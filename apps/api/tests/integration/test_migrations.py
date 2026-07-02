"""Migrations apply cleanly to a real, isolated Supabase Postgres database
(spec section A, item 1) and are idempotent on rerun.
"""
from __future__ import annotations

from pathlib import Path

import pytest

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent.parent.parent / "supabase" / "migrations"


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


@pytest.mark.asyncio
async def test_migrations_apply_to_a_clean_database(test_database_url: str) -> None:
    assert asyncpg is not None, "asyncpg is required for this test"
    files = _migration_files()
    assert len(files) >= 16, f"expected at least 16 migration files, found {len(files)}"

    pool = await asyncpg.create_pool(test_database_url)
    try:
        async with pool.acquire() as conn:
            for path in files:
                sql = path.read_text()
                await conn.execute(sql)

        async with pool.acquire() as conn:
            for table in (
                "ranked_queue_versions", "rating_algorithm_versions", "division_versions",
                "ranked_queue_entries", "ranked_matches", "ranked_match_participants",
                "ranked_match_submissions", "ranked_opponent_history", "rating_periods",
                "ranked_match_settlements", "rating_ledger_entries", "rating_snapshots",
                "queue_ratings", "placement_states", "ranked_integrity_events",
                "ranked_abort_allowances",
            ):
                exists = await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)",
                    table,
                )
                assert exists, f"expected table {table!r} to exist after migrations"
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_migration_rerun_is_idempotent(test_database_url: str) -> None:
    """CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS throughout the
    migration files means rerunning the full set against an already-migrated
    database must not raise.
    """
    assert asyncpg is not None
    pool = await asyncpg.create_pool(test_database_url)
    try:
        async with pool.acquire() as conn:
            for path in _migration_files():
                await conn.execute(path.read_text())
    finally:
        await pool.close()
