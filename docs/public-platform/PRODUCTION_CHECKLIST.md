# Production checklist

Status: partial. This batch (P1) surfaced one concrete, verified blocker as a
direct consequence of the handle-persistence root cause. The full
LOCAL/PREVIEW/PRODUCTION configuration matrix (Phase 15/16) is pending Batch
P5. No secret values appear below or anywhere in this pass's output —
only presence/absence and mode.

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

## Explicitly deferred to Batch P5

- Full LOCAL / PREVIEW / PRODUCTION variable-by-variable matrix (Phase 15).
- Manual Supabase-dashboard and Google-Cloud-Console click-paths (Phase 16).
- Migration/deployment rollout order and rollback steps (Phase 17).
