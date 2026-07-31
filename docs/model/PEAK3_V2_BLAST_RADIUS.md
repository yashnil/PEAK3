# PEAK3 v2 — measured blast radius

Companion to [PEAK3_V2_FORMULA_DESIGN.md](PEAK3_V2_FORMULA_DESIGN.md). That
document says what v2 does and why; this one reports what it **moved**, measured
rather than estimated.

Everything below compares the two committed artifacts:

```
data/game/experimental/player_pool_1500/top_1000_peaks.v1.json
data/game/experimental/player_pool_1500/top_1000_peaks.v2.json
```

**v1 is unchanged.** Regenerating it after this phase's changes produced 0 score
changes, 0 rank changes and 0 component changes across all 2,578 rows; the only
difference is an additive `model_version` field and, on 1Y rows, a descriptive
`anchor_selection` block. The 547-test model suite passes unchanged.

---

## 1. The three calibration failures, before and after

| Measure | v1 | v2 | Target |
|---|---:|---:|---|
| Negative postseason, all 5,756 playoff seasons | **68.3%** | **0.6%** | "dramatically lower" ✓ |
| Negative, ≥30 playoff MPG **and** ≥10 games | **48.0%** | **0.2%** | under 10% ✓ |
| Negative, champions with ≥30 MPG | 36.4% | **0.0%** | "very rarely" ✓ |
| Negative, Finals participants with ≥30 MPG | 40.7% | **0.6%** | "very rarely" ✓ |
| Negative, all champions | 55.4% | 1.6% | — |
| Negative, all Finals participants | 57.9% | 1.7% | — |
| Correlation with playoff **games** | **+0.078** | **+0.487** | materially higher, not dominant ✓ |
| Correlation with playoff **BPM** | +0.608 | +0.568 | quality still leads ✓ |

Quality still outranks run length (+0.568 vs +0.487), and the correlation with
*winning the title* is only +0.325 — so v2 credits sustained postseason
contribution without becoming a rings model.

### Who is still negative

36 seasons, 0.63%. Their median playoff BPM is **−8.2** against a league playoff
median of **+0.4**, over runs of 14–23 games. The worst is −1.41.

| player | season | level | reliability | G | MPG | playoff BPM | v2 |
|---|---|---:|---:|---:|---:|---:|---:|
| Jacque Vaughn | 2007-08 | −35.7 | 0.49 | 14 | 6.5 | −11.7 | −1.41 |
| Donald Royal | 1994-95 | −18.7 | 0.67 | 18 | 11.0 | −7.7 | −1.06 |
| Lindsey Hunter | 2000-01 | −18.5 | 0.66 | 18 | 16.1 | −6.0 | −1.00 |
| Rod Foster | 1983-84 | −24.8 | 0.54 | 16 | 8.0 | −7.9 | −0.92 |
| Vincent Askew | 1995-96 | −14.1 | 0.76 | 19 | 18.2 | −3.5 | −0.88 |

No star, champion or high-minute starter appears. "Genuinely harmful,
high-sample collapse" is now a literal gate, not an aspiration.

---

## 2. Board movement

### 1Y Peak Windows

| | value |
|---|---:|
| Top-100 rows that moved at all | 78 / 93 |
| Top-100 with \|move\| > 5 | 20 |
| Top-100 with \|move\| > 10 | 8 |
| Top-100 max move | 23 |
| Top-100 **median** \|move\| | **2** |
| Top-50 rows that moved | 36 / 47 |
| Top-50 max move | **6** |
| Top-50 median \|move\| | **1** |

The top 50 is very stable — a median move of one place and nothing worse than
six. Movement grows further down, where scores are tightly packed.

| board | top-100 moved | max move | top-10 rows retained |
|---|---:|---:|---:|
| 1Y | 78/93 | 23 | 7/10 |
| 3Y | 76/94 | 13 | 9/10 |
| 5Y | 60/91 | 10 | 7/10 |
| Single Seasons | 85/100 | 17 | 8/10 |

### Top 10, 1Y

```
#   v1                              v2
1   Michael Jordan 1990-91          Michael Jordan 1990-91
2   LeBron James 2008-09            LeBron James 2012-13
3   Stephen Curry 2015-16           Stephen Curry 2015-16
4   Shaquille O'Neal 1999-00        Shaquille O'Neal 1999-00
5   Nikola Jokic 2022-23            Shai Gilgeous-Alexander 2024-25
6   Shai Gilgeous-Alexander 2024-25 Nikola Jokic 2022-23
7   Tim Duncan 2002-03              Tim Duncan 2002-03
8   Giannis Antetokounmpo 2019-20   Kevin Durant 2013-14
9   Magic Johnson 1986-87           Giannis Antetokounmpo 2018-19
10  Hakeem Olajuwon 1993-94         Magic Johnson 1986-87
```

