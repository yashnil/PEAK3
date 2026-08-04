# CONTRACT EVIDENCE — launch-polish §4

Consolidated, per the lead's request: one section per contract item, each
showing the exact test name or query that demonstrates it and the observed
result. Nothing in this document is inferred or asserted without a command
and its real output alongside it. Re-run on the shipping tree
(`wt/lp-identity` @ `d730b1a`) on 2026-08-03, against the local Docker
Supabase Postgres instance and the real FastAPI app via `TestClient` — never
against staging (standing rule: no writes to staging, for any reason,
including verification).

Items 1–4 are identity-community's. Item 5 (theme defaults) is
visual-platform's and is included here only by citing their own test file
and a fresh run of it, not re-derived.

---

## 1. Contact submissions — rate limiting, honeypot, no public read

**Rate limiting and honeypot** (real HTTP requests through the actual
FastAPI app, `TestClient`, not a code read):

```
$ pytest tests/test_contact.py -v -k "rate_limit or honeypot"
tests/test_contact.py::test_honeypot_field_filled_looks_like_success_but_stores_nothing PASSED
tests/test_contact.py::test_honeypot_field_empty_or_absent_does_not_block_submission PASSED
tests/test_contact.py::test_rate_limit_returns_429_with_retry_after PASSED
3 passed, 20 deselected
```

- `test_honeypot_field_filled_looks_like_success_but_stores_nothing`: submits
  with the hidden `website` field populated (what a naive scraper fills),
  asserts the response is still `202 accepted: true` (indistinguishable from
  a real success), and asserts nothing was written to the store.
- `test_rate_limit_returns_429_with_retry_after`: exceeds
  `settings.CONTACT_RATE_LIMIT` (3 per 10 minutes) and asserts the next
  request is `429` with a `Retry-After` header and no leaked remaining-budget
  number in the body.

**No public read path** — proven by attempting the read as `anon` and being
denied, not by noting no GET route exists:

```
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; SELECT * FROM contact_submissions; RESET ROLE;"
SET
ERROR:  permission denied for table contact_submissions
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.contact_submissions TO anon;

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; INSERT INTO contact_submissions (subject_hash, subject_kind, category, subject, message)
   VALUES (repeat('a', 64), 'anon', 'bug', 'direct insert attempt', 'trying to bypass the API'); RESET ROLE;"
SET
ERROR:  permission denied for table contact_submissions
HINT:  Grant the required privileges to the current role with: GRANT INSERT ON public.contact_submissions TO anon;

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE authenticated; SELECT * FROM contact_submissions; RESET ROLE;"
SET
ERROR:  permission denied for table contact_submissions
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.contact_submissions TO authenticated;
```

Both `anon` and `authenticated` are denied SELECT and INSERT directly —
`contact_submissions_no_client_access` (`FOR ALL USING (false) WITH CHECK
(false)`) plus the accompanying `REVOKE SELECT, INSERT, UPDATE, DELETE`
(`supabase/migrations/20260803110000_contact_submissions.sql`). Static check
that the migration actually contains these, not just that it's intended:

```
$ pytest tests/test_contact.py -v -k rls_migration
tests/test_contact.py::test_rls_migration_denies_every_client_verb PASSED
```

Also closed while gathering this evidence: `contact_submissions` (and,
separately, `profiles`) still held `TRUNCATE`/`TRIGGER` for
`anon`/`authenticated` — a table-level privilege RLS does not filter. Fixed
in the same migration and in
`supabase/migrations/20260803120000_profile_column_privileges.sql`; the
remaining three sibling identity tables (`user_settings`,
`anonymous_subjects`, `ownership_claims`) had the identical gap and are
closed in `supabase/migrations/20260803140000_revoke_truncate_trigger_identity_tables.sql`
— before/after grants and live denied-`TRUNCATE` proof in §2 below (same
table family, evidence shown once).

---

## 2. Public handles never expose auth_sub, email, or a Google full name

Live proof, real ASGI request through the actual app — not internals
inspection. Minted an `AuthSubject` carrying a realistic Google-OAuth-shaped
JWT payload (`raw_claims={"name": "Jane Real Fullname", "user_metadata":
{"full_name": "Jane Real Fullname", "avatar_url": "https://lh3.googleusercontent.com/real-photo"}}`,
`email="jane.real.fullname@gmail.com"`), set a handle while deliberately
never sending `display_name`, then hit the **public, unauthenticated** route:

```
PUT /api/v1/profiles/me -> 200
  {'id': '0c40300b-64b8-40cf-8e5e-31319fe69d3c', 'handle': 'liveproof86bf11',
   'display_name': None, 'bio': None, 'region': None, 'avatar_key': None,
   'is_public': True, 'history_public': False, 'joined_at': '2026-08-03T23:49:14.557959+00:00'}

GET /api/v1/profiles/{handle} (public route, unauthenticated) -> 200
  {'id': '0c40300b-64b8-40cf-8e5e-31319fe69d3c', 'handle': 'liveproof86bf11',
   'display_name': None, 'bio': None, 'region': None, 'avatar_key': None,
   'is_public': True, 'history_public': False, 'joined_at': '2026-08-03T23:49:14.557959+00:00'}

CONFIRMED: no auth_sub key, no email key; the raw Supabase sub string,
the account email, and the Google full name (present in raw_claims,
never read by any profile route) are all absent from the response body.
```

**Through the column-privilege grant too**, not just the API layer — the
"even if the FastAPI route were bypassed entirely" case, proven by directly
attempting `SELECT auth_sub` as `anon` against real Postgres:

```
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; SELECT auth_sub FROM profiles LIMIT 1; RESET ROLE;"
SET
ERROR:  permission denied for table profiles
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.profiles TO anon;

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; SELECT * FROM profiles LIMIT 1; RESET ROLE;"
SET
ERROR:  permission denied for table profiles
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.profiles TO anon;
```

`SELECT *` is denied too, deliberately checked — it's what a direct
PostgREST client issues by default, and it must fail rather than quietly
return the withheld column. The safe columns remain readable (the fix is
column-scoped, not a blanket lockout):

```
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; SELECT id, handle FROM profiles LIMIT 1; RESET ROLE;"
SET
                  id                  |      handle
--------------------------------------+------------------
 33fc91e8-6dd1-4b83-8c49-8e4720e37cca | rlsprobedd7816fb
(1 row)
```

**TRUNCATE/TRIGGER**, the table-level privilege RLS row-policies cannot
filter — before and after, on the full identity-table family
(`profiles`, `user_settings`, `anonymous_subjects`, `ownership_claims`):

```sql
-- BEFORE (all four tables, both roles) --
 table_name           grantee         TRUNCATE   TRIGGER
 profiles              anon            yes        yes
 profiles              authenticated   yes        yes
 user_settings         anon            yes        yes
 user_settings         authenticated   yes        yes
 anonymous_subjects    anon            yes        yes
 anonymous_subjects    authenticated   yes        yes
 ownership_claims      anon            yes        yes
 ownership_claims      authenticated   yes        yes
```

```
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SELECT grantee, privilege_type FROM information_schema.role_table_grants
   WHERE table_name='profiles' AND grantee IN ('anon','authenticated');"
-- AFTER: TRUNCATE, TRIGGER absent for both roles; DELETE/INSERT/UPDATE/REFERENCES
-- (the legitimate, RLS-row-scoped owner-write privileges) unchanged.

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE authenticated; TRUNCATE user_settings; RESET ROLE;"
SET
ERROR:  permission denied for table user_settings

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE anon; TRUNCATE anonymous_subjects; RESET ROLE;"
SET
ERROR:  permission denied for table anonymous_subjects

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SET ROLE authenticated; TRUNCATE ownership_claims; RESET ROLE;"
SET
ERROR:  permission denied for table ownership_claims
```

Automated version of the auth_sub proof, run against real Postgres (not the
in-memory backend):

```
$ pytest tests/integration/test_rls_policies.py -v -k profile
test_profile_owner_can_still_read_their_own_safe_columns PASSED
test_anonymous_can_read_a_public_profiles_safe_columns PASSED
test_anonymous_cannot_read_a_private_profiles_safe_columns PASSED
test_profile_auth_sub_is_never_readable_by_a_client_key[SELECT auth_sub FROM profiles] PASSED
test_profile_auth_sub_is_never_readable_by_a_client_key[SELECT * FROM profiles] PASSED
5 passed
```

`test_profile_auth_sub_is_never_readable_by_a_client_key` parametrizes over
anonymous, a signed-in stranger, AND the profile's own owner, asserting
`asyncpg.exceptions.InsufficientPrivilegeError` in all three cases — the
column privilege applies uniformly, including to the row's own owner (their
`auth_sub` is the JWT `sub` they're already holding, so nothing is newly
withheld that they didn't already have).

Full RLS suite, same run: `80 passed` in
`tests/integration/test_rls_policies.py`; `94 passed, 1 skipped` (unrelated,
pre-existing) across the whole integration suite.

---

## 3. Leaderboard cleanup selects by concrete provenance, never by handle "test"

File: `supabase/maintenance/2026-08-01_cleanup_perfect_season_test_contamination.sql`
— checked in, **unexecuted**, not a migration (nothing in this repo's
tooling auto-applies anything under `supabase/maintenance/`).

