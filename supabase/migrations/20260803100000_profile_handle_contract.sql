-- Migration: profiles handle-contract additions (launch-polish §8)
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass, same discipline as every other file added in this phase (see
-- 20260724150000_perfect_season_leaderboard.sql's own header comment for
-- the pattern this repeats).
--
-- WHAT THIS IS NOT. `profiles` already has RLS
-- (20260630124900_rls.sql:6-9, tightened further by
-- 20260801110000_guest_claim_and_daily.sql:137-174) and already has a
-- working case-insensitive unique handle
-- (20260630124500_identity.sql:25-27, `profiles_handle_lower_idx`). This
-- migration does not introduce either of those from scratch -- an earlier
-- audit pass (docs/implementation/launch-polish/IDENTITY_AUDIT.md) said
-- otherwise and was wrong; see the correction thread in
-- docs/implementation/launch-polish/ for the full story. What follows is a
-- narrower, additive change on top of what already exists.
--
-- WHAT THIS IS. `docs/implementation/launch-polish/IMPLEMENTATION_CONTRACT.md`
-- §8 spells out the public-profile contract as seven named fields:
-- `user_id · public_handle · normalized_handle · optional display name ·
-- visibility preference · created_at · updated_at`. Six of those seven
-- already map onto existing columns (`auth_sub`, `handle`, `display_name`,
-- `is_public`/`history_public`, `joined_at`, `updated_at`). `normalized_handle`
-- is the one genuinely new field: today the lowercase-uniqueness invariant
-- lives only inside a functional index expression (`lower(handle)`), never
-- as a queryable column in its own right. This migration materializes it.
--
-- Handle values are still always stored lowercase at the application layer
-- (app/models/profile.py's validator lowercases before it ever reaches a
-- repository), so `normalized_handle` is identical to `handle` for every
-- row today -- this migration does not change that behavior. What it buys:
-- the schema now names the normalization step explicitly rather than
-- burying it in an index expression, and a later phase could stop
-- force-lowercasing `handle` (to preserve a user's chosen display casing,
-- Twitter/GitHub-style) without any further schema change, since the two
-- concepts are already split.

-- ---------------------------------------------------------------------------
-- 1. normalized_handle -- generated, always lower(handle), stored so it can
--    be indexed directly rather than through a functional expression.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS normalized_handle TEXT
    GENERATED ALWAYS AS (lower(handle)) STORED;

-- Replaces profiles_handle_lower_idx (20260630124500_identity.sql:25-27),
-- which enforced the identical invariant through a functional index on
-- lower(handle). Two indexes enforcing the same uniqueness would be pure
-- overhead on every write with no additional guarantee; the generated
-- column supersedes it cleanly since normalized_handle IS lower(handle) by
-- construction.
DROP INDEX IF EXISTS profiles_handle_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_normalized_handle_unique_idx
    ON profiles (normalized_handle)
    WHERE normalized_handle IS NOT NULL;

-- Down:
-- DROP INDEX IF EXISTS profiles_normalized_handle_unique_idx;
-- CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_lower_idx
--     ON profiles (lower(handle)) WHERE handle IS NOT NULL;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS normalized_handle;
