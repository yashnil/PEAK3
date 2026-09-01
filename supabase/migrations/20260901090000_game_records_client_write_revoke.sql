-- Revoke direct client write privileges on games, daily_completions, and
-- result_snapshots — public-platform-readiness Batch P2.
--
-- WHY THIS EXISTS. `20260801130000_peak_duel_results_revoke.sql`,
-- `20260801140000_owned_results_revoke.sql` and `20260801160000_head_to_head.sql`
-- each revoked INSERT/UPDATE/DELETE from anon/authenticated on their own set of
-- owner-scoped tables, all created after `20260630130100_default_privileges.sql`'s
-- blanket `ALTER DEFAULT PRIVILEGES ... GRANT ... TO anon, authenticated`.
-- `20260801170000_revoke_truncate_and_trigger.sql` then closed the same gap for
-- TRUNCATE/TRIGGER across every table those three migrations had touched.
--
-- `games`, `daily_completions`, and `result_snapshots` were never included in
-- any of the four. They are OLDER than the blanket-grant migration
-- (`20260630124700_game_records.sql` vs `20260630130100`), which is why they
-- were not flagged as an instance of "created after the blanket grant, needs a
-- revoke" — but a live grant check against the local Postgres stack (Batch P2)
-- shows they carry the identical over-grant anyway:
--
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND grantee IN ('anon','authenticated')
--     AND table_name IN ('games','daily_completions','result_snapshots');
--
--   -> INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, SELECT, for both
--      roles, on all three tables.
--
-- Real hosted Supabase projects grant base table privileges to anon/authenticated
-- automatically at project provisioning time (see 20260630130100's own header) —
-- that provisioning-time grant does not care when a table was created relative
-- to an in-repo migration timestamp, so the "predates the blanket grant" theory
-- that would have made these three safe by omission does not hold. Verified
-- empirically, not assumed: a real `authenticated`-role connection (a different
-- Postgres role than the row's owner) was confirmed BLOCKED from INSERT/UPDATE/
-- DELETE on all three tables by RLS alone before this migration — `games_owner`,
-- `result_snapshots_owner`, and `daily_completions_owner`
-- (20260630124900_rls.sql:49-72) are each `FOR SELECT` only, and Postgres RLS
-- denies by default for any command with no applicable policy, including for
-- the row's own owner (confirmed: an owner-authenticated connection could not
-- UPDATE its own `games` row either — 0 rows affected, value unchanged). So
-- this is the same "defence-in-depth, not a live breach" class of finding
-- `20260801170000`'s own header names, not an active vulnerability: RLS was
-- already the load-bearing protection for these three tables. This migration
-- closes the second layer to match every sibling owner-scoped table, per this
-- codebase's own stated two-layer argument (a REVOKE fails loudly at the
-- privilege check; a write that matches no RLS policy can silently affect zero
-- rows and read to a naive client as an ambiguous non-error).
--
-- SELECT is deliberately preserved, same as every prior revoke migration: the
-- owner-read policies already narrow it to the caller's own rows, and reading
-- one's own game/result/completion state directly is a legitimate client path.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (20260801100000_rls_gaps.sql) — confirmed directly in
-- this batch by a real, restarted FastAPI process reading/writing `games` state
-- (CourtBuilder resume) through the ordinary Postgres-backed repositories.
--
-- Guarded by pg_tables so a missing table (partially-applied environment) does
-- not fail the chain, matching every migration in this revoke family.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'games',
        'daily_completions',
        'result_snapshots'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format(
                'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.%I FROM anon, authenticated',
                t
            );
        END IF;
    END LOOP;
END
$$;

-- Down (never executed; recorded for review):
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.games,
--     public.daily_completions, public.result_snapshots TO anon, authenticated;