**The mandatory preview SELECT (Section 1a), verbatim:**

```sql
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
ORDER BY created_at;
-- EXPECTED: exactly 32 rows.
```

Plus a **safety check** (Section 1b) that must independently return `0`
before the delete may run — every one of the 32 `owner_sub` values must be
one of the 8 literal test subjects `_mint_test_jwt` mints
(`user-abc`/`user-0`/`user-1`/`user-2`/`user-a`/`user-b`/`user-me`/`user-dup`),
never a real `auth.users` subject. This is the field the public leaderboard
API never exposes, which is why cleanup was blocked on DB access in the
first place.

**The exact DELETE (Section 2), verbatim — identical id list, never a
`display_name` filter:**

```sql
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
-- EXPECTED: exactly 32 rows returned, matching Section 1a row-for-row.
-- File ends without COMMIT or ROLLBACK -- that decision is the operator's,
-- made after reading the RETURNING output, not a default baked into a script.
```

**Grep proof there is no `display_name` filter anywhere in the file:**

```
$ grep -n "display_name" supabase/maintenance/2026-08-01_cleanup_perfect_season_test_contamination.sql
25:-- test deliberately creates a respin, and `display_name="test"` explained by
31:-- never by `display_name = 'test'` or any other pattern match. A real player
55:    display_name,
184:RETURNING id, owner_sub, display_name, game_id, seed, created_at;
```

All four matches are comment prose explaining the rule, or a
SELECT/RETURNING column list for the human operator to read — zero matches
inside a `WHERE` clause. Programmatic count of the selection criteria
itself: exactly 32 UUID literals in `WHERE id IN (...)`, confirmed by
parsing the file's `DELETE` block.

**Expected before/after row counts** (Section 1c / 3a / 3b in the file):
`total_rows_on_board` before = 32 (the entire board, per
`IDENTITY_AUDIT.md` §1.1, as of 2026-08-01); `remaining_from_the_32` after =
0; `total_rows_on_board_after` = 0; `orphaned_run_cards` = 0
(`perfect_season_run_cards` cascades via `ON DELETE CASCADE`).

**Status: unexecuted.** Nobody on this team has `PEAK3_DATABASE_URL` /
staging credentials; the lead is reporting execution as an external
blocker, per the standing no-writes-to-staging rule.

---

## 4. The same authoritative run cannot create two leaderboard entries

**Database-constraint level** — a real duplicate-key violation, not the
application catching it:

```
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c "\d perfect_season_runs" | grep -i unique
    "perfect_season_runs_game_id_key" UNIQUE CONSTRAINT, btree (game_id)

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "INSERT INTO perfect_season_runs (owner_sub, display_name, mode, game_id, seed, wins, losses,
   lineup_score, score_status, exact_cards_scored, total_cards, is_public)
   VALUES ('evidence-owner-2', 'evidence_test', 'apex_1y', 'evidence-game-final-456', 1, 60, 22,
   88.0, 'complete', 8, 8, false);"
INSERT 0 1

-- Retry with the SAME game_id and DIFFERENT fabricated wins (simulating a
-- retry/double-submit that also tries to smuggle a better score):
$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "INSERT INTO perfect_season_runs (... same columns ...)
   VALUES ('evidence-owner-2', 'evidence_test', 'apex_1y', 'evidence-game-final-456', 1, 82, 0,
   100.0, 'complete', 8, 8, false);"
ERROR:  duplicate key value violates unique constraint "perfect_season_runs_game_id_key"
DETAIL:  Key (game_id)=(evidence-game-final-456) already exists.

$ docker exec supabase_db_PEAK3 psql -U postgres -d postgres -c \
  "SELECT count(*), array_agg(wins) FROM perfect_season_runs WHERE game_id = 'evidence-game-final-456';"
 count | array_agg
-------+-----------
     1 | {60}
(1 row)
```

The row count stays at exactly 1, and the surviving value is `60` — the
**original** submission's wins, never overwritten by the second attempt's
fabricated `82`. A constraint that merely rejects the second write is not
enough on its own; this confirms the first write is the one that persists,
which is what actually rules out a silent overwrite.

**Application level**, real HTTP requests through the real app, four
different real-world stories for the identical server-side property:

```
$ pytest tests/test_perfect_season.py -v -k \
  "same_completed_run_submitted_twice or duplicate_submission_is_idempotent or retrying_after_a_client_side_timeout or page_refresh_replaying"
test_the_same_completed_run_submitted_twice_produces_one_entry PASSED
test_duplicate_submission_is_idempotent_not_duplicated PASSED
test_a_page_refresh_replaying_the_same_submit_request_does_not_resubmit PASSED
test_retrying_after_a_client_side_timeout_is_idempotent PASSED
4 passed, 354 deselected
```

