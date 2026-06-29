# Experimental Lineup Model v0

> **Status: EXPERIMENTAL.** `lineup_peak_rating` is *not* a predicted win total,
> championship probability, or any objective basketball truth. It is the output
> of a hypothetical scoring model applied to PEAK3 individual peak scores. The
> PEAK3 individual model (`OFFICIAL_WEIGHTS`, `calibrate_score`) is unchanged and
> authoritative; this layer sits strictly on top of it.

Version constants (single source of truth: `nba_peak/lineup/config.py`):

- `LINEUP_MODEL_VERSION = "experimental_lineup_v0"`
- `RULESET_VERSION = "ruleset_v0"`
- `CARD_PROFILE_VERSION = "v0"`

## Scoring formula

A lineup is exactly 5 cards, each card a PEAK3 peak window of the same duration
(1, 3, or 5 years), each assigned to a distinct functional role.

```
raw          = TALENT_WEIGHT * talent + COVERAGE_WEIGHT * coverage
rating       = clamp(raw * (1 + synergy_total), 0, 100)
```

Weights (`config.py`): `TALENT_WEIGHT = 0.78`, `COVERAGE_WEIGHT = 0.14`,
`SYNERGY_WEIGHT = 0.08` (synergy is applied as a bounded multiplier, not an
additive weight; see below).

### 1. Talent (`talent.py`)
The five `individual_peak_score` values are sorted descending and combined with
diminishing weights `[0.35, 0.27, 0.20, 0.12, 0.06]` (sum = 1.0). Properties:
monotone (more peak score is never worse), every card contributes (min 6%),
output in `[0, 100]`. This is the dominant layer — the blueprint hypothesis is
**talent dominates**.

### 2. Coverage (`coverage.py`)
The eight Lineup DNA dimensions are aggregated across cards with *saturation*:
the nth-best card in a dimension is weighted `1 / (1 + alpha*(n-1))`,
`alpha = 0.40`. Result is normalised so five maxed cards still score 100. A flat
`8.0` penalty applies per dimension whose aggregate falls below `15.0`
(catastrophic hole). Output in `[0, 100]`.

### 3. Synergy (`synergy.py`)
Six named, bounded rules (3 positive, 3 negative), each emitting a receipt item.
The total is clamped to `[-0.06, +0.06]` and applied as a multiplier
`(1 + synergy_total)`. No rule references specific players; all are DNA/role
predicates. By design synergy can nudge but **cannot override talent**: see the
weight-sensitivity and adversarial evidence below.

## Lineup DNA dimensions
`primary_creation, scoring_pressure, individual_validation,
postseason_translation, team_context, peak_tier, prime_index_normalized,
context_completeness`. Each traces to a named PEAK3 component or rank field —
see `docs/model/CARD_PROFILE_PROVENANCE.md`.

## Roles
`lead_creator, guard_wing, wing_forward, forward_big, anchor`. Eligibility is
derived from component percentile thresholds within a duration pool (game
mechanics, not scouting claims). A board guarantees at least one assignment of
all five distinct roles.

## Solver (`solver.py`)
The board state space is bounded (`3^5 = 243` selections), so the optimum is
found by **exact enumeration** (`solver_v0_exact`), filtering to role-feasible
lineups. `board_floor` is the 5th-percentile rating of the feasible
distribution; `draft_efficiency = (rating - floor) / (optimum - floor)` clamped
to `[0, 1.5]`; `board_percentile` is the rating's percentile in that
distribution.

## Validation evidence

**Board corpus** (`reports/board_generation/seed_corpus_summary.json`): 600
boards (200 seeds × 3 modes) all generated successfully, 0 failures, every board
role-feasible (mean feasible lineups per board 152–175; min 24).

**Weight sensitivity** (`reports/lineup_model_v0/weight_sensitivity.csv`):
sweeping `TALENT_WEIGHT` from 0.60 → 0.90 leaves the top-1 lineup unchanged and
the top-10 ordering displacement at 0.0 on the probed board. The ranking is
talent-driven and stable; coverage/synergy refine but do not reorder.

**Adversarial probes** (`reports/lineup_model_v0/adversarial_lineups.json`):
across all three modes, no enumerated lineup exceeds the solver optimum, no
rating exceeds 100, and bounded synergy never flips a talent gap > 5 points.
Max observed `|synergy_total|` ≈ 0.04 (bound 0.06).

## Known limitations (v0)
- Coverage and synergy have minimal influence on ranking given talent dominance;
  they primarily drive the *explanation*, not the ordering.
- Role eligibility is offense-weighted: elite defensive specialists with low
  SI/TP/recognition can fail every role and be excluded (see provenance doc).
- Norm constants are fixed observed maxima; re-deriving the universe would
  require re-running `build_card_profiles.py` and bumping `CARD_PROFILE_VERSION`.
- The model has not been validated against any external outcome metric, by
  design — it is a game scoring layer, not a predictive model.
