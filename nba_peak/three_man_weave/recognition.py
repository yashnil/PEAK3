"""A GAME-ONLY familiarity signal for the Three-Man Weave bot.

WHAT THIS IS, AND WHAT IT IS NOT
--------------------------------
People drafting from memory lean toward names they know: James Worthy before
Marques Johnson, Kareem before Stockton, even when PEAK3's exact numbers lean
the other way. A bot that never does this can be predicted by anyone who
understands which available player PEAK3 values most. This module gives the
Three-Man Weave bot a bounded, data-derived stand-in for that familiarity.

It is NOT a basketball metric and makes no claim about who was better. It is
read by exactly one consumer -- `nba_peak/three_man_weave/bot.py` -- and must
never feed official rankings, any PEAK3 score, The $20 Showdown, Shared Draft,
or any analytical surface. `tests/three_man_weave/test_bot_style.py` asserts
that by scanning imports.

HOW IT IS BUILT
---------------
Career honors from the committed scored parquet (`cache/processed/
scored_1980_2026.parquet`, the v1 file TMW's eligibility index already reads):

    points = 4.0 x MVP           + 0.6 x MVP top-5 finish (2nd-5th)
           + 2.5 x Finals MVP    + 2.0 x All-NBA 1st team
           + 1.2 x All-NBA 2nd/3rd team + 0.8 x All-Star
           + 1.0 x championship  + 0.5 x scoring title

    recognition = 1 - exp(-points / RECOGNITION_SCALE)      in [0, 1)

The curve saturates so the second ten All-Star games count for less than the
first, and the scale is set so a multi-time All-Star sits mid-range while the
handful of household names sit near 1. Measured: Jordan 0.999, LeBron 0.999,
Magic 0.991, Kareem 0.932, Stockton 0.850, Worthy 0.675, Chris Mullin 0.551,
Marques Johnson 0.373, Vinnie Johnson 0.154, Carl Landry 0.0.

KNOWN LIMITATION, STATED: the data starts in 1979-80, so honors earned before
then (Kareem's 1970s MVPs, for instance) are not counted. That under-states a
few early-era legends; acceptable for a bounded game taste, and never a fact
anyone is shown.

Unknown players read 0.0. Built once and cached; the API adapter warms it at
import so the bot never reads the parquet inside a reducer's row lock.
"""
from __future__ import annotations

import functools
import math
from pathlib import Path

#: Points at which recognition reaches 1 - 1/e (~0.63).
RECOGNITION_SCALE = 12.0

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_SCORED_PATH = _REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"


@functools.lru_cache(maxsize=1)
def honors_points() -> dict[str, float]:
    """Career honors points per TMW player slug. Empty if the data is absent."""
    try:
        import pandas as pd

        from nba_peak.three_man_weave.eligibility import slug

        frame = pd.read_parquet(
            _SCORED_PATH,
            columns=[
                "player", "mvp_rank", "finals_mvp", "all_nba_team",
                "all_star", "championship", "scoring_title",
            ],
        )
    except Exception:  # pragma: no cover - defensive: a taste must never block play
        return {}

    def filled(column: str):
        return frame[column].fillna(0).astype(float)

    mvp_rank = frame["mvp_rank"]
    all_nba = frame["all_nba_team"]
    points = (
        4.0 * (mvp_rank == 1).astype(float)
        + 0.6 * mvp_rank.between(2, 5).astype(float)
        + 2.5 * filled("finals_mvp")
        + 2.0 * (all_nba == 1).astype(float)
        + 1.2 * all_nba.isin([2, 3]).astype(float)
        + 0.8 * filled("all_star")
        + 1.0 * filled("championship")
        + 0.5 * filled("scoring_title")
    )
    totals = points.groupby(frame["player"]).sum()
    out: dict[str, float] = {}
    for name, value in totals.items():
        key = slug(str(name))
        out[key] = out.get(key, 0.0) + float(value)
    return out


def recognition(player_slug: str | None) -> float:
    """0..1 game-only familiarity for one player. 0.0 when unknown."""
    if not player_slug:
        return 0.0
    points = honors_points().get(player_slug, 0.0)
    return 1.0 - math.exp(-max(0.0, points) / RECOGNITION_SCALE)


def warm() -> None:
    """Load the honors table now (called at the API adapter's import)."""
    honors_points()


__all__ = ["RECOGNITION_SCALE", "honors_points", "recognition", "warm"]