---

## 5. Theme defaults (visual-platform's domain, cited not re-derived)

Test file: `apps/web/src/tests/unit/theme.test.ts`.

```
$ npx vitest run src/tests/unit/theme.test.ts
✓ src/tests/unit/theme.test.ts (24 tests) 197ms
Test Files  1 passed (1)
     Tests  24 passed (24)
```

Relevant test names (real vitest run, not read from source):
`defaults to dark with nothing stored`,
`reads a previously stored preference on first use`,
`honors an explicitly stored 'system' preference and still follows the OS`,
`an explicit 'dark' choice is never overridden by system light`,
`resolves 'system' against prefers-color-scheme: light -> light`,
`resolves 'system' with no light match -> dark`,
`resolves to dark, matching the resolver's default, when nothing is stored`
(the pre-paint script's own resolver, checked separately from the runtime
one so a mismatch between the two — the exact cause of a wrong-theme flash
— would fail here), `still follows the OS when 'system' was explicitly
stored, matching the resolver`. All 24 passed together, confirming: a clean
user (nothing stored) resolves to Dark; an explicitly saved Light or System
preference wins over that default in both the blocking pre-paint script and
the runtime resolver, not just one of the two.

---

## Undo endpoint contract tests (backend, `fb0840b`)

`POST /api/v1/perfect-season/games/{game_id}/undo` — named together here
per the lead's request, alongside the rest of this evidence:

```
$ pytest tests/test_perfect_season.py -v -k undo
test_undo_is_unavailable_before_anything_has_been_placed PASSED
test_undo_reverses_a_placement_into_an_empty_slot PASSED
test_undo_reverses_a_swap_restoring_both_displaced_players PASSED
test_undo_rejects_a_stale_expected_state_version PASSED
test_undo_is_no_longer_available_once_another_action_has_happened PASSED
test_undo_expires_after_the_server_enforced_window PASSED
test_undo_survives_a_reload_within_the_window PASSED
test_undo_duplicate_request_is_idempotent_not_a_double_undo PASSED
test_undo_denies_a_signed_in_stranger PASSED
test_undo_state_survives_a_serialization_round_trip PASSED
10 passed, 348 deselected
```

- **Cross-user denial**: `test_undo_denies_a_signed_in_stranger` — owner
  places a card under their own JWT; a different signed-in stranger's
  identical undo request against the same `game_id` gets `403`; a
  subsequent fetch as the owner confirms the placement is untouched.
- **Duplicate undo request**: `test_undo_duplicate_request_is_idempotent_not_a_double_undo`
  — the same `idempotency_key` sent twice returns byte-identical JSON both
  times, and a third, genuinely new placement into the same slot afterward
  succeeds normally (proving the slot was emptied exactly once, not into an
  inconsistent double-undone state).
- **Stale state version rejection**: `test_undo_rejects_a_stale_expected_state_version`
  — sends `expected_state_version - 1`, asserts `400 stale_state`, then
  re-fetches the game and confirms `state_version` and the placement are
  byte-identical to before the rejected call ("reject stale undo safely — no
  partial mutation").
- `test_undo_reverses_a_swap_restoring_both_displaced_players` additionally
  asserts `role_fit`/`role_fit_severity` on both slots exactly match their
  pre-swap values after undo, not just that the right card is back — a
  swap recomputes fit for both slots on every application, so this proves
  the reversal reproduces the exact original tuple rather than merely "a
  recomputed value" (raised in review; the class of bug this guards against
  passes "did the roster come back" and fails a player's eyes).

---

## Full-suite confirmation (same run)

```
$ pytest tests/ --ignore=tests/integration -m "not supabase_integration" -q
1154 passed, 114 failed, 1 skipped, 5 deselected, 20 errors
```

The 114 failures / 20 errors are entirely `test_run_the_table.py` and
`test_regression.py`, both caused by this worktree not having
`data/web/`/`data/game/profiles/` generated (`make build-dataset` was never
run here) — confirmed unrelated to any change in this pass by reproducing
one standalone (`503 card_pool_unavailable`) and by the lead independently
verifying the same failures do not occur on a tree with generated data
(1278/0 backend, 955/0 model, reported separately).

```
$ pytest tests/integration/ tests/test_repository_conformance.py -m supabase_integration -q
94 passed, 1 skipped, 5 deselected
```

Real Postgres, real HTTP, real permission errors — not code reads, per the
standard this pass established after two earlier claims (the auth_sub
tightening, the RTT alias retirement) turned out not to exist in the
artifact despite being reported as done.
