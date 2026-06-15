# Methodology

How `peak3` builds, enriches, and scores NBA 3-year peaks. Everything is
deterministic and reproducible from cached Basketball Reference data; nothing
objective is invented.

> **AUTHORITATIVE SCORE:** the season score executed by the code is the
> **Five-Component Open Weighted Index** documented in the final section,
> [OFFICIAL SCORE — Five-Component Open Weighted Index](#official-score--five-component-open-weighted-index-current-model):
> `prime_raw = 0.38·Statistical Impact + 0.21·Traditional Production +
> 0.20·Individual Recognition + 0.18·Postseason Individual Value +
> 0.03·Team Achievement` (+ ±0.5 teammate adjustment), with
> `prime_score = calibrate(prime_raw)` a separate monotonic display relabel.
> It is **not** percentile-based; era-relative percentiles/z-scores are computed
> only for role labels and descriptive display, never inside the index.
> Sections 4 and 4c-* below describe **SUPERSEDED** earlier iterations
> (percentile / pathway / native-value / Statistical+Legacy) and are retained
> for development history only — where they conflict with the OFFICIAL section,
> the OFFICIAL section governs.

## 1. Source hierarchy

Values are resolved in this precedence order (highest first):

1. **Manual override** — non-null values in `data/manual_context.csv`,
   `data/external_impact.csv`, `data/stat_titles.csv`. Never overwritten
   silently; differences vs the automatic value are printed.
2. **High-confidence structured data** — parsed Basketball Reference playoff
   brackets, team-rating tables, and the per-player Awards column.
3. **Deterministic estimate** — quantities derived from the structured data
   (opponent quality, series success, teammate strength, title-team role).
4. **Neutral fallback** — only when nothing better exists, clearly flagged as
   *missing* in coverage and lowering confidence.

LLM interpretation is **not** used for any objective field.

## 2. Core population vs context candidates

The **core statistical population** is every qualifying player-season (≈11,400
seasons / ≈2,000 players). Every core player gets single-season and 3-year
statistical scores, basic legacy scoring, and a full report — whether or not
they are a context candidate. The **context-candidate pool** is the subset that
receives the deep enrichment layer (postseason round, championship, Finals MVP,
opponent quality, series success, teammate strength, title role, stat titles,
provenance/confidence). `context_status` is one of `FULL / PARTIAL / CORE_ONLY /
NOT_AVAILABLE` and is never set to FULL just because neutral defaults were
filled in.

### Tiered candidate selection (`nba_peak/candidates.py`)

Selection is **tiered**, and a count cutoff can never drop a mandatory player:

```
Tier 1  Mandatory: >=1 All-NBA selection (First/Second/Third), MVP win or
        any MVP top-5, DPOY win or 2x DPOY top-5, 2x All-Defense First Team.
Tier 2  Discretionary: top --stat-candidate-count (default 100) by
        WORKLOAD-ADJUSTED preliminary statistical peak (must have >=1
        full-workload season).
Tier 3  Defensive / context safeguards (All-Defense, DPOY top-5, multi-season
        defensive anchors) so defense-first stars are never lost.
Tier 4  User-added (data/user_candidates.csv via --add-candidate).
```

`--stat-candidate-count` limits **only Tier 2**. Every All-NBA player since
1979-80 is mandatory (≈175 players); the final pool is ≈300. Outputs:
`data/generated/candidates.csv` (full tier/qualification columns) and
`candidate_exclusions.csv` (notable non-selected players with role, max
minutes/usage/VORP and exclusion reasons). The context build itself is
league-wide, so enrichment is available to any player; the candidate list drives
audits and the mandatory-coverage guarantee.

## 3. Context derivations

One playoff page + one per-game page per season enriches every player in that
season at once (`nba_peak/context_build.py`, season-checkpointed).

### Postseason rounds & titles (`context/postseason.py`)
The `/playoffs/NBA_{year}.html` bracket is parsed into series
`(round, winner, loser, W-L)`. Round labels are normalized across eras
(Eastern/Western prefixes and old division formats collapse to First Round /
Conference Semifinals / Conference Finals / Finals). For each team:

- deepest round reached (a team that *won* a series reaches one round deeper);
- `championship` = Finals winner, `finals_appearance`, `conf_finals`;
- round → 0-100: missed 10, R1 30, CSF 50, CF 70, Finals loss 85, Champion 100.

Players are joined to postseason context by their **playoff team**, so traded
players get the team they actually played for in the postseason.

### Finals MVP (`context/postseason.parse_finals_mvp`)
Parsed from the same page (objective, one per season since the award existed).

### Opponent quality & path difficulty
For each team, opponents come from its series. Opponent strength is a
series-weighted blend of opponent regular-season **SRS (0.45) / Net (0.25) /
Win% (0.18) / Defense (0.12)** percentiles, with a small later-round bonus.
Path difficulty scales average opponent strength by rounds survived and adds a
bonus per elite (top-quintile) opponent beaten. Both are season-relative.

### Series success
`0.45 round-reached + 0.25 series-win% + 0.15 upset/elite value + 0.15
championship/Finals result`. Distinct from the raw round score; raw components
(`series_wins/losses`, `elite_opponents_beaten`, `upsets`) are retained.

### Awards (`context/awards.py`)
MVP/DPOY rank, All-NBA team (1/2/3), All-Defense team (1/2), All-Star — parsed
from the Awards column. Vote *shares* are not in that column, so ordinal ranks
are used (clearly labelled); `*_vote_share` fields exist for future override.

### Statistical titles (`context/stat_titles.py`)
Per-game leaders (PTS/AST/TRB/STL/BLK) among players meeting a games threshold
(~58% of team games, scaled for shortened seasons). **50-40-90** requires
FG≥.500, 3P≥.400, FT≥.900 *and* realistic minimum makes (300 FGM / 55 3PM /
125 FTM, scaled), so tiny-sample seasons never qualify.

### Teammate strength (`context/teammates.py`)
Supporting-cast strength from teammates' same-season VORP/WS (the candidate is
always excluded; team wins are **not** used to avoid double-counting with team
context). Converted to a season-relative percentile, then to a **modest
adjustment capped at ±5** season-score points: weak cast → small bonus, stacked
cast → small penalty. Applied to the **legacy** score only (statistical peak
stays pure on-court). Traded players (TOT) get a neutral, low-confidence value.

