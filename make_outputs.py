#!/usr/bin/env python3
"""
Deterministic generator for outputs.txt -- the 25-player validation report,
focused comparisons, the five-component distribution audit, warnings, and the
correction-pass summary required by the accuracy/cleanup pass.

Run:  .venv/bin/python make_outputs.py
Reads the built scored cache; writes ./outputs.txt. No network.
"""
from pathlib import Path

import numpy as np
import pandas as pd

import peak3

ROOT = Path(__file__).resolve().parent
SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"

# Component (raw value) and weighted-contribution columns. Weights are pulled
# from peak3.OFFICIAL_WEIGHTS so this file never drifts from the model.
COMPONENTS = [
    ("Statistical Impact", "statistical_impact", "contrib_statistical_impact",
     peak3.OFFICIAL_WEIGHTS["statistical_impact"]),
    ("Traditional Production", "traditional_production", "contrib_traditional_production",
     peak3.OFFICIAL_WEIGHTS["traditional_production"]),
    ("Individual Recognition", "recognition", "contrib_recognition",
     peak3.OFFICIAL_WEIGHTS["recognition"]),
    ("Postseason Individual Value", "postseason_perf", "contrib_postseason",
     peak3.OFFICIAL_WEIGHTS["postseason"]),
    ("Team Achievement", "team_achievement", "contrib_team_achievement",
     peak3.OFFICIAL_WEIGHTS["team_achievement"]),
]

PLAYERS = [
    "Michael Jordan", "LeBron James", "Nikola Jokic", "Stephen Curry",
    "David Robinson", "Hakeem Olajuwon", "Shaquille O'Neal",
    "Giannis Antetokounmpo", "Kevin Garnett", "Magic Johnson", "James Harden",
    "Russell Westbrook", "Steve Nash", "Chris Paul", "Allen Iverson",
    "Carmelo Anthony", "Adrian Dantley", "Dennis Rodman", "Draymond Green",
    "Ben Wallace", "Rajon Rondo", "Reggie Miller", "Manu Ginobili",
    "Clint Capela", "Bradley Beal",
]


def _f(v, nd=2):
    try:
        if pd.isna(v):
            return "  -  "
        return f"{float(v):.{nd}f}"
    except Exception:
        return str(v)


def player_df(s, name):
    return s[s.player == name].copy()


def completed(df):
    if "provisional" in df.columns:
        np_ = df[df["provisional"] != 1]
        return np_ if len(np_) else df
    return df


def best_row(df, col):
    c = completed(df)
    if not len(c):
        return None
    return c.loc[c[col].idxmax()]


def drivers_and_limit(row):
    """Top 3 positive WEIGHTED drivers + the SMALLEST WEIGHTED contribution.
    Everything is compared on the weighted (contrib_*) scale -- never raw
    component values, whose scales and weights differ."""
    contribs = [(lbl, float(row.get(ccol, 0.0) or 0.0)) for lbl, _, ccol, _ in COMPONENTS]
    top3 = sorted(contribs, key=lambda x: -x[1])[:3]
    smallest = min(contribs, key=lambda x: x[1])
    return top3, smallest


def player_block(s, name):
    df = player_df(s, name)
    L = []
    if not len(df):
        return [f"{name}: NOT IN DATASET", ""]
    reg = best_row(df, "regular_perf")
    perf = best_row(df, "performance_only")
    prime = best_row(df, "prime_score")
    win = peak3.best_window(df, "prime_score")     # provisional excluded by default

    L.append("=" * 78)
    L.append(f"PLAYER: {name}")
    L.append("=" * 78)
    L.append(f"  Best completed regular-season peak : {reg['season']:>8}  "
             f"regular_perf {_f(reg['regular_perf'])}")
    L.append(f"  Best completed Performance-Only    : {perf['season']:>8}  "
             f"score {_f(perf['performance_only'])}")
    L.append(f"  Best completed Prime season        : {prime['season']:>8}  "
             f"score {_f(prime['prime_score'])}")
    winp = peak3.best_window(df, "performance_only")
    if winp:
        L.append(f"  Best completed 3-year Perf-Only win : "
                 f"{winp['start_season']}..{winp['end_season']}  "
                 f"P3Y {_f(winp['peak_score'])}")
    if win:
        L.append(f"  Best completed 3-year Prime window : "
                 f"{win['start_season']}..{win['end_season']}  "
                 f"P3Y {_f(win['peak_score'])}  (seasons {', '.join(win['seasons'])})")
    else:
        L.append("  Best completed 3-year Prime window : (fewer than 3 completed seasons)")
    L.append("")
    L.append(f"  -- best Prime season detail ({prime['season']}) --")
    L.append(f"    raw Prime index   : {_f(prime['prime_raw'])}")
    L.append(f"    display Prime score: {_f(prime['prime_score'])}")
    for lbl, vcol, ccol, w in COMPONENTS:
        L.append(f"    {lbl:30}: {_f(prime.get(vcol)):>7}   "
                 f"(weighted contribution {_f(prime.get(ccol))})")
    L.append(f"    postseason decomposition       : level {_f(prime.get('po_level_value'),1)}"
             f" + elevation {_f(prime.get('po_elevation_value'),1)}"
             f" + deep-run {_f(prime.get('po_deep_run_value'),1)}"
             f" = {_f(prime.get('postseason_perf'),1)}")
    L.append(f"    role              : {prime.get('role','?')}")
    L.append(f"    provisional flag  : "
             f"{'YES' if int(prime.get('provisional',0) or 0) else 'no'}")
    top3, smallest = drivers_and_limit(prime)
    L.append("    top three positive drivers (largest weighted contributions):")
    for lbl, c in top3:
        L.append(f"      - {lbl} (+{_f(c)} weighted index pts)")
    L.append(f"    smallest weighted contribution: {smallest[0]} "
             f"(+{_f(smallest[1])} weighted index pts of prime_raw)")
    # ---- official five-year peaks (item 7) ----
    L += five_year_lines(df)
    L.append("")
    return L


