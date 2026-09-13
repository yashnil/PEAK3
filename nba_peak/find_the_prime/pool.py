"""Which (player, duration) prompts FIND THE PRIME may ask, and how each scores.

A prompt is eligible when:

  * the career is fully inside the scored data (`career_fully_covered`) -- a
    player whose prime may predate 1979-80 cannot be asked where it was;
  * the player's canonical best window ranks inside `POOL_RANK_CAP` on that
    duration's committed board (recognisability, from canonical data);
  * there are at least `MIN_WINDOWS[n]` windows to choose between;
  * the best window beats the career's MEDIAN window by at least
    `MIN_BEST_OVER_MEDIAN` -- the career genuinely varies.

SCALE. Each prompt's normalising range is `best - worst` clamped to the
`[SCALE_PERCENTILE_LOW, SCALE_PERCENTILE_HIGH]` percentiles of that spread over
the eligible pool for the duration. The bounds are DERIVED here from the
committed artifact, and the dealt value is written into the match snapshot so
a historical match keeps the number it was scored with.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from statistics import median

from nba_peak.find_the_prime import config as C
from nba_peak.prime_modes.artifact import CareerSeason, CareerWindow, PlayerCareer, load_artifact

DURATIONS: tuple[int, ...] = (2, 3, 5)


@dataclass(frozen=True)
class Prompt:
    player_slug: str
    player_name: str
    duration: int
    canonical_rank: int
    seasons: tuple[CareerSeason, ...]
    windows: tuple[CareerWindow, ...]
    best: CareerWindow
    floor: float
    spread: float


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * pct / 100.0
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _eligible(career: PlayerCareer, duration: int) -> bool:
    windows = career.windows.get(duration, ())
    rank = career.canonical_rank.get(duration)
    if not career.career_fully_covered or rank is None or rank > C.POOL_RANK_CAP:
        return False
    if len(windows) < C.MIN_WINDOWS[duration]:
        return False
    scores = [w.prime_score for w in windows]
    return max(scores) - median(scores) >= C.MIN_BEST_OVER_MEDIAN


@lru_cache(maxsize=None)
def prompts(duration: int) -> tuple[Prompt, ...]:
    if duration not in DURATIONS:
        raise ValueError(f"FIND THE PRIME does not ask {duration}Y prompts")
    out: list[Prompt] = []
    for career in load_artifact().players.values():
        if not _eligible(career, duration):
            continue
        windows = career.windows[duration]
        scores = [w.prime_score for w in windows]
        best = career.best(duration)
        out.append(
            Prompt(
                player_slug=career.player_slug,
                player_name=career.player_name,
                duration=duration,
                canonical_rank=career.canonical_rank[duration],
                seasons=career.seasons,
                windows=windows,
                best=best,
                floor=min(scores),
                spread=round(max(scores) - min(scores), 4),
            )
        )
    out.sort(key=lambda p: (p.canonical_rank, p.player_slug))
    return tuple(out)


@lru_cache(maxsize=None)
def scale_bounds(duration: int) -> tuple[float, float]:
    spreads = [p.spread for p in prompts(duration)]
    return (
        round(_percentile(spreads, C.SCALE_PERCENTILE_LOW), 4),
        round(_percentile(spreads, C.SCALE_PERCENTILE_HIGH), 4),
    )


def scale_for(prompt: Prompt) -> float:
    low, high = scale_bounds(prompt.duration)
    return round(min(max(prompt.spread, low), high), 4)


def warm_pool() -> None:
    for duration in DURATIONS:
        prompts(duration)
        scale_bounds(duration)
