"""Persistence interface for the mode-agnostic multiplayer Arena.

WHAT THIS DOMAIN IS
-------------------
A match, its seats, an append-only event log, an idempotency ledger, turn
deadlines, per-seat results, and a public queue. It encodes NO game rules.
There is no draft logic here, no auction logic, and no scoring. Mode-specific
shape lives inside `ArenaMatch.snapshot` and `ArenaEvent.payload`, which this
layer stores and returns and never interprets -- the same contract
`RunTheTableRunRepository` has with `StoredRun.snapshot`.

WHY NOT `HeadToHeadRepository`
------------------------------
Head-to-head is hard-capped at two seats in its own schema: UNIQUE
(match_id, role) over role IN ('creator','opponent')
(`supabase/migrations/20260801160000_head_to_head.sql:161-162`). Three seats
cannot be expressed in it, and relaxing that CHECK would delete the guarantee
head-to-head depends on. Seats here are addressed by an integer `seat_index`
and the arity is carried on the match, so a 2-seat auction and a 3-seat snake
draft share one model without either weakening the other. The full four-point
argument is in the migration header.

THE ONE METHOD THAT MATTERS IS `apply_command`
-----------------------------------------------
Every mutation to a live match goes through it. It is the atomic unit, in the
same sense `create_match_atomically` and `commit_settlement`
(`ranked_postgres.py:283`, `:707`) are atomic units: the whole read-decide-write
cycle happens inside one transaction holding one row lock, because every part of
it that is split apart becomes a race two browser tabs can both win.

It takes a REDUCER -- a pure function supplied by the mode module -- and calls
it while holding the lock. That inversion is deliberate: it is what keeps this
layer mode-agnostic while keeping the atomicity in one place instead of asking
every mode to re-derive it. The constraints on a reducer are in `MatchReducer`'s
docstring and they are not stylistic.

HIDDEN INFORMATION IS A TYPE, NOT A HABIT
------------------------------------------
`SeatView` is the only thing a bot policy is ever handed, and it structurally
cannot carry another seat's private state: it has no reference to `ArenaMatch`,
no repository handle, and no field holding the full snapshot. See `BotPolicy`.
The same projection boundary is what routes serve to human clients. A leak
therefore requires changing a type here, not forgetting an `if` in a serializer
-- which is the failure mode that put an opponent's `run_id` in a settled
head-to-head receipt (`api/v1/head_to_head.py:183-201`).

ASYNC END TO END, INCLUDING MEMORY
-----------------------------------
Every method is `async def` in the protocol, in both implementations, and at
every call site. `ranked_protocols.py:12-19` records why: the older
`protocols.py` declared sync methods that `postgres.py` implemented with
`async def`, so call sites silently held unawaited coroutines under a real
database and nothing failed until it did.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, Protocol, Sequence, runtime_checkable

from app.repositories.arena_rating_protocols import ArenaPlayerStats

# ---------------------------------------------------------------------------
# Vocabulary. Mirrors the CHECK constraints in
# supabase/migrations/20260804100000_arena_foundation.sql -- if one of these
# sets changes, that migration changes with it in the same commit.
# ---------------------------------------------------------------------------

MATCH_STATUS_FORMING = "forming"
MATCH_STATUS_ACTIVE = "active"
MATCH_STATUS_COMPLETED = "completed"
MATCH_STATUS_ABANDONED = "abandoned"
MATCH_STATUS_EXPIRED = "expired"
MATCH_STATUS_CANCELLED = "cancelled"

#: A match in one of these is finished; nothing may mutate it again.
TERMINAL_MATCH_STATUSES = frozenset(
    {
        MATCH_STATUS_COMPLETED,
        MATCH_STATUS_ABANDONED,
        MATCH_STATUS_EXPIRED,
        MATCH_STATUS_CANCELLED,
    }
)
#: A match in one of these is still live and still has a clock.
LIVE_MATCH_STATUSES = frozenset({MATCH_STATUS_FORMING, MATCH_STATUS_ACTIVE})

ENTRY_PATH_PUBLIC_QUEUE = "public_queue"
ENTRY_PATH_PRIVATE_ROOM = "private_room"
ENTRY_PATH_PRACTICE = "practice"

OCCUPANT_HUMAN = "human"
OCCUPANT_BOT = "bot"

SEAT_STATUS_ACTIVE = "active"
SEAT_STATUS_DISCONNECTED = "disconnected"
SEAT_STATUS_RESIGNED = "resigned"
SEAT_STATUS_ELIMINATED = "eliminated"
SEAT_STATUS_FINISHED = "finished"

VISIBILITY_PUBLIC = "public"
VISIBILITY_SEAT = "seat"
VISIBILITY_SERVER = "server"

TURN_RESOLUTION_ACTION = "action"
TURN_RESOLUTION_TIMEOUT = "timeout"
TURN_RESOLUTION_FORFEIT = "forfeit"
TURN_RESOLUTION_SKIPPED = "skipped"

QUEUE_STATUS_WAITING = "waiting"
QUEUE_STATUS_MATCHED = "matched"
QUEUE_STATUS_CANCELLED = "cancelled"
QUEUE_STATUS_EXPIRED = "expired"

#: The command type a server-issued timeout resolution carries. Reserved: a
#: mode may not define a command of this name, because it is the one command a
#: client is never allowed to send (see `CommandRequest.actor_sub`).
COMMAND_TYPE_TIMEOUT = "__timeout__"

#: Rejection codes this layer itself produces. A mode's reducer returns its own
#: codes for rule violations; these are the ones decided before the reducer is
#: ever called, so they are stable across every mode.
REJECT_MATCH_NOT_LIVE = "match_not_live"
REJECT_STALE_STATE_VERSION = "stale_state_version"
REJECT_NOT_YOUR_SEAT = "not_your_seat"
REJECT_MATCH_EXPIRED = "match_expired"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    """Attach UTC to a naive timestamp.

    asyncpg returns TIMESTAMPTZ as aware, and the memory repository stores what
    it was handed. A naive datetime reaching a comparison against an aware one
    raises `TypeError: can't compare offset-naive and offset-aware datetimes`,
    which is a 500 on a deadline check -- so every boundary normalises rather
    than trusting the caller. `api/v1/head_to_head.py:166-170` does the same
    thing inline; it is a function here because five call sites need it.
    """
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass
class ArenaMatch:
    """One match, of any arity, in any mode."""

    match_id: str
    mode: str
    mode_version: str
    model_version: str
    seat_count: int
    entry_path: str
    rated: bool
    seed: int
    created_by: str
    expires_at: datetime
    status: str = MATCH_STATUS_FORMING
    # Optimistic-concurrency counter. Monotonic, bumped by exactly one place
    # (`apply_command`), never by a caller. Modelled on CourtBuilder's
    # `state_version` (`services/perfect_season/state.py:210-218`), the only
    # optimistic-concurrency implementation that existed in this repo before
    # this one.
    state_version: int = 0
    room_code: Optional[str] = None
    bot_policy_version: Optional[str] = None
    turn_deadline_at: Optional[datetime] = None
    current_turn_seq: Optional[int] = None
    # The mode's own state. Opaque here.
    snapshot: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)
    completed_at: Optional[datetime] = None

    def is_live(self) -> bool:
        return self.status in LIVE_MATCH_STATUSES

    def is_expired_at(self, now: datetime) -> bool:
        return now > _utc(self.expires_at)


@dataclass
class ArenaSeat:
    """One seat. Human or bot; the two are distinguished by `occupant_kind`
    and the schema refuses a row whose columns disagree with it."""

    match_id: str
    seat_index: int
    occupant_kind: str
    occupant_sub: Optional[str] = None
    bot_id: Optional[str] = None
    bot_rating: Optional[float] = None
    display_name: str = "PEAK3 player"
    status: str = SEAT_STATUS_ACTIVE
    joined_at: datetime = field(default_factory=_now)
    last_seen_at: datetime = field(default_factory=_now)

    @property
    def is_bot(self) -> bool:
        return self.occupant_kind == OCCUPANT_BOT


@dataclass
class ArenaEvent:
    """One entry in the append-only log."""

    match_id: str
    seq: int
    event_type: str
    state_version_after: int
    payload: dict = field(default_factory=dict)
    actor_seat_index: Optional[int] = None
    visibility: str = VISIBILITY_PUBLIC
    visible_to_seat: Optional[int] = None
    created_at: datetime = field(default_factory=_now)
    id: Optional[int] = None

    def visible_to(self, seat_index: Optional[int]) -> bool:
        """Whether a given seat may see this event.

        The one place the visibility rule is written for the in-process path.
        The SQL policy in the migration says the same thing for a direct
        PostgREST caller; both exist because the API bypasses RLS entirely
        (it connects as the table owner -- see
        `supabase/migrations/20260801100000_rls_gaps.sql:3-18`), so this
        function, not the policy, is what actually protects a sealed bid from
        another player.
        """
        if self.visibility == VISIBILITY_SERVER:
            return False
        if self.visibility == VISIBILITY_PUBLIC:
            return True
        return seat_index is not None and seat_index == self.visible_to_seat


@dataclass
class ArenaTurn:
    """One turn and its deadline."""

    match_id: str
    turn_seq: int
    phase: str
    deadline_at: datetime
    seat_index: Optional[int] = None
    opened_at: datetime = field(default_factory=_now)
    resolved_at: Optional[datetime] = None
    resolution: Optional[str] = None
    resolved_by_key: Optional[str] = None

    def is_open(self) -> bool:
        return self.resolved_at is None

    def is_overdue_at(self, now: datetime, grace_seconds: float = 0.0) -> bool:
        """Has this turn expired, allowing for the action grace window?

        THE GRACE WINDOW IS THE FIX FOR A DESTROYED HUMAN ACTION, and it is
        modelled here rather than at the call site so every path -- a poll, a
        command, the overdue sweep -- agrees on when a turn is dead. Two
        readers that disagreed by even a millisecond would reintroduce the race
        this exists to close.

        WHAT WENT WRONG WITHOUT IT. `submit_command` runs the clock before
        applying a command, deliberately, so a late action loses to the timeout
        rather than beating it by being the request that happened to trigger
        the sweep. With a zero-width window, "late" included a bid the player
        pressed while their countdown still read a positive number: the client
        seeds that countdown from a poll, so it could be up to one poll
        interval stale, and the request then spent a network round trip in
        flight. A reproduction against the real repository showed a `$2` bid
        submitted 120 ms past the deadline being swept, the lot awarded to the
        bot at `$1`, and the human's command rejected as `stale_state_version`.

        The grace is a property of the SERVER's clock, not a client's claim
        about when it clicked -- there is no timestamp in the request body that
        could be moved. It cannot be used to act twice, because the turn is
        still resolved the moment any action lands. And it does not extend the
        visible clock: `seconds_remaining` is still measured to `deadline_at`,
        so a player never sees a number that includes it.
        """
        if self.resolved_at is not None:
            return False
        return (now - _utc(self.deadline_at)).total_seconds() > grace_seconds


@dataclass
class ArenaResult:
    """One seat's final outcome. Immutable once written."""

    match_id: str
    seat_index: int
    placement: int
    score: float
    outcome: str
    rated: bool
    was_bot: bool
    detail: dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=_now)


