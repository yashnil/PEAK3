# PEAK3 Arena Overhaul — Product Spec

**Status:** Product spec, no product code authorized by this document alone.
**Supersedes, for CourtBuilder specifically:** parts of
`docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`, which shipped
a technical scaffold (see that file's own added note) that proved the game
grammar end-to-end but is not fun enough to be the flagship as-is.
**Does not supersede:** `docs/product/PEAK3_GAME_PLATFORM_MASTER_PLAN.md`
(still the long-range source of truth) or `docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md`
(its 8 decisions all still hold — this spec extends them, contradicts none).
**Companion docs:** `docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`
(engineering phases) and `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`
(database expansion).

---

## 0. Why this document exists

PR #3 (`phase5-courtbuilder-vertical-slice`) shipped a working, fully tested
CourtBuilder vertical slice. It is honest, flag-gated, and does not lie
about its own limitations. It is also, on manual review, not fun. This
document is a hard look at *why*, grounded in the actual shipped code and
actual interim data, not a restatement of the original design intent.

## 1. Audit: is the current build actually a game?

### 1.1 What is the player trying to optimize, today?

Nominally: an 82-0 record. Practically: whatever the v0 simulator's
`talent_core`-dominated heuristic rewards, which the player cannot see or
reason about mid-run (fit components are only shown after the full 8-round
attempt completes). There is no visible objective feedback loop during
play — you make 8 picks blind to their systemic effect, then get one
number at the end. That is not "optimize," that is "guess and see."

### 1.2 What creates suspense today? (Answer: almost nothing.)

- The spin is a static text block (`SpinStage.tsx`) — franchise name, era
  label, one sentence of instructions. No animation, no build-up, no
  moment. `npm run build`'s own bundle size for the route (3.35 kB) reflects
  how little is actually there.
- The candidate list is frequently **one or two names**. A "spin" that
  resolves to a single legal candidate isn't a decision, it's a formality.
  Verified directly against the committed interim dataset
  (`data/game/interim/courtbuilder_team_seasons.v0.json`) this session:

  | Spin | Candidates |
  |---|---|
  | San Antonio Spurs · 1990s | **1** (David Robinson only) |
  | Golden State Warriors · 2015-16 | **1** (Curry only) |
  | Los Angeles Lakers · 2000s | 2 |
  | San Antonio Spurs · 2000s | 2 |
  | Golden State Warriors · 2010s | 2 (missing Klay Thompson, Draymond
    Green, Andre Iguodala entirely — none are in the 250-player pool) |
  | Chicago Bulls · 1990-91 | 2 |
  | Chicago Bulls · 1990s | 3 |
  | Los Angeles Lakers · 1980s | 3 |
  | Boston Celtics · 1980s / 2000s | 3 each |

  Average: **2.4 eligible candidates per spin.** A game whose core verb is
  "choose" doesn't work when half its prompts don't offer a real choice.
- The score/rank reveal happens **immediately after every single
  placement**, not at the end of the run. This is the mechanic ADR-005
  Decision 6 was designed to protect against reappearing — and it has
  reappeared in a subtler form. Hiding the score *before* a pick stops you
  from clicking the biggest number, but revealing it *right after* every
  pick still turns the 8-round run into 8 independent trivia checks
  ("was I right?") instead of one connected roster-building decision under
  uncertainty. There is no tension carried across rounds, because every
  round resolves and closes immediately.

### 1.3 What creates replayability today? (Answer: very little.)

Eight franchises, mostly the same handful of inevitable Hall-of-Famers,
resolved through a flat list-of-buttons UI with a "Prototype" badge visibly
telling the player this isn't finished. There's no reason to run it twice —
the spin pool is small enough to be memorized in one sitting, and the
result screen (`SeasonResultStub.tsx`) is static text with a progress-bar
component, not a moment worth chasing again.

### 1.4 What creates skill expression today? (Answer: almost none.)

Slot placement is fully positionless (`starter_1`..`starter_5`,
`bench_1`..`bench_3` are just labels — see `nba_peak/perfect_season/config.py::SLOT_TYPES`).
Any player fits any slot with zero mechanical consequence beyond the
after-the-fact `role_overlap_penalty` in `simulation.py`, which the player
never sees while deciding. There is no lineup-construction tension (guard
vs. big, shooting vs. defense, ball-dominant vs. connective) because
nothing in the interface asks the player to reason about it.

### 1.5 Peak Draft, Daily, and Ranked — same root cause, different symptom

Peak Draft's problem (documented in the master plan §2.1 and ADR-005's own
Context) is visible scores turning selection into "click the biggest
number." CourtBuilder's problem is the inverse failure mode of the same
underlying issue: hiding the number *without* giving the player enough real
candidates or enough legible structure (positions, fit feedback, stakes)
to make hiding it feel like a meaningful decision instead of an arbitrary
one. Both modes currently fail the same test: **a first-time player cannot
articulate a strategy after five minutes of play**, because neither mode
gives them enough legible levers to reason about.

