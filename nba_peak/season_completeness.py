"""
Season-completeness audit (field-by-field) for a COMPLETED season.

Primary use: the 2025-26 season (season_end=2026) is treated as a completed
season for this project (its regular season, playoffs and awards are over).
Before any 2025-26 player-season is allowed into an OFFICIAL one-, three- or
five-year leaderboard window, this module verifies -- field by field -- that the
required regular-season, award, postseason, team and advanced-stat data are
actually present, and classifies every field as:

    observed        real value sourced from the dataset
    derived         value present but produced by a documented fallback/estimate
    not_applicable  the field legitimately does not apply to this player-season
                    (e.g. not in the MVP voting, missed the playoffs, did not win
                    Finals MVP) -- this is NOT missing data
    missing         a value that SHOULD be present is silently absent (failure)

Missing data is NEVER treated as zero. `assert_no_silent_missing` fails the
official rebuild if any required field is classified `missing` for a player-season
that would enter a leaderboard (i.e. a non-provisional season).

Read-only: imports nothing from peak3 and changes no score.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

OBSERVED, DERIVED, NA, MISSING = "observed", "derived", "not_applicable", "missing"

# field -> category, used to group the report
REGULAR_BOX = ["g", "mp", "pts_per100", "trb_per100", "ast_per100",
               "stl_per100", "blk_per100"]
ADVANCED = ["bpm", "obpm", "dbpm", "vorp", "ws_per_48", "per", "ts_pct", "usg_pct"]
TEAM_SHARE = ["team_scoring_share", "team_assist_share", "n_teams"]
PLAYOFF = ["po_mp", "po_g", "po_bpm", "po_pts", "po_ws_per_48", "po_per"]

# awards that are single-holder / single-selection season EVENTS: present at the
# season level means every non-recipient is `not_applicable` (not missing).
SEASON_AWARD_FLAGS = ["all_nba_team", "all_defense_team", "finals_mvp",
                      "scoring_title", "assist_title", "rebound_title",
                      "steals_title", "blocks_title"]


def _present(v) -> bool:
    return v is not None and not (isinstance(v, float) and np.isnan(v)) and pd.notna(v)


def _status_simple(row: pd.Series, field: str) -> str:
    """observed if the value is present, else missing (used for fields that MUST
    exist for every qualified player-season: regular box + advanced)."""
    return OBSERVED if _present(row.get(field)) else MISSING


def _status_team_share(row: pd.Series, field: str) -> str:
    st = str(row.get("team_share_data_status", "")).lower()
    if not _present(row.get(field)):
        return MISSING
    if st == "observed":
        return OBSERVED
    # a documented USG%/AST% proxy fallback is a DERIVED value, not missing
    return DERIVED


def _status_vote(row: pd.Series, status_col: str, share_col: str) -> str:
    st = str(row.get(status_col, "")).lower()
    if st == "observed":
        return OBSERVED
    if st == "fallback":       # ranked in the voting but share via placement curve
        return DERIVED
    if st == "none":           # not in the voting at all -> field does not apply
        return NA
    # unknown status: classify by the share itself
    return OBSERVED if _present(row.get(share_col)) else NA


def _season_award_present(df: pd.DataFrame, field: str) -> bool:
    """Did this season record the award/selection at all (>=1 recipient)?"""
    if field not in df.columns:
        return False
    vals = pd.to_numeric(df[field], errors="coerce").fillna(0.0)
    return bool((vals != 0).any())


def _status_playoff(row: pd.Series, field: str) -> str:
    made = bool(row.get("made_playoffs", False))
    if not made:
        return NA                       # missed the playoffs: field does not apply
    return OBSERVED if _present(row.get(field)) else MISSING


def field_status_long(scored: pd.DataFrame, season_end: int = 2026) -> pd.DataFrame:
    """Long-form (player-season x field) status table for one season."""
    s = scored[scored["season_end"] == season_end].copy()
    if not len(s):
        return pd.DataFrame(columns=["player", "season_end", "category", "field",
                                     "status", "value"])
    award_present = {f: _season_award_present(s, f) for f in SEASON_AWARD_FLAGS}
    rows: List[dict] = []

    def add(r, cat, field, status):
        rows.append({"player": r.get("player"), "season_end": season_end,
                     "category": cat, "field": field, "status": status,
                     "value": r.get(field)})

    for _, r in s.iterrows():
        for f in REGULAR_BOX:
            add(r, "regular_box", f, _status_simple(r, f))
        for f in ADVANCED:
            add(r, "advanced", f, _status_simple(r, f))
        for f in TEAM_SHARE:
            if f == "n_teams":
                add(r, "team", f, OBSERVED if _present(r.get(f)) else MISSING)
            else:
                add(r, "team", f, _status_team_share(r, f))
        add(r, "awards", "mvp_vote_share",
            _status_vote(r, "mvp_vote_data_status", "mvp_vote_share"))
        add(r, "awards", "dpoy_vote_share",
            _status_vote(r, "dpoy_vote_data_status", "dpoy_vote_share"))
        for f in SEASON_AWARD_FLAGS:
            if not award_present[f]:
                # the season recorded NO recipient for this award -> silently
                # missing for everyone (a completed season must have a holder)
                add(r, "awards", f, MISSING)
            else:
                won = _present(r.get(f)) and float(pd.to_numeric(
                    r.get(f), errors="coerce") or 0.0) != 0.0
                add(r, "awards", f, OBSERVED if won else NA)
        for f in PLAYOFF:
            add(r, "postseason", f, _status_playoff(r, f))
        add(r, "postseason", "playoff_round_score",
            _status_playoff(r, "playoff_round_score"))
        add(r, "status", "provisional",
            OBSERVED if _present(r.get("provisional")) else MISSING)
    return pd.DataFrame(rows)


def completeness_summary(scored: pd.DataFrame, season_end: int = 2026
                         ) -> pd.DataFrame:
    """One row per field: counts of observed/derived/not_applicable/missing plus
    the list of players with a `missing` classification (the failure cases)."""
    lf = field_status_long(scored, season_end)
    if not len(lf):
        return pd.DataFrame()
    out = []
    for (cat, field), g in lf.groupby(["category", "field"], sort=False):
        vc = g["status"].value_counts().to_dict()
        miss = sorted(g.loc[g["status"] == MISSING, "player"].tolist())
        out.append({
            "category": cat, "field": field,
            "observed": vc.get(OBSERVED, 0), "derived": vc.get(DERIVED, 0),
            "not_applicable": vc.get(NA, 0), "missing": vc.get(MISSING, 0),
            "n_player_seasons": len(g),
            "missing_players": "; ".join(miss[:12]) + (
                " ..." if len(miss) > 12 else ""),
        })
    return pd.DataFrame(out)


def missing_required(scored: pd.DataFrame, season_end: int = 2026,
                     only_nonprovisional: bool = True) -> pd.DataFrame:
    """Player-season x field rows classified `missing` (required-but-absent).
    Restricted to non-provisional player-seasons (the ones that enter official
    leaderboards) unless only_nonprovisional=False."""
    lf = field_status_long(scored, season_end)
    if not len(lf):
        return lf
    miss = lf[lf["status"] == MISSING].copy()
    if only_nonprovisional and "provisional" in scored.columns:
        nonprov = set(scored.loc[(scored["season_end"] == season_end) &
                                 (scored["provisional"] != 1), "player"])
        miss = miss[miss["player"].isin(nonprov)]
    return miss


def assert_no_silent_missing(scored: pd.DataFrame, season_end: int = 2026) -> None:
    """Fail the official rebuild if any REQUIRED field is silently missing for a
    season that would enter a leaderboard. `not_applicable` (e.g. not in the MVP
    voting) is fine; only genuine `missing` data raises."""
    if season_end not in set(scored.get("season_end", pd.Series(dtype=int))):
        return
    miss = missing_required(scored, season_end, only_nonprovisional=True)
    if len(miss):
        fields = miss.groupby("field")["player"].count().to_dict()
        raise RuntimeError(
            f"Season {season_end-1}-{str(season_end)[-2:]} has silently MISSING "
            f"required data and cannot enter official leaderboards: {fields}. "
            f"Provide the data or mark the season provisional. "
            f"(example rows: {miss.head(5).to_dict('records')})")


def write_report(scored: pd.DataFrame, reports_dir: Path,
                 season_end: int = 2026) -> Path:
    reports_dir.mkdir(parents=True, exist_ok=True)
    summ = completeness_summary(scored, season_end)
    path = reports_dir / f"season_{season_end-1}_{str(season_end)[-2:]}_completeness.csv"
    summ.to_csv(path, index=False)
    return path


def summary_lines(scored: pd.DataFrame, season_end: int = 2026) -> List[str]:
    """Concise text block for outputs.txt."""
    tag = f"{season_end-1}-{str(season_end)[-2:]}"
    s = scored[scored["season_end"] == season_end]
    L = [f"  Season {tag} completeness (season_end={season_end}):"]
    if not len(s):
        L.append(f"    NO {tag} player-seasons present in the scored dataset.")
        return L
    nprov = int((s.get("provisional", pd.Series([0]*len(s))) == 1).sum())
    L.append(f"    player-seasons: {len(s)}  (provisional: {nprov}; "
             f"playoff participants: {int(s.get('made_playoffs', False).sum())})")
    summ = completeness_summary(scored, season_end)
    tot_missing = int(summ["missing"].sum()) if len(summ) else 0
    by_cat = summ.groupby("category")[["observed", "derived", "not_applicable",
                                       "missing"]].sum()
    for cat, row in by_cat.iterrows():
        L.append(f"    {cat:11s}: observed={int(row.observed):5d} "
                 f"derived={int(row.derived):4d} n/a={int(row.not_applicable):5d} "
                 f"missing={int(row.missing):3d}")
    if tot_missing == 0:
        L.append(f"    RESULT: COMPLETE -- 0 required fields silently missing; "
                 f"{tag} may enter official leaderboards.")
    else:
        bad = summ[summ["missing"] > 0][["field", "missing"]].to_dict("records")
        L.append(f"    RESULT: INCOMPLETE -- {tot_missing} silently-missing field "
                 f"values: {bad}; official rebuild MUST fail.")
    return L
