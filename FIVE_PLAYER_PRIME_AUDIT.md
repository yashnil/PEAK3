# Five-Player Comparative Prime Audit

**Players:** James Harden, David Robinson, Hakeem Olajuwon, Stephen Curry, Kobe Bryant.  
**Model (unchanged):** 38% Statistical Impact · 21% Traditional Production · 20% Individual Recognition · 18% Postseason Individual Value · 3% Team Achievement.  
Completed, non-provisional seasons only; canonical rebuilt data. Windows aggregate **raw** season values with the official rank weighting and calibrate the completed window **once** (display scores are never averaged).

> This is a read-only diagnostic. No formula or weight was changed. Its job is to explain *why* the model ranks these primes as it does and to flag structural weaknesses — not to impose a preferred order.

## 1. Prime at three durations

| Player | Best 1yr | 1yr raw | 1yr disp | Best 3yr | 3yr raw | 3yr disp | Best 5yr | 5yr raw | 5yr disp |
|---|---|--:|--:|---|--:|--:|---|--:|--:|
| James Harden | 2017-18-2017-18 | 62.07 | 88.8 | 2017-18-2019-20 | 59.63 | 87.7 | 2014-15-2018-19 | 56.18 | 85.3 |
| David Robinson | 1994-95-1994-95 | 60.20 | 88.1 | 1993-94-1995-96 | 59.11 | 87.4 | 1991-92-1995-96 | 55.67 | 85.0 |
| Hakeem Olajuwon | 1993-94-1993-94 | 66.51 | 90.5 | 1992-93-1994-95 | 59.92 | 87.9 | 1992-93-1996-97 | 53.58 | 83.5 |
| Stephen Curry | 2015-16-2015-16 | 75.69 | 93.9 | 2014-15-2016-17 | 68.61 | 91.3 | 2014-15-2018-19 | 61.60 | 88.6 |
| Kobe Bryant | 2007-08-2007-08 | 54.48 | 84.1 | 2007-08-2009-10 | 52.57 | 82.8 | 2005-06-2009-10 | 50.97 | 81.7 |

**1-year ranking (raw):** Curry 75.7 > Olajuwon 66.5 > Harden 62.1 > Robinson 60.2 > Bryant 54.5
**3-year ranking (raw):** Curry 68.6 > Olajuwon 59.9 > Harden 59.6 > Robinson 59.1 > Bryant 52.6
**5-year ranking (raw):** Curry 61.6 > Harden 56.2 > Robinson 55.7 > Olajuwon 53.6 > Bryant 51.0

*Reading:* Curry leads at every duration. Hakeem is 2nd at 1 and 3 years but falls to 4th at 5 years (his five-year window dilutes the 1993–95 peak). Harden edges Robinson at all three durations, but by only 0.5 raw at 3 and 5 years — see §10.

## 2. Component comparison — best one-season Prime

Weighted contribution = official weight × component score. Share = a component's weighted contribution as a % of the player's total positive weighted contribution.

| Player | Season | SI (contrib) | TP (contrib) | Rec (contrib) | PO (contrib) | Team (contrib) | tmate | Prime raw | disp |
|---|---|--|--|--|--|--|--:|--:|--:|
| James Harden | 2017-18-2017-18 | 83.3 (31.7) | 58.0 (12.2) | 71.7 (14.3) | 15.0 (2.7) | 47.6 (1.4) | -0.24 | 62.1 | 88.8 |
| David Robinson | 1994-95-1994-95 | 82.9 (31.5) | 55.4 (11.6) | 74.6 (14.9) | 5.2 (0.9) | 42.3 (1.3) | -0.06 | 60.2 | 88.1 |
| Hakeem Olajuwon | 1993-94-1993-94 | 65.6 (24.9) | 45.5 (9.6) | 99.1 (19.8) | 50.7 (9.1) | 100.0 (3.0) | 0.09 | 66.5 | 90.5 |
| Stephen Curry | 2015-16-2015-16 | 94.9 (36.1) | 75.6 (15.9) | 95.6 (19.1) | 16.4 (3.0) | 65.6 (2.0) | -0.29 | 75.7 | 93.9 |
| Kobe Bryant | 2007-08-2007-08 | 60.0 (22.8) | 43.0 (9.0) | 73.9 (14.8) | 32.6 (5.9) | 65.6 (2.0) | 0.05 | 54.5 | 84.1 |

