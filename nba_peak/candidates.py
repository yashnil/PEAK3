"""
Tiered candidate selection for context enrichment.

Mandatory inclusion is the headline rule: EVERY player with at least one All-NBA
selection (First, Second, OR Third Team) since 1979-80 is a candidate, plus
MVP/Finals-MVP/DPOY/All-Defense qualifiers. A statistical-count cutoff
(`--stat-candidate-count`) only limits the *discretionary* Tier-2 pool; it can
never drop a mandatory qualifier.

Tiers:
  1  Mandatory accolade qualifiers (All-NBA / MVP top-5 / Finals MVP / DPOY /
     2x All-Defense First / major title role)
  2  Workload-qualified statistical peak candidates (top-N)
  3  Defensive / context safeguards
  4  User-added candidates (data/user_candidates.csv)

Writes data/generated/candidates.csv and data/generated/candidate_exclusions.csv.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .context.awards import _rank, all_nba_team, all_defense_team, _has


def _pid(player: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(player).lower()).strip("-")


def _accolades(g: pd.DataFrame) -> Dict:
    awards = g.get("awards", pd.Series(dtype=str)).fillna("")
    n1 = sum(1 for a in awards if all_nba_team(a) == 1)
    n2 = sum(1 for a in awards if all_nba_team(a) == 2)
    n3 = sum(1 for a in awards if all_nba_team(a) == 3)
    all_nba = n1 + n2 + n3
    mvp_win = sum(1 for a in awards if _rank(a, "MVP") == 1)
    mvp_top5 = sum(1 for a in awards if (_rank(a, "MVP") or 99) <= 5)
    dpoy_win = sum(1 for a in awards if _rank(a, "DPOY") == 1)
    dpoy_top5 = sum(1 for a in awards if (_rank(a, "DPOY") or 99) <= 5)
    alld1 = sum(1 for a in awards if all_defense_team(a) == 1)
    alld = sum(1 for a in awards if all_defense_team(a) is not None)
    allstar = sum(1 for a in awards if _has(a, "AS"))
    return {"all_nba_selections": all_nba, "all_nba_1": n1,
            "mvp_win": mvp_win, "mvp_top5_count": mvp_top5,
            "dpoy_win": dpoy_win, "dpoy_top5": dpoy_top5,
            "all_defense_1": alld1, "all_defense": alld, "all_star": allstar}


def _best_window(g: pd.DataFrame, col: str, qualified_only: bool = False):
    g = g.sort_values("season_end")
    if qualified_only and "workload_qualified" in g.columns:
        pass  # window math below handles 2-of-3; here we just score peaks
    years = g["season_end"].astype(int).tolist()
    best = None
    for i in range(len(g) - 2):
        y = years[i:i + 3]
        if y != [y[0], y[0] + 1, y[0] + 2]:
            continue
        trio = g.iloc[i:i + 3]
        sc = sorted(trio[col].tolist(), reverse=True)
        peak = 0.40 * sc[0] + 0.35 * sc[1] + 0.25 * sc[2]
        label = f"{trio.iloc[0]['season']} to {trio.iloc[-1]['season']}"
        if best is None or peak > best[0]:
            best = (peak, label)
    return best


def build_candidates(scored: pd.DataFrame, stat_count: int = 100,
                     user_players: Optional[List[str]] = None):
    """Returns (candidates_df, exclusions_df)."""
    user_players = set(user_players or [])
    rows = []
    for player, g in scored.groupby("player"):
        if len(g) < 1:
            continue
        acc = _accolades(g)
        bw_raw = _best_window(g, "stat_total")
        # workload-adjusted peak: average of best window seasons' workload_score
        wq_seasons = int(g.get("workload_qualified", pd.Series([0]*len(g))).sum())
        maxmin = float(np.nanmax(g.get("mp", pd.Series([np.nan])))) if len(g) else np.nan
        maxmpg = float(np.nanmax(g.get("mpg", pd.Series([np.nan])))) if "mpg" in g else np.nan
        maxusg = float(np.nanmax(g.get("usg_pct", pd.Series([np.nan])))) if "usg_pct" in g else np.nan
        maxvorp = float(np.nanmax(g.get("vorp", pd.Series([np.nan])))) if "vorp" in g else np.nan
        role = (g.loc[g["stat_total"].idxmax(), "role"]
                if "role" in g.columns and len(g) else "")
        rows.append({
            "player": player, "player_id": _pid(player),
            "career_start": int(g["season_end"].min()),
            "career_end": int(g["season_end"].max()),
            "raw_preliminary_peak_score": round(bw_raw[0], 2) if bw_raw else np.nan,
            "preliminary_best_window": bw_raw[1] if bw_raw else "",
            "workload_qualified_seasons": wq_seasons,
            "max_minutes": maxmin, "max_mpg": round(maxmpg, 1) if pd.notna(maxmpg) else np.nan,
            "max_usage": round(maxusg, 1) if pd.notna(maxusg) else np.nan,
            "max_vorp": round(maxvorp, 1) if pd.notna(maxvorp) else np.nan,
            "role_classification": role,
            **acc,
        })
    df = pd.DataFrame(rows)
    if not len(df):
        return df, df

    # workload-adjusted peak: penalize peaks with no workload-qualified seasons
    wq = df["workload_qualified_seasons"].clip(0, 3)
    df["workload_adjusted_peak_score"] = (
        df["raw_preliminary_peak_score"] - (3 - wq) * 1.5).round(2)

    # ---- Tier 1: mandatory accolade qualifiers ----
    df["mandatory_all_nba_qualifier"] = df["all_nba_selections"] >= 1
    df["finals_mvp_qualifier"] = False  # filled from context below if available
    df["dpoy_qualifier"] = (df["dpoy_win"] >= 1) | (df["dpoy_top5"] >= 2)
    df["all_defense_qualifier"] = df["all_defense_1"] >= 2
    df["mvp_qualifier"] = (df["mvp_win"] >= 1) | (df["mvp_top5_count"] >= 1)
    tier1 = (df["mandatory_all_nba_qualifier"] | df["dpoy_qualifier"] |
             df["all_defense_qualifier"] | df["mvp_qualifier"])

    # ---- Tier 2: workload-qualified statistical peaks (discretionary count) ----
    stat_pool = df[(df["workload_qualified_seasons"] >= 1)].copy()
    stat_pool = stat_pool.sort_values("workload_adjusted_peak_score",
                                      ascending=False)
    tier2_players = set(stat_pool.head(stat_count)["player"])
    df["statistical_qualifier"] = df["player"].isin(tier2_players)

    # ---- Tier 3: defensive / context safeguards ----
    df["defensive_safeguard"] = (
        (df["all_defense"] >= 1) | (df["dpoy_top5"] >= 1) |
        ((df["role_classification"] == "Defensive anchor") &
         (df["workload_qualified_seasons"] >= 2)))

    # ---- Tier 4: user ----
    df["user_qualifier"] = df["player"].isin(user_players)

    selected = (tier1 | df["statistical_qualifier"] |
                df["defensive_safeguard"] | df["user_qualifier"])

    def tier(r):
        if (r["mandatory_all_nba_qualifier"] or r["mvp_qualifier"] or
                r["dpoy_qualifier"] or r["all_defense_qualifier"]):
            return 1
        if r["statistical_qualifier"]:
            return 2
        if r["defensive_safeguard"]:
            return 3
        if r["user_qualifier"]:
            return 4
        return 0

    df["candidate_tier"] = df.apply(tier, axis=1)

    def reasons(r):
        rs = []
        if r["all_nba_selections"] >= 1:
            rs.append(f"{r['all_nba_selections']}x All-NBA")
        if r["mvp_win"] >= 1:
            rs.append(f"{r['mvp_win']}x MVP")
        elif r["mvp_top5_count"] >= 1:
            rs.append(f"{r['mvp_top5_count']}x MVP top-5")
        if r["dpoy_win"] >= 1:
            rs.append("DPOY")
        elif r["dpoy_top5"] >= 2:
            rs.append("multi DPOY top-5")
        if r["all_defense_1"] >= 2:
            rs.append(f"{r['all_defense_1']}x All-Def 1st")
        if r["statistical_qualifier"]:
            rs.append("top statistical peak")
        if r["defensive_safeguard"] and not rs:
            rs.append("defensive safeguard")
        if r["user_qualifier"]:
            rs.append("user-added")
        return "; ".join(rs) or "—"

    df["selection_reasons"] = df.apply(reasons, axis=1)
    df["context_status"] = "PENDING"

    candidates = df[selected].copy().sort_values(
        ["candidate_tier", "workload_adjusted_peak_score"],
        ascending=[True, False])

    cand_cols = ["player", "player_id", "career_start", "career_end",
                 "mandatory_all_nba_qualifier", "all_nba_selections",
                 "mvp_top5_count", "finals_mvp_qualifier", "dpoy_qualifier",
                 "all_defense_qualifier", "statistical_qualifier",
                 "defensive_safeguard", "user_qualifier", "candidate_tier",
                 "selection_reasons", "preliminary_best_window",
                 "raw_preliminary_peak_score", "workload_adjusted_peak_score",
                 "context_status"]
    candidates = candidates[cand_cols].reset_index(drop=True)

    # ---- Exclusions: notable players NOT selected (highest raw scores) ----
    excluded = df[~selected].copy()

    def role_class(r):
        return r["role_classification"] or "—"

    def excl_reasons(r):
        rs = []
        if r["all_nba_selections"] == 0:
            rs.append("no All-NBA")
        if r["workload_qualified_seasons"] == 0:
            rs.append("no full-workload season")
        if not r["statistical_qualifier"]:
            rs.append("outside top statistical pool")
        return "; ".join(rs) or "—"

    excluded["role_classification"] = excluded.apply(role_class, axis=1)
    excluded["exclusion_reasons"] = excluded.apply(excl_reasons, axis=1)
    excl_cols = ["player", "raw_preliminary_peak_score",
                 "workload_adjusted_peak_score", "max_minutes", "max_mpg",
                 "max_usage", "max_vorp", "all_nba_selections",
                 "role_classification", "exclusion_reasons"]
    exclusions = (excluded[excl_cols]
                  .sort_values("raw_preliminary_peak_score", ascending=False)
                  .reset_index(drop=True))
    return candidates, exclusions


def _exception_score(g: pd.DataFrame, acc: Dict) -> float:
    """
    Strength-of-case score for a NON-All-NBA player to earn an exception slot.
    Rewards genuine individual-impact résumés (Finals MVP/DPOY/All-Def/All-Star,
    elite stat/playoff/defense peaks, sustained value), NOT one-year rate flukes.
    """
    best_stat = float(g["stat_total"].max()) if len(g) else 0.0
    # three-year consistency (best window)
    bw = _best_window(g, "stat_total")
    window = bw[0] if bw else 0.0
    best_def = float(g["defense"].max()) if "defense" in g.columns else 0.0
    best_po = float(g["playoff"].max()) if "playoff" in g.columns else 0.0
    wq = int(g.get("workload_qualified", pd.Series([0] * len(g))).sum())
    score = (
        0.34 * window + 0.20 * best_stat +
        2.2 * min(acc["all_defense_1"], 4) + 1.4 * min(acc["all_defense"], 6) +
        2.0 * min(acc["dpoy_top5"], 4) + 6.0 * acc["dpoy_win"] +
        0.6 * min(acc["all_star"], 10) +
        0.10 * best_def + 0.12 * best_po +
        0.8 * min(wq, 8)
    )
    return round(score, 2)


def build_final_250(scored: pd.DataFrame, target: int = 250):
    """
    Official study population: every All-NBA player (mandatory) plus the
    strongest non-All-NBA exception candidates up to `target`. Returns
    (final_df, exception_report_df, n_all_nba).
    """
    rows = []
    for player, g in scored.groupby("player"):
        acc = _accolades(g)
        bw_s = _best_window(g, "stat_total")
        bw_l = _best_window(g, "legacy_total")
        bs = float(g["stat_total"].max())
        rows.append({
            "player": player, "player_id": _pid(player),
            "career_start": int(g["season_end"].min()),
            "career_end": int(g["season_end"].max()),
            "all_nba_qualifier": acc["all_nba_selections"] >= 1,
            "all_nba_first_count": acc["all_nba_1"],
            "total_all_nba_count": acc["all_nba_selections"],
            "best_preliminary_single_season": round(bs, 1),
            "best_preliminary_three_year_window": round(bw_s[0], 1) if bw_s else np.nan,
            "best_legacy_window": round(bw_l[0], 1) if bw_l else np.nan,
            "exception_score": _exception_score(g, acc),
            "_acc": acc,
        })
    df = pd.DataFrame(rows)
    all_nba = df[df["all_nba_qualifier"]].copy()
    n_all_nba = len(all_nba)

    others = df[~df["all_nba_qualifier"]].copy().sort_values(
        "exception_score", ascending=False)
    slots = max(target - n_all_nba, 0)
    chosen_exc = others.head(slots).copy()

    def routes(r):
        a = r["_acc"]; rs = []
        if a["dpoy_win"]: rs.append("DPOY")
        elif a["dpoy_top5"] >= 2: rs.append("multi DPOY top-5")
        if a["all_defense_1"] >= 2: rs.append(f"{a['all_defense_1']}x All-Def 1st")
        elif a["all_defense"] >= 2: rs.append(f"{a['all_defense']}x All-Def")
        if a["all_star"] >= 3: rs.append(f"{a['all_star']}x All-Star")
        if r["best_preliminary_three_year_window"] >= 72: rs.append("near-All-NBA stat peak")
        return "; ".join(rs) or "elite individual peak"

    all_nba["candidate_type"] = "mandatory_all_nba"
    all_nba["exception_routes"] = ""
    all_nba["exception_rank"] = 0
    chosen_exc["candidate_type"] = "exception"
    chosen_exc["exception_routes"] = chosen_exc.apply(routes, axis=1)
    chosen_exc["exception_rank"] = range(1, len(chosen_exc) + 1)

    final = pd.concat([all_nba, chosen_exc], ignore_index=True)
    final = final.sort_values(
        ["all_nba_qualifier", "best_preliminary_three_year_window"],
        ascending=[False, False]).reset_index(drop=True)
    final["official_rank_seed"] = range(1, len(final) + 1)

    def explain(r):
        if r["all_nba_qualifier"]:
            return f"{r['total_all_nba_count']}x All-NBA (mandatory)"
        return f"exception #{int(r['exception_rank'])}: {r['exception_routes']}"
    final["selection_explanation"] = final.apply(explain, axis=1)

    out_cols = ["official_rank_seed", "player", "player_id", "career_start",
                "career_end", "all_nba_qualifier", "all_nba_first_count",
                "total_all_nba_count", "candidate_type", "exception_rank",
                "exception_routes", "best_preliminary_single_season",
                "best_preliminary_three_year_window", "selection_explanation"]
    final_out = final[out_cols].copy()

    # exception report: all non-All-NBA ranked, included or not
    others["included"] = others["player"].isin(set(chosen_exc["player"]))
    others["exception_routes"] = others.apply(routes, axis=1)
    exc_cols = ["player", "exception_score", "exception_routes",
                "best_preliminary_single_season",
                "best_preliminary_three_year_window", "best_legacy_window",
                "included"]
    exc_report = others[exc_cols].reset_index(drop=True)
    return final_out, exc_report, n_all_nba


def load_or_build_candidates(scored: pd.DataFrame, path: Path,
                             stat_count: int = 100,
                             candidates_file: Path = None,
                             user_players: Optional[List[str]] = None,
                             rebuild: bool = False):
    if candidates_file and Path(candidates_file).exists():
        df = pd.read_csv(candidates_file)
        if "player" in df.columns:
            return df, pd.DataFrame()
    if path.exists() and not rebuild:
        excl = path.parent / "candidate_exclusions.csv"
        return pd.read_csv(path), (pd.read_csv(excl) if excl.exists() else pd.DataFrame())
    cands, excl = build_candidates(scored, stat_count=stat_count,
                                   user_players=user_players)
    path.parent.mkdir(parents=True, exist_ok=True)
    cands.to_csv(path, index=False)
    excl.to_csv(path.parent / "candidate_exclusions.csv", index=False)
    return cands, excl
