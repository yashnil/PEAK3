"""
Award parsing from the Basketball Reference Awards column (already cached on
the advanced tables).  Produces normalized rank/team/vote fields.

Vote *shares* are not present in the Awards column; we expose ordinal ranks
with a clearly-labelled ordinal fallback.  An optional awards-voting page
could fill vote_share later, but ranks are objective and sufficient.
"""
from __future__ import annotations

import re
from typing import Dict, Optional

import pandas as pd


def _rank(awards, code: str) -> Optional[int]:
    if pd.isna(awards):
        return None
    m = re.search(rf"{code}-(\d+)", str(awards))
    return int(m.group(1)) if m else None


def _has(awards, token: str) -> bool:
    if pd.isna(awards):
        return False
    return token in re.split(r",\s*", str(awards))


def all_nba_team(awards) -> Optional[int]:
    for t, n in (("NBA1", 1), ("NBA2", 2), ("NBA3", 3)):
        if _has(awards, t):
            return n
    return None


def all_defense_team(awards) -> Optional[int]:
    for t, n in (("DEF1", 1), ("DEF2", 2)):
        if _has(awards, t):
            return n
    return None


def mvp_score(rank: Optional[int]) -> float:
    if rank is None:
        return 0.0
    return {1: 100, 2: 75, 3: 62, 4: 48, 5: 48}.get(rank, 30 if rank <= 10 else 12)


def dpoy_score(rank: Optional[int]) -> float:
    if rank is None:
        return 0.0
    return {1: 100, 2: 65, 3: 50}.get(rank, 35 if rank <= 5 else 15)


def parse_awards_row(awards) -> Dict:
    mvp_r = _rank(awards, "MVP")
    dpoy_r = _rank(awards, "DPOY")
    nba = all_nba_team(awards)
    def_ = all_defense_team(awards)
    return {
        "mvp_rank": mvp_r,
        "mvp_vote_share": None,            # not in Awards column
        "mvp_score": mvp_score(mvp_r),
        "dpoy_rank": dpoy_r,
        "dpoy_vote_share": None,
        "dpoy_score": dpoy_score(dpoy_r),
        "all_nba_team": nba,
        "all_defense_team": def_,
        "all_star": 1 if _has(awards, "AS") else 0,
    }