### Title-team role (`context/title_role.py`)
For champion rosters only, a transparent title-run composite ranks players by
regular + playoff BPM, playoff minutes, playoff scoring, Finals MVP, and
MVP/All-NBA recognition. If the top two are within a z-gap of 0.6 they are
classified **co-best** rather than forcing certainty. Classes: Clear best /
Co-best / Secondary star / Role player / Did not play meaningful minutes.

## 3b. Prime Score architecture (SUPERSEDED iteration — see OFFICIAL SCORE section for the executed model)

The official score is the **Prime Score**, built from transparent diagnostic
scores that are kept strictly separate:

```
Regular-Season Performance  individual regular-season play only (no awards/playoffs/team)
Postseason Performance      individual postseason per-minute play (reliability-shrunk)
Postseason Availability     share of the team's playoff games available (injuries)
Performance-Only = calibrate(0.76 Regular + 0.20 Postseason-individual + 0.04 Availability)
Individual Recognition      MVP/All-NBA/DPOY/All-Def/Finals MVP/statistical titles/50-40-90
                            + unanimous-MVP bonus.  Championships are NOT here.
Team Achievement            championship/Finals/Conf-Finals/round, scaled by title role
Prime Score = calibrate(Performance-Only_raw + recognition_bonus(≤+18) + team_bonus(≤+5)
                        + teammate_adj(±0.5))
```

Individual performance + individual recognition dominate; team achievement is a
small capped bonus (≤+5) so a championship cannot manufacture an elite peak, and
a strong supporting cast (teammate adj ±0.5) never materially lowers a dominant
player. An **injury-limited postseason** reduces *availability* credit and is
reliability-shrunk — it is not read as "played badly" — so it cannot erase a
historically superior regular season.

