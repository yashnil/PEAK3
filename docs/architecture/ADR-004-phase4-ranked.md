# ADR-004 — Phase 4.0: Async Ranked Duels, Rating Ledger, Glicko-2, and Placements

**Status:** Accepted
**Date:** 2026-06-30
**Deciders:** PEAK3 Engineering

---

## Context

Phase 3.1 closed the progression layer (XP, levels, streaks, achievements, personal
records) — all participation-based, never skill-based. ADR-003 §11 explicitly reserved
this moment: *"When Phase 4.0 adds Glicko-2, rating is computed from a separate table,
not from progression_events; XP and level have zero inputs to the rating algorithm."*
Phase 4.0 builds that separate system: an asynchronous 1v1 ranked queue per duration
(1Y Apex / 3Y Prime / 5Y Foundation), a hidden-until-settled shared board (generalizing
the existing Challenge-link pattern from ADR-001 to queue-based pairing instead of a
shared URL), and an auditable Glicko-2 rating ledger.

Ranked is release-gated behind a closed-alpha feature flag. This ADR is written before
the schema or algorithm so that later implementation decisions trace back to a
documented rationale instead of being invented ad hoc.

---

## Decisions

### 1. Queue separation

**Decision:** Each of the three durations (`apex_1y`, `prime_3y`, `foundation_5y` —
`nba_peak/lineup/config.py::SUPPORTED_MODES`) is an independent ranked queue with its
own rating, RD, volatility, placement progress, and match history. There is no
composite/cross-queue rating.

**Rationale:** The durations already measure meaningfully different skill (short-window
peak identification vs. multi-year sustained-value judgment). Blending them would let
strength in one duration mask weakness in another, and blocks a future Phase 4.2
"Triple Crown" composite from being retrofitted cleanly (a derived view over three
established queue ratings, not a fourth primary rating).

**Rejected:** Single global rating across all modes — rejected per spec, would also
make matchmaking rating-range logic ambiguous across differently-scaled boards.

### 2. Matchmaking model: asynchronous queue, not live rooms

**Decision:** Joining a queue creates a durable `ranked_queue_entries` row. A background
matcher pairs compatible waiting entries into a `ranked_matches` row transactionally.
Both participants then play independently, at their own pace, against the identical
board, until a deadline.

**Rationale:** Live synchronous rooms are explicitly out of scope (spec item 3 of "do
not implement"), and PEAK3's board-drafting interaction (multi-round, Hold/Reframe,
deliberation) is not naturally real-time. Async pairing also removes an entire class of
concurrency bugs (no two live sockets racing on the same round).

### 3. Board assignment reuses the deterministic board generator

**Decision:** `nba_peak/lineup/board.py::generate_board()` is reused unchanged. A new
seed-derivation branch in `_derive_board_seed()` is keyed on the immutable
`ranked_match_id` (a server-generated UUID, never client-supplied), so
`generate_board(board_type="ranked", key=match_id, mode=...)` is deterministic and
reproducible from the match's own identity — exactly analogous to how `daily` boards are
deterministic from `(date, mode)` and `challenge` boards from an explicit seed
(ADR-001). The generated snapshot (JSON) is persisted once, at match creation, on
`ranked_matches.board_snapshot`. Both participants' `DraftGameState`s are hydrated from
that one stored snapshot — the board is never independently regenerated per
participant, so no code path can let the two sides diverge even under a later card-pool
default change (ADR-001 §"Version pinning" applies identically here: the snapshot, not
the generator defaults, is authoritative post-creation).

**Rejected:** Generating the board twice (once per participant) from the same seed and
trusting determinism to keep them identical — rejected because it makes "both players
get the same board" an emergent property of generator purity rather than a stored,
auditable fact, and it would regenerate if `CARD_PROFILE_VERSION` changed mid-flight.

### 4. Hidden-information contract

**Decision:** Generalizes ADR-001's Challenge spoiler-protection to two anonymous-until-
settled queue participants:
- Each participant's API responses expose only their own `DraftGameState` (current
  round's offers, their own selections/Hold/Reframe state) — identical in shape to the
  existing single-player `PublicGameStateResponse`.
