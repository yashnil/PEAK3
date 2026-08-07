# PEAK3 Production Gameplay + Visual Polish — Requirement Tracker

**Spec:** [`peak3-gameplay-ux-production-polish.md`](./peak3-gameplay-ux-production-polish.md)
**Branch:** `fix/gameplay-ux-production-polish`
**Status legend:** TODO · IN PROGRESS · VERIFIED · BLOCKED

Every requirement ID in the spec appears below. A row may only move to **VERIFIED**
after (1) root cause identified, (2) durable fix implemented, (3) regression coverage
added, (4) behavior observed in a real browser where applicable.

---

## Shared foundations (spec §5)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| SHARED-01 | One competitive timing model (reveal phase, action freeze, no overlapping timers, server-authoritative) | IN PROGRESS | **TMW:** `WeaveSpinner.tsx:88-100` runs a client `setTimeout` of `CEREMONY_MS=2270` and gates the pick overlay on it, while the server's 45s deadline was stamped when the turn opened — the human loses ~2.3s + one poll of a clock already running. **S20:** `submit()` never touches `deadlineAt`, so the countdown runs behind a pending request. | TMW + S20 workstreams | |
| SHARED-02 | Clear pending-action state + single in-flight request + server idempotency | IN PROGRESS | S20 client reuses one `pendingKey` across *different intents* and clears it only on success (`TwentyDollarGame.tsx:169,197-206`), so a retry after a dropped response replays the old verdict — and `if (!accepted && !replayed)` then swallows it silently. TMW already derives its key correctly. | S20 workstream | |
| SHARED-03 | Shared player headshot/avatar primitive reused from 82–0 | IN PROGRESS | One primitive already existed (`components/court/PlayerAvatar.tsx`) but TMW, S20 and the homepage rendered no avatar at all. | `PlayerAvatar.tsx` — added `alt` override, `loading="lazy"`, `decoding="async"`; documented that the medallion is the *shipping* path | See the imagery caveat below |
| SHARED-04 | Stronger interactive affordances (buttons, disabled, focus-visible, touch targets) | IN PROGRESS | No `Button` component exists; 78 inline `background: var(--peak-accent…)` across 52 files. The Showdown's submit-bid — the mode's single most important control — is `background: transparent` (`twenty-dollar.css:224-240`), weaker than post-game nav. `.arena-inline-link` declares no `color` at all. | Per-workstream | |
| SHARED-05 | Remove low-value faint microcopy (Rankings exempt) | IN PROGRESS | `--text-secondary` and `--text-muted` measured **1.12:1 apart in dark, 1.26:1 in light** — 1,056 combined uses rendering as one grey. A two-tier hierarchy cannot be edited into existence while the tiers are identical. | `globals.css` — tiers widened to 9.1:1 / 5.7:1 (dark) and 9.1:1 / 5.6:1 (light) | |

