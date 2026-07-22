# Phase 4.0 Report — Async Ranked Duels, Rating Ledger, Glicko-2, Placements

**Status:** Engineering complete. Internal-alpha ready. Not closed-alpha or public-beta ready.
**Date:** 2026-07-01

---

## 1. Preflight production-gap findings

Beyond the two gaps already documented after Phase 3 (no live-Supabase RLS
round-trip, no live sign-in/OAuth coverage), inspecting the running system
before building ranked surfaced three additional, previously-undocumented
issues, all fixed in this pass:

1. **`infra/migrations/003_game_records.sql`** declared `games.expires_at`
   as a `GENERATED ALWAYS AS (created_at + INTERVAL '24 hours') STORED`
   column. PostgreSQL rejects `timestamptz + interval` as a generated-column
   expression ("generation expression is not immutable") — confirmed against
   a real PostgreSQL 16 instance. **This table could never have been created
   against a real database.** Fixed by removing the generated column (no
   application code read it) and documenting that a future TTL job should
   compute the cutoff inline.
2. **`infra/migrations/004_challenges.sql`** used a `CHECK` constraint
   containing a subquery (`challenge_participants_not_self`). PostgreSQL
   rejects subqueries in `CHECK` constraints at DDL time — also confirmed
   against real Postgres. Fixed with a `BEFORE INSERT/UPDATE` trigger
   (the same pattern now used throughout the ranked schema).
3. **`apps/api/app/api/v1/draft.py`** and **`apps/api/app/api/v1/history.py`**
   persist/read game, challenge, and result data through two *different*
   storage paths: `draft.py` uses the Phase 2 `app.services.draft.store`
   module-level singleton (always in-memory, regardless of `DATABASE_URL`),
   while `history.py`/`profiles.py` use the properly dependency-injected
   `GameRepoDep`-style repos that do switch to Postgres. **Practice/Daily/
   Challenge game state does not actually persist to Postgres today even
   when `DATABASE_URL` is set** — a real gap in the Phase 3.0 durability
   claim, independent of ranked. Ranked does **not** inherit this gap: its
   own game persistence goes through `GameRepoDep` directly (see §5), which
   is why refresh/restart tests below pass for ranked. Fixing the legacy
   Daily/Practice/Challenge path is out of scope for this pass and is
   recorded here as a follow-up, not silently patched.

