"""The PRIME CUT card pool: canonical best windows, per duration.

One card per player per duration: that player's CANONICAL best window (the
same window the committed top-250 board lists), taken from the career-window
artifact. Eligible when:

  * the player's career is fully inside the scored data
    (`career_fully_covered`) -- a card labelled as somebody's peak must not be
    a truncated late-career stretch of a player whose prime predates the data;
  * the window ranks inside `POOL_RANK_CAP` on that duration's canonical board.

Warmed once at import by the API mode, so no reducer ever reads a file.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from nba_peak.prime_cut import config as C
from nba_peak.prime_modes.artifact import CareerSeason, CareerWindow, load_artifact


@dataclass(frozen=True)
class PoolCard:
    player_slug: str
    player_name: str
    duration: int
    window: CareerWindow
    canonical_rank: int
    canonical_window_id: str
    seasons: tuple[CareerSeason, ...]


@lru_cache(maxsize=None)
def get_pool(duration: int) -> tuple[PoolCard, ...]:
    if duration not in C.HEAT_DURATIONS:
        raise ValueError(f"PRIME CUT does not deal {duration}Y heats")
    artifact = load_artifact()
    cards: list[PoolCard] = []
    for career in artifact.players.values():
        if not career.career_fully_covered:
            continue
        rank = career.canonical_rank.get(duration)
        best = career.best(duration)
        if rank is None or best is None or rank > C.POOL_RANK_CAP:
            continue
        seasons = tuple(
            s for s in career.seasons if best.start_season_end <= s.season_end <= best.end_season_end
        )
        cards.append(
            PoolCard(
                player_slug=career.player_slug,
                player_name=career.player_name,
                duration=duration,
                window=best,
                canonical_rank=rank,
                canonical_window_id=career.canonical_window_id[duration],
                seasons=seasons,
            )
        )
    cards.sort(key=lambda c: (c.canonical_rank, c.player_slug))
    return tuple(cards)


def warm_pool() -> None:
    for duration in C.HEAT_DURATIONS:
        get_pool(duration)
