-- ============================================================================
-- CLEANUP: 32 test-suite rows on the staging 82-0 (perfect_season_runs)
-- leaderboard, traced in docs/implementation/launch-polish/IDENTITY_AUDIT.md.
-- ============================================================================
--
-- THIS FILE LIVES IN supabase/maintenance/, NOT supabase/migrations/, ON
-- PURPOSE. It is a reviewed, checked-in ARTIFACT — not a migration, and
-- nothing in this repo's tooling (`supabase db push`, CI, or any script)
-- auto-applies anything under this directory. It must be run manually, by a
-- human, with `PEAK3_DATABASE_URL`/Supabase project access, step by step, in
-- a client that lets you read output before deciding whether to commit.
--
-- NO CLAUSE IN THIS FILE HAS BEEN EXECUTED. It was authored and reviewed
-- without database credentials (docs/implementation/launch-polish/
-- IDENTITY_AUDIT.md §1.5) — this audit could confirm the pattern from the
-- public leaderboard API alone, but the one thing it could NOT do is read
-- `owner_sub`, which is deliberately never exposed by that API. Section 1
-- below is the missing step. Do not skip it, and do not run Section 2 until
-- Section 1's output is exactly what this file says to expect.
--
-- WHAT THIS TARGETS. 32 rows in `perfect_season_runs`, confirmed (from the
-- public API alone) to match `apps/api/tests/test_perfect_season.py`'s own
-- leaderboard-submitting tests bit-for-bit: the same 8 seeds, in the same
-- in-file order, with the one respin case landing on the one seed whose
-- test deliberately creates a respin, and `display_name="test"` explained by
-- `_mint_test_jwt`'s default `email="test@example.com"` combined with the
-- (now-fixed-in-source, deployment-status-unverified) email-local-part
-- display-name fallback. Full reasoning: IDENTITY_AUDIT.md §1.
--
-- WHAT MUST NEVER HAPPEN. This file identifies rows by an EXPLICIT id list,
-- never by `display_name = 'test'` or any other pattern match. A real player
-- is free to choose "test" as a handle, today or in the future, and a filter
-- that could catch them is not a safe cleanup — it is the same mistake this
-- whole audit exists to avoid making in the other direction.
--
-- MUST NOT RUN AGAINST ANYTHING OTHER THAN THE EXACT PROJECT THESE 32 IDS
-- WERE READ FROM (`https://peak3-staging.up.railway.app` as of 2026-08-01).
-- Confirm the connection target before running Section 1, not after.
--
-- ============================================================================
-- SECTION 1 — MANDATORY VERIFICATION. RUN THIS FIRST. READ THE OUTPUT.
-- ============================================================================
-- Do not proceed to Section 2 unless BOTH queries below come back exactly as
-- described. If either does not, STOP and re-open the investigation —
-- something has changed since the audit and the id list below may no longer
-- be safe to delete.

-- 1a. The full row detail for all 32 candidate ids, oldest first. Read every
--     row. `owner_sub` is the field this whole cleanup was blocked on being
--     unable to see from the public API — this is where it finally gets
--     checked.
SELECT
    id,
    owner_sub,
    display_name,
    game_id,
    mode,
    seed,
    wins,
    losses,
    lineup_score,
    team_respins_used,
    season_respins_used,
    data_version,
    created_at
