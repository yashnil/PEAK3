"""Snake order and the global identity lock -- pure draft mechanics.

NO PERSISTENCE. Every function here takes a `DraftState` and returns a NEW
one; nothing is mutated in place. That is what lets the platform layer treat a
pick as a transaction: compute the next state, write it under whatever
concurrency control it uses, and discard it safely if the write loses a race.
An in-place mutation would have already corrupted the caller's copy by then.

SNAKE ORDER
-----------
Fixed A-B-C / C-B-A across all six rounds -- seats 0,1,2 then 2,1,0, repeating.
This is NOT a rotating or balanced order and must not be "fixed" into one: the
residual seat advantage is an intentional, documented design decision. Seat A
always opens the draft; seat C always gets the turn (last pick of one round,
first of the next).

THE IDENTITY LOCK IS GLOBAL AND IDENTITY-GRAINED
-------------------------------------------------
Once any seat drafts an identity, that identity is gone for everyone, in every
franchise and every decade, for the rest of the match. A Cavaliers x 2000s
LeBron James blocks a Heat x 2010s LeBron James -- the lock is on the PERSON,
not on the card, because the two cards are the same man and a roster with two
of him is not a basketball team.

`drafted_identities(state)` exposes the lock as a plain frozenset so the
platform layer can enforce it transactionally (e.g. as a uniqueness constraint
on (match_id, player_slug)) rather than trusting an in-memory check that two
concurrent picks could both pass.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional, Sequence

from nba_peak.three_man_weave.config import (
    PARTICIPANT_COUNT,
    ROUNDS,
    RULESET_VERSION,
    SLOT_TYPES,
    SNAKE_FORWARD,
    SNAKE_REVERSE,
)
from nba_peak.three_man_weave.eligibility import EligibilityIndex
from nba_peak.three_man_weave.positions import (
    IllegalPlacement,
    apply_reposition,
    is_legal,
    validate_roster,
)
from nba_peak.three_man_weave.schemas import DraftPick, Roll, Roster


class DraftError(ValueError):
    """An action the draft rules forbid. `code` is machine-readable."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def snake_turn_order(
    rounds: int = ROUNDS, participants: int = PARTICIPANT_COUNT
) -> tuple[tuple[int, int], ...]:
    """The full (round_number, seat_index) sequence for a match.

    Round numbers are 1-based. Odd rounds run forward (A-B-C), even rounds
    run reversed (C-B-A) -- the fixed snake, not a rotation.
    """
    forward = SNAKE_FORWARD if participants == PARTICIPANT_COUNT else tuple(range(participants))
    reverse = SNAKE_REVERSE if participants == PARTICIPANT_COUNT else tuple(reversed(forward))
    out: list[tuple[int, int]] = []
    for round_number in range(1, rounds + 1):
        order = forward if round_number % 2 == 1 else reverse
        out.extend((round_number, seat) for seat in order)
    return tuple(out)


