-- Revoke TRUNCATE and TRIGGER on every owner-scoped table.
--
-- WHY THIS EXISTS. Three migrations now have revoked client write access on
-- owner-scoped tables, each naming exactly `INSERT, UPDATE, DELETE`:
--
--   20260801130000_peak_duel_results_revoke.sql   (previous pass)
--   20260801140000_owned_results_revoke.sql       (this pass)
--   20260801160000_head_to_head.sql               (this pass, on its own tables)
--
-- All three missed the same two privileges, because
-- `20260630130100_default_privileges.sql` grants on `ALL TABLES` and Postgres's
-- table privilege set is larger than the CRUD four. Every table above still
-- reports, for both `anon` and `authenticated`:
--
--     REFERENCES, SELECT, TRIGGER, TRUNCATE
--
-- TRUNCATE IS THE ONE THAT MATTERS. It is a write, and **RLS does not filter
-- it**: row-level policies constrain which rows a statement may touch, but
-- TRUNCATE is a table-level operation that removes every row regardless of any
-- policy. So a role holding TRUNCATE can erase a table whose per-row policies
-- are otherwise perfectly correct. The owner-read policies these tables rely on
-- offer no protection at all against it.
--
-- TRIGGER lets a role attach a trigger function to a table it does not own,
-- which runs on writes made by other roles. There is no legitimate client use
-- for it here.
--
-- REACHABILITY, STATED HONESTLY. PostgREST does not expose TRUNCATE, and these
-- grants are only reachable by a client that can open a direct Postgres
-- connection as `anon`/`authenticated` — which the deployed topology does not
-- hand out. **This is therefore a defence-in-depth finding, not a live
-- breach**, and it is recorded as such rather than dressed up. It is still
-- worth closing: the three migrations above all argue that the REVOKE is the
-- layer that "fails loudly" where a policy silently affects zero rows, and that
-- argument is only true for the privileges actually revoked.
--
-- Found by the head-to-head writer while verifying its own migration against a
-- real Postgres, by reading the grant table rather than trusting the previous
-- migration's stated intent.
--
-- SELECT is deliberately preserved where it was already granted: the owner-read
-- policies narrow it to the caller's own rows and a client reading its own
-- history directly is a legitimate path. `telemetry_events` never had SELECT
-- and does not gain it here. REFERENCES is harmless (it only permits foreign
-- keys against the table) and is left alone so this migration has exactly one
-- idea in it.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (see 20260801100000_rls_gaps.sql).

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        -- owner-scoped result and state tables
        'daily_grid_results',
        'daily_grid_attempts',
        'run_the_table_runs',
        'perfect_season_runs',
        'perfect_season_run_cards',
        'perfect_season_saved_runs',
        'peak_duel_daily_results',
        'telemetry_events',
        -- head-to-head already revoked these itself; listed so the set is
        -- complete and re-running this migration is a no-op rather than a gap.
        'head_to_head_matches',
        'head_to_head_participants'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format(
                'REVOKE TRUNCATE, TRIGGER ON public.%I FROM anon, authenticated',
                t
            );
        END IF;
    END LOOP;
END
$$;

-- Down (never executed; recorded for review):
--   GRANT TRUNCATE, TRIGGER ON <each table above> TO anon, authenticated;