## Three-Man Weave (spec §6)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| TMW-01 | Timeout must never reward inactivity; deterministic legal non-exploitable fallback | **VERIFIED** (code) | `autopick.auto_pick` ranked by scoring card and took the **top** option, and `PickOverlay` advertised it: "Timeout drafts the best available player for you." Doing nothing was never worse than playing. | `nba_peak/three_man_weave/autopick.py` — draws from the lower-value half of the legal completability-preserving pool via the turn's existing seeded RNG; lowest legal option when nothing preserves completability | `tests/three_man_weave/test_autopick.py` — never picks the best, never above the median, 60-state property test that the giveaway is always >0 and averages >5 pts, and stability across recomputation. UI copy owned by the TMW workstream. |
| TMW-02 | Strict per-season position legality; no transitive illegal placement | **VERIFIED** (code) | Legality itself was sound; the **input grain** was wrong. `career_positions` unions every position across a whole career, so Westbrook's single 2025-26 SAC season listed `SF` (of eighteen; the other seventeen are `PG`) made small forward legal for him on a 2010s Thunder roster. A class of defect, not one player. | Season-anchored rights `({listed} ∪ career) ∩ band(listed)`, band = ±1 on PG-SG-SF-PF-C. `positions.py`, `career_positions.py` (`listed_position`), `eligibility.py` (`card_slot_rights`, `potential_slot_rights`, `rights_for_cards`), threaded as an explicit `SlotRights` through `arrangement/feasibility/draft/autopick/evaluation/mode` | `tests/three_man_weave/test_position_seasons.py` (19 tests) incl. the property that every starter in a played match stands where their own card allows. Verified: Westbrook OKC/LAL/HOU cards → `{PG}`; SAC 2025-26 → `{SF}`; Rodman SAS 1990s → `{SF,PF,C}`; Shaq → `{C}` |
| TMW-03 | Complete franchise×decade candidate pools + audit doc | IN PROGRESS | **The premise was wrong.** Rodman IS in the SAS×1990s pool (32 identities, card `1994-95 SAS`, prime 52.19); `franchise_for_team_code("SAS")=="SAS"`, `decade_label(1993)=="1990s"`, both Spurs seasons scored. The user-visible defect is `PickOverlay.tsx:399-403`, whose empty state says "No eligible player matches that search" for three different facts: already drafted (the lock is **global across all rolls**), hidden by an active position filter, or genuinely ineligible. | Audit script + doc (own workstream); empty-state fix (TMW workstream) | |
| TMW-04 | Bot choice quality (strong/near-optimal, seeded sims) | **VERIFIED** (measured) | No defect found — the bots are already strong. The earlier "bots pass obvious elite choices" complaint does not reproduce. | No policy change made. Tuning a policy that measures this well would be changing scoring to chase a feeling. | `tests/three_man_weave/test_bot_simulation.py`, 120 seeded matches / 2,160 picks: **optimal 95.79%**, near-optimal 100%, mean utility regret 0.0025 (p95 0.0), mean quality regret **0.91 PEAK3 pts** (p95 6.61, max 11.83), **0 dominance violations, 0 illegal picks, 0 completion failures, 0 catastrophic deviations**. One latent modelling wart recorded as EXTRA-06 rather than tuned blind. |
| TMW-05 | Bot think time 4–10s, visible, real scheduled phase | **VERIFIED** | `BOT_THINK_SECONDS_MIN/MAX` were 1.0/5.0, and the client polls every 2s, so a 1s draw was invisible. | `nba_peak/three_man_weave/config.py` → 4.0/10.0 (the foundation already clamps a mode hook at 10.0). Bot clock counts **up**, because the server sends `seconds_remaining: null` for a seat that is not yours and inventing a bot deadline would be a fiction. | The old assertion was `MIN <= v <= MAX`, true for every window including the broken one; it now pins the literals. |
| TMW-06 | Spinner/reveal becomes a full-focus game moment | **VERIFIED** | See SHARED-01 — the ceremony was a 2,270ms client `setTimeout` running against an already-started server deadline. | Full-focus reveal over dimmed rosters, mounted **only while no human decision window is open**, derived from server turn state each render. | Frames `tmw-intro-*`, `tmw-room-*` opened. Reviewer note: the scrim is darker than TMW-06's "dimmed/blurred" — logged, not blocking. |
| TMW-07 | One turn-status surface, not three stacked rows | **VERIFIED** | Spinner banner + "X is selecting" + "X is scouting/drafted" were three surfaces for one fact. | `BotPickReveal` and the bands deleted; one `TurnStatus` region. Also fixed a latent bug inherited from `BotPickReveal`: its reveal effect keyed on the pick-feed array, so the dismissal timer was cleared each render and never re-armed — a revealed pick could stick for the whole match. | `tmw-room-d900` opened. |
| TMW-08 | Remove Draft order · snake strip | **VERIFIED** | — | `DraftOrderStrip.tsx` deleted. | `arena-multiplayer.spec.ts` updated from `tmw-draft-order` to `tmw-turnbar`. |
| TMW-09 | Improve three-roster composition (desktop + mobile) | **VERIFIED** | All three seats used one gold accent; `data-is-you` was emitted with zero CSS rules. | Per-seat accents, layered surfaces, court art as texture, bench attached, room constrained to 82rem, tabs below 760px. | `tmw-room-full-m844` opened — stacks cleanly, no horizontal overflow. |
| TMW-10 | Manual roster rearrangement during normal gameplay (drag + click + keyboard) | **VERIFIED** | Rearrangement existed only inside the pick modal. Separately, `moveDestinations` validated only the dragged player, so it offered destinations the server then refused. | Drag + click + keyboard between turns via `tmw_rearrange` (consumes no turn, restored on refresh); `moveRejection()` checks **both halves** of a swap. | Unit tests; browser frames. |
| TMW-11 | Player-selection panel refinement | **VERIFIED** | `onExpire` was never wired, so the panel stayed interactive at 0s and a click landed outside the 2s grace as `stale_state_version`. Timeout copy promised "the best available player". | `onExpire` wired to a locked resolution state; copy authored once as `TMW_TIMEOUT_CONSEQUENCE`; headshots on candidate rows. | `tmw-room-d900` shows the corrected consequence line. |
| TMW-12 | Off the Board becomes compact activity history | **VERIFIED** | The off-the-board ledger grew without bound. | 4-item recent-picks rail + `View draft history` disclosure. | `tmw-room-full-m844`. |
| TMW-13 | Game opening sequence (competitive intro) | **VERIFIED** | Launching dropped the player straight into a timer. | Round-1 ceremony opens on the matchup: title, three competitors, human marked, bot personas, objective in one line. | `tmw-intro-d700` opened. |
| TMW-14 | Results screen full redesign | **VERIFIED** | The result read as an analytics report. | Removed the basis paragraph, decisive pick, best value, positional fit, mean-season line and the duplicate roster disclosure; placement badge + deterministic response line keyed to placement **and** margin; three ranking cards each carrying that team's full six-slot roster; receipt behind a disclosure. | Unit tests. **Not captured in the browser** — see the matrix note. |
| TMW-15 | Result and match visual verification matrix | PARTIAL | — | — | 11 of 13 Weave/Showdown matrix rows captured and opened. The two result screens and the reconnect recap need a match driven to completion; called out rather than omitted. |

