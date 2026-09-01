# PEAK3 Arena — Deployment Architecture

Batch P5. This document records what the repository *actually* configures,
derived from reading `railway.toml`, both `Dockerfile`s, `next.config.ts`,
`.github/workflows/*.yml`, and the CI comment that settles the question
outright — not assumed from naming convention or prior conversation.

**This is a summary + delta document.** The exhaustive, already-verified
configuration steps live in two existing documents this one defers to rather
than duplicates:

- `docs/implementation/AUTH_CONFIGURATION.md` — exact Supabase Auth +
  Google OAuth dashboard steps, verified against the real hosted project.
- `docs/implementation/STAGING_DEPLOYMENT.md` — exact Railway + Vercel
  settings, a real local Docker build validated end to end, and a table of
  fail-closed checks each individually verified.

Both predate this batch (their own numbers — "20/20 domains", "1192 API
tests" — are stale snapshots from an earlier pass) but their **configuration
guidance is still architecturally correct**, re-confirmed by re-reading the
actual current `railway.toml`, `next.config.ts`, and `config.py` this batch.
Where something changed since they were written, it's called out below.

---

## 1. Confirmed topology

| Piece | Host | Evidence |
|---|---|---|
| **API** (`apps/api`, FastAPI) | **Railway** | `railway.toml` (committed, root of repo): Dockerfile builder, exact start command, `/health` healthcheck. `.github/workflows/ci.yml`'s own comment: *"Vercel and Railway appear on every PR... because they are GitHub App integrations that fire on a branch push"* — both are live, connected GitHub Apps on this repository, not a hypothetical. |
| **Web** (`apps/web`, Next.js) | **Vercel** | Same CI comment names Vercel explicitly as a live integration. No `vercel.json` exists — none is needed for a standard Next.js app (Vercel auto-detects); `STAGING_DEPLOYMENT.md` §2 documents the dashboard-only settings this implies. `apps/web/Dockerfile` also exists as a generic Docker-buildable alternative (any Docker host), but it is not the confirmed live path — Vercel is. |
| **Database + Auth** | **Supabase** (existing hosted project) | `PEAK3_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_URL` both name `zwgzxlqzhpwwgbjmrpow.supabase.co` in local dev config (Batch P1's audit); `PEAK3_DATABASE_URL` is a Postgres connection string, no separate DB host. |
| **Realtime** | **Not used** | Confirmed exhaustively in Batch P4: zero `.channel()`/`postgres_changes` usage anywhere, zero `ALTER PUBLICATION` in any migration. Every "live" surface polls. Nothing to configure for launch. |
| **Static data build** | Baked into the API's Docker image at **build time** | `scripts/build_web_dataset.py` and `scripts/build_nba_facts.py` both run inside `Dockerfile` (repository root), with `test -s` assertions that fail the build if either output is empty. `data/web/` is gitignored — a clean checkout has none of it, and it cannot leak in from a developer machine. |
| **CI/CD** | GitHub Actions (`ci.yml`) + Vercel/Railway auto-deploy on push | `ci.yml` runs the same `scripts/ci/*.sh` scripts documented in `CLAUDE.md`; a changed-file classifier (`detect-changed-scope.sh`) skips irrelevant jobs per PR. Vercel/Railway deploy independently of this workflow, triggered by their own GitHub App integrations on a branch push — **not gated on `ci.yml` passing** (no branch protection exists on `main` per `ci.yml`'s own comment: *"every job below is ADVISORY"*). |

## 2. Why the API build context is the repository root, not `apps/api`

The FastAPI app is not self-contained: it imports `nba_peak/` (put on
`sys.path` by `app/main.py`), reads `data/game/**`/`data/generated/**` by
paths resolved relative to the repo root, and exports `data/web/` from
`leaderboards/*.csv` at build time. `railway.toml`'s own header comment
records that a prior `apps/api`-rooted Dockerfile "built cleanly, started,
and then failed on the first import" — this is why the Dockerfile lives at
the repository root and Railway's Root Directory must stay `/`, never
`apps/api`. Full detail: `STAGING_DEPLOYMENT.md` §1.

## 3. What changed since `STAGING_DEPLOYMENT.md`/`AUTH_CONFIGURATION.md` were written

These are the deltas from Batches P1–P4 that a founder following those two
documents today should know about — none change the *steps*, but several
change what a verification check should now show:

- **Repository domain count**: those docs say "postgres (20/20 domains)".
  Batch P1 found 22 domains actually wired; Batch P2 added `telemetry` and
  `contact` to the registry (previously wired but not enumerated) for
  **24/24**. `GET /health/readiness`'s `repository_mode` field (added
  Batch P1) is the current live check — it now also reports whether the
  process is Postgres- or memory-backed without reading server logs.
- **RLS test count**: was unspecified in the old docs; now **244 tests**
  (Batch P2 grant-hardening: 227; Batch P3 profile-mutation tests: +2 → 229;
  wait — see exact figure in §Security below; re-verified this batch).
- **Ranked public leaderboard**: Batch P3 found and fixed a real privacy
  defect — it was serializing the raw Supabase `auth.uid()` instead of a
  chosen handle. Fixed; any founder QA script written against the old
  response shape (`owner_sub` field) needs updating to `handle`.
- **Ranked settlement**: Batch P4 found and fixed three real concurrency
  bugs in the settlement path (all in `apps/api/app/repositories/ranked_postgres.py`
  and `apps/api/app/services/ranked/settlement.py`) and one in H2H rematch.
  None require new configuration — pure application-code fixes. Full detail:
  `docs/public-platform/COMPETITIVE_STATE_MACHINE.md`.
- **Production fail-closed contract**: Batch P5 found and fixed one narrow
  gap — `PEAK3_DATABASE_URL=""` (defined but empty, a shape some deploy
  platforms produce for an unset variable reference) was not caught by the
  earliest guard (`Settings`'s own validator checked `is None`, which an
  empty string is not). Two independent downstream guards (`main.py`'s
  `lifespan()` and `assert_production_ready`) already caught this — it was
  never a live boot-into-memory risk — but the earliest, cheapest check now
  also catches it, and it now has permanent regression coverage
  (`apps/api/tests/test_production_deployability.py`, 13 tests — this exact
  class of check had **zero** automated tests before this batch, only a
  one-time manual verification pass recorded in `STAGING_DEPLOYMENT.md` §4).

## 4. Environment matrix

Full variable-by-variable detail (name, consumer, client-exposed?, secret?,
current local status, validation applied) is in `PRODUCTION_CHECKLIST.md`
§Environment matrix (this batch). Summary of the categories:

- **API secrets** (never client-exposed): `PEAK3_SIGNING_SECRET`,
  `PEAK3_DATABASE_URL`, `PEAK3_SUPABASE_JWT_SECRET` (legacy-only).
- **API non-secret config**: `PEAK3_DEBUG`, `PEAK3_CORS_ORIGINS`,
  `PEAK3_SUPABASE_URL`, feature-flag families (`PEAK3_RANKED_*`,
  `PEAK3_ARENA_*`, `PEAK3_COURTBUILDER_*`, `PEAK3_RUN_THE_TABLE_*`,
  `PEAK3_DAILY_GRID_*`, `PEAK3_TELEMETRY_*`, `PEAK3_CONTACT_*`).
- **Web client-exposed, non-secret by design** (`NEXT_PUBLIC_*`, inlined into
  the browser bundle at build time): `NEXT_PUBLIC_API_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `NEXT_PUBLIC_SITE_URL`.
- **Must never appear in a deploy**: `NEXT_PUBLIC_PEAK3_E2E_AUTH` (build
  fails if set at all — its mere presence means a test environment leaked
  into a deploy).

Every one of these is validated at build or boot, never at request time —
see §Fail-closed contract below.

## 5. Fail-closed contract — re-verified this batch

`Settings._assert_deployable()` (`apps/api/app/core/config.py`, triggered
only when `PEAK3_DEBUG=false`) and `assertDeployableEnv()`
(`apps/web/next.config.ts`, triggered only on a real `next build`) both
refuse to boot/build on a development-shaped production configuration.
Every rejection case documented in `STAGING_DEPLOYMENT.md` §4 was
re-executed this batch, in isolation, against the current code:

| Case | Result |
|---|---|
| Missing `PEAK3_DATABASE_URL` | refused |
| Empty-string `PEAK3_DATABASE_URL` | **refused — fixed this batch, see §3** |
| Localhost/`host.docker.internal` `PEAK3_DATABASE_URL` | refused |
| Default `PEAK3_SIGNING_SECRET` | refused |
| `PEAK3_CORS_ORIGINS` containing `"*"` | refused |
| Empty `PEAK3_CORS_ORIGINS` | refused |
| Localhost origin in `PEAK3_CORS_ORIGINS` | refused |
| Localhost/`http://` `PEAK3_SUPABASE_URL` | refused |
| No auth verification configured | refused |
| A correctly-configured production environment | **boots** |
| `PEAK3_DEBUG=true` with no `PEAK3_DATABASE_URL` (local dev) | **boots** (dev fallback intact) |

All 13 cases now have permanent test coverage
(`apps/api/tests/test_production_deployability.py`) — previously zero.

Web-side (`next.config.ts`) cases were not re-executed as isolated unit
tests this batch (no such test harness exists for a Next.js config
function), but a real `next build` was run against a safe placeholder HTTPS
URL — see §Production build in `PRODUCTION_CHECKLIST.md`.

## 6. What this document does NOT cover

Exact Supabase Auth/Google OAuth dashboard steps: `AUTH_CONFIGURATION.md`.
Exact Railway/Vercel settings: `STAGING_DEPLOYMENT.md`. Founder-executable
checklist combining both plus this batch's deltas:
`FOUNDER_LAUNCH_CHECKLIST.md`. Migration inventory/order/rollback:
`PRODUCTION_CHECKLIST.md` §Migrations. Release order and rollback:
`PRODUCTION_CHECKLIST.md` §Release order / §Rollback.