Additionally, the existing Postgres repository protocols (`protocols.py`)
declare synchronous methods while `postgres.py`'s implementations are
`async def`, and existing call sites (e.g. `history.py`) call them without
`await` — meaning those routes would silently return unawaited coroutines
under a real database. Ranked repositories are `async def` end-to-end with
every call site awaited, specifically to avoid reproducing this bug (see
`ranked_protocols.py`'s module docstring).

## 2. Ranked architecture

Full design in **`docs/architecture/ADR-004-phase4-ranked.md`** (18 numbered
decisions): queue separation, matchmaking model, board assignment, hidden-
information contract, settlement rules, Glicko-2 choice, rating-period
strategy, placements, ledger, divisions, inactivity/RD, aborts, repeated-
opponent limits, integrity, version compatibility, leaderboard eligibility,
progression interaction, and public-launch gates.

Key structural decisions:
- Ranked reuses the existing Draft state machine (`app/services/draft/
  state.py`'s `action_*` functions), the existing board generator
  (`nba_peak/lineup/board.py::generate_board`, **unmodified**), and the
  existing scoring model (`nba_peak/lineup/scoring.py`, **unmodified**) —
  ranked adds a comparison/rating layer, never new scoring math.
- Ranked participant games are created via the properly dependency-injected
  `GameRepoDep` (Postgres-or-memory), not the legacy `store` singleton —
  see finding 3 above.

## 3. Tables and migrations

Six new migrations (`infra/migrations/011`–`016`), continuing the existing
numbered-SQL-file convention: `ranked_queue_versions`, `rating_algorithm_
versions`, `division_versions`, `ranked_queue_entries`, `ranked_matches`,
`ranked_match_participants`, `ranked_match_submissions`, `ranked_opponent_
history`, `rating_periods`, `ranked_match_settlements`, `rating_ledger_
entries` (append-only, trigger-enforced), `rating_snapshots`, `queue_
ratings`, `placement_states`, `ranked_integrity_events`, `ranked_abort_
allowances`, plus RLS policies for all of them in `016_ranked_rls.sql`.

All required constraints (two distinct users per match, one active
participant per user/match, one settlement per match, append-only ledger,
settlement-board-mismatch rejection, one active queue entry per user/queue)
are real `UNIQUE`/`CHECK`/`FOREIGN KEY`/trigger constraints, verified
against a live PostgreSQL 16 instance (Docker), not just asserted in
application code:
- Self-match prevention via `UNIQUE(match_id, owner_sub)` — verified.
- Settlement-board-mismatch trigger — verified (rejects a wrong
  `board_version_key` at insert time).
- Ledger append-only triggers — verified (`UPDATE`/`DELETE` both raise).
- **All 16 migrations apply cleanly to a fresh database and are rerun-safe**
  — verified by applying the full chain three times in sequence against the
  same database with zero errors on the second and third pass (this
  required fixing non-idempotent `CREATE POLICY`/`CREATE TRIGGER`/`ADD
  CONSTRAINT` statements across `004`, `005`, `010`, `013`, `014`, `016` —
  none of these were rerun-safe before this pass).

## 4. Glicko-2 algorithm and parameter version

`apps/api/app/services/ranked/glicko2.py` implements Glickman's published
algorithm exactly (glicko-scale conversion, `g(RD)`, `E(...)`, Illinois-
algorithm volatility root-find, RD/rating update), not an Elo-style
approximation. Version: **`glicko2_v1`**. Parameters: initial rating 1500,
initial RD 350, initial volatility 0.06, `tau = 0.5`, `epsilon = 1e-6`,
bounded iteration with an explicit `Glicko2ConvergenceError` on non-
convergence. Rating-period strategy: **one match per rating period**,
explicitly documented as a v1 limitation (ADR-004 §7), versioned so a
future batched-period algorithm is a pure version bump.

Reference-vector test reproduces Glickman's own worked example (1500/200 vs
opponents 1400/30, 1550/100, 1700/300, outcomes 1/0/0) to rating≈1464.06,
RD≈151.52, volatility≈0.05999 — **passing**. 16 total Glicko-2 tests cover
determinism, convergence failure, win/loss/draw direction, RD/volatility
sensitivity to opponent uncertainty, and inactivity RD growth.

## 5. Matchmaking behavior

Asynchronous queue (`app/services/ranked/matchmaking.py`): join creates a
durable `ranked_queue_entries` row; pairing is attempted synchronously after
each join (appropriate for closed-alpha population size). Rating-range
search starts at ±100 and grows with wait time; placement-state entries
match broadly regardless of rating gap; repeated opponents (within a 2-hour
window) are deprioritized but not blocked when no alternative exists.
Concurrent pairing attempts are serialized via `SELECT ... FOR UPDATE SKIP
LOCKED` (Postgres) / an `asyncio.Lock` (memory) — verified with
`asyncio.gather` racing three simultaneous `try_match` calls: exactly one
match forms.

## 6. Hidden-information protections

Both participants receive an **identical, immutable board** — generated
once at match creation (`generate_ranked_board`, seeded from the match's own
UUID), persisted as `board_snapshot`, and never regenerated per participant.
Verified: two independent deserializations of the same stored snapshot
produce byte-identical round offers; `get_public_state` never includes
future-round offers (same contract Daily/Practice already rely on).
Pre-settlement, `ranked_match_participants`/`ranked_match_submissions` deny
opponent-row reads at the RLS layer (real Postgres RLS test written; see
§13) and the API serializer never includes opponent fields. Verified live
through an actual browser (Playwright): neither page's rendered content nor
network responses ever contain the opponent's identity, picks, or progress
before settlement.

## 7. Settlement and tie-break rules

Primary comparison: `lineup_peak_rating`. Tie-break 1: `draft_efficiency`,
only if both sides share the same `solver_version`. Tie-break 2: forced-
placement count (not currently represented by the state machine; reserved).
Otherwise: draw. Every tie-break input is stored in
`ranked_match_settlements.audit_metadata`. Verified by test: exact ties with
matching solver versions resolve via efficiency; exact ties with
*different* solver versions correctly fall through to draw rather than
comparing incompatible values; completion time/order has no effect on
outcome.

## 8. Rating ledger and replay result

`rating_ledger_entries` is append-only (trigger-enforced). `scripts/
ranked_replay.py` recomputes every user's rating trajectory from the
versioned initial state and diffs against stored values. **Run against 3
real settled matches created through the actual Postgres-backed
matchmaking/settlement services (not mocks): 6 ledger entries replayed, 0
discrepancies.** `scripts/ranked_audit.py`'s 12-check audit (duplicate
updates, missing opponent entry, asymmetric outcomes, mismatched algorithm
versions, settlement-without-rating, rating-without-settlement, impossible
placement counts, non-rated-game leakage, board-mismatch, self-match,
orphaned queue rating) — **all 12 CLEAN** against the same real data. A
manually-inserted append-only reversal entry was confirmed not to trip any
audit check and not to mutate the original entry.

## 9. Placement behavior