@dataclass(frozen=True)
class DraftState:
    """A whole match's game-logic state. Immutable; actions return new copies."""

    match_seed: int
    ruleset_version: str
    turn_index: int
    rosters: tuple[Roster, ...]
    picks: tuple[DraftPick, ...]
    used_roll_ids: tuple[str, ...]
    current_roll: Optional[Roll] = None

    # -- turn -------------------------------------------------------------
    @property
    def order(self) -> tuple[tuple[int, int], ...]:
        return snake_turn_order()

    @property
    def is_complete(self) -> bool:
        return self.turn_index >= len(self.order)

    @property
    def current_round(self) -> Optional[int]:
        return None if self.is_complete else self.order[self.turn_index][0]

    @property
    def current_seat(self) -> Optional[int]:
        return None if self.is_complete else self.order[self.turn_index][1]

    def roster(self, seat_index: int) -> Roster:
        return self.rosters[seat_index]

    def as_dict(self) -> dict:
        return {
            "match_seed": self.match_seed,
            "ruleset_version": self.ruleset_version,
            "turn_index": self.turn_index,
            "current_round": self.current_round,
            "current_seat": self.current_seat,
            "is_complete": self.is_complete,
            "rosters": [roster.as_dict() for roster in self.rosters],
            "picks": [pick.as_dict() for pick in self.picks],
            "used_roll_ids": list(self.used_roll_ids),
            "current_roll": self.current_roll.as_dict() if self.current_roll else None,
            "drafted_identities": sorted(self.drafted_identities()),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "DraftState":
        """Rehydrate from `as_dict()`. The round-trip must be exact.

        The Arena foundation persists this as opaque JSONB and reduces every
        subsequent turn from the rehydrated copy, so a field that serialises
        but does not deserialise silently resets mid-match. That is the exact
        failure `apps/api/app/services/perfect_season/serialization.py:1-24`
        records, where a hand-listed reconstruction reset the respin budget on
        every single request.

        Derived fields (`current_round`, `current_seat`, `is_complete`,
        `drafted_identities`) are properties and are deliberately NOT read
        back -- they are recomputed from `turn_index` and `picks`, so a
        hand-edited snapshot cannot make them disagree with the state.
        """
        return cls(
            match_seed=data["match_seed"],
            ruleset_version=data.get("ruleset_version", RULESET_VERSION),
            turn_index=data["turn_index"],
            rosters=tuple(Roster.from_dict(entry) for entry in data["rosters"]),
            picks=tuple(DraftPick.from_dict(entry) for entry in data["picks"]),
            used_roll_ids=tuple(data.get("used_roll_ids") or ()),
            current_roll=(
                Roll.from_dict(data["current_roll"]) if data.get("current_roll") else None
            ),
        )

    # -- the lock ---------------------------------------------------------
    def drafted_identities(self) -> frozenset[str]:
        """Every identity taken by ANY seat -- the global lock.

        Exposed as a plain set so the platform layer can enforce it
        transactionally instead of relying on an in-memory check that two
        concurrent picks could both pass.
        """
        return frozenset(pick.player_slug for pick in self.picks)


def create_match(match_seed: int, participants: int = PARTICIPANT_COUNT) -> DraftState:
    """A fresh match with empty rosters and no roll revealed."""
    return DraftState(
        match_seed=match_seed,
        ruleset_version=RULESET_VERSION,
        turn_index=0,
        rosters=tuple(Roster(seat_index=index) for index in range(participants)),
        picks=(),
        used_roll_ids=(),
        current_roll=None,
    )


def set_roll(state: DraftState, roll: Roll) -> DraftState:
    """Reveal a roll for the current round.

    The roll's candidate list is snapshotted here and never re-resolved --
    see `Roll`'s own docstring. A repeat of an already-used roll is recorded
    only once, so `used_roll_ids` stays a set of distinct rolls.
    """
    if state.is_complete:
        raise DraftError("match_complete", "The match is already complete")
    used = state.used_roll_ids
    if roll.roll_id not in used:
        used = used + (roll.roll_id,)
    return replace(state, current_roll=roll, used_roll_ids=used)


def legal_slots_for_pick(state: DraftState, seat_index: int, player_slug: str) -> tuple[str, ...]:
    """The open slots on this seat's roster that this identity may occupy."""
    roster = state.roster(seat_index)
    return tuple(slot for slot in roster.open_slots() if is_legal(player_slug, slot))


def legal_picks(state: DraftState, seat_index: Optional[int] = None) -> dict[str, tuple[str, ...]]:
    """player_slug -> the open slots they could fill, for the current roll.

    Empty dict when no roll is revealed. An identity already drafted by ANY
    seat never appears -- the lock is applied here, not left to the caller.
    """
    if state.current_roll is None:
        return {}
    seat = state.current_seat if seat_index is None else seat_index
    if seat is None:
        return {}
    drafted = state.drafted_identities()
    out: dict[str, tuple[str, ...]] = {}
    for slug in state.current_roll.eligible_slugs:
        if slug in drafted:
            continue
        slots = legal_slots_for_pick(state, seat, slug)
        if slots:
            out[slug] = slots
    return out


def apply_pick(
    state: DraftState,
    player_slug: str,
    slot_type: str,
    seat_index: Optional[int] = None,
) -> DraftState:
    """Commit one selection and advance the turn. Returns a NEW state.

    Every rule is checked here rather than assumed by the caller: it is the
    current seat's turn, a roll is revealed, the identity is on that roll,
    the identity is not already taken by anyone, and the slot is open and
    legal for them.
    """
    if state.is_complete:
        raise DraftError("match_complete", "The match is already complete")
    if state.current_roll is None:
        raise DraftError("no_roll", "No roll has been revealed for this round")

    seat = state.current_seat if seat_index is None else seat_index
    if seat != state.current_seat:
        raise DraftError(
            "not_your_turn", f"It is seat {state.current_seat}'s turn, not seat {seat}'s"
        )

    if player_slug in state.drafted_identities():
        raise DraftError(
            "identity_already_drafted",
            f"'{player_slug}' has already been drafted in this match",
        )
    if player_slug not in state.current_roll.eligible_slugs:
        raise DraftError(
            "not_on_roll",
            f"'{player_slug}' is not eligible for "
            f"{state.current_roll.franchise_id} x {state.current_roll.decade}",
        )

    roster = state.roster(seat)
    if slot_type not in SLOT_TYPES:
        raise DraftError("unknown_slot", f"'{slot_type}' is not a roster slot")
    if roster.slots.get(slot_type) is not None:
        raise DraftError("slot_filled", f"Slot {slot_type} is already filled")
    if not is_legal(player_slug, slot_type):
        raise DraftError("illegal_slot", f"'{player_slug}' cannot play {slot_type}")

    pick = DraftPick(
        seat_index=seat,
        round_number=state.current_roll.round_number,
        slot_type=slot_type,
        player_slug=player_slug,
        franchise_id=state.current_roll.franchise_id,
        decade=state.current_roll.decade,
    )

    new_slots = dict(roster.slots)
    new_slots[slot_type] = pick
    new_roster = Roster(seat_index=seat, slots=new_slots)

    # Belt and braces: validate the roster this pick PRODUCES, not just the
    # placement. The individual checks above should make this unreachable,
    # which is exactly why it is worth asserting -- a future rule change that
    # breaks an invariant fails here rather than silently shipping an illegal
    # roster into the evaluator.
    check = validate_roster(new_roster.assignment())
    if not check.ok:  # pragma: no cover - defensive
        raise DraftError(check.code or "illegal_roster", check.message or "illegal roster")

    rosters = tuple(
        new_roster if existing.seat_index == seat else existing for existing in state.rosters
    )
    advanced = state.turn_index + 1
    # The revealed roll belongs to the round that just consumed it. Clear it
    # at a round boundary so the next round cannot be played on a stale roll.
    next_round = None if advanced >= len(state.order) else state.order[advanced][0]
    keep_roll = next_round == state.current_roll.round_number

    return replace(
        state,
        rosters=rosters,
        picks=state.picks + (pick,),
        turn_index=advanced,
        current_roll=state.current_roll if keep_roll else None,
    )


def reposition(
    state: DraftState, seat_index: int, slot_a: str, slot_b: str
) -> DraftState:
    """Swap two of a seat's slots, keeping the roster legal throughout.

    Delegates to `positions.apply_reposition`, which computes the resulting
    roster, validates THAT, and commits it or raises -- so there is no
    intermediate state in which the roster is illegal, temporarily or
    finally. The picks themselves are rewritten to carry their new
    `slot_type` so a pick can never disagree with the slot holding it.
    """
    roster = state.roster(seat_index)
    # Validates the outcome; raises IllegalPlacement if the swap is illegal.
    apply_reposition(roster.assignment(), slot_a, slot_b)

    new_slots = dict(roster.slots)
    pick_a, pick_b = new_slots.get(slot_a), new_slots.get(slot_b)
    new_slots[slot_a] = replace(pick_b, slot_type=slot_a) if pick_b else None
    new_slots[slot_b] = replace(pick_a, slot_type=slot_b) if pick_a else None
    new_roster = Roster(seat_index=seat_index, slots=new_slots)

    rosters = tuple(
        new_roster if existing.seat_index == seat_index else existing
        for existing in state.rosters
    )
    by_key = {(pick.seat_index, pick.player_slug): pick for pick in new_roster.picks()}
    picks = tuple(
        by_key.get((pick.seat_index, pick.player_slug), pick) for pick in state.picks
    )
    return replace(state, rosters=rosters, picks=picks)


def undrafted_pool(state: DraftState, index: EligibilityIndex) -> tuple[str, ...]:
    """Every identity anywhere in the index that no seat has drafted, sorted."""
    everyone: set[str] = set()
    for roll in index.rolls():
        everyone |= index.eligible_slugs(*roll)
    return tuple(sorted(everyone - state.drafted_identities()))


def rosters_for_feasibility(state: DraftState) -> Sequence[Roster]:
    return state.rosters


__all__ = [
    "DraftError",
    "DraftState",
    "IllegalPlacement",
    "apply_pick",
    "create_match",
    "legal_picks",
    "legal_slots_for_pick",
    "reposition",
    "rosters_for_feasibility",
    "set_roll",
    "snake_turn_order",
    "undrafted_pool",
]
