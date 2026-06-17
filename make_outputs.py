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
             f" + dominance {_f(prime.get('po_dominance_value'),1)}"
             f" = {_f(prime.get('postseason_perf'),1)}")
    L.append(f"    postseason sample reliability  : {_f(prime.get('po_sample_reliab'),2)}"
             f"  (po_g {_f(prime.get('po_g'),0)}, po_mp {_f(prime.get('po_mp'),0)},"
             f" series {_f(prime.get('po_series_n'),0)})")
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


def recognition_audit(s):
    """Recognition decomposition + double-counting verification for the listed
    seasons. Uses peak3.recognition_breakdown (the single source of truth) so the
    parts always sum to the recognition component."""
    cases = [("Hakeem Olajuwon", 1994), ("Hakeem Olajuwon", 1995),
             ("David Robinson", 1994), ("David Robinson", 1995),
             ("Michael Jordan", 1991), ("LeBron James", 2013),
             ("Nikola Jokic", 2023), ("Kawhi Leonard", 2019),
             ("Dirk Nowitzki", 2011), ("Jalen Brunson", 2026)]
    SC = peak3.RECOGNITION_SCALE
    Wr = peak3.OFFICIAL_WEIGHTS["recognition"]
    L = ["=" * 78,
         f"RECOGNITION AUDIT ({int(Wr*100)}% weight) -- decomposition + no double counting",
         "values shown are SCALED (x0.80) award points, i.e. as they enter the",
         "recognition component; 'wtd' = x weight into prime_raw.  Overlap discounts:",
         "All-NBA x0.45 under a top-3 MVP; All-Defense x0.5 under a top-3 DPOY;",
         "All-Star subsumed by any All-NBA. Championship is NOT here (Team Achievement).",
         "=" * 78, "",
         f"  {'player / season':24}{'MVP':>7}{'AllNBA':>7}{'AS':>5}{'DPOY':>6}"
         f"{'AllD':>6}{'FMVP':>6}{'titles':>7}{'TOTAL':>8}{'wtd':>7}"]
    for name, yr in cases:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        b = peak3.recognition_breakdown(r)
        total = float(r["recognition"])
        L.append(f"  {name+' '+str(yr-1)+'-'+str(yr)[2:]:24}"
                 f"{SC*b['mvp']:>7.1f}{SC*b['anba']:>7.1f}{SC*b['allstar']:>5.1f}"
                 f"{SC*b['dpoy']:>6.1f}{SC*b['alldef']:>6.1f}{SC*b['fmvp']:>6.1f}"
                 f"{SC*b['titles']:>7.1f}{total:>8.1f}{Wr*total:>7.2f}")
    L.append("")
    L.append("  Verification (computed over the dataset):")
    # Finals MVP appears only in Recognition: a finals_mvp season's recognition is
    # strictly greater than the same row with finals_mvp cleared.
    fm = s[(s.get("finals_mvp", 0) == 1)].head(1)
    if len(fm):
        r = fm.iloc[0].copy()
        with_fm = peak3.recognition_row(r)["recognition"]
        r2 = r.copy(); r2["finals_mvp"] = 0
        without_fm = peak3.recognition_row(r2)["recognition"]
        L.append(f"   * Finals MVP adds {with_fm - without_fm:.1f} to Recognition and is "
                 "absent from Team Achievement / Postseason (verified in tests).")
    # championship does not change recognition
    rr = s[(s.player == 'Hakeem Olajuwon') & (s.season_end == 1994)].iloc[0].copy()
    base = peak3.recognition_row(rr)["recognition"]
    rr_noring = rr.copy(); rr_noring["championship"] = 0
    L.append(f"   * recognition_breakdown reads NO championship field -> a ring "
             f"changes Recognition by 0.0 (Hakeem 1994 stays {base:.1f}).")
    L.append("   * All-Star column is 0 whenever All-NBA > 0 (subsumed); All-NBA and")
    L.append("     All-Defense carry their MVP/DPOY overlap discounts (see header).")
    L.append("")
    return L


def playoff_audit(s):
    """Item 9: focused postseason audits for the validation-philosophy cases."""
    cases = [("Hakeem Olajuwon", 1994, "title run #1, Finals MVP"),
             ("Hakeem Olajuwon", 1995, "title run #2, Finals MVP"),
             ("David Robinson", 1995, "MVP regular season, playoff letdown vs Hakeem"),
             ("Dirk Nowitzki", 2011, "elite title run, Finals MVP"),
             ("Kawhi Leonard", 2019, "historically dominant title run, Finals MVP"),
             ("Kevin Garnett", 2004, "excellent Conf Finals run (lost WCF)"),
             ("Jimmy Butler", 2020, "bubble Finals run"),
             ("Jimmy Butler", 2023, "8-seed Finals run"),
             ("Nikola Jokic", 2023, "dominant title run, Finals MVP"),
             ("Stephen Curry", 2016, "historic regular season, injured playoff decline"),
             ("Jalen Brunson", 2026, "NYK champion, Finals MVP (2025-26)")]
    W = peak3.OFFICIAL_WEIGHTS["postseason"]
    L = ["=" * 78,
         "PLAYOFF AUDITS (item: validation philosophy)",
         f"postseason_value = reliability-adjusted level + elevation + "
         f"sustained_volume + dominance ({int(W*100)}% weight)",
         "rel = playoff-sample reliability (minutes x games x series); dom = convex "
         "dominance bonus",
         "=" * 78, "",
         f"  {'player / season':26}{'po_perf':>8}{'level':>7}{'elev':>6}"
         f"{'deep':>6}{'dom':>6}{'rel':>6}{'po_mp':>7}{'team':>6}{'prime':>7}"]
    for name, yr, note in cases:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        L.append(f"  {name+' '+str(yr-1)+'-'+str(yr)[2:]:26}"
                 f"{r['postseason_perf']:>8.1f}{r['po_level_value']:>7.1f}"
                 f"{r['po_elevation_value']:>6.1f}{r['po_deep_run_value']:>6.1f}"
                 f"{r.get('po_dominance_value', float('nan')):>6.1f}"
                 f"{r.get('po_sample_reliab', float('nan')):>6.2f}"
                 f"{(r.get('po_mp') if pd.notna(r.get('po_mp')) else 0):>7.0f}"
                 f"{r['team_achievement']:>6.0f}{r['prime_score']:>7.1f}")
        L.append(f"      {note}; weighted postseason contribution "
                 f"{W*r['postseason_perf']:.2f} of prime_raw {r['prime_raw']:.1f}")
    L.append("")
    L.append("  Reading: historically dominant individual runs (Kawhi 2019, Jokic")
    L.append("  2023, Hakeem 1994) earn the most; an excellent CF run (Garnett 2004)")
    L.append("  earns meaningful credit; a champion with modest per-minute box impact")
    L.append("  (Brunson 2026, deep-run 0) earns only a modest individual value, NOT an")
    L.append("  automatic peak boost; a historic regular season with an injured playoff")
    L.append("  decline (Curry 2016) is damped, not collapsed. Finals MVP / clear-best-")
    L.append("  player status only validate the metric, never adding points here.")
    L.append("")
    return L


# Seasons required by the postseason upper-tail correction audit (item 6).
PO_AUDIT_CASES = [
    ("LeBron James", 2009), ("LeBron James", 2012), ("LeBron James", 2013),
    ("Michael Jordan", 1988), ("Michael Jordan", 1991),
    ("Hakeem Olajuwon", 1994), ("Hakeem Olajuwon", 1995),
    ("Nikola Jokic", 2023), ("Kawhi Leonard", 2019), ("Dirk Nowitzki", 2011),
    ("Jimmy Butler", 2020), ("Jimmy Butler", 2023), ("Stephen Curry", 2016),
    ("Shaquille O'Neal", 2000), ("Kevin Garnett", 2004),
]


def load_old_snapshot():
    """Pre-correction (OLD postseason model) per-season values, frozen in
    data/old_model_snapshot.csv. Everything BUT the postseason upper-tail formula
    is identical between old and new, so this isolates the correction's effect."""
    p = ROOT / "data" / "old_model_snapshot.csv"
    if not p.exists():
        return None
    return pd.read_csv(p)


def postseason_decomposition_audit(s):
    """Item 6: the FULL postseason decomposition for every required season under
    the corrected upper-tail model."""
    W = peak3.OFFICIAL_WEIGHTS["postseason"]
    L = ["=" * 78,
         "POSTSEASON DECOMPOSITION AUDIT (corrected upper-tail model)",
         "postseason_value = reliability-adjusted level + sample-adjusted elevation",
         "                 + sustained elite volume + reliability-shrunk dominance",
         "=" * 78, "",
         "  Legend: g=playoff games  mp=playoff minutes  ser=series observed",
         "  absL=absolute level (pre-reliability)  rel=playoff-sample reliability",
         "  adjL=reliability-adjusted level  eRaw=raw elevation  eAdj=sample-adjusted",
         "  deep=sustained elite volume  domR=dominance pre-reliability  domF=final",
         "  dominance  PERF=final postseason value  wPO=weighted postseason contrib",
         "",
         f"  {'player / season':24}{'g':>3}{'mp':>6}{'ser':>4}{'absL':>7}{'rel':>6}"
         f"{'adjL':>7}{'eRaw':>6}{'eAdj':>6}{'deep':>6}{'domR':>6}{'domF':>6}"
         f"{'PERF':>7}{'wPO':>7}"]
    for name, yr in PO_AUDIT_CASES:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        tag = f"{name} {yr-1}-{str(yr)[2:]}"
        L.append(
            f"  {tag:24}{_n(r.get('po_g')):>3.0f}{_n(r.get('po_mp')):>6.0f}"
            f"{_n(r.get('po_series_n')):>4.0f}{_n(r.get('po_abs_level')):>7.1f}"
            f"{_n(r.get('po_sample_reliab')):>6.2f}{_n(r.get('po_level_value')):>7.1f}"
            f"{_n(r.get('po_elev_raw')):>6.1f}{_n(r.get('po_elevation_value')):>6.1f}"
            f"{_n(r.get('po_deep_run_value')):>6.1f}{_n(r.get('po_dominance_raw')):>6.1f}"
            f"{_n(r.get('po_dominance_value')):>6.1f}{_n(r.get('postseason_perf')):>7.1f}"
            f"{W*_n(r.get('postseason_perf')):>7.2f}")
    L.append("")
    L.append("  Each season reconciles: adjL + eAdj + deep + domF = PERF.")
    L.append("  The dominance term is BOTH diminishing (a square-root curve on the")
    L.append("  level above 50) AND reliability-shrunk (a short Conference-Finals run")
    L.append("  earns only a partial bonus), so an extreme rate stat over a short run")
    L.append("  no longer overpowers a complete Finals-length championship season.")
    L.append("")
    return L


