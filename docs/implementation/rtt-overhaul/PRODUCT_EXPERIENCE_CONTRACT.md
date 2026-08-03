# RUN THE TABLE — Product Experience Contract

**Owner:** product-director (read-only audit; documentation-only deliverable)
**Status:** Phase 1 audit complete. This is the implementation contract for P3-B/C/D/E/F/G.
**Scope:** every RTT screen state, the RTT game shell, and the RTT-adjacent theme/homepage surfaces.

This document has two jobs. Part A is the audit: what is wrong, classified, with `file:line`
evidence, so nobody re-derives it from scratch. Part B is the contract: exactly what the
overhauled experience must do, specific enough to build directly from and specific enough that
adversarial verification (Phase 5) can check each claim against the shipped code.

Everything here respects the frozen constraints already on record for this codebase:
`docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md` §3 (token contract, class-name contract,
frozen product invariants, server authority) and CLAUDE.md (never move scoring to TypeScript,
never rename `--comp-*` tokens, `arena_points`/`prime_score` naming). Nothing in this contract
asks for a scoring, pricing, legality, eligibility, or randomness decision to move to the
client. Every animation beat specified below is a presentation of a value the server already
returned — timing choreography, never data invention.

---

## Part A — State-by-state audit

Severity: **P0** breaks trust or comprehension outright · **P1** meaningfully degrades the
experience · **P2** polish.

