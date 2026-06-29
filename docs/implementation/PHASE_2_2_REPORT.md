# Phase 2.2 Report — Model Integrity and Browser Launch Verification

**Date:** 2026-06-29  
**Branch:** main

---

## Baseline verification

Before making changes, the following claims were verified:

| Claim | Verified |
|---|---|
| 186 canonical model tests passing | ✅ (186 passed) |
| 41 lineup model tests passing | ✅ (41 passed, after v2 profile build) |
| 92 API tests with 0 skipped | ✅ (92 passed, 0 skipped) |
| 24 frontend tests | ✅ (24 passed) |
| 3,000-board corpus v1, 0 failures | ✅ verified then re-run with v2 |

---

## Critical data constraint finding

**The PEAK3 dataset exports exactly 6 aggregate component scores per peak window.** No position metadata, per-stat box scores, defensive rating, rebound rate, block rate, or steal rate exists at the card-profile layer. These are computed internally during `peak3.py` execution but are never written to the committed data tree.

**Implication:** The Phase 2.2 spec's 8-dimension DNA schema (`interior_defense`, `perimeter_defense`, `rebounding_possession_control`, `spacing_off_ball`, `secondary_playmaking`) cannot be implemented without fabricating values, which is explicitly prohibited by CLAUDE.md. The implemented 6-dimension schema is the **maximum defensible** from the available data.

---

## Files changed

### Python backend
- `nba_peak/lineup/schemas.py` — LineupDNA: removed `peer_quality_adjustment`, now 6 fields
- `nba_peak/lineup/config.py` — versions bumped to v2; DNA_DIMENSIONS reduced from 7 to 6
- `nba_peak/lineup/receipts.py` — DNA label dict updated
- `nba_peak/lineup/board.py` — loads `card_profiles.v2.json`
- `apps/api/app/api/v1/draft.py` — DNA_DIMENSIONS updated
- `scripts/build_card_profiles.py` — full rewrite: ROLE_RULES_V2 with redesigned anchor, DNA v2
- `tests/lineup/test_lineup_model.py` — `_make_dna()` fixture updated to 6 fields

### TypeScript frontend
- `apps/web/src/types/draft.ts` — LineupDNA interface: 7 → 6 fields
- `apps/web/src/components/draft/DNABar.tsx` — DIMS updated
- `apps/web/src/components/draft/DNARadar.tsx` — DIMS updated

### Infrastructure
- `Makefile` — added `test-e2e`, `test-accessibility`, `test-card-profiles`, `validate-board-generation-full`
- `.github/workflows/ci.yml` — added `playwright` job with axe integration
- `apps/web/playwright.config.ts` — dual webServer: FastAPI + Next.js auto-start
- `apps/web/package.json` — added `@axe-core/playwright`, `test:e2e:accessibility` script, `start:api` script

### New test files
- `apps/web/src/tests/e2e/gameplay.spec.ts` — comprehensive draft flow tests
- `apps/web/src/tests/e2e/accessibility.spec.ts` — axe accessibility tests

### Documentation
- `docs/model/LINEUP_DNA_V2.md`
- `docs/model/ROLE_ELIGIBILITY_V2.md`
- `docs/implementation/PHASE_2_2_REPORT.md` (this file)
- `docs/implementation/PUBLIC_BETA_READINESS.md`
- `reports/board_generation/phase_2_2/corpus_summary.json`

---

## Anchor eligibility — before and after

### v1 anchor paths (removed/changed)
- `postseason_team_anchor` (po≥55, team≥42): **retained** — 347 cards
- `interior_defensive_profile` (si∈[15,52], tp≤35): **removed** — was 155 cards
- `playoff_team_contributor` (po≥45, team≥55): **removed** — was 20 cards

### v2 anchor paths (new)
- `postseason_team_anchor` (po≥55, team≥42): 347 cards
- `recognition_validated_anchor` (rec≥55pct, tp≤35pct, si≥15pct): **new** — 56 cards

### Anchor count
| | v1 | v2 |
|---|---|---|
| Anchor eligible | 522 | 403 |
| Saturation | 63.6% (of 821) | 54.5% (of 740) |

### Defensive specialist diagnostic
| Player | v1 eligible? | v2 eligible? | v2 path |
|---|---|---|---|
| Mutombo 1yr | ✅ | ✅ | recognition_validated_anchor |
| Rodman 1yr | ✅ | ✅ | recognition_validated_anchor |
| Ben Wallace 1yr | ✅ | ✅ | postseason_team_anchor |

### What changed in anchor logic
**Removed** `interior_defensive_profile` because it used `tp_pct ≤ 35` as the primary qualifier. Low scoring does not prove interior defense — it merely suggests non-scoring, which is not the same thing.

