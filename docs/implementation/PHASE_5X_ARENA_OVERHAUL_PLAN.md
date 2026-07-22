# Phase 5X — Arena Overhaul Implementation Plan

**Status:** Planning only. No product code authorized by this document
alone (a handful of tiny doc/label corrections are the only exception, per
the task that produced this plan).
**Depends on:** `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` (the "what and
why" — read that first), `docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md`
(still binding), `docs/architecture/PHASE_5_DATA_MODEL.md` (schema design),
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` (the parallel data
track).
**Branch context:** current work is on `phase5-courtbuilder-vertical-slice`
(PR #3, draft, correctly still draft — see report). This plan does not
prescribe a specific new branch name; that's a decision for whoever starts
5X.1, made against whatever `main`/PR state exists at that time.

---

## Sequencing: does database expansion happen before or after the UI overhaul?

**In parallel, with UI/mechanical work (5X.1-5X.3, 5X.5-5X.7) starting
first in practice.** Reasoning:

1. The UI/mechanical fixes (spin ceremony, position slots via the v1
   archetype approximation, deferred reveal, result broadcast) require
   **zero new data** — they work today against the existing 250-player
   pool and the existing interim dataset. They are the cheapest, fastest
   way to find out whether the redesigned loop is actually fun before
   committing to a multi-week data-acquisition project.
2. Database expansion (5X.4 here; full detail in the companion strategy
   doc) is a genuinely different kind of work — sourcing, curating, and
   QA-auditing real historical roster and position data — with a
   different critical path (data acquisition and validation, not
   frontend/backend engineering). It should start immediately and run
   continuously, but its completion should not block 5X.1-5X.3 from
   landing.
3. The two tracks converge at 5X.5 (search/selection quality) and
   specifically at the decision to make team+decade spins the **default**
   public experience (vs. an interim/labeled-narrow mode) — that specific
   milestone *is* gated on expansion coverage meeting the acceptance
   threshold defined in the companion strategy doc (≥5 eligible candidates
   per Competitive-Core team-decade). Until that gate is met, team+decade
   spins can still ship and be played — just visibly labeled as narrow
   coverage, exactly as the current interim dataset already honestly does
   via its `coverage_note` and the frontend's "Interim team data — limited
   coverage" badge.

Net effect: nobody is blocked waiting on the other track, but nobody
claims broad team+decade coverage exists until the data actually backs it
up.

---

## Phase 5X.1 — Arena IA and mode hierarchy cleanup

**Deliverables:**
- Arena landing page redesign per product spec Sec 4.1: single primary CTA,
  Peak Draft/Daily/Ranked collapsed into one visually-secondary "Peak Draft
  (Labs)" section, Peak Hunt placeholder card.
- Remove "Prototype" badge language from CourtBuilder once 5X.1-5X.7's exit
  criteria are met (do this at the *end* of the overhaul, not now — the
  badge is honest today and should stay until the redesign actually ships).
- No route changes — `/arena/court/practice/[mode]` and all existing Peak
  Draft routes stay exactly where they are; this phase is presentation and
  navigation only.

**Files touched:**
- `apps/web/src/app/(main)/arena/page.tsx` (already has the flag-gated
  CourtBuilder nav card from Phase 5C — restructure the whole page's
  hierarchy around it)
- New: a small `LabsSection` or similar component if the Peak Draft
  consolidation needs one (judgment call at implementation time — may not
  need a new component if it's just a layout change to the existing page)

**Tests required:**
- Playwright: landing page shows exactly one primary CTA; Peak Draft modes
  are still reachable via the Labs section; existing `gameplay.spec.ts`
  "Arena landing" tests updated only if the heading/CTA text they assert on
  changes (check `src/tests/e2e/gameplay.spec.ts:54` — `"Which player had"`
  heading assertion — must still pass or be deliberately, visibly updated,
  never silently broken).
- Accessibility: landing page re-audited (existing `accessibility.spec.ts`
  "Arena landing" describe block).

**Acceptance criteria:**
- A first-time visitor can identify the primary action within 2 seconds
  without reading body text (informal, eyeball-tested, not automatable).
- No existing route returns a different status code than before this phase.
- Existing CI baseline stays green.

---

## Phase 5X.2 — True spin/randomizer stage

**Deliverables:**
- Replace `SpinStage.tsx`'s static block with an animated ceremony per
  product spec Sec 3.1 step 1: team ribbon spin → lock, era wheel spin →
  lock, eligible-count reveal (count only, no names).
- Modifier spins (product spec Sec 3.2): "No repeat franchise," "One
  player per decade" — pure board-generation-time constraints, no new data.
- Reduced-motion fallback: instant fade + text reveal, zero information
  loss.
- Animation implemented in CSS transitions/keyframes only — no new
  dependency. If a case is later made for a lightweight animation library,
  it needs its own bundle-size justification separate from this phase.

**Files touched:**
- `apps/web/src/components/court/SpinStage.tsx` (rewritten)
- `nba_peak/perfect_season/board.py` (modifier-spin support — new
  `spin_modifier` field on `SpinPrompt`/board metadata, generated
  deterministically from the existing seed, no schema-breaking change to
  the board shape)
- `nba_peak/perfect_season/schemas.py` (extend `SpinPrompt` with an
  optional `modifier` field)

**Tests required:**
- Frontend unit: reduced-motion variant renders the same final state as
  the animated variant (no content difference, only timing).
- Playwright: spin ceremony completes and reaches the candidate stage
  within a bounded time (assert on the *end* state, not the animation
  itself — animations are exactly the kind of thing that makes Playwright
  specs flaky if asserted on directly, per this task's own "flaky test
  waits" audit concern).
- API: modifier-spin board generation is deterministic from seed (mirrors
  existing `test_board_generation_is_deterministic_from_seed`).

**Acceptance criteria:**
- Spin-to-candidates transition completes in under 2 seconds (product spec
  Sec 3.2 budget).
- `prefers-reduced-motion` respected, verified in at least one Playwright
  test with the media feature emulated.
- No score/rank/name leaks during the spin animation before the eligible
  count reveal (a11y tree + DOM text content check, extending the existing
  score-hiding test pattern from `test_perfect_season.py` /
  `courtbuilder.spec.ts`).

---

## Phase 5X.3 — Position-aware CourtBuilder slots

**Deliverables:**
- Slot semantics change: `starter_1..5` → `PG/SG/SF/PF/C`; `bench_1..3` →
  `sixth_man/defensive_specialist/wildcard` (product spec Sec 6.1).
- Archetype→position v1 mapping (product spec Sec 6.4b) implemented as a
  pure function, clearly labeled as an approximation in its own docstring
  and in any user-facing "why eligible" text.
- Slot-first round flow: player picks which open slot to fill *before*
  seeing candidates (product spec Sec 3.1 step 2) — this changes
  `action_select_player`'s calling convention (needs a target slot up
  front) rather than the current select-then-place two-step.
- Court UI: real half-court graphic (SVG or styled divs), starters at
  position-relative locations, bench in a distinct rail.
- Off-position placement stays legal (never blocked), now surfaces a
  visible plain-language fit note instead of being silently free.

**Files touched:**
- `nba_peak/perfect_season/config.py` (`SLOT_TYPES` renamed/restructured —
  breaking change to the constant's values, not its count; every reference
  needs updating, not just the constant)
- `nba_peak/perfect_season/schemas.py` (`CourtSlot.slot_type` semantics)
- `nba_peak/perfect_season/board.py` (new position-mapping module, likely
  `nba_peak/perfect_season/positions.py`, keeping `board.py` focused)
- `apps/api/app/services/perfect_season/state.py` (round flow reorder:
  slot-first instead of card-first; eligibility check now also validates
  position fit, not just "not already used")
- `apps/api/app/models/perfect_season.py` (request/response shape changes
  for the reordered flow)
- `apps/web/src/components/court/CourtBuilder.tsx`, `PeakCardCourt.tsx`
  (rewritten for court-relative layout), new `CourtLayout.tsx`
- `apps/web/src/types/perfect-season.ts` (`SlotType` union updated)

**This is a breaking change to the Phase 5C API contract.** Since
`COURTBUILDER_ENABLED` defaults to `False` and nothing has shipped to real
users yet (per ADR-005 Decision 7's own "byte-for-byte unchanged until
flipped" guarantee), this is safe to do as a direct rewrite rather than a
versioned migration — confirm this is still true (no `COURTBUILDER_ENABLED=True`
deployment exists anywhere) before starting.

**Tests required:**
- API: position eligibility (primary/secondary/off-position-with-penalty)
  for every archetype; slot-first flow state transitions; regression that
  "same identity cannot be used twice" and "unconventional lineups remain
  legal" (existing tests) still hold under the new slot semantics.
- Frontend unit: archetype→position mapping pure function, exhaustively
  tested against all 5 archetypes.
- Playwright: full run using real position names in assertions (replacing
  `starter_1`/`bench_1` locators with `PG`/`sixth_man` etc.); off-position
  placement produces a visible fit note, not a blocked action.
- Accessibility: court graphic has an accessible list-view equivalent
  (product spec Sec 4.4), tested via axe + a manual screen-reader-order
  assertion (DOM order matches logical roster order).

**Acceptance criteria:**
- Every one of the 5 archetypes maps to exactly one primary + 0-2
  secondary positions, documented and tested.
- Off-position placement is always legal, never returns an error.
- At least 3 deliberately unconventional lineups (product spec's own bar,
  carried over from Phase 5C's acceptance criteria) remain completable.
- Existing CI baseline stays green; this phase's own new tests pass.

---

## Phase 5X.4 — Player database expansion plan to 500

**This phase is the parallel data track — see
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` for the full plan.**
Summarized here only for sequencing context:

**Deliverables (from the strategy doc, not re-derived here):**
- Cohort-based candidate list for the 250→500 expansion, auditable and
  reviewable before any data is scraped.
- Position field (`primary_position`/`secondary_position`) sourced per
  player-season — a new field, not currently present anywhere in the
  pipeline (verified this session — same gap ADR-005 already documented
  for team affiliation, extended here to cover position too).
- Team-season roster membership data for the expanded pool, following the
  `nba_peak/data_complete.py` scrape-once/cache/never-scrape-at-request-time
  pattern already established for award votes and team shares.
- QA/audit process (duplicate detection, minimum-candidates-per-team-decade
  threshold, manual exception review) before any of it reaches gameplay.

**Files touched:** primarily new `nba_peak/`/`data/generated/` pipeline
code and `scripts/` — see the strategy doc's own file list.

**Gating relationship to other phases:** does not block 5X.1-5X.3, 5X.5-5X.7.
Gates only the decision to make team+decade spins the **default** (as
opposed to labeled-narrow-coverage) experience — see the "Sequencing"
section above.

---

## Phase 5X.5 — Improved search/card selection

**Deliverables:**
- Card-based candidate UI (product spec Sec 4.2) replacing the current
  plain-button list — larger touch targets, position badge, qualitative
  trait tags (derived from existing `LineupDNA` thresholds, e.g.
  "Elite Passer" from high `primary_creation`), team/era context.
- Search/filter behavior scales correctly once candidate pools grow past
  the current 1-3 (Phase 5X.4 dependency for *content*, not for the UI
  component itself, which should be built and tested against synthetic
  larger candidate lists in the meantime).
- Trait-tag vocabulary is a small, fixed, versioned list (avoid an
  unbounded tag system that becomes its own maintenance burden) — derive
  from existing `LineupDNA` dimensions plus the new position data, not
  from freeform scouting text.

**Files touched:**
- `apps/web/src/components/court/EligiblePlayerSearch.tsx` (rewritten as
  card-based), new `CandidateCard.tsx`
- `nba_peak/perfect_season/board.py` or a new `traits.py` (qualitative
  trait derivation from existing DNA thresholds)

**Tests required:**
- Frontend unit: trait derivation is a pure function, tested against known
  DNA inputs → expected trait sets.
- Playwright: search/filter still returns correct results with larger
  synthetic candidate lists (10+, to stress-test beyond today's 1-3);
  score-hiding contract re-verified on the new card component (no
  regression of the Phase 5C hardening pass's core guarantee).
- Accessibility: card grid/list is screen-reader-navigable, trait tags
  have text alternatives (not color-only).

**Acceptance criteria:**
- No numeric score/rank anywhere in the candidate UI, verified by the same
  API + frontend + E2E triple-check pattern already established in Phase
  5C (`test_current_spin_candidates_never_expose_score_or_rank` and its
  Playwright equivalent).
- Trait tags are derived, versioned, and documented — never hand-authored
  per player (would violate the "no manual scouting without provenance"
  discipline already established for attributes in the master plan §10.4).

---

## Phase 5X.6 — Lineup-fit engine v1

**Deliverables:**
- Extend `nba_peak/perfect_season/simulation.py::LineupFitComponents` and
  `compute_fit_components` with the position-aware bonuses/penalties from
  product spec Sec 6.3/6.4.
- Reuse `nba_peak/lineup/config.py::SYNERGY_RULES`'s existing pattern and,
  where a rule already exists there (`creator_anchor_balance`,
  `creation_overload`, `no_lead_creator`, `no_anchor`, `scoring_desert`,
  `scoring_depth`, `validation_core`), **extend it to CourtBuilder's
  8-slot position-aware context rather than re-deriving equivalent logic
  from scratch.** New rules (too small, too slow, no bench creation, rim
  pressure, switchable defensive group) are net-new but follow the exact
  same declarative rule shape.
- Every "too small"/"too slow" rule ships with an explicit data-constraint
  disclosure in its description field (no real height/weight/speed data
  exists — these are archetype-mix proxies, not measurements), matching
  the existing honesty pattern in `docs/model/LINEUP_DNA_V2.md`.

**Files touched:**
- `nba_peak/perfect_season/simulation.py` (extended)
- `nba_peak/perfect_season/config.py` (new rule constants, mirroring
  `nba_peak/lineup/config.py::SYNERGY_RULES`'s shape)
- Possibly a new shared module if enough rule logic is genuinely
  reusable between Peak Draft's lineup model and CourtBuilder's — evaluate
  at implementation time; do not force a shared abstraction prematurely if
  the two contexts (5-role vs. 8-slot-position) diverge enough that a
  shared module would need more conditionals than it saves.

**Tests required:**
- Unit tests for every new/extended rule: a synthetic lineup that should
  trigger it, and one that shouldn't, per rule (mirrors the rigor of
  existing Peak Draft synergy-rule tests).
- Regression: existing `test_perfect_season.py` fit-component tests still
  pass with the extended component set (field additions, not removals —
  should be additive to `LineupFitComponents`' dataclass).
- Adversarial: fuzz a large number of random valid 8-slot rosters and
  confirm no rule ever produces a nonsensical (NaN, wildly out-of-range)
  score — same discipline as the existing `scripts/check_board_generation.py`
  smoke check, extended to fit-scoring rather than just board validity.

**Acceptance criteria:**
- Every bonus/penalty in product spec Sec 6.3/6.4 is implemented, tested,
  and displayed with a plain-language description at the broadcast reveal.
- No component is ever a single opaque number without a label (ADR-005
  Decision 4, unchanged).

---

## Phase 5X.7 — Result / reveal / share screen

**Deliverables:**
- Broadcast reveal sequence (product spec Sec 3.1 step 7): full roster
  score reveal → fit breakdown → record count-up → loss timeline → framing
  → share card.
- **API contract change:** `slots[]` no longer includes
  `individual_peak_score`/`individual_peak_rank` until
  `status == "result_ready"` — even for already-filled slots mid-run. This
  is the single change that fixes the "answer-key" complaint (product spec
  Sec 1.2/3.5). Requires updating `state.py::get_public_state` and every
  test that currently asserts scores appear on locked slots mid-run
  (`test_placed_slots_do_reveal_score_once_locked` needs to be
  **rewritten**, not just extended — its current assertion is exactly the
  behavior this phase removes).
- Loss timeline: pseudo-random distribution of losses across an 82-slot
  strip, deterministic from the board seed, explicitly labeled as
  presentational (product spec Sec 3.6) — not a claim of 82 individually
  simulated games.
- Share card: static image (implementation detail — server-side render via
  an image library, or client-side canvas — decide based on what's
  actually available in the stack without adding a heavy new dependency;
  this is a real open implementation question, not pre-decided here).

**Files touched:**
- `apps/api/app/services/perfect_season/state.py` (reveal-timing contract
  change)
- `apps/web/src/components/court/SeasonResultStub.tsx` → rewritten as
  `ResultBroadcast.tsx`, new `LossTimeline.tsx`, new `ShareCard.tsx`
- `apps/api/tests/test_perfect_season.py` (rewrite the mid-run score
  visibility test to assert the *new*, opposite contract)
- `apps/web/src/tests/e2e/courtbuilder.spec.ts` (same)

**Tests required:**
- API: exact-score/rank absent from `slots[]` for every status except
  `result_ready` — new test, and the old contrary test removed/rewritten
  (do not leave both asserting opposite things).
- Playwright: full run confirms zero numeric score/rank anywhere until the
  broadcast reveal begins; share card generation succeeds and contains no
  spoiler list of "optimal" alternatives (product spec Sec 3.7).
- Visual/manual: broadcast sequence is skippable, and skipping still
  leaves the full breakdown reachable afterward (no information loss from
  skipping, only animation time).

**Acceptance criteria:**
- The single most important regression test in this whole overhaul: **no
  score or rank is visible anywhere before `status == "result_ready"`,
  full stop** — verified at the API, frontend-render, and E2E layers, the
  same triple-check discipline already used for pre-selection hiding in
  Phase 5C, now extended to cover the entire run, not just the moment
  before each pick.

---

## Phase 5X.8 — Daily 82 and leaderboard (later)

Not started in this overhaul. Placeholder phase number preserved for
continuity with the original Phase 5 roadmap
(`docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md` §10's own "5D" row covered
this exact scope before this overhaul plan reused the "5D" prefix for a
different purpose — **naming collision, flagged explicitly**: the original
roadmap's "Phase 5X — Daily 82 and result sharing" is renumbered here as
5X.8 to fit inside this document's own phase sequence; anyone cross-
referencing the original roadmap table should treat this document's 5X.8
as that same scope, now sequenced after the overhaul rather than
immediately after Phase 5C).

**Deliverables (unchanged from the original roadmap row, restated for
continuity):** daily immutable boards, official/practice attempt split,
global/friends leaderboards, streaks, Locker Room shelves, playable
challenge links, archive. Requires the `result_snapshots`/`daily_completions`
schema work explicitly deferred in `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`
§0 item 2 (those tables carry Peak-Draft-specific `NOT NULL` columns that
don't fit CourtBuilder without an actual migration).

**Not scoped further in this document** — write a dedicated implementation
doc when this phase actually starts, grounded in whatever the overhaul
(5X.1-5X.7) actually shipped, not speculatively now.

---

## Phase 5X.9 — Ranked/multiplayer (later)

Not started in this overhaul. Depends on 5X.8 (needs durable history) and
on 82-0 proving repeat-play value in real usage first, per master plan
§18.9's sequencing discipline (still binding, unchanged). Not scoped
further in this document for the same reason as 5X.8.

---

## Technical architecture summary

### What reuses current CourtBuilder code as-is

- Feature-flag pattern (`COURTBUILDER_ENABLED`/`COURTBUILDER_TEAM_SPIN_ENABLED`/
  `COURTBUILDER_ALPHA_ALLOWLIST`/`COURTBUILDER_READINESS_LEVEL`) — no
  changes needed, new sub-flags are additive (see below).
- `CourtLineupRepository` + the `games` table reuse pattern (Phase 5C
  established this requires zero migrations; still true — the overhaul
  changes payload *shape*, not storage *mechanism*).
- Board seed derivation and the backtracking feasibility check
  (`_can_assign_distinct` in `board.py`) — directly reusable, position
  constraints are an additional filter on top, not a replacement algorithm.
- `owner_sub`/`resolve_owner_sub` anonymous-identity flow — unchanged.
- The existing `SYNERGY_RULES` declarative pattern in
  `nba_peak/lineup/config.py` — extended, not replaced.

### What gets rewritten

- `SpinStage.tsx` → full rewrite (animation state machine).
- `EligiblePlayerSearch.tsx` → full rewrite (card-based, position-aware).
- `PeakCardCourt.tsx`/`CourtBuilder.tsx` → substantial rewrite (court-
  relative layout, slot-first flow).
- `SeasonResultStub.tsx` → full rewrite as `ResultBroadcast.tsx`.
- `state.py::get_public_state`'s reveal-timing logic — the single most
  consequential backend rewrite in this plan.
- `nba_peak/perfect_season/config.py::SLOT_TYPES` — restructured (position
  semantics).

### What gets deleted later, not now

- The `starter_N`/`bench_N` slot-type strings, once 5X.3 ships and nothing
  references the old values (grep-verify zero remaining references before
  deleting, including in test fixtures and any committed example JSON).
- Nothing else — this overhaul is additive/rewrite, not a deletion pass.
  Peak Draft stays fully intact per ADR-005 Decision 2, unchanged by this
  plan.

### New feature flags for overhaul stages

Extend the existing `COURTBUILDER_*` settings rather than inventing a
parallel flag family:

```python
COURTBUILDER_POSITION_SLOTS_ENABLED: bool = False
    # Gates 5X.3's slot-semantics change. Independent of
    # COURTBUILDER_ENABLED so 5X.1/5X.2 can ship and be tested with the
    # old slot shape still active if 5X.3 isn't ready yet.

COURTBUILDER_DEFERRED_REVEAL_ENABLED: bool = False
    # Gates 5X.7's reveal-timing contract change specifically -- kept
    # separate from COURTBUILDER_POSITION_SLOTS_ENABLED because these two
    # phases have independent risk profiles and either could need to ship
    # or roll back without the other.
```

Do not add a flag per sub-phase mechanically — 5X.1 (IA), 5X.2 (spin
animation), 5X.5 (card UI), and 5X.6 (fit engine) are presentation/content
changes with no meaningful "off" state once `COURTBUILDER_ENABLED` is on;
flagging them separately would add validation-matrix complexity (per the
existing `@model_validator` consistency-checking pattern in `config.py`)
without a real rollback benefit.

### Backend services needed

- Position-eligibility resolver (`nba_peak/perfect_season/positions.py`,
  new).
- Extended lineup-fit engine (Sec 5X.6).
- Trait-tag derivation (Sec 5X.5).
- Loss-timeline distribution function (deterministic, presentational, Sec
  5X.7).
- Share-card generation (Sec 5X.7 — implementation approach TBD at that
  phase).

### Frontend components needed

`SpinCeremony` (replaces `SpinStage`), `CourtLayout` (new, position-
relative court graphic), `CandidateCard` (replaces the button list inside
`EligiblePlayerSearch`), `ResultBroadcast` (replaces `SeasonResultStub`),
`LossTimeline` (new), `ShareCard` (new). `LineupInsightPanel` survives with
extended fields, not a rewrite.

### Test strategy across the whole overhaul

- Every phase above lists its own required tests; the cross-cutting rule
  is: **the reveal-timing contract (5X.7) gets the same triple-check rigor
  (API assertion + frontend render assertion + Playwright E2E assertion)
  that the pre-selection hiding contract already has from Phase 5C** — this
  is the single highest-value regression surface in the entire overhaul.
- Existing Peak Draft test suites (`gameplay.spec.ts`, `test_draft.py`,
  etc.) must stay green throughout — this overhaul touches zero Peak Draft
  code, so any failure there indicates an accidental regression, not
  expected fallout.
- Full CI baseline (model + API + frontend + Playwright) re-verified at the
  end of each numbered sub-phase before starting the next, not just once
  at the end of the whole overhaul — catches regressions close to their
  cause.