| State | Issue | Class | Sev | Evidence |
|---|---|---|---|---|
| Opening reveal | The center panel (`RevealReel`) asks the player to reveal 7 slots one at a time, while the persistent right rail (`RunTray`) shows all 7 players' full names, exact 3-year windows, and PEAK3 scores from the very first frame — the "reveal" is theatre for a roster the player can already read two feet away. | comprehension, suspense | **P0** | Root cause is a payload gap, not a component bug: `apps/api/app/services/run_the_table/public.py:698-699` builds `starters`/`bench` from every roster slot that has a `card_id`, unconditionally — it is never gated on `reveal.roster.complete`. The correctly-gated payload (`reveal.roster`) is a *separate* block built by `reveal_public()` (`public.py:371-410`) and consumed only by `RevealReel`. `RunTray` is mounted once and unconditionally in `RunTheTableGame.tsx:1035-1037`, and `RunTray.tsx:130-177` renders `slot.card ? <full name, window, score> : "Empty"` for every slot — with no branch for "reveal in progress." Since all 7 cards are drafted synchronously at run creation (they all have `card_id` set immediately), every slot reads as filled with full identity from the first paint of the reveal screen. |
| Opening reveal | Mobile does **not** leak identity the same way — `MobileTray.tsx:54-68` renders roster **pips** (filled/empty dots only, no names) via `rosterPips()`, not `RunTray`'s full rows. So the leak is desktop-only, which means the bug is invisible in the mobile e2e/visual QA pass that likely exists and will resurface the first time someone screenshots desktop. | comprehension | P1 | `MobileTray.tsx:54-68` vs `RunTray.tsx:130-177`. |
| Boss reveal | Does **not** have the same leak. `boss_public()` only includes `starters`/`bench` when `revealed=True` (`public.py:160-164`), and `BossPreview.tsx:280-285` correctly shows "Not scouted... A Film Room scout would have shown you this" when unrevealed. This is the correct pattern; the opening-roster payload should match it. | — | — | `public.py:126-164`, `BossPreview.tsx:246-285`. |
| Battle reveal | Each lane row shows a bold number pair (`lane.player_score.toFixed(1)` / `lane.opponent_score.toFixed(1)`) directly above a second row naming `lane.player_top_card.player_name` / `lane.opponent_top_card.player_name`, with no label distinguishing "your roster's lane total" from "the individual who led it." Stacked with no divider, "27.2 — Victor Wembanyama" reads as one fact, not two. | comprehension | **P0** | `BattleReveal.tsx:225-246` (the score row) sits directly above `BattleReveal.tsx:288-299` (the "led by" contributor row) inside the same `<motion.li>`, same lane, no visual separator, no "LINEUP TOTAL" or "TOP CONTRIBUTOR" label on either number. `BossPreview.tsx:90-93` states the underlying fact correctly in prose ("Each lane compares your roster's PEAK3 component total against theirs") but that sentence lives on a *different* screen than the one showing the ambiguous number. |
| Game shell (every state) | Three boxed columns compete for attention on every screen: the run map (up to 15 rows under ruleset v3), the decision surface, and a rail stacking scoreboard → roster (7 rows) → perks → armed block → collapsible lane profile — five independently bordered sections in one column. Nothing but border/background differentiates "context" from "the thing to decide right now." | hierarchy | P1 | `RunTheTableGame.tsx:938-1044` (three-zone grid); `RunTray.tsx` renders 4-5 bordered `<section>`s back to back (roster `113-180`, perks `183-259`, armed `274-312`, lane profile `315-346`), each with its own `rounded-xl border p-2.5` treatment identical to the others regardless of relevance. |
| Run map | Every row of every future stage renders, always, with no collapsing — "Draft Room or Film Room" shape text repeated at `text-[11px]` for stages the player is 4 acts away from reaching. | hierarchy, visual polish | P1 | `RunMap.tsx:124-191` maps every row from `ladderRows(map)` with no windowing; `rowStyle`'s "Locked" branch (`RunMap.tsx:56-62`) only dims color, doesn't collapse or truncate the list. |
| Every decision surface | Micro type is the majority of the type on screen: `text-[9px]`, `text-[10px]`, `text-[11px]` uppercase-tracked labels appear dozens of times per screen (node kind, node consequence, lane labels, tray section headers, "Front office" heading, scoreboard tile labels). Nothing above `text-2xl` exists outside headings. | visual polish, hierarchy | P1 | Representative sample: `RunTray.tsx:72-77, 118-124, 193-198, 280-284`; `BossPreview.tsx:62-67, 104-107, 145-149`; `DraftRoom.tsx:49-53`; every `rtt-node-kind`/`rtt-node-consequence` class use across `NodeChoice.tsx`, `ChoiceNode.tsx`, `ScoutPrepare.tsx`, `TradeDesk.tsx`. |
| Every decision surface | Every panel is independently bordered at the same visual weight — `rounded-xl border p-3` (or `p-2.5`) repeats identically across the boss briefing card, the boss rule card, the roster card, the Draft Room slot picker, the Trade Desk summary, the Scout report card, every `RunTray` section — so nothing on the page is visually subordinate to anything else; a rule callout and a scoreboard tile carry the same border weight. | hierarchy, visual polish | P1 | `BossPreview.tsx:98-101, 140-144, 216-217, 239-241`; `DraftRoom.tsx:141-144`; `TradeDesk.tsx:237-243`; `ScoutPrepare.tsx:250-251`; `RunTray.tsx:113-116, 183-186, 274-277, 315-317`. |
| Every decision surface | Repeated prose: the node-type "purpose" line, the "consequence" line, and (when not suppressed) the server's own `summary` all render on the same card, in the same voice register, for nearly every node — three sentences saying overlapping things before a single control is reached. | comprehension, pacing | P2 | `NodeChoice.tsx:127-140` renders `copy.purpose`, conditionally `option.summary`, and `copy.consequence` back to back; `ChoiceNode.tsx:66-71` likewise. |
| Every decision surface | Node-type tags (Draft Room / Trade Desk / Film Room / Rest-Bank) and role/lane tags are rendered with identical visual weight everywhere they appear — a "Veteran Minimum eligible" badge and a blocked-offer badge and a role-eligibility chip all use the same `text-[9px] uppercase rounded px-1.5 py-0.5` treatment, so nothing signals "this tag changes your decision" vs. "this tag is metadata." | hierarchy | P2 | `DraftRoom.tsx:114-121` (Vet Min badge) vs. `:125-133` (blocked reason) vs. `RunCard.tsx:149-172` (role chips) — three different meanings, one visual language. |
| Opening reveal, boss reveal | Fully manual, click-through pacing: "Reveal next player" must be pressed once per card (7 presses for the roster, up to 5 for a boss lineup) with no automatic queueing and no built-in pause/skip-forward choreography beyond an all-or-nothing "Skip all." There is no lights-lower / role-badge / silhouette / score-count-up sequence at all — a reveal is a single 200ms translateY+opacity fade per row. | pacing, suspense | **P0** | `RevealReel.tsx:160-190` (manual "Reveal next" button, no auto-advance timer); the whole per-slot animation is `motionTransition("base", "out", reducedMotion)` (`RevealReel.tsx:113-115`) — one 200ms fade, nothing else. |
| Boss intro / boss preview | There is no cinematic boss intro at all — no name-card beat, no philosophy statement beyond the `tagline` string, no 3-2-1 countdown, no arena treatment, no skip control (nothing to skip). `BossPreview` is a static data briefing: rule text, a briefing paragraph, two roster columns, one button. | suspense, pacing | **P0** | `BossPreview.tsx:59-306` — entire component is non-animated static layout; only `LaneProfile`'s bars (imported, not this file) carry any transition, and only when `animate` is explicitly passed (it isn't, here). |
| Battle reveal | The lane-by-lane reveal auto-plays, but at a pace (90ms stagger, 350ms fade per lane) that is closer to "instant with a stagger" than a paced cinematic beat — five lanes resolve in under a second, with a "Reveal instantly" skip button always visible even though there's barely anything to skip. No pause control exists (only instant-finish). | pacing | P1 | `BattleReveal.tsx:14-18` (`STAGGER_S = 0.09`, `DURATION_S = 0.35`); skip button `BattleReveal.tsx:156-168`. |
| Battle reveal | Verdict announcement is correctly deferred to a live region filled one frame after mount (`BattleReveal.tsx:92-103`, `120-122`) — this is a genuinely good a11y pattern and should be preserved/reused, not rebuilt, in the cinematic version. | — | — | `BattleReveal.tsx:92-122`. |
| Result screen | Every highlight (`Run MVP`, `Best acquisition`, `Best trade`, `Closest battle`) uses an identical bordered card with identical type scale — there is no "largest mistake" or negative/cautionary highlight anywhere (only positive framing: MVP, best buy, best trade, closest battle), and no leaderboard placement is shown anywhere on the receipt. | decision quality, feedback | P1 | `RunResult.tsx:281-359` (`Highlight` grid, 4 positive-only cards, `RunResult.tsx:496-508` shared identical box style); no `leaderboard` field is read or rendered anywhere in the file. |
| Result screen | The verdict stamp (win/loss framing) renders at `text-[11px] font-black uppercase` above a `text-2xl` headline — the single most game-defining fact on the screen (did you clear the table) is smaller than the flavor headline beneath it, and both are visually equal-weight with every other section below (Highlights, Credits, "Why this run ended this way") — the page reads as a stacked report, not a decisive result. | hierarchy | P1 | `RunResult.tsx:122-142`. |
| Result screen | "Share" is text-only (`Copy summary` copies a string to the clipboard) — there is no visual share card/image, despite the wrapper class being named `share-card-shell`. | feedback, visual polish | P2 | `RunResult.tsx:95-103, 121, 460-473`. |
| Draft Room / Trade Desk | Decision quality is otherwise strong and should be preserved: server-computed `legal_slots`/`selectable`/`blocked_reason` drive every affordance, blocked-but-informative offers stay in the tab order via `aria-disabled` + click guard rather than `disabled` (so a keyboard/screen-reader user reaches the reason), and the Trade Desk's lane-delta preview states its own limits ("Your roster total also depends on starter/bench weighting..."). Scout & Prepare's `would_flip` flag is a genuinely good decision-quality signal. None of this should be lost in a visual pass. | — | — | `DraftRoom.tsx:79, 122-133`; `TradeDesk.tsx:480-569`; `ScoutPrepare.tsx:294-333` (`would_flip`). |
| Theme | There is no light mode. A single dark `:root` block defines every token in `globals.css:24-81`; there is no `prefers-color-scheme` media query and no `data-theme` attribute switching anywhere in `apps/web/src`. "Light mode" as a state to audit does not currently exist — it must be built, not adjusted. | accessibility, visual polish | **P0** | `grep` for `prefers-color-scheme`/`data-theme` across `apps/web/src` returns zero matches outside this audit; `globals.css:24-81` is the only token root. |
| Zoom / narrow viewport | The three-zone grid correctly collapses (`RunTray` refluidifies below 1024px via `.rtt-zone-right-fluid`, `rtt-polish.css:24-30`) and cards use container queries (`@[520px]`, `@[560px]`) rather than viewport breakpoints inside the decision column, which is the right pattern given the column's width varies with the rail. No P0/P1 responsiveness defects found in the audited source; this is a comparative strength. | — | — | `rtt-polish.css:14-30`; `DraftRoom.tsx:63-68`; `TradeDesk.tsx:132-136`. |
| Slow network | `RunSkeleton` is a real structural skeleton (not a spinner) mounted only while the first fetch is genuinely in flight, with a screen-reader "Loading your run…" status — good baseline. But every subsequent action (`busy`) has no comparable skeleton: the surface just disables its buttons and waits, with only a plain-text "Working…" swap on the primary button. On a slow connection, a Draft Room purchase or a battle resolve gives no feedback beyond one disabled button for however long the round trip takes. | feedback, performance | P1 | `RunSkeleton.tsx:1-41` (good); `RunTheTableGame.tsx:452-491` (`run()`) sets `busy` with no skeleton/progress affordance beyond individual buttons reading "Working…"/"Resolving…"/"Starting…". |
| Reduced motion | Broadly well-implemented already: `usePrefersReducedMotion()` (SSR-safe, `useSyncExternalStore`-backed, `lib/a11y.ts:249-255`) and `motionTransition()` (`lib/motion.ts:76-84`) are used consistently to zero out durations rather than merely shortening them, across `RevealReel`, `BattleReveal`, `RunMap`'s shared-element indicator, and CSS-level `@media (prefers-reduced-motion: reduce)` blocks in `rtt-polish.css:245-257`. This is the correct architecture to extend for the cinematic sequences below — not something to replace. | — | — | `lib/a11y.ts:249-255`; `lib/motion.ts:76-84`; `rtt-polish.css:245-257`. |
| Accessibility (cross-cutting, positive) | Focus management on every surface transition is deliberate and correct: `RunTheTableGame.tsx:411-445` moves focus to the new surface's `<h2>` keyed on a surface identity string, with a resume path that claims the key without stealing focus. This must be preserved through the overhaul — any new cinematic surface needs its own entry in `surfaceKeyFor()`. | — | — | `RunTheTableGame.tsx:411-445, 1051-1060`. |
| Homepage | Not a defect, but not yet an "arena entrance" either: the current homepage (already reworked in a prior UX pass) is hero-first but the page below the fold is explicitly catalog-shaped — a grouped grid of `GameCard`s labeled "Flagship / Daily / Full season / Competitive" with a "Browse the full catalog" link. It is a well-organized directory, which is a different thing than an entrance into one flagship experience. | hierarchy | P2 | `apps/web/src/app/(main)/page.tsx:180-306` (`GameCard` grid, 4 groups). |

