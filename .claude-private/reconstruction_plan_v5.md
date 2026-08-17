# PEAK3 V2 — Pass 5 reconstruction plan (private)

Superseding Pass 4. Pass 4 closed functional/wiring gaps and did an anti-vibe
audit but the human reviewer rejected the RESULT as a visual baseline: too
many screens still read as settings pages / generic dark SaaS / legacy
islands. This pass is a full presentation rebuild, not a polish pass.

## Baseline findings (real browser, ?ui=v2, verified against PDF)

1. **Global nav/footer/shell has ZERO V2 branch.** `components/layout/nav.tsx`
   and `Footer.tsx` render unconditionally regardless of `?ui=`, using the
   legacy `.font-display` (Space Grotesk) wordmark, generic pill/border nav
   styling. This is the single biggest "legacy island" — it's on every page.
2. **Homepage** has a real V2 (`HomePageV2.tsx`) but composition is E2-only
   (narrow, restrained) — brief wants E1's mass/balance blended in: bigger
   hero, denser right-side data object, horizontal game SLATE (not a list of
   hairline rows) directly under the fold.
3. **Arena hub** (`ArenaPageV2.tsx`) is a flat hairline list — reads as a
   sitemap, not "every mode, one arena."
4. **Daily hub** (`/daily`) — **no V2 branch at all.** Fully legacy: icon-badge
   bordered cards, pill badges, "chip soup" — the exact SaaS-dashboard anti-
   pattern called out in the brief.
5. **Rankings, Methodology, About, Ranked, Daily Grid, signin/signup** — **no
   V2 branch at all.**
6. **RTT / 82-0 / Peak Duel "start gate" screens** — real, serious problem:
   these are gold-bordered CARDS with numbered-list microcopy paragraphs
   ("1. Pick a Front Office Perk...", "2. Take one of two nodes..."). This is
   precisely the rejected "settings/preferences form with paragraphs"
   pattern, sitting directly behind `?ui=v2`. High-visibility, first thing a
   player sees when entering a mode.
7. **RTT final run receipt** — confirmed still legacy `RunResult` reused
   verbatim inside a bare V2 shell (no `PeakV2RTTResult`).
8. **TMW `PickOverlay`** — confirmed still legacy chrome inside V2 courts.
9. **82-0 chooser** reuses legacy `SpinStage`/`EligiblePlayerSearch` internals.
10. Primitives that DO already meet the bar and should be reused, not
    rebuilt: `PeakV2Shell`, `PeakV2CinematicStage`, `PeakV2ResultHeadline`,
    `PeakV2DisplayEmphasis`, `PeakV2DataLane`, `PeakV2PlayerIdentity`,
    `PeakV2Rule`, `PeakV2PrimaryAction`/`SecondaryAction`, `PeakV2LiveHeader`,
    `PeakV2GameStatus`, `PeakV2CourtSlot`, tone system (`v2-tone.ts`). Token
    layer (`styles/v2/tokens.css`) is well-designed — three-role typography,
    3-step radius vocabulary, one-light rule, aliased not forked colors.
    Extend, don't replace.

## Priority order (given single-session constraints — ranked by success-criteria impact)

**P0 — touches every page, currently 0% done:**
- Global V2 Nav + Footer, wired into `(main)/layout.tsx` via `UiVersionSwitch`.

**P1 — explicit named asks, currently weak/absent:**
- Homepage recomposition (E1 mass + E2 restraint blend).
- Daily hub V2 (currently zero — new build).
- Ranked V2 (currently zero — new build, preserve queue/auth logic exactly).
- Arena hub recomposition (currently flat list).

**P2 — "settings page" screens directly named as unacceptable in the brief:**
- RTT / 82-0 / Peak Duel entry ("start gate") screens — replace card+numbered-
  list with the three-choice/at-a-glance grammar the brief specifies.
- RTT final run receipt (`PeakV2RTTResult`, new).

**P3 — reskin shells preserving strong existing data/interaction:**
- Rankings, Methodology, About — V2 typography/nav/surface wrap, do NOT
  touch the table/chart/accordion logic.

**P4 — remaining disclosed gaps + polish:**
- TMW PickOverlay chrome, 82-0 chooser chrome, Daily Grid V2 (stretch —
  large, self-contained puzzle UI; only if time remains after P0-P3).
- Anti-chalky sweep across existing RTT node components (draft room, boss
  reveal scale, system select, etc.) against the brief's per-mode critique.

**P5 — verification + evaluator + fixes + commit.**

## Route/state → problem → invariant → target → components

