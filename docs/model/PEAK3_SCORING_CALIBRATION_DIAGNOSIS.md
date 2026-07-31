# PEAK3 scoring calibration — diagnosis (Phase 12B)

Manual review of the top-50 Peak Windows produced a list of "this looks wrong"
reactions. This document answers them with the served rows and their inputs,
and separates four different kinds of finding:

| Class | Meaning |
|---|---|
| **BUG** | The code or data is wrong. Fix it. |
| **DEFENSIBLE** | The formula is doing what it says; the explanation was missing. |
| **CALIBRATION** | Not a bug, but the weighting produces outcomes worth reconsidering. |
| **PRODUCT** | A presentation/UX decision, not a scoring one. |

Everything here is reproducible: `nba_peak/calibration_diagnostics.py` loads the
committed served artifacts read-only and answers each query deterministically.
Variant experiments live in
[PEAK3_FORMULA_VARIANT_EXPERIMENTS.md](PEAK3_FORMULA_VARIANT_EXPERIMENTS.md).

**One bug was found and fixed** (stale 2025-26 "in progress" labelling, §2).
**No production score moved in this phase.**

---

## 1. Headline findings

| # | Finding | Class |
|---|---|---|
| 1 | 2025-26 was labelled "in progress" by a hardcoded constant. The season is complete. | **BUG — fixed** |
| 2 | PO measures playoff RATE, confirmed quantitatively: r=+0.61 with playoff BPM, +0.25 with playoff MPG, **+0.08 with playoff games**. | DEFENSIBLE |
| 3 | **68.3% of all playoff player-seasons score below 0 on PO** — i.e. below every player who missed the playoffs entirely. | **CALIBRATION** |
| 4 | Among heavy-load deep runs (≥30 playoff MPG, ≥10 games), **48% are still negative**. | **CALIBRATION** |
| 5 | The 42/50 PO thresholds do **not** produce cliffs. Phase 12A's hypothesis was wrong — see §3.3. | DEFENSIBLE |
| 6 | TEAM maps to advancement with **zero mismatches** across 10,435 rows. | DEFENSIBLE |
| 7 | REC uses **100% of its available range** in the top 100; PO uses 87%, SI 58%. REC is the most discriminating component in the elite tier. | **CALIBRATION** |
| 8 | Anchor selection flips a player's representative season on gaps as small as **0.16 points**, and systematically favours the non-title season. | **PRODUCT** |
| 9 | Four top-100 rows made no playoffs (PO 0, TEAM 0), the highest at rank 47. | PRODUCT |

---

## 2. 2025-26 finalization — the one bug

### What was wrong

Both ranking generators carried a hardcoded constant:

```python
_IN_PROGRESS_SEASON = "2025-26"      # scripts/build_top_peaks.py, build_top_seasons.py
```

Its stated justification was *"the most recent season in the committed parquet
is still in progress (season_progress_pct < 1.0)"*. That does not survive
contact with the data:

| season | `season_progress_pct` | max games |
|---|---|---|
| 2016-17 | 0.9878 | 82 |
| 2021-22 | **0.9390** | 82 |
| 2022-23 | 0.9634 | 82 |
| 2024-25 | 0.9634 | 82 |
| 2025-26 | **0.9512** | 82 |

`season_progress_pct` is a per-season constant that is below 1.0 for **every**
season since at least 2016-17 — 2021-22 is *lower* than 2025-26 and nobody
labelled it in progress. It never distinguished a live season from a finished
one. The constant was simply the newest season when it was written, and it went
stale the moment that season ended.

### 2025-26 is complete

| season | MVP | MVP votes | DPOY | All-NBA | All-Def | All-Star | champs | Finals | **Finals MVP** | made PO | max g |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2022-23 | 1 | 13 | 1 | 15 | 10 | 24 | 8 | 16 | 1 | 119 | 82 |
| 2023-24 | 1 | 9 | 1 | 15 | 10 | 26 | 8 | 15 | 1 | 121 | 82 |
| 2024-25 | 1 | 12 | 1 | 15 | 10 | 25 | 9 | 19 | 1 | 126 | 82 |
| **2025-26** | **1** | **8** | **1** | **15** | **10** | **28** | **9** | **18** | **1** | **133** | **82** |

