#!/usr/bin/env bash
#
# Classifies a PR's changed files into CI scopes, so ci.yml can skip whole
# subsystems (the model suite, the FastAPI suite, the frontend build, Supabase
# local integration, individual Playwright projects) when nothing in that
# subsystem could have changed.
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
# directory), scopes default to true rather than false — see the final rule
# and, for the Playwright shards, the FRONTEND_CORE_ONLY fall-through.
set -euo pipefail

files="$(cat)"

# No changed files (or the caller could not compute a diff): run everything.
if [ -z "$files" ]; then
  echo "model=true"
  echo "api=true"
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

# ── Model scope ─────────────────────────────────────────────────────────────
# Drives ONLY the two pytest steps over `tests/` (the canonical model suite and
# the lineup suite) inside the combined Python job.
#
# WHY SPLIT OUT OF "backend". `pytest tests/` measures 34 MINUTES on a hosted
# runner — the single most expensive step in this workflow — and it cannot be
# affected by an `apps/api/` change: nothing under `tests/` imports the API
# package (`grep -rE "from apps|import apps" tests/` is empty). The dependency
# runs the other way; `apps/api/` imports `nba_peak.*` in 20+ modules, which is
# why every model path below EXCEPT `tests/` also appears in API_PATTERN.
# Before this split, an `apps/api/`-only, `supabase/migrations/`-only or
# `scripts/ci/`-only PR paid those 34 minutes for a suite the diff could not
# break.
#
# `tests/` is the ONE asymmetry, and it is deliberate: this directory holds the
# model suite itself and nothing under apps/api/ reads it (`apps/api/tests/`'s
# `from tests.…` imports resolve against apps/api/tests, because
# api-unit-tests.sh runs pytest with apps/api as the rootdir). A change to
# tests/test_scoring.py therefore cannot change an API result.
#
# `cache/` is NOT an asymmetry and appears in BOTH: cache/processed/*.parquet is
# COMMITTED (see .gitignore's negated entries), it is the scored input the model
# suite reads, AND the API unit suite reads it directly --
# apps/api/tests/test_role_player_serving_guard.py:37 resolves
# `REPO_ROOT/cache/processed/scored_1980_2026.parquet` and skips its whole
# module when it is absent, while nba_peak/{perfect_season,three_man_weave,
# twenty_dollar,daily_grid}/* load it under the API's own imports.
MODEL_PATTERN='^(peak3\.py|nba_peak/|leaderboards/|data/generated/|cache/|scripts/|tests/|requirements(-build)?\.txt|Makefile|\.github/workflows/(ci|ranked-release)\.yml)'

# ── API / data-validation scope ─────────────────────────────────────────────
# Drives the FastAPI unit suite, the board-generation smoke check and static
# migration validation. Includes the model paths because the API imports them,
# and `supabase/` because migration validation lives in this job.
API_PATTERN='^(apps/api/|peak3\.py|nba_peak/|leaderboards/|data/generated/|cache/|scripts/|supabase/|requirements(-build)?\.txt|Makefile|\.github/workflows/(ci|ranked-release)\.yml)'

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
# `scripts/ci/` is included because it holds the Playwright RUNNER itself
# (e2e-tests.sh, assert-e2e-inventory.sh): a change to how the browser suite is
# launched is exactly the kind of change that must not be validated by a subset
# of it.
BROAD_MARKER_PATTERN='^(requirements(-build)?\.txt|Makefile|apps/api/requirements\.txt|apps/api/app/main\.py|apps/api/app/core/|supabase/|\.github/workflows/(ci|ranked-release)\.yml|peak3\.py|scripts/ci/|apps/web/playwright\.config\.ts|apps/web/playwright\.setup\.ts|apps/web/package(-lock)?\.json)'

