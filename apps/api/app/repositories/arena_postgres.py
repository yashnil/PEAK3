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
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Optional, Sequence

from app.repositories.arena_rating_protocols import ArenaPlayerStats
from app.repositories.arena_protocols import (
    InvalidIdempotencyKey,
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
    MatchBundle,
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


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _us(column: str) -> str:
    """A timestamptz as integer microseconds since the epoch, for JSON.

    Integers, not the JSON text form of a timestamp: they round-trip EXACTLY,
    so a bundle-read seat or turn compares equal to the same row read through
    `_row_to_seat`/`_row_to_turn`, and there is no session-timezone formatting
    to parse."""
    return f"(extract(epoch from {column}) * 1000000)::bigint"


def _from_us(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    return _EPOCH + timedelta(microseconds=int(value))


_SEATS_JSON = f"""
    (SELECT coalesce(json_agg(json_build_object(
                'match_id', s.match_id, 'seat_index', s.seat_index,
                'occupant_kind', s.occupant_kind, 'occupant_sub', s.occupant_sub,
                'bot_id', s.bot_id, 'bot_rating', s.bot_rating,
                'display_name', s.display_name, 'status', s.status,
                'joined_at', {_us('s.joined_at')}, 'last_seen_at', {_us('s.last_seen_at')}
            ) ORDER BY s.seat_index), '[]'::json)
       FROM arena_match_seats s WHERE s.match_id = {{match}})
"""

_OPEN_TURN_JSON = f"""
    (SELECT json_build_object(
                'match_id', t.match_id, 'turn_seq', t.turn_seq, 'seat_index', t.seat_index,
                'phase', t.phase, 'opened_at', {_us('t.opened_at')},
                'deadline_at', {_us('t.deadline_at')}, 'resolved_at', {_us('t.resolved_at')},
                'resolution', t.resolution, 'resolved_by_key', t.resolved_by_key)
       FROM arena_turns t
      WHERE t.match_id = {{match}} AND t.resolved_at IS NULL
      ORDER BY t.turn_seq DESC LIMIT 1)
"""


def _json_value(raw: Any) -> Any:
    if isinstance(raw, (str, bytes)):
        return json.loads(raw)
    return raw


def _seats_from_json(raw: Any) -> tuple[ArenaSeat, ...]:
    return tuple(
        ArenaSeat(
            match_id=str(item["match_id"]),
            seat_index=int(item["seat_index"]),
            occupant_kind=item["occupant_kind"],
            occupant_sub=item["occupant_sub"],
            bot_id=item["bot_id"],
            bot_rating=float(item["bot_rating"]) if item["bot_rating"] is not None else None,
            display_name=item["display_name"],
            status=item["status"],
            joined_at=_from_us(item["joined_at"]),
            last_seen_at=_from_us(item["last_seen_at"]),
        )
        for item in (_json_value(raw) or [])
    )


def _turn_from_json(raw: Any) -> Optional[ArenaTurn]:
    item = _json_value(raw)
    if not item:
        return None
    return ArenaTurn(
        match_id=str(item["match_id"]),
        turn_seq=int(item["turn_seq"]),
        phase=item["phase"],
        deadline_at=_from_us(item["deadline_at"]),
        seat_index=item["seat_index"],
        opened_at=_from_us(item["opened_at"]),
        resolved_at=_from_us(item["resolved_at"]),
        resolution=item["resolution"],
        resolved_by_key=item["resolved_by_key"],
    )


#: The request-scoped connection, when a route has pinned one (`session`).
_SESSION_CONN: ContextVar[Optional[Any]] = ContextVar("arena_pg_session_conn", default=None)


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

    # -- connections ----------------------------------------------------------

    @asynccontextmanager
    async def session(self) -> AsyncIterator[None]:
        """Pin ONE pooled connection for everything a request reads and writes.

        Without it every repository call checks a connection out of the pool
        and returns it, and asyncpg resets a connection on release -- a second
        round trip for every query. A route that makes a dozen calls paid for
        two dozen trips. Re-entrant: a nested session reuses the outer one.

        Sequential use only. A request never issues two repository calls
        concurrently (asyncpg refuses concurrent use of one connection, loudly,
        so a future `gather` here would fail in tests rather than corrupt).
        """
        if _SESSION_CONN.get() is not None:
            yield
            return
        async with self._pool.acquire() as conn:
            token = _SESSION_CONN.set(conn)
            try:
                yield
            finally:
                _SESSION_CONN.reset(token)

    @asynccontextmanager
    async def _conn(self) -> AsyncIterator[Any]:
        pinned = _SESSION_CONN.get()
        if pinned is not None:
            yield pinned
            return
        async with self._pool.acquire() as conn:
            yield conn

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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"SELECT {_MATCH_COLUMNS} FROM arena_matches WHERE match_id = $1",
                match_id,
            )
        return _row_to_match(row) if row else None

    async def get_match_bundle(self, match_id: str) -> Optional[MatchBundle]:
        """Match + seats + open turn + newest event seqs, in ONE statement. See
        `MatchBundle` for why this exists."""
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_MATCH_COLUMNS},
                       {_SEATS_JSON.format(match="m.match_id")} AS bundle_seats,
                       {_OPEN_TURN_JSON.format(match="m.match_id")} AS bundle_turn,
                       (SELECT max(e.seq) FROM arena_match_events e
                         WHERE e.match_id = m.match_id AND e.visibility = $2) AS bundle_public_seq,
                       (SELECT coalesce(json_object_agg(q.visible_to_seat, q.seq), '{{}}'::json)
                          FROM (SELECT e.visible_to_seat, max(e.seq) AS seq
                                  FROM arena_match_events e
                                 WHERE e.match_id = m.match_id AND e.visibility = $3
                                   AND e.visible_to_seat IS NOT NULL
                                 GROUP BY e.visible_to_seat) q) AS bundle_seat_seqs
                  FROM arena_matches m
                 WHERE m.match_id = $1
                """,
                match_id, VISIBILITY_PUBLIC, VISIBILITY_SEAT,
            )
        if row is None:
            return None
        seat_seqs = _json_value(row["bundle_seat_seqs"]) or {}
        return MatchBundle(
            match=_row_to_match(row),
            seats=_seats_from_json(row["bundle_seats"]),
            open_turn=_turn_from_json(row["bundle_turn"]),
            public_seq=int(row["bundle_public_seq"]) if row["bundle_public_seq"] is not None else -1,
            seat_seqs={int(seat): int(seq) for seat, seq in seat_seqs.items()},
        )

    async def find_match_by_room_code(self, room_code: str) -> Optional[ArenaMatch]:
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_MATCH_COLUMNS} FROM arena_matches
                 WHERE room_code = $1 AND status = ANY($2::text[])
                """,
                room_code, sorted(LIVE_MATCH_STATUSES),
            )
        return _row_to_match(row) if row else None

    async def get_seats(self, match_id: str) -> list[ArenaSeat]:
        async with self._conn() as conn:
            rows = await conn.fetch(
                f"SELECT {_SEAT_COLUMNS} FROM arena_match_seats WHERE match_id = $1 ORDER BY seat_index",
                match_id,
            )
        return [_row_to_seat(r) for r in rows]

    async def get_seat_for_sub(
        self, match_id: str, occupant_sub: str
    ) -> Optional[ArenaSeat]:
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_SEAT_COLUMNS} FROM arena_match_seats
                 WHERE match_id = $1 AND occupant_sub = $2
                """,
                match_id, occupant_sub,
            )
        return _row_to_seat(row) if row else None

    async def add_seat(self, seat: ArenaSeat) -> ArenaSeat:
        async with self._conn() as conn:
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
        async with self._conn() as conn:
            await conn.execute(
                "UPDATE arena_match_seats SET last_seen_at = $3 WHERE match_id = $1 AND seat_index = $2",
                match_id, seat_index, now,
            )

    async def list_matches_for_sub(
        self, occupant_sub: str, limit: int = 20
    ) -> list[ArenaMatch]:
        async with self._conn() as conn:
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

    async def set_bot_policy_version(self, match_id: str, policy_version: str) -> bool:
        # `bot_policy_version IS NULL` in the statement, not a read first:
        # first write wins and every later caller matches zero rows, so two
        # concurrent host fills cannot overwrite each other's pin.
        async with self._conn() as conn:
            result = await conn.execute(
                """
                UPDATE arena_matches
                   SET bot_policy_version = $2, updated_at = NOW()
                 WHERE match_id = $1 AND bot_policy_version IS NULL
                """,
                match_id, policy_version,
            )
        return int(result.rsplit(" ", 1)[-1] or 0) > 0

    # -- the mutation path --------------------------------------------------

    async def apply_command(
        self,
        request: CommandRequest,
        reducer: MatchReducer,
        now: datetime,
    ) -> CommandOutcome:
        # ROUND TRIPS ARE THE COST (game-feel pass 4). Each statement here is a
        # trip to a database that is tens of milliseconds away in production,
        # and this method used to make about fifteen of them. It now makes: the
        # lock and the idempotency verdict together; seats and the open turn
        # together; the events as one INSERT; the old turn's resolution; and ONE
        # statement that opens the next turn, records the command and writes the
        # match row. The sequence of CHECKS is exactly what it was.
        async with self._conn() as conn:
            async with conn.transaction():
                match_row = await self._lock_match(conn, request.match_id)
                if match_row is None:
                    raise MatchNotFound(f"no such match {request.match_id!r}")
                match = _row_to_match(match_row)

                # THE VERDICT LOOKUP IS A SEPARATE STATEMENT FROM THE LOCK, and
                # must stay one. Under READ COMMITTED a statement that waited on
                # the row lock re-reads the LOCKED row but keeps its original
                # snapshot for everything else -- so a lookup joined into the
                # `FOR UPDATE` cannot see the command row the transaction it
                # waited behind just committed, and an identical concurrent key
                # would run the reducer twice (the conformance suite's
                # `test_arena_concurrent_identical_keys_apply_once` caught exactly
                # that). A new statement takes a new snapshot. Seats and the
                # open turn ride along on it, so this costs no extra trip.
                locked = await conn.fetchrow(
                    f"""
                    SELECT c.idempotency_key      AS recorded_key,
                           c.accepted             AS recorded_accepted,
                           c.rejection_code       AS recorded_rejection_code,
                           c.state_version_after  AS recorded_state_version_after,
                           {_SEATS_JSON.format(match="$1")} AS seats,
                           {_OPEN_TURN_JSON.format(match="$1")} AS open_turn
                      FROM (SELECT 1) AS one
                      LEFT JOIN arena_match_commands c
                        ON c.match_id = $1 AND c.idempotency_key = $2
                    """,
                    request.match_id, request.idempotency_key,
                )

                # 1. Idempotency first -- the recorded verdict is the answer
                #    whatever the match looks like now.
                if locked["recorded_key"] is not None:
                    events: list[ArenaEvent] = []
                    if locked["recorded_accepted"]:
                        rows = await conn.fetch(
                            f"""
                            SELECT {_EVENT_COLUMNS} FROM arena_match_events
                             WHERE match_id = $1 AND state_version_after = $2
                             ORDER BY seq
                            """,
                            request.match_id, locked["recorded_state_version_after"],
                        )
                        events = [_row_to_event(r) for r in rows]
                    return CommandOutcome(
                        accepted=locked["recorded_accepted"],
                        replayed=True,
                        match=match,
                        events=tuple(events),
                        rejection_code=locked["recorded_rejection_code"],
                        rejection_message=(
                            None if locked["recorded_accepted"] else "Previously rejected."
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

                seats = _seats_from_json(locked["seats"])
                open_turn = _turn_from_json(locked["open_turn"])

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
                    # Its own statement, BEFORE the next turn is inserted, so the
                    # new open turn never coexists with the old one inside a
                    # single statement's snapshot.
                    await conn.execute(
                        """
                        UPDATE arena_turns
                           SET resolved_at = $3, resolution = $4, resolved_by_key = $5
                         WHERE match_id = $1 AND turn_seq = $2 AND resolved_at IS NULL
                        """,
                        request.match_id, open_turn.turn_seq, now,
                        out.resolve_turn, request.idempotency_key,
                    )

                # DEFAULT TO THE MATCH'S OWN CURRENT VALUES, NOT TO NULL.
                #
                # `out.open_turn is None` has two meanings depending on
                # `out.resolve_turn`: a rearrangement returns both as None to
                # mean "leave the open turn exactly as it is"; only a resolution
                # with no replacement (completion, abandonment) means there is no
                # open turn any more. Seeding from the match row makes a no-op
                # reducer output a true no-op on these denormalized columns, the
                # same guarantee the in-memory repository gives.
                opens = out.open_turn is not None
                keep_deadline: Optional[datetime] = match.turn_deadline_at
                keep_turn_seq: Optional[int] = match.current_turn_seq
                if not opens and out.resolve_turn is not None:
                    keep_deadline = None
                    keep_turn_seq = None

                new_status = out.status or match.status
                completed_at = (
                    now if new_status == MATCH_STATUS_COMPLETED else match.completed_at
                )
                snapshot = out.snapshot if out.snapshot is not None else match.snapshot
                snapshot_json = json.dumps(snapshot)

                try:
                    written = await conn.fetchrow(
                        """
                        WITH new_turn AS (
                            INSERT INTO arena_turns
                                (match_id, turn_seq, seat_index, phase, opened_at, deadline_at)
                            SELECT $1,
                                   COALESCE((SELECT max(turn_seq) + 1 FROM arena_turns WHERE match_id = $1), 0),
                                   $2::smallint, $3::text, $4::timestamptz, $5::timestamptz
                             WHERE $6::boolean
                            RETURNING turn_seq
                        ),
                        recorded AS (
                            INSERT INTO arena_match_commands
                                (match_id, idempotency_key, actor_seat_index, actor_sub,
                                 command_type, payload, accepted, rejection_code,
                                 state_version_before, state_version_after, created_at)
                            VALUES ($1, $7, $8, $9, $10, $11::jsonb, TRUE, NULL, $12, $13, NOW())
                        )
                        UPDATE arena_matches
                           SET state_version = $13, snapshot = $14::jsonb, status = $15,
                               turn_deadline_at = CASE WHEN $6::boolean THEN $5::timestamptz ELSE $16::timestamptz END,
                               current_turn_seq = CASE WHEN $6::boolean
                                                       THEN (SELECT turn_seq FROM new_turn)
                                                       ELSE $17::integer END,
                               updated_at = $4::timestamptz, completed_at = $18::timestamptz
                         WHERE match_id = $1
                        RETURNING current_turn_seq
                        """,
                        request.match_id,
                        out.open_turn.seat_index if opens else None,
                        out.open_turn.phase if opens else None,
                        now,
                        out.open_turn.deadline_at if opens else None,
                        opens,
                        request.idempotency_key, request.actor_seat_index,
                        request.actor_sub, request.command_type, json.dumps(request.payload),
                        match.state_version, new_version,
                        snapshot_json, new_status,
                        keep_deadline, keep_turn_seq, completed_at,
                    )
                except asyncpg.CheckViolationError as exc:
                    # See `_record_command`: the key-length CHECK surfaces as the
                    # domain exception on both backends.
                    if "idempotency_key" in str(exc):
                        raise InvalidIdempotencyKey(str(exc)) from exc
                    raise

                if out.results:
                    by_index = {s.seat_index: s for s in seats}
                    # ON CONFLICT DO NOTHING, not an UPDATE: the table's
                    # immutability trigger would raise on an UPDATE, and a
                    # settled placement must never be rewritten anyway.
                    await conn.executemany(
                        """
                        INSERT INTO arena_match_results
                            (match_id, seat_index, placement, score, outcome,
                             rated, was_bot, detail, created_at)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
                        ON CONFLICT (match_id, seat_index) DO NOTHING
                        """,
                        [
                            (
                                request.match_id, r.seat_index, r.placement, r.score,
                                r.outcome, match.rated,
                                bool(by_index.get(r.seat_index) and by_index[r.seat_index].is_bot),
                                json.dumps(r.detail), now,
                            )
                            for r in out.results
                        ],
                    )

                current_turn_seq = written["current_turn_seq"]
                if opens:
                    left_open: Optional[ArenaTurn] = ArenaTurn(
                        match_id=request.match_id,
                        turn_seq=int(current_turn_seq),
                        phase=out.open_turn.phase,
                        deadline_at=out.open_turn.deadline_at,
                        seat_index=out.open_turn.seat_index,
                        opened_at=now,
                    )
                elif out.resolve_turn is not None:
                    left_open = None
                else:
                    left_open = open_turn

                # The row as written, WITHOUT reading it back: every column is
                # a value this transaction just set. The snapshot goes through
                # the same JSON text the database stored, so a reader sees what
                # a fresh read would return (lists, not tuples).
                updated = replace(
                    match,
                    state_version=new_version,
                    snapshot=json.loads(snapshot_json),
                    status=new_status,
                    turn_deadline_at=out.open_turn.deadline_at if opens else keep_deadline,
                    current_turn_seq=int(current_turn_seq) if current_turn_seq is not None else None,
                    updated_at=now,
                    completed_at=completed_at,
                )
                return CommandOutcome(
                    accepted=True,
                    replayed=False,
                    match=updated,
                    events=tuple(appended),
                    open_turn=left_open,
                    open_turn_known=True,
                )

    @staticmethod
    async def _append_events(
        conn: Any,
        match_id: str,
        drafts: tuple,
        state_version_after: int,
        now: datetime,
    ) -> list[ArenaEvent]:
        """Every event of one command as ONE statement, numbered after the
        match's current highest seq. The row lock makes the max() safe."""
        if not drafts:
            return []
        rows = await conn.fetch(
            """
            INSERT INTO arena_match_events
                (match_id, seq, event_type, actor_seat_index, payload,
                 visibility, visible_to_seat, state_version_after, created_at)
            SELECT $1,
                   base.next_seq + d.ord - 1,
                   d.event_type, d.actor_seat_index, d.payload::jsonb,
                   d.visibility, d.visible_to_seat, $2, $3
              FROM (SELECT COALESCE(max(seq) + 1, 0) AS next_seq
                      FROM arena_match_events WHERE match_id = $1) base,
                   unnest($4::text[], $5::smallint[], $6::text[], $7::text[], $8::smallint[])
                       WITH ORDINALITY AS d(event_type, actor_seat_index, payload,
                                            visibility, visible_to_seat, ord)
            RETURNING id, seq
            """,
            match_id, state_version_after, now,
            [d.event_type for d in drafts],
            [d.actor_seat_index for d in drafts],
            [json.dumps(d.payload) for d in drafts],
            [d.visibility for d in drafts],
            [d.visible_to_seat for d in drafts],
        )
        ids = sorted((int(r["seq"]), int(r["id"])) for r in rows)
        return [
            ArenaEvent(
                match_id=match_id,
                seq=seq,
                event_type=draft.event_type,
                state_version_after=state_version_after,
                payload=dict(draft.payload),
                actor_seat_index=draft.actor_seat_index,
                visibility=draft.visibility,
                visible_to_seat=draft.visible_to_seat,
                created_at=now,
                id=event_id,
            )
            for (seq, event_id), draft in zip(ids, drafts)
        ]

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
        try:
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
        except asyncpg.CheckViolationError as exc:
            # The key-length CHECK, surfaced as a DOMAIN exception rather than a
            # driver one. Without this the two backends fail differently for the
            # same bad input -- `InvalidIdempotencyKey` in memory, an
            # `asyncpg.CheckViolationError` here -- and a caller could not catch
            # the Postgres case without importing asyncpg, which is exactly the
            # leak `head_to_head_postgres.py:234-235` converts for
            # UniqueViolationError. A route turns the domain exception into a
            # 400 (malformed request); the driver exception would have become a
            # 500 (server fault).
            #
            # Nothing reaches this today: `SubmitCommandRequest.idempotency_key`
            # is `Field(..., min_length=8, max_length=128)` (models/arena.py:213),
            # so a short key from a real client is a 422 at the boundary. This
            # closes the SERVER-issued and internal paths, which have no such
            # guard.
            if "idempotency_key" in str(exc):
                raise InvalidIdempotencyKey(str(exc)) from exc
            raise

    # -- turns and the clock ------------------------------------------------

    async def get_open_turn(self, match_id: str) -> Optional[ArenaTurn]:
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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

    async def list_results_for_sub(self, mode: str, owner_sub: str, limit: int = 1000):
        from app.repositories.arena_protocols import ArenaSubjectResult

        # Most recent `limit` first, then re-ordered oldest-first for streaks.
        # Joined exactly as `get_player_stats` joins results to seats to
        # matches; unlike it, no `rated` filter -- see the protocol docstring.
        async with self._conn() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM (
                    SELECT r.match_id, r.seat_index, r.placement, r.outcome, r.score,
                           r.rated, r.detail, m.seat_count, m.entry_path,
                           COALESCE(m.completed_at, r.created_at) AS completed_at
                      FROM arena_match_results r
                      JOIN arena_match_seats s
                        ON s.match_id = r.match_id AND s.seat_index = r.seat_index
                      JOIN arena_matches m ON m.match_id = r.match_id
                     WHERE m.mode = $1
                       AND s.occupant_sub = $2
                       AND NOT r.was_bot
                     ORDER BY COALESCE(m.completed_at, r.created_at) DESC, r.match_id DESC
                     LIMIT $3
                ) recent
                ORDER BY completed_at ASC, match_id ASC
                """,
                mode, owner_sub, limit,
            )
        return [
            ArenaSubjectResult(
                match_id=str(r["match_id"]),
                seat_index=int(r["seat_index"]),
                placement=int(r["placement"]),
                outcome=r["outcome"],
                score=float(r["score"]),
                rated=bool(r["rated"]),
                seat_count=int(r["seat_count"]),
                entry_path=r["entry_path"],
                completed_at=r["completed_at"],
                detail=_json_obj(r["detail"]),
            )
            for r in rows
        ]

    async def get_player_stats(
        self,
        mode: str,
        owner_subs: Sequence[str],
        detail_keys: Sequence[str] = (),
    ) -> dict[str, ArenaPlayerStats]:
        if not owner_subs:
            return {}
        # One pass. `r.rated` is the settlement-time copy, so this can never
        # include a private-room or practice result even if arena_matches were
        # later corrected -- the same reason the column is denormalised at all.
        #
        # `matches_with_bots` is a per-MATCH property (did this match contain
        # any bot at all), so it is computed with a window over the match rather
        # than from the player's own seat, whose was_bot is always false here.
        async with self._conn() as conn:
            rows = await conn.fetch(
                """
                WITH mine AS (
                    SELECT r.match_id, r.seat_index, r.placement, r.outcome,
                           r.score, r.detail, s.occupant_sub, m.seat_count,
                           EXISTS (
                               SELECT 1 FROM arena_match_results br
                                WHERE br.match_id = r.match_id AND br.was_bot
                           ) AS any_bot
                      FROM arena_match_results r
                      JOIN arena_match_seats s
                        ON s.match_id = r.match_id AND s.seat_index = r.seat_index
                      JOIN arena_matches m ON m.match_id = r.match_id
                     WHERE r.rated
                       AND NOT r.was_bot
                       AND m.mode = $1
                       AND s.occupant_sub = ANY($2::text[])
                )
                SELECT occupant_sub,
                       COUNT(*)                                        AS rated_matches,
                       COUNT(*) FILTER (WHERE outcome = 'win')         AS wins,
                       COUNT(*) FILTER (WHERE outcome = 'loss')        AS losses,
                       COUNT(*) FILTER (WHERE outcome = 'draw')        AS draws,
                       COUNT(*) FILTER (
                           WHERE placement <= GREATEST(1, seat_count / 2)
                       )                                               AS podiums,
                       SUM(placement)                                  AS placement_sum,
                       AVG(score)                                      AS score_avg,
                       MAX(score)                                      AS score_best,
                       COUNT(*) FILTER (WHERE any_bot)                 AS with_bots,
                       COUNT(*) FILTER (WHERE NOT any_bot)             AS all_human
                  FROM mine
                 GROUP BY occupant_sub
                """,
                mode, list(owner_subs),
            )

            stats = {sub: ArenaPlayerStats(owner_sub=sub) for sub in owner_subs}
            for row in rows:
                sub = row["occupant_sub"]
                stats[sub] = ArenaPlayerStats(
                    owner_sub=sub,
                    rated_matches=row["rated_matches"],
                    wins=row["wins"],
                    losses=row["losses"],
                    draws=row["draws"],
                    podiums=row["podiums"],
                    placement_sum=int(row["placement_sum"] or 0),
                    score_avg=round(float(row["score_avg"]), 4) if row["score_avg"] is not None else None,
                    score_best=round(float(row["score_best"]), 4) if row["score_best"] is not None else None,
                    matches_with_bots=row["with_bots"],
                    matches_all_human=row["all_human"],
                )

            for key in detail_keys:
                # A separate narrow query per key rather than dynamic SQL built
                # from `key`: the key names a JSONB field and is chosen by the
                # route, but it is still passed as a PARAMETER and never
                # interpolated into the statement.
                #
                # `jsonb_typeof(...) = 'number'` is what makes an absent or
                # non-numeric value skipped rather than coerced -- a missing
                # measurement is missing, not zero.
                drows = await conn.fetch(
                    """
                    SELECT s.occupant_sub,
                           AVG((r.detail ->> $3)::numeric) AS avg_value,
                           MAX((r.detail ->> $3)::numeric) AS max_value
                      FROM arena_match_results r
                      JOIN arena_match_seats s
                        ON s.match_id = r.match_id AND s.seat_index = r.seat_index
                      JOIN arena_matches m ON m.match_id = r.match_id
                     WHERE r.rated
                       AND NOT r.was_bot
                       AND m.mode = $1
                       AND s.occupant_sub = ANY($2::text[])
                       AND jsonb_typeof(r.detail -> $3) = 'number'
                     GROUP BY s.occupant_sub
                    """,
                    mode, list(owner_subs), key,
                )
                for row in drows:
                    st = stats[row["occupant_sub"]]
                    if row["avg_value"] is not None:
                        st.detail_averages[key] = round(float(row["avg_value"]), 4)
                    if row["max_value"] is not None:
                        st.detail_bests[key] = round(float(row["max_value"]), 4)
        return stats

    async def get_results(self, match_id: str) -> list[ArenaResult]:
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"""
                SELECT {_QUEUE_COLUMNS} FROM arena_public_queue
                 WHERE owner_sub = $1 AND mode = $2 AND status = $3
                """,
                owner_sub, mode, QUEUE_STATUS_WAITING,
            )
        return _row_to_entry(row) if row else None

    async def cancel_queue_entry(self, owner_sub: str, mode: str) -> bool:
        async with self._conn() as conn:
            result = await conn.execute(
                """
                UPDATE arena_public_queue
                   SET status = $3, cancelled_at = NOW()
                 WHERE owner_sub = $1 AND mode = $2 AND status = $4
                """,
                owner_sub, mode, QUEUE_STATUS_CANCELLED, QUEUE_STATUS_WAITING,
            )
        return int(result.rsplit(" ", 1)[-1] or 0) > 0

    async def collapse_human_preference(
        self, owner_sub: str, mode: str, now: datetime
    ) -> Optional[ArenaQueueEntry]:
        # LEAST(), so the window only ever moves EARLIER. A retry or a
        # double-click recomputes the same value and the row is unchanged,
        # which is what makes this safely repeatable without its own
        # idempotency record -- see the protocol docstring.
        #
        # One statement, no read-then-write: the row is never inspected before
        # being narrowed, so two concurrent presses cannot interleave into a
        # window that moved backwards.
        async with self._conn() as conn:
            row = await conn.fetchrow(
                f"""
                UPDATE arena_public_queue
                   SET human_preference_until = LEAST(human_preference_until, $3)
                 WHERE owner_sub = $1 AND mode = $2 AND status = $4
             RETURNING {_QUEUE_COLUMNS}
                """,
                owner_sub, mode, now, QUEUE_STATUS_WAITING,
            )
        return _row_to_entry(row) if row else None

    async def list_waiting_entries(
        self,
        mode: str,
        seat_count: int,
        exclude_owner_sub: Optional[str] = None,
        limit: int = 50,
    ) -> list[ArenaQueueEntry]:
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
        async with self._conn() as conn:
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