This resolves the Curry 2014-15 vs 2015-16 inversion: the championship no longer
sits inside individual recognition, and 2015-16's unanimous MVP + scoring title +
steals title + 50-40-90 now correctly out-recognize a plain MVP season, so
**Prime ranks 2015-16 above 2014-15**. Performance-Only may still favor 2014-15
(its healthy postseason genuinely exceeded the injured 2016 run) — a legitimate,
reported compensating factor surfaced by `--audit-career-order` and
`--compare-seasons`.

`--years N` (1–10) evaluates every consecutive N-season window with
rank-weighted means (best season weighted most, with a documented minimum-weight
floor so weak seasons stay relevant). `--player NAME` prints the full
season-by-season career table with all seven scores.

## 4. Scoring formula (SUPERSEDED — historical percentile/pathway model; see OFFICIAL SCORE section)

All stats are normalized **within season** (era-relative percentiles among
qualifiers; ≥1000 regular-season minutes scaled for short seasons, ≥100 playoff
minutes with a small-sample penalty). The **regular-season** score is built
from seven components specifically so that a hyper-efficient role player cannot
score like a star:

```
Regular = 0.24 Impact            (0.5 Rate impact + 0.5 Total impact)
        + 0.22 Scoring dominance (0.45 volume + 0.35 rel-efficiency + 0.20 volume×eff)
        + 0.10 Playmaking
        + 0.07 Rebounding
        + 0.11 Defense           (DBPM-led; blocks not double-counted)
        + 0.18 Role/workload     (minutes, MPG, games, usage, creation burden)
        + 0.08 Context           (team SRS/Net/Wins)
```

Key design decisions (root-cause fixes):

- **Rate vs Total impact are separated.** Rate impact = the correlated
  per-minute trio BPM/WS48/PER in **one** component (bounded combined weight, not
  three independent full weights). Total impact = cumulative value (VORP, total
  Win Shares, minutes). A bench player with elite per-minute rates but low total
  value no longer rides BPM/WS48/PER to a star score.
- **Role/workload is a real component (0.18).** It rewards minutes, MPG, games
  played, usage and creation burden, so part-time players are placed correctly.
- **Scoring dominance multiplies volume × efficiency.** Volume is a *total
  scoring-load* percentile (per-100 × minutes ∝ total points), so elite
  efficiency at low volume is NOT treated like elite efficiency at high volume.
  The interaction term `clip(volume_z) × clip(rel_TS_z)` rewards keeping elite
  efficiency at elite volume and penalizes high volume + poor efficiency.
- **Defense is DBPM-led and does not double-count blocks** (the old `stocks`
  term that re-counted blocks was removed), so shot-blocking bigs aren't
  over-credited.

```
Playoff  = 0.35 Impact + 0.25 Box + 0.20 Efficiency + 0.10 SeriesSuccess + 0.10 OpponentQuality
Accolade = 0.34 MVP + 0.18 FinalsMVP + 0.16 AllNBA + 0.12 AllD/DPOY + 0.12 Championship + 0.08 StatTitles

Statistical = 0.55 Regular + 0.30 Playoff + 0.10 Team + 0.05 Durability   (NO awards)
Legacy      = 0.45 Regular + 0.25 Playoff + 0.15 Accolade + 0.10 Team + 0.05 Durability
              + teammate_adjustment  (capped ±5)

3-year window = 0.40 best + 0.35 second + 0.25 third   (--window-weighting weighted, default)
              = mean of the three seasons                (--window-weighting equal)
```

The **statistical** score never includes awards. Rate impact blends 75%
historical with 25% modern (EPM/LEBRON/RAPTOR/DARKO/RAPM) **only when** supplied;
absence is never penalized. Weighted-available scoring renormalizes over
*present* metrics so a genuinely missing field never acts as a real
50th-percentile value — but it is **not** used to erase observed negatives (a
real low percentile, or an observed-zero accolade, stays low).

