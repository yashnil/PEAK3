"""Final receipt determinism and daily-seed stability."""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from nba_peak.run_the_table import state as S
from nba_peak.run_the_table.battle import (
    player_lane_profile,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.config import (
    ACTS,
    LANE_FIELDS,
    LANE_LABELS,
    RULESET_VERSION,
    STARTING_CREDITS,
    STARTING_LIVES,
    version_tuple,
)
from nba_peak.run_the_table.daily import (
    DATE_FORMAT,
    InvalidRunDate,
    daily_descriptor,
    daily_run_id,
    daily_seed,
    today_utc_date,
    validate_run_date,
)
from nba_peak.run_the_table.generation import generate_blueprint
from nba_peak.run_the_table.receipt import (
    ITEM_KINDS,
    ITEM_UNITS,
    OUTCOMES,
    build_receipt,
)

from .conftest import slate_for_seed

RECEIPT_SEEDS = (0, 8, 12, 44, 101, 777)
# A greedy run that sweeps all five bosses WITHOUT LOSING ONE -- the receipt
# under test asserts a 5-0 record, not merely a clear. v4 re-pick from 27: the
# boss slate is generated per run now, so which seeds a policy sweeps changed
# wholesale, and a flawless sweep is genuinely rarer than it was because each
# fight is calibrated to the roster instead of to a fixed band.
SEED_GREEDY_SWEEP = 31


def _canonical(receipt: dict) -> str:
    """A byte-comparable rendering of a receipt."""
    return json.dumps(receipt, sort_keys=True, separators=(",", ":"), default=str)


class TestReceiptDeterminism:
    def test_the_same_seed_and_action_log_produce_an_identical_receipt(
        self, pool, play_policy
    ):
        for policy in ("greedy", "random", "first", "pass"):
            for seed in RECEIPT_SEEDS:
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                first = build_receipt(st, bp, pool)

                rebuilt_bp = generate_blueprint(seed, pool=pool)
                rebuilt = S.replay(bp, st.action_log, st.run_id, pool=pool)
                second = build_receipt(rebuilt, rebuilt_bp, pool)

                assert _canonical(first) == _canonical(second), (
                    f"receipt drifted for seed {seed} under policy {policy}"
                )

    def test_building_the_same_receipt_twice_is_stable(self, pool, play_policy):
        bp, st = play_policy(8, random.Random(8), pool, "greedy")
        assert _canonical(build_receipt(st, bp, pool)) == _canonical(
            build_receipt(st, bp, pool)
        )

    def test_receipt_carries_the_versions_the_run_was_played_under(self, pool, play_policy):
        bp, st = play_policy(8, random.Random(8), pool, "greedy")
        receipt = build_receipt(st, bp, pool)
        assert receipt["versions"] == version_tuple()
        assert receipt["seed"] == 8
        assert receipt["run_type"] == "standard"


class TestReceiptBreakdownFixtures:
    """SYNTHESIS_CONTRACT.md §2.3: "deterministic fixtures pin the three
    audited seeds." These are the exact seeds `scripts/audit_rtt_score_semantics.py`
    (P1-A) reconciled against the canonical 3Y leaderboard CSV -- 75
    lane-battles, engine math verified bit-identical in all 75. This class
    pins the SAME three seeds against the receipt-breakdown fields the P1-A
    audit did not yet have (`pre_perk_rating`/`bench_adjustment`), so a
    regression in either the battle math or the breakdown decomposition is
    caught here rather than only by re-running the audit script by hand.

    The starting five-plus-two roster is unmodified (no draft/trade) for every
    seed, matching the audit's own methodology exactly, so these numbers are
    directly comparable to `docs/implementation/rtt-overhaul/
    rtt_score_semantics_audit.json`.
    """

    AUDIT_SEEDS = (11, 42, 2026)

    def _battles(self, seed, pool, blueprints):
        bp = blueprints(seed)
        from nba_peak.run_the_table.battle import resolve_battle
        from nba_peak.run_the_table.config import BOSS_WIN_CREDITS, COMEBACK_CREDITS

        return bp, [
            resolve_battle(
                pool, list(bp.starting_starters), list(bp.starting_bench), boss,
                systems=(), lives_before=3, comeback_credits=COMEBACK_CREDITS,
                win_credits=BOSS_WIN_CREDITS,
            )
            for boss in slate_for_seed(pool, seed)
        ]

    def test_every_lane_of_every_battle_reconciles_for_all_three_seeds(
        self, pool, blueprints
    ):
        """The broad invariant, across all 5 acts x 3 seeds x 5 lanes = 75
        lane-battles -- the same count P1-A audited. `bench_adjustment` is a
        residual by construction (`battle.resolve_battle`), so this must hold
        exactly, not approximately."""
        checked = 0
        for seed in self.AUDIT_SEEDS:
            _, battles = self._battles(seed, pool, blueprints)
            for battle in battles:
                for lane in battle.lanes:
                    total = round(
                        lane.pre_perk_rating + lane.bench_adjustment
                        + lane.player_prep_bonus,
                        4,
                    )
                    assert total == lane.player_score, (
                        seed, battle.boss_id, lane.lane, total, lane.player_score,
                    )
                    checked += 1
        assert checked == 75

    # Act 1 ("the_wall") pinned exactly, per seed -- real engine output,
    # captured once and checked in as a regression anchor. A change to either
    # the lane math or the pool/leaderboard data that moves any of these
    # numbers must be a deliberate, reviewed change, not a silent drift.
    #
    # v4 UPDATE, AND EXACTLY HOW MUCH OF IT CHANGED. Every PLAYER-side value
    # below is BYTE-IDENTICAL to the v3 fixture and to
    # docs/implementation/rtt-overhaul/rtt_score_semantics_audit.json: the
    # player's lane ratings depend only on the starting roster and the lane
    # math, and this pass changed neither. That was verified across all 15
    # lanes before this fixture was touched, and it is the check that proves
    # the published score semantics are intact.
    #
    # The OPPONENT column moved, and had to: the act-1 boss is no longer five
    # constants shared by every seed (which is why the opponent numbers used to
    # be identical for all three seeds -- 25.007, 34.0851, ... repeated down the
    # table), it is generated against each seed's own roster. Three distinct
    # opponent columns where there used to be one is the change working.
    ACT1_PINNED = {
        11: {
            #                          player     opponent
            "statistical_impact": (23.7783, 25.8097),
            "traditional_production": (39.4687, 29.9347),
            "individual_recognition": (13.7469, 24.5927),
            "postseason_individual_value": (15.1098, 11.8485),
            "team_achievement": (26.6511, 10.6629),
        },
        42: {
            "statistical_impact": (20.8393, 26.0559),
            "traditional_production": (30.4607, 26.8598),
            "individual_recognition": (16.7235, 16.0235),
            "postseason_individual_value": (17.1358, 19.1633),
            "team_achievement": (19.3007, 17.5398),
        },
        2026: {
            "statistical_impact": (23.2867, 23.5357),
            "traditional_production": (25.2047, 35.7748),
            "individual_recognition": (20.794, 13.4171),
            "postseason_individual_value": (21.3054, 19.0896),
            "team_achievement": (20.9487, 18.0086),
        },
    }

    # The player-side halves, kept separately and asserted separately, so a
    # future boss-generation change can never quietly take the player's
    # published lane ratings with it.
    PLAYER_PINNED_UNCHANGED_SINCE_V3 = {
        11: (23.7783, 39.4687, 13.7469, 15.1098, 26.6511),
        42: (20.8393, 30.4607, 16.7235, 17.1358, 19.3007),
        2026: (23.2867, 25.2047, 20.794, 21.3054, 20.9487),
    }

    def test_the_player_side_lane_ratings_are_unchanged_from_v3(
        self, pool, blueprints
    ):
        """The score-semantics anchor. These fifteen numbers are the ones
        `scripts/audit_rtt_score_semantics.py` reconciled against the canonical
        3Y leaderboard CSV, and no balance or boss change may move them."""
        for seed in self.AUDIT_SEEDS:
            _, battles = self._battles(seed, pool, blueprints)
            actual = tuple(l.player_score for l in battles[0].lanes)
            assert actual == self.PLAYER_PINNED_UNCHANGED_SINCE_V3[seed], seed

    def test_act_one_lane_ratings_match_the_pinned_fixture(self, pool, blueprints):
        for seed in self.AUDIT_SEEDS:
            _, battles = self._battles(seed, pool, blueprints)
            act1 = battles[0]
            assert act1.boss_id == "the_wall"
            for lane in act1.lanes:
                expected_player, expected_opponent = self.ACT1_PINNED[seed][lane.lane]
                assert lane.player_score == expected_player, (seed, lane.lane)
                assert lane.opponent_score == expected_opponent, (seed, lane.lane)
                # Zero perk, zero rule, zero bonus for act 1 under the
                # unmodified starting roster: the vanilla baseline equals the
                # final rating exactly.
                assert lane.pre_perk_rating == expected_player
                assert lane.bench_adjustment == 0.0
                assert lane.player_prep_bonus == 0.0


class TestReceiptContent:
    @pytest.fixture(scope="class")
    def finished(self, pool, play_policy):
        bp, st = play_policy(
            SEED_GREEDY_SWEEP, random.Random(SEED_GREEDY_SWEEP), pool, "greedy"
        )
        return bp, st, build_receipt(st, bp, pool)

    def test_the_record_matches_the_battles_that_were_played(self, finished):
        _, st, receipt = finished
        wins = sum(1 for b in st.battles if b.outcome == "win")
        losses = sum(1 for b in st.battles if b.outcome == "loss")
        assert receipt["bosses_defeated"] == wins
        assert receipt["battles_lost"] == losses
        assert receipt["record"] == f"{wins}-{losses}"
        # v2: the record is a record, and clearing the table is decided by the
        # FINAL boss alone — not by a count of wins.
        final = next((b for b in st.battles if b.act == ACTS), None)
        expected = st.status == "complete" and final is not None and final.outcome == "win"
        assert receipt["table_cleared"] is expected
        assert receipt["ran_the_table"] is expected  # deprecated alias
        assert len(receipt["battles"]) == len(st.battles)

    def test_the_roster_on_the_receipt_is_the_roster_in_the_state(self, pool, finished):
        _, st, receipt = finished
        assert [row["card_id"] for row in receipt["starters"]] == [
            s.card_id for s in st.starters
        ]
        assert [row["card_id"] for row in receipt["bench"]] == [s.card_id for s in st.bench]
        for row in receipt["starters"] + receipt["bench"]:
            card = pool.get(row["card_id"])
            assert row["player_name"] == card.player_name
            assert row["prime_score"] == card.prime_score
            assert row["base_cost"] == card.base_cost

    def test_the_lane_profile_matches_a_direct_recomputation(self, pool, finished):
        """Recomputed THE WAY THE PLAYER WAS SCORED, Systems included.

        This previously recomputed with a flat 0.35 bench weight, which is only
        correct for a run holding no battle System. `build_receipt` uses
        `player_lane_profile(..., state.systems, None)` -- under Deep Rotation
        that is the better of two bench weights per lane -- so the flat version
        was a second, WRONG model of the same quantity that happened to agree
        for as long as the fixture seed never picked that perk. The v4 re-pick
        of SEED_GREEDY_SWEEP holds it, which is what surfaced the latent bug.
        """
        _, st, receipt = finished
        starters = [s.card_id for s in st.starters if s.card_id]
        bench = [s.card_id for s in st.bench if s.card_id]
        expected = player_lane_profile(pool, starters, bench, st.systems, None)
        assert [row["lane"] for row in receipt["lane_profile"]] == list(LANE_FIELDS)
        for row in receipt["lane_profile"]:
            assert row["value"] == expected[row["lane"]]
            assert row["label"] == LANE_LABELS[row["lane"]]
        assert receipt["roster_total"] == roster_total(expected)

    def test_strongest_and_weakest_lanes_bracket_the_profile(self, finished):
        _, _, receipt = finished
        values = [row["value"] for row in receipt["lane_profile"]]
        assert receipt["strongest_lane"]["value"] == max(values)
        assert receipt["weakest_lane"]["value"] == min(values)

    def test_the_run_mvp_is_the_largest_marginal_contribution(self, finished):
        _, _, receipt = finished
        contributions = receipt["marginal_contributions"]
        assert len(contributions) == len(receipt["starters"]) + len(receipt["bench"])
        assert receipt["run_mvp"]["card_id"] == contributions[0]["card_id"]
        assert contributions[0]["marginal_contribution"] == max(
            row["marginal_contribution"] for row in contributions
        )

    def test_the_credit_ledger_balances(self, finished):
        """v3 counts the four published credit sinks. Leaving them out would
        print a ledger that stops balancing the moment a player refreshes a
        market."""
        _, st, receipt = finished
        cards = sum(a["cost"] for a in st.acquisitions) + sum(
            max(0, t["net_cost"]) for t in st.trades
        )
        sinks = sum(row["cost"] for row in st.sink_spend)
        assert receipt["credits_spent_on_cards"] == cards
        assert receipt["credits_spent_on_sinks"] == sinks
        assert receipt["credits_spent"] == cards + sinks
        assert sum(receipt["credits_spent_by_sink"].values()) == sinks
        assert receipt["credits_remaining"] == st.credits
        assert receipt["starting_credits"] == STARTING_CREDITS

    def test_every_reason_is_backed_by_a_number(self, finished):
        _, _, receipt = finished
        assert receipt["reasons"]
        for reason in receipt["reasons"]:
            assert reason["kind"] in {
                "lane_strength", "lane_weakness", "acquisition", "economy"
            }
            assert reason["text"]
            assert isinstance(reason["signed_value"], (int, float))

    def test_a_failed_run_reports_the_act_it_ended_in(self, pool, play_policy):
        """Seed 12 under the do-nothing policy loses acts 1-3, which is all
        three lives before the Final Boss is ever fought. Re-picked from 6 for
        v4: bosses are built to the roster they face, so a do-nothing run no
        longer loses every fight on an arbitrary seed."""
        bp, st = play_policy(12, random.Random(3), pool, "pass")
        assert st.status == "failed"
        assert st.battles[-1].act < ACTS
        receipt = build_receipt(st, bp, pool)
        assert receipt["outcome"] == "ended_in_act"
        assert receipt["verdict"] == f"RUN ENDED IN ACT {st.battles[-1].act}"
        assert receipt["headline"] == f"Out of lives in Act {st.battles[-1].act}."
        assert receipt["table_cleared"] is False
        assert receipt["reached_final_boss"] is False
        assert receipt["final_boss"] is None
        assert receipt["ended_in_act"] == st.battles[-1].act
        assert receipt["lives_remaining"] == 0

    def test_a_cleared_table_receipt_says_so(self, pool, play_policy):
        bp, st = play_policy(
            SEED_GREEDY_SWEEP, random.Random(SEED_GREEDY_SWEEP), pool, "greedy"
        )
        receipt = build_receipt(st, bp, pool)
        assert receipt["table_cleared"] is True, (
            f"seed {SEED_GREEDY_SWEEP} no longer sweeps under the greedy policy"
        )
        assert receipt["outcome"] == "table_cleared"
        assert receipt["verdict"] == "TABLE CLEARED"
        assert receipt["headline"] == "Cleared the table."
        assert receipt["record"] == f"{ACTS}-0"
        assert receipt["final_boss"]["act"] == ACTS
        assert receipt["final_boss"]["outcome"] == "win"

    def test_the_share_story_names_the_systems_and_the_mvp(self, finished):
        _, st, receipt = finished
        assert receipt["story"]
        assert receipt["run_mvp"]["player_name"] in receipt["story"]
        assert len(receipt["systems"]) == len(st.systems)
        for row in receipt["systems"]:
            assert row["id"] in st.systems
            assert row["name"] and row["summary"]

    def test_the_closest_battle_is_the_tightest_lane_across_the_run(self, finished):
        _, st, receipt = finished
        tightest = min(
            min(abs(l.margin) for l in b.lanes) for b in st.battles
        )
        assert receipt["closest_battle"]["tightest_lane_margin"] == round(tightest, 4)


class TestReceiptV3Fields:
    """Scout & Prepare and the credit sinks have to reach the result screen, or
    the player cannot tell what the node bought them."""

    def test_a_receipt_reports_every_lane_preparation_that_was_spent(
        self, pool, play_policy
    ):
        from nba_peak.run_the_table.config import LANE_LABELS, SCOUT_PREP_LANE_BONUS

        found = False
        for seed in range(30):
            bp, st = play_policy(seed, random.Random(seed), pool, "first")
            receipt = build_receipt(st, bp, pool)
            expected = [
                {
                    "act": b.act,
                    "boss_id": b.boss_id,
                    "lane": lane,
                    "label": LANE_LABELS[lane],
                    "bonus": bonus,
                }
                for b in st.battles
                for lane, bonus in sorted(b.lane_bonuses.items())
            ]
            assert receipt["lane_preparations"] == expected
            if expected:
                found = True
                assert all(row["bonus"] == SCOUT_PREP_LANE_BONUS for row in expected)
        assert found, "no seed under the `first` policy ever armed a preparation"

    def test_a_receipt_reports_which_acts_were_scouted(self, pool, play_policy):
        for seed in range(10):
            bp, st = play_policy(seed, random.Random(seed), pool, "first")
            receipt = build_receipt(st, bp, pool)
            assert receipt["scouted_boss_acts"] == st.scouted_boss_acts

    def test_the_receipt_counts_five_acts(self, pool, play_policy):
        bp, st = play_policy(0, random.Random(0), pool, "greedy")
        receipt = build_receipt(st, bp, pool)
        assert receipt["acts_total"] == ACTS == 5


class TestOutcomeTaxonomy:
    """Exactly three outcomes (plan §2.2). "RUN COMPLETE" is retired: v1 printed
    it both for a clean sweep and for a run that beat nobody."""

    def _receipts(self, pool, play_policy):
        out = []
        for policy in ("greedy", "random", "first", "pass"):
            for seed in range(40):
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                out.append((st, build_receipt(st, bp, pool)))
        return out

    def test_every_receipt_carries_one_of_exactly_three_outcomes(self, pool, play_policy):
        seen = set()
        for _, receipt in self._receipts(pool, play_policy):
            assert receipt["outcome"] in OUTCOMES
            seen.add(receipt["outcome"])
        assert seen == set(OUTCOMES), f"unreached outcomes: {set(OUTCOMES) - seen}"

    def test_run_complete_is_never_printed_again(self, pool, play_policy):
        for _, receipt in self._receipts(pool, play_policy):
            assert receipt["verdict"] != "RUN COMPLETE"
            assert receipt["verdict"] != "RUN ENDED"

    def test_the_verdict_always_matches_the_outcome(self, pool, play_policy):
        for _, receipt in self._receipts(pool, play_policy):
            if receipt["outcome"] == "table_cleared":
                assert receipt["verdict"] == "TABLE CLEARED"
            elif receipt["outcome"] == "ended_at_final_boss":
                assert receipt["verdict"] == "RUN ENDED AT THE FINAL BOSS"
            else:
                assert receipt["verdict"] == f"RUN ENDED IN ACT {receipt['ended_in_act']}"

    def test_clearing_requires_winning_the_final_boss_not_counting_wins(
        self, pool, play_policy
    ):
        for st, receipt in self._receipts(pool, play_policy):
            final = next((b for b in st.battles if b.act == ACTS), None)
            won_final = final is not None and final.outcome == "win"
            assert receipt["table_cleared"] is (st.status == "complete" and won_final)
            if receipt["table_cleared"]:
                assert receipt["bosses_defeated"] >= 1

    def test_surviving_every_act_without_beating_the_final_boss_is_not_a_clear(
        self, pool, play_policy
    ):
        found = False
        for st, receipt in self._receipts(pool, play_policy):
            if st.status == "complete" and not receipt["table_cleared"]:
                found = True
                assert receipt["outcome"] == "ended_at_final_boss"
                assert receipt["verdict"] == "RUN ENDED AT THE FINAL BOSS"
                assert "could not close it out" in receipt["headline"] or (
                    "Drew the Final Boss" in receipt["headline"]
                )
        assert found, "no policy/seed survived four acts without clearing"

    def test_a_drawn_final_boss_is_neither_a_win_nor_a_clear(self, pool, blueprints):
        """A draw costs no life and pays nothing, and it does not clear."""
        import dataclasses

        from nba_peak.run_the_table import state as S
        from nba_peak.run_the_table.battle import resolve_battle
        from nba_peak.run_the_table.config import (
            BOSS_WIN_CREDITS,
            COMEBACK_CREDITS,
            STATUS_COMPLETE,
        )

        bp = blueprints(4)
        st = S.create_run(bp, "draw")
        # A roster mirroring the boss draws exactly; injected directly because
        # no seed is guaranteed to produce a mirror at act 4.
        boss = slate_for_seed(pool, 4)[-1]
        mirror = dataclasses.replace(boss)
        result = resolve_battle(
            pool_or_none := __import__(
                "nba_peak.run_the_table.cards", fromlist=["get_pool"]
            ).get_pool(),
            list(boss.starter_ids), list(boss.bench_ids), mirror, (),
            lives_before=3, comeback_credits=COMEBACK_CREDITS,
            win_credits=BOSS_WIN_CREDITS,
        )
        assert result.outcome == "draw"
        assert result.credits_awarded == 0
        assert result.lives_after == 3

        st.battles = [dataclasses.replace(result, act=ACTS)]
        st.status = STATUS_COMPLETE
        st.act = ACTS
        receipt = build_receipt(st, bp, pool_or_none)
        assert receipt["table_cleared"] is False
        assert receipt["outcome"] == "ended_at_final_boss"
        assert receipt["headline"] == "Drew the Final Boss."


class TestSemanticReceiptItems:
    """Plan §2.3. `kind` — and only `kind` — carries valence; `value` is always
    the true magnitude of what the label states."""

    @pytest.fixture(scope="class")
    def rich(self, pool, play_policy):
        """A finished run that holds credits it never spent, which is the case
        v1 rendered as a negative number beside a positive sentence."""
        for seed in range(60):
            bp, st = play_policy(seed, random.Random(seed), pool, "pass")
            if st.credits >= 15:
                return bp, st, build_receipt(st, bp, pool)
        raise AssertionError("no seed finished holding credits")

    def test_every_item_is_well_formed(self, pool, play_policy):
        for policy in ("greedy", "random", "first", "pass"):
            for seed in range(25):
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                receipt = build_receipt(st, bp, pool)
                assert receipt["items"]
                for item in receipt["items"]:
                    assert item["kind"] in ITEM_KINDS
                    assert item["label"] and isinstance(item["label"], str)
                    assert set(item) <= {"kind", "label", "value", "unit", "display"}
                    if "unit" in item:
                        assert item["unit"] in ITEM_UNITS
                    if "value" in item:
                        assert isinstance(item["value"], (int, float))

    def test_no_item_value_is_ever_negated_to_drive_a_colour(
        self, pool, play_policy
    ):
        """The v1 bug: `signed_value: -state.credits` on a HOLDING, purely so a
        shared signedColorVar() would paint it red."""
        for policy in ("greedy", "random", "first", "pass"):
            for seed in range(25):
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                for item in build_receipt(st, bp, pool)["items"]:
                    assert item.get("value", 0) >= 0, item

    def test_unspent_credits_are_neutral_and_positive(self, rich):
        _, st, receipt = rich
        item = next(
            i for i in receipt["items"] if i["label"].startswith("Finished holding")
        )
        assert item == {
            "kind": "neutral",
            "label": f"Finished holding {st.credits} unspent credits.",
            "value": st.credits,
            "unit": "credits",
        }
        # The same number the Credits section prints, with the same sign.
        assert receipt["credits_remaining"] == item["value"]

    def test_the_lives_record_item_reports_lives_not_a_penalty(self, pool, play_policy):
        bp, st = play_policy(
            SEED_GREEDY_SWEEP, random.Random(SEED_GREEDY_SWEEP), pool, "greedy"
        )
        receipt = build_receipt(st, bp, pool)
        item = next(i for i in receipt["items"] if i["kind"] == "record"
                    and "lives" in i["label"])
        assert item["value"] == st.lives
        assert item["display"] == f"{st.lives} of {STARTING_LIVES}"

    def test_reasons_is_a_deprecated_projection_of_items(self, pool, play_policy):
        """Kept for one release so a client that has not shipped `items` yet
        still renders — with the sign bug fixed even there."""
        for policy in ("greedy", "pass"):
            for seed in range(25):
                bp, st = play_policy(seed, random.Random(seed), pool, policy)
                receipt = build_receipt(st, bp, pool)
                labels = {i["label"] for i in receipt["items"]}
                for reason in receipt["reasons"]:
                    assert reason["text"] in labels
                    assert reason["kind"] in {
                        "lane_strength", "lane_weakness", "acquisition", "economy"
                    }
                    if reason["kind"] == "economy":
                        assert reason["signed_value"] >= 0


class TestDailySeed:
    def test_a_fixed_date_always_yields_the_same_seed(self):
        for date in ("2026-07-31", "2025-01-01", "2024-02-29"):
            values = {daily_seed(date) for _ in range(5)}
            assert len(values) == 1

    def test_the_seed_is_reproducible_from_the_published_formula(self):
        import hashlib

        date = "2026-07-31"
        raw = f"run-the-table-daily:{RULESET_VERSION}:{date}"
        expected = int(hashlib.sha256(raw.encode()).hexdigest(), 16) % (2 ** 31)
        assert daily_seed(date) == expected

    def test_consecutive_dates_produce_different_seeds(self):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        seeds = [
            daily_seed((start + timedelta(days=i)).strftime(DATE_FORMAT))
            for i in range(366)
        ]
        assert len(set(seeds)) == 366

    def test_daily_seeds_fit_the_generator_and_produce_legal_runs(self, pool):
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for i in range(0, 30, 7):
            date = (start + timedelta(days=i)).strftime(DATE_FORMAT)
            seed = daily_seed(date)
            assert 0 <= seed < 2 ** 31
            bp = generate_blueprint(seed, run_type="daily", date=date, pool=pool)
            assert bp.run_type == "daily"
            assert bp.date == date
            assert len(bp.starting_starters) == 5

    def test_run_ids_are_namespaced_by_date(self):
        assert daily_run_id("2026-07-31") == "rtt-daily-2026-07-31"

    def test_the_descriptor_publishes_seed_and_ruleset(self):
        descriptor = daily_descriptor("2026-07-31")
        assert descriptor == {
            "date": "2026-07-31",
            "run_id": "rtt-daily-2026-07-31",
            "seed": daily_seed("2026-07-31"),
            "ruleset_version": RULESET_VERSION,
        }


class TestDateValidation:
    NOW = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)

    def test_today_is_accepted(self):
        assert validate_run_date("2026-07-31", now=self.NOW) == "2026-07-31"

    def test_the_rollover_is_midnight_pacific_not_midnight_utc(self):
        """The daily boundary is midnight America/Los_Angeles (nba_peak.daily_key).

        17:00 UTC is mid-afternoon in California and must NOT roll the board
        over; 07:00 UTC the next morning is exactly midnight PDT and must.
        """
        # 23:59 PDT on the 31st -- still the 31st's run.
        assert today_utc_date(datetime(2026, 8, 1, 6, 59, tzinfo=timezone.utc)) == "2026-07-31"
        # 00:00 PDT on the 1st -- the new run.
        assert today_utc_date(datetime(2026, 8, 1, 7, 0, tzinfo=timezone.utc)) == "2026-08-01"
        # Midnight UTC is 17:00 PDT the previous day: not a rollover.
        assert today_utc_date(datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)) == "2026-07-31"

    def test_a_naive_datetime_is_read_as_utc_then_converted(self):
        """A naive reference instant is UTC, never the container's local zone --
        reading an accident of deployment is exactly the ambiguity this module
        exists to remove. 06:00 UTC is 23:00 PDT the previous day."""
        assert today_utc_date(datetime(2026, 7, 31, 6, 0)) == "2026-07-30"

    def test_future_dates_are_rejected(self):
        for date in ("2026-08-01", "2026-12-25", "2030-01-01"):
            with pytest.raises(InvalidRunDate, match="future"):
                validate_run_date(date, now=self.NOW)

    def test_the_archive_window_is_exactly_366_days(self):
        oldest = (self.NOW - timedelta(days=366)).strftime(DATE_FORMAT)
        too_old = (self.NOW - timedelta(days=367)).strftime(DATE_FORMAT)
        assert validate_run_date(oldest, now=self.NOW) == oldest
        with pytest.raises(InvalidRunDate, match="366"):
            validate_run_date(too_old, now=self.NOW)

    def test_malformed_dates_are_rejected(self):
        for bad in ("31-07-2026", "2026/07/31", "not-a-date", "", "2026-13-01", None):
            with pytest.raises(InvalidRunDate):
                validate_run_date(bad, now=self.NOW)
