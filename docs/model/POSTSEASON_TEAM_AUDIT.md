# Postseason Value & Team Achievement — audit (Phase 12A)

Manual review flagged a set of Postseason Value (PO) and Team Achievement
(TEAM) values as "suspicious". This document traces both components through
the code, runs the flagged cases against the real scored table, and separates
**defensible behaviour** from **actual bugs** from **deferred formula
concerns**.

Data: `cache/processed/scored_1980_2026.parquet` (the committed scored output).
Formula: `peak3.py` at `4cac129`.

**Headline result:** one concrete data bug (a stale `playoff_round` label,
confined to 2025-26, fixed in this phase), and no formula bug. Every other
flagged value is the formula behaving as its own contract specifies. The real
problem is that the contract was never surfaced to users — which is what the
rankings-modal work in this phase addresses.

---

## 1. What the two components actually are

### Postseason Value — `peak3.py::postseason_value` (18% weight)

**PO measures individual playoff RATE PERFORMANCE. It does not measure winning.**
The function's own docstring is explicit: "championships, round reached and
Finals MVP do NOT enter here". Those live in TEAM and in Individual
Recognition.

    PO = clip(reliability_adjusted_level + elevation, -PO_PENALTY_CAP, ∞)
       + deep_run            (≥ 0)
       + dominance           (≥ 0)

| Term | Meaning | Key constants |
|---|---|---|
| `level_full` | Weighted blend of playoff BPM/OBPM/DBPM/WS48/PER (50%), scoring, efficiency, playmaking, rebounding, defence — scaled ±15% by opponent quality | — |
| `abs_level` | `level_full − 25`, floored at `−14` | `PO_BASELINE=25`, `PO_PENALTY_CAP=14` |
| `sample_reliab` | 0.40·minutes/850 + 0.35·games/19 + 0.25·series/4, clipped to [0,1] | `PO_REL_*` |
| `reliab_level` | `abs_level × sample_reliab` | — |
| `elevation` | `0.55 ×` (playoff rate − regular rate), declines damped ×0.35, capped `[−6, +14]`, then × `sample_reliab` | `PO_ELEV_*` |
| `deep_run` | `0.26 × max(level_full − 42, 0) × volume × responsibility(usage)` | `PO_DEEPRUN_*` |
| `dominance` | `2.05 × √(max(level_full − 50, 0)) × sample_reliab × series_fraction` | `PO_DOMINANCE_*` |

Three properties drive almost every "suspicious" case:

1. **Missing the playoffs is exactly 0.0** — `val = where(played, val, 0.0)`.
   It is a *no-evidence* value, not a good one.
2. **Playing badly in the playoffs can be negative** (bounded at −14 before the
   `deep_run`/`dominance` additions).
   **Therefore: missing the playoffs scores higher than a poor playoff run.**
3. **Two thresholds create step-like behaviour** in `level_full`: `42`
   (deep-run credit begins) and `50` (dominance credit begins). A run at 42.5
   and a run at 65 are separated by far more than their 22-point level gap
   suggests.

### Team Achievement — `peak3.py::team_achievement_row` (3% weight)

    TEAM = advancement(0..100) × role_multiplier,   0 if advancement == 0

Advancement is interpolated from `playoff_round_score` against anchors
`{30→0, 50→30, 70→58, 85→80, 100→100}`, with explicit overrides to 100 for
`championship`/`best_player_title`/`co_best_player_title`, 80 for
`finals_appearance`, 58 for `conf_finals`. A first-round exit or no playoffs is
**exactly 0**.

**TEAM is pure team result, weighted 3%** — a maximum of 3.0 index points.
It cannot meaningfully offset an individual gap, and it does **not** include
regular-season team strength.

### Is TEAM double-counting with PO?

**No.** They read disjoint inputs. PO reads `po_*` box-score columns and never
reads `championship`, `finals_appearance`, `conf_finals` or
`playoff_round_score` except through `series_n`/`sample_reliab` (how *much*
playoff basketball was played, not how far the team got). TEAM reads only the
round flags and never a box score. Opponent quality appears once, in PO.

### Do Rankings and Peak Duel use the same PO?

**Yes — one path, verified.** Both read `components.postseason_individual_value`
from `data/web/peak_windows.json`, produced by
`scripts/build_web_dataset.py::parse_*_row` from the
`Postseason contribution` column of `leaderboards/top_250_*_year_prime.csv`.
`apps/api/app/services/explanation.py` (the Duel) and the rankings modal
consume the identical field. **There is no divergent Duel scoring path.**

---

## 2. Case table