### 4a. Role classification & workload policy

Every season is classified (Primary offensive engine / Primary scorer / Primary
playmaker / Two-way engine / Defensive anchor / Secondary star / High-impact
role player / Low-minute specialist) from usage, scoring volume, playmaking,
defense and workload percentiles — **awards are not inputs**. "Primary" roles
require genuine starter workload. A full-workload season is ≥1800 minutes
(scaled), ≥28 MPG and ≥60% of team games (`workload_qualified`).
`--workload-policy {default,strict,permissive}` tunes this; `role_workload`
already encodes the gradient so injured superstars aren't auto-excluded and role
players can't exploit a low bar.

### 4b. Provisional / incomplete seasons

A season whose league-wide max games is <90% of the schedule is `provisional`
(e.g. an in-progress 2025-26). Provisional seasons are shown and labelled but do
not set official peaks unless `--include-provisional` is passed; durability uses
games actually played.

### 4c-pathways. Multi-pathway value model (SUPERSEDED — replaced by the Five-Component Open Weighted Index)

A peak can be elite through **different combinations** of value, so the model
does **not** average every skill. The regular value index is:

```
regular = 50 + 0.42·(universal_impact − 50)   # advanced impact anchors all archetypes
            + specialty_value                  # strongest pathway + partial others
            + versatility_bonus                # cross-position rarity (capped ≤4)
            + 0.08·(workload − 50)             # small; mainly governs total value
```

`specialty_value`: each skill is a **pathway** (scoring / playmaking / defense /
rebounding); a player's pathways are sorted best→worst and weighted
`[0.46, 0.22, 0.11, 0.05]`, so the **strongest pathway counts fully** and weaker
ones add diminishing partial value. Weak (off-role) pathways get a **0.30 damped
downside** — a rebounding/defense anchor's low scoring, or a guard's low blocks,
contributes ≈0 rather than a large penalty. This lets one-dimensional specialists
reach elite value without being well-rounded (Rodman through rebounding+defense,
Rondo through playmaking) while **two dominant skills still outrank six moderate
ones**. `versatility_bonus` adds small capped credit when a player supplies
**multiple genuinely elite pathways** — i.e. cross-position value such as a
center who also plays elite (Jokić) or a guard who also rebounds (Westbrook) —
from production above expectation, never a named-player bonus. Universal advanced
impact (rate+total consensus) remains the **anchor** so archetypes are
comparable. Validated: the historic-apex cohort lands at **median rank #16 (top
0.40%)**; elite specialists Rodman/Rondo reach the **top ~4%**; no non-All-NBA
season cracks the top 50. `--audit-score` prints the primary/secondary pathway,
specialty and versatility contributions.

### 4c-additive. Additive value model (prior step, now within the pathway model)

The regular-season score is **additive value above a baseline**, not an average
of bounded 0-100 category grades:

```
Regular Value Index = 50 + Σ_c  weight_c · value_c
  value_c = (component_c − 50)                       for PRIMARY categories
            (impact 0.40, scoring 0.27, defense 0.15, workload 0.06)
  value_c = (component_c − 50) if ≥0 else 0.35·(…)   for SECONDARY categories
            (playmaking 0.08, rebounding 0.04 — damped downside)
```

