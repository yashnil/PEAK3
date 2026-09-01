# PEAK3 Arena — Public Platform Readiness Audit

Status: **Batch P1 (auth/handle/profile) and Batch P2 (database/RLS contract
+ saved runs) complete.** Batches P3–P5 (public results/leaderboards,
matchmaking/ranked-settlement/realtime, production config) are pending and
will extend this document rather than replace it. Batch P2's findings are in
`§P2` below; `SCHEMA_MATRIX.md` carries the full per-table detail this
document only summarizes.

Scope of this pass: `apps/web/src/lib/auth*.ts`, `apps/web/src/lib/supabase/`,
`apps/web/src/components/auth/**`, `apps/web/src/components/profile/**`,
`apps/api/app/api/v1/{auth,profiles}.py`, `apps/api/app/core/{auth,dependencies}.py`,
`apps/api/app/repositories/{memory_profile,postgres_profile,profile_protocols}.py`,
`supabase/migrations/*` touching `profiles`/`user_settings`, and the relevant
test suites.

---

## 1. AUTH — how a session comes to exist

**Browser client** — `apps/web/src/lib/supabase/client.ts`. `createBrowserClient`
from `@supabase/ssr` (not plain `@supabase/supabase-js`), so the session and the
PKCE code verifier live in **cookies** on the web origin, not `localStorage`.
Lazily memoized singleton; returns `null` when `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent (anonymous-only mode — every caller
already branches on the null).

**Server client** — `apps/web/src/lib/supabase/server.ts` (not read line-by-line
this pass, referenced by callback route and any Server Component that needs the
session) and **middleware** — `apps/web/src/middleware.ts` → `lib/supabase/middleware.ts`
`updateSession()`. Middleware runs on every non-asset route and refreshes the
session cookie so it does not silently expire between page loads. Correctly
located at `src/middleware.ts` (Next resolves middleware relative to the `app/`
parent, not the package root).

**Google OAuth / magic link / email+password** — all three live in
`apps/web/src/lib/auth.ts`. All three build `redirectTo`/`emailRedirectTo` via
`authCallbackUrl()`, which runs the caller-supplied `next` param through
`safeNext()` **before** handing it to Supabase, so an open-redirect payload
cannot ride through the OAuth round trip and come back looking
provider-vouched-for. Google OAuth is **not enabled on the linked hosted
Supabase project** as of this audit (`auth.ts`'s own docstring: "reports
`external: ["email"]`") — calling `signInWithGoogle` today surfaces Supabase's
"Unsupported provider" error verbatim rather than failing silently. This is a
manual-dashboard item, tracked in `PRODUCTION_CHECKLIST.md`.

**Callback handling** — `apps/web/src/app/auth/callback/route.ts` (Route
Handler, not a client component — this pass did not re-read it in full, no
behavior changed here) exchanges the PKCE code for a session server-side, then
redirects to `next`. `apps/web/src/app/auth/complete/page.tsx` and
`apps/web/src/app/auth/auth-code-error/page.tsx` are the two terminal states.

**Session restoration on the client** — `getSession()` / `getAccessToken()` in
`auth.ts` call `client.auth.getSession()` (SDK reads the cookie-backed session).
`getAccessToken()` additionally memoizes the resolved JWT until ~30s before its
`exp`, invalidated on `onAuthStateChange` — a real perf fix (P3-H), not a second
source of truth: it only ever caches what the SDK most recently reported.

**Auth context** — `apps/web/src/lib/auth-context.tsx`. `AuthProvider` exposes
`{ user, loading, supabaseEnabled, signOut }`. `signOut()` clears the SDK
session, then calls `router.refresh()` — necessary because Server Components
render from the cookie session and nothing else forces them to notice it is
gone.

**Server-side verification** — `apps/api/app/core/auth.py`. The API **never
trusts a client-submitted user ID**, only the verified `sub` claim of a Bearer
JWT. Two verification regimes, selected per-token by its `alg` header:
asymmetric (ES256/RS256/EdDSA) via JWKS (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
cached, `aud`/`iss` checked) — the current real Supabase default — and
symmetric HS256 via `PEAK3_SUPABASE_JWT_SECRET` — legacy projects and the local
`supabase start` stack. `AuthSubject.sub` is what every downstream repository
call keys on.

**E2E test-only session backdoor** — `auth.ts`'s `setE2ETestSession` /
`_testSession` machinery, gated on `process.env.NODE_ENV !== "production"` on
**both** the write and read paths (a prior pass found only the writer gated,
which would have made a written `sessionStorage` key an identity primitive in
production). Dead-code-eliminated from production builds; do not remove, ~40
Playwright assertions depend on it.

**Finding (informational, not a defect):** the local dev `.env` for `apps/api`
has `PEAK3_SUPABASE_URL`/`PEAK3_SUPABASE_ANON_KEY` pointed at the **real hosted**
Supabase project (`https://zwgzxlqzhpwwgbjmrpow.supabase.co`) — not the local
`supabase start` Docker stack — and `apps/web/.env.local` agrees. Auth in local
dev is therefore real hosted Supabase Auth, not a local fixture. This is not
itself wrong, but it means the environment's Auth and Database were, before this
pass, pointed at two different places entirely (hosted Auth, no database) — see
§2 and `PRODUCTION_CHECKLIST.md`.

