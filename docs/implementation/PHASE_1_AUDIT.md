# Phase 1 Audit — PEAK3 Web Dataset Export

**Date:** 2026-06-28  
**Auditor:** build process review  
**Scope:** Static JSON export from committed leaderboard CSVs to `data/web/`

---

## 1. Repository Overview

### What exists

| Path | Description |
|------|-------------|
| `peak3.py` | Main scoring engine: data loading, component functions, calibration |
| `nba_peak/` | Supporting modules (candidates, enrichment, postseason, teammate) |
| `leaderboards/` | **Committed canonical output** — 4 CSVs (250 windows each) for 1/2/3/5-year primes |
| `data/generated/final_250_candidates.csv` | 250-player candidate pool with IDs and career info |
| `data/manual_context.csv` | Manual overrides for objective fields |
| `cache/html/` | Committed raw Basketball Reference HTML (1980–2026, ~47 seasons) |
| `cache/processed/scored_1980_2026.parquet` | Locally computed scored parquet — **gitignored** |
| `METHODOLOGY.md` | Authoritative formula documentation |
| `scripts/build_web_dataset.py` | **New** — deterministic CSV → JSON exporter |
| `data/web/` | **New** — generated JSON files for web consumption |

### What the model does

PEAK3 computes a Five-Component Open Weighted Index for every qualifying NBA player-season (≈11,400 seasons, ≈2,000 players). From these season scores it derives peak windows of 1, 2, 3, and 5 consecutive years using rank-weighted averaging, then monotonically calibrates the raw index to a 0–100 display scale. The top-250 windows for each duration are committed as leaderboard CSVs.

---

## 2. Authoritative Scoring Source

### Entry point: `peak3.py`

Key symbols:

- `OFFICIAL_WEIGHTS` — dict mapping component names to weights: `{SI: 0.38, TP: 0.21, IR: 0.20, PIV: 0.18, TA: 0.03}`
- `calibrate_score(raw)` — monotonic sigmoid-family remapping of raw prime index → 0–100 display score; computed once per window after aggregation, never per-season
- Component functions (called per player-season):
  - `score_statistical_impact(row, ...)` — BPM/VORP/WS/PER/EPM ensemble
  - `score_traditional_production(row, ...)` — pts/reb/ast × TS% × team workload share
  - `score_individual_recognition(row, ...)` — MVP votes, All-NBA, DPOY, Finals MVP, stat titles
  - `score_postseason_individual_value(row, ...)` — playoff BPM/WS, efficiency elevation, deep-run volume
  - `score_team_achievement(row, ...)` — championships and Finals, role-adjusted

Formula: `prime_raw = 0.38·SI + 0.21·TP + 0.20·IR + 0.18·PIV + 0.03·TA + teammate_adjustment`

The `teammate_adjustment` is an additive modifier (±0.5 max), not a sixth weighted component.

---

## 3. Data Availability

### Committed data (available without local rebuild)

| File | Status | Notes |
|------|--------|-------|
| `leaderboards/top_250_1_year_prime.csv` | Committed | 250 rows, all component columns |
| `leaderboards/top_250_2_year_prime.csv` | Committed | 249 rows (some players lack 2-season windows) |
| `leaderboards/top_250_3_year_prime.csv` | Committed | 248 rows |
| `leaderboards/top_250_5_year_prime.csv` | Committed | 237 rows |
| `data/generated/final_250_candidates.csv` | Committed | canonical_player_id, career years |
| `cache/html/` | Committed | Raw HTML source for all 47 seasons |

### Local-only data (gitignored)

| File | Status |
|------|--------|
| `cache/processed/scored_1980_2026.parquet` | Local only — full rebuild requires this |
| `cache/processed/` (other parquets) | Local only |

**Phase 1 strategy:** Read from committed CSVs only. No parquet access, no network, no scraping.

---

## 4. Web Dataset Approach

`scripts/build_web_dataset.py` is a deterministic, read-only exporter:

1. Reads the four committed leaderboard CSVs with pandas
2. Parses and validates each row (NaN/inf checks, required field checks, duplicate ID checks)
3. Applies regression assertions (rank 1 for 1yr and 5yr must be Michael Jordan)
4. Writes four JSON files to `data/web/`
5. Exits 0 on success, 1 on any validation failure