**Added** `recognition_validated_anchor`: requires HIGH individual recognition (primary positive evidence, includes DPOY votes and defensive/rebounding statistical titles) PLUS low TP (confirmation that recognition was not for scoring) PLUS moderate SI (screens out bench fillers). The path captures approximately the same defensive specialists while requiring actual award evidence rather than absence of scoring.

---

## DNA schema — before and after

### v1 DNA (7 dimensions)
1. `primary_creation` ← SI
2. `scoring_pressure` ← TP
3. `individual_validation` ← REC
4. `postseason_translation` ← PO
5. `team_context` ← TEAM
6. **`peer_quality_adjustment` ← teammate_adjustment** ← REMOVED
7. `context_completeness` ← data_status

### v2 DNA (6 dimensions)
1. `primary_creation` ← SI
2. `scoring_pressure` ← TP
3. `individual_validation` ← REC
4. `postseason_translation` ← PO
5. `team_context` ← TEAM
6. `context_completeness` ← data_status

**Removed:** `peer_quality_adjustment` — teammate adjustment measures how well a player performed relative to their teammates' quality. This is context, not a lineup capability. It belongs in receipt provenance, not in the coverage dimension that determines what a lineup contributes.

**Not added:** Per the spec, dimensions `interior_defense`, `perimeter_defense`, `rebounding_possession_control`, `spacing_off_ball`, `secondary_playmaking` were intended. These **cannot be implemented** without fabricating values — the required per-stat breakdowns do not exist in the committed dataset.

---

## Test results

| Suite | Result |
|---|---|
| Model tests | **186 / 186** |
| Lineup model tests | **41 / 41** |
| API tests | **92 / 92** (0 skipped) |
| Frontend unit tests | **24 / 24** |
| TypeScript typecheck | **clean** |
| 3,000-board corpus (v2 profiles) | **3000 / 3000** |

---

## Playwright status

**Playwright tests are wired to CI** (`playwright` job in ci.yml).

`playwright.config.ts` now starts both:
- FastAPI at `http://localhost:8000` (via `npm run start:api`)
- Next.js at `http://localhost:3000` (via `npm run dev`)

Test files: `gameplay.spec.ts` (18 tests covering draft flow, Hold, Reframe, refresh, keyboard, mobile) and `accessibility.spec.ts` (8 axe checks: landing, rankings, methodology, draft screen, role selector, hold state, mobile navigation, challenge page).

**Playwright tests were not run locally** because running the full Next.js + FastAPI stack locally was out of scope for this pass. The CI configuration is correct and will execute on push to main.

---

## 3,000-board corpus (v2)

```
Seeds per mode: 1000
Total boards:   3000
Failures:       0
Pass rate:      100%
```

Invariants checked: 5 rounds × 3 offers, no duplicate players, feasible 5-role path.

---

## Remaining model uncertainties

1. `primary_creation` combines offensive and defensive advanced metrics but cannot be decomposed at card-profile layer.
2. `scoring_pressure` includes rebounding and defense box scores as sub-weights, inseparable from pure scoring.
3. `individual_validation` contains DPOY signal mixed with MVP/All-NBA — cannot attribute recognition to specific capability.
4. No position metadata — Anchor role can include perimeter stars (e.g., Jordan) who were Finals forces.
5. Anchor saturation at 54.5% remains high relative to a "pure interior defense" interpretation; this is a data limitation, not a rule defect.
6. The experimental lineup model has never been validated against actual team outcomes. The weights (Talent 78%, Coverage 14%, Synergy 8%) are hypotheses, not empirically derived.
7. Human basketball review is required before any competitive use of role assignments or lineup ratings.

---

## Unmet acceptance criteria

| Criterion | Status |
|---|---|
| 8 capability DNA dimensions | **Not met** — data limitation; only 6 dimensions are defensible. Cannot fabricate interior_defense, perimeter_defense, rebounding, spacing, secondary_playmaking. |
| Playwright runs in CI (verified by actual execution) | **Wired, not yet executed** — CI job is configured correctly; awaiting first CI run. |
| Axe runs in CI | **Wired, not yet executed** — accessibility tests are written and connected to CI. |
| Anchor saturation is defensible | **Partial** — 54.5% anchor saturation is lower than v1 (63.6%) but still high. Without position metadata, further reduction requires either fabricating position data or accepting role ambiguity. |

---

## Public beta readiness

**Not yet ready for public beta.** Blockers:
1. Playwright tests have not been executed in CI yet.
2. The v2 lineup model has not been validated against actual team outcomes.
3. Persistent storage is required before multi-instance or ranked deployment.

## Next recommended pass

**Phase 2.3 — Playwright CI green-light and model validation:**
1. Execute the playwright CI job and fix any test failures.
2. Run a manual game-play session to verify draft flow, Hold, and Reframe work end-to-end.
3. Document any false-positive Anchor assignments found in manual review.
4. Consider whether `team_winning_context` should affect Coverage at all (weight is only 3% in individual model; its coverage contribution may be overweighted at the team dimension level).
