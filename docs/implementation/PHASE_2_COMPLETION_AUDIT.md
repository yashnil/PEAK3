# Phase 2 Completion Audit — Peak Draft

Audit + hardening pass over the Phase 2 Peak Draft implementation (Peak Duel from
Phase 1 unchanged). Scope: verify the lineup model, board generator, draft API,
and frontend; close concrete gaps; add reports, docs, and CI.

## Baseline test results (before changes)
| Suite | Result |
|---|---|
| Model (`tests/`, excl. lineup) | 186 passed |
| Lineup (`tests/lineup/`) | 41 passed |
| API (`apps/api/tests/`) | 84 passed, 1 skipped |
| Frontend unit (`apps/web`) | 24 passed |

## Verification performed
- **Board corpus** — 600 boards (200 seeds × 3 modes): 0 failures, every board
  role-feasible. `reports/board_generation/seed_corpus_summary.json`.
- **Weight sensitivity** — `TALENT_WEIGHT` 0.60→0.90: top-1 lineup unchanged,
  top-10 displacement 0.0. `reports/lineup_model_v0/weight_sensitivity.csv`.
- **Adversarial** — no lineup exceeds solver optimum, none > 100, synergy never
  flips a >5pt talent gap. `reports/lineup_model_v0/adversarial_lineups.json`.
- **Private-data leak scan** — deep key scan of initial payloads across all
  modes: no `future_offers`, `reframe_branches`, `board_seed`, `board_optimum`,
  `board_floor`, `all_ratings`, `optimal_cards`, or `prime_index`.
- **Card profile provenance** — 984 profiles, 684 eligible, 300 excluded, 0
  provisional; every DNA dimension traces to a named PEAK3 field.

## Changes made
1. **Decision Replay (Fix A)** — server now records, per completed round, the
   offers shown + the card/role chosen (`round_history` on `DraftGameState`,
   surfaced in the public state, rendered by a new `DecisionReplay` component on
   the results screen). Contains only already-seen rounds, so no spoiler leak.
2. **Missing-data transparency (Fix B)** — `board.py` tracks excluded-profile
   count and pool sizing; `board_metadata` now exposes `card_pool_size`,
   `cards_placed`, and `excluded_profiles`.
3. **Idempotency (Fix C)** — the `idempotency_key` check now runs *before* the
   active-game assertion in all three actions, so a retried final-round selection
   returns the completed state instead of a spurious `game_complete` 400.
4. **Stable error codes (Fix D)** — state-machine errors raise `DraftError(code,
   message)`; the API returns `detail = {error_code, message}`; the frontend
   `DraftAPIError` carries the code and tolerates plain-string details too.
5. **Mobile layout (Fix E)** — confirmed `DraftScreen` and children use
   responsive widths (only a percentage-width DNA bar); added `max-w-full h-auto`
   to the radar SVG defensively.
6. **Tests** — added draft API tests for round history, completion idempotency,
   error codes, and board-metadata pool counts.
7. **CI** — added a dedicated `lineup-tests` job and card-profile build/artifact
   so API draft tests have their game data on a clean runner.
8. **Makefile** — added `test-board-generation`, `verify-game-data`,
   `verify-fresh`, `test-fast`, `test-full`; added
   `scripts/check_board_generation.py`.
9. **Docs** — this audit, plus ruleset, threat model, provenance, and the
   experimental lineup model spec.

## Post-change test results
| Suite | Result |
|---|---|
| Lineup (`tests/lineup/`) | 41 passed |
| API (`apps/api/tests/`) | 91 passed, 1 skipped (+7 new) |
| Frontend typecheck | clean |
| Frontend unit | 24 passed |
| Frontend production build | success |
| Board-generation smoke (`make test-board-generation`) | PASS (75 boards) |
| Model (`tests/`, excl. lineup) | 186 passed (unchanged; no model files touched) |

## Acceptance criteria status
| Criterion | Status |
|---|---|
| 5 rounds × 3 offers per board | PASS |
| No duplicate players on a board | PASS |
| ≥1 valid role-completion path per board | PASS (600/600) |
| No future offers / seed / solver output pre-completion | PASS |
| No `prime_index` in offers | PASS |
| Deterministic daily boards (HMAC seed) | PASS |
| Talent dominates; synergy bounded & cannot override | PASS |
| Exact solver + draft efficiency / percentile | PASS |
| Hold/Reframe once-each, server-enforced | PASS |
| Idempotent actions incl. finalizing action | PASS (Fix C) |
| Stable machine-readable error codes | PASS (Fix D) |
| Decision replay on results | PASS (Fix A) |
| Missing-data transparency in metadata | PASS (Fix B) |
| Challenge links reproduce boards | PASS |
| No PEAK3 scoring in TypeScript | PASS |
| `OFFICIAL_WEIGHTS` unchanged | PASS (untouched) |
| Elite-defense representation in card pool | PARTIAL — see limitations |
| Persistent store / accounts | N/A — deferred to Phase 3 |

## Known limitations
- Offense-weighted role rules exclude 300 windows (mostly defensive specialists);
  Peak Draft under-represents elite defense. Faithful to PEAK3 components but
  flagged for basketball review.
- Coverage/synergy barely affect ranking (talent dominance); they explain rather
  than reorder.
- In-memory game store is ephemeral (Phase 3 will add Redis/Supabase).
- No rate limiting on game creation yet.
- Playwright e2e requires running services and is excluded from CI
  (`make test-full` runs it locally).

## Required human basketball review
1. Are the role thresholds (`ROLE_RULES`) acceptable, given they exclude elite
   defenders? Should a defense-oriented role be added for v1?
2. Are the synergy rules and their magnitudes basketball-reasonable?
3. Is `peak_tier`/`prime_index_normalized` double-counting acceptable as DNA?

## Next recommended pass
Add a defense-aware role (or relax `anchor`) and re-run the corpus + provenance
reports, so the card pool represents elite defenders before public launch.
