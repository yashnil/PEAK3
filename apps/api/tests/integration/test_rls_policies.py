"""Real Supabase RLS round-trip tests (spec section A / Q).

These connect through PostgREST-equivalent row-level security by opening a
Postgres connection AS the anon/authenticated roles Supabase issues,
using `SET LOCAL ROLE` + `SET LOCAL request.jwt.claims` the same way
PostgREST does, so the policies in supabase/migrations/20260630124900_rls.sql,
20260630125400_progression_rls.sql, 20260630130000_ranked_rls.sql,
20260801100000_rls_gaps.sql and 20260801110000_guest_claim_and_daily.sql are
exercised for real rather than asserted about.

WHO THESE TESTS ARE ABOUT. Not the API. The API holds one asyncpg pool opened
as the table-owning role, never issues `SET ROLE`, never sets
`request.jwt.claims`, and no table carries FORCE ROW LEVEL SECURITY -- so it
bypasses RLS entirely and enforces owner scoping in application code. The
caller these policies actually bind is a client holding the project's
anon/authenticated key and talking to PostgREST, which is the shape emulated
by `_connection_as` below. Both layers are real and neither substitutes for
the other; this file covers the second one.

EVERY OWNED TABLE GETS A CROSS-USER DENIAL TEST. "The owner can read their own
row" passes just as happily against a policy of `USING (true)`, so it proves
almost nothing on its own. The paired "a stranger sees nothing" assertion is
the one that fails when a policy is wrong.
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


# ---------------------------------------------------------------------------
# Owner-scoped tables: own row visible, stranger's row invisible, anon blind.
#
# Every table below is written by the API through its own table-owning
# connection, so these policies are the second layer -- what a PostgREST client
# holding an anon/authenticated key is allowed to see.
#
# `auth.uid()` casts the JWT `sub` claim to ::uuid on this stack, so every test
# subject here is a real UUID. Production rows on the anonymous-first tables
# (run_the_table_runs, peak_duel_daily_results) are frequently owned by an
# 'anon:...' cookie subject instead, which auth.uid() can never equal -- that
# case is covered separately below.
# ---------------------------------------------------------------------------

# table -> (owner column, INSERT taking the owner sub as $1)
#
# `profiles` is deliberately NOT in this dict. This generic harness's own
# verification technique -- `SELECT 1 FROM {table} WHERE {owner_column} = $1`
# -- requires SELECT privilege on the owner column itself, which is exactly
# the privilege 20260803120000_profile_column_privileges.sql revokes for
# `profiles.auth_sub` (Postgres checks column privilege for every column a
# query REFERENCES, WHERE clauses included, not only the output list). Using
# this harness unmodified against profiles would either force auth_sub back
# open or make every profiles case in this loop raise
# InsufficientPrivilegeError instead of asserting the row-visibility outcome
# it exists to check. `profiles` gets its own dedicated tests below instead,
# in "Column-level privileges on profiles", filtering by `id` (which carries
# no such restriction) and asserting `auth_sub` itself is unreadable as its
# own, separate, more precise claim.
_OWNED_TABLES: dict[str, tuple[str, str]] = {
    "games": (
        "owner_sub",
        """
        INSERT INTO games (id, owner_sub, board_id, mode, board_type, status, payload)
        VALUES (gen_random_uuid(), $1, 'board-rls', 'apex', 'practice', 'round_active', '{}'::jsonb)
        """,
    ),
    "daily_completions": (
        "owner_sub",
        """
        INSERT INTO daily_completions
            (id, owner_sub, board_id, mode, date, game_id, lineup_peak_rating, result_snapshot)
        VALUES (gen_random_uuid(), $1, 'board-rls', 'apex', '2026-08-01', 'game-rls', 88.0, '{}'::jsonb)
        """,
    ),
    "result_snapshots": (
        "owner_sub",
        """
        INSERT INTO result_snapshots
            (id, owner_sub, game_id, board_id, board_type, mode, lineup_peak_rating, payload)
        VALUES (gen_random_uuid(), $1, 'game-rls', 'board-rls', 'practice', 'apex', 88.0, '{}'::jsonb)
        """,
    ),
    "perfect_season_runs": (
        "owner_sub",
        # is_public = false, so perfect_season_runs_public_read cannot mask a
        # broken owner policy: the only way a stranger sees this row is if
        # owner scoping itself failed.
        """
        INSERT INTO perfect_season_runs
            (id, owner_sub, display_name, mode, game_id, seed, wins, losses, lineup_score,
             score_status, exact_cards_scored, total_cards, is_public)
        VALUES (gen_random_uuid(), $1, 'RLS', 'peak_season', gen_random_uuid()::text, 1,
                60, 22, 88.0, 'complete', 8, 8, false)
        """,
    ),
    "perfect_season_saved_runs": (
        "owner_sub",
        """
        INSERT INTO perfect_season_saved_runs
            (id, owner_sub, game_id, mode, seed, wins, losses, lineup_score,
             score_status, exact_cards_scored, total_cards)
        VALUES (gen_random_uuid(), $1, gen_random_uuid()::text, 'peak_season', 1,
                60, 22, 88.0, 'complete', 8, 8)
        """,
    ),
    "daily_grid_results": (
        "owner_sub",
        """
        INSERT INTO daily_grid_results
            (id, owner_sub, board_id, board_date, board_version, score, optimal_total,
             percent_of_best, squares_matching_optimal)
        VALUES (gen_random_uuid(), $1, 'daily-grid-v2-2026-08-01', '2026-08-01',
                'daily_grid.v2', 700, 900, 77.8, 6)
        """,
    ),
    "run_the_table_runs": (
        "owner_sub",
        """
        INSERT INTO run_the_table_runs
            (run_id, owner_sub, seed, run_type, status, snapshot,
             engine_version, ruleset_version, card_pool_version)
        VALUES (gen_random_uuid()::text, $1, 1234, 'standard', 'in_progress', '{}'::jsonb,
                'e', 'r', 'c')
        """,
    ),
    "peak_duel_daily_results": (
        "owner_sub",
        """
        INSERT INTO peak_duel_daily_results
            (id, owner_sub, mode, daily_key, duration_years, duels_total, correct_count)
        VALUES (gen_random_uuid(), $1, 'peak_duel', '2026-08-01', 3, 10, 8)
        """,
    ),
}


async def _insert_owned_row(pool, table: str, owner_sub: str) -> None:
    _, insert_sql = _OWNED_TABLES[table]
    async with pool.acquire() as service_conn:
        await service_conn.execute(insert_sql, owner_sub)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", sorted(_OWNED_TABLES))
async def test_owner_can_read_their_own_row(db_pool, table: str) -> None:
    owner_column, _ = _OWNED_TABLES[table]
    owner_sub = str(uuid.uuid4())
    await _insert_owned_row(db_pool, table, owner_sub)

    conn = await _connection_as(db_pool, owner_sub)
    try:
        rows = await conn.fetch(
            f"SELECT 1 FROM {table} WHERE {owner_column} = $1", owner_sub
        )
        assert len(rows) == 1, f"{table}: the owner must be able to read their own row"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", sorted(_OWNED_TABLES))
async def test_another_user_cannot_read_someone_elses_row(db_pool, table: str) -> None:
    """The assertion that actually fails when a policy is wrong."""
    owner_column, _ = _OWNED_TABLES[table]
    owner_sub = str(uuid.uuid4())
    stranger_sub = str(uuid.uuid4())
    await _insert_owned_row(db_pool, table, owner_sub)

    conn = await _connection_as(db_pool, stranger_sub)
    try:
        rows = await conn.fetch(
            f"SELECT 1 FROM {table} WHERE {owner_column} = $1", owner_sub
        )
        assert rows == [], f"{table}: a signed-in stranger must never see another user's row"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", sorted(_OWNED_TABLES))
async def test_anonymous_cannot_read_owned_rows(db_pool, table: str) -> None:
    owner_column, _ = _OWNED_TABLES[table]
    owner_sub = str(uuid.uuid4())
    await _insert_owned_row(db_pool, table, owner_sub)

    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch(
            f"SELECT 1 FROM {table} WHERE {owner_column} = $1", owner_sub
        )
        assert rows == [], f"{table}: the anon role must not read owned rows"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["run_the_table_runs", "peak_duel_daily_results"])
async def test_guest_owned_rows_are_unreachable_through_postgrest(db_pool, table: str) -> None:
    """A guest's rows are invisible to EVERY PostgREST caller, including the
    account that later claims them.

    `auth.uid()` is NULL-or-a-UUID and can never equal an 'anon:...' cookie
    subject, so on the two anonymous-first tables these policies match nothing
    for a guest's rows. That is the intended outcome, not a gap: the API's own
    connection is the only path to them, and it scopes by owner in application
    code. Asserted so nobody later "fixes" it by widening the policy.
    """
    owner_column, _ = _OWNED_TABLES[table]
    guest_sub = f"anon:{uuid.uuid4().hex}"
    await _insert_owned_row(db_pool, table, guest_sub)

    for sub in (str(uuid.uuid4()), None):
        conn = await _connection_as(db_pool, sub)
        try:
            rows = await conn.fetch(
                f"SELECT 1 FROM {table} WHERE {owner_column} = $1", guest_sub
            )
            assert rows == [], f"{table}: a guest's row must not be reachable via PostgREST"
        finally:
            await conn.execute("RESET ROLE")
            await db_pool.release(conn)


# ---------------------------------------------------------------------------
# Column-level privileges on profiles (20260803120000_profile_column_privileges.sql).
#
# Same shape as "The spoiler columns" section below for board_snapshots and
# challenges: profiles_public_read (20260630124900_rls.sql) is a correct ROW
# filter (`is_public = true`), but combined with
# 20260630130100_default_privileges.sql's table-wide grant it exposed every
# COLUMN of a public row, including `auth_sub` -- the raw Supabase auth.uid()
# behind that profile. Reproduced for real against this database before
# writing the fix (see the migration's own header for the exact commands),
# not just reasoned about.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_profile(db_pool):
    """One public profile with a known id and handle, written as the owner."""
    owner_sub = str(uuid.uuid4())
    marker = uuid.uuid4().hex[:8]
    async with db_pool.acquire() as service_conn:
        row = await service_conn.fetchrow(
            """
            INSERT INTO profiles (id, auth_sub, handle, is_public)
            VALUES (gen_random_uuid(), $1, $2, true)
            RETURNING id
            """,
            owner_sub, f"rlsprobe{marker}",
        )
    return {"id": str(row["id"]), "owner_sub": owner_sub, "handle": f"rlsprobe{marker}"}


@pytest.mark.asyncio
async def test_profile_owner_can_still_read_their_own_safe_columns(db_pool, seeded_profile) -> None:
    """The column-level grant does not collaterally block the owner reading
    their own safe fields -- filtered by `id`, which carries no privilege
    restriction (unlike `auth_sub`; see the module comment above
    `_OWNED_TABLES`)."""
    conn = await _connection_as(db_pool, seeded_profile["owner_sub"])
    try:
        rows = await conn.fetch(
            "SELECT id, handle, display_name, is_public FROM profiles WHERE id = $1",
            uuid.UUID(seeded_profile["id"]),
        )
        assert len(rows) == 1
        assert rows[0]["handle"] == seeded_profile["handle"]
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_anonymous_can_read_a_public_profiles_safe_columns(db_pool, seeded_profile) -> None:
    """The genuinely public metadata is preserved, not collateral damage --
    same "prove the fix didn't overcorrect" pairing every column-privilege
    fix in this file gets."""
    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch(
            "SELECT id, handle, normalized_handle, display_name, bio, region, "
            "avatar_key, is_public, history_public, joined_at, updated_at "
            "FROM profiles WHERE id = $1",
            uuid.UUID(seeded_profile["id"]),
        )
        assert len(rows) == 1
        assert rows[0]["handle"] == seeded_profile["handle"]
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_anonymous_cannot_read_a_private_profiles_safe_columns(db_pool) -> None:
    """The row filter still applies on top of the column grant -- a
    non-public profile's safe columns are still invisible to anon."""
    owner_sub = str(uuid.uuid4())
    async with db_pool.acquire() as service_conn:
        row = await service_conn.fetchrow(
            "INSERT INTO profiles (id, auth_sub, handle, is_public) "
            "VALUES (gen_random_uuid(), $1, $2, false) RETURNING id",
            owner_sub, f"rlsprivate{uuid.uuid4().hex[:8]}",
        )

    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch(
            "SELECT id, handle FROM profiles WHERE id = $1", row["id"]
        )
        assert rows == [], "a private profile's safe columns must still be invisible to anon"
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query",
    [
        "SELECT auth_sub FROM profiles",
        "SELECT * FROM profiles",
    ],
)
async def test_profile_auth_sub_is_never_readable_by_a_client_key(
    db_pool, seeded_profile, query: str
) -> None:
    """The core claim of this whole section, proven against a real database:
    `auth_sub` is unreachable through a PostgREST-shaped connection no matter
    who is asking -- an anonymous caller, a signed-in stranger, and even the
    profile's OWNER (see the migration's own comment on why the owner's case
    is not a regression: their `auth_sub` IS the `sub` claim in the JWT they
    are already holding to make the request, so nothing is newly withheld
    that they did not already have). `SELECT *` is included deliberately,
    same reasoning as the board_snapshots/challenges version below: it is
    what a PostgREST client issues by default, and it must fail rather than
    quietly return the withheld column.
    """
    for sub in (None, str(uuid.uuid4()), seeded_profile["owner_sub"]):
        conn = await _connection_as(db_pool, sub)
        try:
            with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
                await conn.fetch(query)
        finally:
            await conn.execute("RESET ROLE")
            await db_pool.release(conn)


