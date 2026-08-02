#!/usr/bin/env bash
#
# The canonical PEAK3 model suite. `tests/lineup` is the experimental lineup
# model and runs separately (scripts/ci/lineup-tests.sh).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

require_generated_data

# actions/checkout materialises every file at roughly the same time, in
# whatever order git writes blobs. peak3.py invalidates its scored cache by
# comparing mtimes, so checkout ordering alone can make the cache look stale
# and trigger a network-less rebuild mid-run. Touching it last cannot.
if [ -f cache/processed/scored_1980_2026.parquet ]; then
  touch cache/processed/scored_1980_2026.parquet
fi

step "Model tests"
"$PYTHON_BIN" -m pytest tests/ -v --tb=short --ignore=tests/lineup
