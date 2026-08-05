"""Versioned configuration for THREE-MAN WEAVE.

Every tunable number in the game lives here. Nothing in the engine may
hard-code a roster size, decade list, slot name or draft order -- the platform
layer and the UI read these same values, so displayed rules and applied rules
cannot drift apart. Mirrors nba_peak/run_the_table/config.py's convention.
"""
from __future__ import annotations

import random
from typing import Final

from nba_peak.perfect_season.config import ERA_LABELS
from nba_peak.perfect_season.config import (
    LINEUP_MODEL_VERSION as PERFECT_SEASON_LINEUP_MODEL_VERSION,
)
from nba_peak.perfect_season.config import (
    SIMULATOR_VERSION as PERFECT_SEASON_SIMULATOR_VERSION,
)

# ---------------------------------------------------------------------------
# Versioning
# ---------------------------------------------------------------------------
ENGINE_VERSION: Final[str] = "three_man_weave_v1"

# Bumped whenever a rule that changes what a legal match looks like changes --
# roster shape, draft order, the identity lock's grain, or the position
# legality model. A stored match built under a different ruleset is not
# replayable and the platform layer must refuse it rather than reinterpret it.
#
# v2: THE SCORING CARD IS FRANCHISE-RESTRICTED. v1 scored a pick on their best
# season anywhere in the drafted decade, so a Cleveland x 2010s Dwyane Wade was
# scored on 2010-11 Miami. v2 requires the card to belong to the rolled
# franchise as well as the rolled decade, which also narrows who is eligible
# for a roll at all. An in-flight v1 snapshot is refused rather than replayed
# under rules its players never agreed to.
RULESET_VERSION: Final[str] = "tmw_ruleset_v2"

# Bumped whenever the franchise x decade eligibility index changes in a way
# that could change WHO is eligible for a given roll: a different source file,
# a different franchise-continuity table, a changed traded-player policy, or a
# changed decade bucketing rule. Stamped onto every index so a cached one can
# be invalidated without inspecting its contents.
ELIGIBILITY_INDEX_VERSION: Final[str] = "tmw_eligibility_index_v2"

# Bumped whenever hard position legality changes. Deliberately separate from
# ELIGIBILITY_INDEX_VERSION: the two answer different questions ("may this
# player be drafted at all" vs "may this player occupy this slot") and change
# for different reasons.
POSITION_LEGALITY_VERSION: Final[str] = "tmw_position_legality_v1"

# The six-player adapter's own version, stamped onto every evaluation result
# ALONGSIDE the untouched perfect_season versions (never replacing them -- a
# reader must be able to tell which evaluator produced the numbers and which
# adapter shaped the roster that went in). See evaluation.py.
#
# v2 changed the COMPARATOR: v1 ranked on `lineup_peak_score`, which is a raw
# mean of the six card scores and therefore blind to the roster construction a
# draft is about. v2 ranks on `SimulationResult.lineup_quality` -- the model's
# own weighted fit index -- and reports no projected record at all.
TMW_ADAPTER_VERSION: Final[str] = "tmw_six_player_adapter_v2"

# Bumped whenever the deterministic timeout auto-pick changes its choice for
# an unchanged (state, seed). Separate constant because a change here silently
# alters recorded match history, which is exactly the kind of change that must
# be greppable.
AUTOPICK_VERSION: Final[str] = "tmw_autopick_v1"

#: The bot policy shipped with this mode. Pinned onto a seat so a later
#: recalibration cannot retroactively change what a settled rated match was
#: played against -- the same discipline the mode's own version strings use.
#: v2 replaced "always take the highest-scoring legal candidate" with a
#: probabilistic draw over five weighted factors. See `bot.py`.
BOT_POLICY_VERSION: Final[str] = "tmw_bot_v2"

#: How long a bot seat appears to "think" before its pick lands, in seconds.
#: A seeded draw inside this window, per (match, seat, turn) -- long enough to
#: watch, short enough that three seats do not turn six rounds into a wait.
BOT_THINK_SECONDS_MIN: Final[float] = 1.0
BOT_THINK_SECONDS_MAX: Final[float] = 5.0


