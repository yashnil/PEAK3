# Local Development Setup — Phase 3.0

## Quick start (no auth / no database)

The app runs fully in development mode without Supabase or a database.
Auth features are gracefully disabled and in-memory storage is used.

```bash
# 1. Install dependencies
pip install -r requirements.txt          # model deps
pip install -r apps/api/requirements.txt # API deps (includes PyJWT, asyncpg)
cd apps/web && npm install               # frontend deps

# 2. Build game data
make build-dataset

# 3. Start services
make api    # FastAPI on :8000
make web    # Next.js on :3000
```

Auth pages (`/signin`, `/signup`, `/profile`, `/history`) render gracefully
with a "not configured" message when Supabase env vars are absent.

---

## With Supabase (local stack)

### Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli): `brew install supabase/tap/supabase`
- Docker Desktop (for the local Postgres + Auth stack)

### Start local Supabase

```bash
supabase start
# Applies every migration under supabase/migrations/ automatically and
# outputs: API URL, anon key, service-role key, JWT secret, DB URL, Studio URL
```

`supabase/migrations/` is the **only** editable migration source (see
`infra/migrations/README.md` — that directory is documentation-only now).
To re-apply the full chain from scratch against a clean local database:

```bash
supabase db reset
```

To add a new migration:

```bash
supabase migration new <description>
# then edit the generated supabase/migrations/<timestamp>_<description>.sql
```

### Configure environment

**`apps/api/.env`** (copy from `.env.example`):

> **Local stack ports are shifted +100**: API `54421`, DB `54422`, Studio
> `54423`, Mailpit `54424`. PEAK3 shares a machine with another local Supabase
> project that holds the default `5432x` block, and two stacks cannot bind the
> same ports. `supabase status` always prints the live values — read them from
> there rather than from any document, including this one.

```env
PEAK3_SIGNING_SECRET=<random-32-char-string>
PEAK3_DEBUG=true
PEAK3_DATABASE_URL=postgresql://postgres:postgres@localhost:54422/postgres
PEAK3_SUPABASE_JWT_SECRET=<jwt-secret-from-supabase-start>
```

**`apps/web/.env.local`** (copy from `.env.example`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54421
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-supabase-start>
```

### Start services with auth enabled

```bash
make api   # API now connects to local Postgres and verifies JWTs
make web   # Frontend now shows Sign In / Profile links
```

Confirm every domain is durable by checking the startup log line:
```
Repository registry: postgres (13/13 domains)
```
If it instead reads `memory (13/13 domains)`, `PEAK3_DATABASE_URL` isn't set
or the pool failed to initialize — check the log line above it. In
production (`PEAK3_DEBUG=false`) any non-`postgres` domain fails startup
outright rather than silently falling back (`app/core/repository_registry.py`).

### Running the real Supabase integration + conformance suites locally

These are normally skipped ("not configured") in a plain `pytest` run — they
require the local stack above to actually be running:

```bash
export PEAK3_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres
export PEAK3_TEST_SUPABASE_URL=http://127.0.0.1:54421
export PEAK3_TEST_SUPABASE_ANON_KEY=<ANON_KEY-from-supabase-status>
export PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY-from-supabase-status>
export PEAK3_TEST_SUPABASE_JWT_SECRET=<JWT_SECRET-from-supabase-status>

cd apps/api
python -m pytest tests/integration/ -q                # real auth + RLS round-trips
python -m pytest tests/test_repository_conformance.py -q  # same behavior suite, memory + real Postgres
```

Both suites create and clean up their own throwaway data (random UUIDs/emails
per run) against the local stack — no fixed seed data or persistent test
users are required. `supabase db reset` at any point returns the stack to a
clean slate.

---

## With Supabase (cloud project)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` (or publishable) key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - JWT Secret → `PEAK3_SUPABASE_JWT_SECRET` — **legacy projects only.**

   > Projects created after Supabase's asymmetric signing-key rollout have **no
   > JWT secret at all**: they publish public keys at
   > `{URL}/auth/v1/.well-known/jwks.json`, and setting `PEAK3_SUPABASE_URL` is
   > all the API needs. Do not go looking for a secret such a project does not
   > have. Check which regime you are on, and confirm what the running API can
   > actually verify, with the two commands in
   > `docs/implementation/AUTH_CONFIGURATION.md` §0.
3. Go to **Settings → Database** and copy the connection string → `PEAK3_DATABASE_URL`.
4. Apply migrations from `supabase/migrations/` via `supabase link` (hosted project) then
   `supabase db push`.

   > **Updated.** Phase 4.0A deliberately linked no hosted project. That is no
   > longer true: a hosted **development** project is linked and the full
   > migration chain is applied to it with `supabase db push`. Never paste
   > migrations into the SQL editor — `scripts/validate_migrations.py` enforces
   > ordering, forward-reference safety and policy uniqueness across the whole
   > chain, and a hand-applied file silently breaks that guarantee.
5. Enable **Email** auth under **Authentication → Providers**.

---

## Environment variable reference

### API (`apps/api/.env`)

| Variable | Required in prod | Description |
|---|---|---|
| `PEAK3_SIGNING_SECRET` | Yes | HMAC secret for session tokens and challenge HMAC |
| `PEAK3_DATABASE_URL` | Yes | PostgreSQL connection string |
| `PEAK3_SUPABASE_JWT_SECRET` | For auth | Supabase JWT secret (verifies access tokens) |
| `PEAK3_DEBUG` | No | `true` in dev; `false` in prod (enables production safety checks) |
| `PEAK3_CORS_ORIGINS` | No | JSON array of allowed CORS origins |
| `PEAK3_TEST_DATABASE_URL` | No | Local-stack Postgres URL for `tests/integration/` + conformance suite only |
| `PEAK3_TEST_SUPABASE_URL` / `_ANON_KEY` / `_SERVICE_ROLE_KEY` / `_JWT_SECRET` | No | Values for the real auth/RLS integration tests. The local stack is the fast path; a dedicated hosted *test* project also works. Never point these at a project holding real user data. |

### Web (`apps/web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Base URL of the FastAPI backend |
| `NEXT_PUBLIC_SUPABASE_URL` | For auth | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | For auth | Supabase anon key |

---

## Running tests

```bash
# Model tests (186)
source .venv/bin/activate
python -m pytest tests/ -q

# API tests (142, includes Phase 3.0 auth/profile/history tests)
source apps/api/.venv/bin/activate
python -m pytest apps/api/tests/ -q

# Frontend unit tests (24)
cd apps/web && npm run test

# TypeScript typecheck
cd apps/web && npm run typecheck

# Playwright E2E (44 chromium + 5 mobile)
cd apps/web && npx playwright test
```
