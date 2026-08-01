-- Peak Duel Daily results: revoke direct client write privileges.
--
-- WHY THIS IS A SEPARATE MIGRATION. `20260801110000_guest_claim_and_daily.sql`
-- created `peak_duel_daily_results` with the right RLS policies but no
-- REVOKE, and it has already been applied to both the local stack and the
-- hosted development project. An applied migration must not be edited in
-- place -- the chain is recorded by version, so a later push would skip the
-- corrected file and leave the two databases silently different. This is the
-- forward fix.
--
-- WHAT WAS WRONG. `20260630130100_default_privileges.sql:31-32` runs
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
--
-- which attaches to every table created *afterwards*. So the moment
-- `peak_duel_daily_results` existed, any holder of the public anon key could
-- reach it through PostgREST. The RLS policies pinned OWNERSHIP
-- (`WITH CHECK (owner_sub = auth.uid()::text)`) but not the PAYLOAD, so a
-- signed-in client could:
--
--   * INSERT a row for itself with any `arena_points`, `best_streak`,
--     `correct_count`, `daily_key` or `played_on_daily_key` it liked --
--     bypassing the server-side scoring in app/api/v1/game.py entirely; and
--   * DELETE its own row, which defeats the immutability the creating
--     migration argues for at its lines 104-110. There is deliberately no
--     UPDATE policy "because the record must be immutable" -- but
--     DELETE-then-INSERT is an UPDATE once the UNIQUE constraint is cleared.
--
-- The sibling telemetry migration (`20260801120000_telemetry_events.sql`)
-- already does this correctly: deny-all policy PLUS an explicit REVOKE. Two
-- layers, because a REVOKE fails loudly at the privilege check while an
-- UPDATE that matches no policy silently affects zero rows.
--
-- SELECT is intentionally left granted: `peak_duel_daily_results_owner_read`
-- already narrows it to the owner's own rows, and a signed-in player reading
-- their own daily history directly is a legitimate future client path.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (see the architecture note in
-- 20260801100000_rls_gaps.sql).

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'peak_duel_daily_results'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE ON public.peak_duel_daily_results
            FROM anon, authenticated;
    END IF;
END
$$;

-- Down (never executed; recorded for review):
--   GRANT INSERT, UPDATE, DELETE ON public.peak_duel_daily_results
--     TO anon, authenticated;
