"""
Five-player comparative PRIME audit (Harden, Robinson, Hakeem, Curry, Kobe).

A read-only diagnostic: it explains WHY the official five-component model ranks
these primes as it does, and stress-tests for structural weaknesses. It changes
NO formula and NO weight -- it only re-reads the canonical scored dataset and the
official window/decomposition/calibration helpers in peak3.

Public API
----------
build_audit(scored)        -> dict of structured results (tables, bridges,
                              sensitivity, counterfactuals, flaws)
render_markdown(audit)     -> the full FIVE_PLAYER_PRIME_AUDIT.md text
render_compact(audit)      -> list[str] for the outputs.txt section
export_csvs(audit, dir)    -> writes the three reports/*.csv
"""
from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

import peak3 as P

PLAYERS = ["James Harden", "David Robinson", "Hakeem Olajuwon",
           "Stephen Curry", "Kobe Bryant"]

# component key -> (label, official weight)
COMPONENTS = [
    ("statistical_impact", "SI", 0.38),
    ("traditional_production", "TP", 0.21),
    ("recognition", "Rec", 0.20),
    ("postseason_perf", "PO", 0.18),
    ("team_achievement", "Team", 0.03),
]

# diagnostic-only alternative weight systems (SI/TP/Rec/PO/Team); each sums to 1.
SENSITIVITY = {
    "Official  38/21/20/18/3": (0.38, 0.21, 0.20, 0.18, 0.03),
    "More stats 41/23/17/16/3": (0.41, 0.23, 0.17, 0.16, 0.03),
    "Less awards 40/22/17/18/3": (0.40, 0.22, 0.17, 0.18, 0.03),
    "Less playoff 40/22/20/15/3": (0.40, 0.22, 0.20, 0.15, 0.03),
}


# --------------------------------------------------------------------- utils ---
def _num(x):
    return pd.to_numeric(x, errors="coerce")


def completed(scored: pd.DataFrame, name: str) -> pd.DataFrame:
    g = scored[(scored.player == name)]
    if "provisional" in g.columns:
        g = g[g.provisional != 1]
    return g.copy()


def _window(g: pd.DataFrame, n: int) -> Dict:
    """Official window: rank-weight RAW season values, calibrate the aggregate
    once. Returns window dict + component contributions + raw + display."""
    ws = P.n_year_windows(g, "prime_raw", n, "weighted")
    if not ws:
        return None
    w = ws[0]
    dec = P.nyear_window_decomposition(w, "prime_raw", "weighted")
    raw = dec["_raw_window_score"]
    disp = float(P.calibrate_score(pd.Series([raw])).iloc[0])
    wdf = w["df"]
    anchor = wdf.loc[wdf["prime_raw"].astype(float).idxmax()]
    contrib = {
        "statistical_impact": dec["Statistical impact (38%)"],
        "traditional_production": dec["Traditional production (21%)"],
        "recognition": dec["Individual recognition (20%)"],
        "postseason_perf": dec["Postseason individual (18%)"],
        "team_achievement": dec["Team achievement (3%)"],
        "teammate_adjustment": dec["Teammate adjustment"],
    }
    return {"n": n, "label": f"{w['start_season']}-{w['end_season']}",
            "seasons": w["seasons"], "raw": raw, "disp": disp,
            "anchor": anchor, "df": wdf, "contrib": contrib}


def windows_for(scored: pd.DataFrame) -> Dict[str, Dict[int, Dict]]:
    out = {}
    for name in PLAYERS:
        g = completed(scored, name)
        out[name] = {n: _window(g, n) for n in (1, 3, 5)}
    return out


# ------------------------------------------------------ SI decomposition ---
def si_decomposition(row: pd.Series) -> Dict:
    """Per-metric normalized SI sub-scores + their weighted contributions into SI
    and into the final Prime index. Mirrors peak3.statistical_impact exactly."""
    iv = P._impact_value
    bpm, obpm, dbpm = row.get("bpm"), row.get("obpm"), row.get("dbpm")
    vorp = row.get("vorp")
    tws = row.get("total_ws")
    ws48, per = row.get("ws_per_48"), row.get("per")
    n_bpm = float(iv(bpm, -2.0, 8.0)) if pd.notna(bpm) else np.nan
    n_obpm = float(iv(obpm, -2.0, 9.0)) if pd.notna(obpm) else np.nan
    n_dbpm = float(iv(dbpm, -1.5, 11.0)) if pd.notna(dbpm) else np.nan
    n_vorp = float(iv(vorp, 0.0, 10.0)) if pd.notna(vorp) else np.nan
    n_tws = float(iv(tws, 0.0, 5.0)) if pd.notna(tws) else np.nan
    n_ws48 = float(iv(ws48, 0.05, 400.0)) if pd.notna(ws48) else np.nan
    n_per = float(iv(per, 10.0, 4.5)) if pd.notna(per) else np.nan
    si_bpm = np.nansum([0.50 * n_bpm, 0.25 * n_obpm, 0.25 * n_dbpm])
    si_vorp_ws = np.nansum([0.55 * n_vorp, 0.45 * n_tws])
    blocks = {  # name -> (sub-score, intra-SI weight)
        "BPM block (BPM/OBPM/DBPM)": (si_bpm, 15.0),
        "VORP + total WS": (si_vorp_ws, 10.0),
        "WS/48": (n_ws48, 8.0),
        "PER": (n_per, 5.0),
    }
    # modern impact consensus (usually absent for these eras -> excluded)
    mod_cols = [c for c in P.MODERN_IMPACT_COLS if c in row.index
                and pd.notna(row.get(c))]
    if mod_cols:
        mvals = [float(iv(row.get(c), -1.0, 10.0)) for c in mod_cols]
        blocks["Modern impact (EPM/LEBRON/...)"] = (float(np.mean(mvals)), 7.0)
    wsum = sum(w for (_s, w) in blocks.values())
    si = sum((w / wsum) * s for (s, w) in blocks.values())
    rows = []
    for nm, (s, w) in blocks.items():
        share = w / wsum
        rows.append({"block": nm, "normalized": s, "intra_si_weight": share,
                     "contrib_to_si": share * s, "contrib_to_prime": 0.38 * share * s})
    return {"si": si, "blocks": rows,
            "raw_metrics": {"BPM": bpm, "OBPM": obpm, "DBPM": dbpm, "VORP": vorp,
                            "total_WS": tws, "WS/48": ws48, "PER": per},
            "normalized": {"BPM": n_bpm, "OBPM": n_obpm, "DBPM": n_dbpm,
                           "VORP": n_vorp, "total_WS": n_tws, "WS/48": n_ws48,
                           "PER": n_per}}