Every marker matches its predecessors. **A season with a Finals MVP awarded is
over.**

### The fix

`nba_peak/season_status.py` derives the answer from the data: a season is
finished when a champion was crowned **and** a Finals MVP was awarded. Both
generators call it; the hardcoded constant is gone. A genuinely unfinished
future season would still be caught, and there is nothing to keep in sync.

### Blast radius — label only

| Artifact | rows | score/rank changes | `season_in_progress` flips |
|---|---|---|---|
| Peak Windows 1Y | 1000 | **0** | 56 |
| Peak Windows 3Y | 893 | **0** | 31 |
| Peak Windows 5Y | 685 | **0** | 10 |
| Single Seasons | 1000 | **0** | 25 |

**Zero scores and zero ranks moved.** Rows still flagged in progress after the
fix: **0**.

### The two rows the brief calls out

| row | rank | score | games | mpg | BPM | awards | postseason | in progress | caveats |
|---|---|---|---|---|---|---|---|---|---|
| Victor Wembanyama 2025-26 | 12 | 90.06 | 64 | 29.2 | 10.7 | **DPOY**, MVP-3, All-NBA 1st | 21 g, 9.1 BPM, Finals | **false** | 1 (availability) |
| Shai Gilgeous-Alexander 2024-25 | 6 | 92.90 | 76 | 34.2 | 11.5 | **MVP**, All-NBA 1st | 23 g, **champion + Finals MVP** | **false** | 0 |

Both use complete final data. Wembanyama's remaining caveat is a genuine
durability signal (64 of 82 games), not missing data. **Neither row was reduced,
and neither is suspicious** — the premise in the brief holds.

---

## 3. Postseason Value

### 3.1 What PO actually correlates with

Over all 5,756 playoff player-seasons:

| PO correlates with | Pearson r |
|---|---|
| playoff BPM (**rate**) | **+0.608** |
| playoff minutes | +0.253 |
| playoff MPG (**load**) | +0.245 |
| team advancement | +0.095 |
| **playoff games (durability of the run)** | **+0.078** |

**PO is a rate metric with almost no sensitivity to how long the run lasted.**
That is what the docstring says it is — but the near-zero games correlation is
stronger than "individual, not team" implies, and is the root of most of the
review's complaints.

### 3.2 The case table

