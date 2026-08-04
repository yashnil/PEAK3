# PEAK3 Arena — Staging Deployment (Vercel + Railway + hosted Supabase)

Configuration only. **Nothing here has been deployed**, no secret is in the
repository, and Ranked stays off.

Target topology:

| Piece | Where | Root |
|---|---|---|
| `apps/web` (Next.js) | Vercel | Root Directory `apps/web` |
| `apps/api` (FastAPI) | Railway | Repository root `/` — **not** `apps/api` |
| Auth + Postgres | Existing hosted Supabase project, used as staging | — |

---

## 1. Railway — exact settings

### Why the build context is the repository root

The API is not self-contained. It reaches outside `apps/api` for three things,
so a service rooted at `apps/api` builds cleanly, starts, and then dies on the
first import:

* `nba_peak/` — `app/main.py` puts the repo root on `sys.path` and imports the
  model package (daily keys, board generation, the Daily Grid optimal solve).
* committed data — `data/game/**` (served peak/season boards, card profiles)
  and `data/generated/**`, resolved relative to the repo root.
* `leaderboards/*.csv` — the input `data/web/` is exported from at build time.

`railway.toml` (committed) pins this. Set these in the Railway service:

| Setting | Value |
|---|---|
| **Root Directory** | `/` (leave empty — **do not** set `apps/api`) |
| **Builder** | Dockerfile (from `railway.toml`) |
| **Dockerfile path** | `Dockerfile` (repository root) |
| **Build command** | *none* — the Dockerfile owns it |
| **Start command** | `sh -c 'cd /app/apps/api && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}'` |
| **Healthcheck path** | `/health` |
| **Healthcheck timeout** | `120` |
| **Watch paths** (optional) | `apps/api/**`, `nba_peak/**`, `leaderboards/**`, `data/**`, `Dockerfile`, `railway.toml` |

`startCommand` is restated in `railway.toml` even though the Dockerfile `CMD`
is identical, because a start command typed into the Railway dashboard
silently overrides `CMD` and this file is the version that gets reviewed.

### The generated-data build step

`data/web/` is gitignored, so a clean checkout has none of it. The Dockerfile
runs, at **build** time:

```
python scripts/build_web_dataset.py
```

then asserts `data/web/peak_windows.json` and `data/web/leaderboards.json` are
non-empty. The exporter reads only the committed leaderboard CSVs — no network —
and takes about a second. Doing it at build rather than boot keeps cold starts
fast and stops a dataset problem from presenting as a failed request.

Without it the API starts, logs one warning, and serves 503 from
`/health/readiness` forever while `/health` reports 200. With `DEBUG=false` this
is now a refused boot instead (see §4).

### PORT binding

Railway injects `$PORT`. The container binds `0.0.0.0:$PORT`; `EXPOSE 8000` and
`ENV PORT=8000` are only defaults so a bare `docker run` behaves like `make api`.
Binding `127.0.0.1` would make the service unreachable through Railway's proxy
while the logs looked perfectly healthy.

### Healthcheck: `/health`, not `/health/readiness`

`/health` is liveness — 200 as soon as the process is up, touches no data.
`/health/readiness` returns **503 until the dataset is loaded**, so pointing
Railway's healthcheck at it would make a slow-loading deploy look like a failed
one. Use readiness as the *human* post-deploy check; it reports
`dataset_loaded`, `player_count`, `duration_count` and `auth_verification_mode`.

---

## 2. Vercel — exact settings

| Setting | Value |
|---|---|
| **Root Directory** | `apps/web` |
| **Framework Preset** | Next.js |
| **Build Command** | *default* (`next build`) |
| **Install Command** | *default*, or `npm install --legacy-peer-deps` if the default fails |
| **Output Directory** | *default* |
| **Node version** | 20 or later |

No `vercel.json` is needed: everything above is dashboard configuration, and
adding a file to restate the defaults would be one more thing to drift.

`next.config.ts` now **fails the build** on a non-deployable environment (§4),
so a bad variable stops the deploy instead of shipping inlined into every
visitor's JavaScript.

