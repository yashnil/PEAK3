# Founder launch checklist

Batch P5. This is the single "what do I actually click" document. Every
dashboard path below is copied from either a document this initiative
already verified (`docs/implementation/AUTH_CONFIGURATION.md`,
`docs/implementation/STAGING_DEPLOYMENT.md`) or from configuration files in
this repository (`railway.toml`, `next.config.ts`) — nothing below is
invented for a platform/dashboard shape not already established in-repo.

No secret values appear anywhere in this document.

Two kinds of item: **AUTOMATED / ALREADY DONE** (nothing for you to do —
listed so you know it's covered) and **FOUNDER MUST DO** (a real dashboard
action, checkbox, only you can do this — it requires credentials/access this
assistant does not have and should not be given).

---

## AUTOMATED / ALREADY DONE — nothing to click

- [x] API refuses to boot in production with an unsafe config (default
      secret, missing/empty/localhost database URL, wildcard or empty or
      localhost CORS, unconfigured auth) — `apps/api/app/core/config.py`,
      13 regression tests in `apps/api/tests/test_production_deployability.py`.
- [x] Web refuses to build in production with an unsafe config (missing/
      localhost/non-HTTPS API or Supabase URL, mismatched Supabase URL/key
      pair, a service-role key detected in the anon-key slot, the E2E-only
      auth flag present at all) — `apps/web/next.config.ts`'s
      `assertDeployableEnv()`.
- [x] Static game dataset (`data/web/`, NBA facts) is generated and validated
      **at Docker build time**, not boot time — a broken/empty dataset fails
      the image build itself, never reaches a running deploy.
- [x] Row-Level Security is enabled and policy-enforced on every durable
      table; client-side direct writes are revoked at the grant layer too
      (defense in depth — see the 6 migrations in the checklist below).
- [x] Public API responses are audited against "PRIVATE DATABASE ROW !=
      PUBLIC API RESPONSE" (`docs/public-platform/PUBLIC_DATA_CONTRACT.md`) —
      no raw auth IDs, no cross-account private fields.
- [x] Ranked/H2H concurrency (matchmaking, settlement, reconnect) is proven
      correct via real concurrent Postgres testing
      (`docs/public-platform/COMPETITIVE_STATE_MACHINE.md`).
- [x] Realtime is confirmed unnecessary for launch — nothing to enable in
      Supabase's Replication settings.
- [x] Share/invite URLs are structurally incapable of hardcoding the wrong
      environment's hostname (always browser `window.location.origin` +
      a relative path from the API).
- [x] Secret scan of the repository: **NO LEAK FOUND**.
- [x] Full RLS regression suite passing locally (exact count in this batch's
      final report).

---

## FOUNDER MUST DO

### 1. Apply the 6 pending database migrations to production

- [ ] Open the Supabase Dashboard for the production project → **SQL Editor**
      (or use the Supabase CLI: `supabase db push` against the linked
      project, if you have the CLI linked to production — either path
      applies the same 6 files).
- [ ] Apply, in order (already correct by filename timestamp):
      `20260901090000_game_records_client_write_revoke.sql`,
      `20260901093000_progression_tables_client_write_revoke.sql`,
      `20260901096000_ranked_tables_client_write_revoke.sql`,
      `20260901120000_revoke_remaining_write_grants.sql`,
      `20260901130000_fix_progression_public_policy_privilege.sql`,
      `20260901140000_anonymous_subjects_ownership_claims_revoke.sql`.
- [ ] All six are additive REVOKE/policy-fix statements — no table rewrite,
      no downtime, safe to run against a live database. See
      `PRODUCTION_CHECKLIST.md` §Migration inventory for what each one does
      and its individual rollback if ever needed.

### 2. Configure Supabase Auth for the real production domain

Dashboard path: **Authentication → URL Configuration**.

- [ ] Set **Site URL** to your real production domain (e.g.
      `https://<your-production-domain>`) — not a Vercel preview URL, not
      localhost.
- [ ] Add to **Redirect URLs**: `https://<your-production-domain>/auth/callback`.
      Keep the existing `http://localhost:3000/auth/callback` entry too —
      removing it breaks local development for every future contributor,
      and an allowlisted localhost redirect is not itself a production
      security issue (it can never be reached from a real browser session
      unless that browser is already running something on localhost:3000).
- [ ] Confirm email templates / sender are acceptable for production volume
      — the built-in Supabase email sender is rate-limited and explicitly
      not recommended for production by Supabase themselves; see
      `AUTH_CONFIGURATION.md` §SMTP for the exact limits and the custom-SMTP
      alternative if you expect signup volume beyond the built-in limits.

### 3. (Optional for day-1 launch) Enable Google OAuth