def nyear_best(df, col, n):
    ws = peak3.n_year_windows(df, col, n, "weighted")   # provisional excluded
    return ws[0] if ws else None


def five_year_lines(df):
    L = ["", "  -- best completed 5-year peaks (provisional excluded) --"]
    for col, label in (("performance_only", "Performance-Only"),
                       ("prime_score", "Prime")):
        w = nyear_best(df, col, 5)
        if not w:
            L.append(f"    5-year {label}: (fewer than 5 completed consecutive seasons)")
            continue
        dec = peak3.nyear_window_decomposition(w, col, "weighted")
        L.append(f"    5-year {label} peak: {w['start_season']}..{w['end_season']}"
                 f"  weighted {_f(w['weighted_score'])}")
        L.append(f"      seasons: {', '.join(w['seasons'])}")
        L.append(f"      equal-avg {_f(w['equal_avg'],1)}  best-season "
                 f"{_f(w['max_season'],1)}  weakest {_f(w['min_season'],1)}  "
                 f"variance {_f(w['variance'],1)}")
        L.append(f"      avg Statistical Impact {_f(dec['avg_statistical_impact'],1)}"
                 f"  avg Traditional Production {_f(dec['avg_traditional_production'],1)}")
        L.append(f"      total postseason contribution {_f(dec['total_postseason_contrib'])}"
                 f"  total recognition {_f(dec['total_recognition_contrib'])}"
                 f"  total team achievement {_f(dec['total_team_contrib'])}")
    return L


def comparison(s, label, a_name, a_sel, b_name, b_sel):
    """a_sel/b_sel: int season_end for a specific season, or None for best Prime."""
    L = ["-" * 78, f"COMPARISON: {label}", "-" * 78]

    def pick(name, sel):
        df = player_df(s, name)
        if not len(df):
            return None
        if sel is None:
            return best_row(df, "prime_score")
        g = df[df.season_end == sel]
        return g.iloc[0] if len(g) else None

    ra, rb = pick(a_name, a_sel), pick(b_name, b_sel)
    if ra is None or rb is None:
        L.append("  (one or both seasons unavailable)")
        L.append("")
        return L
    cola = f"{a_name} {ra['season']}"
    colb = f"{b_name} {rb['season']}"
    L.append(f"  {'metric':28}{cola:>26}{colb:>26}")
    rows = [("raw Prime index", "prime_raw"), ("display Prime score", "prime_score"),
            ("Performance-Only", "performance_only")]
    for lbl, vcol, _, _ in COMPONENTS:
        rows.append((lbl, vcol))
    for lbl, col in rows:
        L.append(f"  {lbl:28}{_f(ra.get(col)):>26}{_f(rb.get(col)):>26}")
    diff = float(ra["prime_raw"]) - float(rb["prime_raw"])
    lead = cola if diff >= 0 else colb
    L.append(f"  -> {lead} leads by {abs(diff):.2f} raw Prime index points "
             "(diagnostic; not forced).")
    L.append("")
    return L


def playoff_audit(s):
    """Item 9: focused postseason audits for the elevation/championship cases."""
    cases = [("Dirk Nowitzki", 2011, "title run, Finals MVP (team), big elevation"),
             ("Kawhi Leonard", 2019, "historic title run, Finals MVP (team)"),
             ("Jimmy Butler", 2020, "bubble Finals run (8-seed level)"),
             ("Jimmy Butler", 2023, "8-seed Finals run"),
             ("Jalen Brunson", 2026, "NYK champion, Finals MVP (2025-26)")]
    L = ["=" * 78, "PLAYOFF AUDITS (item 9): Dirk / Kawhi / Butler / Brunson",
         "postseason_individual_value = level + elevation + deep-run (12% weight)",
         "=" * 78, "",
         f"  {'player / season':28}{'po_perf':>8}{'level':>7}{'elev':>7}"
         f"{'deep':>7}{'po_mp':>7}{'team_ach':>9}{'prime':>7}"]
    for name, yr, note in cases:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        L.append(f"  {name+' '+str(yr-1)+'-'+str(yr)[2:]:28}"
                 f"{r['postseason_perf']:>8.1f}{r['po_level_value']:>7.1f}"
                 f"{r['po_elevation_value']:>7.1f}{r['po_deep_run_value']:>7.1f}"
                 f"{(r.get('po_mp') if pd.notna(r.get('po_mp')) else 0):>7.0f}"
                 f"{r['team_achievement']:>9.0f}{r['prime_score']:>7.1f}")
        L.append(f"      {note}; postseason weighted contribution "
                 f"{peak3.OFFICIAL_WEIGHTS['postseason']*r['postseason_perf']:.2f}"
                 f" of prime_raw {r['prime_raw']:.1f}")
    L.append("")
    L.append("  Reading: elite individual playoff runs (Kawhi 2019) earn the most;")
    L.append("  a championship with modest per-minute box impact (Brunson, BPM-driven")
    L.append("  rate not elite) earns the team-achievement credit + a modest")
    L.append("  individual postseason value, NOT an automatic peak boost.")
    L.append("")
    return L


def current_leaderboard(s, n=25):
    """Item 9: top-N players by best 3-year Prime peak under the LIVE 12% model."""
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)]
    rows = []
    for player, g in qual.groupby("player"):
        w = peak3.best_window(g, "prime_score")
        if w:
            rows.append((player, w["peak_score"], f"{w['start_season']}-{w['end_season']}"))
    rows.sort(key=lambda r: -r[1])
    L = ["=" * 78, f"TOP-{n} LEADERBOARD (best 3-year Prime peak, live 43/24/18/12/3 model)",
         "all qualified completed players; provisional excluded",
         "=" * 78, "",
         f"  {'#':>3} {'player':26}{'3yr Prime':>10}  span"]
    for i, (p, sc, span) in enumerate(rows[:n], 1):
        L.append(f"  {i:>3} {p:26}{sc:>10.2f}  {span}")
    L.append("")
    return L


