"""Run state machine: legality, economy safety, Systems in play, replay, idempotency."""
from __future__ import annotations

import dataclasses
import random

import pytest

from nba_peak.run_the_table import state as S
from nba_peak.run_the_table.cards import get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    BATTLES,
    BOSS_WIN_CREDITS,
    COMEBACK_CREDITS,
    CREDIT_SINKS,
    DECISION_NODES,
    EMERGENCY_RECOVERY_COST,
    EMERGENCY_RECOVERY_MAX_PER_RUN,
    LANE_FIELDS,
    MARKET_REFRESH_COST,
    MARKET_REFRESHES_PER_NODE,
    MAX_LIVES,
    MAX_SYSTEMS,
    RESERVE_CARD_COST,
    REST_CREDITS,
    ROLE_FOCUS_COST,
    ROLES,
    ROSTER_SIZE,
    SCOUT_CHOICES,
    SCOUT_PREP_LANE_BONUS,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STARTING_LIVES,
    TERMINAL_STATUSES,
    TRADE_MACHINE_REFUND_PCT,
    TRADE_REFUND_PCT,
    VETERAN_MINIMUM_PERCENTILE_MAX,
    version_tuple,
)
from nba_peak.run_the_table.generation import (
    generate_blueprint,
    market_offers,
    opening_reveal,
    stage_for,
)
from nba_peak.run_the_table.pricing import price_for, refund_for, trade_net_cost
from nba_peak.run_the_table.state import RunActionError, VersionMismatch

# Seeds chosen for the exact content they generate; each assertion below names
# what it needs from the seed so a regeneration failure is self-explaining.
SEED_TRADE = 12          # act 1 stage 1 offers a Trade Desk at node a1s1o1
# Offers Veteran Minimum, and has a bottom-VETERAN_MINIMUM_PERCENTILE_MAX card
# on the Draft Room boards at a1s1o1, a2s1o0 and a2s2o0. Was 0; re-picked when
# DRAFT_GUARANTEED_AFFORDABLE_COST gave every Draft Room a genuinely cheap
# anchor offer and so changed which cards seed 0's boards hold.
# `test_seed_fixture_still_provides_what_this_test_needs` is the guard that
# catches exactly this, which is why it exists.
# v4 re-pick from 98: the marquee guarantee and the owned-identity substitution
# both change which cards a board holds, so 98 no longer carries a bottom-35%
# offer at every node this fixture needs. Re-picked by search, not by hand.
SEED_VET_MIN = 106
# Offers Trade Machine and opens on a Trade Desk at a1s1o0. Previously borrowed
# SEED_VET_MIN, which coupled two unrelated fixtures to one seed; split out so
# re-picking one of them cannot break the other.
SEED_TRADE_MACHINE = 0
# The "pass" policy loses acts 1, 2 and 3 here, burning all three lives before
# the Final Boss -- the seed the immediate-game-over rule is asserted against.
# v4 re-pick from 6: bosses are now built to the roster they face, so a
# do-nothing run no longer loses every fight by default on an arbitrary seed.
# That is the calibration working, not a regression; the fixture just has to
# name a seed where the roster genuinely cannot keep up.
SEED_ALL_LOSSES = 12
SEED_FILM_EARLY = 3      # Scout & Prepare at act 1 stage 2
# Scout & Prepare ONLY at the very last stage of the run. Re-picked from 9 for
# v3: `_stage_node_types` is keyed per (act, stage), so adding a fifth act gave
# seed 9 further Scout & Prepare nodes and it no longer isolates the last one.
SEED_FILM_LAST = 239
# A greedy run that survives all five acts. v4 re-pick from 27: the boss slate
# is generated per run against the roster facing it, so which seeds a policy
# survives changed wholesale. Note this file drives the policy with
# `random.Random(5)`, NOT with the seed, so it needs its own constant --
# `test_receipt_and_daily.py` has a separate one for a FLAWLESS (5-0) sweep.
SEED_GREEDY_SWEEP = 1


def _volatile(state: S.RunState) -> dict:
    """State as a comparable dict, minus the wall-clock fields."""
    d = dataclasses.asdict(state)
    d.pop("created_at")
    d.pop("last_action_at")
    return d


def _random_scout_and_prepare(st, bp, plan, opt, pool, rng):
    """Take a uniformly random LEGAL Scout & Prepare branch.

    Used by the credits-never-negative fuzzer, so it must offer the paid
    branches whenever they are affordable — a fuzzer that only ever takes the
    free branch would never test the sinks it exists to test.
    """
    options = ["scout_boss"]
    if st.credits >= ROLE_FOCUS_COST and st.role_focus is None:
        options.append("shape_market")
    live = st.reserved_card is not None and st.reserved_card["status"] in (
        "live", "offered"
    )
    reservable = [
        cid for cid in plan.payloads[opt.node_id]["reserve_candidate_ids"]
        if S.legal_slots_for(st, pool, cid) and st.credits >= RESERVE_CARD_COST
    ]
    if reservable and not live:
        options.append("reserve_card")
    choice = rng.choice(options)
    if choice == "scout_boss":
        S.action_film_room(st, bp, choice, lane=rng.choice(list(LANE_FIELDS)), pool=pool)
    elif choice == "shape_market":
        S.action_film_room(st, bp, choice, role=rng.choice(list(ROLES)), pool=pool)
    else:
        S.action_film_room(st, bp, choice, card_id=rng.choice(reservable), pool=pool)


def _drive_to_node(bp, pool, node_id, system_id=None):
    """Create a run, take the first System, and open ``node_id`` in act 1 stage 1."""
    st = S.create_run(bp, "t")
    S.action_select_system(st, bp, system_id or bp.system_offers[0][0])
    S.action_choose_node(st, bp, node_id)
    return st


class TestStandardV3Shape:
    """The frozen v3 run shape (DAILY_RTT_PVP_SECURITY_PLAN §4.3).

    Written as literals on purpose: these are a cross-track contract, so a
    change to any of them must fail here rather than propagate silently into
    the API payload and the UI.
    """

    def test_the_run_shape_is_five_acts_ten_nodes_five_bosses(self):
        assert ACTS == 5
        assert STAGES_PER_ACT == 2
        assert DECISION_NODES == ACTS * STAGES_PER_ACT == 10
        assert BATTLES == ACTS == 5

    def test_the_starting_resources_are_three_lives_and_fifty_credits(self):
        assert STARTING_LIVES == 3
        assert MAX_LIVES == 3
        assert STARTING_CREDITS == 50

    def test_the_ruleset_is_versioned_v4(self):
        from nba_peak.run_the_table.config import RULESET_VERSION

        assert RULESET_VERSION == "rtt_ruleset_v4"
        assert version_tuple()["ruleset_version"] == "rtt_ruleset_v4"

    def test_every_run_locks_a_boss_for_every_act_as_it_reaches_it(
        self, pool, blueprints
    ):
        """REWRITTEN. v3 asserted `len(bp.bosses) == ACTS` -- the blueprint
        carried all five opponents from the moment it was generated.

        DESIGN DECISION (approved): a boss is now generated against the roster
        that will face it, so it cannot exist before its act begins and the
        blueprint has no `bosses` field at all. The replacement asserts the
        stronger property -- exactly one boss is locked per act, at the moment
        that act starts and never before -- which is also what stops a future
        act's lineup from existing to leak.
        """
        bp = blueprints(1)
        assert len(bp.stages) == DECISION_NODES
        assert not hasattr(bp, "bosses")
        st = S.create_run(bp, "r", pool=pool)
        # NOTHING is locked at creation: an opponent built against the opening
        # roster would be stale by the time act 1 is actually fought, because
        # the player spends the whole starting purse in between.
        assert st.boss_lineups == {}
        for act in range(1, ACTS + 1):
            st.act = act
            assert S.boss_for_act(st, bp, act, pool) is None
            locked = S.ensure_boss_for_act(st, bp, act, pool)
            assert locked.act == act
            # Idempotent: asking again serves the lineup already locked.
            assert S.ensure_boss_for_act(st, bp, act, pool) == locked
            assert S.boss_for_act(st, bp, act, pool) == locked
        assert sorted(st.boss_lineups) == list(range(1, ACTS + 1))

    def test_the_published_credit_sink_prices_are_the_spec_prices(self):
        """Spec §4 names three of the four prices outright; the fourth is
        published rather than named. All four are a cross-track contract."""
        assert MARKET_REFRESH_COST == 7
        assert RESERVE_CARD_COST == 5
        assert ROLE_FOCUS_COST == 6
        assert EMERGENCY_RECOVERY_COST == 20
        assert MARKET_REFRESHES_PER_NODE == 1
        assert EMERGENCY_RECOVERY_MAX_PER_RUN == 1
        assert {s["cost"] for s in CREDIT_SINKS.values()} == {7, 5, 6, 20}

    def test_scout_and_prepare_offers_exactly_three_actionable_choices(self):
        """Spec §5: every visit offers three meaningful choices. The v2 pair is
        retired — `take_credits` in particular, which was the whole of the
        node's measured use."""
        assert SCOUT_CHOICES == ("scout_boss", "shape_market", "reserve_card")
        assert S.FILM_CHOICES == SCOUT_CHOICES
        assert "take_credits" not in SCOUT_CHOICES
        assert "scout_offers" not in SCOUT_CHOICES

    def test_the_film_room_no_longer_pays_credits_at_all(self):
        """FILM_CREDITS is deleted, not zeroed: a zeroed constant would let a
        client keep advertising an income source that no longer exists."""
        from nba_peak.run_the_table import config

        assert not hasattr(config, "FILM_CREDITS")