# ---------------------------------------------------------------------------
# The version registries (20260801100000_rls_gaps.sql section 1).
#
# These three tables had RLS never enabled while
# 20260630130100_default_privileges.sql granted anon/authenticated
# SELECT/INSERT/UPDATE/DELETE on every table in the schema. Anyone holding the
# project's anon key could therefore flip `is_current` and change which
# ruleset the whole product believed was released.
#
# Note the shape of the regression: with RLS alone, an UPDATE that matches no
# policy affects zero rows SILENTLY -- no error. It is the REVOKE that makes
# the attempt fail loudly, which is why both layers are applied and why these
# tests assert an exception rather than a row count.
# ---------------------------------------------------------------------------

_VERSION_TABLES = ("lineup_model_versions", "ruleset_versions", "card_pool_versions")


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _VERSION_TABLES)
async def test_version_registries_are_publicly_readable(db_pool, table: str) -> None:
    """Read stays open: these version strings are already in API responses."""
    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch(f"SELECT version, is_current FROM {table}")
        assert isinstance(rows, list)  # readable (possibly empty), not denied
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _VERSION_TABLES)
@pytest.mark.parametrize("role_sub", [None, "authenticated"])
async def test_no_client_key_can_flip_is_current(db_pool, table: str, role_sub) -> None:
    sub = str(uuid.uuid4()) if role_sub else None
    async with db_pool.acquire() as service_conn:
        before = await service_conn.fetch(f"SELECT version, is_current FROM {table}")

    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            await conn.execute(f"UPDATE {table} SET is_current = false")
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            await conn.execute(
                f"INSERT INTO {table} (version, is_current) VALUES ('rls_probe', true)"
            )
        with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
            await conn.execute(f"DELETE FROM {table}")
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)

    async with db_pool.acquire() as service_conn:
        after = await service_conn.fetch(f"SELECT version, is_current FROM {table}")
    assert {(r["version"], r["is_current"]) for r in before} == {
        (r["version"], r["is_current"]) for r in after
    }, f"{table}: no client role may change which version is current"