"7/10 retained" is the row-level number and it overstates the change. At the
**player** level it is **9/10**: the only entry/exit is Durant 2013-14 (11 → 8)
for Olajuwon 1993-94 (10 → 11) — a one-place move at the boundary. The other two are the **same player's anchor season flipping**:

- **LeBron 2008-09 → 2012-13**, both at rank 2. The title season, a 23-game run,
  now outscores the 14-game 2008-09 run it lost to by 0.16 under v1.
- **Giannis 2019-20 → 2018-19**, rank 8 → 9. The 9-game bubble exit
  (reliability 0.42) gives way to the longer 2018-19 run.

Both flips move toward the longer, better-observed postseason, which is what v2
is for.

### Anchor-season flips

**66 of 976** players on the 1Y board changed anchor season. The highest-ranked:

| player | v1 anchor | v2 anchor | v1 rank |
|---|---|---|---:|
| LeBron James | 2008-09 | 2012-13 | 2 |
| Giannis Antetokounmpo | 2019-20 | 2018-19 | 8 |
| John Stockton | 1987-88 | 1994-95 | 36 |
| Damian Lillard | 2020-21 | 2017-18 | 55 |
| Gary Payton | 1999-00 | 1995-96 | 59 |
| Paul Pierce | 2001-02 | 2007-08 | 78 |

### Score distribution

Whole 1Y board, common rows: mean **+0.818**, median **+0.480**, p5 −0.070,
p95 +2.921, max +5.380, min −1.970. v2 raises scores modestly overall, which
follows directly from the postseason median moving from −2.79 to +1.19.

Mean component contribution, 1Y top 100 — only postseason moves materially:

| | SI | TP | REC | PO | TEAM |
|---|---:|---:|---:|---:|---:|
| v1 | 24.53 | 9.53 | 8.12 | 3.06 | 1.21 |
| v2 | 24.43 | 9.51 | 8.28 | 3.73 | 1.29 |

(SI/TP/REC/TEAM shift only because the top-100 *membership* changed; the
component values themselves are bit-identical between versions.)

---

## 3. Suspicious cases, before and after

Ranks are on the Single Seasons board.

| player | season | PO v1 | PO v2 | score v1 | score v2 | rank v1 | rank v2 |
|---|---|---:|---:|---:|---:|---:|---:|
| Klay Thompson | 2014-15 | **−8.09** | **+10.09** | 56.92 | 60.20 | 702 | **569** |
| Karl Malone | 1996-97 | **+1.33** | **+18.66** | 86.98 | 88.64 | 54 | **39** |
| Jimmy Butler | 2022-23 | +13.79 | **+28.19** | 76.29 | 78.88 | 144 | 126 |
| Joel Embiid | 2022-23 | **−2.10** | **+5.14** | 86.18 | 87.10 | 59 | 50 |
| Sidney Moncrief | 1982-83 | **−5.71** | **+4.02** | 72.96 | 74.72 | 197 | 175 |
| Shai Gilgeous-Alexander | 2024-25 | +23.68 | +37.39 | 92.90 | 93.73 | 14 | 9 |
| Dirk Nowitzki | 2010-11 | +38.55 | +48.05 | 78.29 | 80.00 | 124 | 112 |
| Dirk Nowitzki | 2005-06 | +45.67 | +50.81 | 84.88 | 85.52 | 68 | 65 |
| Dwight Howard | 2008-09 | +45.61 | +49.71 | 86.16 | 86.68 | 60 | 52 |
| David Robinson | 1994-95 | +5.18 | +14.99 | 88.08 | 88.76 | 42 | 38 |
| David Robinson | 1993-94 | +0.47 | +2.25 | 87.88 | 88.05 | 43 | 43 |
| Scottie Pippen | 1995-96 | +14.75 | +17.76 | 71.30 | 71.91 | 218 | 216 |
| Scottie Pippen | 1993-94 | +5.91 | +9.43 | 71.87 | 72.58 | 211 | 207 |
| Dwyane Wade | 2005-06 | +49.20 | +48.27 | 85.35 | 85.23 | 64 | 69 |
| Victor Wembanyama | 2025-26 | +40.28 | +39.56 | 90.06 | 90.01 | 28 | 29 |
| Giannis Antetokounmpo | 2020-21 | +43.70 | +41.16 | 89.22 | 89.05 | 36 | 35 |
| Manu Ginobili | 2004-05 | +57.15 | **+52.65** | 76.61 | 75.80 | 140 | 160 |
| Kawhi Leonard | 2018-19 | +63.00 | +55.92 | 83.97 | 83.07 | 77 | 88 |
| Hakeem Olajuwon | 1993-94 | +50.73 | **+44.64** | 90.50 | 90.08 | 25 | **28** |
| Giannis Antetokounmpo | 2019-20 | +20.46 | **+14.24** | 91.28 | 90.85 | 18 | 20 |
| Kawhi Leonard | 2016-17 | +54.24 | **+38.58** | 87.84 | 85.87 | 45 | **60** |

