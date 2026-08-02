#!/usr/bin/env bash
#
# Build every generated artefact the API, the model tests and the browser
# tests read: data/web/ (from the committed leaderboard CSVs) and
# data/game/profiles/ (card profiles v3). No network access; see
# CLAUDE.md, "Data export rules".
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$REPO_ROOT"

step "Building data/web/ from committed leaderboard CSVs"
"$PYTHON_BIN" scripts/build_web_dataset.py

step "Building card profiles v3"
"$PYTHON_BIN" scripts/build_card_profiles.py

require_generated_data
ok "Generated data present"