def bot_think_seconds(seed: int | str, seat_index: int, turn_seq: int) -> float:
    """How long THIS bot takes on THIS turn. Deterministic, never a sleep.

    Presentation only, and enforced against the turn's stored `opened_at` by
    the platform's bot driver -- so two clients polling at different rates
    agree on when the move lands, and a fast poller cannot hurry a bot along.

    Keyed by turn as well as seat so successive picks feel variable rather
    than metronomic, and derived from the match seed so a replay of the same
    match produces the same rhythm.
    """
    draw = stream_rng(seed, f"bot-think:{seat_index}:{turn_seq}").random()
    return round(
        BOT_THINK_SECONDS_MIN + draw * (BOT_THINK_SECONDS_MAX - BOT_THINK_SECONDS_MIN), 2
    )

# The canonical PEAK3 formula this game speaks. peak3_v1 is the version
# `cache/processed/scored_1980_2026.parquet` carries and the version
# `nba_peak.perfect_season.exact_season` reads, which is what makes the
# evaluator and this game agree. The rankings surfaces serve peak3_v2 from
# `scored_1980_2026.v2.parquet`; the two disagree for 6,230 of 11,429
# player-seasons, so a score shown here is NOT interchangeable with a score
# shown on a rankings page and must never be presented as though it were.
FORMULA_VERSION: Final[str] = "peak3_v1"


# ---------------------------------------------------------------------------
# Roster shape
# ---------------------------------------------------------------------------
# Five position-anchored starters plus ONE bench slot. Six, not five, is a
# hard contract rather than a preference:
# `nba_peak.perfect_season.simulation._avg` returns 0.0 for an empty list
# (simulation.py:72-73), so a benchless five-card roster reports
# `bench_strength == 0.0` -- not "absent" -- and silently loses about six
# expected wins to the `(bench_strength - 50.0) * 0.12` term. Verified
# empirically: the same five starters score talent_core 93.49 / bench 0.00 at
# n=5 versus 89.17 / 71.87 at n=6. Six also keeps the roster shorter than
# CourtBuilder's eight so a three-way draft finishes in a sane number of
# rounds.
STARTER_SLOT_TYPES: Final[tuple[str, ...]] = ("PG", "SG", "SF", "PF", "C")
BENCH_SLOT_TYPES: Final[tuple[str, ...]] = ("bench_1",)

# Order matters: `simulation.compute_exact_fit_components` splits
# `cards[:STARTER_SLOTS]` from `cards[STARTER_SLOTS:]` positionally, so the
# starters must come first and in this exact order.
SLOT_TYPES: Final[tuple[str, ...]] = STARTER_SLOT_TYPES + BENCH_SLOT_TYPES
ROSTER_SIZE: Final[int] = len(SLOT_TYPES)  # 6

# One pick per participant per round, every roster filled exactly once.
PARTICIPANT_COUNT: Final[int] = 3
ROUNDS: Final[int] = ROSTER_SIZE  # 6


# ---------------------------------------------------------------------------
# Draft order
# ---------------------------------------------------------------------------
# Fixed A-B-C / C-B-A snake across all six rounds. This is NOT a rotating or
# balanced order, and that is deliberate: the brief specifies the fixed snake
# and documents the residual seat imbalance as intentional. Seat A always
# opens; seat C always gets the turn (last of one round, first of the next).
# Do not "fix" this by rotating the order -- the imbalance is a design
# decision, not a bug.
SNAKE_FORWARD: Final[tuple[int, ...]] = tuple(range(PARTICIPANT_COUNT))
SNAKE_REVERSE: Final[tuple[int, ...]] = tuple(reversed(SNAKE_FORWARD))


# ---------------------------------------------------------------------------
# Roll feasibility
# ---------------------------------------------------------------------------
# A franchise x decade roll is only revealed if at least this many DISTINCT
# undrafted eligible identities remain for it. Three is the floor rather than
# a comfort margin: with three participants picking from one shared roll, a
# pool of two cannot supply a distinct identity to everyone.
MIN_ELIGIBLE_FOR_ROLL: Final[int] = PARTICIPANT_COUNT

