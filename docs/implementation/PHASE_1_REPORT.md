# PEAK3 Arena — Phase 1 Implementation Report

## What was implemented

### Core infrastructure
- `scripts/build_web_dataset.py` — deterministic offline exporter. Reads committed `leaderboards/*.csv` → `data/web/*.json`. Validates NaN, duplicates, rank-1 regression.
- `data/web/` — generated JSON dataset: `leaderboards.json` (984 peak windows across 4 durations), `metadata.json`, `methodology.json`, `peak_windows.json`

### FastAPI application (`apps/api/`)
- Versioned read-only API at `/api/v1/`
- HMAC-SHA256 stateless session tokens (no database required)
- In-memory dataset cache loaded once at startup
- Endpoints: health, readiness, meta, leaderboards, player search, player profile, methodology, game/daily, game/endless, game/answer
- Duel generation: deterministic seeding, difficulty tiering, all pairing invariants
- Arena points: base + closeness + speed bonus × streak multiplier
- Deterministic explanation generation from component differences
- **53 tests pass** (45 existing + 8 regression tests)

### Next.js web application (`apps/web/`)
- App Router, strict TypeScript, Tailwind CSS v4
- Routes: `/`, `/play/daily`, `/play/endless`, `/rankings`, `/players/[slug]`, `/methodology`, `/about`
- Game engine with `useReducer` state machine
- Keyboard support (A/D/←/→ to choose, Enter to advance)
- Animated reveal with component comparison bars (Motion)
- LocalProgressRepository — localStorage with schema versioning and corruption recovery
- Formula explorer with accessible accordion (keyboard, ARIA)
- Share result with Web Share API + clipboard fallback
- **24 unit tests pass**
- **Production build passes (0 errors)**
- **TypeScript type check: clean**

### CI (`/.github/workflows/ci.yml`)
- 4 jobs: model-tests, web-dataset, api-tests, frontend
- Frontend job: typecheck + unit tests + production build

## Architecture decisions

| Decision | Rationale |
|----------|-----------|
| Read committed CSVs, not re-run model | No need for `cache/processed/` at build time; model output is already deterministic and committed |
| Stateless HMAC sessions | No database in Phase 1; scales naturally; answers never in initial payload |
| `useReducer` game state | Explicit, testable, no dependency; easy to trace |
| `LocalProgressRepository` interface | Drops in for a `RemoteProgressRepository` in Phase 2 |
| Motion (not CSS-only) for reveals | Score reveal requires coordinated multi-element animation with spring physics |
| Tailwind CSS v4 with CSS custom properties | Design tokens persist in CSS, usable in inline styles for component colors |

## Data limitations discovered

1. **`cache/processed/` is gitignored** — `scored_1980_2026.parquet` is not committed. The web dataset is built from committed `leaderboards/*.csv` which have all needed fields (rank, raw, display, components). Full rebuild from raw HTML requires this cache.

2. **4-year window not supported** — The model supports 1, 2, 3, 5 years. No `top_250_4_year_prime.csv` exists. The UI correctly limits to [1,2,3,5].

3. **Component breakdown is averaged for multi-year** — Multi-year CSV columns are prefixed `Avg ` (e.g., `Avg SI contribution`). This represents the rank-weighted average across the window seasons, which is the correct unit for comparison.

4. **Player images not included** — No licensed player photographs. Visual identity is achieved through typography, season labels, rank numbers, and component colors.

## Exact commands verified

```bash
# Build dataset
python scripts/build_web_dataset.py
# → 250/249/248/237 windows for 1/2/3/5yr, 984 total, all validated

# Model tests (from repo root)
python -m pytest tests/ -v
# → 186 passed in 304s

# API tests
cd apps/api && python -m pytest tests/ -v
# → 53 passed in 0.14s

# Frontend unit tests
cd apps/web && npm run test
# → 24 passed in 554ms

# TypeScript
cd apps/web && npm run typecheck
# → clean (no output)

# Production build
cd apps/web && npm run build
# → ✓ 9 static pages, 0 errors

# API liveness (with API running)
curl http://localhost:8000/health
# → {"status":"ok","service":"peak3-arena-api","version":"1.0.0"}

# Daily challenge
curl "http://localhost:8000/api/v1/game/daily?years=3"
# → 10 duels, no scores in payload, session_token present
```

## Known risks and limitations

1. **`data/web/` not committed** — users must run `make build-dataset` after clone. The CI pipeline does this automatically via artifact passing.
2. **No Playwright tests run in CI** — they require both API and web app running; smoke tests are defined but need a separate CI stage with both services.
3. **Local scores are not cheat-proof** — explicitly documented; not eligible for a global leaderboard.
4. **API signing secret defaults to insecure dev value** — warned at startup; documented in `.env.example`.
5. **CORS is permissive in debug mode** — must be configured for production deployment.

## Recommended Phase 2 target

**Add authentication and global leaderboards.**

Implement `RemoteProgressRepository` backed by Supabase with:
- User registration and login (magic link or OAuth)
- Server-verified daily scores (the API already produces signed session tokens; link them to authenticated users)
- Global daily leaderboard endpoint
- Friend leaderboards
- Persistent streak (currently resets on browser clear)

This is the most direct path from "fun local game" to "competitive platform" without changing the basketball model, the game design, or the UI significantly.
