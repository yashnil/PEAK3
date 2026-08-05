"""Arena RLS and privilege tests against a real Supabase/Postgres.

WHY THESE EXIST AS TESTS RATHER THAN AS A CLAIM IN THE MIGRATION HEADER.
`20260630130100_default_privileges.sql:31-32` runs

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

so every table this project creates is granted full CRUD to the public anon key
at the moment it is created. Each new migration is expected to revoke that, and
the only way to know a given migration actually did is to try the write as
`anon` and watch it fail. A migration whose REVOKE block had a typo would apply
cleanly, look correct in review, and leave a table world-writable.

WHAT IS BEING PROTECTED. `arena_matches.snapshot` is live game state,
`arena_match_events` carries sealed bids, and `arena_match_results` is the
settled outcome. With an INSERT/UPDATE grant a PostgREST client holding the anon
key -- which ships in the browser bundle -- could write its own result row with
placement 1, and no policy in the migration would stop it, because none of them
is an INSERT/UPDATE policy at all. The REVOKE is the layer that stops a forged
win; the policies narrow reads.

SCOPE, STATED HONESTLY. These bind the anon/authenticated PostgREST caller.
They say nothing about the API's own traffic, which connects as the
table-owning role and is exempt from both the grants and the policies
(`20260801100000_rls_gaps.sql:3-18`). Seat scoping for API traffic is
application code and is covered by `tests/test_arena_routes.py`.
"""
from __future__ import annotations

import uuid

import pytest

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore[assignment]

# See test_migrations.py: a conftest's pytestmark does not propagate to sibling
# modules, so each module declares it directly or `-m supabase_integration`
# would not select it.
pytestmark = pytest.mark.supabase_integration

ARENA_TABLES = (
    "arena_matches",
    "arena_match_seats",
    "arena_match_commands",
    "arena_match_events",
    "arena_turns",
    "arena_match_results",
    "arena_public_queue",
)


@pytest.mark.asyncio
async def test_rls_is_enabled_on_every_arena_table(test_database_url: str) -> None:
    conn = await asyncpg.connect(test_database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT tablename, rowsecurity FROM pg_tables
             WHERE schemaname = 'public' AND tablename = ANY($1::text[])
            """,
            list(ARENA_TABLES),
        )
        found = {r["tablename"]: r["rowsecurity"] for r in rows}
        assert set(found) == set(ARENA_TABLES), f"missing tables: {set(ARENA_TABLES) - set(found)}"
        for table, enabled in found.items():
            assert enabled, f"{table} has RLS disabled"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_anon_and_authenticated_hold_no_write_privilege(
    test_database_url: str,
) -> None:
    """All five write verbs, not three.

    TRUNCATE is a write RLS does not filter -- it is table-level, so no policy is
    consulted -- meaning a role holding it could erase every match regardless of
    every policy. TRIGGER allows attaching a function to a table one cannot
    otherwise write. Both were found still granted on four earlier tables after a
    migration revoked only the CRUD three
    (`20260801160000_head_to_head.sql:258-269`), which is why they are asserted
    here rather than assumed absent.
    """
    conn = await asyncpg.connect(test_database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT table_name, grantee, privilege_type
              FROM information_schema.role_table_grants
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])
               AND grantee IN ('anon', 'authenticated')
               AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')
            """,
            list(ARENA_TABLES),
        )
        assert rows == [], (
            "these grants must not exist: "
            + ", ".join(f"{r['grantee']}:{r['privilege_type']} on {r['table_name']}" for r in rows)
        )
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_the_command_ledger_is_unreadable_by_clients(
    test_database_url: str,
) -> None:
    """It carries every payload every seat ever submitted, including rejected
    sealed bids. No product surface needs a client to read it."""
    conn = await asyncpg.connect(test_database_url)
    try:
        rows = await conn.fetch(
            """
            SELECT grantee FROM information_schema.role_table_grants
             WHERE table_schema='public' AND table_name='arena_match_commands'
               AND grantee IN ('anon','authenticated') AND privilege_type='SELECT'
            """
        )
        assert rows == [], "arena_match_commands must not be client-readable"
    finally:
        await conn.close()


@pytest.mark.asyncio
async def test_anon_cannot_write_or_read_a_live_match(test_database_url: str) -> None:
    """The end-to-end version: seed a match as the owner, then act as `anon`.

    Every write must raise on the privilege check, and every read must return
    zero rows because `auth.uid()` is NULL for an unauthenticated caller.
    """
    conn = await asyncpg.connect(test_database_url)
    match_id = str(uuid.uuid4())
    try:
        tx = conn.transaction()
        await tx.start()
        try:
            await conn.execute(
                """
                INSERT INTO arena_matches (match_id, mode, mode_version, model_version,
                    seat_count, entry_path, rated, seed, created_by, expires_at, snapshot)
                VALUES ($1,'probe_mode','v1','peak3_v1',2,'public_queue',true,99,'victim',
                        NOW() + interval '1 hour', '{"secret":"TOPSECRET"}'::jsonb)
                """,
                match_id,
            )
            await conn.execute(
                """
                INSERT INTO arena_match_seats (match_id, seat_index, occupant_kind, occupant_sub)
                VALUES ($1, 0, 'human', 'victim')
                """,
                match_id,
            )
            await conn.execute(
                """
                INSERT INTO arena_match_events (match_id, seq, event_type,
                    state_version_after, visibility, visible_to_seat, payload)
                VALUES ($1, 0, 'sealed_bid', 1, 'seat', 0, '{"bid":"HIDDEN"}'::jsonb)
                """,
                match_id,
            )

            await conn.execute("SET LOCAL ROLE anon")

            forbidden_writes = [
                ("forge snapshot", f"UPDATE arena_matches SET snapshot='{{}}'::jsonb WHERE match_id='{match_id}'"),
                ("forge version", f"UPDATE arena_matches SET state_version=999 WHERE match_id='{match_id}'"),
                ("forge a win", (
                    "INSERT INTO arena_match_results (match_id, seat_index, placement, "
                    f"score, outcome, rated, was_bot) VALUES ('{match_id}',0,1,999,'win',true,false)"
                )),
                ("seat itself", (
                    "INSERT INTO arena_match_seats (match_id, seat_index, occupant_kind, "
                    f"occupant_sub) VALUES ('{match_id}',1,'human','attacker')"
                )),
                ("delete the match", f"DELETE FROM arena_matches WHERE match_id='{match_id}'"),
                ("truncate matches", "TRUNCATE arena_matches CASCADE"),
                ("truncate results", "TRUNCATE arena_match_results"),
                ("read the ledger", "SELECT count(*) FROM arena_match_commands"),
            ]
            for label, stmt in forbidden_writes:
                sp = conn.transaction()
                await sp.start()
                with pytest.raises(asyncpg.PostgresError, match="permission denied"):
                    await conn.execute(stmt)
                await sp.rollback()

            # Reads: policies narrow to zero rows for an unauthenticated caller.
            for table in ("arena_matches", "arena_match_seats", "arena_match_events",
                          "arena_public_queue", "arena_turns", "arena_match_results"):
                count = await conn.fetchval(f"SELECT count(*) FROM {table}")
                assert count == 0, f"anon could read {count} rows from {table}"
        finally:
            await tx.rollback()
    finally:
        await conn.close()
