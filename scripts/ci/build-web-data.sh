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

step "NBA Fact of the Day bank"
# Offline and deterministic: one committed JSON in, one sorted bank out. Built
# here rather than at request time so the homepage reads a small precomputed
# payload and does no analysis per visitor.
"$PYTHON_BIN" scripts/build_nba_facts.py

step "Building card profiles v3"
"$PYTHON_BIN" scripts/build_card_profiles.py

step "Career-window artifact is current (Prime Cut / Find the Prime)"
# COMMITTED, not regenerated here: data/game/prime_modes/career_windows.v1.json
# is an immutable, versioned game artifact. This only proves a fresh build from
# the committed parquet, universe, bio and leaderboard CSVs reproduces it byte
# for byte, so the file cannot silently outlive its inputs.
"$PYTHON_BIN" scripts/build_prime_windows.py --check

require_generated_data
ok "Generated data present"
