"""
Transparent teammate-strength estimation (no subjective reputation lists).

For each player-season we measure the supporting cast from teammates'
same-season cumulative value (VORP, which is already minutes-weighted), the
depth of rotation-quality teammates, and the count of star teammates
(All-NBA/All-Star or high BPM).  The candidate is always excluded from his own
supporting-cast calculation.

The raw strength is converted to a season-relative percentile and then to a
MODEST adjustment capped at +/-5 season-score points: a weak cast yields a
small bonus, a stacked cast a small penalty.  Team wins are deliberately NOT
used here (they already enter the team-context component).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .awards import all_nba_team

TEAMMATE_ADJ_CAP = 5.0


def _value(df: pd.DataFrame) -> pd.Series:
    vorp = pd.to_numeric(df.get("vorp"), errors="coerce").fillna(0.0)
    ws = pd.to_numeric(df.get("WS", df.get("ws")), errors="coerce")
    ws = ws.fillna(0.0) if ws is not None else 0.0
    return 0.7 * vorp + 0.3 * ws


def derive_teammates(regular: pd.DataFrame) -> pd.DataFrame:
    """
    Input: collapsed regular-season parquet (one row per player-season with
    team, mp, bpm, vorp, WS, awards).  Output: per player-season teammate
    fields.  Traded players (team == 'TOT') get neutral, low-confidence values.
    """
    df = regular.copy()
    df["mp"] = pd.to_numeric(df.get("mp"), errors="coerce")
    df["bpm"] = pd.to_numeric(df.get("bpm"), errors="coerce")
    df["_value"] = _value(df)
    df["_is_star"] = df.get("awards").apply(
        lambda a: 1 if (all_nba_team(a) is not None or
                        (isinstance(a, str) and "AS" in a.split(", ")))
        else 0) if "awards" in df.columns else 0
    df.loc[(df["bpm"] >= 4) & (df["mp"] >= 1000), "_is_star"] = 1

    rows = []
    for (se, team), grp in df.groupby(["season_end", "team"]):
        traded = str(team) in {"TOT", "2TM", "3TM", "4TM", "5TM"}
        for idx, r in grp.iterrows():
            mates = grp.drop(index=idx)
            if traded or len(mates) == 0:
                rows.append({
                    "player": r["player"], "season_end": se,
                    "teammate_strength_raw": np.nan,
                    "top_teammate_value": np.nan,
                    "second_teammate_value": np.nan,
                    "supporting_cast_depth": 0,
                    "star_teammate_count": 0,
                    "_teammate_confidence": 0.3 if traded else 0.5,
                })
                continue
            ranked = mates.sort_values("_value", ascending=False)
            vals = ranked["_value"].to_numpy()
            names = ranked["player"].tolist()
            top = float(vals[0]) if len(vals) else 0.0
            second = float(vals[1]) if len(vals) > 1 else 0.0
            rest = float(np.clip(vals[2:].sum(), 0, None)) if len(vals) > 2 else 0.0
            depth = int(((mates["mp"] >= 1000) & (mates["bpm"] >= 0)).sum())
            stars = int(mates["_is_star"].sum())
            raw = 0.5 * top + 0.3 * second + 0.2 * min(rest, 8.0)
            rows.append({
                "player": r["player"], "season_end": se,
                "team": team,
                "teammate_strength_raw": raw,
                "top_teammate": names[0] if names else "",
                "top_teammate_value": round(top, 2),
                "second_teammate": names[1] if len(names) > 1 else "",
                "second_teammate_value": round(second, 2),
                "supporting_cast_depth": depth,
                "star_teammate_count": stars,
                "_teammate_confidence": 0.85,
            })
    out = pd.DataFrame(rows)

    # Season-relative percentile of supporting-cast strength.
    out["teammate_strength_score"] = np.nan
    for se, idx in out.groupby("season_end").groups.items():
        sub = out.loc[idx, "teammate_strength_raw"]
        pct = sub.rank(pct=True) * 100.0
        out.loc[idx, "teammate_strength_score"] = pct

    # Modest adjustment: weak cast -> +, stacked cast -> -, capped +/-5.
    #   teammate_adjustment = reference_center - teammate_strength_score (scaled)
    # Higher strength = stronger cast = MORE NEGATIVE adjustment (penalty).
    reference_center = 50.0
    out["reference_center"] = reference_center
    strength = out["teammate_strength_score"]
    raw_adj = (reference_center - strength) / 10.0
    out["teammate_adjustment_unclipped"] = raw_adj
    out["teammate_adjustment"] = raw_adj.clip(-TEAMMATE_ADJ_CAP, TEAMMATE_ADJ_CAP)
    out.loc[strength.isna(), "teammate_adjustment"] = 0.0
    out["adjustment_clipped"] = (raw_adj.abs() > TEAMMATE_ADJ_CAP).fillna(False)
    out["adjustment_direction"] = np.where(
        out["teammate_adjustment"] > 0.1, "bonus (weak cast)",
        np.where(out["teammate_adjustment"] < -0.1, "penalty (strong cast)",
                 "neutral"))
    out["teammate_strength_score"] = out["teammate_strength_score"].round(1)
    return out
