-- Migration: complete the write-grant revoke sweep across every remaining
-- durable table (public-platform-readiness Batch P2).
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass, same discipline as every other file added in this phase.
--
-- WHAT THIS IS. `20260630130100_default_privileges.sql` grants
-- `SELECT, INSERT, UPDATE, DELETE` on every table to `anon, authenticated` at
-- provisioning time, AND sets `ALTER DEFAULT PRIVILEGES` so every table
-- created afterward inherits the same blanket grant automatically. Six later
-- migrations (`20260801130000_peak_duel_results_revoke.sql`,
-- `20260801140000_owned_results_revoke.sql`,
-- `20260801170000_revoke_truncate_and_trigger.sql`,
-- `20260803100000_profile_handle_contract.sql`'s sibling
-- `20260803140000_revoke_truncate_trigger_identity_tables.sql`,
-- `20260801160000_head_to_head.sql`'s own inline revoke, and
-- `20260811090000_daily_grid_leaderboard.sql`'s own inline revoke) narrowed
-- that blanket grant back down, table by table, as each was reviewed. A
-- Batch P2 audit against the real local database (not a re-read of the SQL
-- files) found 33 tables where that narrowing had never happened -- the
-- default privileges migration was still the last word on them, including
-- two of the most safety-critical tables in the schema:
-- `ranked_match_settlements` and `rating_ledger_entries`.
--
-- IS THIS EXPLOITABLE TODAY? No, verified directly against a real local
-- Postgres instance before writing this migration, not assumed:
--   - INSERT: fails loudly (`new row violates row-level security policy`) on
--     every one of these tables, because each already has RLS enabled with
--     either an owner-scoped SELECT-only policy (no INSERT policy exists, so
--     the implicit WITH CHECK is `false`) or an explicit `FOR ALL USING
--     (false)` deny-all policy.
--   - UPDATE / DELETE: silently affect ZERO rows for the identical reason --
--     confirmed with `DELETE FROM ranked_match_settlements` and
--     `UPDATE rating_ledger_entries SET post_rating = 9999` while impersonating
--     an authenticated stranger: both returned `0` rows, not an error.
--
-- THAT SILENT ZERO IS THE ACTUAL GAP -- not data loss (nothing changed), but
-- exactly the failure mode `20260801140000_owned_results_revoke.sql`'s own
-- header already named as the reason its five tables got a REVOKE instead of
-- being left to RLS alone: "A write that merely matches no policy silently
-- affects zero rows... a REVOKE fails loudly at the privilege check." A
-- REVOKE turns an abuse attempt into an `InsufficientPrivilegeError` a client
-- library surfaces and a server can log; RLS-policy-absence turns the same
-- attempt into a query that returns successfully having done nothing,
-- indistinguishable at the wire level from "there was nothing to update."
--
-- WHY NOW, NOT LEFT FOR A LATER BATCH: `ranked_match_settlements` and
-- `rating_ledger_entries` back rating integrity -- Batch P2's explicit
-- concern -- and completing an already-established, six-times-repeated
-- pattern to the two tables that most need it is a smaller, safer change
-- than leaving the schema in a state where "was this table's write grant
-- reviewed yet" has no single answer.
--
-- SCOPE. Every table below already has RLS enabled and either no INSERT/
-- UPDATE/DELETE policy for anon/authenticated, or an explicit deny-all
-- policy -- confirmed by direct query against pg_policies before this list
-- was drawn up. `profiles`, `user_settings` are deliberately EXCLUDED: both
-- have a real `FOR ALL ... WITH CHECK` owner-write policy
-- (`profiles_owner_write`, `user_settings_owner_write`) that intentionally
-- allows a direct owner write, so revoking here would be a behavior change,
-- not a hardening. `anonymous_subjects`, `ownership_claims` are also
-- excluded -- already `FOR ALL USING (false)` (unconditional deny,
-- strictly safer than absence-of-policy) and already had TRUNCATE/TRIGGER
-- revoked by `20260803140000_revoke_truncate_trigger_identity_tables.sql`;
-- touching them again is not a proven gap, just churn.
--
-- SELECT is untouched everywhere -- every owner-read / public-read policy
-- already narrows it correctly; this migration only removes write verbs
-- nothing legitimate uses (every application write goes through the API's
-- own table-owning Postgres connection, confirmed by grep: no frontend code
-- anywhere calls the Supabase client's `.from(...)` table access -- every
-- write is browser -> FastAPI -> database, never browser -> direct
-- database credential).

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON
    achievement_awards,
    achievement_definitions,
    board_snapshots,
    card_pool_versions,
    challenge_participants,
    challenge_settlements,
    challenges,
    division_versions,
    game_actions,
    lineup_model_versions,
    personal_record_events,
    personal_records,
    placement_states,
    progression_events,
    queue_ratings,
    ranked_abort_allowances,
    ranked_integrity_events,
    ranked_match_participants,
    ranked_match_settlements,
    ranked_match_submissions,
    ranked_matches,
    ranked_opponent_history,
    ranked_queue_entries,
    ranked_queue_versions,
    rating_algorithm_versions,
    rating_ledger_entries,
    rating_periods,
    rating_snapshots,
    result_snapshots,
    ruleset_versions,
    streak_events,
    streak_states,
    user_progress,
    xp_policy_versions
FROM anon, authenticated;

-- Down:
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON
--     achievement_awards, achievement_definitions, board_snapshots,
--     card_pool_versions, challenge_participants, challenge_settlements,
--     challenges, division_versions, game_actions,
--     lineup_model_versions, personal_record_events, personal_records,
--     placement_states, progression_events, queue_ratings,
--     ranked_abort_allowances, ranked_integrity_events,
--     ranked_match_participants, ranked_match_settlements,
--     ranked_match_submissions, ranked_matches, ranked_opponent_history,
--     ranked_queue_entries, ranked_queue_versions, rating_algorithm_versions,
--     rating_ledger_entries, rating_periods, rating_snapshots,
--     result_snapshots, ruleset_versions, streak_events, streak_states,
--     user_progress, xp_policy_versions
-- TO anon, authenticated;
--
-- `games` and `daily_completions` are deliberately NOT in this list, unlike
-- the rest of this file's REVOKE statement's own siblings: they are revoked
-- by 20260901090000_game_records_client_write_revoke.sql (a sibling migration
-- in this same batch, written independently and applied first), and this
-- file's REVOKE never named them to avoid a second, redundant REVOKE of the
-- same privileges on the same tables across two migrations. `result_snapshots`
-- IS named in both files -- REVOKE is idempotent, so the overlap is harmless,
-- and it is left as-is here rather than edited out after the fact.
