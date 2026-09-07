# 82-0 Peak Season — final pre-deploy polish report

Branch `feature/game-feel-reconstruction`, base `1cd0bbd`. Nothing committed.
Scope held to `components/court/**`, `components/v2/court/**`, `styles/v2/court.css`,
`lib/court-state.ts`, court tests. `styles/game-feel.css`, `styles/v2/spin.css` and every
shared `components/game-feel/*` primitive are untouched. No server call, rule, state
version or sync path changed (command lane, newer-wins, server authority as before).

Files: `components/court/CourtBuilder.tsx`, `PeakSeasonStartGate.tsx`, `SpinStage.tsx`,
`SeasonResultStub.tsx`; `components/v2/court/PeakV2CourtChooser.tsx`, `PeakV2CourtLive.tsx`,
`PeakV2CourtResult.tsx`, `PeakV2CourtIntro.tsx` (new); `lib/court-state.ts`; `styles/v2/court.css`;
tests `unit/court-polish-pacing.test.tsx` (new), `unit/court-result-hierarchy.test.tsx` (new),
`unit/court-builder-v2-resume-selection.test.tsx`, `unit/court-builder-hint.test.tsx`,
`e2e/courtbuilder.spec.ts`.

## Screenshots (1440x900, Playwright, `scratchpad/shots/`)

| Moment | Before | After |
|---|---|---|
| Start gate | `before/01-start-gate.png` | `after/01-start-gate.png` |
| Opening intro (new) | — | `after/02a-intro.png` (t≈0.7 s), `after/02b-intro-late-beat.png` (t≈2.5 s) |
| Round reveal | `before/05-resume-replay-bug.png` (the replay; the 620 ms round-1 card was not capturable) | `after/02-round-reveal.png`, `after/04-slot-fill.png` (round 2 card after a fill) |
| Spin | `before/03-spin.png` | `after/03-spin.png` |
| Slot fill | `before/04-slot-fill.png` | `after/04-slot-fill.png` |
| Result | `before/06-result.png` | `after/06-result.png` (full page), `after/06b-result-viewport.png` |

Scripts: `scratchpad/play_court.mjs <label>` (full run + shots), `scratchpad/measure_court.mjs <label> [--reduced]`
(in-page MutationObserver timeline, t=0 at the Begin click), `scratchpad/intro_shot.mjs`.

## Measured timeline (live dev server, seed 42)

| | Before | After | After, reduced motion |
|---|---|---|---|
| Opening intro on screen | none | **3413 ms** | 613 ms (static) |
| Round card on screen | 629 ms, laid OVER a reel that had started 562 ms *before* the card left | **1525 ms fully up, then a 260 ms exit; reels start 47 ms after the hand-over** | not shown (round in the panel header) |
| Reels spinning | 1704 ms (unchanged) | 1683 ms (unchanged) | none (stepped) |
| LOCKED stamp | 344 ms | 345 ms | 42 ms |
| Locked → candidates (absorb) | 654 ms | **806 ms** | 92 ms |
| Revealed → candidates | 310 ms | **461 ms** | 50 ms |
| Round card attaches on "Resume selection" | **yes (replay)** | **no** | — |

## 1. Start gate

Root cause: `PeakSeasonStartGate` used Run the Table's `.v2-rtt-gate-node*` classes, which
were deleted when RTT's gate was rebuilt in pass 3. With no CSS behind them the four steps and
both difficulty options rendered as inline text runs ("SpinThe wheel rolls…", "Easy3 team…").
The page now has its own composition in `court.css` (`.v2-court-gate*`): header (kicker /
display title at `--v2-display-size-moment` / 56ch lede), four steps on a ruled 4-column grid
(index, display-serif label, purpose), three run facts (`8 rounds · 5 + 3 · 82 games`), the
difficulty as two real option cards (`aria-pressed` → accent / negative ring), one CTA row with
its footnote beside the button, `--v2-space-8` vertical rhythm, 2/1-column collapses at 720/480px.
Every testid and every copy string the e2e/unit tests read is unchanged.

## 2. Opening intro (`components/v2/court/PeakV2CourtIntro.tsx`)