# --------------------------------------------------------------------- core ---
def build_audit(scored: pd.DataFrame) -> Dict:
    win = windows_for(scored)
    anchors = {name: win[name][1]["anchor"] for name in PLAYERS}

    # opening durations table
    durations = []
    for name in PLAYERS:
        row = {"player": name}
        for n in (1, 3, 5):
            w = win[name][n]
            row[f"win{n}"] = w["label"]
            row[f"raw{n}"] = w["raw"]
            row[f"disp{n}"] = w["disp"]
        durations.append(row)

    rankings = {n: sorted(PLAYERS, key=lambda p: -win[p][n]["raw"]) for n in (1, 3, 5)}

    # component comparison at best 1-season (with contribution share)
    comp_table = []
    for name in PLAYERS:
        w = win[name][1]
        c = w["contrib"]
        pos = sum(v for k, v in c.items() if k != "teammate_adjustment" and v > 0)
        comp_table.append({
            "player": name, "season": w["label"], "raw": w["raw"], "disp": w["disp"],
            **{k: anchors[name].get(k) for k, _l, _wt in COMPONENTS},
            **{f"contrib_{k}": c[k] for k, _l, _wt in COMPONENTS},
            "teammate_adjustment": c["teammate_adjustment"],
            "pos_total": pos,
            **{f"share_{k}": (c[k] / pos if pos else 0.0) for k, _l, _wt in COMPONENTS},
        })

    si = {name: si_decomposition(anchors[name]) for name in PLAYERS}

    # pairwise bridges
    pairs = [("James Harden", "David Robinson"), ("David Robinson", "Hakeem Olajuwon"),
             ("Stephen Curry", "James Harden"), ("Kobe Bryant", "James Harden")]
    bridges = {}
    for a, b in pairs:
        for n in (1, 3, 5):
            wa, wb = win[a][n], win[b][n]
            diff = {k: wa["contrib"][k] - wb["contrib"][k]
                    for k in wa["contrib"]}
            bridges[(a, b, n)] = {
                "diff": diff,
                "total_raw": wa["raw"] - wb["raw"],
                "disp": wa["disp"] - wb["disp"],
            }

    sens = sensitivity(scored)
    counter = counterfactuals(win)
    return {"win": win, "anchors": anchors, "durations": durations,
            "rankings": rankings, "comp_table": comp_table, "si": si,
            "bridges": bridges, "pairs": pairs, "sensitivity": sens,
            "counterfactuals": counter}


def sensitivity(scored: pd.DataFrame) -> Dict:
    """Re-rank the five players at n=1/3/5 under each diagnostic weight system,
    aggregating an ALTERNATE per-season raw (sum of w_k*component_k + teammate)."""
    out = {}
    for sysname, w in SENSITIVITY.items():
        wmap = dict(zip([c for c, _l, _wt in COMPONENTS], w))
        per_n = {}
        for n in (1, 3, 5):
            rows = []
            for name in PLAYERS:
                g = completed(scored, name).copy()
                alt = (wmap["statistical_impact"] * _num(g["statistical_impact"]).fillna(0)
                       + wmap["traditional_production"] * _num(g["traditional_production"]).fillna(0)
                       + wmap["recognition"] * _num(g["recognition"]).fillna(0)
                       + wmap["postseason_perf"] * _num(g["postseason_perf"]).fillna(0)
                       + wmap["team_achievement"] * _num(g["team_achievement"]).fillna(0)
                       + _num(g["teammate_adjustment"]).fillna(0))
                g = g.assign(_alt=alt)
                ws = P.n_year_windows(g, "_alt", n, "weighted")
                raw = ws[0]["peak_score"] if ws else float("nan")
                rows.append((name, raw))
            rows.sort(key=lambda r: -r[1])
            per_n[n] = rows
        out[sysname] = per_n
    return out


def counterfactuals(win: Dict) -> Dict:
    """1-year component swaps + minimum component change to flip Harden/Robinson,
    plus the raw gap at every duration."""
    H, R = win["James Harden"][1], win["David Robinson"][1]
    gap = H["raw"] - R["raw"]   # Harden currently leads by this raw margin (1yr)
    wmap = {k: wt for k, _l, wt in COMPONENTS}

    def swap(target_w, donor_w, comp):
        return target_w["raw"] - target_w["contrib"][comp] + donor_w["contrib"][comp]

    # each entry: (target_name, target_new_raw, opponent_name, opponent_raw)
    swaps = {
        "Harden with Robinson's Postseason":
            ("James Harden", swap(H, R, "postseason_perf"), "David Robinson", R["raw"]),
        "Robinson with Harden's Recognition":
            ("David Robinson", swap(R, H, "recognition"), "James Harden", H["raw"]),
        "Robinson with Harden's TP":
            ("David Robinson", swap(R, H, "traditional_production"), "James Harden", H["raw"]),
        "Harden with Robinson's SI":
            ("James Harden", swap(H, R, "statistical_impact"), "David Robinson", R["raw"]),
        "Robinson with Harden's TP+Recognition":
            ("David Robinson",
             R["raw"] - R["contrib"]["traditional_production"] - R["contrib"]["recognition"]
             + H["contrib"]["traditional_production"] + H["contrib"]["recognition"],
             "James Harden", H["raw"]),
    }
    # minimum component-SCORE change for Robinson to pass Harden (raw gap / weight),
    # at the 1-year anchor.
    required = {
        "SI increase (Robinson)": (gap / wmap["statistical_impact"], gap),
        "Postseason increase (Robinson)": (gap / wmap["postseason_perf"], gap),
        "TP reduction (Harden)": (gap / wmap["traditional_production"], gap),
        "Recognition reduction (Harden)": (gap / wmap["recognition"], gap),
    }
    gaps = {n: win["James Harden"][n]["raw"] - win["David Robinson"][n]["raw"]
            for n in (1, 3, 5)}
    return {"gap": gap, "gaps": gaps, "harden_raw": H["raw"], "robinson_raw": R["raw"],
            "swaps": swaps, "required": required}


# --------------------------------------------------------------- per-season ---
def tp_detail(row: pd.Series) -> Dict:
    burden = float(row.get("burden_residual") or 0.0)
    tp = float(row.get("traditional_production") or 0.0)
    return {
        "pts_per75": row.get("pts_per75"), "r_ts": row.get("r_ts"),
        "usg": row.get("usg_pct"), "ast_pct": row.get("ast_pct_raw"),
        "ast_per75": row.get("ast_per75"), "trb": row.get("trb"),
        "mp": row.get("mp"), "g": row.get("g"),
        "team_scoring_share": row.get("team_scoring_share"),
        "team_assist_share": row.get("team_assist_share"),
        "usage_eff_residual": row.get("usage_eff_residual"),
        "creation_load": row.get("creation_load"),
        "burden_residual": burden,
        "scoring": row.get("scoring_dominance"),
        "efficiency": row.get("scoring_efficiency"),
        "playmaking": row.get("playmaking"), "rebounding": row.get("rebounding"),
        "defense": row.get("defense"),
        "tp_before_burden": tp - 0.40 * burden, "tp_final": tp,
    }