Skip this section entirely if email/password or magic-link auth is
sufficient for launch — nothing else in this checklist depends on it.

Dashboard path (Google Cloud Console): **APIs & Services → Credentials →
Create OAuth client ID → Web application**.

- [ ] **Authorized JavaScript origins**: your production web domain
      (`https://<your-production-domain>`).
- [ ] **Authorized redirect URI** (exactly one, and it is **not** your
      app's own callback route): `https://<project-ref>.supabase.co/auth/v1/callback`
      — this is Supabase's callback, which then forwards the user on to
      your app's own `/auth/callback` route internally. Do not put your
      app's domain here; that is a different, unrelated redirect step
      configured in Supabase's own dashboard, not Google's.

Dashboard path (Supabase): **Authentication → Providers → Google**.

- [ ] Toggle Google **on** and paste in the Client ID / Client Secret from
      the Google Cloud Console credential created above.
- [ ] Confirm via `curl https://<project-ref>.supabase.co/auth/v1/settings`
      that the response's `external` list now includes `"google"` (currently
      it reports `["email"]` only — this is the live check that the toggle
      actually took effect, not just that you clicked it).

### 4. Deploy the API (Railway)

Dashboard path: Railway project → the API service → **Variables** tab.

- [ ] Root Directory: confirm it is `/` (repository root), **not**
      `apps/api` — this is already set correctly in `railway.toml`, but
      double-check the dashboard reflects it, since `railway.toml` values
      can be overridden per-service in the dashboard.
- [ ] Set every "Required" row from `PRODUCTION_CHECKLIST.md` §Environment
      matrix for the API: `PEAK3_DEBUG=false`, `PEAK3_SIGNING_SECRET` (a
      real random secret — never the shipped default), `PEAK3_DATABASE_URL`
      (the hosted Supabase project's pooled connection string — Settings →
      Database → Connection string, "Transaction" pooler mode), and
      `PEAK3_SUPABASE_URL` (the hosted project's URL).
- [ ] Set `PEAK3_CORS_ORIGINS` to a JSON array containing your production
      web domain only (e.g. `["https://<your-production-domain>"]`).
- [ ] Deploy (push to the connected branch, or trigger a manual redeploy).
- [ ] **After deploy, before anything else**: `curl https://<your-api-domain>/health/readiness`
      and confirm the response shows `"repository_mode": "postgres"`. This
      single check is the highest-value verification in this entire
      checklist — if it says `"memory"`, stop and fix the variables above
      before proceeding to step 5.

### 5. Deploy the web app (Vercel)

Dashboard path: Vercel project → **Settings → Environment Variables**
(scoped to Production).

- [ ] Root Directory: confirm it is `apps/web` (Vercel project settings, not
      a file in the repo — no `vercel.json` exists or is needed).
- [ ] Set `NEXT_PUBLIC_API_URL` to the real Railway API URL from step 4
      (must be `https://`, must not be localhost — the build will refuse
      to complete otherwise, which is the intended fail-closed behavior,
      not a bug if you see it).
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
      the hosted Supabase project's values (Settings → API in the Supabase
      dashboard). **Use the `anon`/`public` key, never the `service_role`
      key** — the build actively checks for and refuses a service-role key
      in this slot, but don't rely on that as your only safeguard.
- [ ] Set `NEXT_PUBLIC_SITE_URL` to your production domain.
- [ ] Confirm `NEXT_PUBLIC_PEAK3_E2E_AUTH` is **not set** in this
      environment (it should not exist as a Vercel env var for Production
      at all).
- [ ] Deploy. A successful build is itself a partial verification — the
      build fails outright if any of the above is missing or unsafe.

### 6. Run the 10–15 minute smoke test

- [ ] Follow `PRODUCTION_CHECKLIST.md` §Smoke test exactly, against the
      real production URLs, before telling anyone the site is live.

### 7. Announce / open access

- [ ] This is the one step in this checklist that is genuinely hard to
      "undo" in a social sense — everything before it can be rolled back
      cleanly through the Railway/Vercel dashboards (see
      `PRODUCTION_CHECKLIST.md` §Rollback plan). Do this last, and only
      after step 6 passes.

---

## If something goes wrong after launch

See `PRODUCTION_CHECKLIST.md` §Rollback plan for the exact per-component
recovery action. The short version: API and web deploys both roll back in
under a minute via their respective dashboards ("redeploy prior version" /
"promote to production" on the last-known-good deployment); database
migrations should be forward-fixed rather than reverted; Auth/OAuth
dashboard settings are reversible by re-entering the prior values (keep a
note of them before you change anything, since nothing in this repository
can restore dashboard-only state for you).
