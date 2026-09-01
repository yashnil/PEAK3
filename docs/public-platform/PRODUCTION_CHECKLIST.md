# Production checklist

Status: **complete as of Batch P5.** The LOCAL/PREVIEW/PRODUCTION
configuration matrix, migration inventory, launch-limitation review, release
order, and rollback plan below close out everything this file deferred to P5
at the bottom. No secret values appear below or anywhere in this pass's
output — only presence/absence and mode. See also
`docs/public-platform/DEPLOYMENT_ARCHITECTURE.md` (topology + fail-closed
contract) and `docs/public-platform/FOUNDER_LAUNCH_CHECKLIST.md`
(founder-executable steps).

## Blocker found this batch: `PEAK3_DATABASE_URL` in the deployed API

**What was found.** `railway.toml` (repo root) defines the Railway service —
build, start command, health check — but sets **no application environment
variables**; those are necessarily set in the Railway dashboard, outside this
repository, and could not be inspected from here. `apps/api/app/core/config.py`
defaults `DEBUG = True`. The only thing standing between a production deploy
and this batch's reproduced bug (handle — and every other durable domain —
silently reverting to a process-local dict, wiped on every restart) is:

```
PEAK3_DEBUG=false  in that dashboard's env vars
```

If `PEAK3_DEBUG` is unset there, it defaults to `true`, and:
- `app/core/repository_registry.py::assert_production_ready` — the guard that
  refuses to boot when a durable domain would resolve to memory — **never
  runs**, because it only checks anything when `debug is False`.
- The deploy starts successfully, `/health` returns `200`, every request
  appears to work.
- Every profile, handle, saved run, rating, and match is stored in a Python
  dict that is emptied by Railway's own restart policy
  (`restartPolicyType = "ON_FAILURE"`, `restartPolicyMaxRetries = 3` — a
  crash-and-recover cycle, a redeploy, or a routine platform restart all wipe
  it), with no user-visible error at the moment of loss.

**What must be true, and how to check it without exposing secrets.**

1. In the Railway dashboard, on the API service's Variables tab, confirm
   `PEAK3_DEBUG=false` is set explicitly. (Do not paste its value into a chat
   with an assistant, a ticket, or a log — its presence/absence is the whole
   fact that matters.)
2. Confirm `PEAK3_DATABASE_URL` is set to a real Postgres connection string —
   the hosted Supabase project's pooled connection string (Settings →
   Database → Connection string → "Transaction" pooler mode is the usual
   choice for a serverless-style connection pattern; confirm against
   `apps/api/app/repositories/postgres.py`'s `create_pool` if pool-size
   assumptions matter — not re-verified this batch).
3. After deploying with both set, hit the deployed API's
   `GET /health/readiness` (added this batch) and confirm the response
   includes `"repository_mode": "postgres"`. `"repository_mode": "memory"` on
   a real deploy is the single-endpoint proof that this exact bug is live in
   production — check this before doing anything else.
4. If `PEAK3_DEBUG=false` is set and `PEAK3_DATABASE_URL` is missing or
   unreachable, the process will refuse to start (by design — see
   `assert_production_ready` and `app/main.py`'s `lifespan()`) rather than
   silently degrade. A deploy that won't come up at all, in this specific
   shape, means this configuration step was skipped, not that something else
   is broken.

## Also confirm (carried over from existing docs, not re-verified this batch)

- `NEXT_PUBLIC_API_URL` must point at the deployed API's real origin, never
  `http://localhost:8000` — the existing production-build guard already fails
  the build if it detects the localhost default; do not weaken it.
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web) and
  `PEAK3_SUPABASE_URL` / `PEAK3_SUPABASE_ANON_KEY` (API) must reference the
  **same** Supabase project — a mismatch here surfaces as every authenticated
  request 401ing with a "different Supabase project" warning
  (`app/core/auth.py::get_optional_auth`'s `token_unknown_key` /
  `token_invalid_issuer` branch), not as a handle-persistence symptom, but is
  adjacent enough to call out.
