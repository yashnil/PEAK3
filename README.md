# peak3 — NBA Peak Evaluator

`peak3` measures **how good an NBA player was at their best**, season by season,
over a 3-year prime, a 5-year prime, and any N-year window — from automatically
scraped and cached Basketball Reference data (1979-80 → 2025-26).

You never type a player's stats or accolades by hand. You give a name; the model
scores every qualifying player-season on one transparent formula, tests every
consecutive window, and explains which prime won and exactly why.

This document is the authoritative product + methodology reference. For the
deepest derivation see [`METHODOLOGY.md`](METHODOLOGY.md); for a regenerated
25-player validation run see [`outputs.txt`](outputs.txt).

---

## 1. What the model measures

Three related but distinct things, each reported separately:

| Output | What it captures | Includes |
|---|---|---|
| **Regular-season dominance** (`regular_perf`) | Individual regular-season play only | Statistical Impact + Traditional Production. No awards, no playoffs, no team result. |
| **Performance-Only** (`performance_only`) | Total individual on-court value | Regular-season play **+ individual playoff value**. Still no awards, no team result. |
| **Prime** (`prime_score`) | The full peak evaluation | Performance-Only **+ individual recognition + team achievement**. |

So a player who never won an award and never reached a deep playoff round is
judged purely on play; awards and team success only ever **add**, and only in
their own dedicated slices.

---

## 2. The official Prime formula

The Prime index is an **open weighted sum of five raw-value components**:

```
prime_raw = 0.38 · Statistical Impact
          + 0.21 · Traditional Production
          + 0.20 · Individual Recognition
          + 0.18 · Postseason Individual Value
          + 0.03 · Team Achievement
          + teammate_adjustment        (descriptive, capped ±0.5 index pts)

prime_score = calibrate(prime_raw)      # monotonic 0–100 display relabel
```

Every component is a **raw additive points value** computed by metric-specific
continuous formulas on real basketball units. There are **no percentiles, no
universal z-scores, and no generic 0–100 grades inside the index** (era-relative
percentiles exist only for role labels and descriptive display). The index is
open/uncapped, so apex seasons separate naturally.

`performance_only` is the same sum **without** Recognition and Team Achievement:
`0.38·SI + 0.21·TP + 0.18·Postseason`.

### The performance-driven split

```
59% regular-season statistical performance   (Statistical Impact 38 + Traditional Production 21)
20% individual recognition
18% individual postseason performance
 3% team achievement
```

### Why Recognition (20%) and Postseason (18%) are *both* high — without double counting

These two large slices read **completely different evidence**, so a high weight on
each is additive information, not duplication:

- **Individual Recognition (20%)** measures externally-validated individual
  *standing*: MVP, Finals MVP, All-NBA, All-Defense, DPOY, and statistical titles.
  These are meaningful, voted/objective evidence of season quality. Awards are
  additive and **overlap-discounted** (MVP↔All-NBA, DPOY↔All-Defense, All-Star
  subsumed) so no honor is counted twice.
- **Postseason Individual Value (18%)** measures *actual on-court playoff
  performance* from box/impact metrics (reliability-adjusted level + sample-
  adjusted elevation + sustained volume + a diminishing, reliability-shrunk
  dominance bonus). A ring or deep run **by itself** does not create a large
  boost, and an extreme rate stat over a **short** run no longer dwarfs a complete
  Finals-length season — the player must have performed at an elite level and
  carried major responsibility over a real playoff sample (see §6).
- **Team Achievement (3%)** measures *team results* with a small bounded weight,
  so a player is not credited heavily merely for being on a good team.

The boundaries are strict and enforced by tests: **Finals MVP appears only in
Recognition**, **championship/advancement only in Team Achievement**, and
**playoff box-score performance only in Postseason**. Recognition stayed at 20%
(up from a transient 15%) because the awards it encodes are genuine evidence of a
peak; the +5 points came proportionally from Statistical Impact (41→38) and
Traditional Production (23→21). Postseason stayed at 18%.

---

## 3. Statistical Impact (38%)

