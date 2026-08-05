"""Budget arithmetic and the ascending-auction step rules.

Every rule in this module is integer arithmetic over whole dollars. That is a
correctness requirement, not a style choice: an auction compared with floats
would let a "$7" raise land a thousandth of a dollar under the standing bid and
be refused for no reason a player could see. Money here is `int` from the
request boundary to the receipt.

WHAT LEFT IN v2, AND WHY IT LEFT
---------------------------------
v1 was a sealed-bid auction: both seats submitted a hidden amount, the higher
took the player, and EQUAL amounts were broken by a one-shot `tie_priority`
token. v2 bids sequentially -- one seat acts, then the other, each seeing the
standing bid -- so two equal top bids are not reachable: to match the standing
bid you would have to raise to it, and a raise must clear it by at least
`MIN_RAISE`. A tie-break for a state that cannot occur is a rule readers have
to learn and nobody can ever use, so `resolve`, `BID_ORDER`, `BidOutcome`,
`initial_tie_priority` and `next_tie_priority` are gone rather than kept
alongside. `state.py` is the only caller of what remains.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.twenty_dollar.config import (
    MIN_OPENING_BID,
    MIN_RAISE,
    MIN_RESERVE_PER_SLOT,
    ROSTER_SIZE,
    STARTING_BUDGET,
)

# ---------------------------------------------------------------------------
# Budget
# ---------------------------------------------------------------------------


def max_legal_bid(budget: int, filled_slots: int, *, roster_size: int = ROSTER_SIZE) -> int:
    """The most this seat may commit to the lot in front of them.

    THE RESERVE RULE. Every slot that will still be unfilled AFTER this
    purchase must remain affordable, at `MIN_RESERVE_PER_SLOT` dollars each:

        slots_open_after = roster_size - filled_slots - 1
        max_bid          = budget - slots_open_after * MIN_RESERVE_PER_SLOT

    Worked, using the brief's own example: a seat holding $20 with five empty
    slots has `filled_slots = 0`, so `slots_open_after = 5 - 0 - 1 = 4` and
    `max_bid = 20 - 4 = 16`. Winning at $16 leaves $4 for the four remaining
    slots, which is exactly the floor rather than a dollar under it.

    Why the reserve is enforced on the SERVER and never read from a request:
    the client's copy of a budget is a display, and a raise of "all of it" that
    happened to arrive after a concurrent state change would otherwise buy a
    roster that cannot be completed. `state.submit_action` clamps against this
    function; there is no request field that can disagree with it.

    Never negative. A seat whose budget has somehow fallen below its own
    reserve floor can still pass, which is always legal.
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
# The ascending step
# ---------------------------------------------------------------------------


def minimum_bid(current_bid: int) -> int:
    """The smallest amount the seat on the clock may name.

    `MIN_OPENING_BID` when the lot has no live bid, and `current_bid +
    MIN_RAISE` once it does. Written once here rather than at each call site,
    because a UI that computed its own floor and a server that computed
    another is exactly how a "Bid $4" button starts producing `bid_too_low`.
    """
    if current_bid <= 0:
        return MIN_OPENING_BID
    return int(current_bid) + MIN_RAISE


def can_afford_minimum(
    budget: int, filled_slots: int, current_bid: int, *, roster_size: int = ROSTER_SIZE
) -> bool:
    """Is there any legal bid left for this seat on this lot?

    False means the ONLY move available is a pass -- which the projection has
    to be able to say out loud, because a disabled bid button with no reason
    beside it reads as a broken control rather than as a rule.
    """
    return minimum_bid(current_bid) <= max_legal_bid(
        budget, filled_slots, roster_size=roster_size
    )


def is_whole_dollars(amount: object) -> bool:
    """Whole-dollar integer, and NOT a bool.

    `bool` is a subclass of `int` and `True` would otherwise slip through as a
    one-dollar bid -- a real defect this check exists to stop, kept from v1
    where it was found.
    """
    return isinstance(amount, int) and not isinstance(amount, bool)


__all__ = [
    "MIN_OPENING_BID",
    "MIN_RAISE",
    "MIN_RESERVE_PER_SLOT",
    "STARTING_BUDGET",
    "can_afford_minimum",
    "is_solvent",
    "is_whole_dollars",
    "max_legal_bid",
    "minimum_bid",
    "reserve_floor",
]


#: Kept only so a caller that imported this symbol gets a clear failure rather
#: than a silent behaviour change. Removed entirely once nothing references it.
_RETIRED_IN_V2: tuple[str, ...] = (
    "BID_ORDER",
    "BidOutcome",
    "initial_tie_priority",
    "next_tie_priority",
    "resolve",
)


def __getattr__(name: str) -> Optional[object]:  # pragma: no cover - guard rail
    if name in _RETIRED_IN_V2:
        raise AttributeError(
            f"{name!r} was part of the v1 sealed-bid auction and was removed in "
            f"{'twenty_dollar_v2'!r}. Sequential bidding makes ties unreachable, so "
            "there is no tie-break and no simultaneous resolution. See "
            "nba_peak/twenty_dollar/state.py for the ascending state machine."
        )
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
