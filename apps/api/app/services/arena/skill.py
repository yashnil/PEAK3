"""How an Arena rating is PRESENTED: tier, provisional status and percentile.

NOTHING HERE CHANGES A RATING. `rating.py` decides what a match is worth and
`glicko2.py` does the arithmetic; this module only decides what a number that
already exists may be called on a screen, and when a statistic about it is
honest enough to show.

THE TIER LADDER IS RANKED'S, REUSED -- NOT A SECOND LADDER
----------------------------------------------------------
`services/ranked/versions.py` already names a division ladder
(Prospect / Rotation / Starter / All-Star / All-NBA / MVP / Legend) on the SAME
Glicko-2 display scale Arena ratings use: both start at
`GLICKO2_INITIAL_RATING` (1500) and both go through the one `glicko2.py`. A
second ladder with different names or cut-offs for the same scale would give
one player two contradictory identities -- "Starter" in one queue and "Gold" in
the other for the same 1520 -- so the thresholds, the Legend activity floor and
the high-tier population floor are all imported rather than restated. A future
`DIVISION_VERSION` bump therefore moves both products together, and
`ARENA_TIER_VERSION` names the ranked version it was derived from so a stored
or cached label can be traced.

Two presentation rules are Arena's own, and both exist to stop a label claiming
more than the data supports:

  * NO TIER WHILE PROVISIONAL. A rating built from three matches has an RD near
    its ceiling; calling it "All-NBA" would publish a guess as a rank. Ranked
    solves the same problem by listing only established players; Arena lists
    provisional players (a quiet launch would otherwise show an empty board)
    but withholds their tier and says why.
  * MVP AND LEGEND WAIT FOR A POPULATION. Ranked's
    `DIVISION_HIGH_TIER_MIN_QUEUE_POPULATION` suppresses the top two divisions
    until a queue has that many established players, because "MVP" in a
    population of nine is a statement about the population. Applied here per
    MODE: the cap is shown as All-NBA and flagged, never silently.

PERCENTILES ONLY WHEN THEY MEAN SOMETHING
----------------------------------------
A percentile is a claim about a population. "Better than 50% of players" with
two players is a coin flip dressed as a statistic, so it is published only when:

  * the mode's RATED population is at least `PERCENTILE_MIN_POPULATION` (30);
  * the player is NOT provisional (their own position is not yet a measurement).

Otherwise the value is None and a machine-readable reason says which rule
withheld it, so a client can write "percentiles appear at 30 rated players"
rather than showing a blank. 30 is the conventional smallest sample at which a
rank-based percentile stops moving by whole deciles when one player joins
(1/30 = 3.3 points per player); it is a presentation threshold, not a
statistical test, and is named here so it is changed in one place.

The population is every human with at least one rated match in the mode --
listed or not. A public handle is a display choice, not a skill fact, and
excluding unlisted players would make a percentile depend on who had chosen a
name. Bots are never in it: a bot is rated AGAINST but never rated
(`rating.rating_inputs_for_match`), so it has no `arena_ratings` row to count.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.services.ranked.versions import (
    DIVISION_HIGH_TIER_MIN_QUEUE_POPULATION,
    DIVISION_THRESHOLDS,
    DIVISION_VERSION,
    division_for_rating,
)

#: Rated matches before a rating stops being labelled provisional. The same
#: number ranked's placements use (`RANKED_PLACEMENT_MATCH_COUNT`), moved here
#: from `api/v1/arena.py` so the route, the standings service and the tier rule
#: cannot disagree about who is provisional.
PROVISIONAL_UNTIL = 7

#: The smallest rated population a percentile is published for. See the module
#: docstring.
PERCENTILE_MIN_POPULATION = 30

#: Traceable to the ranked ladder it reuses.
ARENA_TIER_VERSION = f"arena_tier_v1+{DIVISION_VERSION}"

#: Tiers withheld until a mode's established population reaches ranked's floor.
_HIGH_TIERS = ("MVP", "Legend")
_HIGH_TIER_FALLBACK = "All-NBA"

# Reasons a tier or percentile is withheld. Stable strings: clients branch on
# them to choose copy, so they are part of the API contract.
REASON_NOT_RATED = "not_rated"
REASON_PROVISIONAL = "provisional"
REASON_POPULATION_TOO_SMALL = "population_too_small"
REASON_RATINGS_DISABLED = "ratings_disabled"
REASON_LEADERBOARD_DISABLED = "leaderboard_disabled"


def is_provisional(rated_matches: int) -> bool:
    return rated_matches < PROVISIONAL_UNTIL


@dataclass(frozen=True)
class TierStep:
    label: str
    min_rating: float


def tier_ladder() -> list[TierStep]:
    """The ladder, lowest first, exactly as ranked defines it."""
    return [TierStep(label=name, min_rating=float(threshold)) for threshold, name in DIVISION_THRESHOLDS]


@dataclass(frozen=True)
class TierVerdict:
    #: The label to show, or None while withheld.
    tier: Optional[str]
    #: Why `tier` is None (`provisional`), else None.
    reason: Optional[str] = None
    #: True when MVP/Legend was earned by rating but shown as All-NBA because
    #: the mode's established population is below ranked's floor.
    capped: bool = False
    next_tier: Optional[str] = None
    next_tier_rating: Optional[float] = None


def tier_for(rating: float, rated_matches: int, established_players: int) -> TierVerdict:
    """The tier a rating may be SHOWN as. Pure; see the module docstring."""
    if is_provisional(rated_matches):
        return TierVerdict(tier=None, reason=REASON_PROVISIONAL)

    label = division_for_rating(rating, rated_matches)
    capped = False
    if label in _HIGH_TIERS and established_players < DIVISION_HIGH_TIER_MIN_QUEUE_POPULATION:
        label, capped = _HIGH_TIER_FALLBACK, True

    ladder = tier_ladder()
    names = [step.label for step in ladder]
    next_tier = next_rating = None
    if not capped and label in names:
        index = names.index(label)
        if index + 1 < len(ladder):
            next_tier = ladder[index + 1].label
            next_rating = ladder[index + 1].min_rating
    return TierVerdict(
        tier=label, capped=capped, next_tier=next_tier, next_tier_rating=next_rating
    )


@dataclass(frozen=True)
class PercentileVerdict:
    #: Share of the rated population with a STRICTLY lower rating, 0-100.
    percentile: Optional[float]
    reason: Optional[str] = None


def percentile_for(
    players_below: int, rated_population: int, rated_matches: int
) -> PercentileVerdict:
    """A percentile, or the reason there is none.

    Strictly-lower, so tied players share a percentile and the top of a
    population of 30 reads 96.7 rather than 100 -- "better than everyone" would
    include the player themselves.
    """
    if is_provisional(rated_matches):
        return PercentileVerdict(percentile=None, reason=REASON_PROVISIONAL)
    if rated_population < PERCENTILE_MIN_POPULATION:
        return PercentileVerdict(percentile=None, reason=REASON_POPULATION_TOO_SMALL)
    value = 100.0 * max(0, players_below) / rated_population
    return PercentileVerdict(percentile=round(min(100.0, value), 1))


__all__ = [
    "ARENA_TIER_VERSION",
    "PERCENTILE_MIN_POPULATION",
    "PROVISIONAL_UNTIL",
    "REASON_LEADERBOARD_DISABLED",
    "REASON_NOT_RATED",
    "REASON_POPULATION_TOO_SMALL",
    "REASON_PROVISIONAL",
    "REASON_RATINGS_DISABLED",
    "PercentileVerdict",
    "TierStep",
    "TierVerdict",
    "is_provisional",
    "percentile_for",
    "tier_for",
    "tier_ladder",
]