## The $20 Showdown (spec §7)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| S20-01 | Pre-match competitive intro | **VERIFIED** | Launching started a decision clock immediately. | `MatchIntro` overlay with the board mounted underneath; dialog role, autofocus, Escape. | `s20-intro-d900` opened. **Defect found and fixed there**: the numeral column was a fixed 2.6rem, which fits "5" and not "$20", so the first rule rendered as "$20ach, for the whole auction". |
| S20-02 | Player/lot reveal before human timer | **VERIFIED** | No read beat before the clock. | ~1.1s reveal, budget-clamped so it can never cut a decision below 18s. | `s20-auction-d900` at 1.6s shows the beat holding the clock; at 4.2s shows `TIME REMAINING · 23 seconds`. |
| S20-03 | Unmistakable active-seat highlighting | **VERIFIED** | A small "YOUR MOVE" pill. | Turn banner + per-seat rails/fills from `--seat-a/b-*` + "On the clock" in text. | Frames opened; seat identity readable at a glance. |
| S20-04 | Redesigned auction decision surface / hierarchy | **VERIFIED** | Small labels and a row of micro-chips. | Identity → **CURRENT BID as a large numeral** → leader → last action → clock → controls; `LotTicker` chips deleted, full walk-up in an expandable log. | `s20-auction-d900` opened — the hierarchy is the page. |
| S20-05 | Better bid controls | **VERIFIED** | The submit-bid control was `background: transparent`, weaker than the post-game nav buttons, and 1.5:1 in light mode. | Filled primary carrying its own amount ("Raise to $2", "Open at $1"); `totalSeconds` corrected from a hardcoded 20 to the real 25. | Frames opened. |
| S20-06 | Skips remaining is a first-class number | **VERIFIED** | Skips were tiny grey text inside a button label, with "— free" appended to Pass. | Three stats of equal rank per seat: money / roster / **skips**. The decline is named (`Market skip` / `Pass on this lot` / `Concede the lot`). | `s20-auction-d900` shows 5 vs 4 skips and the correct sentence for each decline. |
| S20-07 | Correct skip accounting semantics (market_skip / follow_pass / auction_pass) | **VERIFIED** (code) | `pass_consumes_skip` tested only "no standing bid / candidate fits me / roster incomplete". After the first seat passed, `high_bidder` was still None and `current_bid` still 0, so the **second** seat's decline re-satisfied every condition and was charged identically. One dead candidate burned 2 of a match's 10 tokens, and a player who happened to act second five times hit `REJECT_NO_MARKET_SKIPS` and was forced to open bidding on players they did not want. | `nba_peak/twenty_dollar/state.py` — fourth condition `lot_has_prior_rejection()` (read from `lot_actions`, so an automatic pre-pass is *not* a rejection to follow), plus `pass_kind()` naming the three declines and `pass_kind`/`lot_already_rejected` in the projection | `tests/twenty_dollar/test_skip_semantics.py` (9 tests) covering all four spec cases + the out-of-skips forcing bug in both directions + replay safety. The 480-match timeout audit now reaches `free_pass` 60×; that branch was previously "structurally unreachable" and its test was rewritten to encode the new contract. |
| S20-08 | Stop the human timer immediately on click | **VERIFIED** | `submit()` never touched `deadlineAt`; `ArenaTimer` keys only on it. A bid inside the 2s server grace — designed to be accepted — rendered "Time expired". | The clock takes `null` while a submit is in flight; `onExpire` cannot fire; the submitted action is shown. | Unit tests + `s20-pending-*` frames. |
| S20-09 | Inter-turn breathing room | **VERIFIED** | — | 700ms handoff beat on each in-lot action. | Unit tests. |
| S20-10 | Fix "While you were away" at the state-machine level | IN PROGRESS | **Not a reconnect bug.** Three verified mechanisms: (1) `state.py:580-587` — `_advance_lot` can `_resolve_lot` the lot it just created and `_resolve_lot` recurses back into `_advance_lot`, so **one accepted command settles 2+ lots**; the client sees `unseen.length > 1` and shows the catch-up banner *while the user is watching*, replacing the `LotReveal` payoff card. (2) **Sticky** — `LotLedger.tsx:299` self-acknowledges only at `unseen.length === 1`, so one undismissed gap freezes the cursor for the rest of the match and the reveal card never returns. (3) Blocked localStorage pins the cursor at `-1` forever, so the whole history reads as missed. **Explicitly cleared:** the sweep *cannot* manufacture an already-expired human turn — `mode.py:274` always uses `data.now + TURN_SECONDS`, `clock.enforce` fires ≤1 timeout per call, and `drive_pending_bots` freezes `now` against the stored `opened_at`, so ≤1 bot command runs per request. | S20 workstream | |
| S20-11 | Reconnect / reload / two-tab correctness matrix | **VERIFIED** (code) | No `visibilitychange`/`focus` re-poll anywhere in the mode; the poll interval was torn down and recreated on every response because `view` was an effect dependency. | Re-poll on visibility and focus; interval no longer keyed on `view`; cursor is monotonic and falls back to an in-memory store when storage throws. | Reconnect unit suite rewritten to the new contract. **Not exercised in a real two-tab browser** — remaining gap. |
| S20-12 | Errors become actionable product states | **VERIFIED** | Two `apiError.message` branches rendered backend prose verbatim; a malformed detail could surface as literally `"HTTP 500"`; six codes had no mapping, including `ruleset_version_mismatch` whose server text is an engineering string. | One-code prose allowlist; written copy for everything else; the HTTP layer that bypassed the mapper is covered; unknown failures get a retry state. | `arena-rejection.test.ts` extended. |
| S20-13 | Bot auction quality audit | **VERIFIED** (measured) | No defect found. The valuation is coherent: tier→marginal value, scarcity ×(1+0.30/usable slots), urgency ×(1+0.18·filled), last slot = full legal ceiling, closeout ×1.35, uncontested ×0.6, seeded jitter 0.88–1.12, a per-slot reserve, and minimum-increment raises only. It never sees a hidden score — only the coarse three-band draw tier, and only for bot seats. | No policy change. | `tests/twenty_dollar/test_bot_calibration.py`, **2,000 bot-vs-bot matches**: completion **100%**, 0 illegal actions, 0 timeouts, 0 cap violations, 1 extreme overpayment. Prices scale with tier — $3.84 mean for a top-100 peak (max $14), $1.99 for 101–250, $1.11 for 251–500. Mean spend $14.02 of $20, mean skips used 1.18 of 5, final roster score mean 325.3 (sd 28.4). |
| S20-14 | Roster/sidebar redesign | **VERIFIED** | Side columns were 15rem — ordinary names wrapped to three lines. | 17.5/19.5rem tracks, fixed-grid rows with `PlayerAvatar`, name over season, price. | Frames opened. |
| S20-15 | Results screen full redesign | **VERIFIED** (code) | Two text rosters, three small callouts, large dead space. | WON/LOST hero (the word, not the colour), margin, deterministic response line, head-to-head bar, two rich team cards, three callout cards, receipt behind a disclosure, three real buttons. | Unit tests. **Not captured in the browser** — see the matrix note. |
| S20-16 | Visual/browser verification matrix | PARTIAL | — | — | Intro / unopened / live / pending captured at all five matrix cells and opened. Reconnect recap and result not captured. |

