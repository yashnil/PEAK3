-- Migration 017: Base table privileges for anon/authenticated roles
--
-- Discovered via Phase 4.0A's real local-Supabase RLS integration run
-- (previously this suite was "written but never executed" — see
-- docs/implementation/PHASE_4_0_REPORT.md): every table created by our
-- migrations is owned by the `postgres` role, whose own default ACL for
-- schema `public` on this stack does NOT include SELECT/INSERT/UPDATE/DELETE
-- for `anon`/`authenticated` (only TRUNCATE/REFERENCES/TRIGGER). RLS policies
-- only ever RESTRICT which rows a role can see/touch — Postgres separately
-- requires the base object privilege before a role may attempt the query at
-- all. Without this grant, every RLS-protected table returns
-- "permission denied" for anon/authenticated regardless of how permissive
-- its policies are. Real hosted Supabase projects grant this automatically
-- at project provisioning time; local/self-hosted stacks and migrations
-- created by a role other than the provisioning role do not inherit it, so
-- it must be explicit here rather than assumed.
--
-- This does NOT bypass RLS: every table below still has
-- ENABLE ROW LEVEL SECURITY, and tables with `FOR ALL USING (false)` deny
-- policies (ranked_opponent_history, rating_periods, ranked_integrity_events,
-- ranked_abort_allowances) remain fully inaccessible to anon/authenticated
-- regardless of this grant — RLS is evaluated after the privilege check and
-- is unaffected by it.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Ensure every future migration's CREATE TABLE also gets this automatically,
-- so this class of bug cannot recur as new tables are added.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

-- Down:
-- ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon, authenticated;
-- REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
