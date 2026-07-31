"""Final receipt determinism and daily-seed stability."""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from nba_peak.run_the_table import state as S
from nba_peak.run_the_table.battle import roster_lane_profile, roster_total
from nba_peak.run_the_table.config import (
    ACTS,
    LANE_FIELDS,
    LANE_LABELS,
    RULESET_VERSION,
    STARTING_CREDITS,
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
from nba_peak.run_the_table.receipt import build_receipt

RECEIPT_SEEDS = (0, 8, 12, 44, 101, 777)


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


class TestReceiptContent:
    @pytest.fixture(scope="class")
    def finished(self, pool, play_policy):
        bp, st = play_policy(8, random.Random(8), pool, "greedy")
        return bp, st, build_receipt(st, bp, pool)

    def test_the_record_matches_the_battles_that_were_played(self, finished):
        _, st, receipt = finished
        wins = sum(1 for b in st.battles if b.outcome == "win")
        losses = sum(1 for b in st.battles if b.outcome == "loss")
        assert receipt["bosses_defeated"] == wins
        assert receipt["battles_lost"] == losses
        assert receipt["record"] == f"{wins}-{losses}"
        assert receipt["ran_the_table"] == (st.status == "complete" and wins == ACTS)
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
        _, st, receipt = finished
        starters = [s.card_id for s in st.starters if s.card_id]
        bench = [s.card_id for s in st.bench if s.card_id]
        expected = roster_lane_profile(pool, starters, bench, 0.35)
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
        _, st, receipt = finished
        spent = sum(a["cost"] for a in st.acquisitions) + sum(
            max(0, t["net_cost"]) for t in st.trades
        )
        assert receipt["credits_spent"] == spent
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
        bp, st = play_policy(12, random.Random(3), pool, "pass")
        assert st.status == "failed"
        receipt = build_receipt(st, bp, pool)
        assert receipt["verdict"] == "RUN ENDED"
        assert receipt["headline"] == f"Out of lives in Act {st.battles[-1].act}."
        assert receipt["ran_the_table"] is False
        assert receipt["lives_remaining"] == 0

    def test_a_run_the_table_receipt_says_so(self, pool, play_policy):
        bp, st = play_policy(8, random.Random(8), pool, "greedy")
        receipt = build_receipt(st, bp, pool)
        if not receipt["ran_the_table"]:
            pytest.skip("seed 8 no longer runs the table under the greedy policy")
        assert receipt["verdict"] == "RUN COMPLETE"
        assert receipt["headline"] == "Ran the table."
        assert receipt["record"] == f"{ACTS}-0"

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

    def test_utc_date_rollover_uses_utc_not_local_time(self):
        assert today_utc_date(datetime(2026, 7, 31, 23, 59, tzinfo=timezone.utc)) == "2026-07-31"
        assert today_utc_date(datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)) == "2026-08-01"

    def test_a_naive_datetime_is_treated_as_utc(self):
        assert today_utc_date(datetime(2026, 7, 31, 6, 0)) == "2026-07-31"

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
