"""Position feasibility: can this roster still be completed, legally?

WHY THIS IS NOT A COUNTING HEURISTIC
------------------------------------
The tempting cheap check is "does this player fit a slot I have not filled?".
It is wrong, and wrong in the direction that strands a player mid-match.

Worked counterexample, using real position sets from the committed data. A seat
owns Shaquille O'Neal (`{C}`) and holds four empty slots PG/SG/SF/PF. A
candidate appears whose set is `{C}` as well. The cheap check asks "is C
unfilled?" -- C is taken, so it says no, correctly by accident. Now flip it: the
seat owns Nikola Jokic (`{C, PF}`) and a candidate is `{PF}`. The cheap check
says "PF is unfilled, take it" -- and it is right only because Jokic can slide
to C. If the seat had ALSO owned a `{C}`-only player, Jokic would be pinned at
PF and the candidate would strand the roster. A per-slot occupancy flag cannot
see that, because the question is not "is this slot free" but "does a legal
assignment of EVERY player I will own to DISTINCT slots exist".

That is a bipartite matching question, so it is answered with bipartite
matching.

TWO CONDITIONS, BOTH REQUIRED
-----------------------------
A roster is completable iff:

  A. IMMEDIATE. The players already owned can be assigned to distinct slots.
     Multi-position players are free to rearrange -- an assignment is recomputed
     from scratch every time, never incrementally patched, so a player is never
     stuck in a slot an earlier round happened to put them in.

  B. FUTURE. The slots left over under SOME valid assignment from (A) can each
     be filled by a DISTINCT player still available in the pool.

(B) is what the brief means by "validate future completion, not just immediate
fit", and it is checked against a system of distinct representatives rather
than against per-slot counts: five slots each having "at least one eligible
player available" is NOT sufficient if it is the same one player five times.

EXACTNESS OVER CLEVERNESS
-------------------------
Both conditions are decided by exhaustive enumeration, not by an approximation.
The problem is tiny and fixed -- five slots, forever -- so the assignment search
visits at most 5! = 120 arrangements and Hall's condition at most 2^5 = 32
subsets. An exact answer at that size costs microseconds, and a feasibility
check that is "usually right" would produce a stranded roster that no error
message could explain.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import permutations
from typing import Iterable, Optional, Sequence

from nba_peak.twenty_dollar.config import SLOTS


@dataclass(frozen=True)
class RosterFit:
    """The outcome of a feasibility question, with enough detail to explain it.

    `assignment` maps slot -> player_slug for one valid arrangement. It is ONE
    valid arrangement, not the arrangement: a multi-position roster generally
    has several and the model does not claim any is canonical. It exists so the
    UI can show a lineup, never so a rule can depend on a particular one.
    """

    feasible: bool
    assignment: dict[str, str]
    open_slots: tuple[str, ...]
    #: Set only when infeasible. Names the condition that failed, so a refusal
    #: is diagnosable rather than a bare "illegal".
    reason: Optional[str] = None


def _position_sets(
    owned: Sequence[tuple[str, frozenset[str]]]
) -> list[tuple[str, frozenset[str]]]:
    return [(slug, frozenset(pos) & frozenset(SLOTS)) for slug, pos in owned]


def valid_assignments(
    owned: Sequence[tuple[str, frozenset[str]]]
) -> list[dict[str, str]]:
    """Every way to seat these players in distinct slots.

    Exhaustive over slot permutations. Returns an empty list when no legal
    seating exists, which is condition (A) failing.
    """
    players = _position_sets(owned)
    if len(players) > len(SLOTS):
        return []
    out: list[dict[str, str]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()
    for slot_choice in permutations(SLOTS, len(players)):
        assignment: dict[str, str] = {}
        ok = True
        for (slug, positions), slot in zip(players, slot_choice):
            if slot not in positions:
                ok = False
                break
            assignment[slot] = slug
        if not ok:
            continue
        key = tuple(sorted(assignment.items()))
        if key in seen:
            continue
        seen.add(key)
        out.append(assignment)
    return out


_SLOT_BIT: dict[str, int] = {slot: 1 << i for i, slot in enumerate(SLOTS)}


def _mask(positions: Iterable[str]) -> int:
    out = 0
    for position in positions:
        out |= _SLOT_BIT.get(position, 0)
    return out


class PositionSupply:
    """How many still-available players cover each combination of slots.

    A HISTOGRAM, NOT A LIST, and that is a performance requirement rather than
    a tidiness one. `_covers` is called once per candidate per seat per round --
    around two thousand times against a thousand-player pool -- and the naive
    form rescans every available player for every one of Hall's subsets. That is
    tens of millions of set intersections per round, inside a function the
    foundation calls while holding the match's row lock (`MatchReducer`
    constraint 1: a slow reducer is every concurrent match's problem).

    There are only five slots, so a player's eligibility is one of at most 31
    non-empty bitmasks. Counting players per mask collapses the inner scan from
    "every player" to "every distinct mask", and the whole check becomes a few
    hundred integer operations regardless of pool size.
    """

    __slots__ = ("_counts", "_total")

    def __init__(self, position_sets: Iterable[Iterable[str]] = ()) -> None:
        self._counts: dict[int, int] = {}
        self._total = 0
        for positions in position_sets:
            mask = _mask(positions)
            if not mask:
                continue
            self._counts[mask] = self._counts.get(mask, 0) + 1
            self._total += 1

    def without(self, positions: Iterable[str]) -> "PositionSupply":
        """This supply minus one player with exactly these positions.

        Used to answer "if I buy them, can I still finish?" -- the acquired
        player must not also be counted as a future filler for a different
        slot, which is the off-by-one that makes an optimistic check strand a
        seat.
        """
        mask = _mask(positions)
        clone = PositionSupply()
        clone._counts = dict(self._counts)
        clone._total = self._total
        if clone._counts.get(mask):
            clone._counts[mask] -= 1
            clone._total -= 1
            if clone._counts[mask] == 0:
                del clone._counts[mask]
        return clone

    def covers(self, slots: tuple[str, ...]) -> bool:
        """Hall's condition: do `slots` have a system of distinct representatives?

        For every non-empty subset S of the open slots, the number of DISTINCT
        available players eligible for at least one slot in S must be at least
        |S|. That is exactly the condition that fails when five open slots are
        all served by the same one player, which a per-slot count would pass.
        """
        if not slots:
            return True
        if self._total < len(slots):
            return False
        bits = [_SLOT_BIT[s] for s in slots]
        n = len(bits)
        for combo in range(1, 1 << n):
            subset_mask = 0
            size = 0
            for i in range(n):
                if combo & (1 << i):
                    subset_mask |= bits[i]
                    size += 1
            eligible = 0
            for mask, count in self._counts.items():
                if mask & subset_mask:
                    eligible += count
                    if eligible >= size:
                        break
            if eligible < size:
                return False
        return True

    def __len__(self) -> int:
        return self._total


def _as_supply(available) -> PositionSupply:
    """Accept either a prebuilt supply or a raw sequence of position sets."""
    return available if isinstance(available, PositionSupply) else PositionSupply(available)


def evaluate(
    owned: Sequence[tuple[str, frozenset[str]]],
    available=(),
    *,
    require_future: bool = True,
) -> RosterFit:
    """Can this roster be seated now, and completed later?

    `owned` is `(player_slug, positions)` for every player already acquired.
    `available` is the position set of every player still acquirable -- used
    only for condition (B), and only for the slots that would remain open.

    `require_future=False` answers condition (A) alone. That is the right
    question for a roster that is already full, where there is no future to
    validate, and for tests that want the two conditions separated.
    """
    supply = _as_supply(available) if require_future else None
    arrangements = valid_assignments(owned)
    if not arrangements:
        return RosterFit(
            feasible=False,
            assignment={},
            open_slots=(),
            reason="no_legal_seating",
        )

    fallback: Optional[RosterFit] = None
    for assignment in arrangements:
        open_slots = tuple(s for s in SLOTS if s not in assignment)
        if supply is None or supply.covers(open_slots):
            return RosterFit(feasible=True, assignment=assignment, open_slots=open_slots)
        if fallback is None:
            fallback = RosterFit(
                feasible=False,
                assignment=assignment,
                open_slots=open_slots,
                reason="open_slots_unfillable",
            )
    # Every seating leaves slots the remaining pool cannot cover with distinct
    # players. Report one of them so the failure names real slots.
    return fallback or RosterFit(
        feasible=False, assignment={}, open_slots=(), reason="open_slots_unfillable"
    )


def can_acquire(
    owned: Sequence[tuple[str, frozenset[str]]],
    candidate_positions: frozenset[str],
    available_after=(),
    *,
    roster_size: int = len(SLOTS),
) -> bool:
    """Would taking this candidate leave a completable roster?

    `available_after` must EXCLUDE the candidate itself -- they are being
    acquired, so they are no longer available to fill a different slot. Passing
    the pre-acquisition pool here would let a candidate be double-counted as
    both the purchase and the future filler, which is precisely the
    off-by-one that makes an optimistic feasibility check strand a seat.
    """
    if len(owned) >= roster_size:
        return False
    prospective = list(owned) + [("__candidate__", frozenset(candidate_positions))]
    return evaluate(prospective, available_after).feasible


def open_slots_for(owned: Sequence[tuple[str, frozenset[str]]]) -> tuple[str, ...]:
    """The slots still to fill under some valid seating, or all of them.

    Display helper. Returns `()` for a roster with no legal seating at all,
    because naming open slots for an already-broken roster would imply it is
    one purchase away from legal.
    """
    fit = evaluate(owned, (), require_future=False)
    return fit.open_slots if fit.feasible else ()


def fillable_slots(
    owned: Sequence[tuple[str, frozenset[str]]],
    candidate_positions: frozenset[str],
) -> tuple[str, ...]:
    """Which open slots this candidate could actually occupy.

    Computed by trying the candidate in each slot and re-seating everyone from
    scratch, rather than by intersecting their positions with a static list of
    empty slots. The difference is the Jokic case in the module docstring: a
    slot can look open and still be unusable because filling it pins a
    multi-position player out of a slot only they can cover.
    """
    out: list[str] = []
    for slot in SLOTS:
        if slot not in candidate_positions:
            continue
        prospective = list(owned) + [("__candidate__", frozenset({slot}))]
        if evaluate(prospective, (), require_future=False).feasible:
            out.append(slot)
    return tuple(out)