Raw advanced-impact metrics, combined by a masked weighted average that
**renormalizes over whatever is present**, so a missing metric never penalizes a
player or an era. Relative sub-weights:

| Sub-metric | Rel. weight | Built from |
|---|---|---|
| BPM / OBPM / DBPM consensus | 15 | `0.50·BPM + 0.25·OBPM + 0.25·DBPM` (each a continuous plus/minus→points curve) |
| VORP + total Win Shares | 10 | `0.55·VORP + 0.45·total WS` — the **cumulative / minutes / total-value** term |
| WS/48 | 8 | per-minute win production |
| PER | 5 | per-minute efficiency rating |
| Modern impact supplement | 7 | EPM / LEBRON / RAPTOR / DARKO / RAPM consensus — a **bounded supplement**, excluded (weights renormalize) when absent |

Each metric uses `_impact_value(x, x0, per, knee)`: `per` points per unit above a
replacement anchor `x0`, with a smooth never-flat log tail above `knee` and
**negative** values below replacement. Per-minute rate (BPM/WS48/PER) and
cumulative value (VORP/total WS) live in **separate** sub-weights, so they are
not double-counted; defense enters once, via DBPM inside the BPM consensus.

---

## 4. Traditional Production (21%)

Raw box production, where each skill **only adds when it is genuinely strong** (a
hinge that is ~0 at average), so a center's ordinary assists or a guard's
ordinary rebounds contribute nothing rather than dragging the score:

| Sub-metric | Weight | Notes |
|---|---|---|
| Scoring value | 0.40 | **Nonlinear**: `hinge(PTS/100) × minutes-load × efficiency-mult + successful-burden residual − inefficient-high-volume penalty` |
| Efficiency | 0.20 | relative TS% and TS+ above league |
| Playmaking | 0.16 | AST/100 and AST% hinges |
| Rebounding | 0.12 | TRB/100 and TRB% hinges |
| Box defense | 0.12 | stocks/100 and DBPM hinges |

Single-counted **penalties**: excessive turnovers and poor availability (games
played). Scoring multiplies volume × efficiency, so elite efficiency at low
volume is not treated like elite efficiency at high volume.

**Successful offensive-burden residual.** The scoring term's prior *raw heavy-usage
bonus* (`0.8·hinge(usage)`, which rewarded high usage by itself) is **replaced** by
a small, **bounded** residual that credits only *successfully absorbed* extreme
creation:

```
expected relative efficiency  = a usage-adjusted baseline (efficiency is expected to
                                fall as usage rises above ~22%)
usage_efficiency_residual     = actual relative TS − expected
creation_load                 = bounded(ACTUAL team scoring share + 0.45·team assist share)
                                (USG%+0.45·AST% proxy only as a flagged fallback)
successful_burden_residual    = scale · creation_load · max(usage_efficiency_residual, 0)
                                       · workload_reliability      (bounded, small)
```

The **creation load uses actual team scoring/assist shares** (player season points
÷ team points; assists ÷ team assists — *real* production responsibility, not the
USG%/AST% proxy). The actual-share pivots are **percentile-matched** to the old
proxy distribution, so the residual distribution and the TP scale are preserved
(mean burden 1.42 → 1.59; TP mean Δ ≈ +0.07). When a team share is missing the row
falls back to the proxy, flagged via `burden_data_status`. So **high usage alone
earns nothing**, high volume on poor efficiency earns nothing (small bounded
deduction at most), and strong efficiency on a light role earns nothing — only
genuinely *difficult* creation carried at **better-than-expected** efficiency over
real minutes adds (bounded to a few points). It does not duplicate Statistical
Impact (correlation ≈ 0.75) or the rest of Traditional Production; OBPM validates
it but is never an additive input. (USG%, team scoring share, team assist share
and AST% are kept as **distinct** measures — see DATA_SOURCES.md.)

---

## 5. Individual Recognition (20%)

Additive, **grouped** award values (overlapping honors do not each count in
full). A season with **no award contributes exactly zero**.