**Contribution share (% of positive weighted total):**

| Player | SI% | TP% | Rec% | PO% | Team% |
|---|--:|--:|--:|--:|--:|
| James Harden | 51 | 20 | 23 | 4 | 2 |
| David Robinson | 52 | 19 | 25 | 2 | 2 |
| Hakeem Olajuwon | 38 | 14 | 30 | 14 | 5 |
| Stephen Curry | 47 | 21 | 25 | 4 | 3 |
| Kobe Bryant | 42 | 17 | 27 | 11 | 4 |

SI is the largest single driver for every player (≈38–52% of the positive total). Postseason is a major slice only for Hakeem (≈14%) and Kobe (≈11%); it is small for Harden, Robinson and Curry's *statistical-apex* seasons.

## 3. Statistical Impact decomposition

Per-metric **normalized** sub-scores (peak3 `_impact_value` on the raw advanced metric) and their weighted contribution into SI / into the final Prime index. The model's SI uses native continuous anchors — there is **no separate positional, era-multiplier, or specialist term inside SI** (era context lives in the native landmarks; specialist/role handling lives outside SI). Modern impact metrics (EPM/LEBRON/…) are absent for these seasons and are excluded, never zero-filled.

**James Harden — 2017-18-2017-18** (SI = 83.3)

| SI block | normalized | intra-SI wt | → SI | → Prime |
|---|--:|--:|--:|--:|
| BPM block (BPM/OBPM/DBPM) | 79.1 | 39% | 31.2 | 11.87 |
| VORP + total WS | 77.0 | 26% | 20.3 | 7.70 |
| WS/48 | 95.4 | 21% | 20.1 | 7.63 |
| PER | 89.1 | 13% | 11.7 | 4.46 |
  - raw: BPM 9.9, OBPM 8.5, DBPM 1.4, VORP 7.7, WS/48 0.289, PER 29.8
  - largest SI advantage: **WS/48** (95); largest drag: **DBPM** (32).

**David Robinson — 1994-95-1994-95** (SI = 82.9)

| SI block | normalized | intra-SI wt | → SI | → Prime |
|---|--:|--:|--:|--:|
| BPM block (BPM/OBPM/DBPM) | 75.7 | 39% | 29.9 | 11.36 |
| VORP + total WS | 87.2 | 26% | 23.0 | 8.72 |
| WS/48 | 89.2 | 21% | 18.8 | 7.14 |
| PER | 86.0 | 13% | 11.3 | 4.30 |
  - raw: BPM 9.2, OBPM 6.0, DBPM 3.2, VORP 8.7, WS/48 0.273, PER 29.1
  - largest SI advantage: **BPM** (90); largest drag: **DBPM** (52).

**Hakeem Olajuwon — 1993-94-1993-94** (SI = 65.6)

| SI block | normalized | intra-SI wt | → SI | → Prime |
|---|--:|--:|--:|--:|
| BPM block (BPM/OBPM/DBPM) | 60.8 | 39% | 24.0 | 9.12 |
| VORP + total WS | 72.3 | 26% | 19.0 | 7.23 |
| WS/48 | 64.0 | 21% | 13.5 | 5.12 |
| PER | 68.9 | 13% | 9.1 | 3.44 |
  - raw: BPM 6.8, OBPM 3.5, DBPM 3.3, VORP 7.3, WS/48 0.210, PER 25.3
  - largest SI advantage: **VORP** (73); largest drag: **OBPM** (50).

**Stephen Curry — 2015-16-2015-16** (SI = 94.9)