| player | season | rank | total | REC | **PO** | TEAM | po g | po mpg | PO BPM | reg BPM | Δ | reliab | level |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hakeem Olajuwon | 1993-94 | 10 | 90.50 | 19.82 | **9.13** | 3.00 | 23 | 43.0 | 8.5 | 6.8 | +1.7 | 1.00 | 60.2 |
| Kawhi Leonard | 2016-17 | 19 | 87.84 | 8.71 | **9.76** | 1.41 | **12** | 35.8 | **14.2** | 9.4 | +4.8 | 0.61 | **84.1** |
| Manu Ginobili | 2004-05 | 39 | 76.61 | 1.30 | **10.29** | 2.09 | 23 | 33.6 | 9.2 | 6.9 | +2.3 | 0.96 | 65.1 |
| Dwyane Wade | 2005-06 | 25 | 85.35 | 6.99 | **8.86** | 3.00 | 23 | 41.7 | 9.3 | 7.7 | +1.6 | 1.00 | 60.1 |
| Dirk Nowitzki | 2005-06 | 27 | 84.88 | 5.30 | **8.22** | 1.78 | 23 | 42.7 | 9.2 | 8.1 | +1.1 | 1.00 | 59.6 |
| Dwight Howard | 2008-09 | 23 | 86.16 | 16.48 | **8.21** | 1.39 | 23 | 39.3 | 6.2 | 4.5 | +1.7 | 1.00 | 58.1 |
| Giannis Antetokounmpo | 2019-20 | 8 | 91.28 | 19.95 | **3.68** | 0.74 | **9** | 30.8 | 11.2 | 11.5 | −0.3 | **0.42** | 65.1 |
| Jimmy Butler | 2022-23 | 40 | 76.29 | 3.30 | **2.48** | 1.85 | 22 | **39.7** | 6.6 | 8.7 | **−2.1** | 1.00 | 42.5 |
| David Robinson | 1994-95 | 18 | 88.08 | 14.91 | **0.93** | 1.27 | 15 | 41.5 | 6.1 | 9.2 | −3.1 | 0.76 | 37.0 |
| **Karl Malone** | **1996-97** | **20** | 86.98 | 14.32 | **0.24** | 1.97 | **20** | **40.8** | 4.0 | 8.3 | **−4.3** | **0.98** | 31.7 |
| Joel Embiid | 2022-23 | 22 | 86.18 | 14.15 | **−0.38** | 0.74 | 9 | 37.3 | 1.9 | 9.2 | −7.3 | 0.45 | 26.3 |
| Sidney Moncrief | 1982-83 | 50 | 72.96 | 11.52 | **−1.03** | 1.12 | 9 | 41.9 | 2.8 | 5.4 | −2.6 | 0.53 | 19.7 |
| Klay Thompson | 2014-15 | 167 | 56.92 | 1.98 | **−1.46** | 2.06 | 21 | 36.2 | 1.9 | 4.4 | −2.5 | 0.96 | 20.3 |

Two rows carry the whole diagnosis:

- **Karl Malone 1996-97** — the MVP, 20 playoff games at 40.8 MPG, a Finals run,
  full sample reliability (0.98) — scores **PO 0.24**. His playoff BPM collapsed
  from 8.3 to 4.0. The formula is measuring exactly what it claims, and the
  answer is still jarring: a Finals-run MVP gets essentially nothing.
- **Kawhi Leonard 2016-17** — **12 games**, an injury-shortened run, playoff BPM
  14.2 — scores **PO 9.76**, four times Butler's 22-game Finals run. Sample
  reliability (0.61) shrank it and it still won comfortably.

**Verdict: DEFENSIBLE on the formula's stated contract, CALIBRATION concern in
effect.** PO answers "how well did he play per possession when he played",
which is a real question — but it is not the question the component's *name*
implies, and the near-zero games correlation means a 12-game run and a 23-game
run are treated as near-equivalents.

### 3.3 The 42/50 thresholds do NOT cliff — correcting Phase 12A

Phase 12A hypothesised that the Butler↔Ginobili gap was "mostly the two
thresholds". **That was wrong.** Decomposing the 43.36-point raw PO gap:

| term | contribution to the gap | share |
|---|---|---|
| reliability-adjusted level | +21.05 | **48.6%** |
| elevation (vs own regular season) | +10.27 | **23.7%** |
| dominance (the 50 knee) | +7.66 | 17.7% |
| deep-run (the 42 knee) | +4.37 | 10.1% |

**72.3% of the gap is rate quality**, not threshold bonuses. Aggregate PO by
level band confirms a smooth ramp rather than a cliff:

| level_full band | n | mean PO | mean deep-run | mean dominance |
|---|---|---|---|---|
| 25–35 | 742 | 3.71 | 0.00 | 0.00 |
| 35–42 | 320 | 8.14 | 0.00 | 0.00 |
| 42–45 | 108 | 11.63 | 0.12 | 0.00 |
| 45–50 | 138 | 13.75 | 0.50 | 0.00 |
| 50–55 | 84 | 17.33 | 0.96 | 0.97 |
| 55–65 | 112 | 22.99 | 1.76 | 2.11 |

