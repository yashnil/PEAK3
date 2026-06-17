# Specialist & Postseason Sanity Audit

Read-only diagnostics over the canonical scored dataset, plus ONE small adopted correction. The official weights are unchanged:

> **38% Statistical Impact · 21% Traditional Production · 20% Individual Recognition · 18% Postseason Individual Value · 3% Team Achievement**

No sixth component was added. Best five-year windows aggregate the RAW season contributions and calibrate once.

## Headline verdict

| Issue | Verdict |
|---|---|
| Efficient low-creation bigs over-valued | **No issue / reasonable philosophical choice** — purest finishers (DeAndre Jordan, Tyson Chandler) rank at the *bottom* of the comparison set; no systematic outranking. No correction. |
| Overlapping specialist credit (efficiency/rebounding) | **Partial overlap (legitimate corroboration)** — efficiency is corroborated across metrics; rebounding is an *independent* signal (r≈0.15–0.32). Not duplicate reward; no correction. |
| `creation_independence` should be added | **No** — it correlates 0.57–0.81 with usage / team-assist-share / OBPM / TP already in the model; adds no new information. Kept as a read-only diagnostic. |
| Negative postseason for valuable contributors via elevation | **Small structural weakness → bounded correction adopted** — a gated, monotonic elevation-reversal safeguard (below). |
| 2025-26 completeness | **Verified complete**; a field-by-field guard now fails the rebuild on any silently-missing required field. |

## 1. 2025-26 (season_end=2026) completeness

Every required field for all 279 player-seasons is `observed` or legitimately `not_applicable` (e.g. not in the MVP voting, missed the playoffs); **0 silently missing**. See `reports/season_2025_26_completeness.csv`. The completed-season guard (`nba_peak.season_completeness.assert_no_silent_missing`, wired into `peak3.get_scored`) raises if a non-provisional 2025-26 season would enter a leaderboard with a required field missing. Missing data is never treated as zero.

## 2-6. Efficient-big audit

Best five-year windows, ranked by Prime raw (efficient bigs vs broader two-way / offensive bigs):

| player | group | prime_raw | prime_display | SI | TP | Rec | PO | Team | usg | r_ts | burden_residual | creation_load | creation_independence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dwight Howard | efficient_big | 49.62 | 80.60 | 21.02 | 9.77 | 14.43 | 3.64 | 0.75 | 26.10 | 5.40 | 6.36 | 1.00 | 50.20 |
| Rudy Gobert | efficient_big | 39.82 | 70.50 | 21.37 | 8.98 | 8.56 | 0.70 | 0.19 | 17.80 | 12.10 | 4.76 | 0.63 | 32.00 |
| Kevin McHale | efficient_big | 37.41 | 67.80 | 19.23 | 9.79 | 5.61 | 2.13 | 0.97 | 24.10 | 11.60 | 7.60 | 1.00 | 53.50 |
| Patrick Ewing | comparison | 37.22 | 67.60 | 20.74 | 9.21 | 5.14 | 1.15 | 0.82 | 29.40 | 6.40 | 7.60 | 1.00 | 63.30 |
| Alonzo Mourning | comparison | 36.65 | 67.00 | 19.09 | 9.08 | 7.56 | 0.58 | 0.29 | 28.10 | 7.20 | 7.60 | 1.00 | 56.60 |
| Ben Wallace | comparison | 32.60 | 62.60 | 16.69 | 3.72 | 10.55 | 1.10 | 0.62 | 10.20 | -3.40 | -0.07 | 0.07 | 14.10 |
| Pau Gasol | comparison | 32.05 | 62.10 | 19.82 | 7.17 | 1.73 | 2.28 | 1.21 | 20.40 | 7.10 | 6.73 | 1.00 | 52.80 |
| Domantas Sabonis | efficient_big | 31.87 | 61.90 | 20.55 | 9.47 | 1.93 | -0.24 | 0.00 | 22.20 | 5.40 | 5.17 | 1.00 | 73.30 |
| Chris Webber | comparison | 30.60 | 60.60 | 18.61 | 6.35 | 4.80 | 0.15 | 0.69 | 31.60 | -0.20 | 2.73 | 1.00 | 65.10 |
| Blake Griffin | comparison | 29.74 | 59.70 | 18.17 | 7.42 | 2.97 | 0.98 | 0.53 | 29.00 | 4.10 | 6.03 | 1.00 | 67.70 |
| DeAndre Jordan | efficient_big | 29.54 | 59.50 | 17.08 | 7.11 | 4.66 | 0.83 | 0.14 | 13.60 | 10.10 | 1.72 | 0.23 | 7.90 |
| Dikembe Mutombo | comparison | 29.04 | 59.00 | 14.83 | 5.62 | 6.70 | 1.63 | 0.36 | 17.40 | 4.70 | 2.64 | 0.59 | 27.90 |
| Jarrett Allen | efficient_big | 28.01 | 58.00 | 17.84 | 8.20 | 0.25 | 1.46 | 0.32 | 15.90 | 14.70 | 2.88 | 0.38 | 21.10 |
| Marc Gasol | comparison | 27.28 | 57.30 | 17.09 | 4.74 | 4.10 | 0.89 | 0.51 | 19.20 | 2.40 | 2.26 | 1.00 | 47.40 |
| Joakim Noah | comparison | 26.71 | 56.70 | 16.69 | 4.01 | 5.77 | 0.04 | 0.17 | 18.70 | -1.10 | -0.33 | 1.00 | 49.60 |
| Bam Adebayo | comparison | 26.41 | 56.40 | 15.94 | 6.50 | 2.66 | 0.51 | 0.87 | 21.20 | 2.90 | 2.80 | 1.00 | 53.50 |
| Clint Capela | efficient_big | 25.11 | 54.90 | 16.75 | 7.22 | 0.25 | 0.76 | 0.51 | 19.40 | 9.20 | 2.18 | 0.29 | 25.30 |
| Tyson Chandler | efficient_big | 24.90 | 54.60 | 14.48 | 7.31 | 3.22 | -0.35 | 0.30 | 13.00 | 17.90 | 2.11 | 0.28 | 7.10 |
| Andre Drummond | efficient_big | 20.77 | 49.50 | 14.06 | 5.02 | 1.82 | -0.32 | 0.00 | 21.20 | -0.30 | -0.06 | 0.77 | 38.20 |