This fixes the "report-card average" defect: a center's ordinary playmaking or a
guard's ordinary rebounding now contributes ≈0 instead of dragging a
historically great primary profile toward mediocrity (Robinson 1994-95 rose
because his elite impact/defense are no longer averaged down by low assists;
Curry's scoring isn't diluted by low rebounds). **Advanced impact is central
(0.40)** and workload is a small term (it mainly governs total value/reliability,
not a large standalone category). Native landmark functions now have **monotonic
non-flat tails** (log beyond the top landmark) so BPM 12/15/18 and VORP 9/12/14
separate. The index is **open** (no mid-computation clip to 100); an uncalibrated
**Prime Index** (research scale, e.g. Jordan '91 = 103.8) ranks ties and a
monotonic display calibration maps to 0-100 only at presentation. Validated: the
historic-apex cohort lands at **median rank #17, all in the top 0.48%** of
~11,400 player-seasons, with no non-All-NBA season in the top 50 — purely from
the statistics. See `results/pre_redesign_formula_diagnosis.*`.

### 4c-native. Native-value-first scoring (metric functions)

Each major metric is scored from its **native basketball units** through a
documented landmark function (`NATIVE_LANDMARKS`), blended **80% native / 20%**
with a small within-season era-context term. Examples of landmarks: BPM
`0→48, +6→76, +9→88, +12→96`; WS/48 `.150→60, .200→74, .250→86, .300→95`; PER
`15→46, 25→83, 30→93`; VORP `1→55, 5→80, 9→97`; relative-TS `+4→62, +8→80,
+12→96`. The native value carries the basketball meaning; the era term only
adjusts for league pace/inflation, so a changing league SD never redefines what
"+9 BPM" means. Distributional/role metrics without clean landmarks fall back to
the era term. The era term uses a **soft tail** (`soft_z_to_score`): linear core
with a diminishing `log1p` tail and only an emergency ±8 SD guard — so a z=5.3
season is *not* identical to z=4.5 (the old hard ±4.5 clip is gone). Percentiles
are computed into separate `{metric}_percentile` columns for description only and
never enter the score. Team context is **removed** from Regular-Season
Performance. Apex separation is preserved two ways: the calibration curve keeps a
rising slope at the top (raw 96→98, 104→99.5, no flattening), and an uncalibrated
**Prime Index / Perf Index** (research scale) is reported and used to break
ranking ties. `--audit-raw-model` shows raw → mean/SD → z → transform per metric.
Validated: the historic-apex cohort (Jordan '88, LeBron '13, Jokić '23, Hakeem
'94, Curry '16, Shaq '00, Robinson '95, Giannis '20, KG '04 …) lands in the top
~0.5% of all player-seasons **from the statistics alone** — no legend bonus.
(Implementation note: official native scores are still stored in legacy `_pct`
columns to avoid a risky mass rename; despite the name they are native-value
scores — see `results/scoring_dependency_audit.*`.)

### 4c. Prior approach (superseded): raw / era-adjusted z-score — NO percentiles

The official formula does **not** use percentiles. Each metric is normalized to
its **within-season, qualifier-pool z-score** (raw value minus league mean over
league SD) and mapped through a continuous, magnitude-preserving transform
`z_to_score` (piecewise-linear with a mild convex elite tail, capped at ±4.5 SD):
`z=2→72, z=3→84, z=3.5→89, z=4→94, z=4.5→100`. This preserves the *magnitude* of
dominance — the prior percentile/hybrid scheme capped every z≥3 season near 100,
collapsing "elite" and "historically extreme" together (the Curry 2014-15 vs
2015-16 inversion). A +60%-larger VORP (a higher z) now yields a materially
higher score. `--audit-raw-model --player NAME` prints, per metric: raw value,
league mean/SD, raw difference, ratio, z-score, cap, and transformed score.
Percentiles remain available (`NORMALIZATION_MODE="percentile"`) for descriptive
audits only. The calibration curve anchors are fitted to the z-score raw
distribution and validated against award tiers (95+ = 100% All-NBA, 85-90 = 100%,
75-80 ≈ 89%, role/specialist 60-68), not by forcing named players into ranges.

The raw weighted score (`stat_raw`/`legacy_raw`) is then passed through a
**monotonic calibration curve** (`calibrate_score`, transparent piecewise-linear
anchors) that stretches the elite tail and compresses the crowded middle so the
bands mean something. Illustrative bands (validated against award tiers):

```
90-100  inner-circle/apex      100% All-NBA
80-90   MVP / elite            ~98% All-NBA
76-80   All-NBA peak           ~94% All-NBA
70-76   All-Star peak          ~85% All-NBA
60-70   strong starter/spec.   ~40% All-NBA   <- efficient role specialists land here
 0-60   role / rotation        ~2%  All-NBA
```

Two further root-cause fixes keep team success from rescuing role players:
`stat_total` weights team context at only 0.05 and an individual-dominated
playoff (series-success + opponent-quality are just 0.14 of the playoff score),
and the **teammate adjustment is capped at ±1.0** season point (descriptive, not
a quality penalty) so a strong cast never materially lowers a dominant player.
`legacy_total` = the statistical backbone + a **capped (≤+12) accolade bonus**
(awards/championship), so awards never rescue a mediocre season into an elite one.

### 4d. Official 250-player study population

`--build-final-250` writes `data/generated/final_250_candidates.csv`: every
verified All-NBA player since 1979-80 (**mandatory**, 175 players) plus the
strongest non-All-NBA **exception** candidates (ranked by an individual-impact
rubric: DPOY/All-Defense/All-Star, elite stat/playoff/defense peaks, sustained
value) to reach 250. Exception slots are filled by legitimate defensive
specialists (Cheeks, Cooper, Eaton, Camby, Bobby Jones, Bruce Bowen, Jrue
Holiday, …), never by high-rate low-burden role players. Official rankings
default to this population; `--include-all-core-players` runs diagnostics over
the full ~2,000-player core.

## 5. Window decomposition

The legacy window score decomposes **additively** into named buckets — Regular,
Playoff core, Opponent quality, Accolades, Championship/Finals MVP, Team,
Durability, Teammate adjustment — that sum exactly to the window score. The
report prints the per-bucket *difference* between the winning window and the
next-best (and the statistical-peak window), so you can see precisely why one
window beats another.

## 6. Confidence & coverage

Each context row carries `context_confidence` and `context_warning_count`.
Objective bracket/award facts are high-confidence (~0.93–0.97); derived
quantities (opponent quality, teammates, title role) are 0.78–0.85; traded /
missing fall lower. The single-player report shows **Observed / Estimated /
Missing** coverage for the peak window so estimates are never mistaken for
observed facts. Field-level provenance (source, method, confidence, date) is in
`data/generated/provenance.csv`.

## 7. Sensitivity analysis

`--sensitivity` re-evaluates the player's windows under 8 plausible formula
variants (regular-/playoff-/accolade-focused, equal weighting, no teammate
adjustment, balanced, historical-core-only) and reports how many variants each
window wins, plus score ranges. This prevents one arbitrary weight set from
being presented as absolute truth.

## 8. Validation (`nba_peak/audit.py`)

`--audit-context` checks: every champion has finals_appearance and conf_finals;
Finals MVP implies a postseason; finals_appearance implies conf_finals; missed
playoffs ⇒ round score 10; title role only for champions. It also reports field
coverage, confidence distribution, stat/legacy disagreements, and (vs the saved
pre-enrichment baseline) which candidates' best windows changed and by how much.
Output: `results/context_audit.{json,txt}`.

## 9. Known limitations

- **Award vote shares** are not in the Awards column; ordinal ranks are used.
  Drop a CSV with `mvp_vote_share`/`dpoy_vote_share` to refine.
- **Modern impact metrics** (EPM/LEBRON/RAPTOR/DARKO/RAPM) are not available in
  a single scrapable public table, so they come from `data/external_impact.csv`
  if provided. Absence never penalizes a player.
- **Seeds** are not parsed; opponent quality uses SRS/Net/Win%/Defense instead,
  which captures opponent strength without needing the seed.
- Pre-shot-clock and ABA data are intentionally out of scope (start 1979-80).
- 2025-26 is included where Basketball Reference has published it; incomplete
  pages are skipped with a warning.

---

## OFFICIAL SCORE — Five-Component Open Weighted Index (current model)

The single-season **Prime** score replaces all prior pathway/percentile/landmark
designs. It is an **open weighted index built from raw-value contributions**:

```
prime_index = 0.38 * STATISTICAL_IMPACT
            + 0.21 * TRADITIONAL_PRODUCTION
            + 0.20 * INDIVIDUAL_RECOGNITION
            + 0.18 * POSTSEASON_INDIVIDUAL_VALUE
            + 0.03 * TEAM_ACHIEVEMENT
            + teammate_adjustment            (±0.5, descriptive)
prime_score = calibrate(prime_index)         # monotonic relabel only
performance_only = calibrate(0.38*SI + 0.21*TP + 0.18*PO)   # no awards/team
```

Every component is computed from **raw** basketball metrics through
metric-specific **continuous** formulas. No percentiles, universal z-scores,
generic 0–100 grades, landmark tables or 100-caps enter the score. The index is
open (uncapped); `prime_index`/`perf_index` preserve the raw value so apex
separation is never lost. Two continuous primitives:
- `_impact_value(x, x0, per, knee)` — plus/minus metric → points: `per` pts per
  unit above replacement `x0`, smooth never-flat log tail above `knee`
  (sub-replacement goes negative). Open above 100.
- `_hinge_value(x, thr, per, knee)` — production metric → points: ~0 below `thr`
  (average/off-role contributes nothing, never negative), then linear + log tail.

**1. Statistical impact (38%)** — `_masked_wavg` of raw-value sub-scores with
weights 15/10/8/5/7 (relative): BPM/OBPM/DBPM consensus, VORP + total WS, WS/48,
PER, and a modern EPM/LEBRON/RAPM consensus. Modern is a bounded supplement;
when absent the weight renormalizes over the classic metrics, so older seasons
are never penalized.

**2. Traditional production (21%)** — weights 10/5/4/3/3 (relative):
- *Scoring value* combines volume and efficiency **nonlinearly**:
  `hinge(PTS/100) * minutes_load_mult * efficiency_mult + usage_burden − inefficient_high_volume_penalty` (uses PTS/100, usage, sustained minutes/total points, rTS, TS+).
- *Efficiency* (rTS/TS+), *playmaking* (AST/100, AST%), *rebounding* (TRB/100,
  TRB%), *defensive box* (stocks/100, DBPM) are hinges — each only adds when
  strong, so a center's ordinary assists or a guard's ordinary boards score ~0,
  while elite cross-position production still adds through the raw stats.
- Penalties: inefficient high-volume scoring, excessive turnovers, poor
  availability (single-counted).

**3. Individual recognition (20%)** — additive grouped award values
(`recognition_row`): MVP rank + vote share (+ unanimous-MVP record), All-NBA
(discounted when grouped with a top-3 MVP), All-Star (subsumed by All-NBA),
DPOY rank + share grouped with All-Defense, Finals MVP, scoring/assist/rebound/
steal/block titles and 50-40-90. **No championship/team result** appears here.

**4. Postseason individual value (18%)** — a zero-baseline additive value built
from four individual parts so it captures playoff greatness without rewarding
team advancement:

```
postseason_individual_value = absolute_playoff_level   (reliability-adjusted)
                            + playoff_elevation        (sample-adjusted)
                            + sustained_elite_volume
                            + dominance_bonus          (diminishing, reliability-shrunk)
```

**Playoff-sample reliability governs the whole upper tail.** A single confidence
signal `sample_reliab ∈ [0, 1]` is built from how *much* playoff basketball the
rate stats were measured over — total **minutes**, total **games**, and the number
of **series/rounds** reached (`0.40·min/850 + 0.35·games/19 + 0.25·series/4`).
Series count is used **only** as a sample-size signal (how many rounds the rates
survived), **never** as points for advancement; when games/series are unobserved
the blend falls back to the minutes signal. This is what stops an extreme rate
stat over a *short* run from overpowering a complete Finals-length run.

* **absolute_playoff_level** — raw playoff quality across all skills (BPM/OBPM/
  DBPM + WS48 + PER *rate*, scoring volume, efficiency, playmaking, rebounding,
  box defense, minutes), opponent-quality adjusted, centered on a replacement
  baseline (`PO_BASELINE = 25`). This term is **linear in level** (the convex
  bonus lives in its own term, so an extreme level is not rewarded twice) and is
  then **shrunk by `sample_reliab`** → the *reliability-adjusted level*. Poor play
  is a small bounded penalty (rate-quality downside floored once at
  `−PO_PENALTY_CAP = −14`).
* **playoff_elevation** — `playoff rate impact − regular-season rate impact`
  (same `_rate_impact_value` for both). Gains are rewarded in full; a decline
  from an extreme regular-season baseline is **damped** (`×0.35`) and bounded, so
  a great regular season is not punished. Elevation **supplements** absolute
  level, never replaces it, and is **shrunk by the same `sample_reliab`** so
  improvement measured over a short run is not over-trusted (LeBron 2008-09 still
  earns major elevation credit; it is just no longer open-ended).
* **sustained_elite_volume** — elite per-minute quality (`level_full` above a
  threshold) **accumulated over real playoff minutes *and* games**
  (`0.5·min/950 + 0.5·games/21`, uncapped below a Finals-length run), scaled by
  **best-player responsibility** from the playoff **usage burden**
  (`PO_RESP_FLOOR = 0.55` → `PO_RESP_CAP = 1.12`). At equal rates, elite play
  sustained through *more* rounds earns more than a shorter run — the extra value
  comes from sustaining elite play, **never** from merely reaching a round.
  Floored at 0; requires quality *and* volume *and* responsibility.
* **dominance_bonus** — the exceptional residual of the level above an elite knee
  (`PO_DOMINANCE_KNEE = 50`), through a **saturating square-root curve**
  (`PO_DOMINANCE_SCALE · √(level−50)`) that **replaces** the old open-ended
  `+0.30 per point` linear booster. By construction level 50 earns 0, 60 is
  meaningful, 75 larger, 90 exceptional, and the curve flattens so it never
  explodes at the top. It is then **shrunk by `sample_reliab` with an extra
  series gate**, so a short Conference-Finals run with extreme rates earns only a
  *partial* historical-dominance bonus; the full bonus is reserved for elite play
  sustained through the deepest runs.

The four terms read **different signals** — absolute level (how good), elevation
(improvement vs the player's own regular season), sustained volume (how *much*
elite play), dominance (only the exceptional top, reliability-gated) — so the same
extreme BPM/PER/WS48 is not rewarded multiple times. No playoffs / no playoff
minutes contributes exactly 0; availability is counted **once**. Championships,
round reached and **Finals MVP** do **not** enter here (Team Achievement /
Individual Recognition respectively); Finals MVP / clear-best-player status only
**validate** the metric and add no points.

Net effect of the correction: a short run with extreme rates (e.g. **LeBron
2008-09**, a 14-game Conference-Finals run) no longer dwarfs complete
championship seasons — its postseason value falls from ~106 to ~75 and the
single-season Prime crown passes to a complete Finals-length run (Jordan
1990-91), while genuinely complete elite runs (Hakeem 1994, Kawhi 2019, Jokić
2023, Dirk 2011, Shaq 2000) keep or gain value.

**5. Team achievement (3%)** — **zero baseline**; positive value begins only
**after winning a playoff series**, then increases progressively through
**Conference Finals → Finals → championship**, × role multiplier
(`team_achievement_row`). `playoff_round_score` encodes rounds *reached*, so a
first-round **loss** (score 30, zero series won) and no playoffs (10/missing)
both contribute **0**; a series win requires `playoff_round_score ≥ 50`. Small by
design: with a 3% weight (≤3.0 index points) a title cannot materially offset a
major individual gap.

Calibration anchors (`CALIBRATION_ANCHORS_RAW/CAL`) map the open index into
historical bands and are the only post-hoc step (order-preserving). Validation
examples (Jordan, LeBron, Curry, Jokić, Robinson, Olajuwon, Shaq, Garnett,
Giannis) are **never score inputs**; they emerge near the top naturally.
Trace any season with `--audit-score --player P --season S --trace-formula` or
`--compare-seasons P S1 S2 --trace-formula`.
