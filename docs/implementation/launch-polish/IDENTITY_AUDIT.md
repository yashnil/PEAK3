# IDENTITY_AUDIT — leaderboard duplication, public handle, contact/feedback

Phase 1, read-only. Worktree `wt/lp-identity` (from `feature/arena-launch-polish`
@ `95a41cb`). No writes were made to any database. `docs/implementation/
rtt-overhaul/SCORE_RECONCILIATION.md` §5 was read first; every item in its
"already correct — do not regress it" table was re-verified, not re-litigated,
and nothing below proposes weakening auth, ownership, or RLS.

Evidence gathering used two sources only: `GET` calls against
`https://peak3-staging.up.railway.app` (never POST/DELETE), and static
reading of this repo. No database credentials were available in this
worktree, so **owner_sub could not be read directly** — that gap is called
out explicitly in §1.4 and is the one fact a DB-privileged reviewer must
confirm before any cleanup executes.

---

## 1. TASK A — Leaderboard duplication

### 1.1 Full current state of the board (before-count)

```
GET /api/v1/perfect-season/leaderboard?limit=100   (no mode/no_respin/daily filter)
→ 32 rows total, next_cursor: null (i.e. this IS the entire public board)
```

Paginating with `next_cursor` confirms 32 is the complete set — there is no
hidden page 2, and there is no cursor-repeat bug (each `id` appears exactly
once across the full pull).

**Every one of the 32 rows**: `mode="apex_1y"`, `display_name="test"`,
`data_version="courtbuilder_team_year.experimental.v3"`,
`formula_version="peak3_official_weights_v1 (statistical_impact=0.38,
traditional_production=0.21, recognition=0.20, postseason=0.18,
team_achievement=0.03)"`, `simulation_version="perfect_season_simulator_v1"`.
No mode mixing, no formula/weights drift, no stale-version rows.

### 1.2 The 32 rows, enumerated

Sorted by `created_at`. `id`, `game_id`, and `owner_sub` are the columns the
brief asked for; the public API returns `id` but never `game_id` or
`owner_sub` (by design — see 1.4), so those two columns are marked
`(DB-only)` below and must be pulled from Postgres directly to close the loop.