The purest low-creation finishers — **DeAndre Jordan** (usg 13.6, creation-independence 7.9) and **Tyson Chandler** (usg 13.0, 7.1) — rank at the *bottom*, below Patrick Ewing, Alonzo Mourning, Pau Gasol, Ben Wallace and Chris Webber. Where bigs rank high it is **Recognition** (Dwight Howard / Gobert DPOY-MVP votes) and **impact metrics**, not overlapping efficiency credit. Condition 1 of the correction standard (low-creation bigs *systematically outrank* two-way engines) is **not met**, so no efficient-big correction is adopted.

### Direct bridges

| player_a | player_b | d_prime_raw | d_SI | d_TP | d_Rec | d_PO | d_Team | primary_driver |
|---|---|---|---|---|---|---|---|---|
| DeAndre Jordan | Marc Gasol | 2.26 | -0.01 | 2.37 | 0.56 | -0.06 | -0.37 | TP (+2.37) |
| DeAndre Jordan | Joakim Noah | 2.83 | 0.39 | 3.10 | -1.11 | 0.79 | -0.04 | TP (+3.10) |
| DeAndre Jordan | Dikembe Mutombo | 0.50 | 2.26 | 1.49 | -2.04 | -0.81 | -0.22 | SI (+2.26) |
| DeAndre Jordan | Bam Adebayo | 3.13 | 1.14 | 0.62 | 2.00 | 0.32 | -0.73 | Rec (+2.00) |
| Rudy Gobert | Patrick Ewing | 2.60 | 0.63 | -0.23 | 3.42 | -0.45 | -0.63 | Rec (+3.42) |
| Rudy Gobert | Alonzo Mourning | 3.17 | 2.27 | -0.11 | 1.01 | 0.12 | -0.11 | SI (+2.27) |
| Rudy Gobert | Ben Wallace | 7.22 | 4.68 | 5.25 | -1.98 | -0.40 | -0.44 | TP (+5.25) |
| Domantas Sabonis | Chris Webber | 1.27 | 1.94 | 3.12 | -2.87 | -0.38 | -0.69 | TP (+3.12) |
| Domantas Sabonis | Blake Griffin | 2.13 | 2.38 | 2.05 | -1.04 | -1.22 | -0.53 | SI (+2.38) |
| Domantas Sabonis | Shawn Kemp | 0.65 | 3.86 | 1.09 | -1.07 | -2.92 | -0.66 | SI (+3.86) |
| Dwight Howard | Patrick Ewing | 12.40 | 0.29 | 0.56 | 9.29 | 2.49 | -0.07 | Rec (+9.29) |
| Dwight Howard | Alonzo Mourning | 12.97 | 1.93 | 0.69 | 6.87 | 3.06 | 0.46 | Rec (+6.87) |