| Route/state | Current problem | Functional invariant | Visual target | Components to touch |
|---|---|---|---|---|
| Global nav (all pages) | 0% V2, legacy Space Grotesk wordmark, SaaS pill active state | `aria-label="Main navigation"`, active-class string `bg-[var(--bg-surface)]` asserted by tests, wordmark→`/`, PlayMenu disclosure, AccountMenu, ThemeToggle, mobile drawer, `data-nav-ready` | Quiet at top, hairline+subtle surface after scroll, gold active indicator not pill, serif-adjacent wordmark restraint | New `PeakV2Nav.tsx` gated in `(main)/layout.tsx`; reuse `PlayMenu`/`MobileNavDrawer`/`AccountMenu` logic, only reskin chrome |
| Global footer (all pages) | 0% V2, generic 3-col corporate footer | `FOOTER_COLUMNS` data, `NBA_DISCLAIMER` verbatim, unit test `footer.test.tsx` | Quiet, coherent hairline footer matching nav grammar | New `PeakV2Footer.tsx` |
| Homepage `/` | Sparse single column, no horizontal slate | server-fetched props unchanged | E1 mass + E2 restraint: hero left / real data object right, horizontal game slate below fold | `HomePageV2.tsx` rebuild |
| Arena hub `/arena` | Flat hairline list, no hierarchy | fail-closed courtBuilder check, all mode links/state | flagship hero + tiered slate (per PDF pg 2 "MODES" block) | `ArenaPageV2.tsx` |
| Daily hub `/daily` | Fully legacy card grid | same games/links | quiet daily-reset context, today's plays as visual focus | New V2 branch + `PeakV2DailyHub.tsx`, wire into `DailyHub.tsx` |
| Ranked `/arena/ranked[/mode]` | Fully legacy, 3 settings-style cards | exact queue/rating/auth behavior, no invented tiers | competitive sports surface | New V2 branch in `RankedScreen.tsx` |
| Rankings `/rankings` | Fully legacy chrome around strong table/chart | table/chart/filter logic untouched | V2 typography/nav/surface wrap only | New V2 branch, reuse `RankingsTable`/`RankingsAnalysis` |
| Methodology `/methodology` | Fully legacy chrome | accordion logic untouched | V2 wrap | New V2 branch, reuse `ComponentAccordion` |
| About `/about` | Fully legacy | static content | V2 typography wrap | New V2 branch |
| Peak Duel entry (`/play/daily`,`/play/endless`) | (need verify — screenshot showed a bordered card, confirm if legacy or weak V2) | 5s pick, streak, countdown | minimal-copy confrontation intro | Check `game-engine.tsx` entry state |
| RTT entry `/arena/run-the-table` (pre-start) | Gold-card + numbered-paragraph list ("1. Pick a Front Office Perk...") | `RunStartGate` logic, tour trigger | brief roster-deal energy, not a rules document | `RunStartGate.tsx` — add/rebuild V2 branch |
| RTT final receipt | Legacy `RunResult` verbatim in bare V2 shell | all receipt data/actions | strong result hierarchy, hairlines not stacked cards | New `PeakV2RTTResult.tsx`, wire into `RunTheTableGame.tsx` |
| 82-0 entry `/arena/court/daily` | Gold-card + numbered list, difficulty as bordered toggle cards | `PeakSeasonStartGate` logic | roster-deal energy | Add/rebuild V2 branch for start gate |
| 82-0 chooser | Reuses legacy SpinStage/EligiblePlayerSearch chrome | respins, search, View Court, dismissal | docked elegant chooser over visible court | `PeakV2CourtChooser.tsx` polish pass |
| TMW PickOverlay | Legacy chrome inside V2 courts | 872-line stage/commit/timeout/reconnect logic untouched | V2 chrome match | Reskin `PickOverlay.tsx` render only, zero logic change |
| Daily Grid | 0% V2 | board/game mechanic untouched | V2 typography/nav/dialogs/receipts wrap | Stretch — only if time remains |

## Execution order

Phase A: PeakV2Nav + PeakV2Footer + verify token/font system → wire into layout.
Phase B: Homepage, Arena, Daily hub, Ranked, Rankings/Methodology/About shells.
Phase C: RTT start gate + final receipt, 82-0 start gate, Peak Duel entry check,
  TMW PickOverlay skin, 82-0 chooser polish, anti-chalky sweep on existing
  node components.
Phase D: full screenshot sweep (desktop/laptop/mobile) → one evaluator
  subagent against the brief rubric → fix highest-value findings.
Phase E: typecheck/lint/test/build once, confirm functional parity via
  targeted e2e re-run, commit to `feature/peak3-v2-ui` only, unstage private
  files first.

## Explicit non-goals / deferred if time runs out

- Daily Grid V2 is the largest remaining net-new surface (self-contained
  puzzle UI with many sub-states); it will be attempted last and disclosed
  honestly in the final report if not reached.
- No backend/game-rule changes. Any ambiguity found gets legacy behavior
  preserved + documented here, not blocked on.
