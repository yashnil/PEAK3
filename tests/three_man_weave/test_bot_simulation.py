"""PART 10's 2,000-pick deterministic bot simulation.

WHY THIS IS SEPARATE FROM `test_bot.py`. That file asserts the policy's shape
on hand-built rolls and on sixty matches; this one plays enough full drafts to
produce the metrics the specification asks to be REPORTED -- optimal rate,
near-optimal rate, mean/p95/max regret, dominance violations, illegal picks and
completion failures -- and fails on the three that are acceptance criteria
rather than observations.

Every pick is scored against the bot's OWN option list for that turn, which is
the only ranking that exists at decision time: the roll, the seat's open slots
and the arrangement plans are all live state. Comparing against a
post-hoc optimum computed with hindsight would be measuring a different game.

THE THREE HARD GATES (acceptance, not calibration):
    zero illegal picks · zero completion failures · zero dominance violations

Everything else is reported through `simulation_report` and bounded loosely, so
a future retune shows up as a changed number rather than as a red build.
"""
from __future__ import annotations

import math
import random

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.bot import (
    ThreeManWeaveBot,
    _MAX_QUALITY_REGRET_POINTS,
    _MILD_DEVIATION_REGRET,
)
from nba_peak.three_man_weave.config import stream_rng

#: 18 picks per match (3 seats x 6 slots), so 120 matches clears the 2,000-pick
#: floor with margin. Deterministic: every seed, every roll and every sample is
#: a pure function of the match seed.
SIMULATION_MATCHES = 120
REQUIRED_PICKS = 2000


def _projection(state: D.DraftState, seat: int) -> tuple[dict, dict]:
    roll = state.current_roll
    assert roll is not None
    fits = D.candidate_fits(state, seat)
    return (
        {
            "current_roll": {
                **roll.as_dict(),
                "candidates": [{"player_slug": slug} for slug in roll.eligible_slugs],
            }
        },
        {
            "open_slots": list(state.roster(seat).open_slots()),
            "candidate_fits": {slug: fit.as_dict() for slug, fit in fits.items()},
        },
    )


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


@pytest.fixture(scope="module")
def simulation_report(index) -> dict:
    bot = ThreeManWeaveBot()
    picks = 0
    optimal = 0
    near_optimal = 0
    utility_regrets: list[float] = []
    quality_regrets: list[float] = []
    dominance_violations: list[dict] = []
    illegal_picks: list[dict] = []
    completion_failures: list[int] = []
    catastrophic: list[dict] = []

    for seed in range(SIMULATION_MATCHES):
        state = D.create_match(seed)
        roll_rng = stream_rng(seed, "rolls")
        guard = 0
        while not state.is_complete and guard < 200:
            guard += 1
            if (
                state.current_roll is None
                or state.current_roll.round_number != state.current_round
            ):
                roll = F.roll_next(
                    index,
                    state.rosters,
                    state.drafted_identities(),
                    state.current_round,
                    roll_rng,
                    frozenset(state.used_roll_ids),
                )
                if roll is None:
                    completion_failures.append(seed)
                    break
                state = D.set_roll(state, roll)

            seat = state.current_seat
            assert seat is not None
            public, private = _projection(state, seat)
            options = bot.options(public, private)
            decision = bot.decide(
                public, private, random.Random(f"tmw:{seed}:{state.turn_index}")
            )
            if decision is None or not options:
                completion_failures.append(seed)
                break
            _command, payload = decision

            chosen = next(
                (
                    option
                    for option in options
                    if option["player_slug"] == payload["player_slug"]
                    and option["slot_type"] == payload["slot_type"]
                ),
                None,
            )
            if chosen is None:
                # The bot named a (player, slot) that was not on its own legal
                # option list. Recorded rather than raised so one bad pick does
                # not hide the rest of the run.
                illegal_picks.append({"seed": seed, "payload": dict(payload)})
                break

            picks += 1
            # Measured against the best option the policy MAY take -- the
            # quality gate can exclude the utility leader, and scoring against
            # a forbidden pick would be scoring a different policy.
            viable = ThreeManWeaveBot.viable_options(options)
            best_utility = max(option["utility"] for option in viable)
            best_score = max(option["score"] for option in options)
            utility_regret = best_utility - chosen["utility"]
            quality_regret = best_score - chosen["score"]
            utility_regrets.append(utility_regret)
            quality_regrets.append(quality_regret)
            if chosen is viable[0]:
                optimal += 1
                near_optimal += 1
            elif utility_regret <= _MILD_DEVIATION_REGRET + 1e-9:
                near_optimal += 1

            forced = ThreeManWeaveBot.dominant_option(options)
            if forced is not None and chosen["player_slug"] != forced["player_slug"]:
                dominance_violations.append(
                    {
                        "seed": seed,
                        "required": forced["player_slug"],
                        "taken": chosen["player_slug"],
                        "points_given_up": round(quality_regret, 2),
                    }
                )
            if quality_regret > _MAX_QUALITY_REGRET_POINTS:
                catastrophic.append(
                    {
                        "seed": seed,
                        "taken": chosen["player_slug"],
                        "points_given_up": round(quality_regret, 2),
                    }
                )

            try:
                state = D.apply_pick(
                    state,
                    payload["player_slug"],
                    payload.get("slot_type"),
                    seat_index=seat,
                    placements=payload.get("placements"),
                )
            except Exception as exc:  # the reducer refused a bot pick
                illegal_picks.append({"seed": seed, "error": repr(exc)})
                break
        else:
            if not state.is_complete:
                completion_failures.append(seed)
            continue
        if not state.is_complete and seed not in completion_failures:
            completion_failures.append(seed)

    return {
        "matches": SIMULATION_MATCHES,
        "picks": picks,
        "optimal_rate": optimal / picks if picks else 0.0,
        "near_optimal_rate": near_optimal / picks if picks else 0.0,
        "mean_utility_regret": sum(utility_regrets) / len(utility_regrets)
        if utility_regrets
        else 0.0,
        "p95_utility_regret": _percentile(utility_regrets, 0.95),
        "max_utility_regret": max(utility_regrets, default=0.0),
        "mean_quality_regret_points": sum(quality_regrets) / len(quality_regrets)
        if quality_regrets
        else 0.0,
        "p95_quality_regret_points": _percentile(quality_regrets, 0.95),
        "max_quality_regret_points": max(quality_regrets, default=0.0),
        "dominance_violations": dominance_violations,
        "illegal_picks": illegal_picks,
        "completion_failures": completion_failures,
        "catastrophic_deviations": catastrophic,
    }


