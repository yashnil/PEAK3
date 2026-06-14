"""
Postseason context derivation (deterministic, from Basketball Reference
playoff season pages).

ONE page per season (`/playoffs/NBA_{year}.html`) enriches every team and
player in that season at once.  From the series bracket we derive, for each
team-season that reached the playoffs:

  * round reached (categorical + 0-100 score)
  * championship / finals_appearance / conf_finals flags
  * series wins/losses, games won/lost
  * opponent quality (from opponents' regular-season strength)
  * playoff path difficulty
  * series-success composite
  * elite opponents beaten / upsets

Plus the season's Finals MVP (objective historical fact).

Everything here is a deterministic derivation from structured bracket data,
so confidence is high.  If a page is missing the bracket, the season is
skipped and the caller falls back to neutral with low confidence.
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

# Canonical round depth.  BR normalizes older division formats into these.
ROUND_DEPTH = {
    "First Round": 1,
    "Conference Semifinals": 2,
    "Conference Finals": 3,
    "Finals": 4,
}
# Round-reached -> 0-100 (loss in that round, unless champion).
ROUND_LOSS_SCORE = {0: 10.0, 1: 30.0, 2: 50.0, 3: 70.0, 4: 85.0}
CHAMPION_SCORE = 100.0


def _canonical_round(label: str) -> Optional[str]:
    if not label:
        return None
    t = label.strip()
    t = re.sub(r"^(Eastern|Western)\s+", "", t)
    t = re.sub(r"^(Eastern|Western)\s+Division\s+", "", t)
    if "Finals" == t or t == "World Championship Series":
        return "Finals"
    if "Conference Finals" in t or t == "Division Finals":
        return "Conference Finals"
    if "Semifinals" in t:
        return "Conference Semifinals"
    if "First Round" in t or "Quarterfinals" in t:
        return "First Round"
    if t == "Finals":
        return "Finals"
    return None


SERIES_RE = re.compile(r"\((\d+)-(\d+)\)")


def parse_playoff_series(soup_uncommented, season_end: int) -> List[Dict]:
    """
    Returns a list of series dicts:
      {round, round_depth, winner, loser, w, l}
    `soup_uncommented` is a BeautifulSoup over comment-expanded HTML.
    """
    node = soup_uncommented.find(id="all_playoffs")
    if node is None:
        return []

    series: List[Dict] = []
    last_round = None
    for el in node.descendants:
        name = getattr(el, "name", None)
        if name in ("h2", "h3", "strong", "span"):
            t = el.get_text(" ", strip=True)
            if (t and len(t) < 45 and "over" not in t and
                    re.search(r"Finals|Round|Semifinals|Conference|Division|Quarterfinals", t)):
                cr = _canonical_round(t)
                if cr:
                    last_round = cr
        if name == "td":
            t = el.get_text(" ", strip=True)
            if " over " in t and SERIES_RE.search(t) and len(t) < 90:
                links = el.find_all("a", href=re.compile(r"/teams/[A-Z]{3}/\d{4}"))
                if len(links) >= 2:
                    abbrs = [re.search(r"/teams/([A-Z]{3})/", a["href"]).group(1)
                             for a in links]
                    m = SERIES_RE.search(t)
                    w, l = int(m.group(1)), int(m.group(2))
                    rnd = last_round or "First Round"
                    series.append({
                        "round": rnd, "round_depth": ROUND_DEPTH.get(rnd, 1),
                        "winner": abbrs[0], "loser": abbrs[1], "w": w, "l": l,
                    })
    return series


def parse_finals_mvp(soup_uncommented) -> Optional[str]:
    for el in soup_uncommented.find_all(["p", "div", "li", "span", "strong"]):
        t = el.get_text(" ", strip=True)
        if t.startswith("Finals MVP") or "Finals MVP:" in t:
            a = el.find("a", href=re.compile(r"/players/"))
            if a:
                return a.get_text(strip=True)
    return None


def _team_records(series: List[Dict]) -> Dict[str, Dict]:
    """Aggregate per-team series participation for one season."""
    teams: Dict[str, Dict] = {}

    def rec(team):
        return teams.setdefault(team, {
            "deepest_depth": 0, "deepest_round": "Missed playoffs",
            "won_deepest": False, "series_wins": 0, "series_losses": 0,
            "games_won": 0, "games_lost": 0,
            "opponents": [],  # (opp, depth, won_series, opp_games, self_games)
        })

    champion = None
    for s in series:
        w, l, depth, rnd = s["winner"], s["loser"], s["round_depth"], s["round"]
        if depth == ROUND_DEPTH["Finals"]:
            champion = w
        rw = rec(w)
        rl = rec(l)
        rw["series_wins"] += 1
        rw["games_won"] += s["w"]
        rw["games_lost"] += s["l"]
        rw["opponents"].append((l, depth, True, s["l"], s["w"]))
        rl["series_losses"] += 1
        rl["games_won"] += s["l"]
        rl["games_lost"] += s["w"]
        rl["opponents"].append((w, depth, False, s["w"], s["l"]))
        for team, won in ((w, True), (l, False)):
            r = teams[team]
            # A team's "reach" extends one past a series it won.
            reach = depth + 1 if won else depth
            if reach > r["deepest_depth"]:
                r["deepest_depth"] = reach
                r["deepest_round"] = ("Champion" if (won and depth == 4)
                                      else s["round"])
                r["won_deepest"] = won
    return teams, champion


def _pct_rank(values: pd.Series) -> pd.Series:
    v = pd.to_numeric(values, errors="coerce")
    return v.rank(pct=True) * 100.0


def derive_team_postseason(series: List[Dict], teams_df: pd.DataFrame,
                           season_end: int) -> pd.DataFrame:
    """
    Build a per-team-season DataFrame of postseason context for one season.
    `teams_df` is the season's team-ratings slice (team, srs, net, wins...).
    """
    teams, champion = _team_records(series)
    if not teams:
        return pd.DataFrame()

    # Per-season opponent-strength percentiles from regular-season ratings.
    tdf = teams_df.copy()
    if len(tdf):
        tdf["winpct"] = (pd.to_numeric(tdf.get("team_wins"), errors="coerce") /
                         (pd.to_numeric(tdf.get("team_wins"), errors="coerce") +
                          pd.to_numeric(tdf.get("team_losses"), errors="coerce")))
        tdf["srs_pct"] = _pct_rank(tdf.get("team_srs"))
        tdf["net_pct"] = _pct_rank(tdf.get("team_net_rtg"))
        tdf["win_pct_rank"] = _pct_rank(tdf["winpct"])
        # Defense: lower drtg is better -> invert.
        if "team_drtg" in tdf.columns and tdf["team_drtg"].notna().any():
            tdf["def_pct"] = 100.0 - _pct_rank(tdf["team_drtg"])
        else:
            tdf["def_pct"] = np.nan
        strength = tdf.set_index("team")
    else:
        strength = pd.DataFrame()

    def opp_strength(team):
        if team in strength.index:
            r = strength.loc[team]
            comps = {"srs": r.get("srs_pct"), "net": r.get("net_pct"),
                     "win": r.get("win_pct_rank"), "def": r.get("def_pct")}
            ws = {"srs": 0.45, "net": 0.25, "win": 0.18, "def": 0.12}
            num = den = 0.0
            for k, w in ws.items():
                v = comps[k]
                if pd.notna(v):
                    num += w * float(v); den += w
            return num / den if den else np.nan
        return np.nan

    rows = []
    for team, r in teams.items():
        depth = r["deepest_depth"]
        is_champ = (team == champion)
        # round score
        if is_champ:
            round_score = CHAMPION_SCORE
            round_cat = "Champion"
            reached_depth = 4
        else:
            reached_depth = min(depth, 4)
            # team lost in round = reached_depth
            round_score = ROUND_LOSS_SCORE.get(reached_depth, 30.0)
            round_cat = r["deepest_round"]

        # opponent quality: series-weighted average opponent strength
        opp_vals, later_bonus, elite, upsets = [], 0.0, 0, 0
        for (opp, sdepth, won, opp_g, self_g) in r["opponents"]:
            ov = opp_strength(opp)
            if pd.notna(ov):
                opp_vals.append((ov, sdepth))
                if ov >= 80:
                    if won:
                        elite += 1
            # later-round opponents are tougher: small additive bonus
            later_bonus += (sdepth - 1) * 1.5
            # upset detection: beat a clearly stronger team
            sv = opp_strength(team)
            if won and pd.notna(ov) and pd.notna(sv) and ov - sv >= 20:
                upsets += 1
        if opp_vals:
            # weight later rounds a bit more
            wsum = sum(d for _, d in opp_vals)
            oq = sum(v * d for v, d in opp_vals) / wsum if wsum else np.nan
            oq = float(np.clip(oq + min(later_bonus, 8.0) * 0.5, 0, 100))
        else:
            oq = np.nan

        # path difficulty: average opponent strength scaled by how far they went
        if opp_vals:
            avg_opp = np.mean([v for v, _ in opp_vals])
            path = float(np.clip(avg_opp * (0.6 + 0.1 * reached_depth) +
                                 elite * 3.0, 0, 100))
        else:
            path = np.nan

        # series success composite
        total_series = r["series_wins"] + r["series_losses"]
        series_winpct = (r["series_wins"] / total_series * 100.0
                         if total_series else 0.0)
        if is_champ:
            champ_result = 100.0
        elif reached_depth == 4:
            champ_result = 70.0   # finals loss
        elif reached_depth == 3:
            champ_result = 45.0
        else:
            champ_result = 20.0
        upset_value = float(np.clip(50.0 + upsets * 18.0 + elite * 8.0, 0, 100))
        series_success = (0.45 * round_score + 0.25 * series_winpct +
                          0.15 * upset_value + 0.15 * champ_result)

        rows.append({
            "season_end": season_end,
            "team": team,
            "playoff_round": round_cat,
            "playoff_round_score": round(round_score, 1),
            "championship": 1 if is_champ else 0,
            "finals_appearance": 1 if reached_depth >= 4 else 0,
            "conf_finals": 1 if reached_depth >= 3 else 0,
            "series_wins": r["series_wins"],
            "series_losses": r["series_losses"],
            "games_won": r["games_won"],
            "games_lost": r["games_lost"],
            "opponent_quality_score": None if pd.isna(oq) else round(oq, 1),
            "playoff_path_difficulty": None if pd.isna(path) else round(path, 1),
            "elite_opponents_beaten": elite,
            "upsets": upsets,
            "series_success_score": round(float(np.clip(series_success, 0, 100)), 1),
        })
    return pd.DataFrame(rows)
