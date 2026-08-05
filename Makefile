# PEAK3 Arena — developer commands
# Run from the repository root

.PHONY: help install install-api install-web \
        build-dataset build-card-profiles build-game-data \
        api web dev \
        test test-model test-api test-api-integration test-lineup test-web test-card-profiles \
        test-integration-local validate-migrations \
        test-e2e test-accessibility \
        test-board-generation validate-board-generation-full \
        build lint typecheck verify-frontend \
        verify-game-data verify-fresh \
        test-fast test-full

# One developer's absolute miniforge path used to be hardcoded here, which
# meant no one else — and no CI runner — could use this Makefile at all.
# Override with `make PYTHON=/path/to/python ...` or by exporting PYTHON.
PYTHON ?= python3
NODE   := node
NPM    := npm

# The checked-in commands CI runs. Every target below that has a CI equivalent
# calls the script rather than restating it, so the two cannot drift — which
# they had: `make test-api` ran `pytest tests/` while CI ran the same suite
# with `--ignore=tests/integration -m "not supabase_integration"`, so a green
# `make test-api` was a claim about a different set of tests.
CI_SCRIPTS := scripts/ci

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
RESET  := \033[0m

help:
	@echo ""
	@echo "  $(GREEN)PEAK3 Arena$(RESET) — development commands"
	@echo ""
	@echo "  $(YELLOW)Setup$(RESET)"
	@echo "  make install       Install all dependencies (model + api + web)"
	@echo "  make install-api   Install FastAPI dependencies"
	@echo "  make install-web   Install Next.js dependencies"
	@echo ""
	@echo "  $(YELLOW)Data$(RESET)"
	@echo "  make build-dataset              Build data/web/ JSON from committed leaderboard CSVs"
	@echo "  make build-card-profiles        Build data/game/profiles/ (card profiles v2)"
	@echo "  make build-game-data            Build all game data (dataset + card profiles)"
	@echo ""
	@echo "  $(YELLOW)Development$(RESET)"
	@echo "  make api           Run FastAPI (port 8000)"
	@echo "  make web           Run Next.js dev server (port 3000)"
	@echo "  make dev           Print instructions for running both"
	@echo ""
	@echo "  $(YELLOW)Testing — fast (no browser)$(RESET)"
	@echo "  make test-model                 Canonical PEAK3 model tests"
	@echo "  make test-lineup                Experimental lineup model unit tests"
	@echo "  make test-card-profiles         Card profile builder invariants"
	@echo "  make test-api                   FastAPI unit tests (in-memory repositories)"
	@echo "  make test-api-integration       FastAPI Postgres/Supabase tests (needs a test project)"
	@echo "  make test-integration-local     Same suite against a local 'supabase start' stack (no secrets)"
	@echo "  make validate-migrations        Migration chain checks + inventory drift"
	@echo "  make test-web                   Frontend unit tests (vitest)"
	@echo "  make test-board-generation      Quick board smoke check (25 seeds × 3 modes)"
	@echo "  make validate-board-generation-full  Full 3000-board corpus"
	@echo ""
	@echo "  $(YELLOW)Testing — browser$(RESET)"
	@echo "  make test-e2e                   Playwright e2e (auto-starts API + web)"
	@echo "  make test-accessibility         Axe accessibility tests only"
	@echo ""
	@echo "  $(YELLOW)Quality$(RESET)"
	@echo "  make lint          Run frontend linter"
	@echo "  make typecheck     Run TypeScript type check"
	@echo "  make build         Build frontend production bundle"
	@echo "  make verify-frontend  Everything the CI frontend job runs"
	@echo ""

install: install-api install-web
	@echo "$(GREEN)✓ All dependencies installed$(RESET)"

install-api:
	@echo "Installing API dependencies..."
	@pip install -r apps/api/requirements.txt -q
	@echo "$(GREEN)✓ API dependencies installed$(RESET)"

install-web:
	@echo "Installing web dependencies..."
	@cd apps/web && $(NPM) install --legacy-peer-deps --silent
	@echo "$(GREEN)✓ Web dependencies installed$(RESET)"

# ── Data ─────────────────────────────────────────────────────────────────────

# EVERY GENERATOR THAT WRITES INTO data/web/ BELONGS HERE, for the same reason
# they all belong in the Dockerfile's build step: `data/web/` is gitignored, so
# this target is the only way a developer gets any of it. The fact bank was
# added to CI and to the image but not to this target, which meant `make
# build-dataset` produced an API that 503s on /api/v1/nba-facts/today.
build-dataset:
	@echo "Building web dataset from leaderboard CSVs..."
	@$(PYTHON) scripts/build_web_dataset.py
	@echo "Building the NBA Fact of the Day bank..."
	@$(PYTHON) scripts/build_nba_facts.py
	@echo "$(GREEN)✓ Dataset built in data/web/$(RESET)"

build-card-profiles:
	@echo "Building card profiles v3 for Draft Arena..."
	@$(PYTHON) scripts/build_card_profiles.py
	@echo "$(GREEN)✓ Card profiles v3 built in data/game/profiles/$(RESET)"

build-game-data:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/build-web-data.sh
	@echo "$(GREEN)✓ All game data built$(RESET)"

# ── Services ─────────────────────────────────────────────────────────────────

api:
	@echo "Starting FastAPI on http://localhost:8000"
	@cd apps/api && uvicorn app.main:app --reload --port 8000

web:
	@echo "Starting Next.js on http://localhost:3000"
	@cd apps/web && $(NPM) run dev

dev:
	@echo ""
	@echo "Run these in separate terminals:"
	@echo ""
	@echo "  Terminal 1 (API):"
	@echo "    cd apps/api && uvicorn app.main:app --reload"
	@echo ""
	@echo "  Terminal 2 (Web):"
	@echo "    cd apps/web && npm run dev"
	@echo ""

# ── Testing — unit/integration ────────────────────────────────────────────────

test: test-model test-lineup test-api test-web
	@echo "$(GREEN)✓ All unit/integration tests complete$(RESET)"

# Alias for CI fast suite (no playwright)
test-fast: test-model test-lineup test-board-generation test-api test-web
	@echo "$(GREEN)✓ Fast test suite complete (no Playwright)$(RESET)"

# Full suite: all tests + playwright + accessibility
test-full: test-fast test-e2e
	@echo "$(GREEN)✓ Full test suite complete (including Playwright)$(RESET)"

test-model:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/model-tests.sh

test-lineup:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/lineup-tests.sh

test-card-profiles:
	@echo "Running card profile builder invariants..."
	@$(PYTHON) scripts/build_card_profiles.py

test-api:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/api-unit-tests.sh

test-api-integration:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/api-integration-tests.sh

# The same 95 tests as test-api-integration, but provisioned against a local
# `supabase start` stack instead of requiring hosted test-project secrets —
# which is why this one is runnable on a laptop and in CI without any secret.
# It delegates to api-integration-tests.sh above rather than restating the
# suite. Non-destructive by default: `supabase db reset` is opt-in via
# PEAK3_CI_SUPABASE_RESET=1, which CI sets and this target does not.
test-integration-local:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/supabase-local-integration.sh

test-web:
	@echo "Running frontend unit tests..."
	@cd apps/web && $(NPM) run test

test-board-generation:
	@echo "Checking board generation (25 seeds × 3 modes)..."
	@$(PYTHON) scripts/check_board_generation.py 25

validate-board-generation-full:
	@echo "Running full 3,000-board corpus (1000 seeds × 3 modes)..."
	@$(PYTHON) scripts/check_board_generation.py 1000
	@echo "$(GREEN)✓ 3000-board corpus passed$(RESET)"

# ── Testing — browser (Playwright auto-starts both services) ──────────────────

test-e2e:
	@echo "Running Playwright e2e tests (auto-starts FastAPI + Next.js)..."
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/e2e-tests.sh
	@echo "$(GREEN)✓ Playwright e2e complete$(RESET)"

test-accessibility:
	@echo "Running axe accessibility tests..."
	@cd apps/web && $(NPM) run test:e2e:accessibility
	@echo "$(GREEN)✓ Accessibility tests complete$(RESET)"

# ── Quality ───────────────────────────────────────────────────────────────────

lint:
	@cd apps/web && $(NPM) run lint -- --max-warnings 0

typecheck:
	@cd apps/web && $(NPM) run typecheck

build:
	@cd apps/web && $(NPM) run build

# Exactly what the CI "Frontend" job runs: typecheck, lint at zero warnings,
# vitest, and a production build from a clean .next.
verify-frontend:
	@$(CI_SCRIPTS)/frontend-verify.sh

# ── Verification ──────────────────────────────────────────────────────────────

# Exactly what the CI "Migration chain validation + inventory drift" job runs:
# the static cross-file checks, then a regeneration of
# supabase/migrations/MIGRATION_INVENTORY.{json,md} that fails if the committed
# copies have drifted from the migration files.
validate-migrations:
	@PYTHON=$(PYTHON) $(CI_SCRIPTS)/migration-validate.sh

verify-game-data:
	@echo "Verifying generated game data exists..."
	@test -f data/web/peak_windows.json || (echo "$(YELLOW)MISSING data/web/peak_windows.json$(RESET)" && exit 1)
	@test -f data/web/leaderboards.json || (echo "$(YELLOW)MISSING data/web/leaderboards.json$(RESET)" && exit 1)
	@test -f data/game/profiles/card_profiles.v3.json || (echo "$(YELLOW)MISSING card_profiles.v3.json — run make build-card-profiles$(RESET)" && exit 1)
	@test -f data/game/profiles/profile_metadata.v3.json || (echo "$(YELLOW)MISSING profile_metadata.v3.json — run make build-card-profiles$(RESET)" && exit 1)
	@echo "$(GREEN)✓ All required game data present$(RESET)"

verify-fresh: build-game-data verify-game-data test-fast
	@echo "$(GREEN)✓ Fresh build verified end-to-end$(RESET)"
