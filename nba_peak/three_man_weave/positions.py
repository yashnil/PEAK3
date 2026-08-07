"""HARD PG/SG/SF/PF/C legality for THREE-MAN WEAVE.

LEGALITY IS SEASON-ANCHORED, AND THAT IS THE WHOLE POINT OF THIS MODULE
-----------------------------------------------------------------------
A player may start at a slot only when the player-SEASON that is actually on
the board supports it. Three-Man Weave drafts a franchise x decade CARD, and
that card names one exact season, so the season is always known -- there is no
case where the game has to guess.

WHY THE PREVIOUS CAREER-GRAIN RULE WAS WRONG. `career_positions` unions every
position a player ever logged gated minutes at. One anomalous season therefore
granted a position for the player's whole career:

    russell-westbrook -> {PG, SF}

Seventeen seasons listed PG; exactly one (2025-26, SAC, 64 games) listed SF.
Unioned, small forward became a legal STARTING slot for Westbrook on a 2010s
Thunder roster, and a bot duly started him there. That is not a rendering bug
and not a one-player data typo -- it is the grain of the rule being wrong, and
it applies to every player whose late career was relabelled.

THE RULE
--------
For a player drafted on the season `S`:

    listed   = the source's gated position for exactly (player, S)
    band(P)  = P plus its immediate neighbours on PG-SG-SF-PF-C
    starters = ( {listed} u career_positions(player) ) & band(listed)

`listed` alone would be too narrow: the committed source stores ONE token per
season, never Basketball-Reference's hyphenated "PG-SG", so a player whose 1996
row happens to say SG would be illegal at the SF he actually played. Career
evidence is therefore allowed to BROADEN the season -- but only within one step
of what that season actually says, so it can never carry a position across the
floor. Westbrook's PG season admits {PG, SG} and intersects to {PG}; Rodman's
1993-94 PF Spurs season admits {SF, PF, C} and keeps all three.

`starters` can never be empty: `listed` always survives its own band. That also
makes the rule strictly MORE permissive than the old one for identities the
career union had no data for at all.

When no season is known -- a display-only label outside a match -- callers ask
for `career_slot_rights` EXPLICITLY. There is no implicit fallback at that
level, because an implicit one is how the career grain leaked into legality in
the first place. The single narrow exception is `card_starter_positions`, for
the handful of seasons the source labels with the era's bare "F"; it is
documented, measured and pinned by a test.

RIGHTS ARE PASSED IN, NEVER LOOKED UP
--------------------------------------
Every legality predicate here takes a `rights` mapping (slug -> legal slot
types). It is built once per match state from the cards actually in play
(`draft.DraftState.slot_rights`) and threaded through matching, feasibility,
auto-pick and the bot. Nothing in this module reads a season itself, so there
is no code path that can silently answer a legality question with the wrong
grain.

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

THE TWO SOURCES, AND WHAT EACH IS FOR
--------------------------------------
`career_positions.listed_position(slug, season)` is the SEASON-grain source:
the one position token the committed data records for exactly that season,
behind the same >= 20 games / >= 500 minutes gate. It is what anchors legality.

`career_positions.career_positions(slug)` is the CAREER-grain source: every
position the player logged gated minutes at, unioned with the curated
POSITION_OVERRIDES and FLEXIBLE_FORWARD_SLUGS supplements. It is no longer
legality on its own -- it only ever BROADENS a season, and only inside that
season's band. CourtBuilder still uses it directly for soft fit labels, which
is why it is unchanged rather than replaced.

BENCH: an identity with no legal starting position is illegal everywhere,
including the bench -- a bench is not a dumping ground for a data gap.

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

The single bench slot accepts any player with a recognized position for the
card in play. It is not position-restricted -- that is the point of a bench.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Optional, Sequence  # noqa: F401  (SlotRights alias)

from nba_peak.perfect_season.career_positions import (
    career_positions,
    listed_position,
    slug_variants,
)
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


# ---------------------------------------------------------------------------
# Season-anchored rights -- the grain legality actually uses
# ---------------------------------------------------------------------------

#: The five starting positions in floor order. Adjacency is defined ON this
#: order, so "one step" means one position along the guard-to-centre spectrum
#: and nothing else. Do not reorder it to match a UI; the UI reads
#: `STARTER_SLOT_TYPES`.
POSITION_SPECTRUM: tuple[str, ...] = ("PG", "SG", "SF", "PF", "C")

#: slug -> the slot types that identity may legally occupy in ONE match.
SlotRights = Mapping[str, frozenset[str]]


def position_band(position: str | None) -> frozenset[str]:
    """A position plus its immediate neighbours on `POSITION_SPECTRUM`.

    The widest a single season's listed position is allowed to be broadened by
    career evidence. PG admits {PG, SG}; SF admits {SG, SF, PF}; C admits
    {PF, C}. Two steps is never allowed, which is exactly what stops a point
    guard reaching small forward.
    """
    if position not in POSITION_TOKENS:
        return frozenset()
    index = POSITION_SPECTRUM.index(position)
    lower = max(0, index - 1)
    upper = min(len(POSITION_SPECTRUM) - 1, index + 1)
    return frozenset(POSITION_SPECTRUM[lower : upper + 1])


def season_starter_positions(player_slug: str | None, season: str | None) -> frozenset[str]:
    """The starting positions this exact player-season may occupy.

    Empty only when the source gate-qualifies no position for that season --
    which callers must treat as a data gap to exclude on, never as "anywhere".
    """
    listed = listed_position(player_slug, season)
    if listed is None:
        return frozenset()
    return ({listed} | set(canonical_positions(player_slug))) & position_band(listed)


def card_starter_positions(player_slug: str | None, season: str | None) -> frozenset[str]:
    """`season_starter_positions`, falling back to the career grain.

    THE FALLBACK IS FOR ONE SPECIFIC DATA GAP AND IS DELIBERATELY NARROW. The
    committed source stores an era-specific bare `"F"` for a handful of
    seasons, and this module never guesses `F` into SF or PF. A card on such a
    season therefore has no season-grain claim at all -- which is a gap in what
    we know, not a statement that the player played nowhere. Reading it as the
    latter would delete the identity from a roll the index says they are
    eligible for.

    Measured against the real committed index: 1 card of 4751 (Adam Keefe,
    Utah 1997-98, listed `"F"`). `test_position_seasons.py` pins that count, so
    a future data regression that widens the gap fails a test rather than
    quietly re-admitting the career grain for hundreds of cards.
    """
    strict = season_starter_positions(player_slug, season)
    if strict:
        return strict
    return canonical_positions(player_slug)


def season_slot_rights(player_slug: str | None, season: str | None) -> frozenset[str]:
    """Every slot type this player-season may occupy, bench included.

    The bench is offered only to an identity that has a legal starting
    position at all, for the reason the module docstring gives: an identity
    with no position data is a data gap, and a bench is not a dumping ground
    for one.
    """
    starters = card_starter_positions(player_slug, season)
    if not starters:
        return frozenset()
    return starters | frozenset(BENCH_SLOT_TYPES)


def career_slot_rights(player_slug: str | None) -> frozenset[str]:
    """The pre-season-anchoring, career-grain rights.

    KEPT, AND DELIBERATELY NOT THE DEFAULT. It is the honest answer when there
    is genuinely no season -- a display label outside a match, or a legacy
    snapshot whose card cannot be resolved. Legality inside a live draft must
    use `season_slot_rights`; see the module docstring for what the career
    grain did to Russell Westbrook.
    """
    positions = canonical_positions(player_slug)
    if not positions:
        return frozenset()
    return positions | frozenset(BENCH_SLOT_TYPES)


def rights_for(pairs: Iterable[tuple[str, Optional[str]]]) -> dict[str, frozenset[str]]:
    """Build a `SlotRights` map from (player_slug, season) pairs.

    A slug seen twice keeps the rights of the FIRST season supplied. Callers
    order their pairs so the authoritative card comes first -- in a match that
    is the card the identity was actually drafted on, because the roster is
    scored on that season and must be legal for it.
    """
    out: dict[str, frozenset[str]] = {}
    for slug, season in pairs:
        if not slug or slug in out:
            continue
        out[slug] = season_slot_rights(slug, season)
    return out


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


def legal_slots(player_slug: str | None, rights: SlotRights) -> frozenset[str]:
    """Every slot type this identity may legally occupy in THIS match.

    A slug the map does not know has no rights at all. That is deliberate: an
    identity nobody resolved a card for is not on the board, and answering
    "anywhere" for it is the failure mode this signature exists to remove.
    """
    if not player_slug:
        return frozenset()
    return rights.get(player_slug, frozenset())


def is_legal(player_slug: str | None, slot_type: str, rights: SlotRights) -> bool:
    """May this identity occupy this slot? The single hard-legality predicate."""
    return slot_type in legal_slots(player_slug, rights)


def legal_players_for_slot(
    slot_type: str, player_slugs: Iterable[str], rights: SlotRights
) -> tuple[str, ...]:
    """Those of `player_slugs` that may legally occupy `slot_type`, order preserved."""
    return tuple(slug for slug in player_slugs if is_legal(slug, slot_type, rights))


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


def validate_roster(
    assignment: Mapping[str, Optional[str]], rights: SlotRights
) -> RosterCheck:
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
        if not is_legal(player_slug, slot_type, rights):
            # The message names the slots THIS card is legal for, not the
            # player's career positions -- the two differ precisely in the
            # cases this check exists to refuse, and quoting the career set
            # would explain the refusal with the evidence that caused the bug.
            starters = sorted(
                slot for slot in legal_slots(player_slug, rights) if slot in POSITION_TOKENS
            )
            played = ", ".join(starters) if starters else "no recognized position"
            return _fail(
                "illegal_slot",
                f"'{player_slug}' cannot play {slot_type} ({played})",
            )
    return _ok()


def apply_reposition(
    assignment: Mapping[str, Optional[str]],
    slot_a: str,
    slot_b: str,
    rights: SlotRights,
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

    check = validate_roster(proposed, rights)
    if not check.ok:
        raise IllegalPlacement(check.code or "illegal_roster", check.message or "illegal roster")
    return proposed


def can_complete_roster(
    assignment: Mapping[str, Optional[str]],
    available_slugs: Sequence[str],
    rights: SlotRights,
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
    adjacency = {slot: legal_players_for_slot(slot, pool, rights) for slot in empty}
    return has_perfect_matching(empty, adjacency)


def completion_witness(
    assignment: Mapping[str, Optional[str]],
    available_slugs: Sequence[str],
    rights: SlotRights,
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
    adjacency = {slot: legal_players_for_slot(slot, pool, rights) for slot in empty}
    return find_assignment(empty, adjacency)


def open_slots(assignment: Mapping[str, Optional[str]]) -> tuple[str, ...]:
    """Still-empty slots, in canonical SLOT_TYPES order."""
    return tuple(slot for slot in SLOT_TYPES if assignment.get(slot) is None)


def empty_roster() -> dict[str, Optional[str]]:
    """A fresh, fully-empty roster keyed by every slot type."""
    return {slot: None for slot in SLOT_TYPES}


__all__ = [
    "POSITION_SPECTRUM",
    "POSITION_TOKENS",
    "IllegalPlacement",
    "RosterCheck",
    "SlotRights",
    "apply_reposition",
    "can_complete_roster",
    "canonical_positions",
    "career_slot_rights",
    "completion_witness",
    "empty_roster",
    "has_canonical_position",
    "is_legal",
    "legal_players_for_slot",
    "legal_slots",
    "normalize_slug",
    "open_slots",
    "position_band",
    "rights_for",
    "card_starter_positions",
    "season_slot_rights",
    "season_starter_positions",
    "validate_roster",
]