---

## 3. Variable checklist

**No values here.** Sources: `apps/api/.env.example`, `apps/web/.env.example`,
`docs/implementation/PREDEPLOYMENT_READINESS.md`.

### Railway (API)

Required:

| Variable | Notes |
|---|---|
| `PEAK3_DEBUG` | **`false`** — this is what turns on every deployment check |
| `PEAK3_SIGNING_SECRET` | fresh random; never the shipped default |
| `PEAK3_DATABASE_URL` | Supabase Postgres connection string (session pooler) |
| `PEAK3_SUPABASE_URL` | staging project URL; **must** match the web app's |
| `PEAK3_CORS_ORIGINS` | JSON array of exact web origins, e.g. `["https://<app>.vercel.app"]` |

Leave unset unless you mean it:

| Variable | Notes |
|---|---|
| `PEAK3_SUPABASE_JWT_SECRET` | legacy HS256 only; the staging project uses JWKS (ES256) |
| `PEAK3_RANKED_*` | all four stay off for staging |
| `PEAK3_COURTBUILDER_*`, `PEAK3_RUN_THE_TABLE_*` | enable deliberately, per that mode's readiness level |
| `PEAK3_ENV_FILE` | leave unset; there is no `.env` in the image |
| `PEAK3_TELEMETRY_*` | off unless wanted |

### Vercel (web)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | the Railway public URL, `https://`, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | same project as `PEAK3_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable key — **never** service-role |
| `NEXT_PUBLIC_SITE_URL` | the Vercel deployment URL; used by the auth callback behind the proxy |

Must **not** be set: `NEXT_PUBLIC_PEAK3_E2E_AUTH` (the build refuses it).

---

## 4. What staging validation rejects

Both halves fail closed, at build or boot, never at request time.

**API — `Settings._assert_deployable`, only when `PEAK3_DEBUG=false`.** Verified
by executing each case:

| Rejected | Verified |
|---|---|
| localhost in `SUPABASE_URL` / `SUPABASE_JWKS_URL` / `DATABASE_URL` | ✅ |
| localhost origin in `CORS_ORIGINS` | ✅ |
| `CORS_ORIGINS` containing `*` (with `allow_credentials=True`) | ✅ |
| empty `CORS_ORIGINS` | ✅ |
| `http://` Supabase URL | ✅ |
| missing/empty generated dataset | ✅ |
| Ranked enabled at a `disabled`/`simulation_only` readiness level | ✅ |
| in-memory repositories (`DATABASE_URL` unset) | ✅ pre-existing |
| default signing secret | ✅ pre-existing |
| no token verification configured | ✅ pre-existing |

**Web — `assertDeployableEnv()` in `next.config.ts`, only on `next build`.**

Gated on the invoked command, not on `NODE_ENV` and not on the config phase:
`next lint` sets `NODE_ENV=production` *and* loads the config with
`PHASE_PRODUCTION_BUILD`, so either of the obvious gates makes `npm run lint`
fail with a deployment error on any machine whose `NEXT_PUBLIC_API_URL` is
correctly `http://localhost:8000` — which would have broken CI, not just a
laptop. Both were tried; both broke lint.

| Rejected | Verified |
|---|---|
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` set at all | ✅ |
| localhost in any public URL | ✅ |
| `http://` public URL | ✅ |
| missing `NEXT_PUBLIC_API_URL` | ✅ |
| Supabase URL/key set without the other | ✅ |
| a **service-role** key in the anon slot (detected by JWT payload, not name) | ✅ |

---

## 5. Manual steps — nobody but you can do these

### Supabase dashboard (staging project)

1. **Auth → URL Configuration → Site URL** — set to the Vercel URL.
2. **Auth → URL Configuration → Redirect URLs** — add:
   - `https://<app>.vercel.app/auth/callback`
   - `https://<app>-*.vercel.app/auth/callback` if preview deploys should sign in
3. **Auth → Providers → Google** — currently **not enabled**; the development
   project reports `external: ["email"]`. Enable it and paste the client ID and
   secret from Google Cloud. Until then the Google button returns "Unsupported
   provider" — see `docs/implementation/AUTH_CONFIGURATION.md`.
