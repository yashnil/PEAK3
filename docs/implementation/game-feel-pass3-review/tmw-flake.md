# TMW practice flake: `test_a_bot_never_holds_a_weave_turn_for_a_full_human_clock`

## Reproduction

Command (25 runs, before the fix):

    cd apps/api && PEAK3_TEST_REPOSITORY_MODE=memory python -m pytest \
      tests/test_arena_practice_e2e.py -q -p no:cacheprovider -k full_human_clock

Result: 24 passed, 1 failed — `assert polls_waiting_on_bots <= 24` with `25`.

Instrumented trace (scratch test, since deleted) for seed 1892487357, human at seat 2:

    ('BOT', 'intro', seat=None, turn 0, think=None, reply=None)   <- counted in the BOT bucket
    ('CEREMONY',)
    ('BOT', 'pick', 0, 2, think 4.69, reply 4.689)                <- 1 poll
    ('BOT', 'pick', 1, 3, think 8.56, reply 8.557)                <- poll 1
    ('BOT', 'pick', 1, 3, think 8.56, reply 3.554)                <- poll 2, then the move
    ... (12 bot picks: 7 cost two polls, 5 cost one) -> polls_waiting_on_bots = 1 + 19 = 20

## Root cause

`polls_waiting_on_bots` is exactly `1 + sum_i ceil(think_i / 5.0)` over the 12 bot picks:

1. **Poll granularity vs think time.** `_poll` ages the open turn by a fixed
   `_age_open_turn(match_id, 5.0)`; Three-Man Weave's `bot_think_seconds` draws
   4.0-10.0 s per (seat, turn_seq) from the match seed (`nba_peak/three_man_weave/config.py`).
   The driver is lazy (`bots.drive_pending_bots` moves the bot on the first read whose
   elapsed time >= think), so a draw under 5 s resolves on one poll and a draw at/over 5 s
   needs two. Max per pick = ceil(10/5) = 2; 12 picks -> at most 24. **Not** intro/reveal
   timing, not seat rotation, not a slow "contested" think class (TMW has none).
2. **The briefing poll was misfiled.** The match opens on `PHASE_INTRO`, a seatless server
   turn: `current_turn_seat_index is None != you`, so the loop counted its single poll as
   "waiting on bots". True maximum = 1 + 24 = 25.
3. **Seed dependence.** 25 is reached only when all 12 bot draws land >= 5 s:
   P ~ (5/6)^12 ~ 11% of seeds, matching the observed 1-in-5..1-in-25 failure rate.

History (git):
- `2080d09`: think 1-5 s, aging 5.0 -> every pick 1 poll; ceiling 24 was 2x slack.
- `5c03d64` (#15): think -> 4-10 s; picks now 1-2 polls; max = exactly 24. Ceiling stale-but-passing.
- `07349b0` (#23): TMW `PHASE_INTRO` became a seatless turn; its poll went into the bot bucket
  -> max 25 > 24. The flake was born here.

So 25 is a **legitimate** count under the current timing; the ceiling was stale by exactly the
intro poll, and there is **no runtime bug** — every bot moved within its own published
`bot_reply_in_seconds` (the published reply matched the authoritative think time to the
millisecond in every trace). No API/nba_peak/web code was changed.

## Fix (apps/api/tests/test_arena_practice_e2e.py only)

- `BOT_AGE_PER_POLL_SECONDS = 5.0` declared once and used by `_poll`, with a docstring
  explaining why a pick costs `ceil(think / 5)` polls under this driver.
- The test now keeps THREE buckets: briefing (asserted == 1), ceremony (unchanged 6..18),
  and bot turns.
- **State-based per-turn assertion** replaces the flat budget as the guarantee: each bot turn
  is identified by `state_version`; on first sight its published `bot_reply_in_seconds` is
  recorded, and on every poll `polls <= ceil((reply + 0.0005) / BOT_AGE_PER_POLL_SECONDS)`
  is asserted (0.5 ms back for the millisecond rounding of the published value). The lazy
  driver must apply the move on the poll that first covers the published reply, so no "+1"
  slack is given.
- The aggregate ceiling is now **derived**, not declared:
  `ROUNDS * 2 * ceil(BOT_THINK_SECONDS_MAX / BOT_AGE_PER_POLL_SECONDS)` = 6*2*2 = 24, on the
  bot bucket alone (which the old comment claimed but the intro poll violated). It moves
  with the constants instead of going stale again. `len(bot_turns) == 12` is asserted too.
- **Deterministic worst case pinned by seed.** `_new_seed` is monkeypatched
  (`app.services.arena.matchmaking._new_seed`) so the test is parametrized over
  `seed-drawn` (production path) plus `WEAVE_SLOW_BOT_SEEDS = {0: 40, 1: 37, 2: 49}` — one
  seed per human seat, found by an offline scan, where all 12 bot draws are >= 5.5 s (clear of
  the 5.0 boundary). On the pinned seeds the test additionally asserts every published reply
  > 5.0 and `polls_waiting_on_bots == 24` exactly — the case that used to fail one run in nine
  now runs every time and must land ON the ceiling.

Mutation check (scratch, deleted): wrapping `bots.bot_may_act_at` to demand think+5 s while
the published reply stayed unchanged made the test fail with "still held the turn" on both a
drawn seed and seed 37 — the new assertion catches a bot held one poll past its published
clock, which the old flat count would have tolerated only until 24.

## Verification

- 40 consecutive runs of `-k full_human_clock` (4 params each = 160 test executions): **FAILS=0**.
- `PEAK3_TEST_REPOSITORY_MODE=memory python -m pytest tests/test_arena_practice_e2e.py tests/test_three_man_weave_mode.py -q -p no:cacheprovider`: **111 passed**.
- Files changed: `apps/api/tests/test_arena_practice_e2e.py` only. No apps/web, no npm, no servers, no commit.