# How many candidate franchise x decade combinations the roller will examine
# before giving up and reporting that the validated space is exhausted. A
# bound rather than an unbounded search so a pathological late-match state
# cannot spin forever; the search is over a space of at most
# 30 franchises x 5 decades = 150 combinations, so this is generous.
MAX_ROLL_ATTEMPTS: Final[int] = 150


# ---------------------------------------------------------------------------
# Decades
# ---------------------------------------------------------------------------
# The five supported decades, taken from `perfect_season.config.ERA_LABELS`
# rather than redefined, so CourtBuilder and this game can never disagree
# about what "the 1990s" means.
#
# Bucketing is by season START year: "1990-91" is a 1990s season.
#
# The 1970s are EXCLUDED explicitly, not by accident. Committed data starts at
# 1979-80, so a "1970s" bucket would hold exactly one season (1979-80, 22
# team-seasons) while every other bucket holds ten. That is not a decade, it
# is a rounding artifact of bucketing by start year, and offering it as a spin
# would produce a franchise x decade roll with a tenth of the depth of every
# other roll.
DECADES: Final[tuple[str, ...]] = tuple(ERA_LABELS)

# The earliest season START year this game will consider. Anything before it
# falls in the excluded 1970s bucket above.
MIN_SEASON_START: Final[int] = 1980


def decade_label(season_start: int) -> str | None:
    """The decade bucket for a season's START year, or None if out of range.

    None for 1979 (the 1979-80 season) -- see DECADES' own comment for why
    that season has no decade in this game rather than being folded into the
    1980s. Folding it in would silently attribute a 1979-80 appearance to a
    decade the player may not otherwise have played in.
    """
    label = f"{(int(season_start) // 10) * 10}s"
    return label if label in DECADES else None


def season_start_year(season: str) -> int:
    """Start year of a canonical "YYYY-YY" season string ("1990-91" -> 1990)."""
    return int(str(season)[:4])


# ---------------------------------------------------------------------------
# Randomness
# ---------------------------------------------------------------------------
# One `random.Random` per NAMED stream. Deriving every stream from the same
# seed string but a distinct name means adding a new stream cannot shift the
# draw sequence of an existing one -- the failure mode where introducing a
# feature silently changes every previously-recorded match.
def stream_rng(seed: int | str, stream: str) -> random.Random:
    """The RNG for one named stream of one match."""
    return random.Random(f"tmw:{seed}:{stream}")


def human_seat_index(seed: int | str, seat_count: int = PARTICIPANT_COUNT) -> int:
    """Which seat the human takes in a practice match, from the seed alone.

    THE HUMAN DOES NOT ALWAYS DRAFT FIRST. Seat A opens every round-1 snake and
    seat C gets the turn at every round boundary, so a human permanently seated
    at A played a different game from the one the snake describes -- and never
    experienced the back-to-back C pick that is the order's whole texture.

    A pure function of the seed, so a match replays into the same seats, and
    published before the first roll resolves so the assignment is something a
    player is told rather than something they infer.
    """
    return stream_rng(seed, "human-seat").randrange(max(1, seat_count))


__all__ = [
    "AUTOPICK_VERSION",
    "BOT_POLICY_VERSION",
    "BOT_THINK_SECONDS_MAX",
    "BOT_THINK_SECONDS_MIN",
    "bot_think_seconds",
    "human_seat_index",
    "BENCH_SLOT_TYPES",
    "DECADES",
    "ELIGIBILITY_INDEX_VERSION",
    "ENGINE_VERSION",
    "FORMULA_VERSION",
    "MAX_ROLL_ATTEMPTS",
    "MIN_ELIGIBLE_FOR_ROLL",
    "MIN_SEASON_START",
    "PARTICIPANT_COUNT",
    "PERFECT_SEASON_LINEUP_MODEL_VERSION",
    "PERFECT_SEASON_SIMULATOR_VERSION",
    "POSITION_LEGALITY_VERSION",
    "ROSTER_SIZE",
    "ROUNDS",
    "RULESET_VERSION",
    "SLOT_TYPES",
    "SNAKE_FORWARD",
    "SNAKE_REVERSE",
    "STARTER_SLOT_TYPES",
    "TMW_ADAPTER_VERSION",
    "decade_label",
    "season_start_year",
    "stream_rng",
]
