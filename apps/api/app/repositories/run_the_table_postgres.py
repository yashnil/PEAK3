"""PostgreSQL-backed RunTheTableRunRepository.

Connects via the API's own service-role asyncpg pool -- same pattern as every
other Postgres* repository in this package (see daily_grid_postgres.py /
saved_run_postgres.py) and the same "service-role writes/reads, RLS as
defense-in-depth" split documented in
supabase/migrations/20260630130000_ranked_rls.sql. Owner scoping is enforced
here in application code; the policies in
supabase/migrations/20260731090000_run_the_table.sql are an independent second
layer.

TWO CONVERSIONS THIS FILE OWNS, both because the SQL column type and the
protocol's Python type deliberately differ:

* `run_date` is a real `DATE` column (so the partial unique index and any
  future range query work on dates, not on string prefixes) while the protocol
  exposes `Optional[str]`. Converted both ways here so no caller ever handles
  two date representations.
* `snapshot` is JSONB. asyncpg returns JSONB as `str` unless a codec is
  registered on the pool, so it is decoded defensively -- the same guard
  daily_grid_postgres.py uses.

UPDATE IS ALLOWED HERE, unlike daily_grid_results. A run is a live, resumable
object: every action rewrites its snapshot. What is immutable is the run's
IDENTITY -- run_id, owner_sub, seed, run_type and run_date are never updated,
so a run can never be re-pointed at a different seed after the fact.
"""
from __future__ import annotations

import json
from datetime import date as _date, datetime
from typing import Any, Optional

from app.repositories.run_the_table_protocols import StoredRun

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


def _to_date(value: Optional[str]) -> Optional[_date]:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def _from_date(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, _date):
        return value.isoformat()
    return str(value)


def _json_obj(raw: Any) -> dict:
    """Decode a JSONB column defensively -- see the module docstring."""
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


def _row_to_run(row: Any) -> StoredRun:
    return StoredRun(
        run_id=row["run_id"],
        owner_sub=row["owner_sub"],
        seed=int(row["seed"]),
        run_type=row["run_type"],
        run_date=_from_date(row["run_date"]),
        status=row["status"],
        snapshot=_json_obj(row["snapshot"]),
        engine_version=row["engine_version"],
        ruleset_version=row["ruleset_version"],
        card_pool_version=row["card_pool_version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class PostgresRunTheTableRunRepository:
    def __init__(self, pool: Any) -> None:
        _require_asyncpg()
        self._pool = pool

    async def create_run(self, run: StoredRun) -> tuple[StoredRun, bool]:
        if run.run_type == "daily" and run.run_date:
            existing = await self.get_daily_run(run.owner_sub, run.run_date)
            if existing is not None:
                # A daily happens once -- see the protocol docstring. The
                # partial unique index is the authoritative guard; this check
                # just avoids a pointless failed INSERT on the common
                # reload/double-click path.
                return existing, False

        async with self._pool.acquire() as conn:
            try:
                await conn.execute(
                    """
                    INSERT INTO run_the_table_runs (
                        run_id, owner_sub, seed, run_type, run_date, status, snapshot,
                        engine_version, ruleset_version, card_pool_version,
                        created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12
                    )
                    """,
                    run.run_id, run.owner_sub, run.seed, run.run_type,
                    _to_date(run.run_date), run.status, json.dumps(run.snapshot),
                    run.engine_version, run.ruleset_version, run.card_pool_version,
                    run.created_at, run.updated_at,
                )
            except asyncpg.UniqueViolationError:
                # Concurrent daily creation -- return whichever write won, so
                # both callers play the same official run.
                if run.run_type == "daily" and run.run_date:
                    saved = await self.get_daily_run(run.owner_sub, run.run_date)
                    if saved is not None:
                        return saved, False
                raise
        return run, True

    async def get_run(self, run_id: str) -> Optional[StoredRun]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM run_the_table_runs WHERE run_id = $1", run_id
            )
            return _row_to_run(row) if row is not None else None

    async def save_run(self, run: StoredRun) -> StoredRun:
        # Identity columns (run_id/owner_sub/seed/run_type/run_date) are
        # deliberately absent from the SET list: a run's seed is what makes it
        # reproducible, so it must never be re-pointed after creation.
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE run_the_table_runs
                   SET status = $2,
                       snapshot = $3::jsonb,
                       updated_at = NOW()
                 WHERE run_id = $1
             RETURNING *
                """,
                run.run_id, run.status, json.dumps(run.snapshot),
            )
        if row is None:
            raise KeyError(f"Run '{run.run_id}' does not exist")
        return _row_to_run(row)

    async def get_daily_run(self, owner_sub: str, run_date: str) -> Optional[StoredRun]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM run_the_table_runs
                 WHERE owner_sub = $1 AND run_type = 'daily' AND run_date = $2
                """,
                owner_sub, _to_date(run_date),
            )
            return _row_to_run(row) if row is not None else None

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 20) -> list[StoredRun]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM run_the_table_runs
                 WHERE owner_sub = $1
                 ORDER BY created_at DESC
                 LIMIT $2
                """,
                owner_sub, limit,
            )
            return [_row_to_run(row) for row in rows]