The step from 35–42 → 42–45 (+3.49) is *smaller* than 25–35 → 35–42 (+4.43).
Variant D (smoothing both knees) moves at most **4 ranks** in the top 100.
**Smoothing the thresholds is not worth doing** — it would add complexity to fix
something that is not happening.

### 3.4 The inversion — the real calibration finding

| population | n | PO |
|---|---|---|
| missed the playoffs | 4,679 | exactly **0.00** |
| played in the playoffs | 5,756 | — |
| …of whom score **below 0** | **3,930** | **68.3%** |
| …restricted to ≥30 playoff MPG and ≥10 games | **574 / 1,197** | **48.0%** |

**Two thirds of everyone who reached the playoffs is ranked below everyone who
missed them**, on the component meant to reward postseason play. Among genuine
heavy-load deep runs it is still nearly half. 214 champions and 442 Finals
participants carry negative PO.

This is the sharpest answer to the brief's question *"should missing the
playoffs be 0 while bad playoffs can be negative?"* — **as calibrated today, the
asymmetry is not a rare edge case; it is the modal outcome.**

Every negative-PO row in the top 100 is a **short** run:

| rank | player | season | PO | po g | po mpg |
|---|---|---|---|---|---|
| 22 | Joel Embiid | 2022-23 | −0.38 | 9 | 37.3 |
| 50 | Sidney Moncrief | 1982-83 | −1.03 | 9 | 41.9 |
| 54 | Isaiah Thomas | 2016-17 | −1.28 | 15 | 34.7 |
| 56 | Grant Hill | 1996-97 | −0.09 | 5 | 40.6 |
| 57 | Paul George | 2018-19 | −0.05 | 5 | 40.8 |
| 61 | Joakim Noah | 2013-14 | −0.82 | 5 | 42.0 |
| 88 | Chris Webber | 2000-01 | −1.57 | 8 | 43.5 |
| 98 | Jalen Duren | 2025-26 | −2.09 | 14 | 30.1 |

(14 rows total; median 9 games.) **Losing early is what produces negative PO**,
which is defensible as "small sample of below-baseline play" and reads to a fan
as "punished for making the playoffs".

---

## 4. Team Achievement

### Mapping verified — no bug

Recomputing advancement from the flags for all 10,435 rows:

- rows where advancement = 0 but TEAM > 0: **0**
- rows where advancement > 0 but TEAM = 0: **0**
- TEAM range 0.00–100.00 → weighted contribution **0.00–3.00**, exactly the 3% cap.

| player | season | TEAM (weighted) | raw | advancement | role mult | round |
|---|---|---|---|---|---|---|
| Michael Jordan | 1990-91 | 3.00 | 100.0 | 100 | 1.000 | Champion |
| Nikola Jokic | 2022-23 | 3.00 | 100.0 | 100 | 1.000 | Champion |
| Shai Gilgeous-Alexander | 2024-25 | 3.00 | 100.0 | 100 | 1.000 | Champion |
| Dwyane Wade | 2005-06 | 3.00 | 100.0 | 100 | 1.000 | Champion |
| Stephen Curry | 2015-16 | 1.97 | 65.6 | 80 | 0.820 | Finals |
| Victor Wembanyama | 2025-26 | 1.97 | 65.6 | 80 | 0.820 | Finals |
| Jimmy Butler | 2022-23 | 1.85 | 61.6 | 80 | 0.770 | Finals |
| Dirk Nowitzki | 2005-06 | 1.78 | 59.4 | 80 | 0.743 | Finals |
| Dwight Howard | 2008-09 | 1.39 | 46.2 | 80 | 0.577 | Finals |
| Giannis Antetokounmpo | 2019-20 | 0.74 | 24.6 | 30 | 0.820 | Conf Semis |
| Rudy Gobert | 2018-19 | 0.00 | 0.0 | 0 | — | First Round |
| Kevin Love | 2013-14 | 0.00 | 0.0 | 0 | — | Missed |

