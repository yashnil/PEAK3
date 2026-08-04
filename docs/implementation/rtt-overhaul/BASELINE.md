# BASELINE — Arena RTT Overhaul

Captured at Phase 0, before any implementation edits.

## Workspace

| Item | Value |
| --- | --- |
| Repository | `~/Desktop/PEAK3` |
| Working branch | `feature/arena-rtt-overhaul` |
| HEAD at baseline | `7c743f1244568ee921e98a967d22c1ff6e28be90` |
| Base branch | `chore/production-deployment` |
| Working tree | clean (`git status --porcelain` empty) |
| Remote | `origin` → `https://github.com/yashnil/PEAK3.git` |

### Implementation worktrees

All created from `feature/arena-rtt-overhaul` @ `7c743f1`, each on its own branch.

| Path | Branch | Owner |
| --- | --- | --- |
| `~/Desktop/PEAK3` | `feature/arena-rtt-overhaul` | lead (integration only) |
| `~/Desktop/PEAK3-agent-score` | `wt/arena-score` | score-integrity |
| `~/Desktop/PEAK3-agent-rtt` | `wt/arena-rtt` | rtt-experience |
| `~/Desktop/PEAK3-agent-platform` | `wt/arena-platform` | platform |

`product-director` has no worktree — read-only, documentation-only, writes into
`docs/implementation/rtt-overhaul/` on the lead's branch.

## Hosted staging

| Surface | URL | Baseline status |
| --- | --- | --- |
| Web | `https://peak3-staging.vercel.app` | HTTP 200 |
| API | `https://peak3-staging.up.railway.app` | HTTP 200 on `/health` |

`/healthz` does **not** exist — the real routes are `/health` and
`/health/readiness`. 99 paths are published in `/openapi.json`.

```
/health            {"status":"ok","service":"peak3-arena-api","version":"1.0.0"}
/health/readiness  {"status":"ready","dataset_loaded":true,"player_count":250,
                    "duration_count":4,"auth_verification_mode":"jwks"}
```

### Runtime feature-flag state (values read from readiness endpoints; no secrets)

`GET /api/v1/run-the-table/readiness`

```json
{"enabled": true, "daily_enabled": true, "readiness_level": "public_beta",
 "versions": {"engine_version": "run_the_table_v1",
              "ruleset_version": "rtt_ruleset_v3",
              "card_pool_version": "v3",
              "peak3_model_version": "peak3_official_weights_v1"},
 "card_pool": {"available": true, "duration_years": 3, "card_count": 174,
               "excluded_count": 74, "prime_score_min": 50.09,
               "prime_score_max": 95.54}}
```

`GET /api/v1/perfect-season/readiness`

```json
{"readiness_level": "internal_alpha", "courtbuilder_enabled": true,
 "team_spin_enabled": true,
 "interim_team_data_version": "courtbuilder_interim_teams.v3",
 "interim_team_franchise_count": 11}
```

`GET /api/v1/perfect-season/leaderboard` reports `"leaderboard_enabled": true`
on staging and already returns rows. **This is the surface Phase 3-K must
harden** — see `SCORE_RECONCILIATION.md` for the contract audit.

Ranked flags (`PEAK3_RANKED_MATCHMAKING_ENABLED`,
`PEAK3_RANKED_PUBLIC_LEADERBOARD_ENABLED`, `PEAK3_RANKED_RATING_WRITES_ENABLED`)
remain **off** and must stay off for this pass.

Flag names in the codebase (names only — no values recorded anywhere in git):
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`, `PEAK3_RUN_THE_TABLE_ENABLED`,
`PEAK3_RUN_THE_TABLE_DAILY_ENABLED`, `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`,
`PEAK3_RANKED_*`, `PEAK3_SIGNING_SECRET`, `PEAK3_SUPABASE_*`,
`PEAK3_DATABASE_URL`, `PEAK3_TELEMETRY_ENABLED`.

## Canonical ranking hashes (regression anchors)

These SHA-256 values must be **byte-identical** at the end of the pass unless a
reproducible numerical defect is first proven and documented.

```
298ec24a3f573b1af3bacb3bc2de7c4f6082aefa96582ed3dcb32256a1f0b387  leaderboards/top_250_1_year_prime.csv
9723ad7ec2915878069273e27687c1c57a21c9c7ec5b6938088429a6565c5eac  leaderboards/top_250_2_year_prime.csv
83bf92bf6f20c97ff3702cda0e3fc79a0926f8556745fb4cef2802e6fa831b71  leaderboards/top_250_3_year_prime.csv
ef59f6f2a8bd9cd7a460de90c121d88f7a868abce09aefc37b9b018569a37c6c  leaderboards/top_250_5_year_prime.csv
dc3ff5125550e036dc4b4a977f6d67c113844e7118725ed54c3e3349af9f59bf  leaderboards/top_250_prime_comparison.csv
```

Model identity served by `/api/v1/meta`:

```
formula_version_id  peak3_v1
formula_version     peak3_official_weights_v1
                    (statistical_impact=0.38, traditional_production=0.21,
                     recognition=0.20, postseason=0.18, team_achievement=0.03)
