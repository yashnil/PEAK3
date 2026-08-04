"""Roll feasibility: prove a franchise x decade combination is playable BEFORE revealing it.

THE RULE
--------
A roll is revealed only if all five of these hold. Any failure means the
combination is rejected silently and another is drawn -- the player never sees
a roll they cannot play.

  1. The franchise actually existed in that decade (the eligibility index has
     a non-empty entry for it).
  2. At least `MIN_ELIGIBLE_FOR_ROLL` DISTINCT UNDRAFTED eligible identities
     remain.
  3. EVERY participant has at least one legal selection -- legal meaning the
     identity fits one of THAT seat's still-open slots, not merely that they
     are undrafted.
  4. Three DISTINCT legal selections can be assigned, one per seat, for this
     round.
  5. After that round is played, all three rosters can still be completed
     from the identities that remain.

WHY COUNTING IS NOT ENOUGH
---------------------------
Checks 3-5 are matching problems and are solved by matching (see
`matching.py`), never by a candidate-count shortcut. "Eight eligible players
remain, and we need three, so we are fine" is false whenever eligibility is
positionally constrained: eight centers cannot fill three seats that each
need a point guard. The count is satisfied and the round is unplayable.
Bulls x 1990s late in a match is exactly this shape -- a small, heavily
position-skewed pool that a count would wave through.

Check 5 is the one that prevents a match from dead-ending several rounds
later rather than immediately. It is a single global matching over EVERY
still-open slot across ALL THREE rosters against the shared undrafted pool,
which is what makes it exact with respect to the global identity lock: two
seats cannot both be promised the same last remaining centre.
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Mapping, Optional, Sequence

from nba_peak.franchises import franchise_display_name
from nba_peak.three_man_weave.config import MAX_ROLL_ATTEMPTS, MIN_ELIGIBLE_FOR_ROLL
from nba_peak.three_man_weave.eligibility import EligibilityIndex
from nba_peak.three_man_weave.matching import find_assignment, has_perfect_matching
from nba_peak.three_man_weave.positions import is_legal, legal_players_for_slot
from nba_peak.three_man_weave.schemas import Roll, Roster

# Rejection codes, in the order the checks run. Machine-readable so the
# platform layer can report why the roll space narrowed without string
# matching, and so tests can assert on the specific failure rather than just
# "rejected".
REJECT_NO_SUCH_ROLL = "franchise_absent_in_decade"
REJECT_TOO_FEW_ELIGIBLE = "too_few_undrafted_eligible"
REJECT_SEAT_HAS_NO_LEGAL_PICK = "seat_has_no_legal_pick"
REJECT_NO_DISTINCT_ASSIGNMENT = "no_distinct_legal_assignment"
REJECT_CANNOT_COMPLETE_MATCH = "match_cannot_complete"
REJECT_ALREADY_USED = "roll_already_used"


@dataclass(frozen=True)
class RollFeasibility:
    """Why a franchise x decade combination is or is not playable right now."""

    ok: bool
    franchise_id: str
    decade: str
    reason: Optional[str] = None
    undrafted_eligible: tuple[str, ...] = ()
    # A concrete witness assignment seat_index -> player_slug, proving check 4.
    # Kept so a caller can show or reuse the proof rather than recomputing a
    # possibly different one.
    witness: Optional[dict[int, str]] = None

    def as_dict(self) -> dict:
        return {
            "ok": self.ok,
            "franchise_id": self.franchise_id,
            "decade": self.decade,
            "reason": self.reason,
            "undrafted_eligible_count": len(self.undrafted_eligible),
            "witness": dict(self.witness) if self.witness else None,
        }


def legal_choices_for_seat(roster: Roster, candidates: Sequence[str]) -> tuple[str, ...]:
    """Those candidates that fit at least one of THIS roster's open slots.

    Not "undrafted", not "has a position" -- fits a slot this particular seat
    still has open. A seat holding only C open has no legal choice among a
    pool of guards, however large the pool.
    """
    open_slots = roster.open_slots()
    return tuple(
        slug for slug in candidates if any(is_legal(slug, slot) for slot in open_slots)
    )


def can_fill_open_slots(
    open_slots_by_seat: Mapping[int, Sequence[str]],
    available_slugs: Sequence[str],
) -> bool:
    """Can EVERY listed open slot, across ALL seats, be filled from one shared pool?

    One global matching rather than per-seat checks, because the identity
    lock is global: two seats each needing the same single remaining centre
    both pass in isolation and fail together. Left nodes are (seat, slot)
    pairs; a perfect matching on the left is the requirement.

    Takes open slots rather than `Roster` objects so a caller can ask the
    question about a HYPOTHETICAL roster ("what if this seat used its PG slot
    on this pick?") without constructing a roster containing a pick that has
    not happened.
    """
    left: list[tuple[int, str]] = [
        (seat_index, slot)
        for seat_index, slots in sorted(open_slots_by_seat.items())
        for slot in slots
    ]
    if not left:
        return True
    pool = list(available_slugs)
    adjacency = {node: legal_players_for_slot(node[1], pool) for node in left}
    return has_perfect_matching(left, adjacency)


def can_complete_all_rosters(
    rosters: Sequence[Roster],
    available_slugs: Sequence[str],
) -> bool:
    """`can_fill_open_slots` for real rosters -- can every seat still finish?"""
    return can_fill_open_slots(
        {roster.seat_index: roster.open_slots() for roster in rosters}, available_slugs
    )


def _round_is_playable(
    rosters: Sequence[Roster],
    candidates: Sequence[str],
    undrafted_pool: Sequence[str],
) -> tuple[bool, Optional[dict[int, str]]]:
    """Checks 4 and 5 together: can this round be played AND the match finish?

    Returns `(ok, witness)`. The two checks are done together rather than in
    sequence because they interact: a round assignment that is legal in
    isolation can be the one that strands a later roster, so a witness is
    only accepted if the match still completes after it.

    The search is small and bounded by construction: three seats, each
    choosing one candidate and one of at most six slots. The slot choice
    genuinely matters -- placing a versatile player at PG rather than SG can
    be the difference between a completable and a stranded roster -- so it is
    enumerated rather than fixed by a first-fit rule.
    """
    seats = list(rosters)
    adjacency = {
        roster.seat_index: legal_choices_for_seat(roster, candidates) for roster in seats
    }
    assignment = find_assignment([roster.seat_index for roster in seats], adjacency)
    if assignment is None:
        return False, None

    taken = set(assignment.values())
    remaining_pool = [slug for slug in undrafted_pool if slug not in taken]

    # Enumerate which open slot each seat would use for its assigned pick.
    per_seat_slots: list[list[str]] = []
    for roster in seats:
        slug = assignment[roster.seat_index]
        options = [slot for slot in roster.open_slots() if is_legal(slug, slot)]
        if not options:  # pragma: no cover - find_assignment guarantees one
            return False, None
        per_seat_slots.append(options)

    for combo in product(*per_seat_slots):
        # The hypothetical is expressed purely as "which slots would still be
        # open", so no DraftPick is ever fabricated for a pick that has not
        # happened.
        hypothetical = {
            roster.seat_index: tuple(slot for slot in roster.open_slots() if slot != used)
            for roster, used in zip(seats, combo)
        }
        if can_fill_open_slots(hypothetical, remaining_pool):
            return True, assignment
    return False, None


def evaluate_roll(
    franchise_id: str,
    decade: str,
    index: EligibilityIndex,
    rosters: Sequence[Roster],
    drafted_slugs: frozenset[str],
    used_roll_ids: frozenset[str] = frozenset(),
) -> RollFeasibility:
    """Run all five checks against a candidate franchise x decade combination."""
    roll_id = f"{franchise_id.lower()}-{decade}"

    def reject(reason: str, undrafted: tuple[str, ...] = ()) -> RollFeasibility:
        return RollFeasibility(
            ok=False,
            franchise_id=franchise_id,
            decade=decade,
            reason=reason,
            undrafted_eligible=undrafted,
        )

    if roll_id in used_roll_ids:
        return reject(REJECT_ALREADY_USED)

    eligible = index.eligible_slugs(franchise_id, decade)
    if not eligible:
        return reject(REJECT_NO_SUCH_ROLL)

    # Sorted, so the candidate list -- and therefore every matching built from
    # it -- does not depend on set iteration order.
    undrafted = tuple(sorted(eligible - drafted_slugs))
    if len(undrafted) < MIN_ELIGIBLE_FOR_ROLL:
        return reject(REJECT_TOO_FEW_ELIGIBLE, undrafted)

    for roster in rosters:
        if not legal_choices_for_seat(roster, undrafted):
            return reject(REJECT_SEAT_HAS_NO_LEGAL_PICK, undrafted)

    global_pool = _global_undrafted(index, drafted_slugs)
    ok, witness = _round_is_playable(rosters, undrafted, global_pool)
    if not ok:
        # Distinguish "this round cannot be dealt" from "it can, but it
        # strands the match" -- different rejections, and the difference
        # matters when auditing why a roll space narrowed.
        adjacency = {
            roster.seat_index: legal_choices_for_seat(roster, undrafted) for roster in rosters
        }
        dealt = find_assignment([roster.seat_index for roster in rosters], adjacency)
        reason = (
            REJECT_CANNOT_COMPLETE_MATCH if dealt is not None else REJECT_NO_DISTINCT_ASSIGNMENT
        )
        return reject(reason, undrafted)

    return RollFeasibility(
        ok=True,
        franchise_id=franchise_id,
        decade=decade,
        undrafted_eligible=undrafted,
        witness=witness,
    )


def _global_undrafted(index: EligibilityIndex, drafted_slugs: frozenset[str]) -> tuple[str, ...]:
    """Every still-undrafted identity anywhere in the index, sorted.

    The pool a later roll could draw from. Sorted for determinism.
    """
    everyone: set[str] = set()
    for roll in index.rolls():
        everyone |= index.eligible_slugs(*roll)
    return tuple(sorted(everyone - drafted_slugs))


def feasible_rolls(
    index: EligibilityIndex,
    rosters: Sequence[Roster],
    drafted_slugs: frozenset[str],
    used_roll_ids: frozenset[str] = frozenset(),
) -> tuple[RollFeasibility, ...]:
    """Every currently-playable roll, in stable sorted order.

    Used by the roller and by tests that want to count the live roll space.
    """
    out: list[RollFeasibility] = []
    for franchise_id, decade in index.rolls():
        result = evaluate_roll(
            franchise_id, decade, index, rosters, drafted_slugs, used_roll_ids
        )
        if result.ok:
            out.append(result)
    return tuple(out)


def roll_next(
    index: EligibilityIndex,
    rosters: Sequence[Roster],
    drafted_slugs: frozenset[str],
    round_number: int,
    rng,
    used_roll_ids: frozenset[str] = frozenset(),
) -> Optional[Roll]:
    """Draw one playable franchise x decade roll, or None if none exists.

    Candidates are drawn WITHOUT replacement from a shuffled copy of the
    whole roll space and validated one at a time, so an invalid combination
    is rejected before it is ever revealed rather than being shown and then
    retracted.

    A roll already used in this match is skipped -- until the validated space
    is genuinely exhausted, at which point repeats are allowed rather than
    dead-ending the match. That fallback is a real second pass over the same
    space with `used_roll_ids` dropped, not a relaxation of any of the five
    feasibility checks: a repeated roll is still fully validated.
    """
    space = list(index.rolls())
    rng.shuffle(space)

    for franchise_id, decade in space[:MAX_ROLL_ATTEMPTS]:
        result = evaluate_roll(
            franchise_id, decade, index, rosters, drafted_slugs, used_roll_ids
        )
        if result.ok:
            return _to_roll(result, round_number)

    if used_roll_ids:
        for franchise_id, decade in space[:MAX_ROLL_ATTEMPTS]:
            result = evaluate_roll(franchise_id, decade, index, rosters, drafted_slugs)
            if result.ok:
                return _to_roll(result, round_number)
    return None


def _to_roll(result: RollFeasibility, round_number: int) -> Roll:
    return Roll(
        round_number=round_number,
        franchise_id=result.franchise_id,
        franchise_display_name=franchise_display_name(result.franchise_id) or result.franchise_id,
        decade=result.decade,
        eligible_slugs=result.undrafted_eligible,
    )


__all__ = [
    "REJECT_ALREADY_USED",
    "REJECT_CANNOT_COMPLETE_MATCH",
    "REJECT_NO_DISTINCT_ASSIGNMENT",
    "REJECT_NO_SUCH_ROLL",
    "REJECT_SEAT_HAS_NO_LEGAL_PICK",
    "REJECT_TOO_FEW_ELIGIBLE",
    "RollFeasibility",
    "can_complete_all_rosters",
    "evaluate_roll",
    "feasible_rolls",
    "legal_choices_for_seat",
    "roll_next",
]
