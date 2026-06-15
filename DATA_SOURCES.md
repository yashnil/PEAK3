# DATA SOURCES & PROVENANCE

Every external input to the PEAK3 model, where it comes from, how it is
normalized, its coverage, its known gaps, and the fallback used when a value is
unavailable. All datasets are derived **deterministically** from cached
Basketball Reference HTML, so the completed data can be rebuilt offline with:

```bash
python peak3.py --rebuild-data            # rebuild canonical datasets, then re-score
python peak3.py --rebuild-data --no-scrape  # rebuild from the existing HTML cache only
```

The normal offline scoring path (`python peak3.py --rebuild --no-scrape`, or the
scored-cache fast path) consumes these datasets automatically via
`merge_optional`; no model code changes when the data are rebuilt.

## Data layering (kept strictly separate)

| Layer | Location | Overwritten by a rebuild? |
|---|---|---|
| Raw downloaded HTML (source evidence) | `cache/html/NBA_<year>_*.html` | only with `--refresh` |
| Raw parsed frames | `cache/processed/{regular,playoffs,teams}_1980_2026.parquet` | by `--rebuild` |
| Manually maintained overrides | `data/manual_context.csv`, `data/unanimous_mvp.csv`, `data/stat_titles.csv` | never (hand-edited) |
| Deterministic derived data | `data/generated/{team_shares,mvp_votes,dpoy_votes}.csv`, `player_season_context.parquet` | by `--rebuild-data` / `--build-context` |
| Generated caches | `cache/processed/scored_1980_2026.parquet` | by `--rebuild` |
| Reports / leaderboards | `outputs.txt`, `results/top_250_*.csv` | by `make_outputs.py` |
| Deterministic before/after snapshots | `data/refine_pre_snapshot.csv`, `data/datacomplete_pre_snapshot.csv` | regenerated when needed |

Raw source HTML is **never silently overwritten** (only with an explicit
`--refresh`). The completed datasets below are pure functions of that HTML.

---

## 1. Player box / advanced statistics

* **Fields used:** per-100 (PTS/AST/TRB/STL/BLK/TOV, FG%/3P%/FT%), advanced
  (PER, TS%, USG%, AST%, TRB%, STL%, BLK%, TOV%, OWS/DWS/WS, WS/48, OBPM, DBPM,
  BPM, VORP), per-game (PTS/AST/G — used only for team-share totals), `Awards`.
* **Coverage:** every season 1979-80 .. 2025-26 (`season_end` 1980-2026).
* **Source:** `https://www.basketball-reference.com/leagues/NBA_<year>_{advanced,per_poss,per_game}.html`
* **Normalization:** `parse_player_season` collapses traded players to their
  season-total (`TOT`/`2TM`...) row; `clean_player_name` normalizes names/accents.
* **Known gaps:** modern tracking metrics (EPM/LEBRON/RAPTOR) only where present
  in `data/external_impact.csv`; absent metrics are excluded, never zero-filled.
* **Fallback:** none needed (mandatory inputs).
* **Output:** `cache/processed/regular_1980_2026.parquet`, `playoffs_*`, `teams_*`.

## 2. Team scoring & assist shares  (NEW — actual, replaces USG%/AST% proxy)

* **Fields produced:** `team_scoring_share = player season points / team season
  points`; `team_assist_share = player season assists / team season assists`;
  `n_teams`; `team_share_data_status`.
* **Coverage:** every player-season 1980-2026 (20,526 player-team rows; 100% of
  scored player-seasons matched -> `team_share_data_status = observed`).
* **Source:** Basketball Reference per-game tables
  (`.../leagues/NBA_<year>_per_game.html`). A team's season total is the **sum of
  its players' single-team totals** (each point/assist is credited to exactly one
  player), so totals are exact up to per-game rounding.
* **Normalization:** combined-team rows (`TOT`/`2TM`/`3TM`/...) are EXCLUDED from
  team totals; a traded player's share is the **games-weighted** blend of his
  team-specific shares.
* **Known gaps:** none in 1980-2026; a player missing from the per-game table
  would be flagged `team_share_data_status = fallback`.
* **Fallback:** when an actual share is unavailable the burden residual uses the
  USG%/AST% proxy (`creation = USG% + 0.45*AST%`), flagged via
  `burden_data_status = proxy_fallback`. **Missing is never treated as zero.**
