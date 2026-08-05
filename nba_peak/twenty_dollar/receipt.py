"""The end-of-match receipt.

HOUSE STYLE, INHERITED DELIBERATELY
-----------------------------------
Two conventions are copied from `apps/api/app/services/head_to_head.py`, which
is this codebase's reference receipt:

  * THE ORDER TUPLE IS THE ORDERING. `SETTLEMENT_ORDER` below is walked and
    nothing else is consulted, so a displayed order cannot drift from an
    applied one.
  * NON-DECIDING LEVELS ARE REPORTED, NOT OMITTED, with the verdict
    `not_consulted`. A receipt that silently dropped the levels below the
    deciding one would imply they counted.

NO SCORE IS COMPUTED HERE. Every `prime_score` is read from the committed
artifact; the only arithmetic is summing, subtracting and dividing values the
model already published, which is reporting rather than scoring.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.twenty_dollar.config import (
    ABSENT_COMPONENT_FIELDS,
    COMPONENT_FIELDS,
    MODEL_VERSION,
    RULESET_VERSION,
    SLOTS,
    STARTING_BUDGET,
)
from nba_peak.twenty_dollar.pool import CandidatePool, get_pool

#: The match-level winner order. `(level_id, label, higher_wins)`.
#:
#: ONE LEVEL, AND ONLY ONE. The roster total -- the sum of five career-best
#: canonical 1Y PEAK3 scores -- decides the match, and nothing else does.
#:
#: v1 carried `budget_remaining` as a second level, on the argument that two
#: identical rosters are not identically well built if one cost more. That is a
#: reasonable argument and it is NOT the published rule: unspent money has no
#: scoring value, so a match decided by it would be decided by something the
#: rules told both players did not count. Two exactly equal totals are a draw,
#: which is a real outcome rather than a gap to be filled.
#:
#: `budget_remaining` is still reported on every seat's block for the receipt to
#: show; it simply does not decide anything.
SETTLEMENT_ORDER: tuple[tuple[str, str, bool], ...] = (
    ("roster_total", "Roster PEAK3 total", True),
)

#: Rounded before comparison so IEEE-754 noise in a sum of published two-decimal
#: scores can never decide a match. Two totals differing by 1e-12 are equal
#: here and fall through to the next level.
SETTLEMENT_ROUNDING = 6


def component_disclosure() -> dict:
    """Why this receipt shows five components where the house shows six.

    STATED, NOT SILENTLY RENDERED. `top_1000_peaks.v1.json` carries the five
    official weighted contributions and does NOT carry `teammate_adjustment`,
    which the canonical 250-pool `data/web` records do. That is a real property
    of the broader-universe artifact, not a bug here and not something this
    module can fill in -- fabricating the missing sixth value is precisely what
    CLAUDE.md forbids.

    A player reading a five-bar breakdown next to a six-bar one elsewhere in
    the app deserves to be told which is which, so the receipt says so in
    words rather than leaving the gap to be noticed.
    """
    return {
        "shown": list(COMPONENT_FIELDS),
        "absent": list(ABSENT_COMPONENT_FIELDS),
        "count": len(COMPONENT_FIELDS),
        "house_count": len(COMPONENT_FIELDS) + len(ABSENT_COMPONENT_FIELDS),
        "note": (
            "This board publishes five of the six PEAK3 components. The broader "
            "1,000-player peak board (top_1000_peaks.v1) does not carry "
            "teammate_adjustment, which the canonical 250-player rankings do. The "
            "missing component is not estimated or substituted -- it is absent from "
            "the source, and is reported as absent."
        ),
    }


def _round(value: float) -> float:
    return round(float(value), SETTLEMENT_ROUNDING)


def _per_dollar(total: float, spent: int) -> float:
    """Roster PEAK3 per dollar actually committed.

    `max(1, spent)` keeps the ratio finite for a seat that spent nothing.
    Spending zero is a legal line and must score as the best possible
    efficiency rather than dividing by zero -- the same call
    `head_to_head.credit_efficiency` makes and for the same reason.
    """
    return round(float(total) / max(1, int(spent)), 4)


def build(state: dict, pool: Optional[CandidatePool] = None) -> dict:
    """The full receipt for a completed match.

    Safe to call on an unfinished match: the numbers describe what has happened
    so far. `settlement` is None until the match is actually complete, so a
    mid-match caller cannot read a verdict that has not been decided.
    """
    pool = pool or get_pool()
    seats = state["seats"]
    history = state["history"]

    per_seat: list[dict] = []
    for index, seat in enumerate(seats):
        cards = [pool.get(entry["player_slug"]) for entry in seat["roster"]]
        total = _round(sum(c.prime_score for c in cards))
        spent = sum(int(entry["price"]) for entry in seat["roster"])
        components = {
            field: _round(sum(c.components[field] for c in cards))
            for field in COMPONENT_FIELDS
        }
        per_seat.append(
            {
                "seat_index": index,
                "roster_total": total,
                "spent": spent,
                "budget_remaining": seat["budget"],
                "peak3_per_dollar": _per_dollar(total, spent),
                "components": components,
                "roster": [
                    {
                        "player_slug": card.player_slug,
                        "player_name": card.player_name,
                        "anchor_season": card.anchor_season,
                        "prime_score": card.prime_score,
                        "price": int(entry["price"]),
                        "value_per_dollar": _per_dollar(card.prime_score, int(entry["price"])),
                        "autofilled": bool(entry.get("autofilled", False)),
                        "components": dict(card.components),
                    }
                    for card, entry in zip(cards, seat["roster"])
                ],
            }
        )

    return {
        "ruleset_version": RULESET_VERSION,
        "model_version": state.get("model_version", MODEL_VERSION),
        "starting_budget": STARTING_BUDGET,
        "slots": list(SLOTS),
        "seats": per_seat,
        "positional": _positional(state, pool),
        "best_bargain": _best_bargain(per_seat),
        "biggest_overpay": _biggest_overpay(per_seat),
        "most_decisive": _most_decisive(state, pool),
        # ALWAYS None. See `_one_bid_away` for why the panel was
        # retired rather than repaired; the key is retained so an older
        # client renders nothing instead of crashing on a missing field.
        "counterfactual": _one_bid_away(state, pool),
        "autofilled": bool(state.get("autofilled", False)),
        "rounds_played": len(history),
        "component_disclosure": component_disclosure(),
        "settlement": _settlement(per_seat) if state["phase"] == "complete" else None,
    }


def _positional(state: dict, pool: CandidatePool) -> list[dict]:
    """Slot-by-slot comparison, using each seat's live global assignment.

    The slot a player occupies is recomputed from the whole roster rather than
    read from whichever slot motivated the purchase -- a multi-position player
    moves as later purchases arrive, and reporting the purchase-time slot would
    show two players on one slot for a roster that is entirely legal.
    """
    from nba_peak.twenty_dollar import feasibility

    assignments: list[dict[str, str]] = []
    for seat in state["seats"]:
        owned = [
            (entry["player_slug"], pool.get(entry["player_slug"]).positions)
            for entry in seat["roster"]
        ]
        fit = feasibility.evaluate(owned, (), require_future=False)
        assignments.append(fit.assignment if fit.feasible else {})

    price_of = [
        {entry["player_slug"]: int(entry["price"]) for entry in seat["roster"]}
        for seat in state["seats"]
    ]

    rows: list[dict] = []
    for slot in SLOTS:
        entries: list[Optional[dict]] = []
        for index, assignment in enumerate(assignments):
            slug = assignment.get(slot)
            if slug is None:
                entries.append(None)
                continue
            card = pool.get(slug)
            entries.append(
                {
                    "player_slug": card.player_slug,
                    "player_name": card.player_name,
                    "prime_score": card.prime_score,
                    "price": price_of[index].get(slug, 0),
                }
            )
        scores = [e["prime_score"] if e else 0.0 for e in entries]
        best = max(scores) if scores else 0.0
        winners = [i for i, s in enumerate(scores) if s == best and best > 0]
        rows.append(
            {
                "slot": slot,
                "seats": entries,
                "margin": _round(max(scores) - min(scores)) if len(scores) == 2 else 0.0,
                "winner_seat": winners[0] if len(winners) == 1 else None,
            }
        )
    return rows


def _best_bargain(per_seat: list[dict]) -> Optional[dict]:
    """Most PEAK3 per dollar across both rosters.

    Auto-filled slots are excluded: they were not bought, so crediting a seat
    with a bargain it never bid on would praise a fallback rule rather than a
    decision.
    """
    best: Optional[dict] = None
    for seat in per_seat:
        for entry in seat["roster"]:
            if entry["autofilled"]:
                continue
            if best is None or entry["value_per_dollar"] > best["value_per_dollar"]:
                best = {**entry, "seat_index": seat["seat_index"]}
    return best


def _biggest_overpay(per_seat: list[dict]) -> Optional[dict]:
    """Fewest PEAK3 per dollar, among purchases that actually cost something.

    Free acquisitions are skipped rather than reported as infinitely bad value:
    a player won for $0 is the best outcome in the game, and a naive
    lowest-ratio scan would rank it as the worst.
    """
    worst: Optional[dict] = None
    for seat in per_seat:
        for entry in seat["roster"]:
            if entry["autofilled"] or entry["price"] <= 0:
                continue
            if worst is None or entry["value_per_dollar"] < worst["value_per_dollar"]:
                worst = {**entry, "seat_index": seat["seat_index"]}
    return worst


def _most_decisive(state: dict, pool: CandidatePool) -> Optional[dict]:
    """The auction that moved the final margin most.

    Measured as the winning card's `prime_score` -- the swing between the two
    seats had the other side won it instead. Auto-fills are excluded because
    nobody chose them.
    """
    best: Optional[dict] = None
    for record in state["history"]:
        if record["winner_seat"] is None or record.get("decided_by") == "autofill":
            continue
        card = record["candidate"]
        swing = float(card["prime_score"])
        if best is None or swing > best["swing"]:
            best = {
                "round_index": record["round_index"],
                "player_slug": card["player_slug"],
                "player_name": card["player_name"],
                "prime_score": card["prime_score"],
                "price": record["price"],
                "winner_seat": record["winner_seat"],
                "bids": list(record["bids"]),
                "decided_by": record.get("decided_by"),
                "swing": _round(swing),
            }
    return best


def _one_bid_away(state: dict, pool: CandidatePool) -> None:
    """RETIRED. Always None, and the name is kept so the absence is greppable.

    WHY "ONE BID AWAY" WAS REMOVED RATHER THAN FIXED.
    -------------------------------------------------
    The panel claimed: raise your bid on this one lot by $N and the final
    totals become A to B. The dollar figure was right. The totals were not, and
    could not be made right, for a reason that is structural rather than a bug
    in the arithmetic.

    Moving a card from the winner's roster to the loser's is not a swap that
    leaves two legal rosters. Each seat buys exactly five players. If the loser
    had won that lot they would NOT then have bought the player they actually
    bought for that slot -- so their real roster is six cards under the
    counterfactual, and the winner's is four. The published "new totals"
    summed a six-card roster against a four-card one and presented the result
    as the score the match would have ended on.

    Nor can it be repaired by also removing the loser's actual purchase for
    that slot: the winner, having lost the lot, would have spent that money
    somewhere -- on a candidate from a later lot the loser also wanted, at a
    price neither seat's real bidding tells us. Every fix requires simulating
    an auction that did not happen, and a simulated auction reported beside
    real prices is a fabricated result in a receipt whose whole job is that
    every number in it can be checked.

    The receipt now reports what is TRUE about the auction that did happen: the
    decisive lot (`most_decisive`), the exact final margin, and the per-slot
    comparison. Those are facts, and a player who wants to know where the match
    turned is better served by the lot that actually turned it.

    Kept as a function returning None rather than deleted outright so a reader
    who goes looking for the panel finds this explanation instead of nothing.
    """
    return None


def _settlement(per_seat: list[dict]) -> dict:
    """Walk `SETTLEMENT_ORDER` and report every level.

    Levels below the deciding one are reported with the verdict
    `not_consulted`, never omitted -- the head-to-head convention, for the
    reason its own docstring gives: showing a lower level as "winning" would
    imply a rule that does not exist.
    """
    levels: list[dict] = []
    winner: Optional[int] = None
    decided_by: Optional[str] = None

    for level_id, label, higher_wins in SETTLEMENT_ORDER:
        values = [_round(seat[level_id]) for seat in per_seat]
        if winner is not None:
            levels.append(
                {
                    "level": level_id,
                    "label": label,
                    "higher_wins": higher_wins,
                    "values": values,
                    "verdict": "not_consulted",
                }
            )
            continue
        top = max(values) if higher_wins else min(values)
        leaders = [i for i, v in enumerate(values) if v == top]
        if len(leaders) == 1:
            winner = leaders[0]
            decided_by = level_id
            verdict = f"seat_{winner}"
        else:
            verdict = "tied"
        levels.append(
            {
                "level": level_id,
                "label": label,
                "higher_wins": higher_wins,
                "values": values,
                "verdict": verdict,
            }
        )

    return {
        "winner_seat": winner,
        "outcome": "draw" if winner is None else "decided",
        "decided_by": decided_by,
        "levels": levels,
        "rules_version": f"{RULESET_VERSION}_settlement",
    }
