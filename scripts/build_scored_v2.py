"""Derive the PEAK3 v2 scored dataset from the committed v1 one.

WHY DERIVE RATHER THAN RE-SCORE. v2 changes exactly one component. The other
four contributions, the teammate adjustment and every model input already live
in `cache/processed/scored_1980_2026.parquet`, and

    prime_raw = contrib_si + contrib_tp + contrib_recognition
              + contrib_postseason + contrib_team_achievement
              + teammate_adjustment

holds EXACTLY on that file (max abs error 0.0 across all 11,429 rows; asserted
below before anything is written). So recomputing the postseason contribution and
re-summing reproduces precisely what `score_dataset(..., "peak3_v2")` would
produce, without re-running the ingestion path -- which depends on optional
context files and cached HTML that may not be present on a given machine.

This also means v1 is untouched by construction: the v1 parquet is opened
read-only and a separate file is written.

    python scripts/build_scored_v2.py

Writes cache/processed/scored_1980_2026.v2.parquet.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import peak3 as P  # noqa: E402
from nba_peak import formula_version  # noqa: E402

V1_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
V2_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.v2.parquet"

# The five weighted contributions, in assembly order.
CONTRIB_COLS = (
    "contrib_statistical_impact",
    "contrib_traditional_production",
    "contrib_recognition",
    "contrib_postseason",
    "contrib_team_achievement",
)

# Tolerance for the reconstruction assert. The identity is exact in practice;
# this leaves room only for float round-trip through parquet.
IDENTITY_TOL = 1e-9


def _assert_v1_identity(df: pd.DataFrame) -> None:
    """Refuse to derive anything unless v1's own index reconciles exactly.

    If this fails the derivation is invalid and the script must stop rather than
    write a subtly wrong v2 -- a silently-wrong model version is the single worst
    outcome this phase could produce.
    """
    tmadj = P.num(df, "teammate_adjustment").fillna(0.0)
    recon = sum(P.num(df, c).fillna(0.0) for c in CONTRIB_COLS) + tmadj
    err = (recon - P.num(df, "prime_raw")).abs().max()
    if not (err <= IDENTITY_TOL):
        raise SystemExit(
            f"v1 prime_raw does not reconcile from its own contributions "
            f"(max abs error {err:.3e} > {IDENTITY_TOL:g}). Refusing to derive v2."
        )
    cal = (P.calibrate_score(P.num(df, "prime_raw")) - P.num(df, "prime_score")).abs().max()
    if not (cal <= IDENTITY_TOL):
        raise SystemExit(
            f"calibrate_score(prime_raw) does not reproduce v1 prime_score "
            f"(max abs error {cal:.3e}). Refusing to derive v2."
        )


def build(df: pd.DataFrame) -> pd.DataFrame:
    """Return the v2 scored frame. `df` is not mutated."""
    out = df.copy()
    has_po = (P.num(out, "po_g").fillna(0) > 0)

    v2_val, parts = P.postseason_value_v2(out, has_po)
    for name, arr in parts.items():
        out[name] = arr

    # Keep v1's number under an explicit name so any consumer can compare the
    # two for the same row without loading a second file.
    out["postseason_perf_v1"] = P.num(df, "postseason_perf")
    out["postseason_perf"] = v2_val
    out["postseason_perf_score"] = v2_val
    out["contrib_postseason"] = P.OFFICIAL_WEIGHTS["postseason"] * v2_val

    tmadj = P.num(out, "teammate_adjustment").fillna(0.0)
    prime_raw = sum(P.num(out, c).fillna(0.0) for c in CONTRIB_COLS) + tmadj
    perf_only_raw = (P.num(out, "contrib_statistical_impact").fillna(0.0)
                     + P.num(out, "contrib_traditional_production").fillna(0.0)
                     + P.num(out, "contrib_postseason").fillna(0.0))

    out["prime_raw"] = prime_raw
    out["perf_only_raw"] = perf_only_raw
    # Calibration anchors are REUSED unchanged. Refitting them for v2 would move
    # every score for reasons unrelated to the postseason fix and destroy v1<->v2
    # comparability (design doc section 5).
    out["prime_score"] = P.calibrate_score(prime_raw)
    out["performance_only"] = P.calibrate_score(perf_only_raw)
    out["prime_index"] = prime_raw.round(2)
    out["perf_index"] = perf_only_raw.round(2)
    # Back-compat aliases, kept consistent with score_dataset.
    out["stat_raw"] = out["perf_only_raw"]
    out["legacy_raw"] = out["prime_raw"]
    out["formula_version"] = formula_version.PEAK3_V2
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--v1", type=Path, default=V1_PATH)
    ap.add_argument("--out", type=Path, default=V2_PATH)
    args = ap.parse_args(argv)

    if not args.v1.exists():
        raise SystemExit(f"missing v1 scored dataset: {args.v1}")
    if args.out.resolve() == args.v1.resolve():
        raise SystemExit("refusing to overwrite the v1 scored dataset")

    df = pd.read_parquet(args.v1)
    _assert_v1_identity(df)
    out = build(df)

    for col in ("prime_raw", "prime_score", "postseason_perf"):
        bad = ~np.isfinite(P.num(out, col).to_numpy())
        if bad.any():
            raise SystemExit(f"{col} has {bad.sum()} non-finite values; refusing to write")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(args.out, index=False)

    moved = (out["prime_index"] - df["prime_index"]).abs()
    print(f"wrote {args.out}  rows={len(out)}")
    print(f"  formula_version : {formula_version.V2_DESCRIPTION}")
    print(f"  prime_index      : mean shift {moved.mean():+.3f}, max shift {moved.max():.3f}")
    print(f"  postseason median: v1 {df['postseason_perf'].median():+.2f} "
          f"-> v2 {out['postseason_perf'].median():+.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