FROM perfect_season_runs
WHERE id IN (
    '09882bc9-f6a1-47c1-bc35-3660f2e68164',
    '0de5eb2d-c38e-48bf-8927-840d5a85aef8',
    'd0429b63-af10-439e-8eef-297d05253aba',
    '1ac8f935-95e7-40c8-b818-7082aa0870de',
    '484379fe-cf99-48cd-b704-ef7cdc43b894',
    '75d83f78-cb92-4f17-b2b3-6a13f68c58d5',
    '5fc5f8e5-5143-438d-90fa-229699151923',
    '5c2adae7-2593-488e-a432-d2dcdc8aa41d',
    'f682af81-b8cf-48be-9aa0-cd5575b19828',
    '2a444ad4-0971-4d0b-a408-d344c1861ab1',
    '700759ae-ccdc-4d04-a76b-f2b7c0cc7e91',
    'e29871f3-32b5-4e3f-9f9d-1630b14c7503',
    'b091b276-fe81-4e93-a263-209c48af324d',
    '4a3fd925-20b6-4116-a0c3-44841f93b654',
    'f9a31280-3881-427c-8f2c-23684ac2335a',
    '1ef2e0e8-abe2-43ad-ad83-3a9f6f8fddca',
    'ac6509db-7839-49f2-89af-d6d5743277b9',
    '4c78357c-ad03-41dc-af6c-230782ca876d',
    'd745d02c-0817-4b88-a94c-767ab60df095',
    '916bcc82-8bc9-449b-8dfa-5a6f329b0497',
    '42ab2510-5c88-4650-b4a1-60f8fb6aaef7',
    'cc1f2548-3ec7-40ec-90ff-b46db810e9ea',
    'b7e4d154-d669-4838-9e3f-51eae980d4b3',
    '08458300-891d-4a11-bbe2-0e1ed686b5a7',
    '545473af-49f7-4923-9752-21a945537bf9',
    'b6cbaa35-5a39-42ce-802e-db9664a5ab99',
    '100bc12b-6323-4fbb-85fe-469783987eee',
    'b054c840-dddc-4f18-beb8-cd257d3434af',
    'f4792849-2274-46cd-bfe0-324e60bc43d5',
    '119dbf36-fcc1-4e37-aa11-b1f016038f65',
    '3b98333e-3982-4abd-b1f5-cbccfbb99f74',
    '737c0369-5c41-4950-b45f-3d25ae4656a6'
)
ORDER BY created_at;
-- EXPECTED: exactly 32 rows.

-- 1b. Safety check, not a formality: every one of the 32 `owner_sub` values
--     MUST be one of the 8 literal test subjects `_mint_test_jwt` mints in
--     the corresponding test (`apps/api/tests/test_perfect_season.py`) —
--     never a real Supabase `auth.users` subject reachable through the
--     actual sign-in flow. This query counts violations; it must return 0.
SELECT count(*) AS unexpected_owner_sub_count
FROM perfect_season_runs
WHERE id IN (
    '09882bc9-f6a1-47c1-bc35-3660f2e68164', '0de5eb2d-c38e-48bf-8927-840d5a85aef8',
    'd0429b63-af10-439e-8eef-297d05253aba', '1ac8f935-95e7-40c8-b818-7082aa0870de',
    '484379fe-cf99-48cd-b704-ef7cdc43b894', '75d83f78-cb92-4f17-b2b3-6a13f68c58d5',
    '5fc5f8e5-5143-438d-90fa-229699151923', '5c2adae7-2593-488e-a432-d2dcdc8aa41d',
    'f682af81-b8cf-48be-9aa0-cd5575b19828', '2a444ad4-0971-4d0b-a408-d344c1861ab1',
    '700759ae-ccdc-4d04-a76b-f2b7c0cc7e91', 'e29871f3-32b5-4e3f-9f9d-1630b14c7503',
    'b091b276-fe81-4e93-a263-209c48af324d', '4a3fd925-20b6-4116-a0c3-44841f93b654',
    'f9a31280-3881-427c-8f2c-23684ac2335a', '1ef2e0e8-abe2-43ad-ad83-3a9f6f8fddca',
    'ac6509db-7839-49f2-89af-d6d5743277b9', '4c78357c-ad03-41dc-af6c-230782ca876d',
    'd745d02c-0817-4b88-a94c-767ab60df095', '916bcc82-8bc9-449b-8dfa-5a6f329b0497',
    '42ab2510-5c88-4650-b4a1-60f8fb6aaef7', 'cc1f2548-3ec7-40ec-90ff-b46db810e9ea',
    'b7e4d154-d669-4838-9e3f-51eae980d4b3', '08458300-891d-4a11-bbe2-0e1ed686b5a7',
    '545473af-49f7-4923-9752-21a945537bf9', 'b6cbaa35-5a39-42ce-802e-db9664a5ab99',
    '100bc12b-6323-4fbb-85fe-469783987eee', 'b054c840-dddc-4f18-beb8-cd257d3434af',
    'f4792849-2274-46cd-bfe0-324e60bc43d5', '119dbf36-fcc1-4e37-aa11-b1f016038f65',
    '3b98333e-3982-4abd-b1f5-cbccfbb99f74', '737c0369-5c41-4950-b45f-3d25ae4656a6'
)
AND owner_sub NOT IN (
    'user-abc',  -- seed 102 (test_authenticated_submit_succeeds_and_recomputes_from_server_state)
    'user-0', 'user-1', 'user-2',  -- seeds 201/202/203 (test_public_leaderboard_read_works_and_is_sorted)
    'user-a',    -- seed 301 (test_no_respin_filter_excludes_runs_with_respins, run A)
    'user-b',    -- seed 302 (test_no_respin_filter_excludes_runs_with_respins, run B — the one respin)
    'user-me',   -- seed 401 (test_me_runs_requires_auth_and_returns_own_runs)
    'user-dup'   -- seed 501 (test_duplicate_submission_is_idempotent_not_duplicated)
);
-- EXPECTED: unexpected_owner_sub_count = 0.
-- If this is anything other than 0: STOP. Do not run Section 2. At least one
-- of these 32 ids has an owner_sub this audit did not predict, which means
-- either the row is not what this file thinks it is, or the mapping above is
-- stale relative to the current test file. Re-derive it by hand before doing
-- anything else.