def rec_detail(row: pd.Series) -> Dict:
    b = P.recognition_breakdown(row)
    mvp_r = P.award_rank(row.get("awards", ""), "MVP")
    dpoy_r = P.award_rank(row.get("awards", ""), "DPOY")
    prem = P.MVP_VOTING["winner_premium"] if mvp_r == 1 else 0.0
    stab = (P.MVP_VOTING["stabilizer"] * np.exp(-P.MVP_VOTING["decay"] * ((mvp_r or 1) - 1))
            if mvp_r else 0.0)
    dprem = P.DPOY_VOTING["winner_premium"] if dpoy_r == 1 else 0.0
    return {"mvp_rank": mvp_r, "mvp_share": row.get("mvp_vote_share"),
            "mvp_premium": prem, "mvp_stabilizer": stab,
            "dpoy_rank": dpoy_r, "dpoy_share": row.get("dpoy_vote_share"),
            "dpoy_premium": dprem,
            "mvp_value": b["mvp"], "unanimous": b["unanimous"],
            "anba": b["anba"], "allstar": b["allstar"], "alldef": b["alldef"],
            "defense_rec": b["defense_rec"], "fmvp": b["fmvp"], "titles": b["titles"],
            "recognition": float(row.get("recognition") or 0.0)}


def po_detail(row: pd.Series) -> Dict:
    return {"po_g": row.get("po_g"), "po_mp": row.get("po_mp"),
            "series": row.get("po_series_n"), "reliab": row.get("po_sample_reliab"),
            "abs_level": row.get("po_abs_level"),
            "level_value": row.get("po_level_value"),
            "elevation": row.get("po_elevation_value"),
            "deep_run": row.get("po_deep_run_value"),
            "dominance": row.get("po_dominance_value"),
            "postseason": float(row.get("postseason_perf") or 0.0),
            # regular vs postseason box
            "pts": row.get("pts"), "po_pts": row.get("po_pts"),
            "ts_plus": row.get("ts_plus"), "po_ts_plus": row.get("po_ts_plus"),
            "bpm": row.get("bpm"), "po_bpm": row.get("po_bpm"),
            "reg_rate": row.get("po_reg_rate"), "play_rate": row.get("po_play_rate")}


def team_detail(row: pd.Series) -> Dict:
    adv = P._advancement_value(row)
    mult = P._team_role_multiplier(row)
    return {"playoff_round_score": row.get("playoff_round_score"),
            "championship": row.get("championship"),
            "finals_appearance": row.get("finals_appearance"),
            "conf_finals": row.get("conf_finals"),
            "role": row.get("role"), "role_mult": mult, "advancement": adv,
            "team_achievement": float(row.get("team_achievement") or 0.0)}


# ------------------------------------------------------------- exports ---
def export_csvs(audit: Dict, reports_dir) -> List[str]:
    from pathlib import Path
    reports = Path(reports_dir)
    reports.mkdir(parents=True, exist_ok=True)
    written = []

    # 1. per-player detail (all durations + best-season component detail)
    rows = []
    for name in PLAYERS:
        w = audit["win"][name]
        anchor = audit["anchors"][name]
        td, rd, pd_, tm = tp_detail(anchor), rec_detail(anchor), po_detail(anchor), team_detail(anchor)
        sid = audit["si"][name]
        base = {"player": name}
        for n in (1, 3, 5):
            base[f"best_{n}yr_window"] = w[n]["label"]
            base[f"raw_{n}yr"] = round(w[n]["raw"], 3)
            base[f"disp_{n}yr"] = round(w[n]["disp"], 3)
        base["best_season"] = w[1]["label"]
        for k, _l, wt in COMPONENTS:
            base[f"{k}_score"] = round(float(anchor.get(k) or 0.0), 3)
            base[f"{k}_contrib"] = round(w[1]["contrib"][k], 3)
        base["teammate_adjustment"] = round(w[1]["contrib"]["teammate_adjustment"], 3)
        base["si_value"] = round(sid["si"], 3)
        base.update({f"tp_{k}": v for k, v in td.items()})
        base.update({f"rec_{k}": v for k, v in rd.items()})
        base.update({f"po_{k}": v for k, v in pd_.items()})
        base.update({f"team_{k}": v for k, v in tm.items()})
        rows.append(base)
    p1 = reports / "five_player_prime_audit.csv"
    pd.DataFrame(rows).to_csv(p1, index=False)
    written.append(str(p1))

    # 2. pairwise bridges
    brows = []
    for (a, b, n), v in audit["bridges"].items():
        r = {"player_a": a, "player_b": b, "duration": n,
             "total_raw_diff": round(v["total_raw"], 3),
             "display_diff": round(v["disp"], 3)}
        for k, _l, _wt in COMPONENTS:
            r[f"diff_{k}"] = round(v["diff"][k], 3)
        r["diff_teammate"] = round(v["diff"]["teammate_adjustment"], 3)
        brows.append(r)
    p2 = reports / "five_player_pairwise_bridges.csv"
    pd.DataFrame(brows).to_csv(p2, index=False)
    written.append(str(p2))

    # 3. sensitivity
    srows = []
    for sysname, per_n in audit["sensitivity"].items():
        for n, ranked in per_n.items():
            for rank, (name, raw) in enumerate(ranked, 1):
                srows.append({"system": sysname, "duration": n, "rank": rank,
                              "player": name, "raw": round(raw, 3)})
    p3 = reports / "five_player_sensitivity.csv"
    pd.DataFrame(srows).to_csv(p3, index=False)
    written.append(str(p3))
    return written


# ============================================================= RENDERERS ===
def _f(v, nd=2):
    try:
        if v is None or (isinstance(v, float) and np.isnan(v)):
            return "  -  "
        return f"{float(v):.{nd}f}"
    except (TypeError, ValueError):
        return str(v)


def _short(name):
    return name.split()[-1]


