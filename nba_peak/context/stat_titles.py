"""
Deterministic statistical-title derivation from per-game league tables.

The scoring/assist/rebound/steal/block "titles" are per-game leaders among
qualified players (official BR qualification: >=70% of team games, or the
games/minutes-based leaderboard rule).  50-40-90 uses actual percentages with
realistic minimum-volume thresholds so tiny-sample seasons don't qualify.
"""
from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd

# Per-game stat -> output flag column.
LEADER_STATS = {
    "pts": "scoring_title",
    "ast": "assist_title",
    "trb": "rebound_title",
    "stl": "steals_title",
    "blk": "blocks_title",
}

# 50-40-90 minimum makes (full-season leaderboard-style thresholds).
MIN_FGM = 300
MIN_3PM = 55
MIN_FTM = 125


def _scale_for_season(season_end: int, base: int) -> int:
    games = {1999: 50, 2012: 66, 2020: 72, 2021: 72}.get(int(season_end), 82)
    return int(round(base * games / 82.0))


def derive_stat_titles(per_game: pd.DataFrame, season_end: int) -> pd.DataFrame:
    """
    `per_game` must have columns: player, g, mp(min), and per-game pts/ast/trb/
    stl/blk plus fg_pct/threep_pct/ft_pct and per-game fg/3p/ft made.
    Returns one row per player with title flags.
    """
    if per_game is None or not len(per_game):
        return pd.DataFrame()
    df = per_game.copy()
    for c in ("g", "pts", "ast", "trb", "stl", "blk", "mp",
              "fg_pct", "threep_pct", "ft_pct", "fg", "threep", "ft"):
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    team_games = {1999: 50, 2012: 66, 2020: 72, 2021: 72}.get(int(season_end), 82)
    min_games = 0.58 * team_games          # ~ leaderboard games threshold
    qual = df[df.get("g", 0) >= min_games].copy()
    if not len(qual):
        qual = df.copy()

    out = {p: {v: 0 for v in LEADER_STATS.values()} for p in df["player"]}
    for f in df["player"]:
        out[f]["fifty_forty_ninety"] = 0

    for stat, col in LEADER_STATS.items():
        if stat in qual.columns and qual[stat].notna().any():
            leader = qual.loc[qual[stat].idxmax(), "player"]
            out[leader][col] = 1

    # 50-40-90: percentages with volume.
    fgm_thr = _scale_for_season(season_end, MIN_FGM)
    tpm_thr = _scale_for_season(season_end, MIN_3PM)
    ftm_thr = _scale_for_season(season_end, MIN_FTM)
    for _, r in df.iterrows():
        g = r.get("g", np.nan)
        fgm = (r.get("fg", np.nan) or 0) * (g or 0)
        tpm = (r.get("threep", np.nan) or 0) * (g or 0)
        ftm = (r.get("ft", np.nan) or 0) * (g or 0)
        if (pd.notna(r.get("fg_pct")) and r["fg_pct"] >= 0.500 and
                pd.notna(r.get("threep_pct")) and r["threep_pct"] >= 0.400 and
                pd.notna(r.get("ft_pct")) and r["ft_pct"] >= 0.900 and
                fgm >= fgm_thr and tpm >= tpm_thr and ftm >= ftm_thr):
            out[r["player"]]["fifty_forty_ninety"] = 1

    rows = []
    for player, flags in out.items():
        rows.append({"player": player, "season_end": season_end, **flags})
    return pd.DataFrame(rows)