* **Output:** `data/generated/team_shares.csv`.

## 3. MVP voting  (NEW — real vote share)

* **Fields stored:** `season`, `season_end`, `player`, `player_clean`,
  `mvp_finish`, `tie`, `first_place_votes`, `total_vote_points`,
  `maximum_possible_vote_points`, `vote_share`, `vote_share_method`, `source`,
  `source_url`, `dataset_version`.
* **Coverage:** 739 rows, every season 1980-2026 (MVP voting exists every year).
* **Source:** `https://www.basketball-reference.com/awards/awards_<year>.html`
  (`#mvp` voting table).
* **Normalization / definition:**
  `vote_share = award_share = total_vote_points / maximum_possible_vote_points`
  (the spec's preferred normalization; recomputed from points if the published
  share is missing). `mvp_finish` parsed from Rank (ties keep the numeric rank
  with `tie=True`).
* **Known gaps:** none for ranked finishers; players outside the vote table have
  no MVP recognition by construction.
* **Fallback:** a ranked MVP season with no vote row uses the smooth **placement
  fallback** in `ranked_award_value` (flagged `mvp_vote_data_status = fallback`).
  Missing vote share is **NaN, never 0**.
* **Output:** `data/generated/mvp_votes.csv`.

## 4. DPOY voting  (NEW — real vote share)

* **Fields stored:** same schema as MVP (with `dpoy_finish`).
* **Coverage:** 614 rows, seasons **1983**-2026 (the DPOY award began in 1982-83).
* **Source:** `.../awards/awards_<year>.html` (`#dpoy` voting table).
* **Normalization / definition / fallback:** identical to MVP (`vote_share =
  award_share`; placement fallback flagged `dpoy_vote_data_status = fallback`).
* **Known gaps:** seasons 1980-1982 have no DPOY award -> no rows (not a gap).
* **Output:** `data/generated/dpoy_votes.csv`.
* **Finals MVP** is unchanged: binary (`finals_mvp` flag), no vote share, no
  runner-up value, and it lives only in Recognition.

## 5. Other recognition (All-NBA, All-Defense, titles, 50-40-90, unanimous MVP)

* **Fields used:** `Awards` tokens (`NBA1/2/3`, `DEF1/2`, `MVP-n`, `DPOY-n`,
  `AS`), parsed from the advanced table; statistical titles & 50-40-90 from
  `data/stat_titles.csv` (manual) and the auto-derived context; unanimous MVP
  from `data/unanimous_mvp.csv` (the only one in history: Curry 2015-16).
* **Coverage / normalization:** team-tier honors (All-NBA/All-Defense) are taken
  from the season's award tokens; overlap discounts (MVP↔All-NBA, DPOY↔All-Def,
  All-Star subsumed) are applied in `recognition_breakdown`.
* **Known gaps:** none material; these are objective selections.
* **Fallback:** absent award -> 0 recognition for that honor (correct: no award).
* **Provenance audit:** see the "RECOGNITION DATA-QUALITY REPORT" in `outputs.txt`.

## 6. Postseason / team context (championship, round, Finals MVP, opponent quality)

* **Source:** auto-derived from Basketball Reference playoff brackets
  (`nba_peak/context_build.py`), overridable by `data/manual_context.csv`.
* **Output:** `data/generated/player_season_context.parquet`.
* Unchanged by this pass; documented here for completeness.

---

## Data-status fields (section 7)

Every completed field carries an explicit status so a missing value is never
confused with a real zero:

| Field | Values | Meaning |
|---|---|---|
| `team_share_data_status` | observed / fallback | actual share vs USG%/AST% proxy |
| `burden_data_status` | observed / proxy_fallback | burden creation-load input source |
| `mvp_vote_data_status` | observed / fallback / none | real share / placement fallback / not ranked |
| `dpoy_vote_data_status` | observed / fallback / none | real share / placement fallback / not ranked |

## Integrity

`nba_peak/integrity.run_integrity_checks` validates the whole dataset (no
duplicate player-seasons, shares in (0,1], vote shares in [0,1], winners hold the
maximum vote share, exact prime_raw reconciliation, provisional exclusion). It is
asserted at the top of `make_outputs.py` (fails loud) and surfaced in `outputs.txt`.