-- 1c (optional, contextual). Total current board size, for before/after
--     comparison against the expected counts in Section 3.
SELECT count(*) AS total_rows_on_board FROM perfect_season_runs;
-- EXPECTED (per IDENTITY_AUDIT.md §1.1, as of 2026-08-01): 32. If this number
-- is now larger, new rows have landed since the audit — re-pull
-- `GET /api/v1/perfect-season/leaderboard?limit=100` and re-run the
-- provenance check in IDENTITY_AUDIT.md §1 against whatever is new before
-- deleting anything. This file's DELETE only ever touches the 32 explicit
-- ids above regardless, so it cannot accidentally catch newer rows — but a
-- changed total means the picture has changed and is worth understanding
-- before proceeding.

-- ============================================================================
-- SECTION 2 — THE DELETE. Do not run until Section 1's two checks both came
-- back exactly as expected. Wrapped in an explicit transaction that is NOT
-- committed by this file — read the RETURNING output, and only then decide
-- COMMIT or ROLLBACK yourself.
-- ============================================================================

BEGIN;

DELETE FROM perfect_season_runs
WHERE id IN (
    '09882bc9-f6a1-47c1-bc35-3660f2e68164', '0de5eb2d-c38e-48bf-8927-840d5a85aef8',
    'd0429b63-af10-439e-8eef-297d05253aba', '1ac8f935-95e7-40c8-b818-7082aa0870de',
    '484379fe-cf99-48cd-b704-ef7cdc43b894', '75d83f78-cb92-4f17-b2b3-6a13f68c58d5',
    '5fc5f8e5-5143-438d-90fa-229699151923', '5c2adae7-2593-488e-a432-d2dcdc8aa41d',
    'f682af81-b8cf-48be-9aa0-cd5575b19828', '2a444ad4-0971-4d0b-a408-d344c1861ab1',
    '700759ae-ccdc-4d04-a76b-f2b7c0cc7e91', 'e29871f3-32b5-4e3f-9f9d-1630b14c7503',
    'b091b276-fe81-4e93-a263-209c48af324d', '4a3fd925-20b6-4116-a0c3-44841f93b654',
    'f9a31280-3881-427c-8f2c-23684ac2335a', '1ef2e0e8-abe2-43ad-ad83-3a9f6f8fddca',
    'ac6509db-7839-49f2-89af-d6d5743277b9', '4c78357c-ad03-41dc-af6c-230782ca876d',
    'd745d02c-0817-4b88-a94c-767ab60df095', '916bcc82-8bc9-449b-8dfa-5a6f329b0497',
    '42ab2510-5c88-4650-b4a1-60f8fb6aaef7', 'cc1f2548-3ec7-40ec-90ff-b46db810e9ea',
    'b7e4d154-d669-4838-9e3f-51eae980d4b3', '08458300-891d-4a11-bbe2-0e1ed686b5a7',
    '545473af-49f7-4923-9752-21a945537bf9', 'b6cbaa35-5a39-42ce-802e-db9664a5ab99',
    '100bc12b-6323-4fbb-85fe-469783987eee', 'b054c840-dddc-4f18-beb8-cd257d3434af',
    'f4792849-2274-46cd-bfe0-324e60bc43d5', '119dbf36-fcc1-4e37-aa11-b1f016038f65',
    '3b98333e-3982-4abd-b1f5-cbccfbb99f74', '737c0369-5c41-4950-b45f-3d25ae4656a6'
)
RETURNING id, owner_sub, display_name, game_id, seed, created_at;
-- EXPECTED: exactly 32 rows returned, matching Section 1a's output exactly
-- (same ids, same owner_subs). `perfect_season_run_cards` rows for these
-- runs cascade automatically (ON DELETE CASCADE — see
-- supabase/migrations/20260724150000_perfect_season_leaderboard.sql:55).
--
-- Read the RETURNING output above. If it matches Section 1a row-for-row:
--   COMMIT;
-- If anything looks different from what you reviewed in Section 1:
--   ROLLBACK;
-- This file intentionally ends without either statement — that decision is
-- the operator's, made after reading real output, not a default baked into
-- a script.

