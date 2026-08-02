#!/usr/bin/env bash
#
# The real-Postgres / Supabase half. Requires an isolated test project — never
# a shared or production one. Every test here is marked `supabase_integration`
# and skips with an explicit "not configured" reason when the secrets are
# absent, so a missing configuration is never reported as a pass.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

export PEAK3_TEST_REPOSITORY_MODE="${PEAK3_TEST_REPOSITORY_MODE:-memory}"

step "Supabase / Postgres integration tests"
cd "$REPO_ROOT/apps/api"
"$PYTHON_BIN" -m pytest tests/integration/ tests/test_repository_conformance.py \
  -m supabase_integration -v --tb=short "$@"
