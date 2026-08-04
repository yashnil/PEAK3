"""Plain dataclasses shared across the THREE-MAN WEAVE engine.

No Pydantic and no persistence concerns -- mirrors
`nba_peak/perfect_season/schemas.py`'s convention. The platform layer wraps
these at its own boundary; nothing here knows that a database or an HTTP
request exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from nba_peak.three_man_weave.config import ROSTER_SIZE, SLOT_TYPES


@dataclass(frozen=True)
class Roll:
    """One revealed franchise x decade combination.

    `eligible_slugs` is resolved ONCE, at reveal time, from the eligibility
    index minus the identities already drafted -- and then never re-resolved.
    Same snapshot discipline CourtBuilder applies to its spins
    (`SpinPrompt.candidate_player_slugs`): a candidate list that silently
    changes underneath a player who is mid-decision is a bug, not a feature.
    """

    round_number: int
    franchise_id: str
    franchise_display_name: str
    decade: str
    eligible_slugs: tuple[str, ...]

    @property
    def roll_id(self) -> str:
        return f"{self.franchise_id.lower()}-{self.decade}"

    def as_dict(self) -> dict:
        return {
            "round_number": self.round_number,
            "roll_id": self.roll_id,
            "franchise_id": self.franchise_id,
            "franchise_display_name": self.franchise_display_name,
            "decade": self.decade,
            "eligible_slugs": list(self.eligible_slugs),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Roll":
        # `roll_id` is derived and deliberately not read back -- a stored copy
        # of a derivable value can only ever drift from the thing it derives
        # from, the same call arena_matches.snapshot makes for generated content.
        return cls(
            round_number=data["round_number"],
            franchise_id=data["franchise_id"],
            franchise_display_name=data["franchise_display_name"],
            decade=data["decade"],
            eligible_slugs=tuple(data["eligible_slugs"]),
        )


@dataclass(frozen=True)
class DraftPick:
    """One committed selection.

    Carries the DECADE it was drafted on, not just the identity, because the
    scoring card is a function of (identity, decade): the same player drafted
    off a 2000s roll and a 2010s roll is scored on two different seasons. The
    franchise is kept as provenance for the receipt -- it is the eligibility
    evidence, never an input to the score.
    """

    seat_index: int
    round_number: int
    slot_type: str
    player_slug: str
    franchise_id: str
    decade: str

    def as_dict(self) -> dict:
        return {
            "seat_index": self.seat_index,
            "round_number": self.round_number,
            "slot_type": self.slot_type,
            "player_slug": self.player_slug,
            "franchise_id": self.franchise_id,
            "decade": self.decade,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "DraftPick":
        return cls(
            seat_index=data["seat_index"],
            round_number=data["round_number"],
            slot_type=data["slot_type"],
            player_slug=data["player_slug"],
            franchise_id=data["franchise_id"],
            decade=data["decade"],
        )


@dataclass
class Roster:
    """One participant's six slots.

    A plain mutable container by design -- it holds no rules. Every rule
    lives in `draft.apply_pick` / `draft.reposition`, which build a NEW
    `Roster` from a validated assignment rather than editing one in place, so
    a `DraftState` is never observed mid-edit. Nothing here should be mutated
    directly outside of test setup.
    """

    seat_index: int
    slots: dict[str, Optional[DraftPick]] = field(
        default_factory=lambda: {slot: None for slot in SLOT_TYPES}
    )

    def assignment(self) -> dict[str, Optional[str]]:
        """slot -> player_slug, the shape `positions` validates."""
        return {
            slot: (pick.player_slug if pick is not None else None)
            for slot, pick in self.slots.items()
        }

    def picks(self) -> tuple[DraftPick, ...]:
        """Committed picks in canonical slot order."""
        return tuple(self.slots[slot] for slot in SLOT_TYPES if self.slots[slot] is not None)

    def drafted_slugs(self) -> frozenset[str]:
        return frozenset(pick.player_slug for pick in self.picks())

    def open_slots(self) -> tuple[str, ...]:
        return tuple(slot for slot in SLOT_TYPES if self.slots[slot] is None)

    def is_complete(self) -> bool:
        return len(self.picks()) == ROSTER_SIZE

    def as_dict(self) -> dict:
        return {
            "seat_index": self.seat_index,
            "slots": {
                slot: (pick.as_dict() if pick is not None else None)
                for slot, pick in self.slots.items()
            },
            "complete": self.is_complete(),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Roster":
        # Slots are rebuilt from SLOT_TYPES rather than from the stored keys,
        # so a snapshot written under a different roster shape cannot
        # resurrect a slot this ruleset no longer has.
        slots: dict[str, Optional[DraftPick]] = {slot: None for slot in SLOT_TYPES}
        for slot, pick in (data.get("slots") or {}).items():
            if slot in slots and pick is not None:
                slots[slot] = DraftPick.from_dict(pick)
        return cls(seat_index=data["seat_index"], slots=slots)


__all__ = ["DraftPick", "Roll", "Roster"]