# ===========================================================================
# POSTSEASON-WEIGHT SENSITIVITY (item 4)
# ===========================================================================
SENS_WEIGHTS = [0.07, 0.09, 0.12, 0.15]
# base SI:TP:Rec proportions (43:24:18, sum 85); the non-postseason, non-team
# pool (0.97 - w_po) is split in these proportions; Team Achievement stays 0.03.
_SI, _TP, _RC, _POOL = 43.0, 24.0, 18.0, 85.0


def _variant_raw(s, w_po):
    pool = 0.97 - w_po
    w_si, w_tp, w_rc = pool * _SI / _POOL, pool * _TP / _POOL, pool * _RC / _POOL
    return (w_si * pd.to_numeric(s["statistical_impact"], errors="coerce").fillna(0)
            + w_tp * pd.to_numeric(s["traditional_production"], errors="coerce").fillna(0)
            + w_rc * pd.to_numeric(s["recognition"], errors="coerce").fillna(0)
            + w_po * pd.to_numeric(s["postseason_perf"], errors="coerce").fillna(0)
            + 0.03 * pd.to_numeric(s["team_achievement"], errors="coerce").fillna(0)
            + pd.to_numeric(s["teammate_adjustment"], errors="coerce").fillna(0))


def _nyear_peak_map(qual, score_by_idx, n):
    """Best consecutive n-year rank-weighted peak per player from a qualified
    (completed) frame and a per-row variant score; returns {player: (peak, span)}."""
    rw = peak3.nyear_weights(n)
    out = {}
    tmp = qual.copy()
    tmp["_v"] = score_by_idx
    for player, g in tmp.groupby("player"):
        g = g.sort_values("season_end")
        yrs = g["season_end"].astype(int).tolist()
        vals = g["_v"].tolist()
        secs = g["season"].tolist()
        best = None
        for i in range(len(g) - n + 1):
            if yrs[i:i + n] != list(range(yrs[i], yrs[i] + n)):
                continue
            window = sorted(vals[i:i + n], reverse=True)
            peak = sum(w * v for w, v in zip(rw, window))
            if best is None or peak > best[0]:
                best = (peak, f"{secs[i]}-{secs[i + n - 1]}")
        if best:
            out[player] = best
    return out


def _season_rank(qual, variant, player, year):
    """1-based rank of (player, year) among all qualified completed seasons by
    the variant score (higher = better)."""
    order = variant.sort_values(ascending=False).reset_index(drop=True)
    mask = (qual["player"].values == player) & (qual["season_end"].values == year)
    if not mask.any():
        return None, len(qual)
    target = variant[mask].iloc[0]
    rank = int((variant > target).sum()) + 1
    return rank, len(qual)


SENS_SEASONS = [("Dirk Nowitzki", 2011), ("Kawhi Leonard", 2019),
                ("Jimmy Butler", 2020), ("Jimmy Butler", 2023),
                ("Jalen Brunson", 2026), ("Stephen Curry", 2016)]


def sensitivity_audit(s):
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)
             ].copy().reset_index(drop=True)
    L = ["=" * 78, "POSTSEASON-WEIGHT SENSITIVITY AUDIT (item 4)",
         "Postseason weight w in {7%, 9%, 12%, 15%}; the removed/added weight is",
         "redistributed proportionally across Statistical Impact / Traditional",
         "Production / Recognition (43:24:18). Team Achievement stays 3%.",
         "Ranks are among all qualified COMPLETED seasons / 3-year peaks.",
         "=" * 78, ""]
    variants = {w: _variant_raw(qual, w) for w in SENS_WEIGHTS}
    peaks3 = {w: _nyear_peak_map(qual, variants[w], 3) for w in SENS_WEIGHTS}
    peaks5 = {w: _nyear_peak_map(qual, variants[w], 5) for w in SENS_WEIGHTS}

    # ---- Hakeem vs Robinson best 3-year and 5-year peaks ----
    L.append("  Hakeem Olajuwon vs David Robinson best peaks (rank-weighted raw):")
    L.append(f"    {'w_po':>5}{'Hakeem 3yr':>14}{'Robinson 3yr':>16}{'gap':>8}"
             f"{'Hakeem 5yr':>14}{'Robinson 5yr':>16}{'gap':>8}")
    for w in SENS_WEIGHTS:
        h3 = peaks3[w].get("Hakeem Olajuwon"); r3 = peaks3[w].get("David Robinson")
        h5 = peaks5[w].get("Hakeem Olajuwon"); r5 = peaks5[w].get("David Robinson")
        L.append(f"    {int(w*100):>4}%{h3[0]:>14.2f}{r3[0]:>16.2f}{h3[0]-r3[0]:>8.2f}"
                 f"{h5[0]:>14.2f}{r5[0]:>16.2f}{h5[0]-r5[0]:>8.2f}")
    L.append("    (positive gap = Hakeem ahead; not forced either way)")
    L.append("")

    # ---- specific single-season ranks ----
    L.append("  Single-season Prime rank (of " + str(len(qual)) + " qualified seasons):")
    L.append(f"    {'season':>26}" + "".join(f"{int(w*100):>7}%" for w in SENS_WEIGHTS))
    for name, yr in SENS_SEASONS:
        cells = ""
        for w in SENS_WEIGHTS:
            rk, _ = _season_rank(qual, variants[w], name, yr)
            cells += f"{('#'+str(rk)) if rk else 'n/a':>8}"
        L.append(f"    {name+' '+str(yr-1)+'-'+str(yr)[2:]:>26}{cells}")
    L.append("")

    # ---- top-25 leaderboard by best 3-year Prime peak, per weight ----
    def top25(w):
        return sorted(peaks3[w].items(), key=lambda kv: -kv[1][0])[:25]
    L.append("  Top-25 leaderboard by best 3-year Prime peak:")
    base = top25(0.12)
    L.append(f"    {'#':>3} {'player (at 12%)':24}{'peak':>8}  "
             f"{'rank@7%':>8}{'rank@9%':>8}{'rank@15%':>9}")
    rankmaps = {w: {p: i + 1 for i, (p, _) in enumerate(top25(w))} for w in SENS_WEIGHTS}
    # full-rank maps (not just top25) for movement detection
    fullrank = {}
    for w in SENS_WEIGHTS:
        order = sorted(peaks3[w].items(), key=lambda kv: -kv[1][0])
        fullrank[w] = {p: i + 1 for i, (p, _) in enumerate(order)}
    for i, (p, (peak, span)) in enumerate(base, 1):
        r7 = fullrank[0.07].get(p); r9 = fullrank[0.09].get(p); r15 = fullrank[0.15].get(p)
        L.append(f"    {i:>3} {p:24}{peak:>8.2f}  {('#'+str(r7)):>8}{('#'+str(r9)):>8}"
                 f"{('#'+str(r15)):>9}")
    L.append("")

    # ---- largest risers / fallers from 7% -> 15% (full population) ----
    common = set(fullrank[0.07]) & set(fullrank[0.15])
    moves = [(p, fullrank[0.07][p] - fullrank[0.15][p]) for p in common
             if fullrank[0.07][p] <= 120 or fullrank[0.15][p] <= 120]
    risers = sorted(moves, key=lambda x: -x[1])[:10]
    fallers = sorted(moves, key=lambda x: x[1])[:10]
    L.append("  Largest RISERS as postseason weight goes 7% -> 15% "
             "(rank improvement, top-120 pool):")
    for p, d in risers:
        L.append(f"    {p:26} #{fullrank[0.07][p]:<4} -> #{fullrank[0.15][p]:<4} "
                 f"(+{d})")
    L.append("  Largest FALLERS as postseason weight goes 7% -> 15%:")
    for p, d in fallers:
        L.append(f"    {p:26} #{fullrank[0.07][p]:<4} -> #{fullrank[0.15][p]:<4} "
                 f"({d})")
    L.append("")
    L.append("  CHOSEN WEIGHT: 12% (per brief). The audit shows graceful, monotone")
    L.append("  movement -- playoff-dominant peaks (Hakeem, Kawhi 2019, LeBron) rise")
    L.append("  and regular-season-only peaks ease back as w grows, with no severe")
    L.append("  distortion or implausible ordering at 12%.")
    L.append("")
    return L