@dataclass
class ArenaQueueEntry:
    """One durable waiting-room entry."""

    entry_id: str
    owner_sub: str
    mode: str
    mode_version: str
    seat_count: int
    human_preference_until: datetime
    expires_at: datetime
    status: str = QUEUE_STATUS_WAITING
    joined_at: datetime = field(default_factory=_now)
    matched_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    match_id: Optional[str] = None

    def prefers_humans_at(self, now: datetime) -> bool:
        """True while this entry must not be filled with bots."""
        return now < _utc(self.human_preference_until)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CommandRequest:
    """One attempted mutation.

    Carries the four things the contract requires of every mutation: an
    authenticated subject, an expected state version, an idempotency key, and a
    server timestamp (`issued_at`, stamped by the route from the server clock --
    never read from the request body).
    """

    match_id: str
    idempotency_key: str
    command_type: str
    payload: dict = field(default_factory=dict)

    # The caller. None ONLY for a server-issued command (a timeout resolution
    # has no actor). A route never constructs one of those: `command_type`
    # would have to be COMMAND_TYPE_TIMEOUT, which `validate_client_command`
    # refuses.
    actor_sub: Optional[str] = None
    actor_seat_index: Optional[int] = None

    # The version the caller believes it is acting on. None means "unversioned"
    # and is accepted ONLY for server-issued commands, for the reason in
    # `apply_command`'s docstring: a timeout is not racing a stale client, it is
    # racing the action that would beat it, and that race is settled by the turn
    # row rather than by a version comparison.
    expected_state_version: Optional[int] = None

    issued_at: datetime = field(default_factory=_now)

    def is_server_issued(self) -> bool:
        return self.actor_sub is None