def test_the_simulation_covered_at_least_two_thousand_picks(simulation_report):
    assert simulation_report["picks"] >= REQUIRED_PICKS, simulation_report["picks"]


# -- the three hard gates ---------------------------------------------------


def test_zero_illegal_picks(simulation_report):
    assert simulation_report["illegal_picks"] == []


def test_zero_completion_failures(simulation_report):
    assert simulation_report["completion_failures"] == []


def test_zero_dominance_violations(simulation_report):
    assert simulation_report["dominance_violations"] == []


def test_zero_catastrophic_quality_deviations(simulation_report):
    """The Carl Landry gate, over the whole run.

    A deviation that gave up more than the quality floor in PEAK3 points is
    the exact event the manual tester reported. Not a rate: zero.
    """
    assert simulation_report["catastrophic_deviations"] == []


# -- calibration, reported and loosely bounded ------------------------------


def test_calibration_is_in_the_briefed_range(simulation_report):
    assert 0.88 <= simulation_report["optimal_rate"] <= 0.99
    # Every deviation is by construction within the mild bound, so near-optimal
    # is 1.0; asserted anyway, because a future band that reached past the
    # bound would show up here first.
    assert simulation_report["near_optimal_rate"] == pytest.approx(1.0)


def test_regret_stays_small(simulation_report):
    assert simulation_report["max_utility_regret"] <= _MILD_DEVIATION_REGRET + 1e-9
    assert simulation_report["mean_utility_regret"] <= 0.02
    assert simulation_report["max_quality_regret_points"] <= _MAX_QUALITY_REGRET_POINTS


def test_report_is_printable(simulation_report, capsys):
    """Emits the metrics PART 10 asks to be reported.

    A test rather than a script so the numbers are produced by the same run CI
    already pays for, and so they cannot drift from what is actually asserted.
    """
    with capsys.disabled():
        print("\n--- Three-Man Weave bot simulation ---")
        for key in (
            "matches",
            "picks",
            "optimal_rate",
            "near_optimal_rate",
            "mean_utility_regret",
            "p95_utility_regret",
            "max_utility_regret",
            "mean_quality_regret_points",
            "p95_quality_regret_points",
            "max_quality_regret_points",
        ):
            value = simulation_report[key]
            print(f"  {key:32} {value:.4f}" if isinstance(value, float) else f"  {key:32} {value}")
        for key in (
            "dominance_violations",
            "illegal_picks",
            "completion_failures",
            "catastrophic_deviations",
        ):
            print(f"  {key:32} {len(simulation_report[key])}")