**Verdict: DEFENSIBLE, no bug.** Dwight Howard's 0.577 role multiplier on a
Finals team is the lowest of the group because the creation-burden proxy graded
him a secondary contributor — arguable, but it is the documented rule applied
consistently.

### Is TEAM too small?

At 3% it moves at most 3.0 index points, roughly the gap between ranks 20 and
24. Raising the cap barely reorders anything (variant H5, cap 5: 63/100 rows
move, max 6 places, **top 10 fully retained**). TEAM is small *by design* —
PEAK3 is an individual-peak model — and enlarging it does not fix any of the
cases the review flagged. **Recommend renaming rather than reweighting** (§8).

---

## 5. Individual Recognition

### REC is the most discriminating component in the elite tier

| component | max weight | observed range in top 100 | **% of weight actually used** | σ |
|---|---|---|---|---|
| SI | 38 | 16.81 – 38.93 | 58% | 4.91 |
| TP | 21 | 3.99 – 15.87 | 57% | 2.18 |
| **REC** | **20** | **0.00 – 20.00** | **100%** | **5.58** |
| PO | 18 | −2.09 – 13.53 | 87% | 3.46 |
| TEAM | 3 | 0.00 – 3.00 | 100% | 0.89 |

REC has the **largest standard deviation of any component** among top-100 rows —
larger than SI, which carries nearly twice the nominal weight. A 20-point swing
between an MVP+DPOY season and an unrecognised one is the single biggest
discriminator available in the elite tier.

This is the honest answer to *"does the model overreward regular-season awards
relative to postseason performance?"* — **by realized spread, yes**: REC
discriminates more than PO despite a smaller nominal weight, because PO's
distribution is compressed while REC's is saturated at both ends.

### Sensitivity

| variant | rows moved (top 100) | max move | top-10 retained |
|---|---|---|---|
| REC −15% | 77 | 13 | 9/10 |
| REC −25% | 84 | 19 | 9/10 |
| REC capped at 12 | — | 19 | **5/10** |

Under REC −25% the biggest losers are Joakim Noah 2013-14 (+19) and Ben Wallace
2002-03 (+13) — DPOY seasons whose value is *mostly* recognition. The biggest
gainers are high-PO, low-REC rows (Kawhi 2016-17, Chris Paul 2007-08).

**Verdict: CALIBRATION concern, not a bug.** REC double-counts regular-season
dominance already in SI/TP *by construction* (an MVP is voted on the same season
SI measures). Whether that is over-counting is a modelling judgement, not an
error — and cutting REC demotes defensive specialists, which is a different kind
of wrong.

---

## 6. Anchor selection

The 1Y Peak Windows board publishes **one row per player**: their highest-scoring
single season. That is mathematically correct and produces this:

| player | fan-expected | anchor **chosen** | chosen | expected | **gap** | chosen PO | expected PO | chosen TEAM | expected TEAM |
|---|---|---|---|---|---|---|---|---|---|
| LeBron James | 2012-13 | **2008-09** | 95.85 | 95.69 | **+0.16** | 13.53 | 8.39 | 1.43 | 3.00 |
| Kobe Bryant | 2008-09 | **2007-08** | 84.14 | 83.94 | **+0.20** | 5.86 | 8.87 | 1.97 | 3.00 |
| Scottie Pippen | 1995-96 | **1993-94** | 71.87 | 71.30 | **+0.57** | 1.06 | 2.65 | 0.70 | 2.17 |
| Giannis Antetokounmpo | 2020-21 | **2019-20** | 91.28 | 89.22 | +2.06 | 3.68 | 7.87 | 0.74 | 3.00 |
| Kawhi Leonard | 2018-19 | **2016-17** | 87.84 | 83.97 | +3.87 | 9.76 | 11.34 | 1.41 | 3.00 |
| Dirk Nowitzki | 2010-11 | **2005-06** | 84.88 | 78.29 | +6.59 | 8.22 | 6.94 | 1.78 | 3.00 |
| Stephen Curry | 2021-22 | **2015-16** | 93.90 | 74.32 | +19.58 | 2.96 | 6.88 | 1.97 | 3.00 |

