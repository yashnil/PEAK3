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
    DECISION_NODES,
    FILM_CREDITS,
    MAX_LIVES,
    MAX_SYSTEMS,
    REST_CREDITS,
    ROLES,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STARTING_LIVES,
    TERMINAL_STATUSES,
    VETERAN_MINIMUM_PERCENTILE_MAX,
    version_tuple,
)
from nba_peak.run_the_table.generation import generate_blueprint, stage_for
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
SEED_VET_MIN = 98
# Offers Trade Machine and opens on a Trade Desk at a1s1o0. Previously borrowed
# SEED_VET_MIN, which coupled two unrelated fixtures to one seed; split out so
# re-picking one of them cannot break the other.
SEED_TRADE_MACHINE = 0
# Under Standard v2 the "pass" policy loses acts 1, 2 and 3 here, which burns
# all three lives before the Final Boss -- the seed the immediate-game-over rule
# is asserted against. Re-picked from 12, which under v2 survives to act 4.
SEED_ALL_LOSSES = 6
SEED_FILM_EARLY = 3      # Film Room at act 1 stage 2, so scouting has something to unlock
# Film Room ONLY at act 4 stage 2, the final stage of the run. Re-picked from 12
# when v2 added a fourth act.
SEED_FILM_LAST = 9


def _volatile(state: S.RunState) -> dict:
    """State as a comparable dict, minus the wall-clock fields."""
    d = dataclasses.asdict(state)
    d.pop("created_at")
    d.pop("last_action_at")
    return d


def _drive_to_node(bp, pool, node_id, system_id=None):
    """Create a run, take the first System, and open ``node_id`` in act 1 stage 1."""
    st = S.create_run(bp, "t")
    S.action_select_system(st, bp, system_id or bp.system_offers[0][0])
    S.action_choose_node(st, bp, node_id)
    return st


class TestStandardV2Shape:
    """The frozen v2 run shape (AUTH_DAILY_BALANCE_PLAN §2.2).

    Written as literals on purpose: these are a cross-track contract, so a
    change to any of them must fail here rather than propagate silently into
    the API payload and the UI.
    """

    def test_the_run_shape_is_four_acts_eight_nodes_four_bosses(self):
        assert ACTS == 4
        assert STAGES_PER_ACT == 2
        assert DECISION_NODES == ACTS * STAGES_PER_ACT == 8
        assert BATTLES == ACTS == 4

    def test_the_starting_resources_are_three_lives_and_fifty_credits(self):
        assert STARTING_LIVES == 3
        assert MAX_LIVES == 3
        assert STARTING_CREDITS == 50

    def test_the_ruleset_is_versioned_v2(self):
        from nba_peak.run_the_table.config import RULESET_VERSION

        assert RULESET_VERSION == "rtt_ruleset_v2"
        assert version_tuple()["ruleset_version"] == "rtt_ruleset_v2"

    def test_every_generated_run_has_a_boss_for_every_act(self, blueprints):
        bp = blueprints(1)
        assert len(bp.bosses) == ACTS
        assert [b.act for b in bp.bosses] == list(range(1, ACTS + 1))
        assert len(bp.stages) == DECISION_NODES


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
            S.action_film_room(st, bp, "scout_offers")
        assert exc.value.code == "wrong_node_type"

    def test_an_action_with_no_open_node_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
        S.action_select_system(st, bp, bp.system_offers[0][0])
        st.status = "node_active"
        with pytest.raises(RunActionError) as exc:
            S.action_draft_pass(st, bp)
        assert exc.value.code == "no_active_node"

    def test_a_finished_run_refuses_further_actions(self, pool, play_policy):
        bp, st = play_policy(SEED_ALL_LOSSES, random.Random(1), pool, "pass")
        assert st.status in TERMINAL_STATUSES
        with pytest.raises(RunActionError) as exc:
            S.action_advance(st, bp)
        assert exc.value.code == "run_finished"

    def test_unknown_slot_lookup_raises(self, blueprints):
        st = S.create_run(blueprints(1), "r1")
        with pytest.raises(RunActionError) as exc:
            S._slot(st, "bench_9")
        assert exc.value.code == "unknown_slot"