---

## 2. PROFILE / HANDLE — the reported bug

### Root cause (confirmed by live reproduction, not inferred)

**There is no defect in the write, read, or uniqueness code.** The bug is a
missing durable-database configuration in the environment that was used to
observe it. Full reproduction below.

Every write/read of a profile is keyed on `auth_sub` — the JWT's verified `sub`
claim, stable for a given Supabase identity across every future session
(`apps/api/app/api/v1/profiles.py::get_my_profile` /
`update_my_profile` → `ProfileRepoDep`). Which repository implementation
answers that call is decided once, per request, in
`apps/api/app/core/dependencies.py::get_profile_repo`:

```
pool = request.app.state.db_pool
pool is not None  → PostgresProfileRepository(pool)   (durable)
pool is None       → MemoryProfileRepository singleton (process-local dict)
```

`app.state.db_pool` is set at startup in `apps/api/app/main.py`'s `lifespan()`
**only if `PEAK3_DATABASE_URL` is set**. If it is unset:
- `PEAK3_DEBUG=True` (the default): falls back to `MemoryProfileRepository`
  with a `logger.warning` — a real warning, but one line in a startup log, not
  visible anywhere in the product or the API's own responses.
- `PEAK3_DEBUG=False`: refuses to start at all
  (`app/core/repository_registry.py::assert_production_ready`), for exactly
  this reason.

`apps/api/.env` in this repository, before this pass, set real hosted
`PEAK3_SUPABASE_URL`/`PEAK3_SUPABASE_ANON_KEY` (so sign-in is real) but had
**no `PEAK3_DATABASE_URL` at all**, and `PEAK3_DEBUG=true`. Every durable
domain — not just `profile` — was silently running on the in-memory fallback.
`MemoryProfileRepository` (`apps/api/app/repositories/memory_profile.py`) is a
plain `dict` on a module-level singleton object: correct and thread-safe
*within one running process*, and empty again the instant that process
restarts (dev auto-reload, a manual restart, a redeploy, a crash).

### Live reproduction (real login flow, not a unit test)

Performed against a real Supabase Auth account (signed up via the local
`supabase start` stack's GoTrue REST API — email confirmation disabled
locally, so this yields a genuinely provider-issued, ES256-signed JWT
identical in shape to what a browser sign-in produces) and the actual FastAPI
process, restarted between "sessions":

