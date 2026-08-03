-- Migration: profiles column-level privileges -- close the auth_sub exposure
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass, same discipline as every other file added in this phase.
--
-- WHAT WAS ACTUALLY WRONG, verified against the live chain rather than
-- assumed. `profiles_public_read` (20260630124900_rls.sql:22-24) is
--     FOR SELECT USING (is_public = true)
-- -- a ROW filter, not a column filter. Combined with
-- 20260630130100_default_privileges.sql:27's table-wide
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--         TO anon, authenticated;
-- a direct PostgREST caller holding the anon or authenticated key could run
--     GET /rest/v1/profiles?is_public=eq.true&select=*
-- and receive every column of every public profile, including `auth_sub`
-- (20260630124500_identity.sql:13) -- the raw Supabase auth.uid() behind
-- that profile. The FastAPI layer never does this (ProfileResponse in
-- app/models/profile.py has no auth_sub field, checked directly), so this
-- was never reachable through the product as shipped; it is exactly the
-- "second, independent layer in case these tables are ever exposed via
-- Supabase's own REST API to a client holding an anon/authenticated key
-- directly" defense-in-depth the perfect_season_runs migration documents
-- for itself (20260724150000_perfect_season_leaderboard.sql) -- a real gap
-- in that second layer, not an active breach of the first.
--
-- THE FIX IS COLUMN-LEVEL PRIVILEGES, identical shape to
-- 20260801100000_rls_gaps.sql's treatment of board_snapshots and
-- challenges: the ROW policy is correct as written (a public profile's
-- public-safe fields really should be readable by anyone), only the COLUMN
-- exposure was wrong. Revoke the table-wide SELECT this table inherited
-- from the schema-wide default, then re-grant exactly the columns
-- `ProfileResponse` already exposes over HTTP -- everything except
-- `auth_sub`.
--
-- APPLIES UNIFORMLY, INCLUDING TO A ROW'S OWN OWNER. Unlike
-- `profiles_owner_write` (FOR ALL, so it also covers SELECT), a
-- column-level GRANT is not conditional on which RLS policy matched a
-- given row -- it restricts the columns any query from that role can name,
-- full stop. So a signed-in user reading their OWN row directly via
-- PostgREST also cannot select `auth_sub` through this path. That costs
-- them nothing: their own `auth_sub` IS their own Supabase `auth.uid()`,
-- which is the `sub` claim in the JWT they are holding to make the request
-- at all -- there is no information here they do not already have. A
-- narrower "owner sees more columns" carve-out is not expressible as a
-- plain GRANT and is not needed for that reason; the blanket revoke/grant
-- is the correct shape and matches the board_snapshots/challenges
-- precedent, which does not carve out an owner exception either.
--
-- Ordering note, same as that migration's own: this file sorts after
-- 20260630130100_default_privileges.sql, so on a full-chain apply the broad
-- grant lands first and this narrower privilege lands last, which is the
-- order the result depends on. It also sorts after
-- 20260803100000_profile_handle_contract.sql, so `normalized_handle`
-- already exists on `profiles` by the time this runs and can be included
-- in the safe column list below.
--
-- The API is unaffected: it connects as the table-owning role via asyncpg,
-- and an owner's privileges are not derived from these grants.

REVOKE SELECT ON profiles FROM anon, authenticated;

GRANT SELECT (
    id, handle, normalized_handle, display_name, bio, region, avatar_key,
    is_public, history_public, joined_at, updated_at
) ON profiles TO anon, authenticated;

-- Withheld: `auth_sub` only. Every other column already round-trips through
-- ProfileResponse (app/models/profile.py) over the real API, so nothing in
-- the safe list above is newly public that wasn't already reachable through
-- the product.

-- Down:
-- REVOKE SELECT (
--     id, handle, normalized_handle, display_name, bio, region, avatar_key,
--     is_public, history_public, joined_at, updated_at
-- ) ON profiles FROM anon, authenticated;
-- GRANT SELECT ON profiles TO anon, authenticated;
