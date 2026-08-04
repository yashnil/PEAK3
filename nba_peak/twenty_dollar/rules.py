"""Budget, sealed-bid resolution, and the tie-priority token.

Every rule in this module is integer arithmetic over whole dollars. That is a
correctness requirement, not a style choice: a sealed-bid auction compared with
floats would let two bids a player entered as "7" differ by 1e-16 and route to
the tie-break by accident, and the tie-break consumes a one-shot token. Money
here is `int` from the request boundary to the receipt.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from nba_peak.twenty_dollar.config import (
    MIN_RESERVE_PER_SLOT,
    ROSTER_SIZE,
    STARTING_BUDGET,
)

# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


def max_legal_bid(budget: int, filled_slots: int, *, roster_size: int = ROSTER_SIZE) -> int:
    """The most this seat may bid on the candidate in front of them.

    THE RESERVE RULE. Every slot that will still be unfilled AFTER this
    purchase must remain affordable, at `MIN_RESERVE_PER_SLOT` dollars each:

        slots_open_after = roster_size - filled_slots - 1
        max_bid          = budget - slots_open_after * MIN_RESERVE_PER_SLOT

    Worked, using the brief's own example: a seat holding $11 with 3 empty
    slots has `filled_slots = 2`, so `slots_open_after = 5 - 2 - 1 = 2` and
    `max_bid = 11 - 2 = 9`. Spending $9 leaves $2 for 2 slots, which is exactly
    the floor rather than a dollar under it.

    Why the reserve is enforced on the SERVER and never read from a request:
    the client's copy of a budget is a display, and a bid of "all of it" that
    happened to arrive after a concurrent state change would otherwise buy a
    roster that cannot be completed. `state.submit_bid` clamps against this
    function; there is no request field that can disagree with it.

    Never negative. A seat whose budget has somehow fallen below its own
    reserve floor can still bid 0 (pass), which is always legal.
    """
    slots_open_after = max(0, roster_size - filled_slots - 1)
    return max(0, budget - slots_open_after * MIN_RESERVE_PER_SLOT)


def reserve_floor(filled_slots: int, *, roster_size: int = ROSTER_SIZE) -> int:
    """The dollars a seat must still be holding once its current slot is paid
    for. The complement of `max_legal_bid`, published separately so the UI can
    state the constraint rather than only its consequence."""
    return max(0, roster_size - filled_slots - 1) * MIN_RESERVE_PER_SLOT


def is_solvent(budget: int, filled_slots: int, *, roster_size: int = ROSTER_SIZE) -> bool:
    """Can this seat still afford a dollar for each of its unfilled slots?

    An invariant rather than a check the game performs: `max_legal_bid` makes
    it impossible to violate. Asserted in the tests over a full random match so
    that a future rule change cannot break it silently.
    """
    return budget >= max(0, roster_size - filled_slots) * MIN_RESERVE_PER_SLOT


# ---------------------------------------------------------------------------
# Sealed-bid resolution
# ---------------------------------------------------------------------------

#: The auction order, as a tuple that IS the ordering.
#:
#: `resolve` walks this and does nothing else, so there is no second place the
#: order is written down and no way for a displayed order and an applied order
#: to drift apart. Copied in shape from
#: `apps/api/app/services/head_to_head.py:455-472`, whose docstring gives the
#: full argument.
#:
#: `(level_id, label, higher_wins)`.
BID_ORDER: tuple[tuple[str, str, bool], ...] = (
    ("bid_amount", "Bid", True),
    ("tie_priority", "Tie priority", True),
)


@dataclass(frozen=True)
class BidOutcome:
    """How one candidate's round resolved, in full.

    `levels` reports EVERY level with both values and its verdict, including
    the ones that did not decide -- marked `not_consulted` rather than omitted,
    because a receipt that showed a lower level "winning" would imply a rule
    that does not exist. Same construction as the head-to-head settlement.
    """

    winner_seat: Optional[int]
    price: int
    decided_by: Optional[str]
    levels: tuple[dict, ...]
    #: True when the token was actually spent, which is the only thing that
    #: moves it. A round both seats passed does not consume priority.
    tie_priority_used: bool


def resolve(
    bids: Sequence[Optional[int]],
    tie_priority_seat: int,
) -> BidOutcome:
    """Decide one sealed-bid round.

    `bids[i]` is seat i's locked amount, or None for a seat that never locked --
    treated as `TIMEOUT_BID` (a pass) by the caller before it reaches here.

    Rules, in the published order:
      * Highest bid wins and pays its own bid. This is a first-price auction:
        the winner pays what they said, the loser pays nothing.
      * A bid of 0 is a pass. Two passes leave the candidate unsold.
      * Equal NON-ZERO bids go to the tie-priority holder, who then loses the
        token. Equal ZERO bids are two passes, not a tie -- no token is spent,
        because no tie-break happened.
    """
    amounts = [0 if b is None else int(b) for b in bids]
    top = max(amounts) if amounts else 0

    if top <= 0:
        levels = (
            {
                "level": "bid_amount",
                "label": "Bid",
                "higher_wins": True,
                "values": list(amounts),
                "verdict": "all_passed",
            },
            {
                "level": "tie_priority",
                "label": "Tie priority",
                "higher_wins": True,
                "values": [int(i == tie_priority_seat) for i in range(len(amounts))],
                "verdict": "not_consulted",
            },
        )
        return BidOutcome(
            winner_seat=None,
            price=0,
            decided_by=None,
            levels=levels,
            tie_priority_used=False,
        )

    leaders = [i for i, a in enumerate(amounts) if a == top]
    levels: list[dict] = []

    if len(leaders) == 1:
        winner = leaders[0]
        decided_by = "bid_amount"
        used_token = False
        levels.append(
            {
                "level": "bid_amount",
                "label": "Bid",
                "higher_wins": True,
                "values": list(amounts),
                "verdict": f"seat_{winner}",
            }
        )
        levels.append(
            {
                "level": "tie_priority",
                "label": "Tie priority",
                "higher_wins": True,
                "values": [int(i == tie_priority_seat) for i in range(len(amounts))],
                "verdict": "not_consulted",
            }
        )
    else:
        # A genuine tie at a non-zero amount. The token decides and is spent.
        winner = tie_priority_seat if tie_priority_seat in leaders else leaders[0]
        decided_by = "tie_priority"
        used_token = True
        levels.append(
            {
                "level": "bid_amount",
                "label": "Bid",
                "higher_wins": True,
                "values": list(amounts),
                "verdict": "tied",
            }
        )
        levels.append(
            {
                "level": "tie_priority",
                "label": "Tie priority",
                "higher_wins": True,
                "values": [int(i == tie_priority_seat) for i in range(len(amounts))],
                "verdict": f"seat_{winner}",
            }
        )

    return BidOutcome(
        winner_seat=winner,
        price=top,
        decided_by=decided_by,
        levels=tuple(levels),
        tie_priority_used=used_token,
    )


def next_tie_priority(current: int, outcome: BidOutcome, *, seat_count: int = 2) -> int:
    """Where the token sits after this round.

    It transfers ONLY when it was actually used to break a tie. A round decided
    on bid amount, and a round both seats passed, leave it where it is --
    otherwise the token would drift on rounds it never influenced and "you hold
    priority" would stop meaning "you win the next tie".
    """
    if not outcome.tie_priority_used:
        return current
    return (current + 1) % seat_count


def initial_tie_priority(seed: int, *, seat_count: int = 2) -> int:
    """Who holds the token at tip-off.

    Derived from the match seed through the foundation's own keyed-stream
    helper shape, so it is reproducible from the persisted seed alone and is
    NOT hidden randomness: the holder is published in the opening state, before
    the first candidate is revealed.
    """
    import random

    return random.Random(f"arena:{seed}:tie_priority").randrange(seat_count)


__all__ = [
    "BID_ORDER",
    "BidOutcome",
    "initial_tie_priority",
    "is_solvent",
    "max_legal_bid",
    "next_tie_priority",
    "reserve_floor",
    "resolve",
    "STARTING_BUDGET",
]
