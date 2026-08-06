# Arena Games Production Rescue — Requirement Tracker

Binding specification: `docs/specs/arena-games-production-rescue.md`
Branch: `fix/arena-games-production-rescue`
Base commit: `bd8aea2`

Status legend: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED`

---

## Phase 0 — Evidence and proven root causes

Every root cause below was established by reading the shipped code path end to
end and, where a race was involved, by reproducing it against the in-memory
Arena repository. Nothing here is a hypothesis.

### RC-1 — The rejected `$2` Stephen Curry bid

**Observed:** user pressed `Bid $2` on 2015–16 Stephen Curry, saw
"That move was not accepted.", and the lot then settled to the bot for `$1`.

**Proven cause — two defects stacked:**

1. **Server side (the disappearance).**
   `apps/api/app/api/v1/arena.py::submit_command` runs
   `await clock.enforce(repo, match_id, mode.reduce, now)` *before* applying the
   human command. When the human's POST arrives after `turn.deadline_at`, the
   sweep fires the turn's timeout first. In the Showdown,
   `nba_peak/twenty_dollar/state.py::timeout_active_seat` applies a **pass** for
   the active seat; because the bot already held the standing `$1` bid,
   `_apply_pass` sees `high_bidder is not None` and immediately calls
   `_resolve_lot(..., DECIDED_BY_PASS_OUT)` — awarding Curry to the bot at `$1`
   and advancing to the next lot. The human's command is then evaluated against
   a state whose `state_version` has already advanced, so `apply_command`
   returns `stale_state_version`.

   The client's countdown is seeded only from a 2000 ms poll
   (`TwentyDollarGame.tsx` `POLL_MS = 2000`) and ticks locally at 1 Hz with no
   round-trip compensation, so the button remained enabled for up to ~2 s past
   the true deadline plus one network RTT. The user genuinely had a live-looking
   control on an expired turn.

2. **Client side (the generic banner) — a field-name mismatch, so the fallback
   fires on _every_ rejection.**
   The API model is `SubmitCommandResponse(accepted, replayed, rejection_code,
   **message**, match)` (`apps/api/app/models/arena.py:221-228`) and
   `arena.py::submit_command` populates `message=outcome.rejection_message`.
   The Showdown client declares the field as **`rejection_message`**
   (`lib/twenty-dollar-api.ts:292-298`) and reads
   `result.rejection_message || "That move was not accepted."`
   (`TwentyDollarGame.tsx:150`). `result.rejection_message` is therefore
   **always `undefined`**, so the server's precise sentence — in the reproduced
   case *"This match has moved on (you sent version 1, it is now 2). Reload."* —
   is discarded and 100% of Showdown rejections render the generic string.
   The message is additionally **never cleared on an authoritative state
   change** (`error` is only reset at the start of the next `submit`), which is
   why it persisted across later lots.

   Three-Man Weave reads `response.message` and is unaffected.

**Reproduction (scripted, deterministic).** Driving the real
`MemoryArenaRepository` + the real Showdown reducer:

```
step=bot_opens          accepted=True price=1 state_version=1 next_actor=0
                        deadline=12:00:26.200Z
step=human_click        submitted_version=1 amount=2
                        client_submitted_at=12:00:26.320Z  (+120 ms)
step=clock_enforce_ran_first
                        timeout_accepted=True state_version=2 lots_settled=1
                        settled_winner_seat=1 settled_price=1
                        settled_player='Chris Morris' decided_by=pass_out
