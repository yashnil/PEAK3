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
# Outputs: API URL, anon key, JWT secret, DB URL
```

### Apply migrations

```bash
supabase db push --local
# Or apply manually:
psql postgresql://postgres:postgres@localhost:54322/postgres \
  -f infra/migrations/001_identity.sql \
  -f infra/migrations/002_versioning.sql \
  -f infra/migrations/003_game_records.sql \
  -f infra/migrations/004_challenges.sql \
  -f infra/migrations/005_rls.sql
```

### Configure environment

**`apps/api/.env`** (copy from `.env.example`):
```env
PEAK3_SIGNING_SECRET=<random-32-char-string>
PEAK3_DEBUG=true
PEAK3_DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
PEAK3_SUPABASE_JWT_SECRET=<jwt-secret-from-supabase-start>
```

**`apps/web/.env.local`** (copy from `.env.example`):
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-from-supabase-start>
```

### Start services with auth enabled

```bash
make api   # API now connects to local Postgres and verifies JWTs
make web   # Frontend now shows Sign In / Profile links
```

---

## With Supabase (cloud project)

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - JWT Secret → `PEAK3_SUPABASE_JWT_SECRET`
3. Go to **Settings → Database** and copy the connection string → `PEAK3_DATABASE_URL`.
4. Apply migrations from `infra/migrations/` via the Supabase SQL editor or `supabase db push`.
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