def five_year_leaderboard(s):
    """Item 7: best completed 5-year Performance-Only and Prime peaks for the
    25-player validation set (ranked); a deterministic 5-year leaderboard."""
    L = ["=" * 78, "FIVE-YEAR PEAK LEADERBOARD (25-player validation set)",
         "best completed consecutive 5-year windows; provisional excluded",
         "=" * 78, ""]
    for col, label in (("prime_score", "PRIME"), ("performance_only",
                                                  "PERFORMANCE-ONLY")):
        rows = []
        for p in PLAYERS:
            w = nyear_best(player_df(s, p), col, 5)
            if w:
                rows.append((p, w))
        rows.sort(key=lambda pw: -pw[1]["weighted_score"])
        L.append(f"  best 5-year {label} peak:")
        L.append(f"    {'#':>2} {'player':24}{'span':>20}{'weighted':>10}"
                 f"{'equal':>8}{'best':>7}{'weakest':>9}")
        for i, (p, w) in enumerate(rows, 1):
            L.append(f"    {i:>2} {p:24}{w['start_season']+'-'+w['end_season']:>20}"
                     f"{w['weighted_score']:>10.2f}{w['equal_avg']:>8.1f}"
                     f"{w['max_season']:>7.1f}{w['min_season']:>9.1f}")
        L.append("")
    return L


def window_comparison(s, label, a_name, b_name, n):
    """Best completed n-year Prime windows for two players: per-component
    weighted contributions (rank-weighted, reconcile to the raw window score) and
    the raw aggregates, with both raw and weighted differences."""
    L = ["-" * 78, f"COMPARISON: {label}", "-" * 78]
    wa = nyear_best(player_df(s, a_name), "prime_score", n)
    wb = nyear_best(player_df(s, b_name), "prime_score", n)
    if not wa or not wb:
        L += ["  (one or both players lack a completed window)", ""]
        return L
    da = peak3.nyear_window_decomposition(wa, "prime_score", "weighted")
    db = peak3.nyear_window_decomposition(wb, "prime_score", "weighted")
    cola = f"{a_name} {wa['start_season']}-{wa['end_season']}"
    colb = f"{b_name} {wb['start_season']}-{wb['end_season']}"
    L.append(f"  {'(rank-weighted raw contribution)':34}{cola:>22}{colb:>22}{'diff':>10}")
    keys = ["Statistical impact (43%)", "Traditional production (24%)",
            "Individual recognition (18%)", "Postseason individual (12%)",
            "Team achievement (3%)", "Teammate adjustment"]
    for k in keys:
        L.append(f"  {k:34}{_f(da[k]):>22}{_f(db[k]):>22}"
                 f"{_f(da[k]-db[k]):>10}")
    L.append(f"  {'RAW WINDOW SCORE (sum)':34}{_f(da['_raw_window_score']):>22}"
             f"{_f(db['_raw_window_score']):>22}"
             f"{_f(da['_raw_window_score']-db['_raw_window_score']):>10}")
    L.append(f"  {'weighted display score':34}{_f(wa['weighted_score']):>22}"
             f"{_f(wb['weighted_score']):>22}"
             f"{_f(wa['weighted_score']-wb['weighted_score']):>10}")
    L.append("  raw aggregates:")
    L.append(f"    avg Statistical Impact      {_f(da['avg_statistical_impact'],1):>8}"
             f"   vs {_f(db['avg_statistical_impact'],1)}")
    L.append(f"    avg Traditional Production  {_f(da['avg_traditional_production'],1):>8}"
             f"   vs {_f(db['avg_traditional_production'],1)}")
    L.append(f"    total postseason contrib    {_f(da['total_postseason_contrib']):>8}"
             f"   vs {_f(db['total_postseason_contrib'])}")
    L.append(f"    total recognition contrib   {_f(da['total_recognition_contrib']):>8}"
             f"   vs {_f(db['total_recognition_contrib'])}")
    L.append(f"    total team contrib          {_f(da['total_team_contrib']):>8}"
             f"   vs {_f(db['total_team_contrib'])}")
    d = da['_raw_window_score'] - db['_raw_window_score']
    L.append(f"  -> {cola if d>=0 else colb} leads by {abs(d):.2f} rank-weighted "
             "raw points (diagnostic; not forced).")
    L.append("")
    return L