# ---------------------------------------------------------------------------
# Column-level exposure on board_snapshots / challenges
# (20260801100000_rls_gaps.sql section 2).
#
# Both tables carry `FOR SELECT USING (true)`, which is a ROW filter -- and the
# original migration's comments ("seed is server-only", "spoiler-safe metadata
# is public") describe a COLUMN rule those policies never implemented. With the
# schema-wide SELECT grant, an anon key could read the board seed, the
# challenge token hash and the challenger's full snapshot: the answers, before
# the recipient had played. The fix is column-level privileges, so the row
# policies are unchanged and these tests are about which columns come back.
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def seeded_public_rows(db_pool):
    """One board_snapshot and one challenge, written as the table owner."""
    marker = uuid.uuid4().hex[:8]
    async with db_pool.acquire() as service_conn:
        await service_conn.execute(
            """
            INSERT INTO board_snapshots
                (id, board_id, board_type, mode, date, seed,
                 lineup_model_version, ruleset_version, card_pool_version)
            VALUES (gen_random_uuid(), $1, 'practice', 'apex', NULL, 424242, $2, $2, $2)
            """,
            f"board-{marker}", f"v-{marker}",
        )
        await service_conn.execute(
            """
            INSERT INTO challenges
                (id, token_hash, challenger_game_id, board_id, mode, board_type,
                 duration_years, seed, expires_at, challenger_snapshot)
            VALUES (gen_random_uuid(), $1, 'game-x', $2, 'apex', 'challenge', 3, 424242,
                    NOW() + interval '7 days', '{"picks": ["secret"]}'::jsonb)
            """,
            f"hash-{marker}", f"board-{marker}",
        )
    return marker


