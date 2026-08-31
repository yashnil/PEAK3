# Old Branch Semantic Rescue Audit

**Date:** 2026-08-31/09-01
**Auditor branch:** `audit/pre-main-branch-reconciliation` (HEAD, based exactly on the accepted branch `feature/arena-archive-visual-polish`, accepted visual SHA `b8508ed`)
**Scope:** Nine commits from five old local branches — `backup/pre-cloud-reconstruction`, `feature/peak3-product-polish`, `feature/peak3-v2-ui`, `fix/product-ux-recovery`, `recovery/peak3-v2-visual-reconstruction` — none of which are ancestors of the accepted branch.

## Method

For every commit, the full patch was read (`git show <sha>`), each distinct change was separated into behavioral / visual / test-only / doc-only, and every behavioral change was checked against current HEAD two ways: `git diff <sha> HEAD -- <file>` (an empty diff is the strongest possible evidence of survival — same bytes, same behavior), and where the diff was non-empty, a direct read of the current implementation to confirm the underlying invariant (not just "tests pass"). Four investigation workers covered the nine commits in parallel; findings below were then spot-verified independently (see Verification note).

**Central provenance finding.** Two squash-merge commits are ancestors of current HEAD and were not visible from the old branches' own history:

- `07349b0` — "PEAK3 V2 final product integration (#23)", 2026-08-27
- `4534534` — "Complete PEAK3 product UX recovery (#24)", 2026-08-29

Their PR descriptions match, near line-for-line, the intent of the old commits audited here (V2 rebuild of Peak Duel/Court/TMW, timer-lifecycle fixes, drag-and-drop, position filtering, accessibility). In practice this means the old branches are **earlier, messier drafts of work that was independently re-implemented and landed through a different, squashed path** — not orphaned fixes. This was confirmed, not assumed: for the large majority of files below, `git diff <old-sha> HEAD -- <file>` is byte-empty.