### 1.6 The "one more run" test

None of the current modes pass it. This spec's job is to make at least one
of them pass it — 82-0 Peak Season, per ADR-005 Decision 1, remains the
right flagship candidate; it just needs the actual game design work that
was deferred to ship the vertical slice honestly on schedule.

---

## 2. Product north star (restated, sharpened)

> PEAK3 Arena is a basketball strategy game where you build a roster from
> exact historical NBA peaks under real positional and chemistry
> constraints, without knowing the exact numbers until the reveal, and
> chase a perfect season.

The differentiator is not "hidden numbers" alone (any game can hide
numbers) — it's that the numbers being hidden are a **real, versioned,
defensible model** (PEAK3's canonical score), and the constraints being
navigated are **real basketball structure** (position, era, team context),
not arbitrary game-design abstractions. Losing sight of either half of that
is what makes the current build feel like a data-science demo wearing a
game's clothes.

---

## 3. CourtBuilder / 82-0 Peak Season — full loop redesign

### 3.1 The redesigned round flow

```
1. SPIN CEREMONY (2-3s, animated, skippable)
   Team ribbon spins -> locks on franchise
   Era wheel spins -> locks on decade/season
   Eligible-count reveal: "7 eligible legends found" (count only, no names/scores yet)

2. SLOT PROMPT
   "Who starts at Point Guard?" / "Who's your Defensive Specialist?"
   The slot being filled THIS round is chosen by the player from their
   remaining open slots (not forced in a fixed order) -- preserves the
   existing "soft placement, any order legal" property from ADR-005,
   but now the player is choosing a SLOT WITH IDENTITY, not an arbitrary
   numbered box.

3. CANDIDATE REVEAL
   Player cards animate in (name, team/era context, position badges,
   qualitative trait tags: "Elite Passer", "Defensive Anchor",
   "3-Level Scorer" -- derived from existing LineupDNA thresholds,
   never a number). NO exact score or rank anywhere on this screen.

4. PICK + PLACEMENT LOCK
   Selecting a card locks it into the chosen slot in one motion (collapses
   the current two-step select-then-place flow into one interaction per
   round, since the slot is now chosen first in step 2). Card visibly
   travels from the candidate stage onto the court graphic.
   A confirmation micro-animation plays. NO score reveal here.

5. REPEAT for all 8 slots (5 starters + 3 bench), in whatever slot order
   the player chooses.

6. LOCK-IN + SIMULATION
   Once all 8 slots are filled, one explicit "Lock Roster & Simulate"
   action (not automatic) -- gives the player a last look at their full
   court before committing, and creates a real decision boundary moment.

7. BROADCAST REVEAL (the payoff)
   THIS is where every hidden number appears, all at once, in a
   choreographed sequence:
     a. Full roster reveal with every player's real score/rank now shown
        on their court card (this is the FIRST time any score appears --
        collapsing 8 separate "was I right?" checks into one roster-wide
        reveal preserves suspense across the whole run instead of
        resolving it 8 times along the way).
     b. Lineup fit breakdown (component bars, per Sec 3.4 below).
     c. Simulated season record count-up (0 -> final wins), with loss
        markers appearing on an 82-game timeline strip.
     d. Perfect-season / near-miss framing (Sec 3.6).
     e. Share card generation (Sec 3.7).
```

This is the single most important structural change in this spec: **moving
every exact-number reveal from "immediately after each pick" to "the
broadcast reveal after the full roster locks."** It requires no new data
and is a state-machine + UI change only (Sec 3.4/3.5 of the companion
implementation plan). It directly fixes the "answer-key" complaint without
touching ADR-005 Decision 6's requirement (scores are still never shown
*before* a pick — they're now also not shown *between* picks).

### 3.2 Spin mechanics

- **Team + decade spin** (primary): resolves to the best eligible
  card among all eligible players for that franchise in that decade, as
  today — but see Sec 5 on why this needs more than 1-3 candidates to work.
- **Exact team-season spin** (secondary, rarer): unchanged mechanically,
  needs the same candidate-depth fix.
- **Modifier spins** (new, cheap to add, no new data required): "No repeat
  franchise," "One player per decade," "Defense-first" — these add
  variety using the *existing* interim/expanded dataset by constraining
  which spins can recur in one board, not by requiring new content. Good
  candidate for an early, low-cost replayability lever (see implementation
  plan 5X.2).
- Animation budget: **under 2 seconds**, matching master plan §13.3's own
  ceiling. A reduced-motion variant replaces the spin with an instant fade
  + text reveal — no player is blocked from playing by the animation.

### 3.3 Position-aware court slots

Full specification in Sec 6 below (shared with the position-system audit
area). Summary: 5 starters with real position identity (PG/SG/SF/PF/C,
soft-eligible, not hard-locked) + 3 bench slots with role identity (6th
Man, Defensive Specialist, Wildcard/Connector).

### 3.4 Lineup fit v1

Extends the existing `nba_peak/perfect_season/simulation.py::LineupFitComponents`
and reuses the existing `nba_peak/lineup/config.py::SYNERGY_RULES` pattern
(already has `creator_anchor_balance`, `creation_overload`, `no_lead_creator`,
`no_anchor`, `scoring_desert` — this is not a new concept, it's an
underused one). Full bonus/penalty taxonomy in Sec 7. Components remain
visible as bars with plain-language labels, never collapsed into one
"chemistry score" (ADR-005 Decision 4 still applies — this is an extension
of the existing experimental layer, not a new one).

### 3.5 Hidden ratings pre-pick, deferred reveal post-pick

Per Sec 3.1 step 3-4 (hidden) and step 7 (revealed). API-level enforcement
point moves from "never in `current_spin`" (already true) to "never in
`slots[]` either, until `status == result_ready`" — a real, testable
contract change from the current implementation, where `slots[]` reveals a
score the instant a slot is filled (see `state.py::get_public_state`,
current behavior: `if slot.peak_window_id: entry.update({...individual_peak_score...})`
runs regardless of overall game status).

### 3.6 Season simulation and the 82-0 chase identity

- Simulated record remains v0/experimental (unchanged from Phase 5C) —
  this is a presentation and framing upgrade, not a model upgrade.
- **Every result gets a headline framing**, not just perfect seasons:
  - `82-0`: "PERFECT SEASON"
  - `81-1`/`80-2`: "one loss away" / "so close" — the single loss's cause
    (from `decisive_factors`) is the headline, not a footnote.
  - Below 70 wins: framed around the single biggest weakness, so even a
    "bad" run teaches the player something actionable for next time.
- The **loss timeline strip** (§3.1 step 7c) is new: a compact 82-game
  horizontal strip, mostly green (wins), with red markers for losses,
  hoverable/tappable for the reason. This is the single highest-leverage
  "broadcast" visual and is cheap to build (a styled list, not a real
  simulation of 82 individual games — the v0 simulator already only
  produces an aggregate win/loss count and a rationale list; the timeline
  is presentational, distributing losses pseudo-randomly across 82 slots
  using the existing board seed for determinism, not simulating each game
  individually. This must be labeled as presentational distribution, not
  as a literal per-game simulation, to avoid overclaiming precision the
  v0 model does not have).

### 3.7 Shareable result card

New for this overhaul (Phase 5C explicitly deferred it). A single static
image (server-rendered or client-canvas-rendered — implementation detail
for 5X.7) containing: record, court silhouette with 8 player names, one
decisive strength, one decisive weakness or perfect-season badge, board
seed + a playable link. Never a spoiler list of "optimal" picks (matches
master plan §6.11 exactly, unchanged).

### 3.8 What must be built now vs. later

**Now (this overhaul, Phase 5X.1-5X.7):**
- Spin ceremony animation
- Position-aware slots (using the archetype→position approximation, Sec 6.4
  — does not require new data)
- Slot-first round flow (choose slot, then see candidates for it)
- Deferred reveal (move score visibility to the broadcast reveal)
- Lineup fit v1 (extend existing components + synergy-rule reuse)
- Result broadcast screen + loss timeline
- Share card

**Later (explicitly deferred, do not build in this overhaul):**
- Daily 82 official/leaderboard integration (Phase 5X.8 — needs the
  `result_snapshots`/`daily_completions` schema work already flagged as
  out of scope in `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md` §0 item 2)
- Ranked/multiplayer CourtBuilder (Phase 5X.9)
- Full team-season roster ingestion (database expansion strategy doc — a
  parallel, longer-running track, see Sec 8 below)
- Era-adjusted position remapping (Sec 6.5 — a real simplification for v1,
  not an oversight)
- Broadcast-style full game-by-game simulation (still v0 aggregate +
  presentational distribution, not a real per-possession model)

---

## 4. UI/UX overhaul

### 4.1 Arena landing page

- One unambiguous primary action: **"Build a Perfect Season"** (82-0),
  large, above the fold.
- Daily 82 status (once it exists, Sec 3.8) as a secondary card with a
  countdown, matching the existing Ranked-hub card pattern already on the
  page today.
- Peak Draft, Daily Peak Draft, and Ranked Draft Duel move into a single,
  clearly-labeled **"Peak Draft (Labs)"** section — visually secondary,
  not hidden, not deleted (ADR-005 Decision 2 still holds).
- Peak Hunt gets a placeholder "Coming soon" card once its backend exists
  (Sec 5) — do not build the mode itself in this overhaul, just reserve
  its place in the IA so it isn't a surprise addition later.
- Remove the raw "Prototype" badge language once the overhaul's exit
  criteria are met (see companion implementation plan's acceptance
  criteria per phase) — a small thing, but "Prototype" actively signals
  "don't get attached to this" to a first-time player, which undermines
  the entire goal of this overhaul.

### 4.2 CourtBuilder screen

- Real court graphic: a stylized half-court (SVG or styled CSS shapes —
  **not** a canvas/WebGL engine; master plan §13.2 and this overhaul's own
  "avoid brittleness" instruction both point the same direction). Starters
  occupy real court-relative positions (PG top of key, wings on the flanks,
  bigs near the basket); bench sits in a visually distinct rail below or
  beside the court, never mixed into the court graphic itself.
- Card-based candidate selection replaces the plain button list
  (`EligiblePlayerSearch.tsx` today): larger touch targets, position badge,
  qualitative trait tags, team/era context — still zero numbers.
- Clear phase hierarchy: Spin → Slot choice → Candidates → Confirm, as
  distinct visual steps (not all crammed into one scrolling page as today).
- Fast loading: no new heavy dependencies. CSS transitions/keyframes only;
  if a lightweight animation library is later justified, this spec does
  not pre-approve one — the implementation plan must show a bundle-size
  budget check before adding one.

### 4.3 Result screen

Per Sec 3.6/3.7 — broadcast reveal sequence, loss timeline, share card.
Skippable after first viewing (master plan §13.6), full breakdown always
re-viewable without re-running the animation.

### 4.4 Accessibility (non-negotiable floor, not a stretch goal)

- Every animation has a reduced-motion fallback (instant state change +
  fade, no removed information).
- Full keyboard operability preserved (the current build already does this
  correctly per the Phase 5C hardening pass — the redesign must not
  regress it).
- Screen-reader-equivalent court state: an accessible list view of the
  same 8 slots, synchronized with the visual court, not a second
  disconnected representation.
- `aria-live` announcements for: spin lock, candidate reveal, pick
  confirmation, roster-complete, and each reveal-sequence step landing.
- Color is never the only signal (position badges, trait tags, and
  win/loss markers all need a text or shape cue alongside color).
- No critical interaction is drag-only.

---

## 5. Mode hierarchy

| Mode | Status now | Status after this overhaul |
|---|---|---|
| 82-0 Peak Season | Flag-gated prototype | **Flagship**, primary nav CTA once Sec 3.8 "now" scope ships and clears acceptance criteria |
| Daily 82 | Does not exist | Built in Phase 5X.8, after 82-0 core loop is proven |
| Peak Draft (practice/daily) | Primary flagship today | Demoted to "Peak Draft (Labs)" section — reachable, unchanged functionally, de-emphasized visually |
| Ranked Draft Duel | Closed alpha, reachable at `/arena/ranked` | Stays as-is under Labs section; not touched by this overhaul |
| Peak Hunt | Does not exist | Placeholder card only in this overhaul; full build is a fast-follow candidate (master plan rates it "Low" difficulty, read-only over existing card data) — explicitly NOT built in this pass |
| Peak Grid, Forge, Draft Night, War Room, Threepeat, Era Wars, Rebuild Blitz | Do not exist | Untouched — no placeholder, no mention in nav; still governed by master plan §18.9's sequencing discipline (don't overbuild before 82-0 proves repeat-play value) |