The script has no network access and does not import any PEAK3 module — it is a pure data-format converter.

### Running the exporter

```bash
# from repo root
.venv/bin/python scripts/build_web_dataset.py
```

---

## 5. Key Field Mapping (CSV → Web Schema)

### 1-year leaderboard (`top_250_1_year_prime.csv`)

| CSV column | Web field |
|-----------|-----------|
| `Rank` | `rank` |
| `Player` | `player_name` (slug → `player_slug`, `player_id`) |
| `Best season` | `start_season` = `end_season` = `anchor_season` |
| `Prime raw` | `prime_index` |
| `Prime display` | `prime_score` |
| `SI contribution` | `components.statistical_impact` |
| `TP contribution` | `components.traditional_production` |
| `Recognition contribution` | `components.individual_recognition` |
| `Postseason contribution` | `components.postseason_individual_value` |
| `Team Achievement contribution` | `components.team_achievement` |
| `Teammate adjustment` | `components.teammate_adjustment` |
| `Data completeness status` | `data_status` |

### Multi-year leaderboards (2/3/5-year)

Same as above with these differences:

| CSV column | Web field |
|-----------|-----------|
| `Best window` (e.g. `"1990-91-1991-92"`) | `start_season` (first season), `end_season` (last season) |
| `Anchor season` | `anchor_season` |
| `Avg SI contribution` | `components.statistical_impact` |
| `Avg TP contribution` | `components.traditional_production` |
| `Avg Recognition contribution` | `components.individual_recognition` |
| `Avg Postseason contribution` | `components.postseason_individual_value` |
| `Avg Team Achievement contribution` | `components.team_achievement` |
| `Avg Teammate adjustment` | `components.teammate_adjustment` |

### Window ID construction

```
player_slug  = slug(player_name)   # lowercase, hyphens, ASCII-folded
anchor_nodash = anchor_season.replace("-", "")   # "1990-91" → "199091"
window_id = f"{player_slug}-{n}yr-{anchor_nodash}"
# e.g. "michael-jordan-1yr-199091"
```

---

## 6. Risks and Limitations

| Risk | Severity | Notes |
|------|----------|-------|
| `cache/processed/` not committed | Medium | Full score rebuild requires local parquet; Phase 1 is read-only from CSVs |
| No player photos | Low | Web front end must source or omit images separately |
| Season string parsing fragility | Low | Multi-year "Best window" parsed via regex `(\d{4}-\d{2})`; format is consistent across all CSVs |
| 2yr CSV has 249 rows, 5yr has 237 rows | Low | Fewer qualifying windows for longer durations; normal — some players lack enough prime seasons |
| Player slug collisions | Very Low | Checked: 250 unique slugs across all durations; `unidecode` normalises accents (e.g. Jokić → jokic) |
| Static export becomes stale | Low | Must re-run `build_web_dataset.py` whenever leaderboard CSVs are updated |

---

## 7. Architecture Decision: Static Export Pipeline

```
peak3.py (scoring)
    ↓
leaderboards/*.csv (committed canonical output)
    ↓
scripts/build_web_dataset.py (this audit's scope)
    ↓
data/web/*.json (static, versioned by source_commit)
    ↓
FastAPI (loads JSON into memory at startup, serves REST endpoints)
    ↓
Next.js (SSG/ISR pages consume FastAPI)
```

**Rationale:**
- Separates scoring correctness (Python/pandas) from web serving (FastAPI/Next.js)
- JSON files are small enough to ship as static assets or embed in the API server's startup cache
- `metadata.json` carries `source_commit` so the web layer can display provenance
- No database needed for Phase 1: 984 peak windows fit comfortably in memory

---

## 8. Generated Artifacts

After running `build_web_dataset.py`:

| File | Size | Contents |
|------|------|----------|
| `data/web/metadata.json` | ~500 B | schema_version, model_version, timestamps, counts |
| `data/web/leaderboards.json` | ~645 KB | 4 duration arrays keyed by "1"/"2"/"3"/"5" |
| `data/web/peak_windows.json` | ~603 KB | 984 windows sorted by prime_index desc |
| `data/web/methodology.json` | ~7 KB | Formula weights, component descriptions, calibration notes |

All files verified as valid JSON. Rank-1 regression checks passed for 1yr and 5yr (Michael Jordan, anchor 1990-91).
