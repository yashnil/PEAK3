# PEAK3 Arena — Public Platform Readiness Audit

Status: **Batch P1 (auth / handle / profile persistence) complete.** Batches
P2–P5 (saved runs beyond profile, public results/leaderboards, matchmaking/
ranked/realtime, production config) are pending and will extend this
document rather than replace it.

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
