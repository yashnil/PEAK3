# PEAK3 v2 — formula design

**Status:** design, written before any v2 scoring code.
**Predecessor:** [PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md](PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md) (Phase 12B).
**Companion:** [PEAK3_V2_BLAST_RADIUS.md](PEAK3_V2_BLAST_RADIUS.md) (measured movement, written after).

v2 changes **one component**: postseason. Everything else is held fixed
deliberately, and §6 says why.

---

## 1. The v1 component map

`prime_index` is an open weighted sum, assembled in `peak3.py::score_dataset`
(`peak3.py:2200-2231`), then remapped monotonically to `prime_score` by
`calibrate_score` (`peak3.py:1371`).

| # | Component | Weight | Producer | Line |
|---|---|---|---|---|
| 1 | Statistical Impact | 0.38 | `statistical_impact(df)` | 1538 |
| 2 | Traditional Production | 0.21 | `traditional_production(df)` | 1668 |
| 3 | Individual Recognition | 0.20 | `recognition_row(row)` | 1136 |
| 4 | Playoff Rate Impact | 0.18 | `postseason_value(df, has_po)` | 1838 |
| 5 | Team Result | 0.03 | `team_achievement_row(row)` | 1165 |
| + | Teammate adjustment | — | inline, capped ±0.5 | 2171 |

```
prime_raw   = Σ (weight_i · component_i) + teammate_adjustment
prime_score = calibrate_score(prime_raw)          # monotone, 0–100
```

### v1 postseason internals

```
level_full  = 0.50·rate + 0.18·scoring + 0.10·eff + 0.08·playmaking
            + 0.06·rebounding + 0.08·defense,  × opponent-quality factor
abs_level   = clip(level_full − PO_BASELINE, −PO_PENALTY_CAP, ∞)     # 25.0, 14.0
reliab      = 0.40·minutes + 0.35·games + 0.25·series                # ∈ [0,1]
reliab_level= abs_level · reliab
elevation   = clip(0.55·(playoff_rate − regular_rate), −6, +14) · reliab, then a guard
rate_quality= clip(reliab_level + elevation, −PO_PENALTY_CAP, ∞)
deep_run    = 0.26 · max(level_full − 42, 0) · load · responsibility   ≥ 0
dominance   = 2.05 · √(max(level_full − 50, 0)) · reliab · series_frac ≥ 0
postseason  = rate_quality + deep_run + dominance
```

---

## 2. What v1 gets right — and must survive

These are load-bearing and v2 keeps all of them.

1. **The skill composite.** `level_full` is a well-built, era-neutral blend of
   rate, scoring, efficiency, playmaking, rebounding and defence, opponent-
   adjusted. Measured against playoff BPM it correlates **r = +0.61**. The
   *measurement* is sound; only its **zero point** is wrong.
2. **Reliability as a single confidence signal.** Minutes × games × series in
   one `[0,1]` number, counted once, is the right shape.
3. **Responsibility from usage.** Deriving carry-burden from `po_usg_pct`
   rather than from narrative is exactly right.
4. **Diminishing returns on the tail.** The √ dominance curve replaced an
   open-ended linear booster; it should stay.
5. **Advancement is not scored here.** Series count is a *sample* signal only.
   Rounds and rings live in Team Result. No double-counting.
6. **Non-playoff seasons are exactly 0**, never a positive default.

---

## 3. What v1 gets wrong

### 3.1 The baseline is at the 80th percentile of its own distribution

`PO_BASELINE = 25.0` is documented as "a routine playoff contributor sits near
here." Recomputing `level_full` across all 5,756 playoff player-seasons:

| statistic | value |
|---|---|
| p25 | −0.84 |
| **p50** | **10.05** |
| p75 | 21.74 |
| p90 | 34.48 |
| **`PO_BASELINE` sits at percentile** | **80.0** |
| minutes-weighted p25 | **5.65** |
| minutes-weighted p50 | 15.24 |

So "routine" was set roughly **2.5× above** the level of an actual routine
playoff contributor. Everything downstream inherits the error: **80.0%** of
playoff seasons are below the baseline and **68.3%** finish negative — scoring
below every player who did not make the playoffs at all.

This is the whole inversion. It is a **zero-point error, not a measurement
error**, which is why the fix can be surgical.

### 3.2 The penalty cap destroys information

`abs_level` is clipped at −14. **52.3%** of all playoff player-seasons hit that
clip. Half the playoff population is pinned to one identical value, so within
the negative region the component distinguishes nothing — a marginal bench
player and a catastrophic starter score the same.