`level_full` is reconstructed as `po_abs_level + 25`. PO is the raw component
(`postseason_perf`); the 18% weighting turns it into the `Postseason
contribution` the UI shows.

| Player | Season | Tm | PEAK | **PO** | **TEAM** | Round | PO g/min | PO BPM | Reg BPM | Reliab | level_full | level | elev | deep | dom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hakeem Olajuwon | 1993-94 | HOU | 90.50 | **50.73** | 100.0 | Champion | 23 / 989 | 8.5 | 6.8 | 1.00 | 60.2 | 35.23 | +4.21 | 4.72 | 6.56 | Defensible |
| Manu Ginobili | 2004-05 | SAS | 76.61 | **57.15** | 69.8 | Champion | 23 / 772 | 9.2 | 6.9 | 0.96 | 65.1 | 38.59 | +6.40 | 4.49 | 7.66 | Defensible |
| Victor Wembanyama | 2025-26 | SAS | 90.06 | **40.28** | 65.6 | *(label stale)* | 21 / 713 | 9.1 | 10.7 | 0.94 | 59.7 | 32.49 | −1.79 | 3.60 | 5.98 | Defensible |
| Dwight Howard | 2008-09 | ORL | 86.16 | **45.61** | 46.2 | Finals | 23 / 903 | 6.2 | 4.5 | 1.00 | 58.1 | 33.10 | +3.70 | 2.97 | 5.83 | Defensible |
| Kobe Bryant | 2007-08 | LAL | 84.14 | **32.55** | 65.6 | Finals | 21 / 863 | 7.4 | 5.8 | 1.00 | 51.4 | 26.35 | +1.38 | 2.44 | 2.39 | Defensible |
| Klay Thompson | 2015-16 | GSW | 54.86 | **15.62** | 48.6 | Finals | 24 / 849 | 4.2 | 1.8 | 1.00 | 35.7 | 10.69 | +4.93 | 0 | 0 | Defensible |
| Scottie Pippen | 1995-96 | CHI | 71.30 | **14.75** | 72.3 | Champion | 18 / 742 | 7.8 | 6.3 | 0.93 | 39.5 | 13.48 | +1.27 | 0 | 0 | Defensible |
| Jalen Brunson | 2024-25 | NYK | 60.83 | **14.40** | 47.6 | Conf Finals | 18 / 680 | 4.9 | 3.3 | 0.84 | 39.4 | 12.12 | +2.28 | 0 | 0 | Defensible |
| Jimmy Butler | 2022-23 | MIA | 76.29 | **13.79** | 61.6 | Finals | 22 / 874 | 6.6 | 8.7 | 1.00 | 42.5 | 17.54 | **−3.87** | 0.12 | 0 | Defensible, counterintuitive |
| Jalen Brunson | 2025-26 | NYK | 62.67 | **10.49** | **100.0** | *(label stale)* | 18 / 660 | 3.5 | 3.1 | 0.89 | 33.6 | 7.67 | +2.82 | 0 | 0 | **TEAM correct, label bugged** |
| Scottie Pippen | 1993-94 | CHI | 71.87 | **5.91** | 23.4 | Conf Semis | 10 / 384 | 5.6 | 7.7 | **0.49** | 39.6 | 7.13 | −1.22 | 0 | 0 | Defensible (anchor issue) |
| David Robinson | 1994-95 | SAS | 88.08 | **5.18** | 42.3 | Conf Finals | 15 / 623 | 6.1 | 9.2 | 0.76 | 37.0 | 9.09 | −3.91 | 0 | 0 | Defensible |
| Jalen Brunson | 2023-24 | NYK | 65.33 | **2.08** | 24.6 | Conf Semis | 13 / 518 | 3.8 | 5.8 | 0.61 | 31.8 | 4.14 | −2.06 | 0 | 0 | Defensible |
| David Robinson | 1993-94 | SAS | 87.88 | **0.47** | **0.0** | First Round | **4 / 146** | 6.2 | 11.9 | **0.20** | 33.3 | 1.70 | −1.23 | 0 | 0 | Defensible (tiny sample) |
| Victor Wembanyama | 2024-25 | SAS | 54.46 | **0.00** | 0.0 | Missed playoffs | — | — | 6.5 | 0.00 | — | 0 | 0 | 0 | 0 | Defensible (no evidence) |
| Kobe Bryant | 2005-06 | LAL | 80.59 | **−0.60** | 0.0 | First Round | 7 / 314 | 2.4 | 7.6 | 0.34 | 29.2 | 1.43 | −2.04 | 0 | 0 | Defensible |
| Joel Embiid | 2022-23 | PHI | 86.18 | **−2.10** | 24.6 | Conf Semis | 9 / 336 | 1.9 | 9.2 | 0.45 | 26.3 | 0.60 | −2.69 | 0 | 0 | Defensible |
| Klay Thompson | 2014-15 | GSW | 56.92 | **−8.09** | 68.7 | Champion | 21 / 761 | 1.9 | 4.4 | 0.96 | **20.3** | −4.55 | −3.54 | 0 | 0 | Defensible, counterintuitive |