---

## Part B — The contract

### 1. Target experience, concretely

"Premium basketball front-office game, not an admin dashboard" means, specifically:

- **One dominant object per screen.** Every screen has exactly one thing the player is looking
  at or deciding on. Context (map progress, roster, resources) is visible but visually
  subordinate — quieter surface, smaller type, no competing border weight — never boxed at the
  same weight as the decision.
- **Reveals are earned, never redundant.** If a fact is concealed on one part of the screen, it
  is concealed everywhere on the screen, including in the accessibility tree. A "reveal" that
  can be read from an always-visible rail is not a reveal.
- **Numbers are always attributed.** A number on screen states, in the same visual unit,
  *whose* number it is (a roster's lane total vs. an individual player's score) — never inferred
  from proximity.
- **Motion carries information density, not just polish.** A beat exists because it changes what
  the player understands (a role is now known, an identity is now known, a lane is now decided)
  — not because a fade looks nice. Every beat has a reduced-motion equivalent that preserves the
  *information* and drops only the *travel*.
- **The player is never staring at chrome.** Borders, boxes, and uppercase micro-labels are
  used to establish 2-3 tiers of hierarchy, not applied uniformly to every panel on the screen.
- **Consequence is stated once, plainly, at the point of decision** — not restated in three
  registers (purpose / summary / consequence) on the same card.

### 2. Opening reveal specification

**7 concealed slots. No unrevealed names, scores, windows, or identities anywhere in the visible
UI or in accessibility text**, until that slot's own reveal beat has run. This is a hard
regression gate on the P0 leak in Part A: the persistent roster rail (`RunTray`/its successor)
must render each of the 7 slots as concealed for as long as `RevealReel`'s successor has not
yet resolved that slot — driven from the same `state.reveal.roster.revealed_slots` array
`RevealReel` already reads, not a second source of truth.

