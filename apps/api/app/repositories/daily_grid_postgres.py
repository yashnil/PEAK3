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

from app.repositories.daily_grid_protocols import DailyGridResult

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


class PostgresDailyGridResultRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

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
        return moved