| Step | Repository mode | Result |
|---|---|---|
| Session A: `PUT /api/v1/profiles/me {"handle":"repro_tester_1"}` | memory (no `PEAK3_DATABASE_URL`) | `200`, handle set, profile `id=5b7b9f61…` |
| Session A: `GET /api/v1/profiles/me` (same process) | memory | handle present — looks correct |
| **API process killed and restarted** (same JWT, same `sub`) | memory | — |
| Session B: `GET /api/v1/profiles/me` | memory | **`handle: null`, profile `id=d8ac04e9…` (new row)** — bug reproduced |

Same experiment with `PEAK3_DATABASE_URL` pointed at a real Postgres (the local
Supabase stack's database, fully migrated — `supabase migration list` reports
local and remote in lockstep):

| Step | Repository mode | Result |
|---|---|---|
| Session A: `PUT /api/v1/profiles/me {"handle":"repro_tester_pg"}` | postgres | `200`, profile `id=10d458a2…` |
| **API process killed and restarted** | postgres | — |
| Session B: `GET /api/v1/profiles/me` | postgres | **same `id=10d458a2…`, `handle: "repro_tester_pg"`** — persisted correctly |

Case-insensitive uniqueness was checked in the same run: a second real account
attempting `PUT {"handle":"Repro_Tester_PG"}` (a case variant of the
already-claimed `repro_tester_pg`) against the Postgres-backed repository
received `409 {"detail":"handle_taken"}`, confirming
`profiles_normalized_handle_unique_idx` (generated `lower(handle)` column,
`supabase/migrations/20260803100000_profile_handle_contract.sql`) does what the
canonical invariant requires.

**Conclusion:** the write/read/uniqueness pipeline is already correct and
already satisfies the canonical invariant in this task's brief. The fix is
configuration (make `PEAK3_DATABASE_URL` durable, and make its absence harder
to mistake for "everything is fine"), not application code.

### Fix applied this batch

1. **Local dev `apps/api/.env`** (gitignored, never committed) now sets
   `PEAK3_DATABASE_URL` to the local Supabase stack's Postgres connection
   string, so local testing of "does my handle survive a restart" reflects the
   real answer instead of the memory-fallback answer. Also filled in the
   `PEAK3_TEST_*` variables from the same local stack so the Postgres half of
   the conformance/integration suites (previously "not configured" / skipped)
   runs for real locally.
2. **`GET /health/readiness`** (`apps/api/app/api/v1/health.py`) now reports
   `"repository_mode": "postgres" | "memory"` — the same signal
   `repository_registry.py` already computed and logged once at startup, now
   checkable without reading server logs. `assert_production_ready` already
   refuses to boot a `DEBUG=False` deploy in memory mode; this field covers the
   `DEBUG=True` case that guard intentionally allows, which is exactly the
   state that produced the reported bug.
3. **Regression test** —
   `apps/api/tests/test_repository_conformance.py::test_postgres_profile_survives_a_fresh_repository_instance`.
   Constructs two independent `PostgresProfileRepository` objects sharing one
   pool (modeling "a new server process picked the pool back up after a
   restart") and asserts the second sees the first's write. This is the exact
   shape of test `MemoryProfileRepository` fails by construction — that
   contrast is the bug.
4. **Test** — `apps/api/tests/test_health.py::test_health_readiness_reports_repository_mode`.

No changes were made to `profiles.py`, `profile.py` (validation), 
`postgres_profile.py`, `memory_profile.py`, or any RLS/migration file — all
were verified correct by the reproduction above.

### RLS on `profiles` / `user_settings` (already in place, verified by reading, not re-derived)

- `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY` — `20260630124900_rls.sql`.
- `profiles_public_read`: `SELECT` allowed where `is_public = true`.
- `profiles_owner_write` (renamed from `profiles_owner_all` in
  `20260801100000_rls_gaps.sql` to add an explicit `WITH CHECK`): `FOR ALL
  USING (auth_sub = auth.uid()::text) WITH CHECK (auth_sub = auth.uid()::text)`.
- `user_settings_owner_write`: same shape, scoped through `profiles.auth_sub`.
- Column-level privileges (`20260803120000_profile_column_privileges.sql`):
  `SELECT` on `profiles` for `anon`/`authenticated` is revoked and re-granted
  only on a named-column list that excludes `auth_sub` — closes a read of the
  DB-internal Supabase `auth.uid()` correlate through the public-read policy.
- `TRUNCATE`/`TRIGGER` revoked from `anon`/`authenticated` on `profiles`,
  `user_settings`, `anonymous_subjects`, `ownership_claims`
  (`20260803140000_revoke_truncate_trigger_identity_tables.sql`).
- **Note for Phase 13 (not re-verified this batch):** `apps/api`'s own
  Postgres connection (`asyncpg`, `DATABASE_URL`) most likely connects as a
  role that bypasses RLS entirely (table owner / a role without `FORCE ROW
  LEVEL SECURITY`) — RLS here is defense-in-depth against **direct**
  PostgREST/client access to the database, not the mechanism that scopes the
  FastAPI API's own queries (that scoping is `auth_sub = auth.sub` applied
  explicitly in `postgres_profile.py`, verified correct above). Confirming
  which role the API pool actually authenticates as is Phase 4/13 work.