- Future rounds, the opponent's picks, opponent score/progress, and opponent identity
  are never present in any response reachable before `ranked_matches.status = settled`.
  This is enforced at two layers: the API serializer never includes opponent fields in
  pre-settlement responses (defense in depth), and RLS denies row-level read of the
  opponent's `ranked_match_submissions` entirely (see §14).
- After settlement, both players see the settled comparison (both official scores,
  tie-break basis, rating change) — the same "comparison only after both complete"
  pattern as Challenge links, but computed automatically instead of triggered by a
  second link visit.

### 5. Settlement rules and tie-break

**Decision:** Primary comparison is `lineup_peak_rating` from each participant's
server-computed `LineupEvaluation` (`nba_peak/lineup/solver.py`) — no new scoring math.
Tie-break order: (1) `draft_efficiency`, only if both participants' evaluations carry
the same `solver_version` (a version mismatch skips this tie-break rather than compare
incompatible values); (2) count of forced/invalid placements, only where the state
machine represents such a thing; (3) exact equality is a draw. Completion time, click
count, Hold/Reframe usage, XP, and rating are never inputs. Every tie-break input value
is stored verbatim in `ranked_match_settlements` for audit, and comparisons use exact
decimal semantics from the stored NUMERIC values — never frontend-rounded floats.

**Rationale:** This is the smallest settlement rule that is both fair and fully
explainable from data already produced by the existing model — it adds a comparison
layer, not a new scoring layer, which keeps the "never calculate PEAK3 scores in
TypeScript" and "authoritative model" invariants from CLAUDE.md intact by construction.

### 6. Glicko-2 (not Elo, not an approximation)

**Decision:** Implement Glickman's published Glicko-2 algorithm exactly (step-by-step
per the official paper): glicko→glicko-2 scale conversion, `g(RD)`, `E(rating, opp,
RD)`, volatility update via the paper's illinois-style convergence procedure bounded by
`epsilon`, then RD/rating update, then convert back to the display scale. Versioned,
immutable constants live in code (`app/services/ranked/versions.py`,
`GLICKO2_ALGORITHM_VERSION = "glicko2_v1"`): initial rating 1500, initial RD 350,
initial volatility 0.06, system constant `tau = 0.5` (Glickman's recommended
conservative default — smaller tau means volatility changes more slowly, reducing
rating whiplash from a small number of ranked alpha matches), convergence `epsilon =
1e-6`, bounded iteration with an explicit `Glicko2ConvergenceError` raised (never
silently approximated) if the volatility solve does not converge within the iteration
cap.

**Rejected:** A custom Elo-style update — explicitly rejected per spec; it is not
Glicko-2 and must never be labeled as such. A from-scratch re-derivation of the math
without reference-vector validation — rejected; instead the reference test reproduces
Glickman's own worked example (player 1500/200 vs. opponents 1400/30, 1550/100,
1700/300 with outcomes 1/0/0 → new rating ≈1464.06, RD ≈151.52, volatility ≈0.05999) to
prove the implementation is the published algorithm, not a plausible-looking one.

### 7. Rating periods: one match per period (versioned, documented limitation)

**Decision:** For closed alpha, each settled match is treated as its own rating period
(a `rating_periods` row is created per match, referenced by both ledger entries).
Batched multi-match periods are a real Glicko-2 idea (the algorithm assumes a
"reasonable number" of games per period, ideally more than one) but the alpha's low
match volume makes per-match settlement the only period granularity that keeps ratings
responsive. This is explicitly documented (here, in the module docstring, and in the
final report) as **one match per rating period**, not the algorithm's ideal
usage — with `rating_algorithm_versions` versioning making a future move to batched
periods (e.g. daily) a pure version bump: new matches roll under the new algorithm
version; historical ledger entries remain replayable under `glicko2_v1`'s
per-match-period semantics.

### 8. Placements