@dataclass(frozen=True)
class CommandOutcome:
    """What `apply_command` decided.

    `replayed` is the idempotency signal: True means this key had already been
    recorded and NOTHING was applied on this call -- the match, events and
    verdict returned are the ones from the original. A caller must not treat a
    replay as a fresh acceptance (e.g. by awarding progression twice).
    """

    accepted: bool
    replayed: bool
    match: ArenaMatch
    events: tuple[ArenaEvent, ...] = ()
    rejection_code: Optional[str] = None
    rejection_message: Optional[str] = None


class ArenaRepositoryError(RuntimeError):
    """Base class for arena repository invariant violations."""


#: Bounds on an idempotency key, mirrored from the schema.
#:
#: `arena_match_commands.idempotency_key` carries
#: `CHECK (char_length(idempotency_key) BETWEEN 8 AND 128)`
#: (20260804100000_arena_foundation.sql:335). Postgres enforced it and the
#: memory backend did not, so a key shorter than 8 characters passed the whole
#: unit suite and raised CheckViolationError only against a real database --
#: found by `test_repository_conformance.py`, which exists for exactly this.
#:
#: These constants are the schema's numbers restated ONCE so both backends read
#: the same source. A lower bound at all is deliberate: a one-character key is
#: almost always a placeholder rather than a real client-generated token, and a
#: placeholder that collides silently replays somebody else's verdict.
IDEMPOTENCY_KEY_MIN_LENGTH = 8
IDEMPOTENCY_KEY_MAX_LENGTH = 128


