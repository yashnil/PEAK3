"""PostgreSQL-backed ArenaRepository.

Connects via the API's own asyncpg pool -- the same pattern as every other
Postgres* repository here, and the same "service-role reads/writes, RLS as an
independent second layer" split documented in
`supabase/migrations/20260801100000_rls_gaps.sql:3-18`. Seat scoping is enforced
in application code (`api/v1/arena.py::_seat_or_403`); the policies in
`supabase/migrations/20260804100000_arena_foundation.sql` bind a direct
PostgREST caller holding the public anon key, which the API is not.

WHERE THE UNIQUENESS LIVES. Every invariant that two browser tabs could race on
is enforced by an INDEX or a single conditional UPDATE, never by a read followed
by a write:

* `arena_match_seats` PRIMARY KEY (match_id, seat_index) -- one occupant per seat;
* `arena_match_seats_one_per_sub_uniq` -- one seat per person per match, which is
  also the not-self rule;
* `arena_match_commands` PRIMARY KEY (match_id, idempotency_key) -- one verdict
  per key;
* `arena_matches_room_code_live_uniq` -- one live match per room code;
* `arena_public_queue_active_uniq` -- one waiting entry per player per mode;
* `UPDATE arena_turns ... WHERE resolved_at IS NULL` -- one resolver per turn;
* `UPDATE arena_matches ... WHERE status IN (live)` -- one expirer per match.

THE LOCK. `_lock_match` is `SELECT ... FOR UPDATE` with no SKIP LOCKED and no
NOWAIT: it BLOCKS. This is the deliberate opposite of the one pre-existing row
lock in this codebase (`ranked_postgres.py:293-301`, `FOR UPDATE SKIP LOCKED`),
and the difference is not stylistic. Skipping is right when contended rows are
interchangeable candidates -- a queue entry someone else claimed means "pick a
different opponent". It is wrong for a match: two commands against one match are
not alternatives, and skipping the second would silently drop a player's move
instead of serializing it behind the first.

JSONB is decoded defensively (asyncpg returns JSONB as `str` unless a codec is
registered on the pool) -- the same guard `daily_grid_postgres.py` and
`head_to_head_postgres.py` use.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

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
    VISIBILITY_PUBLIC,
    VISIBILITY_SEAT,
    ActiveQueueEntryExists,
    ArenaEvent,
    ArenaMatch,
    ArenaQueueEntry,
    ArenaResult,
    ArenaSeat,
    ArenaTurn,
    CommandOutcome,
    CommandRequest,
    MatchNotFound,
    MatchReducer,
    ReducerInput,
    SeatUnavailable,
    _utc,
)

try:
    import asyncpg  # type: ignore[import]
    _ASYNCPG_AVAILABLE = True
except ImportError:
    _ASYNCPG_AVAILABLE = False


def _require_asyncpg() -> None:
    if not _ASYNCPG_AVAILABLE:
        raise RuntimeError(
            "asyncpg is required for PostgreSQL repositories. Install it: pip install asyncpg"
        )


def _json_obj(raw: Any) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


_MATCH_COLUMNS = """
    match_id, mode, mode_version, model_version, status, state_version, seat_count,
    entry_path, rated, room_code, seed, bot_policy_version, created_by,
    turn_deadline_at, current_turn_seq, expires_at, snapshot,
    created_at, updated_at, completed_at
"""

_SEAT_COLUMNS = """
    match_id, seat_index, occupant_kind, occupant_sub, bot_id, bot_rating,
    display_name, status, joined_at, last_seen_at
"""

_EVENT_COLUMNS = """
    id, match_id, seq, event_type, actor_seat_index, payload, visibility,
    visible_to_seat, state_version_after, created_at
"""

_TURN_COLUMNS = """
    match_id, turn_seq, seat_index, phase, opened_at, deadline_at,
    resolved_at, resolution, resolved_by_key
"""

_QUEUE_COLUMNS = """
    entry_id, owner_sub, mode, mode_version, seat_count, status, joined_at,
    human_preference_until, expires_at, matched_at, cancelled_at, match_id
