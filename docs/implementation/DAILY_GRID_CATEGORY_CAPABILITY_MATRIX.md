# Daily Grid — category capability matrix

What the Daily Grid's axes *could* ask, measured against what PEAK3's
committed data can *truthfully and deterministically* answer.

The brief for the category-breadth pass listed the dimension families NBA
Stats exposes (position, starter/bench, experience, draft year, draft pick,
college, country, height/weight, team, opponent, conference/division, playoff
round, season segment, clutch, traditional stats, advanced stats, scoring,
usage, defense, shooting, hustle, tracking) as *inspiration, not permission to
invent data*. This document is the audit that decides which of them ship.

Every number below is measured against the real answer pool
(`nba_peak/daily_grid/pool.py`: 9,280 player-seasons, 1,384 distinct
identities, 1979-80 through 2025-26), not estimated.

---

## The gate

A family ships only if all five hold:

1. **Available** — the fact is a column on a committed local table
   (`cache/processed/scored_1980_2026.parquet`,
   `cache/processed/regular_1980_2026.parquet`), read at player-**season**
   grain. No network, no derivation from a source this repository does not
   hold.
2. **Complete** — no nulls in the pool for the column the predicate reads. A
   predicate over a partly-null column rejects seasons for a reason that is
   not about basketball.
3. **Era-covered** — the family has answers across the window, or its era skew
   *is the fact* and is stated in the constraint's own description.
4. **Populous** — enough qualifying seasons *and* distinct identities that a
   cell crossing it with another axis can still clear the solvability floors
   (`MIN_ANSWERS_PER_CELL = 6`, `MIN_PLAYERS_PER_CELL = 4`). A two-answer
   trivia axis is explicitly out of scope.
5. **Deterministic** — a pure predicate over committed data, so the same date
   resolves to the same board forever.

---

## Shipped

| Family | Available? | Era coverage | Qualifying seasons | Distinct players | Deterministic | Safe for Daily Grid | Notes |
|---|---|---|---|---|---|---|---|
| `team` (30 franchises) | yes — `team` | 1980s–2020s | whole pool | 1,384 | yes | yes | Relocations folded in (Sonics answer "Thunder"). Capped at 2 axes per board. |
| `award` (15) | yes — `awards`, `mvp_rank`, `dpoy_rank`, `all_nba_team`, `all_defense_team`, `all_star`, `*_title` | 1980s–2020s | varies | varies | yes | yes | DPOY/6MOY gated from 1982-83, MIP from 1985-86 via `Constraint.valid_from`. |
| `era` (5 decades) | yes — `season_start_year` | by construction | whole pool | 1,384 | yes | yes | No 1970s axis: the window opens at 1979-80, so it would be one season pretending to be a decade. |
| `position` (3) | yes — `pos` (season grain) | 1980s–2020s | whole pool | 1,384 | yes | yes | Hyphenated listings count for the primary position only, so the three stay mutually exclusive. |
| `outcome` (5) | yes — `championship`, `finals_appearance`, `conf_finals`, `made_playoffs` | 1980s–2020s | varies | varies | yes | yes | Label rebuilt from the flags PEAK3 scores (`canonical_playoff_round`). |
| `context` (3) | yes — `mpg`, `g` | 1980s–2020s | varies | varies | yes | yes | Capped at 1 axis per board. |
| `peak` (5) | yes — `prime_score` | 1980s–2020s | varies | varies | yes | **restricted** | PEAK3-native. At most one per board, and only on ~1 date in 5 (`_native_allowance`). |
| `component` (5) | yes — the five PEAK3 components | 1980s–2020s | varies | varies | yes | **restricted** | Same restriction, same reason. |
| **`career` (3)** — new | yes — `age` (regular table, season grain) | 1980s–2020s, all decades | 2,010 / 2,420 / 616 | 932 / 744 / 249 | yes | yes | Age 23-, 30+, 34+. One exclusive group: 23- x 30+ has zero answers for ever, and 34+ nests inside 30+. |
| **`production` (5)** — new | yes — `pts_per75`, `ast_per75`, and `trb`/`stl`/`blk` per 100 x 0.75 | 1980s–2020s, all decades | 1,110 / 1,578 / 1,004 / 803 / 1,108 | 281 / 325 / 244 / 195 / 327 | yes | yes | One denominator (per 75 possessions) for every rate, stated in each description. Independent of each other, so two may cross. |
| **`shooting` (2)** — new | yes — `ts_plus`, `threepar` | TS+ all decades; 3PT volume effectively 1990s+ | 1,002 / 2,410 | 370 / 609 | yes | yes | `ts_plus`, not raw `ts_pct`: league TS rose ~10 points across the window, so a fixed `ts_pct` cut is a decade filter wearing an efficiency label. The three-point era skew is stated in the constraint's description. |
| **`usage` (2)** — new | yes — `usg_pct` | 1980s–2020s, all decades | 1,582 / 652 | 392 / 182 | yes | yes | Nested (28% inside 25%), so one exclusive group. |

