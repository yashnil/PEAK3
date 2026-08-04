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
RULESET_VERSION: Final[str] = "tmw_ruleset_v1"

# Bumped whenever the franchise x decade eligibility index changes in a way
# that could change WHO is eligible for a given roll: a different source file,
# a different franchise-continuity table, a changed traded-player policy, or a
# changed decade bucketing rule. Stamped onto every index so a cached one can
# be invalidated without inspecting its contents.
ELIGIBILITY_INDEX_VERSION: Final[str] = "tmw_eligibility_index_v1"

# Bumped whenever hard position legality changes. Deliberately separate from
# ELIGIBILITY_INDEX_VERSION: the two answer different questions ("may this
# player be drafted at all" vs "may this player occupy this slot") and change
# for different reasons.
POSITION_LEGALITY_VERSION: Final[str] = "tmw_position_legality_v1"

# The six-player adapter's own version, stamped onto every evaluation result
# ALONGSIDE the untouched perfect_season versions (never replacing them -- a
# reader must be able to tell which evaluator produced the numbers and which
# adapter shaped the roster that went in). See evaluation.py.
TMW_ADAPTER_VERSION: Final[str] = "tmw_six_player_adapter_v1"

# Bumped whenever the deterministic timeout auto-pick changes its choice for
# an unchanged (state, seed). Separate constant because a change here silently
# alters recorded match history, which is exactly the kind of change that must
# be greppable.
AUTOPICK_VERSION: Final[str] = "tmw_autopick_v1"

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


__all__ = [
    "AUTOPICK_VERSION",
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
