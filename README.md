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
  performance* from box/impact metrics (level + elevation + sustained volume +
  convex dominance). A ring or deep run **by itself** does not create a large
  boost — the player must have performed at an elite level and carried major
  responsibility (see §6).
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
| Scoring value | 0.40 | **Nonlinear**: `hinge(PTS/100) × minutes-load × efficiency-mult + usage burden − inefficient-high-volume penalty` |
| Efficiency | 0.20 | relative TS% and TS+ above league |
| Playmaking | 0.16 | AST/100 and AST% hinges |
| Rebounding | 0.12 | TRB/100 and TRB% hinges |
| Box defense | 0.12 | stocks/100 and DBPM hinges |

Single-counted **penalties**: excessive turnovers and poor availability (games
played). Scoring multiplies volume × efficiency, so elite efficiency at low
volume is not treated like elite efficiency at high volume.

---

## 5. Individual Recognition (20%)

Additive, **grouped** award values (overlapping honors do not each count in
full). A season with **no award contributes exactly zero**.

- **MVP**: 1st = 58, 2nd = 36, 3rd = 26, top-5 = 18, top-10 = 9, plus up to +14 for
  MVP vote share; **unanimous MVP** adds +8 (objective record).
- **All-NBA**: 1st team 30 / 2nd 20 / 3rd 12 — **discounted ×0.45** for a top-3 MVP
  finisher (the MVP value already implies first-team).
- **All-Star**: 8, but **subsumed** by any All-NBA selection.
- **Defense**: DPOY 1st = 34 / 2nd = 18 / 3rd = 12 / top-5 = 7 (+ up to +10 vote
  share), grouped with All-Defense (1st 16 / 2nd 9, **×0.5** for a top-3 DPOY).
- **Finals MVP**: 20 — and Finals MVP lives **only** here.
- **Statistical titles** (scoring/assist/rebound/steal/block leader) and **50-40-90**
  add independently.

The sum is scaled ×0.80 onto the same ~0–115 magnitude as the other components,
so the 20% weight is an honest 20%. **No championship or team result appears in
Recognition.**

---

## 6. Postseason Individual Value (18%)

At 18% this is a **major** slice, so it is built to reward elite individual
playoff performance — **not** winning. A purely individual, zero-baseline,
additive value with three parts:

```
postseason_individual_value = absolute_playoff_level
                            + playoff_elevation
                            + sustained_elite_volume
```

**absolute_playoff_level** — raw playoff quality across all skills: BPM/WS48/PER
rate, scoring volume, efficiency, playmaking, rebounding, box defense, and
minutes, opponent-quality adjusted, centered on a replacement baseline
(`PO_BASELINE = 25`). The curve is **nonlinear**: ordinary play is a small
contribution, good is moderate, elite is substantial, and a **convex dominance
booster** (`+0.30` per point of level above a high knee) makes a *historically
dominant* run **exceptional**. Excellent play adds, poor play is a small bounded
penalty (downside floored once at `−14`). A ring/Finals/deep run **by itself**
does not produce a large level. Round reached is **not** rewarded.

**playoff_elevation** — `playoff rate impact − regular-season rate impact`, using
the identical rate formula for both. Gains are rewarded in full; a **decline from
an extreme regular-season baseline is damped (×0.35)** and bounded (≤ +14, ≥ −6),
and shrunk toward 0 on small samples. Elevation **supplements** absolute level;
it never replaces it. A historic regular season with a modest playoff dip does
**not** collapse; a player who is clearly better in the playoffs (e.g. a Jokić
who elevates) gains meaningful value even without a title.

**sustained_elite_volume** — elite per-minute quality **sustained over real
playoff minutes** (a proxy for surviving multiple series), scaled by **best-player
responsibility**. Responsibility is derived purely from the **playoff usage
burden** (floor `0.55`, cap `1.12`): a primary creator carrying a deep run earns
full credit; a low-usage role player earns little even with a ring. It requires
quality **and** minutes **and** responsibility, is floored at 0, and is never an
automatic reward for the team advancing. Finals MVP and clear-best-player status
only **validate** that these metrics found the right player — their points are
never duplicated here.

**Reliability & no-double-counting.** Availability is counted **once**, through a
minutes-reliability factor `clip(po_mp/450, 0, 1)` that shrinks the rate-quality
terms toward 0 on small/injury samples; missed games are never penalized twice.
**No playoffs (or zero playoff minutes) = exactly 0.** Championships, round
reached, and Finals MVP do **not** enter here (they live in Team Achievement and
Recognition respectively).

---

## 7. Team Achievement (3%)

Zero baseline. Positive value begins **only after winning a playoff series**,
then increases progressively, scaled by the player's role on the team:

| Result | Base × role multiplier |
|---|---|
| First-round exit / no playoffs | **0** |
| Won ≥1 series (no Conf Finals) | 30 × 0.85 |
| Conference Finals | 62 × 0.8 |
| Finals | 80 × 0.8 |
| Champion — role player | 100 × 0.55 |
| Champion — co-best player | 100 × 0.85 |
| Champion — best player | 100 × 1.00 |

`playoff_round_score` encodes rounds *reached*, not won, so a first-round **loss**
(score 30, zero series won) correctly scores 0. With only a 3% weight (≤3.0 index
points) a title can never offset a large individual gap. **Championships appear
only here.**

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
  Postseason level + elevation + sustained-volume — now a major 18% slice.
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