class TestSystemSelection:
    def test_selecting_a_system_advances_to_node_select(self, blueprints):
        bp = blueprints(2)
        st = S.create_run(bp, "r")
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
            st = S.create_run(bp, "r")
            S.action_select_system(st, bp, held)
            st.pending_system_offer = bp.system_offers[1]
            available = S.available_system_offer(st)
            assert held not in available
            assert len(available) >= 2
            return
        pytest.skip("no seed in range produced overlapping System offers")

    def test_at_most_two_systems_can_be_held(self, blueprints):
        bp = blueprints(2)
        st = S.create_run(bp, "r")
        st.systems = list(bp.system_offers[0][:MAX_SYSTEMS])
        st.pending_system_offer = bp.system_offers[0]
        st.status = "system_select"
        spare = next(s for s in bp.system_offers[0] if s not in st.systems)
        with pytest.raises(RunActionError) as exc:
            S.action_select_system(st, bp, spare)
        assert exc.value.code == "system_limit"

    def test_holding_a_system_twice_is_rejected(self, blueprints):
        bp = blueprints(2)
        st = S.create_run(bp, "r")
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
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
        owned = bp.starting_starters[0]
        assert S.legal_slots_for(st, pool, owned) == [ROLES[0]], (
            "the only legal home for an owned card is the slot it already occupies"
        )

    def test_legal_slots_respect_role_eligibility_and_allow_any_bench_slot(
        self, pool, blueprints
    ):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
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
        S.action_advance(st, bp)
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
            S.action_film_room(st, bp, "take_credits")
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
        assert expected["outgoing_refund"] == int(outgoing.base_cost * 0.50)
        assert expected["net_cost"] == expected["incoming_cost"] - expected["outgoing_refund"]

        before = st.credits
        S.action_trade(st, bp, slot_id, cid, pool)

        assert st.credits == before - expected["net_cost"]
        assert S._slot(st, slot_id).card_id == cid
        assert st.trades[-1]["outgoing_card_id"] == outgoing.peak_window_id
        assert st.trades[-1]["incoming_card_id"] == cid
        assert st.trades[-1]["net_cost"] == expected["net_cost"]
        assert st.trades[-1]["outgoing_refund"] == expected["outgoing_refund"]

    def test_trade_machine_lifts_the_refund_to_seventy_percent(self, pool, blueprints):
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

        assert plain_row["outgoing_refund"] == int(outgoing.base_cost * 0.50)
        assert machine_row["outgoing_refund"] == int(outgoing.base_cost * 0.70)
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