**Smooth award-voting for ranked awards (MVP, DPOY).** Placement *buckets* (which
created arbitrary second-to-fourth cliffs) are replaced by

```
award_voting_value = winner_premium                    (only the actual winner)
                   + continuous_vote_share_value       (primary signal)
                   + small_nonwinner_placement_stabilizer
```

**Real MVP/DPOY vote share** (Basketball Reference `award_share = points won ÷
points max`) is now populated for **every ranked awards-era season** and is the
primary continuous signal; the **documented smooth exponential placement
fallback** is used only where a ranked finish has no vote row (flagged via
`mvp_vote_data_status` / `dpoy_vote_data_status`). Missing vote share is **NaN,
never 0**. First place clearly exceeds second and **2nd → 10th decline smoothly
with no cliff**. Real share also separates a *dominant* winner (Embiid 2023 .915,
Westbrook 2017 .879 → above the fallback) from a narrow one, and a close runner-up
from a distant one. MVP example (placement fallback):
1st = 58, 2nd ≈ 29.8, 3rd ≈ 24.6, 4th ≈ 20.4, 5th ≈ 16.8 … 10th ≈ 6.5.

- **MVP**: smooth voting value (above); **unanimous MVP** adds +8 (objective record).
- **All-NBA**: 1st team 30 / 2nd 20 / 3rd 12 — **discounted ×0.45** for a top-3 MVP
  finisher (the MVP value already implies first-team).
- **All-Star**: 8, but **subsumed** by any All-NBA selection.
- **Defense**: DPOY smooth voting value (1st ≈ 35, then a smooth decline), grouped
  with All-Defense (1st 16 / 2nd 9, **×0.5** for a top-3 DPOY).
- **Finals MVP**: 20, **binary — no runner-up value** — and Finals MVP lives **only** here.
- **Statistical titles** (scoring/assist/rebound/steal/block leader) and **50-40-90**
  add independently (the achievement itself, not the underlying statistical edge,
  which already lives in Statistical Impact / Traditional Production).

The sum is scaled ×0.80 onto the same ~0–115 magnitude as the other components,
so the 20% weight is an honest 20%. **No championship or team result appears in
Recognition.**

---

## 6. Postseason Individual Value (18%)

At 18% this is a **major** slice, so it is built to reward elite individual
playoff performance — **not** winning. A purely individual, zero-baseline,
additive value with four parts:

```
postseason_individual_value = absolute_playoff_level   (reliability-adjusted)
                            + playoff_elevation        (sample-adjusted)
                            + sustained_elite_volume
                            + dominance_bonus          (diminishing, reliability-shrunk)
```

**Playoff-sample reliability governs the upper tail.** One confidence signal
`sample_reliab ∈ [0,1]` measures *how much* playoff basketball the rate stats were
observed over — **minutes**, **games**, and **series/rounds reached**
(`0.40·min/850 + 0.35·games/19 + 0.25·series/4`). Series count is a **sample**
signal only (how many rounds the rates survived), never points for advancement.
It shrinks the level, the elevation, and especially the dominance bonus, so an
extreme rate stat over a *short* run cannot dwarf a complete Finals-length run.

**absolute_playoff_level** — raw playoff quality across all skills: BPM/WS48/PER
rate, scoring volume, efficiency, playmaking, rebounding, box defense, and
minutes, opponent-quality adjusted, centered on a replacement baseline
(`PO_BASELINE = 25`). This is **linear in level** (the convex bonus is a separate
term, so an extreme level is never rewarded twice) and is then **shrunk by
`sample_reliab`** → the *reliability-adjusted level*. Excellent play adds, poor
play is a small bounded penalty (downside floored once at `−14`). A ring/Finals/
deep run **by itself** does not produce a large level; round reached is **not**
rewarded.

**playoff_elevation** — `playoff rate impact − regular-season rate impact`, using
the identical rate formula for both. Gains are rewarded in full; a **decline from
an extreme regular-season baseline is damped (×0.35)** and bounded (≤ +14, ≥ −6),
then **shrunk by the same `sample_reliab`**. Elevation **supplements** absolute
level; it never replaces it. LeBron 2008-09 still earns major elevation credit; a
Jokić who elevates gains value even without a title — but improvement measured
over a short sample is no longer over-trusted.

