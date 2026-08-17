# PEAK3 Pass 3 — V2 · Broadcast Arena real implementation — progress

Branch: `feature/peak3-v2-ui`, HEAD `7760e9f` (Pass 2.5's checkpoint commit)
— **nothing committed by this pass; working tree only**, per instruction.
Pass 2's own progress record is superseded by this file.

## Status: ALL SEVEN SURFACES COMPLETE

Homepage, Arena, Peak Duel, Run the Table, $20 Showdown, Three-Man Weave,
82-0 Peak Season are all implemented behind `?ui=v2`, verified in-browser
(desktop 1440×900/1280×900, mobile 390×844) with real interactive
playthroughs, and typecheck/lint/unit/build all green. `?ui=legacy`
verified unchanged.

## Concurrent-writer note (for context only, resolved)

Mid-session, Homepage/Arena/the Peak Duel distribution endpoint were found
already implemented by an earlier part of this same session (context had
been compacted). Two spawned "investigation only" forks also ignored that
instruction and briefly wrote code before being caught and stopped. Both
issues are fully resolved — one real bug (duplicate import) and one
orphaned duplicate file were found and fixed/deleted. No further action
needed; noted here only so a future session doesn't re-investigate it.

## Status by surface

1. **Homepage** — DONE. `HomePageV2.tsx`: two-column cinematic hero (real
   rank-1 window, five real `PeakV2DataLane` component contributions),
   frozen-weights strip, full mode slate as hairline rows (`HomeV2ResumeRow`
   gives RUN THE TABLE real resume state via `useRttResumeState()` — fetches
   the real live run, not just a localStorage flag), Q&A rows linking to
   `/methodology`.
2. **Arena** — DONE. `ArenaPageV2.tsx` (was previously not wired to
   `UiVersionSwitch` at all). `ArenaV2ResumeHero.tsx` cinematic entry (real
   resume or "Every mode. One arena." no-run state), grouped LIVE mode rows,
   multiplayer gated on real `arenaCatalogue.available`.
3. **Peak Duel** — DONE. `components/v2/duel/{PeakDuelV2Stage,Question,Reveal,Final}.tsx`,
   wired into `game-engine.tsx`. Question: fixed left/right identity, paired
   cool/warm `PeakV2ArenaLight`, V2 fractional-second countdown layered over
   the real hidden `ArenaTimer`. Reveal: five `PeakV2DataLane` lanes, real
   server explanation, ~1.2-1.5s auto-advance preserved. Final: cinematic
   "X/10" + a REAL lifetime 0/10..10/10 distribution
   (`GET /api/v1/game/daily/distribution`, already implemented + tested for
   idempotency/Pacific daily identity; 600ms delay avoids a real race
   against the sibling `postDailyResult` write). Mobile: both side panels
   rewritten to stay left-aligned in the stack (found and fixed a real
   "squeezed desktop split" bug via screenshot review).
4. **Run the Table** — DONE. `components/v2/rtt/{PeakV2RTTShell,BossIntro,
   BossLineup,BattleResult,DraftRoom}.tsx`. Three-region `width="live-wide"`
   shell (run map / decision / roster-lanes) for normal decisions — real
   V2 Draft Room built; five other node types (Trade Desk, Scout & Prepare,
   Choice/Rest Bank, System Select, Node Select, Boss Preview) reuse the
   exact already-computed legacy `surface` node inside the V2 shell — a
   deliberate, documented scope boundary, not an oversight. Boss reveal:
   two-phase cinematic (`PeakV2RTTBossIntro` then `PeakV2RTTBossLineup`,
   preserving Pass-1's exact two-step gating), sequenced `PeakV2ArenaLight`
   driven by `sequence.activeIndex`. Boss result: "3—2 / Victory over The
   Wall" scoreline + five dot-on-line lane comparisons, `roster_total` kept
   strictly secondary. Verified end-to-end in-browser: decision → boss
   intro → boss lineup reveal → boss briefing (reused legacy `BossPreview`)
   → battle result, at 1440×900.
5. **$20 Showdown** — DONE. `components/v2/showdown/{Intro,Live,Clock,
   BidControls}.tsx`. Intro: "Somebody always overpays." cinematic, real
   budget/slots/skips mirror. Live: three-column (your roster / lot+bid+
   clock+controls / opponent roster), one warm `PeakV2ArenaLight`, real
   `SettledLotTray` reused, bid controls rebuilt in V2 calling the exact
   same `bidBlockedLabel`/`passActionLabel`/`passActionCost` helpers (no
   legality reimplementation). Mobile: lot dominates the viewport, both
   rosters collapse into `<details>` disclosures — a real, deliberate mobile
   composition, not a squeeze.
6. **Three-Man Weave** — DONE. `components/v2/tmw/{Court,Courts,Reveal}.tsx`.
   Courts use `PeakV2CourtPanel`+`PeakV2CourtSlot` (Pass 2.5's grammar,
   its first real integration) in a real PG/SG-SF/PF-C grid; active seat lit,
   siblings dimmed-not-hidden. Reveal reuses `SpinReel` verbatim (the real
   split-flap primitive) inside a `.tmw-ceremony`-classed wrapper (reuses the
   real, already-tuned aperture/mask/payline CSS rather than approximating
   it). Staged selection reuses legacy `PickOverlay` verbatim (872 lines of
   correctness-critical stage/commit/timeout/reconnect logic — a deliberate
   scope boundary). Mobile: real tab bar (court per seat, "You" default) —
   found the naive stacked-grid was wrong per the brief's explicit ask and
   rebuilt it as tabs. Known gap: TMW-10's "drag to rearrange between turns"
   is NOT ported to V2 (read-only courts outside the pick overlay) — a
   documented, deliberate cut, not an oversight.
7. **82-0 Peak Season** — DONE. `components/v2/court/{CourtLive,Chooser,
   CourtSlotCard}.tsx`. Reuses the real `CourtLayout` UNCHANGED (its actual
   thin-line court markings — paint/arc/rim — already are what the brief
   asks for) with a new V2 `renderSlot`. Projected season record is the
   cinematic-number headline stat (`PeakV2Score role="moment"`), from real
   `live_build.provisional_record_range`. Chooser: `PeakV2DockedPanel`
   (built Pass 2.5 explicitly for this, its first real integration) —
   court visible/dimmed behind, never opaque full-screen — reuses `SpinStage`
   and `EligiblePlayerSearch` verbatim inside new V2 chrome. **Found and
   fixed a real bug** via interactive testing: the panel's `open` condition
   was inverted from legacy's own `hidden={phase !== "spinning" ||
   overlayMinimized}`, which would have kept the docked panel covering the
   court during the "placing" phase — court slots were unreachable. Fixed to
   `open={phase === "spinning" && !overlayMinimized}`; verified end-to-end
   afterward (choose → panel closes → court shows real "Place here" targets
   with real fit labels → place → LiveBuildPanel shows real identity_tags →
   next round auto-rolls behind).

## Global coherence

Achieved by construction — every surface is built from the SAME shared V2
primitive set (`PeakV2Primary/SecondaryAction`, `GameStatus`, `Timer`,
`Score`, `DataLane`, `ArenaLight`, `CinematicStage`, `LiveHeader`, `Rule`,
`Shell`, `CourtPanel`/`CourtSlot`, `DockedPanel`) rather than seven parallel
implementations. `lib/v2-component-map.ts` (new, this pass) is the one
canonical `RankingComponentKey` → V2 tone/label map, used by both Peak Duel
and RTT rather than two drifting copies. RTT/TMW's `LANE_TOKEN_TO_TONE`
maps are a genuinely different domain (server `LaneToken` strings, not
`RankingComponentKey`) — not duplication of the same concept.

## Verification run, this pass (all green)

- `npx tsc --noEmit`: clean, every batch
- `npm run lint -- --max-warnings 0`: clean, every batch
- `scripts/ci/frontend-verify.sh` (typecheck + lint + vitest + production
  build): **2129/2129 unit tests passed**, build succeeds
- `scripts/ci/api-unit-tests.sh`: **1784 passed, 2 skipped, 15 deselected**
- `scripts/ci/model-tests.sh`: **1806 passed, 1 xfailed**
- `git diff --check`: clean
- NOT run: `api-integration-tests.sh` (needs a real Postgres/Supabase test
  project not configured in this environment) and `e2e-tests.sh` (starts
  its own services; the same interactive flows — Peak Duel full 10-round
  completion, RTT decision→boss→battle, $20 full lot cycle, TMW
  reveal→stage→draft, 82-0 roll→choose→place — were already exercised
  manually via Playwright during this pass's own visual verification).
- Manual in-browser verification, every surface, desktop + mobile, with
  real interactive playthroughs (not just static screenshots) — this is
  where both real bugs (Peak Duel mobile alignment, 82-0 panel-open
  inversion) were actually found.

## Local dev environment note

If resuming: `uvicorn ... --reload` is required (a non-reloading instance
served stale routes once this pass). Running `scripts/ci/frontend-verify.sh`
`rm -rf`s and rebuilds `apps/web/.next` for its production-build step, which
DELETES this same day's `npm run dev` server's HMR cache and breaks it —
restart `npm run dev` after running that script.

## Remaining ideas for a Pass 4, if one happens

- RTT: V2 treatments for Trade Desk / Scout & Prepare / Choice-Rest-Bank /
  System Select / Node Select / Boss Preview (currently legacy `surface`
  reused inside the V2 shell — functional and reasonably cohesive, not
  fully redesigned).
- TMW: port TMW-10 (drag-to-rearrange between turns) to the V2 courts.
- $20: the post-match receipt/result screen (`ShowdownResult`) is untouched
  — not in this pass's explicit scope, but a natural next surface.
- 82-0: `SeasonResultStub`/leaderboard/save/share panels untouched — same.
- Mobile respin-button label wrapping in the 82-0 chooser (`Respin team
  (3)` wraps to two lines at 390px) — cosmetic, not functional.
- A full `e2e-tests.sh`/`api-integration-tests.sh` run in an environment
  with the needed services configured, as a final gate before any merge.