| id | seed | wins-losses | lineup_score | respins (team, season) | created_at (UTC) |
|---|---|---|---|---|---|
| `09882bc9-f6a1-47c1-bc35-3660f2e68164` | 102 | 15-67 | 28.9 | (0,0) | 2026-08-01T17:29:47.257878+00:00 |
| `0de5eb2d-c38e-48bf-8927-840d5a85aef8` | 201 | 29-53 | 36.2 | (0,0) | 2026-08-01T17:30:13.650032+00:00 |
| `d0429b63-af10-439e-8eef-297d05253aba` | 202 | 28-54 | 34.4 | (0,0) | 2026-08-01T17:30:21.280512+00:00 |
| `1ac8f935-95e7-40c8-b818-7082aa0870de` | 203 | 20-62 | 31.0 | (0,0) | 2026-08-01T17:30:28.362393+00:00 |
| `484379fe-cf99-48cd-b704-ef7cdc43b894` | 301 | 27-55 | 34.4 | (0,0) | 2026-08-01T17:30:37.076549+00:00 |
| `75d83f78-cb92-4f17-b2b3-6a13f68c58d5` | 302 | 25-57 | 35.1 | (1,0) | 2026-08-01T17:30:44.804290+00:00 |
| `5fc5f8e5-5143-438d-90fa-229699151923` | 401 | 22-60 | 33.0 | (0,0) | 2026-08-01T17:30:53.260998+00:00 |
| `5c2adae7-2593-488e-a432-d2dcdc8aa41d` | 501 | 18-64 | 28.0 | (0,0) | 2026-08-01T17:31:01.859865+00:00 |
| `f682af81-b8cf-48be-9aa0-cd5575b19828` | 102 | 15-67 | 28.9 | (0,0) | 2026-08-01T17:32:45.396363+00:00 |
| `2a444ad4-0971-4d0b-a408-d344c1861ab1` | 201 | 29-53 | 36.2 | (0,0) | 2026-08-01T17:33:11.852916+00:00 |
| `700759ae-ccdc-4d04-a76b-f2b7c0cc7e91` | 202 | 28-54 | 34.4 | (0,0) | 2026-08-01T17:33:19.786571+00:00 |
| `e29871f3-32b5-4e3f-9f9d-1630b14c7503` | 203 | 20-62 | 31.0 | (0,0) | 2026-08-01T17:33:27.117803+00:00 |
| `b091b276-fe81-4e93-a263-209c48af324d` | 301 | 27-55 | 34.4 | (0,0) | 2026-08-01T17:33:35.746672+00:00 |
| `4a3fd925-20b6-4116-a0c3-44841f93b654` | 302 | 25-57 | 35.1 | (1,0) | 2026-08-01T17:33:43.349903+00:00 |
| `f9a31280-3881-427c-8f2c-23684ac2335a` | 401 | 22-60 | 33.0 | (0,0) | 2026-08-01T17:33:52.344808+00:00 |
| `1ef2e0e8-abe2-43ad-ad83-3a9f6f8fddca` | 501 | 18-64 | 28.0 | (0,0) | 2026-08-01T17:34:01.361804+00:00 |
| `ac6509db-7839-49f2-89af-d6d5743277b9` | 102 | 15-67 | 28.9 | (0,0) | 2026-08-01T17:35:10.327539+00:00 |
| `4c78357c-ad03-41dc-af6c-230782ca876d` | 201 | 29-53 | 36.2 | (0,0) | 2026-08-01T17:35:36.361503+00:00 |
| `d745d02c-0817-4b88-a94c-767ab60df095` | 202 | 28-54 | 34.4 | (0,0) | 2026-08-01T17:35:43.322606+00:00 |
| `916bcc82-8bc9-449b-8dfa-5a6f329b0497` | 203 | 20-62 | 31.0 | (0,0) | 2026-08-01T17:35:50.277453+00:00 |
| `42ab2510-5c88-4650-b4a1-60f8fb6aaef7` | 301 | 27-55 | 34.4 | (0,0) | 2026-08-01T17:35:58.728754+00:00 |
| `cc1f2548-3ec7-40ec-90ff-b46db810e9ea` | 302 | 25-57 | 35.1 | (1,0) | 2026-08-01T17:36:05.990714+00:00 |
| `b7e4d154-d669-4838-9e3f-51eae980d4b3` | 401 | 22-60 | 33.0 | (0,0) | 2026-08-01T17:36:14.520799+00:00 |
| `08458300-891d-4a11-bbe2-0e1ed686b5a7` | 501 | 18-64 | 28.0 | (0,0) | 2026-08-01T17:36:23.914795+00:00 |
| `545473af-49f7-4923-9752-21a945537bf9` | 102 | 15-67 | 28.9 | (0,0) | 2026-08-01T21:11:04.787877+00:00 |
| `b6cbaa35-5a39-42ce-802e-db9664a5ab99` | 201 | 29-53 | 36.2 | (0,0) | 2026-08-01T21:11:34.202257+00:00 |
| `100bc12b-6323-4fbb-85fe-469783987eee` | 202 | 28-54 | 34.4 | (0,0) | 2026-08-01T21:11:41.751331+00:00 |
| `b054c840-dddc-4f18-beb8-cd257d3434af` | 203 | 20-62 | 31.0 | (0,0) | 2026-08-01T21:11:48.915638+00:00 |
| `f4792849-2274-46cd-bfe0-324e60bc43d5` | 301 | 27-55 | 34.4 | (0,0) | 2026-08-01T21:11:57.730380+00:00 |
| `119dbf36-fcc1-4e37-aa11-b1f016038f65` | 302 | 25-57 | 35.1 | (1,0) | 2026-08-01T21:12:05.333633+00:00 |
| `3b98333e-3982-4abd-b1f5-cbccfbb99f74` | 401 | 22-60 | 33.0 | (0,0) | 2026-08-01T21:12:14.099760+00:00 |
| `737c0369-5c41-4950-b45f-3d25ae4656a6` | 501 | 18-64 | 28.0 | (0,0) | 2026-08-01T21:12:23.203907+00:00 |

Pattern: **exactly 8 distinct seeds** (102, 201, 202, 203, 301, 302, 401,
501), **each submitted exactly 4 times**, in **4 tight waves** on
2026-08-01: `17:29:47–17:31:01`, `17:32:45–17:34:01`, `17:35:10–17:36:23`,
`21:11:04–21:12:23` UTC. Within every wave, seeds appear in the identical
order: 102, then 201, 202, 203, then 301, then 302, then 401, then 501 —
never shuffled, never interleaved between waves.

