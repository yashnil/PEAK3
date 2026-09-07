# Peak Duel ENDLESS — question-screen face-off (desktop strengthening)

Branch: `feature/game-feel-reconstruction`. Nothing committed.

## What was wrong

Endless shares `PeakDuelV2Question` with Daily. Daily's centre column carries the
10-second clock and its header the session dashes, so the screen has an instrument to
read. Endless is untimed: with the clock gone, the two `p-2` text-only buttons (150px
tall, 1.25rem names) sat in a 772px stage at 1440x900 — measured card box `484x150` in
`1084x772` — and the PLAYER A vs PLAYER B face-off was a small "vs" glyph between two
lines of text.

## How Endless differs from Daily (in code)

- Route `apps/web/src/app/(main)/play/endless/page.tsx`: duration gate, then
  `GameEngine mode="endless"` with a 30-duel session; `onComplete` reloads more.
- `components/game/game-engine.tsx`: Daily arms `deadlineAt` per question
  (`DECISION_CLOCK_SECONDS`); Endless passes `deadlineAt: null` — untimed, manual advance.
- `PeakDuelV2Question`: `mode === "daily"` renders the paired arena lights, the hidden
  `ArenaTimer` (expiry authority), `ProgressDashes` and the centre clock; Endless
  rendered none of those and a plain italic "vs".
- The duel-viewport contract (`tests/e2e/duel-viewport.spec.ts`, which runs on ENDLESS):
  the left card's top edge is the same y in question and reveal (±2px), the window never
  scrolls, the reveal grows downward only, "Next Matchup" is above the fold at 1440x900
  and 1728x1000. Comments in `PeakDuelV2Stage.tsx` / `PeakDuelV2Reveal.tsx` pin the
  shared `mt-10` header→grid gap and forbid inserting anything between header and grid.
  Respected: every Endless rule grows the cards DOWNWARD or paints behind them.

## What changed and why

Scoped entirely by one new attribute, `data-duel-mode={mode}`, on the roots of
`PeakDuelV2Question` and `PeakDuelV2Reveal`; all styling keys on
`[data-duel-mode="endless"]`, so Daily receives no new rule.

### apps/web/src/components/v2/duel/PeakDuelV2Question.tsx
- Root `data-duel-mode`. Grid gets `duel-faceoff relative` — its geometry classes
  (`mt-10 grid grid-cols-1 items-center gap-8 sm:grid-cols-[1fr_auto_1fr] sm:gap-4`) unchanged.