class InvalidIdempotencyKey(ArenaRepositoryError):
    """The key is outside the length the schema accepts.

    Raised by BOTH backends, so a caller cannot pass a key that works in tests
    and fails in production. Distinct from a generic ValueError so a route can
    answer 400 rather than 500 -- this is a malformed request, not a server
    fault.
    """


def validate_idempotency_key(key: str) -> None:
    """Raise `InvalidIdempotencyKey` unless `key` satisfies the schema's CHECK.

    Called by the memory backend to reproduce a constraint Postgres applies for
    free. The Postgres path does not call it: letting the database be the one
    that enforces its own constraint keeps a single source of truth there, and
    the conformance suite asserts both surfaces raise.
    """
    if not (IDEMPOTENCY_KEY_MIN_LENGTH <= len(key) <= IDEMPOTENCY_KEY_MAX_LENGTH):
        raise InvalidIdempotencyKey(
            f"idempotency_key must be {IDEMPOTENCY_KEY_MIN_LENGTH}..."
            f"{IDEMPOTENCY_KEY_MAX_LENGTH} characters, got {len(key)}"
        )


class MatchNotFound(ArenaRepositoryError):
    """No such match. Distinguished from 'not your match' so a route can answer
    404 and 403 separately -- the same split `RunTheTableRunRepository.get_run`
    documents."""


class SeatUnavailable(ArenaRepositoryError):
    """The seat is taken, the match is full, or this subject already holds a
    seat in it.

    Raised by the repository rather than checked-then-inserted by the caller,
    because "is there a free seat?" followed by "take it" is a race two tabs can
    both win. The uniqueness lives in the storage layer in both implementations
    (`arena_match_seats_one_per_sub_uniq` plus the primary key in Postgres, one
    lock in memory) -- the same construction `ParticipantSlotTaken` uses
    (`head_to_head_protocols.py:90-97`).
    """


class ActiveQueueEntryExists(ArenaRepositoryError):
    """This subject already has a waiting entry in this queue."""


# ---------------------------------------------------------------------------
# The reducer boundary -- how a mode plugs in without this layer knowing it
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EventDraft:
    """An event a reducer wants appended. `seq` and `state_version_after` are
    assigned by the repository, not by the mode -- a mode that numbered its own
    events could collide with a concurrent writer."""

    event_type: str
    payload: dict = field(default_factory=dict)
    actor_seat_index: Optional[int] = None
    visibility: str = VISIBILITY_PUBLIC
    visible_to_seat: Optional[int] = None


@dataclass(frozen=True)
class TurnDraft:
    """A turn a reducer wants opened. `turn_seq` is assigned by the repository."""

    phase: str
    deadline_at: datetime
    seat_index: Optional[int] = None


@dataclass(frozen=True)
class ResultDraft:
    """One seat's final result, produced by a reducer at completion."""

    seat_index: int
    placement: int
    score: float
    outcome: str
    detail: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ReducerInput:
    """Everything a reducer is allowed to see. Deliberately a snapshot of
    committed state plus the command -- no repository, no connection, no clock."""

    match: ArenaMatch
    seats: tuple[ArenaSeat, ...]
    open_turn: Optional[ArenaTurn]
    command: CommandRequest
    now: datetime