- Google OAuth is not yet enabled on the linked hosted Supabase project
  (reports `external: ["email"]"` — see `AUDIT.md` §1). Enabling it is a
  Google Cloud Console + Supabase dashboard pairing, tracked for Batch P5's
  manual dashboard checklist (Phase 16), not done this batch.

## Batch P3 review — no new production configuration surfaced

Batch P3 (public data contract — see `PUBLIC_DATA_CONTRACT.md`) was
implemented entirely in application code (a new Pydantic response model, a
route fix, frontend type/render fixes) — no new environment variable, no
migration, no schema change. The `RANKED_PUBLIC_LEADERBOARD_ENABLED` flag
this batch's fix depends on already existed and is already covered by
existing configuration guidance; nothing new to add here.

## Explicitly deferred to Batch P5

- Full LOCAL / PREVIEW / PRODUCTION variable-by-variable matrix (Phase 15).
- Manual Supabase-dashboard and Google-Cloud-Console click-paths (Phase 16).
- Migration/deployment rollout order and rollback steps (Phase 17).

## Batch P4 review — Realtime configuration: confirmed nothing to configure

Batch P4 (matchmaking/settlement/H2H concurrency — see
`COMPETITIVE_STATE_MACHINE.md`) included a full Realtime inventory
(P4.14–17). Result: **this application uses zero Supabase Realtime anywhere**
— Ranked, H2H, and Arena are all polling- or manual-refresh-driven by
design, verified by exhaustive grep across backend and frontend. This is a
genuine, checked "nothing required" rather than an unexamined gap:

- No `ALTER PUBLICATION`/`supabase_realtime`/`REPLICA IDENTITY` statement
  exists in any migration — no table needs to be added to a Realtime
  publication for anything in this app to work.
- No Realtime channel/authorization policy is needed — no frontend code
  ever opens a `.channel()`.
- No reconnect-interval/backoff tuning is needed for a transport that isn't
  used.
- The polling fallback IS the primary mechanism, not a fallback: Ranked
  polls `GET /queues/{mode}/status` and `GET /matches/{id}/settlement`
  every 2500ms while relevant; Arena polls `GET /arena/matches/{id}` every
  2000ms (400ms during its reveal ceremony); H2H does not poll at all
  (documented as a known, likely-intentional gap in
  `COMPETITIVE_STATE_MACHINE.md`, not a production-config item).

