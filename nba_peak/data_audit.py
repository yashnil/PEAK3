"""
Data-integrity audit: coverage, anomalies, join/dup checks, and a formula map.

Writes results/final_data_audit.{json,txt}, final_data_coverage.csv,
final_data_anomalies.csv, and final_formula_map.{csv,txt}.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

# Raw metric -> family -> component map (for results/final_formula_map.*).
FORMULA_MAP = [
    ("BPM", "rate impact ensemble", "Rate impact", "Impact", "stat+legacy"),
    ("WS/48", "rate impact ensemble", "Rate impact", "Impact", "stat+legacy"),
    ("PER", "rate impact ensemble", "Rate impact", "Impact", "stat+legacy"),
    ("EPM/LEBRON (optional)", "modern rate ensemble", "Rate impact", "Impact", "stat+legacy"),
    ("VORP", "total impact ensemble", "Total impact", "Impact", "stat+legacy"),
    ("Win Shares (total)", "total impact ensemble", "Total impact", "Impact", "stat+legacy"),
    ("Minutes (total)", "total impact ensemble", "Total impact", "Impact", "stat+legacy"),
    ("PTS per-100 x minutes (scoring load)", "scoring volume", "Scoring volume", "Scoring dominance", "stat+legacy"),
    ("Usage%", "scoring volume", "Scoring volume", "Scoring dominance", "stat+legacy"),
    ("TS+ / relative TS", "shooting efficiency", "Efficiency", "Scoring dominance", "stat+legacy"),
    ("scoring_load_z x rel_TS_z", "interaction", "Volume x efficiency", "Scoring dominance", "stat+legacy"),
    ("AST% / AST load / AST-100", "playmaking", "Playmaking", "Playmaking", "stat+legacy"),
    ("TRB% / TRB-100", "rebounding", "Rebounding", "Rebounding", "stat+legacy"),
    ("DBPM / STL% / BLK%", "defensive impact ensemble", "Defense", "Defense", "stat+legacy"),
    ("Minutes / MPG / games / usage / creation", "workload", "Role/workload", "Role/workload", "stat+legacy"),
    ("Team SRS / Net / Wins", "team context", "Context", "Context (minimal)", "stat+legacy"),
    ("Playoff BPM/box/eff/TS", "playoff individual", "Playoff", "Playoff", "stat+legacy"),
    ("Opponent quality / series success", "playoff team", "Playoff", "Playoff (small slice)", "stat+legacy"),
    ("MVP / All-NBA / DPOY / All-Def / Finals MVP / championship / titles", "accolade families", "Accolade", "Accolade (capped +12)", "legacy only"),
    ("Games played %", "durability", "Durability", "Durability", "stat+legacy"),
    ("Teammate strength (descriptive)", "teammate", "Teammate adj (±1)", "Teammate", "legacy only"),
]


def write_formula_map(out_dir: Path):
    df = pd.DataFrame(FORMULA_MAP, columns=[
        "raw_metric", "metric_family", "subcomponent", "main_component",
        "used_in"])
    # Official normalization is era-adjusted z-score -> z_to_score (NO percentiles).
    df["normalization"] = "era-relative z-score -> z_to_score (cap +/-4.5 SD)"
    df["percentile_used_in_score"] = "NO (descriptive only)"
    df.to_csv(out_dir / "final_formula_map.csv", index=False)
    lines = ["FORMULA MAP: raw metric -> era-adjusted z-score -> z_to_score "
             "-> family -> component", "",
             "OFFICIAL NORMALIZATION: within-season z-score mapped through a "
             "continuous magnitude-preserving transform (cap +/-4.5 SD).",
             "Percentiles are NOT used as official scoring inputs (descriptive "
             "reference only).", ""]
    for r in FORMULA_MAP:
        lines.append(f"  {r[0]}")
        lines.append(f"      -> z-score -> {r[1]} -> {r[2]} -> {r[3]}  [{r[4]}]")
    (out_dir / "final_formula_map.txt").write_text("\n".join(lines))


def run_data_audit(scored: pd.DataFrame, regular: Optional[pd.DataFrame],
                   playoffs: Optional[pd.DataFrame],
                   context: Optional[pd.DataFrame], out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    write_formula_map(out_dir)
    report: Dict = {}
    lines = ["=" * 64, "DATA INTEGRITY AUDIT", "=" * 64]

    report["total_player_seasons_scored"] = int(len(scored))
    report["total_players_scored"] = int(scored["player"].nunique())
    if regular is not None:
        report["total_regular_rows"] = int(len(regular))
    lines.append(f"Scored player-seasons: {len(scored)}  players: {scored['player'].nunique()}")
    if regular is not None:
        lines.append(f"Regular rows: {len(regular)}")
    if playoffs is not None:
        lines.append(f"Playoff rows: {len(playoffs)}")

    # ---- coverage by field ----
    cov_fields = ["stat_total", "legacy_total", "regular", "playoff", "defense",
                  "role_workload", "bpm", "vorp", "ts_pct", "epm", "lebron",
                  "mvp_rank", "all_nba_team", "championship", "finals_mvp",
                  "opponent_quality_score", "teammate_strength_score"]
    cov_rows = []
    for f in cov_fields:
        if f in scored.columns:
            pct = round(100.0 * scored[f].notna().mean(), 1)
            cov_rows.append({"field": f, "coverage_pct": pct})
    pd.DataFrame(cov_rows).to_csv(out_dir / "final_data_coverage.csv", index=False)
    report["coverage_pct"] = {r["field"]: r["coverage_pct"] for r in cov_rows}
    lines.append("\nFIELD COVERAGE (%):")
    for r in cov_rows:
        lines.append(f"  {r['field']:26} {r['coverage_pct']:5.1f}%")

    # ---- coverage by era ----
    scored = scored.copy()
    scored["era"] = (scored["season_end"] // 10) * 10
    era = scored.groupby("era").agg(
        seasons=("player", "size"),
        epm_cov=("epm", lambda s: round(100 * s.notna().mean(), 1)) if "epm" in scored else ("player", "size"))
    lines.append("\nCOVERAGE BY ERA (player-seasons):")
    for e, r in era.iterrows():
        lines.append(f"  {int(e)}s: {int(r['seasons'])}")

    # ---- anomalies / impossible values ----
    anomalies: List[Dict] = []

    def flag(name, mask, sample_col="player"):
        n = int(mask.sum())
        if n:
            samp = scored[mask][["player", "season"]].head(5).to_dict("records") \
                if {"player", "season"}.issubset(scored.columns) else []
            anomalies.append({"check": name, "count": n, "examples": samp})

    for col in ("ts_pct",):
        if col in scored:
            v = pd.to_numeric(scored[col], errors="coerce")
            flag(f"{col} out of [0,1]", (v < 0) | (v > 1.0))
    for col in ("stat_total", "legacy_total", "regular", "playoff"):
        if col in scored:
            v = pd.to_numeric(scored[col], errors="coerce")
            flag(f"{col} out of [0,100]", (v < 0) | (v > 100))
    # duplicate player-seasons
    dup = scored.duplicated(["player", "season_end"], keep=False)
    flag("duplicate player-season rows", dup)
    # provisional seasons
    if "provisional" in scored:
        n_prov = int((scored["provisional"] == 1).sum())
        report["provisional_player_seasons"] = n_prov
        lines.append(f"\nProvisional player-seasons: {n_prov}")
    # join check: scored players missing from regular
    if regular is not None:
        missing = set(scored["player"]) - set(regular["player"])
        report["scored_players_missing_from_regular"] = len(missing)

    report["anomalies"] = anomalies
    pd.DataFrame([{"check": a["check"], "count": a["count"]} for a in anomalies]
                 ).to_csv(out_dir / "final_data_anomalies.csv", index=False)
    lines.append("\nANOMALY CHECKS:")
    if anomalies:
        for a in anomalies:
            lines.append(f"  [{('WARN' if a['count'] else 'OK')}] {a['check']}: {a['count']}")
    else:
        lines.append("  All clear.")

    txt = "\n".join(lines)
    (out_dir / "final_data_audit.txt").write_text(txt, encoding="utf-8")
    (out_dir / "final_data_audit.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(txt)
    print(f"\nWrote {out_dir}/final_data_audit.* + coverage/anomalies/formula_map")
    return 0