@dataclass(frozen=True)
class ReducerOutput:
    """A reducer's verdict.

    On rejection: `snapshot` is ignored, no events are written, no turn moves,
    and `state_version` does NOT advance -- a rejected command must not
    invalidate every other client's cached version.
    """

    accepted: bool
    rejection_code: Optional[str] = None
    rejection_message: Optional[str] = None
    snapshot: Optional[dict] = None
    events: tuple[EventDraft, ...] = ()
    # Resolve the currently-open turn with this resolution. A reducer that
    # accepts a play normally passes TURN_RESOLUTION_ACTION.
    resolve_turn: Optional[str] = None
    # Open the next turn. None means the match has no open turn afterwards
    # (either it is between phases or it is over).
    open_turn: Optional[TurnDraft] = None
    # New match status, or None to leave it unchanged.
    status: Optional[str] = None
    # Written only when `status` is MATCH_STATUS_COMPLETED.
    results: tuple[ResultDraft, ...] = ()


@runtime_checkable
class MatchReducer(Protocol):
    """A mode's rules, as a pure function.

    CALLED INSIDE A DATABASE TRANSACTION, HOLDING A ROW LOCK. Three constraints
    follow from that and none of them is stylistic:

    1. NO I/O. No database access, no HTTP, no file reads. Every byte a reducer
       needs is in `ReducerInput`. A reducer that awaits something holds the
       match's row lock across that await, so one slow call becomes every
       player in that match blocked.

    2. NO CLOCK. Use `ReducerInput.now`, never `datetime.now()`. The timestamp
       is passed in so a replay produces the same verdict as the original --
       the same discipline `nba_peak/run_the_table/daily.py:68-71` states for
       `daily_seed` ("Pure: never reads a clock").

    3. NO MUTATION OF THE INPUT. `ReducerInput` holds the repository's own
       objects in the memory backend. Return a new snapshot dict; do not edit
       the one you were given, or the memory backend will persist a change that
       the Postgres backend would have discarded, and the two will disagree
       exactly where a test cannot see it.

    Synchronous on purpose: `async def` would invite exactly the I/O that
    constraint 1 forbids.
    """

    def __call__(self, data: ReducerInput) -> ReducerOutput: ...


# ---------------------------------------------------------------------------
# The hidden-information boundary
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SeatView:
    """What ONE seat is allowed to know.

    THIS TYPE IS THE HIDDEN-INFORMATION GUARANTEE, and it is a guarantee because
    of what it does not have. There is no `match` field, no `snapshot` field, no
    `seats` field, no repository handle and no connection. A holder of a
    `SeatView` cannot reach the authoritative state to peek at an unrevealed
    card, an opposing sealed bid, or a future roll, because it holds no
    reference through which the attempt could be made.

    That matters most for bots. A bot that took `ArenaMatch` would be one
    attribute access away from omniscience, and "the bot does not look at
    `snapshot['hidden']`" would be a comment rather than a property. `BotPolicy`
    below therefore accepts a `SeatView` and nothing else.

    `public_state` and `private_state` are produced by the mode's own
    projection. This layer never fills them, and never inspects them.
    """

    match_id: str
    mode: str
    seat_index: int
    seat_count: int
    state_version: int
    status: str
    # What every seat may see.
    public_state: dict = field(default_factory=dict)
    # What THIS seat may additionally see: its own hand, its own sealed bid.
    private_state: dict = field(default_factory=dict)
    # The command types this seat may legally issue right now, as the mode
    # computed them. A bot picks from this rather than guessing, which is also
    # what stops a bot from probing for legality as an information channel.
    legal_commands: tuple[str, ...] = ()
    # Seconds remaining on this seat's turn, or None when it is not their turn.
    # A duration rather than a deadline so a bot cannot compare it against a
    # wall clock it should not be reading.
    seconds_remaining: Optional[float] = None


@dataclass(frozen=True)
class BotCommand:
    """What a bot decided to do. Deliberately not a `CommandRequest`: a bot does
    not choose its own match id, its own seat, its own idempotency key or its own
    timestamp. The driver supplies all four, so a bot cannot address a command at
    a match or a seat it was not asked about."""

    command_type: str
    payload: dict = field(default_factory=dict)


@runtime_checkable
class BotPolicy(Protocol):
    """A bot, structurally unable to cheat.

    Receives a `SeatView` -- which carries no path to the authoritative state --
    and a seeded `random.Random` supplied by the driver, so a bot cannot draw
    from an unseeded global source and make a match unreproducible.

    Async because a future policy may want to call a model; the `SeatView`
    boundary holds regardless of how long it takes, since a bot runs OUTSIDE the
    match transaction (the driver applies its returned command afterwards, as a
    normal command, through the same `apply_command` every human uses).
    """

    @property
    def bot_id(self) -> str: ...

    @property
    def policy_version(self) -> str: ...

    #: The rating this bot is calibrated at, pinned onto the seat so a later
    #: recalibration cannot retroactively change what a settled rated match was
    #: played against.
    @property
    def rating(self) -> float: ...

    async def choose(self, view: SeatView, rng: Any) -> BotCommand: ...