Dwight Howard's edge over Ewing/Mourning is **Recognition** (+9.3/+6.9: three DPOYs, MVP runner-up); Gobert's over Ewing is Recognition, over Mourning is Statistical Impact. DeAndre Jordan's small edges over Marc Gasol/Noah are Traditional Production (his efficiency), but he remains below the genuine two-way bigs — the efficiency overlap does not flip archetype ordering.

### Center overlap (Spearman, all centers, n=1232)

| signal | r_ts | low_turnover | trb_per100 | ws_per_48 | per | bpm | traditional_production | burden_residual | teammate_adjustment |
|---|---|---|---|---|---|---|---|---|---|
| r_ts | 1.00 | -0.07 | 0.16 | 0.71 | 0.50 | 0.53 | 0.77 | 0.85 | -0.16 |
| ts_plus | 1.00 | -0.07 | 0.16 | 0.71 | 0.50 | 0.53 | 0.77 | 0.85 | -0.16 |
| low_turnover | -0.07 | 1.00 | -0.08 | 0.07 | -0.26 | -0.04 | -0.33 | -0.26 | -0.15 |
| trb_per100 | 0.16 | -0.08 | 1.00 | 0.34 | 0.31 | 0.21 | 0.32 | 0.15 | -0.03 |
| ws_per_48 | 0.71 | 0.07 | 0.34 | 1.00 | 0.77 | 0.86 | 0.79 | 0.74 | -0.36 |
| per | 0.50 | -0.26 | 0.31 | 0.77 | 1.00 | 0.81 | 0.88 | 0.69 | -0.02 |
| bpm | 0.53 | -0.04 | 0.21 | 0.86 | 0.81 | 1.00 | 0.76 | 0.65 | -0.17 |
| traditional_production | 0.77 | -0.33 | 0.32 | 0.79 | 0.88 | 0.76 | 1.00 | 0.86 | -0.08 |
| burden_residual | 0.85 | -0.26 | 0.15 | 0.74 | 0.69 | 0.65 | 0.86 | 1.00 | -0.10 |
| teammate_adjustment | -0.16 | -0.15 | -0.03 | -0.36 | -0.02 | -0.17 | -0.08 | -0.10 | 1.00 |

Efficiency (`r_ts`/`ts_plus`) is strongly corroborated by the impact metrics (`ws_per_48` 0.71, `per` 0.50, `bpm` 0.53) and by the burden residual (0.85) — **legitimate corroboration / partial overlap of a real skill**. Crucially **rebounding** (`trb_per100`) is only weakly related to everything (0.15–0.34): it is an *independent* signal, not a third redundant pathway. `low_turnover` and `teammate_adjustment` correlate near zero / negative — no duplicate reward. The one narrow partial overlap is the burden residual rewarding extreme efficiency at very low creation (DeAndre Jordan 1.72 at creation-load 0.23); its effect is ≈0.14 Prime points and changes no ranking, so it stays.

### Marginal association with Traditional Production

| skill_family | spearman_with_TP | n |
|---|---|---|
| efficiency | 0.77 | 1232 |
| rebounding | 0.32 | 1232 |
| impact_metrics | 0.87 | 1232 |
| durability | 0.19 | 1232 |
| team_context | 0.51 | 1232 |

### `creation_independence` diagnostic (read-only, not in any score)

| target | spearman_with_creation_independence | reliability |
|---|---|---|
| TP | 0.63 | proxy (no assisted-FG tracking pre/at era) |
| SI | 0.53 | proxy (no assisted-FG tracking pre/at era) |
| OBPM | 0.72 | proxy (no assisted-FG tracking pre/at era) |
| usage | 0.71 | proxy (no assisted-FG tracking pre/at era) |
| rel_TS | 0.13 | proxy (no assisted-FG tracking pre/at era) |
| team_assist_share | 0.81 | proxy (no assisted-FG tracking pre/at era) |
| burden_residual | 0.37 | proxy (no assisted-FG tracking pre/at era) |
| prime_raw | 0.57 | proxy (no assisted-FG tracking pre/at era) |

