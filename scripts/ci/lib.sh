#!/usr/bin/env bash
#
# Shared helpers for the checked-in CI/local commands in this directory.
#
# WHY THIS DIRECTORY EXISTS. Every command CI runs used to be spelled out
# inline in .github/workflows/ci.yml, and a second, different spelling of the
# same command lived in the Makefile. They drifted, silently and in the
# direction that matters: `make test-api` ran `pytest tests/`, while CI ran
# `pytest tests/ --ignore=tests/integration -m "not supabase_integration"`, so
# "green locally" and "green in CI" were claims about two different sets of
# tests. Both callers now source the same file, so there is exactly one
# definition of what each check is.
#
# These scripts are POSIX-ish bash, run from the repository root, and take no
# arguments beyond what is documented in each one.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export REPO_ROOT

# Prefer an explicit interpreter, then the active venv, then whatever is on
# PATH. The Makefile used to hardcode one developer's miniforge path, which
# meant nobody else could run it and CI could not run it at all.
PYTHON_BIN="${PYTHON:-${PYTHON_BIN:-python3}}"
export PYTHON_BIN

step() { printf '\n\033[0;33m── %s\033[0m\n' "$*"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$*"; }

die() {
  printf '\n\033[0;31m✗ %s\033[0m\n\n' "$1" >&2
  exit 1
}

# Fail in seconds, with one sentence, when a generated artefact the caller
# needs is absent — rather than as a few hundred downstream errors that all
# share one cause.
require_generated_data() {
  local missing=()
  [ -s "$REPO_ROOT/data/web/peak_windows.json" ] || missing+=("data/web/peak_windows.json")
  [ -s "$REPO_ROOT/data/web/leaderboards.json" ] || missing+=("data/web/leaderboards.json")
  [ -s "$REPO_ROOT/data/game/profiles/card_profiles.v3.json" ] || missing+=("data/game/profiles/card_profiles.v3.json")

  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing generated data: ${missing[*]}
  data/web/ is deliberately not committed (CLAUDE.md, 'Data export rules').
  Build it with:  scripts/ci/build-web-data.sh"
  fi
}

require_free_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -ti ":$port" >/dev/null 2>&1; then
    die "Port $port is already in use.
  The E2E run starts its own API and Next.js servers, and a stale process from
  an earlier run will be reused instead — which is how a passing suite can be
  testing code that is no longer in the working tree.
  Clear it with:  (cd apps/web && node scripts/kill-ports.js)"
  fi
}
