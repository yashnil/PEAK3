# PEAK3 game-feel system

The shared interaction and motion layer every Arena game is built on
(`apps/web/src/components/game-feel`, `apps/web/src/lib/game-feel`,
`apps/web/src/styles/game-feel.css`). Added in the interaction /
synchronization / game-feel reconstruction pass (2026-09-05). Arena Archive
tokens (`styles/v2/tokens.css`) are the only palette; per-mode styling layers
on top through each mode's own classes.

## The interaction contract

1. **One snapshot per render.** A command's response is applied as one
   object (rosters, clocks, phase, the moment it announces). Nothing paints a
   message before the roster it describes.
2. **Newer wins, older is dropped.** `isNewer()` compares `state_version`
   (and phase). An older poll landing after a newer command response cannot
   roll the board back.
3. **Commands are serialized, never dropped.** `useCommandLane()` queues
   every command; an exclusive kind (pick, place, replay) refuses a duplicate
   before any handler runs; a coalescing channel (staging a selection) keeps
   only the latest intent. A press issued while a background request is in
   flight waits, then runs against the version current at that moment.
4. **The timeline is the server's.** Seatless phases (Three-Man Weave's
   briefing and reveal) are short server turns; clients animate against
   `turn_seq` / `turn_elapsed_seconds` / `turn_total_seconds` from the match
   view and offer no way to end a phase early.

## Primitives

| Primitive | Owns |
|---|---|
| `GameActionButton` | idle → pressed → pending → confirmed / error; duplicate guard |
| `TurnClock` | one depleting clock for you / rival / bot, warning + expiry states |
| `RoundReveal` | the round identifier landing over a dimmed board |
| `EventMoment` | a compact, self-dismissing notice for a pick, swap, leader change |
| `ScoreTransition` | deterministic number movement to the server's value |
| `ActiveSeat` | active / receded / idle seat emphasis, completion trace |
| `useArrivals` | pick-lock / swap beat from a real roster diff |
| `ResourceMeter` | a spendable resource with a depleting bar, a projected cost and a reserve marker |
| `CardArrival` | a new object ENTERS (keyed on its identity); the stage variant never drops below a painted opacity |
| `RosterSlotLock` | one slot: empty goal / targeted / pending / filled piece, with the arrival beat |
| `BidTransition` | a figure that changes hands: old figure leaves, new locks, holder and direction carried as data |
| `ResultReveal` | the staged ending (`RevealStep` sections on a schedule); click or reduced motion completes it |

## Motion levels

| Level | Band | Used for |
|---|---|---|
| 1 micro | 80–220 ms | press, hover, selection, clock tick |
| 2 event | 180–450 ms | pick lock, swap, round card, score change, active seat |
| 3 major | 600–1500 ms | intro, final reveal count-up, completion trace |

Reduced motion: every effect is decoration over state that is also carried in
attributes and copy; `prefers-reduced-motion` collapses timers and animations
and the reveal resolves immediately.

## The $20 Showdown (game-feel pass 2)

