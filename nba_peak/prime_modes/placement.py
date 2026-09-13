"""Final placements for a four-seat match, in the foundation's own convention.

STANDARD COMPETITION RANKING, TIES SHARING A PLACEMENT (1, 2, 2, 4) -- the rule
stated on `arena_match_results.placement` and consumed by the pairwise rating
pass, which compares placements rather than assuming placement 1 means "won".
Same outcome mapping `nba_peak/three_man_weave/evaluation.py::placements` uses:

  * alone in first  -> "win"
  * tied for first  -> "draw" for every seat tied there
  * anything else   -> "loss"

A FORFEITED SEAT PLACES BELOW EVERY SEAT THAT PLAYED ON, regardless of its
partial score -- conceding cannot be a way to lock in a lead. Among forfeits,
the LATER forfeit places higher (it played more of the match).
"""
from __future__ import annotations

from typing import Optional, Sequence

OUTCOME_WIN = "win"
OUTCOME_LOSS = "loss"
OUTCOME_DRAW = "draw"


def competition_placements(
    entries: Sequence[tuple[int, tuple]],
    forfeit_order: Optional[dict[int, int]] = None,
) -> dict[int, tuple[int, str]]:
    """seat_index -> (placement, outcome).

    `entries` is `(seat_index, key)` where a LARGER key tuple is better and equal
    keys tie. `forfeit_order` maps a forfeited seat to the order it forfeited in
    (0 = first to leave).
    """
    forfeit_order = forfeit_order or {}

    def rank_key(entry: tuple[int, tuple]) -> tuple:
        seat, key = entry
        if seat in forfeit_order:
            # Below everyone who played on; a later forfeit above an earlier one.
            return (0, forfeit_order[seat])
        return (1, key)

    ordered = sorted(entries, key=lambda e: (rank_key(e), -e[0]), reverse=True)
    groups: list[tuple[tuple, list[int]]] = []
    for seat, key in ordered:
        k = rank_key((seat, key))
        if groups and groups[-1][0] == k:
            groups[-1][1].append(seat)
        else:
            groups.append((k, [seat]))

    out: dict[int, tuple[int, str]] = {}
    position = 1
    for index, (_key, seats) in enumerate(groups):
        outcome = OUTCOME_LOSS
        if index == 0 and not any(seat in forfeit_order for seat in seats):
            outcome = OUTCOME_DRAW if len(seats) > 1 else OUTCOME_WIN
        for seat in sorted(seats):
            out[seat] = (position, outcome)
        position += len(seats)
    return out
