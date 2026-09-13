"""PRIME CUT -- every constant the rules, the board and the bots share.

Timings and thresholds carry the reason they have the value they have. The
board-quality thresholds are DERIVED from the canonical score distribution
recorded in `career_windows.v1.json` metadata (`distribution`), and
`tests/prime_cut/test_board.py` re-derives the bounds from that metadata so a
future artifact cannot silently invalidate them. Calibration evidence:
`docs/game-design/PRIME_CUT.md`.
"""
from __future__ import annotations

MODE_ID = "prime_cut"
RULESET_VERSION = "prime_cut_v1"
BOARD_VERSION = "prime_cut_board_v1"
BOT_POLICY_VERSION = "prime_cut_bot_v1"

SEAT_COUNT = 4
HEAT_DURATIONS: tuple[int, ...] = (2, 3, 5)
CARDS_PER_HEAT = 8
KEEPS_PER_HEAT = 4
CUTS_PER_HEAT = 4

# ---------------------------------------------------------------------------
# Phases and timing (seconds). Every visible beat is a real server turn.
# ---------------------------------------------------------------------------

PHASE_INTRO = "intro"            # seatless: who is at the table, what a heat is
PHASE_HEAT_OPEN = "heat_open"    # seatless: "HEAT 2 . 3-YEAR PEAKS"
PHASE_CARD = "card"              # simultaneous decision
PHASE_CARD_FORCED = "card_forced"  # seatless: every seat's call was forced
PHASE_HEAT_REVEAL = "heat_reveal"  # seatless: the heat's scores and standings
PHASE_COMPLETE = "complete"

#: Long enough to read four lines; server-timed, no skip (the Arena convention
#: since the game-feel passes: a ceremony every seat shares ends on its clock).
INTRO_SECONDS = 6.0
HEAT_OPEN_SECONDS = 3.5
#: The decision window for one card. The prompt's 8-12 s region; 12 s because a
#: card carries a player, an exact multi-season window and team context to read,
#: and a decision is irreversible. The foundation adds its 2 s action grace.
CARD_SECONDS = 12.0
#: A card nobody could choose on still has to be SEEN -- resolving it inside the
#: request that dealt it would be the phantom-state defect this repo has fixed
#: twice. Short, because there is nothing to decide.
FORCED_CARD_SECONDS = 2.5
#: Four seats' keeps, the optimal four, and moved standings.
HEAT_REVEAL_SECONDS = 12.0

# ---------------------------------------------------------------------------
# Board generation
# ---------------------------------------------------------------------------

#: Only a player whose canonical best window at this duration ranks inside the
#: top-N of the committed board is dealt. A recognisability floor from canonical
#: data, not a hand-picked list: rank 150 is the tail of the published boards
#: most players will have scrolled.
POOL_RANK_CAP = 150

#: A card is a "marquee" peak if its canonical rank is inside this, and a heat
#: may deal at most `MAX_MARQUEE_CARDS` of them -- eight obvious superstars make
#: four of the choices free.
MARQUEE_RANK = 20
MAX_MARQUEE_CARDS = 3

#: THE CUT-LINE AMBIGUITY THRESHOLD, in display points. The 4th- and 5th-best
#: cards of a heat must be at least this far apart, or "the correct cut" would
#: hinge on a distinction the model does not meaningfully make. Derived: the
#: p90 gap between ADJACENT players on the committed 2Y/3Y/5Y boards is
#: 0.647 / 0.518 / 0.675; 1.0 clears the largest of them by ~50%, i.e. it is a
#: bigger separation than the model draws between neighbours nine times in ten.
CUT_LINE_MIN_GAP = 1.0

#: `sum(top four) - sum(bottom four)` must be at least this, so the heat
#: capture denominator is meaningful and a heat rewards knowledge rather than
#: rounding. 12 = an average of 3 display points per paired swap.
HEAT_MIN_CAPTURE_SPREAD = 12.0

