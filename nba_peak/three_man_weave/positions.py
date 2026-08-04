"""HARD PG/SG/SF/PF/C legality for THREE-MAN WEAVE.

THIS IS NEW LOGIC, NOT A WRAPPER
---------------------------------
CourtBuilder's position model is explicitly soft. Its own docstring says so:
"Placement legality is NOT determined here -- this function is purely for
display/fit-feedback purposes. Every slot accepts every player"
(nba_peak/perfect_season/positions.py:423-425). A misplaced starter there
costs fit points, never legality.

Three-Man Weave is a draft, and a draft needs a hard rule: you may not put
Shaquille O'Neal at small forward, so the position you still need shapes who
is worth taking. That rule is built HERE, on top of the same real data
CourtBuilder derives its labels from, without changing CourtBuilder.

THE SOURCE OF TRUTH IS `career_positions`
------------------------------------------
`nba_peak.perfect_season.career_positions.career_positions(slug)` returns the
set of positions a player logged real, gated NBA minutes at (>= 20 games and
>= 500 season minutes), unioned with the curated POSITION_OVERRIDES and
FLEXIBLE_FORWARD_SLUGS supplements. Career-grain, not season-grain, and that
is the right grain for a draft: a player is drafted as an identity, so "can
LeBron James play point guard" must have one answer, not one answer per
season.

SLUG VARIANTS ARE LOAD-BEARING
-------------------------------
Two slug spellings coexist in this repo -- data-derived `shaquille-o-neal`
versus hand-written `shaquille-oneal` -- along with `amar-e-`/`amare-`,
`de-aaron-`/`deaaron-` and `p-j-`/`pj-`. Every lookup in this module goes
through `career_positions.slug_variants` (career_positions.py:98-115), either
directly or via `career_positions()` which resolves variants itself. A lookup
that skips it silently returns "no positions" for exactly the players the
variant table exists to protect, and a player with no positions is illegal
everywhere -- a silent, total exclusion.

BENCH
-----
The single bench slot accepts any player with a recognized canonical
position. It is not position-restricted (that is the point of a bench), but
it is not a dumping ground for an identity we have no position data for
either: an identity with no canonical position is illegal everywhere,
including the bench, and `eligibility` must never offer one.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Optional, Sequence

from nba_peak.perfect_season.career_positions import career_positions, slug_variants
from nba_peak.three_man_weave.config import (
    BENCH_SLOT_TYPES,
    POSITION_LEGALITY_VERSION,
    SLOT_TYPES,
    STARTER_SLOT_TYPES,
)
from nba_peak.three_man_weave.matching import find_assignment, has_perfect_matching

# The five real position tokens. Anything else in the source data (the single
# bare "F" row, nulls) is not a position we will place a player at -- never
# guessed into SF or PF.
POSITION_TOKENS: frozenset[str] = frozenset(STARTER_SLOT_TYPES)


class IllegalPlacement(ValueError):
    """A placement or repositioning that hard position legality forbids.

    Carries a machine-readable `code` so the platform layer can map it to a
    response without string-matching the message.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def canonical_positions(player_slug: str | None) -> frozenset[str]:
    """The positions this identity may legally start at.

    Empty frozenset means "no position data", which makes the player illegal
    everywhere including the bench. Callers must treat empty as a data gap to
    exclude on, never as "plays nowhere in particular, so put them anywhere".
    """
    if not player_slug:
        return frozenset()
    return frozenset(career_positions(player_slug)) & POSITION_TOKENS


def has_canonical_position(player_slug: str | None) -> bool:
    return bool(canonical_positions(player_slug))


def normalize_slug(player_slug: str | None, known: Iterable[str]) -> Optional[str]:
    """Resolve `player_slug` to whichever spelling `known` actually uses.

    The bridge between an incoming slug and any structure keyed on the other
    convention. Returns None when no variant is known, so a caller can reject
    an unrecognized identity rather than proceeding with a slug that will
    silently miss every lookup.
    """
    if not player_slug:
        return None
    known_set = set(known)
    for variant in slug_variants(player_slug):
        if variant in known_set:
            return variant
    return None


def legal_slots(player_slug: str | None) -> frozenset[str]:
    """Every slot type this identity may legally occupy.

    Their canonical positions, plus the bench slots -- but only if they have
    a canonical position at all.
    """
    positions = canonical_positions(player_slug)
    if not positions:
        return frozenset()
    return positions | frozenset(BENCH_SLOT_TYPES)


def is_legal(player_slug: str | None, slot_type: str) -> bool:
    """May this identity occupy this slot? The single hard-legality predicate."""
    return slot_type in legal_slots(player_slug)


def legal_players_for_slot(slot_type: str, player_slugs: Iterable[str]) -> tuple[str, ...]:
    """Those of `player_slugs` that may legally occupy `slot_type`, order preserved."""
    return tuple(slug for slug in player_slugs if is_legal(slug, slot_type))


# ---------------------------------------------------------------------------
# Roster-level legality
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RosterCheck:
    """The outcome of validating a whole roster assignment."""

    ok: bool
    code: Optional[str] = None
    message: Optional[str] = None
    legality_version: str = POSITION_LEGALITY_VERSION