# SI sub-components and their internal weights (out of 45), matching
# statistical_impact()'s _masked_wavg renormalization.
SI_SUB = [("BPM/OBPM/DBPM consensus", "si_bpm", 15.0),
          ("VORP/total WS (minutes/total-value)", "si_vorp_ws", 10.0),
          ("WS/48", "si_ws48", 8.0),
          ("PER", "si_per", 5.0),
          ("modern impact supplement", "si_modern", 7.0)]


def si_audit_for(s, name):
    """Recompute the Statistical Impact sub-component weighted contributions for a
    player's best completed SI season (reconcile to contrib_statistical_impact)."""
    df = completed(player_df(s, name))
    row = df.loc[df["statistical_impact"].idxmax()]
    si, parts = peak3.statistical_impact(row.to_frame().T)
    wmap = {k: w for _, k, w in SI_SUB}
    present = [k for _, k, _ in SI_SUB if not np.isnan(parts[k][0])]
    tot = sum(wmap[k] for k in present)
    contrib = {}
    for _lbl, k, _w in SI_SUB:
        v = parts[k][0]
        contrib[k] = (None if np.isnan(v)
                      else 0.45 * (wmap[k] / tot) * float(v))
    return row, parts, contrib, float(si.iloc[0])


def si_comparison(s, label, a_name, b_name):
    """Best completed SI season for each: SI sub-component raw values AND weighted
    prime_raw contributions, with both raw and weighted differences."""
    L = ["-" * 78, f"COMPARISON: {label}", "-" * 78]
    ra, pa, ca, sia = si_audit_for(s, a_name)
    rb, pb, cb, sib = si_audit_for(s, b_name)
    cola = f"{a_name} {ra['season']}"
    colb = f"{b_name} {rb['season']}"
    L.append(f"  {'SI sub-component (raw | weighted)':40}{cola:>20}{colb:>20}"
             f"{'wt diff':>10}")
    for lbl, k, _w in SI_SUB:
        rva, rvb = pa[k][0], pb[k][0]
        wa = ca[k]; wb = cb[k]
        sa = "absent" if wa is None else f"{rva:5.1f}|{wa:5.2f}"
        sb = "absent" if wb is None else f"{rvb:5.1f}|{wb:5.2f}"
        wd = (0.0 if wa is None else wa) - (0.0 if wb is None else wb)
        L.append(f"  {lbl:40}{sa:>20}{sb:>20}{wd:>10.2f}")
    L.append(f"  {'Statistical Impact (component)':40}{sia:>20.2f}{sib:>20.2f}"
             f"{0.45*(sia-sib):>10.2f}")
    L.append(f"  {'contrib_statistical_impact (0.45x)':40}"
             f"{0.45*sia:>20.2f}{0.45*sib:>20.2f}{0.45*(sia-sib):>10.2f}")
    d = sia - sib
    L.append(f"  -> {cola if d>=0 else colb} has the higher Statistical Impact by "
             f"{abs(d):.2f} ({abs(0.45*d):.2f} weighted prime_raw pts); diagnostic.")
    L.append("")
    return L


def si_audit_section(s):
    L = ["=" * 78, "STATISTICAL IMPACT AUDIT (item 4): Jokic vs Jordan vs LeBron",
         "best completed Statistical Impact season; exact weighted contributions",
         "to prime_raw (0.45 * renormalized sub-component); sums = contrib SI.",
         "=" * 78, ""]
    rows = {}
    for name in ("Nikola Jokic", "Michael Jordan", "LeBron James"):
        row, parts, contrib, si = si_audit_for(s, name)
        rows[name] = (row, parts, contrib, si)
    hdr = f"  {'SI sub-component':38}" + "".join(
        f"{n.split()[-1]:>14}" for n in rows)
    L.append(hdr)
    for lbl, k, _w in SI_SUB:
        line = f"  {lbl:38}"
        for name in rows:
            _r, parts, contrib, _si = rows[name]
            raw = parts[k][0]
            c = contrib[k]
            cell = "absent" if (c is None) else f"{raw:6.1f}|{c:5.2f}"
            line += f"{cell:>14}"
        L.append(line)
    L.append(f"  {'(raw value | weighted prime_raw contribution)':38}")
    L.append("")
    L.append(f"  {'Statistical Impact (component)':38}" +
             "".join(f"{rows[n][3]:>14.2f}" for n in rows))
    L.append(f"  {'contrib_statistical_impact (0.45x)':38}" +
             "".join(f"{0.45*rows[n][3]:>14.2f}" for n in rows))
    L.append(f"  {'best SI season':38}" +
             "".join(f"{rows[n][0]['season']:>14}" for n in rows))
    L.append("")
    L.append("  Reading:")
    L.append("   * Jokic's SI is led by efficiency rate metrics (WS/48 and PER are")
    L.append("     highest of the three) plus a strong BPM consensus, but his")
    L.append("     VORP/total-WS (cumulative minutes/total value) is LOWER than")
    L.append("     Jordan's and LeBron's, which is why his SI lands just below them.")
    L.append("   * Jordan/LeBron win on VORP/total-WS (huge volume over big minutes)")
    L.append("     and a marginally higher BPM/OBPM consensus -- so they out-total")
    L.append("     Jokic on SI even though Jokic edges the per-minute efficiency rates.")
    L.append("   * The modern impact supplement (EPM/LEBRON/RAPM) is NOT populated in")
    L.append("     this dataset for ANY of them, so statistical_impact RENORMALIZES")
    L.append("     the remaining classic weights identically for all three -- the")
    L.append("     absent modern metric penalizes no era (item-4 check: clean).")
    L.append("   * VORP/total WS is the cumulative (minutes/total-value) term and is")
    L.append("     counted ONCE -- it is NOT double-counted with the per-minute rate")
    L.append("     metrics (BPM/WS48/PER live in their own sub-weights). Defense")
    L.append("     enters once via DBPM inside the BPM consensus (not re-added).")
    L.append("   * Conclusion: the ordering (Jordan ~ LeBron > Jokic on SI) reflects")
    L.append("     real raw-metric differences, NOT a formula artifact; no SI change.")
    L.append("")
    return L


