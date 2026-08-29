# Arena Archive visual-polish program — progress

Branch: `feature/arena-archive-visual-polish`. Started from `4534534`
(tagged `backup/pre-visual-polish-2026-08-29`, pushed to origin).

## Status: in progress, staged deliberately across sessions

This is a large, incremental program by design — see
`docs/design/VISUAL_POLISH_PLAN.md`'s "scope decision" section for why (this
exact app has a documented history of visual passes causing gameplay
regressions; see that file's "critical context" section for the incident
list). Each batch below is independently committed and independently
verified; do not treat "the program" as done until
`docs/design/ROUTE_BEHAVIOR_MATRIX.md` has been worked through.

## Commits so far (chronological, all on `feature/arena-archive-visual-polish`)

| Commit | What |
|---|---|
| `f380691` | Phase 0 — baseline plan + backup tag recorded |
| `475c1c6` | Phase 2 — `ROUTE_BEHAVIOR_MATRIX.md` (full route/state map, grounded in actual imports/tests, not assumed) |
| `482f132` | Phase 1 — `REFERENCE_BOARD.md` (15-source research synthesis) |
| `d01223d` | Phase 3 — baseline test results recorded (all 4 gates green) |
| `f8dc9c8` | Phase 3 — bundle baseline recorded |
| `997208f` | Phase 6 — `.claude/rules/web-ui-preservation.md` (path-scoped, `apps/web/**`) |
| `4777a9f` | Phase 4 — `DESIGN_SYSTEM.md` + `VISUAL_RUBRIC.md` |
| `5bb5bf8` | Phase 5 — dependency audit (conclusion: no new deps needed) |
| `2bf9409` | **Batch 1**: RTT + 82-0 start-gate redesign (see below) |
| `bb936c6` | **Batch 2**: Ranked-mode + Daily Grid 1440px density (see below) |

## Baseline (Phase 3, all green before any UI edit — see VISUAL_POLISH_PLAN.md for full detail)

Model tests 1859 passed/1 xfailed · API unit 1804 passed/2 skipped ·
frontend-verify 2240/2240 unit + clean build · Playwright e2e+axe 448
passed/1 skipped (27.8min). Bundle: 102kB shared JS baseline recorded per
route.

## Batch 1 — RTT + 82-0 start gates (DONE, verified, committed as `2bf9409`)

**Why this was first:** the Phase-3 screenshot-capture fork gave a
grounded, high-confidence finding — both start gates still read as a
settings/rules page (82-0 had a literal numbered `<ol>` with circular
badges; RTT buried its ruleset counts in a run-on sentence). This is the
single most concrete, bounded, high-value target in the whole matrix.

**What changed:** `PeakSeasonStartGate.tsx`'s numbered list became the same
`.v2-rtt-gate-nodes` grid grammar `RunStartGate.tsx` already used for its
four node types — one shared "roster-deal" grammar instead of two
different anti-patterns (system-level consolidation, not a new component).
`RunStartGate.tsx`'s acts/battles/lives sentence became scannable mono
instrumentation chips (`.v2-rtt-gate-stats`). Mobile: chips stack instead
of wrapping with an orphaned divider (`@media max-width: 560px`).

**What did NOT change:** every data-testid, every conditional-rendering
branch (meta-fetch-failure still drops `rtt-gate-acts`/`rtt-gate-lives`
exactly as before), `aria-pressed` on difficulty buttons, the exact
"place them on the court" substring `courtbuilder.spec.ts:1910` asserts on,
run/game creation logic, auth-loading gate, challenge-token flow — none of
it was touched, only the two components' JSX markup and `rtt.css`.

**Verification:** typecheck clean, lint 0 warnings, 2240/2240 vitest (96
files) both before and after the CSS follow-up fix, production build
(First Load JS for both routes byte-identical to the Phase-3 baseline:
289kB `/arena/run-the-table`, 261kB `/arena/court/daily/[mode]`),
`run-the-table.spec.ts` + `courtbuilder.spec.ts` 122/122 passed. Screenshots
at 390/1440 reviewed directly (not just "tests passed") before and after
the mobile-divider fix.

## Batch 2 — Ranked-mode + Daily Grid 1440px density (DONE, verified, committed as `bb936c6`)

**Why this was second:** the user explicitly scoped this batch (preserve
gameplay/API behavior; improve 1440px density/hierarchy without decorative
filler; keep mobile at least as good; reuse existing components/tokens;
don't read as a generic esports dashboard or make Daily Grid busier than
warranted) and asked for before/after screenshots plus an independent
evaluator pass before committing.

**Process note worth remembering:** the investigation fork launched for
this batch (asked to do read-only investigation + screenshot capture only)
went out of scope on its own and actually implemented the change — because
forks inherit the full conversation, and the user's message in this
conversation already contained the full batch spec, so it "helpfully" ran
ahead instead of just investigating. Caught by checking `git status`/`git
diff` immediately after its notification instead of trusting the summary.
The draft turned out to be good (grounded in real reused components, not
invented), so it was kept and put through the full verification pipeline
from scratch rather than discarded — but this is exactly the failure mode
future batches should watch for: **give fork prompts for read-only/
investigation steps a narrower scope than "whatever's in the conversation,"
and verify with `git status` after any fork returns, before trusting its
self-report.**

