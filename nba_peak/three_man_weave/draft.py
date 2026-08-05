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
from typing import Mapping, Optional, Sequence

from nba_peak.three_man_weave.arrangement import (
    CandidateFit,
    fits_for_candidates,
    validate_arrangement,
)
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


def candidate_fits(state: DraftState, seat_index: Optional[int] = None) -> dict[str, CandidateFit]:
    """THE FULL ELIGIBLE POOL for the current roll, each classified for a seat.

    Every undrafted identity the roll made eligible appears, in the roll's own
    sorted order -- including the ones this seat cannot use. That is the
    difference from `legal_picks`, which returns only what fits an already-open
    slot, and it is the point: a drafter needs to see that the roll offered
    someone good and that their own roster shape is why they cannot take them.

    The identity lock is applied here rather than left to the caller, so a
    player already taken by ANY seat is absent rather than merely marked.
    """
    if state.current_roll is None:
        return {}
    seat = state.current_seat if seat_index is None else seat_index
    if seat is None:
        return {}
    drafted = state.drafted_identities()
    assignment = state.roster(seat).assignment()
    return fits_for_candidates(
        assignment,
        [slug for slug in state.current_roll.eligible_slugs if slug not in drafted],
    )


def apply_pick(
    state: DraftState,
    player_slug: str,
    slot_type: Optional[str] = None,
    seat_index: Optional[int] = None,
    placements: Optional[Mapping[str, str]] = None,
) -> DraftState:
    """Commit one selection and advance the turn. Returns a NEW state.

    Every rule is checked here rather than assumed by the caller: it is the
    current seat's turn, a roll is revealed, the identity is on that roll,
    the identity is not already taken by anyone, and the slot is open and
    legal for them.

    DRAFTING AND REARRANGING ARE ONE OPERATION
    -------------------------------------------
    `placements` is an optional COMPLETE final assignment (slot -> player) for
    this seat's roster, including the incoming player. When supplied, the pick
    and whatever repositioning it requires are validated together and applied
    together: a drafter whose SF and PF are both filled can take another small
    forward by moving the current SF to the bench in the same command.

    Atomic on purpose. Two commands -- draft, then reposition -- would leave a
    window in which the roster is legal but not the one the player chose, and
    a timeout, a disconnect or a concurrent action landing in that window
    would commit half a decision. Here the caller either gets the whole
    arrangement or gets a rejection and no change at all; there is no
    intermediate state to be caught in, which is the same guarantee
    `positions.apply_reposition` makes for a bare swap.

    `slot_type` may be omitted when `placements` is given -- the slot the
    incoming player lands on is read from the arrangement. When both are
    given they must agree, so a client cannot describe two different moves in
    one payload.
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

    if placements is not None:
        return _apply_pick_with_arrangement(
            state, roster, seat, player_slug, slot_type, placements
        )

    if slot_type is None:
        raise DraftError(
            "bad_payload", "a pick needs either a slot_type or a full arrangement"
        )
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


def _advance_after_pick(state: DraftState, seat: int, new_roster: Roster, pick: DraftPick) -> DraftState:
    """Swap in the new roster, record the pick and move the clock on.

    Shared by the plain and the rearranging pick paths so the two cannot drift
    apart on turn advancement or roll clearing -- the parts that have nothing
    to do with arrangement and must behave identically either way.
    """
    rosters = tuple(
        new_roster if existing.seat_index == seat else existing for existing in state.rosters
    )
    advanced = state.turn_index + 1
    assert state.current_roll is not None  # callers check
    next_round = None if advanced >= len(state.order) else state.order[advanced][0]
    keep_roll = next_round == state.current_roll.round_number

    # Every pick this seat holds is rewritten from the new roster, because a
    # rearrangement changes the `slot_type` recorded on picks made in earlier
    # rounds. A pick row that disagreed with the slot holding it would make the
    # receipt and the board tell two different stories about the same player.
    by_key = {(p.seat_index, p.player_slug): p for p in new_roster.picks()}
    picks = tuple(by_key.get((p.seat_index, p.player_slug), p) for p in state.picks)

    return replace(
        state,
        rosters=rosters,
        picks=picks + (by_key[(seat, pick.player_slug)],),
        turn_index=advanced,
        current_roll=state.current_roll if keep_roll else None,
    )


def _apply_pick_with_arrangement(
    state: DraftState,
    roster: Roster,
    seat: int,
    player_slug: str,
    slot_type: Optional[str],
    placements: Mapping[str, str],
) -> DraftState:
    """The atomic draft-plus-rearrange path. Validated as one final roster."""
    assert state.current_roll is not None  # caller checks

    try:
        produced = validate_arrangement(roster.assignment(), placements, incoming=player_slug)
    except IllegalPlacement as exc:
        raise DraftError(exc.code, exc.message) from exc

    landed = next(slot for slot, slug in produced.items() if slug == player_slug)
    if slot_type is not None and slot_type != landed:
        raise DraftError(
            "arrangement_mismatch",
            f"the arrangement puts '{player_slug}' at {landed}, "
            f"but the command asked for {slot_type}",
        )

    existing_by_slug = {p.player_slug: p for p in roster.picks()}
    new_slots: dict[str, Optional[DraftPick]] = {slot: None for slot in SLOT_TYPES}
    incoming: Optional[DraftPick] = None
    for slot, slug in produced.items():
        if slug is None:
            continue
        if slug == player_slug:
            incoming = DraftPick(
                seat_index=seat,
                round_number=state.current_roll.round_number,
                slot_type=slot,
                player_slug=player_slug,
                franchise_id=state.current_roll.franchise_id,
                decade=state.current_roll.decade,
            )
            new_slots[slot] = incoming
        else:
            # A moved pick keeps its own round, franchise and decade -- those
            # are facts about when and how it was drafted and a rearrangement
            # does not change them. Only the slot moves.
            new_slots[slot] = replace(existing_by_slug[slug], slot_type=slot)

    assert incoming is not None  # validate_arrangement guarantees it
    return _advance_after_pick(
        state, seat, Roster(seat_index=seat, slots=new_slots), incoming
    )


def rearrange(
    state: DraftState, seat_index: int, placements: Mapping[str, str]
) -> DraftState:
    """Reposition a seat's existing roster. Does NOT consume a turn.

    A standalone move, available to a seat on its own roster whenever the
    match is live, because tidying your own lineup is not an action against
    anybody: it takes no player off the board, changes no other seat's
    options, and cannot be used to stall (the seat on the clock still has the
    same deadline). The pick-time path above exists in addition, for the case
    where the rearrangement is what makes a pick legal.

    `placements` must account for exactly the players already on the roster --
    no additions, no drops -- and produce a legal assignment. Anything else
    raises `DraftError` and nothing is written.
    """
    if state.is_complete:
        raise DraftError("match_complete", "The match is already complete")
    roster = state.roster(seat_index)
    try:
        produced = validate_arrangement(roster.assignment(), placements, incoming=None)
    except IllegalPlacement as exc:
        raise DraftError(exc.code, exc.message) from exc

    existing_by_slug = {p.player_slug: p for p in roster.picks()}
    new_slots: dict[str, Optional[DraftPick]] = {slot: None for slot in SLOT_TYPES}
    for slot, slug in produced.items():
        if slug is not None:
            new_slots[slot] = replace(existing_by_slug[slug], slot_type=slot)
    new_roster = Roster(seat_index=seat_index, slots=new_slots)

    rosters = tuple(
        new_roster if existing.seat_index == seat_index else existing
        for existing in state.rosters
    )
    by_key = {(p.seat_index, p.player_slug): p for p in new_roster.picks()}
    picks = tuple(by_key.get((p.seat_index, p.player_slug), p) for p in state.picks)
    return replace(state, rosters=rosters, picks=picks)


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
    "candidate_fits",
    "create_match",
    "legal_picks",
    "legal_slots_for_pick",
    "rearrange",
    "reposition",
    "rosters_for_feasibility",
    "set_roll",
    "snake_turn_order",
    "undrafted_pool",
]