**Decision:** Seven integrity-valid rated matches per queue are required before a queue
is "established." Real Glicko-2 updates apply from placement match 1 — there is no
separate placement algorithm or artificial multiplier. Only the *visible* division is
withheld during placements ("Placement X of 7"); rating/RD continue updating normally
underneath. Invalidated or protected-abort matches do not count toward the 7.

**Rationale:** A separate placement-only formula would need its own validation and
would diverge from the audited ledger. Reusing the real algorithm from match 1 means
the replay tool and reference tests cover 100% of rated matches, including placements.

### 9. Rating ledger: append-only source of truth

**Decision:** `rating_ledger_entries` is insert-only (no UPDATE/DELETE grants, enforced
by a trigger — same pattern as `result_snapshots` in ADR-002 §4). Every settlement
writes exactly two symmetric entries (one per participant) inside the same transaction
as the settlement row. Corrections use an explicit reversal entry
(`reversal_of_entry_id` FK to the original), never a mutation. A `scripts/ranked_replay.py`
tool recomputes ratings from the versioned initial state by replaying ledger entries in
order through `glicko2.py` and diffs against stored values — the ledger, not the
`queue_ratings` cache table, is authoritative; `queue_ratings` is a derived
materialization for fast reads, verifiable by replay at any time.

### 10. Divisions

**Decision:** Division vocabulary (Prospect → Rotation → Starter → All-Star → All-NBA →
MVP → Legend) is a config table (`division_versions`) mapping rating ranges to labels,
versioned like `xp_policy_versions` (ADR-003 §2). Thresholds for alpha are explicitly
labeled provisional, generated from the Glicko-2 simulation's rating distribution
(§16 of the implementation plan / Phase 4.0 report), not intuition. MVP/Legend public
display remains disabled until population size clears a configured minimum (protects
against a single early player being labeled "Legend" off of two matches).

### 11. Inactivity / RD policy

**Decision:** RD widens toward the initial value over elapsed rating periods without
activity (Glicko-2's own inactivity handling — increasing RD, never rating, when a
player hasn't competed), applied lazily at next-read/next-match time rather than a
scheduled job, since rating periods are per-match in alpha (§7) and there is no fixed
period boundary to sweep on a cron.

### 12. Aborts and protected disconnects

**Decision:** Cancelling before pairing has no consequence. Once matched and the board
is revealed, abandoning past the deadline is a loss for the abandoning side under the
match's stored `policy_version` (so a future policy change doesn't retroactively alter
already-decided matches). A `ranked_abort_allowances` table tracks a small number of
server-verified "protected abort" credits (infrastructure failure only — client claims
alone never grant one; verification is a manual/service-role operation in alpha, not a
public API). Both-sides infrastructure failure invalidates the match (no rating change,
placement count unaffected). Repeated suspicious abort patterns write a
`ranked_integrity_events` row for review; no automatic punitive escalation from a single
network blip.

### 13. Repeated-opponent and board-template limits

**Decision:** `ranked_opponent_history` tracks recent pairings per user; matchmaking
excludes an opponent faced within a configurable recent window before falling back to
allowing a repeat under a widened search (so alpha's necessarily small population isn't
permanently blocked from finding any match). Board templates (the underlying seed
material used across many boards) are similarly capped from repeating too frequently
for the same user in immediate succession.

### 14. Integrity review and RLS