-- ============================================================================
-- SECTION 3 — POST-CLEANUP VERIFICATION. Run after COMMIT.
-- ============================================================================

-- 3a. None of the 32 ids should exist anymore.
SELECT count(*) AS remaining_from_the_32
FROM perfect_season_runs
WHERE id IN (
    '09882bc9-f6a1-47c1-bc35-3660f2e68164', '0de5eb2d-c38e-48bf-8927-840d5a85aef8',
    'd0429b63-af10-439e-8eef-297d05253aba', '1ac8f935-95e7-40c8-b818-7082aa0870de',
    '484379fe-cf99-48cd-b704-ef7cdc43b894', '75d83f78-cb92-4f17-b2b3-6a13f68c58d5',
    '5fc5f8e5-5143-438d-90fa-229699151923', '5c2adae7-2593-488e-a432-d2dcdc8aa41d',
    'f682af81-b8cf-48be-9aa0-cd5575b19828', '2a444ad4-0971-4d0b-a408-d344c1861ab1',
    '700759ae-ccdc-4d04-a76b-f2b7c0cc7e91', 'e29871f3-32b5-4e3f-9f9d-1630b14c7503',
    'b091b276-fe81-4e93-a263-209c48af324d', '4a3fd925-20b6-4116-a0c3-44841f93b654',
    'f9a31280-3881-427c-8f2c-23684ac2335a', '1ef2e0e8-abe2-43ad-ad83-3a9f6f8fddca',
    'ac6509db-7839-49f2-89af-d6d5743277b9', '4c78357c-ad03-41dc-af6c-230782ca876d',
    'd745d02c-0817-4b88-a94c-767ab60df095', '916bcc82-8bc9-449b-8dfa-5a6f329b0497',
    '42ab2510-5c88-4650-b4a1-60f8fb6aaef7', 'cc1f2548-3ec7-40ec-90ff-b46db810e9ea',
    'b7e4d154-d669-4838-9e3f-51eae980d4b3', '08458300-891d-4a11-bbe2-0e1ed686b5a7',
    '545473af-49f7-4923-9752-21a945537bf9', 'b6cbaa35-5a39-42ce-802e-db9664a5ab99',
    '100bc12b-6323-4fbb-85fe-469783987eee', 'b054c840-dddc-4f18-beb8-cd257d3434af',
    'f4792849-2274-46cd-bfe0-324e60bc43d5', '119dbf36-fcc1-4e37-aa11-b1f016038f65',
    '3b98333e-3982-4abd-b1f5-cbccfbb99f74', '737c0369-5c41-4950-b45f-3d25ae4656a6'
);
-- EXPECTED: remaining_from_the_32 = 0.

-- 3b. Board total should have dropped by exactly 32 from whatever Section
--     1c reported (32 -> 0, if nothing else has landed on the board since).
SELECT count(*) AS total_rows_on_board_after FROM perfect_season_runs;
-- EXPECTED: (Section 1c's total_rows_on_board) - 32. If Section 1c read 32,
-- this should now read 0.

-- 3c. Orphaned run_cards should be zero (confirms the cascade actually ran,
--     not just the parent rows).
SELECT count(*) AS orphaned_run_cards
FROM perfect_season_run_cards prc
WHERE NOT EXISTS (SELECT 1 FROM perfect_season_runs r WHERE r.id = prc.run_id);
-- EXPECTED: orphaned_run_cards = 0 (should always be 0 given the FK+cascade;
-- this is a sanity check, not something the DELETE above could get wrong by
-- itself).

-- ============================================================================
-- NOT IN SCOPE OF THIS FILE
-- ============================================================================
-- Closing the hole that let this contamination happen — the postgres-mode
-- test guard in apps/api/tests/conftest.py — is a separate, already-applied
-- code change (see that file's own comment and
-- apps/api/tests/test_postgres_mode_guard.py), not a database change and
-- not part of this SQL. This file only removes what already landed; it does
-- not by itself prevent a recurrence. Confirm that guard is merged before
-- treating this cleanup as durable — deleting these 32 rows without it just
-- means the board refills the next time someone runs pytest against a
-- misconfigured local environment.
