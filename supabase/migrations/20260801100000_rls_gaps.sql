-- Migration 022: close the two real RLS gaps the auth/daily/balance audit found
--
-- READ THIS FIRST -- WHAT RLS IS AND IS NOT DOING IN THIS PROJECT.
-- The API opens ONE asyncpg pool as the table-owning role. It never issues
-- `SET ROLE`, never sets `request.jwt.claims`, and no table in this chain
-- carries FORCE ROW LEVEL SECURITY. A table owner is exempt from its own row
-- policies, so the API bypasses RLS entirely and owner scoping is 100%
-- APPLICATION CODE (every repository filters on owner_sub; every route
-- resolves the owner from a verified JWT or a signature-verified cookie,
-- never from a client-submitted value).
--
-- That is a deliberate architecture, not an oversight, and this migration
-- does NOT change it. FORCE ROW LEVEL SECURITY is deliberately NOT added:
-- it would subject the owning role to policies written against `auth.uid()`,
-- which is NULL on that connection, and every write path in the app would
-- start failing. RLS here binds exactly one class of caller -- a PostgREST
-- client holding a Supabase anon/authenticated key -- and it is the second
-- layer, never the only one.
--
-- WHAT WAS ACTUALLY BROKEN. Two holes, both created by the interaction
-- between 20260630130100_default_privileges.sql:27
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--         TO anon, authenticated;
-- and policies that are missing or that are row-level where the intent was
-- column-level. Postgres checks the base privilege first and RLS second, so a
-- table with the grant and no RLS is simply open, and a table with the grant
-- and `USING (true)` is open COLUMN-WISE even though the row filter reads
-- like a metadata-only exposure.

-- ---------------------------------------------------------------------------
-- 1. lineup_model_versions / ruleset_versions / card_pool_versions
--
-- Created by 20260630124600_versioning.sql and never given RLS at all. With
-- the schema-wide grant above, ANY holder of the project's anon key could
--     UPDATE ruleset_versions SET is_current = false;
-- and every board-generation version check downstream would start reading a
-- version the operator never released. These are public catalogs: the version
-- strings are already visible in API responses and in run snapshots, so read
-- stays open to everyone. Writes belong to migrations and to the service role
-- only.
--
-- Both layers are applied on purpose: RLS with no write policy denies the
-- write, and the REVOKE denies it one step earlier at the privilege check, so
-- a future migration that adds a permissive policy by mistake still cannot
-- open a write path on its own.
-- ---------------------------------------------------------------------------
ALTER TABLE lineup_model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruleset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_pool_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lineup_model_versions_public_read ON lineup_model_versions;
CREATE POLICY lineup_model_versions_public_read ON lineup_model_versions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS ruleset_versions_public_read ON ruleset_versions;
CREATE POLICY ruleset_versions_public_read ON ruleset_versions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS card_pool_versions_public_read ON card_pool_versions;
CREATE POLICY card_pool_versions_public_read ON card_pool_versions
    FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policy on any of the three: denied by default under
-- RLS. The REVOKE below is the independent second denial.
REVOKE INSERT, UPDATE, DELETE ON lineup_model_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ruleset_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON card_pool_versions FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. board_snapshots and challenges -- row-level policies where the intent was
--    column-level.
--
-- 20260630124900_rls.sql:42 says "board metadata is public, seed is
-- server-only" and :75 says "spoiler-safe metadata is public". Neither is true
-- as written. Both policies are
--     FOR SELECT USING (true)
-- which is a ROW filter. Combined with the table-wide SELECT grant, an anon
-- key can read every column of every row, including:
--     board_snapshots.seed        -- reproduces a practice/challenge board
--     challenges.seed             -- same, for a challenge link
--     challenges.token_hash       -- the lookup key for a challenge record
--     challenges.challenger_snapshot -- the challenger's full result, i.e. the
--                                    answers, before the recipient has played
--     challenges.anon_subject_id  -- the challenger's ownership subject
--     challenges.settlement       -- the decided comparison
--
-- The fix is column-level privileges, which is what the original comments
-- describe. The policies are left exactly as they are: every ROW of these two
-- tables really is public metadata, so `USING (true)` was the right row rule
-- and only the column exposure was wrong. Revoking the table-wide SELECT and
-- re-granting the spoiler-safe columns preserves the genuinely public
-- metadata (which board, which mode, which date, which versions, when it
-- expires) and nothing else.
--
-- Ordering note: this file sorts AFTER 20260630130100_default_privileges.sql,
-- so on a full-chain apply (and on every idempotent re-apply) the broad grant
-- lands first and these narrower privileges land last, which is the order the
-- result depends on.
--
-- The API is unaffected: it connects as the table-owning role, and an owner's
-- privileges are not derived from these grants.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON board_snapshots FROM anon, authenticated;
GRANT SELECT (id, board_id, board_type, mode, date, lineup_model_version, ruleset_version, card_pool_version, board_generation_algorithm, generated_at) ON board_snapshots TO anon, authenticated;

-- `seed` is withheld because it regenerates the board, and `metadata` because
-- it is an open JSONB blob with no schema -- anything a future writer puts in
-- it would become public retroactively, which is the opposite of a
-- spoiler-safe default.

REVOKE SELECT ON challenges FROM anon, authenticated;
GRANT SELECT (id, board_id, mode, board_type, duration_years, date, created_at, expires_at, settled_at) ON challenges TO anon, authenticated;

-- Withheld from `challenges`: token_hash (the record's lookup key),
-- challenger_game_id (points at a specific owned game), seed (regenerates the
-- board), challenger_snapshot (the challenger's answers), anon_subject_id (the
-- challenger's ownership subject) and settlement (the decided result).
-- `settled_at` is kept: "has this been settled yet" is legitimately public and
-- carries no result.

-- Down:
-- GRANT SELECT ON challenges TO anon, authenticated;
-- REVOKE SELECT (id, board_id, mode, board_type, duration_years, date, created_at, expires_at, settled_at) ON challenges FROM anon, authenticated;
-- GRANT SELECT ON board_snapshots TO anon, authenticated;
-- REVOKE SELECT (id, board_id, board_type, mode, date, lineup_model_version, ruleset_version, card_pool_version, board_generation_algorithm, generated_at) ON board_snapshots FROM anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE ON card_pool_versions TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE ON ruleset_versions TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE ON lineup_model_versions TO anon, authenticated;
-- DROP POLICY IF EXISTS card_pool_versions_public_read ON card_pool_versions;
-- DROP POLICY IF EXISTS ruleset_versions_public_read ON ruleset_versions;
-- DROP POLICY IF EXISTS lineup_model_versions_public_read ON lineup_model_versions;
-- ALTER TABLE card_pool_versions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE ruleset_versions DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE lineup_model_versions DISABLE ROW LEVEL SECURITY;