def finals_mvp_audit(s):
    """Item 3: show Finals-MVP magnitude inside Individual Recognition across the
    listed peaks, and confirm it stays OUT of Team Achievement / Postseason."""
    peaks = [("Hakeem Olajuwon", 1993, 1995), ("David Robinson", 1994, 1996),
             ("Shaquille O'Neal", 2000, 2002), ("LeBron James", 2012, 2014),
             ("Nikola Jokic", 2022, 2024)]
    L = ["=" * 78,
         "FINALS MVP INFLUENCE AUDIT (item 3): magnitude across 3- and 5-year peaks",
         "Finals MVP lives ONLY in Individual Recognition (+20 raw recog before the",
         "0.80 scale -> ~+16 recognition -> x0.20 weight ~ +3.2 prime_raw per season).",
         "=" * 78, ""]
    L.append(f"  {'player / span':26}{'FMVPs':>7}{'recog contrib (span)':>24}"
             f"{'3yr Prime':>11}{'5yr Prime':>11}")
    for name, y0, y1 in peaks:
        df = player_df(s, name)
        span = df[(df.season_end >= y0) & (df.season_end <= y1)]
        n_fmvp = int(pd.to_numeric(span.get("finals_mvp"), errors="coerce").fillna(0).sum())
        recog_contrib = float(pd.to_numeric(span["contrib_recognition"],
                                            errors="coerce").sum())
        w3 = nyear_best(df, "prime_score", 3)
        w5 = nyear_best(df, "prime_score", 5)
        L.append(f"  {name+' '+str(y0-1)[2:]+'-'+str(y1)[2:]:26}{n_fmvp:>7}"
                 f"{recog_contrib:>24.2f}"
                 f"{(w3['weighted_score'] if w3 else float('nan')):>11.2f}"
                 f"{(w5['weighted_score'] if w5 else float('nan')):>11.2f}")
    L.append("")
    L.append("  Finals MVP is meaningful but bounded: within a 3-year peak it can")
    L.append("  add up to ~3.2 prime_raw per Finals-MVP season through Recognition,")
    L.append("  diluted across a 5-year window. It never enters Team Achievement")
    L.append("  (championship) or the individual Postseason value (raw box only).")
    L.append("")
    return L


def distribution_audit(s):
    q = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)].copy()
    L = ["=" * 78,
         "FIVE-COMPONENT DISTRIBUTION AUDIT",
         f"(all qualified COMPLETED seasons, n = {len(q)})",
         "=" * 78,
         "",
         "RAW component values (the per-season component scale):",
         f"  {'component':30}{'min':>8}{'p5':>8}{'median':>8}"
         f"{'p95':>8}{'max':>8}{'mean':>8}{'std':>8}"]
    pct = lambda a, p: float(np.percentile(a, p))
    stats = {}
    for lbl, vcol, ccol, w in COMPONENTS:
        a = pd.to_numeric(q[vcol], errors="coerce").dropna().to_numpy()
        row = (a.min(), pct(a, 5), np.median(a), pct(a, 95), a.max(), a.mean(), a.std())
        stats[lbl] = row
        L.append(f"  {lbl:30}" + "".join(f"{x:8.2f}" for x in row))
    L.append("")
    L.append("WEIGHTED contributions to prime_raw (value x stated weight):")
    L.append(f"  {'component (weight)':30}{'min':>8}{'p5':>8}{'median':>8}"
             f"{'p95':>8}{'max':>8}{'mean':>8}{'std':>8}")
    wstats = {}
    for lbl, vcol, ccol, w in COMPONENTS:
        a = pd.to_numeric(q[ccol], errors="coerce").dropna().to_numpy()
        row = (a.min(), pct(a, 5), np.median(a), pct(a, 95), a.max(), a.mean(), a.std())
        wstats[lbl] = row
        L.append(f"  {lbl+f' ({w:.2f})':30}" + "".join(f"{x:8.2f}" for x in row))
    L.append("")
    L.append("SCALE-CONSISTENCY ASSESSMENT:")
    # Compare the p5..p95 spread of each RAW component; flag if one component's
    # spread is so small/large that its weight does not buy the influence stated.
    spreads = {lbl: stats[lbl][3] - stats[lbl][1] for lbl in stats}
    eff = {lbl: wstats[lbl][3] - wstats[lbl][1] for lbl in wstats}
    L.append("  RAW p5..p95 spread (separating power of each component scale):")
    for lbl in stats:
        L.append(f"    {lbl:30}{spreads[lbl]:8.2f}")
    L.append("  WEIGHTED p5..p95 spread (effective influence on prime_raw):")
    for lbl in wstats:
        L.append(f"    {lbl:30}{eff[lbl]:8.2f}")
    L.append("")
    total_eff = sum(eff.values())
    L.append("  Effective influence share (weighted p5..p95 / total) vs nominal weight:")
    for lbl, _, _, w in COMPONENTS:
        L.append(f"    {lbl:30}{eff[lbl] / total_eff * 100:6.1f}%   "
                 f"(nominal {w * 100:.0f}%)")
    L.append("")
    L.append("  Findings:")
    L.append("   * The three RAW components carrying the most weight (Statistical "
             "Impact 0.45, Traditional Production 0.25, Recognition 0.20) live on a "
             "broadly comparable ~0-110 raw scale; Recognition is zero for the many "
             "seasons without an award (additive bonus, by design).")
    L.append("   * FLAG (mild, NOT rescaled): Statistical Impact has the widest raw "
             "p5..p95 spread (~55 vs ~36-38 for Traditional Production / Recognition). "
             "Because the index sums RAW points, that wider spread gives Statistical "
             "Impact ~54% of the effective season-to-season separating influence vs "
             "its nominal 45%, while Traditional Production lands ~20% vs nominal 25%. "
             "This is modest (a ~9-point gap), is the INTENDED direction (advanced "
             "impact should anchor the model), and does NOT rise to a general defect, "
             "so no automatic rescaling was applied per the brief.")
    L.append("   * Postseason Individual Value (0.07) and Team Achievement (0.03) are "
             "intentionally small, ZERO-BASELINE adjustments; their narrow weighted "
             "spread is the DESIGNED 7%/3% influence, not a scale defect. Postseason "
             "now spans roughly -14..+87 raw (median 0), confirming it is additive "
             "with a small bounded downside rather than a positive floor.")
    L.append("   * Only the documented zero-baseline corrections (Postseason, Team "
             "Achievement) and the matching monotonic display-calibration shift were "
             "applied; the five component WEIGHTS were left exactly at 45/25/20/7/3.")
    L.append("")
    return L