## Daily Grid (spec §8)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| DG-01 | Remove redundant textual best-grid list | **VERIFIED** | The nine-line list and the 3×3 said the same nine things; both files admitted it in their own comments. | List, expand toggle and per-cell rows deleted; the 3×3 absorbed the one fact it uniquely carried (the overlap note). | `daily-grid-components.test.tsx` rewritten to assert absence; e2e updated. |
| DG-02 | Add player headshots to optimal grid | **VERIFIED** | — | `PlayerAvatar` at 28px, stacking above the name below `sm`; no new component, no new fetcher, no wire change. | Owning workstream measured 390 and 1280 in both themes: nine avatars, zero `<img>` (medallion path), grid overflow −26px, page overflow 0. |
| DG-03 | Preserve scoring semantics | **VERIFIED** | — | Nothing touched in puzzle, scoring, best-legal-grid, points-left or streak logic. | Model + API Daily Grid suites green. |

## Homepage + Fact of the Day (spec §9)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| HOME-01 | Fact of the Day must teach something worth returning for | **VERIFIED** | 16 published facts asserted who "was not the best player on the team" — a PEAK3 model judgment (`title_team_role`) printed as unqualified fact and sourced to Basketball-Reference. | Both generators deleted rather than reworded; two editorial entries rewritten; mundane roster-tenure families re-scored below the publication floor. | Verified directly: 0 "best player on the team" facts and 0 JaVale McGee facts remain in the built bank. |
| HOME-02 | Homepage-quality tier / suitability gate | **VERIFIED** | The gate scored per GENERATOR, so every fact a template emitted scored identically and cleared every floor forever. | `featured.py`: 93 featured of 187; max 3 per template (bank allows 8), each from a different era group; derived held to a higher total than editorial; ordered by the per-fact magnitude the gate never read. | Verified directly: 93 ids, 79 editorial / 14 derived, 19 categories; rotation serves only the tier; all 10 perishable featured facts carry an expiry. |
| HOME-03 | Redesign the fact card | **VERIFIED** | Flat card, mandatory "See their PEAK3 profile", the card's only control 0.6875rem grey. | Category accent + motif + large hook + strong headline + one line; profile link removed by default and made a real control where it survives. | `home-fact-l900` / `-m844` opened. **Defect found and fixed** → EXTRA-09. |