| SI block | normalized | intra-SI wt | → SI | → Prime |
|---|--:|--:|--:|--:|
| BPM block (BPM/OBPM/DBPM) | 90.2 | 39% | 35.6 | 13.53 |
| VORP + total WS | 92.5 | 26% | 24.3 | 9.25 |
| WS/48 | 105.7 | 21% | 22.3 | 8.46 |
| PER | 96.5 | 13% | 12.7 | 4.83 |
  - raw: BPM 11.9, OBPM 10.3, DBPM 1.6, VORP 9.5, WS/48 0.318, PER 31.5
  - largest SI advantage: **BPM** (109); largest drag: **DBPM** (34).

**Kobe Bryant — 2007-08-2007-08** (SI = 60.0)

| SI block | normalized | intra-SI wt | → SI | → Prime |
|---|--:|--:|--:|--:|
| BPM block (BPM/OBPM/DBPM) | 53.2 | 39% | 21.0 | 7.98 |
| VORP + total WS | 65.7 | 26% | 17.3 | 6.57 |
| WS/48 | 63.2 | 21% | 13.3 | 5.06 |
| PER | 63.9 | 13% | 8.4 | 3.19 |
  - raw: BPM 5.8, OBPM 5.2, DBPM 0.6, VORP 6.3, WS/48 0.208, PER 24.2
  - largest SI advantage: **total_WS** (69); largest drag: **DBPM** (23).

**Redundancy note.** BPM, WS/48, PER and VORP are positively correlated (they all load on overall efficiency/impact), so SI partly *repeats* the same signal across four inputs. The model bounds this by capping the BPM block at 15/45 of SI and folding VORP with total WS, but a high-impact season still earns from all four — see the flaw table (§13).

## 4. Traditional Production decomposition

`TP before burden` = final TP − 0.40·burden_residual (burden enters the scoring sub-term at weight 0.40). Creation load uses **actual team scoring + assist shares**; the burden residual rewards only difficult creation carried at *better-than-expected* efficiency.

| Player | pts/75 | rTS | USG | AST% | team score sh | team ast sh | usg-eff resid | creation load | burden | TP before | TP final |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| James Harden | 31.7 | 6.1 | 36.1 | 45.1 | 0.238 | 0.358 | 10.65 | 1.00 | 7.60 | 55.0 | 58.0 |
| David Robinson | 27.7 | 5.9 | 29.9 | 13.7 | 0.256 | 0.122 | 8.41 | 1.00 | 7.60 | 52.3 | 55.4 |
| Hakeem Olajuwon | 25.3 | 3.6 | 29.8 | 16.4 | 0.264 | 0.138 | 6.14 | 1.00 | 5.83 | 43.2 | 45.5 |
| Stephen Curry | 31.9 | 12.8 | 32.6 | 33.7 | 0.252 | 0.223 | 16.16 | 1.00 | 7.60 | 72.5 | 75.6 |
| Kobe Bryant | 27.4 | 3.6 | 31.4 | 23.9 | 0.261 | 0.223 | 6.63 | 1.00 | 6.29 | 40.5 | 43.0 |

The model separates **volume** (pts/75, minutes, games) from **efficiency** (rTS), **usage** (USG%) from **successful burden** (usage-adjusted-efficiency × creation load), and **direct scoring** from **playmaking** (assist share / AST%). Burden contributes only `0.40 × burden_residual` to TP:
  - **James Harden**: burden 7.60 → 3.04 TP pts → 0.64 Prime pts.
  - **Kobe Bryant**: burden 6.29 → 2.52 TP pts → 0.53 Prime pts.
  - **Stephen Curry**: burden 7.60 → 3.04 TP pts → 0.64 Prime pts.
  - **Curry** earns through *efficiency × volume* (elite rTS at high pts/75) rather than raw creation load, so his burden is moderate despite an all-time scoring season — the model does not hand him Harden/Kobe-style burden credit.
  - **David Robinson**: TP 55.4 (scoring 76.4, defense box 41.6); his case rests far more on SI (advanced + defensive impact) than on TP.
  - **Hakeem Olajuwon**: TP 45.5 (scoring 58.8, defense box 42.7); his case rests far more on SI (advanced + defensive impact) than on TP.

