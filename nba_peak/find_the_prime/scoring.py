"""FIND THE PRIME scoring: regret-normalised round points, match totals, ties.

ROUND SCORE, 0-100, from canonical scores only (never start-year distance):

    regret = best_window_score - chosen_window_score        (display points)
    if regret <= EQUIVALENT_REGRET:  100, and the round counts as a found prime
    else:                            100 * max(0, 1 - regret / scale)

`scale` is the player's own best-to-worst spread at that duration, clamped to
the eligible pool's percentile band (`pool.scale_for`). Consequences, measured
on the v1 artifact (see the design doc): the exact best window is 100; a window
the model rates as effectively tied is 100; a window one season off scores a
median ~89-91; the career's median window ~60-69; a rookie or decline window
~0. A smaller canonical gap always costs fewer points -- there is no step
anywhere except the equivalence band, which only ever rounds UP.

NO ANSWER scores 0 and carries the maximum possible regret for the round
(`best - worst window`), so the regret tie-break can never favour silence.

MATCH SCORE is the sum of nine rounds (max 900). Placement: total, then more
found primes, then LOWER total regret, then a shared placement. Speed is never
an input.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.find_the_prime import config as C
from nba_peak.prime_modes.placement import competition_placements


def round_score(best_score: float, chosen_score: float, scale: float) -> tuple[float, float, bool]:
    """(points, regret, found_prime)."""
    if scale <= 0:
        raise ValueError("a prompt with no scale cannot be scored (eligibility forbids it)")
    regret = round(max(0.0, best_score - chosen_score), 4)
    if regret <= C.EQUIVALENT_REGRET:
        return C.MAX_ROUND_SCORE, regret, True
    return round(C.MAX_ROUND_SCORE * max(0.0, 1.0 - regret / scale), 2), regret, False


def score_answer(round_: dict, start_season_end: Optional[int]) -> dict:
    """Score one seat's answer (or its absence) for a dealt round."""
    windows = {w["start_season_end"]: w for w in round_["windows"]}
    best = round_["best_score"]
    if start_season_end is None:
        return {
            "window_id": None,
            "start_season_end": None,
            "prime_score": None,
            "points": 0.0,
            "regret": round(best - round_["floor"], 4),
            "found_prime": False,
        }
    window = windows[start_season_end]
    points, regret, found = round_score(best, window["prime_score"], round_["scale"])
    return {
        "window_id": window["window_id"],
        "start_season_end": start_season_end,
        "prime_score": window["prime_score"],
        "points": points,
        "regret": regret,
        "found_prime": found,
    }


def seat_totals(state: dict, seat_index: int) -> dict:
    points = 0.0
    found = 0
    regret = 0.0
    answered = 0
    rounds_scored = 0
    for result in state["round_results"]:
        row = next(s for s in result["seats"] if s["seat_index"] == seat_index)
        rounds_scored += 1
        points += row["points"]
        found += 1 if row["found_prime"] else 0
        regret += row["regret"]
        answered += 1 if row["window_id"] is not None else 0
    return {
        "seat_index": seat_index,
        "total": round(points, 2),
        "found_primes": found,
        "total_regret": round(regret, 4),
        "rounds_scored": rounds_scored,
        "rounds_answered": answered,
        "average_regret": round(regret / rounds_scored, 4) if rounds_scored else None,
    }


def placement_key(totals: dict) -> tuple:
    return (totals["total"], totals["found_primes"], -totals["total_regret"])


def placements(state: dict) -> dict[int, tuple[int, str]]:
    entries = [(s["seat_index"], placement_key(seat_totals(state, s["seat_index"]))) for s in state["seats"]]
    forfeits = {s["seat_index"]: s["forfeit_order"] for s in state["seats"] if s["forfeited"]}
    return competition_placements(entries, forfeits)


def standings(state: dict) -> list[dict]:
    places = placements(state)
    rows = []
    for seat in state["seats"]:
        totals = seat_totals(state, seat["seat_index"])
        totals["position"] = places[seat["seat_index"]][0]
        totals["forfeited"] = seat["forfeited"]
        rows.append(totals)
    rows.sort(key=lambda r: (r["position"], r["seat_index"]))
    return rows