step=human_bid_result   accepted=False rejection_code='stale_state_version'
```

A bid arriving **120 ms** past the deadline is destroyed and the lot is awarded
to the bot at `$1`, with the human's control still enabled because their
countdown was seeded from a poll up to 2 s stale.

**Files:** `apps/api/app/api/v1/arena.py`, `apps/api/app/services/arena/clock.py`,
`nba_peak/twenty_dollar/state.py`, `apps/web/src/components/twenty-dollar/TwentyDollarGame.tsx`

**Ruled out:** client/server timer drift as *primary* cause (the countdown is a
duration, not a wall-clock deadline); wrong actor (seat index is read from the
seat row, never the request); duplicate action (the idempotency key is per
click); out-of-order polling (`inFlight` ref already guards the poll);
bot acting from stale state (the bot carries `expected_state_version`).

### RC-2 — Incorrect / stale market-skip counter

**Observed:** a skip appeared to be used, the display still read five remaining.

**Proven cause — three distinct legitimate "pass" outcomes share one label and
one counter, and two of them are free:**

* `nba_peak/twenty_dollar/state.py::_apply_pass` charges a skip **only** when
  `not timed_out and pass_consumes_skip(...)`. A **timeout never consumes a
  skip** in the shipped build.
* `pass_consumes_skip` additionally requires no standing bid; a **live-auction
  concession is free**, and the control renders the identical `Pass` label for
  it.
* The seat's own counter and the opponent's are both published as
  `market_skips` and rendered by the same `BudgetMeter`, with no per-action
  receipt saying which pass cost what.

So a user who timed out, or who conceded a live auction, correctly saw `5`
remaining and had no way to tell why. The spec (PART 16) additionally *changes*
the rule: a timeout with a legal fit and skips remaining must now consume one.

**Files:** `nba_peak/twenty_dollar/state.py`,
`apps/web/src/components/twenty-dollar/BidControls.tsx`,
`apps/web/src/components/twenty-dollar/AuctionBoard.tsx`

### RC-3 — Hidden / unexplained lot advancement

**Proven cause — three compounding paths, all server-side and all invisible to
a 2 s poll:**

1. `_advance_lot` resolves an **unsold lot synchronously and recursively**: when
   neither seat can legally acquire the drawn candidate, `active_seat` is
   `None` and `_resolve_lot` is called inside `_advance_lot`, which calls
   `_advance_lot` again. An arbitrary run of unusable candidates settles inside
   a single command, appearing in `history` all at once.
2. `bots.drive_pending_bots` loops up to `max_steps = 12` inside one request, so
   several bot turns (and therefore several lots) can complete between two
   polls.
3. The UI renders only `history[history.length - 1]` in `LotReveal` and appends
   the rest to a tall scrolling `AuctionHistory` column. There is no per-lot
   hold, no transition, and no reconnect summary.

**Files:** `nba_peak/twenty_dollar/state.py`,
`apps/api/app/services/arena/bots.py`,
`apps/web/src/components/twenty-dollar/AuctionBoard.tsx`

### RC-4 — Three-Man Weave placement / rearrangement is unusable

**Proven cause:** `PickOverlay.tsx` implements placement as a `<select>`
(`data-testid="tmw-place-select"`), renders the roster slots as a **non
interactive `<ul>/<li>`** (`tmw-place-slots`), shows "Needs a rearrangement: …"
as a **`<p>`**, and offers no way to move a placed card from inside the pick
flow. `MoveDialog` exists but is reachable only from the board behind the
overlay.

**Files:** `apps/web/src/components/three-man-weave/PickOverlay.tsx`,
`MoveDialog.tsx`, `SeatCourt.tsx`

### RC-5 — Every primary game action renders as plain text

**Proven cause — a missing stylesheet rule, not a markup problem.** The classes
`btn-primary` and `btn-secondary` are used by

* `three-man-weave/PickOverlay.tsx` (Draft / Back)
* `three-man-weave/MoveDialog.tsx` (Move / Cancel)
* `three-man-weave/PodiumReceipt.tsx` (Play again / Back to Arena)
* `twenty-dollar/ShowdownResult.tsx` (Play again / Back to Arena)

and **are defined in no stylesheet in the repository.** `grep -rn
"btn-primary\|btn-secondary" src/**/*.css` matches only `pk-tour-btn-primary`,
`td-btn-primary` and `ar-btn-primary` — three unrelated, differently-named
rules. The app uses Tailwind v4 with Preflight, whose reset renders a bare
`<button>` with `background: transparent; border: 0; padding: 0`, i.e. as plain
text. One missing rule explains the "weak text-like actions" finding on **all
four** surfaces and on **both** result screens.

**Files:** `apps/web/src/styles/*.css` (rule absent)

### RC-6 — Catastrophic Weave bot choices (Carl Landry over Stephen Curry)

**Proven cause:** `nba_peak/three_man_weave/bot.py::_sample` picks from
**ordinal** bands over the ranked option list — `_STRONG_BAND = 0.20`,
`_DEFENSIBLE_BAND = 0.55`, `_MISTAKE_FLOOR = 0.80` — with weights
`(0.70, 0.25, 0.05)`. The bands are **utility-blind**: on a 40-option roll, 30%
of picks come from options ranked 8–32 regardless of whether option 8 is 0.01
worse than option 1 or 0.9 worse. A roll containing peak Curry and Carl Landry
produces exactly the reported outcome ~30% of the time.

**Files:** `nba_peak/three_man_weave/bot.py`

### RC-7 — Light → Dark needs two clicks

**Proven cause:** `apps/web/src/lib/theme.ts::nextThemePreference` cycles
**System → Dark → Light → System** (three states) while the visible theme is
binary.

* Default stored preference is `"dark"`. `dark → light` changes the resolved
  theme, so **Dark → Light is always one click**.
* From `"light"` the next preference is `"system"`. On a machine whose OS is in
  **light** mode, `resolveTheme("system") === "light"` — the resolved theme does
  not change and the click is a **visual no-op**. The second click reaches
  `"dark"`.

That is the exact reported asymmetry, and it is fully deterministic on any
light-mode OS. No hydration race, no duplicate node, no competing provider.

**Files:** `apps/web/src/lib/theme.ts`,
`apps/web/src/components/ui/ThemeToggle.tsx`

### RC-8 — Peak Duel Daily stronger-player-left bias

**Proven cause:** `apps/api/app/services/duel.py:138-144`

```python
if a["prime_index"] >= b["prime_index"]:
    winner_id = a["id"]
    left, right = a, b
else:
    winner_id = b["id"]
    left, right = b, a
```

The stronger peak is assigned to `left` **unconditionally**. The bias is 100%,
not merely systematic, and it leaks the answer through layout.

**Files:** `apps/api/app/services/duel.py`

### RC-9 — Rankings opens with a player selected and a chart rendered

**Proven cause:** `apps/web/src/app/(main)/rankings/page.tsx:222-228` —
`selectedRow` falls back to `sortedRows[0]` when nothing is selected, and
`.rankings-split` permanently reserves a detail column that mounts
`RankingsDetail` → `CompositeChart` on first paint.

**Files:** `apps/web/src/app/(main)/rankings/page.tsx`,
`apps/web/src/styles/rankings.css`

---

## Requirement matrix

| # | Spec section | Requirement | Root cause | Files | Status | Automated tests | Manual evidence |
|---|---|---|---|---|---|---|---|
| R1 | PART 1 | Authoritative action contract: stable rejection codes reach the client | RC-1 | `arena-rejection.ts`, `twenty-dollar-api.ts` | DONE | `arena-rejection.test.ts` (10) | `td-03` (accepted bid on the feed, no error banner) |
| R2 | PART 1 | No generic rejection; errors clear on authoritative transition | RC-1 | `TwentyDollarGame.tsx` | DONE | `arena-rejection.test.ts` | `td-03`, `td-12d` |
| R3 | PART 1/14 | An accepted human action can never disappear | RC-1 | `clock.py`, `arena_protocols.py` | DONE | `test_arena_action_races.py` (17) | `td-12c` → `td-12d` (bid placed inside the urgent band, taken) |
| R4 | PART 2 | Server-authoritative deadline; isolated timer component | RC-1 | `ArenaTimer.tsx` | DONE | `test_arena_action_races.py`, e2e | `td-02`, `td-12a`, `td-12b` |
| R5 | PART 15 | Skip accounting and distinct labels per consequence | RC-2 | `state.py`, `BidControls.tsx` | DONE | `test_ascending_auction.py` | `td-06a` → `td-06` (5 of 5 → 4 of 5) |
| R6 | PART 16 | Four timeout rules, each explained before it fires | RC-2 | `state.py`, `twenty-dollar-api.ts` | DONE | `test_ascending_auction.py`, `test_arena_action_races.py` | `td-12a`, `td-12b`, `td-12` |
| R7 | PART 17 | Visible lot lifecycle; reconnect summary | RC-3 | `LotLedger.tsx` | DONE | `twenty-dollar.test.tsx` | `td-08`, `td-09`, `td-10` |
| R8 | PART 19 | Balanced three-column stage; history in a tray; controls in view | RC-3 | `TwentyDollarGame.tsx`, `twenty-dollar.css` | DONE | e2e | `td-01`, `td-02`, `td-14` |
| R9 | PART 20 | Showdown result: margin, real buttons | RC-5 | `ShowdownResult.tsx`, `arena.css` | DONE | `button-styles.test.ts` | `td-13` |
| R10 | PART 18 | Showdown bot; 2,000-match simulation | — | `test_bot_calibration.py` | DONE | 2,000 matches, metrics reported | n/a |
| R11 | PART 3 | Direct candidate selection + click-to-place | RC-4 | `PlacementBoard.tsx`, `PickOverlay.tsx` | DONE | `three-man-weave-components.test.tsx`, e2e | `tmw-04`, `tmw-05`, `tmw-06` |
| R12 | PART 4 | Direct roster movement | RC-4 | `PickOverlay.tsx` | DONE | `three-man-weave-components.test.tsx` | `tmw-10` |
| R13 | PART 5 | Actionable rearrangement preview, atomic commit | RC-4 | `PickOverlay.tsx` | DONE | `three-man-weave-components.test.tsx` | `tmw-07` |
| R14 | PART 6 | Draft-room redesign, desktop + mobile | RC-4 | `three-man-weave.css` | DONE | e2e | `tmw-04`, `tmw-11`, `tmw-12` |
| R15 | PART 7 | Spinner reads as a reel | — | `three-man-weave.css` | DONE | e2e | `tmw-01`, `tmw-02` |
| R16 | PART 8 | Exactly one unmistakable active roster | — | `SeatCourt.tsx`, css | DONE | `three-man-weave-components.test.tsx` | `tmw-03`, `tmw-08`, `tmw-13` |
| R17 | PART 9 | Visible bot thinking and pick reveal | — | `BotPickReveal.tsx` | DONE | `three-man-weave-components.test.tsx` | `tmw-08`, `tmw-09` |
| R18 | PART 10 | Weave bot quality + guard; 2,000-pick simulation | RC-6 | `three_man_weave/bot.py` | DONE | `test_bot.py` (16), `test_bot_simulation.py` (8) | n/a |
| R19 | PART 11 | Readable snake timeline | — | `DraftOrderStrip.tsx` | DONE | `three-man-weave-components.test.tsx` | `tmw-03` |
| R20 | PART 12 | Weave result payoff, real buttons | RC-5 | `ThreeManWeaveGame.tsx`, css | DONE | `three-man-weave-components.test.tsx` | `tmw-14` |
| R21 | PART 21 | Rankings: no default selection, no chart, full width | RC-9 | `rankings/page.tsx` | DONE | `rankings-analysis.test.tsx` (15), `rankings.spec.ts` | `rk-01` (dark + light) |
| R22 | PART 22 | Complete player analysis containing the chart | RC-9 | `RankingsAnalysis.tsx` | DONE | `rankings-analysis.test.tsx` | `rk-02` (dark + light), `rk-03` |
| R23 | PART 23 | Theme toggle: one click both ways | RC-7 | `theme.ts`, `ThemeToggle.tsx` | DONE | `theme.test.ts`, `ui-primitives.test.tsx`, `theme.spec.ts` | `theme-01`, `theme-02` |
| R24 | PART 24 | Peak Duel orientation bit; 1,000-seed audit | RC-8 | `services/duel.py` | DONE | `test_duel_orientation.py` (15) | n/a — API audit |
| R25 | PART 25 | Performance: isolated timers, memoised lists, no redundant polling | — | both games | DONE | see Performance below | n/a — measured, see Performance |
| R26 | PART 26 | Shared visual quality, Light/Dark, reduced motion, a11y | RC-5 | css | DONE | `button-styles.test.ts`, axe e2e | `rk-01`/`rk-02` in both themes, `theme-01`/`theme-02` |

## Simulation and audit results

### Three-Man Weave bot (PART 10) — `tests/three_man_weave/test_bot_simulation.py`

```
matches                          120
picks                            2160
optimal_rate                     0.9542
near_optimal_rate                1.0000
mean_utility_regret              0.0028
p95_utility_regret               0.0000
max_utility_regret               0.1796
mean_quality_regret_points       0.8842
p95_quality_regret_points        6.5033
max_quality_regret_points        11.8315
dominance_violations             0
illegal_picks                    0
completion_failures              0
catastrophic_deviations          0
```

### $20 Showdown bot (PART 18) — `tests/twenty_dollar/test_bot_calibration.py`

```
matches                          2000
completion rate                  1.0000
max auctioned lots               27   (hard cap 36)
mean auctioned lots              15.31
closeout matches                 38
auto-filled matches              0
mean price · tier 1-100          $3.84 (n=9713, max=$14)
mean price · tier 101-250        $1.99 (n=8284, max=$13)
mean price · tier 251-500        $1.11 (n=2003, max=$11)
mean spend per seat              $14.02
mean budget remaining            $5.98
mean market skips used           1.78
final roster score               mean 325.0, sd 28.5
illegal actions                  0
timeouts                         0
extreme overpayments             1
```

### Peak Duel Daily orientation (PART 24) — `apps/api/tests/test_duel_orientation.py`

```
seeds                            1000  (4 durations x 250 dates)
duels                            10000
stronger-left                    5081
stronger-left ratio              0.5081   (acceptance band 0.45-0.55)
mean score gap, stronger-left    17.4017
mean score gap, stronger-right   17.5832
score-gap standard deviation     12.3043
```

The two means differ by 0.18 — 1.5% of a standard deviation — so orientation
carries no information about which peak is stronger.

## Unresolved blockers

None recorded.

## Defects found by this pass's own tests, and fixed

These were not in the manual findings. They were introduced or exposed while
implementing the rescue, and each is recorded because the way it was caught is
part of the evidence.

### A first-click dead state on the theme toggle

`themeInitScript` applied the stored preference before first paint, but the
BUTTON was a plain server-rendered `<button>` whose listener only exists after
React hydrates. A click in that window moved focus and did nothing else.
Playwright's trace showed the button `[active]` with `data-theme` unchanged and
its own label still reading "Switch to Arena Day".

That is the same class of defect as the three-state cycle — a click the user
has every reason to believe worked, and did not — and it is invisible in
development, where hydration is fast, and worst on a slow connection. The
blocking script now installs a capture-phase click handler and `<ThemeToggle>`
disarms it on mount, so exactly one of the two handles any click and both write
the same storage key and the same root attribute.

The browser test deliberately does **not** wait for hydration, because a test
that did would never exercise this.

### Three contrast regressions, all the same mistake

Recession and entrance animation done with `opacity`, which applies to every
descendant and drags text below AA. Caught by axe in the browser suite.

| Surface | Measured | Cause | Fix |
|---|---|---|---|
| Inactive Weave courts | 4.05:1 on seat kind, progress count, empty bench slots | `opacity: 0.82` on the whole panel | The active court advances instead; inactive text untouched |
| `ON THE CLOCK` badge | 4.13:1 mid-fade | `@keyframes` animating `opacity` | Pulses a `box-shadow`, which never touches text |
| Rankings analysis drawer | 2.52:1 on the eyebrow | Panel faded in, then the SCRIM faded in over it | Panel slides; the scrim animates its own background alpha |

The draft-order strip already carried the rule in a comment — "recessed by fill
rather than opacity, so a completed turn's label stays readable at AA" — and it
had simply not been applied to the seat courts.

### Focus into the drawer scrolled the list behind it

`html` carries `scroll-behavior: smooth`, so the default scroll-into-view that
accompanies `focus()` started a document scroll animation — moving the very
ranking list the drawer exists to preserve, and leaving the panel in motion long
enough that Playwright reported it as unstable. Both focus calls now pass
`preventScroll: true`.

## Validation results

| Gate | Command | Result |
|---|---|---|
| Model tests | `pytest tests/` (excluding mode suites) | 670 passed, 1 xfailed |
| Core scoring/leaderboards | `pytest tests/test_peak3.py test_scoring.py test_leaderboards.py test_validation.py` | 72 passed |
| Three-Man Weave rules + bot | `pytest tests/three_man_weave` | 185 passed |
| Showdown rules + 2,000-match sweep | `pytest tests/twenty_dollar` | 30 passed |
| API unit suite | `pytest apps/api/tests/` (memory repositories) | 1591 passed, 2 skipped |
| Arena action races | `pytest apps/api/tests/test_arena_action_races.py` | 17 passed |
| Peak Duel orientation | `pytest apps/api/tests/test_duel_orientation.py` | 15 passed |
| Frontend typecheck + lint + unit + build | `scripts/ci/frontend-verify.sh` | passed, 0 warnings |
| Desktop Playwright | `e2e-tests.sh --project=chromium` (rankings, arena, theme) | 64 + 6 passed, 0 retries |
| Mobile Playwright | `e2e-tests.sh --project=mobile-chrome` | 29 passed, 0 retries |
| `git diff --check` | vs `bd8aea2` | clean outside the verbatim specification document |
| Generated data | `git diff --name-only` | no change under `leaderboards/`, `data/generated/`, `cache/`, `supabase/migrations/`, `.env*` |

## Manual acceptance

`apps/web/playwright.rescue-shots.config.ts` +
`src/tests/tools/capture-rescue-shots.ts` capture the review sheet against a
dev server with `devIndicators: false` — see "Why the first capture attempt
produced nothing" below for why a production build cannot sign in, and why the
dev indicator had to go with it. Output goes to
`docs/implementation/arena-rescue-review/`, which is gitignored, with a manifest
recording each frame's URL, viewport, resolved theme and content hash — a
duplicate hash means two filenames captured one screen, which an earlier capture
pass in this repository did silently.

Every capture asserts its surface is present before it shoots and fails rather
than writing a misleading frame.

### Why the first capture attempt produced nothing

The config used `next build && next start`, following the UX-polish capture
pass. Every Arena frame then hung for twenty-five minutes and produced nothing,
and the reason is a security boundary working exactly as designed:
`AuthProvider`'s test-session bridge is guarded by

```ts
if (process.env.NODE_ENV === "production") return;
```

so `window.__peak3TestAuth` is **dead-code-eliminated from a production
bundle**. Every Arena capture begins by signing in, so every one waited out its
own 300-second timeout. The Rankings and Theme groups needed no auth, which is
why they alone succeeded.

Weakening that guard to take screenshots would trade the one thing keeping the
bridge out of a deploy for a convenience. The capture uses a dev server instead
— as `scripts/ci/e2e-tests.sh` already does for every Arena browser test — with
`devIndicators: false` so Next's floating disc cannot sit on top of product
content, which is what pushed the UX-polish pass to a production build in the
first place.

## Closure pass — the three concerns, resolved

### C-1 · The ranking row's two actions now occupy two boxes — RESOLVED

The score derivation opened from the PLAYER NAME, which is the widest thing in
a row. At 1440px the name took a small share of the width, so a mid-row tap
landed on empty table and opened the analysis; at 390px it covered most of the
row, so the identical gesture opened a different dialog. The page's primary
action was reachable on a laptop and effectively unreachable on a phone — the
review capture had to click the rank number to work around it.

* The player name opens the **analysis**, like the row and the rank.
* The derivation moved to its **own always-visible cell** with its own label,
  at the 44px tap floor and no wider.
* A table cell is a rectangle, so "neither control contains the other" and "the
  targets do not overlap" are properties of the markup. The mobile e2e asserts
  the geometry anyway, because structure is only useful if it survives layout.
* The row still carries **no interactive role**, so nothing is
  `nested-interactive`; its click handler is a pointer convenience and every
  path it offers is also a real focusable control.
* The derivation keeps its published accessible name, so the six e2e tests that
  find it by name still reach it.

Tests: `rankings-row-interaction.test.tsx` (12) covering name → analysis, row
whitespace → analysis, rank → analysis, derivation → derivation only, Enter and
Space on both, tab order, separate cells, no interactive role on the row, the
tap floor, and the no-analysis-handler fallback. Plus three `@mobile` e2e:
name-opens-analysis at 390px, a geometric non-overlap assertion, and axe.

### C-2 · "While you were away" survives a reload — RESOLVED

The summary compared the authoritative history against a baseline taken at
mount, so a reload started a fresh slate and reported no gap.

The cursor is now the highest `lot_index` this browser has displayed, persisted
per match id (`lib/twenty-dollar-seen.ts`). `lot_index` is server-assigned,
monotonic and already on every history row, so "what have I seen" is one integer
derived from state the server publishes — **no migration**, no second record of
the match, and nothing that can disagree with the authoritative history.

Alternatives rejected, and why: a **count** breaks the moment the server settles
a lot the client never enumerated and carries no ordering; **`state_version`**
advances on every bid and pass and cannot answer "which LOTS did I miss" without
replaying the event log; a **server column** is a migration, and the cursor must
not survive a device change — "while you were away" is a statement about one
reader's attention, not about the match.

* Monotonic, so a stale tab or a double dismissal cannot rewind and replay.
* One unseen lot is a reveal and self-acknowledges after its hold; more than one
  is a gap needing deliberate dismissal — auto-advancing there would be the
  original defect wearing a cursor.
* Two tabs share the cursor plus a `storage` listener.
* A completed match acknowledges everything; the result screen shows it all.

Tests: `twenty-dollar-reconnect.test.tsx` (21) — reload after one and several
missed lots, reload mid-auction, repeated reconnect, no duplicate summary,
two-tab progression, completed-match reconnect, ordering, corrupt values,
blocked storage.

### C-3 · Real timeout behaviour is now audited — RESOLVED

The 2,000-match sweep reports zero timeouts, correctly: a bot always has a legal
move. So it proved nothing about the four expiry branches, which are the rules a
real player meets most often.

`tests/twenty_dollar/test_timeout_audit.py` plays **480 seeded matches** in which
a designated seat lets its deadline expire on a schedule. The bot policy is
untouched — retuning it to manufacture timeouts would measure a different
opponent. The expiry is injected through `timeout_active_seat`, the same
function `clock.enforce` reaches.

```
timed-out decisions   3365
skip_used             1304  (38.75%)
auto_open              359  (10.67%)
conceded              1702  (50.58%)
free_pass                0
expiries that settled a lot   2976
matches completed              480
matches over the lot cap         0
```

**`free_pass` is structurally unreachable in a live match, and that is a
stronger guarantee than "it is free."** `_advance_lot` marks a seat passed
BEFORE the lot opens if it cannot legally acquire the candidate, and
`_next_actor` skips passed seats — so a seat facing a player it cannot use is
never given a clock to run out. Asserted both ways: the invariant across every
timed-out decision in the sweep, and the rule itself on a constructed state, so
the branch stays correct for the day the pre-pass changes.

Also audited per expiry: budget, skip counter, winner, price, the settled row's
timeout flags, per-action `consumed_skip`, the next actor, that a timeout never
touches the other seat, and that every timeout-heavy match still completes
inside the lot cap with five legal roster slots.

## Second closure pass — the Arena visual review, frame by frame

The first pass generated frames. This pass OPENED them. Every file below was
read as an image and judged against the acceptance list — no primary action
looking like text, controls comfortably inside the viewport, nothing important
below the fold, both sides balanced, the active participant unmistakable, bot
actions legible, no clipped text or chart labels, no low-contrast opacity
treatment, both result screens complete. Sixteen defects came out of that
reading; each is recorded below with the frame that found it, and each affected
frame was recaptured after the fix.

Frames live in `docs/implementation/arena-rescue-review/` (gitignored) with
`screenshot-manifest.json` recording each one's URL, viewport, resolved theme,
note and content hash.

### What the frames found — product defects, fixed

| # | Found in | Defect | Fix |
|---|----------|--------|-----|
| 1 | `td-08-sold-reveal` | The settled-lot score — the payoff of the whole lot — sat below the fold, because `LotReveal` rendered LAST in the centre column with the component silhouette inline. PART 19 says the opposite twice: a temporary centre-stage reveal, and "do not append a giant chart under the active controls". | Reveal moved ABOVE the bid controls; the silhouette moved behind a `View breakdown` disclosure. |
| 2 | `td-10-settled-history` | Pressing **Bid** put "Submitting…" on the **Pass** button too. `busy` is one board-wide flag and both controls read it, so the screen claimed to be submitting a bid and a pass at once. | `BidControls` remembers which command was pressed; only that control announces itself. `busy` still disables both. |
| 3 | `td-14-mobile` | At 390×844 the auction's primary controls were entirely below the fold — and worse on a 667px handset. | The bid block docks to the bottom of the screen on phones (the whole block, so the amount you confirm is the amount you can see). `.td-game` reserves the space so the tray and footer stay reachable. |
| 4 | `rk-01-browsing-dark` | The new derivation control drew its border in `transparent` and lit it on hover — a dim italic glyph floating in the row, and on a touch screen there is no hover to reveal it. The requirement was a *clearly bounded* target. | Bordered and filled at rest; the column also gained a visible header. |
| 5 | `tmw-03-board` | The roll banner printed the same sentence twice, one line apart: "41 eligible players undrafted." above "41 eligible players still undrafted". | The live-region announcement is `sr-only`; the visible note carries the count once. |
| 6 | `tmw-07-rearrangement` | On the slot the pick lands on, the movement arrow had no name attached, so a four-move rearrangement read "D'Angelo Russell → SG" directly above a preview saying Russell goes to *point guard* and Bruce Brown is the one going to shooting guard. | The staged slot's arrow names the displaced player. |
| 7 | `tmw-09-bot-reveal` | (capture) The reveal tray shows your OWN picks too and nothing on the element said so, so the "bot pick reveal" frame photographed the player's own pick. | `data-yours` on the reveal; the capture waits for a bot's. |

### What the frames found — capture defects, fixed

A review frame that misrepresents the product is as bad as a product defect,
and eight of these were the capture's fault rather than the app's. They are
listed because each one had to be diagnosed before the frame could be trusted.

| # | Frame | Problem | Fix |
|---|-------|---------|-----|
| 8 | `td-13-result` | The site navigation was stitched as an opaque band across the middle of the result, covering both rosters — Chromium composes `fullPage` by scrolling and joining, so sticky elements land wherever they were. | Sticky containers are pinned to `static` for the duration of a full-page shot and restored immediately after. |
| 9 | `td-01-unopened-lot` | Shot on arrival, by which time the bot had already opened at $1 — an "unopened lot" with a standing bid on it. | Shot inside the loop, the first time the board genuinely reads "no bid yet". |
| 10 | `td-05-raise-exchange` | One `$1` in the feed filed as a raise exchange. | Requires at least two prices. |
| 11 | `td-04` / `td-06` / `td-09` | Byte-identical: three required states coexist one iteration after a pass, so one screen was filed under three names. The manifest made it visible; nothing refused it. | `once()` drops a frame whose hash matches one already written and leaves the name uncaptured, so the driver retakes it on a board that has moved. |
| 12 | `td-09-unsold-reveal` | The reveal's own "LOT 3" eyebrow sat behind the sticky nav, because the scroll position when a state occurs is an accident of the previous click. | Viewport frames are shot from the top of the page unless the frame is about something further down. |
| 13 | `td-10-settled-history` | Never taken once the driver was allowed to play the board out: the loop ended on the result screen, which has no tray. | Captured during the match instead. |
| 14 | `theme-01-light` | Shot the instant `data-theme` flipped, mid cross-fade, on a table that had not loaded — a nav link measured 2.58:1 that measures 8.9:1 once settled. A contrast defect that is not there. | Waits for the board, then lets the palette land. |
| 15 | `tmw-02` / `tmw-03` | `shootBoard()` tested once for a closed overlay and failed with "never caught the board with the overlay closed". A closed overlay is a WINDOW, not a state: the draft order is seed-drawn, so the human can hold two picks in a row and the overlay reopens between the check and the shot. | Polls to a deadline. |
| 16 | `tmw-08-bot-turn` | An unscoped count found two on-clock badges. `RosterBoard` renders every court twice — desktop grid and mobile tab panel — and CSS hides one. A fact about the DOM, not about the board. | The assertion counts VISIBLE badges: exactly one seat is lit. |
| 17 | `tmw-06-staged` | The staged primary carried its ENABLED label ("Draft Anfernee Hardaway at Point guard") painted in the DISABLED neutral, weaker than the Cancel beside it. It measured exactly `--bg-surface` — `.btn-primary` cross-fades its fill over 140ms and the shot was landing inside that window, on the colour it was leaving. This one was chased hardest, because a primary action that looks like a dead control is precisely the defect this rescue exists to remove. | The capture waits for the fill, then READS the computed background, asserts it is not the disabled surface, and records it in the manifest — so the frame proves the control is filled rather than merely being taken late enough to look it. |
| 18 | `tmw-14-result` | Never written across two runs. The podium loop ran until `committed < 18` was false, and in a three-seat snake draft the human makes six of the eighteen picks — so that condition can never be met and the loop spent its whole budget in sleeps. | Runs to the play-again break on a step budget; the test buys the wall clock a full draft needs. |

Also: the podium and full-auction captures were cut off by the shared 300s
config timeout (the draft reached about pick fourteen; the auction reached about
lot six), which is why the result screens and the late-market states had never
appeared. Both now buy the wall clock a real match needs.

### The real-clock timeout flow, both halves

`capture-rescue-shots.ts` → "a real timeout, on a real clock" stubs nothing and
hurries nothing. It now covers both questions a player actually has about a
deadline, not only the second one:

* **A bid placed near the deadline is taken.** The clock is left to run into its
  urgent band, the command goes in with a few seconds on it, and the frame pair
  shows the amount appearing on the feed with no error banner —
  `td-12c-late-bid`, `td-12d-late-bid-accepted`.
* **A decision not made is resolved by the server.** The next turn is simply
  left alone; `TURN_SECONDS` plus the grace window elapse and the server's own
  sweep settles it — `td-12a-timeout-warning` (the consequence stated before
  zero), `td-12b-timeout-expired` (controls stood down, "Time expired —
  settling this lot…"), `td-12-timeout-consequence` (after the sweep, with the
  skip counter's before → after recorded in the manifest note).

### The closeout market

`td-11-closeout` is **not** in the sheet, and that is a fact about the rules
rather than a gap in the review. The closeout market opens only when a roster is
still incomplete after the standard market, and the board works against that on
purpose: a seat that cannot use a candidate is passed out of the lot for free,
and a seat that CAN use one and has no market skips left must open. Both
captured matches filled every roster and closed early — one at twelve lots of
twenty-four. Forcing it would have meant photographing a state the rules did not
produce, which the capture is built to refuse.

How rare, measured rather than asserted: `test_bot_calibration.py`'s 2,000-seed
sweep reaches the closeout market in **38 matches — 1.9%**. Two browser matches
were never likely to find it. The phase's own rules are covered deterministically
there and in `test_ascending_auction.py`, including the guarantee that an
incomplete roster is served a legally fitting candidate inside a bounded number
of closeout lots.

### The sheet — every frame, and what reading it concluded

Three-Man Weave

| Frame | What it shows | Conclusion |
|---|---|---|
| `tmw-01-spinner-spinning` | Franchise/decade reels mid-flight, `data-stage="spinning"` | Reads as a reel in motion, not a banner. Turn bar and all three courts legible behind it. |
| `tmw-02-spinner-landed` | The locked roll, the active roster lit | One eligibility sentence, not two. Active seat unmistakable. |
| `tmw-03-board` | Turn bar, snake timeline, three courts, off-the-board list | Exactly one court carries ON THE CLOCK. Edge labels read as words ("Level with the field"), not as a level number. Nothing clipped. |
| `tmw-04-draft-room` | Pool left, interactive roster right, idle | Hint sits under the slots in a bounded box; no dead space; nothing below the fold. |
| `tmw-05-candidate-selected` | Selection made, legal slots lit, illegal dimmed | Legal/illegal distinction is fill and border, not opacity. Primary correctly not-yet-ready and neutral, not faded gold. |
| `tmw-06-staged` | Player staged on the clicked slot | Primary is the accent, measured `rgb(245, 200, 66)` and recorded in the manifest, and names both who and where. |
| `tmw-07-rearrangement` | A four-move rearrangement preview | Numbered, in order, and every affected slot carries its destination WITH the moving player's name. |
| `tmw-08-bot-turn` | A bot holding the clock | Turn bar names the bot; exactly one visible on-clock badge. |
| `tmw-09-bot-reveal` | A bot's pick, its season, its slot | Attributed to the bot, not to you — `data-yours="false"` asserted before the shutter. |
| `tmw-10-roster-move` | A placed card selected for movement | Source slot marked, legal destinations lit, primary names the pending decision. |
| `tmw-11-mobile-placement` | 390px, two-step flow | Pool hidden at the placement step; both actions comfortably above the fold. |
| `tmw-12-short-desktop` | 1440×700 | The primary action stays in view at laptop height; the pool and placement column scroll internally. |
| `tmw-13-midgame` | All three rosters part-filled, bot on the clock | Balanced; the active seat is the only lit one; off-the-board list present. |
| `tmw-14-result` | Podium, basis, decisive pick, real buttons | Eyebrow is about YOU ("You finished 3rd"), headline about the winner; `Play again` is a filled accent button, not text. |

The $20 Showdown

| Frame | What it shows | Conclusion |
|---|---|---|
| `td-01-unopened-lot` | A genuinely unopened lot | Symmetrical seat panels, both budgets and both skip counters visible, everything above the fold. |
| `td-02-your-turn` | The human on the clock | Large clock stating what expiry costs; `Open at $1` and `Market Skip — 5 of 5` are two distinct controls with two distinct consequences. |
| `td-03-bid-accepted` | The walk-up on the feed | Bot $1 → You $2 → Bot $3; no error banner; controls re-enabled. |
| `td-04-bot-thinking` | The opponent on the clock | Named, with the controls stood down and the reason stated. |
| `td-05-raise-exchange` | Two or more prices in the feed | An exchange, not an opening bid mislabelled as one. |
| `td-06a-skip-before` / `td-06-skip-accepted` | A market skip, before and after | The counter moves 5 of 5 → 4 of 5 on the control AND on the seat panel. |
| `td-07-bid-pending` | A command in flight | "Submitting $2 bid…" on the bid control only; the pass control keeps its own label. |
| `td-08-sold-reveal` | A settled lot | Score, season and destination on centre stage ABOVE the controls; the chart is behind `View breakdown`. |
| `td-09-unsold-reveal` | Nobody bid | "Nobody bid. The lot leaves the board", with the sealed score revealed. |
| `td-10-settled-history` | The settled-lot tray | Full width, newest first, buyer and price and score per row — not a column crushing the opponent. |
| `td-12c-late-bid` / `td-12d-late-bid-accepted` | A bid placed inside the urgent band | Taken: the player lands on the roster and the budget moves. A late press counts. |
| `td-12a-timeout-warning` | Before zero | The consequence is stated before it fires. |
| `td-12b-timeout-expired` | At zero | Controls stood down; "Time expired — settling this lot…". |
| `td-12-timeout-consequence` | After the server's sweep | The skip counter's before → after is recorded in the manifest note. |
| `td-13-result` | The auction closed | Winner, margin, basis, both rosters with price and score, best bargain / biggest overpay / decisive lot, two real buttons. |
| `td-14-mobile` | 390px | The bid block docks to the bottom; the primary action is on screen without scrolling. |

Rankings and theme

| Frame | What it shows | Conclusion |
|---|---|---|
| `rk-01-browsing-dark` / `rk-01-browsing-light` | The board with nothing selected | No default selection and no chart, asserted before the shutter. The derivation control is a bounded, separately labelled cell in both themes. |
| `rk-02-analysis-dark` / `rk-02-analysis-light` | The full analysis | Chart labels complete, exact values, components, completeness, and two real navigation buttons. |
| `rk-03-mobile-analysis` | 390px | A full-width sheet, not a squeezed column; radar labels unclipped. |
| `theme-01-light` / `theme-02-dark` | One click, each direction | The palette lands both ways from a light-mode OS; nav contrast correct in both. |

### Second closure pass — validation

Every command below was run to completion, with **zero retries** on the browser
suites (`scripts/ci/e2e-tests.sh` defaults `PLAYWRIGHT_RETRIES=0`).

| Command | Result |
|---|---|
| `python -m pytest tests/` | 1452 passed, 1 xfailed |
| `python -m pytest tests/twenty_dollar/test_timeout_audit.py` | 20 passed |
| `scripts/ci/api-unit-tests.sh` | 1591 passed, 2 skipped |
| `scripts/ci/frontend-verify.sh` (typecheck + lint 0 warnings + vitest + production build) | 1685 passed; build ✓ |
| `scripts/ci/e2e-tests.sh --project=chromium rankings.spec.ts theme.spec.ts` | 50 passed |
| `scripts/ci/e2e-tests.sh --project=mobile-chrome rankings.spec.ts` | 6 passed |
| `scripts/ci/e2e-tests.sh --project=chromium --grep "@a11y\|axe\|accessib"` | 25 passed |
| `scripts/ci/e2e-tests.sh --project=chromium arena-multiplayer.spec.ts` | 16 passed |
| `npx playwright test --config=playwright.rescue-shots.config.ts` | 39 frames, no duplicate hashes |
| `git diff --check` | clean |
| `git status data/ leaderboards/ nba_peak/ peak3.py` | untouched — no scoring, weights or leaderboard CSV changed |

One caveat, recorded rather than smoothed over: on one of five full `vitest`
runs a single test failed inside jsdom's MutationObserver teardown. Four
subsequent full runs were green at 1683–1685/1685, and the failure did not
reproduce. It is a test-environment flake, not a product signal, but it happened
and is not being reported as if it did not.

### Second closure pass — status

No visual-review or interaction item is outstanding. Thirty-nine frames were
captured and every one was opened and judged; the eighteen defects the reading
produced are fixed and the affected frames recaptured. `td-11-closeout` is the
one required state absent from the sheet, for the measured reason recorded
above (1.9% of 2,000 seeded matches).

---

# Third pass — the second manual review

Four findings from the user's own local review, none of which the first two
passes could have caught: they are about surfaces the earlier work did not
touch, and about a configuration file the browser suite supplies for itself.

## Requirement matrix

| # | Finding | Root cause | Files | Status | Automated tests | Manual evidence |
|---|---|---|---|---|---|---|
| R27 | Rankings still shows a standalone `ƒ` derivation column | RC-10 | `RankingsTable.tsx`, `rankings.css` | DONE | `rankings-row-interaction.test.tsx` (14), `rankings.spec.ts` | `rk-01-browsing-{dark,light}` |
| R28 | Formula derivation and player analysis are two interactions | RC-10 | `ScoreDerivation.tsx`, `RankingsAnalysis.tsx` | DONE | `score-derivation.test.tsx` (35), `rankings-analysis.test.tsx` (17) | `rk-02`, `rk-04`, `rk-05`, `rk-06` |
| R29 | Multiplayer shows a blanket closed-alpha wall | RC-11, RC-12 | `apps/api/.env`, `.env.example`, `arena-capability.ts`, `ArenaLobby.tsx` | DONE | `arena-capability.test.ts` (11), `arena-lobby.test.tsx` (31), `arena-multiplayer.spec.ts` | `lobby-01-{desktop,mobile}`, `lobby-02` |
| R30 | Bot practice needs hosted Supabase auth to review locally | RC-13 | `config.py`, `api/v1/arena.py` | DONE | `test_arena_local_practice.py` (21) | `lobby-01`, played through |
| R31 | Fact of the Day is visually weak | RC-14 | `NbaFactOfTheDay.tsx`, `home.css` | DONE | `nba-fact-of-the-day.test.tsx` (14) | `fotd-01`…`fotd-11` |
| R32 | The generated fact is too dull for the homepage | RC-15 | `nba_peak/nba_facts/*`, `data/facts/editorial_facts.json` | DONE | `test_nba_facts.py` (48) | `fotd-01`…`fotd-10` |
| R33 | The 82-0 global leaderboard is disabled | RC-16 | `apps/api/.env`, `.env.example` | DONE | `test_perfect_season.py` | `lb-01`…`lb-05` |
| R34 | The board is a debug table, and reports failure as disablement | RC-17 | `PeakSeasonLeaderboard.tsx`, `arena.css` | DONE | `peak-season-leaderboard.test.tsx` (19), `courtbuilder.spec.ts` | `lb-01`…`lb-05` |
| R35 | The user's 81-1 run is nowhere | RC-16 | `scripts/reconcile_perfect_season_leaderboard.py` | AUDITED — see below | `test_reconcile_leaderboard.py` (13) | hosted dry-run, read-only |

## Phase 0 — proven root causes

### RC-10 — Rankings splits one question across two dialogs

A ranking row carried TWO controls. The row, the rank and the player name
opened the analysis drawer; a separate `w-px` cell headed `ƒ` opened
`ScoreExplainModal`. The drawer showed the shape of a peak and would not say
where the number came from; the modal showed the derivation and had no chart. A
reader who wanted both had to close one to open the other, and on a phone the
second was reached through a one-character glyph.

This was itself the *second* fix to the same row. The first closure pass had
moved the derivation off the player name into its own bounded cell, because at
390px the name covered most of the row and the same gesture opened different
dialogs at different widths. That fix was correct about geometry and wrong
about the product: two boxes that cannot overlap is a weaker guarantee than one
destination.

**Files:** `RankingsTable.tsx`, `RankingsAnalysis.tsx`, `ScoreExplainModal.tsx`
(deleted), `rankings.css`

### RC-11 — The Arena flags are in no environment file this repository ships

`apps/api/.env` — the file `make api` reads — names **no** `PEAK3_ARENA_*`
variable. Every one defaults to `False` and `ARENA_READINESS_LEVEL` to
`disabled`, so `GET /api/v1/arena/readiness` answered `arena_enabled=false` and
`ArenaLobby` rendered its wall at `if (!readiness.arena_enabled)`.

Proven by loading the real `Settings` from `apps/api`:

```
ARENA_ENABLED                          False
ARENA_PUBLIC_QUEUE_ENABLED             False
ARENA_BOTS_ENABLED                     False
ARENA_READINESS_LEVEL                  'disabled'
COURTBUILDER_LEADERBOARD_ENABLED       False
```

The earlier observation that readiness reported `arena_enabled=true` was true
of a **different API**: `scripts/ci/e2e-tests.sh` exports these itself
(lines 40-43), so the browser suite passed against a lobby a developer could
not reach. And `.env.example` documented neither the Arena nor CourtBuilder at
all, so there was nothing to copy — which is why this was not a five-minute
fix for whoever hit it.

### RC-12 — One boolean cannot express a closed alpha

Even correctly configured, the lobby asked readiness ONE question and answered
everything else with a `disabled` flag per control. In closed alpha two of the
three controls on every card are permanently closed, so a two-game lobby drew
four dead buttons under a heading promising "Live games against other people" —
the one thing closed alpha does not offer. A capability that is not coming back
this week is not a disabled control.

### RC-13 — Practice required an account it never needed

`arena.py` required a Supabase `auth.uid()` on every route, for a reason that
is exactly right for a shared match: an anon subject can be discarded by
clearing a cookie, and in a three-seat match that abandons two other people
mid-clock. That has never applied to practice, and the file's own docstring
said so: *"Practice is the one path where this could later be relaxed, since it
involves nobody else."* The consequence was that reviewing bot practice on a
laptop required a hosted Supabase project.

### RC-14 / RC-15 — The fact bank could only be about roster churn

Every fact came from a generator over `data/generated/player_seasons.json`,
which holds per-season totals and team codes. The only patterns expressible
there are tenure, workload and roster churn — which is why the bank read as a
survey of roster churn and produced the sentence the review quoted. Every
category the brief asks for (rule changes, the Olympics, EuroLeague, the WNBA,
the draft) is outside anything that table could ever emit. The card compounded
it: one type size, and a `<details>` labelled "Show source rows" as its most
prominent interaction.

### RC-16 — The 82-0 leaderboard has never been reachable

`perfect_season_runs` holds **zero rows**. Not an idempotency bug, not an RLS
bug: `submit_run` opens with `_require_leaderboard_enabled()`, and
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` appears in no environment file in this
repository — including `.env.example`. Every submission any player ever
attempted returned 403 `leaderboard_not_enabled`.

Saving is deliberately NOT behind that flag, which is why
`perfect_season_saved_runs` holds 41 rows beside an empty board — and why a
player could reasonably believe a run had been recorded.

Full audit, including everything that was checked and found **correct**:
`docs/implementation/PEAK_SEASON_LEADERBOARD_AUDIT.md`.

### RC-17 — The board reported a dropped request as a disabled feature

`leaderboard/page.tsx` held the board itself and its `catch` did this:

```ts
.catch(() => { setEnabled(false); })
```

so a failed request and a capability nobody had turned on rendered the identical
sentence, with no retry but a page reload. That is the most misleading thing a
board can say: it sends a reader to the wrong question entirely.

## The 81-1 run — found, authoritative, and blocked on one thing

Read-only queries against the hosted database. **Nothing was written.**

| | |
|---|---|
| `games.id` | `e564b8d3-4c1f-4d09-8f8c-16e83ecd1104` |
| status | `result_ready` |
| record | **81-1** |
| lineup score | **77.3** |
| cards exactly scored | 8 of 8 |
| seed | 431465972 |
| completed | 2026-08-04 05:10:08 UTC |
| on the leaderboard | **no** — the table is empty |

The canonical game exists, is complete, is simulated, and
`state_machine.compute_eligibility` calls it leaderboard-eligible. It is
reconcilable. `scripts/reconcile_perfect_season_leaderboard.py`, run in its
default dry-run mode against the hosted database, reports every scored check
passing and refuses on one thing:

```json
{"action": "refused", "reason": "handle_required",
 "wins": 81, "losses": 1, "lineup_score": 77.3,
 "missing": ["profiles.handle"]}
```

**The account has no `profiles` row at all**, so it has no public handle — and
the board displays public handles and nothing else. `submit_run` refuses for
exactly this reason, deliberately: a silent auto-generated fallback would
publish an identity its owner never chose. So the remaining step is one action
by the owner (set a handle at `/profile`), not a data repair, after which
either re-submitting from the result screen or running the tool with `--apply`
puts the run on the board. Both are idempotent through `game_id UNIQUE`.

**Where it would rank is not promised.** The board is empty, so on today's data
an 81-1 entry would be the only row and therefore first. That is a statement
about an empty table, not about the run. The ordering it will be subject to is
wins ↓, lineup score ↓, fewer respins ↑, earliest submission ↑ — and this run
used four respins, which is a real tie-break cost.

## The fact bank, in numbers

Generated by the same run that wrote the bank —
`docs/implementation/NBA_FACT_BANK_REPORT.md`.

```
published                 47
candidates               459
rejected                 412
  below_quality_floor    391
  pattern_cap             20
  near_duplicate           1
by provenance     editorial 30 · derived 17
categories                19
eras                       9
facts with an expiry       1
```

Two things the numbers are hiding unless they are said out loud:

* **`pattern_cap` is not a quality judgement.** A generator finds its pattern
  once per player, so one pattern can produce a hundred facts that are
  individually fine and collectively a survey. The cap is reported rather than
  silent, because "the generator only found six" would be false.
* **Three generators ship nothing, on purpose**, and two of those were scored
  down only after reading the review frames — see below.

## What reading the frames found, and fixed

| Frame | Defect | Fix |
|---|---|---|
| `fotd-03-player-story` | The homepage published *"A.C. Green left LAL after 1992-93 and returned 7 years later. Two separate stints at the same franchise."* — precisely the "players switching teams" / "dull bookkeeping" shape the brief names, with a supporting sentence that restates the headline. It had cleared the gate at 25/35. | `franchise_return` and `many_franchise` re-scored to `broad_interest: 2`, under the floor. Scored down rather than deleted, so the report still counts them. |
| `fotd-03-player-story` | *"his 23th recorded season"* — correct arithmetic in incorrect English, on the surface a visitor sees first. The bug had been in the generator since it was written. | `_ordinal()`, with 11/12/13 handled, plus a test over the whole bank. |
| every derived card | Only the curated half carried a `feature`, so half the bank collapsed to a headline and a thin line while the other half looked finished. | Every generator passes a featured value and label; a test asserts no published fact is without one. |
| `lobby-01`, `lb-01` | The handle-onboarding prompt covered the bottom-right of both frames. A real prompt, and a real obstruction to a review. | The capture skips it, as a reader would. |
| `lb-05-mobile` | The capture reported 238px of horizontal overflow. **It was a phantom**: `body.scrollWidth` was 390 and the page's maximum horizontal scroll was 0. Chromium counts a nested scroll container's clipped layout overflow in the ROOT element's `scrollWidth`. Measured both with and without a `min-width: 0` "fix" — identical. | The probe now tries to scroll and reads how far it went. The `min-width: 0` stays as documented defence, explicitly **not** recorded as a fix, because it fixed nothing. |
| `fotd-*` (first attempt) | Ten frames of the same day's card. `page.route` cannot intercept a fetch made by a SERVER component, and the fact is fetched in one. | The homepage forwards `?fact=YYYY-MM-DD` to the API's own long-standing `?on=`; each frame asserts its `data-category` before the shutter. |
| `rk-05-next-player` | A capture defect: `<details>` is a toggle and the driver clicked an already-open summary, closing the fold the frame was about. | `openFold()` opens only when closed. |
| `fotd-*` (first attempt) | `ECONNREFUSED` — the capture read `NEXT_PUBLIC_API_URL` from `process.env`, which is set for the Next process and not for Playwright's, and fell back to a port nothing was listening on. | The port is exported from the capture config and imported. |

## Third pass — validation

Every command run to completion, with **zero retries** on the browser suites
(`scripts/ci/e2e-tests.sh` defaults `PLAYWRIGHT_RETRIES=0`).

| Gate | Command | Result |
|---|---|---|
| Model tests | `python -m pytest tests/` | 1484 passed, 1 xfailed |
| Fact bank | `pytest tests/test_nba_facts.py tests/test_nba_facts_deployment.py` | 48 + 15 passed |
| Reconciliation logic | `pytest apps/api/tests/test_reconcile_leaderboard.py` | 13 passed |
| Local bot practice | `pytest apps/api/tests/test_arena_local_practice.py` | 21 passed |
| API unit suite | `scripts/ci/api-unit-tests.sh` | 1627 passed, 2 skipped |
| Frontend typecheck + lint + unit + build | `scripts/ci/frontend-verify.sh` | 1743 passed, 0 warnings; build ✓ |
| Rankings + facts (desktop) | `e2e-tests.sh --project=chromium rankings.spec.ts home-fact-of-the-day.spec.ts` | 55 passed |
| Arena + CourtBuilder (desktop) | `e2e-tests.sh --project=chromium arena-multiplayer.spec.ts courtbuilder.spec.ts` | 115 passed |
| Mobile | `e2e-tests.sh --project=mobile-chrome rankings/facts/courtbuilder` | 10 passed |
| Targeted axe | `e2e-tests.sh --project=chromium --grep "@a11y\|axe\|accessib"` | 26 passed |
| Review capture | `npx playwright test --config=playwright.rescue-shots.config.ts` | 14 new frames, every assertion before the shutter |
| `git diff --check` | vs `bd8aea2` | clean outside the verbatim specification document |
| Generated data | `git diff --name-only 25714d9..HEAD` over `peak3.py`, `leaderboards/`, `data/generated/`, `cache/`, `supabase/migrations/`, `nba_peak/three_man_weave`, `nba_peak/twenty_dollar` | **empty** — no scoring, weights, leaderboard CSV or game rule touched |

### One configuration divergence this pass found and closed

`scripts/ci/e2e-tests.sh` did not export
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`, so the API took its value from
whatever `apps/api/.env` happened to say. Enabling the board locally therefore
broke `leaderboard page says the board is not open when the feature is off`
while a clean checkout passed it — the exact laptop-versus-checkout divergence
the two exports already in that file exist to prevent. It is now declared,
`false`, with the suite covering both postures (the disabled state from the
real API, the populated and failed states from network fixtures).

### The review frames

`docs/implementation/arena-rescue-review/` (gitignored), with
`screenshot-manifest.json` recording each frame's URL, viewport, resolved theme,
note and content hash.

| Frame | What it shows |
|---|---|
| `rk-01-browsing-{dark,light}` | The board with no selection, no chart, and no `ƒ` column — all three asserted before the shutter |
| `rk-02-analysis-{dark,light}` | The unified drawer's first view: rank, board, season, team, score, chart, exact per-component values, three collapsed disclosures |
| `rk-04-derivation-{dark,light}` | The same drawer expanded: percentile → component score → weight → contribution, summed, plus teammate adjustment, raw index and calibrated score. Jordan 1990-91: 87.11 − 0.247 = 86.87 → 97.53 |
| `rk-05-next-player-{dark,light}` | Previous/Next moved the analysis AND the derivation |
| `rk-03-mobile-analysis`, `rk-06-mobile-derivation` | 390px: a full-width sheet with the same content, the arithmetic scrolling in its own box |
| `lobby-01-closed-alpha-{desktop,mobile}` | Both games playable vs bots, "Playable vs bots" badges, one primary action each, matchmaking held back once at the end |
| `lobby-02-unavailable` | Arena off: a real wall, naming which state it is |
| `fotd-01`…`fotd-10` | Ten cards across ten categories — buried history, tactics, a player story, a franchise, the Finals, a statistical oddity, international leagues, women's basketball, a rule change, the draft — each asserting its own `data-category` before the shutter, and each with no source-row table |
| `fotd-11-mobile` | 390px: the motif above the copy rather than beside it |
| `lb-01-populated-{dark,light}` | Rank, name, record, lineup score, date, seed, receipt link; the leader crowned; "Your best" highlighted; pagination offered |
| `lb-02-empty` / `lb-03-failed` / `lb-04-disabled` | Three states that used to be two, each with a different next action |
| `lb-05-mobile` | 390px: seven columns scrolling inside their own box, the page not moving |

### Third pass — status

No item from the four findings is outstanding. The one thing that is **not**
done, and cannot be done from here, is the last step of the 81-1
reconciliation: the account needs a public handle before the run can carry a
name onto the board. That is one action by its owner, and the tool refuses
until it happens rather than inventing one.

---

# Fourth pass — the bank was too small for a daily feature

47 published facts and a schedule whose period is exactly the size of the bank
means the whole inventory cycles in seven weeks. Direction approved; scale
insufficient.

## What changed, and why the bank could not simply be "filled in"

**The ceiling was structural, not editorial.** `derived.py` reads a table of
per-season totals — player, team, season, games — and four columns can only
describe tenure, workload and roster churn. Its interesting patterns were
already exhausted; the remaining ones were the dull ones the third pass had
scored below the floor on purpose. Writing another generator over that table
would have produced more of exactly what the review rejected.

So the bank grew from a source it had never read.
`data/generated/player_season_context.parquet` is committed, covers 1980-2026,
and holds what actually happened: MVP and DPOY vote ranks, All-NBA and
All-Defense selections, All-Star nods, the five statistical titles, 50/40/90
seasons, championships, Finals MVPs, playoff depth, and what role a player had
on a title team. It joins onto the season table at **100%**.

`nba_peak/nba_facts/awards.py` is seventeen generators over that join, and
almost every one emits a CONJUNCTION rather than an award. A single award is
bookkeeping — "led the league in blocks in 1993-94" is a row in a table. Two
things that happened to the same player in the same season and are surprising
together is a fact somebody repeats:

* a scoring title and a lottery finish
* an MVP who never reached the Finals
* a Finals MVP who was not his own team's best player
* All-NBA First Team in a season the team missed the playoffs
* a league-leading category and a ring, in the same year

Plus the cases where a single number IS the surprise: 50/40/90 (13 seasons in
47 years) and multi-season title streaks.

**No generator writes "the only player to."** The data starts at 1979-80, so
"only" would be a claim about a window the reader is never told about — the
same plausible-and-wrong shape the namesake guard already refuses. A test
enforces it.

The curated half grew from 30 to 57, weighted to the categories no dataset can
reach: the 1936 Olympic final played outdoors in the rain, the three seconds
replayed twice in Munich, Lithuania's Grateful Dead tie-dye, Oscar Schmidt's
49,737 points without an NBA minute, the Basketball Africa League's first
season in Kigali, the hand-check ban and what it did to scoring, the frozen
envelope, why Utah's team is called the Jazz. Every one names a checked source.

## Four controls, three of them new

| Control | What it binds | Why it exists |
|---|---|---|
| Seven quality axes with per-axis floors | one fact | unchanged from the third pass |
| `MAX_PER_DERIVED_PATTERN = 8` | one generator | **counted per generator now, not per category.** Per-category was a proxy that broke the moment several generators shared a category: capping `statistical_oddity` at six capped four patterns collectively, and the bank could not grow past about fifty however many good candidates existed |
| `MAX_ROTATION_GROUP_SHARE = 1/3` | a FAMILY of generators | five streak generators plus the record and oddity patterns put **51% of a 255-fact bank into one rotation group**. Every fact had cleared the floor and no pattern was over 5%, and the homepage would still have served something arithmetic every other day, because `rotation.py` interleaves by group and a group holding half the bank cannot be alternated away from |
| Near-duplicate, **same subject only, headline only** | two facts | see below |

### The duplicate check was wrong in two separate ways, and expanding the bank proved it

Comparing headline + body counted the **shared explanatory boilerplate** every
fact from one generator carries verbatim, so two facts about two different
people scored as duplicates because they were *explained* the same way. That
alone rejected 145 good facts.

Comparing across subjects was the second error. "Tony Parker won Finals MVP on
a team he was not the best player on" and the same sentence about Jaylen Brown
share nine words of eleven and are **two facts about two different people**. No
amount of shared phrasing makes them one.

So: headline only, and only between facts naming the same player — or the same
team, when neither names a player. Template repetition is a real defect and it
has its own control, which is the pattern cap: one generator is one template.

Where the check now fires it is correct, and the answer was a better fact rather
than a silent drop: four cards reading "Steve Nash shot 50/40/90 in 2005-06 /
2007-08 / 2008-09 / 2009-10" became one reading "Steve Nash put together a
50/40/90 season four times", and six Jordan cards became **"Michael Jordan led
the NBA in scoring and steals and won the title in the same season six times."**

## Rotation: three requirements, one construction

`schedule()` interleaves (category-group, era) lanes greedily, preferring at
each step a lane whose head differs in category group from yesterday and whose
subject has not headlined in fourteen days.

The preferences are preferences and not requirements, deliberately: near the end
of a period only one lane has anything left, and a schedule that refused to
place a fact there would have to drop it. So the build report **measures** how
often the preference could not be honoured rather than the code asserting a
guarantee the inventory cannot give.

```
period                                    211 days
distinct facts served in 216 days         211
first repeat after                        211 days   (requirement: >= 180)
consecutive same-category-group days      3 of 210   (1.4%)
same player or team inside 14 days        0
day boundary                              midnight America/Los_Angeles
```

## The numbers

```
published                 211        (requirement: >= 180; target 250)
candidates                772
rejected                  561
  below_quality_floor     391
  pattern_cap             120        ceiling, not a judgement
  group_cap                45        ceiling, not a judgement
  near_duplicate            5
provenance          derived 154 · editorial 57
categories                 20
eras                       11        (1890s through 2020s)
domestic / global       196 / 15
women's basketball          4
facts with an expiry        1
mean source_confidence   4.84 / 5
```

**211, not 250, and the shortfall is the honest one.** Reaching 250 was possible
and required either raising the pattern cap — more of the same shape — or
relaxing the group ceiling, which would have put half the bank back into one
rotation group. The brief says quality matters more than the number, and both
levers trade the second requirement for the first. The categories that are still
thin (`nba_history` 1, `tactics` 1, `current_nba` 1) are named in the report
rather than padded.

## Two defects the frames found again

| Frame | Defect | Fix |
|---|---|---|
| the first twenty-card sheet | Three slots produced no card and the sheet came back with seventeen. The driver searched 120 days for a category against a **211-day period**, so `historic_games`, `tactics` and `nba_history` were genuinely unreachable. | The window is longer than the period. Every fact appears exactly once per period, so a window over it finds all of them. |
| `fotd-*` after a failed run | Stale frames from a partial run sat beside the new ones under different index numbers, and the manifest kept both. | The frames and their manifest rows are pruned before a re-shoot. |

## Fourth pass — validation

| Gate | Command | Result |
|---|---|---|
| Model tests | `python -m pytest tests/` | 1493 passed, 1 xfailed |
| Fact bank | `pytest tests/test_nba_facts.py tests/test_nba_facts_deployment.py` | 57 + 15 passed |
| API unit suite | `scripts/ci/api-unit-tests.sh` | see below |
| Frontend typecheck + lint + unit + build | `scripts/ci/frontend-verify.sh` | see below |
| Generator | `python scripts/build_nba_facts.py --report …` | 211 facts written; report regenerated from the same run |
| Review capture | `playwright test --config=playwright.rescue-shots.config.ts` | 42 fact frames: 20 dark, 20 light, 2 mobile |

### What the tests now hold

- no fact repeats inside 180 daily keys
- no player or team headlines twice inside 14 days
- consecutive days share a category group at most 5% of the time
- no rotation group exceeds a third of the bank
- no category exceeds a quarter
- no generator template exceeds eight facts
- every award fact re-derives from the committed context table
- no derived fact claims to be "the only"
- no malformed ordinal anywhere in the bank
- every fact carries a featured value and a label
- every editorial fact names a source and is marked verified
- every perishable fact carries an expiry, and an expired one is never served
- the build is byte-reproducible

### One pre-existing failure this pass found, diagnosed, and did NOT cause

`apps/api/tests/test_draft.py::test_daily_completion_is_recorded_on_finish`
fails in the full API suite and passes on its own, and on
`pytest tests/test_daily_grid.py tests/test_draft.py`, and on
`pytest tests/test_perfect_season.py tests/test_draft.py`.

**Not caused by this pass.** Verified rather than assumed: every change was
stashed and the suite re-run on the pre-change tree, where it fails identically
(1626 passed, 1 failed, before and after).

**The cause is test isolation, not the product.** The assertion is

```
a completed Daily game must write a durable DailyCompletion record
```

and `record_completion` enforces one attempt per (owner, board, mode). The
in-memory repositories are MODULE-LEVEL SINGLETONS — `conftest.py` says so in
its own header — and nothing resets `_memory_daily_completion_repo` between test
modules. So an earlier test that completes a daily board for the same anon
subject and the same board leaves a row there, and this test's write is
correctly dropped as a duplicate attempt. The route is doing exactly what it
should; the fixture is not.

A first attempt at a fix — widening the test's date-retry window from five days
to thirty, on the theory that the calendar had rolled onto a run of boards its
greedy heuristic could not solve — was **wrong and has been reverted**: the test
still failed with the window widened, which is what ruled the date out and led
to the real diagnosis.

Left as found: the fix belongs in the suite's fixtures rather than in this
pass, and it is not this pass's to make. Reported rather than absorbed, because
"the suite is green" and "the suite is green except for one pre-existing
order-dependent failure whose cause is known" are different claims.

**Fixed in the fifth pass**, exactly where this diagnosis said it belonged —
see "The API isolation failure" below.

---

# Fifth pass — semantic coverage, test isolation, and the handoff

The fourth pass left a 211-fact bank that was big enough and unevenly *about*
things, one API test that failed only in the full suite, and two questions
about deployment that had never been written down in one place. This pass
closes all four.

## What "coverage" was measuring, and why it had to be replaced

The bank reported its shape through `by_category`, and a category is one label
per fact chosen by whichever generator or curator produced it. That is a fine
index and a poor audit, for two reasons the bank demonstrates directly:

* **A fact has one category and is about several things.** "The Dream Team
  exists because of a vote the United States lost" is filed `olympics_fiba`.
  It is equally foundational NBA history, a rule change, and a
  global-basketball fact. Counting it once, under one heading, understates
  every other heading it belongs in.
* **A category under-reports a subject it does not name.** Reading
  `womens: 4` off the category counter and concluding the bank held four
  women's-basketball facts is only correct if nothing outside that category is
  about women's basketball — which is a claim, not a definition.

`nba_peak/nba_facts/coverage.py` is the second classification: fifteen
semantic areas, and a fact joins one through **its category**, through **a
narrow lexicon of proper nouns and terms of art it actually names**, or
through **a structured field** (`geography`, `valid_until`). The counts sum to
more than the size of the bank, deliberately — "how many facts touch the
Olympics" and "how many facts are filed under the Olympics" are different
questions and the second was never the one being asked.

### The lexicons are narrow, and one pass of this was not narrow enough

A generous matcher makes coverage look solved by definition, which is exactly
the failure a coverage target invites. The first cut of the lexicon compiled
each term as a bare substring, and three of them quietly inflated the audit:

| Term | Also matched | Effect |
|---|---|---|
| `pace` | "space", "spacing" | tactical facts that were about neither |
| `rule` | "ruled", "ruler" | any sentence with a court ruling in it |
| `later` | every ordinary use of the word | 15 "surprising connections" |

`playoffs_finals` reported **83** facts where **42** are about the postseason.
Terms are now word-bounded (`_bounded`), with the trailing boundary skipped
after a digit so the era prefixes `until 19` and `1936` keep matching
"until 1976" and "1936 Berlin". Two vague terms were replaced outright:
`nearly` → `nearly called`, `later` → `years later` / `decades later`.

## The four thin areas, and what closed them

Audited against the brief's preferred minima:

| Area | Before | Target | After |
|---|---|---|---|
| Global and international basketball | 17 | 25 | **26** |
| Women's basketball and the WNBA | 5 | 10 | **10** |
| Active / current NBA | 1 | 10 | **11** |
| Foundational and iconic NBA history | 12 | 25 | **26** |
| Tactics + rule evolution (combined) | — | 10 | **13** |

**Thirty-four curated facts were written**, each naming a published source that
was checked: the first NBA game (played in Canada, by a league not yet called
the NBA), the 1949 merger agreed in the Empire State Building, Earl Lloyd
first by a day, the 1951 All-Star Game staged to hold the league's attention,
Russell as player-coach, the 142 Russell–Chamberlain meetings, the four ABA
survivors and the franchise that folded and made its owners a fortune anyway,
the territorial pick, *Haywood v. NBA*, the logo the league has never
confirmed, the highest-rated basketball game ever played (a college final),
the parquet made from scrap oak, the only unanimous MVP; Germany's undefeated
2023 World Cup, Spain's six titles, Slovenia's 2017 EuroBasket with an
undrafted 18-year-old, the five World Cups won by a country that no longer
exists, the two players with a EuroLeague title *and* a ring *and* an Olympic
gold, Canada's first World Cup medal; A'ja Wilson's fourth MVP, the Aces'
sweep, a rookie leading the WNBA in assists, the first expansion team to make
the playoffs in its opening season, Unrivaled; and ten facts about the season
that just ended, **every one carrying an expiry**.

**And 28 derived facts were displaced rather than added to.** The brief asked
for the weakest accepted derived facts to be replaced where appropriate rather
than the bank inflated, and the lever for that is `MAX_PER_DERIVED_PATTERN`,
which decides how much of the bank is SURVEY — the same sentence about a
different player. At twelve the bank came to 256; at eight it comes to **228**,
and every coverage target is still met. The choice was between publishing 256
facts of which the marginal 28 were another lap of an existing template, and
publishing 228 where the new material displaced them.

## Rotation: a repair pass, because greed is left-to-right

Adding a second LeBron James fact and a second Shai Gilgeous-Alexander fact
broke `test_no_player_or_team_headlines_twice_in_a_fortnight`, and the reason
is structural rather than editorial. The scheduler consumed lanes head-first
and could only choose among the lanes that still had something in them. Near
the end of a period that is one or two lanes, so if what is left in them names
the same player twice the spacing rule is unsatisfiable **at that moment** —
though not for the period, which has 226 other positions in it.

Two changes, in the order they matter:

* **`_pick`** — the head of a lane is no longer sacred. When it names somebody
  who headlined this fortnight and a sibling behind it does not, the lane
  offers the sibling. This costs nothing, because a lane holds one kind of
  fact throughout.
* **`_repair`** — a strict-improvement hill climb over the finished sequence.
  For every position that still clashes it looks for a swap that lowers the
  total cost in the neighbourhood of both positions; a swap is kept only when
  it makes things better, so it cannot cycle and cannot make the schedule worse
  than greed left it. A repeated NAME costs three times a repeated KIND, for
  the reason `SUBJECT_SPACING_DAYS` exists at all.

| Audit | Fourth pass | Fifth pass |
|---|---|---|
| Consecutive same-category-group days | 1 | **0** |
| Same player or team inside 14 days | 2 | **0** |
| First repeat after | 211 days | **228 days** |

The repair pass made `schedule()` ten times more expensive, and
`fact_for_date` calls it on every request. It is now memoised on the tuple of
fact ids that went into it — keyed by content, so a rebuilt bank or an expiry
is a different key rather than an invalidation somebody has to remember. The
fact suite went from 3.5s to 1.3s in the process.

## The API isolation failure — fixed in the fixtures, not in the product

The fourth pass diagnosed `test_daily_completion_is_recorded_on_finish` and
deliberately left it: it fails in the full suite, passes alone, and fails
identically on the pre-change tree.

**The cause, restated exactly.** `client` is session-scoped, so one anonymous
subject — one `peak3_anon` cookie — plays every test in the run. The in-memory
repositories are module-level singletons and nothing emptied them between test
modules. `MemoryDailyCompletionRepository` is keyed on `(owner_sub, board_id)`
and first-write-wins, which is correct: a player gets one recorded attempt at a
daily board. So the first test anywhere in the suite to finish today's
`apex_1y` daily board took that key, and this test — which finishes the same
board as the same subject and asserts the record is its own — found the earlier
test's row.

**The fix is one autouse fixture, and it changes no application behaviour.**
`reset_memory_repositories()` re-initialises every `_memory_*` singleton in
`app.core.dependencies` **in place**, by calling its own `__init__` on itself.
Both properties are the point:

* **Exact.** Whatever `__init__` sets up is what a fresh repository has, so it
  cannot drift from the real constructor and cannot miss a field somebody adds
  later. A hand-written list of attributes to clear would have to be maintained
  against twenty-two classes in fourteen files, and forgetting one is silent.
* **In place.** Rebinding the module global would work for the app —
  `get_daily_completion_repo` reads it on every call — but **eight test modules
  import these singletons at module scope**. Those names would go on pointing
  at the old object, so a test would inspect one store while the app wrote to
  another, and its assertions would quietly stop meaning anything.

Discovered by the `_memory_` prefix rather than from a list, so a new domain is
covered the day it is wired. All twenty-two take no constructor arguments.

What was NOT done, because the brief named each one: no date window was
widened, no duplicate-attempt protection was weakened, no reset endpoint was
added to the product, nothing was made environment-dependent, and no unique
value was randomised to paper over leakage. State shared **within** one test is
untouched — the reset runs once before the test function and once after it.

## The 82-0 reconciliation, and one thing it was getting wrong

`docs/implementation/PEAK_SEASON_81_1_RECONCILIATION.md` is the exact command
sequence, expected output, idempotency behaviour and verification queries for
game `e564b8d3-4c1f-4d09-8f8c-16e83ecd1104`. **Nothing in it has been run.**

Writing it surfaced a defect. `PerfectSeasonRun.created_at` defaults to
`datetime.now(timezone.utc)` — right for a live submission, where the run
genuinely was just completed, and wrong for every row a backfill writes.
`build_run` did not pass the field, so a months-old 81-1 would have been
stamped with the clock of whoever ran the script. That matters because
`list_runs` orders by

```
wins DESC, lineup_score DESC, (team_respins_used + season_respins_used) ASC, created_at ASC
```

and pages on the same tuple, so `created_at` is the final tie-break and the
only field on the row that says when any of this happened. It now carries
`games.updated_at` — the completion timestamp, because `action_complete_game`
is the write that produced the `simulation_result` the row is derived from —
falling back to now only when the row has no timestamp at all.

## Configuration, written down once

`docs/implementation/RESCUE_CONFIGURATION_MATRIX.md` gives local, Railway
staging and Vercel staging: exact variable names, exact values, the file or
service that owns each, whether a restart or a rebuild is required, and whether
each is safe locally, on staging, or both. Derived from `config.py`,
`supabase/config.ts`, `Dockerfile`, `railway.toml` and `scripts/ci/*.sh` rather
than from earlier documentation. **No hosted setting was changed.**

The two rules that explain most of the matrix:

* **API** — `Settings` is constructed once at import, so every `PEAK3_*` value
  is read at process start: a change is a **restart**, never a rebuild. The
  exception is anything that changed what went *into* the image (the generated
  dataset and the fact bank are produced by the Docker build).
* **Web** — `NEXT_PUBLIC_*` is inlined at build time, so a change on Vercel is
  a **redeploy**. Restarting nothing helps: the old value is already compiled
  into the JavaScript that was served.

And one consequence worth stating on its own: **there is no frontend Arena
flag.** `apps/web` renders whatever `GET /api/v1/arena/readiness` reports, so
opening the closed alpha is entirely a Railway change and needs no Vercel
redeploy. The same is true of the 82-0 board.

## One defect the frames found, and fixed

| Frame | Defect | Fix |
|---|---|---|
| `fotd-*-12-womens`, both themes | A two-line `feature_label` — "STRAIGHT TITLES, FROM THE START" — was read through the court motif's densest region: the top edge of the key, and the arc crossing it, at exactly that height. 9px uppercase at 0.12em tracking in `--text-muted`. A one-line label ("FIRST-PLACE VOTES") cleared it, which is why five passes of frames had not shown it. | The motif is masked to a quarter strength below 58% of its own height. A mask rather than a smaller motif or a shorter label: the composition is a number standing on a court, and cropping the court to avoid the text would lose the thing the frame is for. The baseline and the key are still there. |

## Fifth pass — validation

| Gate | Command | Result |
|---|---|---|
| Model tests | `scripts/ci/model-tests.sh` | **1456 passed, 1 xfailed** |
| Fact bank + deployment | `pytest tests/test_nba_facts.py tests/test_nba_facts_deployment.py` | **78 passed** (63 + 15; six new coverage tests, two new rotation tests) |
| API unit suite, run 1 | `scripts/ci/api-unit-tests.sh` | **1629 passed, 2 skipped, 13 deselected** (3:45) |
| API unit suite, run 2 | `scripts/ci/api-unit-tests.sh` | **1629 passed, 2 skipped, 13 deselected** (3:49) |
| API unit suite, run 3 | `scripts/ci/api-unit-tests.sh` | **1629 passed, 2 skipped, 13 deselected** (3:40) |
| Frontend typecheck + lint + unit + build | `scripts/ci/frontend-verify.sh` | ✓ verified (run again after the CSS fix) |
| Homepage fact, browser + axe | `scripts/ci/e2e-tests.sh --grep "NBA Fact of the Day"` | **7 passed**, including `has no serious accessibility violations` and the mobile scroll-trap probe |
| Generator determinism | `build_nba_facts.py` twice | bank and report **byte-identical** |
| Dataset mutation | `build_web_dataset.py`, diffed against the pre-pass copy | `leaderboards`, `methodology`, `peak_windows`, `nba_facts.v1` **unchanged**; `metadata` differs only in `generated_at` and `source_commit` |
| Whitespace | `git diff --check` | clean |
| Review capture | `playwright test --config=playwright.rescue-shots.config.ts --grep "NBA Fact of the Day"` | **42 frames**: 20 dark, 20 light, 2 mobile — one per semantic area plus five second draws |

Three consecutive API runs, each from a clean process, with **identical
counts**. The three runs are the point: the failure being fixed appeared only
in a full-suite run and only because of what ran before it, so one green run
proves nothing that a re-ordering could not undo.

### What the frames showed, area by area

Every one of the fifteen semantic areas produced a card in both themes, and the
driver asserts each frame's `data-category` matches what it asked for, so a
filename cannot disagree with its contents. Read individually: the current-NBA
cards carry a "RIGHT NOW" chip and an expiry behind it; the global cards carry
both a place chip and an era chip; no card renders a table, a `<details>`, or a
source row; every card has a focal point; and the mobile frames put the motif
above the copy rather than beside it, with `maxScrollX` of 0.

### Fifth pass — status

| Item | Status |
|---|---|
| Semantic coverage rebalanced | **done** — 228 facts, every target met, four shortfalls closed |
| API test isolation | **done** — fixed in the fixtures, three identical clean runs |
| Configuration matrix | **done** — `docs/implementation/RESCUE_CONFIGURATION_MATRIX.md` |
| 81-1 reconciliation runbook | **done** — `docs/implementation/PEAK_SEASON_81_1_RECONCILIATION.md`, **not run** |
| Validation and handoff | **done** |

Nothing was pushed, no PR was opened, nothing was deployed, no commit was
squashed, `main` was not modified, no hosted setting was changed, and
reconciliation was not run.