Fixed full-viewport stage on `PeakV2CinematicStage` + `PeakV2ArenaLight`: eyebrow
(`PEAK3 Arena · Practice run | Daily challenge`), the title `82-0 Peak Season`, a rule, one line
("8 real team-seasons are drawn. Draft one exact player-season from each, place them on the
court, and PEAK3 plays the 82."), and at 2.0 s the cue `Round 1 of 8 · Easy · the first
team-season is about to be drawn`. Beats are CSS `animation-delay`s on `data-beat`; the only
timers are the exit (`INTRO_MS - INTRO_EXIT_MS`) and the end (`INTRO_MS`). Not skippable — it is
shorter than the reel it precedes. Reduced motion: one static frame for `INTRO_REDUCED_MS`.

Contract in `CourtBuilder`: `introFor` (a game id) is set from the new `openingIntro` prop, which
`PeakSeasonStartGate` sets **only on the `createCourtGame` path** (`resume()` via `?game=` sets it
false), and by Play Again for the run it creates. While `introFor === state.game_id` the chooser
(and so the round card and the reels) is not mounted; the intro's `onDone` clears it. Nothing in
it touches state or the API; reload/resume never sees it (unit-tested).

## 3. Round reveal replaying on "Resume selection" — root cause and fix

`PeakV2CourtChooser` owned a local timer: `useEffect(() => {… setRoundCardFor(roundKey) …},
[roundKey, reduced, open])`. `open` was in the dependency list, so every time the docked panel
went minimized → open ("View court" → "Resume selection") the effect re-ran and re-opened the
card — it was keyed on the panel opening, not on the round.

Fix: the card is now `CourtBuilder`'s state, keyed on the authoritative round.
`roundCardDoneFor` (a `game:round` key) records the last round whose card has finished;
`roundCardOpen = !introOpen && !reducedMotion && status === selection_pending && roundCardDoneFor
!== roundKey && !ceremonyRevealed`; one effect keyed on `[roundCardOpen, roundKey]` marks it done
after `COURT_PACING.ROUND_REVEAL_MS`. A run resumed mid-placement initialises `roundCardDoneFor`
to its current round (nothing left to announce). The chooser only renders the card (kept mounted
for its 260 ms exit via a derive-from-props `leavingFor`, no effect, so there is no unmount blink)
and passes `start={!roundCardOpen}` to `SpinStage`. Leaving and resuming the panel changes none
of these inputs, so the card cannot come back. Verified live (one attach per round) and by unit
test (two minimize/resume cycles).

## 4. "Data receipt" tag removed

`PeakV2CourtLive` (`board-receipt`), `PeakV2CourtResult` (`result-receipt`) and the legacy
`SeasonResultStub` keep their `<details>` and testids, but the summary line is now the one fact a
player might want — `Seed 4471` (mono, muted, `.v2-court-provenance`, a quiet `· details` hint
that disappears once open) — with the versions / coverage / respin tally behind it. The e2e
"data receipt includes respin history after a respin" still clicks the same summary.

## 5. Result hierarchy (`PeakV2CourtResult`)

Hero unchanged in content; the tier label is now accent (`.v2-court-result-tier`). Below it, five
indexed sections, each opened by `index + display-serif label` on a hairline with `--v2-space-10`
above (`ResultSectionHead`): **01 Your roster, revealed** (aside: `8 exact player-seasons`),
**02 Run analysis** (stat row unchanged; best pick in positive tone, weakness in orange via
`data-tone`), **03 What decided this** (accent-dash list at body size, reassurance as a muted
note), **04 The model's detail** (PEAK3's picks + fit components grouped), **05 This run**
(Play again / Save / Share / Leaderboard on ONE plane, a 2-column hairline grid, `result-actions`;
read-only shows "Build your own" there), then a footnote block (`result-footnotes`: experimental
notice at 11px + the seed disclosure). New testids: `result-section-roster|analysis|factors|model`,
`result-actions`, `result-footnotes`, `decisive-factors`. Every previous testid kept.

## 6. Pacing — exact values

| Constant | File | Before | After |
|---|---|---|---|
| round card on screen before the reels | `COURT_PACING.ROUND_REVEAL_MS` (`lib/court-state.ts`) | 620 ms (chooser-local literal, over a running reel) | **1500 ms**, reels held (`SpinStage start`, `data-held`) |
| round card exit | `COURT_PACING.ROUND_REVEAL_EXIT_MS` | — | **260 ms** (overlaps the reels' first frames) |
| lock beat | `LOCK_MS` (`SpinStage.tsx`) | 350 | 350 (unchanged) |
| outcome absorb (revealed → list opens) | `COUNT_MS` (`SpinStage.tsx`) | 300 | **450** → settle → chooser = 800 ms |
| intro | `COURT_PACING.INTRO_MS / INTRO_EXIT_MS / INTRO_REDUCED_MS` | — | **3400 / 320 / 600 ms** |
| reduced-motion ceremony | `REDUCED_MOTION_LOCK_MS / REVEAL_MS` | 40 / 40 | 40 / 40 (unchanged; no card, no hold) |

`SpinStage` change: the mount effect still plans both reels and mounts them at their start row
(so the strip is present and structural e2e checks are unaffected); the ceremony clock
(`SPIN_MS → LOCKED → revealed → onRevealComplete`) is now armed by a `[start]` effect, and the
two-frame arm refuses `armed → spinning` while `held`. Under reduced motion `held` is never true.
No control is gated behind any of this (nothing is clickable in a list that is not yet shown);
input acknowledgement paths are untouched.

## Tests

- `npx tsc --noEmit` — clean. `npm run lint -- --max-warnings 0` — clean.
- Unit (`npx vitest run` on every file referencing `components/court` / `v2/court` + the two new
  files): **16 files, 211 tests, all green.**
  - New `court-polish-pacing.test.tsx`: constants in band; intro on a new run and on Play Again,
    not on resume (round 3) nor on a mid-placement resume; round card once per round, reels held
    then released, never re-triggered across two minimize/resume cycles; next round's card on a
    server-advanced round; no "Data receipt" text, seed as the summary.
  - New `court-result-hierarchy.test.tsx`: DOM order hero → roster → analysis → factors → model →
    actions → footnotes, emphasis tones, grouped actions, read-only variant, no tag.
  - Updated (budgets, not expectations): `court-builder-v2-resume-selection.test.tsx` and
    `court-builder-hint.test.tsx` `revealCeremony()` — was one 3000 ms fake-timer advance; now
    `ROUND_REVEAL_MS + 50` then 4000 ms in two acts (the hand-over is a state update React
    flushes at the end of an act, and only then is the reel clock armed).
- e2e `courtbuilder.spec.ts` (`chromium-courtbuilder`, retries 0, reusing the running servers):
  - `beginRun()` now also waits for `court-intro` to detach (the intro precedes round 1 of every
    created run; every timing assertion in the suite is about what follows it).
  - Play Again test: asserts the intro appears for the new run, waits it out, then keeps its
    `data-phase="revealed"` assertion (budget 5 s → 8 s, measured from the intro leaving).
  - `FULL_DRAFT_TIMEOUT_MS` 60 s → 90 s: a full draft carries 8 × ~1.65 s more deliberate,
    product-owned time (the constant's own comment describes exactly this case).
  - Result: see "E2E result" below (appended when the run finished).

## Notes / judgment calls

- Intro not skippable: 3.4 s, shorter than the reel it precedes; a skip control on a title card
  would read as an apology for the card. Reduced motion gets the 0.6 s static frame instead.
- Under reduced motion the round card is not shown (as before); the round is stated in the
  chooser header and the stage's live region, so no information is lost.
- `SeasonResultStub` (legacy, no longer routed) received only the label change.

## E2E result

`PLAYWRIGHT_RETRIES=0 npx playwright test src/tests/e2e/courtbuilder.spec.ts --project=chromium-courtbuilder --reporter=line`
(log: `scratchpad/e2e_court_run1.log`): **95 passed, 4 failed in 20.7 min; all 4 pass on an
immediate re-run (`--grep`, 4/4 in 1.2 min).** The four were environmental, not this change:

- "leaderboard submit panel does not render when the leaderboard feature is off" and
  "leaderboard page says the board is not open when the feature is off" — the shared :8000 API
  answered `leaderboard_enabled: true` at the time (the second test touches no file in this
  change: it is the `/arena/court/leaderboard` page alone). Both green on re-run.
- "the respin flourish reads as a different event…" and "respin controls are reachable and
  operable by keyboard alone" — the trace (`test-results/…/trace.zip`, network log) shows the
  `POST …/respin-team` / `respin-season` was SENT and never answered (status -1); `waitForResponse`
  then hit the 30 s test budget. The API was being edited by another workstream at the time
  (`apps/api/app/services/*` modified in the tree; `uvicorn --reload` drops in-flight requests
  on restart); a direct `curl` respin answers in 2 ms and both tests are green on re-run.