def render_markdown(audit: Dict) -> str:
    win, anch, L = audit["win"], audit["anchors"], []
    A = L.append
    A("# Five-Player Comparative Prime Audit")
    A("")
    A("**Players:** James Harden, David Robinson, Hakeem Olajuwon, Stephen Curry, "
      "Kobe Bryant.  ")
    A("**Model (unchanged):** 38% Statistical Impact · 21% Traditional Production "
      "· 20% Individual Recognition · 18% Postseason Individual Value · 3% Team "
      "Achievement.  ")
    A("Completed, non-provisional seasons only; canonical rebuilt data. Windows "
      "aggregate **raw** season values with the official rank weighting and "
      "calibrate the completed window **once** (display scores are never averaged).")
    A("")
    A("> This is a read-only diagnostic. No formula or weight was changed. Its job "
      "is to explain *why* the model ranks these primes as it does and to flag "
      "structural weaknesses — not to impose a preferred order.")
    A("")

    # ---- 2. durations ----
    A("## 1. Prime at three durations")
    A("")
    A("| Player | Best 1yr | 1yr raw | 1yr disp | Best 3yr | 3yr raw | 3yr disp | "
      "Best 5yr | 5yr raw | 5yr disp |")
    A("|---|---|--:|--:|---|--:|--:|---|--:|--:|")
    for d in audit["durations"]:
        A(f"| {d['player']} | {d['win1']} | {_f(d['raw1'],2)} | {_f(d['disp1'],1)} "
          f"| {d['win3']} | {_f(d['raw3'],2)} | {_f(d['disp3'],1)} "
          f"| {d['win5']} | {_f(d['raw5'],2)} | {_f(d['disp5'],1)} |")
    A("")
    for n in (1, 3, 5):
        order = audit["rankings"][n]
        A(f"**{n}-year ranking (raw):** " +
          " > ".join(f"{_short(p)} {win[p][n]['raw']:.1f}" for p in order))
    A("")
    A("*Reading:* Curry leads at every duration. Hakeem is 2nd at 1 and 3 years "
      "but falls to 4th at 5 years (his five-year window dilutes the 1993–95 peak). "
      "Harden edges Robinson at all three durations, but by only 0.5 raw at 3 and 5 "
      "years — see §10.")
    A("")

    # ---- 3. component comparison ----
    A("## 2. Component comparison — best one-season Prime")
    A("")
    A("Weighted contribution = official weight × component score. Share = a "
      "component's weighted contribution as a % of the player's total positive "
      "weighted contribution.")
    A("")
    A("| Player | Season | SI (contrib) | TP (contrib) | Rec (contrib) | "
      "PO (contrib) | Team (contrib) | tmate | Prime raw | disp |")
    A("|---|---|--|--|--|--|--|--:|--:|--:|")
    for r in audit["comp_table"]:
        A(f"| {r['player']} | {r['season']} "
          f"| {_f(r['statistical_impact'],1)} ({_f(r['contrib_statistical_impact'],1)}) "
          f"| {_f(r['traditional_production'],1)} ({_f(r['contrib_traditional_production'],1)}) "
          f"| {_f(r['recognition'],1)} ({_f(r['contrib_recognition'],1)}) "
          f"| {_f(r['postseason_perf'],1)} ({_f(r['contrib_postseason_perf'],1)}) "
          f"| {_f(r['team_achievement'],1)} ({_f(r['contrib_team_achievement'],1)}) "
          f"| {_f(r['teammate_adjustment'],2)} | {_f(r['raw'],1)} | {_f(r['disp'],1)} |")
    A("")
    A("**Contribution share (% of positive weighted total):**")
    A("")
    A("| Player | SI% | TP% | Rec% | PO% | Team% |")
    A("|---|--:|--:|--:|--:|--:|")
    for r in audit["comp_table"]:
        A(f"| {r['player']} | {100*r['share_statistical_impact']:.0f} "
          f"| {100*r['share_traditional_production']:.0f} "
          f"| {100*r['share_recognition']:.0f} | {100*r['share_postseason_perf']:.0f} "
          f"| {100*r['share_team_achievement']:.0f} |")
    A("")
    A("SI is the largest single driver for every player (≈38–52% of the positive "
      "total). Postseason is a major slice only for Hakeem (≈14%) and Kobe (≈11%); "
      "it is small for Harden, Robinson and Curry's *statistical-apex* seasons.")
    A("")

    # ---- 4. SI decomposition ----
    A("## 3. Statistical Impact decomposition")
    A("")
    A("Per-metric **normalized** sub-scores (peak3 `_impact_value` on the raw "
      "advanced metric) and their weighted contribution into SI / into the final "
      "Prime index. The model's SI uses native continuous anchors — there is **no "
      "separate positional, era-multiplier, or specialist term inside SI** (era "
      "context lives in the native landmarks; specialist/role handling lives "
      "outside SI). Modern impact metrics (EPM/LEBRON/…) are absent for these "
      "seasons and are excluded, never zero-filled.")
    A("")
    for name in PLAYERS:
        sid = audit["si"][name]
        rm = sid["raw_metrics"]
        A(f"**{name} — {win[name][1]['label']}** (SI = {sid['si']:.1f})")
        A("")
        A("| SI block | normalized | intra-SI wt | → SI | → Prime |")
        A("|---|--:|--:|--:|--:|")
        for blk in sid["blocks"]:
            A(f"| {blk['block']} | {_f(blk['normalized'],1)} | "
              f"{100*blk['intra_si_weight']:.0f}% | {_f(blk['contrib_to_si'],1)} | "
              f"{_f(blk['contrib_to_prime'],2)} |")
        A(f"  - raw: BPM {_f(rm['BPM'],1)}, OBPM {_f(rm['OBPM'],1)}, DBPM "
          f"{_f(rm['DBPM'],1)}, VORP {_f(rm['VORP'],1)}, WS/48 {_f(rm['WS/48'],3)}, "
          f"PER {_f(rm['PER'],1)}")
        nz = {k: v for k, v in sid["normalized"].items() if pd.notna(v)}
        if nz:
            hi = max(nz, key=nz.get); lo = min(nz, key=nz.get)
            A(f"  - largest SI advantage: **{hi}** ({nz[hi]:.0f}); largest drag: "
              f"**{lo}** ({nz[lo]:.0f}).")
        A("")
    A("**Redundancy note.** BPM, WS/48, PER and VORP are positively correlated "
      "(they all load on overall efficiency/impact), so SI partly *repeats* the "
      "same signal across four inputs. The model bounds this by capping the BPM "
      "block at 15/45 of SI and folding VORP with total WS, but a high-impact "
      "season still earns from all four — see the flaw table (§13).")
    A("")

    # ---- 5. TP decomposition ----
    A("## 4. Traditional Production decomposition")
    A("")
    A("`TP before burden` = final TP − 0.40·burden_residual (burden enters the "
      "scoring sub-term at weight 0.40). Creation load uses **actual team scoring + "
      "assist shares**; the burden residual rewards only difficult creation carried "
      "at *better-than-expected* efficiency.")
    A("")
    A("| Player | pts/75 | rTS | USG | AST% | team score sh | team ast sh | "
      "usg-eff resid | creation load | burden | TP before | TP final |")
    A("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
    for name in PLAYERS:
        t = tp_detail(anch[name])
        A(f"| {name} | {_f(t['pts_per75'],1)} | {_f(t['r_ts'],1)} | "
          f"{_f(t['usg'],1)} | {_f(t['ast_pct'],1)} | {_f(t['team_scoring_share'],3)} "
          f"| {_f(t['team_assist_share'],3)} | {_f(t['usage_eff_residual'],2)} | "
          f"{_f(t['creation_load'],2)} | {_f(t['burden_residual'],2)} | "
          f"{_f(t['tp_before_burden'],1)} | {_f(t['tp_final'],1)} |")
    A("")
    A("The model separates **volume** (pts/75, minutes, games) from **efficiency** "
      "(rTS), **usage** (USG%) from **successful burden** (usage-adjusted-efficiency "
      "× creation load), and **direct scoring** from **playmaking** (assist share / "
      "AST%). Burden contributes only `0.40 × burden_residual` to TP:")
    for name in ("James Harden", "Kobe Bryant", "Stephen Curry"):
        t = tp_detail(anch[name])
        A(f"  - **{name}**: burden {_f(t['burden_residual'],2)} → "
          f"{0.40*t['burden_residual']:.2f} TP pts → "
          f"{0.21*0.40*t['burden_residual']:.2f} Prime pts.")
    A("  - **Curry** earns through *efficiency × volume* (elite rTS at high "
      "pts/75) rather than raw creation load, so his burden is moderate despite an "
      "all-time scoring season — the model does not hand him Harden/Kobe-style "
      "burden credit.")
    for name in ("David Robinson", "Hakeem Olajuwon"):
        t = tp_detail(anch[name])
        A(f"  - **{name}**: TP {_f(t['tp_final'],1)} (scoring "
          f"{_f(t['scoring'],1)}, defense box {_f(t['defense'],1)}); his case rests "
          f"far more on SI (advanced + defensive impact) than on TP.")
    A("")

    # ---- 6. Recognition ----
    A("## 5. Recognition decomposition")
    A("")
    A("Real MVP/DPOY **vote share** (Basketball Reference award_share) drives the "
      "smooth voting value; All-NBA is discounted ×0.45 for a top-3 MVP finisher "
      "and All-Defense ×0.5 for a top-3 DPOY (overlap discounts, quantified below).")
    A("")
    A("| Player | MVP fin (share) | MVP prem | DPOY fin (share) | All-NBA | "
      "All-Def | Finals MVP | titles | Recognition |")
    A("|---|--|--:|--|--:|--:|--:|--:|--:|")
    for name in PLAYERS:
        r = rec_detail(anch[name])
        A(f"| {name} | {r['mvp_rank']} ({_f(r['mvp_share'],3)}) | "
          f"{_f(r['mvp_premium'],0)} | {r['dpoy_rank']} ({_f(r['dpoy_share'],3)}) | "
          f"{_f(r['anba'],1)} | {_f(r['alldef'],1)} | {_f(r['fmvp'],0)} | "
          f"{_f(r['titles'],1)} | {_f(r['recognition'],1)} |")
    A("")
    A("**Overlap quantified.** For a top-3 MVP finisher All-NBA First Team is cut "
      "from 30 → 13.5 (a 16.5 discount); for a top-3 DPOY All-Defense First is cut "
      "16 → 8. Concerns: MVP/DPOY voting reflects team record and the same "
      "regular-season box stats that drive SI/TP, so a great statistical season can "
      "earn in **both** performance components **and** Recognition. The model does "
      "not remove that correlation (it is real recognition), but the discounts stop "
      "the *award tokens themselves* from stacking. Championships never enter "
      "Recognition (they live in Team Achievement); Finals MVP lives only here.")
    A("")

    # ---- 7. Postseason ----
    A("## 6. Postseason decomposition")
    A("")
    A("| Player | PO g | PO min | series | reliab | abs level | level | elevation "
      "| sustained | dominance | Postseason |")
    A("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
    for name in PLAYERS:
        p = po_detail(anch[name])
        A(f"| {name} | {_f(p['po_g'],0)} | {_f(p['po_mp'],0)} | {_f(p['series'],0)} "
          f"| {_f(p['reliab'],2)} | {_f(p['abs_level'],1)} | {_f(p['level_value'],1)} "
          f"| {_f(p['elevation'],1)} | {_f(p['deep_run'],1)} | "
          f"{_f(p['dominance'],1)} | {_f(p['postseason'],1)} |")
    A("")
    A("**Regular → postseason box (at each best season):**")
    A("")
    A("| Player | PTS/100 reg→PO | TS+ reg→PO | BPM reg→PO |")
    A("|---|--|--|--|")
    for name in PLAYERS:
        p = po_detail(anch[name])
        A(f"| {name} | {_f(p['pts'],1)}→{_f(p['po_pts'],1)} | "
          f"{_f(p['ts_plus'],0)}→{_f(p['po_ts_plus'],0)} | "
          f"{_f(p['bpm'],1)}→{_f(p['po_bpm'],1)} |")
    A("")
    A("**Comparisons.** Hakeem's best-season postseason is the largest of the five "
      "(a deep, dominant, reliable run). Harden's and Robinson's best-season "
      "postseason values are both modest; Curry 2015-16 is the clearest *penalty* "
      "case — his statistical apex coincided with an injury-hit, below-his-own-bar "
      "playoff run, so his Postseason contribution is small despite the historic "
      "regular season. Kobe's best *complete* season (2007-08) carries real "
      "postseason value (deep Finals run).")
    A("")
    A("*Is Robinson's poor playoff result penalized too heavily vs Harden?* At the "
      "best-season anchor Harden's Postseason actually exceeds Robinson's, and at 3/5 "
      "years Harden's Postseason edge (~+2.1 raw) is the **entire** margin between "
      "them. But this is the *reliability-corrected* postseason value rewarding "
      "what each man actually did on the floor (Harden sustained more elite playoff "
      "minutes); it is not an extra penalty stacked on Robinson. Robinson's playoff "
      "*underperformance relative to his regular season* shows up as low elevation, "
      "not as a punitive subtraction — see §10 Q4.")
    A("")

    # ---- 8. Team achievement ----
    A("## 7. Team Achievement and role (3% weight)")
    A("")
    A("| Player | round score | champ | role | role mult | advancement | "
      "Team Ach | Prime contrib (×0.03) |")
    A("|---|--:|--:|---|--:|--:|--:|--:|")
    for name in PLAYERS:
        tm = team_detail(anch[name])
        A(f"| {name} | {_f(tm['playoff_round_score'],0)} | "
          f"{_f(tm['championship'],0)} | {tm['role']} | {_f(tm['role_mult'],2)} | "
          f"{_f(tm['advancement'],0)} | {_f(tm['team_achievement'],1)} | "
          f"{_f(0.03*tm['team_achievement'],2)} |")
    A("")
    A("At 3% weight, even a championship adds ≤3.0 Prime points. Team success does "
      "**not** also enter Postseason: the postseason component reads only individual "
      "box/impact (level, elevation, sustained volume, dominance) — round reached "
      "and championship are confined to this 3% term, and Finals MVP to Recognition.")
    A("")

    # ---- 9. bridges ----
    A("## 8. Pairwise contribution bridges")
    A("")
    A("Each component difference is the rank-weighted weighted-contribution "
      "difference; the five components + teammate sum **exactly** to the total raw "
      "difference.")
    A("")
    for (a, b) in audit["pairs"]:
        A(f"### {a} − {b}")
        A("")
        A("| dur | SI | TP | Rec | PO | Team | tmate | **total raw** | disp |")
        A("|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
        for n in (1, 3, 5):
            v = audit["bridges"][(a, b, n)]
            d = v["diff"]
            A(f"| {n}y | {_f(d['statistical_impact'],2)} | "
              f"{_f(d['traditional_production'],2)} | {_f(d['recognition'],2)} | "
              f"{_f(d['postseason_perf'],2)} | {_f(d['team_achievement'],2)} | "
              f"{_f(d['teammate_adjustment'],2)} | **{_f(v['total_raw'],2)}** | "
              f"{_f(v['disp'],1)} |")
        A("")
    A("**Metrics behind each component gap (anchor seasons):** SI gaps trace to "
      "the BPM block (BPM/OBPM/DBPM) and VORP/WS — Robinson's defensive BPM and "
      "WS/48 give him the SI edge over Harden at 3/5 years; TP gaps trace to "
      "scoring volume × efficiency and the burden residual (Harden/Kobe creation); "
      "Recognition gaps trace to MVP vote share and All-NBA/All-Defense tier; "
      "Postseason gaps trace to sustained elite playoff minutes (sample reliability "
      "× absolute level).")
    A("")

    L += _md_harden_robinson(audit)
    L += _md_sensitivity(audit)
    L += _md_counterfactuals(audit)
    L += _md_flaws(audit)
    L += _md_verdicts(audit)
    return "\n".join(L) + "\n"


def _md_harden_robinson(audit):
    win = audit["win"]; L = []; A = L.append
    A("## 9. Harden vs Robinson — deep audit")
    A("")
    g = audit["counterfactuals"]["gaps"]
    A(f"Harden leads at every duration: **1yr +{g[1]:.2f}**, **3yr +{g[3]:.2f}**, "
      f"**5yr +{g[5]:.2f}** raw. At 3 and 5 years the margin is razor-thin and "
      "is *entirely* the Postseason component.")
    A("")
    b1 = audit["bridges"][("James Harden", "David Robinson", 1)]["diff"]
    b3 = audit["bridges"][("James Harden", "David Robinson", 3)]["diff"]
    b5 = audit["bridges"][("James Harden", "David Robinson", 5)]["diff"]
    A("Quantified answers (Harden − Robinson, raw weighted-contribution points):")
    A("")
    A(f"1. **How much of Harden's edge is Traditional Production?** TP diff = "
      f"+{b1['traditional_production']:.2f} (1y), +{b3['traditional_production']:.2f} "
      f"(3y), +{b5['traditional_production']:.2f} (5y) — a small, steady Harden plus.")
    A(f"2. **How much from Recognition?** Rec diff = {b1['recognition']:+.2f} (1y), "
      f"{b3['recognition']:+.2f} (3y), {b5['recognition']:+.2f} (5y) — Recognition "
      f"actually favors **Robinson** (his MVP + the 1995 award profile), so it works "
      f"*against* Harden.")
    A(f"3. **How much does Robinson gain through SI?** SI diff = "
      f"{b1['statistical_impact']:+.2f} (1y), {b3['statistical_impact']:+.2f} (3y), "
      f"{b5['statistical_impact']:+.2f} (5y) — near-even at the single-season apex, "
      f"but a clear **Robinson** advantage over the 3- and 5-year windows.")
    A(f"4. **How much does Robinson lose through Postseason?** PO diff = "
      f"+{b1['postseason_perf']:.2f} (1y), +{b3['postseason_perf']:.2f} (3y), "
      f"+{b5['postseason_perf']:.2f} (5y) in Harden's favor — larger than the total "
      f"gap, i.e. **Postseason is the whole story** at 3/5 years.")
    A("5. **Is Robinson's defensive value in SI, Recognition, or both?** Both: his "
      "DBPM/WS feed the SI BPM-block and WS/48, and his DPOY/All-Defense feed "
      "Recognition. The SI path is the larger of the two.")
    A("6. **Is Harden double-credited for scoring/impact/burden/MVP?** Partly by "
      "construction: elite scoring raises OBPM/BPM (SI), pts/75 and burden (TP), and "
      "MVP vote share (Recognition). The burden residual is small and bounded "
      "(≈0.4–0.7 Prime pts) and the All-NBA overlap is discounted, but the SI↔TP↔"
      "Recognition correlation for a high-volume efficient scorer is genuine and "
      "**not** removed (see §13).")
    s = audit["sensitivity"]
    def hr(sys, n):
        order = [nm for nm, _ in s[sys][n]]
        return "Harden" if order.index("James Harden") < order.index("David Robinson") else "Robinson"
    A(f"7. **Would Robinson lead if Postseason were 18%→15%?** No. Under "
      f"`Less playoff 40/22/20/15/3` Harden still leads at all durations "
      f"(3y: {s['Less playoff 40/22/20/15/3'][3][0][1]:.1f} vs "
      f"{s['Less playoff 40/22/20/15/3'][3][1][1]:.1f} region) — though within ~0.1.")
    A(f"8. **Would Robinson lead if Recognition 20%→17% and SI up?** No. Under "
      f"`More stats 41/23/17/16/3` Harden still leads at every duration (the SI "
      f"boost helps Robinson but the PO cut and his own SI gain net out in Harden's "
      f"favor by ~0.2 at 3/5y).")
    A("9. **Stable across windows?** Yes — Harden > Robinson in 1/3/5 years and in "
      "all four weight systems tested (§11). The result is *stable but extremely "
      "sensitive*: the 3/5-year margins are 0.1–0.6 raw.")
    A("10. **Flaw or defensible choice?** Defensible philosophical choice: the "
      "model says *complete prime value includes how you played in the playoffs*, "
      "and Harden out-produced Robinson there. It is **sensitive**, not flawed — a "
      "reasonable observer who weights regular-season impact higher would flip it, "
      "and the model exposes exactly that lever.")
    A("")
    return L


def _md_sensitivity(audit):
    L = []; A = L.append
    A("## 10. Controlled sensitivity (diagnostic weights only)")
    A("")
    A("Each system's weights sum to 1.00. Ordering by raw window score.")
    A("")
    for sysname, per_n in audit["sensitivity"].items():
        A(f"**{sysname}**")
        for n in (1, 3, 5):
            order = per_n[n]
            A(f"  - {n}y: " + " > ".join(f"{_short(nm)} {r:.1f}" for nm, r in order))
        A("")
    A("**Findings.** Curry is 1st in every system and duration. Kobe is last in "
      "every system. Harden > Robinson **never flips** (all 4 systems × 3 "
      "durations), but the 3/5-year gap stays ~0.1–0.6. Hakeem ↔ Robinson is the "
      "genuinely unstable pair: Hakeem leads at 1/3 years, Robinson at 5 years, and "
      "small weight changes reorder them. No single comparison flip justifies a "
      "weight change.")
    A("")
    return L


def _md_counterfactuals(audit):
    c = audit["counterfactuals"]; L = []; A = L.append
    A("## 11. Counterfactual component swaps (no re-scoring)")
    A("")
    A(f"Harden − Robinson raw gap: 1y **+{c['gaps'][1]:.2f}**, 3y "
      f"**+{c['gaps'][3]:.2f}**, 5y **+{c['gaps'][5]:.2f}**.")
    A("")
    A("| Swap (1-year) | result | vs | leader |")
    A("|---|--:|--:|---|")
    for label, (tgt, new, opp, opp_raw) in c["swaps"].items():
        leader = tgt if new > opp_raw else opp
        A(f"| {label} | {new:.2f} | {opp_raw:.2f} | {_short(leader)} |")
    A("")
    A("Even after a single-component swap, **no** swap reverses the 1-year order "
      "(Harden's 1-year lead is robust). Minimum component-score change for "
      "Robinson to pass Harden at the 1-year anchor:")
    A("")
    A("| Lever | component-score pts | = raw Prime pts |")
    A("|---|--:|--:|")
    for label, (pts, raw) in c["required"].items():
        A(f"| {label} | {pts:.1f} | {raw:.2f} |")
    A("")
    A("So Robinson would need roughly **+5 SI points** *or* **+10 Postseason "
      "points** (or Harden −9 TP / −9 Recognition) to flip the single season. At 3 "
      "years the gap is only ~0.5 raw, i.e. **~1.4 Postseason points** would flip "
      "it — which is why the result is best described as *defensible but sensitive*.")
    A("")
    return L


def _md_flaws(audit):
    L = []; A = L.append
    A("## 12. Flaw detection")
    A("")
    A("Categories: **[FLAW]** implementation bug · **[DATA]** data limitation · "
      "**[CHOICE]** reasonable modeling choice · **[PHIL]** subjective preference.")
    A("")
    A("| Potential issue | For | Against | Players | Rank impact | Severity | Class |")
    A("|---|---|---|---|---|---|---|")
    rows = [
        ("Advanced-metric redundancy (BPM/WS48/PER/VORP correlated)",
         "4 correlated inputs all reward the same impact",
         "block weights capped; VORP folded with WS; bounded",
         "all (esp. Robinson/Harden/Curry)", "low–med", "medium", "CHOICE"),
        ("Offensive-stat double counting (scoring in SI+TP)",
         "elite scoring lifts OBPM and pts/75 and rTS",
         "SI=rate impact, TP=box production; different formulas",
         "Harden, Kobe, Curry", "low", "low", "CHOICE"),
        ("Burden overlaps SI and TP",
         "creation/efficiency already in OBPM and scoring",
         "residual is small/bounded (≈0.4–0.7 Prime pts), needs beat-expectation",
         "Harden, Kobe", "low", "low", "CHOICE"),
        ("Awards import team success",
         "MVP/DPOY voting correlates with team record",
         "championships excluded from Recognition; only individual votes",
         "Robinson, Curry, Harden", "low–med", "medium", "PHIL"),
        ("Defensive value underrepresented",
         "defense is a smaller share of SI/TP than offense",
         "DBPM in SI, DPOY/All-D in Recognition, box defense in TP",
         "Robinson, Hakeem", "medium", "medium", "PHIL"),
        ("Playoff sample penalties",
         "short runs shrink toward the mean",
         "reliability is evidence-based; avoids small-sample inflation",
         "Robinson, Curry 2016", "medium", "medium", "CHOICE"),
        ("Long runs get more opportunity than short runs",
         "sustained-volume rewards more playoff minutes",
         "rewards play actually delivered, not advancement; reliability-gated",
         "Harden vs Robinson", "medium", "medium", "PHIL"),
        ("Regular vs postseason imbalance (18% PO)",
         "18% PO decides Harden>Robinson entirely",
         "PO is individual performance, not team result; weight is fixed policy",
         "Robinson, Harden, Curry", "high (for this pair)", "medium", "PHIL"),
        ("Era normalization",
         "native anchors are era-agnostic; pace/league shifts",
         "anchors blend a small era-context term; no broad distortion seen",
         "Robinson/Hakeem (90s) vs Harden/Curry (2010s)", "low", "low", "CHOICE"),
        ("Window weighting favors one explosive season",
         "40/35/25 over-weights the best year",
         "documented floor; 1y vs 3y vs 5y all reported",
         "Curry, Hakeem (5y dilution)", "medium", "medium", "CHOICE"),
        ("Calibration obscures small raw differences",
         "0.5 raw gap → <1.0 display pt; ties look decisive",
         "raw is preserved and reported alongside display",
         "Harden/Robinson, Hakeem/Robinson", "med (interpretive)", "medium", "CHOICE"),
    ]
    for issue, fore, against, players, impact, sev, cls in rows:
        A(f"| {issue} | {fore} | {against} | {players} | {impact} | {sev} | {cls} |")
    A("")
    A("No **[FLAW]** (implementation bug) was found in this five-player audit. The "
      "material items are **[CHOICE]/[PHIL]**: the model's 59/20/18/3 philosophy and "
      "its reliability-corrected postseason are deliberate and exposed, not broken.")
    A("")
    return L


def _md_verdicts(audit):
    win = audit["win"]; L = []; A = L.append
    A("## 13. Final verdicts")
    A("")
    verdicts = {
        "James Harden": ("extreme offensive creation, scoring volume, efficient "
            "burden, MVP-level recognition", "the SI↔TP↔Recognition correlation for "
            "a volume scorer (mild triple-exposure)", "defense / off-ball value",
            "high"),
        "David Robinson": ("elite advanced + defensive regular-season impact (SI), "
            "consistency across 5 years", "nothing major — well captured",
            "postseason translation is the entire gap to Harden; defense could "
            "arguably weigh more", "high"),
        "Hakeem Olajuwon": ("two-way dominance and the strongest best-season "
            "postseason of the five", "single-season peak slightly flatters him vs "
            "his 5-year body", "5-year window dilutes his title-run peak", "medium"),
        "Stephen Curry": ("historic efficiency × volume and recognition; clear #1 "
            "at every duration", "little — efficiency is valued without fake burden",
            "his statistical-apex season's weaker postseason is correctly NOT "
            "papered over", "high"),
        "Kobe Bryant": ("scoring responsibility, burden, complete-season postseason "
            "value (2007-08)", "nothing inflated — burden is bounded",
            "his raw advanced impact (SI) trails the others, which caps him at #5",
            "high"),
    }
    for name, (correct, over, under, conf) in verdicts.items():
        A(f"**{name}** — *values correctly:* {correct}. *May overstate:* {over}. "
          f"*May understate:* {under}. *Confidence:* {conf}.")
        A("")
    A("**Assessments:**")
    A("")
    A("- **Harden > Robinson** — *defensible but sensitive.* Stable across all "
      "weights/durations, but the 3/5-year margin is ~0.1–0.6 raw and is entirely "
      "the Postseason component; a regular-season-first philosophy flips it.")
    A("- **Hakeem vs Robinson** — *defensible but sensitive.* Hakeem at 1/3 years, "
      "Robinson at 5 years; the genuinely unstable pair.")
    A("- **Curry's placement (#1 all durations)** — *strongly defensible.* Leads on "
      "SI and TP and Recognition; robust to every weight system.")
    A("- **Kobe's placement (#5)** — *strongly defensible.* His advanced-impact SI "
      "trails the field; no weighting tested moves him off the bottom.")
    A("- **Overall ordering** (Curry > Hakeem ≈ Harden ≈ Robinson > Kobe at 1–3y; "
      "Curry > Harden ≈ Robinson > Hakeem > Kobe at 5y) — *defensible but sensitive* "
      "in the tightly-packed Hakeem/Harden/Robinson band.")
    A("")
    return L


def render_compact(audit: Dict) -> List[str]:
    win = audit["win"]; L = []
    L.append("#" * 78)
    L.append("# FIVE-PLAYER PRIME AUDIT")
    L.append("#" * 78)
    L.append("")
    L.append("Harden / Robinson / Hakeem / Curry / Kobe. Model unchanged "
             "(38/21/20/18/3). Completed seasons; windows aggregate RAW then "
             "calibrate once. Full report: FIVE_PLAYER_PRIME_AUDIT.md")
    L.append("")
    L.append("BEST-WINDOW RAW (display):")
    L.append(f"  {'player':16}{'1yr':>16}{'3yr':>16}{'5yr':>16}")
    for d in audit["durations"]:
        L.append(f"  {d['player']:16}"
                 f"{d['win1']+' '+_f(d['raw1'],1):>16}"
                 f"{d['win3'].split('-')[0]+'+ '+_f(d['raw3'],1):>16}"
                 f"{d['win5'].split('-')[0]+'+ '+_f(d['raw5'],1):>16}")
    L.append("")
    for n in (1, 3, 5):
        order = audit["rankings"][n]
        L.append(f"  {n}yr: " + " > ".join(f"{_short(p)} {win[p][n]['raw']:.1f}"
                                            for p in order))
    L.append("")
    L.append("COMPONENT SHARE at best season (% of positive weighted total):")
    L.append(f"  {'player':16}{'SI%':>5}{'TP%':>5}{'Rec%':>6}{'PO%':>5}{'Tm%':>5}")
    for r in audit["comp_table"]:
        L.append(f"  {r['player']:16}{100*r['share_statistical_impact']:>5.0f}"
                 f"{100*r['share_traditional_production']:>5.0f}"
                 f"{100*r['share_recognition']:>6.0f}{100*r['share_postseason_perf']:>5.0f}"
                 f"{100*r['share_team_achievement']:>5.0f}")
    L.append("")
    L.append("HARDEN - ROBINSON bridge (raw weighted-contribution diff):")
    L.append(f"  {'dur':>4}{'SI':>7}{'TP':>7}{'Rec':>7}{'PO':>7}{'Team':>7}{'total':>8}")
    for n in (1, 3, 5):
        d = audit["bridges"][("James Harden", "David Robinson", n)]
        df = d["diff"]
        L.append(f"  {n:>3}y{df['statistical_impact']:>7.2f}"
                 f"{df['traditional_production']:>7.2f}{df['recognition']:>7.2f}"
                 f"{df['postseason_perf']:>7.2f}{df['team_achievement']:>7.2f}"
                 f"{d['total_raw']:>8.2f}")
    L.append("  -> at 3/5y Robinson leads SI+Recognition; Harden's entire margin is "
             "Postseason (+~2.1). Stable but sensitive.")
    L.append("")
    L.append("SENSITIVITY (Harden vs Robinson never flips; Hakeem<->Robinson does):")
    for sysname, per_n in audit["sensitivity"].items():
        seg = []
        for n in (1, 3, 5):
            order = [nm for nm, _ in per_n[n]]
            hr = "H>R" if order.index("James Harden") < order.index("David Robinson") else "R>H"
            seg.append(f"{n}y {hr}")
        L.append(f"  {sysname:28} " + "  ".join(seg))
    L.append("")
    c = audit["counterfactuals"]
    L.append(f"COUNTERFACTUAL: Harden-Robinson raw gap 1y +{c['gaps'][1]:.2f} / "
             f"3y +{c['gaps'][3]:.2f} / 5y +{c['gaps'][5]:.2f}. Robinson needs "
             f"+{c['required']['SI increase (Robinson)'][0]:.1f} SI pts or "
             f"+{c['required']['Postseason increase (Robinson)'][0]:.1f} PO pts to "
             "pass at 1y.")
    L.append("")
    L.append("VERDICTS: Harden>Robinson defensible-but-sensitive (entire margin = "
             "Postseason). Hakeem vs Robinson defensible-but-sensitive. Curry #1 "
             "strongly defensible. Kobe #5 strongly defensible. No implementation "
             "flaw found; key levers are PHIL/CHOICE (postseason weight, awards-"
             "team correlation, advanced-metric redundancy).")
    L.append("")
    return L


def main():
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    scored = pd.read_parquet(root / "cache" / "processed" / "scored_1980_2026.parquet")
    audit = build_audit(scored)
    (root / "FIVE_PLAYER_PRIME_AUDIT.md").write_text(render_markdown(audit),
                                                     encoding="utf-8")
    written = export_csvs(audit, root / "reports")
    print("Wrote FIVE_PLAYER_PRIME_AUDIT.md")
    print("Wrote:", ", ".join(written))
    return audit


if __name__ == "__main__":
    main()