# ── Playwright feature attribution ──────────────────────────────────────────
#
# GROUND TRUTH is the routes the two narrow projects' specs actually visit:
#
#   chromium-courtbuilder  courtbuilder.spec.ts      -> /arena/court/**
#   chromium-multiplayer   arena-multiplayer.spec.ts -> /, /arena, /arena/lobby,
#                                                       /arena/three-man-weave/*,
#                                                       /arena/twenty-dollar/*
#                          showdown-two-tab.spec.ts  -> /, /arena/lobby,
#                                                       /arena/twenty-dollar/*
#
# These used to be two bare keyword lists, `(courtbuilder|perfect_season)` and
# `(arena|showdown|multiplayer)`, and both had gone wrong by the time V2 landed:
#
#   - `components/v2/court/`, `components/v2/tmw/`, `components/three-man-weave/`
#     and `components/twenty-dollar/` matched NEITHER list, so the shard that
#     owns each of them was skipped entirely on a PR that changed only it.
#   - `app/(main)/arena/court/**` matched the bare word `arena` and therefore ran
#     the MULTIPLAYER shard while skipping the CourtBuilder one — the wrong
#     project, in both directions, for CourtBuilder's own routes.
#   - the same bare `arena` dragged `arena/run-the-table`, `arena/ranked` and
#     `arena/daily` (all chromium-core surfaces) into the 9.5-minute multiplayer
#     shard for nothing.
COURTBUILDER_PATTERN='(courtbuilder|perfect[-_]season|^apps/web/src/app/\(main\)/arena/court/|^apps/web/src/components/(v2/)?court/|^apps/web/src/styles/v2/court\.css|^nba_peak/perfect_season/|^apps/api/app/(services|models)/perfect_season)'
MULTIPLAYER_PATTERN='(showdown|multiplayer|matchmaking|three[-_ ]?man[-_ ]?weave|twenty[-_]dollar|tmw|weave|prime[-_]cut|find[-_]the[-_]prime|prime[-_]arena|prime[-_]modes|^apps/web/src/app/\(main\)/arena/(lobby|three-man-weave|twenty-dollar)/|^apps/web/src/app/\(main\)/arena/page\.|^apps/web/src/components/(arena|three-man-weave|twenty-dollar)/|^apps/web/src/components/v2/(tmw|showdown)/|^apps/web/src/styles/v2/arena-lobby\.css|^nba_peak/(three_man_weave|twenty_dollar)/|^apps/api/app/services/arena/|^apps/api/app/api/v1/arena\.py)'