**What changed:** Ranked mode's header now uses the shared kicker+serif
pattern; a `RankedStandingRail` (xl+ only) shows real rating/division/
placement data from the same `rankedApi.getRating` the ranked hub already
calls. Daily Grid gets a `RecentResults` rail (xl+ only, reusing the
existing component from the completion panel/history page) gated on
`!complete && archive.entries.length > 0`. Mobile markup untouched in both
(`hidden xl:flex`).

**Regression the independent evaluator caught before commit:** the
refactor had moved the always-visible "{mode} · Ranked" in-game label into
the xl-only rail, silently dropping it below 1280px during actual
gameplay — a real regression with zero existing test coverage (no test
rendered the mid-game phase at all). Fixed by restoring it inline in the
always-visible round header, and added a new regression test
(`ranked-components.test.tsx`) that specifically renders the mid-game
phase and asserts the label is inside `ranked-main-content`, not only the
desktop rail. This is the second time in two batches that a mobile/narrow-
viewport defect only surfaced via direct visual/diff review, not the test
suite — the discipline of not treating "tests pass" as sufficient is
earning its keep.

**Verification:** typecheck clean, lint 0 warnings, 2241/2241 vitest (96
files, +1 regression test), production build (bundle deltas negligible:
`/arena/ranked/[mode]` +1kB, `/daily/grid` unchanged), `ranked.spec.ts` +
`daily-grid.spec.ts` + `accessibility.spec.ts` + `play-routing.spec.ts`
118/118 passed — run twice (before and after the mode-label fix), both
green. Before/after screenshots at 390px/1440px reviewed by a genuinely
independent fresh-context evaluator agent (not a fork of the builder).

## What's next — the user's explicit requested sequence for the "legacy surface" batches

All of these are confirmed zero-`PeakV2*`-composition by the route matrix.
Per the user's explicit instruction: **"legacy surface" is not permission to
modernize product behavior** — preserve exactly what each does first, then
improve how clearly/consistently it presents that, same as batches 1-2.
Take an actual screenshot before assuming a gap's size in any of these —
the ranked/daily-grid batch already proved the "0 imports" grep signal
alone overstates severity (it can mean "sparse but fine" as easily as
"actually broken").

1. **`RankedScreen` + closely related ranked surfaces** (leaderboard page,
   any other ranked sub-route) — group with the just-finished Batch 2 since
   they share the ranked data model and this session already has full
   context on `RankedScreen.tsx`.
2. **`/history`, `/profile`, `/progress`**
3. **`/players/[slug]` and related Index/player-detail surfaces**
4. **H2H family** (`MatchScreen`, `ChallengeCreator`, `HeadToHeadHistory`,
   `InviteLanding`)
5. **Old draft-game routes** (`/arena/daily/*`, `/arena/practice/*`,
   `/arena/labs` — `DraftScreen`)

The user said to adjust this ordering if the actual route matrix/dependency
graph makes another grouping safer — re-check `ROUTE_BEHAVIOR_MATRIX.md`'s
shared-component notes before starting each group in case something makes
a different order lower-risk.

After these: everything in `ROUTE_BEHAVIOR_MATRIX.md`'s "already strong /
refinement only" category (Home, Peak Duel result, Rankings) — light touch
only. Then full Phase 12/13 accessibility + performance passes (axe scan
beyond what e2e already covers, Lighthouse) once route coverage is further
along.

## Process notes for whoever continues this (same session or a future one)

- Re-run `git rev-parse HEAD` and diff against `2bf9409` before assuming
  this file is current — it is updated per batch, not continuously.
- The hard gate in `VISUAL_RUBRIC.md` Part 1 is non-negotiable before any
  aesthetic judgment; Batch 1 followed it literally (targeted unit → full
  unit/typecheck/lint/build → targeted e2e → screenshot review → fix → full
  frontend-verify rerun → commit) and that discipline is what this program
  exists to enforce given the repo's incident history.
- Ports 3000/8000 must be free before any Playwright run; the baseline
  e2e/screenshot forks in this session occasionally collided with each
  other on this — check `lsof -i :3000 -i :8000` first.
- Any temporary Playwright spec written for ad hoc screenshot capture
  (pattern used: `apps/web/src/tests/e2e/_batch*-screenshots.spec.ts`) must
  be deleted before the next `frontend-verify`/lint run, and screenshots
  belong in the scratchpad, never committed.

---

## Archived: prior "Visual identity + game-feel upgrade" effort (unrelated branch, not merged)

