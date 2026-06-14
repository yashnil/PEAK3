"""
Inspection and audit CLI commands (candidate lists, candidate/score status,
score audit, teammate audit, candidate audit, anomaly detection, top seasons).

These operate on the already-scored dataframe plus the raw regular parquet, so
they need no network access.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

# Official five-component weights of the open weighted index. Sourced from the
# live model (peak3.OFFICIAL_WEIGHTS) so the score audit reconciles exactly.
def _official_weights():
    import peak3
    return dict(peak3.OFFICIAL_WEIGHTS)


OFFICIAL_WEIGHTS = _official_weights()
# Component -> the per-season component column it weights in the official index.
OFFICIAL_COMPONENTS = {
    "statistical_impact": "statistical_impact",
    "traditional_production": "traditional_production",
    "recognition": "recognition",
    "postseason": "postseason_perf",
    "team_achievement": "team_achievement",
}


def _season_pct(scored: pd.DataFrame, season_end: int, col: str, value) -> float:
    pool = pd.to_numeric(scored[scored["season_end"] == season_end][col],
                         errors="coerce").dropna()
    if not len(pool) or pd.isna(value):
        return float("nan")
    return float(100.0 * (pool <= value).mean())


# --------------------------------------------------------------- candidates ---

def list_candidates(cands: pd.DataFrame, tier: Optional[str] = None,
                    all_nba_only: bool = False) -> int:
    if cands is None or not len(cands):
        print("No candidate list found. Run --build-candidates.")
        return 2
    df = cands.copy()
    if all_nba_only:
        df = df[df["mandatory_all_nba_qualifier"] == True]  # noqa: E712
    if tier:
        tmap = {"mandatory": 1, "1": 1, "2": 2, "3": 3, "4": 4}
        if tier.lower() in tmap:
            df = df[df["candidate_tier"] == tmap[tier.lower()]]
    df = df.sort_values(["candidate_tier", "workload_adjusted_peak_score"],
                        ascending=[True, False])
    cols = ["player", "candidate_tier", "all_nba_selections",
            "selection_reasons", "career_start", "career_end",
            "preliminary_best_window", "raw_preliminary_peak_score",
            "workload_adjusted_peak_score", "context_status"]
    cols = [c for c in cols if c in df.columns]
    print(f"\n{len(df)} candidate(s)"
          + (f" (tier={tier})" if tier else "")
          + (" [All-NBA mandatory]" if all_nba_only else ""))
    with pd.option_context("display.max_rows", None, "display.width", 200):
        print(df[cols].to_string(index=True))
    return 0


def search_player(scored: pd.DataFrame, cands: pd.DataFrame, query: str) -> int:
    from unidecode import unidecode
    q = unidecode(str(query)).lower()
    players = sorted(scored["player"].dropna().unique())
    hits = [p for p in players if q in unidecode(p).lower()]
    cset = set(cands["player"]) if cands is not None and len(cands) else set()
    print(f"\n{len(hits)} match(es) for {query!r}:")
    for p in hits:
        g = scored[scored["player"] == p]
        bw = g["stat_total"].max()
        print(f"  {p:26} seasons={len(g)} bestStatSeason={bw:5.1f} "
              f"candidate={'YES' if p in cset else 'no'}")
    return 0


def list_all_players(scored: pd.DataFrame, cands: pd.DataFrame,
                     out_path: Path) -> int:
    cset = set(cands["player"]) if cands is not None and len(cands) else set()
    rows = []
    for p, g in scored.groupby("player"):
        rows.append({
            "player": p, "seasons": len(g),
            "career_start": int(g["season_end"].min()),
            "career_end": int(g["season_end"].max()),
            "best_stat_season": round(float(g["stat_total"].max()), 1),
            "best_legacy_season": round(float(g["legacy_total"].max()), 1),
            "in_core_dataset": True,
            "in_context_candidate_set": p in cset,
        })
    df = pd.DataFrame(rows).sort_values("best_stat_season", ascending=False)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    print(f"{len(df)} players in core dataset -> {out_path}")
    print(df.head(25).to_string(index=False))
    return 0


def candidate_status(scored: pd.DataFrame, cands: pd.DataFrame,
                     context: Optional[pd.DataFrame], regular: pd.DataFrame,
                     player: str) -> int:
    g = scored[scored["player"] == player]
    if not len(g):
        print(f"{player}: NOT in core dataset (no qualifying season).")
        return 3
    crow = (cands[cands["player"] == player].iloc[0]
            if cands is not None and (cands["player"] == player).any() else None)
    n_reg = int((regular["player"] == player).sum()) if regular is not None else 0
    wq = int(g.get("workload_qualified", pd.Series([0] * len(g))).sum())
    print("\n" + "=" * 64)
    print(f"CANDIDATE / DATA STATUS: {player}")
    print("=" * 64)
    print(f"  In core dataset:            YES ({len(g)} qualifying seasons)")
    print(f"  Regular-season rows:        {n_reg}")
    print(f"  In context candidate set:   {'YES' if crow is not None else 'NO'}")
    if crow is not None:
        print(f"  Candidate tier:             {crow['candidate_tier']}")
        print(f"  Mandatory All-NBA:          {crow['mandatory_all_nba_qualifier']}")
        print(f"  All-NBA selections:         {crow['all_nba_selections']}")
        print(f"  Selection reasons:          {crow['selection_reasons']}")
    print(f"  Workload-qualified seasons: {wq} of {len(g)}")
    if context is not None and len(context):
        c = context[context["player"] == player]
        if len(c):
            made = int(c.get("made_playoffs", pd.Series([0])).sum())
            print(f"  Context-enriched seasons:   {len(c)} "
                  f"({made} postseason)")
            if "context_confidence" in c:
                print(f"  Mean context confidence:    {c['context_confidence'].mean():.2f}")
    # observed/derived/missing summary from scored coverage cols
    for k, lab in (("_cov_observed", "Observed"), ("_cov_estimated", "Derived"),
                   ("_cov_missing", "Missing")):
        if k in g.columns:
            print(f"  {lab} context (sum):        {int(g[k].sum())}")
    return 0


# --------------------------------------------------------------- score audit ---

# Per-metric raw contribution columns carried on the scored frame (open index).
TRACE_METRIC_CONTRIB = [
    ("contrib_bpm", "BPM/OBPM/DBPM consensus"),
    ("contrib_vorp_ws", "VORP + total Win Shares"),
    ("contrib_ws48", "WS/48"),
    ("contrib_per", "PER"),
    ("contrib_scoring", "Scoring value (vol x eff)"),
    ("contrib_efficiency", "Efficiency"),
]


def audit_score(scored: pd.DataFrame, regular: pd.DataFrame, player: str,
                n_seasons: int = 2, trace: bool = False,
                season: str = None) -> int:
    g = scored[scored["player"] == player].sort_values("prime_score",
                                                       ascending=False)
    if not len(g):
        print(f"{player}: not in scored dataset.")
        return 3
    if season:
        g = g[g["season"] == season]
        if not len(g):
            print(f"{player}: no season {season} in scored dataset.")
            return 3
        n_seasons = len(g)
    raw_stats = ["mp", "g", "mpg", "usg_pct", "pts_per100", "ast_per100",
                 "trb_per100", "stocks_per100", "bpm", "obpm", "dbpm", "vorp",
                 "total_ws", "ws_per_48", "per", "ts_pct", "ts_plus", "r_ts"]
    for _, r in g.head(n_seasons).iterrows():
        se = int(r["season_end"])
        print("\n" + "=" * 72)
        print(f"SCORE AUDIT: {player}  {r['season']}  ({r.get('team','')})  "
              f"role={r.get('role','?')}")
        print(f"  PRIME (official)={r['prime_score']:.2f}  "
              f"performance_only={r['performance_only']:.2f}  "
              f"prime_index(raw)={r.get('prime_index', float('nan')):.2f}")
        print(f"  workload_qualified={int(r.get('workload_qualified',0))}  "
              f"provisional={int(r.get('provisional',0))}")
        print("=" * 72)
        print("RAW VALUES (value | season percentile, descriptive only):")
        for s in raw_stats:
            if s in r.index and pd.notna(r.get(s)):
                pctl = _season_pct(scored, se, s, r[s])
                print(f"  {s:14} {float(r[s]):9.3f}   {pctl:5.1f} pct")
        print("\nOFFICIAL OPEN-INDEX CONTRIBUTIONS (component value x weight):")
        total = 0.0
        for comp, col in OFFICIAL_COMPONENTS.items():
            w = OFFICIAL_WEIGHTS[comp]
            val = float(r.get(col) or 0.0)
            pts = w * val
            total += pts
            print(f"  {comp:24} value={val:7.2f}  x {w:.2f}  -> {pts:7.2f}")
        tmadj = float(r.get("teammate_adjustment") or 0.0)
        total += tmadj
        print(f"  {'teammate adjustment':24} {'':19} -> {tmadj:7.2f}")
        print(f"  {'PRIME INDEX (sum of raw contributions)':46} = {total:7.2f}  "
              f"(stored prime_index={r.get('prime_index', float('nan')):.2f})")
        if trace:
            print("\nPER-METRIC RAW CONTRIBUTIONS (inside the components):")
            for col, lab in TRACE_METRIC_CONTRIB:
                if col in r.index and pd.notna(r.get(col)):
                    print(f"  {lab:30} {float(r[col]):7.2f}")
        print("\nNotes: BPM/OBPM/DBPM/VORP/WS/WS48/PER flow through metric-"
              "specific continuous formulas on RAW values (no percentile/landmark "
              "caps). Awards are NOT in performance_only; championships live in "
              "Team Achievement (3%), never in recognition.")
    return 0


# ----------------------------------------------------------- teammate audit ---

def audit_teammates(regular: pd.DataFrame, out_dir: Path,
                    player: Optional[str] = None) -> int:
    from .context.teammates import derive_teammates
    tm = derive_teammates(regular)
    cols = ["player", "season_end", "team", "teammate_strength_score",
            "reference_center", "teammate_adjustment", "top_teammate",
            "top_teammate_value", "second_teammate", "second_teammate_value",
            "supporting_cast_depth", "star_teammate_count",
            "adjustment_direction", "adjustment_clipped", "_teammate_confidence"]
    cols = [c for c in cols if c in tm.columns]
    out_dir.mkdir(parents=True, exist_ok=True)
    tm[cols].to_csv(out_dir / "teammate_audit.csv", index=False)
    lines = ["TEAMMATE ADJUSTMENT AUDIT",
             "Convention: higher strength = stronger cast;",
             "  teammate_adjustment = (reference_center 50 - strength)/10, capped +/-5",
             "  POSITIVE = weak-cast bonus, NEGATIVE = strong-cast penalty.", ""]
    if player:
        sub = tm[tm["player"] == player].sort_values("season_end")
        if not len(sub):
            print(f"{player}: no teammate rows."); return 3
        lines.append(f"=== {player} ===")
        for _, r in sub.iterrows():
            lines.append(
                f"  {int(r['season_end'])} {r.get('team',''):4} "
                f"strength={r['teammate_strength_score']:5.1f} "
                f"adj={r['teammate_adjustment']:+.2f} [{r['adjustment_direction']}] "
                f"top={r.get('top_teammate','')}({r.get('top_teammate_value',0)})")
        # sign sanity
        strong = sub[sub["teammate_strength_score"] >= 70]
        weak = sub[sub["teammate_strength_score"] <= 30]
        if len(strong):
            assert (strong["teammate_adjustment"] <= 0.1).all(), "SIGN BUG"
        if len(weak):
            assert (weak["teammate_adjustment"] >= -0.1).all(), "SIGN BUG"
        lines.append("  [sign check] strong casts -> <=0, weak casts -> >=0: OK")
    txt = "\n".join(lines)
    (out_dir / "teammate_audit.txt").write_text(txt, encoding="utf-8")
    print(txt)
    print(f"\nWrote {out_dir/'teammate_audit.csv'} and .txt")
    return 0


# --------------------------------------------------------- candidate audit ---

def audit_candidates(scored: pd.DataFrame, cands: pd.DataFrame,
                     excl: pd.DataFrame, out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = ["CANDIDATE SELECTION AUDIT", "=" * 50]
    n_core = scored["player"].nunique()
    lines.append(f"Core players:                 {n_core}")
    if cands is not None and len(cands):
        lines.append(f"Total candidates:             {len(cands)}")
        tiers = cands["candidate_tier"].value_counts().sort_index()
        for t, n in tiers.items():
            lines.append(f"  Tier {t}:                     {n}")
        lines.append(f"Mandatory All-NBA:            {int(cands['mandatory_all_nba_qualifier'].sum())}")
        lines.append(f"MVP/Stat qualifiers (T2):     {int((cands['candidate_tier']==2).sum())}")
        lines.append(f"Defensive safeguards (T3):    {int((cands['candidate_tier']==3).sum())}")
        # lowest-scoring mandatory inclusions
        mand = cands[cands["candidate_tier"] == 1].sort_values(
            "raw_preliminary_peak_score")
        lines.append("\nLowest-scoring mandatory inclusions:")
        for _, r in mand.head(8).iterrows():
            lines.append(f"  {r['player']:24} raw={r['raw_preliminary_peak_score']:.1f}"
                         f"  {r['selection_reasons']}")
    if excl is not None and len(excl):
        lines.append("\nHighest-scoring EXCLUDED (discretionary) players:")
        for _, r in excl.head(12).iterrows():
            lines.append(f"  {r['player']:24} raw={r['raw_preliminary_peak_score']:.1f}"
                         f"  [{r.get('role_classification','')}] {r['exclusion_reasons']}")
    txt = "\n".join(lines)
    (out_dir / "candidate_audit.txt").write_text(txt, encoding="utf-8")
    if cands is not None:
        cands.to_csv(out_dir / "candidate_audit.csv", index=False)
    print(txt)
    print(f"\nWrote {out_dir/'candidate_audit.txt'}")
    return 0


# ----------------------------------------------------------- anomaly audit ---

def _anomaly_flags(g: pd.DataFrame, scored: pd.DataFrame) -> List[str]:
    flags = []
    best = g.loc[g["stat_total"].idxmax()]
    peak = float(best["stat_total"])
    all_nba = ("all_nba_team" in g.columns and g["all_nba_team"].notna().any())
    if peak >= 80 and not all_nba:
        flags.append("elite score (>=80) with no All-NBA season")
    if peak >= 78 and ("mpg" in g.columns) and (g["mpg"].max() < 28):
        flags.append("elite score with no season above 28 MPG")
    if peak >= 78 and ("mp" in g.columns) and (g["mp"].max() < 1800):
        flags.append("elite score with no season above 1,800 minutes")
    # rate-dominated: rate_impact >> total_impact
    if {"rate_impact", "total_impact"}.issubset(best.index):
        if best["rate_impact"] - best["total_impact"] > 18:
            flags.append("score leans on per-minute rate over total value")
    if "role" in best.index and best["role"] in (
            "High-impact role player", "Low-minute specialist") and peak >= 76:
        flags.append(f"role-player archetype ({best['role']}) in a high tier")
    if "provisional" in best.index and int(best.get("provisional", 0)) == 1:
        flags.append("peak season is provisional/incomplete")
    if "team_score" in best.index and best["team_score"] >= 85 and peak >= 76:
        flags.append("high team-context contribution")
    return flags


def audit_anomalies(scored: pd.DataFrame, player: Optional[str] = None) -> int:
    if player:
        g = scored[scored["player"] == player]
        if not len(g):
            print(f"{player}: not scored."); return 3
        flags = _anomaly_flags(g, scored)
        print(f"\nANOMALY CHECK: {player}")
        if flags:
            for f in flags:
                print(f"  ⚠ {f}")
        else:
            print("  (no anomalies flagged)")
        return 0
    # global scan among high scorers
    print("\nANOMALY SCAN (players with stat peak >= 76):")
    rows = []
    for p, g in scored.groupby("player"):
        if g["stat_total"].max() >= 76:
            fl = _anomaly_flags(g, scored)
            if fl:
                rows.append((p, round(float(g["stat_total"].max()), 1), "; ".join(fl)))
    rows.sort(key=lambda x: -x[1])
    for p, sc, fl in rows[:30]:
        print(f"  {p:24} peak={sc:5.1f}  {fl}")
    print(f"\n{len(rows)} flagged.")
    return 0


# ----------------------------------------------------------- top seasons ---

# ----- season comparison (Curry 2014-15 vs 2015-16 diagnosis) -----
COMPARE_FIELDS = [
    ("regular_perf", "Regular-Season Performance"),
    ("postseason_perf", "Postseason Individual Performance"),
    ("postseason_availability", "Postseason Availability"),
    ("performance_only", "PERFORMANCE-ONLY SCORE"),
    ("recognition", "Individual Recognition"),
    ("team_achievement", "Team Achievement"),
    ("prime_score", "PRIME SCORE"),
    ("scoring_dominance", "Scoring dominance"),
    ("scoring_volume", "Scoring volume"),
    ("regular_impact", "Advanced impact (combined)"),
    ("role_workload", "Role/workload"),
    ("unanimous_mvp", "Unanimous MVP"),
]
COMPARE_RAW = ["pts_per100", "ts_pct", "ts_plus", "bpm", "vorp", "ws_per_48",
               "per", "usg_pct", "mpg", "po_mp"]


# Raw per-contribution fields for --trace-formula (open-index decomposition).
TRACE_FIELDS = [
    ("contrib_bpm", "  BPM/OBPM/DBPM contribution"),
    ("contrib_vorp_ws", "  VORP + total WS contribution"),
    ("contrib_ws48", "  WS/48 contribution"),
    ("contrib_per", "  PER contribution"),
    ("contrib_statistical_impact", "STATISTICAL IMPACT (45%) contribution"),
    ("contrib_scoring", "  Scoring value contribution"),
    ("contrib_efficiency", "  Efficiency contribution"),
    ("contrib_traditional_production", "TRADITIONAL PRODUCTION (25%) contribution"),
    ("contrib_recognition", "RECOGNITION (20%) contribution"),
    ("contrib_postseason", "POSTSEASON INDIVIDUAL (7%) contribution"),
    ("contrib_team_achievement", "TEAM ACHIEVEMENT (3%) contribution"),
    ("teammate_adjustment", "Teammate adjustment"),
    ("prime_index", "PRIME INDEX (open raw sum)"),
]


def compare_seasons(scored: pd.DataFrame, player: str, s1: str, s2: str,
                    out_dir, trace: bool = False) -> int:
    from pathlib import Path
    g = scored[scored["player"] == player]
    r1 = g[g["season"] == s1]
    r2 = g[g["season"] == s2]
    if not len(r1) or not len(r2):
        print(f"Need both seasons for {player}: {s1}, {s2}")
        return 3
    r1, r2 = r1.iloc[0], r2.iloc[0]
    lines = [f"SEASON COMPARISON: {player}  {s1}  vs  {s2}",
             "=" * 70,
             f"{'metric':32} {s1:>10} {s2:>10} {'diff':>9}"]
    rows = []
    for col, lab in COMPARE_FIELDS:
        if col in r1.index:
            v1, v2 = float(r1.get(col) or 0), float(r2.get(col) or 0)
            lines.append(f"{lab:32} {v1:>10.2f} {v2:>10.2f} {v2-v1:>+9.2f}")
            rows.append({"metric": lab, s1: round(v1, 2), s2: round(v2, 2),
                         "diff_2minus1": round(v2 - v1, 2)})
    lines.append("\nKEY RAW STATS:")
    for col in COMPARE_RAW:
        if col in r1.index and pd.notna(r1.get(col)):
            v1, v2 = float(r1.get(col) or 0), float(r2.get(col) or 0)
            lines.append(f"  {col:14} {v1:>10.3f} {v2:>10.3f}")
            rows.append({"metric": col, s1: round(v1, 3), s2: round(v2, 3),
                         "diff_2minus1": round(v2 - v1, 3)})
    if trace:
        lines.append("\nRAW FORMULA TRACE (open-index contributions, points):")
        lines.append(f"{'contribution':42} {s1:>10} {s2:>10} {'diff':>9}")
        for col, lab in TRACE_FIELDS:
            if col in r1.index:
                v1, v2 = float(r1.get(col) or 0), float(r2.get(col) or 0)
                lines.append(f"{lab:42} {v1:>10.2f} {v2:>10.2f} {v2-v1:>+9.2f}")
                rows.append({"metric": lab.strip(), s1: round(v1, 2),
                             s2: round(v2, 2), "diff_2minus1": round(v2 - v1, 2)})
    # winner + why
    p1, p2 = float(r1["prime_score"]), float(r2["prime_score"])
    winner, loser = (s2, s1) if p2 > p1 else (s1, s2)
    lines.append(f"\nPRIME winner: {winner} ({max(p1,p2):.2f} vs {min(p1,p2):.2f})")
    lines.append("Why:")
    rec_diff = float(r2["recognition"]) - float(r1["recognition"])
    po_diff = float(r2["postseason_perf"]) - float(r1["postseason_perf"])
    reg_diff = float(r2["regular_perf"]) - float(r1["regular_perf"])
    lines.append(f"  - Regular-season performance diff ({s2}-{s1}): {reg_diff:+.1f}")
    lines.append(f"  - Postseason individual diff: {po_diff:+.1f} "
                 f"(availability {float(r1['postseason_availability']):.0f} vs "
                 f"{float(r2['postseason_availability']):.0f})")
    lines.append(f"  - Individual recognition diff: {rec_diff:+.1f} "
                 f"(championship is in Team Achievement, NOT recognition)")
    txt = "\n".join(lines)
    print(txt)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = "curry_2015_vs_2016" if "Curry" in player else \
        f"compare_{player.replace(' ', '_')}_{s1}_{s2}"
    (out_dir / f"{base}_audit.txt").write_text(txt, encoding="utf-8")
    pd.DataFrame(rows).to_csv(out_dir / f"{base}_audit.csv", index=False)
    print(f"\nWrote {out_dir}/{base}_audit.txt + .csv")
    return 0


# ----- season-order sanity audit -----
ORDER_METRICS = ["regular_perf", "postseason_perf", "scoring_dominance",
                 "scoring_volume", "regular_impact", "total_impact",
                 "role_workload", "defense", "playmaking", "recognition",
                 "ts_plus", "bpm", "vorp"]


def audit_career_order(scored: pd.DataFrame, player: str) -> int:
    g = scored[scored["player"] == player].sort_values("season_end")
    if len(g) < 2:
        print(f"{player}: <2 seasons."); return 3
    print(f"\nCAREER-ORDER AUDIT: {player}")
    flagged = 0
    rows = [r for _, r in g.iterrows()]
    for i in range(len(rows)):
        for j in range(len(rows)):
            if i == j:
                continue
            a, b = rows[i], rows[j]   # is a > b in metrics but a ranks lower?
            if a["prime_score"] >= b["prime_score"]:
                continue
            mets = [m for m in ORDER_METRICS if m in a.index and pd.notna(a.get(m))]
            if not mets:
                continue
            wins = sum(1 for m in mets if float(a.get(m) or 0) > float(b.get(m) or 0))
            frac = wins / len(mets)
            if frac >= 0.70:   # supermajority superior yet ranks lower
                flagged += 1
                print(f"  SUSPICIOUS: {a['season']} superior to {b['season']} in "
                      f"{wins}/{len(mets)} individual indicators but Prime "
                      f"{a['prime_score']:.1f} < {b['prime_score']:.1f}.")
                # compensating factor
                comp = []
                if float(b["postseason_perf"]) > float(a["postseason_perf"]) + 3:
                    comp.append(f"{b['season']} had better postseason individual "
                                f"({float(b['postseason_perf']):.0f} vs {float(a['postseason_perf']):.0f})")
                if float(b["team_achievement"]) > float(a["team_achievement"]) + 10:
                    comp.append(f"{b['season']} team achievement higher")
                if float(b["postseason_availability"]) > float(a["postseason_availability"]) + 10:
                    comp.append(f"{a['season']} lower playoff availability (injury)")
                print(f"     Compensating: {'; '.join(comp) or 'none found — REVIEW'}")
    if not flagged:
        print("  No suspicious orderings.")
    return 0


# ----- full career table -----
CAREER_COLS = [("season", "Season", 8), ("team", "Tm", 4), ("g", "G", 4),
               ("mpg", "MPG", 5), ("role", "Role", 22),
               ("regular_perf", "RegPerf", 8), ("postseason_perf", "POPerf", 7),
               ("performance_only", "PerfOnly", 9), ("recognition", "Recog", 6),
               ("team_achievement", "TeamAch", 8), ("prime_score", "PRIME", 7)]


def career_table(scored: pd.DataFrame, player: str) -> int:
    g = scored[scored["player"] == player].sort_values("season_end")
    if not len(g):
        print(f"{player}: not in dataset."); return 3
    cols = [(c, h, w) for c, h, w in CAREER_COLS if c in g.columns]
    print(f"\nCAREER TABLE: {player}")
    print(" ".join(h.ljust(w) for _, h, w in cols))
    for _, r in g.iterrows():
        cells = []
        for c, _h, w in cols:
            v = r.get(c)
            if c in ("season", "team", "role"):
                cells.append(str(v)[:w].ljust(w))
            elif c == "g":
                cells.append((f"{float(v):.0f}" if pd.notna(v) else "-").ljust(w))
            else:
                cells.append((f"{float(v):.1f}" if pd.notna(v) else "-").ljust(w))
        prov = " *prov" if int(r.get("provisional", 0) or 0) else ""
        print(" ".join(cells) + prov)
    return 0


RAW_AUDIT_METRICS = ["pts", "trb", "ast", "bpm", "obpm", "dbpm", "vorp",
                     "ws_per_48", "per", "ts_pct", "usg_pct"]


def audit_raw_model(scored: pd.DataFrame, regular: pd.DataFrame, player: str,
                    n_seasons: int = 2) -> int:
    """Show raw value -> league mean/std -> z-score -> transform, NO percentiles."""
    import peak3
    g = scored[scored["player"] == player].sort_values("prime_score",
                                                        ascending=False)
    if not len(g):
        print(f"{player}: not scored."); return 3
    rr = regular.copy()
    rr["scoring_load"] = pd.to_numeric(rr.get("pts"), errors="coerce") * \
        pd.to_numeric(rr.get("mp"), errors="coerce") / 1000.0
    for _, row in g.head(n_seasons).iterrows():
        se = int(row["season_end"])
        season = rr[(rr["season_end"] == se)]
        qual = season[pd.to_numeric(season["mp"], errors="coerce") >= 1000]
        pr = season[season["player"] == player]
        if not len(pr):
            continue
        pr = pr.iloc[0]
        print("\n" + "=" * 78)
        print(f"RAW-MODEL AUDIT (no percentiles): {player}  {row['season']}  "
              f"Prime={row['prime_score']:.2f}")
        print("=" * 78)
        print(f"{'metric':12} {'raw':>8} {'lgMean':>8} {'lgStd':>7} "
              f"{'rawDiff':>8} {'ratio':>6} {'z':>6} {'cap':>5} {'score':>7}")
        for m in RAW_AUDIT_METRICS + ["scoring_load"]:
            if m not in season.columns:
                continue
            qv = pd.to_numeric(qual[m], errors="coerce").dropna()
            v = pd.to_numeric(pd.Series([pr.get(m)]), errors="coerce").iloc[0]
            if not len(qv) or pd.isna(v):
                continue
            mu, sd = qv.mean(), qv.std()
            z = (v - mu) / sd if sd else 0.0
            zc = max(-peak3.ZSCORE_CAP, min(peak3.ZSCORE_CAP, z))
            sc = float(peak3.z_to_score(zc))
            ratio = v / mu if mu else float("nan")
            print(f"{m:12} {v:>8.2f} {mu:>8.2f} {sd:>7.2f} {v-mu:>8.2f} "
                  f"{ratio:>6.2f} {z:>6.2f} {zc:>5.2f} {sc:>7.1f}")
        print(f"\nTransform: z -> z_to_score (piecewise, cap ±{peak3.ZSCORE_CAP} SD); "
              f"magnitude preserved (z=3->84, z=4->94). NO percentiles in scoring.")
    return 0


def top_seasons(scored: pd.DataFrame, n: int, mode: str,
                include_provisional: bool) -> int:
    col = "legacy_total" if mode == "legacy" else "stat_total"
    df = scored.copy()
    if not include_provisional and "provisional" in df.columns:
        df = df[df["provisional"] != 1]
    df = df.sort_values(col, ascending=False).drop_duplicates(
        ["player", "season"]).head(n)
    show = ["player", "season", col, "role", "regular", "playoff"]
    if mode == "legacy":
        show.append("accolade")
    show += ["team_score", "durability"]
    show = [c for c in show if c in df.columns]
    print(f"\nTOP {n} SINGLE SEASONS ({'LEGACY' if mode=='legacy' else 'STATISTICAL'})"
          + ("" if include_provisional else "  [excludes provisional]"))
    hdr = f"{'#':>3} {'player':24} {'season':9} {col[:6]:>6} {'role':24}"
    print(hdr)
    for i, (_, r) in enumerate(df.iterrows(), 1):
        print(f"{i:>3} {r['player'][:24]:24} {r['season']:9} "
              f"{float(r[col]):6.1f} {str(r.get('role',''))[:24]:24}")
    return 0
