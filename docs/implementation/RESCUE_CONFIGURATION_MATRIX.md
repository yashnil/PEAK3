# Configuration matrix — local, Railway staging, Vercel staging

**Derived from the current implementation, not from earlier documentation.**
Every variable below was read out of the file that consumes it:

| What | Where the truth is |
|---|---|
| API settings, defaults and cross-flag validators | `apps/api/app/core/config.py` |
| Which repository backend a domain resolves to | `apps/api/app/core/repository_registry.py`, `apps/api/app/core/dependencies.py` |
| Web variables | `apps/web/src/lib/supabase/config.ts`, `apps/web/src/lib/**`, `apps/web/next.config.*` |
| Build/runtime shape of the API container | `Dockerfile`, `railway.toml` |
| Test/CI-only variables | `scripts/ci/*.sh`, `apps/api/tests/conftest.py` |

Nothing hosted was changed to produce this document.

Two conventions, because they explain most of the "restart or rebuild" column:

* **API (Railway).** `Settings` is a `pydantic-settings` model constructed once
  at import. Every `PEAK3_*` value is therefore read at **process start**, so a
  change needs a **restart** and never a rebuild. The one exception is anything
  that changed what went *into* the image — the generated dataset and the fact
  bank are produced by the Docker build (`Dockerfile`, "the generated-data build
  step"), so changing those inputs needs a **rebuild**.
* **Web (Vercel).** `NEXT_PUBLIC_*` values are **inlined into the bundle at
  build time**. Changing one on a deployed Vercel project therefore requires a
  **redeploy**; restarting nothing helps, because the old value is already
  compiled into the JavaScript that was served. Locally, `next dev` reads
  `.env.local` at startup, so a **dev-server restart** is enough.

---

## 1. LOCAL MANUAL TESTING

The whole point of this column is that none of it needs a hosted project. The
API falls back to in-memory repositories and logs
`Repository registry: memory (22/22 domains)` when `PEAK3_DATABASE_URL` is
unset — a loud line, not a silent default.

### `apps/api/.env` — read by `apps/api/app/core/config.py`

| Variable | Exact value | Restart / rebuild | Local | Staging |
|---|---|---|---|---|
| `PEAK3_DEBUG` | `true` | restart | ✅ | ❌ **never** — `false` is what turns on every deployment check |
| `PEAK3_SIGNING_SECRET` | any non-default string, e.g. `local-dev-only-not-a-secret` | restart | ✅ | ❌ use a fresh random value |
| `PEAK3_CORS_ORIGINS` | `["http://localhost:3000"]` | restart | ✅ | ❌ must be the exact deployed web origin |
| `PEAK3_ARENA_ENABLED` | `true` | restart | ✅ | ✅ |
| `PEAK3_ARENA_BOTS_ENABLED` | `true` | restart | ✅ | ✅ |
| `PEAK3_ARENA_READINESS_LEVEL` | `closed_alpha` | restart | ✅ | ✅ |
| `PEAK3_ARENA_PUBLIC_QUEUE_ENABLED` | `false` | restart | ✅ | ✅ |
| `PEAK3_ARENA_RATINGS_ENABLED` | `false` | restart | ✅ | ✅ |
| `PEAK3_ARENA_LEADERBOARD_ENABLED` | `false` | restart | ✅ | ✅ |
| `PEAK3_ARENA_ALPHA_ALLOWLIST` | `[]` (empty = anyone signed in) | restart | ✅ | ✅ — put the closed-alpha `owner_sub` values here to restrict |
| `PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED` | `true` | restart | ✅ | ❌ **the API refuses to start** with this set and `PEAK3_DEBUG=false` |
| `PEAK3_COURTBUILDER_ENABLED` | `true` | restart | ✅ | ✅ |
| `PEAK3_COURTBUILDER_READINESS_LEVEL` | `internal_alpha` | restart | ✅ | ✅ |
| `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` | `true` | restart | ✅ | ✅ |
| `PEAK3_COURTBUILDER_ALPHA_ALLOWLIST` | `[]` | restart | ✅ | ✅ |
| `PEAK3_DATABASE_URL` | *unset* → in-memory; or the local stack's `DB_URL`, `postgresql://postgres:postgres@127.0.0.1:54422/postgres` | restart | ✅ | ❌ staging points at the Supabase session pooler |

Five of those six Arena values are the closed alpha exactly as
`config.py`'s `validate_arena_readiness` defines it; the sixth
(`ARENA_ANONYMOUS_PRACTICE_ENABLED`) is the local-only affordance that lets bot
practice run on the signed `peak3_anon` cookie instead of a Supabase account.
The validators refuse the combinations that would be lies:

* `ARENA_ANONYMOUS_PRACTICE_ENABLED` + `DEBUG=false` → **startup error**
* `ARENA_ANONYMOUS_PRACTICE_ENABLED` without `ARENA_ENABLED` → startup error
* `ARENA_ANONYMOUS_PRACTICE_ENABLED` without `ARENA_BOTS_ENABLED` → startup error
  (practice *is* a bot match, so the combination grants access to nothing)
* `ARENA_PUBLIC_QUEUE_ENABLED` / `ARENA_BOTS_ENABLED` / `ARENA_RATINGS_ENABLED`
  without `ARENA_ENABLED` → startup error
* `ARENA_LEADERBOARD_ENABLED` without `ARENA_RATINGS_ENABLED` → startup error
  (a board reading a table nothing writes looks live and is frozen)
* `ARENA_READINESS_LEVEL=disabled` with any Arena capability on → startup error

### `apps/web/.env.local` — read by `apps/web/src/lib/supabase/config.ts`

| Variable | Exact value | Restart / rebuild | Local | Staging |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | dev-server restart | ✅ | ❌ must be the Railway public URL |
| `NEXT_PUBLIC_SUPABASE_URL` | *unset* for anonymous local practice | dev-server restart | ✅ | ❌ set to the staging project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *unset* for anonymous local practice | dev-server restart | ✅ | ❌ set to the staging anon key |
| `NEXT_PUBLIC_SITE_URL` | *unset* locally | dev-server restart | ✅ | ✅ set to the deployment origin |
| `NEXT_PUBLIC_TELEMETRY_ENABLED` | *unset* | dev-server restart | ✅ | ✅ (both sides must agree — see below) |
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` | `1`, **and only via `npm run dev:e2e`** | dev-server restart | ⚠️ tests only | ❌ never |

`NEXT_PUBLIC_PEAK3_E2E_AUTH` cannot take effect on a production build: the
expression in `config.ts` is `process.env.NODE_ENV !== "production" && …`, and
Next inlines `NODE_ENV`, so the whole branch folds to `false` and the flag
becomes dead code. Setting it on Vercel does nothing — which is a weaker
statement than "the build refuses it", and is the accurate one.

### Data the local API needs on disk

| Artifact | Command | Restart / rebuild |
|---|---|---|
| `data/web/` (leaderboards, metadata) | `make build-dataset` | restart the API afterwards |
| `data/web/nba_facts.v1.json` | `python scripts/build_nba_facts.py --report docs/implementation/NBA_FACT_BANK_REPORT.md` | restart the API afterwards |

The fact bank is held by one process-wide cache (`nba_facts.cached_bank`), which
`/health/readiness` reads too — so a rebuilt bank is picked up on restart and
never half-applied.

### Run it

```bash
cd apps/api && uvicorn app.main:app --reload      # :8000
cd apps/web && npm run dev                        # :3000
```

---

## 2. RAILWAY STAGING (the API)

Owning service: the Railway service built from `Dockerfile` at the **repository
root** (`railway.toml` → `builder = "DOCKERFILE"`, root directory `/`).
Variables are set in the Railway dashboard; there is no `.env` in the image and
`PEAK3_ENV_FILE` must stay unset.

**Every row below is a restart, not a rebuild.** Railway redeploys the running
image when a variable changes, which is a restart of the same build.

### Required

| Variable | Exact value | Owner | Notes |
|---|---|---|---|
| `PEAK3_DEBUG` | `false` | Railway | Turns on the production-readiness assertions: every repository domain must resolve to Postgres, and auth must not be `unconfigured` |
| `PEAK3_SIGNING_SECRET` | fresh random, ≥32 chars | Railway | Never the shipped default; the app warns on it |
| `PEAK3_DATABASE_URL` | Supabase Postgres session-pooler URL | Railway | Required when `DEBUG=false` — `assert_production_ready` refuses to start otherwise |
| `PEAK3_SUPABASE_URL` | `https://<staging-project>.supabase.co` | Railway | JWKS URL and expected issuer are derived from it |
| `PEAK3_CORS_ORIGINS` | `["https://<app>.vercel.app"]` | Railway | Exact origins, JSON array |

### The Arena closed alpha on staging

| Variable | Exact value | Notes |
|---|---|---|
| `PEAK3_ARENA_ENABLED` | `true` | |
| `PEAK3_ARENA_BOTS_ENABLED` | `true` | bot practice for both games |
| `PEAK3_ARENA_READINESS_LEVEL` | `closed_alpha` | |
| `PEAK3_ARENA_PUBLIC_QUEUE_ENABLED` | `false` | no human matchmaking |
| `PEAK3_ARENA_RATINGS_ENABLED` | `false` | no ratings written |
| `PEAK3_ARENA_LEADERBOARD_ENABLED` | `false` | no Arena rating board |
| `PEAK3_ARENA_ALPHA_ALLOWLIST` | `[]`, or a JSON array of `owner_sub` values | empty + enabled = anyone signed in |
| `PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED` | **must not be set** | the API raises on startup with `DEBUG=false`; signed-in closed-alpha accounts reach bot practice the normal way |

### The 82-0 global leaderboard on staging

| Variable | Exact value | Notes |
|---|---|---|
| `PEAK3_COURTBUILDER_ENABLED` | `true` | required for any CourtBuilder route |
| `PEAK3_COURTBUILDER_READINESS_LEVEL` | `internal_alpha` | this enum has no `closed_alpha` member |
| `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` | `true` | **this is the flag that has never been set anywhere.** Reading is public once on; submitting always requires a signed-in account with a public handle, and every scored field is recomputed server-side |
| `PEAK3_COURTBUILDER_ALPHA_ALLOWLIST` | `[]` | |

Durable rows need `PEAK3_DATABASE_URL` as well: with in-memory repositories the
board is real and does not survive a restart.

### Leave unset unless you mean it

| Variable | Why |
|---|---|
| `PEAK3_SUPABASE_JWT_SECRET` | legacy HS256. A post-rollout Supabase project has no JWT secret; setting a placeholder verifies nothing |
| `PEAK3_RANKED_*` (all six) | a different product from the Arena; all off |
| `PEAK3_TELEMETRY_ENABLED` | off by default, and must agree with the web side |
| `PEAK3_ENV_FILE` | there is no `.env` in the image |
| `PEAK3_TEST_*` | test-only; never read by a deployed process |

### Needs a REBUILD, not a restart

| Change | Why |
|---|---|
| regenerating `data/web/` | exported from `leaderboards/*.csv` during the Docker build |
| regenerating the fact bank | `scripts/build_nba_facts.py` runs in the same build step; the image carries `data/web/nba_facts.v1.json` |
| `data/game/**`, `cache/processed/**`, `nba_peak/**`, `apps/api/**` | all `COPY`d into the image |

### Verify from the outside, not from the dashboard

```bash
curl -s https://<api-host>/health/readiness | jq
curl -s https://<api-host>/api/v1/arena/readiness | jq
curl -s https://<api-host>/api/v1/perfect-season/readiness | jq
```

`/health/readiness` reports `auth_verification_mode` (`jwks` | `hs256` |
`jwks+hs256` | `unconfigured`) and the fact-bank status. Read the flags off the
live readiness endpoints rather than off the configuration you believe you set
— this repository has already shipped one bug that existed only because a flag
was checked in a file instead of on the running service.

---

## 3. VERCEL STAGING (the web app)

Owning service: the Vercel project rooted at `apps/web`. **Every row is a
REDEPLOY**, because `NEXT_PUBLIC_*` is inlined at build time.

| Variable | Exact value | Restart / rebuild | Local | Staging |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<railway-host>` — `https://`, no trailing slash | **redeploy** | ❌ locally this is `http://localhost:8000` | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | the same project as `PEAK3_SUPABASE_URL` | **redeploy** | ⚠️ optional locally | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon/publishable key — **never** service-role | **redeploy** | ⚠️ optional locally | ✅ |
| `NEXT_PUBLIC_SITE_URL` | `https://<app>.vercel.app`, no trailing slash | **redeploy** | ⚠️ optional locally | ✅ required behind the proxy, for the OAuth callback's `x-forwarded-host` allowlist |
| `NEXT_PUBLIC_TELEMETRY_ENABLED` | `true` only if `PEAK3_TELEMETRY_ENABLED=true` on Railway | **redeploy** | ✅ | ✅ |
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` | **must not be set** | — | ⚠️ tests only, via `npm run dev:e2e` | ❌ |

**There is no frontend Arena flag.** `apps/web` reads
`GET /api/v1/arena/readiness` and renders whatever the server reports, so
opening the closed alpha is entirely a Railway change and needs no Vercel
redeploy. The same is true of the 82-0 board and
`GET /api/v1/perfect-season/readiness`.

Telemetry is the one pair that must be changed on both sides: the web client
never makes the request unless `NEXT_PUBLIC_TELEMETRY_ENABLED` is exactly
`"true"`, and the API returns 403 unless `PEAK3_TELEMETRY_ENABLED` is on. That
is deliberate for a privacy-affecting collection path — it cannot be turned on
by accident from one side.

---

## 4. Test-only variables — never on a deployment

Set inside `scripts/ci/*.sh` and `apps/api/tests/conftest.py` rather than left
to the environment, because both used to differ silently between a laptop and a
clean checkout.

| Variable | Value | Set by | Purpose |
|---|---|---|---|
| `PEAK3_TEST_REPOSITORY_MODE` | `memory` | `scripts/ci/api-unit-tests.sh` | disables dotenv, drops an inherited `PEAK3_DATABASE_URL`, then asserts the resolved backend at startup |
| `PEAK3_TEST_DATABASE_URL` | local stack `DB_URL` | operator | the ONLY connection string the test process accepts |
| `PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS` | `1` | operator | a second, independently-shaped acknowledgement required alongside the URL |
| `PEAK3_TEST_SUPABASE_URL` / `_ANON_KEY` / `_SERVICE_ROLE_KEY` / `_JWT_SECRET` | local stack values | operator | the RLS integration suite; all four or all 95 tests skip |
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` | `1` | `npm run dev:e2e` | renders the account surface with no hosted project; folds away in a production build |
| `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` | `false` | `scripts/ci/e2e-tests.sh` | declared explicitly so the browser suite stops inheriting whatever is in `apps/api/.env` |