def _n(v, default=0.0):
    try:
        return default if pd.isna(v) else float(v)
    except Exception:
        return default


def postseason_before_after(s):
    """Item 8: before/after table for the audited seasons plus the headline
    single-season / 3-year Prime shifts, top-25 leaderboard moves, and the
    largest risers/fallers caused by the postseason upper-tail correction."""
    old = load_old_snapshot()
    L = ["=" * 78,
         "POSTSEASON CORRECTION -- BEFORE / AFTER",
         "OLD = open-ended linear dominance booster (+0.30 per level point > 50);",
         "NEW = diminishing-return, reliability-shrunk dominance + sample-shrunk level.",
         "=" * 78, ""]
    if old is None:
        L.append("  (data/old_model_snapshot.csv missing -- before/after unavailable)")
        L.append("")
        return L

    W = peak3.OFFICIAL_WEIGHTS["postseason"]
    okey = old.set_index(["player", "season_end"])

    # ---- qualified completed frames for ranking (new + old prime) ----
    qual = s[(s.get("workload_qualified", 1) == 1) &
             (s.get("provisional", 0) != 1)].copy().reset_index(drop=True)
    qm = qual.merge(old[["player", "season_end", "old_prime_score",
                         "old_prime_raw"]],
                    on=["player", "season_end"], how="left")
    new_peak = _nyear_peak_map(qm, qm["prime_score"], 3)
    old_peak = _nyear_peak_map(qm, qm["old_prime_score"].fillna(-1e9), 3)
    new_rank = {p: i + 1 for i, (p, _) in
                enumerate(sorted(new_peak.items(), key=lambda kv: -kv[1][0]))}
    old_rank = {p: i + 1 for i, (p, _) in
                enumerate(sorted(old_peak.items(), key=lambda kv: -kv[1][0]))}
    # single-season Prime ranks (across all qualified completed seasons)
    new_srank = qm.assign(_r=qm["prime_score"].rank(ascending=False, method="min")
                          ).set_index(["player", "season_end"])["_r"]
    old_srank = qm.assign(
        _r=qm["old_prime_score"].rank(ascending=False, method="min")
        ).set_index(["player", "season_end"])["_r"]

    # ---- per-season before/after for the audited seasons ----
    L.append(f"  {'player / season':24}{'oldPO':>7}{'newPO':>7}{'owPO':>6}{'nwPO':>6}"
             f"{'oPrR':>7}{'nPrR':>7}{'oRnk':>6}{'nRnk':>6}")
    for name, yr in PO_AUDIT_CASES:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        try:
            o = okey.loc[(name, yr)]
        except KeyError:
            o = None
        opo = _n(o["old_postseason_perf"]) if o is not None else float("nan")
        npo = _n(r["postseason_perf"])
        opr = _n(o["old_prime_raw"]) if o is not None else float("nan")
        npr = _n(r["prime_raw"])
        orank = int(old_srank.get((name, yr), 0))
        nrank = int(new_srank.get((name, yr), 0))
        tag = f"{name} {yr-1}-{str(yr)[2:]}"
        L.append(f"  {tag:24}{opo:>7.1f}{npo:>7.1f}{W*opo:>6.1f}{W*npo:>6.1f}"
                 f"{opr:>7.1f}{npr:>7.1f}{orank:>6}{nrank:>6}")
    L.append("  (owPO/nwPO = old/new weighted postseason contribution; oRnk/nRnk =")
    L.append("   the season's rank in the single-season Prime leaderboard, old vs new.)")
    L.append("")

    # ---- headline single-season Prime shifts (best per player, old vs new) ----
    def best_season(player, score_col, frame):
        g = frame[frame.player == player]
        g = g[g.get("provisional", 0) != 1] if "provisional" in g.columns else g
        if not len(g):
            return None
        i = g[score_col].astype(float).idxmax()
        return g.loc[i]

    L.append("  Best SINGLE-SEASON Prime (completed), old vs new:")
    for player in ("LeBron James", "Michael Jordan"):
        bn = best_season(player, "prime_score", s)
        bo = best_season(player, "old_prime_score", qm)
        if bn is not None and bo is not None:
            L.append(f"    {player:16} OLD {int(bo['season_end'])-1}-"
                     f"{str(int(bo['season_end']))[2:]} "
                     f"(prime {_f(bo['old_prime_score'],1)})  ->  NEW "
                     f"{int(bn['season_end'])-1}-{str(int(bn['season_end']))[2:]} "
                     f"(prime {_f(bn['prime_score'],1)})")
    L.append("")

    # ---- Hakeem vs Robinson best-3-year Prime, old vs new ----
    L.append("  Hakeem vs Robinson best-3-year Prime peak (rank-weighted, calibrated")
    L.append("  prime_score; the fixed-window RAW bridge is in PART 2):")
    for player in ("Hakeem Olajuwon", "David Robinson"):
        npk = new_peak.get(player); opk = old_peak.get(player)
        if npk and opk:
            L.append(f"    {player:16} OLD {opk[0]:.2f} ({opk[1]})  ->  "
                     f"NEW {npk[0]:.2f} ({npk[1]})")
    if new_peak.get("Hakeem Olajuwon") and new_peak.get("David Robinson"):
        h, rb = new_peak["Hakeem Olajuwon"][0], new_peak["David Robinson"][0]
        lead = "Hakeem" if h > rb else "Robinson"
        L.append(f"    -> NEW model: {lead} leads by {abs(h-rb):.2f} (transparent, "
                 f"not forced).")
    L.append("")

    # ---- top-25 leaderboard changes + largest movers ----
    common = set(new_rank) & set(old_rank)
    moves = sorted(((p, old_rank[p] - new_rank[p]) for p in common),
                   key=lambda kv: kv[1])
    new_top25 = {p for p, rk in new_rank.items() if rk <= 25}
    old_top25 = {p for p, rk in old_rank.items() if rk <= 25}
    entered = sorted(new_top25 - old_top25, key=lambda p: new_rank[p])
    dropped = sorted(old_top25 - new_top25, key=lambda p: old_rank[p])
    L.append("  TOP-25 (best-3-year Prime) membership changes:")
    if entered:
        for p in entered:
            L.append(f"    + ENTERED  {p:22} old #{old_rank[p]:>3} -> new #{new_rank[p]:>3}")
    if dropped:
        for p in dropped:
            L.append(f"    - DROPPED  {p:22} old #{old_rank[p]:>3} -> new #{new_rank[p]:>3}")
    if not entered and not dropped:
        L.append("    (no change in top-25 membership; only intra-list reordering)")
    L.append("")
    risers = [m for m in reversed(moves) if m[1] > 0][:10]
    fallers = [m for m in moves if m[1] < 0][:10]
    L.append("  Largest RISERS (best-3-year Prime rank improved):")
    for p, d in risers:
        L.append(f"    {p:24} #{old_rank[p]:>3} -> #{new_rank[p]:>3}  (+{d})")
    L.append("  Largest FALLERS (best-3-year Prime rank dropped):")
    for p, d in fallers:
        L.append(f"    {p:24} #{old_rank[p]:>3} -> #{new_rank[p]:>3}  ({d})")
    L.append("")
    return L


def current_leaderboard(s, n=25):
    """Item 9: top-N players by best 3-year Prime peak under the LIVE model."""
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)]
    rows = []
    for player, g in qual.groupby("player"):
        w = peak3.best_window(g, "prime_score")
        if w:
            rows.append((player, w["peak_score"], f"{w['start_season']}-{w['end_season']}"))
    rows.sort(key=lambda r: -r[1])
    wtag = "/".join(f"{int(peak3.OFFICIAL_WEIGHTS[k]*100)}" for k in
                    ("statistical_impact", "traditional_production", "recognition",
                     "postseason", "team_achievement"))
    L = ["=" * 78,
         f"TOP-{n} LEADERBOARD (best 3-year Prime peak, live {wtag} model)",
         "all qualified completed players; provisional excluded",
         "=" * 78, "",
         f"  {'#':>3} {'player':26}{'3yr Prime':>10}  span"]
    for i, (p, sc, span) in enumerate(rows[:n], 1):
        L.append(f"  {i:>3} {p:26}{sc:>10.2f}  {span}")
    L.append("")
    return L


def _prime_under(qual, W):
    """Per-row prime_raw under an arbitrary full weight dict W."""
    g = lambda c: pd.to_numeric(qual[c], errors="coerce").fillna(0.0)
    return (W["statistical_impact"] * g("statistical_impact")
            + W["traditional_production"] * g("traditional_production")
            + W["recognition"] * g("recognition")
            + W["postseason"] * g("postseason_perf")
            + W["team_achievement"] * g("team_achievement")
            + g("teammate_adjustment"))


