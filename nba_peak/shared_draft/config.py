"""SHARED DRAFT -- every constant the rules, the board and the bot share.

THE GAME. Two competitors, matched before the draft, pick from ONE visible
board of latest-season NBA players. A player drafted by either side is gone for the
other, so every pick carries two values: what it adds to your five, and what it
takes from theirs. The mechanic is the shared-player-pool draft of EA College
Football 26's CUT Draft, applied to PEAK3 cards.

WHAT A CARD IS. Eligible players appeared in the latest COMPLETED, scored
season in the committed data (see `pool.latest_completed_season`). That is
"played last season", not a live roster check: the repository has no
current-roster source (see `pool.py`). The
card itself is that player's career-best canonical 1-year PEAK3 window from the
same committed artifact The $20 Showdown deals from -- an official, already
published value. No live-season or speculative score exists anywhere here.

WHAT DECIDES THE MATCH. The roster PEAK3 total: the sum of the five drafted
cards' published scores, the same one-level rule The $20 Showdown settles on
(`twenty_dollar.receipt.SETTLEMENT_ORDER`). Equal totals are a draw.
"""
from __future__ import annotations

MODE_ID = "shared_draft"
RULESET_VERSION = "shared_draft_v1"
BOARD_VERSION = "shared_draft_board_v1"
BOT_POLICY_VERSION = "shared_draft_bot_v1"

SEAT_COUNT = 2

#: One card per lineup slot. A card is dealt AT ONE POSITION -- the player's
#: `primary_position` (most career minutes), the same field the Rankings tabs
#: file players under -- so "who can still fill my C" is answerable at a glance.
SLOTS: tuple[str, ...] = ("PG", "SG", "SF", "PF", "C")
ROSTER_SIZE = len(SLOTS)

#: THE BOARD: two cards at every position plus `EXTRA_CARDS` more at distinct
#: positions, so twelve in all and two left undrafted.
#:
#: TWO PER POSITION IS WHAT MAKES THE DRAFT DEADLOCK-FREE. Each seat holds at
#: most one card per position and needs exactly one, so when a seat still needs
#: position P, at most one P card can have been taken (by the opponent): at
#: least one is still on the board. No pick can strand either roster, however
#: aggressively the other side denies. `tests/shared_draft/test_state.py`
#: proves it exhaustively over adversarial orders.
CARDS_PER_POSITION = 2
EXTRA_CARDS = 2
BOARD_SIZE = CARDS_PER_POSITION * len(SLOTS) + EXTRA_CARDS

#: Each position's cards are drawn from the `POSITION_DEPTH` best latest-season players
#: at that position (by the published 1Y score). Deep enough that boards vary a
#: great deal from seed to seed; shallow enough that every board is a draft of
#: real starters rather than of whoever is left.
POSITION_DEPTH = 16

#: THE PICK ORDER, as seat roles: A then a snake. `A B B A A B B A A B` is the
#: two-team snake, each seat drafting five; which seat is A is drawn from the
#: match seed (`state.opener_for`).
PICK_ORDER: tuple[int, ...] = (0, 1, 1, 0, 0, 1, 1, 0, 0, 1)

# ---------------------------------------------------------------------------
# Phases and timing (seconds). Every visible beat is a real server turn.
# ---------------------------------------------------------------------------

PHASE_ARRIVAL = "arrival"  # seatless: the intro is on screen, its clock waits for every human seat
PHASE_INTRO = "intro"      # seatless: who you are drafting against, how the board works
PHASE_PICK = "pick"        # one seat on the clock
PHASE_COMPLETE = "complete"

#: The intro's clock starts only when every HUMAN seat reports it on screen,
#: never at match creation -- the arrival contract PRIME CUT proved and
#: Three-Man Weave and The $20 Showdown adopted. The backstop is for a human who
#: never arrives; it opens the INTRO, never a pick.
ARRIVAL_BACKSTOP_SECONDS = 20.0
INTRO_SECONDS = 5.0
#: One pick. Twelve faces and two rosters to read, a decision that also takes
#: something from the opponent. The foundation adds its 2 s action grace.
PICK_SECONDS = 30.0

#: (min, max) seconds a bot appears to deliberate, shaped by how close its call
#: is (`bot.deliberation`). Presentation only: the decision is independent.
BOT_THINK_RANGE: tuple[float, float] = (1.6, 5.2)

COMMAND_INTRO_SEEN = "sd_intro_seen"
COMMAND_PICK = "sd_pick"
COMMAND_FORFEIT = "sd_forfeit"

#: Why a pick was recorded without the seat choosing it. None = chosen.
AUTO_TIMEOUT = "timeout"
AUTO_FORFEIT = "forfeit"

# ---------------------------------------------------------------------------
# Bots
# ---------------------------------------------------------------------------

#: The calibrated rating a bot seat carries into a rated match. One tier: the
#: mode ships one opponent, strong but not a solver.
BOT_RATING = 1250.0

#: A candidate more than this many PEAK3 points below the best card the bot may
#: legally take is never considered -- the same structural "no catastrophe" gate
#: Three-Man Weave's bot uses, so randomness can only ever choose between
#: defensible picks.
BOT_MAX_QUALITY_REGRET_POINTS = 10.0
#: Gumbel temperature, in PEAK3 points of projected margin: near-peer choices
#: vary, a clearly better pick stays overwhelmingly likely. Measured over 600
#: seeded matches against a greedy best-score drafter: wins 0.667 (+7.4 points),
#: and 0.20 of picks are not the bot's own argmax (`tests/shared_draft/test_bot.py`).
BOT_TEMPERATURE = 2.0
#: Picks within this many utility points of the best are eligible for sampling.
BOT_REGRET_CAP = 5.0