**Verification note.** I independently re-ran a sample of the reported diffs myself after the four workers reported back (`git diff` on `nba_peak/perfect_season/career_positions.py`, `three_man_weave/mode.py`, `game-engine.tsx`, `test_daily_reset_boundaries.py` — all empty as claimed; `CourtBuilder.tsx` and `StartGate.tsx` — non-empty as claimed, and the specific invariants cited were confirmed present by direct grep). I also independently confirmed both squash-merge SHAs are real ancestors of HEAD. One `UNCERTAIN` item from a worker (methodology/exporter label cross-check) was resolved to `PRESENT EQUIVALENTLY` by direct inspection. One worker (auditing `feature/peak3-product-polish`'s first five commits) produced a corrupted/confused first two responses that echoed unrelated orchestration status text instead of findings; that slice was re-run from scratch with a fresh, self-contained agent whose output is what appears below.

## Findings table

### `backup/pre-cloud-reconstruction` — `a245f20` "fix gameplay interaction semantics"

| Commit | Old behavior/fix | Current implementation | Classification | Evidence | Recommended action |
|---|---|---|---|---|---|
| a245f20 | Peak Duel `answer` endpoint accepts `selected_peak_id: null` as a genuine no-pick (decision-clock timeout), scored incorrect, never a 400 | Identical logic | A — PRESENT EQUIVALENTLY | `apps/api/app/api/v1/game.py:542,544,566`; `apps/api/app/models/game.py:45` | NO ACTION |
| a245f20 | Peak Duel Daily 5s decision clock + fast auto-advance out of reveal (rounds 1-9) | Present; clock constant later centralized in `peak-duel-constants.ts` | A | `apps/web/src/components/game/game-engine.tsx:15,87,173,197,206,240` | NO ACTION |
| a245f20 | `handleTimeout` dispatches `SUBMIT_TIMEOUT`, submits `selected_peak_id: null` on clock expiry | Present verbatim | A | `game-engine.tsx:197-206`; `game-state.ts:16,61` | NO ACTION |
| a245f20 | New `postDailyResult` — idempotent official record of a completed daily, credentialed, best-effort | Present, now formally typed | A | `apps/web/src/lib/api.ts:407-424`; `types/index.ts:587-594` | NO ACTION |
| a245f20 | Three-Man Weave: selection staged (`COMMAND_STAGE_PICK`), not committed; timeout drafts the staged choice instead of a blind autopick | Present, same mechanism | A | `apps/api/app/services/three_man_weave/mode.py:241,453,595-596,634,1162-1165`; `PickOverlay.tsx:89-385`; `ThreeManWeaveGame.tsx:418-426,826` | NO ACTION |
| a245f20 | Staged pick private to the staging seat, survives refresh/reconnect | Present | A | `mode.py:1162` `private_state["staged_pick"]` | NO ACTION |
| a245f20 | Race test proving exactly one of {manual pick, server timeout sweep} commits | Present, same file/size | A | `apps/api/tests/test_three_man_weave_action_races.py` | NO ACTION |
| a245f20 | Twenty-Dollar: uncontestable position parked as a real seatless server turn (`PHASE_LOT_FORCED_FILL`), not committed inline — phantom-lot fix | Present, same phase/function names, plus sibling test | A | `apps/api/app/services/twenty_dollar/mode.py:166,247,311-331,456-477,517-526`; `nba_peak/twenty_dollar/state.py:88-109,860` | NO ACTION |
| a245f20 | Uncontested lot shows "Claim for $X", no fake bid stepper; ledger uses distinct honest wording for forced-fill vs uncontested | Present | A | `BidControls.tsx:111-161,237,275`; `LotLedger.tsx:182,190` | NO ACTION |
| a245f20 | Extra follow-up poll armed right after handing turn to a bot | Present, further tuned (`BOT_THINK_FLOOR_MS`, later backed by `nba_peak.twenty_dollar.config`) | A (superseded by later refinement) | `TwentyDollarGame.tsx:91,106-107,142,217-219,269` | NO ACTION |
| a245f20 | Run The Table: boss lineup reveal auto-starts; reload mid-boss-reveal reopens correctly instead of stranding the match | Present | A | `RevealSequenceSurface.tsx:126-130`; `RunTheTableGame.tsx:326-357` | NO ACTION |
| a245f20 | New test: RTT lane winner/margin is a pure function of the two lineup ratings, never `top_contributor` | Present verbatim | A | `apps/api/tests/test_run_the_table.py:2182` | NO ACTION |
| a245f20 | Test-only: credential-scoping and rejection-fixture updates | Present | A | `api-credentials.test.ts:43`; `arena-rejection.test.ts:66,101` | NO ACTION |

### `feature/peak3-product-polish` — `b26c3cc`, `a804ad0`, `5ed85c2`, `42b5670`, `8394dc9`

| Commit | Old behavior/fix | Current implementation | Classification | Evidence | Recommended action |
|---|---|---|---|---|---|
| b26c3cc | Daily-result reads scoped by `mode="peak_duel"` so a future daily-shaped mode can't leak into history/distribution | Identical repo signatures + test | A | `apps/api/app/repositories/peak_duel_daily_{memory,postgres,protocols}.py`, `test_peak_duel_daily_result.py` — diff empty | NO ACTION |
| b26c3cc | Rankings position filter matches via `.includes()` on a `positions` eligibility array | Repointed to a single `primary_position` (most career minutes) after the eligibility-array approach produced a nonsensical "PG" board topped by Jordan/LeBron/Giannis — a bug found and fixed on top of this old commit's own approach | B — SUPERSEDED (deliberately corrected) | `apps/api/app/api/v1/peaks.py`, `apps/web/src/app/(main)/rankings/page.tsx`; HEAD's inline comment documents the defect | NO ACTION |
| b26c3cc | CourtBuilder undo-toast auto-dismiss on `result_ready`; EligiblePlayerSearch provenance moved to data-attrs; stale-`deadlineAt` duel-timer race fixed (bound to `{index, deadlineAt}`) | All identical | A | diffs empty for all three files | NO ACTION |
| b26c3cc | ThreeManWeaveGame: shared `turn_seconds_remaining` for all seats; `rollRevealed` gate stops round-1 roll leaking behind intro card | Both invariants present; only header markup later restyled | A | `grep turnDeadlineAt/rollRevealed` both hit HEAD | NO ACTION |
| b26c3cc | SpinStage per-axis respin controls; PeakV2DataLane `fill="higher"` used by Peak Duel reveal | SpinStage identical. Peak Duel reveal **reverted** to role-based `ownerSide` — per-lane data-fill was found to mislead on a lane the overall loser numerically "won"; capability kept but unused | A / B (deliberately reversed with documented reasoning) | `PeakV2DataLane.tsx:60-95`, `PeakDuelV2Reveal.tsx:35-45,122,305` | NO ACTION |
| b26c3cc | PeakV2CourtSlot bench detail (TMW's flat-mean score needs season/team, not just score); CourtResult `slotDisplayLabel()`; TMW "on the clock" strip; TMW result single ordinal + viewer's own score under viewer's own badge (real display bug) | All present, several further extended | A | greps hit HEAD for all | NO ACTION |
| b26c3cc | Homepage "Your Arena" unification (Status/Featured/Modes), removes duplicate Run-the-Table row | Present, purely additively extended since (shared `ModeSlateCell` now also serves `/arena`) | B — SUPERSEDED (extended, not lost) | diff shows only additions | NO ACTION |
| a804ad0 | IdentityLockPanel hide-when-empty counter; CourtPanel `hideHeader` | Identical | A | diffs empty | NO ACTION |
| a804ad0 | Native HTML5 drag-and-drop as a 4th court-building input method alongside click/tap/keyboard, sharing the same reducer path | Identical (`dragSourceProps`/`dropTargetProps`), plus dedicated test | A | `court-drag-and-drop.test.tsx` present; greps hit | NO ACTION |
| a804ad0 | `PeakV2SpinReveal` caller-controlled `stage` prop + gated reel mount — fixed reel settling ~1.6s into the ceremony behind the intro card, landing the answer before "Rolling…" played | Identical, plus `spin-reveal-lifecycle.test.tsx` | A | diff empty | NO ACTION |
| a804ad0 | TMW reveal unified onto shared `PeakV2SpinReveal`; pick-lock flash animation; "Thinking" bot-deliberation label; CourtResult "Run analysis" consolidation with real per-player scores | All identical | A | diffs empty | NO ACTION |
| 5ed85c2 | `PlayAgainPanel` dedupes triple sign-in prompt; `PeakV2Score` `align="center"` fixes score visually off-axis under a centered TMW result label | Identical logic; later restyled onto shared action components, same props/behavior/testids | A | diff shows component-swap styling only | NO ACTION |
| 42b5670 | Undo button outline (was competing visually with selection); "needs" chip recolored off-accent; pending-fit caption recolored (duplicate color signal) | Identical — this is pure color/visual-hierarchy work; no accessibility/aria/focus code appears in the diff at all | Visual-only, excluded from behavioral rows per audit rules | diff empty on all 4 files | NO ACTION |
| 8394dc9 | Pinned `ARCHIVE_DATE` for daily-challenge tests (old `yesterday()` dead-ended on ~8% of calendar dates via a documented `tom-chambers→forward_big` stranding bug) | Identical, byte-for-byte, including root-cause comment | A | `git diff 8394dc9 HEAD -- test_daily_reset_boundaries.py` empty | NO ACTION |
| 8394dc9 | Showdown lot-transition e2e switched from stopwatch polling (broken budget math) to state-based waiting; skip-counter assertion made structural | Identical, byte-for-byte | A | `git diff 8394dc9 HEAD -- arena-multiplayer.spec.ts` empty | NO ACTION |

### `feature/peak3-product-polish` — `e02bdb2` "founder review fixes through arena"

| Commit | Old behavior/fix | Current implementation | Classification | Evidence | Recommended action |
|---|---|---|---|---|---|
| e02bdb2 | Rankings position tabs must filter on a single `primary_position` (minutes-weighted), not the `career_positions` eligibility set | `nba_peak/perfect_season/career_positions.py` has `primary_position()`; `apps/api/app/api/v1/peaks.py:42,296` uses it | A | `git diff e02bdb2 HEAD` empty on both files | NO ACTION |
| e02bdb2 | `tests/test_primary_position.py` — canonical position + partition-property tests | Byte-identical | A | diff empty | NO ACTION |
| e02bdb2 | Twenty-Dollar bot needs `bot_think_seconds` (2.6–4.2s) — platform default (1.2s) was below the 2000ms client poll interval, so the bot's raise never visibly registered | `nba_peak/twenty_dollar/config.py:148-167`; `apps/api/app/services/twenty_dollar/mode.py:215-235` | A | diff empty on both files | NO ACTION |
| e02bdb2 | `test_twenty_dollar_bot_timing.py` — floor-above-poll-interval, determinism, per-seat/per-turn variance | Byte-identical | A | diff empty | NO ACTION |
| e02bdb2 | `ArenaPageV2` mode-row layout (`ModeGroupRow` → shared `ModeSlateCell` grid) | Byte-identical | A (visual, fully present regardless) | diff empty | NO ACTION |
| e02bdb2 | TwentyDollarGame error/loading/forfeit screens | Later wrapped in `PeakV2Shell`/action components — same testids, copy, routes | B — SUPERSEDED (later visual refactor, behavior preserved) | diff is markup/component-swap only, no testid/logic changes | NO ACTION |
| e02bdb2 | PeakDuelV2Reveal, PeakV2ShowdownLive, PeakV2ShowdownBidControls, PeakV2DataLane, HomePageV2, rankings/page.tsx, lib/api.ts, lib/twenty-dollar-api.ts, types/index.ts | All byte-identical | A | diff empty on every file | NO ACTION |

No CLAUDE.md scoring violation: neither `career_positions.py` nor `twenty_dollar/config.py` touches `OFFICIAL_WEIGHTS` or `calibrate_score` — `primary_position` is a derived display field for rankings-tab filtering, not a scoring change.

### `feature/peak3-v2-ui` / `fix/product-ux-recovery` / `recovery/peak3-v2-visual-reconstruction` — `d1e5c15`, `a2dc49a`

| Commit | Old behavior/fix | Current implementation | Classification | Evidence | Recommended action |
|---|---|---|---|---|---|
| d1e5c15 | Peak Duel daily rounds 1-9 stop auto-advancing after reveal; only manual "Next Matchup" advances | Identical — no `AUTO_ADVANCE_MS` timer, explicit dispatch on click | A | `game-engine.tsx:226-241` | NO ACTION |
| d1e5c15 | Decision-clock length centralized in one constant so V2/legacy can't drift | Present, same purpose (re-tuned since) | A | `apps/web/src/lib/peak-duel-constants.ts` | NO ACTION |
| d1e5c15 | `HandleOnboardingPrompt` denylist extended so the prompt can't overlap live gameplay routes | Identical regex set | A | `HandleOnboardingPrompt.tsx:75-88` | NO ACTION |
| d1e5c15 | `Dialog` `keepMounted` prop — hide via CSS not unmount, so a reveal ceremony's internal timers never remount on close | Present, same mechanism | A | `Dialog.tsx:122,152,245,261` | NO ACTION |
| d1e5c15 | CourtBuilder "Resume selection" path back into a minimized in-progress pick | Present, same wiring | A | `CourtBuilder.tsx:493-519` (independently re-verified by grep) | NO ACTION |
| d1e5c15 | `PeakV2DockedPanel` fixed height (not `maxHeight`) so the panel never resizes as content changes | Present, same pattern | A | `PeakV2DockedPanel.tsx:116-124` | NO ACTION |
| d1e5c15 | `PeakV2CourtChooser` split into fixed header + independently-scrolling body | Present verbatim | A | `PeakV2CourtChooser.tsx:135-273` | NO ACTION |
| d1e5c15 | TMW reveal reserved-geometry grid-stack (no recentering jank on reel settle); TMW courts always-visible "on the clock" strip | Present, both later refined | A | greps hit HEAD | NO ACTION |
| d1e5c15 | Methodology/Rankings V2 chrome built alongside legacy via `UiVersionSwitch` | Legacy branch fully removed; V2 is the sole production UI, content further evolved | B — SUPERSEDED | no `UiVersionSwitch` import remains; `.claude/rules/web-ui-preservation.md` confirms V2-only | NO ACTION |
| d1e5c15 | Daily-grid components' per-element `v2`/`useUiVersion()` styling branches | Dual-branch scaffolding removed; components render V2 tokens unconditionally | B — SUPERSEDED | e.g. `CompletionModal.tsx` imports `PeakV2Modal` unconditionally | NO ACTION |
| d1e5c15 | New tests: court-builder resume-selection, daily-grid-completion-v2, TMW v2 geometry, etc. | Identically-named test files present in current tree | A | confirmed via directory listing | NO ACTION |
| a2dc49a | `layout.tsx` `adjustFontFallback` fix for a ~30% headline-width reflow (serif fallback silently matching `local("Arial")`) | Identical fix | A | `layout.tsx:124` | NO ACTION |
| a2dc49a | Daily-grid row-header gutter widened, length-aware font-size — stops single-word category labels from being sliced mid-word | Identical fix | A | `DailyGridBoardView.tsx:46-63,87` | NO ACTION |
| a2dc49a | `StartGate` gets a V2 branch (was the last V2 visual island with no branch at all) | Legacy branch since removed entirely; StartGate now unconditionally renders the V2 markup this commit introduced | B — SUPERSEDED | `git diff` confirms only the dead legacy branch/`useUiVersion` import was removed; V2 markup intact | NO ACTION |
| a2dc49a | ThreeManWeaveGame measures real viewport height, publishes `--tmw-viewport-cap`, fixing content pushed below viewport on some screens | Identical mechanism | A | `ThreeManWeaveGame.tsx:659-667,780` | NO ACTION |
| a2dc49a | **Real bug fix:** TMW header timer rendered whenever `deadlineAt` existed with no gate on a seat actually being on the clock — during seatless intro/reveal phases the ~1800s intro backstop rendered as a literal 4-digit number in the live header | Fixed identically: gated on `currentTurnSeatIndex !== null` | A | `PeakV2TMWCourts.tsx:273` | NO ACTION |
| a2dc49a | `build_web_dataset.py` methodology label rename ("Postseason Individual Value"→"Playoff Rate Impact", "Team Achievement"→"Team Result"), label-only, no `OFFICIAL_WEIGHTS`/`calibrate_score` touch | Identical labels present | A | `scripts/build_web_dataset.py:445,466`; matches CLAUDE.md's own component-color-token names | NO ACTION |
| a2dc49a | `test_methodology_consistency.py` — exporter labels cross-checked against frontend `RANKING_COMPONENT_LABEL` map | Present; independently re-verified (worker flagged as uncertain, resolved here) | A | `apps/web/src/lib/v2-component-map.ts:29`; `tests/test_methodology_consistency.py:36,234-243` | NO ACTION |

## 1. Every unique old behavior still missing from current PEAK3

**None found.** Across all nine commits and every distinct behavioral invariant identified, zero were classified `C — MISSING AND STILL RELEVANT`. Two items were initially flagged `E — UNCERTAIN` by the investigation workers; both were resolved to `A — PRESENT EQUIVALENTLY` by direct follow-up verification (the methodology/exporter label cross-check test, and independent confirmation of the CourtBuilder resume-selection wiring).

## 2. Every important old behavior confirmed preserved

- **Three-Man Weave:** staged (not committed) picks, private per-seat staged state surviving reconnect, the action-race resolution invariant (manual pick vs. server timeout sweep — exactly one wins, and a timeout drafts the staged choice), shared turn countdown across all seats, roll-leak gating before the intro card, drag-and-drop-safe reducer path, pick-lock flash, bot "Thinking" label, and the seatless-phase timer bug (a literal 4-digit second count rendering in the live header) — fixed.
- **Twenty-Dollar:** phantom-lot fix (uncontestable positions parked as a real seatless server turn, not committed inline), honest uncontested-lot UI (no fake bid stepper, distinct ledger wording for forced-fill vs. uncontested), and bot timing (a `bot_think_seconds` floor above the client poll interval, plus a follow-up poll armed immediately after handing off to a bot).
- **Run The Table:** boss-reveal auto-start, reload-mid-reveal recovery, and lane winner/margin as a pure function of lineup ratings (never `top_contributor`).
- **Game engine / Peak Duel:** null-pick timeout semantics, decision-clock lifecycle (bound to duel index so a stale deadline can't fire early), manual (not auto-advancing) reveal-to-next transition, and the official `postDailyResult` credentialed POST.
- **CourtBuilder:** resume-selection path back into a minimized in-progress pick, native drag-and-drop as a fourth input method, undo-toast auto-dismiss on result.
- **Rankings / primary-position:** the minutes-weighted `primary_position` fix (superseding a naive eligibility-array `.includes()` filter that produced nonsensical position boards).
- **API credential behavior:** `postDailyResult`'s cookie-scoped credential handling; daily-result reads correctly scoped by mode.
- **Accessibility / layout:** `Dialog` `keepMounted`, the serif-font-fallback headline-reflow fix, daily-grid label-truncation fix, docked-panel fixed-height behavior.
- **Daily challenge/reset boundaries:** deterministic, verified-winnable archive-date test fixture (replacing a `yesterday()`-based helper that dead-ended on ~8% of calendar dates).

## 3. Exact files/tests that would need changing

None. No `PORT FIX MANUALLY`, `PORT TEST ONLY`, or `CHERRY-PICK COMMIT` actions were warranted for any of the nine commits.

## 4. Can `b8508ed` safely become `main` without rescue work?

**Yes.** Every behavioral invariant found across all nine audited commits from the five non-ancestor old branches is already present on current HEAD — the large majority as byte-identical file content (confirmed via empty `git diff <old-sha> HEAD -- <file>`), the remainder as deliberately-superseded or further-refined implementations of the same invariant, each with evidence read directly from current production code (not inferred from passing tests). This is explained by two squash-merges already in HEAD's ancestry — `07349b0` ("PEAK3 V2 final product integration (#23)") and `4534534` ("Complete PEAK3 product UX recovery (#24)") — whose PR descriptions independently corroborate covering this same ground. The old branches are earlier drafts of work that was re-landed through a different, squashed path, not a source of orphaned fixes.

## 5. Smallest rescue plan

None required. No code changes, test ports, or cherry-picks are recommended from this audit. The five old branches (`backup/pre-cloud-reconstruction`, `feature/peak3-product-polish`, `feature/peak3-v2-ui`, `fix/product-ux-recovery`, `recovery/peak3-v2-visual-reconstruction`) can be treated as fully superseded and are safe to leave alone (or archive/delete at the user's discretion — not performed as part of this audit).