4. **Database → Connection string** — take the **session pooler** URI for
   `PEAK3_DATABASE_URL`. The direct connection is IPv6-only and Railway may not
   route to it.
5. **Apply migrations** — `supabase/migrations/` has never been run against this
   project. Verify before pointing traffic at it.

### Google Cloud Console

6. **APIs & Services → Credentials → OAuth 2.0 Client** — add the authorised
   redirect URI Supabase gives you, of the form
   `https://<project-ref>.supabase.co/auth/v1/callback`. This is the **Supabase**
   callback, not the Vercel one; putting the app URL here is the usual mistake.
7. **OAuth consent screen** — add test users while it is unpublished, or nobody
   but you can sign in.

### Railway

8. Create the service from this repository with **Root Directory `/`**.
9. Set the variables in §3. `PEAK3_DEBUG=false` is the one that matters — with
   it unset, every check in §4 is skipped.
10. After the first deploy, confirm `/health/readiness` reports
    `dataset_loaded: true`, `duration_count: 4`, `auth_verification_mode: "jwks"`.

### Vercel

11. Create the project with **Root Directory `apps/web`**.
12. Set the four `NEXT_PUBLIC_*` variables in §3 for the target environment.
13. Redeploy after changing any of them — they are inlined at build time, so an
    edited variable does nothing until the next build.

### Cross-cutting

14. **Point both sides at the same Supabase project.** A mismatch is invisible
    from the outside: the user is signed in, the avatar renders, and every write
    401s. `scripts/ci/preflight-config.sh` compares them, and the API logs both
    issuers on rejection.
15. **After repointing either URL, sign out and back in.** A browser session
    from the previous project survives the change and reproduces exactly the
    symptom above.

---

## 6. Local validation performed

| Check | Result |
|---|---|
| `docker build -t peak3-api:staging-check .` (root context) | ✅ exit 0, **1.37GB** |
| Dataset generated inside the image | ✅ `Loading PEAK3 dataset from /app/data/web` → 250 players, 4 durations |
| `/health` | ✅ `{"status":"ok",...}` |
| `/health/readiness` | ✅ `dataset_loaded: true`, `duration_count: 4`, `auth_verification_mode: "jwks"` |
| 2-Year board through the image | ✅ `#1 Michael Jordan 1990-91 to 1991-92 96.14` |
| Repositories | ✅ `postgres (20/20 domains)` — not memory |
| `$PORT` honoured | ✅ ran on 9099 via `-e PORT=9099` |
| Container `HEALTHCHECK` | ✅ reports `healthy` |
| Staging guard inside the container | ✅ refused a localhost `DATABASE_URL` at boot |
| `next build` with a staging-shaped env | ✅ exit 0 |
| `next build` with E2E auth / localhost / service-role key | ✅ refused |
| `npm run lint` on a localhost dev env | ✅ passes — the guard does not fire outside `next build` |
| `npx tsc --noEmit` | ✅ clean |
| FastAPI unit suite | ✅ 1192 passed, 1 skipped |
| Frontend unit suite | ✅ 1251 passed |

**Not validated:** an actual Railway or Vercel deploy, the Supabase Postgres
connection from Railway's network, Google OAuth, and the migrations. Those need
the platforms.

---

## 7. Known limitations

* The image excludes `cache/html/` (raw scrapes, never read at request time).
  `cache/processed/` **is** included — four small parquets that back CourtBuilder's
  exact player-season resolution, which degrades silently rather than erroring
  if absent.
* The image is 1.37GB, dominated by `data/game/` (~84MB) plus scipy/pandas/
  pyarrow wheels. Fine for Railway; worth a slimming pass before anything
  latency-sensitive.
* `apps/api/Dockerfile` has been **removed**. It copied only `apps/api`, so the
  image it produced installed, started, and failed on the first `nba_peak`
  import. A Dockerfile inside `apps/api` implies an `apps/api` build context,
  which is the wrong instruction — hence deletion rather than repair.
