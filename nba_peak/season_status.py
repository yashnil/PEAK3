"""Which seasons in the scored dataset are FINISHED (Phase 12B).

WHY THIS EXISTS. Both ranking generators used to carry a hardcoded constant:

    _IN_PROGRESS_SEASON = "2025-26"

and stamped `season_in_progress` on every row from that season. The stated
justification was "the most recent season in the committed parquet is still in
progress (season_progress_pct < 1.0)". That justification does not survive
contact with the data:

    season     season_progress_pct     max games
    2016-17    0.9878                  82
    2021-22    0.9390                  82      <- LOWER than 2025-26
    2022-23    0.9634                  82
    2024-25    0.9634                  82
    2025-26    0.9512                  82

`season_progress_pct` is a per-season constant that is below 1.0 for every
season since at least 2016-17, so it never distinguished a live season from a
finished one. The constant was simply the newest season at the time it was
written, and it went stale the moment that season ended -- which is exactly
what a hardcoded date does.

THE DERIVED SIGNAL. A season's playoffs are over when the data says who won:
a champion was crowned AND a Finals MVP was awarded. Both are real columns
populated from the bracket, both are absent while a postseason is unresolved,
and neither can be true of a season still being played. That is the whole
test -- there is nothing to keep in sync, and a genuinely unfinished future
season is still caught.

DISPLAY ONLY. `season_in_progress` drives a table suffix and an explain-block
caveat. It has never entered a score, and this module does not change that:
switching a season from "in progress" to finished moves no PEAK3 value, only
what the row is labelled. See docs/model/PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md
section 2.
"""
from __future__ import annotations

import pandas as pd


def resolved_seasons(scored: pd.DataFrame) -> set[str]:
    """Every season whose postseason has concluded in this dataset.

    A season qualifies when at least one row carries `championship == 1` and at
    least one carries `finals_mvp == 1`. Both flags come from the parsed
    bracket; a season still being played has neither.

    Missing columns are treated as "cannot confirm resolved" rather than
    "resolved", so a dataset built without postseason context degrades to
    labelling everything in progress instead of silently claiming every season
    is final.
    """
    for column in ("season", "championship", "finals_mvp"):
        if column not in scored.columns:
            return set()

    champions = scored.loc[
        pd.to_numeric(scored["championship"], errors="coerce") == 1, "season"
    ]
    finals_mvps = scored.loc[
        pd.to_numeric(scored["finals_mvp"], errors="coerce") == 1, "season"
    ]
    return set(champions.astype(str)) & set(finals_mvps.astype(str))


def in_progress_seasons(scored: pd.DataFrame) -> set[str]:
    """The complement of `resolved_seasons` over the seasons actually present.

    Empty for the currently committed dataset -- every season from 1979-80
    through 2025-26 has a champion and a Finals MVP -- which is the point: the
    label is now earned by the data rather than asserted by a constant.
    """
    if "season" not in scored.columns:
        return set()
    present = {str(s) for s in scored["season"].dropna().unique()}
    return present - resolved_seasons(scored)


def is_season_in_progress(scored: pd.DataFrame, season: str) -> bool:
    """Convenience predicate for one season."""
    return str(season) in in_progress_seasons(scored)
