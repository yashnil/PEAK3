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
| TMW-05 | Bot think time 4–10s, visible, real scheduled phase | TODO | | | |
| TMW-06 | Spinner/reveal becomes a full-focus game moment | TODO | | | |
| TMW-07 | One turn-status surface, not three stacked rows | TODO | | | |
| TMW-08 | Remove Draft order · snake strip | TODO | | | |
| TMW-09 | Improve three-roster composition (desktop + mobile) | TODO | | | |
| TMW-10 | Manual roster rearrangement during normal gameplay (drag + click + keyboard) | TODO | | | |
| TMW-11 | Player-selection panel refinement | TODO | | | |
| TMW-12 | Off the Board becomes compact activity history | TODO | | | |
| TMW-13 | Game opening sequence (competitive intro) | TODO | | | |
| TMW-14 | Results screen full redesign | TODO | | | |
| TMW-15 | Result and match visual verification matrix | TODO | | | |

## The $20 Showdown (spec §7)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| S20-01 | Pre-match competitive intro | TODO | | | |
| S20-02 | Player/lot reveal before human timer | TODO | | | |
| S20-03 | Unmistakable active-seat highlighting | TODO | | | |
| S20-04 | Redesigned auction decision surface / hierarchy | TODO | | | |
| S20-05 | Better bid controls | TODO | | | |
| S20-06 | Skips remaining is a first-class number | TODO | | | |
| S20-07 | Correct skip accounting semantics (market_skip / follow_pass / auction_pass) | **VERIFIED** (code) | `pass_consumes_skip` tested only "no standing bid / candidate fits me / roster incomplete". After the first seat passed, `high_bidder` was still None and `current_bid` still 0, so the **second** seat's decline re-satisfied every condition and was charged identically. One dead candidate burned 2 of a match's 10 tokens, and a player who happened to act second five times hit `REJECT_NO_MARKET_SKIPS` and was forced to open bidding on players they did not want. | `nba_peak/twenty_dollar/state.py` — fourth condition `lot_has_prior_rejection()` (read from `lot_actions`, so an automatic pre-pass is *not* a rejection to follow), plus `pass_kind()` naming the three declines and `pass_kind`/`lot_already_rejected` in the projection | `tests/twenty_dollar/test_skip_semantics.py` (9 tests) covering all four spec cases + the out-of-skips forcing bug in both directions + replay safety. The 480-match timeout audit now reaches `free_pass` 60×; that branch was previously "structurally unreachable" and its test was rewritten to encode the new contract. |
| S20-08 | Stop the human timer immediately on click | TODO | | | |
| S20-09 | Inter-turn breathing room | TODO | | | |
| S20-10 | Fix "While you were away" at the state-machine level | IN PROGRESS | **Not a reconnect bug.** Three verified mechanisms: (1) `state.py:580-587` — `_advance_lot` can `_resolve_lot` the lot it just created and `_resolve_lot` recurses back into `_advance_lot`, so **one accepted command settles 2+ lots**; the client sees `unseen.length > 1` and shows the catch-up banner *while the user is watching*, replacing the `LotReveal` payoff card. (2) **Sticky** — `LotLedger.tsx:299` self-acknowledges only at `unseen.length === 1`, so one undismissed gap freezes the cursor for the rest of the match and the reveal card never returns. (3) Blocked localStorage pins the cursor at `-1` forever, so the whole history reads as missed. **Explicitly cleared:** the sweep *cannot* manufacture an already-expired human turn — `mode.py:274` always uses `data.now + TURN_SECONDS`, `clock.enforce` fires ≤1 timeout per call, and `drive_pending_bots` freezes `now` against the stored `opened_at`, so ≤1 bot command runs per request. | S20 workstream | |
| S20-11 | Reconnect / reload / two-tab correctness matrix | TODO | | | |
| S20-12 | Errors become actionable product states | TODO | | | |
| S20-13 | Bot auction quality audit | **VERIFIED** (measured) | No defect found. The valuation is coherent: tier→marginal value, scarcity ×(1+0.30/usable slots), urgency ×(1+0.18·filled), last slot = full legal ceiling, closeout ×1.35, uncontested ×0.6, seeded jitter 0.88–1.12, a per-slot reserve, and minimum-increment raises only. It never sees a hidden score — only the coarse three-band draw tier, and only for bot seats. | No policy change. | `tests/twenty_dollar/test_bot_calibration.py`, **2,000 bot-vs-bot matches**: completion **100%**, 0 illegal actions, 0 timeouts, 0 cap violations, 1 extreme overpayment. Prices scale with tier — $3.84 mean for a top-100 peak (max $14), $1.99 for 101–250, $1.11 for 251–500. Mean spend $14.02 of $20, mean skips used 1.18 of 5, final roster score mean 325.3 (sd 28.4). |
| S20-14 | Roster/sidebar redesign | TODO | | | |
| S20-15 | Results screen full redesign | TODO | | | |
| S20-16 | Visual/browser verification matrix | TODO | | | |

## Daily Grid (spec §8)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| DG-01 | Remove redundant textual best-grid list | TODO | | | |
| DG-02 | Add player headshots to optimal grid | TODO | | | |
| DG-03 | Preserve scoring semantics | TODO | | | |

## Homepage + Fact of the Day (spec §9)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| HOME-01 | Fact of the Day must teach something worth returning for | TODO | | | |
| HOME-02 | Homepage-quality tier / suitability gate | TODO | | | |
| HOME-03 | Redesign the fact card | TODO | | | |

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
| VIS-08 | Site-wide smoke audit without destabilizing other games | TODO | | | |

## Cross-cutting (spec §11–§12)

| ID | Requirement | Status | Root cause | Implementation | Verification |
|---|---|---|---|---|---|
| ACC-01 | Accessibility + responsive requirements on all touched surfaces | TODO | | | |
| PERF-01 | No performance regression (layout shift, image storms, interval leaks, timer-tick rerenders) | TODO | | | |

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

| Surface | 1440×900 dark | 1440×900 light | 1440×700 dark | 390×844 dark | 390×844 light |
|---|---|---|---|---|---|
| TMW intro | ☐ | ☐ | — | ☐ | — |
| TMW spinner | ☐ | ☐ | ☐ | ☐ | — |
| TMW user pick | ☐ | ☐ | ☐ | ☐ | ☐ |
| TMW bot turn | ☐ | — | ☐ | ☐ | — |
| TMW result | ☐ | ☐ | ☐ | ☐ | ☐ |
| S20 intro | ☐ | ☐ | — | ☐ | — |
| S20 unopened | ☐ | ☐ | ☐ | ☐ | ☐ |
| S20 auction live | ☐ | ☐ | ☐ | ☐ | — |
| S20 reconnect recap | ☐ | — | ☐ | ☐ | — |
| S20 result | ☐ | ☐ | ☐ | ☐ | ☐ |
| Daily result | ☐ | ☐ | — | ☐ | ☐ |
| Homepage fact | ☐ | ☐ | ☐ | ☐ | ☐ |
| Rankings (regression check) | ☐ | ☐ | — | ☐ | — |

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



---

## Audits required by the spec

| Audit | Artifact | Status |
|---|---|---|
| Franchise × decade pool completeness | `docs/implementation/THREE_MAN_WEAVE_POOL_AUDIT.md` | TODO |
| Position legality property audit | tests + audit doc | TODO |
| TMW timeout non-exploitability simulation | tests | TODO |
| TMW bot simulation statistics | tests / audit doc | TODO |
| S20 skip-semantics + timing simulation | tests | TODO |
| Fact featured-tier counts and categories | fact bank build report | TODO |

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
