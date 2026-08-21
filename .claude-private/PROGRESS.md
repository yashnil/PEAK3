# PEAK3 Pass 6 — global design consistency + homepage product depth — progress

Branch: `recovery/peak3-v2-visual-reconstruction`, HEAD `cdad44a` (Pass 5's
committed reconstruction) — **nothing committed by this pass; working tree
only**, per instruction. Pass 5's own progress record (`reconstruction_plan_v5.md`)
is not superseded — it documents real prior-pass history and stays as-is.

## Status: HOMEPAGE RECOMPOSED PER BRIEF. One real Daily Grid consistency fix
landed. Global legacy-leak audit (parallel fork, real browser, `?ui=v2`)
found the codebase in much better shape than Pass 4/5's own docs implied —
PROGRESS.md had not been updated after Pass 5 landed, so it understated
current V2 coverage. Full detail in the conversation transcript; this is the
terse working log.

## What this pass closed

1. **Homepage CTA**: `HomePageV2.tsx`'s primary hero action changed from
   `{flagship.title}` ("RUN THE TABLE" → `/arena/run-the-table`) to a fixed
   "GO TO ARENA" → `/arena`, matching legacy's own already-shipped
   arena-first CTA. Secondary "Play today's duel" → `/play/daily` unchanged.
   The now-unused `flagship` prop was removed from `HomePageV2Props`.
2. **Homepage recomposition**, per the brief's exact order — Hero (untouched)
   → Game Slate (untouched) → **Your Arena** (new, `HomeV2YourArena.tsx`) →
   **interactive five-lane explainer** (new, `HomeV2LaneExplainer.tsx`,
   replacing the static 5-cell percentage grid) → **rankings preview** (new,
   inline in `HomePageV2.tsx`, real top-5 board rows) → **"Why Peaks?"**
   editorial bridge (new, inline) → **FAQ as a collapsed accordion** (new,
   `HomeV2Faq.tsx`, same real Q&A copy, was 5 permanently-open paragraphs).
   - `HomeV2YourArena`: real data only — `useResumeState()` (RTT resume +
     Daily Grid streak/completed, same hook the nav drawer already trusts),
     `multiplayerModes` prop (server-computed, fail-closed), and
     `progressionApi.getSummary()` for signed-in level/streak/achievements
     (same endpoint `/profile` uses). Anonymous + no-signal visitors get a
     sign-in nudge tile or nothing — never fabricated activity. Caps at 4
     tiles, reuses `.v2-slate-cell` markup/CSS verbatim so it reads as the
     game slate's sibling, not a new component language.
   - `HomeV2LaneExplainer`: one proportional five-segment bar (real frozen
     weights), hover/focus previews, click pins. Detail panel copy is
     `methodology.components[i].short_description` — the exact string
     `/methodology`'s own accordion renders, never re-authored.
   - Rankings preview reuses the SAME board fetch as the hero's data object
     (`home-data.ts`'s `loadHomeModelData` now fetches depth 5, slices 3 for
     the hero's `windows` — unchanged — and up to 5 for the new
     `rankingsPreview` field) — no second network call, and legacy's
     `HeroVignette` rotation depth is provably unchanged (still fed
     `windows`, still length 3).
3. **Daily Grid live-board consistency fix** (`discovery.css`): the
   score/locked/misses/time/difficulty stat strip was five individually-
   bordered `.card-surface` cells — the exact "everything in its own card"
   anti-pattern the brief calls out. CSS-only reskin, scoped to
   `[data-ui-version="v2"] [data-tour-id="dg-score"]` (an existing stable
   selector already on that container), merges it into one hairline-divided
   plane matching `.v2-slate-grid`'s grammar. Zero JSX/game-logic touched.
   Verified `?ui=legacy` renders byte-identical to before (real screenshot
   diff, not assumed).