def _ok() -> RosterCheck:
    return RosterCheck(ok=True)


def _fail(code: str, message: str) -> RosterCheck:
    return RosterCheck(ok=False, code=code, message=message)


def validate_roster(assignment: Mapping[str, Optional[str]]) -> RosterCheck:
    """Validate a slot -> player_slug assignment as a whole.

    Whole-assignment rather than per-placement, which is what makes
    "repositioning must never produce a temporarily OR finally illegal
    roster" enforceable: a move is validated against the roster it WOULD
    produce, so there is no intermediate state to be illegal in. A partial
    roster (unfilled slots mapped to None, or simply absent) is fine -- this
    checks what is filled, and `can_complete_roster` checks what remains.
    """
    for slot_type in assignment:
        if slot_type not in SLOT_TYPES:
            return _fail("unknown_slot", f"'{slot_type}' is not a roster slot")

    seen: dict[str, str] = {}
    for slot_type, player_slug in assignment.items():
        if player_slug is None:
            continue
        if player_slug in seen:
            return _fail(
                "duplicate_player",
                f"'{player_slug}' is assigned to both {seen[player_slug]} and {slot_type}",
            )
        seen[player_slug] = slot_type
        if not is_legal(player_slug, slot_type):
            positions = sorted(canonical_positions(player_slug))
            played = ", ".join(positions) if positions else "no recognized position"
            return _fail(
                "illegal_slot",
                f"'{player_slug}' cannot play {slot_type} ({played})",
            )
    return _ok()


def apply_reposition(
    assignment: Mapping[str, Optional[str]],
    slot_a: str,
    slot_b: str,
) -> dict[str, Optional[str]]:
    """The roster produced by swapping whatever occupies `slot_a` and `slot_b`.

    Raises `IllegalPlacement` if the RESULT would be illegal, and returns a
    new dict otherwise -- the input is never mutated. Moving a player into an
    empty slot is the same operation with `None` on one side.

    This is the only sanctioned way to reposition: it computes the outcome,
    validates the outcome, and commits the outcome or nothing at all. There
    is no window in which a caller holds a half-applied, illegal roster.
    """
    for slot_type in (slot_a, slot_b):
        if slot_type not in SLOT_TYPES:
            raise IllegalPlacement("unknown_slot", f"'{slot_type}' is not a roster slot")

    proposed = dict(assignment)
    proposed[slot_a] = assignment.get(slot_b)
    proposed[slot_b] = assignment.get(slot_a)

    check = validate_roster(proposed)
    if not check.ok:
        raise IllegalPlacement(check.code or "illegal_roster", check.message or "illegal roster")
    return proposed


def can_complete_roster(
    assignment: Mapping[str, Optional[str]],
    available_slugs: Sequence[str],
) -> bool:
    """Could every still-empty slot be filled legally from `available_slugs`?

    A real matching question, not a count: three available centers cannot
    fill PG, SG and C no matter that three is enough players. Answered by
    `matching.has_perfect_matching` over (empty slots) x (available players).
    """
    empty = [slot for slot in SLOT_TYPES if assignment.get(slot) is None]
    if not empty:
        return True
    taken = {slug for slug in assignment.values() if slug is not None}
    pool = [slug for slug in available_slugs if slug not in taken]
    adjacency = {slot: legal_players_for_slot(slot, pool) for slot in empty}
    return has_perfect_matching(empty, adjacency)


def completion_witness(
    assignment: Mapping[str, Optional[str]],
    available_slugs: Sequence[str],
) -> Optional[dict[str, str]]:
    """A concrete legal completion of the empty slots, or None if impossible.

    The witness `can_complete_roster` proves the existence of. Returned so a
    caller that needs to SHOW a completion (auto-pick, a hint) uses the same
    one that proved feasibility instead of recomputing a possibly different
    answer.
    """
    empty = [slot for slot in SLOT_TYPES if assignment.get(slot) is None]
    if not empty:
        return {}
    taken = {slug for slug in assignment.values() if slug is not None}
    pool = [slug for slug in available_slugs if slug not in taken]
    adjacency = {slot: legal_players_for_slot(slot, pool) for slot in empty}
    return find_assignment(empty, adjacency)


def open_slots(assignment: Mapping[str, Optional[str]]) -> tuple[str, ...]:
    """Still-empty slots, in canonical SLOT_TYPES order."""
    return tuple(slot for slot in SLOT_TYPES if assignment.get(slot) is None)


def empty_roster() -> dict[str, Optional[str]]:
    """A fresh, fully-empty roster keyed by every slot type."""
    return {slot: None for slot in SLOT_TYPES}


__all__ = [
    "POSITION_TOKENS",
    "IllegalPlacement",
    "RosterCheck",
    "apply_reposition",
    "can_complete_roster",
    "canonical_positions",
    "completion_witness",
    "empty_roster",
    "has_canonical_position",
    "is_legal",
    "legal_players_for_slot",
    "legal_slots",
    "normalize_slug",
    "open_slots",
    "validate_roster",
]