#: CLOSENESS: at least `CLOSE_MIN_CARDS` of the eight sit within `CLOSE_BAND`
#: display points of the cut line, so the heat has a real decision near the
#: line and not four locks and four cuts.
CLOSE_BAND = 6.0
CLOSE_MIN_CARDS = 4

#: How cards are drawn: a target "cut score" is placed uniformly between these
#: percentiles of the duration's pool, and cards are drawn without replacement
#: with Gaussian weight around it. Placing the target this way (rather than
#: drawing uniformly) is what produces boards clustered around a cut line with
#: real spread instead of a random slice of the top 150.
CENTER_PERCENTILE_LOW = 15.0
CENTER_PERCENTILE_HIGH = 85.0
SAMPLE_SIGMA = 8.0

#: Deterministic re-draws before giving up. `tests/prime_cut/test_board.py`
#: generates thousands of seeds and asserts none needs more than this.
MAX_GENERATION_ATTEMPTS = 400

# ---------------------------------------------------------------------------
# Timeout policy
# ---------------------------------------------------------------------------

#: A seat that has not decided when a card's clock (plus grace) runs out CUTS
#: it if it still has a cut left, and otherwise KEEPS it. Independent of the
#: card's strength, so a timeout can never quietly hand anybody the right call.
TIMEOUT_DECISION_ORDER: tuple[str, ...] = ("cut", "keep")

# ---------------------------------------------------------------------------
# Bots
# ---------------------------------------------------------------------------

BOT_TIERS: tuple[str, ...] = ("rotation", "starter", "all_star", "mvp")
BOT_TIER_LABELS: dict[str, str] = {
    "rotation": "Rotation",
    "starter": "Starter",
    "all_star": "All-Star",
    "mvp": "MVP",
}
#: Standard deviation of a bot's judgement error on one card, in display points.
#: Calibrated in `tests/prime_cut/test_bot.py` so mean heat capture is strictly
#: ordered by tier and no tier is perfect.
BOT_TIER_NOISE: dict[str, float] = {
    "rotation": 10.0,
    "starter": 6.0,
    "all_star": 3.5,
    "mvp": 1.8,
}
#: The calibrated rating pinned on a tier's seat (`bot_seat_rating`), so a rated
#: match against a strong bot is scored as one. FITTED, not chosen: 500 seeded
#: four-tier matches, pairwise placement win rates converted to Elo gaps
#: (400*log10(p/(1-p))) and least-squares fitted with Starter anchored at the
#: foundation's default 1200. Measured pairwise rates: MVP beats Rotation 0.88,
#: Starter 0.73, All-Star 0.62; All-Star beats Rotation 0.80, Starter 0.64;
#: Starter beats Rotation 0.67. See `docs/game-design/PRIME_CUT.md`.
BOT_TIER_RATINGS: dict[str, float] = {
    "rotation": 1059.0,
    "starter": 1200.0,
    "all_star": 1303.0,
    "mvp": 1388.0,
}
#: (min, max) seconds a tier appears to deliberate on a card.
BOT_THINK_RANGE: dict[str, tuple[float, float]] = {
    "rotation": (2.0, 5.5),
    "starter": (2.5, 6.5),
    "all_star": (3.0, 7.5),
    "mvp": (3.0, 8.0),
}

COMMAND_KEEP = "pc_keep"
COMMAND_CUT = "pc_cut"
COMMAND_FORFEIT = "pc_forfeit"

DECISION_KEEP = "keep"
DECISION_CUT = "cut"

#: Why a decision was recorded without the seat choosing it. None = chosen.
AUTO_FORCED = "forced"      # the seat's KEEP or CUT quota was already full
AUTO_TIMEOUT = "timeout"    # the card's clock (plus grace) ran out
AUTO_FORFEIT = "forfeit"    # the seat conceded the match

#: Heats of generated boards the bot's prior is estimated from. Fixed seeds,
#: independent of any live match, so the prior is identical on every process.
BOT_PRIOR_SEEDS = 240