*(Phase 12B reported a "floor at 11.00" in `level_full`. That was the
`−PO_PENALTY_CAP` clip read back through `po_abs_level + 25`, not a floor in the
composite. The composite is not floored: `po_rate` among clipped rows ranges
−243.5 to +20.4 and correlates +0.96 with playoff BPM. Corrected here.)*

### 3.3 Reliability shrinks the penalty backwards

`reliab_level = abs_level · reliab` multiplies a **signed** quantity. For a
negative `abs_level` this means:

> the more playoff basketball you played, the larger your penalty.

A 4-game cameo below baseline is shrunk toward 0; a 23-game starter below
baseline takes the full −14. That is the opposite of what a confidence weight
should do — more sample should mean more confidence in the *estimate*, not a
bigger penalty. It is why **50.5%** of ≥36-MPG playoff seasons are still
negative, and why **36.4%** of champions playing ≥30 MPG are negative.

The cleanest illustration is **Klay Thompson 2014-15**: level 18.37 —
*above* the minutes-weighted median of 15.24 — over a full 21-game title run at
36.2 MPG, reliability 0.96. v1 scores it **−8.09**.

### 3.4 Run length is invisible

`deep_run` needs `level_full > 42` (≈ p93) and `dominance` needs `> 50` (≈ p97).
For ~90% of playoff seasons both are exactly zero, so the component reduces to a
rate statistic. Hence **r = +0.078** with playoff games, against **+0.61** with
playoff BPM.

### 3.5 The elevation-reversal guard is a patch over a contradiction

v1's own docstring says elevation "SUPPLEMENTS absolute quality (does not
replace it)", but the implementation lets a negative elevation reverse a
positive level. `PO_ELEV_GUARD_*` (three constants, `peak3.py:1755-1757`) exists
to stop that. v2 should make the structure honest instead of guarding it.

---

## 4. v2 design principles

**A. Regular-season greatness stays the foundation.** Weights are unchanged:
38 / 21 / 20 / 18 / 3. v2 is not a rebalancing.

**B. Zero means replacement, and replacement is derived, not asserted.**
Replacement level = the level a playoff team can readily substitute, i.e. a
marginal rotation player. Operationally the **minutes-weighted 25th percentile**
of playoff level. Minutes-weighting describes the level of *playoff minutes
actually played* rather than of roster spots, so two-minute cameos do not define
the floor. The value is derived once from the committed dataset, **frozen as a
documented constant** for reproducibility, and a test re-derives it and fails if
the data drifts away from it.

**C. Confidence shrinks the estimate toward replacement, in both directions.**

```
est_edge = (level_full − replacement) · reliability
```

This is shrinkage toward the prior mean. A short run with an extreme rate is
pulled toward replacement (so a low-minute spike cannot dominate a high-burden
carry run — principle D). A short run with a terrible rate is *also* pulled
toward replacement (so a 4-game cameo is not hugely negative). A long run is
trusted in either direction. One rule, both tails, no sign asymmetry.

**D. Negative is rare, gated, and bounded.** Below replacement there is a
**dead band**: slightly below replacement is *neutral*, not negative. Only a run
that is well below replacement **and** well observed produces a penalty, and the
penalty is capped far below v1's −14. "Genuinely harmful, high-sample collapse"
becomes a literal gate rather than an aspiration.

**E. Every term except the single collapse penalty is non-negative.** v2 is

```
postseason_v2 = quality + elevation + carry + dominance − collapse
```

with the first four ≥ 0. This removes the reversal contradiction (§3.5) and
retires `PO_ELEV_GUARD_*` — the guard is unnecessary once elevation cannot
reverse a level.

**F. Run length earns credit through load, never through rounds.** `carry`
scales with playoff minutes **and** games and with usage-derived
responsibility. Rounds reached stay out of this component entirely; they remain
Team Result's job. Target: correlation with playoff games materially above
+0.078, but well below the correlation with playoff quality, so the component
stays an individual measure.

**G. No player-specific anything.** No name appears in v2 scoring code. Every
term is a function of data fields.

---

## 5. Exact scope

### Changed
- **Postseason component only.** New `postseason_value_v2` beside the untouched
  v1 function.

### Unchanged (verified, not assumed — see §6)
- `OFFICIAL_WEIGHTS`, `calibrate_score` and its anchors
- Statistical Impact, Traditional Production, Recognition
- Team Result (`team_achievement_row`, `_advancement_value`, role multipliers)
- Teammate adjustment
- Window aggregation (`n_year_windows`), anchor selection