Seven integrity-valid matches establish a queue (`RANKED_PLACEMENT_MATCH_
COUNT = 7`), using the real Glicko-2 algorithm from match 1 (no separate
placement formula). Verified end-to-end through the real HTTP API: a user
who completes 7 matches has `placement_states.established = True` and their
exact rating becomes visible; a user with 1 completed match sees "Placement
1 of 7" and `rating: null` (hidden during placements, per spec).

## 10. Division configuration

Vocabulary (Prospect → Rotation → Starter → All-Star → All-NBA → MVP →
Legend) is code-versioned (`division_v1_provisional`) with explicit
provisional thresholds and a Legend minimum-valid-matches gate (30) to
prevent an early lucky streak from minting a "Legend." Public MVP/Legend
display is gated on population size (not implemented in the UI yet beyond
the flag — see limitations).

## 11. Leaderboard eligibility

Queue-specific only (no composite). Ranking key: `(rating desc, RD asc,
valid-match count desc, owner_sub asc — pagination only)`. **A real cursor-
pagination bug was found and fixed during testing**: the original cursor
encoded only `rating|owner_sub`, dropping RD/valid-match-count from the
comparison, which let a tied-rating row re-appear across a page boundary.
Fixed by encoding the full sort key in the cursor; verified with a
dedicated test asserting adjacent pages are disjoint. Public leaderboard
reads are gated by `RANKED_PUBLIC_LEADERBOARD_ENABLED`, independent of the
other ranked flags.

## 12. Progression-separation evidence

`app/services/ranked/settlement.py` and `matchmaking.py` contain zero
imports of the progression package (verified via AST inspection in a
dedicated test, not just a substring grep). A dedicated invariant test runs
the *same* settlement inputs through two fully independent repository
instances standing in for players with different XP/level/streak histories
(which never enter the rating code path at all) and asserts bit-identical
outcome and ledger math. Ranked XP is awarded through the existing
versioned progression policy (`ranked_completion_first_weekly`, added
additively to `xp_policy.py`/`engine.py`), called only *after* the rating
transaction commits, wrapped in a try/except so a progression failure can
never surface as a ranked-match failure.

## 13. RLS/auth integration results

**Written, not yet run against a live project** — no Supabase test project
exists in this environment. `apps/api/tests/integration/` contains 5 RLS
tests (owner read, non-owner denial, anonymous denial, public-metadata
read, pre-settlement opponent-submission denial — using real `SET ROLE` +
`request.jwt.claims`, the same mechanism PostgREST/Supabase uses, not a
mock) and 6 auth-flow tests (sign-up/sign-in/session-restoration, sign-out
revokes refresh token, real JWT accepted, expired JWT rejected, tampered
signature rejected, OAuth-disabled-is-intentional). All are marked
`@pytest.mark.supabase_integration` and **skip with an explicit "not
configured" reason** — never silently reported as passing — when
`PEAK3_TEST_SUPABASE_URL` etc. are absent, which they are in this
environment. A dedicated `supabase-integration` CI job was added
(`.github/workflows/ci.yml`) that always runs and always visibly reports
"NOT CONFIGURED" in the job summary when secrets are absent, rather than
silently skipping. **Two checks that need no live project were run for
real and pass**: the service-role key never appears in the built Next.js
output (scanned every JWT-shaped string in `.next/` for a `service_role`
claim — none found), and `.env.example` never declares a service-role
key under a `NEXT_PUBLIC_` prefix.

## 14. Simulation and calibration results

`scripts/ranked_validation/simulate_glicko.py`, run against 200 synthetic
players with Gaussian latent skill (σ=300) and per-match performance noise
(σ=150), 30 matches/player:
- Rating-order correlation (Spearman, true skill vs. final rating): **0.973**
- Upset probability: **15.2%**
- Calibration by rating-gap bucket: monotonic from 0.0004 (−1500 gap) through
  0.559 (0 gap) to 0.9997 (+1300 gap) — sensible and monotonic.
- Mean final volatility: 0.0600 (stable, no runaway inflation).
- Population sensitivity (n=30/200/1000): Spearman 0.963/0.973/0.966 — stable
  across population sizes.

Full report: `scripts/ranked_validation/output/glicko_simulation_report.json`
(gitignored; regenerate with the script).

## 15. Distribution and adversarial-audit results

`slice_audit.py` against the real committed card pool
(`data/game/profiles/card_profiles.v3.json`, 984 cards, 271 excluded):
role-eligibility, era, and score distributions computed per mode; **zero
roles flagged** below the 5%-of-pool eligibility threshold in any mode.