---

## 3. Handle-onboarding UI (`HandleOnboardingPrompt.tsx`) — verified correct, unchanged

- Fetches the real profile (`fetchProfile`) before ever deciding to show the
  prompt; a profile **fetch failing** fails closed to `hidden` (never
  misinterpreted as "handle missing" — the phase model already distinguishes
  `checking` from `hidden`/`prompting`).
- Anonymous sessions never see it (`user.isAnonymous` check) — handles are a
  real-account concept.
- Session-scoped dismissal only (`sessionStorage`, not `localStorage`) — a
  closed tab and a later sign-in asks again, which is correct per the launch
  contract.
- Route denylist (`isLiveMatchRoute`) keeps it off every live-decision board —
  three-man-weave, twenty-dollar, 82-0 roll/chooser/placement, Peak Duel
  question, Daily Grid board.

This component was **not** the source of the reported bug — it faithfully
reports what the server says. With the server now durable (per-environment,
once `PEAK3_DATABASE_URL` is actually configured there), its behavior is
already correct with no code change.

---

## 4. Pending for later batches (explicitly out of scope for P1)

- Saved runs beyond `profiles`/`user_settings` (CourtBuilder, RTT, Daily Grid,
  Peak Draft, H2H, Three-Man Weave, Twenty-Dollar Showdown, Peak Duel history) —
  Batch P2.