For LeBron, Kobe and Pippen a **sub-1-point difference** decides which season
represents the player forever — and in **every** case the title season loses,
because it trades regular-season SI for PO and TEAM that cannot make it back.

This is the root cause of Phase 12A's unresolved "Pippen looks weak in Peak
Duel" complaint: the board anchors him to 1993-94 (PO 1.06, no title) over
1995-96 (PO 2.65, 72-10 champion) on a **0.57-point** margin.

**Verdict: PRODUCT, not a bug.** The rule is correct and stated. The problem is
that the UI implies "career peak" while the data means "highest-scoring single
season". Recommendations in §8.

---

## 7. No-playoff seasons

Four top-100 rows made no postseason at all (PO 0, TEAM 0):

| rank | player | season | total | SI | REC | games |
|---|---|---|---|---|---|---|
| 47 | Kevin Love | 2013-14 | 73.42 | 28.38 | 3.38 | 77 |
| 75 | Domantas Sabonis | 2023-24 | 66.10 | 22.94 | 3.17 | 82 |
| 87 | Andrei Kirilenko | 2003-04 | 64.64 | 24.07 | 3.32 | 78 |
| 100 | Zion Williamson | 2020-21 | 63.05 | 20.87 | 1.28 | 61 |

A further 14 top-100 rows reached the playoffs but scored TEAM 0 (first-round
exit), including Westbrook 2016-17 (#24) and McGrady 2002-03 (#26).

The highest no-playoff row sits at **#47**, forfeiting 21% of the formula. The
model already penalises them heavily by omission; no additional cap is needed.
Variant J (×0.95 for no-playoff seasons) moves Sabonis 75→89 and Love 47→54 —
a change with no principled magnitude behind it.

**Verdict: PRODUCT.** Recommend a label, not a cap: the board is "highest-scoring
single season", and a season with no postseason should say so on the row.

---

## 8. Recommendations

| # | Recommendation | Class | Status |
|---|---|---|---|
| 1 | Derive season completion from resolved playoffs, not a hardcoded season | BUG | **Shipped** |
| 2 | Test that no finalized season renders "in progress" | BUG | **Shipped** |
| 3 | Rename **Postseason Value → Playoff Rate Impact** in the UI; it measures per-possession play, not postseason importance | PRODUCT | **Shipped** |
| 4 | Rename **Team Achievement → Team Result** | PRODUCT | **Shipped** |
| 5 | Label the 1Y board explicitly as "highest-scoring single season", and surface the player's title seasons as nearby comparisons in the modal | PRODUCT | Recommended, not shipped |

The rename (3 and 4) was applied at every surface that names a component to a
reader — `componentLabel()` in the web app, the duel-explanation labels in the
API, the Daily Grid constraint labels, the weight bars on the home and
methodology pages, and the receipt prose. **Component keys, payload shapes and
constraint ids are untouched**, so no stored data, no API contract and no daily
puzzle changes; only the strings a person reads. Recommendation 5 is a layout
change rather than a naming one and is left for a product phase.
| 6 | Do **not** smooth the 42/50 thresholds — measured effect is ≤4 ranks and the cliff does not exist | CALIBRATION | Rejected |
| 7 | Do **not** cut REC — it demotes defensive-specialist peaks, trading one distortion for another | CALIBRATION | Rejected |
| 8 | Do **not** cap no-playoff seasons — omission already costs them 21% of the formula | CALIBRATION | Rejected |
| 9 | **Consider for PEAK3 v2**: the missed-playoffs/negative-PO inversion (§3.4) and PO's near-zero sensitivity to run length (§3.1). Both are real calibration issues; both move scores league-wide and need a versioned formula bump, not a patch. | CALIBRATION | Deferred to v2 |

**No production formula change is recommended in this phase.** The one concrete
bug was data labelling and has been fixed with zero score movement.