class TestFilmAndRest:
    def test_taking_credits_at_the_film_room_pays_the_published_amount(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = self._open_first_of_type(bp, pool, "film_room")
        before = st.credits
        S.action_film_room(st, bp, "take_credits")
        assert st.credits == before + FILM_CREDITS
        assert st.scouted_stage_keys == []

    def test_scouting_unlocks_the_rest_of_the_act_plus_the_next_stage(self, pool):
        bp = generate_blueprint(SEED_FILM_EARLY, pool=pool)
        st = self._open_first_of_type(bp, pool, "film_room")
        assert (st.act, st.stage) == (1, 2)
        before = st.credits
        S.action_film_room(st, bp, "scout_offers")
        assert st.credits == before
        # Act 1 has no stage after 2, so the unlock is exactly the next act's opener.
        assert st.scouted_stage_keys == ["a2s1"]

    def test_scouting_at_the_final_stage_unlocks_nothing(self, pool):
        """Documented no-op: the Film Room's scout option has no future to reveal
        at the last stage of the last act. The audit counts these as no-op nodes."""
        bp = generate_blueprint(SEED_FILM_LAST, pool=pool)
        st = self._open_first_of_type(bp, pool, "film_room")
        assert (st.act, st.stage) == (ACTS, STAGES_PER_ACT)
        before = st.credits
        S.action_film_room(st, bp, "scout_offers")
        assert st.scouted_stage_keys == []
        assert st.credits == before

    def test_rest_bank_credits_and_life_recovery_are_exclusive(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = self._open_first_of_type(bp, pool, "rest_bank")
        before_credits, before_lives = st.credits, st.lives
        S.action_rest_bank(st, bp, "take_credits")
        assert st.credits == before_credits + REST_CREDITS
        assert st.lives == before_lives

    def test_life_recovery_is_capped_at_max_lives(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = self._open_first_of_type(bp, pool, "rest_bank")
        st.lives = MAX_LIVES
        before_credits = st.credits
        S.action_rest_bank(st, bp, "recover_life")
        assert st.lives == MAX_LIVES
        assert st.credits == before_credits

    def test_unknown_choices_are_rejected(self, pool):
        bp = generate_blueprint(SEED_TRADE, pool=pool)
        st = self._open_first_of_type(bp, pool, "rest_bank")
        with pytest.raises(RunActionError) as exc:
            S.action_rest_bank(st, bp, "nap")
        assert exc.value.code == "unknown_choice"

    @staticmethod
    def _open_first_of_type(bp, pool, node_type):
        """Walk the run with pass-only actions until a node of this type opens."""
        st = S.create_run(bp, "r")
        guard = 0
        while guard < 60:
            guard += 1
            if st.status == "system_select":
                S.action_select_system(st, bp, S.available_system_offer(st)[0])
            elif st.status == "node_select":
                plan = stage_for(bp, st.act, st.stage)
                match = [o for o in plan.options if o.node_type == node_type]
                S.action_choose_node(st, bp, (match or list(plan.options))[0].node_id)
            elif st.status == "node_active":
                _, opt = S.node_option(bp, st.active_node_id)
                if opt.node_type == node_type:
                    return st
                if opt.node_type == "draft_room":
                    S.action_draft_pass(st, bp)
                elif opt.node_type == "trade_desk":
                    S.action_decline_trade(st, bp)
                elif opt.node_type == "film_room":
                    S.action_film_room(st, bp, "take_credits")
                else:
                    S.action_rest_bank(st, bp, "take_credits")
            elif st.status == "boss_ready":
                S.action_resolve_boss(st, bp, pool)
            elif st.status == "boss_resolved":
                S.action_advance(st, bp)
            else:
                break
        raise AssertionError(f"seed {bp.seed} never opened a {node_type}")


class TestBossProgression:
    def test_a_boss_battle_moves_the_run_forward_one_act(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
        S.action_select_system(st, bp, bp.system_offers[0][0])
        for stage in range(1, STAGES_PER_ACT + 1):
            S.action_choose_node(st, bp, stage_for(bp, 1, stage).options[0].node_id)
            TestVeteranMinimumInPlay._resolve_open_node(st, bp, pool)
        assert st.status == "boss_ready"
        assert st.stage == STAGES_PER_ACT + 1

        S.action_resolve_boss(st, bp, pool)
        assert st.status == "boss_resolved"
        assert len(st.battles) == 1
        assert st.battles[0].boss_id == bp.bosses[0].boss_id

        S.action_advance(st, bp)
        assert st.act == 2
        assert st.stage == 1
        assert st.status in {"system_select", "node_select"}

    def test_a_battle_with_an_incomplete_roster_is_rejected(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
        st.status = "boss_ready"
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
        # THE RUN ENDS AT THE THIRD LOSS, in act 3, with the act-4 Final Boss
        # never fought. Three lives against four bosses is what makes running out
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
        st = S.create_run(bp, "r")
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
            S.action_advance(st, bp)
        assert exc.value.code == "run_finished"

    def test_winning_a_boss_pays_the_published_win_reward(self, pool, blueprints):
        """v1 paid a winner NOTHING and a loser 8 credits, so the only battle
        income in the game went to the player who was losing."""
        bp = blueprints(8)
        st = S.create_run(bp, "r")
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
        between a stored act and the generated boss list was a 500."""
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")
        st.status = "boss_ready"
        st.act = len(bp.bosses) + 1
        with pytest.raises(RunActionError) as exc:
            S.action_resolve_boss(st, bp, pool)
        assert exc.value.code == "no_boss_for_act"

    def test_comeback_credits_actually_land_in_the_players_balance(self, pool, blueprints):
        bp = blueprints(SEED_ALL_LOSSES)
        st = S.create_run(bp, "r")
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

    def test_a_run_that_survives_all_four_acts_completes(self, pool, play_policy):
        bp, st = play_policy(8, random.Random(5), pool, "greedy")
        assert st.status == "complete"
        assert len(st.battles) == ACTS == 4
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
                for cid in plan.payloads[opt.node_id]["offer_ids"]:
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
                for cid in plan.payloads[opt.node_id]["incoming_ids"]:
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
                S.action_film_room(st, bp, rng.choice(list(S.FILM_CHOICES)))
            else:
                S.action_rest_bank(st, bp, rng.choice(list(S.REST_CHOICES)))
        elif st.status == "boss_ready":
            S.action_resolve_boss(st, bp, pool)
        else:
            S.action_advance(st, bp)

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
        for seed in range(40):
            _, st = play_policy(seed, random.Random(seed), pool, "greedy")
            spent = sum(a["cost"] for a in st.acquisitions) + sum(
                t["net_cost"] for t in st.trades
            )
            earned = sum(b.credits_awarded for b in st.battles)
            earned += sum(
                REST_CREDITS for a in st.action_log
                if a.action_type == "rest_bank" and a.payload["choice"] == "take_credits"
            )
            earned += sum(
                FILM_CREDITS for a in st.action_log
                if a.action_type == "film_room" and a.payload["choice"] == "take_credits"
            )
            assert st.credits == STARTING_CREDITS + earned - spent


class TestIdempotency:
    def test_a_repeated_key_is_a_no_op_on_every_action_type(self, pool, blueprints):
        bp = blueprints(SEED_TRADE)
        st = S.create_run(bp, "r")

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
        st = S.create_run(bp, "r")
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
        st = S.create_run(bp, "r")
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
        st = S.create_run(bp, "r")
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

    def test_a_non_ruleset_change_names_the_field_that_moved(self):
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

    def test_several_changed_fields_are_all_named(self):
        saved = dict(version_tuple())
        saved["card_pool_version"] = "v2"
        saved["engine_version"] = "run_the_table_v0"
        with pytest.raises(VersionMismatch) as exc:
            S.assert_version_compatible(saved)
        assert set(exc.value.changed_fields) == {"card_pool_version", "engine_version"}
        assert "card pool" in str(exc.value)
        assert "engine" in str(exc.value)