@pytest.mark.asyncio
async def test_anonymous_can_still_read_public_board_metadata(db_pool, seeded_public_rows) -> None:
    """The genuinely public metadata is preserved, not collateral damage."""
    conn = await _connection_as(db_pool, sub=None, role="anon")
    try:
        rows = await conn.fetch(
            """
            SELECT board_id, board_type, mode, date, lineup_model_version,
                   ruleset_version, card_pool_version, generated_at
              FROM board_snapshots WHERE board_id = $1
            """,
            f"board-{seeded_public_rows}",
        )
        assert len(rows) == 1
        challenge_rows = await conn.fetch(
            """
            SELECT board_id, mode, board_type, duration_years, date, created_at,
                   expires_at, settled_at
              FROM challenges WHERE board_id = $1
            """,
            f"board-{seeded_public_rows}",
        )
        assert len(challenge_rows) == 1
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "query",
    [
        "SELECT seed FROM board_snapshots",
        "SELECT metadata FROM board_snapshots",
        "SELECT * FROM board_snapshots",
        "SELECT seed FROM challenges",
        "SELECT token_hash FROM challenges",
        "SELECT challenger_snapshot FROM challenges",
        "SELECT anon_subject_id FROM challenges",
        "SELECT settlement FROM challenges",
        "SELECT challenger_game_id FROM challenges",
        "SELECT * FROM challenges",
    ],
)
async def test_spoiler_columns_are_not_readable_by_a_client_key(
    db_pool, seeded_public_rows, query: str
) -> None:
    """Seeds, token hashes and the challenger's answers stay server-side.

    `SELECT *` is included deliberately: it is what a PostgREST client issues
    by default, and it must fail rather than quietly return the withheld
    columns.
    """
    for sub in (None, str(uuid.uuid4())):
        conn = await _connection_as(db_pool, sub)
        try:
            with pytest.raises(asyncpg.exceptions.InsufficientPrivilegeError):
                await conn.fetch(query)
        finally:
            await conn.execute("RESET ROLE")
            await db_pool.release(conn)


