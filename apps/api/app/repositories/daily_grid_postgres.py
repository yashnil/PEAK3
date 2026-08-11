"""PostgreSQL-backed DailyGridResultRepository (Phase 11D).

Connects via the API's own service-role asyncpg pool -- same pattern as every
other Postgres* repository in this package (see postgres.py /
saved_run_postgres.py) and the same "service-role writes/reads, RLS as
defense-in-depth" split documented in
supabase/migrations/20260630130000_ranked_rls.sql. Owner scoping is enforced
here in application code (every query filters on owner_sub); the RLS policies
in 20260730190000_daily_grid_results.sql are a second, independent layer.

There is no UPDATE path anywhere in this file, matching the migration's
deliberate absence of an UPDATE policy: an official daily result is immutable.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from app.repositories.daily_grid_protocols import (
    DailyGridAttempt,
    DailyGridLeaderboardEntry,
    DailyGridResult,
    DailyGridRetryAttempt,
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


def _json_str_list(raw: Any) -> list[str]:
    """asyncpg returns JSONB as a str unless a codec is registered -- decode
    defensively so this works with or without one."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(v) for v in raw]
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        return [str(v) for v in parsed] if isinstance(parsed, list) else []
    return []


def _row_to_result(row: Any) -> DailyGridResult:
    return DailyGridResult(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        board_id=row["board_id"],
        board_date=row["board_date"],
        board_version=row["board_version"],
        board_theme=row["board_theme"],
        score=row["score"],
        optimal_total=row["optimal_total"],
        percent_of_best=float(row["percent_of_best"]),
        squares_matching_optimal=row["squares_matching_optimal"],
        incorrect_attempts=row["incorrect_attempts"],
        elapsed_seconds=row["elapsed_seconds"],
        played_on_board_date=row["played_on_board_date"],
        answers=_json_str_list(row["answers"]),
        created_at=row["created_at"],
    )


def _row_to_leaderboard_entry(row: Any) -> DailyGridLeaderboardEntry:
    return DailyGridLeaderboardEntry(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        daily_key=row["daily_key"],
        board_id=row["board_id"],
        board_version=row["board_version"],
        score=row["score"],
        completion_time_ms=row["completion_time_ms"],
        result_id=str(row["result_id"]),
        completed_at=row["completed_at"],
        created_at=row["created_at"],
    )


def _row_to_attempt(row: Any) -> DailyGridAttempt:
    return DailyGridAttempt(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        daily_key=row["daily_key"],
        board_id=row["board_id"],
        board_version=row["board_version"],
        started_at=row["started_at"],
    )


class PostgresDailyGridResultRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    # -- Attempts (the server-side clock) --------------------------------

    async def start_attempt(
        self, attempt: DailyGridAttempt
    ) -> tuple[DailyGridAttempt, bool]:
        """Write ``started_at`` exactly once for (owner, daily_key).

        A single statement, not a read-then-write: two tabs that both post
        `start` inside the same millisecond must agree on the timestamp, and
        the only thing that can guarantee that is the database. `ON CONFLICT DO
        NOTHING` plus `RETURNING` gives "created" for free -- an empty
        RETURNING means the row was already there, so we read it back and
        report `created=False` with the ORIGINAL timestamp.

        Deliberately NOT `ON CONFLICT DO UPDATE`: updating would let a second
        call move the clock, which is the exact abuse the server-side timer
        exists to prevent.
        """
        attempt_id = attempt.id or str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO daily_grid_attempts (
                    id, owner_sub, daily_key, board_id, board_version, started_at
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (owner_sub, daily_key) DO NOTHING
                RETURNING *
                """,
                attempt_id, attempt.owner_sub, attempt.daily_key,
                attempt.board_id, attempt.board_version, attempt.started_at,
            )
            if row is not None:
                return _row_to_attempt(row), True
            existing = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_attempts
                WHERE owner_sub = $1 AND daily_key = $2
                """,
                attempt.owner_sub, attempt.daily_key,
            )
        if existing is None:
            # The conflicting row was deleted between the INSERT and the
            # SELECT. Vanishingly unlikely, and reporting the caller's own
            # timestamp is the honest answer -- never a silent None.
            attempt.id = attempt_id
            return attempt, True
        return _row_to_attempt(existing), False

    async def get_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridAttempt]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_attempts
                WHERE owner_sub = $1 AND daily_key = $2
                """,
                owner_sub, daily_key,
            )
            return _row_to_attempt(row) if row is not None else None

    # -- Official results -------------------------------------------------

    async def save_result(self, result: DailyGridResult) -> tuple[DailyGridResult, bool]:
        existing = await self.get_result(
            result.owner_sub, result.board_date, result.board_version
        )
        if existing is not None:
            # Idempotent -- see the protocol's own docstring. The UNIQUE
            # constraint is the authoritative guard; this check just avoids a
            # pointless failed INSERT on the common reload/double-click path.
            return existing, False

        result_id = result.id or str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO daily_grid_results (
                        id, owner_sub, board_id, board_date, board_version, board_theme,
                        score, optimal_total, percent_of_best, squares_matching_optimal,
                        incorrect_attempts, elapsed_seconds, played_on_board_date,
                        answers, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15
                    )
                    """,
                    result_id, result.owner_sub, result.board_id, result.board_date,
                    result.board_version, result.board_theme, result.score,
                    result.optimal_total, result.percent_of_best,
                    result.squares_matching_optimal, result.incorrect_attempts,
                    result.elapsed_seconds, result.played_on_board_date,
                    json.dumps(result.answers), result.created_at,
                )
            except asyncpg.UniqueViolationError:
                # Concurrent double-save -- return whichever write won, so both
                # callers see the same official record.
                saved = await self.get_result(
                    result.owner_sub, result.board_date, result.board_version
                )
                if saved is not None:
                    return saved, False
                raise
        result.id = result_id
        return result, True

    async def get_result(
        self, owner_sub: str, board_date: str, board_version: str
    ) -> Optional[DailyGridResult]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_results
                WHERE owner_sub = $1 AND board_date = $2 AND board_version = $3
                """,
                owner_sub, board_date, board_version,
            )
            return _row_to_result(row) if row is not None else None

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[DailyGridResult]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM daily_grid_results
                WHERE owner_sub = $1
                ORDER BY board_date DESC, created_at DESC
                LIMIT $2
                """,
                owner_sub, limit,
            )
            return [_row_to_result(row) for row in rows]

    # -- Leaderboard (public best-per-user-per-day) ------------------------

    #: The ranking, as ORDER BY — the SQL spelling of
    #: `daily_grid_protocols.leaderboard_sort_key`, kept adjacent to its
    #: WHERE so the paired partial index below stays the obvious plan.
    _LEADERBOARD_ORDER = (
        "ORDER BY score DESC, completion_time_ms ASC NULLS LAST, "
        "completed_at ASC, id ASC"
    )

    async def upsert_leaderboard_best(
        self, entry: DailyGridLeaderboardEntry
    ) -> tuple[DailyGridLeaderboardEntry, bool]:
        """One statement, atomic under concurrency (A2.5).

        The better-only rule lives in the `WHERE` of `ON CONFLICT DO UPDATE`
        — the SQL spelling of `daily_grid_protocols.is_strictly_better` — so
        two simultaneous submissions serialise on the unique index and the
        loser of the race is compared against the winner's ROW, not against a
        stale read. `RETURNING` is non-empty only when the insert or the
        qualified update actually applied; an empty return means the incumbent
        stood, and it is read back unchanged.
        """
        entry_id = entry.id or str(uuid.uuid4())
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO daily_grid_leaderboard_entries (
                    id, owner_sub, daily_key, board_id, board_version,
                    score, completion_time_ms, result_id, completed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (owner_sub, daily_key, board_version) DO UPDATE SET
                    score = EXCLUDED.score,
                    completion_time_ms = EXCLUDED.completion_time_ms,
                    result_id = EXCLUDED.result_id,
                    board_id = EXCLUDED.board_id,
                    completed_at = EXCLUDED.completed_at,
                    updated_at = NOW()
                WHERE
                    EXCLUDED.score > daily_grid_leaderboard_entries.score
                    OR (
                        EXCLUDED.score = daily_grid_leaderboard_entries.score
                        AND EXCLUDED.completion_time_ms IS NOT NULL
                        AND (
                            daily_grid_leaderboard_entries.completion_time_ms IS NULL
                            OR EXCLUDED.completion_time_ms
                                < daily_grid_leaderboard_entries.completion_time_ms
                        )
                    )
                RETURNING *
                """,
                entry_id, entry.owner_sub, entry.daily_key, entry.board_id,
                entry.board_version, entry.score, entry.completion_time_ms,
                entry.result_id, entry.completed_at,
            )
            if row is not None:
                return _row_to_leaderboard_entry(row), True
            existing = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_leaderboard_entries
                WHERE owner_sub = $1 AND daily_key = $2 AND board_version = $3
                """,
                entry.owner_sub, entry.daily_key, entry.board_version,
            )
        if existing is None:
            # The incumbent vanished between statements — retry-once territory,
            # but honesty beats loops: report the caller's entry as unapplied.
            entry.id = entry_id
            return entry, False
        return _row_to_leaderboard_entry(existing), False

    async def leaderboard_top(
        self, daily_key: str, limit: int = 25
    ) -> list[DailyGridLeaderboardEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT * FROM daily_grid_leaderboard_entries
                WHERE daily_key = $1
                {self._LEADERBOARD_ORDER}
                LIMIT $2
                """,
                daily_key, limit,
            )
            return [_row_to_leaderboard_entry(r) for r in rows]

    async def leaderboard_entry_for_owner(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridLeaderboardEntry]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_leaderboard_entries
                WHERE owner_sub = $1 AND daily_key = $2
                """,
                owner_sub, daily_key,
            )
            return _row_to_leaderboard_entry(row) if row is not None else None

    async def leaderboard_all_for_day(
        self, daily_key: str
    ) -> list[DailyGridLeaderboardEntry]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT * FROM daily_grid_leaderboard_entries
                WHERE daily_key = $1
                {self._LEADERBOARD_ORDER}
                """,
                daily_key,
            )
            return [_row_to_leaderboard_entry(r) for r in rows]

    async def start_retry_attempt(
        self, attempt: DailyGridRetryAttempt
    ) -> DailyGridRetryAttempt:
        """Plain INSERT, no conflict clause: every retry is its own clock and
        `started_at` is the database's NOW(), never a caller-supplied value."""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO daily_grid_retry_attempts (id, owner_sub, daily_key)
                VALUES ($1, $2, $3)
                RETURNING *
                """,
                attempt.id or str(uuid.uuid4()),
                attempt.owner_sub,
                attempt.daily_key,
            )
        return DailyGridRetryAttempt(
            id=str(row["id"]),
            owner_sub=row["owner_sub"],
            daily_key=row["daily_key"],
            started_at=row["started_at"],
            created_at=row["created_at"],
        )

    async def latest_retry_attempt(
        self, owner_sub: str, daily_key: str
    ) -> Optional[DailyGridRetryAttempt]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM daily_grid_retry_attempts
                WHERE owner_sub = $1 AND daily_key = $2
                ORDER BY started_at DESC, created_at DESC
                LIMIT 1
                """,
                owner_sub, daily_key,
            )
        if row is None:
            return None
        return DailyGridRetryAttempt(
            id=str(row["id"]),
            owner_sub=row["owner_sub"],
            daily_key=row["daily_key"],
            started_at=row["started_at"],
            created_at=row["created_at"],
        )

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign this owner's results to `to_sub` -- the guest-claim path.

        This is the one place in this file that writes `owner_sub`, and it is
        not an exception to the table's immutability: it changes WHO a result
        belongs to, never WHAT the result was. Every scored column is left
        untouched.

        Runs in one transaction, moves what
        `UNIQUE (owner_sub, board_date, board_version)` allows, and sweeps the
        rest -- the same shape as
        PostgresDailyCompletionRepository.transfer_owner.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                result = await conn.execute(
                    """
                    UPDATE daily_grid_results AS d
                       SET owner_sub = $2
                     WHERE d.owner_sub = $1
                       AND NOT EXISTS (
                            SELECT 1 FROM daily_grid_results AS existing
                             WHERE existing.owner_sub = $2
                               AND existing.board_date = d.board_date
                               AND existing.board_version = d.board_version
                       )
                    """,
                    from_sub, to_sub,
                )
                moved = int(result.split()[-1])
                await conn.execute(
                    "DELETE FROM daily_grid_results WHERE owner_sub = $1", from_sub
                )

                # In-progress clocks follow their owner, same collision rule,
                # not counted in `moved`. Guarded by to_regclass so a
                # deployment that has not yet applied
                # 20260801150000_daily_grid_attempts.sql still claims results.
                if await conn.fetchval(
                    "SELECT to_regclass('public.daily_grid_attempts')"
                ):
                    await conn.execute(
                        """
                        UPDATE daily_grid_attempts AS a
                           SET owner_sub = $2
                         WHERE a.owner_sub = $1
                           AND NOT EXISTS (
                                SELECT 1 FROM daily_grid_attempts AS existing
                                 WHERE existing.owner_sub = $2
                                   AND existing.daily_key = a.daily_key
                           )
                        """,
                        from_sub, to_sub,
                    )
                    await conn.execute(
                        "DELETE FROM daily_grid_attempts WHERE owner_sub = $1", from_sub
                    )
        return moved
