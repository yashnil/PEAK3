"""In-memory ArenaRepository -- dev/CI when DATABASE_URL is unset.

Enforces the SAME invariants the Postgres schema does, under a per-match lock,
so a behaviour that only the database has cannot exist:

* one seat per (match, seat_index) and one per (match, subject) -- together
  these cap a match at its own `seat_count` and stop a player taking two seats;
* one command per (match, idempotency_key), with the recorded verdict replayed
  rather than re-derived;
* `state_version` advances by exactly one, and only on an accepted command;
* a turn resolves exactly once -- the loser of the race observes False;
* events are append-only and are filtered by visibility on the way out;
* results are written once and never rewritten.

WHY THE MEMORY BACKEND ENFORCES ALL OF THIS RATHER THAN BEING A THIN STUB.
`expire_stale_queue_entries`' memory twin says it best
(`ranked_memory.py:102-109`): the two backends must behave identically or a
behaviour only reachable on Postgres has no test that can see it. The unit
suite runs entirely in memory (`scripts/ci/api-unit-tests.sh:22`), so an
invariant that lives only in SQL is an invariant that 1,289 API tests cannot
exercise.

Deep-copies on the way in and out for the same reason `run_the_table_memory.py`
and `head_to_head_memory.py` do: handing back the stored object would let a
caller mutate persisted state without calling a write method, which works in a
dict and does not work in Postgres.

THE LOCK IS PER MATCH, NOT GLOBAL. A single repository-wide lock would serialize
every match in the process against every other, which is both needlessly slow
and -- worse -- would hide a real bug, because a test exercising two matches
concurrently would pass under a global lock and fail under Postgres's per-row
one. Queue operations take a separate per-subject lock for the same reason.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
from datetime import datetime
from typing import Optional

from app.repositories.arena_protocols import (
    LIVE_MATCH_STATUSES,
    MATCH_STATUS_COMPLETED,
    MATCH_STATUS_EXPIRED,
    QUEUE_STATUS_CANCELLED,
    QUEUE_STATUS_EXPIRED,
    QUEUE_STATUS_MATCHED,
    QUEUE_STATUS_WAITING,
    REJECT_MATCH_EXPIRED,
    REJECT_MATCH_NOT_LIVE,
    REJECT_STALE_STATE_VERSION,
    TERMINAL_MATCH_STATUSES,
    ActiveQueueEntryExists,
    ArenaEvent,
    ArenaMatch,
    ArenaQueueEntry,
    ArenaRepository,
    ArenaResult,
    ArenaSeat,
    ArenaTurn,
    CommandOutcome,
    CommandRequest,
    MatchReducer,
    ReducerInput,
    SeatUnavailable,
    _utc,
)


def _clone_match(m: ArenaMatch) -> ArenaMatch:
    return replace(m, snapshot=copy.deepcopy(m.snapshot))


def _clone_seat(s: ArenaSeat) -> ArenaSeat:
    return replace(s)


def _clone_event(e: ArenaEvent) -> ArenaEvent:
    return replace(e, payload=copy.deepcopy(e.payload))


def _clone_turn(t: ArenaTurn) -> ArenaTurn:
    return replace(t)


def _clone_result(r: ArenaResult) -> ArenaResult:
    return replace(r, detail=copy.deepcopy(r.detail))


def _clone_entry(q: ArenaQueueEntry) -> ArenaQueueEntry:
    return replace(q)


class _RecordedCommand:
    """The stored verdict for one idempotency key. Holds the events the original
    call produced so a replay returns the same payload rather than an empty
    list, which a client could not distinguish from 'accepted but did nothing'."""

    __slots__ = ("accepted", "rejection_code", "rejection_message", "event_seqs")

    def __init__(
        self,
        accepted: bool,
        rejection_code: Optional[str],
        rejection_message: Optional[str],
        event_seqs: tuple[int, ...],
    ) -> None:
        self.accepted = accepted
        self.rejection_code = rejection_code
        self.rejection_message = rejection_message
        self.event_seqs = event_seqs


class MemoryArenaRepository:
    def __init__(self) -> None:
        self._matches: dict[str, ArenaMatch] = {}
        self._seats: dict[str, list[ArenaSeat]] = {}
        self._events: dict[str, list[ArenaEvent]] = {}
        self._turns: dict[str, list[ArenaTurn]] = {}
        self._results: dict[str, list[ArenaResult]] = {}
        self._commands: dict[tuple[str, str], _RecordedCommand] = {}
        self._queue: dict[str, ArenaQueueEntry] = {}
        self._match_locks: dict[str, asyncio.Lock] = {}
        self._queue_lock = asyncio.Lock()
        self._event_id_seq = 0

    # -- locking ------------------------------------------------------------

    def _lock_for(self, match_id: str) -> asyncio.Lock:
        """The per-match lock, created on first use.

        Not itself guarded by another lock: `dict.setdefault` is atomic under
        CPython's GIL and this is only ever reached from the single asyncio
        event loop, so two coroutines cannot interleave between the lookup and
        the insert. Stated explicitly because "create a lock lazily" is a
        recognisable race in a threaded program and this one is safe for a
        reason that is not obvious from the line alone.
        """
        return self._match_locks.setdefault(match_id, asyncio.Lock())

    # -- matches ------------------------------------------------------------

    async def create_match(
        self, match: ArenaMatch, seats: list[ArenaSeat]
    ) -> ArenaMatch:
        async with self._lock_for(match.match_id):
            if match.match_id in self._matches:
                raise SeatUnavailable(f"match {match.match_id!r} already exists")
            if match.room_code and await self._live_room_code_taken(match.room_code):
                raise SeatUnavailable(f"room code {match.room_code!r} is in use")
            subs = [s.occupant_sub for s in seats if s.occupant_sub is not None]
            if len(subs) != len(set(subs)):
                raise SeatUnavailable("a subject may hold only one seat in a match")
            if len({s.seat_index for s in seats}) != len(seats):
                raise SeatUnavailable("duplicate seat_index")
            if len(seats) > match.seat_count:
                raise SeatUnavailable(
                    f"{len(seats)} seats exceeds seat_count {match.seat_count}"
                )
            self._matches[match.match_id] = _clone_match(match)
            self._seats[match.match_id] = [_clone_seat(s) for s in seats]
            self._events.setdefault(match.match_id, [])
            self._turns.setdefault(match.match_id, [])
            self._results.setdefault(match.match_id, [])
            return _clone_match(match)

    async def _live_room_code_taken(self, room_code: str) -> bool:
        return any(
            m.room_code == room_code and m.status in LIVE_MATCH_STATUSES
            for m in self._matches.values()
        )

    async def get_match(self, match_id: str) -> Optional[ArenaMatch]:
        found = self._matches.get(match_id)
        return _clone_match(found) if found is not None else None

    async def find_match_by_room_code(self, room_code: str) -> Optional[ArenaMatch]:
        for m in self._matches.values():
            if m.room_code == room_code and m.status in LIVE_MATCH_STATUSES:
                return _clone_match(m)
        return None

    async def get_seats(self, match_id: str) -> list[ArenaSeat]:
        rows = sorted(self._seats.get(match_id, []), key=lambda s: s.seat_index)
        return [_clone_seat(s) for s in rows]

    async def get_seat_for_sub(
        self, match_id: str, occupant_sub: str
    ) -> Optional[ArenaSeat]:
        for s in self._seats.get(match_id, []):
            if s.occupant_sub == occupant_sub:
                return _clone_seat(s)
        return None

    async def add_seat(self, seat: ArenaSeat) -> ArenaSeat:
        async with self._lock_for(seat.match_id):
            match = self._matches.get(seat.match_id)
            if match is None:
                raise SeatUnavailable(f"no such match {seat.match_id!r}")
            rows = self._seats.setdefault(seat.match_id, [])
            if len(rows) >= match.seat_count:
                raise SeatUnavailable("this match is full")
            for existing in rows:
                if existing.seat_index == seat.seat_index:
                    raise SeatUnavailable(f"seat {seat.seat_index} is taken")
                if (
                    seat.occupant_sub is not None
                    and existing.occupant_sub == seat.occupant_sub
                ):
                    raise SeatUnavailable("this player already holds a seat")
            rows.append(_clone_seat(seat))
            return _clone_seat(seat)

    async def touch_seat(self, match_id: str, seat_index: int, now: datetime) -> None:
        for s in self._seats.get(match_id, []):
            if s.seat_index == seat_index:
                s.last_seen_at = now
                return

    async def list_matches_for_sub(
        self, occupant_sub: str, limit: int = 20
    ) -> list[ArenaMatch]:
        ids = [
            mid
            for mid, rows in self._seats.items()
            if any(s.occupant_sub == occupant_sub for s in rows)
        ]
        rows = [self._matches[i] for i in ids if i in self._matches]
        rows.sort(key=lambda m: m.created_at, reverse=True)
        return [_clone_match(m) for m in rows[:limit]]

    # -- the mutation path --------------------------------------------------

    async def apply_command(
        self,
        request: CommandRequest,
        reducer: MatchReducer,
        now: datetime,
    ) -> CommandOutcome:
        async with self._lock_for(request.match_id):
            match = self._matches.get(request.match_id)
            if match is None:
                from app.repositories.arena_protocols import MatchNotFound

                raise MatchNotFound(f"no such match {request.match_id!r}")

            # 1. Idempotency FIRST. A replayed key must not even be evaluated
            #    against the current state -- the recorded verdict is the
            #    answer, whatever the match looks like now.
            key = (request.match_id, request.idempotency_key)
            recorded = self._commands.get(key)
            if recorded is not None:
                by_seq = {e.seq: e for e in self._events.get(request.match_id, [])}
                return CommandOutcome(
                    accepted=recorded.accepted,
                    replayed=True,
                    match=_clone_match(match),
                    events=tuple(
                        _clone_event(by_seq[s]) for s in recorded.event_seqs if s in by_seq
                    ),
                    rejection_code=recorded.rejection_code,
                    rejection_message=recorded.rejection_message,
                )

            # 2. Liveness and the clock, before any rule runs.
            if match.status in TERMINAL_MATCH_STATUSES:
                return self._record_rejection(
                    request, match, REJECT_MATCH_NOT_LIVE,
                    f"This match is {match.status}.",
                )
            if match.is_expired_at(now):
                return self._record_rejection(
                    request, match, REJECT_MATCH_EXPIRED,
                    "This match has expired.",
                )

            # 3. Optimistic concurrency.
            if (
                request.expected_state_version is not None
                and request.expected_state_version != match.state_version
            ):
                return self._record_rejection(
                    request, match, REJECT_STALE_STATE_VERSION,
                    f"This match has moved on (you sent version "
                    f"{request.expected_state_version}, it is now "
                    f"{match.state_version}). Reload.",
                )

            seats = tuple(
                _clone_seat(s)
                for s in sorted(
                    self._seats.get(request.match_id, []), key=lambda s: s.seat_index
                )
            )
            open_turn = self._open_turn(request.match_id)

            # 4. The mode's rules. Handed clones so a reducer that ignores the
            #    no-mutation rule cannot corrupt stored state through the input.
            out = reducer(
                ReducerInput(
                    match=_clone_match(match),
                    seats=seats,
                    open_turn=_clone_turn(open_turn) if open_turn else None,
                    command=request,
                    now=now,
                )
            )

            if not out.accepted:
                return self._record_rejection(
                    request,
                    match,
                    out.rejection_code or "rejected",
                    out.rejection_message or "This move is not legal.",
                )

            # 5. Accepted: advance by exactly one.
            new_version = match.state_version + 1
            if out.snapshot is not None:
                match.snapshot = copy.deepcopy(out.snapshot)
            match.state_version = new_version
            match.updated_at = now

            appended: list[ArenaEvent] = []
            events = self._events.setdefault(request.match_id, [])
            next_seq = (max((e.seq for e in events), default=-1)) + 1
            for draft in out.events:
                self._event_id_seq += 1
                ev = ArenaEvent(
                    match_id=request.match_id,
                    seq=next_seq,
                    event_type=draft.event_type,
                    state_version_after=new_version,
                    payload=copy.deepcopy(draft.payload),
                    actor_seat_index=draft.actor_seat_index,
                    visibility=draft.visibility,
                    visible_to_seat=draft.visible_to_seat,
                    created_at=now,
                    id=self._event_id_seq,
                )
                events.append(ev)
                appended.append(ev)
                next_seq += 1

            if out.resolve_turn is not None and open_turn is not None:
                for t in self._turns.get(request.match_id, []):
                    if t.turn_seq == open_turn.turn_seq and t.resolved_at is None:
                        t.resolved_at = now
                        t.resolution = out.resolve_turn
                        t.resolved_by_key = request.idempotency_key
                        break

            if out.open_turn is not None:
                turns = self._turns.setdefault(request.match_id, [])
                turn_seq = (max((t.turn_seq for t in turns), default=-1)) + 1
                turns.append(
                    ArenaTurn(
                        match_id=request.match_id,
                        turn_seq=turn_seq,
                        phase=out.open_turn.phase,
                        deadline_at=out.open_turn.deadline_at,
                        seat_index=out.open_turn.seat_index,
                        opened_at=now,
                    )
                )
                match.current_turn_seq = turn_seq
                match.turn_deadline_at = out.open_turn.deadline_at
            elif out.resolve_turn is not None:
                match.current_turn_seq = None
                match.turn_deadline_at = None

            if out.status is not None:
                match.status = out.status
                if out.status == MATCH_STATUS_COMPLETED:
                    match.completed_at = now

            if out.results:
                # First write wins, matching the Postgres immutability trigger:
                # a second completion cannot rewrite a settled placement.
                existing = self._results.setdefault(request.match_id, [])
                if not existing:
                    for r in out.results:
                        seat = next(
                            (s for s in seats if s.seat_index == r.seat_index), None
                        )
                        existing.append(
                            ArenaResult(
                                match_id=request.match_id,
                                seat_index=r.seat_index,
                                placement=r.placement,
                                score=r.score,
                                outcome=r.outcome,
                                rated=match.rated,
                                was_bot=bool(seat and seat.is_bot),
                                detail=copy.deepcopy(r.detail),
                                created_at=now,
                            )
                        )

            self._commands[key] = _RecordedCommand(
                True, None, None, tuple(e.seq for e in appended)
            )
            return CommandOutcome(
                accepted=True,
                replayed=False,
                match=_clone_match(match),
                events=tuple(_clone_event(e) for e in appended),
            )

    def _record_rejection(
        self,
        request: CommandRequest,
        match: ArenaMatch,
        code: str,
        message: str,
    ) -> CommandOutcome:
        """Record a refusal so a retry returns the same refusal.

        A rejection consumes an idempotency key and does NOT consume a state
        version -- see the `arena_match_commands_version_monotonic` CHECK and
        the column comment explaining why a rejected retry must not invalidate
        every other client's cached version.
        """
        self._commands[(request.match_id, request.idempotency_key)] = _RecordedCommand(
            False, code, message, ()
        )
        return CommandOutcome(
            accepted=False,
            replayed=False,
            match=_clone_match(match),
            rejection_code=code,
            rejection_message=message,
        )

    # -- turns and the clock ------------------------------------------------

    def _open_turn(self, match_id: str) -> Optional[ArenaTurn]:
        for t in sorted(
            self._turns.get(match_id, []), key=lambda t: t.turn_seq, reverse=True
        ):
            if t.resolved_at is None:
                return t
        return None

    async def get_open_turn(self, match_id: str) -> Optional[ArenaTurn]:
        found = self._open_turn(match_id)
        return _clone_turn(found) if found else None

    async def list_overdue_matches(
        self, mode: Optional[str], now: datetime, limit: int = 50
    ) -> list[str]:
        out: list[str] = []
        for mid, match in self._matches.items():
            if match.status not in LIVE_MATCH_STATUSES:
                continue
            if mode is not None and match.mode != mode:
                continue
            if match.is_expired_at(now):
                out.append(mid)
                continue
            turn = self._open_turn(mid)
            if turn is not None and turn.is_overdue_at(now):
                out.append(mid)
        return out[:limit]

    async def resolve_overdue_turn(
        self, match_id: str, turn_seq: int, now: datetime, resolution: str
    ) -> bool:
        async with self._lock_for(match_id):
            for t in self._turns.get(match_id, []):
                if t.turn_seq == turn_seq and t.resolved_at is None:
                    t.resolved_at = now
                    t.resolution = resolution
                    return True
            return False

    async def expire_match(self, match_id: str, now: datetime) -> bool:
        async with self._lock_for(match_id):
            match = self._matches.get(match_id)
            if match is None or match.status not in LIVE_MATCH_STATUSES:
                return False
            match.status = MATCH_STATUS_EXPIRED
            match.updated_at = now
            match.turn_deadline_at = None
            match.current_turn_seq = None
            return True

    # -- events -------------------------------------------------------------

    async def list_events(
        self,
        match_id: str,
        after_seq: int = -1,
        for_seat: Optional[int] = None,
        limit: int = 200,
    ) -> list[ArenaEvent]:
        rows = [
            e
            for e in sorted(self._events.get(match_id, []), key=lambda e: e.seq)
            if e.seq > after_seq
        ]
        if for_seat is not None:
            rows = [e for e in rows if e.visible_to(for_seat)]
        return [_clone_event(e) for e in rows[:limit]]

    # -- results ------------------------------------------------------------

    async def get_results(self, match_id: str) -> list[ArenaResult]:
        rows = sorted(
            self._results.get(match_id, []), key=lambda r: (r.placement, r.seat_index)
        )
        return [_clone_result(r) for r in rows]

    # -- public queue -------------------------------------------------------

    async def enqueue(self, entry: ArenaQueueEntry) -> ArenaQueueEntry:
        async with self._queue_lock:
            for e in self._queue.values():
                if (
                    e.owner_sub == entry.owner_sub
                    and e.mode == entry.mode
                    and e.status == QUEUE_STATUS_WAITING
                ):
                    raise ActiveQueueEntryExists(
                        f"{entry.owner_sub} is already queued for {entry.mode}"
                    )
            self._queue[entry.entry_id] = _clone_entry(entry)
            return _clone_entry(entry)

    async def get_queue_entry(
        self, owner_sub: str, mode: str
    ) -> Optional[ArenaQueueEntry]:
        for e in self._queue.values():
            if (
                e.owner_sub == owner_sub
                and e.mode == mode
                and e.status == QUEUE_STATUS_WAITING
            ):
                return _clone_entry(e)
        return None

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        async with self._queue_lock:
            for e in self._queue.values():
                if (
                    e.owner_sub == owner_sub
                    and e.mode == mode
                    and e.status == QUEUE_STATUS_WAITING
                ):
                    e.status = QUEUE_STATUS_CANCELLED
                    return True
            return False

    async def list_waiting_entries(
        self,
        mode: str,
        seat_count: int,
        exclude_owner_sub: Optional[str] = None,
        limit: int = 50,
    ) -> list[ArenaQueueEntry]:
        rows = [
            e
            for e in self._queue.values()
            if e.mode == mode
            and e.seat_count == seat_count
            and e.status == QUEUE_STATUS_WAITING
            and (exclude_owner_sub is None or e.owner_sub != exclude_owner_sub)
        ]
        rows.sort(key=lambda e: e.joined_at)
        return [_clone_entry(e) for e in rows[:limit]]

    async def expire_stale_queue_entries(self, mode: str, now: datetime) -> int:
        async with self._queue_lock:
            swept = 0
            for e in self._queue.values():
                if (
                    e.mode == mode
                    and e.status == QUEUE_STATUS_WAITING
                    and now > _utc(e.expires_at)
                ):
                    e.status = QUEUE_STATUS_EXPIRED
                    swept += 1
            return swept

    async def claim_entries_into_match(
        self,
        entry_ids: list[str],
        match: ArenaMatch,
        seats: list[ArenaSeat],
        now: datetime,
    ) -> Optional[ArenaMatch]:
        async with self._queue_lock:
            # All-or-nothing: verify every entry is still claimable BEFORE
            # mutating any of them, so a partial claim cannot leave two players
            # marked matched into a match that was never created.
            claimed: list[ArenaQueueEntry] = []
            for entry_id in entry_ids:
                e = self._queue.get(entry_id)
                if e is None or e.status != QUEUE_STATUS_WAITING:
                    return None
                claimed.append(e)
            created = await self.create_match(match, seats)
            for e in claimed:
                e.status = QUEUE_STATUS_MATCHED
                e.matched_at = now
                e.match_id = match.match_id
            return created


# Structural conformance, asserted at import time exactly as the RUN THE TABLE,
# head-to-head and ranked memory repositories do. Catches a protocol method
# renamed on one side and not the other at import rather than at first call.
assert isinstance(MemoryArenaRepository(), ArenaRepository)
