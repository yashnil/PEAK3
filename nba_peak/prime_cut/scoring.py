"""PRIME CUT scoring: heat capture, match score, placement keys, receipt facts.

HEAT CAPTURE, board-relative and 0-100 by construction:

    optimal_total = sum of the heat's four highest canonical prime_scores
    floor_total   = sum of its four lowest
    kept_total    = sum of the four cards this seat kept

    heat_capture  = 100 * (kept_total - floor_total) / (optimal_total - floor_total)

Every seat keeps exactly four of the eight, so `floor_total <= kept_total <=
optimal_total` and no clamping is needed. The board validator guarantees
`optimal_total - floor_total >= HEAT_MIN_CAPTURE_SPREAD`, so the denominator is
always meaningful.

MATCH SCORE is the plain mean of the heats played. 2Y, 3Y and 5Y scores live on
different raw scales; capture is relative to each heat's own range, so no
duration can dominate the match.

PLACEMENT is by match score, then by optimal keeps across all heats, then by
captured value (`sum kept_total / sum optimal_total`), then a shared placement.
Speed is never a tie-break.
"""
from __future__ import annotations

from typing import Optional, Sequence

from nba_peak.prime_cut import config as C
from nba_peak.prime_modes.placement import competition_placements


def heat_capture(kept_total: float, optimal_total: float, floor_total: float) -> float:
    denominator = optimal_total - floor_total
    if denominator <= 0:
        raise ValueError("a heat with no score spread cannot be scored (the board validator forbids it)")
    return round(100.0 * (kept_total - floor_total) / denominator, 2)


def ordered_cards(cards: Sequence[dict]) -> list[dict]:
    """Best first. The tie-break after `prime_score` only matters for a board
    the validator would already have refused at the cut line."""
    return sorted(cards, key=lambda c: (-c["prime_score"], -c["prime_index"], c["card_index"]))


def score_heat(state: dict, heat_index: int) -> dict:
    heat = state["board"]["heats"][heat_index]
    cards = heat["cards"]
    by_index = {c["card_index"]: c for c in cards}
    ordered = ordered_cards(cards)
    k = C.KEEPS_PER_HEAT
    optimal = [c["card_index"] for c in ordered[:k]]
    optimal_set = set(optimal)
    optimal_total = round(sum(c["prime_score"] for c in ordered[:k]), 4)
    floor_total = round(sum(c["prime_score"] for c in ordered[k:]), 4)
    cut_line = (ordered[k - 1]["prime_score"] + ordered[k]["prime_score"]) / 2

    seats = []
    for seat in state["seats"]:
        decisions = seat["decisions"][heat_index]
        kept = [d["card_index"] for d in decisions if d["decision"] == C.DECISION_KEEP]
        cut = [d["card_index"] for d in decisions if d["decision"] == C.DECISION_CUT]
        if len(kept) != k or len(cut) != C.CUTS_PER_HEAT:
            raise ValueError(f"seat {seat['seat_index']} heat {heat_index}: incomplete decisions")
        kept_total = round(sum(by_index[i]["prime_score"] for i in kept), 4)
        score = lambda i: by_index[i]["prime_score"]  # noqa: E731

        correct = [
            d for d in decisions
            if (d["decision"] == C.DECISION_KEEP) == (d["card_index"] in optimal_set)
        ]
        closest_correct = min(
            correct, key=lambda d: (abs(score(d["card_index"]) - cut_line), d["card_index"]), default=None
        )
        seats.append(
            {
                "seat_index": seat["seat_index"],
                "capture": heat_capture(kept_total, optimal_total, floor_total),
                "kept_card_indexes": sorted(kept),
                "cut_card_indexes": sorted(cut),
                "optimal_kept": len(optimal_set.intersection(kept)),
                "kept_total": kept_total,
                "decisions": [dict(d) for d in decisions],
                "strongest_correct_keep": max((i for i in kept if i in optimal_set), key=score, default=None),
                "weakest_keep": min(kept, key=score),
                "costliest_cut": max((i for i in cut if i in optimal_set), key=score, default=None),
                "best_call": closest_correct["card_index"] if closest_correct else None,
            }
        )
    return {
        "heat_index": heat_index,
        "duration": heat["duration"],
        "optimal_card_indexes": optimal,
        "cut_line": round(cut_line, 4),
        "optimal_total": optimal_total,
        "floor_total": floor_total,
        "cards": [
            {
                "card_index": c["card_index"],
                "prime_score": c["prime_score"],
                "prime_index": c["prime_index"],
                "canonical_rank": c["canonical_rank"],
            }
            for c in cards
        ],
        "seats": seats,
    }


def seat_totals(state: dict, seat_index: int) -> dict:
    """What one seat has banked across the heats played so far."""
    captures: dict[str, float] = {}
    optimal_keeps = 0
    kept_sum = 0.0
    optimal_sum = 0.0
    for heat in state["heat_results"]:
        row = next(s for s in heat["seats"] if s["seat_index"] == seat_index)
        captures[str(heat["duration"])] = row["capture"]
        optimal_keeps += row["optimal_kept"]
        kept_sum += row["kept_total"]
        optimal_sum += heat["optimal_total"]
    match_score: Optional[float] = (
        round(sum(captures.values()) / len(captures), 2) if captures else None
    )
    return {
        "seat_index": seat_index,
        "heat_scores": captures,
        "heats_completed": len(captures),
        "match_score": match_score,
        "optimal_keeps": optimal_keeps,
        "captured_ratio": round(kept_sum / optimal_sum, 6) if optimal_sum else None,
    }


def placement_key(totals: dict) -> tuple:
    return (
        totals["match_score"] if totals["match_score"] is not None else -1.0,
        totals["optimal_keeps"],
        totals["captured_ratio"] if totals["captured_ratio"] is not None else -1.0,
    )


def placements(state: dict) -> dict[int, tuple[int, str]]:
    entries = [(seat["seat_index"], placement_key(seat_totals(state, seat["seat_index"]))) for seat in state["seats"]]
    forfeits = {
        seat["seat_index"]: seat["forfeit_order"] for seat in state["seats"] if seat["forfeited"]
    }
    return competition_placements(entries, forfeits)


def standings(state: dict) -> list[dict]:
    """Every seat's banked totals and current position, best first."""
    places = placements(state)
    rows = []
    for seat in state["seats"]:
        totals = seat_totals(state, seat["seat_index"])
        totals["position"] = places[seat["seat_index"]][0]
        totals["forfeited"] = seat["forfeited"]
        rows.append(totals)
    rows.sort(key=lambda r: (r["position"], r["seat_index"]))
    return rows
