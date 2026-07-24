#!/usr/bin/env python3
"""Phase 6A Stage C: experimental 1-year card extension for real team-year rosters.

Generates real, non-fabricated 1-year (apex_1y) peak-window cards for players
who are locally verified (scripts/audit_player_pool_expansion.py) but have no
entry in the canonical `data/game/profiles/card_profiles.v3.json`. Output goes
to an experimental, non-canonical path -- this script NEVER writes to
card_profiles.v3.json, final_250_candidates.csv, or any other canonical file.

Formula reuse discipline (Phase 6A Goal 2 -- "do not create one formula for
stars and another for role players"): every raw component value used here is
read DIRECTLY from cache/processed/scored_1980_2026.parquet's own
`contrib_*` columns, which are the exact same OFFICIAL_WEIGHTS-scaled raw
component values `data/web/peak_windows.json`'s `components` dict already
contains for the 250-pool (verified this session: Michael Jordan 1990-91's
contrib_statistical_impact=37.605910 matches peak_windows.json's SI=37.6059
to 4 decimal places). No new scoring logic is written here -- this script
only selects which season is a player's best 1-year window (trivial for
n=1: their single highest-prime_raw season) and re-runs the EXISTING
scripts/build_card_profiles.py role-eligibility/DNA transform functions
(imported, not duplicated) over a merged percentile basis (250-pool windows
+ the new windows together), so role classification stays consistent with
the main pool instead of being computed against a tiny, skewed basis.

Scope (deliberately bounded for this pass, see
docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md "Stage C" status):
  - 1-year (apex_1y) duration only -- matches CourtBuilder's default mode.
  - Only the audited Warriors 2010s rotation (scripts/audit_player_pool_expansion.py's
    WARRIORS_AUDIT_LIST) plus any other real GSW 2015-16/2016-17/2017-18
    rostermate found in local data who isn't already in the 250-pool.
  - 3/5-year windows and the full 1885-identity manifest are explicitly
    NOT built here -- see the expansion strategy doc for the follow-up scope.

Usage:
    python scripts/build_experimental_card_extension.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from build_card_profiles import (  # noqa: E402
    _compute_dna,
    _compute_duration_percentiles,
    _eligible_roles,
    _primary_role,
)

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
PEAK_WINDOWS_PATH = REPO_ROOT / "data" / "web" / "peak_windows.json"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "card_profiles.experimental.json"

EXPERIMENTAL_PROFILE_VERSION = "experimental_v0"
EXPERIMENTAL_CARD_POOL_VERSION = "experimental_warriors_2010s_v0"

# The audited Warriors rotation list, plus real GSW 2015-16/2016-17/2017-18
# rostermates surfaced by scripts/audit_player_pool_expansion.py's roster
# printout who are not already in the 250-pool.
EXTENSION_PLAYERS = [
    "Andre Iguodala", "Jrue Holiday", "Andrew Bogut", "Draymond Green",
    "Shaun Livingston", "Harrison Barnes", "David West", "Kevon Looney",
    "Zaza Pachulia", "Festus Ezeli", "Leandro Barbosa", "Marreese Speights",
    "Matt Barnes", "Nick Young", "JaVale McGee", "Jermaine O'Neal",
    "Brandon Rush", "Patrick McCaw", "Ian Clark",
]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _already_in_250(player_slugs_in_pool: set[str], slug: str) -> bool:
    return slug in player_slugs_in_pool


def build_windows_for_player(name: str, scored: pd.DataFrame) -> dict | None:
    """The player's single best 1-year (n=1) window -- trivially their
    highest-prime_raw non-provisional season, mirroring
    peak3.py::n_year_windows(..., n=1)'s own selection rule."""
    rows = scored[(scored["player"] == name) & (scored["provisional"] != 1)]
    if not len(rows):
        return None
    best = rows.loc[rows["prime_raw"].idxmax()]
    slug = _slug(name)
    return {
        "id": f"{slug}-1yr-{best['season'].replace('-', '')}",
        "player_id": slug,
        "player_slug": slug,
        "player_name": name,
        "duration_years": 1,
        "start_season": best["season"],
        "end_season": best["season"],
        "anchor_season": best["season"],
        "rank": None,  # filled in after merge, see main()
        # `prime_score` is already the real, canonical calibrate_score(prime_raw)
        # output for this season -- calibrate_score() is a fixed deterministic
        # interpolation against constant anchor points (not refit per call,
        # verified this session by reading peak3.py), so the precomputed value
        # here is identical to what calling calibrate_score() directly would
        # produce. Reused as-is; calibrate_score() itself is never called or
        # modified (CLAUDE.md: never touch outside the canonical model).
        "prime_score": round(float(best["prime_score"]), 2),
        "prime_index": round(float(best["prime_raw"]), 4),
        "components": {
            "statistical_impact": round(float(best["contrib_statistical_impact"]), 4),
            "traditional_production": round(float(best["contrib_traditional_production"]), 4),
            "individual_recognition": round(float(best["contrib_recognition"]), 4),
            "postseason_individual_value": round(float(best["contrib_postseason"]), 4),
            "team_achievement": round(float(best["contrib_team_achievement"]), 4),
            "teammate_adjustment": round(float(best["teammate_adjustment"]), 4)
            if pd.notna(best["teammate_adjustment"]) else 0.0,
        },
        "data_status": "complete" if best.get("games_played_pct", 0) >= 0.9 else "partial",
    }


