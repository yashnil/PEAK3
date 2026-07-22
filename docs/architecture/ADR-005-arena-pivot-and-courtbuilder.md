# ADR-005 — Arena Flagship Pivot: 82-0 Peak Season and the CourtBuilder Foundation

**Status:** Accepted
**Date:** 2026-07-22
**Deciders:** PEAK3 Engineering
**Branch:** `phase5-courtbuilder-prototype`

---

## Context

PR #1 (Phases 2–4: Daily boards, durable identity, progression, and ranked
internal alpha) is squash-merged into `main`. CI baseline on `main` before
this branch was 8/8 green. `docs/implementation/CURRENT_PROJECT_STATE.md`
and `docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md` both independently concluded
the same thing: the underlying platform (deterministic board generation,
exact peak-window cards, durable auth/history/progression, ranked queue +
Glicko-2, Supabase/Postgres schema and RLS, CI/Playwright harnesses) is
sound, but the current flagship interaction — a three-offer, five-role Peak
Draft that reveals rating/rank before the user chooses — is not compelling
enough to remain the long-term flagship. `docs/product/PEAK3_GAME_PLATFORM_MASTER_PLAN.md`
§1–2 documents the specific, concrete failure modes (optimal play collapses
to "click the largest visible number," hard role slots create dead ends, no
visible opponent or season narrative, a tested flow produced a
result-loading failure after draft completion) and recommends 82-0 Peak
Season as the new accessible front door (§6, §18.1).