### 1.3 Root cause — confirmed, not inferred

`apps/api/tests/test_perfect_season.py` hardcodes **exactly this seed set,
in exactly this order**, across its leaderboard-submitting tests:

| Line | Test | Seed(s) submitted to the leaderboard |
|---|---|---|
| `2190` | `test_authenticated_submit_succeeds_and_recomputes_from_server_state` | 102 |
| `2241` (loop) | `test_public_leaderboard_read_works_and_is_sorted` | 201, 202, 203 |
| `2261` | `test_no_respin_filter_excludes_runs_with_respins` (run A) | 301 |
| `2271` | `test_no_respin_filter_excludes_runs_with_respins` (run B, 1 team respin) | 302 |
| `2303` | (next test) | 401 |
| `2317` | (next test) | 501 |

That is the complete, in-file-order list of every seed the test module
submits to `POST /perfect-season/games/{id}/submit` — it matches all 8
observed seeds, in the observed order, with zero extras and zero omissions.
(Seeds 101, 103, 104 also appear in the file but their tests assert 401/403
— unauthenticated / wrong-owner / anonymous rejection — so they never reach
the leaderboard table, and indeed never appear in the staging data.)

The `run B` respin case (`301`→0 respins, `302`→1 team respin) is exactly
why seed 302 is the only one of the 8 with `respins=(1,0)` — matching the
staging rows precisely.

`display_name="test"` on every row is explained the same way. `_mint_test_jwt`
(`apps/api/tests/test_perfect_season.py:2112`) defaults
`email: str = "test@example.com"`, and none of the leaderboard tests override
it. `SCORE_RECONCILIATION.md` gap #4 records that the submit route's
display-name fallback **used to be** `auth.email.split("@")[0]` — which for
every one of these test JWTs evaluates to literally `"test"`. This worktree's
current code (`perfect_season.py:613`) already carries the fix — the
fallback is now `profile.display_name or f"Player-{auth.sub[-6:]}"` — but
that only proves the fix exists in this branch's source; it says nothing
about which build was deployed to Railway on 2026-08-01. The row data itself
is the proof of what actually ran that day, and it is bit-for-bit consistent
with the **old**, pre-fix fallback.

**Conclusion: this is the API's own test suite (or its exact submit-flow
logic), executed four separate times against the STAGING Postgres database**
— almost certainly by running `pytest apps/api/tests/test_perfect_season.py`
(or the subset covering these tests) locally with
`PEAK3_TEST_REPOSITORY_MODE=postgres` and a `PEAK3_DATABASE_URL` /
`PEAK3_TEST_DATABASE_URL` that resolved to the staging project's connection
string, rather than an isolated test project. This is not a wild guess:

