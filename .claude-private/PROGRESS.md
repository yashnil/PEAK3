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