## Global visual system (spec §10)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| VIS-01 | Preserve Rankings component bars (protected) | IN PROGRESS | — | Nothing under `components/rankings/**`, `styles/rankings.css`, `lib/utils.ts::componentColor` or the `--comp-*` fill/text pairs was touched. The bar is inline-styled (`ComponentBreakdown.tsx:161,192-199`) and reads no token I changed except the shared text/border/surface tiers. | Needs the browser regression check in the matrix |
| VIS-02 | Typography refresh | IN PROGRESS | **`--font-display` was referenced in 11 rules across four partials and never defined**, so every "display" game heading silently fell back to Inter and Syne — which *is* loaded — reached only the `.font-display` class. `--font-mono` and `--peak-accent-on` were likewise undefined; `three-man-weave.css:287` writes `color: var(--peak-accent-on)` with no fallback, an invalid declaration. | `globals.css` — all three defined; `.pk-numeral`/`.score-number` consolidate the 36 hand-rolled `font-variant-numeric` rules | |
| VIS-03 | Richer dark palette | IN PROGRESS | `--border-subtle` measured **1.056:1** against `--bg-surface` and is the most-used card edge in the app (55 rules). `--focus-ring` measured 3.65:1. All three TMW seats and both S20 seats shared one gold; `data-is-you` was emitted with zero CSS attached. | `globals.css` — border raised to 1.37:1, new `--border-edge` at 3.0:1, focus ring to ~6:1, and three-seat / two-seat accent families derived from the approved component hues | |
| VIS-04 | First-class light palette | IN PROGRESS | Light `--bg-elevated` vs `--bg-surface` measured **1.074:1** — three declared elevation tiers reading as one material, which is why Arena Day looks washed out. | `globals.css` — recessed goes darker than the page, raised lighter; raised↔page now 1.23:1. Seat inks re-derived per theme with fills held stable | |
| VIS-05 | Shared surfaces / primitives | IN PROGRESS | 92 distinct CSS rules define their own card (background + 1px border + radius); 26 distinct radius values; 25 distinct shadows. `.card-surface`/`.card-elevated` exist but are used in only 10 and 12 files. | Per-workstream | |
| VIS-06 | Color communicates hierarchy (never color alone) | IN PROGRESS | | Seat accents + per-workstream | |
| VIS-07 | Animation language + reduced motion | IN PROGRESS | The global blanket sets `animation-duration: .01ms` but **never neutralised `html { scroll-behavior: smooth }`**, so reduced-motion users still got animated scrolling. Eight `motion/react` files write inline transforms the blanket cannot reach — the entire `components/game/` duel surface among them — while `/accessibility` claims full coverage. | `globals.css` — `scroll-behavior: auto !important` added to the reduced-motion block. The unguarded `motion/react` files are logged as EXTRA-01 below. | |
| VIS-08 | Site-wide smoke audit without destabilizing other games | PARTIAL | — | — | Homepage, Arena, Rankings, Three-Man Weave, $20 Showdown and the Daily Grid result reviewed. Run the Table, 82–0, Peak Duel and the Methodology shell inherit the token changes but were not individually re-reviewed. |

## Cross-cutting (spec §11–§12)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| ACC-01 | Accessibility + responsive requirements on all touched surfaces | **VERIFIED** (code) / PARTIAL (browser) | The global reduced-motion blanket never neutralised `scroll-behavior: smooth`. | Fixed globally. Per-mode: keyboard equivalents for every drag, Escape, one `aria-live` per room for turn changes only, focus-visible strengthened to ~6:1. | Rankings + theme e2e (61 tests) include axe and pass. Eight `motion/react` files outside the target games remain unguarded → EXTRA-01. |
| PERF-01 | No performance regression (layout shift, image storms, interval leaks, timer-tick rerenders) | **VERIFIED** (code) | — | `PlayerAvatar` reserves its box in both branches and lazy-loads; the Showdown poll interval no longer rebuilds on every response; the countdown stays isolated so a tick does not re-render the room. | Production build clean. No profiling run — stated rather than claimed. |