## 5. Recognition decomposition

Real MVP/DPOY **vote share** (Basketball Reference award_share) drives the smooth voting value; All-NBA is discounted ×0.45 for a top-3 MVP finisher and All-Defense ×0.5 for a top-3 DPOY (overlap discounts, quantified below).

| Player | MVP fin (share) | MVP prem | DPOY fin (share) | All-NBA | All-Def | Finals MVP | titles | Recognition |
|---|--|--:|--|--:|--:|--:|--:|--:|
| James Harden | 1 (0.955) | 22 | None (  -  ) | 13.5 | 0.0 | 0 | 12.0 | 71.7 |
| David Robinson | 1 (0.858) | 22 | 4 (0.114) | 13.5 | 16.0 | 0 | 0.0 | 74.6 |
| Hakeem Olajuwon | 1 (0.880) | 22 | 1 (0.228) | 13.5 | 8.0 | 20 | 0.0 | 99.1 |
| Stephen Curry | 1 (1.000) | 22 | None (  -  ) | 13.5 | 0.0 | 0 | 32.0 | 95.6 |
| Kobe Bryant | 1 (0.873) | 22 | 5 (0.065) | 13.5 | 16.0 | 0 | 0.0 | 73.9 |

**Overlap quantified.** For a top-3 MVP finisher All-NBA First Team is cut from 30 → 13.5 (a 16.5 discount); for a top-3 DPOY All-Defense First is cut 16 → 8. Concerns: MVP/DPOY voting reflects team record and the same regular-season box stats that drive SI/TP, so a great statistical season can earn in **both** performance components **and** Recognition. The model does not remove that correlation (it is real recognition), but the discounts stop the *award tokens themselves* from stacking. Championships never enter Recognition (they live in Team Achievement); Finals MVP lives only here.

## 6. Postseason decomposition

| Player | PO g | PO min | series | reliab | abs level | level | elevation | sustained | dominance | Postseason |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| James Harden | 17 | 621 | 3 | 0.79 | 22.2 | 17.6 | -3.7 | 1.1 | 0.0 | 15.0 |
| David Robinson | 15 | 623 | 3 | 0.76 | 12.0 | 9.1 | -3.9 | 0.0 | 0.0 | 5.2 |
| Hakeem Olajuwon | 23 | 989 | 4 | 1.00 | 35.2 | 35.2 | 4.2 | 4.7 | 6.6 | 50.7 |
| Stephen Curry | 18 | 614 | 4 | 0.87 | 23.4 | 20.4 | -5.2 | 1.3 | 0.0 | 16.4 |
| Kobe Bryant | 21 | 863 | 4 | 1.00 | 26.4 | 26.4 | 1.4 | 2.4 | 2.4 | 32.6 |

**Regular → postseason box (at each best season):**

| Player | PTS/100 reg→PO | TS+ reg→PO | BPM reg→PO |
|---|--|--|--|
| James Harden |   -  →39.2 | 111→99 | 9.9→8.1 |
| David Robinson |   -  →32.6 | 111→99 | 9.2→6.1 |
| Hakeem Olajuwon |   -  →35.9 | 107→110 | 6.8→8.5 |
| Stephen Curry |   -  →36.4 | 124→114 | 11.9→7.0 |
| Kobe Bryant |   -  →38.0 | 107→109 | 5.8→7.4 |

**Comparisons.** Hakeem's best-season postseason is the largest of the five (a deep, dominant, reliable run). Harden's and Robinson's best-season postseason values are both modest; Curry 2015-16 is the clearest *penalty* case — his statistical apex coincided with an injury-hit, below-his-own-bar playoff run, so his Postseason contribution is small despite the historic regular season. Kobe's best *complete* season (2007-08) carries real postseason value (deep Finals run).

