#!/usr/bin/env python3
"""Phase 6D Task D: Top-1000 individual 1Y/3Y/5Y PEAK3 peaks.

Read-only re-use of nba_peak.leaderboards.build_leaderboard/best_window,
which themselves only call peak3.n_year_windows/calibrate_score (the
official, unmodified formula -- CLAUDE.md: never calculate PEAK3 scores in
TypeScript, never change the formula). This script changes NO scoring
logic; it only runs the EXISTING window/calibration functions against a
BROADER universe than the canonical 250-pool leaderboards/*.csv use, so the
website's Peak section can show real top-1000 lists instead of being capped
at 250.

Universe: every player in cache/processed/scored_1980_2026.parquet (2,016
identities) -- not the 250-pool, and not the 1500-identity manifest (that
manifest is built from AWARD/role criteria, not peak score, so restricting
to it would risk excluding a real high-peak-score player who happens not to
clear an award-based criterion). This is a pure re-ranking of already-scored
data across a wider population, never a new score.

Outputs:
  data/game/experimental/player_pool_1500/top_1000_peaks.v1.json

Usage:
    python scripts/build_top_peaks.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import nba_peak.leaderboards as L  # noqa: E402
import peak3 as P  # noqa: E402

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "top_1000_peaks.v1.json"

DATASET_VERSION = "top_1000_peaks.v1"
TOP_N = 1000
SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"
FORMULA_VERSION = (
    "peak3_official_weights_v1 (statistical_impact=0.38, traditional_production=0.21, "
    "recognition=0.20, postseason=0.18, team_achievement=0.03)"
)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def main() -> int:
    if not SCORED_PATH.exists():
        print(f"ERROR: {SCORED_PATH} missing -- broken checkout.")
        return 1

    scored = pd.read_parquet(SCORED_PATH)
    universe = pd.DataFrame({"player": sorted(scored["player"].unique())})
    universe["canonical_player_id"] = universe["player"].map(_slug)

    print(f"Universe: {len(universe)} identities (full scored_1980_2026.parquet population)")

    payload = {
        "dataset_version": DATASET_VERSION,
        "generation_command": "python scripts/build_top_peaks.py",
        "source_provenance": {
            "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            "windowing": "nba_peak.leaderboards.build_leaderboard -> peak3.n_year_windows/calibrate_score (unmodified official formula)",
        },
        "formula_version": FORMULA_VERSION,
        "official_weights": P.OFFICIAL_WEIGHTS,
        "supported_start_season": SUPPORTED_START_SEASON,
        "supported_end_season": SUPPORTED_END_SEASON,
        "universe_identity_count": len(universe),
        "top_n": TOP_N,
        "windows": {},
    }

    for n in (1, 3, 5):
        board = L.build_leaderboard(scored, universe, n, top=TOP_N)
        rows = []
        for _, r in board.iterrows():
            player = r["Player"]
            slug = _slug(player)
            window_label = r["Best season"] if n == 1 else r["Best window"]
            anchor_season = r["Anchor season"] if "Anchor season" in r else r.get("Best season")
            team_rows = scored[(scored["player"] == player) & (scored["season"] == anchor_season)]
            team = str(team_rows.iloc[0]["team"]) if len(team_rows) else None
            rows.append({
                "rank": int(r["Rank"]),
                "player_slug": slug,
                "player_name": player,
                "window_label": window_label,
                "anchor_season": anchor_season,
                "team": team,
                "prime_score": float(r["Prime display"]),
                "data_completeness": r["Data completeness status"],
            })
        payload["windows"][f"{n}y"] = {
            "duration_years": n,
            "row_count": len(rows),
            "rows": rows,
        }
        print(f"  {n}y: {len(rows)} rows (top score={rows[0]['prime_score'] if rows else None})")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=False))
    size = OUT_PATH.stat().st_size
    print(f"\nWrote {OUT_PATH.relative_to(REPO_ROOT)} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
