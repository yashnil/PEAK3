#!/usr/bin/env bash
#
# Playwright + axe. Playwright starts both services itself (playwright.config.ts
# webServer), so the ports must be free and the generated data must exist first
# — both are checked here, in seconds, rather than discovered as a wall of
# element-not-found failures half an hour in.
#
# The frontend is started through `npm run dev:e2e`, which sets
# NEXT_PUBLIC_PEAK3_E2E_AUTH=1 so the account surface renders with no hosted
# Supabase project. playwright.setup.ts re-checks that against the running
# server rather than trusting the flag.
#
# The feature flags below are the ones the API refuses to serve without; each
# is a dev/test value and none is a real secret. PEAK3_SUPABASE_JWT_SECRET and
# PEAK3_TEST_JWT_SECRET must match — the suite signs test JWTs with the second
# and the API verifies them with the first.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

require_generated_data
require_free_port 3000
require_free_port 8000

export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
export PEAK3_RANKED_ENABLED=true
export PEAK3_RANKED_MATCHMAKING_ENABLED=true
export PEAK3_RANKED_RATING_WRITES_ENABLED=true
export PEAK3_RANKED_READINESS_LEVEL=internal_alpha
export PEAK3_SUPABASE_JWT_SECRET="${PEAK3_TEST_JWT_SECRET:-e2e-ranked-test-secret-do-not-use-in-prod}"
export PEAK3_TEST_JWT_SECRET="$PEAK3_SUPABASE_JWT_SECRET"
export PEAK3_COURTBUILDER_ENABLED=true
export PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true
export PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev
export PEAK3_COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=true
# THE 82-0 LEADERBOARD IS OFF FOR THIS SUITE, AND IT IS DECLARED RATHER THAN
# LEFT UNSET. It was unset, which meant the API took its value from whatever
# `apps/api/.env` happened to say — so a developer who enabled the board
# locally broke `leaderboard page says the board is not open when the feature
# is off` while a clean checkout passed it. That is exactly the laptop-versus-
# checkout divergence this file's other two exports exist to prevent (see
# CLAUDE.md on PEAK3_TEST_REPOSITORY_MODE and NEXT_PUBLIC_PEAK3_E2E_AUTH).
#
# The suite covers BOTH postures: the disabled state needs the real API to
# report `leaderboard_enabled: false`, and the populated and failed states are
# driven by network fixtures, so they hold either way.
export PEAK3_COURTBUILDER_LEADERBOARD_ENABLED=false

# The Arena's multiplayer modes. Ratings and the public leaderboard stay OFF --
# they are deliberately not part of this release, and the browser suite must not
# be the thing that quietly turns them on. `closed_alpha` with an EMPTY
# allowlist is "any signed-in account", which is what the suite's test JWTs are.
export PEAK3_ARENA_ENABLED=true
export PEAK3_ARENA_PUBLIC_QUEUE_ENABLED=true
export PEAK3_ARENA_BOTS_ENABLED=true
export PEAK3_ARENA_READINESS_LEVEL=closed_alpha

step "Playwright browser tests + axe accessibility"
cd "$REPO_ROOT/apps/web"
PLAYWRIGHT_RETRIES="${PLAYWRIGHT_RETRIES:-0}" npx playwright test "$@"