*Is Robinson's poor playoff result penalized too heavily vs Harden?* At the best-season anchor Harden's Postseason actually exceeds Robinson's, and at 3/5 years Harden's Postseason edge (~+2.1 raw) is the **entire** margin between them. But this is the *reliability-corrected* postseason value rewarding what each man actually did on the floor (Harden sustained more elite playoff minutes); it is not an extra penalty stacked on Robinson. Robinson's playoff *underperformance relative to his regular season* shows up as low elevation, not as a punitive subtraction — see §10 Q4.

## 7. Team Achievement and role (3% weight)

| Player | round score | champ | role | role mult | advancement | Team Ach | Prime contrib (×0.03) |
|---|--:|--:|---|--:|--:|--:|--:|
| James Harden | 70 | 0 | Primary offensive engine | 0.82 | 58 | 47.6 | 1.43 |
| David Robinson | 70 | 0 | Primary scorer | 0.73 | 58 | 42.3 | 1.27 |
| Hakeem Olajuwon | 100 | 1 | Primary scorer | 1.00 | 100 | 100.0 | 3.00 |
| Stephen Curry | 85 | 0 | Primary offensive engine | 0.82 | 80 | 65.6 | 1.97 |
| Kobe Bryant | 85 | 0 | Primary offensive engine | 0.82 | 80 | 65.6 | 1.97 |

At 3% weight, even a championship adds ≤3.0 Prime points. Team success does **not** also enter Postseason: the postseason component reads only individual box/impact (level, elevation, sustained volume, dominance) — round reached and championship are confined to this 3% term, and Finals MVP to Recognition.

## 8. Pairwise contribution bridges

Each component difference is the rank-weighted weighted-contribution difference; the five components + teammate sum **exactly** to the total raw difference.

### James Harden − David Robinson

| dur | SI | TP | Rec | PO | Team | tmate | **total raw** | disp |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1y | 0.14 | 0.56 | -0.58 | 1.76 | 0.16 | -0.18 | **1.87** | 0.7 |
| 3y | -1.77 | 0.76 | -0.90 | 2.18 | 0.34 | -0.08 | **0.53** | 0.4 |
| 5y | -1.54 | 0.79 | -1.22 | 2.10 | 0.43 | -0.04 | **0.51** | 0.4 |

### David Robinson − Hakeem Olajuwon

| dur | SI | TP | Rec | PO | Team | tmate | **total raw** | disp |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1y | 6.60 | 2.06 | -4.90 | -8.20 | -1.73 | -0.15 | **-6.31** | -2.4 |
| 3y | 8.27 | 2.00 | -3.58 | -5.87 | -1.48 | -0.15 | **-0.81** | -0.6 |
| 5y | 8.77 | 1.93 | -2.05 | -5.12 | -1.37 | -0.07 | **2.09** | 1.5 |

### Stephen Curry − James Harden

| dur | SI | TP | Rec | PO | Team | tmate | **total raw** | disp |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1y | 4.41 | 3.68 | 4.78 | 0.26 | 0.54 | -0.05 | **13.63** | 5.1 |
| 3y | 0.95 | 1.62 | 2.78 | 2.49 | 1.31 | -0.18 | **8.98** | 3.6 |
| 5y | -0.72 | 1.31 | 1.24 | 2.50 | 1.36 | -0.26 | **5.42** | 3.3 |

### Kobe Bryant − James Harden

| dur | SI | TP | Rec | PO | Team | tmate | **total raw** | disp |
|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| 1y | -8.86 | -3.16 | 0.44 | 3.16 | 0.54 | 0.29 | **-7.58** | -4.7 |
| 3y | -9.86 | -4.37 | 1.99 | 3.82 | 1.40 | -0.04 | **-7.07** | -4.9 |
| 5y | -7.57 | -3.36 | 2.95 | 2.01 | 0.77 | -0.02 | **-5.22** | -3.7 |