This directly answers audit goal 6: the product surface gets *simpler*
during this overhaul (one flagship, one clearly-secondary legacy section,
one placeholder for a cheap future win), not more sprawling.

---

## 6. Position and lineup system

### 6.1 Slot definitions

**Starters (5, position-anchored):**

| Slot | Primary eligibility | Court-relative placement |
|---|---|---|
| PG | Point Guard | Top of key |
| SG | Shooting Guard | Wing |
| SF | Small Forward | Wing |
| PF | Power Forward | Elbow/baseline |
| C | Center | Rim |

**Bench (3, role-anchored, not position-anchored):**

| Slot | Definition |
|---|---|
| 6th Man | Rewards an offensive spark off the bench — bonus tied to `scoring_pressure`/`primary_creation` DNA on whichever card fills it, no position restriction |
| Defensive Specialist | Rewards defensive/anchor-flavored value off the bench — bonus tied to `anchor`-eligible or `postseason_translation`-heavy cards, no position restriction |
| Wildcard / Connector | No restriction, no special bonus condition — the deliberate "positionless" release valve. Every roster needs exactly one slot where "just take your best remaining player" is the correct, unpunished strategy, so the other 7 slots' structure reads as meaningful constraint rather than arbitrary rigidity |

Eight total slots — unchanged from the current `STARTER_SLOTS=5,
BENCH_SLOTS=3` shape in `nba_peak/perfect_season/config.py`. This overhaul
changes slot *semantics*, not slot *count* — a materially smaller
engineering change than it might first appear.