It is 0.81 with team-assist-share, 0.71 with usage, 0.72 with OBPM, 0.63 with TP — i.e. it largely re-expresses creation signals already in the model. It therefore **adds no new information** (correction condition 3 fails) and is **not** inserted into the official formula. For all eras here, assisted-FG / dunks / rim / roll-man tracking is unavailable; the diagnostic uses a flagged conservative proxy.

## 7-9. Negative postseason audit

Negative-postseason player-seasons by category (post-safeguard):

- **genuinely_poor_playoff_performance**: 3279
- **small_sample_underperformance**: 871
- **secondary_star_or_specialist_compression**: 129
- **valuable_absolute_negative_elevation**: 1

The overwhelming majority are *genuinely poor* (absolute playoff rate-impact at or near the −14 floor) or *small-sample*. The audited names (Jaylen Brown, Dennis Rodman, Carmelo Anthony, Draymond Green, Ben Wallace, Rajon Rondo) are almost entirely **genuinely-poor absolute level**, not elevation artifacts — confirmed below.

| player | season_end | postseason_perf | po_abs_level | po_level_value | po_elevation_value | po_sample_reliab | category |
|---|---|---|---|---|---|---|---|
| Dennis Rodman | 1988 | -14.00 | -14.00 | -11.52 | -2.86 | 0.82 | genuinely_poor_playoff_performance |
| Jaylen Brown | 2023 | -14.00 | -13.64 | -12.15 | -2.76 | 0.89 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1998 | -14.00 | -14.00 | -13.16 | -1.79 | 0.94 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1997 | -14.00 | -14.00 | -11.93 | -4.05 | 0.85 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1990 | -11.88 | -10.44 | -9.01 | -2.87 | 0.86 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1991 | -10.42 | -12.90 | -8.99 | -1.43 | 0.70 | genuinely_poor_playoff_performance |
| Draymond Green | 2022 | -10.37 | -8.44 | -7.86 | -2.51 | 0.93 | small_sample_underperformance |
| Draymond Green | 2025 | -9.96 | -14.00 | -7.41 | -2.56 | 0.53 | genuinely_poor_playoff_performance |
| Ben Wallace | 2006 | -8.89 | -7.77 | -6.38 | -2.51 | 0.82 | small_sample_underperformance |
| Jaylen Brown | 2017 | -8.84 | -14.00 | -8.43 | -0.41 | 0.60 | genuinely_poor_playoff_performance |
| Ben Wallace | 2009 | -7.53 | -12.93 | -6.83 | -0.70 | 0.53 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1987 | -7.22 | -10.89 | -6.30 | -0.92 | 0.58 | genuinely_poor_playoff_performance |
| Carmelo Anthony | 2006 | -4.91 | -14.00 | -3.44 | -1.47 | 0.24 | genuinely_poor_playoff_performance |
| Jaylen Brown | 2025 | -4.68 | -8.25 | -4.26 | -0.41 | 0.52 | secondary_star_or_specialist_compression |
| Carmelo Anthony | 2018 | -4.16 | -14.00 | -3.70 | -0.46 | 0.26 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1989 | -4.13 | -3.49 | -2.64 | -1.49 | 0.76 | small_sample_underperformance |
| Carmelo Anthony | 2008 | -4.10 | -14.00 | -2.87 | -1.23 | 0.20 | genuinely_poor_playoff_performance |
| Carmelo Anthony | 2004 | -4.07 | -14.00 | -2.85 | -1.22 | 0.20 | genuinely_poor_playoff_performance |
| Carmelo Anthony | 2021 | -3.84 | -14.00 | -3.36 | -0.47 | 0.24 | genuinely_poor_playoff_performance |
| Carmelo Anthony | 2005 | -3.71 | -14.00 | -3.35 | -0.36 | 0.24 | genuinely_poor_playoff_performance |
| Carmelo Anthony | 2020 | -3.64 | -14.00 | -3.32 | -0.31 | 0.24 | genuinely_poor_playoff_performance |
| Dennis Rodman | 1996 | -3.55 | -5.97 | -5.22 | 1.67 | 0.87 | small_sample_underperformance |
| Rajon Rondo | 2011 | -3.37 | -5.64 | -2.56 | -0.81 | 0.45 | small_sample_underperformance |
| Dennis Rodman | 1995 | -3.09 | -3.90 | -2.58 | -0.51 | 0.66 | small_sample_underperformance |
| Jaylen Brown | 2018 | -2.35 | -7.51 | -5.96 | 3.61 | 0.79 | small_sample_underperformance |
| Dennis Rodman | 1994 | -1.95 | -9.74 | -1.67 | -0.28 | 0.17 | small_sample_underperformance |
| Rajon Rondo | 2015 | -1.84 | -14.00 | -1.64 | -0.20 | 0.12 | genuinely_poor_playoff_performance |
| Jaylen Brown | 2026 | -1.74 | -3.62 | -1.12 | -0.62 | 0.31 | small_sample_underperformance |
| Rajon Rondo | 2018 | -1.44 | -5.08 | -2.20 | 0.76 | 0.43 | small_sample_underperformance |
| Carmelo Anthony | 2013 | -1.24 | 0.93 | 0.53 | -1.77 | 0.57 | secondary_star_or_specialist_compression |
| Ben Wallace | 2002 | -1.00 | 0.09 | 0.04 | -1.04 | 0.50 | secondary_star_or_specialist_compression |
| Dennis Rodman | 1992 | -0.59 | -0.76 | -0.17 | -0.42 | 0.23 | small_sample_underperformance |
| Rajon Rondo | 2008 | -0.18 | -1.16 | -1.15 | 0.97 | 0.99 | secondary_star_or_specialist_compression |
| Jaylen Brown | 2022 | -0.11 | -0.04 | -0.04 | -0.08 | 1.00 | secondary_star_or_specialist_compression |

