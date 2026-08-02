#!/usr/bin/env bash
#
# The FastAPI unit suite — the ONE definition, used by CI and by developers.
#
# Two things are made explicit rather than left to the environment:
#
#   PEAK3_TEST_REPOSITORY_MODE=memory
#       tests/conftest.py turns off dotenv loading and drops any inherited
#       PEAK3_DATABASE_URL, then asserts at startup that the app really did
#       resolve to in-memory repositories. Without this the backend depended on
#       whether the developer happened to have an untracked apps/api/.env.
#
#   -m "not supabase_integration" --ignore=tests/integration
#       the real-Postgres tests are DESELECTED, not run-and-skipped, so this
#       suite's skip count stays a signal rather than noise. They run for real
#       in scripts/ci/api-integration-tests.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

require_generated_data

export PEAK3_TEST_REPOSITORY_MODE=memory

step "FastAPI unit tests (explicit in-memory repositories)"
cd "$REPO_ROOT/apps/api"
"$PYTHON_BIN" -m pytest tests/ -v --tb=short \
  --ignore=tests/integration \
  -m "not supabase_integration" "$@"