### Where v2 improves trust

- **Klay Thompson 2014-15** — the clearest case. A title-winning starter, 21
  games at 36.2 MPG, at a level *above* the minutes-weighted playoff median,
  scored **−8.09** under v1: worse than every player who missed the playoffs.
  Now **+10.09**.
- **Karl Malone 1996-97** — MVP, 20 games at 40.8 MPG, a Finals run, playoff
  sample reliability 0.98, and v1 gave it **+1.33**. Now +18.66.
- **Jimmy Butler 2022-23** — the canonical carry run (22 games, 39.7 MPG) more
  than doubles, from +13.79 to +28.19.
- **Embiid 2022-23 and Moncrief 1982-83** both cross from negative to small
  positive: short runs, shrunk toward replacement rather than punished.
- **Kawhi 2016-17 (12 games) vs 2018-19 (24 games)** — v2 widens the gap in
  favour of the full run, which is principle D working.
- **Kevin Love 2013-14**, the only no-playoff season in the 1Y top 50, slips
  **47 → 50** as real playoff runs rise past it. That is the inversion closing.

### Where v2 creates new questions

- **Hakeem Olajuwon 1993-94** loses the most of any elite season: PO
  50.73 → 44.64, Single Seasons 25 → 28, and 1Y rank 10 → 11 (out of the top
  ten). A championship + Finals MVP + MVP + DPOY season scoring *lower* is the
  one result here that will read badly.

  The cause is v2 halving elevation's weight (0.55 → 0.30) and dropping its
  decline term, because elevation is computed from the same playoff rate as the
  level and was double-counting. Olajuwon's 1994 run is the strongest
  "rose-to-the-moment" season in the dataset, so it loses the most from that
  correction. **This was not tuned around** — restoring his rank by raising the
  elevation scale would be exactly the hand-fitting rule G forbids. It is
  recorded as a known cost.

- **Elite separation compresses.** The top-10 `prime_score` spread narrows from
  7.03 to 6.24 (−11%) and the median adjacent gap in the top 10 from 0.580 to
  0.410. Shrinking extreme short-run values toward replacement is the intended
  mechanism, but it does mean the very top is decided by slightly smaller
  margins.

- **Manu Ginobili 2004-05** drops 140 → 160. Still a strong postseason (+52.65),
  and the brief explicitly allows this case to stay strong — but it is now
  ranked behind higher-burden runs, which is the intended load-awareness and
  will still surprise some readers.

---

## 4. What v2 did not change

Verified bit-identical between the v1 and v2 scored datasets across all 11,429
rows:

`statistical_impact`, `traditional_production`, `recognition`,
`contrib_recognition`, `team_achievement`, `contrib_team_achievement`,
`teammate_adjustment`.

- **Team Result — unchanged.** Weighted range still exactly 0.00–3.00; zero
  champions or Finals participants at 0; no zero-TEAM row lacking a series win.
  Its correlation with the postseason component rises (+0.270 → +0.623), but
  that is **not** duplicated advancement credit: playoff games and rounds reached
  are 0.908-correlated by construction, so any run-length credit correlates with
  advancement. Controlling for playoff level *and* games, the residual
  correlation with rounds reached is **+0.155**, and rounds enter v2 only as a
  sample-size signal that can lower a score, never raise one.
- **Recognition — unchanged.** 2023-24, 2024-25 and 2025-26 each carry exactly
  one MVP, one DPOY, five All-NBA First Team, one Finals MVP and a champion, so
  there is no in-progress award leakage to correct. Phase 12B showed REC cuts
  demote defensive-specialist peaks; no evidence emerged here to justify one.
- **Weights and calibration — unchanged.** `OFFICIAL_WEIGHTS` and
  `calibrate_score`'s anchors are reused as-is, so v1 and v2 scores sit on the
  same scale and remain comparable.

---

## 5. Recommendation

**Keep v2 as a labelled preview; do not make it the default yet.**

The calibration case is strong — every stated target is met, and the cases that
motivated the phase all improve. But two things argue against flipping the
default in the same pass that introduced the model:

1. **Olajuwon 1993-94** is a genuine regression in perceived quality, and the
   elevation weighting that causes it deserves its own evidence pass rather than
   a same-phase adjustment.
2. **Elite compression** (−11% top-10 spread) has not been reviewed by anyone
   but this analysis.

v1 remains default and fully reproducible; v2 is generated, versioned, served on
request and labelled everywhere it appears. Flipping the default is a small,
reversible change once those two items are reviewed.
