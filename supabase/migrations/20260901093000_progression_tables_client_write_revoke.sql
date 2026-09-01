-- Revoke direct client write privileges on the nine progression/records/
-- achievements/streaks tables — public-platform-readiness Batch P2.
--
-- WHY THIS EXISTS. Same class of gap as
-- 20260901090000_game_records_client_write_revoke.sql, found independently
-- while auditing this vertical: `20260630125400_progression_rls.sql` enables
-- RLS and defines SELECT-only policies (owner-scoped, plus a deliberate public
-- projection on several of them for public-profile display) for every table
-- below, but no INSERT/UPDATE/DELETE policy exists for any of them. A live
-- grant check against local Postgres shows all nine still carry the full
-- `ALTER DEFAULT PRIVILEGES` grant from `20260630130100_default_privileges.sql`
-- (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, for both
-- `anon` and `authenticated`), and none of the four prior revoke migrations
-- touched this vertical.
--
-- VERIFIED, NOT ASSUMED SAFE TODAY. A real `authenticated`-role connection
-- (different Postgres role than the table owner, mirroring PostgREST) was
-- confirmed BLOCKED — "new row violates row-level security policy" — when
-- attempting to INSERT a forged `achievement_awards` row, a forged
-- `personal_records` row, a forged `user_progress` XP/level row, and a forged
-- `streak_states` row, each for the attacker's own `owner_sub` (the one case
-- an owner-scoped INSERT policy would have permitted, had one existed). RLS's
-- default-deny-with-no-policy behavior was already the load-bearing
-- protection here, exactly as it was for `games`/`daily_completions`/
-- `result_snapshots`. This migration is the same "close the second layer to
-- match every other owner-scoped table" hardening — defence-in-depth, not a
-- live breach, per the identical reasoning `20260801170000_revoke_truncate_
-- and_trigger.sql` already applied to a different table set.
--
-- xp_policy_versions and achievement_definitions are shared catalog/config
-- tables (not owner-scoped) — SELECT stays public, as intended, but nothing
-- but the API's service-role connection should ever be able to write to them:
-- INSERT/UPDATE/DELETE here would mean a client could edit the XP curve or
-- invent achievement definitions outright, not merely forge their own
-- progress.
--
-- SELECT is deliberately preserved on all nine, matching every prior revoke
-- migration in this family: the owner-read (and, where applicable, public)
-- policies already narrow it correctly, and reading progress directly is a
-- legitimate client path.
--
-- The API is unaffected: it connects as the table-owning role (`postgres` on
-- the local stack), which is not subject to these grants
-- (20260801100000_rls_gaps.sql).
--
-- Guarded by pg_tables so a missing table does not fail the chain, matching
-- every migration in this revoke family.

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'xp_policy_versions',
        'progression_events',
        'user_progress',
        'personal_records',
        'personal_record_events',
        'achievement_definitions',
        'achievement_awards',
        'streak_states',
        'streak_events'
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
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.xp_policy_versions,
--     public.progression_events, public.user_progress, public.personal_records,
--     public.personal_record_events, public.achievement_definitions,
--     public.achievement_awards, public.streak_states, public.streak_events
--     TO anon, authenticated;
