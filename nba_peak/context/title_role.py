"""
Deterministic "best player on a title team" classification.

For each championship team-season we rank the roster by a transparent title-run
composite built from regular-season impact, playoff impact, playoff minutes,
Finals MVP, MVP/All-NBA status, and playoff box production.  We never use a
subjective label.  If the top two composites are close, we classify both as
co-best rather than forcing certainty.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _z(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    mu, sd = s.mean(), s.std(ddof=0)
    if not sd or pd.isna(sd):
        return pd.Series(0.0, index=s.index)
    return (s - mu) / sd


CO_BEST_GAP = 0.60        # composite z-gap under which #1 and #2 are "co-best"


def classify_title_team(roster: pd.DataFrame) -> pd.DataFrame:
    """
    `roster` = rows for ONE champion team-season with columns:
      player, reg_bpm, po_bpm, po_mp, po_pts, finals_mvp, mvp_rank, all_nba_team
    Returns per-player: title_team_role, title_team_role_score,
    best_player_title, co_best_player_title, secondary_star_title.
    """
    df = roster.copy()
    df["po_mp"] = pd.to_numeric(df.get("po_mp"), errors="coerce").fillna(0.0)
    played = df["po_mp"] >= 50      # meaningful postseason minutes

    composite = (
        0.9 * _z(df.get("reg_bpm")) +
        1.4 * _z(df.get("po_bpm")) +
        0.8 * _z(df["po_mp"]) +
        0.5 * _z(df.get("po_pts"))
    )
    composite = composite + df.get("finals_mvp", 0).fillna(0) * 2.0
    # MVP / All-NBA recognition nudges.
    mvp_bonus = df.get("mvp_rank").apply(
        lambda r: 1.2 if r == 1 else (0.7 if pd.notna(r) and r <= 3 else 0.0))
    nba_bonus = df.get("all_nba_team").apply(
        lambda t: 0.8 if t == 1 else (0.4 if pd.notna(t) else 0.0))
    composite = composite + mvp_bonus + nba_bonus
    composite[~played] = -np.inf
    df["_composite"] = composite

    df = df.sort_values("_composite", ascending=False)
    df["title_team_role"] = "Role player"
    df["best_player_title"] = 0
    df["co_best_player_title"] = 0
    df["secondary_star_title"] = 0

    valid = df[df["_composite"] > -np.inf]
    if len(valid):
        order = valid.index.tolist()
        top = order[0]
        df.loc[top, "best_player_title"] = 1
        df.loc[top, "title_team_role"] = "Clear best player"
        if len(order) > 1:
            gap = df.loc[top, "_composite"] - df.loc[order[1], "_composite"]
            if gap < CO_BEST_GAP:
                df.loc[order[1], "co_best_player_title"] = 1
                df.loc[order[1], "title_team_role"] = "Co-best / ambiguous"
                df.loc[top, "title_team_role"] = "Co-best / ambiguous"
            else:
                df.loc[order[1], "secondary_star_title"] = 1
                df.loc[order[1], "title_team_role"] = "Secondary star"
        for i in order[2:4]:
            if df.loc[i, "title_team_role"] == "Role player":
                df.loc[i, "title_team_role"] = "Secondary star"
                df.loc[i, "secondary_star_title"] = 1
    df.loc[~played, "title_team_role"] = "Did not play meaningful postseason minutes"

    # normalize composite to 0-100 within team for transparency
    c = df["_composite"].replace(-np.inf, np.nan)
    if c.notna().any():
        lo, hi = c.min(), c.max()
        df["title_team_role_score"] = ((c - lo) / (hi - lo) * 100).round(1) if hi > lo else 50.0
    else:
        df["title_team_role_score"] = np.nan
    return df.drop(columns=["_composite"])