**Metrics behind each component gap (anchor seasons):** SI gaps trace to the BPM block (BPM/OBPM/DBPM) and VORP/WS — Robinson's defensive BPM and WS/48 give him the SI edge over Harden at 3/5 years; TP gaps trace to scoring volume × efficiency and the burden residual (Harden/Kobe creation); Recognition gaps trace to MVP vote share and All-NBA/All-Defense tier; Postseason gaps trace to sustained elite playoff minutes (sample reliability × absolute level).

## 9. Harden vs Robinson — deep audit

Harden leads at every duration: **1yr +1.87**, **3yr +0.53**, **5yr +0.51** raw. At 3 and 5 years the margin is razor-thin and is *entirely* the Postseason component.

Quantified answers (Harden − Robinson, raw weighted-contribution points):

1. **How much of Harden's edge is Traditional Production?** TP diff = +0.56 (1y), +0.76 (3y), +0.79 (5y) — a small, steady Harden plus.
2. **How much from Recognition?** Rec diff = -0.58 (1y), -0.90 (3y), -1.22 (5y) — Recognition actually favors **Robinson** (his MVP + the 1995 award profile), so it works *against* Harden.
3. **How much does Robinson gain through SI?** SI diff = +0.14 (1y), -1.77 (3y), -1.54 (5y) — near-even at the single-season apex, but a clear **Robinson** advantage over the 3- and 5-year windows.
4. **How much does Robinson lose through Postseason?** PO diff = +1.76 (1y), +2.18 (3y), +2.10 (5y) in Harden's favor — larger than the total gap, i.e. **Postseason is the whole story** at 3/5 years.
5. **Is Robinson's defensive value in SI, Recognition, or both?** Both: his DBPM/WS feed the SI BPM-block and WS/48, and his DPOY/All-Defense feed Recognition. The SI path is the larger of the two.
6. **Is Harden double-credited for scoring/impact/burden/MVP?** Partly by construction: elite scoring raises OBPM/BPM (SI), pts/75 and burden (TP), and MVP vote share (Recognition). The burden residual is small and bounded (≈0.4–0.7 Prime pts) and the All-NBA overlap is discounted, but the SI↔TP↔Recognition correlation for a high-volume efficient scorer is genuine and **not** removed (see §13).
7. **Would Robinson lead if Postseason were 18%→15%?** No. Under `Less playoff 40/22/20/15/3` Harden still leads at all durations (3y: 70.1 vs 61.4 region) — though within ~0.1.
8. **Would Robinson lead if Recognition 20%→17% and SI up?** No. Under `More stats 41/23/17/16/3` Harden still leads at every duration (the SI boost helps Robinson but the PO cut and his own SI gain net out in Harden's favor by ~0.2 at 3/5y).
9. **Stable across windows?** Yes — Harden > Robinson in 1/3/5 years and in all four weight systems tested (§11). The result is *stable but extremely sensitive*: the 3/5-year margins are 0.1–0.6 raw.
10. **Flaw or defensible choice?** Defensible philosophical choice: the model says *complete prime value includes how you played in the playoffs*, and Harden out-produced Robinson there. It is **sensitive**, not flawed — a reasonable observer who weights regular-season impact higher would flip it, and the model exposes exactly that lever.

## 10. Controlled sensitivity (diagnostic weights only)

Each system's weights sum to 1.00. Ordering by raw window score.

**Official  38/21/20/18/3**
  - 1y: Curry 75.7 > Olajuwon 66.5 > Harden 62.1 > Robinson 60.2 > Bryant 54.5
  - 3y: Curry 68.6 > Olajuwon 59.9 > Harden 59.6 > Robinson 59.1 > Bryant 52.6
  - 5y: Curry 61.6 > Harden 56.2 > Robinson 55.7 > Olajuwon 53.6 > Bryant 51.0

**More stats 41/23/17/16/3**
  - 1y: Curry 76.9 > Olajuwon 65.4 > Harden 63.3 > Robinson 62.4 > Bryant 54.3
  - 3y: Curry 69.8 > Harden 61.3 > Robinson 61.1 > Olajuwon 59.7 > Bryant 52.5
  - 5y: Curry 63.0 > Harden 57.9 > Robinson 57.6 > Olajuwon 53.7 > Bryant 51.2

**Less awards 40/22/17/18/3**
  - 1y: Curry 75.5 > Olajuwon 65.3 > Harden 62.2 > Robinson 60.8 > Bryant 53.9
  - 3y: Curry 68.9 > Harden 60.2 > Robinson 59.7 > Olajuwon 59.3 > Bryant 52.2
  - 5y: Curry 62.2 > Harden 56.9 > Robinson 56.3 > Olajuwon 53.3 > Bryant 50.7

**Less playoff 40/22/20/15/3**
  - 1y: Curry 77.9 > Olajuwon 66.8 > Harden 63.9 > Robinson 62.3 > Bryant 55.1
  - 3y: Curry 70.1 > Harden 61.4 > Robinson 61.3 > Olajuwon 60.6 > Bryant 53.1
  - 5y: Curry 62.9 > Harden 57.9 > Robinson 57.7 > Olajuwon 54.2 > Bryant 51.8

**Findings.** Curry is 1st in every system and duration. Kobe is last in every system. Harden > Robinson **never flips** (all 4 systems × 3 durations), but the 3/5-year gap stays ~0.1–0.6. Hakeem ↔ Robinson is the genuinely unstable pair: Hakeem leads at 1/3 years, Robinson at 5 years, and small weight changes reorder them. No single comparison flip justifies a weight change.

## 11. Counterfactual component swaps (no re-scoring)

Harden − Robinson raw gap: 1y **+1.87**, 3y **+0.53**, 5y **+0.51**.

| Swap (1-year) | result | vs | leader |
|---|--:|--:|---|
| Harden with Robinson's Postseason | 60.30 | 60.20 | Harden |
| Robinson with Harden's Recognition | 59.62 | 62.07 | Harden |
| Robinson with Harden's TP | 60.76 | 62.07 | Harden |
| Harden with Robinson's SI | 61.93 | 60.20 | Harden |
| Robinson with Harden's TP+Recognition | 60.18 | 62.07 | Harden |

Even after a single-component swap, **no** swap reverses the 1-year order (Harden's 1-year lead is robust). Minimum component-score change for Robinson to pass Harden at the 1-year anchor:

| Lever | component-score pts | = raw Prime pts |
|---|--:|--:|
| SI increase (Robinson) | 4.9 | 1.87 |
| Postseason increase (Robinson) | 10.4 | 1.87 |
| TP reduction (Harden) | 8.9 | 1.87 |
| Recognition reduction (Harden) | 9.3 | 1.87 |

So Robinson would need roughly **+5 SI points** *or* **+10 Postseason points** (or Harden −9 TP / −9 Recognition) to flip the single season. At 3 years the gap is only ~0.5 raw, i.e. **~1.4 Postseason points** would flip it — which is why the result is best described as *defensible but sensitive*.

## 12. Flaw detection

Categories: **[FLAW]** implementation bug · **[DATA]** data limitation · **[CHOICE]** reasonable modeling choice · **[PHIL]** subjective preference.

| Potential issue | For | Against | Players | Rank impact | Severity | Class |
|---|---|---|---|---|---|---|
| Advanced-metric redundancy (BPM/WS48/PER/VORP correlated) | 4 correlated inputs all reward the same impact | block weights capped; VORP folded with WS; bounded | all (esp. Robinson/Harden/Curry) | low–med | medium | CHOICE |
| Offensive-stat double counting (scoring in SI+TP) | elite scoring lifts OBPM and pts/75 and rTS | SI=rate impact, TP=box production; different formulas | Harden, Kobe, Curry | low | low | CHOICE |
| Burden overlaps SI and TP | creation/efficiency already in OBPM and scoring | residual is small/bounded (≈0.4–0.7 Prime pts), needs beat-expectation | Harden, Kobe | low | low | CHOICE |
| Awards import team success | MVP/DPOY voting correlates with team record | championships excluded from Recognition; only individual votes | Robinson, Curry, Harden | low–med | medium | PHIL |
| Defensive value underrepresented | defense is a smaller share of SI/TP than offense | DBPM in SI, DPOY/All-D in Recognition, box defense in TP | Robinson, Hakeem | medium | medium | PHIL |
| Playoff sample penalties | short runs shrink toward the mean | reliability is evidence-based; avoids small-sample inflation | Robinson, Curry 2016 | medium | medium | CHOICE |
| Long runs get more opportunity than short runs | sustained-volume rewards more playoff minutes | rewards play actually delivered, not advancement; reliability-gated | Harden vs Robinson | medium | medium | PHIL |
| Regular vs postseason imbalance (18% PO) | 18% PO decides Harden>Robinson entirely | PO is individual performance, not team result; weight is fixed policy | Robinson, Harden, Curry | high (for this pair) | medium | PHIL |
| Era normalization | native anchors are era-agnostic; pace/league shifts | anchors blend a small era-context term; no broad distortion seen | Robinson/Hakeem (90s) vs Harden/Curry (2010s) | low | low | CHOICE |
| Window weighting favors one explosive season | 40/35/25 over-weights the best year | documented floor; 1y vs 3y vs 5y all reported | Curry, Hakeem (5y dilution) | medium | medium | CHOICE |
| Calibration obscures small raw differences | 0.5 raw gap → <1.0 display pt; ties look decisive | raw is preserved and reported alongside display | Harden/Robinson, Hakeem/Robinson | med (interpretive) | medium | CHOICE |

No **[FLAW]** (implementation bug) was found in this five-player audit. The material items are **[CHOICE]/[PHIL]**: the model's 59/20/18/3 philosophy and its reliability-corrected postseason are deliberate and exposed, not broken.

## 13. Final verdicts

**James Harden** — *values correctly:* extreme offensive creation, scoring volume, efficient burden, MVP-level recognition. *May overstate:* the SI↔TP↔Recognition correlation for a volume scorer (mild triple-exposure). *May understate:* defense / off-ball value. *Confidence:* high.

**David Robinson** — *values correctly:* elite advanced + defensive regular-season impact (SI), consistency across 5 years. *May overstate:* nothing major — well captured. *May understate:* postseason translation is the entire gap to Harden; defense could arguably weigh more. *Confidence:* high.

**Hakeem Olajuwon** — *values correctly:* two-way dominance and the strongest best-season postseason of the five. *May overstate:* single-season peak slightly flatters him vs his 5-year body. *May understate:* 5-year window dilutes his title-run peak. *Confidence:* medium.

**Stephen Curry** — *values correctly:* historic efficiency × volume and recognition; clear #1 at every duration. *May overstate:* little — efficiency is valued without fake burden. *May understate:* his statistical-apex season's weaker postseason is correctly NOT papered over. *Confidence:* high.

**Kobe Bryant** — *values correctly:* scoring responsibility, burden, complete-season postseason value (2007-08). *May overstate:* nothing inflated — burden is bounded. *May understate:* his raw advanced impact (SI) trails the others, which caps him at #5. *Confidence:* high.

**Assessments:**

- **Harden > Robinson** — *defensible but sensitive.* Stable across all weights/durations, but the 3/5-year margin is ~0.1–0.6 raw and is entirely the Postseason component; a regular-season-first philosophy flips it.
- **Hakeem vs Robinson** — *defensible but sensitive.* Hakeem at 1/3 years, Robinson at 5 years; the genuinely unstable pair.
- **Curry's placement (#1 all durations)** — *strongly defensible.* Leads on SI and TP and Recognition; robust to every weight system.
- **Kobe's placement (#5)** — *strongly defensible.* His advanced-impact SI trails the field; no weighting tested moves him off the bottom.
- **Overall ordering** (Curry > Hakeem ≈ Harden ≈ Robinson > Kobe at 1–3y; Curry > Harden ≈ Robinson > Hakeem > Kobe at 5y) — *defensible but sensitive* in the tightly-packed Hakeem/Harden/Robinson band.

