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

# See test_auth_flows.py's comment: conftest.py's pytestmark does not
# propagate to sibling modules, so each module declares it directly.
pytestmark = pytest.mark.supabase_integration


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


# Every table the chain is expected to create. The list used to name only the
# 16 ranked tables, which meant the six domains added after Phase 4.0 --
# leaderboard, saved runs, daily grid, RUN THE TABLE, and the Peak Duel Daily
# attempt record -- could have been dropped from the chain entirely without
# this test noticing. A migration test that only checks the tables that existed
# when it was written stops being a migration test.
EXPECTED_TABLES = (
    # 20260630124500_identity
    "profiles", "user_settings", "anonymous_subjects", "ownership_claims",
    # 20260630124600_versioning
    "lineup_model_versions", "ruleset_versions", "card_pool_versions",
    # 20260630124700_game_records
    "board_snapshots", "games", "game_actions", "result_snapshots", "daily_completions",
    # 20260630124800_challenges
    "challenges", "challenge_participants", "challenge_settlements",
    # 20260630125000..125300 progression
    "xp_policy_versions", "progression_events", "user_progress",
    "personal_records", "personal_record_events",
    "achievement_definitions", "achievement_awards",
    "streak_states", "streak_events",
    # ranked (20260630125500..125900)
    "ranked_queue_versions", "rating_algorithm_versions", "division_versions",
    "ranked_queue_entries", "ranked_matches", "ranked_match_participants",
    "ranked_match_submissions", "ranked_opponent_history", "rating_periods",
    "ranked_match_settlements", "rating_ledger_entries", "rating_snapshots",
    "queue_ratings", "placement_states", "ranked_integrity_events",
    "ranked_abort_allowances",
    # post-Phase-4.0 game domains
    "perfect_season_runs", "perfect_season_run_cards",       # 20260724150000
    "perfect_season_saved_runs",                             # 20260729180000
    "daily_grid_results",                                    # 20260730190000
    "run_the_table_runs",                                    # 20260731090000
    "peak_duel_daily_results",                               # 20260801110000
    # Arena multiplayer foundation                             20260804100000
    "arena_matches", "arena_match_seats", "arena_match_commands",
    "arena_match_events", "arena_turns", "arena_match_results",
    "arena_public_queue",
    # Arena public ratings                                      20260804140000
    "arena_ratings", "arena_rating_history",
)

# Tables whose rows are owned by one player and must never be world-readable.
# `rowsecurity` is asserted rather than assumed: the three version registries
# were created with RLS never enabled at all, and nothing caught it for a year
# of migrations because no test ever asked.
RLS_REQUIRED_TABLES = (
    "profiles", "games", "daily_completions", "result_snapshots", "challenges",
    "board_snapshots", "lineup_model_versions", "ruleset_versions", "card_pool_versions",
    "perfect_season_runs", "perfect_season_saved_runs", "daily_grid_results",
    "run_the_table_runs", "peak_duel_daily_results",
    # Every arena table is seat-scoped or server-only; none is world-readable.
    # `arena_matches.snapshot` is live game state, `arena_match_events` carries
    # sealed bids and unrevealed cards, and `arena_matches.seed` regenerates
    # every board in the match -- all three are spoiler material even to a
    # spectator, let alone an opponent.
    "arena_matches", "arena_match_seats", "arena_match_commands",
    "arena_match_events", "arena_turns", "arena_match_results",
    "arena_public_queue",
    # `arena_ratings` is world-READABLE by design -- it is a public
    # leaderboard -- but RLS is still required on it, because the protection
    # that matters there is COLUMN-level: `owner_sub` is a Supabase auth.uid()
    # and is withheld from anon/authenticated by an explicit column GRANT, the
    # same treatment `profiles.auth_sub` gets. RLS being enabled is what makes
    # the write policies below it meaningful.
    # `arena_rating_history` is a player's own ledger and is self-only.
    "arena_ratings", "arena_rating_history",
)


@pytest.mark.asyncio
async def test_migrations_apply_to_a_clean_database(test_database_url: str) -> None:
    assert asyncpg is not None, "asyncpg is required for this test"
    files = _migration_files()
    assert len(files) >= 23, f"expected at least 23 migration files, found {len(files)}"

    pool = await asyncpg.create_pool(test_database_url)
    try:
        async with pool.acquire() as conn:
            for path in files:
                sql = path.read_text()
                await conn.execute(sql)

        async with pool.acquire() as conn:
            for table in EXPECTED_TABLES:
                exists = await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)",
                    table,
                )
                assert exists, f"expected table {table!r} to exist after migrations"
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_every_owned_table_has_row_level_security_enabled(test_database_url: str) -> None:
    """RLS is the second layer, and a second layer that is off is not a layer.

    The API bypasses RLS by design (it connects as the table owner), so a table
    with RLS accidentally left off looks completely healthy from the
    application's side. The only caller that notices is a client holding the
    project's anon key -- which is precisely the caller these policies exist to
    stop.
    """
    assert asyncpg is not None
    pool = await asyncpg.create_pool(test_database_url)
    try:
        async with pool.acquire() as conn:
            for path in _migration_files():
                await conn.execute(path.read_text())

            for table in RLS_REQUIRED_TABLES:
                enabled = await conn.fetchval(
                    "SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = $1",
                    table,
                )
                assert enabled is True, f"{table}: row level security must be enabled"
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_spoiler_columns_are_not_granted_to_client_roles(test_database_url: str) -> None:
    """`board_snapshots.seed` and the challenge secrets stay server-side.

    The row policies on both tables are `USING (true)`, so nothing about the
    ROW filter withholds these -- only the column-level grants in
    20260801100000_rls_gaps.sql do. Asserted at the privilege level so a future
    `GRANT SELECT ON ALL TABLES` cannot quietly re-open them.
    """
    assert asyncpg is not None
    pool = await asyncpg.create_pool(test_database_url)
    try:
        async with pool.acquire() as conn:
            for path in _migration_files():
                await conn.execute(path.read_text())

            withheld = (
                ("board_snapshots", "seed"),
                ("board_snapshots", "metadata"),
                ("challenges", "seed"),
                ("challenges", "token_hash"),
                ("challenges", "challenger_snapshot"),
                ("challenges", "anon_subject_id"),
                ("challenges", "settlement"),
            )
            for table, column in withheld:
                for role in ("anon", "authenticated"):
                    # The role name is interpolated (from a fixed tuple, so
                    # no injection surface) because has_column_privilege's first
                    # argument is `name`, not `text`, and passing it as a bind
                    # parameter leaves the overload resolution ambiguous.
                    granted = await conn.fetchval(
                        f"SELECT has_column_privilege('{role}', $1, $2, 'SELECT')",
                        table, column,
                    )
                    assert granted is False, (
                        f"{role} must not be able to read {table}.{column}"
                    )

            # ...while the genuinely public metadata is still readable.
            for table, column in (("board_snapshots", "board_id"), ("challenges", "expires_at")):
                for role in ("anon", "authenticated"):
                    granted = await conn.fetchval(
                        f"SELECT has_column_privilege('{role}', $1, $2, 'SELECT')",
                        table, column,
                    )
                    assert granted is True, f"{role} should still read {table}.{column}"
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