**sustained_elite_volume** — elite per-minute quality **accumulated over real
playoff minutes *and* games** (`0.5·min/950 + 0.5·games/21`, uncapped below a
Finals-length run), scaled by **best-player responsibility** from the **playoff
usage burden** (floor `0.55`, cap `1.12`). At equal rates, elite play sustained
through *more* rounds earns more than a shorter run — the extra value comes from
sustaining elite play, never from advancing. Requires quality **and** volume
**and** responsibility; floored at 0.

**dominance_bonus** — the exceptional residual of the level above an elite knee
(`50`), through a **saturating square-root curve** (`PO_DOMINANCE_SCALE·√(level−50)`)
that **replaces the old open-ended `+0.30 per point` linear booster**. Level 50
earns 0, 60 is meaningful, 75 larger, 90 exceptional, and the curve flattens so it
never explodes at the top. It is then **shrunk by `sample_reliab` with an extra
series gate**, so a short Conference-Finals run with extreme rates earns only a
*partial* historical-dominance bonus; the full bonus is reserved for elite play
sustained through the deepest runs.

**Reliability & no-double-counting.** The four terms read **different signals**
(how good / improvement / how much / exceptional top), so the same extreme
BPM/PER/WS48 is not counted multiple times; availability is counted **once**.
**No playoffs (or zero playoff minutes) = exactly 0.** Finals MVP and clear-best-
player status only **validate** the metric and add no points; championships, round
reached, and Finals MVP do **not** enter here (they live in Team Achievement and
Recognition respectively). *Net effect:* a short extreme run (LeBron 2008-09,
~106 → ~75) no longer overpowers complete championship seasons, and the
single-season Prime crown passes to a complete Finals-length run (Jordan 1990-91).

---

## 7. Team Achievement (3%)

Zero baseline. The component is

```
team_achievement = smooth_bounded_advancement_value × role_responsibility_multiplier
```

The **advancement value** is a *smooth, bounded* progression in `[0, 100]` driven by
measurable results (rounds reached / series won / championship), **interpolated**
between anchors rather than coarse `0 / 50 / 100` buckets:

| Result (rounds reached) | Advancement value |
|---|---|
| First-round exit / no playoffs | **0** |
| Won ≥1 series (lost Conf Semis) | 30 |
| Conference Finals | 58 |
| Finals | 80 |
| Champion | 100 |

…with intermediate `playoff_round_score` values interpolated smoothly between
those anchors. The **role-responsibility multiplier** distinguishes a *clear
primary player* (1.00) → *co-star* (0.82) → *secondary contributor* → *role
player* (floor 0.34). Recognized best/co-best players use the explicit flag;
everyone else is graded smoothly by **creation burden** (usage + assist share),
capped at the co-star level, so a low-creation role player on a champion receives
limited credit while a high-responsibility hub does not.

`playoff_round_score` encodes rounds *reached*, not won, so a first-round **loss**
(score 30, zero series won) correctly scores 0. With only a 3% weight (≤3.0 index
points) a title can never offset a large individual gap. **Championships appear
only here; Finals MVP and individual playoff box score never enter Team
Achievement.**

---

## 8. Zero baselines & anti-double-counting

- No playoffs → Postseason = 0 **and** Team Achievement = 0.
- No award → Recognition = 0.
- First-round exit → Team Achievement = 0.
- Each playoff fact lives in exactly one place: **round/series → Team
  Achievement; Finals MVP → Recognition; individual playoff box → Postseason.**
- Within Statistical Impact, per-minute rate and cumulative value are separate
  sub-weights; defense is counted once (DBPM in the BPM consensus).
- Postseason availability is the only minutes discount (counted once).

These invariants are enforced by tests (see §13).

---

## 9. Missing data, eras, and calibration

- **Missing optional metrics never zero a player out.** Masked weighted averages
  renormalize over present metrics, so old seasons without modern impact data —
  or any season missing a box split — are not penalized.
