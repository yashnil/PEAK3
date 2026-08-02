#!/usr/bin/env bash
#
# Experimental lineup model tests. Needs the v3 card profiles.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

require_generated_data

step "Lineup model tests"
"$PYTHON_BIN" -m pytest tests/lineup/ -v --tb=short