### Calibration-scale constraint

`calibrate_score`'s anchors were fitted to v1's `prime_raw` distribution.
Refitting them for v2 would move every score for reasons unrelated to the
postseason fix and destroy v1↔v2 comparability. So **v2's postseason component
is deliberately held to approximately v1's scale** among the players who define
the top of the board, and the anchors are reused unchanged. The distribution
shift is measured and reported in the blast-radius doc rather than absorbed
silently.

---

## 6. TEAM and REC — evaluate, default to unchanged

Phase 12B found Team Result arithmetic **clean**: zero mismatches in both
directions, champions all above zero, weighted range exactly 0.00–3.00. It also
found REC cuts actively harmful — they demote defensive-specialist peaks
(Noah +19, Wallace +17 under a 25% cut) to promote high-usage scorers, trading
one distortion for another.

Default for both: **unchanged**, with the decision recorded and, for REC, a
check that finalized 2024-25 / 2025-26 awards carry no in-progress leakage.
Changing either would need its own evidence; "v2 is a good moment to also
change X" is not evidence.

---

## 7. Compatibility and versioning plan

### The problem
`peak3.py` has **no version identifier**. The string `peak3_official_weights_v1`
is hand-copied into four files (`scripts/build_top_peaks.py:104`,
`scripts/build_top_seasons.py:100`, `nba_peak/perfect_season/config.py:126`,
`scripts/build_experimental_card_extension.py:206`) and would not change if
`OFFICIAL_WEIGHTS` did. Any v2 work must fix that first or version drift is
guaranteed.

### The plan
1. **`nba_peak/formula_version.py`** — one module owning `FormulaVersion`
   (`"peak3_v1" | "peak3_v2"`), `DEFAULT_FORMULA_VERSION`, and the descriptive
   strings. The four duplicated literals are re-pointed at it. v1's string stays
   byte-identical so existing artifacts and saved rows still match.
2. **v1 functions are not edited.** `postseason_value` keeps its name, body and
   constants. v2 lives in `postseason_value_v2` next to it, and `score_dataset`
   takes a `formula_version` argument defaulting to **v1**.
3. **Separate artifacts.** `top_1000_peaks.v1.json` and
   `top_1000_seasons.v1.json` are not rewritten. v2 generates
   `top_1000_peaks.v2.json` / `top_1000_seasons.v2.json`. Every row and explain
   block carries `model_version`.
4. **Default stays v1** until the blast radius is documented, tests pass and
   manual review is done. v2 ships as an explicitly-labelled preview.
5. **Saved results keep their version.** Anything already recorded against v1
   continues to reference v1.

### Architecture check
The artifact layer already parameterises paths and version strings per script,
so parallel v1/v2 generation needs no refactor of the generators — only the
shared version module and a `--formula-version` switch. **No blocking refactor
is required.** If that turns out to be false during implementation, the phase
stops and reports rather than hacking around it.

---

## 8. UI / leaderboard impact

- Rankings rows and explain payloads expose `model_version`.
- Methodology states which version is default and that the other exists.
- Peak Duel, Daily Grid and 82-0 continue to read the artifacts they read today,
  which remain v1 — so no game result changes model version implicitly.
- Separately from the formula: the 1Y board is labelled **"highest-scoring
  single season"** and the modal surfaces narrowly-beaten iconic seasons. That
  is a clarity fix for anchor selection, not a scoring change, and it ships
  regardless of the v2 default decision.

---

## 9. Testing plan

**v1 preservation** — v1 remains byte-reproducible: the shipped top-10 scores,
the committed v1 artifacts, and `postseason_value` outputs are pinned.

**v2 correctness** — determinism; components reconcile to the index; no NaN/Inf;
every term's sign contract holds (only `collapse` may be negative).

**v2 calibration targets** — measured, with the numbers asserted:
negative rate overall, negative rate among ≥30 MPG / ≥10 G, champions and
Finals participants with real minutes, correlation with playoff games and with
playoff quality, top-10 stability.

**Named cases** — the Phase 12B suspicious list, asserted as *properties*
(e.g. "a full-minutes title run is not negative"), never as hardcoded per-player
scores, so the tests cannot become the hidden exceptions rule G forbids.

**Anchor UI** — nearby-iconic-season selection is deterministic and covers the
LeBron / Kobe / Pippen cases.

**Versioning** — artifacts are not cross-written, payloads carry
`model_version`, and the frontend displays it.