**Decision:** RLS policies (generalizing ADR-002 §8's table) restrict pre-settlement
reads to each participant's own rows; post-settlement, both participants may read the
settled comparison; non-participants can never read match/submission/ledger rows for a
private match. Public users may read only flagged, feature-gated leaderboard and queue
metadata views. Matchmaking internals, unrevealed board fields, integrity signals, abort
allowances, and raw rating computation are service-role-only, matching the existing
"service-role bypasses RLS, key never reaches the client" boundary from ADR-002 §8.

### 15. Version compatibility and replay

**Decision:** `ranked_queue_versions` pins together the ruleset, lineup-model,
card-pool, board-generator, anchor-eligibility, and rating-algorithm versions active
when a queue-version was valid (`valid_from`/`retired_at`). A match stores its queue
version at creation and never re-resolves "current defaults" — identical in spirit to
board snapshots pinning `lineup_model_version`/`ruleset_version`/`card_pool_version`
(ADR-002 §5) so that a later default bump cannot alter a historical match's settlement
or its replay.

### 16. Leaderboard eligibility

**Decision:** Per-queue leaderboards only (no composite). Eligibility requires:
placement complete, a minimum count of valid rated matches, RD under a configured
ceiling, recent rated activity, no unresolved integrity review, and the user's
leaderboard-visibility preference. Ranking key is `(rating desc, RD asc, deterministic
valid-match tie-break, user id as final pagination-only order)` — user ID is never a
competitive factor, only a stable cursor. Public leaderboard reads remain behind
`RANKED_PUBLIC_LEADERBOARD_ENABLED` independent of the other ranked flags.

### 17. Interaction with XP/progression

**Decision:** Ranked completion triggers ordinary participation XP through the existing
versioned progression policy (ADR-003 §2) exactly as Practice completion does — called
*after* the rating transaction commits, never inside it, so progression can never
influence or block a settlement. No ranked-specific XP bonus for winning, rating
magnitude, or division exists. Ranked personal records flow through the existing
version-tupled record system (ADR-003 §4) unmodified. Invariant tests assert that two
identical ranked settlements with different XP/profile starting states produce bit-
identical rating ledger entries.

### 18. Public-launch validation gates

**Decision:** Public beta requires all of: real Supabase auth/RLS integration tests
passing against a live project, zero unexplained ledger-replay drift, simulation
calibration meeting documented thresholds, no severe era/role distribution bias,
adversarial exploits resolved or bounded, completed real expert pairwise review,
approved integrity/abort policy, sufficient real closed-alpha player data, and
demonstrated better-than-chance outcome prediction with documented confidence. Any gate
that cannot be evidenced (no live Supabase project, no human reviewers) keeps the
release at "engineering complete / internal alpha" rather than being marked passing.

---

## Alternatives considered

- **Composite cross-duration rating before per-queue ratings stabilize** — rejected;
  explicitly out of scope and statistically premature.
- **Live synchronous ranked rooms** — rejected; out of scope, and async fits the
  drafting interaction better than a live-turn system would.
- **Elo or a custom rating formula** — rejected; spec requires genuine Glicko-2, and
  Elo does not model uncertainty (RD) or volatility, both required for placements.
  Batched rating periods from day one — rejected for alpha; population is too small for
  a period to contain "a reasonable number of games," so per-match periods are used and
  clearly labeled as a documented interim choice, versioned for later migration.
- **Fabricating expert-review or live-Supabase-RLS evidence to mark public-beta gates
  "passing"** — rejected outright; the spec and this ADR require these to be reported
  as genuinely absent until real infra/reviewers exist.

---

## Consequences

**Positive:**
- Rating logic is fully isolated from scoring, progression, and matchmaking inputs by
  construction (separate tables, separate service module, one-directional calls).
- The ledger's append-only + replay design means any future dispute is independently
  auditable without trusting the live `queue_ratings` cache.
- Reusing the deterministic board generator and the Challenge hidden-information pattern
  means ranked introduces no new fairness primitive that hasn't already shipped and been
  tested in Phase 1/3.

**Negative / Risks:**
- Per-match rating periods (§7) mean early volatility convergence behavior is closer to
  the algorithm's edge case than its ideal use — mitigated by the Glicko-2 simulation
  harness explicitly measuring this and by keeping the algorithm version bump path open.
- Alpha population size makes divisions, especially MVP/Legend, statistically unstable —
  mitigated by gating their public display on a population minimum.
- Two production gaps inherited from Phase 3 (live Supabase RLS round-trip, live auth
  flow coverage) are prerequisites for closed alpha specifically because ranked data is
  private/competitive; this phase adds the integration-test harness but cannot supply
  the missing live credentials itself.
