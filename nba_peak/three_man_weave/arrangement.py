"""Legal roster ARRANGEMENT: where a squad of players can stand, not just who.

WHY THIS EXISTS SEPARATELY FROM `positions`
--------------------------------------------
`positions` answers per-placement questions ("may this player occupy this
slot?") and validates a finished assignment. It cannot answer the question a
drafter actually asks, which is one step higher:

    "My SF and PF are both taken. Can I still take this small forward?"

The honest answer is often YES -- move the current SF to SG or the bench and
the new one fits -- and the previous ruleset said no, because it only ever
compared a candidate against the slots that happened to be EMPTY. That made
multi-position players quietly worthless and made the candidate list look
arbitrary: a legal pick was shown as illegal because of an arrangement nobody
had asked the player to change.

This module answers the higher question by matching. A roster of `k` players
plus one candidate is legal iff the `k+1` of them can be assigned to `k+1`
distinct slots, each legal for its occupant. That is a bipartite matching, and
`matching.find_assignment` already solves it exactly -- so the answer is a
proof, and the proof doubles as the PLAN the surface shows and the server
commits.

THREE STATES, AND EVERY CANDIDATE HAS ONE
------------------------------------------
  * `FITS_NOW`                   -- an already-open slot accepts them.
  * `FITS_AFTER_REARRANGEMENT`   -- no open slot does, but a legal rearrangement
                                    of the whole roster admits them. The plan
                                    is attached.
  * `NO_LEGAL_ARRANGEMENT`       -- no assignment of these players to these
                                    slots is legal. Shown and disabled, with a
                                    reason, never hidden.

A candidate is never REMOVED from the list for any of these. Hiding a player
the roll made eligible is how a draft board starts lying about the pool, and
"there is no legal way to fit them" is information a drafter needs, not an
error to suppress.

DETERMINISM
-----------
Players are fed to the matcher in a fixed order (canonical slot order for
those already placed, candidate last) and each player's legal slots in
`SLOT_TYPES` order, so the plan returned for a given roster and candidate is
always the same one. A plan that varied between the projection and the commit
would let a player confirm an arrangement and get a different one.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

from nba_peak.three_man_weave.config import SLOT_TYPES
from nba_peak.three_man_weave.matching import find_assignment
from nba_peak.three_man_weave.positions import (
    IllegalPlacement,
    canonical_positions,
    legal_slots,
    validate_roster,
)

FITS_NOW = "fits_now"
FITS_AFTER_REARRANGEMENT = "fits_after_rearrangement"
NO_LEGAL_ARRANGEMENT = "no_legal_arrangement"

#: Human-readable reasons for the disabled state. Authored here so every
#: surface says the same sentence and a test can assert on it.
REASON_NO_POSITION_DATA = (
    "PEAK3 has no recognised position for this player, so there is no slot "
    "they can legally occupy."
)
REASON_NO_ARRANGEMENT = (
    "Every slot they could play is filled by someone who cannot move anywhere "
    "else, so there is no legal way to fit them on this roster."
)


@dataclass(frozen=True)
class CandidateFit:
    """Whether -- and how -- one candidate can join one roster.

    `plan` is a COMPLETE final assignment (slot -> player_slug) for every
    player on the roster including the candidate, not a diff. A complete
    assignment is what the server validates and commits, so handing the
    surface anything less would mean two different descriptions of the same
    move and a chance for them to disagree.
    """

    player_slug: str
    state: str
    #: Open slots that accept the candidate with nothing else moving. Empty
    #: unless `state == FITS_NOW`.
    direct_slots: tuple[str, ...] = ()
    #: The rearrangement that admits them. None when `FITS_NOW` (nothing needs
    #: to move) or `NO_LEGAL_ARRANGEMENT` (nothing can).
    plan: Optional[dict[str, str]] = None
    #: Which already-placed players the plan moves, and to where. Derived from
    #: `plan` so a surface can explain the move without recomputing it.
    moves: tuple[dict, ...] = ()
    reason: Optional[str] = None

    @property
    def selectable(self) -> bool:
        return self.state != NO_LEGAL_ARRANGEMENT

    def as_dict(self) -> dict:
        return {
            "player_slug": self.player_slug,
            "state": self.state,
            "direct_slots": list(self.direct_slots),
            "plan": dict(self.plan) if self.plan else None,
            "moves": [dict(move) for move in self.moves],
            "reason": self.reason,
        }


def _placed(assignment: Mapping[str, Optional[str]]) -> dict[str, str]:
    """slot -> player, for the filled slots only, in canonical slot order."""
    return {
        slot: assignment[slot]
        for slot in SLOT_TYPES
        if assignment.get(slot) is not None
    }


def open_slots_for(assignment: Mapping[str, Optional[str]]) -> tuple[str, ...]:
    return tuple(slot for slot in SLOT_TYPES if assignment.get(slot) is None)


def direct_slots_for(
    assignment: Mapping[str, Optional[str]], player_slug: str
) -> tuple[str, ...]:
    """Open slots this player may occupy with nothing else moving."""
    allowed = legal_slots(player_slug)
    return tuple(slot for slot in open_slots_for(assignment) if slot in allowed)


def arrangement_for(
    assignment: Mapping[str, Optional[str]],
    player_slug: str,
) -> Optional[dict[str, str]]:
    """A complete legal assignment admitting `player_slug`, or None.

    The matching is over PLAYERS (left) against SLOTS (right), which is the
    orientation that makes "every player must get a slot" the perfect-matching
    condition. The reverse orientation would ask every slot to get a player,
    which is a different -- and, on a partly-filled roster, wrong -- question.
    """
    placed = _placed(assignment)
    if player_slug in placed.values():
        return None  # already on this roster; the caller has a duplicate

    players = [placed[slot] for slot in placed] + [player_slug]
    if len(players) > len(SLOT_TYPES):
        return None

    adjacency = {
        slug: tuple(slot for slot in SLOT_TYPES if slot in legal_slots(slug))
        for slug in players
    }
    by_player = find_assignment(players, adjacency)
    if by_player is None:
        return None
    return {slot: slug for slug, slot in by_player.items()}


def candidate_fit(
    assignment: Mapping[str, Optional[str]],
    player_slug: str,
) -> CandidateFit:
    """Classify one candidate against one roster. Never raises."""
    if not canonical_positions(player_slug):
        return CandidateFit(
            player_slug=player_slug,
            state=NO_LEGAL_ARRANGEMENT,
            reason=REASON_NO_POSITION_DATA,
        )

    direct = direct_slots_for(assignment, player_slug)
    if direct:
        return CandidateFit(
            player_slug=player_slug, state=FITS_NOW, direct_slots=direct
        )

    plan = arrangement_for(assignment, player_slug)
    if plan is None:
        return CandidateFit(
            player_slug=player_slug,
            state=NO_LEGAL_ARRANGEMENT,
            reason=REASON_NO_ARRANGEMENT,
        )

    return CandidateFit(
        player_slug=player_slug,
        state=FITS_AFTER_REARRANGEMENT,
        plan=plan,
        moves=plan_moves(assignment, plan),
    )


def plan_moves(
    assignment: Mapping[str, Optional[str]],
    plan: Mapping[str, str],
) -> tuple[dict, ...]:
    """Which already-placed players the plan relocates, and where to.

    Only genuine relocations: a player the plan leaves where they were is not
    a move and must not be announced as one, or a one-player rearrangement
    reads as a roster-wide shuffle.
    """
    was = {slug: slot for slot, slug in _placed(assignment).items()}
    out = []
    for slot in SLOT_TYPES:
        slug = plan.get(slot)
        if slug is None or slug not in was or was[slug] == slot:
            continue
        out.append({"player_slug": slug, "from_slot": was[slug], "to_slot": slot})
    return tuple(out)


def validate_arrangement(
    assignment: Mapping[str, Optional[str]],
    plan: Mapping[str, str],
    incoming: Optional[str] = None,
) -> dict[str, Optional[str]]:
    """Check a client-supplied arrangement and return the roster it produces.

    RAISES `IllegalPlacement` RATHER THAN RETURNING A FLAG, so a caller cannot
    accidentally commit a plan it forgot to check. Four ways to be refused,
    each with its own code:

      * `unknown_slot`      -- a key that is not a roster slot.
      * `roster_mismatch`   -- the plan's players are not exactly the roster's
                               players plus the incoming one. This is the check
                               that stops a client dropping a drafted player,
                               duplicating one, or smuggling in an identity it
                               never drafted.
      * `duplicate_player`  -- the same player in two slots.
      * `illegal_slot`      -- a placement hard position legality forbids.

    The incoming player is REQUIRED to appear when one is given, so a "draft
    plus rearrange" cannot quietly become "rearrange, and never mind the pick".
    """
    for slot in plan:
        if slot not in SLOT_TYPES:
            raise IllegalPlacement("unknown_slot", f"'{slot}' is not a roster slot")

    expected = set(_placed(assignment).values())
    if incoming is not None:
        if incoming in expected:
            raise IllegalPlacement(
                "duplicate_player",
                f"'{incoming}' is already on this roster",
            )
        expected = expected | {incoming}

    supplied = [slug for slug in plan.values() if slug is not None]
    if len(supplied) != len(set(supplied)):
        raise IllegalPlacement(
            "duplicate_player", "the same player appears in two slots"
        )
    if set(supplied) != expected:
        missing = sorted(expected - set(supplied))
        extra = sorted(set(supplied) - expected)
        raise IllegalPlacement(
            "roster_mismatch",
            "the arrangement must place exactly this roster's players"
            + (f"; missing {missing}" if missing else "")
            + (f"; unexpected {extra}" if extra else ""),
        )

    produced: dict[str, Optional[str]] = {slot: None for slot in SLOT_TYPES}
    for slot, slug in plan.items():
        produced[slot] = slug

    check = validate_roster(produced)
    if not check.ok:
        raise IllegalPlacement(
            check.code or "illegal_roster", check.message or "illegal roster"
        )
    return produced


def fits_for_candidates(
    assignment: Mapping[str, Optional[str]],
    player_slugs: Sequence[str],
) -> dict[str, CandidateFit]:
    """`candidate_fit` over a whole candidate list, in the order given.

    Bounded work by construction: at most six players and six slots per
    matching, over at most a few dozen candidates on the largest roll. No data
    file is read, so this is safe to call from a projection on every poll.
    """
    return {slug: candidate_fit(assignment, slug) for slug in player_slugs}


__all__ = [
    "FITS_AFTER_REARRANGEMENT",
    "FITS_NOW",
    "NO_LEGAL_ARRANGEMENT",
    "REASON_NO_ARRANGEMENT",
    "REASON_NO_POSITION_DATA",
    "CandidateFit",
    "arrangement_for",
    "candidate_fit",
    "direct_slots_for",
    "fits_for_candidates",
    "open_slots_for",
    "plan_moves",
    "validate_arrangement",
]