- `apps/api/tests/conftest.py:35-66` shows the mode switch (`memory` default;
  `postgres` requires the operator to supply a URL) and shows the ONE guard
  that exists — it pops and refuses an inherited `PEAK3_DATABASE_URL` **only
  when the mode is `memory`**. It never verifies that a `postgres`-mode URL
  actually points at an isolated project — that is convention
  (`scripts/ci/api-integration-tests.sh:3`: "Requires an isolated test
  project — never a shared or production one"), not an enforced check.
- `docs/implementation/STAGING_DEPLOYMENT.md` §3 confirms staging has exactly
  one Postgres project, addressed by `PEAK3_DATABASE_URL`, with no separate
  test project documented for it.
- `SCORE_RECONCILIATION.md` §5 itself records the lead directly curling
  `peak3-staging.up.railway.app` on **2026-08-01** — the same day, evidence
  of active hands-on staging work in progress, i.e. exactly the kind of
  session where a local `.env` might already have `PEAK3_DATABASE_URL`
  pointed at staging for other manual verification.
- CI (`.github/workflows/ci.yml:360-364`) uses its own
  `PEAK3_TEST_SUPABASE_URL` / `PEAK3_TEST_DATABASE_URL` secrets, which by
  design should be a separate project — but nothing in the repo proves those
  secret *values* are actually distinct from the staging URL. That can only
  be confirmed or ruled out by someone with access to the GitHub Actions
  secrets and the Railway `PEAK3_DATABASE_URL` value, which this worktree
  does not have. **A local `pytest` run against a misconfigured local `.env`
  is the simpler, better-evidenced explanation** (matches the 4 discrete,
  minutes-apart, business-hours-then-evening timing much better than a CI
  cron would), but CI cannot be ruled out with certainty from this vantage
  point.

### 1.4 Hypotheses explicitly ruled out (with evidence)

- **Can one completed game submit repeatedly?** No. `game_id TEXT NOT NULL
  UNIQUE` (`supabase/migrations/20260724150000_perfect_season_leaderboard.sql:23`)
  plus the route-level idempotent check-then-insert
  (`perfect_season.py:570-574`, re-checked again on
  `DuplicateRunSubmission` at `:637-641`, returning the **original** record
  rather than erroring or duplicating). The 32 rows have 32 distinct `id`s
  and 32 distinct `created_at` values, so this is not what happened here —
  each of the 32 rows is a genuinely distinct completed game, not a resubmit
  of one game. The previous pass's idempotency claim **is verified true**,
  not merely trusted.
- **Do save / claim / refresh / retry create duplicate rows?** No evidence of
  this in the observed data. `save_run` writes to `perfect_season_run_cards`/
  saved-run tables, a wholly separate store from the leaderboard (see
  `perfect_season.py`'s own module comment at `:759-772`); it cannot produce
  a `perfect_season_runs` row. Ownership-claim flow (`ownership_claims`
  table) is unrelated to leaderboard submission. No route reachable from a
  page refresh resubmits an already-submitted `game_id` — see the UNIQUE
  constraint above.
- **Are multiple ruleset boards mixed?** No — `mode`, `data_version`,
  `formula_version`, `simulation_version` are identical across all 32 rows.
- **Is the UI duplicating rows client-side?** No — 32 unique server-side
  `id`s were returned by a single unfiltered `GET`; nothing about the
  duplication pattern (four *time-separated* waves, hours apart) is
  explicable by client-side rendering.
- **Does the pagination cursor repeat records?** No — the full unfiltered
  pull terminated with `next_cursor: null` after exactly 32 rows and zero
  repeats.
- **Did automated benchmark users use the public submission route?** Yes —
  see §1.3. This is the confirmed mechanism.

### 1.5 What could NOT be verified from this worktree

`owner_sub` is deliberately never exposed by `_run_to_public()`
(`perfect_season.py:518-537`) or by `PerfectSeasonRunPublic` — correctly, for
the same privacy reason the leaderboard shouldn't leak a raw Supabase
subject id to the public. That means the enumeration above cannot state
`owner_sub` values, and this audit had no database credentials with which to
query Postgres directly. **Before any cleanup executes**, whoever has
`PEAK3_DATABASE_URL` access should run one read-only query:

```sql
SELECT id, owner_sub, display_name, game_id, wins, created_at, data_version
FROM perfect_season_runs
WHERE id IN (<the 32 ids above>)
ORDER BY created_at;
```

and confirm every `owner_sub` corresponds to one of the ad-hoc test subs the
suite mints (`user-0`, `user-1`, `user-2`, `user-a`, `user-b`, `user-abc`,
or similar — see `_mint_test_jwt` call sites in §1.3), **not** a real
Supabase `auth.users` row reachable through the actual sign-in flow. That
single query is what turns this from "extremely strong circumstantial
evidence" into "certain."

### 1.6 Exact cleanup criteria (DO NOT EXECUTE — proposal only)

A row is a proven test artifact, eligible for deletion, **only if it
satisfies every one of these conditions**, checked against the live DB, not
just the fields visible over the public API:

1. `owner_sub` matches the pattern of a `_mint_test_jwt`-minted subject (the
   literal strings used in `test_perfect_season.py`, e.g. `user-0`, `user-1`,
   `user-2`, `user-a`, `user-b`, `user-abc`, `a-different-user`,
   `anon-user`) — **confirmed by direct DB query**, never inferred from
   `display_name` alone, per the brief's explicit instruction.
2. `game_id` is NOT resolvable to a real, currently-owned `court_lineups` row
   whose `owner_sub` maps to a live Supabase Auth account (cross-check
   against `profiles`/`auth.users`).
3. `seed ∈ {102, 201, 202, 203, 301, 302, 401, 501}` **and** `mode =
   'apex_1y'` **and** `data_version = 'courtbuilder_team_year.experimental.v3'`.
4. `created_at` falls inside one of the four narrow clusters in §1.2 (all on
   `2026-08-01`, each cluster under 2 minutes wide).
5. `display_name = 'test'`.

All five together, not `display_name` in isolation — a real human is free to
choose the handle "test" and condition 5 alone must never be sufficient
grounds for deletion. Given all 32 currently-visible rows already satisfy
conditions 3–5 from the public API alone, and the DB-only check (1–2) is
what a privileged reviewer still needs to run, my recommendation is: **once
1–2 are confirmed for all 32 ids, delete all 32 via `DELETE FROM
perfect_season_runs WHERE id IN (...)` (cascades to
`perfect_season_run_cards` via `ON DELETE CASCADE`) — not a broader filter,
not a `display_name = 'test'` match, an explicit `id IN (<these 32 uuids>)`
list.** A migration/script that filters on `display_name` would be unsafe:
nothing stops a real player from choosing that handle later.

**On "the real user completed only ~2 runs":** I could not identify which,
if any, of the 32 visible rows are the real user's. Every one of the 32
matches the automated-test fingerprint in §1.3 with no residual unexplained
rows. Since `GET /leaderboard` only returns `is_public = TRUE` rows, the
real user's ~2 runs are either (a) not on this board at all — never
submitted, or submitted with `is_public=false` — or (b) the person who made
that observation was looking at the same 32 test rows and reading repeated
`"test"` entries as if they were one real, repeatedly-playing account. I'd
recommend cross-checking the real user's own `owner_sub` against
`perfect_season_runs` directly (or via `GET /perfect-season/leaderboard/me`
once authenticated as them) rather than assuming any of the 32 rows above
are theirs.

### 1.7 The "No-respin runs only" filter — what removing it takes

Lives in three places, all straightforward to remove, no schema change
needed:

- **Frontend UI**: `apps/web/src/app/(main)/arena/court/leaderboard/page.tsx`
  — `noRespinOnly` state (`:42`), the checkbox
  (`:122-130`, `data-testid="leaderboard-no-respin-filter"`), and the
  `noRespin: noRespinOnly` param passed into `getLeaderboard()` (`:50`).
- **API client**: `apps/web/src/lib/perfect-season-api.ts:241,247` — the
  `noRespin` param and `no_respin=true` query-string mapping.
- **API route**: `apps/api/app/api/v1/perfect_season.py:681` — the
  `no_respin: bool = Query(False, ...)` parameter, threaded into
  `leaderboard_repo.get_leaderboard(mode, no_respin, limit, cursor, since)`.
  Filtering SQL lives in `leaderboard_postgres.py:131-132`
  (`if no_respin_only: conditions.append("team_respins_used = 0 AND
  season_respins_used = 0")`) and the equivalent in-memory filter in
  `leaderboard_memory.py:63`.

**Respin count is already displayable metadata and does not need new
plumbing**: `team_respins_used` / `season_respins_used` are already on the
wire in every `PerfectSeasonRunPublic` (`perfect_season.py:531-532`), and
the leaderboard page already renders a "N respins used" badge per row when
either is nonzero (`page.tsx:162-168`). So removing the filter is: delete
the checkbox + state + query param on the frontend; optionally deprecate
(not delete, for backward compatibility with any external caller) the
`no_respin` query param server-side by leaving it accepted but unused, or
remove it outright since it's an internal-only param with one caller. No
migration, no new column, no backend data change required.

---

## 2. TASK B — Public username / handle contract

### 2.1 What exists today

A working `profiles` table and API already exist — this is not starting from
zero:

- **Migration**: `supabase/migrations/20260630124500_identity.sql` —
  `profiles(id, auth_sub UNIQUE, handle UNIQUE, display_name, bio, region,
  avatar_key, is_public, history_public, joined_at, updated_at)`, plus
  `user_settings`, `anonymous_subjects`, `ownership_claims`.
- **DB-level uniqueness**: `CREATE UNIQUE INDEX profiles_handle_lower_idx ON
  profiles (lower(handle)) WHERE handle IS NOT NULL` (`:25-27`) — this
  already IS the case-insensitive-uniqueness mechanism the brief asks for.
  Reuse it; do not invent a second one.
- **Validation**: `apps/api/app/models/profile.py` — `HANDLE_RE =
  r"^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$"` (3–30 chars, alnum/underscore,
  must start/end alnum), a `RESERVED_HANDLES` frozenset (`admin`, `system`,
  `peak3`, `api`, `auth`, `me`, `settings`, `profile`, `history`, `arena`,
  `play`, `daily`, `rankings`, `about`, `methodology`, `support`, `help`,
  `null`, `undefined`), and a stable `ValueError` message on mismatch that
  FastAPI turns into a 422. Handle collision on `PUT /profiles/me` raises
  `HandleTakenError` → `409 handle_taken` (`profiles.py:66-67`).
- **Repository**: `apps/api/app/repositories/profile_protocols.py` (the
  `Protocol`) has both a `postgres_profile.py` implementation and an
  in-memory one; `dependencies.py:210-216` correctly selects Postgres
  whenever `request.app.state.db_pool` is set (i.e. on staging, this is
  durable, not a memory-mode stub).
- **No email anywhere**: `ProfileResponse` never includes email;
  `Profile` (the repo dataclass) has no email field.
- **The email-local-part fallback IS fixed in this branch's code.**
  `perfect_season.py:613`: `display_name = profile.display_name or
  f"Player-{auth.sub[-6:]}"`. The comment at `:604-612` documents exactly
  the change SCORE_RECONCILIATION.md gap #4 asked for and states the old
  behavior explicitly (`auth.email.split("@")[0]`). **Whether this fix is
  live on the deployed staging build is a separate question** — see §1.3:
  the staging leaderboard data itself is consistent with the OLD fallback
  having been what ran on 2026-08-01, which is either evidence the fix
  postdates that deploy, or is simply explained by all 32 rows being local
  test-suite writes that hit whatever code the developer had checked out
  locally, not necessarily what's deployed. Recommend the lead re-verify
  directly: submit one real, minimally-configured throwaway run against
  staging today and confirm the returned `display_name` is `Player-XXXXXX`
  and not an email-derived string, before calling gap #4 closed in
  production.

### 2.2 What's missing / worth flagging (design only, not implementing)

- **No RLS on `profiles`, `user_settings`, `anonymous_subjects`, or
  `ownership_claims`.** `20260630124500_identity.sql` never runs `ALTER
  TABLE ... ENABLE ROW LEVEL SECURITY` for any of these four tables — unlike
  every leaderboard/telemetry table added since, which all follow the
  documented "service-role writes, RLS as a second independent layer against
  a client holding the anon/authenticated key directly" pattern (see
  `20260724150000_perfect_season_leaderboard.sql:6-12` and
  `20260801120000_telemetry_events.sql`'s own RLS section). This is a real
  gap relative to the codebase's own established pattern, worth a follow-up
  migration.
- **No profanity/impersonation guard beyond the literal reserved-word set.**
  `RESERVED_HANDLES` blocks exact matches only (`admin`, `peak3`, etc.); it
  does not block near-miss impersonation (`_peak3_`, `peak3official`) or run
  a profanity filter. MVP-appropriate here likely means: block handles
  containing any reserved word as a substring (not just exact match) and add
  a small static profanity denylist, both cheap and false-positive-tolerant
  for a beta.
- **`is_public` defaults to `false` on `profiles`**
  (`identity.sql:19`) vs. `perfect_season_runs.is_public` defaulting to
  `TRUE` (`perfect_season_leaderboard.sql:36`). That asymmetry is actually
  the *correct* privacy posture (a profile is private-by-default; a
  leaderboard submission you explicitly complete and submit is
  public-by-default) but should be stated as an intentional design decision
  in any implementation contract, not left implicit.

### 2.3 Proposed public profile contract (design only)

Given the above, the "public profile contract" the brief asks for is mostly
**already implemented** — `profiles` already carries `user_id` (`auth_sub`),
`public_handle` (`handle`), a normalized (lowercased, uniquely-indexed)
handle, `display_name`, a visibility preference (`is_public`,
`history_public`), and `created_at`/`updated_at` (`joined_at`/`updated_at`).
The design work remaining is narrower than "build this from scratch":

| Requirement | Status |
|---|---|
| `user_id` | done (`auth_sub`) |
| `public_handle` | done (`handle`) |
| `normalized_handle` (case-insensitive uniqueness) | done, via the functional unique index on `lower(handle)` — no separate stored column needed |
| optional display name | done (`display_name`, nullable) |
| visibility preference | done (`is_public`, `history_public`) |
| `created_at` / `updated_at` | done (`joined_at`, `updated_at`) |
| unique case-insensitively | done |
| 3–20 chars | **partial** — current regex allows 3–30; brief asks 3–20. Tightening is a one-line regex change plus a `Field(max_length=20)` on the request model; no migration needed (column is unconstrained `TEXT`) |
| letters/numbers/underscores | done |
| reserved-word protection | done, exact-match only (§2.2 gap) |
| profanity/impersonation guard | **missing** (§2.2) |
| stable validation errors | done (pydantic `ValueError` → 422 with a fixed message; `HandleTakenError` → 409 `handle_taken`) |
| no email published | done |
| no auto-published Google name | **needs the staging re-verification in §2.1** before calling it done in production |
| RLS: users update only their own | **missing at the DB layer** (§2.2) — currently enforced only in application code via `WHERE auth_sub = $1` in the Postgres repo (not re-read here in detail, but there is no RLS backstop) |
| RLS: public reads expose only intended public fields | **missing at the DB layer** — same gap; `ProfileResponse` already limits what the API *returns*, but a direct PostgREST caller with an anon/authenticated key would not be bound by that if these tables were ever exposed that way |
| emails/provider metadata/private names stay private | done at the API layer (no email field exists), not yet backstopped by RLS |

**Recommended next migration** (not written here, per phase-1 scope): add
`ALTER TABLE profiles ENABLE ROW LEVEL SECURITY` with an owner-only
`UPDATE`/`SELECT-own` policy plus a public `SELECT` policy restricted to
`is_public = TRUE` rows and a **column-limited view** (not the raw table) for
the public read path, since `profiles` has no per-column RLS in Postgres —
matching the `perfect_season_runs_public_read` pattern already established.

---

## 3. TASK C — Contact / feedback

### 3.1 Confirmed: nothing exists today

- No contact/feedback **table** anywhere in `supabase/migrations/`.
- No contact/feedback **API route** anywhere under `apps/api/app/api/v1/`.
- `apps/web/src/app/(main)/contact/page.tsx` is a **static page with no
  backend at all** — a `mailto:` link to a literal placeholder address
  (`TODO-set-before-launch@example.invalid`, using the reserved `.invalid`
  TLD specifically so it can never accidentally reach anyone), with an
  explicit in-file comment: "OPERATOR ACTION REQUIRED... No contact address
  exists anywhere in this repository." This is an honest placeholder, not a
  broken feature — but it means there is genuinely zero server-side surface
  to design against; a contact/feedback endpoint would be new work end to
  end.

### 3.2 A directly reusable precedent already in this codebase

`apps/api/app/api/v1/telemetry.py` (`POST /api/v1/telemetry/events`) is
almost exactly the shape Task C asks for and should be the template, not a
fresh design:

- Off by default behind a settings flag (`PEAK3_TELEMETRY_ENABLED`),
  answering a stable 403 and writing nothing when disabled.
- Unauthenticated-friendly (`OptionalAuth` + `resolve_owner_sub`) but rate
  limited via the existing in-process limiter
  (`app/core/rate_limit.py` — `RateLimiter`/`RateLimitRule`/`client_key()`,
  keyed on IP + the **verified** anon-subject cookie, explicitly never on
  the Authorization header so an unauthenticated flood can't be made cheaper
  to block than an authenticated one).
- Table is append-only, no free-text/PII columns by construction
  (`telemetry_events`, `20260801120000_telemetry_events.sql`), with RLS that
  denies **every** verb to a PostgREST anon/authenticated key ("the correct
  answer to that client is nothing at all") because only the service-role
  connection ever touches it. No GET route reads it back over HTTP.

### 3.3 Proposed contact/feedback storage + security contract (design only)

- **Table**: `contact_submissions` — `id UUID PK`, `created_at
  TIMESTAMPTZ`, `subject_kind TEXT CHECK IN ('anon','user')` (mirroring
  telemetry, not raw identity), `subject_hash TEXT` (HMAC-SHA256 of
  owner_sub with `PEAK3_SIGNING_SECRET`, same construction as
  `telemetry.py:hash_subject`, so a leaked extract isn't directly
  identifying), `category TEXT CHECK IN (...)` (bug / accessibility / data
  request / security / model / other — matching the categories the current
  static contact page already describes), `message TEXT CHECK
  (char_length(message) <= N)` (cap, e.g. 4000 chars), `contact_email TEXT`
  (optional, user-supplied reply-to, validated format, capped length — this
  is the one legitimately-collected email-shaped field, opt-in and distinct
  from the account's auth email), `request_id UUID` (client-supplied or
  server-minted correlation id returned to the submitter), `status TEXT
  DEFAULT 'open'` (admin-only field for triage).
- **No public read, ever.** RLS denies all PostgREST verbs (same "nothing at
  all" policy as `telemetry_events`); the only read path is a
  server-side/admin script, analogous to `scripts/telemetry_report.py`.
- **Authenticated create**: a signed-in user's submission attaches their
  hashed `owner_sub` and skips the honeypot/captcha-equivalent (a real
  session is already a strong anti-spam signal).
- **Signed-out submissions**: allowed, but only through the rate-limited
  server endpoint — never a direct client-side Supabase insert with the
  public/anon key (this table should not be in the client's Supabase
  schema exposure at all, matching how `perfect_season_runs` writes only go
  through the API's service-role connection). Apply a
  `RateLimitRule` (e.g. 3 submissions per 10 minutes per `client_key(...,
  "contact")`) plus a honeypot field (a hidden input real users never fill;
  silently 200-and-drop if populated, so a bot doesn't learn it was caught).
- **Bounded on every axis a body can grow along**, same discipline as
  telemetry: message length, category is a closed enum, no attachments in
  v1, Content-Length cap.
- **Sanitized admin output**: whatever eventually renders these
  (dashboard, email digest, or manual `psql`) must escape/strip `message`
  before display — it is arbitrary user text and the one field in this
  whole audit that is genuinely free-form input from an unauthenticated
  surface.
- **Request IDs and timestamps**: `request_id` returned in the response body
  so a user reporting "it didn't work" can be correlated to a row without
  exposing the row itself; `created_at` for triage ordering.

None of this is implemented — it's a contract proposal only, per phase-1
scope.

---

## Summary for the lead

1. **Leaderboard duplication root cause is confirmed, not speculative**: all
   32 visible rows are `apps/api/tests/test_perfect_season.py`'s own
   leaderboard-submitting tests, run 4 separate times against the staging
   Postgres DB — seed set, seed order, respin pattern, and `display_name`
   are all bit-for-bit explained by that file. Most likely mechanism: a
   local `pytest` run in `postgres` repository mode with a `.env` pointed at
   the staging `PEAK3_DATABASE_URL` rather than an isolated test project;
   CI misconfiguration cannot be fully ruled out without secrets access.
2. **Idempotency (`game_id UNIQUE`) is genuinely correct** — independently
   re-verified against the migration and the route, not just re-asserted.
3. **The email-local-part fallback is fixed in this worktree's source**
   (`perfect_season.py:613`), but whether that fix is live on the currently
   *deployed* staging build is unverified — recommend a real throwaway
   submission against staging to confirm before closing gap #4.
4. **Exact cleanup criteria are in §1.6** — they require one DB-only
   confirmation step (`owner_sub` values, §1.5) this worktree could not
   perform. No cleanup was executed.
5. **Migration order I'd propose**, once the DB check in §1.5 confirms all
   32 rows are test artifacts:
   1. `DELETE FROM perfect_season_runs WHERE id IN (<32 confirmed ids>)`
      (cascades to `perfect_season_run_cards`) — a one-off cleanup, not a
      migration file (it targets specific rows, not schema).
   2. Ship the already-drafted display-name fix to staging if not already
      deployed, and re-verify with a real submission.
   3. Remove the "No-respin runs only" filter (§1.7) — frontend-only plus a
      small API param removal, no schema change.
   4. New migration: RLS on `profiles`/`user_settings`
      (§2.2/§2.3) — additive, no data change, safe to ship independently.
   5. New migration + route: `contact_submissions` (§3.3) — wholly new
      surface, ship last since nothing depends on it.
6. Handle/profile groundwork (Task B) is **further along than the brief
   assumed** — most of the contract already exists and is durable on
   staging (Postgres-backed, not memory-mode). The real gaps are RLS on
   `profiles` and a profanity/impersonation guard beyond exact reserved-word
   matching, both additive.