"""


def _row_to_match(row: Any) -> ArenaMatch:
    return ArenaMatch(
        match_id=str(row["match_id"]),
        mode=row["mode"],
        mode_version=row["mode_version"],
        model_version=row["model_version"],
        status=row["status"],
        state_version=int(row["state_version"]),
        seat_count=int(row["seat_count"]),
        entry_path=row["entry_path"],
        rated=bool(row["rated"]),
        room_code=row["room_code"],
        seed=int(row["seed"]),
        bot_policy_version=row["bot_policy_version"],
        created_by=row["created_by"],
        turn_deadline_at=row["turn_deadline_at"],
        current_turn_seq=row["current_turn_seq"],
        expires_at=row["expires_at"],
        snapshot=_json_obj(row["snapshot"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        completed_at=row["completed_at"],
    )


def _row_to_seat(row: Any) -> ArenaSeat:
    return ArenaSeat(
        match_id=str(row["match_id"]),
        seat_index=int(row["seat_index"]),
        occupant_kind=row["occupant_kind"],
        occupant_sub=row["occupant_sub"],
        bot_id=row["bot_id"],
        bot_rating=float(row["bot_rating"]) if row["bot_rating"] is not None else None,
        display_name=row["display_name"],
        status=row["status"],
        joined_at=row["joined_at"],
        last_seen_at=row["last_seen_at"],
    )


def _row_to_event(row: Any) -> ArenaEvent:
    return ArenaEvent(
        match_id=str(row["match_id"]),
        seq=int(row["seq"]),
        event_type=row["event_type"],
        state_version_after=int(row["state_version_after"]),
        payload=_json_obj(row["payload"]),
        actor_seat_index=row["actor_seat_index"],
        visibility=row["visibility"],
        visible_to_seat=row["visible_to_seat"],
        created_at=row["created_at"],
        id=int(row["id"]),
    )


def _row_to_turn(row: Any) -> ArenaTurn:
    return ArenaTurn(
        match_id=str(row["match_id"]),
        turn_seq=int(row["turn_seq"]),
        phase=row["phase"],
        deadline_at=row["deadline_at"],
        seat_index=row["seat_index"],
        opened_at=row["opened_at"],
        resolved_at=row["resolved_at"],
        resolution=row["resolution"],
        resolved_by_key=row["resolved_by_key"],
    )


def _row_to_entry(row: Any) -> ArenaQueueEntry:
    return ArenaQueueEntry(
        entry_id=str(row["entry_id"]),
        owner_sub=row["owner_sub"],
        mode=row["mode"],
        mode_version=row["mode_version"],
        seat_count=int(row["seat_count"]),
        status=row["status"],
        joined_at=row["joined_at"],
        human_preference_until=row["human_preference_until"],
        expires_at=row["expires_at"],
        matched_at=row["matched_at"],
        cancelled_at=row["cancelled_at"],
        match_id=str(row["match_id"]) if row["match_id"] else None,
    )


class PostgresArenaRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    # -- locking ------------------------------------------------------------

    @staticmethod
    async def _lock_match(conn: Any, match_id: str) -> Optional[Any]:
        """Take the match's row lock. BLOCKS until it is available.

        Must be called inside an open transaction: a `FOR UPDATE` outside one
        acquires and immediately releases, which looks like it worked and
        protects nothing.
        """
        return await conn.fetchrow(
            f"SELECT {_MATCH_COLUMNS} FROM arena_matches WHERE match_id = $1 FOR UPDATE",
            match_id,
        )

    @staticmethod
    async def _lock_subject(conn: Any, sub: str) -> None:
        """Serialize cross-match work for one player.

        `pg_advisory_xact_lock` rather than a row lock because the thing being
        protected is not a row -- it is the invariant "this player is being
        seated into at most one match at a time", which spans the queue table
        and a match that does not exist yet, so there is nothing to point
        `FOR UPDATE` at.

        Released automatically at transaction end (that is the `_xact_` in the
        name); there is no unlock call to forget.

        `hashtext` collides: two different subjects can map to one lock. That is
        acceptable and is why this is safe rather than merely convenient -- a
        collision costs two unrelated players a few milliseconds of
        serialization and can never produce a wrong answer, whereas a missed
        lock could seat one player twice.
        """
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", sub)

    # -- matches ------------------------------------------------------------

    async def create_match(
        self, match: ArenaMatch, seats: list[ArenaSeat]
    ) -> ArenaMatch:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                try:
                    await self._insert_match(conn, match)
                    for seat in seats:
                        await self._insert_seat(conn, seat)
                except asyncpg.UniqueViolationError as exc:
                    raise SeatUnavailable(str(exc)) from exc
        return match

    @staticmethod
    async def _insert_match(conn: Any, match: ArenaMatch) -> None:
        await conn.execute(
            """
            INSERT INTO arena_matches (
                match_id, mode, mode_version, model_version, status, state_version,
                seat_count, entry_path, rated, room_code, seed, bot_policy_version,
                created_by, turn_deadline_at, current_turn_seq, expires_at, snapshot,
                created_at, updated_at, completed_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20)
            """,
            match.match_id, match.mode, match.mode_version, match.model_version,
            match.status, match.state_version, match.seat_count, match.entry_path,
            match.rated, match.room_code, match.seed, match.bot_policy_version,
            match.created_by, match.turn_deadline_at, match.current_turn_seq,
            match.expires_at, json.dumps(match.snapshot), match.created_at,
            match.updated_at, match.completed_at,
        )

    @staticmethod
    async def _insert_seat(conn: Any, seat: ArenaSeat) -> None:
        await conn.execute(
            """
            INSERT INTO arena_match_seats (
                match_id, seat_index, occupant_kind, occupant_sub, bot_id,
                bot_rating, display_name, status, joined_at, last_seen_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            """,
            seat.match_id, seat.seat_index, seat.occupant_kind, seat.occupant_sub,
            seat.bot_id, seat.bot_rating, seat.display_name, seat.status,
            seat.joined_at, seat.last_seen_at,
        )

    async def get_match(self, match_id: str) -> Optional[ArenaMatch]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"SELECT {_MATCH_COLUMNS} FROM arena_matches WHERE match_id = $1",
                match_id,
            )
        return _row_to_match(row) if row else None

    async def find_match_by_room_code(self, room_code: str) -> Optional[ArenaMatch]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_MATCH_COLUMNS} FROM arena_matches
                 WHERE room_code = $1 AND status = ANY($2::text[])
                """,
                room_code, sorted(LIVE_MATCH_STATUSES),
            )
        return _row_to_match(row) if row else None

    async def get_seats(self, match_id: str) -> list[ArenaSeat]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT {_SEAT_COLUMNS} FROM arena_match_seats WHERE match_id = $1 ORDER BY seat_index",
                match_id,
            )
        return [_row_to_seat(r) for r in rows]

    async def get_seat_for_sub(
        self, match_id: str, occupant_sub: str
    ) -> Optional[ArenaSeat]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_SEAT_COLUMNS} FROM arena_match_seats
                 WHERE match_id = $1 AND occupant_sub = $2
                """,
                match_id, occupant_sub,
            )
        return _row_to_seat(row) if row else None

    async def add_seat(self, seat: ArenaSeat) -> ArenaSeat:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                match_row = await self._lock_match(conn, seat.match_id)
                if match_row is None:
                    raise SeatUnavailable(f"no such match {seat.match_id!r}")
                taken = await conn.fetchval(
                    "SELECT count(*) FROM arena_match_seats WHERE match_id = $1",
                    seat.match_id,
                )
                # Safe as a read-then-write ONLY because the match row lock is
                # held: every other seat insert for this match must take the
                # same lock first, so no concurrent writer can slip between the
                # count and the insert. The uniqueness indexes below are still
                # the backstop.
                if int(taken) >= int(match_row["seat_count"]):
                    raise SeatUnavailable("this match is full")
                try:
                    await self._insert_seat(conn, seat)
                except asyncpg.UniqueViolationError as exc:
                    raise SeatUnavailable(str(exc)) from exc
        return seat

    async def touch_seat(self, match_id: str, seat_index: int, now: datetime) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE arena_match_seats SET last_seen_at = $3 WHERE match_id = $1 AND seat_index = $2",
                match_id, seat_index, now,
            )

    async def list_matches_for_sub(
        self, occupant_sub: str, limit: int = 20
    ) -> list[ArenaMatch]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {_MATCH_COLUMNS} FROM arena_matches m
                 WHERE EXISTS (
                     SELECT 1 FROM arena_match_seats s
                      WHERE s.match_id = m.match_id AND s.occupant_sub = $1
                 )
                 ORDER BY m.created_at DESC
                 LIMIT $2
                """,
                occupant_sub, limit,
            )
        return [_row_to_match(r) for r in rows]

    # -- the mutation path --------------------------------------------------

    async def apply_command(
        self,
        request: CommandRequest,
        reducer: MatchReducer,
        now: datetime,
    ) -> CommandOutcome:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                match_row = await self._lock_match(conn, request.match_id)
                if match_row is None:
                    raise MatchNotFound(f"no such match {request.match_id!r}")
                match = _row_to_match(match_row)

                # 1. Idempotency first -- the recorded verdict is the answer
                #    whatever the match looks like now.
                recorded = await conn.fetchrow(
                    """
                    SELECT accepted, rejection_code, state_version_after
                      FROM arena_match_commands
                     WHERE match_id = $1 AND idempotency_key = $2
                    """,
                    request.match_id, request.idempotency_key,
                )
                if recorded is not None:
                    events: list[ArenaEvent] = []
                    if recorded["accepted"]:
                        rows = await conn.fetch(
                            f"""
                            SELECT {_EVENT_COLUMNS} FROM arena_match_events
                             WHERE match_id = $1 AND state_version_after = $2
                             ORDER BY seq
                            """,
                            request.match_id, recorded["state_version_after"],
                        )
                        events = [_row_to_event(r) for r in rows]
                    return CommandOutcome(
                        accepted=recorded["accepted"],
                        replayed=True,
                        match=match,
                        events=tuple(events),
                        rejection_code=recorded["rejection_code"],
                        rejection_message=(
                            None if recorded["accepted"] else "Previously rejected."
                        ),
                    )

                # 2. Liveness and the clock, before any rule runs.
                if match.status in TERMINAL_MATCH_STATUSES:
                    return await self._reject(
                        conn, request, match, REJECT_MATCH_NOT_LIVE,
                        f"This match is {match.status}.",
                    )
                if match.is_expired_at(now):
                    return await self._reject(
                        conn, request, match, REJECT_MATCH_EXPIRED,
                        "This match has expired.",
                    )

                # 3. Optimistic concurrency.
                if (
                    request.expected_state_version is not None
                    and request.expected_state_version != match.state_version
                ):
                    return await self._reject(
                        conn, request, match, REJECT_STALE_STATE_VERSION,
                        f"This match has moved on (you sent version "
                        f"{request.expected_state_version}, it is now "
                        f"{match.state_version}). Reload.",
                    )

                seat_rows = await conn.fetch(
                    f"SELECT {_SEAT_COLUMNS} FROM arena_match_seats WHERE match_id = $1 ORDER BY seat_index",
                    request.match_id,
                )
                seats = tuple(_row_to_seat(r) for r in seat_rows)
                turn_row = await conn.fetchrow(
                    f"""
                    SELECT {_TURN_COLUMNS} FROM arena_turns
                     WHERE match_id = $1 AND resolved_at IS NULL
                     ORDER BY turn_seq DESC LIMIT 1
                    """,
                    request.match_id,
                )
                open_turn = _row_to_turn(turn_row) if turn_row else None

                # 4. The mode's rules. Pure, no I/O -- see MatchReducer.
                out = reducer(
                    ReducerInput(
                        match=match,
                        seats=seats,
                        open_turn=open_turn,
                        command=request,
                        now=now,
                    )
                )

                if not out.accepted:
                    return await self._reject(
                        conn, request, match,
                        out.rejection_code or "rejected",
                        out.rejection_message or "This move is not legal.",
                    )

                new_version = match.state_version + 1

                appended = await self._append_events(
                    conn, request.match_id, out.events, new_version, now
                )

                if out.resolve_turn is not None and open_turn is not None:
                    await conn.execute(
                        """
                        UPDATE arena_turns
                           SET resolved_at = $3, resolution = $4, resolved_by_key = $5
                         WHERE match_id = $1 AND turn_seq = $2 AND resolved_at IS NULL
                        """,
                        request.match_id, open_turn.turn_seq, now,
                        out.resolve_turn, request.idempotency_key,
                    )

                next_deadline: Optional[datetime] = None
                next_turn_seq: Optional[int] = None
                if out.open_turn is not None:
                    highest = await conn.fetchval(
                        "SELECT max(turn_seq) FROM arena_turns WHERE match_id = $1",
                        request.match_id,
                    )
                    next_turn_seq = (int(highest) + 1) if highest is not None else 0
                    await conn.execute(
                        """
                        INSERT INTO arena_turns
                            (match_id, turn_seq, seat_index, phase, opened_at, deadline_at)
                        VALUES ($1,$2,$3,$4,$5,$6)
                        """,
                        request.match_id, next_turn_seq, out.open_turn.seat_index,
                        out.open_turn.phase, now, out.open_turn.deadline_at,
                    )
                    next_deadline = out.open_turn.deadline_at

                new_status = out.status or match.status
                completed_at = (
                    now if new_status == MATCH_STATUS_COMPLETED else match.completed_at
                )
                snapshot = out.snapshot if out.snapshot is not None else match.snapshot

                await conn.execute(
                    """
                    UPDATE arena_matches
                       SET state_version = $2, snapshot = $3::jsonb, status = $4,
                           turn_deadline_at = $5, current_turn_seq = $6,
                           updated_at = $7, completed_at = $8
                     WHERE match_id = $1
                    """,
                    request.match_id, new_version, json.dumps(snapshot), new_status,
                    next_deadline, next_turn_seq, now, completed_at,
                )

                if out.results:
                    by_index = {s.seat_index: s for s in seats}
                    for r in out.results:
                        seat = by_index.get(r.seat_index)
                        # ON CONFLICT DO NOTHING, not an UPDATE: the table's
                        # immutability trigger would raise on an UPDATE, and a
                        # settled placement must never be rewritten anyway.
                        await conn.execute(
                            """
                            INSERT INTO arena_match_results
                                (match_id, seat_index, placement, score, outcome,
                                 rated, was_bot, detail, created_at)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
                            ON CONFLICT (match_id, seat_index) DO NOTHING
                            """,
                            request.match_id, r.seat_index, r.placement, r.score,
                            r.outcome, match.rated, bool(seat and seat.is_bot),
                            json.dumps(r.detail), now,
                        )

                await self._record_command(
                    conn, request, True, None, match.state_version, new_version
                )

                refreshed = await conn.fetchrow(
                    f"SELECT {_MATCH_COLUMNS} FROM arena_matches WHERE match_id = $1",
                    request.match_id,
                )
                return CommandOutcome(
                    accepted=True,
                    replayed=False,
                    match=_row_to_match(refreshed),
                    events=tuple(appended),
                )

    @staticmethod
    async def _append_events(
        conn: Any,
        match_id: str,
        drafts: tuple,
        state_version_after: int,
        now: datetime,
    ) -> list[ArenaEvent]:
        if not drafts:
            return []
        highest = await conn.fetchval(
            "SELECT max(seq) FROM arena_match_events WHERE match_id = $1", match_id
        )
        next_seq = (int(highest) + 1) if highest is not None else 0
        out: list[ArenaEvent] = []
        for draft in drafts:
            row = await conn.fetchrow(
                """
                INSERT INTO arena_match_events
                    (match_id, seq, event_type, actor_seat_index, payload,
                     visibility, visible_to_seat, state_version_after, created_at)
                VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)
                RETURNING id
                """,
                match_id, next_seq, draft.event_type, draft.actor_seat_index,
                json.dumps(draft.payload), draft.visibility, draft.visible_to_seat,
                state_version_after, now,
            )
            out.append(
                ArenaEvent(
                    match_id=match_id,
                    seq=next_seq,
                    event_type=draft.event_type,
                    state_version_after=state_version_after,
                    payload=dict(draft.payload),
                    actor_seat_index=draft.actor_seat_index,
                    visibility=draft.visibility,
                    visible_to_seat=draft.visible_to_seat,
                    created_at=now,
                    id=int(row["id"]),
                )
            )
            next_seq += 1
        return out

    async def _reject(
        self,
        conn: Any,
        request: CommandRequest,
        match: ArenaMatch,
        code: str,
        message: str,
    ) -> CommandOutcome:
        """Record a refusal so a retry returns the same refusal.

        `state_version_after == state_version_before`: a rejection changes no
        state and must not consume a version, or a rejected retry would
        invalidate every other client's cached version for nothing. The
        `arena_match_commands_version_monotonic` CHECK permits equality
        precisely for this case.
        """
        await self._record_command(
            conn, request, False, code, match.state_version, match.state_version
        )
        return CommandOutcome(
            accepted=False,
            replayed=False,
            match=match,
            rejection_code=code,
            rejection_message=message,
        )

    @staticmethod
    async def _record_command(
        conn: Any,
        request: CommandRequest,
        accepted: bool,
        rejection_code: Optional[str],
        version_before: int,
        version_after: int,
    ) -> None:
        await conn.execute(
            """
            INSERT INTO arena_match_commands
                (match_id, idempotency_key, actor_seat_index, actor_sub,
                 command_type, payload, accepted, rejection_code,
                 state_version_before, state_version_after, created_at)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,NOW())
            """,
            request.match_id, request.idempotency_key, request.actor_seat_index,
            request.actor_sub, request.command_type, json.dumps(request.payload),
            accepted, rejection_code, version_before, version_after,
        )

    # -- turns and the clock ------------------------------------------------

    async def get_open_turn(self, match_id: str) -> Optional[ArenaTurn]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_TURN_COLUMNS} FROM arena_turns
                 WHERE match_id = $1 AND resolved_at IS NULL
                 ORDER BY turn_seq DESC LIMIT 1
                """,
                match_id,
            )
        return _row_to_turn(row) if row else None

    async def list_overdue_matches(
        self, mode: Optional[str], now: datetime, limit: int = 50
    ) -> list[str]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT m.match_id
                  FROM arena_matches m
                  LEFT JOIN arena_turns t
                    ON t.match_id = m.match_id AND t.resolved_at IS NULL
                 WHERE m.status = ANY($1::text[])
                   AND ($2::text IS NULL OR m.mode = $2)
                   AND (m.expires_at < $3 OR t.deadline_at < $3)
                 LIMIT $4
                """,
                sorted(LIVE_MATCH_STATUSES), mode, now, limit,
            )
        return [str(r["match_id"]) for r in rows]

    async def resolve_overdue_turn(
        self, match_id: str, turn_seq: int, now: datetime, resolution: str
    ) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE arena_turns
                   SET resolved_at = $3, resolution = $4
                 WHERE match_id = $1 AND turn_seq = $2 AND resolved_at IS NULL
                """,
                match_id, turn_seq, now, resolution,
            )
        return int(result.rsplit(" ", 1)[-1] or 0) == 1

    async def expire_match(self, match_id: str, now: datetime) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE arena_matches
                   SET status = $3, updated_at = $2,
                       turn_deadline_at = NULL, current_turn_seq = NULL
                 WHERE match_id = $1 AND status = ANY($4::text[])
                """,
                match_id, now, MATCH_STATUS_EXPIRED, sorted(LIVE_MATCH_STATUSES),
            )
        return int(result.rsplit(" ", 1)[-1] or 0) == 1

    # -- events -------------------------------------------------------------

    async def list_events(
        self,
        match_id: str,
        after_seq: int = -1,
        for_seat: Optional[int] = None,
        limit: int = 200,
    ) -> list[ArenaEvent]:
        # Visibility is filtered IN THE QUERY, not by the caller. `for_seat`
        # None means the server view and returns 'server' rows too; no
        # client-facing route may pass None.
        async with self._pool.acquire() as conn:
            if for_seat is None:
                rows = await conn.fetch(
                    f"""
                    SELECT {_EVENT_COLUMNS} FROM arena_match_events
                     WHERE match_id = $1 AND seq > $2
                     ORDER BY seq LIMIT $3
                    """,
                    match_id, after_seq, limit,
                )
            else:
                rows = await conn.fetch(
                    f"""
                    SELECT {_EVENT_COLUMNS} FROM arena_match_events
                     WHERE match_id = $1 AND seq > $2
                       AND (visibility = $4
                            OR (visibility = $5 AND visible_to_seat = $6))
                     ORDER BY seq LIMIT $3
                    """,
                    match_id, after_seq, limit, VISIBILITY_PUBLIC,
                    VISIBILITY_SEAT, for_seat,
                )
        return [_row_to_event(r) for r in rows]

    # -- results ------------------------------------------------------------

    async def get_results(self, match_id: str) -> list[ArenaResult]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT match_id, seat_index, placement, score, outcome, rated,
                       was_bot, detail, created_at
                  FROM arena_match_results
                 WHERE match_id = $1
                 ORDER BY placement, seat_index
                """,
                match_id,
            )
        return [
            ArenaResult(
                match_id=str(r["match_id"]),
                seat_index=int(r["seat_index"]),
                placement=int(r["placement"]),
                score=float(r["score"]),
                outcome=r["outcome"],
                rated=bool(r["rated"]),
                was_bot=bool(r["was_bot"]),
                detail=_json_obj(r["detail"]),
                created_at=r["created_at"],
            )
            for r in rows
        ]

    # -- public queue -------------------------------------------------------

    async def enqueue(self, entry: ArenaQueueEntry) -> ArenaQueueEntry:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await self._lock_subject(conn, entry.owner_sub)
                try:
                    await conn.execute(
                        """
                        INSERT INTO arena_public_queue
                            (entry_id, owner_sub, mode, mode_version, seat_count,
                             status, joined_at, human_preference_until, expires_at)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                        """,
                        entry.entry_id, entry.owner_sub, entry.mode,
                        entry.mode_version, entry.seat_count, entry.status,
                        entry.joined_at, entry.human_preference_until,
                        entry.expires_at,
                    )
                except asyncpg.UniqueViolationError as exc:
                    raise ActiveQueueEntryExists(
                        f"{entry.owner_sub} is already queued for {entry.mode}"
                    ) from exc
        return entry

    async def get_queue_entry(
        self, owner_sub: str, mode: str
    ) -> Optional[ArenaQueueEntry]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_QUEUE_COLUMNS} FROM arena_public_queue
                 WHERE owner_sub = $1 AND mode = $2 AND status = $3
                """,
                owner_sub, mode, QUEUE_STATUS_WAITING,
            )
        return _row_to_entry(row) if row else None

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE arena_public_queue
                   SET status = $3, cancelled_at = NOW()
                 WHERE owner_sub = $1 AND mode = $2 AND status = $4
                """,
                owner_sub, mode, QUEUE_STATUS_CANCELLED, QUEUE_STATUS_WAITING,
            )
        return int(result.rsplit(" ", 1)[-1] or 0) > 0

    async def list_waiting_entries(
        self,
        mode: str,
        seat_count: int,
        exclude_owner_sub: Optional[str] = None,
        limit: int = 50,
    ) -> list[ArenaQueueEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT {_QUEUE_COLUMNS} FROM arena_public_queue
                 WHERE mode = $1 AND seat_count = $2 AND status = $3
                   AND ($4::text IS NULL OR owner_sub <> $4)
                 ORDER BY joined_at
                 LIMIT $5
                """,
                mode, seat_count, QUEUE_STATUS_WAITING, exclude_owner_sub, limit,
            )
        return [_row_to_entry(r) for r in rows]

    async def expire_stale_queue_entries(self, mode: str, now: datetime) -> int:
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE arena_public_queue
                   SET status = $3
                 WHERE mode = $1 AND status = $4 AND expires_at < $2
                """,
                mode, now, QUEUE_STATUS_EXPIRED, QUEUE_STATUS_WAITING,
            )
        return int(result.rsplit(" ", 1)[-1] or 0)

    async def claim_entries_into_match(
        self,
        entry_ids: list[str],
        match: ArenaMatch,
        seats: list[ArenaSeat],
        now: datetime,
    ) -> Optional[ArenaMatch]:
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                # ORDER BY entry_id is load-bearing, not tidiness. Two
                # matchmakers claiming overlapping candidate sets in opposite
                # orders deadlock; locking in a total order that every caller
                # agrees on makes that impossible. Postgres would detect and
                # abort the deadlock rather than hang, but an aborted
                # transaction here is a player bounced out of matchmaking for
                # no reason they could understand.
                rows = await conn.fetch(
                    """
                    SELECT entry_id FROM arena_public_queue
                     WHERE entry_id = ANY($1::uuid[]) AND status = $2
                     ORDER BY entry_id
                     FOR UPDATE
                    """,
                    entry_ids, QUEUE_STATUS_WAITING,
                )
                if len(rows) != len(entry_ids):
                    # Somebody else claimed one of them. All-or-nothing: touch
                    # nothing, report the loss, let the caller pick another set.
                    return None
                try:
                    await self._insert_match(conn, match)
                    for seat in seats:
                        await self._insert_seat(conn, seat)
                except asyncpg.UniqueViolationError:
                    return None
                await conn.execute(
                    """
                    UPDATE arena_public_queue
                       SET status = $2, matched_at = $3, match_id = $4
                     WHERE entry_id = ANY($1::uuid[])
                    """,
                    entry_ids, QUEUE_STATUS_MATCHED, now, match.match_id,
                )
                return match
