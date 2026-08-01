"""PostgreSQL-backed PeakDuelDailyResultRepository.

Connects via the API's own table-owning asyncpg pool -- same pattern as every
other Postgres* repository in this package (see daily_grid_postgres.py) and the
same "service-role writes/reads, RLS as defense-in-depth" split documented in
supabase/migrations/20260801100000_rls_gaps.sql's header. Owner scoping is
enforced here in application code (every query filters on owner_sub); the RLS
policies in 20260801110000_guest_claim_and_daily.sql are a second, independent
layer that binds PostgREST clients only.

There is no UPDATE path to any scored column anywhere in this file, matching
the migration's deliberate absence of an UPDATE policy: an official daily
attempt is immutable. `transfer_owner` writes `owner_sub` and nothing else --
it changes who an attempt belongs to, never what happened in it.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from app.repositories.peak_duel_daily_protocols import PeakDuelDailyResult

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


def _json_dict_list(raw: Any) -> list[dict]:
    """asyncpg returns JSONB as a str unless a codec is registered -- decode
    defensively so this works with or without one (same guard as
    daily_grid_postgres.py)."""
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [dict(v) for v in raw if isinstance(v, dict)]
    if isinstance(raw, (str, bytes)):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        if isinstance(parsed, list):
            return [v for v in parsed if isinstance(v, dict)]
        return []
    return []


def _row_to_result(row: Any) -> PeakDuelDailyResult:
    return PeakDuelDailyResult(
        id=str(row["id"]),
        owner_sub=row["owner_sub"],
        mode=row["mode"],
        daily_key=row["daily_key"],
        duration_years=row["duration_years"],
        duels_total=row["duels_total"],
        correct_count=row["correct_count"],
        arena_points=row["arena_points"],
        best_streak=row["best_streak"],
        elapsed_seconds=row["elapsed_seconds"],
        played_on_daily_key=row["played_on_daily_key"],
        answers=_json_dict_list(row["answers"]),
        created_at=row["created_at"],
    )


class PostgresPeakDuelDailyResultRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def save_result(
        self, result: PeakDuelDailyResult
    ) -> tuple[PeakDuelDailyResult, bool]:
        existing = await self.get_result(result.owner_sub, result.mode, result.daily_key)
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
                    INSERT INTO peak_duel_daily_results (
                        id, owner_sub, mode, daily_key, duration_years, duels_total,
                        correct_count, arena_points, best_streak, elapsed_seconds,
                        played_on_daily_key, answers, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13
                    )
                    """,
                    result_id, result.owner_sub, result.mode, result.daily_key,
                    result.duration_years, result.duels_total, result.correct_count,
                    result.arena_points, result.best_streak, result.elapsed_seconds,
                    result.played_on_daily_key, json.dumps(result.answers),
                    result.created_at,
                )
            except asyncpg.UniqueViolationError:
                # Concurrent double-save -- return whichever write won, so both
                # callers see the same official record.
                saved = await self.get_result(
                    result.owner_sub, result.mode, result.daily_key
                )
                if saved is not None:
                    return saved, False
                raise
        result.id = result_id
        return result, True

    async def get_result(
        self, owner_sub: str, mode: str, daily_key: str
    ) -> Optional[PeakDuelDailyResult]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM peak_duel_daily_results
                WHERE owner_sub = $1 AND mode = $2 AND daily_key = $3
                """,
                owner_sub, mode, daily_key,
            )
            return _row_to_result(row) if row is not None else None

    async def list_results_for_owner(
        self, owner_sub: str, limit: int = 30
    ) -> list[PeakDuelDailyResult]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM peak_duel_daily_results
                WHERE owner_sub = $1
                ORDER BY daily_key DESC, created_at DESC
                LIMIT $2
                """,
                owner_sub, limit,
            )
            return [_row_to_result(row) for row in rows]

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign this owner's attempts to `to_sub` -- the guest-claim path.

        Runs in one transaction, moves what
        `UNIQUE (owner_sub, mode, daily_key)` allows, and sweeps the rest --
        the same shape as PostgresDailyCompletionRepository.transfer_owner.
        """
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                result = await conn.execute(
                    """
                    UPDATE peak_duel_daily_results AS p
                       SET owner_sub = $2
                     WHERE p.owner_sub = $1
                       AND NOT EXISTS (
                            SELECT 1 FROM peak_duel_daily_results AS existing
                             WHERE existing.owner_sub = $2
                               AND existing.mode = p.mode
                               AND existing.daily_key = p.daily_key
                       )
                    """,
                    from_sub, to_sub,
                )
                moved = int(result.split()[-1])
                await conn.execute(
                    "DELETE FROM peak_duel_daily_results WHERE owner_sub = $1", from_sub
                )
        return moved
