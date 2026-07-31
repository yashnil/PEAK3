"""Non-production PEAK3 formula variant experiments (Phase 12B).

WHAT THIS IS. A sandbox for answering "what would the board look like if we
changed X?" without changing anything. It reads the committed served artifact,
re-weights components in memory, re-sorts, and reports rank movement. It
NEVER writes an artifact, never touches `leaderboards/`, and never imports the
production scoring path in a way that could mutate it.

WHY RANKING IN INDEX SPACE IS VALID. A row's `prime_index` is exactly the sum
of its five weighted component contributions plus the teammate adjustment
(verified to 0.01 across the board), and `prime_score` is a monotonic remap of
`prime_index`. So re-sorting on a modified index gives the same ordering the
real pipeline would produce after calibration -- without needing to re-fit the
calibration curve on a hypothetical distribution, which would itself change
the numbers for reasons unrelated to the variant.

WHAT A VARIANT CAN AND CANNOT SHOW HERE. Variants that re-weight an EXISTING
component (REC, TEAM, a PO floor) are exact: the contribution is already in the
artifact. Variants that would change how a component is COMPUTED -- smoothing
the PO thresholds, re-weighting playoff load inside PO -- cannot be evaluated
from the artifact alone, because the artifact carries the finished component,
not its internal terms. Those are computed from the scored parquet's PO
diagnostic columns instead, and are marked APPROXIMATE where the reconstruction
is not exact. Saying which is which matters more than covering every variant.

Usage:
    python scripts/experiment_formula_variants.py            # summary table
    python scripts/experiment_formula_variants.py --markdown # doc-ready output
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.calibration_diagnostics import Boards, DiagnosticRow  # noqa: E402

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"

# PO weight, needed to convert a raw postseason_perf delta into index points.
PO_WEIGHT = 0.18
TEAM_WEIGHT = 0.03


@dataclass
class Variant:
    key: str
    name: str
    description: str
    # Returns the row's NEW prime_index. `raw` carries the scored-parquet row
    # when the variant needs PO internals; None when unavailable.
    index_fn: Callable[[DiagnosticRow, Optional[pd.Series]], float]
    exact: bool = True


def _index(row: DiagnosticRow) -> float:
    """The row's current prime_index, reconstructed from its components."""
    return row.prime_index if row.prime_index is not None else sum(row.components.values())


# ---------------------------------------------------------------------------
# Variants
# ---------------------------------------------------------------------------

def _po_floor(row: DiagnosticRow, _raw) -> float:
    """B: PO can never be negative."""
    return _index(row) + max(0.0, -row.po)


def _po_floor_for_deep_starters(row: DiagnosticRow, _raw) -> float:
    """C: PO floored at 0 only for high-minute starters on deep runs.

    "Deep" is a conference-finals-or-better team; "starter" is >=30 playoff
    minutes per game. The narrow version of B: it protects a Klay-2014-15 case
    without lifting every role player who had a bad series.
    """
    deep = (row.championship == 1) or (row.finals_appearance == 1)
    heavy = row.po_mpg is not None and row.po_mpg >= 30.0
    if deep and heavy and row.po < 0:
        return _index(row) - row.po
    return _index(row)


def _rec_scaled(factor: float) -> Callable[[DiagnosticRow, Optional[pd.Series]], float]:
    def fn(row: DiagnosticRow, _raw) -> float:
        return _index(row) - row.rec + row.rec * factor
    return fn


def _team_cap(new_cap: float) -> Callable[[DiagnosticRow, Optional[pd.Series]], float]:
    """H: rescale TEAM to a larger ceiling. The component is 0..3 today; this
    stretches the same relative value onto 0..new_cap."""
    def fn(row: DiagnosticRow, _raw) -> float:
        return _index(row) - row.team_ach + row.team_ach * (new_cap / 3.0)
    return fn


def _no_playoff_shrink(factor: float) -> Callable[[DiagnosticRow, Optional[pd.Series]], float]:
    """J: shrink the whole index for a season with no postseason at all."""
    def fn(row: DiagnosticRow, _raw) -> float:
        base = _index(row)
        return base * factor if row.made_playoffs == 0 else base
    return fn


def _po_smooth_thresholds(row: DiagnosticRow, raw: Optional[pd.Series]) -> float:
    """D: soften the deep-run (42) and dominance (50) knees.

    APPROXIMATE. Recomputes the two gated terms with a softer ramp -- a
    quadratic ease-in over the 10 points below each knee instead of a hard
    max(level - knee, 0) -- and substitutes them for the stored ones.
    Everything else in PO is left untouched.
    """
    base = _index(row)
    if raw is None or pd.isna(raw.get("po_abs_level")):
        return base
    level = float(raw["po_abs_level"]) + 25.0
    reliab = float(raw.get("po_sample_reliab") or 0.0)

    def soft(value: float, knee: float, width: float = 10.0) -> float:
        """Ease in over `width` points below the knee instead of switching on."""
        if value >= knee:
            return value - knee
        if value <= knee - width:
            return 0.0
        t = (value - (knee - width)) / width
        return 0.5 * width * t * t

    old_deep = float(raw.get("po_deep_run_value") or 0.0)
    old_dom = float(raw.get("po_dominance_value") or 0.0)
    # Same scales as peak3.py, applied to the softened residuals.
    new_deep = 0.26 * soft(level, 42.0) * 1.0 * 0.85
    new_dom = 2.05 * (soft(level, 50.0) ** 0.5) * reliab
    delta_raw = (new_deep - old_deep) + (new_dom - old_dom)
    return base + PO_WEIGHT * delta_raw


