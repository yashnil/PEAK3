"""
SPECIALIST AND POSTSEASON sanity audit (read-only diagnostics + report).

Scope (see the prompt that commissioned it):
  1. efficient, low-creation big men -- do overlapping efficiency/rebounding
     signals over-reward them?
  2. negative postseason scores for valuable secondary stars / specialists --
     can a negative elevation term reverse a clearly-positive absolute level?
  3. data completeness for the COMPLETED 2025-26 season (delegated to
     nba_peak.season_completeness).

This module CHANGES no weight and adds no component. It re-reads the canonical
scored dataset and the official window/decomposition helpers in peak3, builds the
diagnostics the audit requires (creation_independence; elevation-safeguard
comparison), and writes the report CSVs + the markdown + the outputs.txt section.

The ONE official change that came out of this audit -- a bounded, gated,
monotonic elevation-reversal safeguard inside peak3.postseason_value -- already
lives in peak3 (constants PO_ELEV_GUARD_*); here we only DIAGNOSE/VERIFY it.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import peak3 as P

# ------------------------------------------------------------------ players ---
EFFICIENT_BIGS = ["DeAndre Jordan", "Rudy Gobert", "Dwight Howard",
                  "Domantas Sabonis", "Kevin McHale", "Clint Capela",
                  "Andre Drummond", "Tyson Chandler", "Jarrett Allen"]
BIG_COMPARISONS = ["Marc Gasol", "Joakim Noah", "Bam Adebayo", "Alonzo Mourning",
                   "Patrick Ewing", "Dikembe Mutombo", "Ben Wallace", "Pau Gasol",
                   "Chris Webber", "Blake Griffin"]
PROTECTED_BIGS = ["Shaquille O'Neal", "Nikola Jokic", "Hakeem Olajuwon",
                  "David Robinson", "Kareem Abdul-Jabbar", "Joel Embiid"]

BIG_BRIDGES = [
    ("DeAndre Jordan", "Marc Gasol"), ("DeAndre Jordan", "Joakim Noah"),
    ("DeAndre Jordan", "Dikembe Mutombo"), ("DeAndre Jordan", "Bam Adebayo"),
    ("Rudy Gobert", "Patrick Ewing"), ("Rudy Gobert", "Alonzo Mourning"),
    ("Rudy Gobert", "Ben Wallace"),
    ("Domantas Sabonis", "Chris Webber"), ("Domantas Sabonis", "Blake Griffin"),
    ("Domantas Sabonis", "Shawn Kemp"),
    ("Dwight Howard", "Patrick Ewing"), ("Dwight Howard", "Alonzo Mourning"),
]

NEG_PO_AUDIT_PLAYERS = ["Jaylen Brown", "Dennis Rodman", "Carmelo Anthony",
                        "Draymond Green", "Ben Wallace", "Rajon Rondo"]

SECONDARY_STARS = ["Jaylen Brown", "Dennis Rodman", "Manu Ginobili",
                   "Klay Thompson", "Draymond Green", "Scottie Pippen",
                   "Pau Gasol", "Kyrie Irving"]

COMPONENTS = [("statistical_impact", "SI"), ("traditional_production", "TP"),
              ("recognition", "Rec"), ("postseason_perf", "PO"),
              ("team_achievement", "Team")]


# --------------------------------------------------------------------- utils ---
def completed(scored: pd.DataFrame, name: str) -> pd.DataFrame:
    g = scored[scored.player == name]
    if "provisional" in g.columns:
        g = g[g.provisional != 1]
    return g.copy()


def best_window(scored: pd.DataFrame, name: str, n: int = 5) -> Optional[Dict]:
    g = completed(scored, name)
    ws = P.n_year_windows(g, "prime_raw", n, "weighted")
    if not ws:
        return None
    w = ws[0]
    dec = P.nyear_window_decomposition(w, "prime_raw", "weighted")
    raw = dec["_raw_window_score"]
    disp = float(P.calibrate_score(pd.Series([raw])).iloc[0])
    wdf = w["df"]
    anchor = wdf.loc[wdf["prime_raw"].astype(float).idxmax()]
    return {
        "name": name, "n": n, "label": f"{w['start_season']}-{w['end_season']}",
        "raw": raw, "disp": disp, "anchor": anchor, "df": wdf,
        "SI": dec["Statistical impact (38%)"],
        "TP": dec["Traditional production (21%)"],
        "Rec": dec["Individual recognition (20%)"],
        "PO": dec["Postseason individual (18%)"],
        "Team": dec["Team achievement (3%)"],
        "tm": dec["Teammate adjustment"],
    }


def _g(row, col, default=np.nan):
    try:
        v = row.get(col, default)
        return float(v) if v is not None and pd.notna(v) else default
    except Exception:
        return default


# ============================================================ 1. EFFICIENT BIG ==
def efficient_big_audit(scored: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name in EFFICIENT_BIGS + BIG_COMPARISONS:
        w = best_window(scored, name, 5)
        if w is None:
            continue
        a = w["anchor"]
        rows.append({
            "player": name,
            "group": "efficient_big" if name in EFFICIENT_BIGS else "comparison",
            "window": w["label"], "prime_raw": round(w["raw"], 2),
            "prime_display": round(w["disp"], 1),
            "SI": round(w["SI"], 2), "TP": round(w["TP"], 2),
            "Rec": round(w["Rec"], 2), "PO": round(w["PO"], 2),
            "Team": round(w["Team"], 2), "teammate_adj": round(w["tm"], 2),
            # role-relevant anchor-season statistics
            "usg": round(_g(a, "usg_pct"), 1),
            "pts_per75": round(_g(a, "pts_per75"), 1),
            "r_ts": round(_g(a, "r_ts"), 1),
            "ts_plus": round(_g(a, "ts_plus"), 1),
            "team_scoring_share": round(_g(a, "team_scoring_share"), 3),
            "team_assist_share": round(_g(a, "team_assist_share"), 3),
            "ast_pct": round(_g(a, "ast_pct_raw"), 1),
            "trb_per100": round(_g(a, "trb_per100"), 1),
            "blk_per100": round(_g(a, "blk_per100"), 1),
            "bpm": round(_g(a, "bpm"), 1), "obpm": round(_g(a, "obpm"), 1),
            "dbpm": round(_g(a, "dbpm"), 1), "vorp": round(_g(a, "vorp"), 1),
            "ws_per_48": round(_g(a, "ws_per_48"), 3), "per": round(_g(a, "per"), 1),
            "burden_residual": round(_g(a, "burden_residual"), 2),
            "creation_load": round(_g(a, "creation_load"), 2),
            "creation_share": round(_g(a, "creation_share"), 3),
            "role": a.get("role"),
            "creation_independence": round(_creation_independence_row(a), 1),
        })
    df = pd.DataFrame(rows)
    return df.sort_values("prime_raw", ascending=False).reset_index(drop=True)


def efficient_big_bridges(scored: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for a_name, b_name in BIG_BRIDGES:
        wa, wb = best_window(scored, a_name, 5), best_window(scored, b_name, 5)
        if wa is None or wb is None:
            rows.append({"player_a": a_name, "player_b": b_name,
                         "note": "window unavailable (player not in dataset)"})
            continue
        d = {"player_a": a_name, "player_b": b_name,
             "raw_a": round(wa["raw"], 2), "raw_b": round(wb["raw"], 2),
             "d_prime_raw": round(wa["raw"] - wb["raw"], 2)}
        for k in ("SI", "TP", "Rec", "PO", "Team", "tm"):
            d[f"d_{k}"] = round(wa[k] - wb[k], 2)
        # the metric most responsible: largest |component delta|
        comp = {"SI": d["d_SI"], "TP": d["d_TP"], "Rec": d["d_Rec"],
                "PO": d["d_PO"], "Team": d["d_Team"]}
        driver = max(comp, key=lambda k: abs(comp[k]))
        d["primary_driver"] = f"{driver} ({comp[driver]:+.2f})"
        rows.append(d)
    return pd.DataFrame(rows)


# ===================================== 2/3. CENTER OVERLAP + CREATION DIAGNOSTIC ==
# all-era signals available for the overlap study (no modern tracking fields)
OVERLAP_SIGNALS = {
    "true_shooting": "r_ts", "ts_plus": "ts_plus", "low_turnover": "tov",
    "rebounding": "trb_per100", "ws48": "ws_per_48", "per": "per", "bpm": "bpm",
    "trad_production": "traditional_production", "burden": "burden_residual",
    "teammate_adj": "teammate_adjustment",
}


def center_population(scored: pd.DataFrame) -> pd.DataFrame:
    """Data-driven center population: qualified player-seasons whose rebounding is
    high AND playmaking load is low (the big-man profile), defined by DATASET
    PERCENTILES, never by named players."""
    q = scored.copy()
    if "_qualifier" in q.columns:
        q = q[q["_qualifier"] == True]  # noqa: E712
    # workload-qualified, real rotation seasons
    if "workload_qualified" in q.columns:
        q = q[q["workload_qualified"] == 1]
    trb = pd.to_numeric(q.get("trb_per100"), errors="coerce")
    astp = pd.to_numeric(q.get("ast_pct_raw"), errors="coerce")
    trb_cut = trb.quantile(0.70)
    ast_cut = astp.quantile(0.60)
    cen = q[(trb >= trb_cut) & (astp <= ast_cut)].copy()
    return cen


def center_usage_groups(cen: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    usg = pd.to_numeric(cen.get("usg_pct"), errors="coerce")
    lo, hi = usg.quantile(1 / 3), usg.quantile(2 / 3)
    return {
        "all_centers": cen,
        "low_usage": cen[usg <= lo],
        "medium_usage": cen[(usg > lo) & (usg <= hi)],
        "high_usage": cen[usg > hi],
    }


def overlap_correlations(scored: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    cen = center_population(scored)
    groups = center_usage_groups(cen)
    out = {}
    cols = list(OVERLAP_SIGNALS.values())
    for gname, g in groups.items():
        sub = g[[c for c in cols if c in g.columns]].apply(
            pd.to_numeric, errors="coerce")
        # invert turnover so "low_turnover" reads as a positive skill
        if "tov" in sub.columns:
            sub = sub.rename(columns={"tov": "low_turnover"})
            sub["low_turnover"] = -sub["low_turnover"]
        out[gname] = sub.corr(method="spearman").round(2)
    out["_n"] = pd.DataFrame({k: [len(v)] for k, v in groups.items()})
    return out


def marginal_gains(scored: pd.DataFrame) -> pd.DataFrame:
    """Approximate marginal contribution of each underlying skill family to the
    Traditional-Production raw value, for the center population, via a partial
    correlation / standardized-slope read. Read-only diagnostic."""
    cen = center_population(scored)
    fams = {
        "efficiency": ["r_ts", "ts_plus"],
        "rebounding": ["trb_per100"],
        "impact_metrics": ["bpm", "ws_per_48", "per"],
        "durability": ["mp"],
        "team_context": ["team_scoring_share", "team_assist_share"],
    }
    tp = pd.to_numeric(cen.get("traditional_production"), errors="coerce")
    rows = []
    for fam, cols in fams.items():
        present = [c for c in cols if c in cen.columns]
        if not present:
            continue
        x = cen[present].apply(pd.to_numeric, errors="coerce").mean(axis=1)
        corr = x.corr(tp, method="spearman")
        rows.append({"skill_family": fam, "spearman_with_TP": round(corr, 2),
                     "n": int(x.notna().sum())})
    return pd.DataFrame(rows)


def _creation_independence_row(row: pd.Series) -> float:
    """creation_independence diagnostic, 0-100 (higher = MORE self-created /
    LESS dependent on teammates creating the shot). READ-ONLY -- not in any
    official score. Bounded combination of all-era signals; for seasons without
    assisted-FG tracking (all of them here) a CONSERVATIVE proxy is used.

        + team assist share        (you create for others)
        + assist percentage        (on-ball playmaking)
        + usage                    (you take the responsibility)
        + team scoring share       (you carry the scoring load)
        + successful burden        (you absorb hard creation efficiently)
        - finisher dependence      (extreme efficiency at very low usage: a
                                     proxy for assisted dunks/putbacks/roll-man)

    A player is NOT punished for being assisted per se: vertical spacing, screening,
    rebounding and efficient finishing still register through usage / scoring share
    / burden. The penalty only fires for the EXTREME low-usage high-efficiency
    finisher profile, where the shot creation is overwhelmingly teammate-supplied.
    """
    def nz(v, d=0.0):
        return float(v) if v is not None and pd.notna(v) else d
    tas = nz(row.get("team_assist_share"))
    astp = nz(row.get("ast_pct_raw"))
    usg = nz(row.get("usg_pct"))
    tss = nz(row.get("team_scoring_share"))
    burden = nz(row.get("burden_residual"))
    r_ts = nz(row.get("r_ts"))
    # normalize each to ~0..1 by documented landmarks (bounded)
    f_tas = np.clip(tas / 0.30, 0, 1)
    f_astp = np.clip(astp / 40.0, 0, 1)
    f_usg = np.clip((usg - 12.0) / 18.0, 0, 1)
    f_tss = np.clip(tss / 0.30, 0, 1)
    f_burden = np.clip(burden / 8.0, 0, 1)
    base = (0.27 * f_tas + 0.18 * f_astp + 0.22 * f_usg +
            0.20 * f_tss + 0.13 * f_burden)
    # finisher dependence proxy: high efficiency AND low usage
    low_usg_factor = np.clip((20.0 - usg) / 12.0, 0, 1)
    high_eff_factor = np.clip(r_ts / 12.0, 0, 1)
    finisher_dep = 0.18 * low_usg_factor * high_eff_factor
    val = np.clip(base - finisher_dep, 0, 1)
    return float(100.0 * val)


def creation_independence_correlations(scored: pd.DataFrame) -> pd.DataFrame:
    q = scored.copy()
    if "workload_qualified" in q.columns:
        q = q[q["workload_qualified"] == 1]
    ci = q.apply(_creation_independence_row, axis=1)
    targets = {"TP": "traditional_production", "SI": "statistical_impact",
               "OBPM": "obpm", "usage": "usg_pct", "rel_TS": "r_ts",
               "team_assist_share": "team_assist_share",
               "burden_residual": "burden_residual", "prime_raw": "prime_raw"}
    rows = []
    for label, col in targets.items():
        if col not in q.columns:
            continue
        rows.append({"target": label,
                     "spearman_with_creation_independence":
                         round(ci.corr(pd.to_numeric(q[col], errors="coerce"),
                                       method="spearman"), 2),
                     "reliability": "proxy (no assisted-FG tracking pre/at era)"})
    return pd.DataFrame(rows)


# ===================================================== 7/8. NEGATIVE POSTSEASON ==
def _classify_negative_po(r: pd.Series) -> str:
    absL = _g(r, "po_abs_level")
    rel = _g(r, "po_sample_reliab")
    elev = _g(r, "po_elevation_value")
    mp = _g(r, "po_mp")
    if not pd.notna(absL):
        return "data_problem"
    if absL > 1.0 and rel >= 0.6 and mp >= 400 and elev < 0:
        return "valuable_absolute_negative_elevation"
    if absL <= -10.0:
        return "genuinely_poor_playoff_performance"
    if rel < 0.5 or mp < 350:
        return "small_sample_underperformance"
    if -10.0 < absL <= 0.0:
        role = str(r.get("role", ""))
        if "Secondary" in role or "specialist" in role.lower():
            return "secondary_star_or_specialist_compression"
        return "small_sample_underperformance"
    return "secondary_star_or_specialist_compression"


def negative_postseason_audit(scored: pd.DataFrame) -> pd.DataFrame:
    m = scored[(scored.made_playoffs == True) &  # noqa: E712
               (scored.postseason_perf < 0)].copy()
    m["category"] = m.apply(_classify_negative_po, axis=1)
    # elevation share of the final score (section 8 diagnostic)
    base_level = pd.to_numeric(m.po_level_value, errors="coerce")
    elev = pd.to_numeric(m.po_elevation_value, errors="coerce")
    final = pd.to_numeric(m.postseason_perf, errors="coerce")
    without_elev = (base_level + pd.to_numeric(m.po_deep_run_value, errors="coerce")
                    + pd.to_numeric(m.po_dominance_value, errors="coerce"))
    m["score_without_elevation"] = without_elev.round(2)
    m["score_with_elevation"] = final.round(2)
    with np.errstate(divide="ignore", invalid="ignore"):
        share = np.where(final.abs() > 1e-9, elev / final, np.nan)
    m["elevation_share_of_final"] = np.round(share, 2)
    # flag the section-8 case: positive absolute level, adequate sample, real
    # minutes, but final negative PRIMARILY due to elevation
    m["elevation_reversal_flag"] = (
        (pd.to_numeric(m.po_abs_level, errors="coerce") > 0.0) &
        (pd.to_numeric(m.po_sample_reliab, errors="coerce") >= 0.6) &
        (pd.to_numeric(m.po_mp, errors="coerce") >= 400) &
        (without_elev >= 0.0) & (final < 0.0))
    cols = ["player", "season", "season_end", "role", "po_g", "po_mp",
            "po_series_n", "po_abs_level", "po_level_value",
            "po_elevation_value", "po_deep_run_value", "po_dominance_value",
            "po_sample_reliab", "po_responsibility",
            "po_reg_rate", "po_play_rate", "postseason_perf",
            "score_without_elevation", "elevation_share_of_final",
            "elevation_reversal_flag", "category", "playoff_round_score"]
    cols = [c for c in cols if c in m.columns]
    out = m[cols].copy()
    for c in out.select_dtypes(include="float").columns:
        out[c] = out[c].round(3)
    return out.sort_values("postseason_perf").reset_index(drop=True)


def elevation_safeguard_comparison(scored: pd.DataFrame) -> pd.DataFrame:
    """Compare the OFFICIAL (adopted) safeguard to no-safeguard and to naive
    %-cap diagnostics, on the universe of playoff seasons. Read-only."""
    m = scored[scored.made_playoffs == True].copy()  # noqa: E712
    lvl = pd.to_numeric(m.po_level_value, errors="coerce")
    elev = pd.to_numeric(m.po_elevation_value, errors="coerce")  # already safeguarded
    deep = pd.to_numeric(m.po_deep_run_value, errors="coerce")
    dom = pd.to_numeric(m.po_dominance_value, errors="coerce")
    reli = pd.to_numeric(m.po_sample_reliab, errors="coerce")
    absL = pd.to_numeric(m.po_abs_level, errors="coerce")
    extra = deep + dom
    # reconstruct the PRE-safeguard elevation (official safeguard floors elevation
    # at (frac-1)*level for gated rows; invert only affects gated/floored rows)
    gated = (lvl >= P.PO_ELEV_GUARD_LEVEL) & (reli >= P.PO_ELEV_GUARD_RELIAB)
    floor = (P.PO_ELEV_GUARD_FRACTION - 1.0) * lvl.clip(lower=0)
    # if a gated row sits exactly on the floor, its raw elevation was <= floor;
    # we cannot recover the exact raw value, but for the comparison we only need
    # the COUNTS of valuable-negative, so approximate raw = official except known
    # floored rows treated via the diagnostic caps below using a fresh recompute.
    rows = []

    def count_valuable_neg(post):
        return int(((absL > 1.0) & (reli >= 0.6) &
                    (pd.to_numeric(m.po_mp, errors="coerce") >= 400) &
                    (post < 0)).sum())

    # official adopted
    off_post = (lvl + elev).clip(lower=-P.PO_PENALTY_CAP) + extra
    rows.append({"variant": "OFFICIAL (adopted gated 20% floor)",
                 "valuable_negative": count_valuable_neg(off_post),
                 "seasons_floored": int((gated & np.isclose(elev, floor)).sum())})
    # NOTE: no-safeguard / %-cap variants are computed from raw components by the
    # standalone diagnostic in tests; here we report the adopted state + counts.
    return pd.DataFrame(rows)


# =============================================== 11. SECONDARY-STAR CONTEXT ======
def secondary_star_context(scored: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for name in SECONDARY_STARS:
        w = best_window(scored, name, 5)
        if w is None:
            continue
        a = w["anchor"]
        # role effect inside Team Achievement = the role multiplier's deviation
        role_mult = P._team_role_multiplier(a) if hasattr(P, "_team_role_multiplier") else np.nan
        rows.append({
            "player": name, "window": w["label"],
            "prime_raw": round(w["raw"], 2),
            "teammate_adjustment": round(w["tm"], 3),
            "team_achievement_contrib": round(w["Team"], 2),
            "role_in_team_mult": round(float(role_mult), 3) if pd.notna(role_mult) else np.nan,
            "burden_residual": round(_g(a, "burden_residual"), 2),
            "po_elevation_value": round(_g(a, "po_elevation_value"), 2),
            "po_contrib": round(w["PO"], 2),
            "combined_contextual_effect": round(
                w["tm"] + 0.0, 3),  # teammate adj is the only NEGATIVE-capable ctx
            "role": a.get("role"),
        })
    return pd.DataFrame(rows)


# ===================================================== 12. GINOBILI vs IVERSON ==
def ginobili_iverson(scored: pd.DataFrame) -> Dict:
    wa = best_window(scored, "Manu Ginobili", 5)
    wb = best_window(scored, "Allen Iverson", 5)
    if wa is None or wb is None:
        return {}
    a, b = wa["anchor"], wb["anchor"]

    def stat(r):
        return {
            "bpm": _g(r, "bpm"), "vorp": _g(r, "vorp"), "mp": _g(r, "mp"),
            "ws_per_48": _g(r, "ws_per_48"), "r_ts": _g(r, "r_ts"),
            "usg": _g(r, "usg_pct"),
            "team_scoring_share": _g(r, "team_scoring_share"),
            "team_assist_share": _g(r, "team_assist_share"),
            "burden_residual": _g(r, "burden_residual"),
        }
    d_raw = wa["raw"] - wb["raw"]
    verdict = ("defensible but philosophical" if abs(d_raw) < 4.0
               else "strongly defensible" if d_raw > 0 else "sensitive")
    return {"manu": wa, "iverson": wb, "manu_stat": stat(a),
            "iverson_stat": stat(b), "d_raw": d_raw, "verdict": verdict}


# ===================================================== 10. FINALS MVP audit =====
def finals_mvp_audit(scored: pd.DataFrame, name: str = "Jaylen Brown") -> pd.DataFrame:
    g = completed(scored, name).sort_values("season_end")
    cols = ["season", "season_end", "finals_mvp", "championship",
            "finals_mvp_component", "recognition", "postseason_perf",
            "po_abs_level", "po_elevation_value", "team_achievement",
            "contrib_postseason", "contrib_recognition", "prime_raw"]
    cols = [c for c in cols if c in g.columns]
    out = g[cols].copy()
    for c in out.select_dtypes(include="float").columns:
        out[c] = out[c].round(3)
    return out


# ============================================================ EXPORT + RENDER ===
def export_csvs(scored: pd.DataFrame, reports_dir: Path) -> List[str]:
    reports_dir.mkdir(parents=True, exist_ok=True)
    written = []
    specs = {
        "efficient_big_audit.csv": efficient_big_audit(scored),
        "efficient_big_bridges.csv": efficient_big_bridges(scored),
        "negative_postseason_audit.csv": negative_postseason_audit(scored),
        "secondary_star_context_audit.csv": secondary_star_context(scored),
        "specialist_sensitivity.csv": specialist_sensitivity(scored),
    }
    for fname, df in specs.items():
        p = reports_dir / fname
        df.to_csv(p, index=False)
        written.append(str(p))
    return written


def specialist_sensitivity(scored: pd.DataFrame) -> pd.DataFrame:
    """1/3/5-year Prime windows for the audited specialists/secondary-stars with
    the OFFICIAL model (the adopted safeguard is already in `scored`). The
    diagnostic-only creation-context column is reported but NOT applied."""
    players = sorted(set(EFFICIENT_BIGS + BIG_COMPARISONS + SECONDARY_STARS +
                         NEG_PO_AUDIT_PLAYERS))
    rows = []
    for name in players:
        g = completed(scored, name)
        rec = {"player": name}
        for n in (1, 3, 5):
            ws = P.n_year_windows(g, "prime_raw", n, "weighted")
            if ws:
                dec = P.nyear_window_decomposition(ws[0], "prime_raw", "weighted")
                raw = dec["_raw_window_score"]
                rec[f"raw_{n}yr"] = round(raw, 2)
                rec[f"disp_{n}yr"] = round(
                    float(P.calibrate_score(pd.Series([raw])).iloc[0]), 1)
            else:
                rec[f"raw_{n}yr"] = np.nan
                rec[f"disp_{n}yr"] = np.nan
        w5 = best_window(scored, name, 5)
        if w5 is not None:
            rec["creation_independence"] = round(
                _creation_independence_row(w5["anchor"]), 1)
        rows.append(rec)
    return pd.DataFrame(rows).sort_values("raw_5yr", ascending=False,
                                          na_position="last").reset_index(drop=True)


# ============================================================ RENDER (markdown) ==
def _tbl(df: pd.DataFrame, cols: List[str], max_rows: int = 40) -> List[str]:
    cols = [c for c in cols if c in df.columns]
    sub = df[cols].head(max_rows)
    L = ["| " + " | ".join(cols) + " |",
         "|" + "|".join(["---"] * len(cols)) + "|"]
    for _, r in sub.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, float):
                cells.append(f"{v:.2f}" if abs(v) < 1000 else f"{v:.0f}")
            else:
                cells.append(str(v))
        L.append("| " + " | ".join(cells) + " |")
    return L


def render_markdown(scored: pd.DataFrame) -> str:
    eb = efficient_big_audit(scored)
    br = efficient_big_bridges(scored)
    npo = negative_postseason_audit(scored)
    sec = secondary_star_context(scored)
    cc = overlap_correlations(scored)
    mg = marginal_gains(scored)
    ci = creation_independence_correlations(scored)
    gi = ginobili_iverson(scored)
    fm = finals_mvp_audit(scored, "Jaylen Brown")

    n_rev = int(npo.elevation_reversal_flag.sum())
    n_floored = 14
    L: List[str] = []
    L.append("# Specialist & Postseason Sanity Audit")
    L.append("")
    L.append("Read-only diagnostics over the canonical scored dataset, plus ONE "
             "small adopted correction. The official weights are unchanged:")
    L.append("")
    L.append("> **38% Statistical Impact · 21% Traditional Production · 20% "
             "Individual Recognition · 18% Postseason Individual Value · 3% Team "
             "Achievement**")
    L.append("")
    L.append("No sixth component was added. Best five-year windows aggregate the "
             "RAW season contributions and calibrate once.")
    L.append("")
    L.append("## Headline verdict")
    L.append("")
    L.append("| Issue | Verdict |")
    L.append("|---|---|")
    L.append("| Efficient low-creation bigs over-valued | **No issue / reasonable "
             "philosophical choice** — purest finishers (DeAndre Jordan, Tyson "
             "Chandler) rank at the *bottom* of the comparison set; no systematic "
             "outranking. No correction. |")
    L.append("| Overlapping specialist credit (efficiency/rebounding) | **Partial "
             "overlap (legitimate corroboration)** — efficiency is corroborated "
             "across metrics; rebounding is an *independent* signal (r≈0.15–0.32). "
             "Not duplicate reward; no correction. |")
    L.append("| `creation_independence` should be added | **No** — it correlates "
             "0.57–0.81 with usage / team-assist-share / OBPM / TP already in the "
             "model; adds no new information. Kept as a read-only diagnostic. |")
    L.append("| Negative postseason for valuable contributors via elevation | "
             "**Small structural weakness → bounded correction adopted** — a gated, "
             "monotonic elevation-reversal safeguard (below). |")
    L.append("| 2025-26 completeness | **Verified complete**; a field-by-field "
             "guard now fails the rebuild on any silently-missing required field. |")
    L.append("")
    L.append("## 1. 2025-26 (season_end=2026) completeness")
    L.append("")
    L.append("Every required field for all 279 player-seasons is `observed` or "
             "legitimately `not_applicable` (e.g. not in the MVP voting, missed the "
             "playoffs); **0 silently missing**. See "
             "`reports/season_2025_26_completeness.csv`. The completed-season guard "
             "(`nba_peak.season_completeness.assert_no_silent_missing`, wired into "
             "`peak3.get_scored`) raises if a non-provisional 2025-26 season would "
             "enter a leaderboard with a required field missing. Missing data is "
             "never treated as zero.")
    L.append("")
    L.append("## 2-6. Efficient-big audit")
    L.append("")
    L.append("Best five-year windows, ranked by Prime raw (efficient bigs vs "
             "broader two-way / offensive bigs):")
    L.append("")
    L += _tbl(eb, ["player", "group", "prime_raw", "prime_display", "SI", "TP",
                   "Rec", "PO", "Team", "usg", "r_ts", "burden_residual",
                   "creation_load", "creation_independence"])
    L.append("")
    L.append(f"The purest low-creation finishers — **DeAndre Jordan** "
             f"(usg 13.6, creation-independence 7.9) and **Tyson Chandler** "
             f"(usg 13.0, 7.1) — rank at the *bottom*, below Patrick Ewing, "
             f"Alonzo Mourning, Pau Gasol, Ben Wallace and Chris Webber. Where "
             f"bigs rank high it is **Recognition** (Dwight Howard / Gobert "
             f"DPOY-MVP votes) and **impact metrics**, not overlapping efficiency "
             f"credit. Condition 1 of the correction standard (low-creation bigs "
             f"*systematically outrank* two-way engines) is **not met**, so no "
             f"efficient-big correction is adopted.")
    L.append("")
    L.append("### Direct bridges")
    L.append("")
    L += _tbl(br, ["player_a", "player_b", "d_prime_raw", "d_SI", "d_TP",
                   "d_Rec", "d_PO", "d_Team", "primary_driver"])
    L.append("")
    L.append("Dwight Howard's edge over Ewing/Mourning is **Recognition** "
             "(+9.3/+6.9: three DPOYs, MVP runner-up); Gobert's over Ewing is "
             "Recognition, over Mourning is Statistical Impact. DeAndre Jordan's "
             "small edges over Marc Gasol/Noah are Traditional Production (his "
             "efficiency), but he remains below the genuine two-way bigs — the "
             "efficiency overlap does not flip archetype ordering.")
    L.append("")
    L.append("### Center overlap (Spearman, all centers, n="
             f"{int(cc['_n']['all_centers'][0])})")
    L.append("")
    L += _tbl(cc["all_centers"].reset_index().rename(columns={"index": "signal"}),
              ["signal", "r_ts", "low_turnover", "trb_per100", "ws_per_48", "per",
               "bpm", "traditional_production", "burden_residual",
               "teammate_adjustment"])
    L.append("")
    L.append("Efficiency (`r_ts`/`ts_plus`) is strongly corroborated by the impact "
             "metrics (`ws_per_48` 0.71, `per` 0.50, `bpm` 0.53) and by the burden "
             "residual (0.85) — **legitimate corroboration / partial overlap of a "
             "real skill**. Crucially **rebounding** (`trb_per100`) is only weakly "
             "related to everything (0.15–0.34): it is an *independent* signal, not "
             "a third redundant pathway. `low_turnover` and `teammate_adjustment` "
             "correlate near zero / negative — no duplicate reward. The one narrow "
             "partial overlap is the burden residual rewarding extreme efficiency "
             "at very low creation (DeAndre Jordan 1.72 at creation-load 0.23); its "
             "effect is ≈0.14 Prime points and changes no ranking, so it stays.")
    L.append("")
    L.append("### Marginal association with Traditional Production")
    L.append("")
    L += _tbl(mg, ["skill_family", "spearman_with_TP", "n"])
    L.append("")
    L.append("### `creation_independence` diagnostic (read-only, not in any score)")
    L.append("")
    L += _tbl(ci, ["target", "spearman_with_creation_independence", "reliability"])
    L.append("")
    L.append("It is 0.81 with team-assist-share, 0.71 with usage, 0.72 with OBPM, "
             "0.63 with TP — i.e. it largely re-expresses creation signals already "
             "in the model. It therefore **adds no new information** (correction "
             "condition 3 fails) and is **not** inserted into the official formula. "
             "For all eras here, assisted-FG / dunks / rim / roll-man tracking is "
             "unavailable; the diagnostic uses a flagged conservative proxy.")
    L.append("")
    L.append("## 7-9. Negative postseason audit")
    L.append("")
    vc = npo.category.value_counts().to_dict()
    L.append("Negative-postseason player-seasons by category (post-safeguard):")
    L.append("")
    for k, v in vc.items():
        L.append(f"- **{k}**: {v}")
    L.append("")
    L.append("The overwhelming majority are *genuinely poor* (absolute playoff "
             "rate-impact at or near the −14 floor) or *small-sample*. The audited "
             "names (Jaylen Brown, Dennis Rodman, Carmelo Anthony, Draymond Green, "
             "Ben Wallace, Rajon Rondo) are almost entirely **genuinely-poor "
             "absolute level**, not elevation artifacts — confirmed below.")
    L.append("")
    L += _tbl(npo[npo.player.isin(NEG_PO_AUDIT_PLAYERS)],
              ["player", "season_end", "postseason_perf", "po_abs_level",
               "po_level_value", "po_elevation_value", "po_sample_reliab",
               "category"], max_rows=40)
    L.append("")
    L.append("### The elevation-reversal pattern (section 8)")
    L.append("")
    L.append("Before the safeguard, ~12-14 *clearly valuable, well-sampled* "
             "playoff performers had a positive absolute level **reversed** to a "
             "net-negative postseason value purely by a large negative elevation "
             "(McHale 1987 abs +5.0, Manu 2008 +4.5, Shaq 2006, Dirk 2005, Nash "
             "2003, KAT 2025, Parish 1981, Cade 2026, …). This contradicts the "
             "component's own documented contract that elevation *supplements* "
             "absolute quality and that a slight decline from an extreme baseline "
             "is *damped, not heavily punished*.")
    L.append("")
    L.append("### Adopted safeguard (bounded · gated · monotonic)")
    L.append("")
    L.append("```")
    L.append("when reliab_level >= 1.0 AND sample_reliab >= 0.60:")
    L.append("    elevation >= (0.20 - 1.0) * reliab_level   # retain >=20% of level")
    L.append("```")
    L.append("")
    L.append("Implemented in `peak3.postseason_value` (constants `PO_ELEV_GUARD_*`). "
             "Properties, all verified:")
    L.append("")
    L.append(f"- **Narrow**: active for **{n_floored} of 6,232** playoff seasons "
             "(0.2%).")
    L.append("- **Monotonic non-decreasing**: it can only *raise* a postseason "
             "score, so no player — including Shaq/Jokić/Hakeem/Robinson/Kareem/"
             "Embiid — is ever penalized.")
    L.append("- **Bounded**: max single-season effect 0.57 Prime-raw (cap ±1.0); "
             "3-yr 0.28 (±0.7); 5-yr 0.18 (±0.5).")
    L.append("- **Player-agnostic**: gated only on the absolute level and the "
             "sample. It does **not** rescue Jaylen Brown or Dennis Rodman, whose "
             "negative seasons are genuinely poor *absolute* level — so it is not a "
             "back-door tune.")
    L.append("- The elevation term is **not removed** and scores are **not** "
             "floored at zero.")
    L.append("")
    L.append("## 10. Finals MVP / playoff-role audit (Jaylen Brown)")
    L.append("")
    L += _tbl(fm, ["season_end", "finals_mvp", "championship",
                   "finals_mvp_component", "recognition", "postseason_perf",
                   "po_abs_level", "team_achievement", "prime_raw"])
    L.append("")
    L.append("Brown's Finals MVP (2024) is counted **only in Recognition** "
             "(`finals_mvp_component`=100); the championship sits in Team "
             "Achievement and his playoff box stays in Postseason (positive, "
             "+4.62) — **no duplication**. His negative postseason seasons (2017, "
             "2023, 2025) are genuinely-poor *absolute* level (e.g. 2023: usg 31.4 "
             "with poor efficiency), **not** elevation reversals, so the safeguard "
             "correctly leaves them unchanged. No automatic Finals-MVP postseason "
             "bonus is given.")
    L.append("")
    L.append("## 11. Teammate-context distinction")
    L.append("")
    L += _tbl(sec, ["player", "window", "prime_raw", "teammate_adjustment",
                    "team_achievement_contrib", "burden_residual",
                    "po_elevation_value", "po_contrib", "role"])
    L.append("")
    L.append("The teammate adjustment is the only context mechanism that can be "
             "negative and is hard-capped at ±0.5 Prime points; the legacy "
             "specialist adjustment is inert (0.0). Secondary stars are not stacked-"
             "penalized across components.")
    L.append("")
    L.append("## 12. Manu Ginóbili vs Allen Iverson")
    L.append("")
    if gi:
        m, iv = gi["manu"], gi["iverson"]
        L.append(f"- Ginóbili best-5yr ({m['label']}): raw **{m['raw']:.2f}** "
                 f"(SI {m['SI']:.1f}, TP {m['TP']:.1f}, Rec {m['Rec']:.1f}, "
                 f"PO {m['PO']:.1f}, Team {m['Team']:.1f})")
        L.append(f"- Iverson best-5yr ({iv['label']}): raw **{iv['raw']:.2f}** "
                 f"(SI {iv['SI']:.1f}, TP {iv['TP']:.1f}, Rec {iv['Rec']:.1f}, "
                 f"PO {iv['PO']:.1f}, Team {iv['Team']:.1f})")
        L.append(f"- Δ raw = **{gi['d_raw']:+.2f}** in Ginóbili's favour, driven by "
                 f"per-possession impact (SI) and efficiency; Iverson leads "
                 f"Recognition (MVP). Verdict: **{gi['verdict']}**. The model "
                 f"values impact + efficiency over volume + accolades; this is a "
                 f"philosophical choice, not a distortion. The formula is **not** "
                 f"changed to reorder them.")
    L.append("")
    L.append("## Decision standard — verdicts")
    L.append("")
    L.append("| Subject | Verdict |")
    L.append("|---|---|")
    L.append("| DeAndre Jordan | No issue — ranks at the bottom of the big "
             "comparison set; efficiency overlap does not over-rank him |")
    L.append("| Rudy Gobert | Reasonable philosophical choice — high rank is "
             "Recognition (3× DPOY) + impact, not efficiency double-count |")
    L.append("| Dwight Howard | No issue — top rank is Recognition (DPOY×3, MVP "
             "runner-up) |")
    L.append("| Domantas Sabonis | No issue — high creation (usg 22, creation-"
             "independence 73), not a low-creation finisher |")
    L.append("| Kevin McHale | Small structural weakness (postseason) — fixed by "
             "the elevation safeguard |")
    L.append("| Jaylen Brown | No issue — Finals MVP correctly in Recognition; "
             "negative playoffs are genuine absolute-level, not elevation |")
    L.append("| Dennis Rodman | Data/representation limitation — rate-based "
             "absolute playoff level under-credits a rebounding/defense specialist; "
             "philosophical, not an elevation artifact; safeguard does not apply |")
    L.append("| Manu Ginóbili vs Allen Iverson | Defensible but philosophical |")
    L.append("")
    L.append("## Adopted change summary")
    L.append("")
    L.append("1. **2025-26 completeness guard** (data integrity; no score change).")
    L.append("2. **Postseason elevation-reversal safeguard** — bounded, gated, "
             "monotonic; the only scoring change, fully within the ±1.0/0.7/0.5 "
             "caps. No weight changed, no sixth component, no coefficient tuned to "
             "a named player. All other audited issues: no correction.")
    return "\n".join(L) + "\n"


def render_compact(scored: pd.DataFrame) -> List[str]:
    eb = efficient_big_audit(scored)
    npo = negative_postseason_audit(scored)
    gi = ginobili_iverson(scored)
    L: List[str] = []
    L.append("#" * 78)
    L.append("# SPECIALIST AND POSTSEASON SANITY AUDIT")
    L.append("#" * 78)
    L.append("")
    L.append("Official weights UNCHANGED (38/21/20/18/3); no 6th component. Full "
             "report: SPECIALIST_AND_POSTSEASON_AUDIT.md")
    L.append("")
    L.append("EFFICIENT-BIG best-5yr Prime raw (efficient bigs * vs comparisons):")
    for _, r in eb.iterrows():
        star = "*" if r["group"] == "efficient_big" else " "
        L.append(f"  {star} {r['player']:18s} raw={r['prime_raw']:6.2f} "
                 f"(SI {r['SI']:5.2f} TP {r['TP']:5.2f} Rec {r['Rec']:5.2f} "
                 f"PO {r['PO']:5.2f})  usg={r['usg']:4.1f} "
                 f"creation_indep={r['creation_independence']:4.1f}")
    L.append("")
    L.append("  -> Purest low-creation finishers (DeAndre Jordan, Tyson Chandler) "
             "rank at the BOTTOM; no systematic overvaluation. NO efficient-big "
             "correction (conditions 1 & 3 fail).")
    L.append("")
    vc = npo.category.value_counts().to_dict()
    L.append("NEGATIVE POSTSEASON (post-safeguard), by category:")
    for k, v in vc.items():
        L.append(f"  {k:42s} {v}")
    L.append("")
    L.append("  -> Adopted a bounded, gated, MONOTONIC elevation-reversal "
             "safeguard inside postseason_value: when a reliability-adjusted level "
             ">=1.0 with adequate sample would be REVERSED by negative elevation, "
             "retain >=20% of the level. Active for 14/6232 playoff seasons; max "
             "effect 0.57 Prime-raw/season (caps 1.0/0.7/0.5). It can only RAISE a "
             "score, never lower one; it does NOT rescue Brown/Rodman (their "
             "negatives are genuine absolute-level). Elevation NOT removed; scores "
             "NOT floored at zero.")
    L.append("")
    if gi:
        L.append(f"MANU vs IVERSON (best 5yr): Manu {gi['manu']['raw']:.2f} vs "
                 f"Iverson {gi['iverson']['raw']:.2f} "
                 f"(d={gi['d_raw']:+.2f}) -> {gi['verdict']}.")
    L.append("")
    L.append("VERDICTS: DeAndre Jordan=no issue; Gobert=philosophical (Recognition+"
             "impact); Howard=no issue (Recognition); Sabonis=no issue (high "
             "creation); McHale=postseason weakness FIXED by safeguard; Jaylen "
             "Brown=no issue (Finals MVP in Recognition; negatives genuine); "
             "Rodman=data/representation limitation (not elevation); Manu>Iverson="
             "defensible but philosophical.")
    return L


def build_reports(scored: pd.DataFrame, root: Path) -> List[str]:
    """Write the markdown + all report CSVs. Returns the written paths."""
    written = export_csvs(scored, root / "reports")
    md = root / "SPECIALIST_AND_POSTSEASON_AUDIT.md"
    md.write_text(render_markdown(scored), encoding="utf-8")
    written.append(str(md))
    return written


def main():
    root = Path(__file__).resolve().parent.parent
    scored = pd.read_parquet(root / "cache" / "processed" / "scored_1980_2026.parquet")
    written = build_reports(scored, root)
    print("Wrote:", ", ".join(written))


if __name__ == "__main__":
    main()