**Implementation path that respects server authority (UX plan §3.5 — no data invention on the
client):** on the one user action that starts the sequence, issue the existing `skip-all` reveal
action (`reveal("roster", 7)`, `RunTheTableGame.tsx:625-631`) immediately. The server saturates
and returns all 7 `revealed_slots` in a single response — nothing about that response is new;
`RevealReel.tsx:175-190` already does exactly this today for the "Skip all" button. The
difference is what happens next: instead of rendering all 7 open immediately, the client holds
the already-received, already-authoritative data and **paces its own reveal of it** through the
9-step sequence below, purely as client-side choreography over data the server has already
committed to. This is presentation over an already-chosen result, identical in kind to the
existing lane-reveal stagger in `BattleReveal.tsx` — not a new round-trip per card, and not a
new server capability.

- **One user action starts it.** A single "Reveal your roster" press. Nothing before that press
  shows any slot content anywhere on screen (the rail included).
- **Subsequent cards queue automatically.** No further clicks. Card 2 begins the moment card 1's
  sequence completes.
- **Total duration ~8-12s** for all 7 cards (roughly 1.1-1.7s per card, see timing table §9).
- **Controls, present for the entire sequence:**
  - **Pause** — freezes the current card's in-progress beat; resuming continues from that beat.
  - **Skip all** — jumps straight to all 7 slots fully resolved, no further animation.
  - **Reduced motion** — the *same* server response, rendered as all 7 slots resolved
    immediately with zero animation duration (mirrors `motionTransition(..., true)`'s existing
    zero-duration contract). This is not a shortened version of the sequence; it is the sequence
    collapsed to a single frame, matching how `BattleReveal` and `RevealReel` already treat
    reduced motion.
- **The 9-step sequence, per card:**
  1. **Lights lower** — the rest of the shell (map rail, tray, other unrevealed slots) dims
     slightly (opacity/brightness on the *container*, never on individual text below AA — see
     the `RunMap` locked-row lesson already learned in this codebase, `RunMap.tsx:56-62`'s
     comment about why opacity dimming broke contrast once already).
  2. **Role appears** — the slot label (`Starter — Lead Creator`, etc.) fades in first; this is
     metadata the server already sends per slot and carries no identity.
  3. **Silhouette enters** — a neutral placeholder shape (not a blank card) slides/settles into
     the slot position, establishing *where* the reveal will land before *what* lands there.
  4. **Identity resolves** — the player's name fades/settles in. This is the single most
     information-dense beat and should get the longest hold.
  5. **3-year window appears** — `window_label` (e.g. `2015-16 – 2017-18`) appears beneath the
     name, exactly as `RevealReel.tsx:138-139` already renders it, just paced.
  6. **Score counts up** — `prime_score` animates from 0 to its final value. `AnimatedNumber`
     already exists in this codebase (used for the credits tile, `RunTray.tsx:88-95`) and
     already follows the correct rule of carrying the authoritative final value in an sr-only
     sibling from first paint — reuse it, don't rebuild it.
  7. **Component signature** — the lane fingerprint bars (`RunCard.tsx:216-244`'s pattern)
     sweep in, one lane at a time or as a group.
  8. **Card moves to roster slot** — a shared-element transition (Motion's `layoutId`, the same
     mechanism `RunMap.tsx:135-143` already uses for its current-position indicator) from the
     reveal stage to its permanent position in the roster rail — this is the moment the rail is
     first allowed to show that slot as filled.
  9. **Next card begins** — silhouette for slot N+1 enters as slot N's card finishes settling;
     no dead air between cards.

### 3. Boss cinematic specification

**Intro beat** (before the lineup is shown):
- Boss name, full-bleed treatment.
- One-line philosophy (the existing `tagline` field, no new server field needed).
- Win condition, stated plainly: "First to N of five lanes" (data already sent, see
  `BossPreview.tsx:79-95`).
- A 3-2-1 countdown before the lineup reveal begins — numerals only, no player data behind them.
- Arena treatment: darker frame, accent-lit boss name, distinguishing this from a routine
  decision screen (this is a boss battle, the tone should say so before any number does).
- **Skip** control, present from the first frame of the countdown.

**Paired sequential lineup reveal:** the boss's 5+2 lineup reveals using the *same* 9-step
per-card grammar as §2 (this is one reveal system, not two) — but paired: the player's
already-known card in that slot position appears alongside the boss's card as it resolves, so
the comparison is legible the instant the boss card lands, not three screens later.

**Automatic 5-lane resolution**, each lane explicitly two-part and explicitly labeled:
- A number labeled **LINEUP TOTAL** (this is `lane.player_score`/`lane.opponent_score` today —
  the exact field is correct, it is only unlabeled; see the Part A finding on `BattleReveal.tsx`)
  compares the two rosters' summed lane values.
- A **separately shown, separately styled** "Top contributor" line beneath it, naming the
  individual card and *that card's own* lane percentile (`RunCard.tsx` already computes this
  per-card shape) — never sharing a number with the lineup total.
- An animated margin (the gap between the two totals, growing/settling as the bars animate to
  their final width — reuse `LaneProfile`'s existing `animate`/`.rtt-lane-bar-animated` CSS
  transition mechanism, `LaneProfile.tsx:22-29`, `rtt-polish.css:170-175`).
- A lane award (a visible "won"/"lost"/"tied" stamp per lane, not just border-color as today).