def main() -> int:
    if not SCORED_PATH.exists() or not PEAK_WINDOWS_PATH.exists():
        print(f"ERROR: required source missing (SCORED_PATH exists={SCORED_PATH.exists()}, "
              f"PEAK_WINDOWS_PATH exists={PEAK_WINDOWS_PATH.exists()}) -- broken checkout.")
        return 1

    scored = pd.read_parquet(SCORED_PATH)
    with PEAK_WINDOWS_PATH.open() as f:
        existing_windows = json.load(f)
    existing_1yr = [w for w in existing_windows if w["duration_years"] == 1]
    existing_slugs = {w["player_slug"] for w in existing_windows}

    new_windows = []
    skipped = []
    for name in EXTENSION_PLAYERS:
        slug = _slug(name)
        if _already_in_250(existing_slugs, slug):
            skipped.append((name, "already has a canonical card_profiles.v3.json entry"))
            continue
        w = build_windows_for_player(name, scored)
        if w is None:
            skipped.append((name, "no non-provisional local season found"))
            continue
        new_windows.append(w)

    if not new_windows:
        print("No new experimental windows to build (all candidates already covered or unavailable).")
        for name, reason in skipped:
            print(f"  skipped: {name} -- {reason}")
        return 0

    # Percentile basis = existing 250-pool 1yr windows + the new ones together,
    # so role classification is computed on the SAME basis as the main pool
    # (Goal 2: no separate formula/basis for role players vs stars).
    merged_pool = existing_1yr + new_windows
    pcts = _compute_duration_percentiles(merged_pool)

    # Rank: where each new window would fall by prime_index among the merged
    # pool -- an honest, real rank against the same population, not a
    # fabricated placeholder.
    sorted_by_index = sorted(merged_pool, key=lambda w: w["prime_index"], reverse=True)
    rank_by_id = {w["id"]: i + 1 for i, w in enumerate(sorted_by_index)}

    cards = []
    for w in new_windows:
        w["rank"] = rank_by_id[w["id"]]
        eligible, traces = _eligible_roles(w, pcts)
        dna = _compute_dna(w)
        primary = _primary_role(eligible)
        cards.append({
            "peak_window_id": w["id"],
            "profile_version": EXPERIMENTAL_PROFILE_VERSION,
            "player_id": w["player_id"],
            "player_slug": w["player_slug"],
            "player_name": w["player_name"],
            "duration_years": w["duration_years"],
            "start_season": w["start_season"],
            "end_season": w["end_season"],
            "anchor_season": w["anchor_season"],
            "individual_peak_score": w["prime_score"],
            "individual_peak_rank": w["rank"],
            "prime_index": w["prime_index"],
            "eligible_roles": eligible,
            "primary_role": primary,
            "role_traces": traces,
            "lineup_dna": dna,
            "data_completeness": w["data_status"],
            "profile_status": "experimental_data_derived",
            "source_fields": ["cache/processed/scored_1980_2026.parquet: contrib_* columns, prime_index"],
            "transform_ids": ["dna_v2_roles_v3 (reused from scripts/build_card_profiles.py, unmodified)"],
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "card_pool_version": EXPERIMENTAL_CARD_POOL_VERSION,
        "profile_version": EXPERIMENTAL_PROFILE_VERSION,
        "status": "experimental -- NOT canonical, NOT wired into CourtBuilder by default, "
                  "NOT a replacement for card_profiles.v3.json",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generation_command": "python scripts/build_experimental_card_extension.py",
        "formula_version": "peak3 OFFICIAL_WEIGHTS (statistical_impact=0.38, traditional_production=0.21, "
                            "recognition=0.20, postseason=0.18, team_achievement=0.03) -- unchanged, "
                            "read directly from cache/processed/scored_1980_2026.parquet, never recomputed",
        "source_provenance": {
            "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            "percentile_basis": "merged with the existing 250-pool's 1yr windows for consistent role classification",
        },
        "cards": cards,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print(f"Built {len(cards)} experimental 1-year cards -> {OUT_PATH.relative_to(REPO_ROOT)}")
    for c in cards:
        print(f"  {c['player_name']:20s} anchor={c['anchor_season']}  prime_index={c['prime_index']:.2f}  "
              f"primary_role={c['primary_role']}  rank={c['individual_peak_rank']}")
    if skipped:
        print("\nSkipped:")
        for name, reason in skipped:
            print(f"  {name}: {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
