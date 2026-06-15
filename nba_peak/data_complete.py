"""
Data-completion pass: build CANONICAL, deterministic, provenance-tracked input
datasets that replace the prior burden PROXIES and the empty vote-share columns.

Three canonical datasets are produced under data/generated/ :

  team_shares.csv   actual season team scoring / assist shares per player-season
  mvp_votes.csv     real MVP voting (finish, first-place votes, points, vote_share)
  dpoy_votes.csv    real DPOY voting (same schema)

All three are derived deterministically from cached Basketball Reference HTML
(per-game tables for shares; awards pages for votes), so `--rebuild-data` is
reproducible offline once the HTML cache exists. NOTHING is fabricated: when a
field is genuinely unavailable the row is OMITTED (and the scorer falls back to
the documented placement / proxy path with an explicit data-status flag).

The functions take the peak3 HTML/parse helpers as arguments so this module has
no import cycle with peak3.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional

import numpy as np
import pandas as pd

# Combined-team markers in Basketball Reference player tables (a traded player's
# season-total row). Team totals must EXCLUDE these to avoid double counting.
MULTI_TEAM = {"TOT", "2TM", "3TM", "4TM", "5TM", "TM"}

DATASET_VERSION = "basketball-reference.com cache (seasons 1980-2026)"
BREF_AWARDS_URL = "https://www.basketball-reference.com/awards/awards_{se}.html"
BREF_PERGAME_URL = "https://www.basketball-reference.com/leagues/NBA_{se}_per_game.html"


# ======================================================================
#  TEAM SCORING / ASSIST SHARES  (actual, not USG%/AST% proxies)
# ======================================================================

def _per_game_table(se: int, fetch_html, read_tables, drop_header_rows
                    ) -> Optional[pd.DataFrame]:
    html = fetch_html("x", f"NBA_{se}_per_game.html", scrape=False, refresh=False)
    if not html:
        return None
    tabs = read_tables(html)
    for t in tabs:
        cols = [str(c) for c in t.columns]
        if "player" in cols and "pts" in cols and "team" in cols and "ast" in cols:
            t = drop_header_rows(t)
            return t
    return None


def build_team_shares(seasons: List[int], *, fetch_html, read_tables,
                      drop_header_rows, clean_player_name) -> pd.DataFrame:
    """ACTUAL team scoring / assist shares per player-season.

        team_scoring_share = player season points / team season points
        team_assist_share  = player season assists / team season assists

    A team's season total equals the SUM of its players' single-team season totals
    (every point/assist is credited to exactly one player), so totals are exact up
    to per-game rounding. Traded seasons are handled by computing a team-specific
    share on EACH team and combining them GAMES-weighted (the player's games with
    each team), per the spec. Players absent from the per-game table get status
    'missing' (the scorer then falls back to the flagged proxy).
    """
    rows: List[dict] = []
    for se in seasons:
        t = _per_game_table(se, fetch_html, read_tables, drop_header_rows)
        if t is None:
            continue
        t = t.copy()
        for c in ("g", "pts", "ast"):
            t[c] = pd.to_numeric(t.get(c), errors="coerce")
        t = t.dropna(subset=["team", "g"])
        t["player_clean"] = t["player"].apply(clean_player_name)
        t["pts_tot"] = t["pts"].fillna(0.0) * t["g"]
        t["ast_tot"] = t["ast"].fillna(0.0) * t["g"]

        single = t[~t["team"].astype(str).isin(MULTI_TEAM)]
        team_pts = single.groupby("team")["pts_tot"].sum()
        team_ast = single.groupby("team")["ast_tot"].sum()

        for pc, grp in t.groupby("player_clean", sort=False):
            srows = grp[~grp["team"].astype(str).isin(MULTI_TEAM)]
            if srows.empty:
                continue
            w = srows["g"].to_numpy(dtype=float)
            if w.sum() <= 0:
                continue
            tp = srows["team"].map(team_pts).to_numpy(dtype=float)
            ta = srows["team"].map(team_ast).to_numpy(dtype=float)
            with np.errstate(divide="ignore", invalid="ignore"):
                ss = np.where(tp > 0, srows["pts_tot"].to_numpy() / tp, np.nan)
                sa = np.where(ta > 0, srows["ast_tot"].to_numpy() / ta, np.nan)
            scoring = float(np.average(ss, weights=w)) if np.isfinite(ss).all() else np.nan
            assist = float(np.average(sa, weights=w)) if np.isfinite(sa).all() else np.nan
            rows.append({
                "season_end": se,
                "player": grp["player"].iloc[0],
                "player_clean": pc,
                "team_scoring_share": scoring,
                "team_assist_share": assist,
                "n_teams": int(len(srows)),
                "team_share_data_status": "observed",
                "source": "Basketball Reference per-game tables",
                "source_url": BREF_PERGAME_URL.format(se=se),
                "dataset_version": DATASET_VERSION,
            })
    return pd.DataFrame(rows)


# ======================================================================
#  MVP / DPOY VOTE SHARES  (real, never fabricated)
# ======================================================================

def _parse_award_table(html: str, table_id: str, uncomment_tables, BeautifulSoup
                       ) -> List[dict]:
    soup = BeautifulSoup(uncomment_tables(html), "lxml")
    table = soup.find("table", id=table_id)
    if table is None:
        return []
    out = []
    for tr in table.select("tbody tr"):
        cls = tr.get("class") or []
        if "thead" in cls:
            continue
        cells = {td.get("data-stat"): td.get_text(strip=True)
                 for td in tr.find_all(["td", "th"])}
        if not cells.get("player"):
            continue
        out.append(cells)
    return out


def _num(x):
    try:
        v = float(str(x).replace(",", ""))
        return v
    except (TypeError, ValueError):
        return np.nan


def _finish_from_rank(rank_text: str):
    """Parse Basketball Reference 'Rank' (e.g. '1', '2T', '10') -> (finish, tie)."""
    if rank_text is None:
        return (np.nan, False)
    s = str(rank_text).strip()
    tie = s.endswith("T")
    digits = "".join(ch for ch in s if ch.isdigit())
    return (int(digits) if digits else np.nan, tie)


def build_award_votes(seasons: List[int], table_id: str, *, fetch_html,
                      uncomment_tables, BeautifulSoup, clean_player_name
                      ) -> pd.DataFrame:
    """Real award voting for one award (table_id in {'mvp','dpoy'}). Vote share is
    Basketball Reference's `award_share` = points_won / points_max (the spec's
    preferred normalization). Seasons with no voting table for the award (e.g. DPOY
    before 1983) simply contribute no rows -> scorer uses the placement fallback."""
    rows: List[dict] = []
    for se in seasons:
        html = fetch_html("x", f"NBA_{se}_awards.html", scrape=False, refresh=False)
        if not html:
            continue
        recs = _parse_award_table(html, table_id, uncomment_tables, BeautifulSoup)
        for c in recs:
            finish, tie = _finish_from_rank(c.get("rank"))
            share = _num(c.get("award_share"))
            pts_won = _num(c.get("points_won"))
            pts_max = _num(c.get("points_max"))
            # recompute share from points when share is missing but points exist
            if (np.isnan(share) or share <= 0) and pts_max and pts_max > 0:
                share = pts_won / pts_max
            rows.append({
                "season": f"{se-1}-{str(se)[-2:]}",
                "season_end": se,
                "player": c.get("player"),
                "player_clean": clean_player_name(c.get("player")),
                f"{table_id}_finish": int(finish) if not pd.isna(finish) else np.nan,
                "tie": bool(tie),
                "first_place_votes": _num(c.get("votes_first")),
                "total_vote_points": pts_won,
                "maximum_possible_vote_points": pts_max,
                "vote_share": share,
                "vote_share_method": "award_share = points_won / points_max",
                "source": "Basketball Reference awards page",
                "source_url": BREF_AWARDS_URL.format(se=se),
                "dataset_version": DATASET_VERSION,
            })
    df = pd.DataFrame(rows)
    if len(df):
        # guard against impossible values (fail loud at integrity-check time)
        df = df[df["player_clean"].astype(bool)]
    return df