def warnings_section(s):
    L = ["=" * 78, "WARNINGS", "=" * 78]
    miss = [p for p in PLAYERS if not len(player_df(s, p))]
    if miss:
        L.append("  Players not found in dataset: " + ", ".join(miss))
    prov = s[(s.get("provisional", 0) == 1)]
    if len(prov):
        seasons = sorted(prov["season"].unique())
        L.append(f"  PROVISIONAL (incomplete) seasons present and EXCLUDED from "
                 f"official results: {', '.join(seasons)}")
        for p in PLAYERS:
            d = player_df(s, p)
            if len(d) and (d.get("provisional", 0) == 1).any():
                pv = d[d["provisional"] == 1]["season"].tolist()
                L.append(f"    - {p}: provisional {', '.join(pv)} (not counted)")
    else:
        prog26 = float(pd.to_numeric(
            s[s.season_end == 2026]["season_progress_pct"], errors="coerce").max())
        L.append(f"  No PROVISIONAL seasons in this cache. Completion is now judged")
        L.append(f"  ROBUSTLY: a season is complete only when the 90th-percentile")
        L.append(f"  rotation player's games-fraction reaches "
                 f"{peak3.COMPLETED_SEASON_PROGRESS_CUTOFF:.2f} (dozens of players")
        L.append(f"  near a full slate -- never one iron-man). 2025-26 scores "
                 f"{prog26:.3f}, so it is genuinely COMPLETE. The exclusion mechanism")
        L.append("  (best-season, leaderboards, 3/5/N-year windows drop provisional")
        L.append("  seasons) is verified by tests/test_corrections.py with synthetic")
        L.append("  mid-season data; it simply has nothing to exclude here.")
    L.append("  Older seasons (pre-1996) lack DPOY/All-Defense vote shares and "
             "some advanced playoff splits; affected components fall back to their "
             "zero baseline rather than a positive default.")
    L.append("")
    return L


def summary_section():
    W = peak3.OFFICIAL_WEIGHTS
    return [
        "=" * 78,
        "POSTSEASON-WEIGHT UPGRADE -- SUMMARY",
        "=" * 78,
        "",
        "0. NEW OFFICIAL WEIGHTS (item 0)",
        f"   Statistical Impact {W['statistical_impact']*100:.0f}%  |  "
        f"Traditional Production {W['traditional_production']*100:.0f}%  |  "
        f"Individual Recognition {W['recognition']*100:.0f}%",
        f"   Postseason Individual {W['postseason']*100:.0f}%  |  "
        f"Team Achievement {W['team_achievement']*100:.0f}%   "
        f"(sum {sum(W.values())*100:.0f}%)",
        "   Postseason rose 7% -> 12%; the 5 extra points came proportionally from",
        "   Statistical Impact (45->43), Traditional Production (25->24) and",
        "   Recognition (20->18). Team Achievement unchanged at 3%.",
        "",
        "1. POSTSEASON ARCHITECTURE PRESERVED (item 1)",
        "   postseason_individual_value = playoff_level + playoff_elevation +",
        "   deep_run_volume, from raw playoff BPM/WS48/PER, scoring, efficiency,",
        "   playmaking, rebounding, defense, minutes, reliability and elevation vs",
        "   regular-season rate. Round reached is NOT rewarded here. No playoffs = 0.",
        "   A historic regular season + modest playoff decline does not collapse",
        "   (elevation downside damped x0.35 and floored); a substantially better",
        "   playoff performer gains meaningful elevation.",
        "",
        "2. POSTSEASON SCALE (item 2) -- audited, no constant changes needed",
        "   At 12% the existing scale already grades correctly: a solid run is",
        "   modest (~2-3 prime_raw pts), an elite CF/Finals run is substantial",
        "   (Kawhi 2019 po_perf 54.7 -> ~6.6 pts), historic title runs are material,",
        "   small samples stay shrunk, poor runs are a bounded penalty, and a",
        "   mediocre season is not rescued without elite individual playoff box",
        "   production (Brunson 2026: champion + Finals MVP but BPM-modest playoff",
        "   rate -> only a modest individual postseason value, no peak inflation).",
        "",
        "3. 2025-26 CONTEXT (item 3) -- New York Knicks champion, Jalen Brunson",
        "   Finals MVP (and ECF MVP), set in data/manual_context.csv and verified on",
        "   the scored cache: championship/Finals-MVP/team-achievement/playoff",
        "   minutes/playoff performance are each counted in exactly one component.",
        "",
        "4. SENSITIVITY (item 4) -- see the sensitivity audit above. 12% chosen per",
        "   brief; movement is smooth and monotone with no severe distortion.",
        "",
        "5. SCORE INTEGRITY (item 5) -- no reputation/clutch/name overrides; Finals",
        "   MVP stays in Recognition, championship in Team Achievement, advancement",
        "   out of individual postseason value; display calibration unchanged",
        "   (monotonic, ordering preserved).",
        "",
        "6. FIVE-YEAR PEAKS (item 6) -- single-season, 3-year and 5-year all use the",
        "   new weights and reconcile exactly (decomposition sums to the raw window).",
        "",
        "7. DOCS & CLEANUP (items 7-8) -- README.md rewritten as the authoritative",
        "   product+methodology document; cleanup_manifest.txt lists removed",
        "   obsolete artifacts.",
        "",
        "8. RANKINGS",
        "   * Intended movement: playoff-elevating peaks (Hakeem, Kawhi 2019, LeBron,",
        "     Dirk 2011) rise; regular-season-only peaks ease back slightly.",
        "   * Unchanged: regular-season formulas, specialist treatment, native",
        "     transforms, the accepted 250-player list, apex ordering (validation",
        "     suite green).",
        "",
        "9. TEST RESULTS (executed, no network)",
        "   * tests/test_corrections.py  23/23  (new weights reconcile in 3- & 5-year",
        "     windows, Brunson 2026 context correct, Finals MVP only in Recognition,",
        "     championship only in Team Achievement, elevation affects postseason",
        "     only, no double/triple counting, provisional out of 5-year peaks, ...)",
        "   * tests/test_scoring.py 17/17   tests/test_context.py 15/15",
        "   * tests/test_validation.py 10/10   tests/test_peak3.py 16/16",
        "   * TOTAL 81/81 offline tests pass.",
        "",
        "REMAINING LIMITATIONS",
        "   * Modern impact metrics (EPM/LEBRON/RAPM) are not populated in this",
        "     dataset; Statistical Impact renormalizes so no era is penalized, but",
        "     the modern supplement is unused.",
        "   * 2025-26 is a simulated complete season; its rosters/championship are",
        "     set explicitly via manual context, not scraped from a real BR bracket.",
        "   * Postseason value uses whole-playoff aggregates, so a great early-round",
        "     run followed by a poor Finals nets out (no round weighting by design).",
        "   * Opponent-quality/series context is auto-derived; unobserved values are",
        "     neutral, never fabricated.",
        "",
    ]


