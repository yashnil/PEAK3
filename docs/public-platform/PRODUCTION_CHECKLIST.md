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