If a future batch decides to adopt real Realtime (e.g., to reduce H2H's
staleness gap), the manual dashboard step would be: Supabase Dashboard →
Database → Replication → add the specific table(s) to the
`supabase_realtime` publication, plus an RLS-compatible channel
authorization policy — not needed today. Fixes made in P4 (settlement
atomicity, the H2H rematch race, and Ranked's queue-reconnect gap) reduce
the actual staleness/incorrectness risk that would motivate this, so it is
not currently recommended.

## Batch P4 review — no new environment variables or infrastructure required

Every P4 fix was application code (Python/TypeScript) and additive test
coverage — no new migration, no new environment variable, no new Supabase
project configuration. `RANKED_PUBLIC_LEADERBOARD_ENABLED` and the other
existing Ranked/Arena feature flags are unchanged and already covered by
prior guidance.

---

# Batch P5 — Production Deployment Readiness

Everything below is new this batch. **No production write of any kind was
made** — no migration applied to production, no Supabase/Google OAuth
dashboard config changed, no deploy triggered. This section documents what
*would* need to happen, for founder execution, per the batch's explicit
constraint ("This batch ends at READY-TO-DEPLOY").

## Environment matrix

`LOCAL` = a developer's machine. `PREVIEW` = a Vercel preview deploy / a
Railway PR environment, if either is turned on (neither is configured today
— every deploy is direct-to-production on a push to `main`, per Railway's
and Vercel's default GitHub App behavior with no `railway.toml` environments
block and no `vercel.json`). `PRODUCTION` = the live site.

### API (`apps/api`, consumed server-side only — never bundled into a client)

| Variable | Local | Preview | Production | Secret? | Required? | Failure mode if wrong/missing |
|---|---|---|---|---|---|---|
| `PEAK3_DEBUG` | `true` (or unset) | `false` | `false` | No | Yes | If left `true` in prod: `assert_production_ready`/`_assert_deployable` never run — the exact P1 handle-persistence-class bug (silent memory-backed persistence) becomes possible again. If `false` locally with no DB: refuses to boot (correct — dev fallback is DEBUG-gated by design). |
| `PEAK3_SIGNING_SECRET` | dev default OK | must override | must override | **Yes** | Yes | Boot refused if left as the shipped default and `DEBUG=false` (`warn_insecure_secret`). |
| `PEAK3_DATABASE_URL` | unset (memory) or local Postgres | pooled Supabase conn string | pooled Supabase conn string | **Yes** | Yes in prod | Missing, empty-string, or localhost: boot refused when `DEBUG=false` (all three cases now covered — see `test_production_deployability.py`). |
| `PEAK3_SUPABASE_URL` | local Supabase (`127.0.0.1:54421`) or hosted | hosted | hosted | No (it's a public project URL) | Yes for auth verification | Boot refused if localhost/`http://` under `DEBUG=false`; if entirely unset with no `PEAK3_SUPABASE_JWT_SECRET` fallback, boot refused ("No Supabase token verification is configured"). |
| `PEAK3_SUPABASE_JWT_SECRET` | unset (JWKS/ES256 path used) | unset | unset (not needed — hosted project uses ES256/JWKS, confirmed `AUTH_CONFIGURATION.md`) | **Yes**, if ever set | No (legacy HS256 fallback only) | Irrelevant unless the Supabase project is ever switched to a shared-secret JWT signing mode. |
| `PEAK3_CORS_ORIGINS` | `["http://localhost:3000"]` | the preview's Vercel URL | `["https://<production-domain>"]` | No | Yes | Boot refused if `["*"]`, empty, or containing a localhost origin under `DEBUG=false`. Wrong-but-valid origin (e.g. an old domain) fails open at the network level as ordinary browser CORS rejection, not a security hole — but breaks the web app visibly, so gets caught immediately in the smoke test. |
| `PEAK3_RANKED_*`, `PEAK3_ARENA_*`, `PEAK3_COURTBUILDER_*`, `PEAK3_RUN_THE_TABLE_*`, `PEAK3_DAILY_GRID_*` feature flags | mode-dependent, see `.env.example` | same as prod (mirror prod for realistic previews) | intentional per-mode on/off | No | No (each has a safe default) | Wrong value only changes which game modes are reachable — no security or data-integrity failure mode. |
| `PEAK3_TELEMETRY_*`, `PEAK3_CONTACT_*` | mode-dependent | same as prod | intentional | No | No | Same class as above — feature availability only. |

### Web (`apps/web`, `NEXT_PUBLIC_*` = baked into the browser bundle at build time — never a place for a secret)

| Variable | Local | Preview | Production | Secret? | Required? | Failure mode if wrong/missing |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` (fallback default in every `lib/*-api.ts`) | the preview API's URL | the production API's HTTPS URL | No | Yes for a real build | `assertDeployableEnv()` refuses the build if unset, localhost, or non-HTTPS. If it silently points at the wrong-but-valid API (e.g. a stale prior deploy), the build succeeds but every request 404s/CORS-fails — caught in the smoke test, not silent. |
| `NEXT_PUBLIC_SUPABASE_URL` | local or hosted Supabase URL | hosted | hosted | No | Yes, paired with the anon key | Build refused if set without a matching anon key, or vice versa, or if localhost/non-HTTPS under a real build. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local or hosted anon key | hosted anon key | hosted anon key | No (anon keys are meant to be public; RLS is the real boundary) | Yes, paired with the URL above | Build refused if it decodes as a `service_role` JWT (the exact class of accidental-secret-leak this guard exists to catch) — **must never be the service_role key**. |
| `NEXT_PUBLIC_SITE_URL` | unset or `http://localhost:3000` | the preview's own URL | the production domain | No | Recommended (used by `publicOrigin()` in the OAuth callback route's host allowlist) | If unset, the callback route falls back to `request.nextUrl.host`/`x-forwarded-host`, which still works behind Vercel's proxy — this variable hardens against host-header spoofing, it isn't load-bearing for basic function. |
| `NEXT_PUBLIC_PEAK3_E2E_AUTH` | `1` only when running `npm run dev:e2e` | **must be unset** | **must be unset** | No | Must be absent | Build refused if present at all under a real `next build` — this is a deliberate hard stop, not a soft warning, because its presence would mean a test-only auth bypass shipped to real users. |

## Migration inventory — the 6 files new on this branch since `main`

All six are additive/security-only (grant REVOKE + one RLS policy fix),
**none alter table shape, none are destructive, none require app downtime**,
and confirmed via `git diff 253c28c..HEAD -- supabase/migrations/` to be the
only migrations added across the entire public-platform-readiness initiative
(P3 and P4 were both application-code-only batches — no new migrations from
either).

| # | File | What it does | Lock/downtime risk | Rollback |
|---|---|---|---|---|
| 1 | `20260901090000_game_records_client_write_revoke.sql` | REVOKE INSERT/UPDATE/DELETE (and TRUNCATE/TRIGGER) on `games`, `daily_completions`, `result_snapshots` from `anon`/`authenticated` — closes a gap where these three tables predate the batch of "revoke the default blanket grant" migrations and were missed by all of them. | None — `REVOKE` takes only a brief catalog lock, no table rewrite. | `GRANT INSERT, UPDATE, DELETE ON <table> TO anon, authenticated;` restores the pre-migration (insecure) state — only ever needed if a legitimate client write path is later discovered to depend on the direct grant (none does; the API writes as the table-owning role, which is unaffected by this REVOKE). |
| 2 | `20260901093000_progression_tables_client_write_revoke.sql` | Same class of REVOKE across the nine progression/records/achievements/streaks tables (`personal_records`, `achievement_awards`, `streak_states`, and their `*_public` read-projection counterparts, etc.). | None. | Same pattern — re-`GRANT` if ever needed. |
| 3 | `20260901096000_ranked_tables_client_write_revoke.sql` | Same class of REVOKE across every Ranked table (queue, matches, rating_periods, etc.) — the only vertical that had gone from `20260630125500` through `20260630130000` without ever getting an explicit revoke migration, unlike every sibling vertical. | None. | Same pattern. |
| 4 | `20260901120000_revoke_remaining_write_grants.sql` | Sweeps every remaining table not covered by 1–3 or any prior batch's revoke migrations — the "close out the rest" pass. Its own header explicitly excludes `anonymous_subjects`/`ownership_claims`, reasoning (incorrectly, corrected by #6) that they needed nothing further. | None. | Same pattern, per-table. |
| 5 | `20260901130000_fix_progression_public_policy_privilege.sql` | Fixes a self-inflicted regression: `20260803120000_profile_column_privileges.sql` (an earlier, pre-P5 migration) revoked table-level SELECT on `profiles` and re-granted only a column list excluding `auth_sub` — but three progression `*_public` RLS policies subquery `profiles.auth_sub` internally to resolve "is this owner's profile public", so they silently stopped evaluating. This migration grants the minimum needed for those three policies to function again (not a broad SELECT restoration). | None — policy/grant change only. | Revert to the column-restricted grant; **this would silently break public progression display again** — rollback of this specific migration is not recommended unless it's the proven cause of a production incident, and even then prefer a forward-fix. |
| 6 | `20260901140000_anonymous_subjects_ownership_claims_revoke.sql` | Corrects #4's stated-but-unverified assumption: a live grant check showed `anonymous_subjects`/`ownership_claims` still carried the full base grant despite already being `FOR ALL USING (false)` at the RLS layer. REVOKEs it, so an RLS bypass (e.g. a future `SECURITY DEFINER` misconfiguration) would fail loudly at the grant layer too, not just rely on the policy. | None. | Same pattern. |

**Order dependency**: files 1–4 and 6 are independent of each other (each
scopes to disjoint tables) and can be applied in any relative order; file 5
has no ordering dependency on the others either (it only depends on
`20260803120000`, already on `main`). Supabase's migration runner applies by
filename timestamp, which is already correct (1→2→3→4→5→6) — no manual
reordering needed.

**"Do these depend on local-only assumptions?"** — checked explicitly per
the batch's instruction: no. Each is a plain `REVOKE`/`GRANT`/`CREATE POLICY`
statement against table/role names that exist identically in local and
hosted Supabase (same `supabase/migrations/` directory governs both). None
reference a local-only extension, local-only role, or hardcoded connection
string.

**Current state**: none of the 6 are applied to the hosted production
Supabase project (confirmed via `git log`/branch history — these were
authored and tested only against local Docker Supabase in Batch P2, per that
batch's own explicit constraint). Applying them is founder step 1 of the
release order below.

## CORS and cross-origin cookies (P5.10 / P5.11)

The web app (Vercel) and API (Railway) are on different registrable domains
in every deployed environment — this is a genuinely cross-site setup, not
same-site-with-a-subdomain, which shapes both the CORS and cookie posture:

- **CORS**: the API's `PEAK3_CORS_ORIGINS` is an explicit allowlist (never
  `"*"`, refused outright in production — see the fail-closed contract).
  Production should list exactly the real web domain(s); a preview
  deployment's dynamically-generated Vercel URL would need its own origin
  added if previews are ever exercised against a shared API, which isn't
  the current setup (no Railway PR environments exist).
- **The guest-identity cookie** (`ANON_COOKIE_NAME`, `apps/api/app/core/auth.py`):
  `httponly=True` always; `samesite`/`secure` are DEBUG-gated
  (`anon_cookie_attributes()`) — `SameSite=Lax; Secure=False` in local dev
  (same-site localhost, plain HTTP), `SameSite=None; Secure=True` whenever
  `DEBUG=False` (the real deployed shape, cross-site by construction).
  This function's own docstring records a real incident this exact split
  fixed: `SameSite=Lax` on a cross-site deployment silently dropped the
  cookie on every API `fetch`, so each request minted a fresh anonymous
  identity and ownership checks failed in a way that looked like an
  ownership bug rather than a cookie-delivery bug. The DEBUG-gated split is
  intentional and must not be simplified back to a single hardcoded value.
- **Authenticated sessions**: Supabase's own session (managed by
  `@supabase/ssr` in the web app) is cookie-based on the web app's own
  origin; the web app then attaches the session's JWT as a `Bearer` token on
  its own cross-origin calls to the API (`apps/web/src/lib/api.ts` and
  siblings) — the API never reads a Supabase session cookie directly, only
  verifies the bearer JWT via JWKS. This sidesteps the cross-site cookie
  problem entirely for authenticated traffic; only the lightweight anonymous
  identity cookie above needs the `SameSite=None` treatment.
- **OAuth/callback host safety**: `apps/web/src/app/auth/callback/route.ts`'s
  `publicOrigin()` builds its redirect target from an explicit host
  allowlist (the request's own host plus `NEXT_PUBLIC_SITE_URL`'s host, if
  set) rather than trusting `x-forwarded-host` blindly — guards against
  open-redirect via a spoofed proxy header.

No change was needed here this batch — re-verified against the current code,
not re-derived from memory of an earlier pass.

## Realtime — reconfirmed, nothing required (P5.12)

Batch P4 already established this exhaustively (§Batch P4 review above).
Re-confirmed this batch with no new findings: zero `.channel()` calls, zero
Realtime publication migrations, all "live" surfaces poll. Nothing to
configure in Supabase Dashboard → Database → Replication for launch.

## Public URL / share-link audit (P5.13) — no hardcoded host found

Every share-URL-constructing code path in `apps/web` was traced:

- `DraftScreen.tsx`, `ShareRunPanel.tsx`: build the URL inline as
  `` `${window.location.origin}${relative_path}` ``.
- `ChallengeCreator.tsx`, `MatchScreen.tsx` (H2H): call the shared
  `inviteUrl()` helper (`apps/web/src/lib/head-to-head-api.ts:287`), which
  does exactly the same thing: `` `${window.location.origin}${path}` ``,
  falling back to the bare relative path only in a non-browser (SSR)
  context where there is no meaningful origin to prefix.
- The API only ever returns **relative** paths (`public_url_path`,
  `invite_url_path` — the same fields documented in `PUBLIC_DATA_CONTRACT.md`)
  — it never returns an absolute URL, so there is no backend-baked host for
  the frontend to accidentally trust.
- The public profile route (`/u/[handle]`) has no separate "copy my profile
  link" affordance — its URL is simply whatever the browser's address bar
  already shows, which is inherently correct.
- The remaining `localhost` matches across `apps/web/src/lib/*-api.ts` are
  all the same one pattern — `` process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000" `` —
  a development-only fallback for `API_BASE`, never a share/display URL, and
  structurally unreachable in a real production build because
  `assertDeployableEnv()` refuses to build unless `NEXT_PUBLIC_API_URL` is
  explicitly set to a real HTTPS URL.

**Conclusion**: share URLs cannot leak a wrong environment's hostname by
construction — the pattern is "relative path from the API + the browser's
own actual current origin," never a baked-in or configured host. No fix was
needed.

## Secret scan (P5.14) — NO LEAK FOUND

A full-repository scan (tracked files, git history commit messages/diffs
touched by this initiative, `.env.example` vs `.env` gitignore coverage) was
run. Result: **NO LEAK FOUND.** `.env`, `.env.local`, and their variants are
gitignored and none are tracked. `.env.example` files contain only variable
names and placeholder/instructional values (e.g. `INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION`,
which is a deliberately-named default the code itself refuses to boot on in
production — not a real secret). No API key, JWT signing secret, database
password, or service-role key pattern was found in any tracked file. Per the
batch's explicit instruction, no actual secret value is reproduced here even
as a redacted excerpt — this section reports outcome only.

## RLS re-verification against the P4 baseline (P5.15)

Re-ran the full RLS integration suite against local Postgres this batch —
see the FINAL REPORT's test totals for the exact re-run result and pass
count, cross-checked against the Batch P4-reported baseline.

## Launch-limitation review (P5.16)

| Limitation | Classification | Reasoning |
|---|---|---|
| Ranked 48h match deadline is defined but not enforced by an expiry job | **SAFE FOR BETA** | No correctness or security impact — an abandoned match simply sits `in_progress` forever with no auto-forfeit. Annoying, not unsafe. Revisit if it causes visible queue/rating pollution post-launch. |
| No Ranked/H2H abandonment or forfeit mechanic | **SAFE FOR BETA** (explicitly: the P5 prompt forbids inventing one this batch) | Same shape as above — a stalled match is a UX gap, not a data-integrity or security gap. The state machine (`COMPETITIVE_STATE_MACHINE.md`) was hardened in P4 to make sure a stalled match can't corrupt rating/settlement state; it just doesn't resolve itself. |
| H2H has no cancellation affordance | **POST-LAUNCH** | Minor UX gap, no risk. |
| H2H does not poll for opponent state (manual refresh only) | **MUST DISCLOSE IN UI** if not already — check that the H2H screen doesn't imply live updates it doesn't provide; otherwise **SAFE FOR BETA**, since P4 confirmed this is a known, non-corrupting gap. |
| Arena leaderboard has no frontend consumer | **POST-LAUNCH** | Backend-complete, unused — pure feature-completeness gap, not a risk. |
| RTT/Daily Grid histories have data but no browsing UI | **POST-LAUNCH** | Same shape — data exists and is correct, presentation is incomplete. |
| Some routes lack an explicit `response_model` (P3 backlog item) | **POST-LAUNCH** | P3 confirmed none of the affected routes currently leak a private field in practice (verified via live response inspection) — this is a type-safety/discipline debt, not an active leak. Still worth closing eventually so a future edit can't introduce one silently. |
| No automated browser-level H2H invite→accept→settle e2e test | **MUST DISCLOSE internally, not launch-blocking** | P5.1 finding: this exact path has only been verified via API-level concurrency tests (P4) and manual/component testing, never a full three-actor browser flow. The underlying correctness is proven at the API layer; only end-to-end UI wiring is unverified. Flag for the next test-authoring pass, does not block launch. |
| No error-monitoring/alerting platform wired (e.g. Sentry) | **SAFE FOR BETA, revisit soon after** | `/health`, `/health/readiness`, and structured request logs (see P5.17) are sufficient to detect an outage during the launch window if someone is watching; they are not sufficient for unattended operation at any real scale. |
| No production connection-pool sizing verification | **MUST DISCLOSE to founder, not launch-blocking for a beta-scale audience** | `create_pool`'s defaults were never load-tested against Supabase's actual connection ceiling for the project's plan tier. Fine for a beta cohort; would need attention before any traffic push. |

None of the reviewed items are **BLOCKS LAUNCH**.

## Observability (P5.17)

What's already available, with no new platform needed:

- `GET /health` — liveness only (used by Railway's `healthcheckPath`); a
  `200` means the process is up, nothing more.
- `GET /health/readiness` — the real signal: reports `repository_mode`
  (`"postgres"` vs `"memory"` — the single check that would have caught the
  P1-class bug immediately), `auth_verification_mode`, and `fact_bank`
  status. **This is the first thing to check after any deploy.**
- Structured request logs (uvicorn access logs, visible in Railway's log
  stream) give per-request status codes and latency — sufficient to spot an
  elevated error rate or a stalled endpoint during the smoke-test window.
- `scripts/ci/preflight-config.sh` — re-runnable at any time against a live
  environment's *presence* of required variables (never values); already
  confirmed working this batch (0 blockers against local dev, 4 expected
  local-only warnings).

Nothing further is proposed — the batch's explicit scope is "use existing
health/readiness/logging only, no new platform."

## Release order (P5.18)

1. **Apply the 6 pending migrations** to the hosted production Supabase
   database (Dashboard → SQL Editor, or `supabase db push` against the
   linked project — founder's choice of tooling, either applies the same
   files in the same order). Verify via a read-only grant check
   (`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'ranked_matches';`
   or similar) that `anon`/`authenticated` no longer carry INSERT/UPDATE/DELETE
   on the affected tables.
2. **Configure Supabase Auth** (Site URL, Redirect URLs allowlist) for the
   real production domain — see `FOUNDER_LAUNCH_CHECKLIST.md` for the exact
   dashboard path, sourced from `AUTH_CONFIGURATION.md`.
3. **(Optional at launch) Enable Google OAuth** — currently disabled on the
   hosted project (`external: ["email"]` only). Email/password or magic-link
   auth works without this step; only do it if Google sign-in is required
   for day-1 launch.
4. **Set Railway environment variables** for the API service (`PEAK3_DEBUG=false`
   plus every "Required" row in the environment matrix above) and deploy.
   Confirm `GET /health/readiness` on the live Railway URL reports
   `"repository_mode": "postgres"` before proceeding — this is the load-bearing
   check.
5. **Set Vercel environment variables** for the web app (`NEXT_PUBLIC_API_URL`
   pointed at the now-live Railway API's HTTPS URL, plus the Supabase pair)
   and deploy. The build itself will refuse to complete if any required
   variable is missing/unsafe (`assertDeployableEnv()`), so a successful
   Vercel build is itself a partial verification.
6. **Run the smoke test** (P5.21, below) against the real production URLs.
7. **Announce/open access** — the only step in this list that is
   effectively irreversible in a social sense (once real users sign up,
   rollback of steps 1–2 gets materially harder). Everything before this
   point can be reverted cleanly.

Steps 1–3 are Supabase-dashboard/CLI actions; steps 4–5 are platform deploys;
step 6 is verification; step 7 is the founder's own call, not a technical
gate.

## Rollback plan (P5.19)

| Component | Rollback action | Notes |
|---|---|---|
| **API deploy (Railway)** | Railway keeps prior deploy images; use the dashboard's "Redeploy" on the last-known-good deployment, or revert the merge commit and push. | Fast, low-risk — this is the cheapest rollback in the whole system. |
| **Web deploy (Vercel)** | Vercel's dashboard → Deployments → "Promote to Production" on the prior deployment (Vercel keeps every deploy as an immutable, instantly-promotable artifact by default). | Equally fast — no rebuild needed, just a routing switch. |
| **Database migrations (the 6 files)** | **Prefer NOT rolling back.** All six are security-hardening REVOKEs; reverting them re-opens the exact grant-level gaps this initiative closed. If a migration is later proven to be the cause of an incident, prefer a forward-fix migration over a revert. If a revert is truly necessary, each file's own rollback statement is documented in the Migration inventory table above — apply the single implicated file's inverse, not a blanket revert of all six. |
| **Supabase Auth config (Site URL / Redirect URLs)** | Dashboard change, immediately reversible by re-entering the prior values — no data is affected, only which redirect targets are accepted. | Keep a copy of the prior Site URL / Redirect URLs list before changing them (nothing in-repo can restore this — it's dashboard-only state). |
| **Google OAuth config** | Same — Google Cloud Console changes and the Supabase-side toggle are both simple to revert; email/password auth is unaffected either way since it doesn't depend on this. | |
| **Environment variables (Railway/Vercel)** | Both platforms show prior variable values in their dashboard history/redeploy view; reverting is a matter of restoring the previous values and redeploying. | Neither platform's variable history is captured in this repo — this is dashboard-only state, same caveat as Auth config. |

General principle: **every reversible step here is reversible in minutes
through the hosting dashboards themselves** — nothing requires a `git
revert` and a fresh deploy except the (not recommended) migration-revert
case. The only genuinely hard-to-reverse action in the whole release is
announcing/opening access to real users (step 7 above), which is a product
decision, not a technical one.

## 10–15 minute production smoke test (P5.21)

Run immediately after deploy, before announcing:

1. **Anonymous**: load the production URL, confirm the landing page and
   methodology page render, confirm `GET /health/readiness` (via browser
   devtools network tab or `curl`) shows `repository_mode: postgres`.
2. **Account A**: sign up (email/password or magic link), set a handle,
   play one Peak Duel round, refresh, confirm the handle and progress
   persisted (this is the exact P1 regression class — the highest-value
   single check in this whole test).
3. **Account B**: sign up separately, visit Account A's public profile
   (`/u/<handle>`), confirm only public fields are visible (no raw IDs,
   no private stats) — spot-check against `PUBLIC_DATA_CONTRACT.md`.
4. **Multiplayer — Ranked**: both accounts join the same mode's queue in two
   separate browser sessions (or one incognito), confirm they get paired,
   play one round each, confirm settlement resolves and both ratings update.
5. **Multiplayer — H2H**: Account A creates a challenge, copies the invite
   link (confirm it's the real production domain, not localhost — this was
   architecturally guaranteed in P5.13 but worth eyeballing once live),
   Account B opens it in a separate session and accepts, both play, confirm
   the result screen shows for both.
6. **CORS/auth sanity**: open browser devtools console during all of the
   above, confirm no CORS errors and no 401s on authenticated requests.

If any step fails, the release order's rollback plan (P5.19) applies —
prefer rolling back the most recently changed component first (usually the
web or API deploy) before touching database state.
