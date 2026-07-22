# Phase 3.1 Release Gate

## Required environment

```bash
# Python (model + API)
source apps/api/.venv/bin/activate   # or: conda activate <env>
pip install -r requirements.txt
pip install -r apps/api/requirements.txt

# Node (frontend)
cd apps/web && npm install --legacy-peer-deps

# Build game data (required once after clone or data change)
python scripts/build_web_dataset.py
python scripts/build_card_profiles.py
```

## Fresh-service startup procedure

Always start services from the current working tree:

```bash
# 1. Kill any stale processes
node apps/web/scripts/kill-ports.js

# 2. Start API (in a separate terminal)
cd apps/api && uvicorn app.main:app --port 8000

# 3. Start frontend (in a separate terminal)
cd apps/web && npm run dev
```

### Detecting stale servers

A server is stale if it was started before your latest code changes. Symptoms:
- Playwright tab-click tests fail (click handler not attached — React didn't hydrate)
- API returns 404 for `/api/v1/achievements` (Phase 3.1 routes not registered)

Check:
```bash
lsof -i :3000 -i :8000 | grep LISTEN    # shows PIDs
curl http://localhost:8000/api/v1/achievements | head -c 100   # must return JSON array
```

After any layout change (`nav.tsx`, new React providers, `app/layout.tsx`), restart
the Next.js dev server. The Playwright global setup (`playwright.setup.ts`) validates
both services before tests start and fails fast with a clear message if stale.

## Release-gate commands (run in order)

### 1. Python model tests

```bash
python -m pytest tests/ --ignore=tests/lineup -q --tb=short
# Expected: 186 passed
```

### 2. Lineup model tests

```bash
python -m pytest tests/lineup/ -q --tb=short
# Expected: 41 passed
```

### 3. FastAPI suite

```bash
cd apps/api
python -m pytest tests/ -q --tb=short
# Expected: 180 passed, 0 skipped
```

### 4. Frontend typecheck

```bash
cd apps/web && npm run typecheck
# Expected: no output (exit 0)
```

### 5. Frontend lint

```bash
cd apps/web && npm run lint -- --max-warnings 0
# Expected: "No ESLint warnings or errors"
```

### 6. Frontend unit tests

```bash
cd apps/web && npm run test
# Expected: 67 passed (3 test files)
```

### 7. Production build

```bash
cd apps/web
rm -rf .next
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run build
# Expected: "Compiled successfully"
```

### 8. Playwright E2E (clean fresh-service run, zero retries)

```bash
# Ensure ports are clear first
node apps/web/scripts/kill-ports.js

cd apps/web
npm run test:e2e:fresh       # kills ports, starts fresh services, runs tests
# Or for the strict zero-retry proof run:
npm run test:e2e:ci          # PLAYWRIGHT_RETRIES=0, expects CI=true env
```

Expected:
- **chromium project**: 56 tests discovered, 56 passed
- **mobile-chrome project**: 6 tests discovered, 6 passed
- **Total**: 62 passed, 0 failed, 0 skipped, 0 retries

### 9. 3,000-board anchor-v3 corpus

```bash
python scripts/check_board_generation.py 1000
# Expected: "Checked 3000 boards across 3 modes (1000 seeds each). PASS: all boards valid."
# Typical runtime: ~5 min
```

## Migration procedure

Migrations live in `infra/migrations/`. They target Supabase / PostgreSQL.
Run via the Supabase CLI or any PostgreSQL client in dependency order:

```
001_identity.sql          — profiles, anonymous_subjects
002_versioning.sql        — model version tracking
003_game_records.sql      — result_snapshots
004_challenges.sql        — challenge links
005_rls.sql               — Phase 3.0 RLS
006_progression.sql       — XP events, user_progress (Phase 3.1)
007_records.sql           — personal_records (Phase 3.1)
008_achievements.sql      — achievement_definitions + catalog seed (Phase 3.1)
009_streaks.sql           — streak_states, streak_events (Phase 3.1)
010_progression_rls.sql   — Phase 3.1 RLS policies
```

### Idempotency

Migrations 001–009 use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
and `INSERT ... ON CONFLICT DO NOTHING` throughout — safe to re-apply.

Migration 010 (`CREATE POLICY`) is NOT idempotent and will error if re-run.
The Supabase migration runner tracks applied migrations in `schema_migrations` and
skips already-applied files. Never run 010 manually more than once on the same database.

### Migration rerun test

To validate idempotency locally (requires PostgreSQL):
```bash
psql $DATABASE_URL -f infra/migrations/006_progression.sql  # first apply
psql $DATABASE_URL -f infra/migrations/006_progression.sql  # should not error (IF NOT EXISTS)
```

## RLS policy coverage (migration 010)

| Table | Owner | Non-owner authenticated | Public (anon) | Service role |
|---|---|---|---|---|
| `xp_policy_versions` | read | read | read | full access |
| `progression_events` | read | — | — | full access |
| `user_progress` | read | — | — | full access |
| `personal_records` | read | read (if public profile) | — | full access |
| `personal_record_events` | read | — | — | full access |
| `achievement_definitions` | read (non-hidden) | read (non-hidden) | read (non-hidden) | full access |
| `achievement_awards` | read | read (if public profile, non-hidden) | — | full access |
| `streak_states` | read | read (if public profile) | — | full access |
| `streak_events` | read | — | — | full access |

RLS policies tested via `test_non_owner_blocked_from_progression` and
`test_progression_requires_auth` in `apps/api/tests/test_progression.py`.
Full PostgreSQL-level RLS validation requires a live Supabase project.

## Playwright project counts

| Project | Filter | Tests discovered | Tests passing |
|---|---|---|---|
| chromium | not @mobile | 56 | 56 |
| mobile-chrome | @mobile only | 6 | 6 |
| **Total** | | **62** | **62** |

### Spec breakdown

| File | chromium | mobile-chrome |
|---|---|---|
| `accessibility.spec.ts` | 9 | 0 |
| `daily-challenge.spec.ts` | 11 | 2 |
| `gameplay.spec.ts` | 23 | 3 |
| `progression.spec.ts` | 13 | 1 |

## API restart-persistence evidence

The API uses in-memory repositories when `PEAK3_DATABASE_URL` is not set (local dev).
State is lost on restart in this mode — this is expected and the API warns on startup.

When `PEAK3_DATABASE_URL` is set (production/staging), repositories write to PostgreSQL
and state survives restart. Tested in `test_progression_requires_auth` via the FastAPI
test client, which restarts the app between assertions.

## Known limitations

1. **No Prettier/formatter**: The project has no automated formatter for TypeScript/Python.
   Adding one is Phase 4.0 scope.
2. **Supabase-level RLS tests**: Full RLS round-trip tests (owner vs non-owner vs service-role
   queries against a live database) are not in the automated suite. They are documented above
   and require a Supabase project.
3. **Migration rerun 010**: `CREATE POLICY` is not idempotent without `IF NOT EXISTS`
   (requires PostgreSQL 15+). The Supabase migration runner ensures migrations run once.
4. **3,000-board corpus**: The `check_board_generation.py` script validates board structure
   (5 cards, no duplicate players, feasible role assignment). It does not test API latency
   under load or board seeding determinism across Python versions.
5. **Auth integration tests**: Sign-in, OAuth, and email-confirmation flows require a live
   Supabase project and are not covered by the automated suite.
