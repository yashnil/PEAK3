# PEAK3 Arena — developer commands
# Run from the repository root

.PHONY: help install install-api install-web \
        build-dataset build-card-profiles build-game-data \
        api web dev \
        test test-model test-api test-lineup test-web test-card-profiles \
        test-e2e test-accessibility \
        test-board-generation validate-board-generation-full \
        build lint typecheck \
        verify-game-data verify-fresh \
        test-fast test-full

PYTHON := /Users/yashnilmohanty/miniforge3/bin/python3
NODE   := node
NPM    := npm

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
	@echo "  make test-model                 186 canonical model tests"
	@echo "  make test-lineup                Experimental lineup model unit tests"
	@echo "  make test-card-profiles         Card profile builder invariants"
	@echo "  make test-api                   FastAPI integration tests"
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

build-dataset:
	@echo "Building web dataset from leaderboard CSVs..."
	@$(PYTHON) scripts/build_web_dataset.py
	@echo "$(GREEN)✓ Dataset built in data/web/$(RESET)"

build-card-profiles:
	@echo "Building card profiles v2 for Draft Arena..."
	@$(PYTHON) scripts/build_card_profiles.py
	@echo "$(GREEN)✓ Card profiles v2 built in data/game/profiles/$(RESET)"

build-game-data: build-dataset build-card-profiles
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
	@echo "Running PEAK3 model tests (186 required)..."
	@$(PYTHON) -m pytest tests/ -v --tb=short --ignore=tests/lineup

test-lineup:
	@echo "Running lineup model unit tests..."
	@$(PYTHON) -m pytest tests/lineup/ -v --tb=short

test-card-profiles:
	@echo "Running card profile builder invariants..."
	@$(PYTHON) scripts/build_card_profiles.py

test-api:
	@echo "Running API tests (92 required, 0 skipped)..."
	@cd apps/api && $(PYTHON) -m pytest tests/ -v --tb=short

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
	@cd apps/web && $(NPM) run test:e2e
	@echo "$(GREEN)✓ Playwright e2e complete$(RESET)"

test-accessibility:
	@echo "Running axe accessibility tests..."
	@cd apps/web && $(NPM) run test:e2e:accessibility
	@echo "$(GREEN)✓ Accessibility tests complete$(RESET)"

# ── Quality ───────────────────────────────────────────────────────────────────

lint:
	@cd apps/web && $(NPM) run lint

typecheck:
	@cd apps/web && $(NPM) run typecheck

build:
	@cd apps/web && $(NPM) run build

# ── Verification ──────────────────────────────────────────────────────────────

verify-game-data:
	@echo "Verifying generated game data exists..."
	@test -f data/web/peak_windows.json || (echo "$(YELLOW)MISSING data/web/peak_windows.json$(RESET)" && exit 1)
	@test -f data/web/leaderboards.json || (echo "$(YELLOW)MISSING data/web/leaderboards.json$(RESET)" && exit 1)
	@test -f data/game/profiles/card_profiles.v2.json || (echo "$(YELLOW)MISSING card_profiles.v2.json — run make build-card-profiles$(RESET)" && exit 1)
	@test -f data/game/profiles/profile_metadata.v2.json || (echo "$(YELLOW)MISSING profile_metadata.v2.json — run make build-card-profiles$(RESET)" && exit 1)
	@echo "$(GREEN)✓ All required game data present$(RESET)"

verify-fresh: build-game-data verify-game-data test-fast
	@echo "$(GREEN)✓ Fresh build verified end-to-end$(RESET)"