### The elevation-reversal pattern (section 8)

Before the safeguard, ~12-14 *clearly valuable, well-sampled* playoff performers had a positive absolute level **reversed** to a net-negative postseason value purely by a large negative elevation (McHale 1987 abs +5.0, Manu 2008 +4.5, Shaq 2006, Dirk 2005, Nash 2003, KAT 2025, Parish 1981, Cade 2026, …). This contradicts the component's own documented contract that elevation *supplements* absolute quality and that a slight decline from an extreme baseline is *damped, not heavily punished*.

### Adopted safeguard (bounded · gated · monotonic)

```
when reliab_level >= 1.0 AND sample_reliab >= 0.60:
    elevation >= (0.20 - 1.0) * reliab_level   # retain >=20% of level
```

Implemented in `peak3.postseason_value` (constants `PO_ELEV_GUARD_*`). Properties, all verified:

- **Narrow**: active for **14 of 6,232** playoff seasons (0.2%).
- **Monotonic non-decreasing**: it can only *raise* a postseason score, so no player — including Shaq/Jokić/Hakeem/Robinson/Kareem/Embiid — is ever penalized.
- **Bounded**: max single-season effect 0.57 Prime-raw (cap ±1.0); 3-yr 0.28 (±0.7); 5-yr 0.18 (±0.5).
- **Player-agnostic**: gated only on the absolute level and the sample. It does **not** rescue Jaylen Brown or Dennis Rodman, whose negative seasons are genuinely poor *absolute* level — so it is not a back-door tune.
- The elevation term is **not removed** and scores are **not** floored at zero.

## 10. Finals MVP / playoff-role audit (Jaylen Brown)

| season_end | finals_mvp | championship | finals_mvp_component | recognition | postseason_perf | po_abs_level | team_achievement | prime_raw |
|---|---|---|---|---|---|---|---|---|
| 2017 | 0.00 | 0.00 | 0.00 | 0.00 | -8.84 | -14.00 | 22.82 | -1.11 |
| 2018 | 0.00 | 0.00 | 0.00 | 0.32 | -2.35 | -7.51 | 27.97 | 8.36 |
| 2019 | 0.00 | 0.00 | 0.00 | 0.00 | 1.88 | -2.94 | 14.70 | 5.30 |
| 2020 | 0.00 | 0.00 | 0.00 | 0.00 | 4.55 | 0.25 | 33.06 | 14.58 |
| 2021 | 0.00 | 0.00 | 0.00 | 6.40 | 0.00 | 0.00 | 0.00 | 18.46 |
| 2022 | 0.00 | 0.00 | 0.00 | 0.00 | -0.11 | -0.04 | 62.96 | 18.25 |
| 2023 | 0.00 | 0.00 | 0.00 | 16.00 | -14.00 | -13.64 | 46.00 | 16.81 |
| 2024 | 1.00 | 1.00 | 100.00 | 22.40 | 4.62 | 1.89 | 73.70 | 21.85 |
| 2025 | 0.00 | 0.00 | 0.00 | 6.40 | -4.68 | -8.25 | 23.59 | 13.36 |
| 2026 | 0.00 | 0.00 | 0.00 | 19.61 | -1.74 | -3.62 | 0.00 | 24.91 |