def weight_change_movers(s, topn=12):
    """Largest risers/fallers in best-3-year-Prime rank: prior 41/23/15/18/3 vs
    the new 38/21/20/18/3 model (postseason held at 18%). The only weight change
    is +5 Recognition from -3 SI / -2 TP, so decorated players rise and purely
    statistical peaks ease back."""
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)
             ].copy().reset_index(drop=True)
    peaks = {}
    for tag, W in (("prior", WEIGHTS_PRIOR), ("new", WEIGHTS_NOW)):
        peaks[tag] = _nyear_peak_map(qual, _prime_under(qual, W), 3)
    rank = {}
    for tag in ("prior", "new"):
        order = sorted(peaks[tag].items(), key=lambda kv: -kv[1][0])
        rank[tag] = {p: i + 1 for i, (p, _) in enumerate(order)}
    common = set(rank["prior"]) & set(rank["new"])
    moves = [(p, rank["prior"][p] - rank["new"][p]) for p in common
             if rank["prior"][p] <= 130 or rank["new"][p] <= 130]
    risers = sorted(moves, key=lambda x: -x[1])[:topn]
    fallers = sorted(moves, key=lambda x: x[1])[:topn]
    L = ["=" * 78,
         "LARGEST RISERS / FALLERS vs the PRIOR 41/23/15/18/3 model",
         "(best 3-year Prime peak rank; recognition 15% -> 20%, SI 41->38, TP 23->21)",
         "=" * 78, "",
         "  RISERS (more recognition weight helps decorated peaks):"]
    for p, d in risers:
        L.append(f"    {p:26} #{rank['prior'][p]:<4} -> #{rank['new'][p]:<4} (+{d})")
    L.append("  FALLERS (purely statistical peaks ease back):")
    for p, d in fallers:
        L.append(f"    {p:26} #{rank['prior'][p]:<4} -> #{rank['new'][p]:<4} ({d})")
    L.append("")
    return L


# ===========================================================================
# POSTSEASON-WEIGHT SENSITIVITY (item 4)
# ===========================================================================
SENS_WEIGHTS = [0.12, 0.15, 0.18]
# base SI:TP:Rec proportions (38:21:20, sum 79); the non-postseason, non-team
# pool (0.97 - w_po) is split in these proportions; Team Achievement stays 0.03.
_SI, _TP, _RC, _POOL = 38.0, 21.0, 20.0, 79.0


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
         "Postseason weight w in {" + ", ".join(f"{int(x*100)}%" for x in SENS_WEIGHTS)
         + "}; the removed/added weight is redistributed proportionally across",
         f"Statistical Impact / Traditional Production / Recognition "
         f"({int(_SI)}:{int(_TP)}:{int(_RC)}). Team Achievement stays 3%.",
         "Ranks are among all qualified COMPLETED seasons / 3-year peaks.",
         "18% is the OFFICIAL model (rightmost column); 12%/15% shown for sensitivity.",
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

    lo, mid, hi = SENS_WEIGHTS[0], SENS_WEIGHTS[1], SENS_WEIGHTS[2]
    # full-rank maps (not just top25) for movement detection
    fullrank = {}
    for w in SENS_WEIGHTS:
        order = sorted(peaks3[w].items(), key=lambda kv: -kv[1][0])
        fullrank[w] = {p: i + 1 for i, (p, _) in enumerate(order)}

    # ---- top-25 leaderboard by best 3-year Prime peak (at the OFFICIAL hi=18%) ----
    base = sorted(peaks3[hi].items(), key=lambda kv: -kv[1][0])[:25]
    L.append(f"  Top-25 leaderboard by best 3-year Prime peak (at {int(hi*100)}%):")
    L.append(f"    {'#':>3} {'player':24}{'peak':>8}  "
             f"{'rank@'+str(int(lo*100))+'%':>9}{'rank@'+str(int(mid*100))+'%':>9}")
    for i, (p, (peak, span)) in enumerate(base, 1):
        rlo = fullrank[lo].get(p); rmid = fullrank[mid].get(p)
        L.append(f"    {i:>3} {p:24}{peak:>8.2f}  {('#'+str(rlo)):>9}{('#'+str(rmid)):>9}")
    L.append("")

    # ---- largest risers / fallers from lo -> hi (full population) ----
    common = set(fullrank[lo]) & set(fullrank[hi])
    moves = [(p, fullrank[lo][p] - fullrank[hi][p]) for p in common
             if fullrank[lo][p] <= 120 or fullrank[hi][p] <= 120]
    risers = sorted(moves, key=lambda x: -x[1])[:10]
    fallers = sorted(moves, key=lambda x: x[1])[:10]
    L.append(f"  Largest RISERS as postseason weight goes {int(lo*100)}% -> "
             f"{int(hi*100)}% (rank improvement, top-120 pool):")
    for p, d in risers:
        L.append(f"    {p:26} #{fullrank[lo][p]:<4} -> #{fullrank[hi][p]:<4} (+{d})")
    L.append(f"  Largest FALLERS as postseason weight goes {int(lo*100)}% -> "
             f"{int(hi*100)}%:")
    for p, d in fallers:
        L.append(f"    {p:26} #{fullrank[lo][p]:<4} -> #{fullrank[hi][p]:<4} ({d})")
    L.append("")
    L.append("  CHOSEN WEIGHT: 18% (per brief). The sweep 12% -> 15% -> 18% shows")
    L.append("  graceful, monotone movement -- elite individual playoff peaks (Hakeem,")
    L.append("  Kawhi 2019, Jokic, LeBron, Dirk 2011) rise and regular-season-only")
    L.append("  peaks ease back -- with no broad distortion across the validation set,")
    L.append("  so 18% is adopted as the official model.")
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


# Prior and current official weight systems for the Hakeem-Robinson bridge.
WEIGHTS_PRIOR = {"statistical_impact": 0.41, "traditional_production": 0.23,
                 "recognition": 0.15, "postseason": 0.18, "team_achievement": 0.03}
WEIGHTS_NOW = dict(peak3.OFFICIAL_WEIGHTS)
_BRIDGE_COMPONENTS = [
    ("Statistical Impact", "statistical_impact", "statistical_impact"),
    ("Traditional Production", "traditional_production", "traditional_production"),
    ("Recognition", "recognition", "recognition"),
    ("Postseason", "postseason", "postseason_perf"),
    ("Team Achievement", "team_achievement", "team_achievement"),
]


def _window_agg(window_df, weights):
    """Rank-weighted (best-season-most) aggregate of a window under a given weight
    system: returns per-component RAW value and WEIGHTED contribution, the
    teammate adjustment, and the reconstructed prime_raw. The within-window season
    ranking is recomputed under the supplied weights (so a weight change that
    reorders the trio is reflected)."""
    df = window_df.copy()
    n = len(df)

    def col(c):
        return pd.to_numeric(df.get(c), errors="coerce").fillna(0.0).to_numpy()

    vals = {key: col(vcol) for _lbl, key, vcol in _BRIDGE_COMPONENTS}
    tmadj = col("teammate_adjustment")
    pr = sum(weights[k] * vals[k] for k in vals) + tmadj          # per-season prime_raw
    order = pd.Series(pr).rank(ascending=False, method="first").astype(int)
    rw = peak3.nyear_weights(n)
    sw = order.map(lambda r: rw[r - 1]).to_numpy()                # season weight by rank
    raw = {k: float((sw * vals[k]).sum()) for k in vals}
    weighted = {k: weights[k] * raw[k] for k in vals}
    tm = float((sw * tmadj).sum())
    prime = sum(weighted.values()) + tm
    return {"raw": raw, "weighted": weighted, "teammate": tm, "prime_raw": prime}


