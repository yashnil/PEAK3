# PEAK3 Arena — Web Architecture

## Overview

PEAK3 Arena uses a three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│  Python Model (read-only, authoritative)                    │
│  peak3.py + nba_peak/ + leaderboards/*.csv                  │
└─────────────────────────────────────────────────────────────┘
                           │
                    scripts/build_web_dataset.py
                    (offline, deterministic, no network)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  data/web/   (JSON artifacts)                               │
│  leaderboards.json | metadata.json | methodology.json       │
│  peak_windows.json                                          │
└─────────────────────────────────────────────────────────────┘
                           │
                    FastAPI loads once at startup
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/api/   (FastAPI — read-only)                          │
│  Stateless HMAC sessions | Duel generation | Arena points   │
└─────────────────────────────────────────────────────────────┘
                           │
                      HTTP/JSON
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/web/   (Next.js App Router)                           │
│  Game UI | Rankings | Methodology Explorer                  │
└─────────────────────────────────────────────────────────────┘
                           │
                      localStorage
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Guest progress  (LocalProgressRepository)                  │
│  Daily completions | High scores | Streaks                  │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Build time (offline, no network)
1. `scripts/build_web_dataset.py` reads `leaderboards/*.csv`
2. Normalizes to typed JSON with player slugs and window IDs
3. Validates: no NaN, no duplicates, rank-1 regression
4. Writes `data/web/{leaderboards,metadata,methodology,peak_windows}.json`

### API startup
1. `DatasetStore.load()` reads all JSON files into memory
2. Validates schema; raises `RuntimeError` if data missing or invalid
3. Subsequent requests served from in-memory cache (no disk I/O per request)

### Game session (daily challenge)
1. Client calls `GET /api/v1/game/daily?years=3`
2. API generates 10 duels deterministically from UTC date + years seed
3. Returns `DailyGameResponse` with public duel cards (no scores) + HMAC session token
4. Token payload: mode, date, years, list of `{id, left_id, right_id}`, exp
5. Client stores session_token in React state (never in localStorage)

### Answer submission
1. Client calls `POST /api/v1/game/answer` with token + duel_id + selected_peak_id + timing
2. API verifies token (signature + expiry + duel membership)
3. Looks up both peaks in dataset; computes arena_points + explanation
4. Returns full reveal data (scores, components, explanation)
5. Client updates game reducer state; persists answer to localStorage via `LocalProgressRepository`

## Security Properties

- Session tokens are HMAC-SHA256 signed
- Correct answers are NOT in the initial duel payload (verified by test)
- Signing secret lives only server-side (env var)
- No server-side session storage needed (stateless)
- LocalStorage progress is explicitly noted as non-cheat-proof

## Key Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Game state | `useReducer` + explicit actions | Simple, testable, no library needed |
| Progress | `LocalProgressRepository` | Abstracted for future auth replacement |
| Animations | Motion (Framer Motion) | Purposeful reveals, respects reduced-motion |
| Styling | Tailwind CSS v4 | Design tokens via CSS custom properties |
| API sessions | Stateless HMAC | No database in Phase 1 |
| Data source | Static JSON | Fast, no DB cost, deterministic |
| Fonts | Next.js Google Fonts (Inter + Syne) | Self-hosted, no external request |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness probe |
| GET | /health/readiness | Dataset loaded check |
| GET | /api/v1/meta | Dataset metadata |
| GET | /api/v1/leaderboards | Paginated + searchable rankings |
| GET | /api/v1/players/search | Player name search |
| GET | /api/v1/players/{slug} | Player all-duration windows |
| GET | /api/v1/methodology | Structured formula data |
| GET | /api/v1/game/daily | Deterministic daily challenge |
| GET | /api/v1/game/endless | Random-seeded endless session |
| POST | /api/v1/game/answer | Submit answer, receive reveal |

## Adding Authentication (Phase 2)

The `LocalProgressRepository` class implements a simple interface (`load`, `save`, `recordAnswer`, `recordDailyCompletion`, `reset`). A `RemoteProgressRepository` can implement the same interface backed by Supabase or another store. The game components receive the repository via dependency injection.

The stateless HMAC token design allows future per-user sessions without changing the token format — only the secret management and user_id claim need adding.
