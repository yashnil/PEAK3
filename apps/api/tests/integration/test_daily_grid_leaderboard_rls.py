"""Daily Grid leaderboard RLS and privilege tests against a real Postgres.

The table under test is `daily_grid_leaderboard_entries`
(20260811090000_daily_grid_leaderboard.sql) — the PUBLIC ranked counterpart of
the private `daily_grid_results`. Its whole security story is two claims, and
each is only a fact if a real client role is watched hitting the wall:

  1. ANYONE MAY READ. A leaderboard is public; the row carries a subject, a
     day and two numbers — no email, no answer material. The public-read
     policy must actually return rows to `anon`, because a policy typo would
     ship an empty leaderboard that looks like nobody has played.

  2. NO CLIENT MAY WRITE. Every number in a row is server-derived (the score
     from the revalidated official result, the time from two server stamps).
     A client that could INSERT or UPDATE could choose its own score and
     time, which is precisely what the server-authoritative pipeline exists
     to prevent. `20260630130100_default_privileges.sql` grants full CRUD on
     every new table to anon+authenticated at creation, so the migration's
     REVOKE block is the layer under test — a typo there would apply cleanly
     and leave the board world-writable.

SCOPE, STATED HONESTLY (same caveat as test_arena_rls.py): these bind the
anon/authenticated PostgREST caller. The API's own connection is the table
owner and is exempt; its write path is covered by
tests/test_daily_grid_leaderboard.py and the repository conformance suite.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

# See test_migrations.py: a conftest's pytestmark does not propagate to sibling
# modules, so each module declares it directly.
pytestmark = pytest.mark.supabase_integration

TABLE = "daily_grid_leaderboard_entries"


async def _seed_entry(conn, owner_sub: str, daily_key: str, score: int = 800) -> str:
    entry_id = str(uuid.uuid4())
    await conn.execute(
        f"""
        INSERT INTO {TABLE} (id, owner_sub, daily_key, board_id, board_version,
                             score, completion_time_ms, result_id, completed_at)
        VALUES ($1, $2, $3, $4, '1.0.0', $5, 42800, $6, $7)
        """,
        entry_id, owner_sub, daily_key, f"grid-{daily_key}", score,
        str(uuid.uuid4()), datetime.now(timezone.utc),
    )
    return entry_id


@pytest.mark.asyncio
async def test_rls_is_enabled_on_the_leaderboard_table(test_database_url: str) -> None:
    conn = await asyncpg.connect(test_database_url)
    try:
        enabled = await conn.fetchval(
            "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1",
            TABLE,
        )
        assert enabled is True, f"{TABLE} missing or RLS disabled"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_client_roles_hold_no_write_privilege(test_database_url: str) -> None:
    """The REVOKE actually took: neither client role holds any write verb."""
    conn = await asyncpg.connect(test_database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT grantee, privilege_type
              FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = $1
               AND grantee IN ('anon', 'authenticated')
               AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')
            """,
            TABLE,
        )
        assert rows == [], (
            "these grants must not exist: "
            + ", ".join(f"{r['grantee']}:{r['privilege_type']}" for r in rows)
        )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_anon_reads_the_board_but_cannot_touch_it(test_database_url: str) -> None:
    """End to end as the browser's own role: seed a row as the owner, then
    read it as `anon` (must succeed — a leaderboard is public) and try every
    forgery (must all die on the privilege check)."""
    conn = await asyncpg.connect(test_database_url)
    daily_key = f"2099-rls-{uuid.uuid4().hex[:8]}"
    victim = f"victim-{uuid.uuid4()}"
    try:
        tx = conn.transaction()
        await tx.start()
        try:
            entry_id = await _seed_entry(conn, victim, daily_key, score=800)

            await conn.execute("SET LOCAL ROLE anon")

            # 1. PUBLIC READ WORKS — the policy is USING (TRUE), not a stub.
            row = await conn.fetchrow(
                f"SELECT owner_sub, score, completion_time_ms FROM {TABLE} WHERE daily_key=$1",
                daily_key,
            )
            assert row is not None and row["score"] == 800

            # 2. NO WRITE OF ANY KIND.
            forbidden = [
                ("forge an entry", (
                    f"INSERT INTO {TABLE} (id, owner_sub, daily_key, board_id, board_version, "
                    f"score, completion_time_ms, result_id, completed_at) VALUES "
                    f"('{uuid.uuid4()}', 'attacker', '{daily_key}', 'grid-x', '1.0.0', "
                    f"99999, 1, 'fake', NOW())"
                )),
                ("inflate the victim's score", f"UPDATE {TABLE} SET score=99999 WHERE id='{entry_id}'"),
                ("fake a faster clock", f"UPDATE {TABLE} SET completion_time_ms=1 WHERE id='{entry_id}'"),
                ("steal the row", f"UPDATE {TABLE} SET owner_sub='attacker' WHERE id='{entry_id}'"),
                ("erase a rival", f"DELETE FROM {TABLE} WHERE id='{entry_id}'"),
                ("wipe the board", f"TRUNCATE {TABLE}"),
            ]
            for label, stmt in forbidden:
                sp = conn.transaction()
                await sp.start()
                with pytest.raises(asyncpg.PostgresError, match="permission denied"):
                    await conn.execute(stmt)
                await sp.rollback()
        finally:
            await tx.rollback()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_authenticated_cannot_forge_even_its_own_entry(test_database_url: str) -> None:
    """A signed-in Supabase client is no more trusted than `anon` here: the
    only write path is the API's own connection, so `authenticated` must be
    unable to insert an entry for itself OR overwrite another user's."""
    conn = await asyncpg.connect(test_database_url)
    daily_key = f"2099-rls-{uuid.uuid4().hex[:8]}"
    victim = f"victim-{uuid.uuid4()}"
    try:
        tx = conn.transaction()
        await tx.start()
        try:
            entry_id = await _seed_entry(conn, victim, daily_key, score=900)

            await conn.execute("SET LOCAL ROLE authenticated")

            # Reads work — same public board the anon key sees.
            count = await conn.fetchval(
                f"SELECT count(*) FROM {TABLE} WHERE daily_key=$1", daily_key
            )
            assert count == 1

            forbidden = [
                ("enter itself directly", (
                    f"INSERT INTO {TABLE} (id, owner_sub, daily_key, board_id, board_version, "
                    f"score, completion_time_ms, result_id, completed_at) VALUES "
                    f"('{uuid.uuid4()}', 'self-service', '{daily_key}', 'grid-x', '1.0.0', "
                    f"1000, 1000, 'forged', NOW())"
                )),
                ("overwrite another user's entry", f"UPDATE {TABLE} SET score=1 WHERE id='{entry_id}'"),
                ("delete another user's entry", f"DELETE FROM {TABLE} WHERE id='{entry_id}'"),
            ]
            for label, stmt in forbidden:
                sp = conn.transaction()
                await sp.start()
                with pytest.raises(asyncpg.PostgresError, match="permission denied"):
                    await conn.execute(stmt)
                await sp.rollback()
        finally:
            await tx.rollback()
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_the_owner_write_path_and_the_unique_key_hold(test_database_url: str) -> None:
    """The server path works where the client paths fail: the table-owning
    connection inserts, and the UNIQUE (owner_sub, daily_key, board_version)
    constraint — the anchor of the atomic best-attempt upsert — rejects a
    second plain insert for the same owner and day."""
    conn = await asyncpg.connect(test_database_url)
    daily_key = f"2099-rls-{uuid.uuid4().hex[:8]}"
    owner = f"owner-{uuid.uuid4()}"
    try:
        tx = conn.transaction()
        await tx.start()
        try:
            await _seed_entry(conn, owner, daily_key, score=700)
            with pytest.raises(asyncpg.UniqueViolationError):
                await _seed_entry(conn, owner, daily_key, score=800)
        finally:
            await tx.rollback()
    finally:
        await conn.close()