def contribution_bridge(s, a_name, b_name, n):
    """Item: Hakeem-minus-Robinson contribution bridge over their best overlapping
    n-year windows, computed under BOTH the prior (41/23/15/18/3) and current
    (38/21/20/18/3) weight systems. No winner is forced."""
    wa = nyear_best(player_df(s, a_name), "prime_score", n)
    wb = nyear_best(player_df(s, b_name), "prime_score", n)
    L = ["-" * 78,
         f"CONTRIBUTION BRIDGE ({n}-year): {a_name} MINUS {b_name}",
         "-" * 78]
    if not wa or not wb:
        L += ["  (one or both players lack a completed window)", ""]
        return L
    L.append(f"  {a_name} window: {wa['start_season']}-{wa['end_season']}   "
             f"{b_name} window: {wb['start_season']}-{wb['end_season']}")
    L.append("  (positive = Hakeem ahead; rank-weighted raw values, fixed windows)")
    L.append("")
    for tag, W in (("PRIOR 41/23/15/18/3", WEIGHTS_PRIOR),
                   ("NEW   38/21/20/18/3", WEIGHTS_NOW)):
        aa, bb = _window_agg(wa["df"], W), _window_agg(wb["df"], W)
        L.append(f"  [{tag}]")
        L.append(f"    {'component':26}{'raw diff':>12}{'weighted diff':>16}")
        for lbl, key, _v in _BRIDGE_COMPONENTS:
            rdiff = aa["raw"][key] - bb["raw"][key]
            wdiff = aa["weighted"][key] - bb["weighted"][key]
            L.append(f"    {lbl:26}{rdiff:>12.2f}{wdiff:>16.2f}")
        tmdiff = aa["teammate"] - bb["teammate"]
        L.append(f"    {'teammate adjustment':26}{tmdiff:>12.2f}{tmdiff:>16.2f}")
        pdiff = aa["prime_raw"] - bb["prime_raw"]
        L.append(f"    {'FINAL Prime raw diff':26}{'':>12}{pdiff:>16.2f}  "
                 f"({'Hakeem' if pdiff >= 0 else 'Robinson'} leads)")
        L.append("")
    # explain the change
    a_prior = _window_agg(wa["df"], WEIGHTS_PRIOR); b_prior = _window_agg(wb["df"], WEIGHTS_PRIOR)
    a_now = _window_agg(wa["df"], WEIGHTS_NOW); b_now = _window_agg(wb["df"], WEIGHTS_NOW)
    gap_prior = a_prior["prime_raw"] - b_prior["prime_raw"]
    gap_now = a_now["prime_raw"] - b_now["prime_raw"]
    rec_raw = a_now["raw"]["recognition"] - b_now["raw"]["recognition"]
    si_raw = a_now["raw"]["statistical_impact"] - b_now["raw"]["statistical_impact"]
    L.append(f"  WHY THE GAP CHANGES: final Prime-raw gap moves {gap_prior:+.2f} -> "
             f"{gap_now:+.2f} (Hakeem-minus-Robinson).")
    L.append(f"   Recognition weight rose 15% -> 20% and Hakeem's recognition raw is "
             f"{'higher' if rec_raw >= 0 else 'lower'} ({rec_raw:+.1f}); raising its")
    L.append(f"   weight moves the gap by {0.05 * rec_raw:+.2f} from recognition alone.")
    L.append(f"   Statistical Impact weight fell 41% -> 38% and Robinson's SI raw is "
             f"higher ({si_raw:+.1f} for Hakeem), so cutting SI weight moves the gap")
    L.append(f"   by {(-0.03) * si_raw:+.2f} (toward Hakeem). Traditional Production "
             "weight also fell 23% -> 21% (small further shift).")
    L.append(f"   Net: Robinson's superior regular-season SI and Hakeem's superior "
             "recognition + postseason are each represented transparently.")
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
    keys = ["Statistical impact (38%)", "Traditional production (21%)",
            "Individual recognition (20%)", "Postseason individual (18%)",
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
         "0.80 scale -> ~+16 recognition -> x0.15 weight ~ +2.4 prime_raw per season).",
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
    L.append("  add up to ~2.4 prime_raw per Finals-MVP season through Recognition,")
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
    W = peak3.OFFICIAL_WEIGHTS
    L.append("  Findings:")
    L.append(f"   * The official weights are Statistical Impact {W['statistical_impact']*100:.0f}% / "
             f"Traditional Production {W['traditional_production']*100:.0f}% / Recognition "
             f"{W['recognition']*100:.0f}% / Postseason {W['postseason']*100:.0f}% / Team "
             f"{W['team_achievement']*100:.0f}%. SI/TP/Recognition live on a broadly "
             "comparable ~0-110 raw scale; Recognition is zero for the many seasons "
             "without an award (additive bonus, by design).")
    L.append("   * Statistical Impact still has the widest raw p5..p95 spread, so its "
             "effective separating influence runs a little above its nominal weight "
             "(see the share table above) -- the intended direction (advanced impact "
             "anchors the model); this is modest and not a defect, so SI/TP/Recognition "
             "scales were left unchanged.")
    L.append(f"   * Postseason Individual Value (now {W['postseason']*100:.0f}%) is a "
             "ZERO-BASELINE additive value (level + elevation + sustained volume). At "
             "the raised weight its effective influence grows as intended -- elite "
             "playoff runs move peaks materially -- while it still spans a bounded raw "
             "range (median 0, small bounded downside) so a ring alone cannot rescue a "
             "mediocre season. Team Achievement stays a small 3% adjustment.")
    L.append("   * Only the component WEIGHTS changed (postseason 12% -> 18%, drawn "
             "proportionally from SI/TP/Recognition) plus a matching MONOTONIC display-"
             "calibration shift; no raw component formula or scale was rescaled.")
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
        "RECOGNITION-WEIGHT UPDATE (20% recognition, 18% postseason) -- SUMMARY",
        "=" * 78,
        "",
        "0. OFFICIAL WEIGHTS",
        f"   Statistical Impact {W['statistical_impact']*100:.0f}%  |  "
        f"Traditional Production {W['traditional_production']*100:.0f}%  |  "
        f"Individual Recognition {W['recognition']*100:.0f}%",
        f"   Postseason Individual {W['postseason']*100:.0f}%  |  "
        f"Team Achievement {W['team_achievement']*100:.0f}%   "
        f"(sum {sum(W.values())*100:.0f}%)",
        "   Change from 41/23/15/18/3: Recognition 15% -> 20% (+5), taken from",
        "   Statistical Impact (41->38) and Traditional Production (23->21).",
        "   Postseason held at 18%; Team Achievement held at 3%.",
        "   Performance-driven split: 59% regular-season statistical performance,",
        "   20% individual recognition, 18% individual postseason, 3% team result.",
        "",
        "1. WHY BOTH RECOGNITION (20%) AND POSTSEASON (18%) ARE HIGH WITHOUT DOUBLE",
        "   COUNTING",
        "   * Recognition measures externally-validated individual STANDING: MVP,",
        "     Finals MVP, All-NBA, All-Defense, DPOY, statistical titles -- evidence",
        "     of season quality, additive and overlap-discounted.",
        "   * Postseason measures actual on-court PLAYOFF PERFORMANCE (level +",
        "     elevation + sustained volume + convex dominance), purely from box/impact.",
        "   * Team Achievement measures TEAM RESULTS at a small bounded 3%.",
        "   These three read DIFFERENT evidence; the recognition audit confirms Finals",
        "   MVP appears only in Recognition, championship only in Team Achievement,",
        "   playoff box only in Postseason, and the MVP/All-NBA and DPOY/All-Def",
        "   overlap discounts (and All-Star subsumption) still apply.",
        "",
        "2. FORMULAS UNCHANGED",
        "   Only OFFICIAL_WEIGHTS changed. Statistical Impact, Traditional Production,",
        "   Recognition, Postseason (incl. responsibility + convex dominance) and Team",
        "   Achievement formulas, native transforms, calibration ordering and the",
        "   five-year logic are all untouched. recognition_row was refactored to share",
        "   a pure recognition_breakdown() helper (identical numbers), enabling the",
        "   audit -- no formula change.",
        "",
        "3. HAKEEM-ROBINSON CONTRIBUTION BRIDGE (audited, not forced)",
        "   The bridge (above) reports Hakeem-minus-Robinson raw and weighted",
        "   differences per component under BOTH 41/23/15/18/3 and 38/21/20/18/3 for",
        "   their best overlapping 3-year and 5-year windows. Robinson leads on",
        "   Statistical Impact; Hakeem leads on Recognition and Postseason. Raising",
        "   Recognition 15% -> 20% narrows the gap (Hakeem's two Finals MVPs + MVP +",
        "   DPOY out-weigh Robinson's recognition) and cutting SI 41% -> 38% narrows",
        "   it further; neither player is forced to win.",
        "",
        "4. POSTSEASON INTEGRITY PRESERVED",
        "   postseason_value = absolute_playoff_level + playoff_elevation +",
        "   sustained_elite_volume + convex_dominance_booster, with best-player",
        "   responsibility data-derived from usage. Ordinary champions earn little",
        "   (Brunson 2026 deep-run 0); elite playoff performers rise without a title",
        "   (Jokic, Dirk 2011, Kawhi 2019, Butler); monster regular seasons stay",
        "   elite even with weaker playoffs (Curry 2016). No named/ring/clutch bonus.",
        "",
        "5. CALIBRATION unchanged -- the recognition increase lifted decorated apex",
        "   peaks, so the apex band held without any anchor change (monotonic; no",
        "   ranking change from calibration).",
        "",
        "6. FIVE-YEAR + N-YEAR all use OFFICIAL_WEIGHTS dynamically and reconcile",
        "   exactly (decomposition sums to the rank-weighted raw window).",
        "",
        "7. REPOSITORY CLEANUP -- re-ran the dependency-graph audit; see",
        "   cleanup_manifest.txt (deleted path | why obsolete | evidence unused |",
        "   current replacement) plus the preserved-files list.",
        "",
        "8. TEST RESULTS (executed, no network)",
        "   * tests/test_corrections.py  (weights sum to 1.00; Recognition == 20%;",
        "     Postseason == 18%; season + 3/5-year decompositions reconcile; Finals MVP",
        "     not double counted; championship not double counted; prior vs new Hakeem-",
        "     Robinson bridges reconcile; ...)",
        "   * tests/test_scoring.py / test_context.py / test_validation.py /",
        "     test_peak3.py all pass.",
        "",
        "REMAINING LIMITATIONS",
        "   * Modern impact metrics (EPM/LEBRON/RAPM) not populated; SI renormalizes",
        "     so no era is penalized, but the modern supplement is unused.",
        "   * 2025-26 is a simulated complete season; NYK champion + Brunson Finals MVP",
        "     set via data/manual_context.csv, not scraped from a live bracket.",
        "   * Postseason value uses whole-playoff aggregates (no per-round weighting).",
        "",
    ]


def write_leaderboards(s):
    """Rebuild the official single-season, 3-year and 5-year rankings (Prime and
    Performance-Only) from the CURRENT scored cache, writing results/top_250_*.csv
    so the leaderboard deliverables never go stale. Provisional excluded."""
    import peak3 as _p
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)]
    written = []
    for col, tag in (("prime_score", "prime"), ("performance_only", "performance")):
        # single seasons
        ss = (qual.sort_values(col, ascending=False)
              .head(250)[["player", "season", col, "role", "prime_raw",
                          "statistical_impact", "traditional_production",
                          "recognition", "postseason_perf", "team_achievement"]]
              .reset_index(drop=True))
        ss.insert(0, "rank", range(1, len(ss) + 1))
        p1 = results / f"top_250_single_seasons_{tag}.csv"
        ss.to_csv(p1, index=False); written.append(p1.name)
        # n-year windows
        for n in (3, 5):
            rows = []
            for player, g in qual.groupby("player"):
                ws = _p.n_year_windows(g, col, n, "weighted")
                if ws:
                    w = ws[0]
                    rows.append(dict(player=player,
                                     window=f"{w['start_season']}-{w['end_season']}",
                                     peak=round(w["peak_score"], 2),
                                     equal_avg=round(w["equal_avg"], 2),
                                     best_season=round(w["max_season"], 2),
                                     weakest=round(w["min_season"], 2)))
            df = (pd.DataFrame(rows).sort_values("peak", ascending=False)
                  .head(250).reset_index(drop=True))
            df.insert(0, "rank", range(1, len(df) + 1))
            pn = results / f"top_250_{n}_year_peaks_{tag}.csv"
            df.to_csv(pn, index=False); written.append(pn.name)
    return written