# ---------------------------------------------------------------------------
# Client write privileges on the newest owner-scoped tables
#
# 20260630130100_default_privileges.sql runs ALTER DEFAULT PRIVILEGES granting
# SELECT/INSERT/UPDATE/DELETE on TABLES to anon and authenticated, which
# attaches to every table created AFTERWARDS. So a new table is writable
# through PostgREST the moment it exists unless the migration revokes it, and
# an owner-scoped INSERT policy does not save you: WITH CHECK pins the OWNER,
# not the PAYLOAD, so a client could still write its own arena_points.
#
# These tests exercise the privilege check against a real database rather than
# reading the SQL, because a REVOKE that was never applied looks identical to
# one that was until somebody tries to write.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_client_cannot_forge_a_peak_duel_daily_result(db_pool):
    """The API scores this table; a client must not be able to write to it."""
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(
                """
                INSERT INTO peak_duel_daily_results
                    (id, owner_sub, mode, daily_key, duration_years,
                     duels_total, correct_count, arena_points)
                VALUES (gen_random_uuid(), $1, 'peak_duel', '2026-08-01', 3, 10, 10, 999999)
                """,
                sub,
            )
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_a_client_cannot_delete_its_own_daily_result(db_pool):
    """Deletion would defeat the immutability the schema argues for.

    There is deliberately no UPDATE policy "because the record must be
    immutable" — but DELETE-then-INSERT is an UPDATE once the UNIQUE
    constraint is cleared, so the DELETE privilege has to go too.
    """
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(
                "DELETE FROM peak_duel_daily_results WHERE owner_sub = $1", sub
            )
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_an_owner_can_still_read_their_own_daily_results(db_pool):
    """SELECT stays granted: the owner policy already narrows it to own rows,
    and a signed-in player reading their own history directly is legitimate."""
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        rows = await conn.fetch(
            "SELECT id FROM peak_duel_daily_results WHERE owner_sub = $1", sub
        )
        assert rows == []
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