---

## 3. Case-by-case explanation

### Jimmy Butler 2022-23 — PO 13.79 despite the 8-seed Finals run
The famous part of that run is the **team result**, and PEAK3 scores it there:
TEAM 61.6 out of a possible 100. PO asks a different question — how did he
rate per possession — and by playoff BPM he was **6.6 versus 8.7 in the regular
season**. He was excellent, but slightly *below his own regular-season rate*,
so elevation is −3.87. His `level_full` of 42.5 clears the deep-run threshold
by 0.5 (hence deep_run 0.12) and falls well short of the dominance knee at 50.

**Defensible.** The value is not measuring what a fan means by "that run".

### Manu Ginobili 2004-05 — PO 57.15, far above Butler
Ginobili's playoff BPM was **9.2 against a 6.9 regular-season baseline**: elite
rates *and* a genuine step up. That puts `level_full` at 65.1, which clears the
dominance knee by 15 and earns 7.66 dominance plus 4.49 deep-run. Butler's 42.5
earns neither. **The Butler↔Ginobili gap is mostly the two thresholds, not the
22-point level gap.** Defensible, and the single clearest example of why the
thresholds need explaining in the UI.

### Klay Thompson 2014-15 — PO −8.09 on a championship team
Playoff BPM **1.9 against a 4.4 regular-season baseline**. `level_full` 20.3 is
*below* the replacement baseline of 25, so `abs_level` is −4.55, and elevation
adds −3.54. **The negative is intentional and bounded** (`PO_PENALTY_CAP=14`).
The ring is scored in TEAM (68.7). Defensible — and note that his 2015-16
season, a Finals *loss*, scores PO **+15.62**, because he actually played
better. That pair is the cleanest demonstration that PO is not a winning metric.

### David Robinson 1993-94 — PO 0.47 vs Hakeem 1993-94 PO 50.73
Robinson played **4 playoff games, 146 minutes** before a first-round exit.
Sample reliability is 0.20, so his `abs_level` of 8.28 is shrunk to 1.70.
Hakeem played 23 games and 989 minutes at reliability 1.00 with a `level_full`
of 60.2, earning full level plus deep-run plus dominance.

**Defensible.** This is the sample-reliability system doing exactly its job:
four games is not evidence of a postseason. Note his 1994-95 season (15 games,
reliability 0.76) scores 5.18 — still modest, because his playoff rate (6.1
BPM) fell well below his 9.2 regular-season rate.

### Scottie Pippen vs Victor Wembanyama — the Duel comparison
This is the case that looks most wrong, and the cause is **anchor selection,
not PO**.

Pippen's highest single-season PEAK3 is **1993-94 (71.87)** — the post-Jordan
season where the Bulls lost the Conference Semifinals and he played 10 playoff
games at reliability 0.49. His 1995-96 title season scores **71.30**, only 0.57
lower, and carries PO 14.75 instead of 5.91. The 1Y board picks the higher
*total*, so the Duel shows Pippen anchored to a season with a weak postseason.

Wembanyama's 2025-26 is a genuine 21-game, 713-minute run at 9.1 playoff BPM
(`level_full` 59.7), earning deep-run and dominance credit.

**Defensible on the formula's terms**, but the presentation is misleading: a
user comparing "Pippen" to "Wembanyama" is not told they are seeing Pippen's
*non-title* season. **Deferred concern**, recorded in §5.

### Jalen Brunson — PO barely moves with team success
2023-24 PO 2.08, 2024-25 PO 14.40, 2025-26 PO 10.49. His playoff BPMs (3.8,
4.9, 3.5) are good-not-elite, so `level_full` never approaches the 42 deep-run
threshold and he collects level + a small elevation only. **Defensible.** His
team success is scored in TEAM (24.6 → 47.6 → 100.0), which is exactly where
the design puts it.

### Joel Embiid 2022-23, Kobe Bryant 2005-06 — small negatives
Both played short, below-baseline runs (9 games / 7 games) at rates far below
their regular seasons. Small bounded negatives. Defensible.

---