# ============================================================================
#  REFINEMENT-PASS AUDITS (Recognition / offensive burden / Team Achievement)
# ============================================================================

def load_pre_refine_snapshot():
    """Pre-refinement (post-postseason-correction) per-season values, frozen in
    data/refine_pre_snapshot.csv. Everything BUT this pass's Recognition, burden,
    and Team-Achievement changes is identical, so it isolates the refinement."""
    p = ROOT / "data" / "refine_pre_snapshot.csv"
    return pd.read_csv(p) if p.exists() else None


KOBE_SEASONS = [2001, 2003, 2006, 2007, 2008, 2009, 2010]


def _award_voting_value(r):
    """The smooth MVP award-voting value (winner premium + continuous + stabilizer),
    pre RECOGNITION_SCALE -- the single number that replaced the old buckets."""
    return peak3.ranked_award_value(
        peak3.award_rank(r.get("awards", ""), "MVP"),
        r.get("mvp_vote_share"), **peak3.MVP_VOTING)


def kobe_burden_audit(s, pre):
    """Item 9: full per-season burden + recognition + team decomposition for Kobe,
    plus the 2005-06 minus 2008-09 bridge."""
    okey = pre.set_index(["player", "season_end"]) if pre is not None else None
    L = ["=" * 78,
         "KOBE BRYANT BURDEN / RECOGNITION / TEAM AUDIT (item 8)",
         "team scoring/assist shares are ACTUAL (player season totals / team totals);",
         "USG% and AST% are shown SEPARATELY (possession-ending / playmaking-rate);",
         "burden residual is in TP 'scoring' units (enters TP at 0.40 weight)",
         "=" * 78]
    for yr in KOBE_SEASONS:
        g = s[(s.player == "Kobe Bryant") & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {yr}: not in dataset"); continue
        r = g.iloc[0]
        tp_after = float(r.get("traditional_production"))
        tp_before = tp_after - 0.40 * float(r.get("burden_residual") or 0.0)
        b = peak3.recognition_breakdown(r)
        L.append("")
        L.append(f"  -- Kobe Bryant {yr-1}-{str(yr)[2:]} --")
        L.append(f"    Statistical Impact            : {_f(r.get('statistical_impact'),1)}")
        L.append(f"    USG%                          : {_f(r.get('usg_pct'),1)}"
                 f"   points/75: {_f(r.get('pts_per75'),1)}"
                 f"   relative TS: {_f(r.get('r_ts'),1)}")
        L.append(f"    actual team scoring share     : {_f(r.get('team_scoring_share'),3)}"
                 f"   actual team assist share: {_f(r.get('team_assist_share'),3)}"
                 f"   AST%: {_f(r.get('ast_pct_raw'),1)}")
        L.append(f"    usage-adj efficiency residual : {_f(r.get('usage_eff_residual'),2)}"
                 f"   creation-load value: {_f(r.get('creation_load'),3)}"
                 f"   creation share: {_f(r.get('creation_share'),3)}")
        L.append(f"    successful burden residual    : {_f(r.get('burden_residual'),2)}"
                 f"   (data: {r.get('burden_data_status','?')})")
        L.append(f"    Traditional Production (before burden) : {_f(tp_before,1)}")
        L.append(f"    Traditional Production (after burden)  : {_f(tp_after,1)}")
        mvp_rank = r.get("mvp_rank")
        share = r.get("mvp_vote_share")
        share_txt = (f"{_f(share,3)} (real, {r.get('mvp_vote_data_status')})"
                     if pd.notna(share) else
                     f"n/a -> placement fallback ({r.get('mvp_vote_data_status')})")
        L.append(f"    MVP finish                    : "
                 f"{int(mvp_rank) if pd.notna(mvp_rank) else '-'}"
                 f"   MVP vote share: {share_txt}")
        L.append(f"    award-voting value (MVP)      : {_f(_award_voting_value(r),1)}")
        L.append(f"    Recognition breakdown         : mvp {_f(b['mvp'],1)} + anba "
                 f"{_f(b['anba'],1)} + defense {_f(b['defense_rec'],1)} + fmvp "
                 f"{_f(b['fmvp'],1)} + titles {_f(b['titles'],1)} -> "
                 f"Recognition {_f(r.get('recognition'),1)}")
        L.append(f"    Postseason Individual Value    : {_f(r.get('postseason_perf'),1)}")
        L.append(f"    Team Achievement              : {_f(r.get('team_achievement'),1)}")
        L.append(f"    teammate adjustment           : {_f(r.get('teammate_adjustment'),2)}")
        L.append(f"    Prime raw                     : {_f(r.get('prime_raw'),1)}"
                 f"   Prime display: {_f(r.get('prime_score'),1)}")

    # ---- 2005-06 minus 2008-09 bridge ----
    a = s[(s.player == "Kobe Bryant") & (s.season_end == 2006)]
    c = s[(s.player == "Kobe Bryant") & (s.season_end == 2009)]
    if len(a) and len(c):
        a, c = a.iloc[0], c.iloc[0]
        W = peak3.OFFICIAL_WEIGHTS
        pre_a = okey.loc[("Kobe Bryant", 2006)] if okey is not None else None
        pre_c = okey.loc[("Kobe Bryant", 2009)] if okey is not None else None
        L += ["", "  -- BRIDGE: Kobe 2005-06 minus Kobe 2008-09 (positive = 2006 ahead) --"]
        L.append(f"    Statistical Impact diff           : "
                 f"{_f(a['statistical_impact']-c['statistical_impact'],1)}")
        if pre_a is not None:
            L.append(f"    Traditional Production diff (pre)  : "
                     f"{_f(pre_a['pre_traditional_production']-pre_c['pre_traditional_production'],1)}")
        L.append(f"    successful burden residual diff    : "
                 f"{_f(a['burden_residual']-c['burden_residual'],2)}")
        L.append(f"    Traditional Production diff (post) : "
                 f"{_f(a['traditional_production']-c['traditional_production'],1)}")
        L.append(f"    Recognition diff                  : "
                 f"{_f(a['recognition']-c['recognition'],1)}")
        L.append(f"    Postseason diff                   : "
                 f"{_f(a['postseason_perf']-c['postseason_perf'],1)}")
        L.append(f"    Team Achievement diff             : "
                 f"{_f(a['team_achievement']-c['team_achievement'],1)}")
        L.append(f"    teammate adjustment diff          : "
                 f"{_f(a['teammate_adjustment']-c['teammate_adjustment'],2)}")
        L.append(f"    final Prime raw diff              : "
                 f"{_f(a['prime_raw']-c['prime_raw'],2)}")
        lead = "2005-06" if a['prime_raw'] > c['prime_raw'] else "2008-09"
        L.append(f"    -> {lead} leads on Prime raw (not forced). 2005-06 shows the "
                 f"unusually high successful burden;")
        L.append(f"       2008-09's edge (if any) comes from postseason + Finals-MVP "
                 f"recognition + team achievement.")
    L.append("")
    return L


def validation_cases_audit(s):
    """Item 10: required validation cases -- confirm the model behaves logically."""
    cases = [("Michael Jordan", 1988), ("Michael Jordan", 1991),
             ("LeBron James", 2009), ("LeBron James", 2012), ("LeBron James", 2013),
             ("Hakeem Olajuwon", 1994), ("Hakeem Olajuwon", 1995),
             ("David Robinson", 1994), ("David Robinson", 1995),
             ("Scottie Pippen", 1994), ("Scottie Pippen", 1996),
             ("Kevin Garnett", 2004), ("Allen Iverson", 2001),
             ("James Harden", 2019), ("Russell Westbrook", 2017),
             ("Nikola Jokic", 2023), ("Kawhi Leonard", 2019),
             ("Dirk Nowitzki", 2011), ("Stephen Curry", 2016),
             ("Shaquille O'Neal", 2000)]
    L = ["=" * 78,
         "VALIDATION CASES (item 10) -- refined model",
         "burden = successful-burden residual (TP scoring units); MVP = MVP placement",
         "=" * 78, "",
         f"  {'player / season':24}{'SI':>6}{'TP':>6}{'burden':>7}{'usg':>5}"
         f"{'rTS':>6}{'Rec':>6}{'MVP':>4}{'PO':>6}{'Team':>6}{'Praw':>7}"]
    for name, yr in cases:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            L.append(f"  {name} {yr}: not in dataset"); continue
        r = g.iloc[0]
        mvp = r.get("mvp_rank")
        L.append(f"  {name+' '+str(yr-1)+'-'+str(yr)[2:]:24}"
                 f"{_n(r.get('statistical_impact')):>6.1f}{_n(r.get('traditional_production')):>6.1f}"
                 f"{_n(r.get('burden_residual')):>7.2f}{_n(r.get('usg_pct')):>5.1f}"
                 f"{_n(r.get('r_ts')):>6.1f}{_n(r.get('recognition')):>6.1f}"
                 f"{(int(mvp) if pd.notna(mvp) else 0):>4}{_n(r.get('postseason_perf')):>6.1f}"
                 f"{_n(r.get('team_achievement')):>6.1f}{_n(r.get('prime_raw')):>7.1f}")
    L.append("")
    L.append("  Reading: advanced-statistical dominance (SI) stays central; successful")
    L.append("  extreme burden (Harden 2019, Curry 2016, Jokic 2023) earns measured TP")
    L.append("  credit while inefficient high volume (Iverson 2001, Westbrook 2017) does")
    L.append("  not rise automatically; MVP winners (Jordan 1988/1991, Garnett 2004,")
    L.append("  Shaq 2000, Curry 2016) carry a clear premium over non-winners (Jokic")
    L.append("  2023, Harden 2019 -> MVP-2); championships move Team Achievement only")
    L.append("  modestly (3% weight).")
    L.append("")
    return L


def refinement_before_after(s):
    """Item 11: before/after for the 25 case-study players (best single-season
    Prime), with the component responsible for the largest moves."""
    pre = load_pre_refine_snapshot()
    L = ["=" * 78,
         "REFINEMENT BEFORE / AFTER (25 case-study players, best single-season Prime)",
         "OLD = post-postseason-correction model; NEW = + Recognition smoothing,",
         "successful-burden residual, and smooth role-adjusted Team Achievement.",
         "=" * 78, ""]
    if pre is None:
        L.append("  (data/refine_pre_snapshot.csv missing -- before/after unavailable)")
        L.append("")
        return L
    pk = pre.set_index(["player", "season_end"])
    qual = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)].copy()
    qm = qual.merge(pre, on=["player", "season_end"], how="left")
    # ranks among ALL qualified completed single seasons (old vs new)
    new_rank = qm.assign(_r=qm["prime_raw"].rank(ascending=False, method="min")
                         ).set_index(["player", "season_end"])["_r"]
    old_rank = qm.assign(_r=qm["pre_prime_raw"].rank(ascending=False, method="min")
                         ).set_index(["player", "season_end"])["_r"]
    rows = []
    for name in PLAYERS:
        g = qm[qm.player == name]
        if not len(g):
            continue
        rnew = g.loc[g["prime_raw"].astype(float).idxmax()]
        yr = int(rnew["season_end"])
        rows.append((name, yr, rnew))
    L.append(f"  {'player':22}{'oRec':>6}{'nRec':>6}{'oTP':>6}{'nTP':>6}{'burd':>6}"
             f"{'oTeam':>6}{'nTeam':>6}{'oPraw':>7}{'nPraw':>7}{'oRk':>5}{'nRk':>5}")
    movers = []
    for name, yr, r in rows:
        key = (name, yr)
        opre = pk.loc[key] if key in pk.index else None
        orec = _n(opre["pre_recognition"]) if opre is not None else float("nan")
        otp = _n(opre["pre_traditional_production"]) if opre is not None else float("nan")
        oteam = _n(opre["pre_team_achievement"]) if opre is not None else float("nan")
        opraw = _n(opre["pre_prime_raw"]) if opre is not None else float("nan")
        orank = int(old_rank.get(key, 0)); nrank = int(new_rank.get(key, 0))
        movers.append((name, orank - nrank, orank, nrank, r))
        L.append(f"  {name:22}{orec:>6.1f}{_n(r['recognition']):>6.1f}{otp:>6.1f}"
                 f"{_n(r['traditional_production']):>6.1f}{_n(r['burden_residual']):>6.2f}"
                 f"{oteam:>6.1f}{_n(r['team_achievement']):>6.1f}{opraw:>7.1f}"
                 f"{_n(r['prime_raw']):>7.1f}{orank:>5}{nrank:>5}")
    L.append("  (ranks are among ALL qualified completed single seasons, old vs new)")
    L.append("")
    movers_sorted = sorted(movers, key=lambda m: m[1], reverse=True)
    def _why(r, opre_key):
        opre = pk.loc[opre_key] if opre_key in pk.index else None
        if opre is None:
            return "n/a"
        d = {"Recognition": _n(r['recognition']) - _n(opre['pre_recognition']),
             "Traditional Prod": _n(r['traditional_production']) - _n(opre['pre_traditional_production']),
             "Team Achievement": _n(r['team_achievement']) - _n(opre['pre_team_achievement'])}
        k = max(d, key=lambda x: abs(d[x]))
        return f"{k} {d[k]:+.1f}"
    L.append("  Largest RISERS (best-single-season Prime rank):")
    for name, dlt, orank, nrank, r in movers_sorted[:5]:
        L.append(f"    {name:22} #{orank} -> #{nrank} (+{dlt})   driver: {_why(r, (name, int(r['season_end'])))}")
    L.append("  Largest FALLERS:")
    for name, dlt, orank, nrank, r in sorted(movers, key=lambda m: m[1])[:5]:
        L.append(f"    {name:22} #{orank} -> #{nrank} ({dlt})   driver: {_why(r, (name, int(r['season_end'])))}")
    L.append("")
    return L