supported_durations [1, 2, 3, 5]
player_count        250
peak_window_count   984
```

## Latency baseline (warm, hosted staging, from a single client)

Small-N smoke numbers taken at Phase 0 to establish that staging is warm and
reachable. The authoritative p50/p75/p95 tables with proper sample counts live
in `PERFORMANCE.md`, produced by a committed, re-runnable measurement script so
before/after comparisons use the same instrument.

| Endpoint | N | Observed wall time | Payload |
| --- | --- | --- | --- |
| `GET /api/v1/run-the-table/readiness` | 5 | 0.164–0.180 s | small |
| `GET /api/v1/run-the-table/meta` | 3 | 0.168–0.182 s | 4,858 B |
| `GET https://peak3-staging.vercel.app/` | 3 | 0.278–0.379 s | 101,730 B |

## Test totals at baseline

All measured in the teammates' own worktrees at `7c743f1`, before any
implementation edit.

| Suite | Result | Source |
| --- | --- | --- |
| `scripts/ci/model-tests.sh` | **939 passed**, 9 skipped, 1 xfailed, **0 failed** | `wt/arena-score` |
| `scripts/ci/api-unit-tests.sh` | **1198 passed**, 2 skipped, 5 deselected, **0 failed** | `wt/arena-score` |
| `scripts/ci/frontend-verify.sh` — vitest | **1258 passed / 1258** across 47 files | `wt/arena-platform` |
| `scripts/ci/frontend-verify.sh` — typecheck | clean | `wt/arena-platform` |
| `scripts/ci/frontend-verify.sh` — lint | **0 warnings** | `wt/arena-platform` |
| `scripts/ci/frontend-verify.sh` — production build | fails **as scripted** on a deploy-safety env guard; succeeds manually with a real HTTPS API URL | `wt/arena-platform` |
| RTT-owned frontend vitest (subset of the 1258) | 342 passing | `wt/arena-rtt` (298 run-the-table-v3/copy/state/components + 44 trade-desk/head-to-head) |
| RTT e2e (`run-the-table.spec.ts`) | ~14 tests, **not executed** at baseline (requires API up) | `wt/arena-rtt` |
| `scripts/ci/api-integration-tests.sh` | **not executed** at baseline (needs a real Postgres/Supabase test project) | — |

Canonical CSV sha256 hashes were independently re-verified in `wt/arena-score`
and **match the anchors above exactly**.

Largest frontend route at baseline: `/arena/run-the-table` — 26.9 KB, 259 KB
First Load JS.

CI entry points (the Makefile and `.github/workflows/ci.yml` both call these —
"green locally" and "green in CI" are claims about the same commands):

```
scripts/ci/model-tests.sh
scripts/ci/api-unit-tests.sh
scripts/ci/api-integration-tests.sh
scripts/ci/frontend-verify.sh
scripts/ci/e2e-tests.sh
scripts/ci/lineup-tests.sh
scripts/ci/build-web-data.sh
```

## Deterministic RTT baseline

RTT is seeded and deterministic. Phase 1-A pins at least three seeds and
reconciles every card against `leaderboards/top_250_3_year_prime.csv`; the
resulting fixtures are the regression anchor for the battle-receipt work.
Card pool at baseline: **174 cards**, 3-year duration, prime_score range
50.09 – 95.54, `card_pool_version: v3`, `ruleset_version: rtt_ruleset_v3`.

## Known defects entering the pass

1. **Opening-reveal identity leak (backend).** `apps/api/app/services/run_the_table/public.py`
   `_slot_public()` / `public_state()` serialize full `card_public()` identity
   (name, window, prime_score) for every roster slot gated only on `card_id`
   existing, never on `reveal_index`. All 7 identities ship from the first
   frame. `boss_public()` in the same module already gates correctly behind
   `if revealed:`. Lower-severity variant: top-level `lane_profile` /
   `roster_total` / `bench_weight` are computed from the full real roster, so
   aggregate strength foreshadows the reveal even with names hidden.
2. **Seven round trips for the opening reveal.** One
   `POST /api/v1/run-the-table/runs/{id}/actions` per card
   (`RevealReel.tsx:165` always sends `count=1`); "skip all" collapses it to 2
   minimum and is only offered after 1 of 7 is revealed. Note: the atomic batch
   primitive **already exists server-side** — `action_reveal`
   (`state.py:1039`) saturates on an arbitrary `count` and is simply never
   invoked for the default path. Batching alone would be a no-op for the
   spoiler, though, since the leak in defect 1 has already happened at run
   creation regardless; the gating fix is what makes batching a real fix.
3. **Battle-number semantics.** Values presented as `27.2 — Victor Wembanyama`
   read as individual player Statistical Impact. Actual provenance is being
   established in `SCORE_RECONCILIATION.md`; the verdict must distinguish a
   numerical defect from a presentation defect on evidence, not inference.

## Constraints in force for this pass

- Do not merge to `main`. Do not deploy publicly.
- Do not enable Ranked matchmaking.
- Do not alter `OFFICIAL_WEIGHTS`, `calibrate_score()`, or canonical ranking
  rows unless a reproducible numerical defect is proven first.
- Do not weaken authentication, ownership, RLS, or IDOR protections.
- Do not commit credentials, secrets, or environment values.