**Persistent scoreboard** — the running lanes-won count (`BattleReveal.tsx:172-197`'s pattern)
stays visible and updating throughout, not just at the end.

**Decisive result** — a single unambiguous stamp (WIN / LOSS), full-bleed enough to read as the
headline of the screen, not a `text-lg` line buried under five lane rows.

**Controls:** pause, skip to result (equivalent to today's "Reveal instantly," extended to the
whole cinematic not just the lane bars), replay (available only after the sequence has completed
once — replays the already-known, already-resolved result, never re-fetches or re-decides
anything).

### 4. Game shell specification

- **Top HUD**: credits, lives, act/stage progress — always visible, always the same three
  numbers in the same order, minimal chrome (this is close to what `RunTray`'s scoreboard tiles
  already do; promote that pattern to the top of the shell rather than burying it inside the
  rail).
- **Single dominant center interaction**: the decision surface keeps its existing raised
  treatment (`.rtt-decision-zone`, already correctly the one elevated panel per
  `rtt-polish.css:43-54`) but everything else on screen must recede *further* than it does
  today — reduce the map rail and tray to genuinely quiet chrome, not just slightly quieter
  bordered boxes.
- **Compact, expandable roster dock**: default state shows avatars/initials and score only (no
  full row per player); expands (click/tap, not hover-only) to the full detail `RunTray` shows
  today. This directly resolves the opening-reveal leak by construction — a collapsed dock has
  nothing to leak until the player expands it, and it should default to *collapsed* during any
  active reveal sequence regardless of user preference.
- **Compact act-timeline run map**: replace the full always-rendered ladder with a compact
  timeline showing the current position and near-term stages prominently, with a **history
  drawer** for everything already completed and a collapsed/summarized affordance for anything
  more than ~2 stages out — not a full 15-row list rendered at all times.

### 5. Decision-quality specification

Preserve every server-authoritative signal already in the payload — this is a presentation
overhaul, not a mechanics overhaul:

- Draft Room and Trade Desk keep `legal_slots`, `selectable`, `blocked_reason`,
  `effective_cost`/`base_cost`, and the `aria-disabled`-not-`disabled` pattern for blocked offers
  exactly as implemented (`DraftRoom.tsx:79-133`, `TradeDesk.tsx` `OfferButton`).
- Trade Desk's lane-delta preview and its explicit "roster total also depends on
  starter/bench weighting" caveat (`TradeDesk.tsx:298-347`) stays — it is honest about the limit
  of a client-side preview and should not be simplified into a false promise.
- Scout & Prepare's `would_flip` flag (`ScoutPrepare.tsx:294-333`) is the single strongest
  existing "does this decision matter" signal in the game — surface it more prominently in the
  redesign (larger, colored, not a small caption), not less.
- New requirement: every priced decision surface must show, at the point of choice, what is
  foregone — not just what is gained. Today most cards state gain only (`copy.purpose`); the
  `nodeChoiceTradeoff` mechanism (`ChoiceNode.tsx:93-103`, already used for Rest/Bank) is the
  right pattern and should extend to Draft Room and Trade Desk offer cards, not remain unique
  to Rest/Bank.

### 6. Result-experience specification

Required sections, each visually distinct in weight (this is the fix for "repeated prose,
equally weighted" in Part A):

1. **Decisive verdict**, headline weight, above everything else — win/loss stamp, not a small
   uppercase caption.
2. Act reached / boss record (existing `receipt.battles[]` per-act rows — keep).
3. Run MVP (existing, keep).
4. **Most valuable transaction** — the better of `best_acquisition` / `best_trade` by score
   delta, promoted to a single "best move" callout rather than two co-equal cards; the runner-up
   of the two stays as a secondary line, not a full duplicate card.
5. **NEW: largest mistake** — the worst-value transaction the receipt data can already support
   (lowest or negative `score_delta` acquisition/trade, or the credit sink with the weakest
   payoff) — the result screen currently has zero negative framing, which makes every run read
   as a highlight reel regardless of how it actually went. This requires no new engine
   computation beyond what `receipt.best_acquisition`/`receipt.best_trade` already model — a
   "worst" variant of the same comparison.
6. Closest lost lane (existing `closest_battle.tightest_lane_margin` — keep, but only surface if
   the closest battle was a loss or a draw; a closest *won* lane is a different, less interesting
   fact).
7. Credits remaining (existing economy line — promote out of paragraph form into its own stat
   tile alongside MVP/best-move, since it is a resource-management payoff the player made
   decisions toward all run).
8. Final roster (existing — keep).
9. Five-lane profile (existing `LaneProfile` chart — keep).
10. **Decision timeline** — NEW: a compact chronological strip of the run's choices (which node
    type at each stage, each battle's outcome) — the map the player just played, presented once
    more as a story rather than only as a live progress ladder during the run.
11. Share card — NEW: an actual shareable visual card (not clipboard text alone), reusing the
    `share-card-shell` class name that already exists but currently wraps a full scrollable
    report rather than a compact image-shaped summary.
12. **NEW: leaderboard placement** — where this run's record/score lands against the relevant
    board (daily board, global board, or "not eligible" stated plainly for a run with no
    ranking context) — currently absent entirely; this is the payoff for "run it back" and
    should not be invented data — a null/"not ranked" state is correct and required until the
    backend (task #7, global leaderboard) exists.

Five actions at the bottom, all present today except the fifth:
run it back · replay this seed · challenge a friend · copy summary · **share card (image)**.

### 7. Homepage specification

Not a rebuild — the existing hero-first pass (`page.tsx:110-175`) is a reasonable foundation.
The gap is structural, not cosmetic: the page reads as a directory the instant you scroll past
the hero. Target: an **arena entrance**.

- The hero's `HeroVignette` (live top-ranked peak windows) should feel like a window *into* the
  arena, not a decorative strip beside the headline — increase its share of the first viewport
  relative to the mode-picker grid below it.
- The mode grid stays (it is honest information architecture — every mode really does need a
  link), but it should read as secondary wayfinding under an arena-styled hero, not as the
  page's second act of equal visual weight. Concretely: the "Choose a game" grid section should
  sit further from the hero (more separation, quieter surface tier) so the hero reads as a
  complete moment on its own before the catalog begins.
- Preserve every frozen invariant from `UX_ORGANIZATION_POLISH_PLAN.md` §3.4 — the single
  `<h1>` with the exact frozen sentence, exactly one `[data-featured="true"]`, the `MODE_COPY`
  single-source-of-truth, and every listed `data-testid`.

### 8. Animation timing table

All durations below extend the existing `--pk-dur-*` / `MOTION_DURATION_MS` scale
(`globals.css:135-139`, `lib/motion.ts:31-38`) — add new named durations to that scale rather
than hardcoding new magic numbers, exactly as the codebase's own convention already requires.

| Beat | Duration | Easing | Stagger | Reduced-motion equivalent |
|---|---|---|---|---|
| Opening reveal — lights lower | 300ms (`slow`) | `standard` | — | Skipped; final dim state applied instantly |
| Opening reveal — role appears | 150ms | `out` | — | Instant |
| Opening reveal — silhouette enters | 250ms | `out` | — | Instant |
| Opening reveal — identity resolves | 350ms (`slower`-adjacent; add `reveal` token ≈400ms) | `emphasized` | — | Instant, full name shown |
| Opening reveal — window appears | 200ms (`base`) | `out` | — | Instant |
| Opening reveal — score counts up | 600ms (new `count` token) | `standard` | — | Instant final value (matches `AnimatedNumber`'s existing terminal-frame contract) |
| Opening reveal — component signature sweep | 320ms (`slow`) | `out` | 60ms/bar | Instant, bars at final height |
| Opening reveal — card moves to slot | 480ms (`slower`) | `emphasized` | — | Instant placement, no shared-element travel |
| Opening reveal — inter-card gap | 200ms hold | — | — | 0ms (cards render sequentially with no visible gap) |
| Boss intro — countdown (3-2-1) | 700ms/numeral | `standard` | — | Collapsed to a single "Battle starting" state, no numerals |
| Boss lineup reveal (per card) | same as opening reveal | same | same | same |
| Battle lane resolve | 350ms (existing `DURATION_S`) | `out` | 90ms/lane (existing) | Instant, all lanes resolved (existing behavior — keep) |
| Battle margin bar animate | 320ms (`slow`, existing `.rtt-lane-bar-animated`) | `out` | — | Instant final width (existing — keep) |
| Battle lock-in pulse | 480ms (`slower`, existing `.rtt-lock-in`) | `out` | — | None (existing — keep) |
| Result verdict stamp entrance | 480ms (`slower`) | `emphasized` | — | Instant |
| Surface-to-surface transition (existing shell pattern) | 200ms (`base`, existing) | `out` | — | Instant (existing `motionTransition` contract — keep, do not change) |

### 9. Theme direction

**Dark = "Arena Night."** The existing palette (`globals.css:24-81`) *is* Arena Night; it does
not need to be reinvented, only formally named and treated as one of two explicit states rather
than the only state.

**Light = "Arena Day / Press Box."** Not an inverted palette — a different structural read,
consistent with the "not just inverted colors" instruction:

- **Surfaces**: Arena Night uses near-black stacked surfaces (`--bg-page` → `--bg-elevated` →
  `--bg-surface`) that read as a dim arena bowl. Arena Day should read as a press box / broadcast
  desk — bright, high-key neutral surfaces (warm-white to light-grey, not pure white, to avoid a
  clinical admin-tool read) with the *same three-tier elevation logic* preserved (page < elevated
  < surface must remain a legible visual stack in both themes).
  - Requirement: the same relative "quiet → raised → decision" surface-tier structure (`--pk-
    surface-*`, `globals.css:147-160`) must hold in both themes — a card must not become
    *flatter* in light mode, only differently lit.
- **The gold accent (`--peak-accent: #f5c842`) stays the identity color in both themes** — do
  not replace it. In Arena Day, its usage should shift from "glow against near-black" (its
  current job — `--peak-accent-bg`, box-shadow glows throughout `rtt-polish.css`/`globals.css`)
  toward "ink against paper" — solid fills and underlines read better than glow-shadows on a
  light surface; keep the same hex, change *how* it's deployed structurally, not the value.
- **Component lane colors** (`--comp-si`, `--comp-tp`, `--comp-rec`, `--comp-po`, `--comp-team`,
  `--comp-tm`) are frozen per CLAUDE.md and per the token contract — they must remain the exact
  same hex values in both themes; verify contrast against both new light surfaces and confirm
  each still clears WCAG AA against its lane-bar background in both themes (see §10).
- **Motion**: Arena Night can afford glow/shadow-based emphasis (lock-in pulse, victory sweep);
  Arena Day should express the same *beats* through a different visual language (a solid fill
  sweep or an underline draw rather than a glow ring) so the beat still reads clearly against a
  light background rather than washing out.
- **Implementation**: no such system exists today (Part A confirms zero `prefers-color-scheme`
  or `data-theme` usage in the codebase). Build via a `data-theme` attribute on `<html>` set by
  a blocking inline script before paint (the standard `next-themes`-style pattern — see
  Sources), defaulting to system preference (`prefers-color-scheme`), with a visible toggle. All
  existing `:root { ... }` values become the `[data-theme="dark"]` (or unscoped `:root`
  default) block; a new `[data-theme="light"]` block is added additively — **the token contract
  in `UX_ORGANIZATION_POLISH_PLAN.md` §3.1 permits this**, since no existing property is
  renamed, removed, or has its *dark* value changed; only a light-mode value is added.

### 10. Accessibility acceptance criteria

- **Contrast**: every text/background pairing in both themes meets WCAG 2.2 AA (4.5:1 body text,
  3:1 large text/UI components) — measured, not assumed, exactly as the codebase already does
  for `RunMap`'s state words (`RunMap.tsx:74-92`'s documented contrast table is the model to
  follow for every new color pairing introduced by the cinematic sequences and by Arena Day).
  No state may ever be carried by a blanket `opacity` reduction on a text container — this
  codebase has already had to fix that bug once (`RunMap.tsx:56-62`, `DraftRoom.tsx:99-101`);
  the overhaul must not reintroduce it in the run-map compaction (§4) or the reveal "lights
  lower" beat (§2, step 1).
- **Focus**: every new cinematic surface (opening reveal, boss intro/countdown, boss lineup
  reveal) registers its own key in `surfaceKeyFor()` (`RunTheTableGame.tsx:1051-1060`) and
  receives the same focus-to-`<h2>`-on-transition treatment already implemented for every
  existing surface (`RunTheTableGame.tsx:411-445`) — do not special-case cinematic surfaces out
  of this mechanism.
- **Focus indicator**: meets WCAG 2.2 SC 2.4.11 minimum — ≥3:1 contrast against adjacent color,
  visible perimeter, never fully obscured — for every interactive element introduced (pause,
  skip, countdown-skip, replay, theme toggle, roster-dock expand).
- **Target size**: every new control (pause, skip-all, skip-to-result, replay, roster-dock
  toggle, theme toggle) meets the existing `--pk-tap-min: 44px` (`globals.css:174`) — already
  the codebase's stated floor and already ahead of the WCAG 2.2 SC 2.5.8 24px minimum; do not
  regress below the project's own existing floor for any new control.
- **Keyboard path**: every cinematic (opening reveal, boss intro, boss lineup reveal, battle
  reveal) must be fully operable via keyboard alone — pause, skip, skip-all, and the final
  "continue" control all reachable via Tab and activated via Enter/Space, with no control that
  exists only as a click/hover/gesture target.
- **Screen-reader announcements**: every cinematic's *complete* final state is available in an
  `aria-live="polite"` region mounted empty and filled one frame after commit — the exact
  pattern `BattleReveal.tsx:92-122` already implements correctly — extended to the opening
  reveal (today's `RevealReel` has no equivalent battle-style live-region summary of "all 7
  revealed") and to the boss cinematic. Reduced-motion and screen-reader users must reach the
  same complete information as a sighted, motion-preferring user, at the same or lower time
  cost, never higher.
- **No reveal leakage in accessibility text, ever.** This is the direct fix for the P0 finding
  in Part A: a screen reader must not be able to read `RunTray`'s roster rows (or their
  successor's) and learn identities/scores the visual reveal has not yet resolved. Concealed
  slots must render `aria-label="Not revealed yet"` (the pattern `RevealReel.tsx:145-152`
  already uses for its own concealed rows) in *every* component that can render that slot,
  including the roster dock/rail — not only in the reveal surface itself.
- **Reduced motion**: every beat in §8's timing table has a stated reduced-motion equivalent in
  that same table; none may be "the same animation, just shorter" — each collapses to the final,
  fully-informative state at zero duration, matching the existing `motionTransition(...,
  reducedMotion: true)` contract used throughout the codebase today.

### 11. Numbered acceptance checklist

1. Opening the roster reveal shows zero player names, windows, or scores anywhere on screen
   (rail included) or in the accessibility tree, before the player's first reveal action.
2. One user action starts the opening reveal; no further click is required to see all 7 cards
   resolve, though pause/skip-all remain available throughout.
3. The opening reveal's total run time (unpaused, not skipped) is between 8 and 12 seconds.
4. With `prefers-reduced-motion: reduce` set, the opening reveal completes in a single frame
   with the complete, correct final roster visible immediately.
5. Every lane row in the battle/boss reveal visually distinguishes "lineup total" from "top
   contributor" — distinct label text, distinct type treatment, no shared unlabeled number.
6. The boss cinematic includes a named intro beat, a stated win condition, a 3-2-1 countdown,
   and a skip control, all before the lineup reveal begins.
7. The boss lineup reveal uses the same 9-step per-card grammar as the opening reveal (verified
   by shared component/hook usage, not just visual similarity).
8. At every viewport width the game shell exposes exactly one dominant decision surface, with
   the run map and roster rail visibly and measurably quieter (lower elevation token, smaller
   type scale, or both) than the decision surface.
9. The run map does not render more than 2 stages of unreached future content expanded by
   default; a history drawer/expand affordance exists for everything else.
10. The roster dock defaults to collapsed (avatars + score only) outside of an active reveal,
    and defaults to fully concealed during an active opening-reveal sequence.
11. The result screen's win/loss verdict is the single largest, highest-contrast element on the
    screen, above the fold, before any highlight card.
12. The result screen includes a "largest mistake" or equivalent negative-framed highlight
    whenever the run's data supports one (i.e., whenever any acquisition/trade had a negative or
    below-median `score_delta`).
13. The result screen states leaderboard placement or an explicit "not ranked yet" state — never
    silently omits the section.
14. The result screen offers a real shareable visual card (an image/canvas render or an
    artifact-equivalent), not clipboard text alone.
15. `<html data-theme>` toggles between `"dark"` and `"light"` with no flash of incorrect theme
    on first paint (verified by disabling JS-after-paint timing / checking the blocking script
    runs before first contentful paint) and no React hydration warning in the console.
16. Every `--comp-*`, `--peak-accent`, and every token listed in
    `UX_ORGANIZATION_POLISH_PLAN.md` §3.1 has the identical value in both themes that it has
    today (regression-tested against that file's frozen list).
17. Every text/background pairing introduced by this overhaul, in both themes, measures ≥4.5:1
    (body) or ≥3:1 (large text / UI component) contrast — documented the way `RunMap.tsx:74-92`
    already documents its own contrast math, for every new pairing.
18. Every new interactive control has a visible focus indicator meeting ≥3:1 contrast and a hit
    target ≥44px, and is reachable and operable via keyboard alone, with no click/hover-only
    control.
19. Screen-reader users reach the complete, correct final state of every cinematic (opening
    reveal, boss intro, boss lineup reveal, battle reveal) via a live region, with no reveal
    content ever exposed to assistive tech ahead of its visual counterpart.
20. No scoring, pricing, legality, eligibility, or randomness decision has moved to the client —
    every new animation is provably a presentation of a value already present in the existing
    `RunPublicState`/`RevealTrack`/`BattlePublic` payload shapes (verified by diffing API
    request/response pairs before and after the visual overhaul: identical server calls, same
    payload fields consumed, only client-side timing changes).
21. The homepage retains the single frozen `<h1>`, exactly one `[data-featured="true"]`, and
    every `data-testid` listed in `UX_ORGANIZATION_POLISH_PLAN.md` §3.4, while visually reading
    as an arena entrance (hero occupies the dominant share of the first viewport; the mode grid
    is visually and spatially subordinate to it).

---

## Sources consulted

- [Motion for React docs — animation, stagger, AnimatePresence](https://motion.dev/docs/react-animation)
- [Motion.dev — stagger()](https://motion.dev/docs/stagger)
- [Framer Motion in 2026: A Designer's Guide for React](https://artofstyleframe.com/blog/framer-motion-animation-guide/)
- [Using prefers-reduced-motion for Accessible Animation](https://blog.openreplay.com/prefers-reduced-motion-accessible-animation/)
- [prefers-reduced-motion: a no-motion-first approach — Tatiana Mac](https://www.tatianamac.com/posts/prefers-reduced-motion)
- [Design accessible animation and movement — Pope Tech](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/)
- [next-themes — npm / GitHub (pacocoursey/next-themes)](https://github.com/pacocoursey/next-themes)
- [Fixing Hydration Mismatch in Next.js (next-themes)](https://medium.com/@pavan1419/fixing-hydration-mismatch-in-next-js-next-themes-issue-8017c43dfef9)
- [Fixing Dark Mode Flickering (FOUC) in React and Next.js](https://www.notanumber.in/blog/fixing-react-dark-mode-flickering)
- [WCAG 2.2 overview — WebAIM](https://webaim.org/blog/wcag-2-2-overview-and-feedback/)
- [WCAG 2.4.11 Focus Appearance Minimum — TestParty](https://testparty.ai/blog/wcag-focus-appearance-minimum)
- [Contrast requirements for WCAG 2.2 Level AA](https://www.makethingsaccessible.com/guides/contrast-requirements-for-wcag-2-2-level-aa/)

## Repository evidence index

- `apps/api/app/services/run_the_table/public.py` — `public_state()` (:647), `_slot_public()`
  (:111-117), `boss_public()` (:125-190), `reveal_public()` (:371-435).
- `apps/web/src/components/run-the-table/RunTheTableGame.tsx` — shell composition (:937-1046),
  focus management (:411-445), `surfaceKeyFor()` (:1051-1060), reveal action (:625-631).
- `apps/web/src/components/run-the-table/RunTray.tsx` — roster rendering (:112-180), scoreboard
  (:81-110).
- `apps/web/src/components/run-the-table/MobileTray.tsx` — roster pips (:54-68).
- `apps/web/src/components/run-the-table/RevealReel.tsx` — reveal cadence and concealment
  (:97-195).
- `apps/web/src/components/run-the-table/BattleReveal.tsx` — lane number/contributor pairing
  (:200-316), live-region pattern (:92-122).
- `apps/web/src/components/run-the-table/BossPreview.tsx` — briefing composition (:59-306).
- `apps/web/src/components/run-the-table/RunMap.tsx` — map rendering and contrast documentation
  (:56-100, 124-191).
- `apps/web/src/components/run-the-table/RunResult.tsx` — result composition (:120-494).
- `apps/web/src/components/run-the-table/DraftRoom.tsx`, `TradeDesk.tsx`, `ScoutPrepare.tsx`,
  `ChoiceNode.tsx`, `NodeChoice.tsx` — decision-quality patterns cited throughout §5.
- `apps/web/src/lib/a11y.ts` (:249-255), `apps/web/src/lib/motion.ts` (:1-100) — existing
  reduced-motion and timing infrastructure to extend, not replace.
- `apps/web/src/styles/globals.css` (:1-260) — token roots, no theme switching present.
- `apps/web/src/styles/rtt-polish.css` — existing RTT-specific motion/layout rules.
- `apps/web/src/app/(main)/page.tsx` — homepage composition (:95-495).
- `docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md` §3 — frozen token/class/testid contract.
- `docs/implementation/RUN_THE_TABLE_IMPLEMENTATION_PLAN.md` §5-6 — state machine and API
  contract (note: acts_total is stale in this doc relative to shipped `rtt_ruleset_v3`; treat
  current `apps/api` code as authoritative on counts, per CLAUDE.md).