---

## Proactive defects found during this pass (spec §16)

Issues discovered while inspecting these surfaces that were not named by the user.
Each gets an ID `EXTRA-nn` and must be fixed or explicitly deferred with a reason.

| ID | Surface | Defect | Status | Notes |
|---|---|---|---|---|
| EXTRA-01 | Shared / reduced motion | Eight `motion/react` files animate with no `useReducedMotion` guard — the whole `components/game/` duel surface (`duel-card.tsx:51` `whileTap`, `game-engine.tsx`, `reveal-panel.tsx`, `component-comparison.tsx`), `methodology/page.tsx`, and three Run the Table components. They write inline transforms, which the global CSS blanket cannot reach. `/accessibility` claims full coverage. | OPEN | Outside the two target games, so fixing it means touching Peak Duel and RTT — deliberately deferred unless the adversarial pass says otherwise. Logged because the accessibility page currently overstates the guarantee. |
| EXTRA-02 | `globals.css` | `html { scroll-behavior: smooth }` was never neutralised under `prefers-reduced-motion`. | **FIXED** | `scroll-behavior: auto !important` added to the reduced-motion block. |
| EXTRA-03 | `nba_peak/nba_facts/awards.py` | `gen_finals_mvp_not_best_player` and `gen_champion_role_players` (16 published facts) branch on `title_team_role`, a weighted z-score composite computed **in this repo** (`nba_peak/context/title_role.py`, `CO_BEST_GAP=0.60`). So "was not the best player on the team" is a PEAK3 model judgment printed as unqualified fact and sourced to Basketball-Reference. This contradicts the card's own stated rule. The guard test greps only `nba_facts/__init__.py` for two literal strings and never sees `awards.py`. | IN PROGRESS | Fact-bank workstream: generators removed, guard test widened to every module. |
| EXTRA-04 | `apps/web/src/lib/twenty-dollar-seen.ts` + `LotLedger.tsx` | Docstrings assert that up to twelve bot turns can run inside one request. Verified false: `drive_pending_bots` freezes `now` and compares it against the stored `opened_at`, so at most one bot command executes per HTTP request. | IN PROGRESS | S20 workstream: correct the comments rather than leave a false rationale in place. |
| EXTRA-05 | `apps/api/app/services/arena/clock.py` | `sweep_mode` is dead code (no caller anywhere), and its memory-repo feeder `arena_memory.py:469-484` calls `is_overdue_at(now)` **without** the grace argument, disagreeing with `enforce`. Latent if it is ever wired up. | OPEN | Not reachable today; recorded rather than fixed speculatively. |
| EXTRA-08 | `$20 Showdown` auction stage | Found by opening `s20-auction-d900`: the `CURRENT BID` slot renders a small grey rounded bar in the no-bid state, directly under the label. On a fully-loaded panel it reads as a loading skeleton. | OPEN | Handed to the Showdown workstream; cosmetic, on the mode's focal element. |
| EXTRA-09 | Fact of the Day card | Found by opening `home-fact-l900`: `feature` is not always a numeral — across the featured tier it runs from `"3"` to `"31 October 1950"` (15 chars) — and at display size a long one overflowed a panel with `overflow: hidden`, so the Jordan-shoes fact rendered as **"anne"**. First fix (`overflow-wrap: anywhere`) then broke "Banned" mid-word as "Bann / ed". | **FIXED** | Length bands measured in the component (CSS cannot ask how long a text node is) drive three size steps; `break-word` replaces `anywhere` so a word only splits when it genuinely cannot fit. Re-captured and re-inspected in both themes. |
| EXTRA-07 | Arena entry (`styles/home.css`, `GameCard`) | Found by opening `arena-dark`: the flagship card's primary action was the 11px uppercase text link "START A RUN →" whose only affordance was a hover underline, and `.arena-inline-link` declared **no `color` at all**, so "Start a standard run" / "Resume a saved run" were indistinguishable from body text until hovered. This is the surface both target games launch from. | **FIXED** | `.pk-game-card-action` is now a real pill — filled gold on the featured card (ink 11.25:1), outlined elsewhere; secondary links are underlined and coloured at rest. Re-captured and re-inspected. |
| EXTRA-06 | `nba_peak/three_man_weave/bot.py` | `_slot_supply` (`:337-345`) counts only `direct_slots` and initialises only for open slots, so a `FITS_AFTER_REARRANGEMENT` option whose landing slot is not open falls to the `.get(slot, 1)` default and receives the **maximum** scarcity bonus, partly cancelling the intended `-0.08` rearrangement penalty. Also `:294` mixes a per-slot alternative with a roll-wide floor, making `replacement_gap` non-comparable across slots. | OPEN | TMW-04 asks for a bot-quality audit; the seeded simulation currently reports 0 illegal picks, 0 completion failures, 0 dominance violations. Recorded for the audit rather than tuned blind. |