### 6.2 Eligibility model

- **Primary position/role**: full credit, no penalty, at its own slot.
- **Secondary position** (every player identity gets 0-2 secondary
  positions, per Sec 6.4's mapping): full credit at the secondary slot too
  — a "combo guard" archetype is PG-primary/SG-secondary, both with zero
  penalty.
- **Off-position placement** (e.g., placing a C-primary player at PG):
  legal, never blocked (preserves the existing, correct "soft placement"
  principle from ADR-005/master plan §5.5) — but triggers a visible fit
  penalty in the lineup-fit breakdown, shown as a plain-language note
  ("Out-of-position size disadvantage"), never as a hard invalidation or
  disabled button.
- **Bench role slots**: any player identity is eligible for any of the 3
  bench slots; the bonus condition (Sec 6.1 table) is evaluated per pick,
  not gated as an eligibility filter.

### 6.3 Penalties (extends existing `SYNERGY_RULES` pattern)

| Penalty | Trigger | Existing precedent to extend |
|---|---|---|
| No primary creator | No starter is PG-eligible (primary or secondary) | `no_lead_creator` (exists) |
| No rim protection | No starter/bench is C-eligible or `anchor`-archetype | `no_anchor` (exists) |
| Weak spacing | Fewer than 2 cards with `scoring_pressure >= 40` among starters | `scoring_desert` (exists, currently board-wide — narrow to starters) |
| Too many ball-dominant players | 4+ cards with `primary_creation >= 65` | `creation_overload` (exists) |
| Too small | 3+ guard-primary players placed at PF/C slots | New — position-fit specific, era-honest proxy only (no real height/weight data exists per `docs/model/LINEUP_DNA_V2.md`'s own documented data constraint) |
| Too slow | New — same data-constraint caveat; proxy via archetype mix imbalance (heavy `forward_big`/`anchor` count with no `lead_creator`/`guard_wing` balance), must be labeled as a proxy in its own tooltip, never presented as a measured speed stat |
| No bench creation | No bench slot filled with a `lead_creator`/`guard_wing`-eligible card | New, mirrors `no_lead_creator` at bench scope |

### 6.4 Bonuses (extends existing `SYNERGY_RULES` pattern)

| Bonus | Trigger | Existing precedent to extend |
|---|---|---|
| Elite creator + elite finisher pairing | High-`primary_creation` PG/SG + high-`scoring_pressure` PF/C | `creator_anchor_balance` (exists) |
| Shooting gravity | High `scoring_pressure` across 3+ starters | `scoring_depth` (exists) |
| Defensive backbone | `anchor`-archetype at C + Defensive Specialist bench slot filled meaningfully | New, composes existing `anchor` eligibility with the new bench-role concept |
| Rim pressure | High `scoring_pressure` combined with C/PF-primary placement | New, position-fit specific |
| Switchable defensive group | 3+ cards with `wing_forward`/`guard_wing` cross-eligibility among starters | New |
| Complementary usage profiles | Low aggregate role overlap across all 8 (inverse of `role_overlap_penalty`, already computed in `simulation.py`) | Already exists as `role_overlap_penalty`; this bonus is its positive framing, not new math |

### 6.4b Archetype-to-position mapping (v1 approximation — no new data required)

The current card data has **no NBA position field at all** — only the
lineup-archetype roles already computed in `card_profiles.v3.json`
(`lead_creator`, `guard_wing`, `wing_forward`, `forward_big`, `anchor`).
For this overhaul to ship position-aware slots without waiting on new data
acquisition, use this approximation as v1:

| Archetype | Primary position | Secondary position |
|---|---|---|
| `lead_creator` | PG | SG |
| `guard_wing` | SG | PG / SF |
| `wing_forward` | SF | SG / PF |
| `forward_big` | PF | C / SF |
| `anchor` | C | PF |

**This is explicitly labeled an approximation, not ground truth.** It will
misclassify some players (e.g., some historical `anchor`-archetype players
were defensive-minded wings, not literal centers). The player-expansion
strategy doc (Sec 8) specifies replacing this with a real
`primary_position`/`secondary_position` field sourced from
Basketball-Reference as part of the same data-acquisition pass already
required for team affiliation — until then, this mapping is good enough to
prove the position-slot mechanic is fun, which is the actual goal of this
phase.

### 6.5 Era-adjusted roles — explicitly deferred

Position meaning drifts across eras (a 1980s "small forward" plays a
different role than a modern point-forward). Real era-adjustment is a
genuine modeling project, not a UI decision, and is explicitly **out of
scope** for this overhaul. v1 uses traditional positions uniformly across
all eras. This is a deliberate simplification, not an oversight — flagging
it here so it isn't silently forgotten.

---

## 7. What "flexible but not positionless" actually means here

The current build is positionless in the bad sense: no structure at all,
so "skill" reduces to picking the highest number (which is itself hidden,
so in practice it reduces to picking arbitrarily). The redesign is
flexible in the good sense: 5 real position anchors create genuine
roster-construction tension (a PG-heavy team you're excited about can't
also start two more PGs at SF/PF without a visible penalty), while 3
role-flavored-but-unrestricted bench slots and universally-legal
off-position placement (with a penalty, never a block) preserve the
existing, correct principle that basketball history is full of legitimate
unconventional lineups the game must never forbid.

---

## 8. Database expansion — summary (full detail in the companion strategy doc)

The 250-player pool is **not enough** for team+decade CourtBuilder to work
as designed, full stop. It was built as an all-time top-N cohort by peak
score, which is the wrong selection criterion for this game: a team's
*texture* — its role players, defensive specialists, connective bench
pieces — is exactly what typically falls outside an all-time top-250 cutoff,
even though those are precisely the players a team+decade prompt needs in
order to offer a real choice. See
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` for the full
250→500 plan, inclusion criteria, and worked examples (2010s Warriors,
1990s Spurs, 1980s Lakers).

**Sequencing answer (asked explicitly in this task):** database expansion
and the UI/mechanical overhaul should run **in parallel, not serially**,
with the UI/mechanical work going first in practice because it's faster to
validate and doesn't block on data acquisition. Full reasoning and staged
gating in the companion implementation plan, Sec "Sequencing."

---

## 9. Non-goals for this overhaul (explicit, to prevent scope creep)

- No Daily 82, no leaderboards, no history writes (deferred, Phase 5X.8).
- No ranked/multiplayer CourtBuilder (deferred, Phase 5X.9).
- No PEAK3 Forge, Draft Night, War Room, Threepeat, Peak Grid, Era Wars,
  Rebuild Blitz.
- No full team-season roster ingestion (that's the *strategy*, not the
  *execution*, in this pass — see companion doc).
- No changes to `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any committed
  `leaderboards/*.csv` (unchanged, non-negotiable per `CLAUDE.md` and
  ADR-005 Decision 3).
- No hosted Supabase, no new migrations, no secrets/env changes.
- No deletion of Peak Draft or its infrastructure.