class TestRunCreation:
    def test_a_new_run_starts_at_the_published_resources(self, pool, blueprints):
        st = S.create_run(blueprints(1), "r1")
        assert st.credits == STARTING_CREDITS == 50
        assert st.lives == STARTING_LIVES == 3
        assert st.status == "system_select"
        assert st.act == 1 and st.stage == 1
        assert st.versions == version_tuple()
        assert st.action_log == []
        assert st.veteran_minimum_used_in_act == {a: False for a in range(1, ACTS + 1)}

    def test_the_starting_roster_is_wired_into_role_ordered_slots(self, pool, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r1")
        assert [s.slot_id for s in st.starters] == list(ROLES)
        assert [s.role for s in st.starters] == list(ROLES)
        assert [s.card_id for s in st.starters] == list(bp.starting_starters)
        assert [s.slot_id for s in st.bench] == ["bench_1", "bench_2"]
        assert [s.card_id for s in st.bench] == list(bp.starting_bench)
        assert all(s.is_starter for s in st.starters)
        assert not any(s.is_starter for s in st.bench)

    def test_all_card_ids_returns_the_whole_roster(self, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r1")
        assert st.all_card_ids() == list(bp.starting_starters) + list(bp.starting_bench)


class TestActionLegality:
    def test_actions_must_match_the_current_status(self, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r1")
        with pytest.raises(RunActionError) as exc:
            S.action_choose_node(st, bp, bp.stages[0].options[0].node_id)
        assert exc.value.code == "wrong_status"

    def test_a_system_that_was_not_offered_is_rejected(self, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r1")
        not_offered = next(
            s for s in ("moneyball", "deep_rotation", "no_hardware", "two_way_value",
                        "trade_machine", "veteran_minimum")
            if s not in bp.system_offers[0]
        )
        with pytest.raises(RunActionError) as exc:
            S.action_select_system(st, bp, not_offered)
        assert exc.value.code == "system_not_offered"

    def test_a_node_from_another_stage_is_rejected(self, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r1")
        S.action_select_system(st, bp, bp.system_offers[0][0])
        with pytest.raises(RunActionError) as exc:
            S.action_choose_node(st, bp, "a3s2o0")
        assert exc.value.code == "node_not_available"

    def test_the_wrong_action_for_the_open_node_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")   # a Draft Room
        with pytest.raises(RunActionError) as exc:
            S.action_decline_trade(st, bp)
        assert exc.value.code == "wrong_node_type"

    def test_buying_a_card_that_is_not_on_the_board_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        offered = set(stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"])
        elsewhere = next(c.peak_window_id for c in pool.cards if c.peak_window_id not in offered)
        with pytest.raises(RunActionError) as exc:
            S.action_draft_buy(st, bp, elsewhere, ROLES[0], pool)
        assert exc.value.code == "card_not_offered"

    def test_buying_into_a_role_the_card_cannot_play_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        offers = stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"]
        for cid in offers:
            card = pool.get(cid)
            illegal = [r for r in ROLES if r not in card.eligible_roles]
            if illegal:
                with pytest.raises(RunActionError) as exc:
                    S.action_draft_buy(st, bp, cid, illegal[0], pool)
                assert exc.value.code == "illegal_slot"
                return
        pytest.skip("every offered card on this board is eligible for every role")

    def test_a_film_room_action_at_a_trade_desk_is_rejected_before_the_choice(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o1")   # Trade Desk
        with pytest.raises(RunActionError) as exc:
            S.action_film_room(st, bp, "scout_boss", lane=LANE_FIELDS[0])
        assert exc.value.code == "wrong_node_type"

    def test_an_action_with_no_open_node_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        st.status = "node_active"
        with pytest.raises(RunActionError) as exc:
            S.action_draft_pass(st, bp)
        assert exc.value.code == "no_active_node"

    def test_a_finished_run_refuses_further_actions(self, pool, play_policy):
        bp, st = play_policy(SEED_ALL_LOSSES, random.Random(1), pool, "pass")
        assert st.status in TERMINAL_STATUSES
        with pytest.raises(RunActionError) as exc:
            S.action_advance(st, bp, pool)
        assert exc.value.code == "run_finished"

    def test_unknown_slot_lookup_raises(self, blueprints):
        st = S.create_run(blueprints(1), "r1")
        with pytest.raises(RunActionError) as exc:
            S._slot(st, "bench_9")
        assert exc.value.code == "unknown_slot"


class TestSystemSelection:
    def test_selecting_a_system_advances_to_node_select(self, blueprints, pool):
        bp = blueprints(2)
        st = S.create_run(bp, "r", pool=pool)
        chosen = bp.system_offers[0][1]
        S.action_select_system(st, bp, chosen)
        assert st.systems == [chosen]
        assert st.pending_system_offer is None
        assert st.status == "node_select"

    def test_an_already_held_system_is_filtered_out_of_the_second_offer(self, pool, blueprints):
        for seed in range(60):
            bp = blueprints(seed)
            overlap = set(bp.system_offers[0]) & set(bp.system_offers[1])
            if not overlap:
                continue
            held = sorted(overlap)[0]
            st = S.create_run(bp, "r", pool=pool)
            S.action_select_system(st, bp, held)
            st.pending_system_offer = bp.system_offers[1]
            available = S.available_system_offer(st)
            assert held not in available
            assert len(available) >= 2
            return
        pytest.skip("no seed in range produced overlapping System offers")

    def test_at_most_two_systems_can_be_held(self, blueprints, pool):
        bp = blueprints(2)
        st = S.create_run(bp, "r", pool=pool)
        st.systems = list(bp.system_offers[0][:MAX_SYSTEMS])
        st.pending_system_offer = bp.system_offers[0]
        st.status = "system_select"
        spare = next(s for s in bp.system_offers[0] if s not in st.systems)
        with pytest.raises(RunActionError) as exc:
            S.action_select_system(st, bp, spare)
        assert exc.value.code == "system_limit"

    def test_holding_a_system_twice_is_rejected(self, blueprints, pool):
        bp = blueprints(2)
        st = S.create_run(bp, "r", pool=pool)
        held = bp.system_offers[0][0]
        S.action_select_system(st, bp, held)
        st.pending_system_offer = bp.system_offers[0]
        st.status = "system_select"
        with pytest.raises(RunActionError) as exc:
            S.action_select_system(st, bp, held)
        assert exc.value.code == "system_already_held"


class TestDraftRoom:
    def test_buying_charges_the_listed_price_and_fills_the_slot(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        offers = stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"]
        cid = offers[0]
        slot_id = next(s for s in S.legal_slots_for(st, pool, cid))
        expected_cost, _ = price_for(pool.get(cid), st.systems)
        before = st.credits
        replaced = S._slot(st, slot_id).card_id

        S.action_draft_buy(st, bp, cid, slot_id, pool)

        assert st.credits == before - expected_cost
        assert S._slot(st, slot_id).card_id == cid
        assert st.acquisitions[-1] == {
            "card_id": cid, "slot_id": slot_id, "cost": expected_cost,
            "list_cost": expected_cost, "modifiers": [], "replaced_card_id": replaced,
            "refund": 0, "act": 1, "stage": 1, "veteran_minimum": False,
            "reserved": False,
        }

    def test_a_draft_room_purchase_never_refunds_the_displaced_card(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        cid = stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"][0]
        slot_id = S.legal_slots_for(st, pool, cid)[0]
        cost, _ = price_for(pool.get(cid), st.systems)
        before = st.credits
        S.action_draft_buy(st, bp, cid, slot_id, pool)
        assert st.credits == before - cost
        assert st.acquisitions[-1]["refund"] == 0

    def test_passing_is_always_legal_and_costs_nothing(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        before = st.credits
        S.action_draft_pass(st, bp)
        assert st.credits == before
        assert st.status == "node_select"
        assert st.stage == 2
        assert "a1s1o0" in st.resolved_node_ids

    def test_a_card_already_on_the_roster_has_no_legal_slot(self, pool, blueprints):
        """REWRITTEN. THE OLD ASSERTION ENCODED THE BUG.

        It asserted `legal_slots_for(owned_card) == [the slot it is in]`, with
        the message "the only legal home for an owned card is the slot it
        already occupies" -- i.e. it required the function to report a card as a
        legal acquisition INTO ITS OWN SLOT. That is what made a self-trade
        legal: `action_trade` had no `outgoing != incoming` guard and relied on
        this function to refuse, so trading a card for itself passed every check
        and charged `cost - refund` for a no-op.

        The test name was always right and the assertion always contradicted it.
        It now asserts what the name says, which is also what the function's own
        docstring claimed: a card already on the roster has NO legal slot.
        """
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        owned = bp.starting_starters[0]
        assert S.legal_slots_for(st, pool, owned) == []
        # A different card that can play the same role still has that slot
        # available, so refilling a slot is unaffected.
        role = ROLES[0]
        owned_slugs = {pool.get(c).player_slug for c in st.all_card_ids()}
        blocked = S.unavailable_slugs(st, pool)
        other = next(
            c for c in pool.cards
            if role in c.eligible_roles
            and c.player_slug not in owned_slugs
            and c.player_slug not in blocked
        )
        assert role in S.legal_slots_for(st, pool, other.peak_window_id)

    def test_legal_slots_respect_role_eligibility_and_allow_any_bench_slot(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        owned = {pool.get(c).player_slug for c in st.all_card_ids()}
        outsider = next(c for c in pool.cards if c.player_slug not in owned)
        slots = S.legal_slots_for(st, pool, outsider.peak_window_id)
        assert set(slots) == set(outsider.eligible_roles) | {"bench_1", "bench_2"}

    def test_buying_beyond_your_credits_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        offers = stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"]
        cid = max(offers, key=lambda c: pool.get(c).base_cost)
        slot_id = S.legal_slots_for(st, pool, cid)[0]
        st.credits = price_for(pool.get(cid), st.systems)[0] - 1
        with pytest.raises(RunActionError) as exc:
            S.action_draft_buy(st, bp, cid, slot_id, pool)
        assert exc.value.code == "insufficient_credits"


class TestVeteranMinimumInPlay:
    """Once per act, resets across acts. `SEED_VET_MIN` offers the System and
    puts a bottom-35% card on a Draft Room board in act 1 and in both act-2
    stages."""

    def _cheap(self, pool, ids):
        return [
            c for c in ids
            if pool.get(c).overall_percentile <= VETERAN_MINIMUM_PERCENTILE_MAX
        ]

    def test_seed_fixture_still_provides_what_this_test_needs(self, pool, blueprints):
        bp = blueprints(SEED_VET_MIN)
        assert "veteran_minimum" in bp.system_offers[0]
        assert self._cheap(pool, stage_for(bp, 1, 1).payloads["a1s1o1"]["offer_ids"])
        assert self._cheap(pool, stage_for(bp, 2, 1).payloads["a2s1o0"]["offer_ids"])
        assert self._cheap(pool, stage_for(bp, 2, 2).payloads["a2s2o0"]["offer_ids"])

    def test_veteran_minimum_makes_a_qualifying_card_free(self, pool, blueprints):
        bp = blueprints(SEED_VET_MIN)
        st = _drive_to_node(bp, pool, "a1s1o1", system_id="veteran_minimum")
        cid = self._cheap(pool, stage_for(bp, 1, 1).payloads["a1s1o1"]["offer_ids"])[0]
        list_cost, _ = price_for(pool.get(cid), st.systems)
        assert list_cost > 0
        before = st.credits

        S.action_draft_buy(st, bp, cid, "bench_1", pool, use_veteran_minimum=True)

        assert st.credits == before
        assert st.veteran_minimum_used_in_act[1] is True
        assert st.veteran_minimum_used_in_act[2] is False
        assert st.acquisitions[-1]["cost"] == 0
        assert st.acquisitions[-1]["list_cost"] == list_cost
        assert st.acquisitions[-1]["veteran_minimum"] is True

    def test_it_cannot_be_used_twice_in_one_act_but_resets_across_acts(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_VET_MIN)
        st = _drive_to_node(bp, pool, "a1s1o1", system_id="veteran_minimum")

        # Act 1 — first use is free.
        cid1 = self._cheap(pool, stage_for(bp, 1, 1).payloads["a1s1o1"]["offer_ids"])[0]
        S.action_draft_buy(st, bp, cid1, "bench_1", pool, use_veteran_minimum=True)
        assert st.veteran_minimum_used_in_act == {
            1: True, **{a: False for a in range(2, ACTS + 1)}
        }

        # Walk to act 2.
        S.action_choose_node(st, bp, stage_for(bp, 1, 2).options[0].node_id)
        self._resolve_open_node(st, bp, pool)
        S.action_resolve_boss(st, bp, pool)
        S.action_advance(st, bp, pool)
        if st.status == "system_select":
            S.action_select_system(st, bp, S.available_system_offer(st)[0])
        assert st.act == 2 and st.status == "node_select"

        # Act 2 stage 1 — the allowance has reset, so this one is free again.
        S.action_choose_node(st, bp, "a2s1o0")
        cid2 = self._cheap(pool, stage_for(bp, 2, 1).payloads["a2s1o0"]["offer_ids"])[0]
        before = st.credits
        S.action_draft_buy(st, bp, cid2, "bench_2", pool, use_veteran_minimum=True)
        assert st.credits == before
        assert st.veteran_minimum_used_in_act[2] is True

        # Act 2 stage 2 — asking again in the same act charges full price.
        S.action_choose_node(st, bp, "a2s2o0")
        cid3 = self._cheap(pool, stage_for(bp, 2, 2).payloads["a2s2o0"]["offer_ids"])[0]
        list_cost, _ = price_for(pool.get(cid3), st.systems)
        assert list_cost > 0
        slot = S.legal_slots_for(st, pool, cid3)[0]
        before = st.credits
        S.action_draft_buy(st, bp, cid3, slot, pool, use_veteran_minimum=True)
        assert st.credits == before - list_cost
        assert st.acquisitions[-1]["veteran_minimum"] is False
        assert st.acquisitions[-1]["cost"] == list_cost

    @staticmethod
    def _resolve_open_node(st, bp, pool):
        _, opt = S.node_option(bp, st.active_node_id)
        if opt.node_type == "draft_room":
            S.action_draft_pass(st, bp)
        elif opt.node_type == "trade_desk":
            S.action_decline_trade(st, bp)
        elif opt.node_type == "film_room":
            S.action_film_room(st, bp, "scout_boss", lane=LANE_FIELDS[0], pool=pool)
        else:
            S.action_rest_bank(st, bp, "take_credits")


class TestTradeDesk:
    def test_a_trade_charges_incoming_price_minus_outgoing_refund(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        plain = next(s for s in bp.system_offers[0] if s != "trade_machine")
        st = _drive_to_node(bp, pool, "a1s1o1", system_id=plain)
        assert S.node_option(bp, "a1s1o1")[1].node_type == "trade_desk"
        incoming_ids = stage_for(bp, 1, 1).payloads["a1s1o1"]["incoming_ids"]

        assert "trade_machine" not in st.systems
        cid, slot_id = self._first_legal_trade(st, pool, incoming_ids)
        outgoing = pool.get(S._slot(st, slot_id).card_id)
        incoming = pool.get(cid)
        expected = trade_net_cost(outgoing, incoming, st.systems)
        assert expected["incoming_cost"] == price_for(incoming, st.systems)[0]
        assert expected["outgoing_refund"] == refund_for(outgoing, st.systems)
        assert expected["outgoing_refund"] == int(outgoing.base_cost * TRADE_REFUND_PCT)
        assert expected["net_cost"] == expected["incoming_cost"] - expected["outgoing_refund"]

        before = st.credits
        S.action_trade(st, bp, slot_id, cid, pool)

        assert st.credits == before - expected["net_cost"]
        assert S._slot(st, slot_id).card_id == cid
        assert st.trades[-1]["outgoing_card_id"] == outgoing.peak_window_id
        assert st.trades[-1]["incoming_card_id"] == cid
        assert st.trades[-1]["net_cost"] == expected["net_cost"]
        assert st.trades[-1]["outgoing_refund"] == expected["outgoing_refund"]

    def test_trade_machine_lifts_the_refund_above_the_base_rate(self, pool, blueprints):
        """`SEED_TRADE_MACHINE` offers Trade Machine and opens with a Trade Desk
        at a1s1o0."""
        bp = blueprints(SEED_TRADE_MACHINE)
        assert "trade_machine" in bp.system_offers[0]
        incoming_ids = stage_for(bp, 1, 1).payloads["a1s1o0"]["incoming_ids"]

        results = {}
        for system_id in ("veteran_minimum", "trade_machine"):
            st = _drive_to_node(bp, pool, "a1s1o0", system_id=system_id)
            cid, slot_id = self._first_legal_trade(st, pool, incoming_ids)
            outgoing = pool.get(S._slot(st, slot_id).card_id)
            before = st.credits
            S.action_trade(st, bp, slot_id, cid, pool)
            results[system_id] = (before - st.credits, outgoing, st.trades[-1])

        plain_spend, outgoing, plain_row = results["veteran_minimum"]
        machine_spend, _, machine_row = results["trade_machine"]

        assert plain_row["outgoing_refund"] == int(outgoing.base_cost * TRADE_REFUND_PCT)
        assert machine_row["outgoing_refund"] == int(
            outgoing.base_cost * TRADE_MACHINE_REFUND_PCT
        )
        assert machine_row["incoming_cost"] == plain_row["incoming_cost"]
        assert machine_spend == plain_spend - (
            machine_row["outgoing_refund"] - plain_row["outgoing_refund"]
        )
        assert machine_row["outgoing_refund"] > plain_row["outgoing_refund"]

    def test_declining_a_trade_costs_nothing(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o1")
        before = st.credits
        S.action_decline_trade(st, bp)
        assert st.credits == before
        assert st.status == "node_select"

    def test_a_card_not_on_the_trade_board_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o1")
        offered = set(stage_for(bp, 1, 1).payloads["a1s1o1"]["incoming_ids"])
        elsewhere = next(c.peak_window_id for c in pool.cards if c.peak_window_id not in offered)
        with pytest.raises(RunActionError) as exc:
            S.action_trade(st, bp, ROLES[0], elsewhere, pool)
        assert exc.value.code == "card_not_offered"

    def test_a_trade_the_player_cannot_afford_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o1")
        incoming_ids = stage_for(bp, 1, 1).payloads["a1s1o1"]["incoming_ids"]
        options = [
            (trade_net_cost(pool.get(S._slot(st, slot).card_id), pool.get(cid), st.systems),
             cid, slot)
            for cid in incoming_ids
            for slot in S.legal_slots_for(st, pool, cid)
            if slot in ROLES
        ]
        net, cid, slot_id = max(options, key=lambda row: row[0]["net_cost"])
        assert net["net_cost"] > 0, "seed no longer offers a trade with a positive net cost"
        st.credits = net["net_cost"] - 1
        with pytest.raises(RunActionError) as exc:
            S.action_trade(st, bp, slot_id, cid, pool)
        assert exc.value.code == "insufficient_credits"

    @staticmethod
    def _first_legal_trade(st, pool, incoming_ids):
        for cid in incoming_ids:
            for slot_id in S.legal_slots_for(st, pool, cid):
                if slot_id in ROLES:
                    return cid, slot_id
        raise AssertionError("no legal trade available on this board")


def open_first_of_type(bp, pool, node_type):
    """Walk the run with pass-only actions until a node of this type opens."""
    st = S.create_run(bp, "r", pool=pool)
    guard = 0
    while guard < 80:
        guard += 1
        if st.status == "system_select":
            S.action_select_system(st, bp, S.available_system_offer(st)[0])
        elif st.status == "node_select":
            plan = stage_for(bp, st.act, st.stage)
            match = [o for o in plan.options if o.node_type == node_type]
            S.action_choose_node(st, bp, (match or list(plan.options))[0].node_id, pool)
        elif st.status == "node_active":
            _, opt = S.node_option(bp, st.active_node_id)
            if opt.node_type == node_type:
                return st
            if opt.node_type == "rest_bank" and st.lives < MAX_LIVES:
                # v3 is five acts against three lives, so a walker that always
                # banked instead of healing could not reach a late-act node at
                # all. Healing when hurt is the minimum competence the walk
                # needs; it changes nothing about what is being asserted.
                S.action_rest_bank(st, bp, "recover_life")
            else:
                TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        elif st.status == "boss_ready":
            S.action_resolve_boss(st, bp, pool)
        elif st.status == "boss_resolved":
            S.action_advance(st, bp, pool)
        else:
            break
    raise AssertionError(f"seed {bp.seed} never opened a {node_type}")


class TestScoutAndPrepare:
    """Spec §5. Every visit must produce information plus a preparation, market
    control, or a reserved asset — and never a bare credit payout, which is what
    the v2 Film Room degenerated into (0.0% pick rate for `lane_aware` over
    100,000 seeds; `greedy_overall` took `scout_offers` zero times)."""

    def test_scouting_the_boss_is_free_and_arms_one_capped_lane_preparation(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        before = st.credits
        S.action_film_room(st, bp, "scout_boss", lane="team_achievement", pool=pool)
        assert st.credits == before, "Scout the Boss is the free branch"
        assert st.pending_prep == {
            "lane": "team_achievement",
            "label": "Team Result",
            "bonus": SCOUT_PREP_LANE_BONUS,
            "act": 1,
        }
        assert st.scouted_boss_acts == [1]

    def test_the_preparation_is_applied_to_the_next_battle_and_then_spent(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        act = st.act
        S.action_film_room(st, bp, "scout_boss", lane="statistical_impact", pool=pool)
        while st.status != "boss_ready":
            if st.status == "node_select":
                S.action_choose_node(st, bp, stage_for(bp, st.act, st.stage).options[0].node_id)
            else:
                TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        S.action_resolve_boss(st, bp, pool)

        battle = st.battles[-1]
        assert battle.act == act
        assert battle.lane_bonuses == {"statistical_impact": SCOUT_PREP_LANE_BONUS}
        lane = next(l for l in battle.lanes if l.lane == "statistical_impact")
        assert lane.player_prep_bonus == SCOUT_PREP_LANE_BONUS
        # Spent, not carried: the next act starts with nothing armed.
        assert st.pending_prep is None

    def test_the_preparation_moves_exactly_the_lane_it_named(self, pool):
        """The bonus is a published number on one lane, not a roster buff."""
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        plain = S.create_run(bp, "plain")
        prepared = S.create_run(bp, "prepared")
        boss = S.ensure_boss_for_act(plain, bp, 1, pool)
        from nba_peak.run_the_table.battle import resolve_battle

        args = dict(
            comeback_credits=COMEBACK_CREDITS, win_credits=BOSS_WIN_CREDITS, lives_before=3
        )
        starters = [s.card_id for s in plain.starters]
        bench = [s.card_id for s in prepared.bench]
        a = resolve_battle(pool, starters, bench, boss, (), **args)
        b = resolve_battle(
            pool, starters, bench, boss, (), lane_bonuses={"team_achievement": 2.5}, **args
        )
        for x, y in zip(a.lanes, b.lanes):
            if x.lane == "team_achievement":
                assert round(y.player_score - x.player_score, 4) == 2.5
            else:
                assert y.player_score == x.player_score

    def test_shaping_the_market_charges_its_price_and_reveals_the_next_stage(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        assert (st.act, st.stage) == (1, 2)
        before = st.credits
        S.action_film_room(st, bp, "shape_market", role="anchor", pool=pool)
        assert st.credits == before - ROLE_FOCUS_COST
        assert st.role_focus["role"] == "anchor"
        assert st.role_focus["consumed_node_id"] is None
        # Act 1 has no stage after 2, so the reveal is exactly the next opener.
        assert st.scouted_stage_keys == ["a2s1"]
        assert st.sink_spend[-1]["sink_id"] == "role_focus"
        assert st.sink_spend[-1]["cost"] == ROLE_FOCUS_COST

    def test_a_role_focus_guarantees_a_legal_offer_in_the_next_market(self, pool):
        """The guarantee is on the BOARD, so it has to hold for every seed that
        reaches a market with a focus armed — not just for a convenient one."""
        checked = 0
        for seed in range(60):
            bp = generate_blueprint(seed, pool=pool)
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type not in ("draft_room", "trade_desk"):
                        continue
                    for role in ROLES:
                        ids = market_offers(pool, bp, opt.node_id, role_focus=role)
                        assert any(role in pool.get(cid).eligible_roles for cid in ids), (
                            f"seed {seed} node {opt.node_id}: no {role} after Role Focus"
                        )
                        slugs = [pool.get(cid).player_slug for cid in ids]
                        assert len(set(slugs)) == len(slugs)
                        checked += 1
        assert checked > 500

    def test_reserving_a_card_locks_todays_price_and_charges_the_fee(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        plan, opt = S.node_option(bp, st.active_node_id)
        card_id = plan.payloads[opt.node_id]["reserve_candidate_ids"][0]
        expected_cost, expected_mods = price_for(pool.get(card_id), st.systems)
        before = st.credits

        S.action_film_room(st, bp, "reserve_card", card_id=card_id, pool=pool)

        assert st.credits == before - RESERVE_CARD_COST
        assert st.reserved_card == {
            "card_id": card_id,
            "locked_cost": expected_cost,
            "locked_modifiers": expected_mods,
            "reserved_act": 1,
            "reserved_stage": 2,
            "offered_node_id": None,
            "status": "live",
        }

    def test_a_reserved_card_appears_in_the_next_draft_room_and_then_expires(self, pool):
        bp, st, card_id, node_id = self._reserve_then_open_a_draft_room(pool)
        assert card_id in S.node_offers(st, bp, node_id, pool)
        assert st.reserved_card["status"] == "offered"
        assert st.reserved_card["offered_node_id"] == node_id

        S.action_draft_pass(st, bp)
        assert st.reserved_card["status"] == "expired"
        # And it is gone from every later board.
        for plan in bp.stages:
            for opt in plan.options:
                if opt.node_type == "draft_room" and opt.node_id != node_id:
                    assert card_id not in S.node_offers(st, bp, opt.node_id, pool) or (
                        card_id in plan.payloads[opt.node_id]["offer_ids"]
                    )

    def test_buying_a_reserved_card_charges_the_locked_price_not_the_live_one(self, pool):
        bp, st, card_id, node_id = self._reserve_then_open_a_draft_room(pool)
        locked = st.reserved_card["locked_cost"]
        slot = S.legal_slots_for(st, pool, card_id)[0]
        before = st.credits
        S.action_draft_buy(st, bp, card_id, slot, pool)
        assert st.credits == before - locked
        assert st.acquisitions[-1]["reserved"] is True
        assert st.acquisitions[-1]["cost"] == locked
        assert st.reserved_card["status"] == "used"

    def test_only_one_reservation_can_be_live_at_a_time(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        plan, opt = S.node_option(bp, st.active_node_id)
        card_id = plan.payloads[opt.node_id]["reserve_candidate_ids"][0]
        S.action_film_room(st, bp, "reserve_card", card_id=card_id, pool=pool)
        st.status = "node_active"
        st.active_node_id = opt.node_id
        with pytest.raises(RunActionError) as exc:
            S.action_film_room(st, bp, "reserve_card", card_id=card_id, pool=pool)
        assert exc.value.code == "reservation_active"

    def test_a_card_that_is_not_a_revealed_candidate_cannot_be_reserved(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        plan, opt = S.node_option(bp, st.active_node_id)
        offered = set(plan.payloads[opt.node_id]["reserve_candidate_ids"])
        elsewhere = next(
            c.peak_window_id for c in pool.cards if c.peak_window_id not in offered
        )
        with pytest.raises(RunActionError) as exc:
            S.action_film_room(st, bp, "reserve_card", card_id=elsewhere, pool=pool)
        assert exc.value.code == "card_not_offered"

    def test_a_broke_player_can_still_always_scout(self, pool):
        """The free branch is what makes this node dead-end-proof, exactly as
        `draft_pass` does for a Draft Room."""
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        st.credits = 0
        with pytest.raises(RunActionError):
            S.action_film_room(st, bp, "shape_market", role="anchor", pool=pool)
        st.status = "node_active"
        S.action_film_room(st, bp, "scout_boss", lane=LANE_FIELDS[0], pool=pool)
        assert st.credits == 0
        assert st.pending_prep is not None

    def test_the_v2_choices_are_refused(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        for stale in ("take_credits", "scout_offers"):
            st = open_first_of_type(bp, pool, "film_room")
            with pytest.raises(RunActionError) as exc:
                S.action_film_room(st, bp, stale, pool=pool)
            assert exc.value.code == "unknown_choice"

    def test_scouting_without_naming_a_lane_is_refused(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        with pytest.raises(RunActionError) as exc:
            S.action_film_room(st, bp, "scout_boss", lane="vibes", pool=pool)
        assert exc.value.code == "unknown_lane"

    def test_a_scout_and_prepare_node_at_the_final_stage_still_arms_a_preparation(
        self, pool
    ):
        """v2's documented no-op: `scout_offers` at the last stage revealed
        nothing at all. The v3 node always has the act's own boss to prepare for,
        so the last stage of the last act is a real choice too."""
        bp = generate_blueprint(SEED_FILM_LAST, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        assert (st.act, st.stage) == (ACTS, STAGES_PER_ACT)
        S.action_film_room(st, bp, "scout_boss", lane=LANE_FIELDS[0], pool=pool)
        assert st.pending_prep["act"] == ACTS

    def _reserve_then_open_a_draft_room(self, pool):
        """Reserve a card, then walk to the next Draft Room and open it."""
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        plan, opt = S.node_option(bp, st.active_node_id)
        card_id = next(
            cid for cid in plan.payloads[opt.node_id]["reserve_candidate_ids"]
            if S.legal_slots_for(st, pool, cid)
        )
        st.credits = 60
        S.action_film_room(st, bp, "reserve_card", card_id=card_id, pool=pool)
        guard = 0
        while guard < 60:
            guard += 1
            if st.status == "system_select":
                S.action_select_system(st, bp, S.available_system_offer(st)[0])
            elif st.status == "node_select":
                plan = stage_for(bp, st.act, st.stage)
                match = [o for o in plan.options if o.node_type == "draft_room"]
                if not match:
                    S.action_choose_node(st, bp, plan.options[0].node_id)
                    continue
                S.action_choose_node(st, bp, match[0].node_id)
                return bp, st, card_id, match[0].node_id
            elif st.status == "node_active":
                TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
            elif st.status == "boss_ready":
                S.action_resolve_boss(st, bp, pool)
            elif st.status == "boss_resolved":
                S.action_advance(st, bp, pool)
            else:
                break
        raise AssertionError("seed never reached a Draft Room after reserving")


class TestFilmAndRest:
    def test_rest_bank_credits_and_life_recovery_are_exclusive(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = open_first_of_type(bp, pool, "rest_bank")
        before_credits, before_lives = st.credits, st.lives
        S.action_rest_bank(st, bp, "take_credits")
        assert st.credits == before_credits + REST_CREDITS
        assert st.lives == before_lives

    def test_life_recovery_is_capped_at_max_lives(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = open_first_of_type(bp, pool, "rest_bank")
        st.lives = MAX_LIVES
        before_credits = st.credits
        S.action_rest_bank(st, bp, "recover_life")
        assert st.lives == MAX_LIVES
        assert st.credits == before_credits

    def test_unknown_choices_are_rejected(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = open_first_of_type(bp, pool, "rest_bank")
        with pytest.raises(RunActionError) as exc:
            S.action_rest_bank(st, bp, "nap")
        assert exc.value.code == "unknown_choice"



class TestBossProgression:
    def test_a_boss_battle_moves_the_run_forward_one_act(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        for stage in range(1, STAGES_PER_ACT + 1):
            S.action_choose_node(st, bp, stage_for(bp, 1, stage).options[0].node_id)
            TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        assert st.status == "boss_ready"
        assert st.stage == STAGES_PER_ACT + 1

        S.action_resolve_boss(st, bp, pool)
        assert st.status == "boss_resolved"
        assert len(st.battles) == 1
        assert st.battles[0].boss_id == S.boss_for_act(st, bp, 1, pool).boss_id

        S.action_advance(st, bp, pool)
        assert st.act == 2
        assert st.stage == 1
        assert st.status in {"system_select", "node_select"}

    def test_a_battle_with_an_incomplete_roster_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        st.status = "boss_ready"
        S.ensure_boss_for_act(st, bp, 1, pool)
        st.starters[0].card_id = None
        with pytest.raises(RunActionError) as exc:
            S.action_resolve_boss(st, bp, pool)
        assert exc.value.code == "incomplete_roster"

    def test_losing_every_battle_burns_the_lives_and_fails_the_run(self, pool, play_policy):
        bp, st = play_policy(SEED_ALL_LOSSES, random.Random(3), pool, "pass")
        assert [b.outcome for b in st.battles] == ["loss", "loss", "loss"]
        assert [b.lives_after for b in st.battles] == [2, 1, 0]
        assert [b.credits_awarded for b in st.battles] == [
            COMEBACK_CREDITS, COMEBACK_CREDITS, 0
        ]
        assert st.lives == 0
        assert st.status == "failed"
        # THE RUN ENDS AT THE THIRD LOSS, in act 3, with the act-5 Final Boss
        # never fought. Three lives against five bosses is what makes running out
        # of lives a real ending rather than an arithmetic impossibility.
        assert len(st.battles) == 3
        assert st.battles[-1].act == 3
        assert st.act < ACTS

    def test_the_run_ends_the_instant_lives_hit_zero_without_an_advance(
        self, pool, blueprints
    ):
        """v1 only checked lives inside `_advance_after_boss`, so a run was still
        live until the client acknowledged the battle. Resolving the boss is now
        itself terminal."""
        bp = blueprints(SEED_ALL_LOSSES)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        st.lives = 1
        while st.status != "boss_ready":
            if st.status == "node_select":
                S.action_choose_node(st, bp, stage_for(bp, st.act, st.stage).options[0].node_id)
            else:
                TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        S.action_resolve_boss(st, bp, pool)
        assert st.battles[-1].outcome == "loss"
        assert st.lives == 0
        assert st.status == "failed"
        with pytest.raises(RunActionError) as exc:
            S.action_advance(st, bp, pool)
        assert exc.value.code == "run_finished"

    def test_winning_a_boss_pays_the_published_win_reward(self, pool, blueprints):
        """v1 paid a winner NOTHING and a loser 8 credits, so the only battle
        income in the game went to the player who was losing."""
        bp = blueprints(8)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        for stage in range(1, STAGES_PER_ACT + 1):
            S.action_choose_node(st, bp, stage_for(bp, 1, stage).options[0].node_id)
            TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        before = st.credits
        S.action_resolve_boss(st, bp, pool)
        battle = st.battles[0]
        assert battle.outcome == "win"
        assert battle.credits_awarded == BOSS_WIN_CREDITS
        assert st.credits == before + BOSS_WIN_CREDITS
        assert st.lives == STARTING_LIVES
        assert BOSS_WIN_CREDITS > COMEBACK_CREDITS

    def test_a_boss_index_beyond_the_blueprint_is_refused_not_an_index_error(
        self, pool, blueprints
    ):
        """`blueprint.bosses[state.act - 1]` had no length guard, so any drift
        between a stored act and the generated boss list was a 500. v4 resolves
        the boss through `boss_for_act`, which answers None for an out-of-range
        act and for one that was never locked; both must still be a 409."""
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        st.status = "boss_ready"
        st.act = ACTS + 1
        with pytest.raises(RunActionError) as exc:
            S.action_resolve_boss(st, bp, pool)
        assert exc.value.code == "no_boss_for_act"

    def test_comeback_credits_actually_land_in_the_players_balance(self, pool, blueprints):
        bp = blueprints(SEED_ALL_LOSSES)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        for stage in range(1, STAGES_PER_ACT + 1):
            S.action_choose_node(st, bp, stage_for(bp, 1, stage).options[0].node_id)
            TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        before = st.credits
        S.action_resolve_boss(st, bp, pool)
        battle = st.battles[0]
        assert st.credits == before + battle.credits_awarded
        if battle.outcome == "loss":
            assert battle.credits_awarded == COMEBACK_CREDITS
            assert st.lives == STARTING_LIVES - 1

    def test_a_run_that_survives_all_five_acts_completes(self, pool, play_policy):
        bp, st = play_policy(SEED_GREEDY_SWEEP, random.Random(5), pool, "greedy")
        assert st.status == "complete"
        assert len(st.battles) == ACTS == 5
        assert st.lives >= 1


class TestCreditsNeverGoNegative:
    """Fuzz: every legal action sequence must keep the balance at or above zero."""

    def _random_run(self, pool, seed, rng):
        bp = generate_blueprint(seed, pool=pool)
        st = S.create_run(bp, f"fuzz-{seed}")
        guard = 0
        while st.status not in TERMINAL_STATUSES:
            guard += 1
            assert guard <= 80, f"seed {seed} never terminated"
            self._random_action(st, bp, pool, rng)
            assert st.credits >= 0, (
                f"seed {seed} went to {st.credits} credits after "
                f"{st.action_log[-1].action_type}"
            )
        return st

    @staticmethod
    def _random_action(st, bp, pool, rng):
        if st.status == "system_select":
            S.action_select_system(st, bp, rng.choice(list(S.available_system_offer(st))))
        elif st.status == "node_select":
            S.action_choose_node(st, bp, rng.choice(list(stage_for(bp, st.act, st.stage).options)).node_id)
        elif st.status == "node_active":
            plan, opt = S.node_option(bp, st.active_node_id)
            if opt.node_type == "draft_room":
                buys = []
                for cid in S.node_offers(st, bp, opt.node_id, pool):
                    card = pool.get(cid)
                    free = S.veteran_minimum_available(
                        card, st.systems, st.veteran_minimum_used_in_act[st.act]
                    )
                    cost = 0 if free else price_for(card, st.systems)[0]
                    if cost > st.credits:
                        continue
                    buys += [(cid, slot, free) for slot in S.legal_slots_for(st, pool, cid)]
                if buys and rng.random() < 0.8:
                    cid, slot, free = rng.choice(buys)
                    S.action_draft_buy(st, bp, cid, slot, pool, free)
                else:
                    S.action_draft_pass(st, bp)
            elif opt.node_type == "trade_desk":
                trades = []
                for cid in S.node_offers(st, bp, opt.node_id, pool):
                    for slot in S.legal_slots_for(st, pool, cid):
                        current = S._slot(st, slot).card_id
                        if not current:
                            continue
                        net = trade_net_cost(pool.get(current), pool.get(cid), st.systems)
                        if net["net_cost"] <= st.credits:
                            trades.append((cid, slot))
                if trades and rng.random() < 0.8:
                    cid, slot = rng.choice(trades)
                    S.action_trade(st, bp, slot, cid, pool)
                else:
                    S.action_decline_trade(st, bp)
            elif opt.node_type == "film_room":
                _random_scout_and_prepare(st, bp, plan, opt, pool, rng)
            else:
                S.action_rest_bank(st, bp, rng.choice(list(S.REST_CHOICES)))
        elif st.status == "boss_ready":
            S.action_resolve_boss(st, bp, pool)
        else:
            S.action_advance(st, bp, pool)

    def test_random_legal_play_never_produces_a_negative_balance(self, pool):
        rng = random.Random(31337)
        finals = []
        for seed in range(120):
            st = self._random_run(pool, seed, rng)
            finals.append(st.credits)
        assert all(c >= 0 for c in finals)
        assert any(c < STARTING_CREDITS for c in finals), "the fuzzer never spent anything"

    def test_every_deterministic_policy_keeps_the_balance_non_negative(self, pool, play_policy):
        for policy in ("greedy", "random", "first", "pass"):
            for seed in range(40):
                _, st = play_policy(seed, random.Random(seed), pool, policy)
                assert st.credits >= 0
                for a in st.action_log:
                    assert a.act >= 1 and a.stage >= 1

    def test_a_run_can_never_spend_more_than_it_earns(self, pool, play_policy):
        """The whole v3 ledger, including the four credit sinks.

        Rest / Bank is now the ONLY node that pays credits — Scout & Prepare
        pays nothing and can only cost — so this is also the assertion that
        catches a stray income line reappearing.
        """
        for policy in ("greedy", "random"):
            for seed in range(40):
                _, st = play_policy(seed, random.Random(seed), pool, policy)
                spent = sum(a["cost"] for a in st.acquisitions) + sum(
                    t["net_cost"] for t in st.trades
                ) + sum(row["cost"] for row in st.sink_spend)
                earned = sum(b.credits_awarded for b in st.battles)
                earned += sum(
                    REST_CREDITS for a in st.action_log
                    if a.action_type == "rest_bank"
                    and a.payload["choice"] == "take_credits"
                )
                assert st.credits == STARTING_CREDITS + earned - spent
                assert S.credit_sink_total(st) == sum(
                    row["cost"] for row in st.sink_spend
                )


class TestApiAccessors:
    """The two payload builders the API layer drives the node and the reveal
    from. They exist so a price or a legality rule is stated once."""

    def test_scout_and_prepare_options_price_and_gate_all_three_choices(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        payload = S.scout_and_prepare_options(st, bp, pool)

        assert [c["id"] for c in payload["choices"]] == list(SCOUT_CHOICES)
        by_id = {c["id"]: c for c in payload["choices"]}
        assert by_id["scout_boss"]["cost"] == 0
        assert by_id["scout_boss"]["available"] is True
        assert by_id["scout_boss"]["prep_bonus"] == SCOUT_PREP_LANE_BONUS
        assert by_id["scout_boss"]["report"]["boss_id"] == S.boss_for_act(
            st, bp, st.act, pool
        ).boss_id
        assert by_id["shape_market"]["cost"] == ROLE_FOCUS_COST
        assert by_id["reserve_card"]["cost"] == RESERVE_CARD_COST
        assert [c["card_id"] for c in by_id["reserve_card"]["candidates"]] == (
            S.node_option(bp, st.active_node_id)[0]
            .payloads[st.active_node_id]["reserve_candidate_ids"]
        )

    def test_a_broke_player_sees_the_paid_options_locked_with_a_reason(self, pool):
        """Locked WITH a reason, not hidden: hiding a sink is how a player never
        learns it exists."""
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        st.credits = 0
        by_id = {c["id"]: c for c in S.scout_and_prepare_options(st, bp, pool)["choices"]}
        assert by_id["scout_boss"]["available"] is True
        assert by_id["shape_market"]["available"] is False
        assert by_id["shape_market"]["unavailable_reason"] == "insufficient_credits"
        assert by_id["reserve_card"]["available"] is False

    def test_the_options_accessor_agrees_with_what_the_action_accepts(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        st.credits = 0
        by_id = {c["id"]: c for c in S.scout_and_prepare_options(st, bp, pool)["choices"]}
        for choice_id, kwargs in (
            ("shape_market", {"role": "anchor"}),
            ("reserve_card", {"card_id": by_id["reserve_card"]["candidates"][0]["card_id"]}),
        ):
            assert by_id[choice_id]["available"] is False
            with pytest.raises(RunActionError):
                S.action_film_room(st, bp, choice_id, pool=pool, **kwargs)
            st.status = "node_active"

    def test_reveal_progress_carries_both_reveals_and_their_positions(
        self, pool, blueprints
    ):
        bp = blueprints(1)
        st = S.create_run(bp, "r", pool=pool)
        S.ensure_boss_for_act(st, bp, 1, pool)
        payload = S.reveal_progress(st, bp, pool)
        assert payload["roster"]["total"] == ROSTER_SIZE
        assert payload["roster"]["revealed"] == 0
        assert payload["roster"]["complete"] is False
        assert len(payload["roster"]["slots"]) == ROSTER_SIZE
        assert payload["boss"]["boss_id"] == S.boss_for_act(st, bp, 1, pool).boss_id
        # v4: lineups are generated per run, so `source` is "generated". It was
        # "curated" while the slate was five constants.
        assert payload["boss"]["source"] == "generated"
        assert len(payload["boss"]["slots"]) == ROSTER_SIZE

        S.action_reveal(st, bp, "roster", ROSTER_SIZE)
        payload = S.reveal_progress(st, bp, pool)
        assert payload["roster"]["complete"] is True


class TestMarketRefresh:
    """Spec §4: 7 credits, once per node, deterministic replacement."""

    def test_a_refresh_charges_the_published_price_and_replaces_the_board(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        before_board = list(S.node_offers(st, bp, "a1s1o0", pool))
        before = st.credits

        S.action_market_refresh(st, bp, pool)

        assert st.credits == before - MARKET_REFRESH_COST
        assert st.node_refreshes["a1s1o0"] == 1
        after_board = S.node_offers(st, bp, "a1s1o0", pool)
        assert after_board != before_board
        # A real replacement, not a shuffle: no identity survives.
        before_slugs = {pool.get(c).player_slug for c in before_board}
        after_slugs = {pool.get(c).player_slug for c in after_board}
        assert not (before_slugs & after_slugs)
        # The node is still open — a refresh is not the node's move.
        assert st.status == "node_active"
        assert st.active_node_id == "a1s1o0"

    def test_a_second_refresh_at_the_same_node_is_refused(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        S.action_market_refresh(st, bp, pool)
        with pytest.raises(RunActionError) as exc:
            S.action_market_refresh(st, bp, pool)
        assert exc.value.code == "refresh_limit"

    def test_the_replacement_board_is_a_pure_function_of_the_seed(self, pool, blueprints):
        """Refreshing must not be re-rollable: two runs on one seed that both
        refresh the same node must see the same second board."""
        bp = blueprints(SEED_TRADE)
        boards = []
        for run_id in ("a", "b"):
            st = _drive_to_node(bp, pool, "a1s1o0")
            S.action_market_refresh(st, bp, pool)
            boards.append(S.node_offers(st, bp, "a1s1o0", pool))
        assert boards[0] == boards[1]

    def test_a_refreshed_draft_board_keeps_the_affordability_guarantee(
        self, pool, blueprints
    ):
        from nba_peak.run_the_table.config import DRAFT_GUARANTEED_AFFORDABLE_COST
        from nba_peak.run_the_table.generation import refreshed_offers

        checked = 0
        for seed in range(60):
            bp = blueprints(seed)
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type != "draft_room":
                        continue
                    ids = refreshed_offers(pool, bp, opt.node_id, 1)
                    costs = [pool.get(cid).base_cost for cid in ids]
                    assert min(costs) <= DRAFT_GUARANTEED_AFFORDABLE_COST
                    checked += 1
        assert checked > 100

    def test_a_player_who_cannot_afford_a_refresh_is_refused(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        st.credits = MARKET_REFRESH_COST - 1
        with pytest.raises(RunActionError) as exc:
            S.action_market_refresh(st, bp, pool)
        assert exc.value.code == "insufficient_credits"
        assert st.credits == MARKET_REFRESH_COST - 1

    def test_a_refresh_is_only_offered_where_there_is_a_market(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = open_first_of_type(bp, pool, "film_room")
        with pytest.raises(RunActionError) as exc:
            S.action_market_refresh(st, bp, pool)
        assert exc.value.code == "wrong_node_type"


class TestEmergencyRecovery:
    """Spec §4: a published price for one life, capped per run."""

    def _open_rest(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        return bp, open_first_of_type(bp, pool, "rest_bank")

    def test_it_buys_a_life_at_the_published_price(self, pool):
        bp, st = self._open_rest(pool)
        st.lives = 1
        before = st.credits = 40
        S.action_emergency_recovery(st, bp)
        assert st.lives == 2
        assert st.credits == before - EMERGENCY_RECOVERY_COST
        assert st.emergency_recoveries_used == 1
        assert st.sink_spend[-1]["sink_id"] == "emergency_recovery"

    def test_it_stacks_with_the_free_recovery_at_the_same_node(self, pool):
        """This is why it is worth its price: one Rest / Bank visit can take a
        run from one life to three. A paid copy of the free option would be
        strictly worse than the free option."""
        bp, st = self._open_rest(pool)
        st.lives = 1
        st.credits = 40
        S.action_emergency_recovery(st, bp)
        S.action_rest_bank(st, bp, "recover_life")
        assert st.lives == 3

    def test_it_is_capped_per_run(self, pool):
        bp, st = self._open_rest(pool)
        st.lives = 1
        st.credits = 200
        S.action_emergency_recovery(st, bp)
        st.lives = 1
        with pytest.raises(RunActionError) as exc:
            S.action_emergency_recovery(st, bp)
        assert exc.value.code == "recovery_limit"
        assert st.emergency_recoveries_used == EMERGENCY_RECOVERY_MAX_PER_RUN

    def test_it_is_refused_at_full_lives(self, pool):
        bp, st = self._open_rest(pool)
        st.credits = 200
        assert st.lives == MAX_LIVES
        with pytest.raises(RunActionError) as exc:
            S.action_emergency_recovery(st, bp)
        assert exc.value.code == "lives_full"

    def test_it_is_only_offered_at_a_rest_bank(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        st.lives = 1
        with pytest.raises(RunActionError) as exc:
            S.action_emergency_recovery(st, bp)
        assert exc.value.code == "wrong_node_type"

    def test_it_never_drives_the_balance_negative(self, pool):
        bp, st = self._open_rest(pool)
        st.lives = 1
        st.credits = EMERGENCY_RECOVERY_COST - 1
        with pytest.raises(RunActionError) as exc:
            S.action_emergency_recovery(st, bp)
        assert exc.value.code == "insufficient_credits"
        assert st.credits == EMERGENCY_RECOVERY_COST - 1
        assert st.lives == 1


class TestOpeningReveal:
    """Spec §3: the server preselects the roster; the client only animates."""

    def test_the_reveal_is_the_seven_published_slots_in_order(self, pool, blueprints):
        bp = blueprints(1)
        rows = opening_reveal(pool, bp)
        assert [r["label"] for r in rows] == [
            "Lead Creator", "Guard/Wing", "Wing/Forward", "Forward/Big", "Anchor",
            "Bench 1", "Bench 2",
        ]
        assert [r["order"] for r in rows] == list(range(ROSTER_SIZE))
        assert [r["card_id"] for r in rows] == (
            list(bp.starting_starters) + list(bp.starting_bench)
        )
        assert all(r["duration_years"] == 3 for r in
                   [{"duration_years": pool.get(x["card_id"]).duration_years} for x in rows])

    def test_the_same_seed_reveals_the_same_roster(self, pool):
        a = opening_reveal(pool, generate_blueprint(77, pool=pool))
        b = opening_reveal(pool, generate_blueprint(77, pool=pool))
        assert a == b

    def test_reveal_progress_is_server_side_and_resumable(self, blueprints, pool):
        bp = blueprints(1)
        st = S.create_run(bp, "r", pool=pool)
        assert st.reveal_index == 0
        S.action_reveal(st, bp, "roster", 1)
        S.action_reveal(st, bp, "roster", 2)
        assert st.reveal_index == 3
        # Skip-all is one call and saturates rather than overrunning.
        S.action_reveal(st, bp, "roster", 99)
        assert st.reveal_index == ROSTER_SIZE

    def test_boss_reveal_progress_is_tracked_per_act(self, pool, blueprints):
        bp = blueprints(1)
        st = S.create_run(bp, "r", pool=pool)
        S.ensure_boss_for_act(st, bp, 1, pool)
        S.action_reveal(st, bp, "boss", 3)
        assert st.boss_reveal_index == {1: 3}
        # v4: an act's boss does not exist until that act begins, so reaching
        # act 2 means going through the transition that locks it rather than
        # just moving the counter.
        st.lives = 3
        S._advance_after_boss(st, bp, pool)
        assert st.act == 2
        S.ensure_boss_for_act(st, bp, 2, pool)
        S.action_reveal(st, bp, "boss", 99)
        assert st.boss_reveal_index == {1: 3, 2: ROSTER_SIZE}

    def test_the_reveal_replays_exactly(self, pool, blueprints):
        """A boss reveal is only reachable once its lineup is locked, so the
        replay has to reach that state the same way the original did -- by
        opening a Scout & Prepare node, which is what locks it."""
        bp = blueprints(SEED_FILM_EARLY)
        st = open_first_of_type(bp, pool, "film_room")
        S.action_reveal(st, bp, "roster", 4)
        S.action_reveal(st, bp, "boss", 2)

        rebuilt = S.replay(bp, st.action_log, "r", pool=pool)
        assert rebuilt.reveal_index == 4
        assert rebuilt.boss_reveal_index == {st.act: 2}
        # The replayed run must serve the SAME locked lineup, not a fresh one.
        assert rebuilt.boss_lineups == st.boss_lineups

    def test_an_unknown_reveal_target_is_rejected(self, blueprints, pool):
        bp = blueprints(1)
        st = S.create_run(bp, "r", pool=pool)
        with pytest.raises(RunActionError) as exc:
            S.action_reveal(st, bp, "opponent_bench", 1)
        assert exc.value.code == "unknown_reveal_target"

    def test_the_reveal_gates_nothing(self, pool, blueprints):
        """A client that never calls it is degraded, not broken."""
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        assert st.reveal_index == 0
        S.action_select_system(st, bp, bp.system_offers[0][0])
        S.action_choose_node(st, bp, "a1s1o0")
        assert st.status == "node_active"


class TestLiveMarketOffers:
    """`node_offers` is the one place the board is decided, so what is shown and
    what is legal can never drift apart."""

    def test_an_untouched_node_offers_exactly_its_blueprint_board(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        assert S.node_offers(st, bp, "a1s1o0", pool) == (
            stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"]
        )

    def test_a_card_that_is_not_on_the_live_board_cannot_be_bought(self, pool, blueprints):
        """Specifically: the pre-refresh board stops being buyable."""
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        stale = list(S.node_offers(st, bp, "a1s1o0", pool))
        S.action_market_refresh(st, bp, pool)
        for cid in stale:
            slots = S.legal_slots_for(st, pool, cid)
            if not slots:
                continue
            with pytest.raises(RunActionError) as exc:
                S.action_draft_buy(st, bp, cid, slots[0], pool)
            assert exc.value.code == "card_not_offered"
            return
        pytest.skip("no stale offer had a legal slot on this board")

    def test_role_focus_is_a_no_op_when_the_board_already_has_the_role(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_TRADE)
        base = market_offers(pool, bp, "a1s1o0")
        present = next(
            (r for r in ROLES if any(r in pool.get(c).eligible_roles for c in base)), None
        )
        assert present is not None
        assert market_offers(pool, bp, "a1s1o0", role_focus=present) == base


class TestVersionRetirement:
    """Plan §4.3: a v2 run retires through the existing strict gate rather than
    being silently reinterpreted under v3 rules."""

    def test_a_saved_v2_run_is_refused_by_name(self):
        saved = dict(version_tuple())
        saved["ruleset_version"] = "rtt_ruleset_v2"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        message = str(exc.value)
        assert "rtt_ruleset_v2" in message
        assert "rtt_ruleset_v4" in message
        assert "previous ruleset" in message
        assert exc.value.changed_fields == ["ruleset_version"]

    def test_a_v2_run_is_never_partially_accepted(self):
        """There is no lenient path: the gate is checked before anything reads
        the saved state, so a four-act run can never walk into act 5."""
        for stale in ("rtt_ruleset_v1", "rtt_ruleset_v2", "rtt_ruleset_v2.1"):
            saved = dict(version_tuple())
            saved["ruleset_version"] = stale
            with pytest.raises(VersionMismatch):
                S.assert_version_compatible(saved)

    def test_a_daily_seed_changes_when_the_ruleset_does(self):
        """`daily.daily_seed` is salted by RULESET_VERSION, so every v3 daily
        board differs from the v2 board for the same date. That is intended:
        a stored v2 daily result can never be re-scored under v3 rules."""
        import hashlib

        from nba_peak.run_the_table.daily import daily_seed

        date = "2026-07-31"
        v2 = int(hashlib.sha256(
            f"run-the-table-daily:rtt_ruleset_v2:{date}".encode()
        ).hexdigest(), 16) % (2 ** 31)
        assert daily_seed(date) != v2


class TestIdempotency:
    def test_a_repeated_key_is_a_no_op_on_every_action_type(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)

        S.action_select_system(st, bp, bp.system_offers[0][0], idempotency_key="k1")
        snapshot = _volatile(st)
        S.action_select_system(st, bp, bp.system_offers[0][1], idempotency_key="k1")
        assert _volatile(st) == snapshot
        assert len(st.action_log) == 1

        S.action_choose_node(st, bp, "a1s1o0", idempotency_key="k2")
        snapshot = _volatile(st)
        S.action_choose_node(st, bp, "a1s1o1", idempotency_key="k2")
        assert _volatile(st) == snapshot
        assert len(st.action_log) == 2

    def test_a_repeated_purchase_key_does_not_double_charge(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o0")
        cid = stage_for(bp, 1, 1).payloads["a1s1o0"]["offer_ids"][0]
        slot_id = S.legal_slots_for(st, pool, cid)[0]

        S.action_draft_buy(st, bp, cid, slot_id, pool, idempotency_key="buy-1")
        snapshot = _volatile(st)
        log_len = len(st.action_log)

        S.action_draft_buy(st, bp, cid, slot_id, pool, idempotency_key="buy-1")
        assert _volatile(st) == snapshot
        assert len(st.action_log) == log_len
        assert len(st.acquisitions) == 1

    def test_a_repeated_boss_key_does_not_double_resolve(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        for stage in range(1, STAGES_PER_ACT + 1):
            S.action_choose_node(st, bp, stage_for(bp, 1, stage).options[0].node_id)
            TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)

        S.action_resolve_boss(st, bp, pool, idempotency_key="boss-1")
        snapshot = _volatile(st)
        S.action_resolve_boss(st, bp, pool, idempotency_key="boss-1")
        assert _volatile(st) == snapshot
        assert len(st.battles) == 1

    def test_distinct_keys_are_not_deduplicated(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0], idempotency_key="a")
        S.action_choose_node(st, bp, "a1s1o0", idempotency_key="b")
        assert [a.idempotency_key for a in st.action_log] == ["a", "b"]


class TestReplay:
    def test_replay_recreates_the_final_state_exactly(self, pool, play_policy):
        for policy in ("greedy", "random", "first", "pass"):
            for seed in (0, 12, 44, 101, 777):
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                rebuilt = S.replay(bp, st.action_log, st.run_id, pool=pool)
                assert _volatile(rebuilt) == _volatile(st), (
                    f"replay diverged for seed {seed} under policy {policy}"
                )

    def test_replay_from_a_freshly_generated_blueprint_also_matches(self, pool, play_policy):
        _, st = play_policy(55, random.Random(55), pool, "greedy")
        fresh = generate_blueprint(55, pool=pool)
        rebuilt = S.replay(fresh, st.action_log, st.run_id, pool=pool)
        assert _volatile(rebuilt) == _volatile(st)

    def test_a_partial_log_replays_to_the_matching_partial_state(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        S.action_select_system(st, bp, bp.system_offers[0][0])
        S.action_choose_node(st, bp, "a1s1o0")
        S.action_draft_pass(st, bp)
        rebuilt = S.replay(bp, st.action_log, "r", pool=pool)
        assert _volatile(rebuilt) == _volatile(st)

    def test_an_unknown_action_type_cannot_be_replayed(self, pool, blueprints):
        from nba_peak.run_the_table.schemas import RunAction

        bp = blueprints(1)
        with pytest.raises(RunActionError) as exc:
            S.replay(bp, [RunAction(action_type="teleport", act=1, stage=1)], "r", pool=pool)
        assert exc.value.code == "unknown_action"

    def test_clone_is_a_deep_copy(self, blueprints):
        st = S.create_run(blueprints(1), "r")
        copy_ = S.clone(st)
        copy_.starters[0].card_id = "mutated"
        assert st.starters[0].card_id != "mutated"


class TestVersionCompatibility:
    def test_the_current_version_tuple_is_accepted(self):
        S.assert_version_compatible(version_tuple())

    def test_a_changed_ruleset_version_is_rejected(self):
        saved = dict(version_tuple())
        saved["ruleset_version"] = "rtt_ruleset_v0"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        assert exc.value.saved == saved
        assert exc.value.current == version_tuple()

    def test_every_version_field_is_load_bearing(self):
        for key in version_tuple():
            saved = dict(version_tuple())
            saved[key] = "something-else"
            with pytest.raises(VersionMismatch):
                S.assert_version_compatible(saved)

    def test_a_missing_version_field_is_rejected(self):
        with pytest.raises(VersionMismatch):
            S.assert_version_compatible({})

    def test_a_saved_run_stamps_the_versions_it_was_created_under(self, blueprints):
        st = S.create_run(blueprints(1), "r")
        S.assert_version_compatible(st.versions)

    def test_a_v1_run_is_refused_with_a_message_that_names_the_ruleset(self):
        """Plan §2.4: strict rejection stays, but the message must be specific
        and human. v1 said "a different ruleset" for any of four fields."""
        saved = dict(version_tuple())
        saved["ruleset_version"] = "rtt_ruleset_v1"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        message = str(exc.value)
        assert "previous ruleset" in message
        assert "rtt_ruleset_v1" in message
        assert version_tuple()["ruleset_version"] in message
        assert "start a new run" in message.lower()
        assert exc.value.changed_fields == ["ruleset_version"]

    def test_a_non_ruleset_change_names_the_field_that_moved(self, pool):
        """A card-pool rebuild and a rules change are different events and a
        player deserves to be told which one cost them their run."""
        saved = dict(version_tuple())
        saved["card_pool_version"] = "v2"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        message = str(exc.value)
        assert "card pool v2" in message
        assert version_tuple()["card_pool_version"] in message
        assert exc.value.changed_fields == ["card_pool_version"]

    def test_several_changed_fields_are_all_named(self, pool):
        saved = dict(version_tuple())
        saved["card_pool_version"] = "v2"
        saved["engine_version"] = "run_the_table_v0"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        assert set(exc.value.changed_fields) == {"card_pool_version", "engine_version"}
        assert "card pool" in str(exc.value)
        assert "engine" in str(exc.value)


class TestIdentityIntegrityInPlay:
    """v4 acceptance tests for the three identity defects, at the action layer.

    `test_bosses.py` covers generation; these cover what the state machine will
    actually ACCEPT, which is where two of the three defects lived.
    """

    def test_a_card_cannot_be_traded_for_itself(self, pool, blueprints):
        """THE SELF-TRADE. Under v3 `legal_slots_for` reported a card as legal
        for the slot it already occupied and `action_trade` had no
        `outgoing != incoming` guard, so a player could pay `cost - refund` --
        7 credits on a 14-cost card -- to swap a player for himself.
        """
        bp = blueprints(SEED_TRADE)
        st = _drive_to_node(bp, pool, "a1s1o1")
        slot = st.starters[0]
        owned = slot.card_id
        before = st.credits
        with pytest.raises(RunActionError) as exc:
            S.action_trade(st, bp, slot.slot_id, owned, pool)
        assert exc.value.code in {"card_not_offered", "same_player_trade"}
        assert st.credits == before
        assert S._slot(st, slot.slot_id).card_id == owned

    def test_the_outgoing_player_is_never_on_the_incoming_board(
        self, pool, blueprints
    ):
        for seed in range(30):
            bp = blueprints(seed)
            st = S.create_run(bp, f"r{seed}", pool=pool)
            owned = {pool.get(c).player_slug for c in st.all_card_ids()}
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type != "trade_desk":
                        continue
                    board = S.node_offers(st, bp, opt.node_id, pool)
                    assert not (
                        {pool.get(c).player_slug for c in board} & owned
                    ), f"seed {seed} {opt.node_id} offers a card the roster holds"

    def test_a_boss_identity_cannot_be_acquired_while_that_boss_is_unbeaten(
        self, pool, blueprints
    ):
        """A card on a LOCKED, still-unbeaten boss must be unbuyable.

        The boss for an act is fixed when it is scouted or reached, and the
        player then keeps playing decision nodes. Without this, a card bought at
        one of them could walk onto the board opposite its own twin.
        """
        bp = blueprints(SEED_FILM_EARLY)
        st = open_first_of_type(bp, pool, "film_room")
        boss = S.boss_for_act(st, bp, st.act, pool)
        assert boss is not None, "opening Scout & Prepare must lock the opponent"
        for cid in list(boss.starter_ids) + list(boss.bench_ids):
            assert S.legal_slots_for(st, pool, cid) == [], (
                f"{cid} is on the unbeaten act-{st.act} boss and must not be "
                f"acquirable"
            )
        # And no board offers one either.
        for plan in bp.stages:
            for opt in plan.options:
                if opt.node_type not in ("draft_room", "trade_desk"):
                    continue
                board = S.node_offers(st, bp, opt.node_id, pool)
                assert not (
                    {pool.get(c).player_slug for c in board}
                    & {pool.get(c).player_slug
                       for c in list(boss.starter_ids) + list(boss.bench_ids)}
                )

    def test_the_roster_assertion_refuses_a_duplicate_written_around_the_action_api(
        self, pool, blueprints
    ):
        """The server-side guard, not the legality check.

        `assert_roster_identities_unique` runs on the WRITE path so a duplicate
        cannot be persisted even if a future caller bypasses `legal_slots_for`.
        """
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r", pool=pool)
        st.bench[0].card_id = st.starters[0].card_id
        with pytest.raises(RunActionError) as exc:
            S.assert_roster_identities_unique(st, pool)
        assert exc.value.code == "duplicate_identity"


class TestBossPersistence:
    """The generated slate is state, not a cache: it must survive a re-read."""

    def test_a_refresh_serves_the_lineup_that_was_locked(self, pool, blueprints):
        """Re-reading a run must not re-derive a different opponent.

        This is the whole reason `boss_lineups` is persisted. A boss is a
        function of the roster it was locked against, and that roster moves as
        the run goes on -- so re-deriving on load would hand the player a
        different opponent than the one they scouted and prepared for.
        """
        bp = blueprints(SEED_FILM_EARLY)
        st = open_first_of_type(bp, pool, "film_room")
        locked = S.boss_for_act(st, bp, st.act, pool)
        assert locked is not None

        # Upgrade the roster hard, then re-read. The opponent must not move.
        strongest = max(
            (c for c in pool.cards if S.legal_slots_for(st, pool, c.peak_window_id)),
            key=lambda c: c.prime_score,
        )
        slot = S.legal_slots_for(st, pool, strongest.peak_window_id)[0]
        S._slot(st, slot).card_id = strongest.peak_window_id

        assert S.boss_for_act(st, bp, st.act, pool) == locked
        assert S.ensure_boss_for_act(st, bp, st.act, pool) == locked

    def test_a_replay_reproduces_the_same_locked_slate(self, pool, play_policy):
        import random as _random

        for seed in (3, 11, 44):
            bp, st = play_policy(seed, _random.Random(seed), pool, "greedy")
            rebuilt = S.replay(bp, st.action_log, st.run_id, pool=pool)
            assert rebuilt.boss_lineups == st.boss_lineups, (
                f"seed {seed}: replay produced a different boss slate"
            )
            assert [b.boss_id for b in rebuilt.battles] == [
                b.boss_id for b in st.battles
            ]

    # NOTE: the snapshot round-trip of `boss_lineups` is asserted in
    # `apps/api/tests/test_run_the_table.py` -- serialisation lives in the API
    # layer, which is not on this suite's import path.


class TestModelIsUntouched:
    """This pass changed game balance. It must not have changed the model."""

    def test_no_canonical_component_value_or_prime_score_changed(self, pool):
        """The card pool is read straight from the committed artifacts. If a
        balance change had reached into the data, it would show up here."""
        import json
        from pathlib import Path

        root = Path(__file__).resolve().parent.parent.parent
        windows = {
            w["id"]: w
            for w in json.loads((root / "data" / "web" / "peak_windows.json").read_text())
        }
        for card in pool.cards:
            w = windows[card.peak_window_id]
            for lane, value in card.lane_values.items():
                assert value == round(float(w["components"][lane]), 4), (
                    f"{card.peak_window_id} lane {lane} drifted from the dataset"
                )

    def test_the_official_peak3_weights_are_unchanged(self):
        from nba_peak.run_the_table.config import LANE_PEAK3_WEIGHTS

        assert LANE_PEAK3_WEIGHTS == {
            "statistical_impact": 0.38,
            "traditional_production": 0.21,
            "individual_recognition": 0.20,
            "postseason_individual_value": 0.18,
            "team_achievement": 0.03,
        }