- **Bot timing is decision-shaped.** `config.BOT_THINK_RANGES`: quick pass
  0.25-0.65 s, ordinary 0.35-1.3 s, contested call occasionally 1.2-1.8 s,
  bidding war 0.3-0.85 s. The move is computed from the board; only the
  landing waits. The mode's `bot_think_seconds(seed, seat, turn_seq,
  snapshot=…)` classifies from the bot's own projection.
- **The reply is read when it is due.** `ArenaMatchView.bot_reply_in_seconds`
  is published for a bot's open turn; the room schedules one read for that
  instant, then a short retry ladder. Measured: a bot's move visible 0.4-2.0 s
  after the human's action (was 4-5 s), with the network at ~40 ms.
- **No client beat gates a control.** The reveal and handoff holds are gone.
  A new lot's card enters (`CardArrival`), the SOLD stamp plays over the
  stage's top zone with `pointer-events: none`, and the controls are live in
  the same frame the state lands.
- **The proposal is local.** Stepping the bid updates the figure, the action
  label ("Bid $7") and the projected budget (`ResourceMeter`) in the same
  frame; one `GameActionButton` press emits one command through the lane.
- **Event hierarchy.** Micro: press, step. Event: opponent raise/pass
  (`EventMoment`, `BidTransition`), slot lock, SOLD stamp. Major: intro,
  the staged result (`ResultReveal`, ~3.4 s, skippable).

### Bot v5

`BOT_POLICY_VERSION = "twenty_dollar_bot_v5"` (`nba_peak/twenty_dollar/bot.py`).
v4 was oppressive: against a rank-aware human proxy it won 78% of 2,000
seeded matches, a tenth of its self-play matches were decided by two star
purchases before lot four, and the seat that overspent then watched a
top-ten peak go for $2 with no legal way to bid. v5 is "formidable but
beatable": **69% vs the proxy (95% CI 67-71), 50% self-play, 83% vs an
always-max-raiser, 76% vs a min-opener**; early double-star blowouts 19% →
5% of self-play matches (heavy $12+ shape 5.5% → 0.5%); late premium lots
sold at ≤ $2 to a locked-out opponent 10.5% → 2.4%.

- **Opportunity cost, not a handicap.** The early replacement level was
  unreachable (51 points at lot 0, below the 101-250 band mean) — it now
  tops out at 57 on a fresh board and rises with the money a seat holds per
  open slot. A **liquidity reserve** (up to $1.20 per other open slot,
  decaying as the market runs out) means a second early star is priced as
  what it costs the rest of the roster; the first is still allowed. Once the
  opponent is down to two open slots or the reserve, the money rate and the
  reserve relax so the bot spends while there is still someone to outbid.
- **Less precision, not less intelligence.** A **per-lot opinion**
  (`_opinion`), keyed only on public facts (candidate, lot index, seat, both
  budgets), reads a candidate half a band better 22% of the time and half a
  band worse 22%, scales the ceiling ±20% and blurs the pacing cap — held
  for the whole lot, so the bot's price is an opinion rather than a fresh
  draw per raise. Deterministic: a match replays exactly. Stretch/flinch
  0.14/0.12; no jump raise against an opponent who cannot legally answer.
- **Pinned in CI.** `tests/twenty_dollar/test_bot_opponents.py` defines the
  rank-aware proxy from the public rules and holds 55-75% over 200 seeds,
  40-60% self-play over 300, early blowouts < 10% (heavy < 3%), and no
  hoarding against a human.

## Server fields

`ArenaMatchView` publishes `turn_seq`, `turn_elapsed_seconds` and
`turn_total_seconds` alongside `turn_seconds_remaining`. Three-Man Weave's
`INTRO_SECONDS` (4.0) and `REVEAL_SECONDS` (4.0, was 3.0 before the final polish pass) are the two seatless windows;
`tmw_skip_intro` / `tmw_skip_reveal` are refused with `shared_timeline`.
`bot_reply_in_seconds` says how long until the bot on the open turn may
move (null when the open turn is not a bot's).

## Run the Table (game-feel pass 3)

The run around the decision. One composition for every screen so the player
never loses their place between a draft and a boss.

- **Composition.** Header (which board: *Daily run · 2026-09-06 · seed 4471* /
  *Practice run · seed 11*; objective; `ResourceMeter` credits with the
  projected cost; `LifeMeter`; act; How to play; Start new run) → `RunTrack`
  (the whole run as chapters, current mark brightest, lost bosses scarred) →
  the decision (dominant) beside the roster rail (seven `RosterSlotLock`s,
  Lineup DNA as five short bars, perks, anything armed). Boss encounters and
  endings use the `focus` layout: no rail, the decision alone, the shell
  recedes (`data-boss`). Under 1024px the rail is a collapsible block under
  the decision and a sticky bar keeps credits and lives in reach.
- **Teaching.** No tour opens by itself. The opening cover is the whole first
  brief (*Build your roster. Survive the run. Spend credits carefully. Three
  lives.*) and one press; each rule is a one-line `PeakV2RTTCoach` chip the
  first time it matters (first choice, first cost, first boss, first life at
  risk, first scout), stored once per browser (`lib/run-the-table-coach.ts`).
  The seven-step walkthrough is behind *How to play*.
- **The deal.** Draft offers are large exact-peak cards (`PeakV2RTTOfferCard`,
  `CardArrival` staggered 70 ms). Pick: the card lifts, the others recede,
  the header meter projects the cost, the legal roster slots read
  `targeted`. Lock: one `GameActionButton` per legal slot (pending →
  confirmed). Consequence: the server snapshot lands, the slot locks with the
  arrival beat and stays marked *new*, the credits tween, an `EventMoment`
  names the signing. Advance: the track moves. All derived in the commit that
  applied the snapshot (`describeRunTransition`), never from a timer.
- **Bosses.** Title card (act numeral, name, tagline, rule, stakes; 1.8 s
  hold, *Face the lineup* ends it early; the final boss wears it larger and
  in the negative tone) → the paired deal (boss card over your card in every
  seat) → the matchup board (five lane rows with lean markers, the rule in
  one line, the seven behind a disclosure, *1 of N lives* at stake beside
  *Play the matchup*) → the staged result (`ResultReveal`: lanes at 0/260/…
  ms with a running series count, verdict at 1.4 s, consequence at 1.95 s —
  a life lost with the big `LifeMeter`, or *Act N cleared · +9 credits* —
  action at 2.35 s; a click completes it). A run that fails shows the battle
  that ended it before the receipt.
- **Act transitions.** `RoundReveal` overlay *Act I · Cleared · 2 lives · 24
  credits · Act II begins* for 1.7 s over the next decision; nothing waits.
- **Endings.** *RUN ENDED* / *FINAL BOSS CLEARED* stamp → how far (one card
  per act, lost bosses marked *Lost · life*) → the roster → the score
  assembles (count-up) and the five lanes → what mattered → personal best
  (local, `peak3.run-the-table.best`) → *Run it back*. A resumed ending or
  battle paints complete (`ResultReveal startComplete`).
- **Interaction contract.** Every command goes through `useCommandLane`; a
  snapshot is applied only when `isNewerRun` says it is newer
  (`action_count` as the version, a new `run_id` always newer). Measured on
  the rebuilt run: press → first DOM mutation 2.5–18 ms, press → next surface
  median 27 ms (2–104 ms) locally, ~800 ms at 400 ms network latency; a
  reload resumes on the same surface in ~470 ms with a *Run resumed* moment
  and no replayed animation.

## Primitives added in pass 3

| Primitive | Owns |
|---|---|
| `LifeMeter` | lives as pips; a lost pip breaks and stays scarred; `data-danger` at one life |
| `RunTrack` | the run as chapters of marks (stage / boss); current mark is the step; lost bosses keep a scar; compact under 1024px |
| `ResultReveal.startComplete` | a resumed ending paints complete on the first frame |

## Final pre-deploy polish pass (2026-09-07)

Composure, not latency: important moments stay on screen long enough to be
felt; controls still acknowledge in under 100 ms and nothing waits on a beat.

### The $20 Showdown
- **Shared intro, no skip.** `showdown_skip_intro` is refused with
  `shared_timeline` (both seats leave the 4.5 s intro on the server's own
  deadline; lot 1's full 25 s window opens for both at that instant). The
  intro shows "Lot 1 opens in Ns" and the drain bar; Escape does nothing.
- **Bot dwell, recalibrated** (`config.BOT_THINK_RANGES`, seconds): quick pass
  0.25–0.65 → **0.55–1.05**; ordinary 0.35–1.3 → **0.9–1.9**; contested
  1.2–1.8 → **1.9–2.9** (still only 45 % of contested calls take the long
  beat); bidding war 0.3–0.85 → **0.55–1.15**. Quick and sharp, never a snap.
- **The SOLD moment holds** 1.6 → **2.2 s** (`LotLedger.REVEAL_HOLD_MS`), and
  the next lot's card enters 320 ms after the stamp lands (`.sd-lot-card`
  arrival delay) — controls beneath are live the whole time.

### Run the Table
- **No reveal skip.** The opening deal and every boss deal play to the end
  (Pause stays); per-card beats trimmed identity 400 → 340 ms, score 600 →
  460 ms (≈1.16 s per card, ≈8.5 s for seven). Scores count up on the face;
  the active seat carries a light sweep; boss faces are tinted.
- **Outcome semantics.** `battleResolution()` states the lane count, the
  target and the decider together ("2–3 on lanes · 4 needed — 2–3 is not
  enough · Decided on total lane margin +6.4"), on the battle verdict and the
  receipt's journey. `DECIDED_BY_LABELS.summed_margin` no longer says "tied
  on lanes". The engine was correct; the presentation was misleading.
- **Composure.** Header and track breathe more; the rail is hairline rows
  (only the newest piece and a targeted slot light); wider gutter; perk cards
  are a card family (gradient rule, serif name, full-width choose, exact rule
  as a quiet disclosure); RTT buttons share one radius/hover/press envelope;
  the public-handle prompt stays off `/arena/run-the-table`.
- Programmatic focus on a surface's heading no longer paints a focus ring.

### 82-0 Peak Season (subagent workstream, `docs/implementation/game-feel-pass3-review/court-polish.md`)
- Start gate recomposed (`.v2-court-gate*` in `styles/v2/court.css`; the old
  markup had borrowed Run the Table's deleted gate classes and rendered as
  inline text).
- Opening intro `PeakV2CourtIntro`: `COURT_PACING.INTRO_MS` 3400 / exit 320 /
  reduced 600 ms, only on a freshly created run (never on resume/reload).
- Round card: `COURT_PACING.ROUND_REVEAL_MS` **1500 ms** held before the reels
  start (was a 620 ms chooser-local card over an already-running reel),
  exit 260 ms; the card is `CourtBuilder` state keyed on the authoritative
  round (`roundCardDoneFor`), so "Resume selection" cannot replay it.
- Spin outcome absorb `COUNT_MS` 300 → **450 ms** (lock → chooser ≈ 800 ms).
- "Data receipt" tag gone; the details now lead with the seed. Result screen
  in five indexed sections with a single actions plane.

### Three-Man Weave (subagent workstream, `.../tmw-polish.md`)
- `REVEAL_SECONDS` 3.0 → **4.0** (one shared seatless window). Ceremony marks
  (`TMW_CEREMONY_MARKS`, ms): round card 0–1550, armed 1550–1750, reels
  1750–2850, lock 2850–3250 (400 ms), pair held to 4000; marks compress
  proportionally for a shorter published window.
- Previous-pick beat `TMW_PREVIOUS_PICK_BEAT_MS` **900 ms**: when the seat
  before you picks and the turn becomes yours on a poll, the applied board
  and a hand-off moment show before the pick overlay opens; any press ends
  it; reduced motion collapses it.
- "Taken this roll" chips replace the sentence; the end screen marks your
  seat in gold at any placement, alongside the winner.

## Broadcast immersion pass (2026-09-09)

Branch `feature/arena-broadcast-immersion`. Full report:
`docs/implementation/BROADCAST_IMMERSION_REPORT.md`; plan and audit:
`docs/design/BROADCAST_IMMERSION_PLAN.md`.

### The room

`PeakV2ArenaBackdrop`, mounted **once** in `(main)/layout.tsx`, is the page-level
environment: a real 94×50 NBA court seen overhead (boundary, division line,
centre circle, both keys, both free-throw circles, both restricted arcs, both
three-point lines, drawn from actual dimensions), one floodlight and a vignette,
fixed to the viewport.

It replaced eight per-component `.pk-atmosphere` / `.court-grid-bg` call sites.
`.pk-atmosphere` survives in `globals.css` for the narrower thing it was
originally for — one *contained* panel that needs a floor of its own inside a
page — and must never go back on a full-bleed section.

Three rules it holds, all asserted in `tests/unit/arena-backdrop.test.tsx`:

- **Nothing animates.** Painted once into one composited layer, `contain:
  layout paint style`, no keyframes, no transition, no filter. Measured over a
  120-frame scroll at 4× CPU throttle: zero frames over 16.7 ms on `/rankings`
  and `/arena`. There is also nothing for `prefers-reduced-motion` to undo.
- **It cannot move text contrast.** The court line is gold at 0.10 alpha, which
  puts `--text-muted` at ≈5.1:1 in the worst case of a hairline directly behind
  text. The ceiling is a test, not a convention.
- **It is mounted exactly once.** A second `position: fixed` instance is a
  second floodlight. A test enumerates the call sites.

**A route says what kind of surface it is** with `data-arena="live" | "quiet"`
on its own root; `styles/v2/arena-room.css` reads it upward through `:has()`.
No prop threading, no client component, no route table. Unclassified is
`ambient`, which is the right fallback. `quiet` hides the court and keeps the
light — for dense tables, reading pages, the Daily Grid board and the RTT start
gate (one URL, two very different surfaces). Below 768 px the geometry is
dropped everywhere: the portrait crop leaves one hairline and one circle, which
does not read as a court and is not worth the noise.

**Light and floor are one fact.** A radial falloff mask centred where the
floodlight hangs takes the line alpha to a quarter strength at the far edge. A
uniform alpha reads as a diagram; the falloff reads as a lit floor, and it also
quiets the lines furthest from the light, which are the ones that collide with
body copy.

### Peak Duel

The framed panels, the versus axis and the paired wash were built for Endless
and scoped away from Daily. Daily now has all of it, at its own scale, with the
countdown on the axis where Endless carries the VS mark. Every size is a custom
property with Daily as the base.

- **The entrance** is keyed on the duel's id (`.duel-grid`'s `key`), so it
  replays per matchup rather than once per session. Transform/opacity only at
  220 ms; the buttons are live mid-flight.
- **The axis** is a gradient seam brightest where the two cards meet it. A flat
  neutral hairline disappeared once there was court geometry behind it.
- **The paired cool/warm wash is retired.** It was the one documented exception
  to the single-light rule, added when the page behind it was flat black. The
  room supplies direction now, so keeping it meant five gradient layers on the
  single surface that already had an exception.
- **`.duel-grid` is on both grids** and exists so the header-to-grid gap can
  only ever be changed for both phases at once. That gap is the never-moves
  contract (`duel-viewport.spec.ts`).
- **Height, not width, is the binding constraint on the reveal.** A
  `max-height: 820px` guard trims panel height, padding, lane pitch and two
  gaps so `Next Matchup` stays above the fold at 1280×720.

### Three-Man Weave

Every seat runs the shared `useArrivals` diff. An arrival (a draft) drops into
the slot and settles; a swap (a rearrangement, nobody new) pulses in place. The
arriving card takes its seat's accent for the length of the beat, so a
three-court board says *which* seat signed someone without a name being read.

`game-feel.css`'s `.tmw-court-seat [data-gf-lock]` rules have been inert since
that class was renamed; they are marked as such. `.tmw-slot[data-beat]` in
`three-man-weave.css` is the live consumer of the same keyframes.

#### Three-Man Weave, game-feel pass 5 (supersedes the ceremony marks above)

- **One scroll, the page's.** The `--tmw-viewport-cap` measurement, the pinned
  header and the inner `overflow-y: auto` courts region (with its axe-driven
  `role="region" tabIndex=0`) are gone. The turn strip (`tmw-turnbar`) is
  `position: sticky` under the site header (`--tmw-nav-h`, the nav's `h-14`),
  opaque and full-bleed: constraint first (round/pick, then franchise ×
  decade in display type), turn second (whose pick, beside the clock). It
  publishes its own height as `--tmw-strip-h` for anything that sticks below.
- **The pick surface is in the page.** `PickOverlay` renders through
  `PeakV2TMWCourts`' `decision` slot, between the strip and the courts, as a
  labelled region rather than a fixed modal. The candidate list is as long as
  the pool and the page scrolls it; on desktop the roster column is sticky
  beside it (only where the viewport can hold it, `min-height: 760px`); on a
  phone the actions dock at the bottom of the viewport and a multi-slot pick
  offers "Choose slot" to jump to the board. Moments and the previous-pick
  beat are viewport-fixed so they announce wherever the player has scrolled.
- **The roll is a draft-lottery slate** (`PeakV2TMWReveal`), fixed below the
  site header: round and picks it owns, scoreboard apertures for FRANCHISE ×
  DECADE, the round's snake order (`roundPickOrder`), and the handoff. Laid
  out for the server's **1.5 s** `REVEAL_SECONDS` (`TMW_CEREMONY`, ms):
  slate 0–200, armed 200–260, reels 260 (360 / 460 ms travel), locked 860,
  resolved 1000, handoff held for the last 500 ms. Shorter windows compress
  proportionally; longer windows only lengthen the hold. A Franchise or
  Decade Draft (`public_state.constraint`) rolls one aperture, named for the
  whole draft ("Franchise Draft · all 18 picks"), and the strip says the same.
- **The final answers who won, why, and what you built above the fold**
  (`PeakV2TMWResult`): verdict + your score + Play again / Back to Arena;
  standings with bars; "Why <winner> won" from the winner's `decisive_pick`
  and the fit measures it led by ≥ 1 point (`winnerSeparation`, comparison
  only, no weighting); a head-to-head of the four fit measures the lineup
  score reads plus each roster's decisive pick and top-rated card (values
  printed, "best" in words); your six with the decisive and top cards marked.
  The three courts and the itemised receipt follow, secondary.

### Audio

`lib/arena-audio` — eight cues, synthesised from the Web Audio API, no assets,
no dependency, **off by default**, with the mute control in the header's display
cluster. No cue carries information that is not already visible, the
`AudioContext` is constructed lazily on a real gesture, and every entry point is
wrapped so a cue can never throw into a press. Wired through shared primitives:
the selection cue fires in `GameActionButton`'s press (after the duplicate
guard, so a refused double-press is silent), the roster cue rides the same
`useArrivals` diff as TMW's beat.

The public surface is `play(cue)`. Swapping the envelopes for recorded samples
is a change inside one function; no call site moves.

### Interruption

`HandleOnboardingPrompt` suppresses itself on a route denylist **and** whenever
any `[data-arena="live"]` element is in the document, watched with a
`MutationObserver`. The route list alone was not enough: TMW's start gate
creates its practice match and sets it into state in place, so one URL is a
gate for a second and a live draft for ten minutes.

## Game-feel pass 5 — pacing, suspense and presentation (2026-09-14)

Pass 4 made every human action register instantly. Played end to end, the
Arena then felt instant in the wrong way: rolls flashed, bots answered in the
same two seconds whatever the decision, and picks were covered by the next
phase in the frame they landed. Pass 5 keeps the instant acknowledgment and
adds pacing only where it is **deliberate and server-timed**. Nothing a player
presses waits on a timer.

### Three-Man Weave

| Beat | Before | After | Where |
|---|---|---|---|
| Roll (reveal turn) | 1.5 s | 3.8 s: slate 0, armed 450, reels 700, franchise lands 2440, decade lands and locks 3090, resolved 3300, 500 ms hold | `mode.REVEAL_SECONDS`, `PeakV2TMWReveal` |
| Settle before a round's roll | none (scrim covered the pick) | 1.4 s lead inside the same server turn; board shown with the card's lock-in | `PICK_SETTLE_SECONDS`, `revealLeadMs`, `Room.settleUntil` |
| Previous-pick beat | 200 ms | 750 ms, press anywhere to skip | `TMW_PREVIOUS_PICK_BEAT_MS` |
| Snake edge without a roll (Franchise/Decade) | surface re-opened in the same frame | same 750 ms beat, "Round N · your pick again" | `roundTurnedToYou` |
| Bot think | flat 1.2–3.0 s | shaped by `ThreeManWeaveBot.deliberation`: forced ~2–3 s, typical 3–5 s, toss-up 8–11 s | `config.bot_think_seconds`, `_bot_deliberation` |

- **Deliberation** (0..1) is RNG-free and presentation only: 0.05 when the
  quality gate forces the pick, otherwise closeness of the top two players
  (0.60), crowd of contenders (0.15), and how many slots the contenders span
  (0.15), +0.08 if the best option needs a rearrangement. Seconds =
  2.6 + 7.4 × d^1.3, × seeded noise 0.85–1.15, bounded 2.0–11.5. The
  foundation clamp is 12 s. Measured over seeded drafts: standard p50 3.1 s /
  p90 6.7 s; Franchise 5.2 / 7.1; Decade 6.2 / 7.8.
- **Franchise/Decade bots (`tmw_bot_v3`)** add a small lean to utility: a player
  whose natural group (guard/wing/big) the roster already holds twice is marked
  down per extra body, a missing group is marked up after two picks, and a
  recognition pull from the career-best card anywhere in the index (superseded
  in `tmw_bot_v4`, below). The
  quality gate still runs on raw scores first, so no lean can reach a
  catastrophic pick. Bands 82/13/5 instead of 90/8/2. Decade Draft rosters with
  three or more bigs: 13/36 → 6/36 over 12 seeds. The standard game's policy is
  unchanged.
- **Pick surface over the teams.** The courts and the decision share one grid
  cell (`.tmw-stage`); the surface floats over dimmed courts that stop taking
  presses; the page still scrolls a long pool (no nested pane). The roster tab
  bar stays outside and live. Opacity-only entrance, so nothing moves under a
  press.
- **Card landing.** A drafted card drops in and rings gold once (longer during
  the settle lead).
- **Results.** Verdict first, a 2-1-3 podium, confetti/sparks only on a win,
  your score beside the rival's, at most two "why" insights, and the head to
  head, rosters and receipt in closed folds (`PeakV2TMWResult`,
  `tmw-result.css`).

### $20 Showdown

- Think ranges by decision kind: quick 1.3–2.4 s, a considered `pass`
  1.6–2.8 s, ordinary 2.2–3.8 s (15% hesitate +0.5–1.2 s), contested 3.8–6.5 s
  at 55%, bidding war 1.2–2.4 s tightening by 0.18 s per raise past the fourth
  to a 1.0–1.5 s floor. Decisions unchanged (calibration 31/31).
- SOLD hold 2.2 → 2.8 s with a hammer slam; the next lot arrives 420 ms later
  under "Next on the block"; controls stay live.
- A thinking bot sweeps the stage edge and breathes on its bench; a new
  standing bid scales in. Narrower side columns, clock and controls docked
  together, the Bid button above the fold on a phone.

### Arena IA and feedback

- One **Three-Man Weave** family everywhere: the lobby card lists Classic,
  Franchise Draft and Decade Draft with their own actions
  (`groupModeFamilies`, from `variantOf`); the Play menu and mobile drawer nest
  the three formats; the hub cell links them.
- Feedback: a "Help shape PEAK3 Arena" band under Your Arena with three quick
  kinds that jump to the existing form (`#feedback`, `?feedback=<kind>`), plus
  links from the lobby, hub and footer.

