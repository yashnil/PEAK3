"""
Context validation + audit reporting.

Runs sanity checks on the generated context, summarizes coverage/confidence,
and (if a pre-enrichment baseline exists) reports which candidates' best
windows changed and by how much.  Writes results/context_audit.{json,txt}.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd


def _best_window(g: pd.DataFrame, col: str):
    g = g.sort_values("season_end")
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


def validate(context: pd.DataFrame) -> List[Dict]:
    checks = []

    def add(name, mask_bad, note=""):
        bad = int(mask_bad.sum())
        checks.append({"check": name, "violations": bad,
                       "status": "PASS" if bad == 0 else "WARN", "note": note})

    champ = context["championship"] == 1
    add("champion implies finals_appearance",
        champ & (context["finals_appearance"] != 1))
    add("champion implies conf_finals",
        champ & (context["conf_finals"] != 1))
    add("finals_mvp implies made playoffs",
        (context["finals_mvp"] == 1) & (context.get("made_playoffs", 0) != 1))
    if "title_team_role" in context.columns:
        role = context["title_team_role"].notna() & \
            (context["title_team_role"] != "")
        add("title role only for champions (best/co-best)",
            (context["best_player_title"] == 1) & (champ == False))  # noqa: E712
    add("finals_appearance implies conf_finals",
        (context["finals_appearance"] == 1) & (context["conf_finals"] != 1))
    if "playoff_round_score" in context.columns:
        add("missed playoffs => round_score==10",
            (context.get("made_playoffs", 0) == 0) &
            (context["playoff_round_score"] != 10.0))
    return checks


def coverage(context: pd.DataFrame, fields: List[str]) -> Dict[str, float]:
    cov = {}
    n = len(context)
    for f in fields:
        if f in context.columns:
            cov[f] = round(100.0 * context[f].notna().mean(), 1)
    return cov


def run_audit(context: pd.DataFrame, scored: Optional[pd.DataFrame],
              candidates: Optional[pd.DataFrame], results_dir: Path) -> Dict:
    results_dir.mkdir(parents=True, exist_ok=True)
    lines: List[str] = []
    report: Dict = {}

    cand_players = set(candidates["player"]) if candidates is not None else None
    n_players = context["player"].nunique()
    n_seasons = len(context)
    report["candidate_players"] = len(cand_players) if cand_players else None
    report["context_player_seasons"] = int(n_seasons)
    report["context_players"] = int(n_players)

    lines.append("=" * 70)
    lines.append("CONTEXT AUDIT")
    lines.append("=" * 70)
    if cand_players:
        lines.append(f"Candidate players: {len(cand_players)}")
    lines.append(f"Context player-seasons: {n_seasons}  (players: {n_players})")

    fields = ["championship", "finals_mvp", "finals_appearance", "conf_finals",
              "playoff_round_score", "series_success_score",
              "opponent_quality_score", "teammate_strength_score",
              "mvp_rank", "all_nba_team", "all_defense_team",
              "scoring_title", "fifty_forty_ninety", "best_player_title"]
    cov = coverage(context, fields)
    report["coverage_pct"] = cov
    lines.append("\nFIELD COVERAGE (% non-null):")
    for f, v in cov.items():
        lines.append(f"  {f:28} {v:5.1f}%")

    if "context_confidence" in context.columns:
        conf = context["context_confidence"].dropna()
        bins = pd.cut(conf, [0, 0.5, 0.7, 0.85, 1.01],
                      labels=["<0.5", "0.5-0.7", "0.7-0.85", "0.85+"])
        dist = bins.value_counts().sort_index()
        report["confidence_distribution"] = {str(k): int(v) for k, v in dist.items()}
        lines.append("\nCONFIDENCE DISTRIBUTION:")
        for k, v in dist.items():
            lines.append(f"  {str(k):10} {int(v)}")

    checks = validate(context)
    report["validation"] = checks
    lines.append("\nVALIDATION CHECKS:")
    for c in checks:
        lines.append(f"  [{c['status']}] {c['check']}: {c['violations']} violation(s)")

    # stat vs legacy window disagreement + before/after change
    if scored is not None:
        players = (sorted(cand_players) if cand_players
                   else sorted(scored["player"].unique()))
        disagreements = []
        for p in players:
            g = scored[scored["player"] == p]
            if len(g) < 3:
                continue
            bs = _best_window(g, "stat_total")
            bl = _best_window(g, "legacy_total")
            if bs and bl and bs[1] != bl[1]:
                disagreements.append({"player": p, "stat": bs[1], "legacy": bl[1]})
        report["stat_legacy_disagreements"] = disagreements
        lines.append(f"\nSTAT vs LEGACY WINDOW DISAGREEMENTS: {len(disagreements)}")
        for d in disagreements[:25]:
            lines.append(f"  {d['player']:24} stat={d['stat']:18} legacy={d['legacy']}")

        baseline_path = results_dir / "baseline" / "scored_pre_context.parquet"
        if baseline_path.exists():
            try:
                base = pd.read_parquet(baseline_path)
            except Exception:
                base = None
            if base is not None:
                changed = []
                for p in players:
                    g = scored[scored["player"] == p]
                    b = base[base["player"] == p]
                    if len(g) < 3 or len(b) < 3:
                        continue
                    new = _best_window(g, "legacy_total")
                    old = _best_window(b, "legacy_total")
                    if new and old:
                        delta = new[0] - old[0]
                        if new[1] != old[1] or abs(delta) >= 0.5:
                            changed.append({"player": p, "old": old[1],
                                            "new": new[1],
                                            "old_score": round(old[0], 2),
                                            "new_score": round(new[0], 2),
                                            "window_moved": new[1] != old[1]})
                changed.sort(key=lambda x: abs(x["new_score"] - x["old_score"]),
                             reverse=True)
                report["best_window_changes"] = changed
                moved = [c for c in changed if c["window_moved"]]
                lines.append(f"\nLEGACY BEST-WINDOW CHANGES AFTER ENRICHMENT: "
                             f"{len(changed)} (window moved for {len(moved)})")
                for c in changed[:25]:
                    flag = "  *MOVED*" if c["window_moved"] else ""
                    lines.append(f"  {c['player']:24} {c['old']:18} -> "
                                 f"{c['new']:18} "
                                 f"({c['old_score']:.2f} -> {c['new_score']:.2f})"
                                 f"{flag}")

    txt = "\n".join(lines)
    (results_dir / "context_audit.txt").write_text(txt, encoding="utf-8")
    (results_dir / "context_audit.json").write_text(
        json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(txt)
    print(f"\nWrote {results_dir/'context_audit.txt'} and .json")
    return report