## 4. Bug found and fixed: stale `playoff_round` label in 2025-26

**This is the one concrete bug in the audit, and it is a data bug, not a
formula bug.**

For the 2025-26 season only, the `playoff_round` *string* disagrees with the
numeric flags that PEAK3 actually scores from:

| Check | Result |
|---|---|
| Rows where `championship == 1` but label ≠ "Champion" | **9** (all 2025-26) |
| Rows where `finals_appearance == 1` but label ∉ {Finals, Champion} | **18** (all 2025-26) |
| Same checks, 1979-80 … 2024-25 | **0** |

In 2025-26 the label saturates at "Conference Finals":

| label | `playoff_round_score` 70 | 85 | 100 |
|---|---|---|---|
| Conference Finals | 18 | **9** | **9** |

The string was written from a bracket state captured before the Finals
resolved; the numeric flags (`championship`, `finals_appearance`,
`conf_finals`, `playoff_round_score`) carry the final outcome. Source:
`nba_peak/context/postseason.py::derive_team_postseason` sets `round_cat` from
the parsed bracket's `deepest_round`.

### Blast radius

| Consumer | Reads | Affected? |
|---|---|---|
| PEAK3 TEAM (`_advancement_value`) | flags + `playoff_round_score` | **No** — scores correctly |
| PEAK3 PO | `po_*` box score | **No** |
| Daily Grid `outcome_champion` / `_finals` / `_conf_finals` | flags | **No** |
| Daily Grid `outcome_missed_playoffs` | label, but `Missed playoffs` ↔ `made_playoffs` is coherent | **No** |
| Daily Grid rejection message (`validation.py`) | **label** | **YES — user-visible false statement** |

The user-visible symptom: submitting a 2025-26 champion into a "Champion"
square that they fail for another reason produced *"…that team finished at
conference finals."* — a false claim about a real team, printed to the player
as a teaching sentence.

**Fix:** `nba_peak/daily_grid/pool.py` now derives the round label from the
authoritative flags (`canonical_playoff_round`) rather than trusting the
string. No PEAK3 score changes; no leaderboard artifact changes. Regression
tests pin flag/label agreement across the whole pool.

---

## 5. Deferred formula concerns (no change made)

Recorded, not acted on. None of these is a bug; each is a design property whose
*presentation* is the real problem.

1. **Missing the playoffs (0.0) outranks a bad playoff run (negative).**
   Structurally, a player who never qualified is treated better than one who
   qualified and underperformed. Defensible as "0 = no evidence", but it means
   PO is not monotone in postseason quality across the missed/played boundary.
   Changing it would move scores league-wide and is out of scope here.

2. **The 42 / 50 thresholds are steep.** `deep_run` and `dominance` both switch
   on inside an 8-point band of `level_full`, which is where the
   Butler↔Ginobili and Pippen↔Wembanyama gaps mostly come from. A smoother
   ramp would compress those gaps, but it is a genuine formula change requiring
   full re-generation and re-validation.

3. **1Y anchor selection can pick a player's non-title season**, which makes
   PO/TEAM comparisons in the Duel and rankings read strangely (Pippen). The
   anchor is correct by the stated rule ("highest total PEAK3 season"); the
   issue is that the UI does not say *which* season it picked loudly enough.

4. **`season_complete` is a per-player availability flag, not a league-season
   flag.** It is 0 for ~74–77% of rows in every recent season, including
   completed ones. It is not evidence that a season is in progress, and it
   should not be read that way. (`Data completeness status` in the leaderboard
   CSVs is a third, unrelated notion — data coverage.) No bug; a naming hazard.

---

## 6. Recommendations

| # | Recommendation | Status |
|---|---|---|
| 1 | Derive `playoff_round` from the authoritative flags | **Done** (this phase) |
| 2 | Pin flag/label agreement with a regression test | **Done** |
| 3 | Pin the suspicious PO/TEAM values so a future change cannot move them silently | **Done** (`tests/test_postseason_team_audit.py`) |
| 4 | Explain PO's contract in the rankings modal — that it is rate performance, that 0 means "did not play", that short samples are shrunk | **Done** (row-specific receipts) |
| 5 | Smooth the 42/50 thresholds | **Deferred** — real formula change |
| 6 | Revisit the missed-playoffs / negative-PO ordering | **Deferred** — real formula change |
| 7 | Surface the anchor season more prominently in Duel comparisons | **Deferred** — Duel UI is out of scope this phase |

**No PEAK3 formula change was made in this phase.** No `leaderboards/*.csv`
were edited and no scored artifact was regenerated.
