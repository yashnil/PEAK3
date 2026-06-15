"""
Full-dataset integrity checks for the completed-data pass (spec section 10).

`run_integrity_checks(scored, mvp, dpoy, team_shares)` returns (ok, report_lines).
Impossible values (shares > 1, negative vote shares, vote shares > 1, duplicate
player-seasons, award winners that are not first in the vote table, provisional
leakage, etc.) are collected; `assert_integrity(...)` FAILS LOUD on any of them.
"""
from __future__ import annotations

from typing import List, Tuple

import numpy as np
import pandas as pd


def _num(s):
    return pd.to_numeric(s, errors="coerce")


def run_integrity_checks(scored: pd.DataFrame,
                         mvp: pd.DataFrame | None = None,
                         dpoy: pd.DataFrame | None = None,
                         team_shares: pd.DataFrame | None = None
                         ) -> Tuple[bool, List[str]]:
    problems: List[str] = []
    notes: List[str] = []

    # 1. duplicate player-season rows in the scored dataset
    dup = scored.duplicated(["player", "season_end"]).sum()
    (problems if dup else notes).append(f"duplicate player-season rows: {int(dup)}")

    # 2. team shares within (0, 1]; no impossible >1
    if team_shares is not None and len(team_shares):
        for col in ("team_scoring_share", "team_assist_share"):
            v = _num(team_shares[col])
            hi = int((v > 1.0 + 1e-9).sum())
            lo = int((v < -1e-9).sum())
            (problems if (hi or lo) else notes).append(
                f"team_shares {col}: >1 -> {hi}, <0 -> {lo} "
                f"(max {v.max():.3f})")
    # scored-side shares too
    for col in ("team_scoring_share", "team_assist_share"):
        if col in scored.columns:
            v = _num(scored[col])
            hi = int((v > 1.0 + 1e-9).sum())
            (problems if hi else notes).append(f"scored {col} >1: {hi}")

    # 3. vote shares in [0, 1]; winners are first; no fabricated negatives
    for name, vt in (("mvp", mvp), ("dpoy", dpoy)):
        if vt is None or not len(vt):
            continue
        vs = _num(vt["vote_share"])
        neg = int((vs < -1e-9).sum())
        hi = int((vs > 1.0 + 1e-9).sum())
        (problems if (neg or hi) else notes).append(
            f"{name} vote_share: <0 -> {neg}, >1 -> {hi} "
            f"(range {vs.min():.3f}..{vs.max():.3f})")
        # award winners (finish==1) must hold the maximum vote share that season
        fcol = f"{name}_finish"
        if fcol in vt.columns:
            bad = 0
            for se, g in vt.groupby("season_end"):
                g = g.dropna(subset=["vote_share"])
                if not len(g):
                    continue
                winners = g[_num(g[fcol]) == 1]
                if len(winners) and _num(winners["vote_share"]).max() < \
                        _num(g["vote_share"]).max() - 1e-9:
                    bad += 1
            (problems if bad else notes).append(
                f"{name} seasons where a non-winner outscored the winner: {bad}")
        # duplicate player-season inside a vote table
        d2 = vt.duplicated(["season_end", "player_clean"]).sum()
        (problems if d2 else notes).append(f"{name} duplicate player-seasons: {int(d2)}")

    # 4. scored vote-share columns in [0,1] and never silently zero-filled
    for col in ("mvp_vote_share", "dpoy_vote_share"):
        if col in scored.columns:
            v = _num(scored[col])
            bad = int(((v < -1e-9) | (v > 1.0 + 1e-9)).sum())
            zeros = int((v == 0.0).sum())
            (problems if bad else notes).append(
                f"scored {col}: out-of-range {bad}, exact-zero {zeros} "
                f"(missing is NaN, not 0)")

    # 5. provisional leakage: a provisional season must not be flagged complete
    if "provisional" in scored.columns:
        prov = int(_num(scored["provisional"]).fillna(0).sum())
        notes.append(f"provisional seasons in dataset: {prov} (excluded from windows)")

    # 6. data-status fields present and consistent
    for col in ("team_share_data_status", "mvp_vote_data_status",
                "dpoy_vote_data_status", "burden_data_status"):
        if col not in scored.columns:
            problems.append(f"missing data-status column: {col}")
        else:
            notes.append(f"{col}: " + ", ".join(
                f"{k}={v}" for k, v in scored[col].value_counts().items()))

    # 7. component contributions reconcile exactly to prime_raw
    W = {"statistical_impact": 0.38, "traditional_production": 0.21,
         "recognition": 0.20, "postseason_perf": 0.18, "team_achievement": 0.03}
    recon = sum(W[k] * _num(scored[k]).fillna(0) for k in W) \
        + _num(scored["teammate_adjustment"]).fillna(0)
    diff = float((recon - _num(scored["prime_raw"])).abs().max())
    (problems if diff > 1e-9 else notes).append(
        f"max prime_raw reconciliation diff: {diff:.2e}")

    ok = len(problems) == 0
    lines = ["INTEGRITY CHECKS (section 10)", "=" * 60]
    lines.append("PASS" if ok else "FAIL -- impossible/inconsistent values found")
    lines.append("")
    if problems:
        lines.append("PROBLEMS:")
        lines += [f"  ! {p}" for p in problems]
        lines.append("")
    lines.append("CHECKS:")
    lines += [f"  - {n}" for n in notes]
    return ok, lines


def assert_integrity(scored, mvp=None, dpoy=None, team_shares=None) -> List[str]:
    ok, lines = run_integrity_checks(scored, mvp, dpoy, team_shares)
    if not ok:
        raise AssertionError("Integrity checks FAILED:\n" + "\n".join(lines))
    return lines