This ADR is written before any CourtBuilder UI code, per the master plan's
own operating contract (§23.1: "read this plan's relevant mode and engine
sections... before implementing a major feature") and per
`PEAK3_NEXT_AMBITIOUS_STEPS.md` §10's Phase 5A deliverable ("ADR documenting
the flagship pivot... before any code changes").

**A concrete grounding gap surfaced while researching this ADR, not present
in any of the source docs:** none of the current data pipeline outputs carry
team-affiliation data. `data/generated/player_season_context.parquet` (47
columns), `data/generated/team_shares.csv`, `leaderboards/*.csv`,
`data/web/peak_windows.json`, and `data/game/profiles/card_profiles.v3.json`
all lack a team-name or team-ID field entirely — `card_profiles.v3.json`'s
`eligible_roles`/`primary_role` are lineup-archetype roles (`lead_creator`,
`guard_wing`, etc.), not NBA team-roster membership. This means Phase 5B is
not "add a schema over existing team data" — it is schema design **and**
net-new data acquisition with no existing source to migrate from. This is
reflected in `docs/architecture/PHASE_5_DATA_MODEL.md`'s open questions and
directly shapes Decision 5 below (identity/card separation) and the Phase 5B
scope in the vertical-slice checklist.

---

## Decisions

### 1. 82-0 Peak Season becomes the flagship anonymous/quick-play loop

**Decision:** 82-0 Peak Season (master plan §6) is the primary entry point
for new and anonymous users going forward. It replaces Peak Draft as "the
game PEAK3 leads with" in navigation, marketing, and the home page's primary
call to action once Phase 5C ships behind its feature flag and clears the
exit gates in `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`.

**Rationale:** Matches the master plan's launch hierarchy (§1.3, priority 1)
and the bridge doc's north star (§2, §4). 82-0's core loop — spin a
team+era, pick one eligible player, place him, repeat, see a record — is
independently legible in one sentence and does not require the user to
understand PEAK3's five-component scoring model before playing, unlike Peak
Draft's current visible-rating mechanic.

**Rejected:** Making PEAK3 Forge or Draft Duel the flagship instead —
rejected because both require either a validated attribute model (Forge,
master plan §10, not yet built) or a live-matchmaking population (Duel) that
does not exist yet. 82-0 is solo, anonymous-friendly, and buildable on
existing card infrastructure, matching master plan §18.9's sequencing
discipline ("do not begin Draft Night, War Room, or Forge until the 82-0
loop proves repeat-play value").

### 2. Current Peak Draft is retained as Legacy/Labs, not deleted

**Decision:** Peak Draft (`/arena/practice/[mode]`, `/arena/daily/[mode]`,
`/arena/ranked/[mode]`, `/arena/results/[id]`) remains fully reachable and
fully functional. It is re-labeled/re-routed under a Legacy or Labs surface
in navigation once 82-0 ships, but no route, API endpoint, repository, or
test for it is removed in this phase or in Phase 5C.

**Rationale:** Explicit user instruction for this task, and consistent with
master plan §19.4 ("do not keep it as the homepage's main game merely
because it already exists" — but also do not delete it) and §2.2's
inventory of infrastructure Peak Draft's continued operation still exercises
in production: ranked queue, Glicko-2, the daily-board pipeline, challenge
links, and durable history/progression all currently run through Peak Draft
routes. Deleting it would silently stop exercising all of that Phase 4
machinery in real traffic. This directly satisfies the durably-recorded
project constraint: **do not delete Peak Draft.**

**Rejected:** Deleting Peak Draft once 82-0 ships — rejected, both by
explicit instruction and because it is the only mode currently exercising
ranked/Glicko-2/progression end-to-end; removing it before Draft Duel
(master plan §8, roadmap Phase 5F) exists would leave that infrastructure
untested by real usage for multiple phases.

### 3. PEAK3 individual score remains canonical

**Decision:** `OFFICIAL_WEIGHTS` and `calibrate_score()` in `peak3.py`
remain the sole authoritative individual player-peak rating. Nothing in
Phase 5A/5B/5C modifies scoring math, weights, or the committed
`leaderboards/*.csv` files. `prime_score`/`prime_index` remain the only
canonical display values; CourtBuilder consumes them read-only through the
existing `data/web/` export pipeline exactly as Peak Draft does today.

**Rationale:** Restates the pre-existing, non-negotiable `CLAUDE.md` rule
("Never change these without explicit approval and passing regression
evidence... Calculate PEAK3 scores in TypeScript/Next.js" is listed under
"Never do these") and the bridge doc's §8 simulation/scoring contract. This
ADR does not weaken or restate that rule with new exceptions — it exists
here only so CourtBuilder's design (Decisions 4–6 below) has an explicit
anchor to build on top of, not around.

**Rejected:** Any per-mode scoring variant that recomputes or approximates
`prime_score` for gameplay convenience — rejected outright; lineup-fit and
simulation scores (Decision 4) must be additive, never a replacement metric
computed client-side or with different weights.

### 4. Lineup/synergy/simulation models are experimental and separately versioned

**Decision:** Lineup-fit, chemistry, and season/series simulation (master
plan §5.6–5.7, §12) are implemented as a distinct, explicitly-labeled
experimental layer with their own version identifiers
(`lineup_model_version`, `simulator_version` — see `PHASE_5_DATA_MODEL.md`'s
`lineup_score_snapshot` entity), never merged into or presented as a
decomposition of the canonical PEAK3 score. Every user-facing simulation or
fit result must disclose its model version and, where applicable, an
uncertainty range — never presented with false scientific certainty (master
plan §5.7: "not a scientific claim that a hypothetical roster would
literally win a given number of NBA games").

**Rationale:** The codebase already has precedent for this exact separation
— `nba_peak/lineup/` (`LineupDNA`, `LineupEvaluation`, `synergy.py`,
`solver.py`) is already versioned and already kept separate from `peak3.py`
for Peak Draft's lineup evaluation. Phase 5C extends this existing pattern
to CourtBuilder rather than inventing a new one.

**Rejected:** Folding lineup-fit into `prime_score` for a single unified
"how good is this pick" number — rejected; this is precisely the mechanic
the pivot is moving away from (Decision 6), and it would violate the
existing model-authority boundary.

### 5. Exact player/season/peak-card identity is separated from display cards

**Decision:** Per `PHASE_5_DATA_MODEL.md`, `player_identity` (the real
person), `peak_card` (an exact, versioned scored window), and
`peak_card_team_affiliation` (which team-season context a card is being
presented under) are three distinct entities, never collapsed into one
denormalized "card" row the way `card_profiles.v3.json` currently is. A
given `player_identity` can have many `peak_card`s (1Y/3Y/5Y/playoff, per
master plan §11.2); a given `peak_card` can be presented under different
`peak_card_team_affiliation` contexts depending on which team-decade or
exact team-season spin resolved it.

**Rationale:** Directly required by 82-0's core resolution mechanic (master
plan §5.3: "Chicago Bulls + 2010s + Derrick Rose resolves to 2010-11 Derrick
Rose"), which needs to answer "which of this player's cards is eligible
under this specific team+era context" — a question the current flat
`peak_windows.json`/`card_profiles.v3.json` shape cannot answer because it
carries no team dimension at all (see Context, above). This is also the
schema precondition for Phase 5B's player-universe expansion (master plan
§11.2's "identity and card layers must remain separate").

**Rejected:** Extending `card_profiles.v3.json` in place with an ad hoc team
field — rejected; it would conflate two different versioning lifecycles
(peak-score versioning vs. team-membership-data versioning) in one file and
block the identity/card separation Phase 5B explicitly requires.

### 6. No exact PEAK3 score or rank is shown before user selection in the flagship mode

**Decision:** In 82-0 (and any future official/ranked/daily attempt of it),
the eligible-player search and selection UI never displays the exact
`prime_score`, `prime_index`, or all-time rank of a candidate before the
user locks in their pick. Archetype/trait badges, position, and
"why eligible" context may be shown; the exact number and rank may not.
Score and rank become visible only after the pick is locked, exactly as
specified in master plan §6.4 and restated in the bridge doc §4.

**Rationale:** This is the single mechanical fix for the pivot's core
complaint (Decision 1's context): Peak Draft's current defining failure is
that the optimal action is "click the largest visible number." Hiding the
score is not a UI preference here — it is the mechanism that turns card
selection back into a basketball-knowledge decision.

**Rejected:** Showing an approximate tier/band instead of hiding entirely —
considered (master plan §21 open decision 2 lists this as a real
alternative) but explicitly deferred; the master plan's own recommendation
is "no [reveal] in official modes; reveal after lock," and this ADR adopts
that recommendation rather than reopening it for Phase 5C.

### 7. CourtBuilder ships behind feature flags

**Decision:** All Phase 5C CourtBuilder routes, API endpoints, and UI entry
points are gated behind an explicit feature-flag contract, following the
exact pattern already established for ranked in `apps/api/app/core/config.py`
(`RANKED_ENABLED`/`RANKED_MATCHMAKING_ENABLED`/etc. as independent boolean
capability switches, plus a human-facing `RANKED_READINESS_LEVEL` enum
validated for internal consistency). See
`docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md` for the exact
flag names and their validated states. Until the flag is enabled, existing
navigation, routes, and CI behavior are completely unaffected.

**Rationale:** Matches the explicit user instruction ("CourtBuilder ships
behind feature flags") and reuses a pattern that is already tested,
documented, and understood by this codebase rather than inventing a second
feature-flag mechanism. It also lets Phase 5C land incrementally on `main`
without exposing an unfinished flagship experience to real users, mirroring
how ranked shipped through `internal_alpha` → `closed_alpha` → `public_beta`
readiness levels (ADR-004 §18).

**Rejected:** A separate long-lived feature branch instead of flagged
trunk-based merges — rejected; the existing ranked rollout already
demonstrated flagged merges to `main` work for this codebase and avoid a
large, high-conflict-risk branch divergence.

### 8. Hosted Supabase is not touched in this phase

**Decision:** Phase 5A/5B/5C work exclusively against the local Supabase
stack (`supabase start`/`db reset`, as established in Phase 4.0A). No
`supabase link`, no `supabase db push` against a remote project, no
hosted-project credentials introduced, no production `.env` or secrets
modified. Any new migrations for Phase 5B schema entities (§`PHASE_5_DATA_MODEL.md`)
are designed in this phase but not written as executable migration files
yet, per this task's explicit scope.

**Rationale:** Restates the explicit user instruction and the precedent set
by Phase 4.0A §1 ("Confirmed before any work began: ... no hosted-project
reference anywhere in the repo or shell environment... At no point in this
phase was `supabase link` ... run"). Keeping this invariant explicit in an
ADR (rather than only in task instructions) means future agents reading this
document inherit the constraint without needing the original task prompt.

**Rejected:** Standing up a hosted Supabase project for Phase 5B schema
validation — rejected; the local stack has already been proven sufficient
for schema/migration validation through Phase 4.0A (`scripts/validate_migrations.py`,
`scripts/migration_inventory.py`, real `supabase db reset` runs), and
nothing about the new entities requires hosted infrastructure to design or
validate.

---

## Alternatives considered

- **Ship CourtBuilder as a full replacement, retiring Peak Draft
  immediately** — rejected; violates the explicit "keep Peak Draft
  reachable" instruction and master plan §18.9's sequencing discipline.
- **Reveal PEAK3 scores in an approximate tier before selection** — rejected
  for this ADR's scope; see Decision 6.
- **Compute lineup-fit/simulation scores by extending `peak3.py`'s
  weighted-sum model directly** — rejected; violates the canonical-score
  boundary (Decision 3) and the existing `nba_peak/lineup/` separation
  precedent (Decision 4).
- **Defer the identity/card separation until Phase 5B's migrations are
  written** — rejected; the separation is a modeling decision that the
  vertical slice's API shape depends on (Decision 5), so it needs to be
  decided now even though the migrations themselves are out of scope for
  this pass.

## Consequences

**Positive:**
- Every subsequent Phase 5 implementation doc (`PHASE_5_DATA_MODEL.md`,
  `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`) can cite this ADR instead of
  re-litigating these eight decisions.
- Reusing the existing feature-flag and model-versioning patterns
  (Decisions 4, 7) means Phase 5C introduces zero new architectural
  primitives — only new domains within primitives that are already tested.
- Explicitly recording the team-data gap (Context) means Phase 5B's actual
  scope — net-new data acquisition, not just schema design — is visible to
  whoever picks up that phase, instead of being discovered mid-implementation.

**Negative / Risks:**
- Decision 5's identity/card separation is a real modeling investment before
  any UI ships; if Phase 5C's vertical slice needs to move faster than
  Phase 5B's schema can be finalized, the slice may need to start against a
  narrower, hand-curated interim card set (see `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`
  non-goals).
- Keeping Peak Draft fully reachable (Decision 2) means two flagship-shaped
  surfaces exist in navigation simultaneously for some period, which is a
  real product-clarity cost the master plan's §4.2 navigation redesign will
  need to resolve, not just an engineering one.
- No team-affiliation source data exists yet (Context) — Phase 5B cannot
  complete `team_season`/`team_season_roster_member` population without a
  new data-acquisition step this ADR does not itself resolve.