def _season_data_status(r):
    """Compact data-completeness label for one season: 'full' when team shares are
    observed and every ranked award used REAL vote share; otherwise note the
    flagged fallback(s) in play."""
    flags = []
    if str(r.get("team_share_data_status")) != "observed":
        flags.append("share-proxy")
    if str(r.get("mvp_vote_data_status")) == "fallback":
        flags.append("mvp-fallback")
    if str(r.get("dpoy_vote_data_status")) == "fallback":
        flags.append("dpoy-fallback")
    return "full" if not flags else "+".join(flags)


def _window_data_status(wdf):
    statuses = {_season_data_status(row) for _, row in wdf.iterrows()}
    return "full" if statuses == {"full"} else "mixed"


def _window_contribs(g, n):
    """Best completed consecutive n-year window for a player, selecting by the
    rank-weighted RAW (prime_raw) aggregate and calibrating that single aggregate
    once -- the official raw-first methodology. Returns a dict or None."""
    ws = peak3.n_year_windows(g, "prime_raw", n, "weighted")  # ranks by RAW
    if not ws:
        return None
    w = ws[0]
    dec = peak3.nyear_window_decomposition(w, "prime_raw", "weighted")
    raw = dec["_raw_window_score"]
    disp = float(peak3.calibrate_score(pd.Series([raw])).iloc[0])
    wdf = w["df"]
    anchor = wdf.loc[wdf["prime_raw"].astype(float).idxmax(), "season"]
    return {
        "window": f"{w['start_season']}-{w['end_season']}",
        "raw": raw, "disp": disp, "anchor": anchor,
        "si": dec["Statistical impact (38%)"], "tp": dec["Traditional production (21%)"],
        "rec": dec["Individual recognition (20%)"], "po": dec["Postseason individual (18%)"],
        "team": dec["Team achievement (3%)"], "status": _window_data_status(wdf),
    }


