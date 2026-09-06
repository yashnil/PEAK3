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

## Server fields

`ArenaMatchView` publishes `turn_seq`, `turn_elapsed_seconds` and
`turn_total_seconds` alongside `turn_seconds_remaining`. Three-Man Weave's
`INTRO_SECONDS` (4.0) and `REVEAL_SECONDS` (3.0) are the two seatless windows;
`tmw_skip_intro` / `tmw_skip_reveal` are refused with `shared_timeline`.
`bot_reply_in_seconds` says how long until the bot on the open turn may
move (null when the open turn is not a bot's).