- Endless only: an absolutely positioned `duel-faceoff-stage` (not a grid item, adds no
  height) carrying the same paired `PeakV2ArenaLight` cool/warm wash Daily already uses
  (Pass 2.5's one exception to the single-light rule), at `y=50%`, `intensity="focus"`.
- Centre column is the VERSUS axis (`data-testid="duel-versus-axis"`); Endless adds two
  `.duel-versus-rule` hairlines above/below the "vs" mark (`data-testid="peak-duel-v2-versus"`).
- Side panels get class hooks (`duel-side-key/-identity/-name/-window/-cta`). Every size
  Endless enlarges is a CSS custom property whose FALLBACK is Daily's literal value
  (`var(--duel-name-size, 1.25rem)`, `var(--duel-vs-size, 1.5rem)`,
  `var(--duel-side-idle-opacity, 0.92)`, `--duel-cta-border/color/bg`), never a second
  inline style — verified by computed style on the live Daily screen (below).
- No new information before the answer: each card is still key hint + name + window +
  "Choose X" echo (asserted byte-for-byte in the new unit test).

### apps/web/src/styles/v2/duel.css (NEW)
Imported in `app/layout.tsx` after `info-pages.css` (next to the other v2 sheets, before
`game-feel.css`); every selector carries the attribute, so it outranks game-feel.css's
base `.duel-side` rules by specificity, not order. A separate file was chosen because
another workstream will append to game-feel.css.
- Two framed, equal-height scouting panels (`align-items: stretch`; min-height
  15/17/19rem at base/sm/lg; 1px `--v2-border` frame, 12px radius, 78% `--v2-bg-surface`);
  the "Choose X" echo pins to the bottom (`margin-top: auto`) so both silhouettes match.
- Name `clamp(1.75rem, 2.4vw, 2.5rem)` at sm+; key hint as a small keycap chip.
- VERSUS axis: full-height hairlines (`--v2-border-emphasis`), 3rem accent italic VS,
  "HIGHER PEAK?" eyebrow. Under 640px it turns horizontal (rule — label — vs — rule) and
  the stack tightens.
- Hover / `:focus-visible`: hovered side lifts 2px, frame accent-tinted, echo fills accent;
  the OTHER side recedes to opacity 0.58 via `:has()` (progressive). The focus rule
  composes the 2px `--focus-ring` explicitly because it outranks Tailwind's ring on
  `box-shadow`.
- Press (`:active`): scale 0.985 + inset accent ring, 60ms. Pending (`data-pending`,
  game-feel.css's lock pulse unchanged) also turns the frame accent, other side to 0.5.
- Endless reveal cards (`.duel-reveal-card`) keep the same frame (padding/border only,
  winner frame accent-tinted) so the frame the player pressed is the frame the score
  lands in. Reveal choreography (count-up, verdict, lanes, explanation timings in
  game-feel.css) untouched.
- Reduced motion: transitions and the 240ms identity entrance removed; hover/press/
  pending/receded states remain as colour/border/opacity — verified live
  (`rightBorder` accent-tinted, `leftOpacity 0.58`, `transform none`, `animationName none`).

### apps/web/src/components/v2/duel/PeakDuelV2Reveal.tsx
- One attribute on the root: `data-duel-mode={mode}`. Nothing else.

### apps/web/src/app/layout.tsx
- `import "@/styles/v2/duel.css";`

### apps/web/src/tests/unit/peak-duel-v2-question.test.tsx (NEW, 10 tests)
Endless: root attribute; both semantic buttons + accessible names; axis with two rules
and the vs mark; stage with two lights; DOM order stage/left/axis/right; shared grid
classes; no clock; byte-exact card text (no answer info); selected/pending/disabled
attributes; `onSelect` wiring; CSS-var sizing fallbacks. Daily: root `daily`; no rules /
no stage; header-band lights still 2; clock present; no vs mark; same grid classes and
child order; same side markup incl. `p-2`.

## Screenshots (scratchpad `shots/`)

BEFORE: `before-1440-question.png`, `before-1440-question-hover-left.png`,
`before-1440-reveal.png`, `before-390-question.png`; Daily reference
`before-daily-1440-question.png`, `before-daily-390-question.png`.

AFTER: `after-1440-question.png`, `after1-1440-question-hover-left.png`,
`after-1440-reveal.png`, `after-1440-focus-left.png` (keyboard focus-visible),
`after-1440-press-right.png` (mousedown held ~90ms),
`after-1440-reduced-motion-hover-right.png`, `after-390-question.png`,
`after-390-reveal.png`; Daily `after-daily-1440-question.png`, `after-daily-390-question.png`.

Geometry at 1440x900: cards `484x150` → `448x304` each; left card top `249` before and
after (the contract). 390x844: `358x150` → `358x240`, stacked with a horizontal axis,
no horizontal overflow, top `249` both.

## Timings (in-page performance.now(), local API), six consecutive questions

| | before 1440 | after 1440 | before 390 | after 390 |
|---|---|---|---|---|
| click → first DOM mutation (ms) | 2.4, 2.0, 1.7, 1.7, 1.6, 1.7 | 2.7, 2.2, 1.8, 2.0, 1.9, 1.8 | 2.5, 1.8, 1.7, 1.6, 1.7, 1.8 | 2.8, 2.2, 2.0, 2.1, 1.9, 2.0 |
| click → reveal region present (ms) | 16.6, 16.7, 9.8, 9.8, 10.5, 8.9 | 16.3, 18.4, 15.1, 11.6, 11.5, 9.8 | 15.8, 10.1, 9.7, 13.5, 9.5, 9.4 | 17.6, 16.9, 10.9, 11.0, 11.7, 10.6 |

Press acknowledgement (after; per-frame sampling around `mouse.down`): `:active` true and
the border already moving toward accent in the first frame after the press, fully
settled by ~90ms. Under 100ms; the reveal itself lands in 10–18ms on the local API so
the pending state is a single frame in practice.

## Verification

- `cd apps/web && npm run typecheck` — passed immediately after my edits. A later re-run
  fails in `src/lib/run-the-table-state.ts(1690)` (`acquisitions` missing on
  `RunPublicState`): that file was modified at 09:18:55 by a concurrent workstream
  (+302 lines; not mine, not touched). No error in any file I edited.
- `npm run lint -- --max-warnings 0` — clean.
- `npx vitest run src/tests/unit/peak-duel-v2-question.test.tsx src/tests/unit/peak-duel-v2-reveal.test.tsx src/tests/unit/peak-duel-v2-history.test.tsx src/tests/unit/peak-duel-history.test.ts src/tests/unit/game-engine.test.tsx src/tests/unit/game-feel.test.tsx` — 6 files, 63 tests passed.
- `npx playwright test --project=chromium-core -g "duel|Duel"` (running servers) — 15
  passed: all 6 `duel-viewport.spec.ts` tests (incl. reduced motion and the 1440x900 /
  1728x1000 above-the-fold checks), `gameplay.spec.ts` Peak Duel regression, daily-grid
  hub → duel, and the ranked "duels" tests the grep also matched.
- `npx playwright test --project=mobile-chrome -g "duel|Duel"` — 1 passed (`@mobile`).

## Daily-mode impact: none

Live computed styles on `/play/daily` after the change (1440 and 390): left card top
`221.5`, size `476.98x150` / `358x150` (identical to before), padding `8px`, border `0px`,
opacity `0.92`, min-height `auto`, transparent background, name `20px`, echo border
`rgb(42,46,61)` / colour `rgb(179,184,204)`, grid `align-items: center`,
`data-duel-mode="daily"`, 0 `.duel-versus-rule`, no stage. Daily's header-band lights,
clock, dashes and reveal choreography are untouched; the only Daily DOM differences are
inert class names / test ids and CSS-var fallbacks that resolve to the previous literals.

## Scratchpad scripts

`endless-probe.mjs <label>` (screenshots + timings, both widths), `daily-computed.mjs`
(Daily computed-style check), `endless-states.mjs` / `endless-states2.mjs` (focus, press,
reduced motion), `daily-shot.mjs`.