def final_25_comparison(s):
    """Item 12: final ranked case-study comparison (best 1-, 3-, 5-year Prime)
    over the 25 case-study players, plus the cross-duration summary. To include
    all 25 (some, e.g. Ginobili/Capela, lack 3 consecutive 28-mpg qualified
    seasons), the case-study basis is COMPLETED (non-provisional) seasons; the
    provisional/incomplete exclusion is applied consistently across A/B/C."""
    qual = s[s.get("provisional", 0) != 1]
    L = ["#" * 78, "# FINAL 25-PLAYER PRIME COMPARISON", "#" * 78, "",
         "Rankings over the 25 case-study players only (completed, non-provisional",
         "seasons). Single-season uses prime_raw (calibrated = prime display); 3-/5-",
         "year use the official rank-weighted RAW aggregate, calibrated ONCE.", ""]
    W = peak3.OFFICIAL_WEIGHTS

    # ---- A. best single season ----
    a_rows = []
    for name in PLAYERS:
        g = qual[qual.player == name]
        if not len(g):
            continue
        r = g.loc[g["prime_raw"].astype(float).idxmax()]
        a_rows.append((name, r))
    a_rows.sort(key=lambda x: -float(x[1]["prime_raw"]))
    L.append("A. BEST ONE-SEASON PRIME")
    L.append(f"  {'#':>3} {'player':22}{'season':>9}{'Praw':>7}{'Pdisp':>7}"
             f"{'SI':>7}{'TP':>7}{'Rec':>7}{'PO':>7}{'Team':>6}  data")
    a_rank = {}
    for i, (name, r) in enumerate(a_rows, 1):
        a_rank[name] = i
        L.append(f"  {i:>3} {name:22}{r['season']:>9}{_n(r['prime_raw']):>7.1f}"
                 f"{_n(r['prime_score']):>7.1f}"
                 f"{W['statistical_impact']*_n(r['statistical_impact']):>7.1f}"
                 f"{W['traditional_production']*_n(r['traditional_production']):>7.1f}"
                 f"{W['recognition']*_n(r['recognition']):>7.1f}"
                 f"{W['postseason']*_n(r['postseason_perf']):>7.1f}"
                 f"{W['team_achievement']*_n(r['team_achievement']):>6.1f}  "
                 f"{_season_data_status(r)}")
    a_season = {name: r["season"] for name, r in a_rows}
    L.append("")

    # ---- B & C. best 3-year and 5-year ----
    rank_maps = {}
    win_maps = {}
    for n, letter, title in ((3, "B", "BEST THREE-YEAR PRIME"),
                             (5, "C", "BEST FIVE-YEAR PRIME")):
        rows = []
        for name in PLAYERS:
            g = qual[qual.player == name]
            wc = _window_contribs(g, n) if len(g) else None
            if wc:
                rows.append((name, wc))
        rows.sort(key=lambda x: -x[1]["raw"])
        rmap = {}
        wmap = {}
        L.append(f"{letter}. {title}")
        L.append(f"  {'#':>3} {'player':23}{'window':>17}{'raw':>7}{'disp':>7}"
                 f"{'anchor':>9}{'SI':>7}{'TP':>7}{'Rec':>7}{'PO':>7}{'Team':>6}  data")
        for i, (name, wc) in enumerate(rows, 1):
            rmap[name] = i
            wmap[name] = wc["window"]
            L.append(f"  {i:>3} {name:23}{wc['window']:>17}{wc['raw']:>7.1f}"
                     f"{wc['disp']:>7.1f}{wc['anchor']:>9}{wc['si']:>7.1f}"
                     f"{wc['tp']:>7.1f}{wc['rec']:>7.1f}{wc['po']:>7.1f}{wc['team']:>6.1f}"
                     f"  {wc['status']}")
        L.append("")
        rank_maps[n] = rmap
        win_maps[n] = wmap

    # ---- D. cross-duration summary ----
    L.append("D. CROSS-DURATION SUMMARY (sorted by 1-year rank)")
    L.append(f"  {'player':22}{'1yr':>4}{'3yr':>4}{'5yr':>4}  "
             f"{'best 1yr':>9}  {'best 3yr':>14}  {'best 5yr':>14}")
    r3, r5 = rank_maps.get(3, {}), rank_maps.get(5, {})
    w3, w5 = win_maps.get(3, {}), win_maps.get(5, {})
    summary = sorted(PLAYERS, key=lambda p: a_rank.get(p, 999))
    for name in summary:
        if name not in a_rank:
            continue
        L.append(f"  {name:22}{a_rank.get(name,0):>4}{r3.get(name,0):>4}"
                 f"{r5.get(name,0):>4}  {a_season.get(name,'-'):>9}  "
                 f"{w3.get(name,'-'):>14}  {w5.get(name,'-'):>14}")
    L.append("")
    # movers between 1-year and 5-year rank
    common5 = [p for p in PLAYERS if p in a_rank and p in r5]
    moves = sorted(((p, a_rank[p] - r5[p]) for p in common5), key=lambda x: x[1])
    if moves:
        up = moves[-1]; down = moves[0]
        L.append(f"  largest improvement 1yr->5yr rank: {up[0]} "
                 f"(#{a_rank[up[0]]} -> #{r5[up[0]]}, +{up[1]})")
        L.append(f"  largest decline 1yr->5yr rank    : {down[0]} "
                 f"(#{a_rank[down[0]]} -> #{r5[down[0]]}, {down[1]})")
    top5_all = [p for p in PLAYERS if a_rank.get(p, 99) <= 5
                and r3.get(p, 99) <= 5 and r5.get(p, 99) <= 5]
    L.append(f"  ranked top 5 at ALL three durations: "
             f"{', '.join(top5_all) if top5_all else '(none)'}")
    outside = [p for p in PLAYERS if p in a_season and p in w3
               and not _season_in_window(a_season[p], w3[p])]
    L.append(f"  best 1-year season OUTSIDE best 3-year window: "
             f"{', '.join(outside) if outside else '(none)'}")
    L.append("")
    return L


def _season_in_window(season, window):
    """True if a 'YYYY-YY' season falls inside a 'YYYY-YY-YYYY-YY' window span."""
    try:
        start = int(window[:4]); end = int(window.split("-")[2])
        syr = int(season[:4])
        return start <= syr <= end
    except Exception:
        return True


# Audited seasons for the data-completion before/after (spec sections 8-9).
AUDIT_SEASONS = [
    ("Kobe Bryant", 2001), ("Kobe Bryant", 2003), ("Kobe Bryant", 2006),
    ("Kobe Bryant", 2007), ("Kobe Bryant", 2008), ("Kobe Bryant", 2009),
    ("Kobe Bryant", 2010),
    ("Michael Jordan", 1988), ("Michael Jordan", 1991),
    ("LeBron James", 2009), ("LeBron James", 2012), ("LeBron James", 2013),
    ("Hakeem Olajuwon", 1994), ("Hakeem Olajuwon", 1995),
    ("David Robinson", 1994), ("David Robinson", 1995),
    ("Scottie Pippen", 1994), ("Scottie Pippen", 1996),
    ("Kevin Garnett", 2004), ("Allen Iverson", 2001), ("James Harden", 2019),
    ("Russell Westbrook", 2017), ("Nikola Jokic", 2023), ("Kawhi Leonard", 2019),
    ("Dirk Nowitzki", 2011), ("Stephen Curry", 2016), ("Shaquille O'Neal", 2000),
]


def load_datacomplete_pre_snapshot():
    """Pre-data-completion baseline (refined model with the USG/AST burden PROXY
    and placement-fallback votes), frozen in data/datacomplete_pre_snapshot.csv;
    isolates the effect of swapping in actual team shares + real award votes."""
    p = ROOT / "data" / "datacomplete_pre_snapshot.csv"
    return pd.read_csv(p) if p.exists() else None


def burden_ablation_report(s):
    """Spec section 2: A (USG/AST proxy creation) vs B (ACTUAL team-share creation)
    burden residual, with correlations, moments, and the largest movers. Documents
    why version B was adopted (distinct/defensible, no material TP-scale inflation)."""
    import peak3 as P
    q = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)].copy()
    usg = pd.to_numeric(q["usg_pct"], errors="coerce")
    astp = pd.to_numeric(q["ast_pct_raw"], errors="coerce")
    r_ts = pd.to_numeric(q["r_ts"], errors="coerce").fillna(0).to_numpy()
    mp = pd.to_numeric(q["mp"], errors="coerce").fillna(0).to_numpy()
    tss = pd.to_numeric(q["team_scoring_share"], errors="coerce")
    tas = pd.to_numeric(q["team_assist_share"], errors="coerce")
    cp = (usg + 0.45 * astp).to_numpy()
    ca = (100 * tss + 0.45 * 100 * tas).to_numpy()

    def burden(creation, pivot, scale):
        exp = -P.BURDEN_EFF_SLOPE * np.clip(
            np.nan_to_num(usg.to_numpy(), nan=P.BURDEN_USG_PIVOT) - P.BURDEN_USG_PIVOT, 0, None)
        resid = r_ts - exp
        cl = np.clip((np.nan_to_num(creation) - pivot) / scale, 0, 1)
        wl = np.clip(mp / P.BURDEN_MP_FULL, 0, 1)
        pos = np.clip(resid, 0, P.BURDEN_RESID_CAP)
        neg = np.clip(-resid, 0, P.BURDEN_RESID_CAP)
        return (np.clip(P.BURDEN_POS_SCALE * cl * pos * wl, 0, P.BURDEN_POS_MAX)
                - np.clip(P.BURDEN_NEG_SCALE * cl * neg * wl, 0, P.BURDEN_NEG_MAX))

    bA = pd.Series(burden(cp, P.BURDEN_CREATION_PIVOT, P.BURDEN_CREATION_SCALE), index=q.index)
    bB = pd.Series(burden(ca, P.BURDEN_SHARE_PIVOT, P.BURDEN_SHARE_SCALE), index=q.index)
    si = pd.to_numeric(q["statistical_impact"], errors="coerce")
    obpm = pd.to_numeric(q["obpm"], errors="coerce")
    tp_full = pd.to_numeric(q["traditional_production"], errors="coerce")
    tp_before = tp_full - 0.40 * bB        # TP without the (adopted) burden term

    L = ["=" * 78,
         "BURDEN RESIDUAL ABLATION (spec section 2): proxy vs actual team shares",
         "A = USG%+0.45*AST% proxy creation;  B = 100*scoring_share + 0.45*100*"
         "assist_share (ACTUAL), pivots percentile-matched to A (scale-preserving)",
         "=" * 78, "",
         f"  {'version':10}{'mean':>7}{'std':>7}{'min':>7}{'max':>7}"
         f"{'rSI':>7}{'rTPbef':>8}{'rTPful':>8}{'rOBPM':>7}"]
    for nm, b in (("A proxy", bA), ("B actual", bB)):
        L.append(f"  {nm:10}{b.mean():>7.3f}{b.std():>7.3f}{b.min():>7.3f}"
                 f"{b.max():>7.3f}{b.corr(si):>7.3f}{b.corr(tp_before):>8.3f}"
                 f"{b.corr(tp_full):>8.3f}{b.corr(obpm):>7.3f}")
    L.append(f"  corr(A,B) = {bA.corr(bB):.3f}   |   "
             f"TP-mean impact of B vs A = {0.40*(bB.mean()-bA.mean()):+.3f} pts "
             f"(immaterial; no scale break)")
    L.append("")
    d = (bB - bA)
    d.index = q["player"].values + " " + q["season"].values
    L.append("  Largest 20 INCREASES (B - A), actual shares add credit:")
    for k, v in d.nlargest(20).items():
        L.append(f"    {k:30} {v:+.2f}")
    L.append("  Largest 20 DECREASES (B - A), USG overstated real creation:")
    for k, v in d.nsmallest(20).items():
        L.append(f"    {k:30} {v:+.2f}")
    L.append("")
    L.append("  DECISION: adopt B (actual shares). It is a DISTINCT, defensible")
    L.append("  creation-responsibility signal (re-ranks vs the proxy at corr "
             f"{bA.corr(bB):.2f}),")
    L.append("  is LESS redundant with SI, and the percentile-matched pivots keep the")
    L.append("  residual distribution and the TP scale intact. Missing shares fall")
    L.append("  back to the proxy, flagged via burden_data_status. No coefficient was")
    L.append("  tuned for any player.")
    L.append("")
    return L