def project_seat_view(
    match: ArenaMatch,
    seat: ArenaSeat,
    public_state: dict,
    private_state: dict,
    legal_commands: tuple[str, ...],
    open_turn: Optional[ArenaTurn],
    now: datetime,
) -> SeatView:
    """Build a `SeatView` from committed state plus a mode's own projection.

    The mode decides what `public_state` and `private_state` contain; this
    function decides the envelope, so every mode's view carries the same
    identity fields and the same clock treatment. Deep-copied on the way in:
    a view handed to a bot must not alias the repository's snapshot, or a
    careless policy could mutate live state through it.
    """
    seconds_remaining: Optional[float] = None
    if open_turn is not None and open_turn.is_open():
        if open_turn.seat_index is None or open_turn.seat_index == seat.seat_index:
            seconds_remaining = max(
                0.0, (_utc(open_turn.deadline_at) - now).total_seconds()
            )
    return SeatView(
        match_id=match.match_id,
        mode=match.mode,
        seat_index=seat.seat_index,
        seat_count=match.seat_count,
        state_version=match.state_version,
        status=match.status,
        public_state=copy.deepcopy(public_state),
        private_state=copy.deepcopy(private_state),
        legal_commands=tuple(legal_commands),
        seconds_remaining=seconds_remaining,
    )


def validate_client_command(command_type: str) -> None:
    """Refuse a client command that impersonates the server.

    `COMMAND_TYPE_TIMEOUT` is issued by the clock and by nothing else. Without
    this check a client could post `{"command_type": "__timeout__"}` against
    their opponent's turn and forfeit it on demand -- the whole timeout
    mechanism inverted into a weapon. Checked at the boundary rather than in the
    reducer so no mode can forget it.
    """
    if command_type == COMMAND_TYPE_TIMEOUT:
        raise ValueError(
            f"{command_type!r} is server-issued and cannot be sent by a client."
        )


# ---------------------------------------------------------------------------
# The repository interface
# ---------------------------------------------------------------------------