def _po_load_weighted(row: DiagnosticRow, raw: Optional[pd.Series]) -> float:
    """E/F/G combined: scale PO by how much of the postseason the player
    actually carried.

    APPROXIMATE. Multiplies the POSITIVE part of PO by a load factor built from
    playoff minutes per game and games played, so a 12-game 36-minute run at an
    extreme rate is worth less than a 23-game 40-minute run at a strong one.
    Negative PO is left alone -- shrinking a penalty by load would reward
    playing badly for longer.
    """
    base = _index(row)
    if row.po <= 0 or row.po_mpg is None or row.po_games is None:
        return base
    minutes_part = min(row.po_mpg / 38.0, 1.0)
    games_part = min(row.po_games / 20.0, 1.0)
    load = 0.55 + 0.45 * (0.5 * minutes_part + 0.5 * games_part)
    return base - row.po + row.po * load


VARIANTS: list[Variant] = [
    Variant("A", "Baseline", "The shipped formula, unchanged.", lambda r, _: _index(r)),
    Variant("B", "PO floor at 0", "Postseason value can never be negative.", _po_floor),
    Variant(
        "C",
        "PO floor for deep-run starters",
        "PO floored at 0 only for >=30 playoff MPG on a Finals/title team.",
        _po_floor_for_deep_starters,
    ),
    Variant(
        "D",
        "Smooth PO thresholds",
        "Ease the deep-run (42) and dominance (50) knees over 10 points.",
        _po_smooth_thresholds,
        exact=False,
    ),
    Variant(
        "E",
        "Load-weighted PO",
        "Scale positive PO by playoff minutes-per-game and games played.",
        _po_load_weighted,
        exact=False,
    ),
    Variant("H4", "TEAM cap 4", "Stretch Team Achievement from 0-3 to 0-4.", _team_cap(4.0)),
    Variant("H5", "TEAM cap 5", "Stretch Team Achievement from 0-3 to 0-5.", _team_cap(5.0)),
    Variant("I15", "REC -15%", "Reduce Individual Recognition by 15%.", _rec_scaled(0.85)),
    Variant("I25", "REC -25%", "Reduce Individual Recognition by 25%.", _rec_scaled(0.75)),
    Variant(
        "J",
        "No-playoff shrinkage",
        "Multiply the index by 0.95 for a season with no postseason.",
        _no_playoff_shrink(0.95),
    ),
]


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

def _raw_lookup() -> dict[tuple[str, str], dict]:
    """(player, season) -> scored row, for variants that need PO internals."""
    if not SCORED_PATH.exists():
        return {}
    df = pd.read_parquet(SCORED_PATH)
    df = df[~df["team"].isin({"2TM", "3TM", "4TM", "5TM", "TOT"})]
    # Kept as dicts, not namedtuples: variants read optional PO diagnostic
    # columns and need a missing one to be absent rather than an
    # AttributeError.
    return {(r["player"], r["season"]): r for _, r in df.iterrows()}


def run(board: str = "1y", depth: int = 100) -> dict:
    boards = Boards.load()
    rows = boards.board(board, depth)
    raw = _raw_lookup()

    def raw_for(row: DiagnosticRow) -> Optional[pd.Series]:
        return raw.get((row.player, row.anchor_season))

    baseline = {r.row_id: i + 1 for i, r in enumerate(rows)}
    results = {}
    for variant in VARIANTS:
        scored = sorted(
            ((variant.index_fn(r, raw_for(r)), r) for r in rows), key=lambda x: (-x[0], x[1].row_id)
        )
        ranks = {r.row_id: i + 1 for i, (_, r) in enumerate(scored)}
        moves = {rid: ranks[rid] - baseline[rid] for rid in baseline}
        top10_before = {r.row_id for r in rows[:10]}
        top10_after = {rid for rid, rk in ranks.items() if rk <= 10}
        results[variant.key] = {
            "variant": variant,
            "ranks": ranks,
            "moves": moves,
            "max_move": max(abs(v) for v in moves.values()),
            "moved_rows": sum(1 for v in moves.values() if v != 0),
            "top10_retained": len(top10_before & top10_after),
            "biggest_gainers": sorted(moves.items(), key=lambda kv: kv[1])[:5],
            "biggest_losers": sorted(moves.items(), key=lambda kv: -kv[1])[:5],
        }
    return {"rows": rows, "baseline": baseline, "results": results}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--board", default="1y")
    parser.add_argument("--depth", type=int, default=100)
    parser.add_argument("--markdown", action="store_true")
    args = parser.parse_args()

    out = run(args.board, args.depth)
    rows = {r.row_id: r for r in out["rows"]}

    if args.markdown:
        print("| Variant | Exact? | Rows moved | Max move | Top-10 retained | Biggest gainer | Biggest loser |")
        print("|---|---|---|---|---|---|---|")
    for key, res in out["results"].items():
        v = res["variant"]
        gain = res["biggest_gainers"][0]
        lose = res["biggest_losers"][0]
        g = rows[gain[0]]
        l = rows[lose[0]]
        if args.markdown:
            print(
                f"| **{key}** {v.name} | {'exact' if v.exact else 'approx'} | {res['moved_rows']}/{len(rows)} "
                f"| {res['max_move']} | {res['top10_retained']}/10 "
                f"| {g.player} {g.label} ({gain[1]:+d}) | {l.player} {l.label} ({lose[1]:+d}) |"
            )
        else:
            print(f"{key:4s} {v.name:32s} moved={res['moved_rows']:3d} max={res['max_move']:3d} top10={res['top10_retained']}/10")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