---

## Standing constraint: player imagery (SHARED-03)

The spec asks for headshots "wherever the existing asset source supports them".
Measured, the existing source supports very few, and it is not currently allowed
to be used at all:

- `data/game/assets/player_assets.v3.json` resolves **526 of 3,432** eligible
  identities (15.3%); **66 of the canonical 250** (26.4%).
- Resolution requires a *current* ESPN roster entry, so historical players are
  essentially uncovered. Jordan, Magic, Bird, Kareem, Kobe, Duncan, Hakeem,
  Barkley, Dirk, Garnett and Wade are all `unresolved`; Wilt, Russell, Shaq,
  Oscar Robertson and Jerry West are **absent from the manifest entirely**.
- Every one of the 534 resolved entries carries
  `license_status: "unknown_do_not_cache"` and
  `cache_policy: "dev_hotlink_preview_only"`, and the API gate
  `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` (`apps/api/app/core/config.py:209`)
  defaults **off** because nobody has reviewed ESPN's terms for hotlinking in a
  shipped product.

So in production today 82–0 renders initials for 100% of players, and so will
every surface this pass touches. Flipping that flag is a licensing decision, not
an implementation one, and this pass does not make it.

What is delivered instead: one shared primitive (`components/court/PlayerAvatar.tsx`),
used by every touched roster surface, that renders a *designed* medallion — a
tinted radial gradient with the player's initials — reserves its exact box so a
failed or absent image causes no layout shift, lazy-loads, and renders a real
headshot the moment the payload carries one. The medallion is treated as the
shipping path rather than the error path.

---

## Browser review matrix (spec §15)

Every cell requires: capture → **open and visually inspect the image** → one-sentence
judgement recorded here → fix → recapture.

Captured by `npx playwright test --config=playwright.polish-shots.config.ts`
(from `apps/web`), written to the gitignored
`docs/implementation/gameplay-polish-review/` with a content-hashed manifest so
two filenames cannot silently be one screen. ✓ = captured **and opened**.

| Surface | 1440×900 dark | 1440×900 light | 1440×700 dark | 390×844 dark | 390×844 light |
|---|---|---|---|---|---|
| TMW intro (ceremony) | ✓ | ✓ | ✓ | ✓ | ✓ |
| TMW room / turn status | ✓ | ✓ | ✓ | ✓ | ✓ |
| TMW user pick | ✓ | ✓ | ✓ | ✓ | ✓ |
| TMW result | ☐ | ☐ | ☐ | ☐ | ☐ |
| S20 intro | ✓ | ✓ | ✓ | ✓ | ✓ |
| S20 unopened lot | ✓ | ✓ | ✓ | ✓ | ✓ |
| S20 auction live | ✓ | ✓ | ✓ | ✓ | ✓ |
| S20 bid pending | ✓ | ✓ | ✓ | ☐ | ☐ |
| S20 reconnect recap | ☐ | — | ☐ | ☐ | — |
| S20 result | ☐ | ☐ | ☐ | ☐ | ☐ |
| Daily result | ☐ | ☐ | — | ☐ | ☐ |
| Homepage fact | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rankings (regression check) | ✓ | ✓ | — | — | — |

**Not yet captured, and why:** the two result screens and the reconnect recap
need a match driven to completion (18 Weave picks / up to 36 auction lots) or a
deliberately backgrounded tab. The capture tool starts a match and shoots the
live surfaces; driving a full match is the remaining work on this matrix and is
called out in the closure report rather than quietly omitted. Daily Grid's
result was verified by its owning workstream in a real browser at 390 and 1280
in both themes (nine avatars, zero `<img>`, grid overflow −26px, page overflow
0) but is not in this sheet.

### Visual review notes

_(one sentence per reviewed frame — hierarchy / readability judgement)_

**Token-layer verification pass (1440×900, both themes, dev server), opened and inspected:**

- `rankings-light` — **Protected surface intact.** All five component text colours
  (SI blue, TP violet, REC pink, PO orange, TEAM green) render at full saturation
  against the warmer raised surface, the numeric columns stay aligned, and the row
  separators are now visible where the old `--border-subtle` was not. No bar
  geometry, colour or ordering changed.
- `home-light` — The hero reads as designed rather than washed out: the Syne
  display face now actually renders (it did not before), the elevated player card
  separates cleanly from the canvas, and the component bars are the strongest
  element on the page. The primary CTA is a real filled gold button.
- `arena-dark` — Display headings ("Arena", "RUN THE TABLE", "82-0 Peak Season")
  now render in Syne; card edges are visible; the two-tier text hierarchy reads as
  two tiers for the first time. **Defect found → EXTRA-07.**