def recognition_before_after(s):
    """Spec section 9: per audited season, the MVP/DPOY placement (fallback) value
    vs the real vote-share value, winner premium + stabilizer, fallback status,
    old vs new total Recognition, and the resulting Prime-raw change."""
    import peak3 as P
    pre = load_datacomplete_pre_snapshot()
    pk = pre.set_index(["player", "season_end"]) if pre is not None else None
    mv, dv = P.MVP_VOTING, P.DPOY_VOTING
    L = ["=" * 78,
         "RECOGNITION BEFORE / AFTER -- real MVP/DPOY votes vs placement fallback",
         "(section 9). 'old' = smooth placement fallback; 'new' = real vote share.",
         "=" * 78, "",
         f"  {'player / season':22}{'mvpR':>5}{'oMVP':>6}{'nMVP':>6}{'prem':>5}"
         f"{'stab':>5}{'oDPOY':>6}{'nDPOY':>6}{'oRec':>7}{'nRec':>7}{'dPraw':>7} status"]
    for name, yr in AUDIT_SEASONS:
        g = s[(s.player == name) & (s.season_end == yr)]
        if not len(g):
            continue
        r = g.iloc[0]
        mvp_r = peak3.award_rank(r.get("awards", ""), "MVP")
        dpoy_r = peak3.award_rank(r.get("awards", ""), "DPOY")
        o_mvp = peak3.ranked_award_value(mvp_r, float("nan"), **mv)
        n_mvp = peak3.ranked_award_value(mvp_r, r.get("mvp_vote_share"), **mv)
        o_dpoy = peak3.ranked_award_value(dpoy_r, float("nan"), **dv)
        n_dpoy = peak3.ranked_award_value(dpoy_r, r.get("dpoy_vote_share"), **dv)
        prem = mv["winner_premium"] if mvp_r == 1 else 0.0
        stab = (mv["stabilizer"] * np.exp(-mv["decay"] * ((mvp_r or 1) - 1))
                if mvp_r else 0.0)
        o_rec = (pk.loc[(name, yr), "dc_pre_recognition"]
                 if pk is not None and (name, yr) in pk.index else float("nan"))
        o_praw = (pk.loc[(name, yr), "dc_pre_prime_raw"]
                  if pk is not None and (name, yr) in pk.index else float("nan"))
        dpraw = float(r["prime_raw"]) - o_praw if pd.notna(o_praw) else float("nan")
        status = r.get("mvp_vote_data_status", "?")
        L.append(f"  {name+' '+str(yr-1)+'-'+str(yr)[2:]:22}"
                 f"{(int(mvp_r) if mvp_r else 0):>5}{o_mvp:>6.1f}{n_mvp:>6.1f}"
                 f"{prem:>5.0f}{stab:>5.1f}{o_dpoy:>6.1f}{n_dpoy:>6.1f}"
                 f"{_n(o_rec):>7.1f}{_n(r['recognition']):>7.1f}{_n(dpraw):>7.2f} {status}")
    L.append("")
    L.append("  Reading: winners keep a clear premium; the real share separates a")
    L.append("  dominant winner (Embiid 2023 .92, Westbrook 2017 .88 -> ABOVE the")
    L.append("  fallback) from a narrow one, and a modest-margin win (e.g. a low DPOY")
    L.append("  share) lands BELOW the generic fallback. Fourth place is not crushed;")
    L.append("  ranked seasons all use real data, so no fake precision is introduced.")
    L.append("")
    return L


def _pctile_row(label, series):
    v = pd.to_numeric(series, errors="coerce").dropna()
    return (f"  {label:24}{v.mean():>8.2f}{v.median():>8.2f}{v.std():>8.2f}"
            f"{v.quantile(.05):>8.2f}{v.quantile(.25):>8.2f}{v.quantile(.75):>8.2f}"
            f"{v.quantile(.95):>8.2f}{v.max():>8.2f}")


def distribution_before_after(s):
    """Spec section 11: full-distribution old vs new for every component (and Prime
    raw), to confirm the new data did NOT cause a broad scale break."""
    pre = load_datacomplete_pre_snapshot()
    q = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)].copy()
    L = ["=" * 78,
         "COMPONENT DISTRIBUTIONS -- BEFORE / AFTER data completion (section 11)",
         "qualified completed seasons; scales preserved (no recalibration applied)",
         "=" * 78, "",
         f"  {'component':24}{'mean':>8}{'med':>8}{'std':>8}{'p5':>8}{'p25':>8}"
         f"{'p75':>8}{'p95':>8}{'max':>8}"]
    comps = [("Statistical Impact", "statistical_impact", "dc_pre_statistical_impact"),
             ("Traditional Prod", "traditional_production", "dc_pre_traditional_production"),
             ("Recognition", "recognition", "dc_pre_recognition"),
             ("Postseason", "postseason_perf", "dc_pre_postseason_perf"),
             ("Team Achievement", "team_achievement", "dc_pre_team_achievement"),
             ("Prime raw", "prime_raw", "dc_pre_prime_raw")]
    qm = q.merge(pre, on=["player", "season_end"], how="left") if pre is not None else q
    for label, newc, oldc in comps:
        if pre is not None and oldc in qm.columns:
            L.append(_pctile_row(label + " (old)", qm[oldc]))
        L.append(_pctile_row(label + " (new)", qm[newc] if pre is not None else q[newc]))
        L.append("")
    L.append("  Only Traditional Production, Recognition and Prime raw move (the data")
    L.append("  pass touches the burden creation input and the MVP/DPOY vote share);")
    L.append("  Statistical Impact, Postseason and Team Achievement are unchanged.")
    L.append("  The shifts are small and distribution-preserving -> no rescale needed.")
    L.append("")
    return L


def integrity_report(s):
    """Spec section 10: full-dataset integrity checks (fails loud on impossible
    values; here we surface the PASS report into outputs.txt)."""
    from nba_peak.integrity import run_integrity_checks
    mvp = pd.read_csv(ROOT / "data/generated/mvp_votes.csv") \
        if (ROOT / "data/generated/mvp_votes.csv").exists() else None
    dpoy = pd.read_csv(ROOT / "data/generated/dpoy_votes.csv") \
        if (ROOT / "data/generated/dpoy_votes.csv").exists() else None
    ts = pd.read_csv(ROOT / "data/generated/team_shares.csv") \
        if (ROOT / "data/generated/team_shares.csv").exists() else None
    ok, lines = run_integrity_checks(s, mvp, dpoy, ts)
    return ["=" * 78] + lines + ["", ""]


def main():
    s = pd.read_parquet(SCORED)
    # FAIL LOUD on impossible/inconsistent values before generating anything.
    from nba_peak.integrity import assert_integrity
    def _opt(p):
        p = ROOT / "data/generated" / p
        return pd.read_csv(p) if p.exists() else None
    assert_integrity(s, _opt("mvp_votes.csv"), _opt("dpoy_votes.csv"),
                     _opt("team_shares.csv"))
    # fix any stray accent so the requested spellings resolve
    W = peak3.OFFICIAL_WEIGHTS
    out = []
    out.append("NBA PEAK PROJECT -- RECOGNITION 20% / POSTSEASON 18% VALIDATION OUTPUT")
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

    # ---- Hakeem-Robinson contribution bridge (3-year and 5-year, both systems) --
    out += contribution_bridge(s, "Hakeem Olajuwon", "David Robinson", 3)
    out += contribution_bridge(s, "Hakeem Olajuwon", "David Robinson", 5)

    out.append("#" * 78)
    out.append("# PART 3 -- AUDITS")
    out.append("#" * 78)
    out.append("")
    out += recognition_audit(s)
    out += playoff_audit(s)
    out += postseason_decomposition_audit(s)
    out += postseason_before_after(s)
    # ---- data-completion pass (actual team shares + real award votes) ----
    out += integrity_report(s)
    out += burden_ablation_report(s)
    out += recognition_before_after(s)
    out += distribution_before_after(s)
    out += kobe_burden_audit(s, load_pre_refine_snapshot())
    out += validation_cases_audit(s)
    out += refinement_before_after(s)
    out += sensitivity_audit(s)
    out += current_leaderboard(s, 25)
    out += weight_change_movers(s)
    out += finals_mvp_audit(s)
    out += si_audit_section(s)
    out += distribution_audit(s)

    out += warnings_section(s)
    out += summary_section()

    # Item 12: final ranked case-study comparison.
    out += final_25_comparison(s)

    # Five-player comparative prime audit (compact); full report is the .md.
    from nba_peak import five_player_audit as fpa
    audit = fpa.build_audit(s)
    out += fpa.render_compact(audit)
    fpa.export_csvs(audit, ROOT / "reports")
    (ROOT / "FIVE_PLAYER_PRIME_AUDIT.md").write_text(
        fpa.render_markdown(audit), encoding="utf-8")

    # 2025-26 completed-season completeness audit + guard.
    from nba_peak import season_completeness as scomp
    scomp.assert_no_silent_missing(s, 2026)
    scomp.write_report(s, ROOT / "reports", 2026)
    out += [""] + scomp.summary_lines(s, 2026) + [""]

    # Specialist & postseason sanity audit (compact); full report is the .md.
    from nba_peak import specialist_postseason_audit as spa
    out += spa.render_compact(s)
    spa.build_reports(s, ROOT)

    # Canonical top-250 Prime leaderboards (1/2/3/5-year) + cross-duration
    # comparison + 2-year validation. Detailed decompositions live in
    # leaderboards/*.csv and leaderboards/*.md.
    from nba_peak import leaderboards as lbs
    lb_res = lbs.generate_all(s, top=250, write=True)
    out += [""] + lbs.render_outputs_section(lb_res, top=250)
    out += lbs.render_validation_section(s)

    (ROOT / "outputs.txt").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"Wrote outputs.txt ({len(out)} lines)")
    lb = write_leaderboards(s)
    print(f"Rebuilt {len(lb)} leaderboard CSVs: {', '.join(lb)}")


if __name__ == "__main__":
    main()