## Three-Man Weave bots with opinions (`tmw_bot_v4`, 2026-10-06)

The v3 bot took the best option by utility ~96% of the time (measured 0.958
over 120 seeded matches), so after a few games a player could call its pick
from PEAK3 alone. v4 keeps every strength guard and replaces the 90/8/2 bands
with a seeded TASTE draw:

- **Quality gate and regret cap unchanged.** A candidate more than 12 PEAK3
  points behind the best legal one is never drawable; nothing beyond 0.18
  utility regret is drawable; a decisive roll is forced and consumes no
  randomness.
- **Taste** = `peak × utility + need × (roster-need share of utility) + star ×
  recognition`, drawn by Gumbel-max at a style temperature (a softmax draw).
- **Styles** (internal, never shown), seeded per match seat by the API adapter
  as `private_state.bot_style`, bot seats only: analyst (peak 1.15, star 0.04,
  T 0.055), fan (star 0.20, T 0.075), builder (need +0.45, star 0.08, T 0.070);
  `balanced` (star 0.10, T 0.070) is the fallback. One-constraint drafts cool
  the temperature ×0.4: their deep pools hold many more near-peers.
- **Recognition** (`nba_peak/three_man_weave/recognition.py`) is a GAME-ONLY
  familiarity signal from career honors in the scored parquet (MVP, Finals MVP,
  All-NBA, All-Star, titles, scoring titles), saturating to 0..1. Not a
  basketball metric; imported only by the TMW bot and its adapter (tested).
  Worthy 0.68 vs Marques Johnson 0.37; Kareem 0.93 vs Stockton 0.85 (pre-1980
  honors are outside the data and not counted).
- **Measured (120 matches, standard):** best option 0.73–0.78 by style (v3
  0.958); single highest raw-PEAK3 candidate on non-forced turns 0.62–0.67 (v3
  0.725); situations that differ across seeds 0.64–0.69 (v3 0.31); mean quality
  regret 1.0–1.4 points (v3 0.91); zero catastrophic picks or dominance
  violations.
- **The $20 Showdown bot is untouched**: `tests/twenty_dollar/
  test_bot_policy_separation.py` pins a digest of 40 seeded bot-vs-bot decision
  sequences captured before this change, and forbids any Showdown import of
  the TMW bot or recognition.
