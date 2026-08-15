#!/usr/bin/env bash
#
# Classifies a PR's changed files into CI scopes, so ci.yml can skip whole
# subsystems (model tests, frontend build, Supabase local integration,
# Playwright) when nothing in that subsystem could have changed.
#
# INPUT: one file path per line on stdin (repo-relative, as GitHub's PR-files
# API or `git diff --name-only` produce).
#
# OUTPUT: `key=value` lines on stdout, meant to be appended to $GITHUB_OUTPUT
# by the caller. Every value is "true" or "false", except feature_projects,
# which is a JSON array for a matrix `strategy.matrix.project`.
#
# WHY A SCRIPT AND NOT INLINE YAML. Same reason every other check in this
# directory is a script: it can be run and read outside of a GitHub Actions
# log, and CI calling it is the only way "the classification ci.yml uses" and
# "the classification a developer can inspect" stay the same thing.
#
# CONSERVATIVE BY CONSTRUCTION. Every pattern below is an ALLOW-list of paths
# known to be irrelevant to a scope; anything not positively excluded counts
# as relevant. When in doubt (a path nobody anticipated, e.g. a new top-level
# directory), scopes default to true rather than false — see the final rule.
set -euo pipefail

files="$(cat)"

# No changed files (or the caller could not compute a diff): run everything.
if [ -z "$files" ]; then
  echo "backend=true"
  echo "frontend=true"
  echo "e2e=true"
  echo "supabase=true"
  echo 'feature_projects=["chromium-multiplayer","chromium-courtbuilder"]'
  exit 0
fi

matches() {                              # matches PATTERN <<< "$files"
  grep -qiE "$1" <<<"$files"
}

# ── Backend / model / data scope ────────────────────────────────────────────
# Drives the combined Python job: dataset build, model tests, lineup tests,
# API unit tests, board-generation smoke, migration validation.
BACKEND_PATTERN='^(peak3\.py|nba_peak/|leaderboards/|data/generated/|scripts/|tests/|apps/api/|requirements(-build)?\.txt|Makefile|supabase/|\.github/workflows/(ci|ranked-release)\.yml)'

# ── Frontend scope ──────────────────────────────────────────────────────────
FRONTEND_PATTERN='^apps/web/'

# ── Supabase scope ──────────────────────────────────────────────────────────
# Narrower than "backend": only what actually touches the local-stack
# integration suite (RLS/auth/migrations), so an unrelated apps/api/ change
# (e.g. a Daily Grid rate limit) does not spin up Docker + the Supabase CLI.
SUPABASE_PATTERN='^(supabase/|apps/api/app/(core/(auth|jwks)|repositories|services/(auth|arena_rating))|apps/api/tests/integration/|apps/api/tests/test_repository_conformance\.py)'

# ── Paths that are broad enough to make narrow E2E gating unsafe ───────────
# A change here can affect ANY feature, so both narrow Playwright projects
# (courtbuilder, multiplayer) run rather than trying to prove a negative.
BROAD_MARKER_PATTERN='^(requirements(-build)?\.txt|Makefile|apps/api/requirements\.txt|apps/api/app/main\.py|apps/api/app/core/|supabase/|\.github/workflows/(ci|ranked-release)\.yml|peak3\.py|apps/web/playwright\.config\.ts|apps/web/playwright\.setup\.ts|apps/web/package(-lock)?\.json)'

COURTBUILDER_PATTERN='(courtbuilder|perfect_season)'
MULTIPLAYER_PATTERN='(arena|showdown|multiplayer)'

backend=false;   matches "$BACKEND_PATTERN"   && backend=true
frontend=false;  matches "$FRONTEND_PATTERN"  && frontend=true
supabase=false;  matches "$SUPABASE_PATTERN"  && supabase=true

e2e=false
{ [ "$backend" = true ] || [ "$frontend" = true ]; } && e2e=true

broad=false; matches "$BROAD_MARKER_PATTERN" && broad=true

feature_projects="[]"
if [ "$e2e" = true ]; then
  want_cb=false; want_mp=false
  if [ "$broad" = true ]; then
    want_cb=true; want_mp=true
  else
    matches "$COURTBUILDER_PATTERN" && want_cb=true
    matches "$MULTIPLAYER_PATTERN"  && want_mp=true
  fi
  projects=()
  [ "$want_mp" = true ] && projects+=('"chromium-multiplayer"')
  [ "$want_cb" = true ] && projects+=('"chromium-courtbuilder"')
  if [ ${#projects[@]} -gt 0 ]; then
    feature_projects="[$(IFS=,; echo "${projects[*]}")]"
  fi
fi

echo "backend=$backend"
echo "frontend=$frontend"
echo "e2e=$e2e"
echo "supabase=$supabase"
echo "feature_projects=$feature_projects"
