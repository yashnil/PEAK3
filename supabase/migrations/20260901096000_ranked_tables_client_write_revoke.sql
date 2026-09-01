-- Revoke direct client write privileges on every Ranked table —
-- public-platform-readiness Batch P2.
--
-- WHY THIS EXISTS. Same class of gap as
-- 20260901090000_game_records_client_write_revoke.sql and
-- 20260901093000_progression_tables_client_write_revoke.sql, found while
-- auditing Ranked persistence: none of the Ranked migrations
-- (20260630125500_ranked_config.sql .. 20260630130000_ranked_rls.sql) ever
-- revoked client write privileges, unlike `run_the_table_runs`,
-- `daily_grid_results`, `perfect_season_*`, `peak_duel_daily_results`, and
-- `head_to_head_*`, all of which got an explicit REVOKE migration. A live
-- grant check against local Postgres confirms every table below still
-- carries the full `ALTER DEFAULT PRIVILEGES` grant from
-- `20260630130100_default_privileges.sql` — SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, TRIGGER, REFERENCES, for both `anon` and `authenticated`.
--
-- VERIFIED, NOT ASSUMED SAFE TODAY. A real `authenticated`-role connection
-- (mirroring PostgREST) was confirmed BLOCKED — "new row violates row-level
-- security policy" — attempting to INSERT a forged `ranked_queue_entries` row
-- for its own `owner_sub`. Every table below has either an owner-scoped
-- SELECT-only policy (`ranked_queue_entries`, `ranked_match_participants`,
-- `ranked_match_submissions`, `ranked_match_settlements`,
-- `rating_ledger_entries`, `rating_snapshots`, `queue_ratings`,
-- `placement_states`), a public SELECT-only policy on version/config catalogs
-- (`ranked_queue_versions`, `rating_algorithm_versions`, `division_versions`),
-- `is_ranked_match_participant`-gated SELECT on `ranked_matches`, or an
-- explicit `FOR ALL USING (false)` deny-all (`ranked_opponent_history`,
-- `rating_periods`, `ranked_integrity_events`, `ranked_abort_allowances`) —
-- no table has an INSERT/UPDATE/DELETE policy anywhere in the Ranked
-- migration chain, so RLS was already the load-bearing protection.
-- `ranked_match_settlements` and `rating_ledger_entries` additionally carry a
-- database-level `BEFORE UPDATE/DELETE` trigger that raises on any attempted
-- mutation, independent of RLS or this grant. This migration is the same
-- "close the second layer to match every other owner-scoped table" hardening
-- already applied twice elsewhere in this batch — defence-in-depth, not a
-- live breach.
--
-- SELECT is deliberately preserved everywhere it was already granted,
-- matching every prior revoke migration in this family: the owner/public-scoped
-- policies already narrow it correctly.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (20260801100000_rls_gaps.sql).
--
-- Guarded by pg_tables so a missing table does not fail the chain, matching
-- every migration in this revoke family. `arena_public_queue`,
-- `arena_rating_history`, and `arena_ratings` are deliberately NOT in this
-- list — a live grant check confirmed they were already correctly hardened
-- (no TRUNCATE/TRIGGER grant present) as part of their own migrations.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'ranked_queue_versions',
        'rating_algorithm_versions',
        'division_versions',
        'ranked_queue_entries',
        'ranked_matches',
        'ranked_match_participants',
        'ranked_match_submissions',
        'ranked_opponent_history',
        'rating_periods',
        'ranked_match_settlements',
        'rating_ledger_entries',
        'rating_snapshots',
        'queue_ratings',
        'placement_states',
        'ranked_integrity_events',
        'ranked_abort_allowances'
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
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.ranked_queue_versions,
--     public.rating_algorithm_versions, public.division_versions,
--     public.ranked_queue_entries, public.ranked_matches,
--     public.ranked_match_participants, public.ranked_match_submissions,
--     public.ranked_opponent_history, public.rating_periods,
--     public.ranked_match_settlements, public.rating_ledger_entries,
--     public.rating_snapshots, public.queue_ratings, public.placement_states,
--     public.ranked_integrity_events, public.ranked_abort_allowances
--     TO anon, authenticated;