- **Era handling.** Components are continuous functions of raw units; era-relative
  percentiles/z-scores are used **only** for role labels and descriptive display,
  never inside the index. Per-100 conversions and TS+/relative-TS handle
  pace/efficiency inflation.
- **Calibration.** `prime_score = calibrate(prime_raw)` is a single, **monotonic**
  piecewise-linear relabel of the open index into interpretable historical bands
  (~60s = quality starter, mid-70s = credible All-NBA, ~88+ = MVP-level, ~95+ =
  historically dominant). Because it is monotonic it **never changes ordering**;
  the raw index is preserved (`prime_index`/`perf_index`) so apex separation is
  never lost.

---

## 10. Single-season, 3-year, 5-year, N-year peaks

- A **single season** must clear a workload bar (≈1800 minutes scaled, ≥28 MPG,
  ≥60% of team games) to be `workload_qualified`.
- An **N-year window** is N *consecutive completed* seasons. The window score is
  rank-weighted (best season weighted most) with a documented minimum-weight
  floor — for 3-year the default is `0.40·best + 0.35·second + 0.25·third`
  (`--window-weighting equal` averages instead).
- **5-year peaks** (`best 5-year Performance-Only peak`, `best 5-year Prime peak`)
  use the same framework via `n_year_windows(n=5)`.
- Every window's score **decomposes exactly** into the five weighted component
  contributions (they sum to the rank-weighted raw window score).

### Provisional seasons
A season is **provisional** (incomplete) unless a broad set of rotation players
have played a near-full schedule — specifically until the **90th-percentile**
rotation games-fraction reaches `0.90` (not when a single iron-man hits the game
count). Provisional seasons may appear in career tables but are **excluded** from
official single-season, 3-year, 5-year, N-year, and leaderboard results
(`--include-provisional` opts in).

---

## 11. Why different archetypes can score highly

The model rewards real value through whichever channel a player provides it:

- **Dominant regular-season engines** (Jordan, LeBron, Jokić) win on Statistical
  Impact + Traditional Production.