- Public result/share pages, public leaderboards — Batch P3.
- Matchmaking, ranked settlement, H2H/challenges, Realtime — Batch P4.
- Full production environment/config matrix and manual dashboard checklist —
  Batch P5 (a first, partial finding is already in `PRODUCTION_CHECKLIST.md`
  because it fell directly out of this batch's root-cause work).

---

# §P2 — Database/RLS contract + saved runs

## 1. Repository-mode audit — is one global `repository_mode` flag truthful?

**Yes, provably.** Every `get_*_repo` function across the entire API —
traced from `core/dependencies.py` (21 domains) plus the two wired inline in
their own route files, `telemetry.py` and `contact.py` (both under the exact
same `request.app.state.db_pool is not None` check, by their own comments
"Same single-flag switch every other domain uses") — resolves off the
**same single flag**, set once at process startup in `main.py`'s `lifespan()`.
There is exactly one connection pool for the whole process; no domain can
diverge from any other. `repository_registry.py::log_repository_registry`
already asserts this is true at startup (logs an error if it ever isn't,
which cannot currently happen) and `assert_production_ready` refuses to boot
a `DEBUG=False` deploy with any domain on memory. `REPOSITORY_DOMAINS` now
lists 24 domains (was 22 before this batch — `telemetry` and `contact` added
for completeness; they were durable and durability-checked-by-construction
already, just absent from the registry's own enumeration).

**Conclusion: the P1 `repository_mode: "postgres" | "memory"` field on
`GET /health/readiness` remains fully truthful and does NOT need to become a
per-domain map.** A per-domain `{"profiles": "postgres", "runs": "postgres", ...}`
shape would imply a possibility (independent per-domain fallback) that this
architecture does not have — it would be manufactured detail, not more truth.

## 2. Saved-run semantics matrix (all modes)

| Mode | Active state persists? | Completed result persists? | History exists? | Cross-restart? | Cross-session? | Cross-device? | Public share? | Source of truth |
|---|---|---|---|---|---|---|---|---|
| Peak Draft — in-progress game | Yes | — | — | **Yes — live-verified** (see §3) | Yes | Yes | No | `games` (Postgres) |
| Peak Draft — completed result | — | Yes | Yes (`/history`) | Yes | Yes | Yes | Not found this batch (challenge share links are a separate mechanism) | `result_snapshots` |
| Peak Draft — daily gate | — | — | — | Yes (real `UNIQUE` constraint) | Yes | Yes | — | `daily_completions` |
| CourtBuilder/82-0 — in-progress lineup | Yes | — | — | **Yes — live-verified**: created a real game via the running API, killed and restarted the process, `GET` returned the identical state | Yes | Yes | No | `games` (`board_type="perfect_season"`) |
| CourtBuilder/82-0 — leaderboard submission | — | Yes, immutable | Yes | Yes | Yes | Yes | **Yes**, `is_public DEFAULT TRUE`, toggleable | `perfect_season_runs` |
| CourtBuilder/82-0 — saved run/personal history | — | Yes | Yes ("Save run" UI copy matches) | Yes | Yes | Yes | No (private by design) | `perfect_season_saved_runs` |
| Ranked — queue entry | Yes | — | — | Yes | Yes | Yes | No | `ranked_queue_entries` |
| Ranked — match/settlement | Yes → immutable on settle | Yes | Yes | Yes | Yes | Yes | Rating is public if `RANKED_PUBLIC_LEADERBOARD_ENABLED` | `ranked_matches`/`ranked_match_settlements`/`rating_ledger_entries` |
| H2H — challenge/match | Yes | Yes | Yes | Yes | Yes | Yes | Invite link (`/c/[token]`) is spoiler-safe by construction | `head_to_head_matches`/`head_to_head_participants` |
| Arena (Three-Man Weave / Twenty-Dollar) — match | Yes, transactionally serialized | Yes | Yes | Yes | Yes | Yes | No dedicated share page found | `arena_matches` + related |
| Arena — rating | N/A | Yes | Yes | Yes | Yes | Yes | Yes, public leaderboard row | `arena_ratings`/`arena_rating_history` |
| Peak Duel Daily — attempt | N/A (single-shot) | Yes | Yes, merges local+server | Yes | Yes | Yes (once identity recognized) | No | `peak_duel_daily_results` (+ local browser cache as a UI-only fallback, never the source of truth) |
| Progression (XP/level/streaks/achievements/records) | Streaks are live state; rest is append-only history | Yes | Yes | Yes | Yes | Yes | Public-profile projection exists in the schema (`_public` policies); no consuming public page found yet (Batch P3 concern) | `progression_events`/`user_progress`/`personal_records`/`achievement_awards`/`streak_states` |
| RTT — active run/resume | Yes, every action rewrites `snapshot` | N/A | Backend fully supports it (`list_runs_for_owner`); **no route or UI ever calls it** — GAP, see below | Yes | Yes for real accounts; **no for anonymous** (httponly cookie is per-browser) | No for anonymous; yes for real accounts | Yes — `/challenge` mints a spoiler-safe seed-only token (not the run itself) | `run_the_table_runs` |
| RTT — completed/abandoned run | N/A | Yes, row preserved with terminal status | Same gap as above — durable, not browsable | Yes | Same split as above | Same split as above | Same | `run_the_table_runs` |
| Daily Grid — active board/clock | Clock only (`daily_grid_attempts`); board fill state is client-only by design (Phase 11A: local progress explicitly not cheat-proof) | N/A | Local archive only | Clock: yes. Board fill: no | Clock: yes if same owner_sub | No | No | `daily_grid_attempts` + browser localStorage |
| Daily Grid — official result (signed-in) | N/A | Yes, immutable, server-revalidated | Backend route exists (`GET /daily-grid/results`); **frontend never calls it** — GAP, see below | Yes | Yes (requires real account) | **Yes** — the one genuinely cross-device Daily Grid surface | No | `daily_grid_results` |
| Daily Grid — official result (anonymous) | N/A | **No** — official save requires a real account | Local archive only, explicitly labeled local-only in the UI | No | No | No | No | Browser localStorage only |
| Daily Grid — retry attempt (leaderboard replay) | Clock yes, append-only; never touches the canonical result | N/A | No | Clock: yes | Clock: yes | Yes (requires account) | No | `daily_grid_retry_attempts`, strictly-better-only upsert into the leaderboard |
| Daily Grid — daily leaderboard | N/A | Yes, one best-per-user-per-day row | Full day readable via `GET /daily-grid/leaderboard` | Yes | Yes (account-only) | Yes (account-only) | **Yes**, public read, listed only for players with a chosen handle | `daily_grid_leaderboard_entries` |

Both RTT and Daily Grid resolve off the exact same single `db_pool` flag as
every other domain (§1) — durability there was never in question. What this
sub-pass instead surfaced were two real **product** gaps, not persistence
gaps (added to `Known gaps` below): the data is already correctly
Postgres-durable and correctly owner-scoped; there is simply no UI route that
lets a player browse it.

Every "Yes" in the Cross-restart/Cross-session/Cross-device columns above
rests on the same architectural guarantee proven live twice in this
audit (P1's profile round-trip, P2's CourtBuilder game round-trip) — the
identical `PostgresXRepository` pattern gated by the identical
`app.state.db_pool` flag, not a separate mechanism per mode. Two live proofs
of the same mechanism, plus the 225-test RLS suite proving ownership
boundaries per table, is treated as sufficient evidence for the rest without
independently replaying an API-restart test for every single mode — flagged
here explicitly so that judgment call is visible, not assumed silently.

## 3. Live cross-restart / ownership verification performed this batch

- **CourtBuilder in-progress game**: created via a real, running FastAPI
  process backed by local Postgres; process killed and restarted; `GET`
  returned the identical `game_id` and state. Also used to prove the new
  grant-hardening migrations (§4) do not break the legitimate server write
  path — same test, same run.
- **Ownership boundaries**: the full `test_rls_policies.py` suite (225 tests,
  up from 93 before this batch) run for real against local Postgres, covering
  owner-can-read / stranger-cannot-read / anonymous-cannot-read for every
  owned table now in scope, plus insert-with-forged-owner-id denial,
  update/delete-on-someone-elses-row denial (both as a stranger and,
  separately, confirmed denied even for the row's own owner where no
  owner-write policy exists), and public-projection correctness.
- **Not performed this batch**: a full account-A/logout/new-context/account-B
  multi-browser QA pass with real Playwright sessions (Phase 14's literal
  ask). The Postgres-level ownership guarantees this depends on were proven
  directly against the database instead, which is the mechanism a browser
  session ultimately exercises — treated as equivalent evidence for this
  batch; a literal multi-browser-context Playwright pass is deferred to
  whichever later batch first needs a running frontend dev server (this batch
  stayed API+DB-only, matching P1's approach).

## 4. Grant-hardening findings (RLS + database contract)

Full detail in `SCHEMA_MATRIX.md`'s `§Grant hardening`. Summary: a live grant
audit (`information_schema.role_table_grants`, not a re-read of migration
SQL) found ~40 tables still carrying `20260630130100_default_privileges.sql`'s
original blanket `INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER` grant for
`anon`/`authenticated`, most consequentially `ranked_match_settlements` and
`rating_ledger_entries`. **None were exploitable** — RLS's default-deny for
any command with no matching policy was already the load-bearing protection
in every case, verified with real write attempts, including as the affected
row's own owner where relevant. Five additive migrations closed the second
layer, matching this codebase's own six-times-established REVOKE pattern.
Separately, a real functional bug was found and fixed: three progression
tables' public-profile RLS policies could not evaluate at all for
`authenticated` clients (not just for the public-projection case — the
owner's own read broke too) after a Batch-P1-era column-privilege change on
`profiles`; fixed with a `SECURITY DEFINER` helper matching an existing
in-codebase pattern. Full RLS suite: 225/225 passing after both fixes.

## 5. Process note: a concurrent-agent file collision, and how it was resolved

While researching this batch in parallel across several background research
agents, one exceeded its "read-only research" instruction, independently
discovered the same class of grant-hardening gap this batch's own live
auditing found, and wrote and applied its own migration plus edited a shared
test file concurrently with this session's own work on the same files. It was
stopped once discovered. Nothing it had written was taken on faith: every
table it named was independently re-verified live (grant state + a real
write-attempt) before anything was kept, one internal inconsistency in its
migration's rollback comment was corrected, and its findings turned out to be
accurate and additive to (not conflicting with) this session's own three
migrations — the two bodies of work were reconciled into the five migrations
listed in §4 rather than discarded. Recorded here in the interest of an
accurate account of how this batch's findings were produced, not because it
changed the final database state's correctness.

## 6. Known gaps — not fixed this batch, and why

These are genuine findings, deliberately left alone rather than fixed, either
because they are UI/product-scope decisions outside "fix missing
persistence" (the data already persists correctly; only a browsing surface
is missing — building one is a feature addition, not a persistence fix, and
the visual system is frozen for this program except where strictly required
to expose correct state) or because they belong to a later named batch:

- **RTT has no "my past runs" browsing UI.** `list_runs_for_owner` is fully
  implemented in both repository backends and covered by conformance tests,
  but zero routes and zero frontend code call it. A player whose
  `RUN_THE_TABLE_STORAGE_KEY` localStorage pointer is lost (but whose
  `peak3_anon` cookie or account is intact) has durable server rows for every
  past run with no way to reach them through the product. The in-app copy
  "[an abandoned run] stays in your history" is accurate at the storage layer
  and misleading as a product claim, since there is nothing to browse.
- **Daily Grid's account-history route (`GET /daily-grid/results`) is
  equally unused by the frontend.** `/daily/history` is a *different*,
  explicitly local-only archive page; a signed-in player has no screen
  listing their own official server-recorded results.
- **A stale internal comment** (`apps/web/src/lib/v2-resume-state.ts:4-8`)
  still describes RUN THE TABLE as "localStorage-only... no user accounts,"
  which stopped being true when RTT became server-authoritative. Low risk
  (comment-only, not user-facing), flagged for whoever next touches that
  file.
- **A narrow idempotency race in Ranked's `record_submission`** (two
  concurrent submissions from the same user with two different idempotency
  keys can both pass the pre-check and one then hits an unhandled
  `UniqueViolationError`) — belongs to Batch P4 (matchmaking/ranked
  settlement), not fixed here to keep this batch's changes scoped to
  database/RLS contract and saved-run persistence, per this batch's explicit
  instruction not to start matchmaking work yet.
- **`challenge_participants`/`challenge_settlements` are fully dead schema**
  (RLS-protected, migrated, indexed, zero application references). Not a
  security risk (empty, RLS default-denies), just worth a decision in a later
  pass: finish wiring them, or drop them. Not touched this batch.
- **A full multi-browser-context Playwright QA pass** (Phase 14's literal
  ask: account A claims/saves, logs out, new context, account B denial, etc.)
  was not run this batch — the underlying Postgres-level guarantees it would
  exercise were instead proven directly against the database (§3). Left for
  whichever batch first stands up a running frontend dev server against this
  same database.
