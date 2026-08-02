# CLAUDE.md — PEAK3 Arena

## Product mission
PEAK3 Arena transforms the PEAK3 NBA peak-evaluation engine into a global basketball analytics game. Phase 1 ships Peak Duel: a daily 10-question challenge and endless mode comparing player peak windows using real PEAK3 data.

## Repository architecture

```
/                     # Python model (authoritative — do not modify scoring)
  peak3.py            # Core model: calibrate_score, OFFICIAL_WEIGHTS, n_year_windows
  nba_peak/           # Scoring modules, leaderboard builders, CLI
  leaderboards/       # Committed CSV canonical rankings (top_250_*_year_prime.csv)
  data/generated/     # Committed candidate universe and parquet context
  data/web/           # GENERATED: JSON files for the API (run scripts/build_web_dataset.py)
  tests/              # model tests — must always pass
  scripts/            # build_web_dataset.py — offline exporter

apps/
  api/                # FastAPI — read-only, serves pre-generated data
  web/                # Next.js App Router — game UI
docs/
  architecture/
  game-design/
  model/               # SCORING_METHODOLOGY.md, POSTSEASON_TEAM_AUDIT.md
  implementation/     # PHASE_1_AUDIT.md, PHASE_1_REPORT.md
```

## Authoritative model rules

**Never change these without explicit approval and passing regression evidence:**
- `OFFICIAL_WEIGHTS` in `peak3.py`: statistical_impact=0.38, traditional_production=0.21, recognition=0.20, postseason=0.18, team_achievement=0.03
- `calibrate_score()` — the monotonic display score remapping
- The leaderboard CSV files in `leaderboards/`

**Never do these:**
- Calculate PEAK3 scores in TypeScript/Next.js
- Trigger Basketball Reference scraping during a web request
- Hardcode famous players or hand-pick winners
- Replace missing data with fabricated values
- Call game scoring "peak_score" — use `arena_points` instead

## Commands

```bash
# Setup
pip install -r requirements.txt          # model deps
pip install -r apps/api/requirements.txt # API deps
cd apps/web && npm install               # frontend deps

# Build data (required before running API)
python scripts/build_web_dataset.py

# Run services
cd apps/api && uvicorn app.main:app --reload    # API: localhost:8000
cd apps/web && npm run dev                       # Web: localhost:3000

# Test — CI runs these EXACT scripts; call them, do not restate them
scripts/ci/model-tests.sh                # model
scripts/ci/api-unit-tests.sh             # FastAPI, explicit in-memory repositories
scripts/ci/api-integration-tests.sh      # FastAPI against a real Postgres/Supabase test project
scripts/ci/frontend-verify.sh            # typecheck + lint (0 warnings) + vitest + production build
scripts/ci/e2e-tests.sh                  # Playwright + axe (starts its own services)
scripts/ci/build-web-data.sh             # generate data/web/ + card profiles v3

# Or use Make (thin wrappers over the same scripts):
make test                                # all non-browser tests
make build-dataset                       # generate data/web/
make api && make web                     # run services
```

`.github/workflows/ci.yml` and the Makefile both call `scripts/ci/*.sh`, so
"green locally" and "green in CI" are claims about the same commands. Adding a
check means editing the script, not the YAML. Two configuration choices are
made inside those scripts rather than left to the environment, because both
used to differ silently between a laptop and a clean checkout:

- `PEAK3_TEST_REPOSITORY_MODE=memory` for the API unit suite — dotenv loading
  is disabled and an inherited `PEAK3_DATABASE_URL` is dropped, then the
  resolved backend is asserted once at startup.
- `NEXT_PUBLIC_PEAK3_E2E_AUTH=1` (via `npm run dev:e2e`) for the browser suite
  — renders the account surface with no hosted Supabase project, constructs no
  client, and folds away entirely in a production build.

## Testing expectations

- **Python model tests** (`tests/`): must always pass. Never weaken assertions or change expected values.
- **FastAPI/API tests** (`apps/api/tests/`): must always pass.
- **API regression tests**: verify web dataset matches canonical CSVs for rank 1 of all durations and top-10 ordering.
- **Frontend unit tests**: game reducer state transitions, progress persistence, share text, Daily Grid streak/archive.
- **Playwright e2e**: landing page, navigation, rankings, methodology accordion.

## Design principles

- Arena atmosphere: dark, warm gold accent (`--peak-accent: #f5c842`), court-line geometry
- Premium analytics publication feel — not a sports betting app
- No player photographs, no NBA/team logos (unlicensed)
- Results explained through actual component differences, not prose opinion
- "PEAK3 rates…", "the model gives…" — never claim objective historical truth

## Component color tokens

- Statistical Impact: `--comp-si: #60a5fa` (blue)
- Traditional Production: `--comp-tp: #a78bfa` (violet)
- Individual Recognition: `--comp-rec: #f472b6` (pink)
- Playoff Rate Impact: `--comp-po: #fb923c` (orange)
- Team Result: `--comp-team: #34d399` (emerald)
- Teammate Adj: `--comp-tm: #94a3b8` (slate)

## Naming conventions

- `arena_points` — game scoring (never `peak_score`)
- `prime_score` — calibrated 0-100 display value (from API)
- `prime_index` — raw ordering index (from API)
- Player slugs: lowercase, hyphens, no apostrophes, ASCII-folded (e.g., `michael-jordan`)
- Window IDs: `{player_slug}-{n}yr-{anchor_nodash}` (e.g., `michael-jordan-1yr-199091`)

## Data export rules

- The authoritative source is `leaderboards/*.csv` (committed)
- `scripts/build_web_dataset.py` reads from those CSVs — no network access
- `data/web/` is re-generated; do NOT commit it in Phase 1 (gitignored)
- The exporter validates: no NaN/Inf, no duplicate IDs, rank-1 regression
- `cache/processed/` is gitignored; needed to REBUILD leaderboards from scratch

## Features intentionally deferred (Phase 2+)

- Supabase / user accounts
- Global user leaderboards
- Friends and social feeds
- Live NBA scores
- Player photographs
- Native mobile apps
- AI-generated player commentary
- Payments

## Security

- HMAC session token secret: `PEAK3_SIGNING_SECRET` env var
- Never commit `.env` files; use `.env.example`
- localStorage scores are not cheat-proof and not eligible for global ranking
- No server-side answer storage in Phase 1 (stateless sessions)

## Phase 1 known limitations

- No user accounts; progress is localStorage only
- `data/web/` not committed; must run `make build-dataset` after cloning
- No Playwright browser tests without running API (API-dependent tests skip gracefully)
- 4-year peak window not implemented (model supports 1,2,3,5 only)

## Product blueprint

The complete product and implementation blueprint is:

`docs/product/PEAK3_Product_Implementation_Blueprint.pdf`

The page and visual-reference index is:

`docs/product/PEAK3_BLUEPRINT_INDEX.md`

Important exported diagrams are stored under:

`docs/product/blueprint-assets/`

Before substantial work involving product structure, gameplay, navigation, design, competition, formula exploration, or architecture, review the relevant blueprint section and diagram.

The blueprint defines product intent. Current code, schemas, tests, versioned model documentation, and phase reports define implemented behavior. Do not fabricate data or silently alter validated model behavior merely to match an older visual concept.
