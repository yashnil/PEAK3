# Clean-Checkout Data Contract for CI

**Why this document exists:** the model test suite failed on a clean GitHub
Actions checkout (`data/generated/*.csv` missing, cached HTML missing) even
though it passed locally, because several data directories were gitignored
as "rebuildable from source" when rebuilding them actually requires live
network access to basketball-reference.com — which CI must never depend on.
This document is the audit trail for which files are canonical committed
inputs, which are safely-regenerable, and which are test-only fixtures, so
this class of gap does not silently reappear.

## The three categories

1. **Canonical committed inputs/outputs** — expensive or impossible to
   rebuild without live network access; small enough to version; already
   real, versioned data (not synthetic). Committed.
2. **Cheaply reproducible from committed inputs** — rebuilt by a CI step
   before tests run. Gitignored.
3. **Test-only fixtures** — synthetic, deterministic, defined in the test
   file itself. No file I/O.

## What's committed, and why

| Path | Category | Why |
|---|---|---|
| `leaderboards/*.csv` | 1 | Already committed pre-existing canonical rankings (unchanged by this pass). |
| `data/generated/*.csv`, `data/generated/*.parquet` | 1 | Team scoring/assist shares, real MVP/DPOY vote shares, the canonical 250-player universe, and player-season context — all built by `peak3.py --rebuild-data`/`--build-context` from live basketball-reference.com scrapes (see `nba_peak/data_complete.py`'s `fetch_html(..., scrape=True)` calls). Rebuilding requires network access; CI must not depend on that. This also matches `CLAUDE.md`'s own stated architecture ("`data/generated/` # Committed candidate universe and parquet context") — the directory being gitignored was itself the bug, not the intended design. |
| `cache/html/NBA_2006_per_game.html` | 1 (narrow exception) | `tests/test_data_complete.py`'s single-team and traded-season tests independently reconstruct expected values from the *raw* per-game table for season 2006, as a cross-check against `team_shares.csv` rather than trusting it blindly. This is the only season any test reads raw HTML for. The rest of `cache/html/` (369MB, ~376 files) stays gitignored — committing the whole cache would be excessive; only the one file tests actually require is carved out. |
| `cache/processed/scored_1980_2026.parquet` | 1 (narrow exception) | The real, fully-scored 1980–2026 dataset. Seven test files (`test_data_complete.py`, `test_five_player_audit.py`, `test_corrections.py`, `test_refinement.py`, `test_leaderboards.py`, `test_specialist_postseason_audit.py`, `test_validation.py`) already contain an explicit "prefer the real cache when present, else fall back to a small synthetic league" pattern — this is clearly *intentional* test design, not an accident. On a clean checkout without this file, `test_refinement.py::test_burden_does_not_duplicate_full_si_or_tp`'s synthetic fallback produces exactly **one** row passing its `workload_qualified`/`provisional` filter, so `np.corrcoef` on a single point returns `NaN` — a real, previously-latent bug in the fallback path that nobody had ever hit locally (this file always existed in dev). Committing the real cache lets all seven test files exercise their intended "real data" branch in CI instead of always silently degrading to the weaker synthetic one. **Phase 6C correction:** despite this row previously saying otherwise, `cache/processed/regular_1980_2026.parquet` is *also* already git-tracked (committed in the initial `3e10e29` commit, confirmed via `git ls-files`/`git log`) — it was never actually gitignored, that prior claim was stale. `nba_peak/perfect_season/exact_season.py` (Phase 6C, team-year CourtBuilder mode) now depends on both `regular_1980_2026.parquet` and `scored_1980_2026.parquet` being present on a clean checkout, which they already are. `playoffs_1980_2026.parquet`/`teams_1980_2026.parquet` remain gitignored and are not depended on by any test or the Phase 6C code path. |
| `apps/api/requirements.txt`: `pandas`, `pyarrow` | 1 | Phase 6C: `apps/api/app/services/perfect_season/state.py` → `nba_peak.perfect_season.exact_season` reads the two parquet files above directly, for the team-year CourtBuilder mode only. The rest of the API remains read-only against pre-generated `data/web/*.json` (no other route touches `cache/processed/` or does live scoring). |
| `data/web/` | 2 | Rebuilt by `scripts/build_web_dataset.py` from `leaderboards/*.csv` (already committed, no network). CI's `web-dataset` job does this and passes it downstream as an artifact. Stays gitignored — correctly so. |
| `cache/processed/` (remaining files) | 2, for future rebuilds | Documented as rebuildable via `peak3.py --build-context`/`--rebuild-data`, which does require network access when the cache is genuinely cold — this is a local-dev/data-refresh concern, not a CI concern, since CI never rebuilds this cache. |

## Phase 6D: experimental team-year + 1500-identity + PEAK Index data (2026-07-24)

Generated files under `data/game/experimental/player_pool_1500/`, produced
by `scripts/build_experimental_team_year_dataset.py`,
`scripts/audit_player_pool_expansion.py --write-manifest`,
`scripts/build_top_peaks.py`, and `scripts/build_experimental_card_extension.py`
respectively. All four generators read `cache/processed/regular_1980_2026.parquet`
and/or `scored_1980_2026.parquet`, which ARE committed (category 1 — see
the corrected row above; both were committed in the initial `3e10e29`
commit, confirmed via `git ls-files`/`git log`), so all four are re-runnable
on a clean CI checkout with no network access.

| Path | Category | Why |
|---|---|---|
| `courtbuilder_team_year.experimental.v2.json` (4.9MB) | 1 (recommended) | Read at runtime by `nba_peak/perfect_season/board.py::_load_experimental_team_year_dataset()` — if `COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=True` and this file is missing, board generation raises `FileNotFoundError`. Computed from every team-season in `regular_1980_2026.parquet` (1,310 rollable of 1,314 total, 40 franchises, 1979-80..2025-26) — not a hardcoded list. **v0 and v1 (both narrower, Warriors-only) are deleted**; `EXPERIMENTAL_TEAM_YEAR_DATA_VERSION`/`_default_experimental_team_year_path()` point only at v2. |
| `card_profiles.experimental.json` (43KB) | 1 (recommended) | Read at runtime by `nba_peak/perfect_season/board.py::_load_experimental_cards()`, the fallback path `resolve_card()` uses to resolve real rostermates who have no canonical `card_profiles.v3.json` entry. |
| `candidate_identity_manifest.v1.json` (1.3MB) | 1 (recommended) | Read at runtime by `nba_peak/perfect_season/exact_season.py::_load_1500_pool_slugs()` for every candidate's `identity_pool_status` classification — **this makes it runtime-load-bearing**, unlike the old v0 draft (which was never read by runtime code and was correctly never committed). 1,510 identities, generated deterministically from committed local data. |
| `all_seasons_for_identities.v1.json` (4.1MB) | 2 (recommended, not currently read at runtime) | Every locally available regular-season row for every qualifying 1500-pool identity (14,133 rows) — currently a review/audit artifact (`scripts/review_player_pool_manifest.py`), not read by any live gameplay code path. Cheaply regenerable from committed data; commit recommended anyway so CI/review tooling doesn't require a local regeneration step, but not strictly required for CourtBuilder to function. |
| `top_1000_peaks.v1.json` (877KB) | 1 (recommended) | Read at runtime by `apps/api/app/api/v1/peaks.py` (`GET /api/v1/peaks`) — missing file returns 503, not a crash, but the PEAK Index page needs it to function. |
| `candidate_identity_manifest.v0.json` (566KB) | — (do not commit) | Superseded draft snapshot from Phase 6A/6C. Not read by any runtime code path. Not staged/committed per explicit instruction. |

None of these four generation scripts require network access or an
uncommitted cache directory — the earlier "Regeneration caveat" note in
this document (claiming `regular_1980_2026.parquet` was gitignored) was
itself stale and has been corrected above.

## `.gitignore` mechanics

`cache/html/` and `cache/processed/` were previously ignored as whole
directories (`cache/html/`, `cache/processed/` with a trailing slash). A
trailing-slash directory pattern in `.gitignore` prevents git from even
looking inside that directory for negated (`!`) patterns — so re-including
one file inside required first *narrowing* the directory pattern to a glob
(`cache/html/*`) so git still descends into it per-file, then negating the
one needed file:

```gitignore
cache/html/*
!cache/html/NBA_2006_per_game.html
cache/processed/*
!cache/processed/scored_1980_2026.parquet
```

`data/generated/` was removed from `.gitignore` entirely (the whole
directory is committed — see table above).

## What this does NOT change

- No test assertion was weakened or skipped to work around missing data.
- No live network access was added anywhere in CI.
- `nba_peak/data_complete.py`'s `fetch_html(..., scrape=False, refresh=False)`
  calls are unchanged — they still only ever read from a local cache, never
  scrape. The fix is making the specific cached file they need actually
  present on a clean checkout, not changing their behavior.
- `cache/processed/` and `cache/html/` remain gitignored in general; only the
  two specific files real tests depend on are carved out.
