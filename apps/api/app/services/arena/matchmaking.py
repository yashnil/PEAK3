"""The three entry paths, and the rated policy that follows from them.

  public_queue   matchmade against strangers; humans preferred for 30s, then
                 bots fill the remaining seats.        RATED.
  private_room   joined with a short code; NEVER auto-filled.  UNRATED.
  practice       explicitly against bots, starts immediately.  UNRATED.

RATED IS DERIVED, NOT PASSED IN. `is_rated` below is the only place the policy
is written in Python, and the database carries the same rule as a CHECK
(`arena_matches_rated_matches_entry_path`), so a caller that constructed a rated
private match would be rejected by the storage layer rather than quietly
recorded. Two statements of one rule, deliberately: the CHECK cannot be
forgotten, and the function keeps the reason readable.

A PUBLIC MATCH FILLED WITH BOTS IS STILL RATED, and that is the interesting
case. The alternative -- unrate a match once a bot joins -- creates an exploit
with no counter: queue at a quiet hour, wait out the window, and every match you
play is unrated practice while you occupy a real queue slot. It also punishes the
player who queued honestly at 3am for the crime of nobody else being awake. The
bot's calibrated rating is pinned onto the seat (`bots.bot_seat`) precisely so a
rating pass can score that match correctly rather than having to discard it.

WHY THE HUMAN-PREFERENCE WINDOW IS A STORED TIMESTAMP
------------------------------------------------------
`arena_public_queue.human_preference_until` is an absolute instant, decided once
by the server at join. A duration would have to be re-applied against a clock on
every check, and two checks a millisecond apart could disagree about whether it
had elapsed -- so a player could be bot-filled by one request and human-matched
by another racing it. An instant is decided once and every reader agrees.

NO BACKGROUND MATCHMAKER. Pairing is attempted synchronously on join and on
poll, exactly as ranked does (`services/ranked/matchmaking.py:1-14`), because
there is no background runner in this application. The consequence is the same
one ranked has: a player alone in the queue is paired by the NEXT joiner's
request, or by their own poll once the window lapses and bots may fill.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.repositories.arena_protocols import (
    ENTRY_PATH_PRACTICE,
    ENTRY_PATH_PRIVATE_ROOM,
    ENTRY_PATH_PUBLIC_QUEUE,
    MATCH_STATUS_ACTIVE,
    OCCUPANT_HUMAN,
    ArenaMatch,
    ArenaQueueEntry,
    ArenaRepository,
    ArenaSeat,
    SeatUnavailable,
)
from app.services.arena import bots as bot_service
from app.services.arena.modes import ArenaMode

logger = logging.getLogger(__name__)

#: How long the matchmaker holds out for a human before filling with bots.
#: 30 seconds is the product decision recorded in the implementation contract.
HUMAN_PREFERENCE_WINDOW = timedelta(seconds=30)

#: How long a waiting entry stays matchable before it is swept.
#: Ten minutes, matching ranked's QUEUE_ENTRY_TTL and for the same reason
#: (`services/ranked/matchmaking.py:48-68`): a queue entry outlives the tab that
#: created it, so without a TTL the queue accumulates ghosts and the next
#: genuine joiner is paired with someone who closed their browser.
QUEUE_ENTRY_TTL = timedelta(minutes=10)

#: How long a whole match may live before its own clock closes it.
MATCH_TTL = timedelta(hours=2)

#: Room-code alphabet. No 0/O/1/I/L -- the code is read aloud and typed by hand,
#: and a code that is ambiguous in a voice call is a support ticket.
_ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_ROOM_CODE_LENGTH = 6


def is_rated(entry_path: str) -> bool:
    """The rated policy, in one place. See the module docstring."""
    return entry_path == ENTRY_PATH_PUBLIC_QUEUE


def _now() -> datetime:
    return datetime.now(timezone.utc)


def generate_room_code() -> str:
    """A short, human-transcribable code.

    `secrets`, not `random`: guessing a live code is guessing your way into a
    stranger's private match. 31^6 is ~887 million, which is not a
    cryptographic secret and is not treated as one -- the route rate-limits
    lookups and the code only ever grants the right to seat YOURSELF, the same
    posture the head-to-head invite takes
    (`20260801160000_head_to_head.sql:64-72`).
    """
    return "".join(secrets.choice(_ROOM_CODE_ALPHABET) for _ in range(_ROOM_CODE_LENGTH))


def _human_seat(match_id: str, seat_index: int, sub: str, display_name: str) -> ArenaSeat:
    return ArenaSeat(
        match_id=match_id,
        seat_index=seat_index,
        occupant_kind=OCCUPANT_HUMAN,
        occupant_sub=sub,
        display_name=display_name,
    )


def _new_match(
    mode: ArenaMode,
    entry_path: str,
    created_by: str,
    seed: int,
    now: datetime,
    room_code: Optional[str] = None,
    bot_policy_version: Optional[str] = None,
    model_version: str = "peak3_v1",
) -> ArenaMatch:
    return ArenaMatch(
        match_id=str(uuid.uuid4()),
        mode=mode.mode,
        mode_version=mode.mode_version,
        model_version=model_version,
        seat_count=mode.seat_count,
        entry_path=entry_path,
        rated=is_rated(entry_path),
        seed=seed,
        created_by=created_by,
        expires_at=now + MATCH_TTL,
        room_code=room_code,
        bot_policy_version=bot_policy_version,
        created_at=now,
        updated_at=now,
    )


def _new_seed() -> int:
    """A fresh match seed.

    `secrets.randbelow(2**31)` matches the space every other mode in this
    repository draws from (`services/run_the_table/runs.py:184`), so a seed is
    portable across them and fits the `BIGINT` column with room to spare.
    """
    return secrets.randbelow(2**31)


# ---------------------------------------------------------------------------
# Practice -- starts immediately, all other seats are bots
# ---------------------------------------------------------------------------


async def start_practice(
    repo: ArenaRepository,
    mode: ArenaMode,
    owner_sub: str,
    display_name: str,
    now: Optional[datetime] = None,
) -> ArenaMatch:
    """Create a practice match that is playable on return. Always UNRATED."""
    now = now or _now()
    policy = bot_service.registry.default_for(mode.mode)
    match = _new_match(
        mode, ENTRY_PATH_PRACTICE, owner_sub, _new_seed(), now,
        bot_policy_version=policy.policy_version,
    )
    seats = [_human_seat(match.match_id, 0, owner_sub, display_name)]
    for index in range(1, mode.seat_count):
        seats.append(bot_service.bot_seat(match.match_id, index, policy))
    return await _create_and_open(repo, mode, match, seats, now)


# ---------------------------------------------------------------------------
# Private room -- a code, and never an auto-fill
# ---------------------------------------------------------------------------


async def create_private_room(
    repo: ArenaRepository,
    mode: ArenaMode,
    owner_sub: str,
    display_name: str,
    now: Optional[datetime] = None,
) -> ArenaMatch:
    """Open a private room. Always UNRATED, and NEVER auto-filled with bots.

    A private room is people who chose each other; filling an empty seat with a
    bot because a friend was slow to click the link would replace the thing
    they asked for with something else. The room simply waits, and its own
    `expires_at` closes it if nobody comes.

    The room starts in `forming` and only becomes `active` when the last seat is
    taken (see `join_private_room`), so no turn opens -- and therefore no
    deadline runs -- while seats are still empty. A creator who opened a room and
    walked away is not forfeiting a turn they were never given.
    """
    now = now or _now()
    for attempt in range(5):
        code = generate_room_code()
        match = _new_match(
            mode, ENTRY_PATH_PRIVATE_ROOM, owner_sub, _new_seed(), now, room_code=code
        )
        seats = [_human_seat(match.match_id, 0, owner_sub, display_name)]
        try:
            return await repo.create_match(match, seats)
        except SeatUnavailable:
            # The live-code unique index refused it. Retry with a new code
            # rather than surfacing a collision to the player: at 887M codes a
            # collision means an unlucky draw, not a full namespace.
            logger.info("arena: room code collision on attempt %d", attempt + 1)
            continue
    raise SeatUnavailable("could not allocate a free room code")


async def join_private_room(
    repo: ArenaRepository,
    mode: ArenaMode,
    room_code: str,
    owner_sub: str,
    display_name: str,
    now: Optional[datetime] = None,
) -> ArenaMatch:
    """Take a seat in a private room.

    Raises SeatUnavailable when the room is full, when this subject already
    holds a seat (which is also what stops the creator joining their own room
    twice), or when the code resolves to nothing live.

    The full/duplicate checks are the STORAGE layer's, not this function's --
    `add_seat` raises on the unique indexes. Checking here first and inserting
    afterwards is the race two tabs can both win.
    """
    now = now or _now()
    match = await repo.find_match_by_room_code(room_code)
    if match is None:
        raise SeatUnavailable("no live match for that room code")
    seats = await repo.get_seats(match.match_id)
    next_index = max((s.seat_index for s in seats), default=-1) + 1
    await repo.add_seat(
        _human_seat(match.match_id, next_index, owner_sub, display_name)
    )
    seats = await repo.get_seats(match.match_id)
    if len(seats) >= match.seat_count:
        return await _open_play(repo, mode, match.match_id, now)
    return await repo.get_match(match.match_id)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Public queue
# ---------------------------------------------------------------------------


async def join_queue(
    repo: ArenaRepository,
    mode: ArenaMode,
    owner_sub: str,
    now: Optional[datetime] = None,
) -> ArenaQueueEntry:
    """Join the public queue.

    Sweeps stale entries FIRST, before this entry can be paired against
    anything, and deliberately here rather than inside `try_match` -- so the
    sweep also runs for the joiner who finds nobody. Otherwise the queue is only
    ever cleaned by the player unlucky enough to be matched with a ghost, which
    is precisely the case the sweep exists to prevent
    (`services/ranked/matchmaking.py:94-98` makes the same argument).
    """
    now = now or _now()
    await repo.expire_stale_queue_entries(mode.mode, now)
    entry = ArenaQueueEntry(
        entry_id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        mode=mode.mode,
        mode_version=mode.mode_version,
        seat_count=mode.seat_count,
        human_preference_until=now + HUMAN_PREFERENCE_WINDOW,
        expires_at=now + QUEUE_ENTRY_TTL,
        joined_at=now,
    )
    return await repo.enqueue(entry)


async def try_match(
    repo: ArenaRepository,
    mode: ArenaMode,
    entry: ArenaQueueEntry,
    display_names: Optional[dict[str, str]] = None,
    now: Optional[datetime] = None,
) -> Optional[ArenaMatch]:
    """Try to fill a match around `entry`. Returns the match, or None.

    Two phases, in order:

      1. HUMANS. Take the longest-waiting compatible entries. If enough exist to
         fill every seat, pair them -- regardless of anyone's preference window,
         because a full table of humans is what the window is holding out FOR.
      2. BOTS. Only once `entry`'s own window has lapsed. Fill the remaining
         seats with the mode's default policy.

    Returns None while the window is still open and there are not enough humans:
    the entry stays queued and the next request tries again.
    """
    now = now or _now()
    display_names = display_names or {}

    candidates = await repo.list_waiting_entries(
        mode.mode, mode.seat_count, exclude_owner_sub=entry.owner_sub
    )
    needed = mode.seat_count - 1

    if len(candidates) >= needed:
        chosen = candidates[:needed]  # longest-waiting first -- fairness.
        return await _pair(repo, mode, [entry, *chosen], display_names, now)

    if entry.prefers_humans_at(now):
        return None  # still holding out for people.

    # Window lapsed: fill what is left with bots. Every human still waiting is
    # brought in first, so a bot never displaces a person who was available.
    return await _pair(
        repo, mode, [entry, *candidates], display_names, now, fill_with_bots=True
    )


async def _pair(
    repo: ArenaRepository,
    mode: ArenaMode,
    entries: list[ArenaQueueEntry],
    display_names: dict[str, str],
    now: datetime,
    fill_with_bots: bool = False,
) -> Optional[ArenaMatch]:
    policy = bot_service.registry.default_for(mode.mode)
    match = _new_match(
        mode, ENTRY_PATH_PUBLIC_QUEUE, entries[0].owner_sub, _new_seed(), now,
        bot_policy_version=policy.policy_version if fill_with_bots else None,
    )
    seats: list[ArenaSeat] = []
    for index, e in enumerate(entries[: mode.seat_count]):
        seats.append(
            _human_seat(
                match.match_id, index, e.owner_sub,
                display_names.get(e.owner_sub, "PEAK3 player"),
            )
        )
    if len(seats) < mode.seat_count:
        if not fill_with_bots:
            return None
        for index in range(len(seats), mode.seat_count):
            seats.append(bot_service.bot_seat(match.match_id, index, policy))

    claimed = await repo.claim_entries_into_match(
        [e.entry_id for e in entries[: mode.seat_count]], match, seats, now
    )
    if claimed is None:
        # Lost the race for one of the entries. The caller retries on the next
        # request rather than looping here, so a contended queue cannot turn one
        # request into an unbounded retry storm.
        return None
    return await _open_play(repo, mode, match.match_id, now)


# ---------------------------------------------------------------------------
# Opening play
# ---------------------------------------------------------------------------


async def _create_and_open(
    repo: ArenaRepository,
    mode: ArenaMode,
    match: ArenaMatch,
    seats: list[ArenaSeat],
    now: datetime,
) -> ArenaMatch:
    await repo.create_match(match, seats)
    return await _open_play(repo, mode, match.match_id, now)


async def _open_play(
    repo: ArenaRepository, mode: ArenaMode, match_id: str, now: datetime
) -> ArenaMatch:
    """Move a full match from `forming` to `active`, seed its snapshot, and open
    the first turn.

    Routed through `apply_command` like every other mutation rather than a
    direct UPDATE, so the opening gets the same row lock, the same idempotency
    key and the same event log entry as a move. The key is derived from the
    match id, so two requests that both observe the last seat being taken open
    the match once.
    """
    from app.repositories.arena_protocols import (
        CommandRequest,
        EventDraft,
        ReducerInput,
        ReducerOutput,
        TurnDraft,
    )

    seats = tuple(await repo.get_seats(match_id))

    def _open(data: ReducerInput) -> ReducerOutput:
        if data.match.status != "forming":
            return ReducerOutput(
                accepted=False,
                rejection_code="already_started",
                rejection_message="This match has already started.",
            )
        snapshot = mode.initial_snapshot(data.match.seed, data.seats)
        return ReducerOutput(
            accepted=True,
            snapshot=snapshot,
            status=MATCH_STATUS_ACTIVE,
            events=(
                EventDraft(
                    event_type="match_started",
                    payload={
                        "seat_count": data.match.seat_count,
                        "entry_path": data.match.entry_path,
                        "rated": data.match.rated,
                    },
                ),
            ),
            open_turn=TurnDraft(
                phase=mode.initial_phase(),
                deadline_at=data.now + timedelta(seconds=mode.turn_seconds),
                seat_index=0,
            ),
        )

    await repo.apply_command(
        CommandRequest(
            match_id=match_id,
            idempotency_key=f"open:{match_id}",
            command_type="__open__",
            actor_sub=None,
            expected_state_version=None,
            issued_at=now,
        ),
        _open,
        now,
    )
    return await repo.get_match(match_id)  # type: ignore[return-value]