- `arena-light` (recapture) — `START A RUN →` is now an unmistakable filled gold
  pill and the two secondary links are underlined and coloured at rest. The
  primary/secondary hierarchy survives a first glance.

**Gameplay capture sheet, opened and judged:**

- `s20-auction-d900` — The hierarchy the spec asked for is now the page: player
  identity, then `CURRENT BID` as a large gold numeral, then "PEAK3 Bot leads",
  then "PEAK3 Bot opened at $1", then the clock, then the controls. The CTA
  carries its own amount ("Raise to $2", "Open at $1" filled gold). Skips sit at
  equal rank with money and roster on both seat cards. **The skip-semantics fix
  is visible end to end**: "The other seat has already declined this lot, so this
  costs you no market skip", with the bot at 4 skips and the human at 5.
  **Defect found → EXTRA-08** (grey placeholder bar in the no-bid state).
- `s20-auction-d900` (first capture, 1.6s in) — reported as "no clock anywhere",
  which was **my error**: 1.6s lands inside the reveal beat, which is precisely
  when the countdown is supposed not to be running. Re-shot at 4.2s and the
  panel is correct — `TIME REMAINING · 23 seconds` with a progress bar and the
  consequence in words. The capture wait was fixed rather than the product.
- `tmw-room-d900` — The pick surface opens on the same frame the turn does, at a
  full 45s, with the round/pick counter, the franchise and decade in display
  type, candidate rows carrying medallion, name, team·season and their
  **season-anchored** positions, and the corrected timeout copy ("Running out
  drafts a weaker legal fallback for you"). The scrim is very dark — the three
  rosters behind are nearly invisible where TMW-06 asks for "dimmed/blurred".
  Minor; noted, not blocking.
- `tmw-room-full-m844` — Stacks cleanly at 390px: overlay, then roster, then the
  court with the bench attached, then the recent-picks rail. No horizontal
  overflow. The candidate list is a short scroll region, which is tight but
  workable.
- `home-fact-l900` / `home-fact-m844` — Editorial and strong in both themes:
  accent rail, category and era chips, motif watermark, Syne headline, one
  explanatory line, no source row, no forced profile link. **Two defects found
  and fixed here → EXTRA-09**, both only visible by opening the image.
- `rankings-light` / `rankings-dark` — **Protected surface unchanged.** All five
  component colours at full saturation, geometry and ordering identical, and the
  61 Rankings + theme browser tests (axe included) pass.



---

## Audits required by the spec

| Audit | Artifact | Status |
|---|---|---|
| Franchise × decade pool completeness | `docs/implementation/THREE_MAN_WEAVE_POOL_AUDIT.md` | **DONE** — 150 combinations, 6,656 expected pairs, 4,751 actual, **0 extra, 0 unexplained missing**. All 1,905 gaps are one evidenced cause (season below PEAK3's own minutes qualifier ⇒ no score for any team ⇒ no card). `scripts/audit_three_man_weave_pool.py`, 29 tests. |
| Position legality property audit | tests | **DONE** — `test_position_seasons.py` (19). Every card in the index has ≥1 starting slot; every starter in a played match stands where their own card allows; the bare-"F" fallback pinned at ≤5 of 4,751. |
| TMW timeout non-exploitability simulation | tests | **DONE** — never picks the best, never above the median of the legal pool, and across 60 seeded rolls the giveaway is >0 in every state and averages >5 PEAK3 points. Stable across recomputation. |
| TMW bot simulation statistics | tests | **DONE** — 120 matches / 2,160 picks: optimal 95.79%, near-optimal 100%, mean quality regret 0.91 pts (p95 6.61, max 11.83), **0** dominance violations / illegal picks / completion failures / catastrophic deviations. |
| S20 skip-semantics + timing simulation | tests | **DONE** — `test_skip_semantics.py` (9) covers all four spec cases plus the out-of-skips forcing bug in both directions and replay safety. The 480-match timeout audit now reaches the follow-pass branch 60× (previously "structurally unreachable"); 2,000 bot-vs-bot matches complete 100% with 0 illegal actions and 0 cap violations. |
| Fact featured-tier counts and categories | `docs/implementation/NBA_FACT_BANK_REPORT.md` | **DONE** — bank 228→187, featured 93 (79 editorial / 14 derived), 19 categories, eras classic 35 / modern 20 / current 19 / early 19, max 3 per template, 93-day rotation, 0 subject repeats inside 14 days. |

## Completion gates (spec §19)

Gates A–F are tracked verbatim in the spec. This tracker records per-requirement
evidence; the closure report cites gate status.

| Gate | Status |
|---|---|
| A — Three-Man Weave gameplay | TODO |
| B — $20 Showdown gameplay | TODO |
| C — Daily Grid | TODO |
| D — Homepage / facts | TODO |
| E — Visual system | TODO |
| F — Validation | TODO |