# ---------------------------------------------------------------------------
# Payload forgery: the four owner-scoped result tables that were still writable.
#
# This is the same finding the peak_duel_daily_results tests above cover, and
# the same fix (20260801140000_owned_results_revoke.sql). It was worth writing
# separately because the whole suite above this line is SELECT-only: before
# these cases, no test anywhere asserted that a stranger — or an owner — could
# not WRITE through PostgREST at all. An owner-scoped `WITH CHECK` pins
# *ownership*, not the *payload*, so RLS alone let a client INSERT its own
# `score`, its own `snapshot`, or its own 82-0 leaderboard row.
#
# `run_the_table_runs` is the sharpest of the four: it granted UPDATE on
# `snapshot`, which is the entire engine state blob, so server-authoritative
# play was fully bypassable.
# ---------------------------------------------------------------------------

_REVOKED_WRITE_TABLES = [
    "daily_grid_results",
    "run_the_table_runs",
    "perfect_season_runs",
    "perfect_season_saved_runs",
    "perfect_season_run_cards",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _REVOKED_WRITE_TABLES)
@pytest.mark.parametrize("role_sub", [None, "authenticated"])
async def test_clients_cannot_insert_into_owned_result_tables(db_pool, table, role_sub):
    """Neither anon nor a signed-in user may INSERT — the privilege is revoked.

    Asserted as InsufficientPrivilegeError specifically, not "affects zero
    rows": a REVOKE fails loudly at the privilege check, whereas a write that
    merely matches no policy silently affects nothing and reads to a client as
    success. That difference is the reason the fix is a REVOKE and not another
    policy.
    """
    sub = str(uuid.uuid4()) if role_sub else None
    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(f"INSERT INTO {table} DEFAULT VALUES")
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _REVOKED_WRITE_TABLES)
async def test_clients_cannot_delete_from_owned_result_tables(db_pool, table):
    """DELETE is revoked too — DELETE-then-INSERT is an UPDATE in disguise once
    a UNIQUE constraint is cleared, which is exactly how the immutability these
    tables claim would otherwise be defeated."""
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(f"DELETE FROM {table}")
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
async def test_run_the_table_snapshot_cannot_be_updated_by_a_client(db_pool):
    """The single most valuable write to deny: `snapshot` is the run's whole
    engine state, so a client UPDATE is a forged, table-cleared run."""
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute(
                "UPDATE run_the_table_runs SET snapshot = '{}'::jsonb"
            )
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)


@pytest.mark.asyncio
@pytest.mark.parametrize("table", _REVOKED_WRITE_TABLES)
async def test_select_is_still_granted_on_owned_result_tables(db_pool, table):
    """SELECT must survive the REVOKE: the owner-read policies already narrow
    it to the caller's own rows, and reading one's own history directly is a
    legitimate client path. A blanket REVOKE ALL would have been the easy
    over-correction."""
    sub = str(uuid.uuid4())
    conn = await _connection_as(db_pool, sub)
    try:
        rows = await conn.fetch(f"SELECT 1 FROM {table} LIMIT 1")
        assert rows == [] or len(rows) == 1
    finally:
        await conn.execute("RESET ROLE")
        await db_pool.release(conn)