- **Playoff elevators** (Hakeem's title runs, Kawhi 2019, Dirk 2011) gain through
  Postseason level + elevation + sustained-volume + dominance — now a major 18%
  slice, with the dominance bonus diminishing and shrunk by the playoff sample.
- **Pure scorers** (Dantley, English) score on Traditional Production.
- **Defensive anchors / rebound specialists** (Ben Wallace, Rodman, Mutombo)
  reach high marks through DBPM/stocks and rebounding hinges plus All-Defense
  recognition — no archetype penalty, no archetype bonus.

No reputation, "clutch," or named-player overrides exist anywhere.

---

## 12. Install & usage

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

First run scrapes and caches Basketball Reference (~235 pages, ~13 min at a
polite delay); afterward everything is offline.

```bash
# single player (full career table + 3-year prime + why it won)
python peak3.py --player "Hakeem Olajuwon"

# both Performance-Only and Prime views
python peak3.py --player "LeBron James" --mode both

# 5-year prime (or any N from 1..10) with component decomposition
python peak3.py --player "Stephen Curry" --years 5

# leaderboards
python peak3.py --top 25 --mode legacy
python peak3.py --top-seasons 25            # best single seasons (provisional excluded)

# compare seasons / players (writes an audit under results/)
python peak3.py --compare-seasons "Stephen Curry" 2015 2016 --trace-formula
python peak3.py --compare-players "Hakeem Olajuwon" "David Robinson"

# trace one season's exact per-metric contributions
python peak3.py --player "Nikola Jokic" --audit-score --season 2023 --trace-formula

# offline / rebuild
python peak3.py --player "Kobe Bryant" --no-scrape   # use cache only
python peak3.py --rebuild --no-scrape                # re-parse cached HTML, re-score
python peak3.py --refresh                            # re-download, then rebuild
```

### Full CLI reference

**Reports:** `--player`, `--mode {stat,legacy,both}`, `--years N`, `--top N`,
`--top-seasons N`, `--best-season`, `--best-window`, `--window-weighting
{weighted,equal}`, `--sensitivity`, `--export PATH`, `--include-provisional`,
`--season YEAR`, `--trace-formula`.

**Compare:** `--compare-seasons PLAYER S1 S2`, `--compare-players A B`.

**Data / context:** `--rebuild`, `--refresh`, `--no-scrape`,
`--start-season-end`, `--end-season-end`, `--build-context`, `--ensure-context`.

**Candidates / population:** `--build-candidates`, `--candidates`,
`--candidate-count N`, `--stat-candidate-count N`, `--list-candidates`,
`--list-all-nba-candidates`, `--list-exception-candidates`, `--list-all-players`,
`--search-player NAME`, `--add-candidate NAME`, `--candidate-status`, `--tier N`,
`--include-all-core-players`, `--workload-policy {default,strict,permissive}`.

**Audits:** `--audit-score`, `--audit-context`, `--audit-data`,
`--audit-candidates`, `--audit-anomalies`, `--audit-teammates`,
`--audit-career-order`, `--audit-raw-model`, `--audit-exception-candidates`,
`--debug`.

---

## 13. Tests

All offline (no network):

```bash
.venv/bin/python tests/test_peak3.py       # I/O, windows, parsing
.venv/bin/python tests/test_context.py     # context derivation + window reconciliation
.venv/bin/python tests/test_scoring.py     # component invariants
.venv/bin/python tests/test_validation.py  # data-supported relationships on the built cache
.venv/bin/python tests/test_corrections.py # zero baselines, postseason, weights, no-double-count
```

`test_corrections.py` proves, among others: the 43/24/18/12/3 weights reconcile
exactly in single-season, 3-year and 5-year windows; the 2025-26 Brunson context
is correct; Finals MVP appears only in Recognition; championship appears only in
Team Achievement; playoff elevation affects Postseason only; no double counting;
and provisional seasons cannot enter five-year peaks.

---

## 14. Interpretation examples

**A dominant regular-season player (Nikola Jokić).** His Prime is anchored by an
enormous Statistical Impact (top-tier BPM consensus, WS/48, PER) and Traditional
Production. His Postseason value is solidly positive but secondary; the 18%
weight lifts strong playoff runs without overturning a historically great regular
season. He ranks where his raw advanced metrics put him — not forced anywhere.

**A playoff-elevating player (Hakeem Olajuwon, 1993-94 / title runs).** His
regular-season Statistical Impact is excellent but below the very top; his peak
is materially lifted by Postseason value — strong playoff level, positive
elevation (he raised his game in May/June), and sustained-volume from two deep
championship runs — plus two Finals MVPs in Recognition. The Hakeem–Robinson
**contribution bridge** in `outputs.txt` makes this transparent: Robinson leads
on Statistical Impact while Hakeem leads on Recognition and Postseason, and
raising Recognition from 15% to 20% (and trimming Statistical Impact 41→38) flips
their best-overlapping-3-year raw Prime gap from a slight Robinson edge to a
slight Hakeem edge — **if the data supports it**, with neither player forced.

---

## 15. Limitations

- Modern impact metrics (EPM/LEBRON/RAPM) are not populated in this dataset;
  Statistical Impact renormalizes so no era is penalized, but the modern
  supplement is currently unused.
- 2025-26 is treated as a complete season; its championship/Finals-MVP context is
  set explicitly via `data/manual_context.csv` rather than scraped from a live
  bracket.
- Postseason value uses whole-playoff aggregates, so a great early-round run
  followed by a poor Finals nets out (no per-round weighting, by design — this is
  individual value, not narrative).
- Opponent-quality and series context are auto-derived from brackets; unobserved
  values are treated as neutral, never fabricated.
- Some official native scores are still stored under legacy `_pct` column names
  (used only for role labels, never the index); a full rename is deferred.

See [`METHODOLOGY.md`](METHODOLOGY.md) for the complete derivation and
[`outputs.txt`](outputs.txt) for a full regenerated validation run.