`adversarial_search.py`, 20,000 randomly-sampled valid role-filling
lineups per mode (60,000 total) against the real synergy/scoring rules:
**zero synergy-bound violations**, **zero talent/synergy inversions**
(no case where a lineup with ≥5-point-lower talent score out-rated a
higher-talent one), and no single card appeared in more than **1.23%** of
sampled slots in any mode (no dominant/exploitable card found at this
sample size).

`face_validity_fixtures.py`: 2 structurally-grounded fixtures (monotonicity
in individual score; anchor-coverage-present) evaluated through the real
model, `reviewer_status: "pending"` on both — **no fabricated expert
consensus**. `expert_review_harness/cli.py` is a working blind pairwise-
review tool (tested end-to-end, then its test record was deleted); it ships
with **zero review records**.

## 16. Exact test commands and counts

```bash
# Python model (unmodified)
python -m pytest tests/ --ignore=tests/lineup -q         # 186 passed
python -m pytest tests/lineup/ -q                         # 41 passed
# Total: 227/227

# FastAPI (excludes tests/integration/, which always skips without secrets)
cd apps/api && python -m pytest tests/ --ignore=tests/integration -q
# 250 passed, 0 skipped
# (180 baseline + 70 new: 16 glicko2 + 13 matchmaking + 14 settlement +
#  7 board_security + 7 placements_leaderboard + 5 progression_separation +
#  6 concurrency + 2 service_role_not_bundled)

cd apps/api && python -m pytest tests/integration/ -rs
# 13 skipped, all with explicit "Supabase integration tests not configured" reason

# Frontend
cd apps/web && npx tsc --noEmit         # clean
cd apps/web && npm run lint -- --max-warnings 0   # clean
cd apps/web && npm run test              # 87 passed (67 baseline + 20 new)
cd apps/web && rm -rf .next && npm run build   # succeeds

# Playwright — two independent fresh-service runs
# (kill all node/uvicorn, restart both services from scratch, run full suite)
npx playwright test --project=chromium --reporter=list    # 61/61, run 1
npx playwright test --project=chromium --reporter=list    # 61/61, run 2 (fresh restart)
npx playwright test --project=mobile-chrome --reporter=list  # 7/7
# (56 baseline chromium + 5 new ranked; 6 baseline mobile + 1 new ranked)
```

## 17. Full corpus results

```bash
python scripts/check_board_generation.py 1000
# Checked 3000 boards across 3 modes (1000 seeds each). PASS.

python scripts/ranked_validation/check_ranked_board_corpus.py --n 1000
# Checked 3000 ranked boards across 3 modes (1000 match ids each).
# Determinism spot-check: PASS. PASS: all ranked boards valid.
```

## 18. Remaining limitations

- **No live Supabase project** in this environment — the RLS/auth
  integration suite (§13) is written and structurally sound but unexecuted.
  This is the single largest gate blocking closed alpha.
- **No real human expert review** — the pairwise-review harness works but
  has zero data. This blocks public beta specifically.
- **Legacy Daily/Practice/Challenge persistence gap** (finding 3, §1) is
  pre-existing, not introduced by ranked, and not fixed in this pass.
- **Divisions are provisional** — thresholds are placeholders pending a
  real distribution report from actual closed-alpha rating data, not from
  the 200-synthetic-player simulation alone.
- **Matchmaking runs synchronously on join**, not as a separate worker
  process — acceptable for closed-alpha population size, documented in
  ADR-004 as a scale limitation to revisit before public beta.
- **UI polish**: the ranked play screen reuses `DraftCard`/`RoleSelector`
  directly but does not yet have ranked-specific DNA-bar/receipt richness
  Daily/Practice have; functionally complete, visually plainer.
- **Reversal/integrity admin tooling** is data-model-complete (append-only
  ledger reversal, `ranked_integrity_events`, `ranked_abort_allowances`) but
  has no admin UI — only the schema, repos, and audit script exist.

## 19. Ranked readiness classification

| Gate | Status |
|---|---|
| Engineering complete | **Yes** |
| Internal alpha ready | **Yes** — behind `RANKED_READINESS_LEVEL=internal_alpha` |
| Closed alpha ready | **No** — blocked on real Supabase RLS/auth integration evidence |
| Public beta ready | **No** — additionally blocked on real expert review and real closed-alpha player data |

## 20. Recommended next pass

**Phase 4.1 — Ranked Closed Alpha, Expert Validation, Integrity Calibration,
and Observability.** Priorities: provision a real isolated Supabase test
project and run the integration suite in §13 for real; recruit real
reviewers for the expert-review harness; replace synchronous join-time
matchmaking with a background worker if closed-alpha volume warrants it;
build the division-threshold distribution report from real rating data
once closed-alpha volume exists; add operator-facing integrity/reversal
tooling.
