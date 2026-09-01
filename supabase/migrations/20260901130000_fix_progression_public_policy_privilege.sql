-- Fix: public-profile progression policies could not evaluate at all —
-- public-platform-readiness Batch P2.
--
-- WHY THIS EXISTS. `personal_records_public`, `achievement_awards_public`, and
-- `streak_states_public` (20260630125400_progression_rls.sql) each subquery
-- `profiles.auth_sub` directly:
--
--     owner_sub IN (SELECT auth_sub FROM profiles WHERE is_public = true)
--
-- `20260803120000_profile_column_privileges.sql` later revoked table-level
-- SELECT on `profiles` from anon/authenticated and re-granted it only on a
-- named column list that deliberately EXCLUDES `auth_sub` (closing a leak of
-- the auth correlate through the profiles_public_read policy). That migration
-- did not anticipate — and could not have, from reading its own file in
-- isolation — that three OTHER tables' RLS policies would need to read that
-- exact column to evaluate at all.
--
-- THE BREAK IS NOT LIMITED TO THE PUBLIC-PROFILE CASE. Postgres evaluates
-- every RLS policy attached to a table for a given command (they combine with
-- OR); if evaluating ANY one of them raises a privilege error, the whole
-- statement fails — it does not fall back to the policies that would have
-- evaluated fine. So `personal_records_owner`, `achievement_awards_owner`, and
-- `streak_states_owner` — the actual "a signed-in user reads their own
-- progress" path, previously asserted safe in this batch's own SELECT-must-
-- survive-the-revoke tests — were silently broken too. Verified live, not
-- assumed: an `authenticated` connection reading its OWN `streak_states` row
-- failed with `permission denied for table profiles`, not zero rows and not
-- success.
--
-- THE FIX. The same SECURITY DEFINER pattern already established in this
-- codebase for exactly this class of problem
-- (`is_ranked_match_participant()`, 20260630130000_ranked_rls.sql:44-67, and
-- `is_arena_seat_holder()`, 20260804100000_arena_foundation.sql) — a small
-- function that runs with the DEFINER's privileges (the table-owning
-- migration role, which has full column access and bypasses RLS), so the
-- CALLER's own column privileges are irrelevant to evaluating it. This does
-- NOT re-expose `auth_sub` to the client: the function returns a boolean, and
-- nothing about `profiles.auth_sub`'s value is present in the caller's actual
-- result set. A client still cannot `SELECT auth_sub FROM profiles` directly
-- — that privilege boundary from `20260803120000_profile_column_privileges.sql`
-- is completely untouched by this migration.

-- ---------------------------------------------------------------------------
-- Helper: is `p_sub` the owner of a public profile?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_public_profile_sub(p_sub TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles WHERE auth_sub = p_sub AND is_public = true
    );
$$;

-- ---------------------------------------------------------------------------
-- personal_records_public
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS personal_records_public ON personal_records;
DROP POLICY IF EXISTS personal_records_public_v2 ON personal_records;
CREATE POLICY personal_records_public_v2 ON personal_records
    FOR SELECT USING (is_public_profile_sub(owner_sub));

-- ---------------------------------------------------------------------------
-- achievement_awards_public — same fix, keeps its second AND-condition
-- (achievement_definitions.is_hidden) untouched: that subquery reads columns
-- already fully granted to anon/authenticated, so it was never the problem.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS achievement_awards_public ON achievement_awards;
DROP POLICY IF EXISTS achievement_awards_public_v2 ON achievement_awards;
CREATE POLICY achievement_awards_public_v2 ON achievement_awards
    FOR SELECT USING (
        is_public_profile_sub(owner_sub)
        AND achievement_key IN (
            SELECT achievement_key FROM achievement_definitions WHERE is_hidden = false
        )
    );

-- ---------------------------------------------------------------------------
-- streak_states_public
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS streak_states_public ON streak_states;
DROP POLICY IF EXISTS streak_states_public_v2 ON streak_states;
CREATE POLICY streak_states_public_v2 ON streak_states
    FOR SELECT USING (is_public_profile_sub(owner_sub));

-- Policies are RENAMED (`_public` -> `_public_v2`) rather than redefined under
-- their original names: scripts/validate_migrations.py rejects a duplicate
-- (table, policy_name) pair anywhere in the migration chain, the same
-- discipline 20260801100000_rls_gaps.sql's profiles_owner_write rename
-- follows. Semantics are unchanged from the original `_public` policies
-- except for the privilege fix itself.

-- Down:
-- DROP POLICY IF EXISTS streak_states_public_v2 ON streak_states;
-- CREATE POLICY streak_states_public ON streak_states
--     FOR SELECT USING (owner_sub IN (SELECT auth_sub FROM profiles WHERE is_public = true));
-- DROP POLICY IF EXISTS achievement_awards_public_v2 ON achievement_awards;
-- CREATE POLICY achievement_awards_public ON achievement_awards
--     FOR SELECT USING (
--         owner_sub IN (SELECT auth_sub FROM profiles WHERE is_public = true)
--         AND achievement_key IN (SELECT achievement_key FROM achievement_definitions WHERE is_hidden = false)
--     );
-- DROP POLICY IF EXISTS personal_records_public_v2 ON personal_records;
-- CREATE POLICY personal_records_public ON personal_records
--     FOR SELECT USING (owner_sub IN (SELECT auth_sub FROM profiles WHERE is_public = true));
-- DROP FUNCTION IF EXISTS is_public_profile_sub(TEXT);