Brown's Finals MVP (2024) is counted **only in Recognition** (`finals_mvp_component`=100); the championship sits in Team Achievement and his playoff box stays in Postseason (positive, +4.62) — **no duplication**. His negative postseason seasons (2017, 2023, 2025) are genuinely-poor *absolute* level (e.g. 2023: usg 31.4 with poor efficiency), **not** elevation reversals, so the safeguard correctly leaves them unchanged. No automatic Finals-MVP postseason bonus is given.

## 11. Teammate-context distinction

| player | window | prime_raw | teammate_adjustment | team_achievement_contrib | burden_residual | po_elevation_value | po_contrib | role |
|---|---|---|---|---|---|---|---|---|
| Jaylen Brown | 2021-22-2025-26 | 20.67 | -0.29 | 1.18 | 3.11 | -0.62 | -0.30 | Primary offensive engine |
| Dennis Rodman | 1987-88-1991-92 | 23.00 | 0.01 | 0.63 | 1.71 | -0.42 | -1.22 | High-impact role player |
| Manu Ginobili | 2003-04-2007-08 | 38.51 | -0.26 | 1.62 | 7.53 | 6.40 | 4.20 | Secondary star |
| Klay Thompson | 2014-15-2018-19 | 21.14 | -0.44 | 1.74 | 6.79 | -3.54 | -0.62 | Secondary star |
| Draymond Green | 2014-15-2018-19 | 29.69 | -0.44 | 1.54 | 4.34 | -0.36 | 1.88 | Secondary star |
| Scottie Pippen | 1993-94-1997-98 | 38.78 | -0.23 | 1.41 | 3.01 | -1.22 | 1.35 | Two-way engine |
| Pau Gasol | 2006-07-2010-11 | 32.05 | -0.15 | 1.21 | 6.73 | 1.38 | 2.28 | Secondary star |
| Kyrie Irving | 2014-15-2018-19 | 31.44 | -0.09 | 1.08 | 5.24 | -2.68 | 0.89 | Secondary star |

The teammate adjustment is the only context mechanism that can be negative and is hard-capped at ±0.5 Prime points; the legacy specialist adjustment is inert (0.0). Secondary stars are not stacked-penalized across components.

## 12. Manu Ginóbili vs Allen Iverson

- Ginóbili best-5yr (2003-04-2007-08): raw **38.51** (SI 23.3, TP 8.7, Rec 0.9, PO 4.2, Team 1.6)
- Iverson best-5yr (1998-99-2002-03): raw **35.65** (SI 18.2, TP 5.9, Rec 9.3, PO 1.0, Team 1.0)
- Δ raw = **+2.87** in Ginóbili's favour, driven by per-possession impact (SI) and efficiency; Iverson leads Recognition (MVP). Verdict: **defensible but philosophical**. The model values impact + efficiency over volume + accolades; this is a philosophical choice, not a distortion. The formula is **not** changed to reorder them.

## Decision standard — verdicts

| Subject | Verdict |
|---|---|
| DeAndre Jordan | No issue — ranks at the bottom of the big comparison set; efficiency overlap does not over-rank him |
| Rudy Gobert | Reasonable philosophical choice — high rank is Recognition (3× DPOY) + impact, not efficiency double-count |
| Dwight Howard | No issue — top rank is Recognition (DPOY×3, MVP runner-up) |
| Domantas Sabonis | No issue — high creation (usg 22, creation-independence 73), not a low-creation finisher |
| Kevin McHale | Small structural weakness (postseason) — fixed by the elevation safeguard |
| Jaylen Brown | No issue — Finals MVP correctly in Recognition; negative playoffs are genuine absolute-level, not elevation |
| Dennis Rodman | Data/representation limitation — rate-based absolute playoff level under-credits a rebounding/defense specialist; philosophical, not an elevation artifact; safeguard does not apply |
| Manu Ginóbili vs Allen Iverson | Defensible but philosophical |

## Adopted change summary

1. **2025-26 completeness guard** (data integrity; no score change).
2. **Postseason elevation-reversal safeguard** — bounded, gated, monotonic; the only scoring change, fully within the ±1.0/0.7/0.5 caps. No weight changed, no sixth component, no coefficient tuned to a named player. All other audited issues: no correction.
