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
`INTRO_SECONDS` (4.0) and `REVEAL_SECONDS` (3.0) are the two seatless windows;
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