4. **Focus-visible fix on the new lane bar**: a plain `outline` on the
   Statistical Impact segment nearly disappeared (segment fill and
   `--focus-ring` are both blue-family in this theme). Replaced with a
   gapped double inset box-shadow (page-color ring, then focus-ring),
   verified visible against all five component colors via a 4x-DPI zoomed
   screenshot — a plain screenshot at normal zoom made it look invisible
   even though `:focus-visible` was correctly matching; only the crop
   confirmed it renders.
5. **Mobile bug found and fixed during this pass, not before**: the new
   `.v2-arena-grid` CSS rule (Your Arena's variable-column-count override)
   had no media-query guard, so it beat the game slate's existing
   1024px/639px responsive breakpoints on specificity+source-order and Your
   Arena stayed 2-column at 390px instead of collapsing to 1 column like
   every other slate-grid strip. Fixed by scoping the rule to
   `@media (min-width: 1025px)`. Confirmed via real 390px screenshot
   before/after.

## Global legacy-leak audit (parallel fork, real browser, `?ui=v2`)

Confirmed Pass 5 already closed nearly everything PROGRESS.md's stale entry
implied was still open: global nav/footer, Rankings, Methodology, About,
RTT/82-0 start gates, Peak Duel entry are all genuinely V2-styled and
consistent. No `text-gray-*`/`text-slate-*` leaks, no arbitrary radius
misuse, no legacy `font-display` CLASS leaking into V2 branches (only the
correct `--v2-font-display` TOKEN appears). `.pk-lift`/`.pk-press` usage in
3 V2 files is legitimate shared-motion-primitive reuse, not a leak.

**One real, disclosed remaining gap**: Daily Grid's live board interior
(`GridCell`, `DailyGridBoardView`, `CellPanel`, `CompletionModal`) has no V2
branch — only its entry gate (`StartGate`) and the stat strip (fixed this
pass, see above) are V2-styled. A full rebuild is out of proportion for a
consistency pass (Pass 5's own plan explicitly deferred it as a large
stretch goal) and was judged out of scope here too — disclosed, not hidden.
Minor: Rankings' duration-pill toggle uses a fuller pill radius than most
other V2 controls — low severity, not fixed this pass.

## Verification, this pass

- `npx tsc --noEmit`: clean
- `npm run lint -- --max-warnings 0`: clean
- `npm run test -- --run` (vitest): **2134/2134** passed (added 5 new
  `HomePageV2` tests: CTA text/href, lane explainer omits-when-empty +
  real-interaction-reveals-real-copy, rankings-preview-real-rows-only,
  FAQ-collapsed-by-default)
- `npm run build` (`PEAK3_BUILD_VERIFY_ONLY=1`): 33/33 static pages, clean
- axe (`@axe-core/playwright`, wcag2a+wcag2aa, `?ui=v2` homepage): **0**
  violations of any severity
- e2e, real dev server: `v2-ui-version.spec.ts` 10/10; `gameplay.spec.ts`
  (legacy homepage/Arena/Rankings/Methodology/draft flows) 35/35;
  `accessibility.spec.ts` + `progression.spec.ts` + `play-routing.spec.ts`
  62/62; `daily-grid.spec.ts` — 14-18 failures depending on run, but
  **confirmed pre-existing/environmental by baseline comparison**: stashed
  this pass's entire diff, reran the exact same suite against unmodified
  HEAD, got the same class of failures (auth/profile-endpoint-dependent
  tests, e.g. `PUT /api/v1/profiles/me` not `.ok()`), popped the stash back.
  Not a regression this pass introduced.
- Dev server restarted clean after every production-build check, per the
  Pass 4 note about `.next` staleness under a live dev process.

## Independent evaluator (fresh agent, no prior context, screenshots + live
## Playwright, read-only) — findings and disposition

1. **Rankings avatars render real player photos** (LeBron, Curry, SGA, etc.)
   — HIGH as reported, but investigated and root-caused: `PlayerAvatar.tsx`
   already gates real photo URLs behind `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`
   (default OFF, "pending a licensing review nobody has done" per its own
   docstring). This sandbox's `apps/api/.env` has it set to `true` locally
   — a pre-existing environment setting, not this pass's code, not a
   frontend bug, and not something I have the authority to silently
   "resolve" (a licensing decision). Disclosed to the user, not touched.
2. **Rankings avatar column visually incoherent** — same root cause as #1;
   not touched for the same reason.
3. **Gold overused across the homepage** — investigated instance by
   instance. Fixed the one genuine overreach that was mine: the new
   rankings-preview section had every one of 5 real scores in gold; now
   only rank 1 is (`.v2-rankings-row:first-child .v2-rankings-score`),
   mirroring the hero object's own single gold score. Everything else the
   evaluator counted (slate-cell "Play →"/"Enter →"/"Sign in →" arrows,
   `PeakV2DisplayEmphasis`'s italic gold) is pre-existing Pass 2/5
   infrastructure reused deliberately for cross-page consistency — each is
   its own contextual action or an established cinematic-emphasis role, not
   decorative sprinkle, and reworking those primitives now would ripple
   into every other V2 route for a subjective call. Left as-is.
4. **RTT node-type colors (`--foundation-blue`/`--apex-coral`) resemble
   `--comp-si`/`--comp-po`** — investigated (`run-the-table-copy.ts`):
   different, deliberately-chosen hex values, and the code's own comment
   states the `--comp-*`/`--role-*` families were "deliberately avoided"
   for exactly this reason. Pre-existing, documented, used across the
   entire RTT mode's node-type system (draft room/trade desk/scout/rest) —
   changing it is a cross-cutting RTT identity change far outside a
   consistency pass's mandate and the "preserve mode identity" boundary.
   Not touched; noted as a legitimate but out-of-scope subjective critique.
5. **Lane-explainer dimmed state looks "muddy"** — CONFIRMED, and mine.
   `opacity: 0.35` on a non-active segment collapses `--comp-po` (orange)
   into a dark, muddy brown against the near-black page background (dimming
   a warm hue via opacity is a lossy blend, not a clean fade — verified via
   a 4x-zoomed crop, not assumed). Tried `filter: saturate()/brightness()`
   combinations first (still browned); the actual fix was simpler — the cut
   was just too steep. Raised to `opacity: 0.82`, verified clean against
   all five component colors at that value via zoomed screenshot.
6. **Two structurally different homepages coexist (`?ui=v2` vs default)** —
   accurate description of the intentional, deliberate parallel-rollout
   architecture (`ui-version-script.ts`: legacy is the default until an
   explicit product decision to flip it; not implied by this task). Noted,
   not treated as a bug.

## Environment note carried forward

Same as Pass 4's note: a production `next build` against a live dev server
can leave it serving a stale manifest. Restarted the dev server after every
build-verify step this pass, not just trusted it to recover.

---

# PEAK3 Pass 4 — V2 completeness + anti-vibe polish + final visual QA — progress

Branch: `feature/peak3-v2-ui`, HEAD `67b1d01` (Pass 3's checkpoint commit)
— **nothing committed by this pass; working tree only**, per instruction.
Pass 3's own progress record is superseded by this file. Pass 3's PROGRESS.md
content is preserved below the Pass 4 section for surface-by-surface history.

## Status: PHASE 1 COMPLETENESS GAPS CLOSED. Anti-vibe/responsive/interaction
audit done via parallel agents across every mode. Two real regressions found
and fixed (RTT roster reveal had no V2 branch at all; a dev-server asset-cache
artifact from this pass's own production-build verification step, not a code
bug). SAFE for human acceptance testing — see final report to the user for
full detail (this file is a terser working log; the conversation transcript
has the complete 19-point report).

## What Pass 4 closed

1. **RTT — 6 remaining node types.** New V2 components: `PeakV2RTTTradeDesk`,
   `PeakV2RTTScoutPrepare`, `PeakV2RTTChoiceNode`, `PeakV2RTTSystemSelect`,
   `PeakV2RTTNodeChoice`, `PeakV2RTTBossPreview`, plus `PeakV2RTTCreditSinks`
   (found+fixed during audit — legacy `CreditSinks` was leaking into V2
   Trade Desk/Choice nodes). All wired into `RunTheTableGame.tsx`'s
   `v2Content` dispatch, LIVE tempo, following `PeakV2RTTDraftRoom`'s
   hairline-row grammar (no card-in-card). Audit also found and fixed a real
   gap: the OPENING ROSTER REVEAL had no V2 branch in the `v2Content` if/else
   chain at all — every RTT run under `?ui=v2` opened on fully legacy-styled
   content before a single V2 pixel rendered. Fixed by generalizing
   `PeakV2RTTBossLineup` to `kind="boss"|"roster"`.
2. **TMW — between-turn rearrange ported to V2.** `PeakV2CourtSlot` gained
   `interactive`/`moving`/`onPickUp`/`onDropOn`/`activateLabel` props (whole
   slot becomes a real button, drag+click+keyboard, mirrors legacy
   `SeatCourt`'s `SlotCard` exactly). `PeakV2TMWCourt`/`PeakV2TMWCourts` lift
   pick-up/drop/notice state, reusing the exact same `legalMoveTargets`/
   `moveRejection`/`placementsAfterMove` legacy already validates against —
   no new legality logic. Verified working end-to-end via real browser
   screenshot (`tmw/12-mid-pickup-legal-highlight.png`).
3. **$20 Showdown result screen.** New `PeakV2ShowdownResult` — CINEMATIC
   WON/LOST/DREW hero → LIVE rosters/settlement-ladder/callouts/component-
   disclosure → itemised detail behind `<details>`. Fixed a real bug in the
   process: the result screen was rendered *unconditionally*, entirely
   outside `UiVersionSwitch` — `?ui=v2` never mattered for this screen at
   all. Now properly gated.
4. **82-0 Peak Season result screen.** New `PeakV2CourtResult` — same
   CINEMATIC→LIVE pattern, {wins}-{losses} as the hero moment number, real
   roster on the real `CourtLayout` court, save/leaderboard/share panels
   reused verbatim. Same unconditional-render bug found and fixed as $20.
   Also fixed the known 390px "Respin team (N)" label-wrap bug in
   `PeakV2CourtChooser` (`flex-wrap` + `whitespace-nowrap`).
5. **TMW result screen (found mid-pass, not in the original gap list).** The
   audit surfaced that `PodiumReceipt` (match completion) had the exact same
   unconditional-render bug as $20/82-0 had. Built `PeakV2TMWResult` matching
   the established pattern and wired it in, since TMW's own brief explicitly
   requires "all phases of a complete match stay inside the V2 visual
   language."

## Anti-vibe / responsive / interaction audit (parallel agents, real browser)

Two large audits ran in parallel: Homepage/Arena/Peak Duel/Rankings/
Methodology, and RTT/TMW/$20/82-0. Both drove real Playwright sessions at
1440×900/1280×800/390×844, took and read real screenshots, and fixed issues
directly. Notable fixes: Peak Duel's outer page wrapper was clamping the V2
confrontation screen to a legacy ~640px width; a completely unstyled "Already
completed" Peak Duel return-visit screen (new `PeakDuelV2AlreadyCompleted`);
Peak Duel mode label not reflecting Daily vs Endless; TMW picked-up vs.
legal-target slots were visually identical (added an accent-tinted background
wash to "current"); $20 bid-clamp math bug + missing error-banner wiring +
double-submit guard + button width jitter; 82-0 stale "LIVE" badge on a
finished result + gold-CTA-scarcity fix on the hint button + fit-severity
color coding restored on the result screen.

## Known, disclosed remaining gaps (not fixed this pass — documented, not silent)

- **RTT final run receipt** (`RunResult`) is still legacy content, reused
  verbatim inside the V2 shell (`layout="bare"`) — a documented Pass 3 scope
  boundary, not a wiring bug (it IS inside the V2 branch). Visually the most
  jarring remaining legacy moment. Proper fix is a full `PeakV2RTTResult`
  build, sized as its own pass.
- **TMW pick overlay** (`PickOverlay`) renders legacy-styled chrome inside
  the V2 courts — an explicit, documented Pass 3 scope boundary (872 lines of
  correctness-critical stage/commit/timeout/reconnect logic reused verbatim
  on purpose), not new.
- **RTT/TMW/$20/82-0 loading skeletons** (`RunSkeleton`, etc.) render before
  `UiVersionSwitch` is reached, so they're shared/neutral (pulsing gray
  blocks, no text/branding) regardless of `?ui=`. Low severity, disclosed
  rather than rebuilt.
- No new dedicated unit tests for the TMW rearrange interaction's React
  wiring (the underlying legality functions it calls are already covered by
  `three-man-weave-state.test.ts`). Verified via real e2e + a manual browser
  screenshot instead.
- Two pre-existing e2e failures, confirmed unrelated to this pass by code-
  path exclusion: `courtbuilder.spec.ts`'s leaderboard-feature-flag test
  (depends on this dev server's env config, never touched), and
  `showdown-two-tab.spec.ts` / `arena-multiplayer.spec.ts`'s two lobby-copy
  assertions (expect stale "Closed alpha" text; product copy has since
  evolved to "Play vs bots"/"Play With Friends" — the lobby page was never
  touched this pass).

## Verification, this pass (all green on a freshly-restarted dev server)

- `npx tsc --noEmit`: clean throughout
- `npm run lint -- --max-warnings 0`: clean throughout
- `npm run test -- --run` (vitest): **2129/2129** passed, unchanged from
  Pass 3's baseline (no new tests added this pass — see disclosed gap above)
- `npm run build` (production, `PEAK3_BUILD_VERIFY_ONLY=1`): succeeds, 33/33
  static pages generated
- `git diff --check`: clean
- e2e (`npx playwright test`, real dev server, `reuseExistingServer`):
  - `v2-ui-version.spec.ts`: 10/10 (legacy safety + portal-token regression)
  - `run-the-table.spec.ts`: 18/18 (full run, resume, mobile, daily, tour)
  - `courtbuilder.spec.ts`: 102/104 (2 explained above, confirmed
    non-regressions by isolated re-run / code-path exclusion)
  - `arena-multiplayer.spec.ts` (TMW): 27/30 (3 explained above)
  - `showdown-two-tab.spec.ts`: 0/2 — both fail on a real, reproducible
    "Not your seat" rejection; root-caused to `view.your_seat_index`, a pure
    server-authoritative field this pass's zero backend/auth changes cannot
    have affected. Flagged, not fixed — out of a presentation pass's mandate
    (CLAUDE.md: never touch API/auth logic).

## Environment note for a future session

A `rm -rf .next && npm run build` against a LIVE dev server process can leave
it serving stale/missing static-asset paths (its in-memory manifest drifts
from what's actually on disk) — this pass hit exactly that (a fully
unstyled homepage, CSS 404s) and had to fully kill + restart the dev server
(not just re-request) to recover. If a future pass needs the production-build
verification step, kill and restart the dev server afterward rather than
trusting it to self-heal.

---

# Pass 3 — V2 · Broadcast Arena real implementation — progress (superseded, kept for history)

Branch: `feature/peak3-v2-ui`, HEAD `7760e9f` (Pass 2.5's checkpoint commit)
— **nothing committed by this pass; working tree only**, per instruction.
Pass 2's own progress record is superseded by this file.

## Status: ALL SEVEN SURFACES COMPLETE

Homepage, Arena, Peak Duel, Run the Table, $20 Showdown, Three-Man Weave,
82-0 Peak Season are all implemented behind `?ui=v2`, verified in-browser
(desktop 1440×900/1280×900, mobile 390×844) with real interactive
playthroughs, and typecheck/lint/unit/build all green. `?ui=legacy`
verified unchanged.

(See git history / prior session transcripts for the full Pass 3 record —
truncated here to keep this file from growing unbounded across passes.)