# ── Frontend paths PROVEN not to reach either narrow shard ──────────────────
#
# THE POINT OF THIS LIST. Attribution above is opt-IN, and an opt-in list is a
# false-negative machine: every file nobody thought to name gets zero feature
# coverage. So attribution is not the last word. Any `apps/web/` file that is
# neither attributed above NOR named here turns BOTH narrow shards on — which is
# how `styles/v2/tokens.css`, `components/layout/nav.tsx`, `components/shared/`
# (SpinReel backs CourtBuilder's SpinStage *and* TMW's WeaveSpinner),
# `components/ui/`, `src/lib/` and any future shared primitive get covered
# without anyone having to remember to add them.
#
# Only surfaces owned exclusively by chromium-core / mobile-chrome belong here:
# Peak Duel, Daily Grid, Run the Table, ranked, rankings, players, progression,
# profile/auth, the static informational pages, the vitest unit suite, and the
# screenshot-capture tooling (src/tests/tools/ + playwright.*-shots.config.ts),
# which no CI project runs at all.
#
# WHY THE GENERIC `tests/e2e/*.spec.ts` RULE IS SAFE, and is not the
# false-negative hole it looks like. It mirrors chromium-core's membership rule
# exactly. playwright.config.ts gives the two narrow projects a closed
# `testMatch` -- /(arena-multiplayer|showdown-two-tab).spec.ts/ and
# /courtbuilder.spec.ts/ -- and gives chromium-core the complement of those
# three as a `testIgnore`. So EVERY spec filename that is not one of those three
# lands in chromium-core, and all three are claimed by COURTBUILDER_PATTERN /
# MULTIPLAYER_PATTERN above before this list is ever consulted.
#
# Three things keep that true rather than merely true today:
#   - chromium-core and mobile-chrome are NOT feature-gated. playwright-pr-core
#     runs on every PR with e2e == true, so a new spec is executed by the PR
#     that adds it no matter what feature_projects says. "core-only" is the
#     always-on tier, not a skip.
#   - playwright.config.ts is a BROAD_MARKER path, so a PR that moves a spec
#     into a narrow project's testMatch runs BOTH narrow shards anyway.
#   - scripts/ci/assert-e2e-inventory.sh fails the run if the projects stop
#     partitioning the suite -- an unclaimed or double-claimed spec is an error,
#     not a silent gap.
# A nested spec (tests/e2e/<dir>/x.spec.ts) does not match the `[^/]`-shaped
# class below and so falls through to both shards, which is the conservative
# direction for a layout nobody has anticipated.
# Global chrome (nav.css, footer.css) and shared game furniture (game-intro.css,
# discovery.css, home.css) are deliberately ABSENT so they fall through to
# "both".
#
# `components/home/` is ABSENT for the same reason, and this was checked rather
# than assumed. The homepage is on the multiplayer specs' critical path twice
# over: arena-multiplayer.spec.ts asserts `home-three_man_weave-card` and
# `home-twenty_dollar-card` are visible with `href=^/arena/lobby`, then CLICKS
# the $20 card and waits for the lobby URL; and its `signInAs()` helper loads
# `/` for every signed-in test in the file (showdown-two-tab.spec.ts:30 does the
# same). `app/(main)/page.tsx` cannot render without
# `components/home/home-data.ts` (`loadHomeModelData`, `loadNbaFactOfTheDay`),
# and `components/v2/HomePageV2.tsx` — which emits those very `home-${mode.id}-card`
# testids — imports `components/home/NbaFactOfTheDay`. Breaking either takes the
# homepage down and with it the whole multiplayer shard, so `components/home/`
# must not be classified core-only.
FRONTEND_CORE_ONLY_PATTERN='^apps/web/(src/(app/\(main\)/(about|accessibility|contact|data-sources|daily|history|methodology|play|players|privacy|profile|progress|rankings|signin|signup|terms|u|v2-preview)/|app/\(main\)/arena/(daily|labs|practice|ranked|results|run-the-table)/|app/auth/|app/c/|components/(auth|contact|daily|daily-grid|draft|game|head-to-head|profile|progression|ranked|rankings|run-the-table)/|components/v2/(duel|rtt)/|styles/v2/(rtt|rtt-result|info-pages)\.css|lib/(daily-grid|daily-time|draft|peak-duel|progression|profile|ranked|rankings|run-the-table)[-.]|types/(daily-grid|draft|ranked|run-the-table)\.ts|tests/unit/|tests/tools/|tests/e2e/[A-Za-z0-9._-]+\.spec\.ts$)|playwright\.[a-z0-9-]+-shots\.config\.ts$|.*\.md$)'

model=false;     matches "$MODEL_PATTERN"     && model=true
api=false;       matches "$API_PATTERN"       && api=true
frontend=false;  matches "$FRONTEND_PATTERN"  && frontend=true
supabase=false;  matches "$SUPABASE_PATTERN"  && supabase=true

# `backend` keeps its previous meaning exactly — it is the job-level gate for
# "Model, API, and data validation (Python)", and that job still runs whenever
# either half of it has work to do. `model` and `api` gate the steps INSIDE it.
backend=false
{ [ "$model" = true ] || [ "$api" = true ]; } && backend=true

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

    # Fall-through described above: a frontend file that no rule claimed could
    # belong to anything, so it is treated as belonging to everything.
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      grep -qiE "$FRONTEND_PATTERN" <<<"$f" || continue
      grep -qiE "$COURTBUILDER_PATTERN" <<<"$f" && continue
      grep -qiE "$MULTIPLAYER_PATTERN" <<<"$f" && continue
      grep -qiE "$FRONTEND_CORE_ONLY_PATTERN" <<<"$f" && continue
      want_cb=true; want_mp=true
      break
    done <<<"$files"
  fi
  projects=()
  [ "$want_mp" = true ] && projects+=('"chromium-multiplayer"')
  [ "$want_cb" = true ] && projects+=('"chromium-courtbuilder"')
  if [ ${#projects[@]} -gt 0 ]; then
    feature_projects="[$(IFS=,; echo "${projects[*]}")]"
  fi
fi

echo "model=$model"
echo "api=$api"
echo "backend=$backend"
echo "frontend=$frontend"
echo "e2e=$e2e"
echo "supabase=$supabase"
echo "feature_projects=$feature_projects"