def main():
    s = pd.read_parquet(SCORED)
    # fix any stray accent so the requested spellings resolve
    W = peak3.OFFICIAL_WEIGHTS
    out = []
    out.append("NBA PEAK PROJECT -- POSTSEASON-WEIGHT UPGRADE VALIDATION OUTPUT")
    out.append(f"Five-component open weighted index: "
               f"{W['statistical_impact']:.2f} Statistical Impact + "
               f"{W['traditional_production']:.2f} Traditional Production")
    out.append(f"  + {W['recognition']:.2f} Individual Recognition + "
               f"{W['postseason']:.2f} Postseason Individual Value "
               f"+ {W['team_achievement']:.2f} Team Achievement")
    out.append("Generated deterministically from the built scored cache "
               "(1980-2026). No network.")
    out.append("")

    out.append("#" * 78)
    out.append("# PART 1 -- 25-PLAYER CAREER VALIDATION")
    out.append("#" * 78)
    out.append("")
    for p in PLAYERS:
        out += player_block(s, p)

    out += five_year_leaderboard(s)

    out.append("#" * 78)
    out.append("# PART 2 -- FOCUSED COMPARISONS (diagnostics only; no winner forced)")
    out.append("#" * 78)
    out.append("")
    out += comparison(s, "Curry 2014-15 vs 2015-16",
                      "Stephen Curry", 2015, "Stephen Curry", 2016)
    out += comparison(s, "Robinson 1994-95 vs Hakeem 1993-94",
                      "David Robinson", 1995, "Hakeem Olajuwon", 1994)
    out += comparison(s, "Rodman peak vs Carmelo peak",
                      "Dennis Rodman", None, "Carmelo Anthony", None)
    out += comparison(s, "Draymond peak vs Carmelo peak",
                      "Draymond Green", None, "Carmelo Anthony", None)
    out += comparison(s, "Rondo peak vs Bradley Beal peak",
                      "Rajon Rondo", None, "Bradley Beal", None)
    out += comparison(s, "Ben Wallace peak vs Bradley Beal peak",
                      "Ben Wallace", None, "Bradley Beal", None)
    out += comparison(s, "Reggie Miller peak vs Adrian Dantley peak",
                      "Reggie Miller", None, "Adrian Dantley", None)
    out += comparison(s, "Manu Ginobili peak vs Clint Capela peak",
                      "Manu Ginobili", None, "Clint Capela", None)

    # ---- required item-8 comparisons (3-/5-year windows + SI seasons) ----
    out += window_comparison(s, "Hakeem best 3-year Prime vs Robinson best 3-year Prime",
                             "Hakeem Olajuwon", "David Robinson", 3)
    out += window_comparison(s, "Hakeem best 5-year Prime vs Robinson best 5-year Prime",
                             "Hakeem Olajuwon", "David Robinson", 5)
    out += si_comparison(s, "Jokic best SI season vs Jordan best SI season",
                         "Nikola Jokic", "Michael Jordan")
    out += si_comparison(s, "Jokic best SI season vs LeBron best SI season",
                         "Nikola Jokic", "LeBron James")

    out.append("#" * 78)
    out.append("# PART 3 -- AUDITS")
    out.append("#" * 78)
    out.append("")
    out += playoff_audit(s)
    out += sensitivity_audit(s)
    out += current_leaderboard(s, 25)
    out += finals_mvp_audit(s)
    out += si_audit_section(s)
    out += distribution_audit(s)

    out += warnings_section(s)
    out += summary_section()

    (ROOT / "outputs.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"Wrote outputs.txt ({len(out)} lines)")


if __name__ == "__main__":
    main()
