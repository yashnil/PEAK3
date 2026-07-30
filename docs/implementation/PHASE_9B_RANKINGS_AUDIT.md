# Phase 9B — Rankings & model audit

Status: **partially remediated.** One display/serving bug fixed and guarded; one
candidate-universe bug diagnosed, reproduced, and deliberately deferred. No
change was made to the scoring formula.

Every number below was read directly from `cache/processed/scored_1980_2026.parquet`
(11,429 scored seasons, 2,016 identities) and the committed JSON/CSV artifacts.
Where this document says "defensible", that means *the arithmetic follows the
documented weight vector* — **not** that the weight vector is the right one. See
[What this audit does NOT claim](#what-this-audit-does-not-claim).

---

## 1. Summary

| # | Reported symptom | Verdict | Class | State |
|---|---|---|---|---|
| 1 | Kobe 2007-08 ranks above 2005-06 | Defensible | explainability-only | Explained in UI |
| 2 | Embiid 2022-23 ≈ Dwight 2008-09 | Defensible (0.03 pts apart) | explainability-only | Explained in UI |
| 3 | Hakeem 1993-94 > Robinson 1994-95 | Defensible, intentional | explainability-only | Explained in UI |
| 4 | Jaylen Brown ≈ Deandre Ayton | Defensible (0.02 pts apart) | explainability-only | Explained in UI |
| 5 | Gary Payton II above real starters | **Real** — role-player inflation | formula (structural) + display-list | Display **fixed**; formula **deferred** |
| 6 | Luka Garza in the rankings at all | **Real** — two independent bugs | inclusion-filter + display-list | Serving gate **fixed**; universe **deferred** |

Cases 1–4 all resolve by the *same* mechanism — postseason (0.18) plus
recognition (0.20) plus team achievement (0.03) outweighing a regular-season
edge. That is why the fix for them is the explainability modal, not a formula
change: the numbers are internally consistent, the reasoning was simply
invisible.

---

## 2. FIXED — the served-rankings minutes gate

**Responsible file:** `scripts/build_top_peaks.py`

**Root cause.** The generator built its universe from *every* identity in the
scored parquet:

```python
universe = pd.DataFrame({"player": sorted(scored["player"].unique())})   # 2,016 identities
```

and the only minutes gate anywhere upstream was
`peak3.regular_minutes_threshold` — 1000 minutes over 82 games, i.e. **~12.2
MPG**. Observed floor in the parquet: **12.24 MPG**.

The generator reuses `nba_peak.leaderboards.build_leaderboard()`, whose own
docstring declares its contract as *"player universe →
`data/generated/final_250_candidates.csv` … the scored dataset is already
minutes-qualified."* Substituting a different universe silently voided that
contract; the phrase "already minutes-qualified" was carrying all the weight,
and the only qualification that existed was the 12.2 MPG floor.

**Measured impact on the list users saw** (`/api/v1/peaks?window=1y`, 1000 rows):

| Bucket | Rows | Share | Median rank |
|---|---|---|---|
| < 20 MPG | 106 | 10.6 % | 714 |
| 20–25 MPG | 163 | 16.3 % | 702 |
| 25–30 MPG | 224 | 22.4 % | 617 |
| 30+ MPG | 507 | 50.7 % | 317 |

**269 of 1000 served rows (26.9 %) were sub-25-MPG seasons.** 57 rows belonged
to neither the canonical 250 pool nor the 1510-identity manifest.

**Fix.** Added `MIN_SERVED_ANCHOR_MPG = 25.0` — a serving filter applied to the
window's **anchor season**, *after* the board is built:

- Post-filtering (not pre-filtering rows) keeps the consecutive-season windowing
  that `n_year_windows` depends on for the 3Y/5Y boards **byte-identical**.
- Ranks are re-numbered to a dense `1..N` so there are no gaps where an excluded
  row used to sit.
- Rows now carry `anchor_season_mpg`, and each window records
  `min_anchor_season_mpg` / `excluded_low_minute_windows`, so the artifact is
  self-describing.
- 25.0 is the **documented fallback tier** of the project's own intended
  inclusion criteria (30+ MPG primary, 25+ fallback) — the most permissive gate
  consistent with the stated design, not a new editorial threshold.

**Result:** 1Y serves a full 1000 rows, 0 below 25 MPG (722 windows excluded);
3Y 893 rows; 5Y 685 rows. Garza, Gary Payton II, Daniel Gafford, Isaiah
Hartenstein, and Luke Kornet are all gone. Michael Jordan 1990-91 is still #1 at
97.53 and score ordering is unchanged.

**Why this is safe.** It touches no score. `peak3.py`, `OFFICIAL_WEIGHTS`, and
`calibrate_score()` are untouched; no stored value changed; the rows that remain
are in exactly the same order. Every excluded season is still fully scored and
still reachable everywhere else — CourtBuilder, the canonical board, the
per-season data.

**Guards added** — `apps/api/tests/test_peak_index_serving_gate.py` (11 tests).
This path previously had **zero** test coverage: nothing under `apps/api/tests/`
or `apps/web/src/tests/` referenced `/api/v1/peaks`, `get_peaks`, or
`top_1000_peaks`, and nothing anywhere asserted a minutes floor on any served
ranking. The tests assert per-row (not from the summary counter, so a
partially-regenerated file cannot pass), that the gate actually excluded
something (guards against an inert filter), that ordering and the #1 row are
unchanged, and that the official weights are intact.

---

## 3. FIXED (display only) — role-player inflation

The underlying mechanism is real and is **not** fixed. What is fixed is that it
no longer surfaces in the served rankings.

### Quantified mechanisms

**A. `statistical_impact` is ~74 % pure per-minute rate.** Its five sub-terms
(`peak3.py:1533-1562`) weight 15 BPM / 10 VORP+WS / 8 WS-48 / 5 PER / 7 modern.
`epm` and `lebron` are non-null in **0 of 11,429 rows**, so `si_modern` is always
NaN and `_masked_wavg` renormalizes over 38, not 45:

- rate share of `statistical_impact` = 28/38 = **73.7 %**
- rate share of the **total index** = 0.38 × 28/38 = **28.0 %**
- cumulative (minutes-sensitive) share of the total index = 0.38 × 10/38 = **10.0 %**

**B. `si_ws48` is the single largest lever.** `peak3.py:1544` —
`_impact_value(ws48, 0.05, 400.0)`: **400 points per unit of WS/48 above 0.05**,
linear, no shrinkage. In raw-index points:

| Player / season | MPG | WS/48 | WS-48 index points |
|---|---|---|---|
| Daniel Gafford 2024-25 | 21.5 | .232 | **5.82** |
| Luka Garza 2025-26 | 16.2 | .226 | **5.63** |
| Jaylen Brown 2025-26 | 34.4 | .135 | 2.72 |

Garza's WS/48 term alone is **2.5× Jaylen Brown's on less than half the
minutes** — a **+3.36 raw-index** swing.

**C. The only minutes term in `traditional_production` is far too flat.**
`peak3.py:1673` — `load_mult = clip(0.55 + 0.45 * mp/2300, 0.5, 1.12)`. A
1250-minute player keeps **79.5 %** of the scoring credit of a 2300-minute
player; total spread across the whole minutes range is **1.41×** against a real
minutes ratio of 2.6×.

**D. Postseason sample reliability is 60 % team-determined.** `peak3.py:1793-1799`
— `PO_REL_W_MIN = 0.40`, `PO_REL_W_G = 0.35`, `PO_REL_W_S = 0.25`. `po_series_n`
is the **team's** round reached, and games played is near-team-determined for a
rotation player. So 0.35 + 0.25 = **60 % of the reliability weight is a team
property**, not the individual's sample.

| Player / season | PO MP | PO reliability | PO contribution |
|---|---|---|---|
| Gary Payton II 2021-22 | 203 | 0.567 | **4.22** |
| Jaylen Brown 2023-24 *(Finals MVP)* | 707 | 0.933 | 0.83 |

**GPII's postseason contribution is 5.1× the actual Finals MVP's, on 29 % of the
playoff minutes.** This contradicts the module's own documented invariant
(`peak3.py:1786-1791`), which promises that *"an extreme rate stat over a SHORT
run … cannot dwarf a Finals-length elite run."* At 203 vs 707 minutes it
demonstrably does. **This is the one finding I would classify as bug-shaped
rather than a tuning preference.**

**E. A safeguard the current model does not have was documented for an earlier
one.** `METHODOLOGY.md:171-183` describes a `+ 0.18 Role/workload (minutes, MPG,
games, usage, creation burden)` component, with the explicit rationale that the
score was built *"specifically so that a hyper-efficient role player cannot score
like a star."* The current official index has no such component.
`peak3.py:2050-2053` keeps `role_workload` as a **diagnostic**, and
`workload_score` / `workload_qualified` are computed and **never read by any
scoring path**. `classify_roles()` correctly labels GPII, Garza, Gafford, Kornet,
and Hartenstein as `"Low-minute specialist"` — **the model knows exactly what
they are, the score ignores it, and (before Phase 9B) the display did too.**

> **Correction, made in Phase 10B.** An earlier revision of this document said
> METHODOLOGY.md "promises a protection the code does not have". That overstated
> it. The section in question is explicitly headed *"## 4. Scoring formula
> (SUPERSEDED — historical percentile/pathway model; see OFFICIAL SCORE
> section)"*, so the document does not actually present that component as
> current. The residual, much smaller issue is that bullets **inside** that
> superseded section are written in the present tense ("Role/workload **is** a
> real component (0.18)"), which reads as current to anyone skimming bullets
> past the heading. That is a readability nit, not a false claim.
>
> **Verified in Phase 10B:** no user-facing surface claims the safeguard.
> `data/web/methodology.json` and the methodology page contain no
> role/workload component — their only "workload" mention is
> `traditional_production`'s `short_description` ("…relative to team
> workload"), which is accurate, since TP genuinely carries a `load_mult`
> minutes term (`peak3.py:1673`). The served weights are exactly
> `OFFICIAL_WEIGHTS` (0.38 / 0.21 / 0.20 / 0.18 / 0.03, summing to 1.0) under
> the web naming convention.

### The net effect, in one line

A 21.5-MPG backup centre (Gafford, 27.30) out-indexed a 34-MPG All-NBA Second
Team wing (Jaylen Brown 2025-26, 24.91) **on the two regular-season components
alone** — no award or playoff artifact involved.

### Why the display fix was the right first move

`METHODOLOGY.md:353` states the intended band: *"60-70 strong starter/spec. ←
efficient role specialists land here."* GPII scored **55.76** and Garza
**50.55** — at or *below* the documented specialist band. The absolute numbers
are within contract. The problem is that **real starters also land in the low
50s** (Ayton 54.61, Jaylen Brown 54.64), so in a ranked list the two populations
interleave. Correcting the served universe resolved the visible defect without
touching a single scored value.

### The tidiest illustration of the whole audit

**Isaiah Hartenstein is simultaneously a hardcoded negative control in
`tests/test_validation.py::ROLE_CONTROLS`** — the model suite names him as an
example of a player who must not rank like a star — **and was being served at
rank 212, above Deandre Ayton.** The guard existed. It just wasn't wired to the
surface users actually see.

### Existing guards are weaker than they look

- `test_no_role_player_in_top_50_stat_seasons` inspects only the **top 50**.
  Gafford at 164 and GPII at 194 sail straight through.
- `test_role_players_in_calibration_band` requires the 4 hardcoded controls below
  69.03. Actual peaks: Capela 61.23, Harrell 57.00, Hartenstein 54.90, Splitter
  50.66 — **7.79 points of headroom**, so it passes comfortably while the defect
  goes undetected.

---

## 4. DEFERRED — the candidate-universe inclusion bug

**Responsible file:** `scripts/audit_player_pool_expansion.py`

The intended rule is **(15+ PPG OR award) AND (30+ MPG, fallback 25+)**. The
implemented gate at lines **222-231** and **268-271** is a flat OR-chain with MPG
as a *disjunct*:

```python
qual_mask = (
    (g["all_defense_team"].notna()) | (g["mvp_rank"].notna()) |
    (g["dpoy_rank"].notna()) | (g["all_star"] == 1) |
    (g["ppg_proxy"] >= MIN_PPG) |
    ((g["championship"] == 1) & g["_meaningful_po"]) |
    ((g["finals_appearance"] == 1) & g["_meaningful_po"]) |
    (g["mpg"] >= MIN_MPG_PRIMARY)      # <-- should be ANDed, not ORed
)
```

Measured on the committed 1510-identity manifest:

- **304 identities (20 %) have no MPG criterion at all** — the `AND 30+ MPG` gate
  is never applied.
- **55 identities qualify on minutes alone** (Alonzo Gee, Andrew Lang, Chris
  Duhon, Fred Hoiberg…). MPG-as-a-disjunct is an *admission route*, which was
  never intended.
- **`fallback_25mpg_count: 0`.** The fallback tier has never fired once, because
  the OR already admits everyone it was meant to catch. **That zero is the
  manifest's own self-reported proof of the bug.**
- **`15_ppg` is not PPG.** `MIN_PPG = 15.0` is compared against `pts_per75`
  (line 206), a per-75-possession *rate*. The manifest's own `ppq_caveat` field
  admits no real PPG column exists locally. The criterion name is misleading.

Luka Garza is the clean proof — his entire manifest entry is
`"qualifying_criteria": ["15_ppg"]` on a 16.2 MPG season with zero awards.

### Why this is deferred, not fixed

Regenerating this manifest changes the **CourtBuilder gameplay candidate pool**
(`identity_pool_status`), not just a ranking display. The blast radius includes
the spin dataset, `apps/api/tests/test_perfect_season.py:1298`,
`tests/test_audit_player_portrait_coverage.py`, and any saved run whose cards
reference a since-excluded identity. Doing it in the same pass as a spinner
rebuild and a position-label change would couple three independently risky
changes with no way to attribute a regression.

### Recommended next pass

1. Fix the gate to `(award | ppg_15) & (mpg_30 | mpg_25_fallback)` and drop bare
   `mpg >= 30` as a standalone admission route.
2. Rename `15_ppg` → `15_pts_per75`.
3. Regenerate. **Treat a still-zero `fallback_25mpg_count` as proof the fix did
   not take.** Expect the pool to shrink well below 1510.
4. Add: every identity has ≥ 1 MPG criterion; `fallback_25mpg_count > 0`.
5. Diff the CourtBuilder candidate pool before/after and confirm no saved run
   breaks.

---

## 5. Documentation / code mismatches (TODO, all comment-only)

None of these change behavior; all of them actively mislead a future reader.

| Location | Says | Actually |
|---|---|---|
| `peak3.py:1461-1465` | TP 23 %, Recognition 15 %, Postseason 12 % | **21 / 20 / 18** |
| `peak3.py:2029-2030` | `# 43% component` (si), `# 23% component` (tp) | **38 % / 21 %** |
| `peak3.py:1534-1536` | "Sub-weights of the 45" | effective denominator is **38** (`si_modern` always NaN) |
| `peak3.py:1981` | — | `regular.loc[qualifier.values \| True]` is a **no-op** (`\| True` is always all-True) |
| `METHODOLOGY.md:171-183` | an 18 % Role/workload component protects against role-player inflation | **that component no longer exists**; see §3E |
| `nba_peak/leaderboards.py:11-14` | universe is `final_250_candidates.csv`, "already minutes-qualified" | `build_top_peaks.py` substitutes a 2,016-identity universe |

`METHODOLOGY.md` is the important one: it promises a protection the code does not
have, which is precisely how this class of bug goes unnoticed.

---

## 6. What this audit does NOT claim

- **It does not claim the formula is correct.** It claims cases 1–4 are
  *internally consistent with the documented weight vector*. Whether 0.18 on
  postseason is the right weight is a product question this audit did not test.
- **It does not claim role-player inflation is fixed.** Mechanisms A–E are
  unaddressed in the model. Only the served rankings were filtered.
- **It does not claim the 25 MPG floor is principled beyond precedent.** It is
  the project's own documented fallback tier, chosen for that reason.
- **It verified no scores.** No score was recomputed, and none needed to be —
  every fix is a filter or a label.

## 7. Explicitly out of scope / not attempted

- `OFFICIAL_WEIGHTS` and `calibrate_score()` — untouched, per `CLAUDE.md`.
  Calibration is a monotonic relabel and cannot reorder anything, so it is not
  implicated in any finding here.
- Any change to `po_sample_reliab` weights. Candidate minimal change: shift
  toward minutes (e.g. 0.70/0.20/0.10) or multiply `s_frac` by the player's
  share of team playoff minutes. **Deferred** — it moves scores for every
  playoff season since 1980. Guarded by `tests/test_corrections.py` (~20+
  `po_sample_reliab` assertions), `tests/test_specialist_postseason_audit.py`,
  and `tests/test_validation.py::test_defensive_pathway_preserved`. Any change
  must show the full model suite green **plus** a before/after diff of rank 1 in
  all four `leaderboards/top_250_*.csv`.
- Minutes-shrinkage on the rate terms of `statistical_impact`. Principled form:
  shrink toward the league mean by `min(1, mp/2300)` rather than reweighting.
  **Deferred**, same reason.

## 8. Recommended new guards (beyond the 11 added)

- No `role == "Low-minute specialist"` season appears in the top 250 of any
  served list.
- Every manifest identity has ≥ 1 MPG criterion.
- `fallback_25mpg_count > 0`.
- Extend `test_no_role_player_in_top_50_stat_seasons` past the top 50 — its
  current window is why this went undetected.

---

# Phase 10B addendum — rankings explainability

## What changed

**The "no useful information" complaint had a single root cause, and it was a
dropped-data bug, not a missing model.** `nba_peak.leaderboards.build_leaderboard()`
already returned every official weighted contribution
(`SI/TP/Recognition/Postseason/Team Achievement contribution`, and `Avg …` for
multi-year windows) plus `Prime raw`. `scripts/build_top_peaks.py` threw all of
them away. So `PeakRow` had no component data to serve, and the explainability
modal correctly reported "Not available for this view" for the entire breakdown.
Nothing needed to be computed — only carried through.

Now published per row, on both boards: the five contributions, `prime_index`,
and 0-100 percentiles for each contribution plus the total. Per row, behind a
`/explain` route: official `weights` (read from `peak3.OFFICIAL_WEIGHTS`, never
re-typed), `score_split`, percentile-ranked strongest/weakest components,
season stats, recognition, postseason, team context, role/minutes, caveats, and
three comparison rails.

## Percentile population — a deliberate choice worth recording

Percentiles rank each contribution **within the served board**, not against the
full 11,429-season population. Every row on these boards is already top-1000, so
a population percentile saturates near 100 and separates nothing. The population
figure is retained at `explain.component_detail[].population_percentile` for
anyone who wants it.

## Strongest / weakest are percentile-ranked, not raw

`team_achievement` is capped at a 3 % weight, so it is almost always the
numerically smallest contribution. Ranking "what held this score back" by raw
value would name it for essentially every row on the board. Ranking by percentile
instead: `team_achievement` appears in the weakest pair for 1226 of 2578 peak
rows (47.6 %) — often, but far from always. A test asserts the naive
raw-contribution ranking does *not* reproduce the published pair.

## Comparisons — one non-obvious consequence

On the **peaks** boards, `same_player` deliberately spans durations (each entry
carries its `window`). `build_leaderboard` is best-window-per-player, so within a
single duration a player has exactly one row and a same-player rail would always
be empty. Kobe's 1Y row therefore reaches his 3Y and 5Y windows.
`similar_scores` and `same_season_peers` stay within a duration.

`similar_scores` is ordered by raw `prime_index` gap while `delta` displays the
calibrated-score gap. The two are monotone but not identical — a test caught the
difference.

## Fields deliberately left null

`ppg` / `rpg` / `apg` are `null`. The parquet stores per-75 and per-100 rates
only; back-solving per-game averages from them would be fabrication. The real
rates ship alongside, and the modal renders a dash rather than a plausible-looking
number. This is the same discipline as the unscored-card handling in CourtBuilder.

## Board simplification

The rankings section went from three boards to two. "Canonical Players" asked the
same question as Peak Windows — one row per player, best window — over a narrower
universe, so a reader had to diff two boards to tell them apart. The canonical
250-pool leaderboards are **not** removed from the product: `/api/v1/leaderboards`,
the committed `leaderboards/top_250_*.csv`, and the methodology page's
documentation of them are all untouched. Only the third, overlapping *board* is
gone from this page.

## Methodology consistency — verified, not assumed

- Served weights are exactly `OFFICIAL_WEIGHTS` (0.38 / 0.21 / 0.20 / 0.18 /
  0.03, sum 1.0) under the web naming convention.
- The modal reads weights from the explain payload. A unit test feeds it a
  deliberately *wrong* vector (SI 0.41) and asserts that value is rendered —
  which proves no weight is hardcoded in TypeScript.
- No user-facing surface claims the retired role/workload safeguard. See the
  Phase 10B correction in §3E above.

## Artifact size — improved, not solved

Adding the explain blocks took `top_1000_peaks.v1.json` from 886 KB to 23 MB at
`indent=2`. Compacting the separators brought both artifacts down ~37 %
(peaks 23 MB → 14 MB, seasons 9.2 MB → 5.8 MB). Nothing reads these files as
text, and a multi-megabyte JSON diff is not reviewable line-by-line either way,
so the readability `indent=2` bought was theoretical.

**Still open.** `peaks.py` `json.loads` the whole 14 MB into a module cache on
the first `/peaks` request, even though the table needs only ~1.8 MB of it. The
clean fix is to split `explain` into a sibling artifact loaded lazily on the
first `/explain` request:

| | current | after a split |
|---|---|---|
| table (hot path) | 14 MB resident | ~1.8 MB |
| explain | same file | ~12.8 MB, lazy |

Deferred rather than done because the serving-gate guards read the artifact
directly, so a split means updating those tests too — real regression risk to
take on at the end of a pass. It is a contained follow-up.

## Still deferred from Phase 9B

Both items in §3 (role-player inflation in `statistical_impact`) and §4 (the
`audit_player_pool_expansion.py` OR-instead-of-AND candidate-universe bug) are
**unchanged and still open**. Nothing in Phase 10B touched the formula or the
candidate pool. The rankings section is now explainable; it is not yet fully
correct at the model level, and the modal does not claim otherwise.