@runtime_checkable
class ArenaRepository(Protocol):
    # -- matches ------------------------------------------------------------

    async def create_match(
        self, match: ArenaMatch, seats: list[ArenaSeat]
    ) -> ArenaMatch:
        """Insert a match and its initial seats atomically.

        One call, not two, for the reason `HeadToHeadRepository.create_match`
        gives: a match with no seats is a row no route can reach, because the
        seat check would reject its own creator.
        """
        ...

    async def get_match(self, match_id: str) -> Optional[ArenaMatch]:
        """One match by id, regardless of who is asking. Authorization is the
        caller's job so a route can answer 404 and 403 separately."""
        ...

    async def find_match_by_room_code(self, room_code: str) -> Optional[ArenaMatch]:
        """The LIVE match a room code resolves to, or None. Never returns a
        finished match: a code is reusable once its match ends."""
        ...

    async def get_seats(self, match_id: str) -> list[ArenaSeat]:
        """Every seat, ordered by seat_index."""
        ...

    async def get_seat_for_sub(
        self, match_id: str, occupant_sub: str
    ) -> Optional[ArenaSeat]:
        """This caller's seat, or None if they hold none."""
        ...

    async def add_seat(self, seat: ArenaSeat) -> ArenaSeat:
        """Seat a player or a bot.

        Raises SeatUnavailable if the index is taken, if this subject already
        holds a seat, or if the match already has `seat_count` seats.
        """
        ...

    async def touch_seat(
        self, match_id: str, seat_index: int, now: datetime
    ) -> None:
        """Stamp `last_seen_at`. Advisory liveness only; nothing forfeits on it."""
        ...

    async def list_matches_for_sub(
        self, occupant_sub: str, limit: int = 20
    ) -> list[ArenaMatch]:
        """Every match this subject holds a seat in, newest first."""
        ...

    async def set_bot_policy_version(self, match_id: str, policy_version: str) -> bool:
        """Pin the bot policy this match's bots were seated under. Returns True
        iff THIS caller set it.

        FIRST WRITE WINS, and the statement says so rather than the caller:
        `WHERE bot_policy_version IS NULL`. A match created already carrying a
        version (the public-queue fill, which knows at creation time) is never
        overwritten, and two concurrent host fills pin one value rather than
        racing to replace each other's.

        Exists because a private room is created with no bots and therefore no
        policy version -- the host's later "fill empty seats" is the first
        moment there is one to record. Pinning it at seat time rather than
        reading the current policy at scoring time is the same discipline
        `bots.bot_seat` applies to `bot_rating`, and for the same reason: a
        recalibration must not retroactively change what a settled match was
        played against.
        """
        ...

    # -- the mutation path --------------------------------------------------

    async def apply_command(
        self,
        request: CommandRequest,
        reducer: MatchReducer,
        now: datetime,
    ) -> CommandOutcome:
        """Apply one command atomically. THE method of this domain.

        Sequence, all inside one transaction holding the match's row lock:

          1. Lock the match row (blocking -- see the implementation note below).
          2. If (match_id, idempotency_key) is already recorded, return the
             recorded outcome with `replayed=True` and apply NOTHING.
          3. If the match is not live, or its clock has run out, reject.
          4. If `expected_state_version` is supplied and does not equal the
             match's, reject with REJECT_STALE_STATE_VERSION.
          5. Call the reducer.
          6. Record the command -- accepted or rejected -- so a retry of either
             verdict is idempotent.
          7. On acceptance only: bump `state_version` by exactly one, write the
             snapshot, append the events, resolve/open turns, and write results.

        WHY THE LOCK BLOCKS RATHER THAN SKIPS. The one row lock in this codebase
        before this method is `FOR UPDATE SKIP LOCKED`
        (`ranked_postgres.py:293-301`), which is right for matchmaking: a
        contended queue entry means "somebody else claimed this player, go find
        another." It is wrong here. Two commands against one match are not
        interchangeable candidates -- skipping the second would silently drop a
        player's move rather than serialize it behind the first. So this waits.

        EXPECTED VERSION IS OPTIONAL, AND ONLY FOR THE SERVER. A timeout carries
        none: it is not racing a stale client, it is racing the action that
        would beat it, and that race is settled by the turn row's
        `WHERE resolved_at IS NULL` -- see `resolve_overdue_turn`. Requiring a
        version there would mean reading one first, which reintroduces the
        check-then-write the lock exists to remove.
        """
        ...

    # -- turns and the clock ------------------------------------------------

    async def get_open_turn(self, match_id: str) -> Optional[ArenaTurn]:
        """The currently-open turn, or None."""
        ...

    async def list_overdue_matches(
        self, mode: Optional[str], now: datetime, limit: int = 50
    ) -> list[str]:
        """Match ids with an open turn past its deadline, or a match clock past
        `expires_at`. The lazy sweep's input.

        Lazy rather than a background worker because no background runner exists
        in this application -- no APScheduler, no Celery, no cron, no
        `asyncio.create_task` in application code -- and inventing one for this
        would be a new deployment surface. Ranked reached the same conclusion for
        its queue TTL and documented it (`services/ranked/matchmaking.py:66-68`).
        The difference from ranked is that this one is actually WIRED: ranked's
        `ranked_matches.deadline` is written and never compared anywhere.
        """
        ...

    async def resolve_overdue_turn(
        self, match_id: str, turn_seq: int, now: datetime, resolution: str
    ) -> bool:
        """Claim an open turn for the clock. Returns True iff THIS caller won.

        The whole timeout-vs-action race, in one statement:
        `UPDATE ... SET resolved_at = $now WHERE resolved_at IS NULL`. Exactly
        one caller affects a row; every other observes zero and must abandon
        rather than retry. A caller that reads the row first to decide whether
        to resolve it has reintroduced the race this method exists to remove.
        """
        ...

    async def expire_match(self, match_id: str, now: datetime) -> bool:
        """Move a live match past its clock to `expired`. Returns True iff this
        call did it -- `WHERE status IN (live)` makes it first-write-wins, so
        two concurrent sweeps cannot both report having expired it."""
        ...

    # -- events -------------------------------------------------------------

    async def list_events(
        self,
        match_id: str,
        after_seq: int = -1,
        for_seat: Optional[int] = None,
        limit: int = 200,
    ) -> list[ArenaEvent]:
        """Events after `after_seq`, in order, FILTERED FOR `for_seat`.

        `for_seat=None` means "server view" and returns everything including
        `server`-visibility rows; it must never be reached from a client-facing
        route. Filtering happens in the query rather than in the caller, because
        a filter the caller applies is a filter some future caller forgets --
        which is exactly how an opponent's run_id ended up in a settled
        head-to-head receipt (`api/v1/head_to_head.py:183-201`).
        """
        ...

    # -- results ------------------------------------------------------------

    async def get_results(self, match_id: str) -> list[ArenaResult]:
        """Every seat's final result, ordered by placement then seat index.
        Empty until the match completes."""
        ...

    async def get_player_stats(
        self,
        mode: str,
        owner_subs: Sequence[str],
        detail_keys: Sequence[str] = (),
    ) -> dict[str, "ArenaPlayerStats"]:
        """Aggregates over these players' RATED results in one mode.

        LIVES HERE, NOT ON THE RATING REPOSITORY, because it is an aggregate
        over `arena_match_results` joined to `arena_match_seats` -- this
        repository's own tables. A rating repository reaching into them is how
        two repositories end up jointly owning one table.

        DERIVED, NEVER MATERIALISED. There is no statistics table to fall out of
        step with the results it summarises; the migration
        (20260804140000_arena_ratings.sql) explains the choice and adds the
        partial index that makes it cheap.

        `detail_keys` names numeric keys to average and max out of the result
        `detail` JSONB, so this method stays mode-agnostic: Three-Man Weave asks
        for `lineup_peak_score`, the $20 Showdown asks for `budget_remaining`
        and `peak3_per_dollar`, and a third mode needs no change here. A key
        that is absent or non-numeric is skipped rather than defaulted -- a
        missing measurement is missing, not zero.

        ONLY RATED RESULTS COUNT, mirroring the rating pass: private-room and
        practice matches are excluded, so a leaderboard statistic can never
        describe a match that did not affect a rating.
        """
        ...

    # -- public queue -------------------------------------------------------

    async def enqueue(self, entry: ArenaQueueEntry) -> ArenaQueueEntry:
        """Join the public queue. Raises ActiveQueueEntryExists if this subject
        already has a waiting entry for this mode."""
        ...

    async def get_queue_entry(
        self, owner_sub: str, mode: str
    ) -> Optional[ArenaQueueEntry]:
        """This subject's waiting entry for this mode, or None."""
        ...

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        """Withdraw. Returns True iff an entry was actually cancelled."""
        ...

    async def collapse_human_preference(
        self, owner_sub: str, mode: str, now: datetime
    ) -> Optional[ArenaQueueEntry]:
        """Bring this subject's OWN human-preference window forward to `now`, so
        bots may fill immediately. Returns the updated entry, or None when this
        subject has no waiting entry for this mode.

        THE WINDOW STAYS AN ABSOLUTE INSTANT. `services/arena/matchmaking.py`'s
        module docstring explains why `human_preference_until` is a stored
        instant rather than a duration: two readers a millisecond apart must
        never disagree about whether it has elapsed. "Fill with bots now"
        therefore WRITES a new instant rather than passing a fudged clock into
        the matcher -- after this returns, every reader agrees, which is exactly
        the property that faking `now` at one call site would destroy.

        MONOTONIC, NEVER EXTENDING. The stored value becomes the EARLIER of the
        existing instant and `now`, so this can only bring the window forward.
        A double-click is therefore a no-op on the second press rather than a
        way to push the window out, and the operation is safely repeatable
        without a separate idempotency record.

        Scoped to `owner_sub` inside the statement rather than checked by the
        caller: this can only ever collapse the caller's own window.
        """
        ...

    async def list_waiting_entries(
        self,
        mode: str,
        seat_count: int,
        exclude_owner_sub: Optional[str] = None,
        limit: int = 50,
    ) -> list[ArenaQueueEntry]:
        """Waiting entries for one (mode, seat_count), longest-waiting first."""
        ...

    async def expire_stale_queue_entries(self, mode: str, now: datetime) -> int:
        """Sweep entries past their TTL. Returns the number swept.

        One UPDATE, no read-then-write: two workers sweeping concurrently both
        narrow on `status = 'waiting'`, so the second matches zero rows rather
        than double-expiring anything -- exactly
        `expire_stale_queue_entries`'s construction in `ranked_postgres.py:262-272`.
        """
        ...

    async def claim_entries_into_match(
        self,
        entry_ids: list[str],
        match: ArenaMatch,
        seats: list[ArenaSeat],
        now: datetime,
    ) -> Optional[ArenaMatch]:
        """Atomically claim N waiting entries and create the match they fill.

        Returns None if ANY entry was no longer claimable -- the caller then
        knows it lost the race and must try a different set, exactly as
        `create_match_atomically` returns None on a lost pairing race
        (`ranked_postgres.py:302-303`).

        Unlike ranked, this one is all-or-nothing across N entries rather than
        exactly two, which is why it takes a list. It uses a BLOCKING lock, not
        SKIP LOCKED: with three seats, SKIP LOCKED makes a contended entry look
        identical to a cancelled one, and the matchmaker would churn through
        candidates it could simply have waited 2ms for.
        """
        ...
