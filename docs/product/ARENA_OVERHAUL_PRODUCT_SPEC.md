# PEAK3 Arena Overhaul — Product Spec

## Phase 6C — Exact-Season Card Fix (this session, 2026-07-24)

**Root cause of the second manual-review rejection:** Phase 6A/6B built a
real team+exact-season SPIN (the wheel correctly rolled "Golden State
Warriors · 2017-18"), but SELECTING a candidate still resolved through
`nba_peak.perfect_season.board.resolve_card(player_slug, duration_years)` —
a lookup keyed only by player + duration against `card_profiles.v3.json`,
which stores exactly one row per player per duration: that player's single
best CAREER PEAK window. The rolled season/team were never passed to the
resolver at all. Result: a 2017-18 Warriors Kevin Durant selection silently
resolved to his 2013-14 OKC career-peak card — PEAK Season was functionally
Peak Draft wearing a team+season costume.

**The fix, in one sentence:** team-year mode now has its own resolver,
`nba_peak.perfect_season.exact_season.resolve_player_season_card(player_slug,
team_id, season)`, which reads `cache/processed/regular_1980_2026.parquet`
(roster membership/position) and `cache/processed/scored_1980_2026.parquet`
(the real, official per-season `prime_score`) directly — never
`card_profiles.v3.json`. A hard invariant enforced in
`apps/api/app/services/perfect_season/state.py::action_select_player` raises
`CourtError("exact_season_mismatch", ...)` if the resolved card's team/season
ever disagrees with what was rolled. See `PlayerSeasonCard` vs `CardProfile`:
two distinct, never-interchangeable card types. Peak Draft
(`nba_peak/lineup/`) and the legacy team+decade CourtBuilder path
(`generate_board`/`resolve_card`) are completely untouched.

**"Open Pool" removed from team-year mode.** It was the fallback used
whenever the (3-entry, Warriors-only) team-year dataset couldn't fill all 8
rounds. `generate_team_year_board` now samples real team-seasons WITH
replacement (the same team-season can be rolled more than once per board —
still a real team + exact season each time, never an unconstrained pool) and
never falls back to `open_pool`. A team-season is only offered at all if it
has ≥8 real roster candidates (`MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON`).

**Honest score status, not fabrication.** A candidate/card carries
`identity_pool_status` (`canonical_250` | `qualifies_1500` |
`team_year_roster_only`) and `score_status` (`exact_season_scored` |
`exact_season_unscored`) — e.g. Festus Ezeli is a real, selectable 2015-16
Warriors roster candidate, honestly labeled `team_year_roster_only` /
`exact_season_unscored` (below the model's minutes threshold that season),
never silently upgraded or given a substitute score. The result screen shows
"Prototype score incomplete" instead of a lineup score if any placed card is
unscored (`score_substitution_allowed=false`, enforced in
`simulation.py::simulate_exact_season`).

**Still narrow, still honestly labeled as such.** This session fixed the
*architecture* using the existing 3-entry (Golden State Warriors
2015-16/2016-17/2017-18) team-year dataset as the proof case — every field
above is now correct for those 3 seasons, verified end-to-end (backend
pytest, Playwright, and a live browser session). Scaling team-season/player
coverage across 1980-2026 (Parts 4/5/7 of the Phase 6C task: 1500-identity
all-seasons table, broad team-season rosters, iconic-team-season sanity set,
Peak-section top-1000 pages) is real, substantial follow-up work, not done
in this session — see `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`'s
Phase 6C addendum for what's already available locally to build it from.

## Manual Review Rejection — Current CourtBuilder Is Not Ready (Phase 5X.7, 2026-07-23)

**PR #3 remains draft. Do not mark it ready. Do not merge.** A manual
browser pass — not an automated-test pass, CI is green — rejected the
current CourtBuilder build on product grounds. This is a different, more
serious kind of finding than the wheel-coverage bug (5X.5) or the position
bug (5X.6): those were *correctness* problems in an otherwise-reasonable
design. This one says the design itself, as currently built, is not good
enough to ship, even though every automated check passes.

**What manual review found:**
1. **The feature currently is not fun.** Passing tests and a correct
   position model are necessary, not sufficient — the actual moment-to-
   moment experience of playing it isn't good.
2. **No cancel/back-out after selecting a candidate.** Once a player is
   selected, the only path forward was placing them — a real usability gap
   (fixed this session, see Sec 5X.7 code changes in the companion plan
   doc; this is the one item from this list that got an actual code fix).
3. **The court view looks visually awful:** floating boxes, awkward
   spacing, weak basketball feel, overlapping text/cards, not fun or
   shareable. The half-court markings shipped under the "5X.5" label
   (key/hoop/arc) were a real improvement over nothing, and are nowhere
   near enough.
4. **The spinner is lame.** Two text boxes cycling through names, however
   functionally correct, does not create the anticipation a slot-machine-
   style reveal is supposed to create. It does not feel like a real random
   event.
5. **Team + decade is probably the wrong constraint grain.** A decade-wide
   pool (e.g. "Lakers, 1980s") is less legible and less exciting than a
   specific, real roster-year ("2015-16 Warriors — pick one eligible
   player from that real roster"). New direction: **team + year**, not
   team + decade. See Sec "New direction: team + year, not team + decade"
   below.
6. **The dataset makes the mode feel fake.** The candidate pools are tiny
   even after the 5X.5 coverage fix — e.g. the 2010s Warriors pool should
   eventually include real rotation players like Andre Iguodala, not just
   the two or three obvious superstars. The 250-player pool is too small
   for team+year specifically (it's worse than team+decade, since a single
   year has fewer eligible names than a full decade). **The 1000-player
   expansion (`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`,
   already targeted since Phase 5X.6) is now a hard prerequisite for this
   mode to be genuinely fun, not a nice-to-have.**
7. **The hooks from comparable products haven't actually been extracted
   yet.** First Down Studio's 17-0/82-0 builders, Sleeper 17-0, and
   Databallr's Six Rings were named as references in earlier planning
   passes, but their actual mechanical hooks (visible progress, chemistry/
   scoring, lifelines, hidden-impact reveal, trophy case) were never
   translated into concrete PEAK3-native design decisions. Sec "Redesign
   spec: the PEAK3-native game loop" below is the first pass at actually
   doing that extraction.

**What this means going forward:**
- The current scaffolding (state machine, API contract, position system,
  scoring philosophy) **remains useful and is not being thrown away** —
  the game *grammar* (spin → select → place → repeat → reveal) is sound.
  What's rejected is the *execution*: visual design, spinner feel, and
  constraint grain.
- This is a **redesign-spec pass, not a redesign-execution pass.** Per this
  task's own scope limits, the only code shipped this session is the
  cancel/back fix (item 2 above) and a copy honesty fix (Sec "Copy fix"
  below) — everything else here is direction-setting documentation for
  future phases, the same discipline already established for the Phase
  5X.6 product-direction-reset pass.

---

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

**Correction (Phase 5X.4, shipped on `phase5-courtbuilder-vertical-slice`):**
a product review of the shipped Phase 5X.1-5X.3 build found this document's
scoring philosophy (Sec 6.3) and bench slot naming (Sec 6.1) were wrong, not
just unimplemented. Both were rewritten in code and are now corrected here:

- **No role-overlap/redundancy penalty, ever.** Sec 6.3's `role_overlap_penalty`
  row and its "too many ball-dominant players"/"creation_overload" framing
  described a mechanic that punishes a roster for having too much elite
  talent of a similar archetype. That mechanic shipped in Phase 5C and was
  removed entirely in 5X.4: PEAK3 is a game about peak value, and a roster
  of several legitimate all-time-great peaks (Magic, Jordan, Bird, Duncan,
  Shaq, ...) must project as historically dominant, never nerfed for
  "having too many stars." The only things `simulation.py` scores besides
  raw peak talent now are `bench_strength` (real bench talent) and
  `positional_fit` (whether starters are placed at a position they actually
  played) — both real basketball constraints, neither a talent-suppression
  mechanic. Sec 6.3's table below is kept for historical record but is no
  longer implemented and must not be re-implemented as originally written.
- **Bench slots are plain: Bench 1 / Bench 2 / Bench 3.** Sec 6.1's
  "6th Man / Defensive Specialist / Wildcard" role-flavored bench slots
  shipped in Phase 5C, then were found to imply exactly the kind of
  archetype-scoring mechanic the correction above removes (a bonus "tied to"
  a specific DNA dimension per bench slot). 5X.4 replaced them with three
  identical, unrestricted bench slots — any selected player is eligible for
  any bench slot, no bonus condition attached to which one they land in.
- **Team wheel + era wheel are two separate, real random wheels**, not a
  single combined interim-dataset label. The era wheel is fixed at 5 real
  decades (1980s-2020s); the team wheel cycles through the actual
  resolvable franchise set (now 11 franchises via the expanded interim
  dataset, up from 5) — never a broader decorative list that includes a
  franchise no spin could actually land on.
- **Candidate depth is actively managed, not just measured.** The board
  generator now excludes zero-candidate interim entries outright and
  prefers >=2-candidate entries over 1-candidate ones whenever enough exist
  (`nba_peak/perfect_season/board.py::_select_interim_entries`). Sec 1.2's
  candidate-count table below reflects the pre-5X.4 state; it's kept as the
  historical baseline the fix was measured against, not current behavior.

**Addendum (Phase 5X.6, "Product Direction Reset," 2026-07-22):** a second
manual review, after the wheel-coverage fix and half-court polish (shipped
under a reused "Phase 5X.5" label — see the collision log in
`docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`), found two further
problems this document did not yet address:

1. **A real position-data bug, not just an approximation gap.** Sec 6.4b
   below already labels the archetype-derived position mapping "an
   approximation, not ground truth" — but the actual manual-review finding
   was worse than an approximation being imprecise: Tim Duncan and
   Shaquille O'Neal, both real centers/bigs, displayed as "plays PG,"
   because nearly every elite, high-usage player in the pool gets
   classified `lead_creator` by the *lineup*-archetype model (a "best
   offensive engine" concept, not a position concept), and
   `ARCHETYPE_POSITION_MAP` maps `lead_creator` to PG. Fixed with a manual
   `POSITION_OVERRIDES` table (`nba_peak/perfect_season/positions.py`) that
   takes priority over the archetype fallback for every player currently
   reachable in the game. Full strategy — manual v0 now, real
   source-derived position data as part of the player-pool expansion later
   — is in `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`.
2. **82-0 alone is probably the wrong primary success metric.** Once a
   roster is built from legitimately elite peaks, many valid rosters
   should realistically project near a perfect record — a binary "did you
   sweep" outcome stops discriminating between a merely-great roster and a
   truly historic one exactly where the model's actual signal is most
   interesting. Sec 2's north star below (perfect season as the "chase")
   is **not wrong, but incomplete**: 82-0 stays as a visible, celebrated
   outcome, but the durable, comparable, leaderboard-ready number becomes a
   **PEAK3 lineup score (0-100, same display scale as `individual_peak_score`)**,
   computed from the existing `LineupFitComponents`. Full design (scoring
   outputs, working-title options, spinner/reroll redesign, team+player
   imagery plan, leaderboard schema target) is in
   `docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`'s new "Phase 5X.6"
   section and the new companion doc
   `docs/architecture/PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`. Nothing in
   this addendum is implemented beyond the position-data fix and one
   interim-dataset correction (Jrue Holiday's Celtics affiliation) — it is
   direction-setting for future phases, per that task's own scope limits.

## Redesign spec: the PEAK3-native game loop (Phase 5X.7)

Extracted from — not copied from — the mechanical hooks in the named
reference products, translated into PEAK3-specific decisions:

| Hook (from reference products) | PEAK3-native version |
|---|---|
| Slot-machine/random team-season reveal (First Down Studio, Sleeper) | Team + year spin (see below), not team + decade — a specific roster is more exciting to land on than a decade-wide pool |
| Fixed roster slots (First Down Studio) | Already true: PG/SG/SF/PF/C + Bench 1/2/3, unchanged |
| Visible progress through rounds (First Down Studio) | Already true (`Round N / 8`), needs visual polish not redesign |
| Hidden score/reveal tension (Databallr Six Rings' "blind values") | Already true (deferred-reveal contract, Phase 5X.7-of-the-earlier-numbering) — PEAK3's version is a full roster-wide reveal at the end, not per-pick |
| Personal best / leaderboard (Sleeper, Databallr) | Designed, not built (Phase 5X.6's leaderboard schema target) — the durable PEAK3 lineup score is the sort key |
| Shareable result card (Sleeper) | Designed, not built (product spec Sec 3.7, unchanged) |
| Daily challenge (First Down Studio, Sleeper) | Explicitly deferred (Phase 5X.8), unchanged |
| Limited rerolls/lifelines (Sleeper's team/year reroll, Databallr's lifelines) | New: one team reroll + one decade/year reroll per attempt (already scoped in the Phase 5X.6 plan doc section, restated below for the team+year context) |
| Names/faces, hidden impact reveal, trophy case (Databallr) | Names: already true. Faces: blocked on `PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`'s licensing gate. Trophy case: a leaderboard/history concept, deferred with the rest of Phase 5X.8 |
| Solo / duels / FFA (Databallr) | Solo only for the foreseeable future — CourtBuilder is explicitly single-player practice today (ADR-005 Decision 1); duels/FFA would be a Phase 5X.9 ranked-layer concept, not scoped here |

**The round loop (target, not yet built):**

```text
1. Roll random team.
2. Roll random year (an actual season, e.g. "2015-16" -- see the team+year
   section below).
3. Show team logo/color identity. (Logo blocked on asset strategy --
   color identity is safe to build now.)
4. Show the year prominently -- this is now the headline of the round,
   not a secondary label next to the team name.
5. Show eligible real roster/player-season candidates from that exact
   team-year.
6. User chooses one player.
7. User can cancel/back before placing (SHIPPED this session -- see the
   companion plan doc's "Phase 5X.7" section for the implementation).
8. User places into PG/SG/SF/PF/C or bench.
9. Repeat for 8 rounds.
10. Final result shows: projected record, PEAK3 lineup score, percentile/
    tier (once the leaderboard exists), score receipt, share-card-ready
    layout. All already scoped in the Phase 5X.6 "Product Direction Reset"
    section of the companion plan doc -- restated here as the loop's
    terminal step, not redesigned again.
```

Steps 1-2 (team+year spin), 3 (color identity only), and 4 are the
concrete near-term redesign target. Steps 6-9 are the existing, working
select/cancel/place loop (step 7 shipped this session). Step 10 is
designed but not built (Phase 5X.6).

## New direction: team + year, not team + decade

**Old:** a spin resolves to a franchise + decade (e.g. "Lakers, 1980s"),
pooling every in-pool player who was on that team at any point in that
decade.
**New:** a spin resolves to a franchise + **specific season** (e.g.
"2015-16 Warriors," "2002-03 Spurs," "1995-96 Bulls"), pooling only
players who were actually on that exact roster that year.

**Why:** a decade-wide pool is less legible ("the 1980s Lakers" spans 3
different core rosters across a real 10-year span) and, per the manual
review, less exciting than "you rolled the 2015-16 Warriors — pick one."
An exact year is also a better niche-player discovery mechanic: a specific
roster-year naturally surfaces role players who were meaningfully on that
team but wouldn't clear an all-time or even a decade-wide cutoff.

**This is a real widening of scope, not a relabeling.** The interim
dataset already supports `exact_team_season` as a spin type today (a small
number of hand-curated entries, e.g. `warriors-2015-16`) — but flipping it
to the *default* constraint grain, for *every* team in the wheel, across
*all* seasons from the model's starting season through present, requires
real roster-membership data at a depth the current 250-player pool cannot
support (see the manual-review finding above: exact-year pools are
*narrower* than decade pools, so they need *more*, not less, player-pool
depth to stay fun). **The 1000-player expansion is the gating dependency**
— see `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`'s new
team-year coverage QA section. Team + year does not ship as the default
mode until that coverage gate is met; shipping it against the current
sparse dataset would make the exact problem (tiny, fake-feeling candidate
pools) worse, not better.

**Rules for when this ships:**
- Year is an actual season (`"2015-16"`, `"2002-03"`, `"1995-96"`), not a
  decade bucket.
- Eventually covers all seasons from the model's starting season through
  the present, not a curated handful.
- A rolled team-year maps to real roster membership (the
  `team_season_roster_member` entity already scoped in
  `PHASE_5_DATA_MODEL.md`, not the interim hand-curated dataset's
  eventual replacement).
- Limited rerolls apply to both dimensions independently (one team
  reroll, one year reroll per attempt — same mechanic already scoped for
  team+decade in the Phase 5X.6 plan doc section, carried forward
  unchanged in spirit).

**Phase 6A update (2026-07-23):** a real, working proof of concept of this
direction now exists —
`nba_peak/perfect_season/board.py::generate_team_year_board()`, covering
exactly three exact team-seasons (Golden State Warriors 2015-16, 2016-17,
2017-18) with real roster membership and 10-11 resolvable candidates
each, up from 2. It is gated behind
`COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` (default off) and does
**not** change the shipped default — team+decade remains the default
mode, exactly as this section already required, because the 1000→1500-
player expansion coverage gate this section names has not been cleared.
See `docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`'s new "Phase 6A"
section for full detail, and
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` for the updated
1500-identity audit findings.

## Copy fix (shipped this session)

Sec 6.4b below (and the equivalent in-app copy) said "an early
approximation from each player's lineup archetype, not verified NBA
position data." That became actively inaccurate once the Phase 5X.6
manual `POSITION_OVERRIDES` table shipped (every player reachable in the
game today has a human-verified, not archetype-derived, position) — and
read as amateur regardless. Replaced in-app with: *"Prototype mode: roster
eligibility uses interim team-year coverage and manual position checks.
Full historical roster expansion is not yet live."* The limited-coverage
badge (`interim-data-label`) is unchanged.

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

**Phase 6A update (2026-07-23):** the "durable, comparable score" this
section implies but doesn't name has shipped as **PEAK3 Lineup Score
(0-100)** — a real mean of the 8 placed cards' own canonical
`individual_peak_score` values, server-computed, shown on the result
screen alongside (not replacing) the 82-0 record. 82-0 is still the fun
headline chase identity described above; the Lineup Score is the number
meant to survive comparison across different rosters/runs, since the
82-0 record has seeded noise and a hard 82-game ceiling baked in. No
global leaderboard writes yet (that remains future work, Sec 3.8/9).

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

**Superseded/expanded (Phase 5X.7):** Sec 4.2 below described the current
half-court + card layout as the target; manual review rejected it
(floating boxes, awkward spacing, overlapping text, "not fun or
shareable"). Full visual-redesign requirements (NBA-arena-style card
table, proper half-court geometry, team-color accents, headshot/silhouette
slots, team logo reel, responsive roster rail, shareable result card) are
now tracked as a dedicated future task in
`docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md`'s "Phase 5X.7"
section — **not executed in this pass**, per this task's own explicit "do
not do the full visual redesign yet" scope limit.

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

**Bench (3) -- SUPERSEDED by the Phase 5X.4 correction above.** As shipped,
all 3 bench slots are plain and identical: **Bench 1 / Bench 2 / Bench 3**,
no role label, no per-slot bonus condition. The table below (6th Man /
Defensive Specialist / Wildcard, each with its own DNA-tied bonus) is kept
for historical record only and must not be re-implemented.

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

### 6.3 Penalties -- SUPERSEDED by the Phase 5X.4 correction above

**None of this table is implemented, and it must not be.** PEAK3's scoring
is peak-value-first: a roster is never docked for having "too many
ball-dominant players" or similar archetype-concentration triggers merely
because that concentration happens to involve elite talent. The only
implemented scoring components tied to roster construction are
`bench_strength` and `positional_fit` (`nba_peak/perfect_season/simulation.py`).
Kept below for historical record only.

| Penalty | Trigger | Existing precedent to extend |
|---|---|---|
| No primary creator | No starter is PG-eligible (primary or secondary) | `no_lead_creator` (exists) |
| No rim protection | No starter/bench is C-eligible or `anchor`-archetype | `no_anchor` (exists) |
| Weak spacing | Fewer than 2 cards with `scoring_pressure >= 40` among starters | `scoring_desert` (exists, currently board-wide — narrow to starters) |
| Too many ball-dominant players | 4+ cards with `primary_creation >= 65` | `creation_overload` (exists) |
| Too small | 3+ guard-primary players placed at PF/C slots | New — position-fit specific, era-honest proxy only (no real height/weight data exists per `docs/model/LINEUP_DNA_V2.md`'s own documented data constraint) |
| Too slow | New — same data-constraint caveat; proxy via archetype mix imbalance (heavy `forward_big`/`anchor` count with no `lead_creator`/`guard_wing` balance), must be labeled as a proxy in its own tooltip, never presented as a measured speed stat |
| No bench creation | No bench slot filled with a `lead_creator`/`guard_wing`-eligible card | New, mirrors `no_lead_creator` at bench scope |

### 6.4 Bonuses -- SUPERSEDED by the Phase 5X.4 correction above

Not implemented as a per-condition bonus taxonomy. In particular,
"Complementary usage profiles" below assumed `role_overlap_penalty` would
keep existing as computed math to invert -- that field was removed
entirely in 5X.4, not repurposed. Kept for historical record only.

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

**Superseded for reachable players (Phase 5X.6 fix):** the table above
alone produced a real bug, not just an imprecise approximation — nearly
every elite player's `primary_role` is `lead_creator` (a "best offensive
engine" classification, not a position one), which this table maps to PG,
so Tim Duncan and Shaquille O'Neal (both real centers/bigs) displayed as
"plays PG." `nba_peak/perfect_season/positions.py::POSITION_OVERRIDES` now
sits in front of this table as a manual, human-verified position for every
player_slug reachable via the interim team-season dataset; this table is
still the fallback for anyone not yet covered (i.e. open-pool draws outside
the curated dataset), and remains exactly as approximate/risky as described
above for that remaining long tail.

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