**Totals: 83 constraints across 12 families** (was 71 across 8).

---

## Available, deliberately not shipped

| Candidate | Available? | Why not |
|---|---|---|
| 50/40/90 season | yes — `fifty_forty_ninety` | 13 seasons, 9 players in the whole window. A two-answer trivia square, which the brief rules out explicitly. |
| BPM / VORP / WS48 / PER thresholds | yes — all four are columns | They restate the objective the game already scores. The Phase 11C design note in `constraints.py` records why a PEAK3-native axis makes a worse puzzle ("name the biggest all-time name who clears the bar"), and these correlate with `prime_score` closely enough to collapse the same way. |
| `role` ("Primary scorer", "Defensive anchor") | yes — `role` | Classes far too thin (54 defensive-anchor seasons in the window) to intersect with a team or an award and leave a solvable cell. Already documented in `constraints.py`. |
| Multi-team ("journeyman") seasons | `n_teams` exists | The pool drops `2TM`/`3TM`/`TOT` rows by construction — a season aggregate for a traded player is not a real single-team-season and a team constraint cannot be honestly evaluated against one. |
| Raw `ts_pct` bands | yes | Superseded by `ts_plus`; see above. |

---

## Not available — no committed source

None of these exist in any table this repository holds at player-season grain,
so no constraint can be written for them without fabricating data:

| Requested dimension | Status |
|---|---|
| Draft year / round / pick / lottery / undrafted | **no data** |
| College | **no data** |
| Country / international | **no data** |
| Height / weight bands | **no data** |
| Conference / division | **no data** — and a static franchise→conference map would be wrong across the 2004 realignment and the Hornets/Pelicans moves, which is exactly the kind of "close enough" this gate exists to refuse. |
| Experience / seasons played / rookie flag | **no reliable data** — the window opens at 1979-80, so career length is truncated for every player who debuted earlier and a "rookie" flag would be a lie for them. |
| Starter / bench | **no data** (games-started is not on either committed table). |
| Opponent, season segment, clutch splits | **no data** — these are game- or possession-grain and the pool is season-grain. |
| Hustle, tracking | **no data** (and league-wide only from 2013-14 regardless). |
| One-team vs multi-team career, franchise-era combinations | derivable in principle, but see "Multi-team seasons" above and the per-board franchise cap. |

---

## What this changed, measured

Same 365-day window (2026-09-09 → 2027-09-08), generated through the real
`generate_board` path against the committed pool:

| Metric | Before (v3, 71 constraints / 8 families) | After (v4, 83 / 12) |
|---|---|---|
| Boards generated | 365 | 365 |
| Generation failures | 0 | 0 |
| Zero- or one-answer cells | 0 | 0 |
| Constraint ids never reached | 2 | 0 |
| Largest single-category share of all axis slots | 3.7 % | 2.6 % |
| Mean generation attempts | 2,759.2 | 783.5 |
| Max generation attempts | 6,985 | 4,941 |
| Exact-category repeats inside the 3-board cooldown | 222 | 11 |
| Mean exact-category repeat distance | 10.2 boards | 12.7 boards |
| Cell-pair repeats inside the 10-board cooldown | 136 | 3 |
| Minimum cell-pair repeat distance | 1 board | 5 boards |
| Mean cell-pair repeat distance | 67.0 boards | 90.6 boards |
| A family taking 2 of 6 axes on **consecutive** boards | 251 | 1 |
| Boards drawing on 6 distinct families | 19 | 121 |
| Boards drawing on only 4 | 158 | 56 |
| Consecutive identical boards | 0 | 0 |

Reproduce with:

```
scripts/audit_daily_grid_novelty.py --days 365
```

---

## Determinism and the published archive

Adding constraints changes what `rng.sample` returns for **every** date, so the
taxonomy is versioned and each date resolves through the version that was in
force when its board shipped (`_VERSION_LADDER`). Verified by generating every
date from 2026-07-20 to 2026-09-08 before and after this change: **all 50
boards are byte-identical**, and the first board to differ is 2026-09-09, the
day after `FAMILY_CUTOVER_DATE`.

The published **label** is part of the published board, so the theme priority
order is versioned the same way — reordering the single shared list changed the
primary label of 14 in 100 already-published legacy boards while leaving their
axes untouched. Legacy label drift after the fix: 0 of 100.