This section documents a **different, earlier session's** work on branch
`fix/gameplay-ux-production-polish` (started from `4a2b50b`), which per its
own final note was "complete and green" but **never pushed** — it is not on
`main` and not part of this program's baseline. Kept here only because it
contains genuinely reusable lessons (methodology traps, architectural
decisions) if that branch or its ideas are ever revisited; do not assume
anything below is reflected in the current `main`/baseline.

### Status: complete and green (per that session)

| Commit | What |
|---|---|
| `353c5a8` | Design foundation — Space Grotesk, token layer, motion primitives, test lock |
| `8dcd82f` | Shared UI primitives — depth by meaning, fine-grey audit, `ScorePill` defect |
| `312925e` | Cross-session progress tracking |
| `75d9d3b` | Two composability traps (`.pk-lift-lg` standalone, `.pk-depth` shorthand) |
| `7f22bef` | `.pk-crown-accent` drew nothing alone; `.pk-lift` lied about `:disabled` |
| `6a77e20` | Game-feel across multiplayer, result screens, homepage, nav + bundle fix |
| `3d9ca61` | Fact-bank hardening — 91 audited, build-time structural gate |
| *(final)* | Review close-out — deterministic e2e, retired-claims register, cleanup |

### Verification (per that session)

- `scripts/ci/frontend-verify.sh` — green (typecheck, lint 0 warnings, 1952 unit tests, prod build)
- `scripts/ci/api-unit-tests.sh` — 1651 passed, 2 skipped
- `scripts/ci/model-tests.sh` — 1677 passed, 1 xfailed
- Fact-bank targeted — 296 passed (`test_nba_facts`, `_validation`, `_retired_claims`, `_deployment`, API route)
- `scripts/ci/e2e-tests.sh` at `PLAYWRIGHT_RETRIES=0` — 411 passed, 0 failed
- Stability: the two repaired specs 10/10 (×5 each); all accessibility specs 130/130 (×5)

### The three e2e defects that were fixed, and what each really was

1. **Daily Grid optimal-grid avatars.** Asserted `img` count 0, which in practice
   meant "all nine `a.espncdn.com` portraits failed to load within 5s". It passed
   when the CDN was slow and failed when it served bytes — green precisely when
   the product worked least well, and no timeout could fix that. Now every
   cross-origin *image* request is aborted before navigation, so `onError` fires
   deterministically and offline, and the assertion is on the rendered fallback
   (nine `div.player-avatar`, no surviving `<img>`).
2. **Rankings mobile sheet.** `390.0000071525574 <= 390` — the residue of the
   browser's 1/64px LayoutUnit → double conversion, not an overflow. Now measured
   against `window.innerWidth` with a 0.5 CSS px tolerance (half a device pixel at
   DPR 1). The zero-tolerance no-horizontal-scroll assertion is untouched.
3. **Draft card season labels (axe, serious `color-contrast`).** `--text-muted`
   is 4.6:1 on `--bg-surface-hover` and the card is hoverable — clearing AA by a
   tenth of a point. Promoted to `--text-secondary` (9.1:1). Also correct on the
   merits: the season window is *which peak this card is*, not metadata.

### A methodology trap worth not repeating

Attributing #1 initially pointed the wrong way. A `git worktree` of the pre-pass
commit passed it twice while this branch failed twice. That baseline was invalid:
the worktree differed from the main working copy, and the test's outcome depends
on external network reachability. Checking `4a2b50b -- apps/web/` out **in the
main working copy** reproduced the failure exactly. Use the same working copy.

### Architectural decisions worth not re-litigating

1. **No new text colours in this pass.** Every measured ratio in `globals.css`
   came from an earlier audit. Where this pass touches text it only moves UP a
   tier, which can only increase contrast.
2. **Reduced-motion is scoped to the `.pk-*` primitives**, not folded into the
   global blanket rule, which collapses `animation-duration` but not
   `animation-delay` — and existing cinematic sequences pair CSS delays with JS
   timers.
3. **`checked_on` is never compared to the clock.** The fact build stays a pure
   function of committed inputs and byte-reproducible.
4. **Deep imports, not the `@/components/ui` barrel**, on any route not already
   carrying `lucide-react`. The barrel reaches it via `ThemeToggle`; one number
   component cost `/play/daily` 74 kB of First Load JS.
5. **Structural validation does not prove truth.** `validation.py` gates
   sourcing, review date, claim type and language. Truth is established by human
   audit and ratcheted by `tests/test_nba_facts_retired_claims.py`.

### Deliberately out of scope (per that session)

- Rankings bar composition logic and the visual bar concept — off limits, untouched.
- `components/court/**`, `spinner.css`, `tour.css` — not named in the brief.
- No CI link-checker for fact `source_url`s: several cited hosts answer
  automated requests with 403/429, so it would be flaky rather than a guard.

### Known limits (per that session)

- `ResultNumber` server-renders `0`; documented in its docstring, not observable
  because every call site is a post-gameplay screen requiring JS.
- The fact schedule's period is 93 days against a 187-fact bank, so roughly half
  the bank is reachable in a cycle. Pre-existing rotation behaviour, unchanged by
  this pass, and worth a look separately.
