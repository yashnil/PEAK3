"""FIND THE PRIME -- every constant the rules, the pool and the bots share.

Every threshold states where its number comes from. The data-derived ones are
computed from the committed artifact by `pool.py` rather than typed here, and
`tests/find_the_prime/test_pool.py` pins them so a new artifact version cannot
move them silently. Calibration evidence: `docs/game-design/FIND_THE_PRIME.md`.
"""
from __future__ import annotations

MODE_ID = "find_the_prime"
RULESET_VERSION = "find_the_prime_v1"
BOARD_VERSION = "find_the_prime_board_v1"
BOT_POLICY_VERSION = "find_the_prime_bot_v1"

SEAT_COUNT = 4
#: Nine rounds, exactly three at each duration; the ORDER is seeded.
ROUND_DURATIONS: tuple[int, ...] = (2, 2, 2, 3, 3, 3, 5, 5, 5)
ROUND_COUNT = len(ROUND_DURATIONS)
MAX_ROUND_SCORE = 100.0
MAX_MATCH_SCORE = MAX_ROUND_SCORE * ROUND_COUNT  # 900

# ---------------------------------------------------------------------------
# Phases and timing
# ---------------------------------------------------------------------------

PHASE_INTRO = "intro"        # seatless
PHASE_DECIDE = "decide"      # simultaneous decision
PHASE_REVEAL = "reveal"      # seatless: the career ridge, every seat's window
PHASE_COMPLETE = "complete"

INTRO_SECONDS = 6.0
#: Long enough to place, move and lock a window on a 10-20 season rail without
#: hurrying; the prompt's 15-20 s region. The foundation adds its 2 s grace.
DECIDE_SECONDS = 20.0
#: The ridge, four seats' brackets and the round's points. The teaching moment
#: of the mode; long enough to read, short enough to keep nine rounds near five
#: minutes.
REVEAL_SECONDS = 9.0

# ---------------------------------------------------------------------------
# Which prompts are asked
# ---------------------------------------------------------------------------

#: Recognisability floor from canonical data, the same one PRIME CUT uses.
POOL_RANK_CAP = 150
#: A prompt needs enough windows to be a choice at all.
MIN_WINDOWS: dict[int, int] = {2: 6, 3: 5, 5: 4}
#: MEANINGFUL VARIATION: the best window must beat the career's median window
#: by at least this many display points. Below it, PEAK3 rates most of the
#: career as near-equal (Michael Jordan's 3Y windows span 92.75-95.54) and the
#: prompt would be a coin flip dressed as knowledge.
MIN_BEST_OVER_MEDIAN = 3.0

# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

#: EFFECTIVELY TIED. A chosen window whose canonical score is within this many
#: display points of the best window earns full marks and counts as finding
#: the prime. Derived: the p90 gap between ADJACENT players on the committed
#: 2Y/3Y/5Y boards is 0.647 / 0.518 / 0.675, so a regret inside ~0.65 is a
#: smaller distinction than the model draws between neighbouring players on
#: its own leaderboard nine times in ten.
EQUIVALENT_REGRET = 0.65

#: The normalising range is the player's own best-to-worst window spread,
#: CLAMPED to this percentile band of that spread across the eligible pool
#: (computed per duration by `pool.scale_bounds`). The clamp keeps one outlier
#: season (a rookie year, a comeback) from making every other window nearly
#: free, and keeps a narrow career from turning a two-point regret into a
#: cliff.
SCALE_PERCENTILE_LOW = 10.0
SCALE_PERCENTILE_HIGH = 75.0

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
#: Size of a bot's misreading of a window, in display points. The error is
#: CORRELATED along the career (AR(1), `BOT_NOISE_CORRELATION`) so a weak bot
#: misplaces the prime by a plausible few seasons rather than picking noise.
#:
#: CALIBRATED against isolated reads of 3,600 dealt rounds (400 seeded boards),
#: targeting a strong-but-beatable table: sigma 8 -> 89.1 mean round points and
#: 46% exact primes (MVP); 12 -> 83.7 / 38% (All-Star); 18 -> ~76.5 (Starter);
#: 30 -> 69.0 / 22% (Rotation). A uniformly random legal window averages 57.8.
#: The first draft (1.5-9) let an MVP bot find the exact prime 90% of the time
#: and average 99.3 -- a table no human could reasonably beat.
BOT_TIER_NOISE: dict[str, float] = {
    "rotation": 30.0,
    "starter": 18.0,
    "all_star": 12.0,
    "mvp": 8.0,
}
BOT_NOISE_CORRELATION = 0.7
#: Calibrated rating pinned on each tier's seat (`bot_seat_rating`). FITTED, not
#: chosen: 600 seeded four-tier matches with the noise above, pairwise placement
#: win rates converted to Elo gaps (400*log10(p/(1-p))) and least-squares fitted
#: with Starter anchored at the foundation's default 1200. Measured pairwise
#: rates: MVP beats Rotation 0.96, Starter 0.89, All-Star 0.76; All-Star beats
#: Rotation 0.86, Starter 0.70; Starter beats Rotation 0.70. Mean round points in
#: those matches: 69.8 / 77.3 / 83.4 / 89.2. See docs/game-design/FIND_THE_PRIME.md.
BOT_TIER_RATINGS: dict[str, float] = {
    "rotation": 1030.0,
    "starter": 1200.0,
    "all_star": 1356.0,
    "mvp": 1570.0,
}
BOT_THINK_RANGE: dict[str, tuple[float, float]] = {
    "rotation": (4.0, 11.0),
    "starter": (5.0, 12.0),
    "all_star": (5.5, 13.0),
    "mvp": (6.0, 14.0),
}

COMMAND_STAGE = "ftp_stage"
COMMAND_LOCK = "ftp_lock"
COMMAND_FORFEIT = "ftp_forfeit"

#: How an answer came to be recorded.
LOCKED_BY_PLAYER = "lock"
LOCKED_BY_STAGED_TIMEOUT = "staged_at_timeout"
NO_ANSWER_TIMEOUT = "no_selection"
NO_ANSWER_FORFEIT = "forfeit"
