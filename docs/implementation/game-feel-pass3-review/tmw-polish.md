# Three-Man Weave — final pre-deploy polish (items 7–11)

Branch `feature/game-feel-reconstruction`, HEAD 1cd0bbd. No commits made. No servers started/killed.
Driver + screenshots + DOM timing logs: `scratchpad/tmw/` (`play.mjs <label>`, `analyze.mjs <label>`; `before/`, `after/`, `after2/`).

## IMPORTANT: the API must be restarted

`apps/api/app/services/three_man_weave/mode.py` `REVEAL_SECONDS` moved **3.0 → 4.0** (the only Python change; `nba_peak/three_man_weave/config.py` untouched).
The running uvicorn (`uvicorn app.main:app --port 8000`, no `--reload`) still serves the 3.0 s window, so every AFTER measurement below was taken against a 3.0 s server window, which the client now **scales proportionally** (k = 0.75) so no seat's reel is still turning when the phase ends. After the restart, re-run `node scratchpad/tmw/play.mjs after4` to measure the designed 4.0 s pacing.

## Pacing — before / designed / measured

Ceremony timeline (ms from the reveal turn's start; `PeakV2TMWReveal.TMW_CEREMONY` / `TMW_CEREMONY_MARKS`):

| beat | before (3.0 s window) | after, nominal 4.0 s | after, scaled to a 3.0 s server (what was measured) |
|---|---|---|---|
| ROUND N card | 0–550 | 0–1550 | 0–1163 |
| armed shell (anticipation, new) | — | 1550–1750 | 1163–1313 |
| reels spinning (primary / secondary) | 550–1750 (950 / 1200) | 1750–2850 (800 / 1100) | 1313–2138 (600 / 825) |
| LOCK beat | 1750–2050 (300) | 2850–3250 (400) | 2138–2438 (300) |
| pair held ("resolved") until the server opens the pick turn | 2050–3000 | 3250–4000 (+ ≤400 ms poll) | 2438–3000 |

Measured with a MutationObserver log in the page (`log.json`), one full six-round bot match each, 1440×900:

| measurement | BEFORE | AFTER (3.0 s server, scaled) | expected after API restart (4.0 s) |
|---|---|---|---|
| Round card on screen (6 rounds) | 368–513 ms | 988–1133 ms | ~1.40–1.55 s |
| Lock beat | 296–301 ms | 296–299 ms | 400 ms |
| Pair resolved → pick overlay opens (human-led rounds) | 1188–1416 ms | 795–972 ms | ~0.75–1.15 s |
| Previous seat's pick lands → your overlay opens | **0 ms (same frame; the moment was hidden under the overlay scrim)** | 928–933 ms (beat 900 + render) | 900 ms |

Input acknowledgement is unchanged (nothing new sits between a press and the lane); no forced wait was added after any click.

## What changed, where

### 7. Round cards (`components/v2/tmw/PeakV2TMWReveal.tsx`, `mode.py`, `types/three-man-weave.ts`)
- Client presentation could not reach 1.4 s inside a 3.0 s server window and still leave a reel, a lock and a hold, so `REVEAL_SECONDS` 3.0 → 4.0 (mode.py; still one shared seatless window, identical for all three seats; `tmw_skip_*` still refused). `TMW_REVEAL_SECONDS` mirror in `types/three-man-weave.ts` 3.0 → 4.0. The API test pin `2.0 <= REVEAL_SECONDS <= 4.0` still holds; no API test expectation was changed.
- Round card holds 1550 ms of the window, every round, derived from the server's `turn_elapsed_seconds` as before.
- New `ceremonyMarks(totalMs)`: the beats are laid out for 4000 ms and compress proportionally for a shorter published `turn_total_seconds` (every seat gets the same total, so every seat scales identically). This is what kept the room coherent against the still-running 3.0 s API.

### 8. Previous-pick beat (`components/three-man-weave/ThreeManWeaveGame.tsx`)
- `TMW_PREVIOUS_PICK_BEAT_MS = 900`. `handedToYouAfterPick(prev, next)` reads the two snapshots: another seat's roster gained a card AND the open turn moved from not-yours to yours, on a poll. Only then `Room.previousPickBeat` is set for that snapshot and `overlayOpen` additionally requires `previousPickBeat === null`.
- Presentation over already-applied state: the roster, the on-the-clock marker, the server clock (`deadlineAt`) and every command are live during the beat; polling unchanged; no server change. The moment reads "<Name> → <SLOT> / <Seat> · Round N · You're up" (`tmw-moment`, class `tmw-moment--handoff`, larger), the previous seat's card keeps its lock light for the beat, and a small `tmw-previous-pick-beat` cue says "You're up · press to open now".
- Never gates: any `pointerdown`/`keydown` (window capture) or the cue itself ends the beat at once; reduced motion collapses it to 0 ms (the overlay's own "Taken this roll" chips carry the same fact). A reload straight into your turn (source `initial`) or a ceremony handoff never triggers it.

### 9. Spinner / reveal pacing (`PeakV2TMWReveal.tsx`, `styles/game-feel.css`)
- New `armed` stage (shell visible, both windows empty, breathing rule) before the reels turn; lock 300 → 400 ms; status line reads "LOCKED IN" in the accent during the lock; the pair holds before the handoff.
- TMW-scoped lock treatment: `.tmw-ceremony[data-stage="locked"]` — one accent ring pulse on each axis and a 2 px lift of the value (400 ms, `prefers-reduced-motion: no-preference` only). Shared `PeakV2SpinReveal`/`spin.css` untouched.
- `data-stage` now also on `.tmw-ceremony`; `tmw-ceremony-status` testid added to the status line.

### 10. Draft state instead of the sentence (`PickOverlay.tsx`, `lib/three-man-weave-state.ts`)
- The sentence is replaced by `tmw-overlay-taken` (`data-count`): when you open the roll — "YOU OPEN THIS ROLL · 3 seats draft from it"; otherwise "TAKEN THIS ROLL" + one chip per name gone from this roll (`tmw-overlay-taken-<seat>`, seat name in the seat's own accent via `data-seat-accent`, name struck through, slot abbreviation). An sr-only sentence keeps the rule and lists "X took Y at Point guard".
- `TmwLockEntry.slotType?` added (identityLock fills it); `takenThisRoll(entries, roundNumber, yourSeatIndex)` helper.

### 11. End screen (`components/v2/tmw/PeakV2TMWResult.tsx`, `styles/game-feel.css`)
- Your card: solid gold border + soft halo + a "YOUR SEAT" tab on the top edge (`tmw-result-<seat>-yours`; "Your seat · Winner" when both). Winner keeps the lit ground/gold ordinal. Existing "You" pill (`tmw-result-seat-you`) kept.
- Standings strip: your row gets `tmw-standing-<seat>` `data-yours` (gold left rule, primary-weight name, gold "YOU" tag); winner row `data-winner`.

### CSS
Only an appended, labelled section at the very end of `styles/game-feel.css` ("Three-Man Weave pacing (pre-deploy polish)"), added with the Edit tool. It also carries one TMW-scoped a11y fix: `.tmw-ceremony .v2-spin-axis-label` reads in `--v2-text-secondary` (axe measured the muted label at 3.48:1 on the resolved ceremony; with the longer hold the e2e axe scan now lands on that state).

## Tests

- `npx tsc --noEmit` clean; `npm run lint -- --max-warnings 0` clean.
- Unit: `three-man-weave-game-feel` 15/15, `three-man-weave-components` 76/76, `game-feel` 19/19, `three-man-weave-state` 54/54, `three-man-weave-v2-geometry` 26/26; every other unit file referencing TMW (arena-api, button-styles, nav-model, arena-lobby, handle-onboarding-prompt) green — 207/207.
- New regression coverage: previous-pick beat (moment + state visible before the overlay, press-through, reduced motion, no beat on reload); round card 1.4–2.0 s and ceremony resolves ≥500 ms before the window ends, stages at elapsed 0 / 1.4 s / armed / locked, compression on a 3.0 s window; taken-this-roll chips (+ sr-only sentence, earlier rolls excluded, "you open this roll"); end-screen your-seat mark for 3rd, 2nd, and winner+you.
- One existing expectation updated, deliberately: `three-man-weave-game-feel.test.tsx` "reconnect … settled when the reels have settled" used a literal elapsed 2.6 s (settled under the old 3.0 s timeline); it now derives the elapsed from `TMW_CEREMONY_MARKS.resolved` because the duration legitimately changed.
- API: `PEAK3_TEST_REPOSITORY_MODE=memory pytest tests/test_three_man_weave_mode.py tests/test_arena_practice_e2e.py` — 111 passed (no expectation changed; the bot-timing state test is green).
- E2E `arena-multiplayer.spec.ts --project=chromium-multiplayer --grep "weave|Weave|three"`: 8/9 on the first two runs — "bot practice starts … not a 404" failed on the axe scan (`.v2-spin-axis-label` 3.48:1 on the resolved ceremony; pre-existing colour, newly exposed by the longer hold). After the TMW-scoped label fix that test passed 3/3 consecutive runs; the other 8 passed in both full runs. (All e2e ran against the still-3.0 s API.)

## Screenshots
`scratchpad/tmw/before/`: 01-intro, 02-round-card, 07-your-turn-opens (overlay in the same frame as the bot's pick), 08-pick-overlay (sentence), 11/12 end screen (dashed "you" outline only).
`scratchpad/tmw/after2/`: 01-intro, 02-round-card, 03-armed, 04-lock (gold ring + "LOCKED IN"), 05-resolved, 06-previous-pick-beat (moment "Jaren Jackson Jr. → C · Floor General · Round 3 · You're up" over the applied board, overlay closed), 07-your-turn-opens, 09-taken-this-roll (chips), 11/12 end screen ("YOUR SEAT" tab, gold edge on 3rd).

## Follow-ups for the main session
1. Restart the API (REVEAL_SECONDS 4.0), then `node scratchpad/tmw/play.mjs after4 && node scratchpad/tmw/analyze.mjs after4` for the designed-window numbers.
2. `docs/design/GAME_FEEL.md` "Server fields" still says `REVEAL_SECONDS` (3.0) — another workstream is editing that file, so I did not touch it; one-word update needed.
