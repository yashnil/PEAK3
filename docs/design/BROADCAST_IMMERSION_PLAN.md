# PEAK3 — Broadcast Immersion pass

Branch: `feature/arena-broadcast-immersion`, cut from `main` @ `08c264b`.

This document is Phase 1 of the pass: the audit, the dependency decision, and
the mode-by-mode design plan. It is written **before** any implementation, per
the brief, and it is deliberately narrow about what this pass will and will not
touch.

It sits on top of, and does not replace:

- `docs/design/DESIGN_SYSTEM.md` — the token constitution
- `docs/design/VISUAL_RUBRIC.md` — the pass/fail gate and 1–5 scoring
- `docs/design/GAME_FEEL.md` — the interaction contract and existing primitives
- `docs/design/VISUAL_POLISH_PLAN.md` — the incident history that sets the
  discipline for this kind of work
- `.claude/rules/web-ui-preservation.md` — the hard "do not change behaviour"
  rule

---

## 1. What the app actually is right now

Measured, not assumed: services started (`uvicorn` + `next dev:e2e`), every
major surface screenshotted at 1440×900 and 390×844, and every mode driven into
real gameplay through Playwright against the real API.

**The system is already mature.** Three prior game-feel passes shipped a real
interaction contract (`useCommandLane`, `isNewer`, server-owned timelines), a
13-primitive game-feel library, a disciplined three-role type system, three
radii, two elevations, a named duration scale, and two-level reduced-motion
handling. 20,821 lines of CSS across 25 files. 2,411 unit tests, 448 browser
tests. **Nothing in this pass is a rewrite.** Anything that reads as "this looks
unfinished" is almost always a composition or environment problem, not a
missing feature.

### 1.1 Animation / motion inventory

| Layer | What exists | Where |
|---|---|---|
| Runtime library | `motion` 11.18.2 — the only animation dependency | `package.json` |
| Lazy boundary | `MotionProvider` (`LazyMotion` + `domAnimation`), exported but **not wired into any layout** | `lib/motion.ts` |
| Direct `motion` consumers | 8 components (methodology, `SpinStage`, `SeasonResultStub`, duel reveal/comparison, RTT `BattleReveal` / `RevealCard` / `RunMap`) | — |
| Duration tokens | `--pk-dur-*` (0/120/200/320/480 + reveal 400 / count 600 / lift 160 / pulse 2000) and `--v2-dur-*` (ack 100 / control 160 / transition 210 / reveal 380 / cinematic 2800) | `globals.css`, `v2/tokens.css` |
| Easing | `--pk-ease-standard/out/in/emphasized` + `settle` / `decel`, aliased into `--v2-ease-*` | both |
| Stagger | `MOTION_STAGGER_MS` 55, capped at index 8, mirrored by the `.pk-reveal` CSS primitive | `lib/motion.ts` |
| Game-feel primitives | `GameActionButton`, `TurnClock`, `RoundReveal`, `EventMoment`, `ScoreTransition`, `ActiveSeat`, `useArrivals`, `ResourceMeter`, `CardArrival`, `RosterSlotLock`, `BidTransition`, `ResultReveal`, `LifeMeter`, `RunTrack` | `components/game-feel` |
| Ambient effect | `PeakV2ArenaLight` — one radial source per surface, `--v2-light-opacity` 0.16 | `components/v2` |
| Environment | `.pk-atmosphere` (two corner glows + a **uniform 48px square grid**) and `.court-grid-bg` (the grid alone) | `globals.css` |
| Reduced motion | Two levels: a global blanket zeroing `animation-duration`/`transition-duration`, plus a `.pk-*`-scoped rule for `animation-delay`; JS timer chains call `usePrefersReducedMotion()` | `globals.css`, `lib/a11y.ts` |
| Canvas / WebGL | **None.** | — |
| Audio | **None.** No `AudioContext`, no audio element, anywhere in `src/`. | — |
| View Transitions | **Not used.** | — |

