-- Revoke direct client access to anonymous_subjects and ownership_claims —
-- public-platform-readiness Batch P2.
--
-- WHY THIS EXISTS. `20260901120000_revoke_remaining_write_grants.sql`'s own
-- header excluded these two tables, reasoning that
-- `20260803140000_revoke_truncate_trigger_identity_tables.sql` had already
-- revoked TRUNCATE/TRIGGER on them and that they were already
-- `FOR ALL USING (false)` (unconditional deny), so nothing further was a
-- proven gap. The TRUNCATE/TRIGGER half of that is correct — verified live,
-- neither table carries those grants. The rest was not verified against the
-- actual grant table before being stated, and is wrong: a live check shows
-- both tables still carry the FULL base grant from
-- `20260630130100_default_privileges.sql` — SELECT, INSERT, UPDATE, DELETE,
-- REFERENCES — for both `anon` and `authenticated`.
--
-- IS THIS EXPLOITABLE TODAY? No — verified live, not assumed: an
-- `authenticated`-role INSERT into both tables was blocked with "new row
-- violates row-level security policy", because `anonymous_subjects_deny_all`
-- and `ownership_claims_deny_all` (20260630124900_rls.sql, `FOR ALL USING
-- (false)`) apply to every command on the table, SELECT included — so the
-- remaining SELECT grant is equally inert today. This migration closes the
-- second layer for consistency with every other table this batch touched,
-- and additionally revokes SELECT here (unlike the owner-scoped result
-- tables elsewhere in this batch): neither table has ever had a legitimate
-- direct-client read path — `anonymous_subjects` is an internal credential
-- hash ledger and `ownership_claims` is an audit log the API alone writes
-- and the API alone has ever needed to read.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (20260801100000_rls_gaps.sql).

REVOKE SELECT, INSERT, UPDATE, DELETE ON anonymous_subjects, ownership_claims
    FROM anon, authenticated;

-- Down:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_subjects, ownership_claims
--     TO anon, authenticated;
