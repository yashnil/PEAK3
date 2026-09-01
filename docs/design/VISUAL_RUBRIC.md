# PEAK3 Visual Rubric ("Arena Archive")

The gate every batch in the polish program runs through, per
`VISUAL_POLISH_PLAN.md`'s Phase 11 discipline. **Part 1 is a hard gate. A
batch that fails any item in Part 1 does not proceed to Part 2's scoring,
regardless of how good it looks.**

## Part 1 — Hard gate (functional correctness, pass/fail only)

- [ ] Route loads (no 500, no blank page, no infinite loading)
- [ ] No new browser console errors vs. the Phase-3 baseline
- [ ] No new hydration warnings
- [ ] The route's primary user task (per `ROUTE_BEHAVIOR_MATRIX.md`'s
      "primary user task" column) is completable start to finish
- [ ] The route's listed tests pass (unit + the specific e2e spec(s) named
      in the matrix for that route) — not the full suite necessarily per
      micro-edit, but always before a batch is called done
- [ ] Keyboard navigation reaches every interactive element in a sane order
- [ ] Focus is visible at every stop (not just present — actually visible;
      `--focus-ring` contrast, not obscured by an overlapping element)
- [ ] Any modal/sheet/drawer touched can be entered and escaped (Escape key,
      backdrop click if that was the prior behavior, focus trap intact,
      focus returns to the trigger on close)
- [ ] Mobile (390px) layout works: no horizontal overflow
      (`document.documentElement.scrollWidth <= window.innerWidth`, allow
      the 0.5px LayoutUnit tolerance already established in this repo's own
      test suite — see memory note on the rankings mobile-sheet defect)
- [ ] No critical action is hidden or requires hover-only discovery
- [ ] No broken touch interaction (tap targets ≥ `--pk-tap-min` 44px, or
      documented spacing compensates)
- [ ] No material performance regression — recheck First Load JS for any
      route this batch touched against the Phase-3 bundle baseline in
      `VISUAL_POLISH_PLAN.md`; a jump demands justification, not silence
- [ ] Data meaning is unchanged (a rank is still the same rank, a score is
      still `arena_points` not something renamed/recomputed, a component
      color still maps to the same component)

Only a route that clears every box above gets scored below.

## Part 2 — Aesthetic scoring (1–5 per dimension)

Score against what the surface *should* be per its `ROUTE_BEHAVIOR_MATRIX.md`
polish category — a route marked "leave as-is" is not expected to score a 5
on Delight, and that's correct, not a defect.

**Visual Identity** — does this feel unmistakably PEAK3, not template UI?
- *2:* Could be any dark-mode SaaS dashboard with the accent color swapped.
  (This was the RTT/82-0 start gates before this program — bordered card +
  numbered list, no basketball-specific grammar.)
- *4:* Uses PEAK3's actual grammar — component colors mean something,
  tabular scores, the arena-light single-source convention, Space
  Grotesk/Instrument Serif role split — not generic icon-plus-heading cards.

**Hierarchy** — is it obvious where the eye should go and what to do next?
- *2:* Peak Duel's result screen if the headline score, the component
  breakdown, and the "play again" CTA all carried equal visual weight.
- *4:* The actual current Peak Duel result screen — dot-plot comparison,
  tabular numerals, one dominant headline, correct color tokens (per
  baseline screenshot review) — this is the reference 4.

**Typography** — are labels, scores, tables, and explanatory copy readable
and deliberate?
- *2:* Instrumentation-role numbers set in the UI font (no tabular figures,
  scores visibly shift width as they animate).
- *4:* Every ticking number uses `--v2-font-mono` with `"tnum" 1`, prose
  capped at a readable measure, display serif reserved for genuine moments.

**Spacing/Composition** — controlled, or uniformly padded?
- *2:* Ranked-mode / Daily Grid today at 1440px — a single centered CTA
  block floating in mostly-empty space (confirmed by baseline screenshots).
- *4:* Home or Rankings today — deliberate density, real use of the
  available width, not padding stretched to fill it.

**Information Density** — does the amount of visible information fit the
task?
- *2:* A rules-document reading of "1. Pick a Front Office Perk... 2. Take
  one of two nodes..." before the player can act (RTT's current start gate).
- *4:* State + one clear CTA visible at a glance, secondary detail one
  disclosure level down (Methodology's accordion pattern, reused correctly).

**State Clarity** — are selected/active/disabled/loading/success/failure
states obvious?
- *2:* A disabled control that only differs by a faint opacity shift with no
  second cue.
- *4:* `ScorePill`/`StatusChip` used consistently, selection paired with
  `--peak-accent-bg` wash *and* a border/icon change, not color alone.

**Consistency** — do repeated behaviors look and behave like the same
system?
- *2:* Two different "difficulty picker" visual patterns across 82-0 and
  another mode for the same kind of choice.
- *4:* Every selectable-row surface uses the same `--v2-radius-control` +
  selection-wash treatment regardless of which game mode it's in.

**Data Legibility** — are tables/charts/rankings/numeric comparisons easy to
scan?
- *2:* Misaligned numeric columns, component colors used decoratively
  rather than tied to real data.
- *4:* Rankings' existing table (already strong per baseline review) — do
  not touch its logic, only its chrome if anything.

**Restraint** — has unnecessary visual noise been removed?
- *2:* More than one ambient light source on a single surface outside the
  documented Peak Duel paired-wash exception; a second novelty font.
- *4:* One arena light, tied to real game focus, everything else flat
  typography and alignment.

**Delight** — memorable moments, without animation/effect spam?
- *2:* Every hover animates; nothing specific stands out because everything
  moves.
- *4:* The existing opening-reveal ceremony and cinematic stage remain the
  one or two signature moments; routine interactions stay quick (100–210ms
  per the existing `--v2-dur-*` scale) and undecorated.

No route ships on the strength of an averaged score if it fails Part 1, and
no route needs a 5 across the board — a quiet route (auth, settings) scoring
low on Delight by design is correct, not a gap.

## Anti-pattern checklist (reject on sight)

- [ ] Neon overload / more than one glow source per surface outside the
      documented Peak Duel paired-ambient exception
- [ ] Glassmorphism / blur applied to a surface for its own sake (PEAK3's
      own tokens explicitly reject "Liquid Glass"-style translucency —
      Depth here is typographic/spatial, not blur)
- [ ] Decorative gradients not tied to a real data encoding
- [ ] Icon-only controls where a label would remove ambiguity
- [ ] Any routine transition exceeding ~400ms (compare against
      `--v2-dur-cinematic`'s 2800ms, which is the one deliberate exception,
      reserved for genuine cinematic sequences only)
- [ ] Five or more competing accent colors visible on one surface
      simultaneously (component colors are semantic and situational — a
      surface showing all six at once because "it's the color system" is a
      misuse, not a feature)
- [ ] Universal pillification — every element rounded to the same radius
      regardless of the three-role vocabulary (`--v2-radius-instrument` /
      `-control` / `-modal`)
- [ ] Card-inside-card-inside-card nesting where flat typography/alignment
      would carry the same hierarchy
- [ ] **Settings-page numbered-list microcopy as a game entry point** — the
      named, confirmed reference example this program fixes: RTT's start
      gate ("1. Pick a Front Office Perk... 2. Take one of two nodes...")
      and 82-0's start gate (numbered 1–4 list plus a bordered two-box
      Easy/Hard toggle), both verified via baseline screenshot to currently
      read as a rules document rather than a game's opening beat. Any new
      surface that reaches for "numbered paragraph explaining the mode
      before the player can act" is repeating this exact defect.
