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

## Motion levels

| Level | Band | Used for |
|---|---|---|
| 1 micro | 80–220 ms | press, hover, selection, clock tick |
| 2 event | 180–450 ms | pick lock, swap, round card, score change, active seat |
| 3 major | 600–1500 ms | intro, final reveal count-up, completion trace |

Reduced motion: every effect is decoration over state that is also carried in
attributes and copy; `prefers-reduced-motion` collapses timers and animations
and the reveal resolves immediately.

## Server fields

`ArenaMatchView` publishes `turn_seq`, `turn_elapsed_seconds` and
`turn_total_seconds` alongside `turn_seconds_remaining`. Three-Man Weave's
`INTRO_SECONDS` (4.0) and `REVEAL_SECONDS` (3.0) are the two seatless windows;
`tmw_skip_intro` / `tmw_skip_reveal` are refused with `shared_timeline`.
