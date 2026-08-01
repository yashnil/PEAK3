-- Revoke direct client write privileges on the four remaining owner-scoped
-- result tables.
--
-- WHY THIS EXISTS. `20260801130000_peak_duel_results_revoke.sql` fixed exactly
-- this bug for `peak_duel_daily_results` and stated the reasoning in full: an
-- owner-scoped RLS policy pins *ownership*, not the *payload*. The fix was
-- correct and was never extended to its four siblings, all of which were
-- created after `20260630130100_default_privileges.sql:31-32` ran
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
--
-- and all of which therefore reachable through PostgREST with nothing but the
-- public anon key that ships in the browser bundle
-- (`apps/web/src/lib/supabase/config.ts:22`).
--
-- WHAT EACH ONE EXPOSED:
--
--   daily_grid_results        (20260730190000:88) -- INSERT its own `score`,
--     `optimal_total`, `percent_of_best`, `squares_matching_optimal` and
--     `elapsed_seconds`, bypassing `_revalidate_completed_board` and
--     `build_result` in app/api/v1/daily_grid.py entirely. The server
--     recomputes every square precisely so these numbers cannot be asserted by
--     a client; a direct INSERT walks around that whole trust boundary.
--
--   run_the_table_runs        (20260731090000:105,109) -- the worst of the
--     four, because it grants INSERT *and* UPDATE on `snapshot`, which is the
--     entire engine state blob. Server-authoritative play is fully bypassable:
--     a client could write itself a completed, table-cleared run it never
--     played. The engine's version gate (state.py:129-138) does not help,
--     since a forged snapshot can carry whatever `versions` dict it likes.
--
--   perfect_season_runs       (20260724150000:84) -- INSERT an arbitrary row
--     onto a PUBLIC leaderboard (`is_public` DEFAULT TRUE): `wins = 82`,
--     `losses = 0`, any `lineup_score`.
--
--   perfect_season_saved_runs (20260729180000:97) -- INSERT an arbitrary
--     personal best.
--
-- SELECT is deliberately left granted on all four. The existing owner-read
-- policies already narrow it to the caller's own rows, and reading one's own
-- history directly is a legitimate future client path. This migration removes
-- only the ability to WRITE.
--
-- Two layers on purpose, exactly as the telemetry migration argues
-- (20260801120000_telemetry_events.sql): the RLS policy AND the REVOKE. A
-- REVOKE fails loudly at the privilege check, while a write that matches no
-- policy silently affects zero rows and reads to a client as success.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (see 20260801100000_rls_gaps.sql).
--
-- Guarded by pg_tables because `20260730190000_daily_grid_results.sql` has not
-- been applied to every environment (its own header, lines 4-7), and a missing
-- table must not fail the chain.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'daily_grid_results',
        'run_the_table_runs',
        'perfect_season_runs',
        'perfect_season_saved_runs'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format(
                'REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated',
                t
            );
        END IF;
    END LOOP;
END
$$;

-- `perfect_season_run_cards` hangs off `perfect_season_runs` by foreign key and
-- its policies route through the parent (20260724150000:89,98,107). Revoking
-- writes on the parent closes the row it would attach to, but the child is
-- revoked too so a client cannot append cards to a row created by the API.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'perfect_season_run_cards'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE ON public.perfect_season_run_cards
            FROM anon, authenticated;
    END IF;
END
$$;

-- Down (never executed; recorded for review):
--   GRANT INSERT, UPDATE, DELETE ON public.daily_grid_results,
--     public.run_the_table_runs, public.perfect_season_runs,
--     public.perfect_season_saved_runs, public.perfect_season_run_cards
--     TO anon, authenticated;