### 1.2 The four defects that explain almost everything

Every "this feels like a website, not a game" observation from the screenshot
sweep reduces to one of these four. They are ranked by how many surfaces they
damage.

**D1 — The environment is graph paper, and it belongs to boxes rather than to
the page.** The single environmental motif in the product is
`linear-gradient` × 2 at a uniform 48px pitch. That is a spreadsheet, not a
basketball court: no sidelines, no half-court line, no centre circle, no arc,
no key. Worse, it is applied *per component* (`ArenaLobby`, `tmw-room`,
`play/daily`, the grid board) rather than to the page, so each screen is a
lit rectangle floating in an unlit void, and the two `.pk-atmosphere`
floodlights terminate at a container edge instead of at the horizon.
Verified by cropping the RTT opening reveal: the light has a hard horizontal
top edge exactly where its container begins.
*Surfaces damaged: every one.*

**D2 — Start gates are documents in a void.** Run the Table, 82-0, Daily Grid
and Peak Duel all open the same way: eyebrow, serif headline, explanatory
paragraph, a numbered or columned rules block, then a CTA — laid out in a
~1050px column with 200–400px of dead black to the left and right and, on
Daily Grid, 500px of nothing below the fold. `VISUAL_RUBRIC.md` already names
this exact pattern as its reject-on-sight anti-pattern ("settings-page
numbered-list microcopy as a game entry point"). A previous batch fixed the
*copy*; the *composition* is still a document.
*Surfaces damaged: 5 entry points, i.e. the first thing every player sees.*

**D3 — Peak Duel has no face-off.** The daily question screen renders two
player names at ~24px, a season line, and a bordered "Choose X" button on each
side, with a countdown between them — occupying the top 340px of the viewport
and leaving the rest black. There are no cards. The brief's "cards enter
opposite sides of a strong central axis" describes something that does not
exist yet. The *reveal* that follows is genuinely strong (dot-plot, correct
component tokens, tabular figures) and is the rubric's own reference "4" —
so the mode's problem is entirely in the decision beat, not the result.
*Surface damaged: the most-played daily mode.*

**D4 — Three-Man Weave's seats are bordered columns and its pick surface is a
database.** The three seats are three `1px` bordered boxes each containing a
grid of grey rectangles labelled "Point guard / Shooting guard / …". The pick
overlay — where the entire decision of the mode happens — is a search input
above a list of rows with circular monogram avatars, next to a column of rows
reading "Open". A pick lands as a row's text changing from "Open" to a name.
Nothing enters, nothing travels, nothing locks.
*Surface damaged: the flagship multiplayer mode's core loop.*

### 1.3 Smaller, confirmed craft defects

- `RunTrack` chapter labels truncate to garbage at 1440px: `Draft Roo…`,
  `Rest / Bank…`, `THE CEILI…`, `THE STAND…`, `THE LONG …`.
- RTT boss intro: the "+11 credits BANKED" chip overlaps the act numeral above
  the boss name.
- Three-Man Weave shows the "Choose a public handle" modal over round 1 of live
  gameplay. RTT already defers this prompt; TMW does not.
- The 82-0 and Daily Grid boards sit left-aligned in a wide viewport with the
  entire right third empty.

### 1.4 What is already good and must not be "improved"

- **Rankings.** A real data table: tabular figures, correct per-component
  colours, dense, scannable. Out of scope by CLAUDE.md and correct as-is.
- **The Peak Duel reveal.** The rubric's reference for hierarchy. Untouched.
- **RTT's information architecture.** Header → run track → decision beside
  roster rail is genuinely well-composed and dense in the right way.
- **The nav "Play" panel.** Grouped, iconed, labelled, with a CURRENT marker.
- **The three-role type system.** Instrument Serif for moments, Space Grotesk
  for interface, tabular mono for instrumentation. It works. No fourth font.

---

## 2. Dependency decision matrix

The existing stack was audited against every technology the brief names. The
conclusion is **zero new runtime dependencies**, and the reasoning is per-item
rather than a blanket "we're being disciplined".

| Technology | Present? | Gap it would solve | Specific PEAK3 use | Cost | Accessibility | Verdict |
|---|---|---|---|---|---|---|
| **Motion for React** | **Yes, 11.18.2** | Shared-element continuity (`layoutId`), presence-aware exits, spring physics | `SharedCardFlight` (candidate → roster slot, lot → winning roster), duel card entrance, roster arrival | Already paid. `LazyMotion`+`domAnimation` is ~15 kB and is currently **unused** — wiring it is a net *reduction* on routes that today pull the full component tree | Respects `usePrefersReducedMotion`; already the app's convention | **ADOPT (already present) — and finally wire `MotionProvider`** |
| **Native View Transition API** | No | Cross-route continuity (player row → player page) | `/rankings` row → `/players/[slug]` | 0 bytes | Same-document is Baseline; cross-document lacks Firefox | **REJECT this pass.** Next 15 App Router + `next dev` interop is an extra failure mode against a 448-test browser suite, for one non-gameplay transition. Documented as a future opportunity. |
| **GSAP / Flip** | No | Same job as Motion's `layout`/`layoutId` | — | ~23 kB min+gz for Flip + core | Manual reduced-motion wiring | **REJECT.** Two libraries for one responsibility. Motion already owns FLIP-style layout animation and is already in the tree. |
| **Rive** | No | Authored vector animation with state machines | PEAK3 crest, boss insignia, perfect-grid mark | ~90 kB WASM runtime + per-asset | Needs manual reduced-motion handling | **REJECT.** The runtime is not the problem — *there is no custom PEAK3 art to play in it*, and the brief is explicit that a generic stock basketball animation is worse than none. Documented as an art commission. |
| **dotLottie / Lottie** | No | Same | Same | ~35 kB + JSON payloads | Same | **REJECT**, same reason. |
| **React Three Fiber / Three.js** | No | Genuine 3D arena environment | Home hero, RTT boss scene | ~160 kB gz for three + R3F, plus a render loop | Must have a static fallback and honour reduced motion | **REJECT.** The environment this product needs is a *lit court plane seen flat-on* — that is a CSS radial + conic gradient and a handful of `border-radius` arcs, at 0 bytes of JS and 0 render loops. WebGL would buy a parallax that the brief's own performance section then asks us to avoid on scrolling content. |
| **Howler.js** | No | Sprite-sheet audio playback | Selection lock, SOLD, life loss | ~9 kB gz | Needs its own mute plumbing | **REJECT the library, BUILD the layer.** The eight cues this product wants are 40–180 ms envelopes; the Web Audio API synthesises them from an oscillator and a gain ramp in ~120 lines with no asset request and no dependency. See §6. |
| **Canvas particles** | No | Confetti / burst on a rare win | Perfect grid, table clear | 0 (hand-written) or ~10 kB (library) | Must be suppressed under reduced motion | **REJECT for this pass.** A full-screen `requestAnimationFrame` loop on the exact frame a result screen is doing a staged reveal is the wrong place to spend frame budget, and confetti is the most generic "celebration" signal available. A composed, typographic celebration is more PEAK3. Documented. |
| **Native CSS / WAAPI** | Partially | Everything ambient and everything compositor-bound | The arena environment, court sweep, line trace, impact lock, sheen | 0 bytes | Covered by the two existing `prefers-reduced-motion` levels | **ADOPT — it is the primary tool of this pass.** |

**Net package delta: 0 added, 0 removed, 0 upgraded.**

`motion` stays at 11.x. A v12 bump is a real API-surface change against eight
existing consumers and a 2,411-test suite, and buys nothing this plan needs.

---

## 3. The motion system

The app has two duration families that already mean the right things. This pass
does **not** add a third. It gives the existing scale the four *named bands* the
brief asks for, maps every band onto tokens that already exist, and writes down
the grammar so a new animation has an obvious right answer instead of a new
hardcoded number.

### 3.1 Bands

| Band | Range | Existing token | Communicates | Grammar |
|---|---|---|---|---|
| **MICRO** | 60–180 ms | `--v2-dur-ack` 100, `--v2-dur-control` 160 | "I heard you" | Opacity/scale ≤ 0.02, no travel. Never blocks. |
| **STATE** | 180–450 ms | `--v2-dur-transition` 210, `--v2-dur-reveal` 380 | ownership, lock, direction | Travel ≤ 24 px, scale ≤ 1.04. Ends *settled*, never bouncing. |
| **REVEAL** | 500–1200 ms | `--pk-dur-count` 600 + stagger | hierarchy, sequence | Staggered 55 ms, capped at 8. Content is readable at 50 % of the duration. |
| **CINEMATIC** | 900–2000 ms | `--v2-dur-cinematic` 2800 (whole sequence) | consequence | Only on a genuine ending or a boss. Never gates a control. |

### 3.2 Curves — a physical vocabulary

Four existing curves, each given one job so a call site picks by meaning:

- `--pk-ease-standard` `(0.2, 0, 0, 1)` — anything moving between two states.
- `--pk-ease-out` `(0, 0, 0.2, 1)` — anything entering.
- `--pk-ease-settle` `(0.16, 1, 0.3, 1)` — **a card locking into a slot.**
  Overshoots and stops dead. This is the pass's signature curve.
- `--pk-ease-decel` `(0.05, 0.7, 0.1, 1)` — anything the player just committed
  to. Starts at full speed, as if already in motion.

`--pk-ease-emphasized` `(0.34, 1.56, 0.64, 1)` is a true overshoot and stays
reserved for a single celebratory beat per screen, never for a control.

### 3.3 What motion is allowed to say

Motion in this app encodes exactly eight things. Anything that does not encode
one of them is decoration and does not ship.

ownership · direction · hierarchy · lock · score · active turn ·
success/failure · progression

### 3.4 Depth and light limits (unchanged, restated because this pass adds an environment)

- **Two elevation steps.** `--v2-elev-plane`, `--v2-elev-modal`. Rows stay flat.
- **One light per surface**, plus the documented Peak Duel paired exception.
  The new page environment is **not** a second light: it replaces the per-screen
  `.pk-atmosphere` copies rather than layering over them.
- **No blur as decoration.** Depth here is typographic and spatial.
- Max scale on any interactive element: **1.04**. Max travel for a state
  change: **24 px**. A card *flight* between two real DOM positions is exempt
  because its distance is the information.

### 3.5 Reduced motion — substitution, not deletion

The existing global rule zeroes durations, which is correct but on its own
destroys hierarchy. Every primitive this pass adds declares its reduced-motion
*equivalent*, not its absence:

| Full | Reduced |
|---|---|
| card flies from candidate to slot | slot fills instantly + a 900 ms accent ring on the destination |
| score rolls up | final value, one opacity step |
| court sweep across the active seat | static accent rail on that seat |
| light moves between targets | light is simply already at the target |
| staged reveal on a timer chain | whole result painted on first frame (`ResultReveal.startComplete`, already exists) |
| burst on a win | a static struck mark |

---

## 4. Primitives this pass will actually build

The brief lists sixteen. Building sixteen abstractions with one caller each is
the failure this repo's own design system warns about, so the list below is
only what has **two or more real call sites**, plus what already exists and just
needs wiring.

| Primitive | Status | Call sites |
|---|---|---|
| `ArenaBackdrop` | **NEW** — page-level court environment + horizon light | every game route (replaces 6 scattered `.pk-atmosphere` / `.court-grid-bg` uses) |
| `SharedCardFlight` | **NEW** — `motion` `layoutId` wrapper with a reduced-motion ring fallback | TMW candidate → slot; Showdown lot → roster; RTT offer → slot |
| `ImpactLock` | **NEW** — the settle beat when a thing becomes yours | TMW slot, RTT slot, Showdown roster |
| `CourtSweep` | **NEW** — a light passing across the active seat | TMW active court, Showdown active seat |
| `ScoreRoll` | **EXISTS** as `ScoreTransition` | reuse, do not rebuild |
| `TimerRail` | **EXISTS** as `TurnClock` | reuse |
| `LifeBreak` | **EXISTS** as `LifeMeter` | reuse |
| `BudgetDrain` | **EXISTS** as `ResourceMeter` | reuse |
| `RosterArrival` | **EXISTS** as `useArrivals` + `RosterSlotLock` | reuse, wire into TMW |
| `PlacementReveal` / `VictoryEffect` / `ResultBurst` | **EXISTS** as `ResultReveal` | reuse |
| `BossReveal` | **EXISTS** as RTT's title card | fix its composition defect only |
| `ArenaSpotlight` | **EXISTS** as `PeakV2ArenaLight` | fix its hard container edge |
| `LineTrace` | **NOT BUILT** | folded into `ArenaBackdrop` as court geometry; a standalone tracer had no second caller |
| `PageTransition` | **NOT BUILT** | rejected with View Transitions, §2 |

---

## 5. Mode-by-mode plan

Each mode is audited on the ten axes the brief asks for. "Stays quiet" is a
first-class answer.

### Peak Duel — *the highest-value single change in this pass*

1. **Dominant object:** two peak windows.
2. **Action:** choose a side.
3. **Existing feedback:** the reveal (strong). The decision beat has none.
4. **Dead moments:** the entire decision screen — two text names, 380 px of black.
5. **Missing consequence:** nothing acknowledges the choice before the reveal replaces the screen.
6. **Missing hierarchy:** the two candidates carry the same weight as the countdown.
7. **Missing identity:** no cards, no axis, no confrontation.
8. **Continuity:** the chosen card should *survive* into the reveal rather than being replaced by a different layout.
9. **Signature idea:** **the VS axis is a real vertical seam of light**; the two cards enter from opposite edges, meet it, and hold. On pick, the chosen card advances and the rejected one recedes — *before* the verdict, so anticipation and verdict are separate beats.
10. **Stays quiet:** the reveal's dot-plot. It is already the reference.

### Three-Man Weave

1. **Dominant object:** three rosters. 2. **Action:** draft a player. 3. **Feedback:** a row's text changes. 4. **Dead:** the pick overlay's list; the seat columns between turns. 5. **Missing consequence:** the pick does not travel. 6. **Missing hierarchy:** all three seats are equally lit at all times. 7. **Missing identity:** grey rectangles labelled with position names. 8. **Continuity:** candidate row → roster slot. 9. **Signature:** **three courts sharing one floor** — the seat dividers become court lines, and the active-seat light *moves* between them instead of a border changing colour. 10. **Stays quiet:** the search input and filters; a draft board needs to be fast to read.

### $20 Showdown

1. Lot. 2. Bid. 3. `BidTransition`, `ResourceMeter`, `EventMoment`, SOLD stamp — **already good**. 4. Dead: the stage between lots. 5. Missing: the sold player does not travel to the winner. 6/7. Adequate. 8. Lot card → winning roster slot. 9. **Signature:** the lot sits under its own light on an auction stage; on SOLD the light drops to the winning seat and the card flies there. 10. **Stays quiet: the bid controls.** This mode's game feel was rebuilt twice already and measured at 0.4–2.0 s bot response. Do not touch the control path.

### Run the Table

1. The run. 2. A decision per node. 3. Extensive — the strongest mode. 4. Dead: none of consequence. 5–7. Mostly present. 8. Offer card → roster slot. 9. **Signature:** the boss title card gets a per-boss identity (a struck geometric insignia derived from the boss's own rule, drawn in CSS, one per act) instead of five identical gold-lit cards. 10. **Stays quiet: ordinary node decisions.** Adding a beat to a decision the player makes twenty times per run is how a run stops being 15 minutes.
*Also: fix the truncated `RunTrack` labels and the overlapping credits chip.*

### 82-0 Peak Season

1. The wheel and the court. 2. Spin, then place. 3. Reel + absorb + round card — reworked in the last pass. 4. Dead: the court between spins. 5. The placed player does not visibly *land* on the court. 6–7. The court is a grid of slots, not a court. 8. Candidate → court slot. 9. **Signature:** the court is a *court* — the five starter slots sit in a real half-court plan with a key and an arc, not a 5-across row. 10. **Stays quiet: the spin timing.** It was tuned to 1500/450 ms deliberately last pass.

### Daily Grid

1. Nine squares. 2. Fill one. 3. Locked state + points. 4. Dead: the board between picks; the empty right third. 5. A locked cell should *land*. 6. Adequate. 7. Nine dashed boxes; the row/column headers are the basketball content. 8. Search result → cell. 9. **Signature:** **the board completes as a physical object** — each locked cell darkens its neighbours' dashes and the board's frame gains a line per lock, so a nearly-finished board looks nearly finished from across the room. 10. **Stays quiet: the search sheet.** It is a lookup tool under a timer.

### Arena / Home / Index

- **Home & Arena:** the hero sits over the arena environment rather than over black; the empty band below the CTA becomes the environment's horizon instead of dead space. Mode entry gets a one-beat handoff, not a page-load flash.
- **Rankings & player pages:** **stay quiet.** Restrained depth on the player identity card only. Browsing is not a cinematic sequence, and Rankings is out of scope by CLAUDE.md.

---

## 6. Audio

Build the layer, ship no stock assets.

- Eight cues: selection lock, bid, SOLD, spinner lock, roster placement, boss
  reveal, life loss, victory.
- **Synthesised at runtime** from `AudioContext` — an oscillator or filtered
  noise burst with a 40–180 ms gain envelope. No files, no network request, no
  dependency, and the result is authored for this product rather than pulled
  from a library.
- **Off by default.** A single explicit toggle. Never auto-plays; the context is
  created lazily on the first real user gesture, satisfying autoplay policy.
- **No cue carries information that is not already visible.** Muting removes
  nothing.
- If a real sound designer later supplies samples, the same call sites take
  them: the module's public surface is `play(cue)`, not `oscillator`.

---

## 7. Guardrails this pass holds itself to

Hard stops, checked before every commit:

1. **No game rule, seed, timing constant, server contract, or scoring change.**
   `--v2-dur-*` values that a mode's timing was tuned against
   (`REVEAL_SECONDS`, `COURT_PACING`, `TMW_CEREMONY_MARKS`,
   `REVEAL_HOLD_MS`, `BOT_THINK_RANGES`) are **frozen**.
2. **No test's expected value is edited to make a visual change pass.**
3. **Input → first visual acknowledgement stays under 50 ms.** Every effect is
   `transform`/`opacity`; nothing decorative gates a control.
4. **One light per surface.** The new environment replaces the scattered
   `.pk-atmosphere` instances; it does not stack on them.
5. **No new font, no second icon set, no glassmorphism, no fifth accent.**
6. **Reduced motion substitutes, never deletes.**
7. **Nothing merges.** Commits land on the feature branch only.

---

## 8. Order of work

1. Environment + motion tokens (`ArenaBackdrop`, court geometry, light fix).
2. Shared primitives (`SharedCardFlight`, `ImpactLock`, `CourtSweep`) + wire
   `MotionProvider`.
3. Peak Duel face-off. *(largest single gain)*
4. Start gates composed into the arena.
5. Three-Man Weave courts + roster arrival.
6. Per-mode signatures: RTT boss identity, 82-0 half-court, Daily Grid
   completion, Showdown flight.
7. Audio layer, off by default.
8. Evaluator-led iteration, then performance / a11y / mobile, then full CI.
