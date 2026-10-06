# Shared Draft

Two competitors, matched before the draft, pick from **one visible board of
players from the latest completed NBA season**. A player either side drafts is gone for the other, so
every pick has two values: what it adds to your five, and what it takes from
theirs. The mechanic is the shared-player-pool draft of EA College Football
26's CUT Draft, applied to PEAK3 cards.

- Arena mode id `shared_draft`, ruleset `shared_draft_v1`, board
  `shared_draft_board_v1`, bot `shared_draft_bot_v1`.
- Rules: `nba_peak/shared_draft/` (pure). Adapter:
  `apps/api/app/services/shared_draft/mode.py`. Room:
  `apps/web/src/components/shared-draft/`.
- Rollout switch `PEAK3_ARENA_SHARED_DRAFT_ENABLED` (default off, like the Prime
  modes under ADR-006). Off: absent from `/arena/readiness`, refused on every
  entry path; a match in progress keeps working.

## Who is eligible, and what their card is

- **Eligible** = has a row in the latest season the model has scored, in the
  committed `all_seasons_for_identities.v1.json`
  (`pool.latest_completed_season`, `pool.latest_season_slugs`). Derived from
  the data, never a hard-coded list or year: the next completed season moves
  the line by itself. Today that is 2025-26 (285 identities).
- **This is not a live roster check.** The repository holds no current-roster
  source: every committed dataset (season rows, box scores, player bios, the
  scored parquet) ends at the latest completed season, so a player who retired
  or went unsigned since is still eligible. Product copy says "players from the
  latest completed season", never "current roster". Committing a trustworthy
  roster source would be one filter in `pool.py`.
- **Card** = the player's career-best canonical 1-year PEAK3 window from The
  $20 Showdown's committed pool (`top_1000_peaks.v1.json`, 25 MPG anchor gate) —
  an official, already published value. An eligible player whose best season is
  older plays on that completed season. A row flagged `season_in_progress` is
  refused. No live-season score exists anywhere in the mode. 212 eligible
  players have a card.
- Each card is dealt at ONE position, the player's `primary_position` (most
  career minutes) — the same field the Rankings position tabs use.

## Rules

1. Board: 12 cards — two at every position plus two more at distinct seeded
   positions — each drawn from that position's 16 best eligible players. Board
   order is by position, shuffled within a position; never by score.
2. Order: two-team snake `A B B A A B B A A B`; which seat is A is seeded.
3. A pick is legal when the card is still on the board and your slot at its
   position is open. **Two cards per position make the draft deadlock-free**:
   when you still need P, at most one P card can be gone (the opponent's), so
   one remains. Tested over adversarial "deny" orders.
4. Scores are hidden from both seats until the tenth pick.
5. Clock: 30 s a pick (+ the foundation's 2 s grace). A timeout drafts the
   first legal card in board order — never score-based, so stalling is never a
   strategy.
6. Arrival → intro (5 s, timed from the last human's arrival; 20 s backstop
   opens the intro, never a pick) → picks → complete.
7. Result: the roster PEAK3 total — the sum of the five published scores, The
   $20 Showdown's one-level settlement rule. Equal totals draw; a concession
   loses outright.

## Bot

One ply, not a solver. For each legal card it reads the projected **margin**:
take this card, then let both sides draft greedily to the end. That one number
prices value, need (what waiting would cost at this position) and denial (what
the pick takes from the opponent); need and denial are also reported per
option. Choice:

- **Quality gate** — a card more than 10 points below the best legal card is
  never considered.
- **Gumbel-max** at temperature 2.0 over the survivors within 5 margin points
  of the best.

Measured (300 seeds x both seat orders = 600 matches; asserted in
`tests/shared_draft/test_bot.py`): beats a greedy best-score drafter 0.667 of
the time (+7.4 roster points a match) and a random drafter 0.975 (+57.8);
about one pick in five (0.20) is not its own argmax. Adding explicit
need/denial weights on top of the margin made it weaker (0.60), so they are
reported, not weighted.

## Deferred

- Product telemetry (the analytics allowlist names modes explicitly).
- Rated public-queue calibration of `BOT_RATING` (1250 is a placeholder within
  the existing tier ratings, like a new Prime mode before its fit).
