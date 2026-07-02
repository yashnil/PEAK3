"""Real Supabase RLS round-trip tests (spec section A / Q).

These connect through PostgREST-equivalent row-level security by opening a
Postgres connection AS the anon/authenticated roles Supabase issues,
using `SET LOCAL ROLE` + `SET LOCAL request.jwt.claims` the same way
PostgREST does, so the policies in supabase/migrations/20260630124900_rls.sql,
20260630125400_progression_rls.sql, and 20260630130000_ranked_rls.sql are
exercised for real rather than asserted about.
"""
from __future__ import annotations

import json
import uuid

import pytest
import pytest_asyncio

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

# See test_auth_flows.py's comment: conftest.py's pytestmark does not
# propagate to sibling modules, so each module declares it directly.
pytestmark = pytest.mark.supabase_integration


async def _connection_as(pool, sub: str | None, role: str = "authenticated"):
    """Open a connection whose RLS-visible identity is `sub` (or anonymous
    if sub is None), mirroring how Supabase's PostgREST layer sets
    request.jwt.claims and switches Postgres role per request.
    """
    conn = await pool.acquire()
    claims = {"sub": sub} if sub else {}
    await conn.execute("SET ROLE %s" % ("authenticated" if sub else "anon"))
    await conn.execute("SELECT set_config('request.jwt.claims', $1, false)", json.dumps(claims))
    return conn


@pytest_asyncio.fixture
async def db_pool(test_database_url: str):
    assert asyncpg is not None
    pool = await asyncpg.create_pool(test_database_url)
    yield pool
    await pool.close()


@pytest.mark.asyncio
async def test_authenticated_owner_can_read_own_queue_entry(db_pool) -> None:
    # auth.uid() casts the JWT sub claim to ::uuid (see auth.uid()'s real
    # definition on this stack) — ranked owner_sub is always a genuine
    # Supabase auth UUID in production (ranked requires a real account, never
    # an anonymous session), so test subs must be real UUIDs too.
    owner_sub = str(uuid.uuid4())
    async with db_pool.acquire() as service_conn:
        await service_conn.execute(
            """
            INSERT INTO ranked_queue_versions (mode, queue_version, ruleset_version, lineup_model_version,
                card_pool_version, board_generator_version, anchor_eligibility_version, rating_algorithm_version)
            VALUES ('apex_1y', 'ranked_queue_v1', 'r', 'l', 'c', 'b', 'a', 'glicko2_v1')
            ON CONFLICT DO NOTHING
            """
        )
        await service_conn.execute(
            """
            INSERT INTO ranked_queue_entries
                (id, owner_sub, mode, queue_version, rating_snapshot, rd_snapshot,
                 volatility_snapshot, placement_state, status, joined_at, search_range_rating)
            VALUES (gen_random_uuid(), $1, 'apex_1y', 'ranked_queue_v1', 1500, 350, 0.06, 'placement', 'waiting', NOW(), 100)
            """,
            owner_sub,
        )

    conn = await _connection_as(db_pool, owner_sub)
    try:
        rows = await conn.fetch("SELECT * FROM ranked_queue_entries WHERE owner_sub = $1", owner_sub)
        assert len(rows) == 1
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_authenticated_non_owner_cannot_read_someone_elses_queue_entry(db_pool) -> None:
    owner_sub = str(uuid.uuid4())
    stranger_sub = str(uuid.uuid4())
    async with db_pool.acquire() as service_conn:
        await service_conn.execute(
            """
            INSERT INTO ranked_queue_versions (mode, queue_version, ruleset_version, lineup_model_version,
                card_pool_version, board_generator_version, anchor_eligibility_version, rating_algorithm_version)
            VALUES ('apex_1y', 'ranked_queue_v1', 'r', 'l', 'c', 'b', 'a', 'glicko2_v1')
            ON CONFLICT DO NOTHING
            """
        )
        await service_conn.execute(
            """
            INSERT INTO ranked_queue_entries
                (id, owner_sub, mode, queue_version, rating_snapshot, rd_snapshot,
                 volatility_snapshot, placement_state, status, joined_at, search_range_rating)
            VALUES (gen_random_uuid(), $1, 'apex_1y', 'ranked_queue_v1', 1500, 350, 0.06, 'placement', 'waiting', NOW(), 100)
            """,
            owner_sub,
        )

    conn = await _connection_as(db_pool, stranger_sub)
    try:
        rows = await conn.fetch("SELECT * FROM ranked_queue_entries WHERE owner_sub = $1", owner_sub)
        assert rows == [], "a non-owner must never see another user's queue entry"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_anonymous_cannot_read_private_ranked_tables(db_pool) -> None:
    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        for table in ("ranked_queue_entries", "rating_ledger_entries", "ranked_match_settlements", "placement_states"):
            rows = await conn.fetch(f"SELECT * FROM {table}")
            assert rows == [], f"anonymous role must not read any rows from {table}"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_public_metadata_tables_are_readable_by_anonymous(db_pool) -> None:
    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch("SELECT * FROM ranked_queue_versions")
        assert isinstance(rows, list)  # readable (possibly empty), not denied
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_participant_cannot_read_opponent_submission_before_settlement(db_pool) -> None:
    sub_a, sub_b = str(uuid.uuid4()), str(uuid.uuid4())
    match_id = str(uuid.uuid4())
    async with db_pool.acquire() as service_conn:
        await service_conn.execute(
            """
            INSERT INTO ranked_queue_versions (mode, queue_version, ruleset_version, lineup_model_version,
                card_pool_version, board_generator_version, anchor_eligibility_version, rating_algorithm_version)
            VALUES ('apex_1y', 'ranked_queue_v1', 'r', 'l', 'c', 'b', 'a', 'glicko2_v1')
            ON CONFLICT DO NOTHING
            """
        )
        await service_conn.execute(
            """
            INSERT INTO ranked_matches (id, mode, queue_version, board_snapshot, board_version_key,
                rating_algorithm_version, deadline)
            VALUES ($1, 'apex_1y', 'ranked_queue_v1', '{}'::jsonb, 'key-1', 'glicko2_v1', NOW() + interval '1 day')
            """,
            match_id,
        )
        for slot, sub in ((0, sub_a), (1, sub_b)):
            await service_conn.execute(
                """
                INSERT INTO ranked_match_participants
                    (id, match_id, owner_sub, slot, status, joined_at, pre_match_rating, pre_match_rd, pre_match_volatility)
                VALUES (gen_random_uuid(), $1, $2, $3, 'in_progress', NOW(), 1500, 350, 0.06)
                """,
                match_id, sub, slot,
            )
        await service_conn.execute(
            """
            INSERT INTO ranked_match_submissions
                (id, match_id, participant_id, owner_sub, game_id, board_version_key, lineup_evaluation, solver_version, submitted_at, idempotency_key)
            SELECT gen_random_uuid(), $1, id, owner_sub, gen_random_uuid(), 'key-1', '{}'::jsonb, 'v1', NOW(), 'idem-1'
            FROM ranked_match_participants WHERE match_id = $1 AND owner_sub = $2
            """,
            match_id, sub_b,
        )

    conn = await _connection_as(db_pool, sub_a)
    try:
        rows = await conn.fetch("SELECT * FROM ranked_match_submissions WHERE match_id = $1", match_id)
        assert rows == [], "participant A must not see participant B's submission before settlement"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)
