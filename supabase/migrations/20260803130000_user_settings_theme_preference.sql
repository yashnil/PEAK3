-- Migration: user_settings.theme_preference (launch-polish IMPLEMENTATION_CONTRACT.md §2)
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass, same discipline as every other file added in this phase.
--
-- SEQUENCED AFTER 20260803120000_profile_column_privileges.sql on purpose:
-- that migration closes a real column-exposure gap on a sibling table
-- (`profiles`); this one adds a new field. Protect first, extend second --
-- not the other way around.
--
-- NO COLUMN-PRIVILEGE CHANGE NEEDED HERE, unlike that migration. Unlike
-- `profiles.auth_sub`, `theme_preference` carries no identity or
-- correlation risk -- it is exactly as sensitive as the two columns already
-- on this table (`timezone`, `reduced_motion`), which have never needed
-- column-level restriction. `user_settings` was already granted table-wide
-- SELECT/INSERT/UPDATE/DELETE (20260630130100_default_privileges.sql) with
-- RLS scoping every verb to the owner (`user_settings_owner_write`,
-- 20260801110000_guest_claim_and_daily.sql) -- a table-wide GRANT with no
-- column list already covers a column added later, so this migration is
-- schema-only.
--
-- NULLABLE, NO DEFAULT, DELIBERATELY. The client-side contract (§2): new
-- and signed-out users resolve to Dark; an explicitly saved preference
-- (Light, Dark, or an explicit System) wins; local storage is authoritative
-- for the session and this table is a background sync target, not a source
-- of truth the client blocks on. NULL is not "unset, default to something"
-- -- it is the meaningful third state "this account has never told the
-- server anything," and coercing it to a default here would make that
-- state unrepresentable. A row with no explicit preference must keep
-- reading back NULL exactly as it does today (no theme_preference column
-- existed at all until this migration).

ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS theme_preference TEXT
    CHECK (theme_preference IS NULL OR theme_preference IN ('system', 'dark', 'light'));

-- Down:
-- ALTER TABLE user_settings DROP COLUMN IF EXISTS theme_preference;
