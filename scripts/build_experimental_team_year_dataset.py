#!/usr/bin/env python3
"""Phase 6D: broad team+YEAR (exact season) roster dataset, all teams/seasons.

Builds real, non-fabricated exact-team-season roster entries for EVERY
team-season locally available in cache/processed/regular_1980_2026.parquet
(1979-80..2025-26) -- not a hand-picked list. Every player_slug listed is
read directly from that file's own team/season/mp columns for that exact
team-season -- no roster is hand-typed or guessed.

History:
  v0 (Phase 6A): 3 hand-picked Golden State Warriors seasons only, roster
    intersected with the canonical 250-pool card_profiles.v3.json (deleted
    Phase 6C -- superseded).
  v1 (Phase 6C): same 3 Warriors seasons, added `team_id` per entry and
    switched to the full real roster (not canonical-pool-intersected) --
    fixed the exact-season resolution bug, but coverage was still
    Warriors-only. Deleted this session -- superseded by v2.
  v2 (Phase 6D, this file): computed from EVERY team-season in
    regular_1980_2026.parquet, not a hardcoded list. A team-season is
    "rollable" if it has >= MEANINGFUL_CANDIDATES_FLOOR real rostermates
    (mp >= MEANINGFUL_MINUTES_FLOOR that season) -- verified: 1,310 of
    1,314 total team-seasons clear this bar (min/max/median candidates
    5/23/13 across all team-seasons; the 4 that don't clear it are listed
    in `unsupported_team_seasons` with their real candidate count, not
    silently dropped). Only rollable entries appear in
    `exact_team_year_spins` (what the board generator actually reads);
    unrollable ones are never fabricated up to the floor.

A roster slot is included only if the player logged >=50 minutes for that
team in that season (regular_1980_2026.parquet's `mp` column) -- the same
"meaningful involvement, not a single cameo appearance" threshold already
used elsewhere in this codebase (nba_peak/context/title_role.py's
`po_mp >= 50` postseason-minutes floor), reused here for consistency rather
than inventing a new cutoff.

Each candidate carries identity_pool_status (canonical_250 / qualifies_1500
/ team_year_roster_only, cross-referenced against data/generated/
final_250_candidates.csv and the Phase 6D 1500-identity manifest) and
score_status (exact_season_scored / exact_season_unscored, cross-referenced
against cache/processed/scored_1980_2026.parquet) for transparency -- this
is a review/audit convenience; the runtime resolver
(nba_peak/perfect_season/exact_season.py::resolve_player_season_card)
re-derives both live from the same source parquets rather than trusting
this JSON's copy, so the two can never drift.

Usage:
    python scripts/build_experimental_team_year_dataset.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nba_peak.perfect_season.exact_season import TEAM_ID_TO_NAME  # noqa: E402

REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
MANIFEST_1500_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "candidate_identity_manifest.v1.json"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "courtbuilder_team_year.experimental.v2.json"

DATASET_VERSION = "courtbuilder_team_year.experimental.v2"
SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"

MEANINGFUL_MINUTES_FLOOR = 50.0
MEANINGFUL_CANDIDATES_FLOOR = 8

_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM"}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _load_1500_slugs() -> set[str]:
    if not MANIFEST_1500_PATH.exists():
        return set()
    data = json.loads(MANIFEST_1500_PATH.read_text())
    return {i["player_slug"] for i in data.get("identities", [])}


def main() -> int:
    if not REGULAR_PATH.exists():
        print(f"ERROR: {REGULAR_PATH} missing -- broken checkout.")
        return 1
    if not SCORED_PATH.exists():
        print(f"ERROR: {SCORED_PATH} missing -- broken checkout.")
        return 1

    regular = pd.read_parquet(REGULAR_PATH)
    regular = regular[~regular["team"].isin(_MULTI_TEAM_CODES)].copy()
    regular = regular.dropna(subset=["team", "season", "player"])
    regular["player_slug"] = regular["player"].map(_slug)

    scored = pd.read_parquet(SCORED_PATH)
    scored = scored[~scored["team"].isin(_MULTI_TEAM_CODES)].copy()
    scored["player_slug"] = scored["player"].map(_slug)
    scored_keys = set(zip(scored["player_slug"], scored["team"], scored["season"]))

    canonical_250: set[str] = set()
    if FINAL_250_PATH.exists():
        canonical_250 = {_slug(n) for n in pd.read_csv(FINAL_250_PATH)["player"].astype(str)}
    pool_1500 = _load_1500_slugs()

    def identity_status(slug: str) -> str:
        if slug in canonical_250:
            return "canonical_250"
        if slug in pool_1500:
            return "qualifies_1500"
        return "team_year_roster_only"

    unknown_teams: set[str] = set()
    entries: list[dict] = []
    unsupported: list[dict] = []

    # Deterministic ordering: team_id, then season -- never insertion order
    # from a groupby, which pandas does not guarantee is stable across
    # versions for this operation.
    team_seasons = sorted(regular[["team", "season"]].drop_duplicates().itertuples(index=False), key=lambda r: (r.team, r.season))

    for team_abbr, season in team_seasons:
        rows = regular[
            (regular["team"] == team_abbr) & (regular["season"] == season) & (regular["mp"] >= MEANINGFUL_MINUTES_FLOOR)
        ].sort_values(["mp", "player_slug"], ascending=[False, True])

        franchise_display_name = TEAM_ID_TO_NAME.get(team_abbr)
        if franchise_display_name is None:
            unknown_teams.add(team_abbr)
            franchise_display_name = team_abbr

        candidates = []
        for _, r in rows.iterrows():
            slug = r["player_slug"]
            key = (slug, team_abbr, season)
            candidates.append({
                "player_slug": slug,
                "player_name": str(r["player"]),
                "position": r["pos"] if pd.notna(r.get("pos")) else None,
                "identity_pool_status": identity_status(slug),
                "score_status": "exact_season_scored" if key in scored_keys else "exact_season_unscored",
            })

        roster_size = len(candidates)
        spin_id = f"{_slug(franchise_display_name)}-{season.replace('-', '')}"

        if roster_size >= MEANINGFUL_CANDIDATES_FLOOR:
            entries.append({
                "spin_id": spin_id,
                "team_id": team_abbr,
                "franchise_display_name": franchise_display_name,
                "season_label": season,
                "player_slugs": [c["player_slug"] for c in candidates],
                "candidates": candidates,
                "roster_size": roster_size,
                "source_provenance": (
                    f"cache/processed/regular_1980_2026.parquet: every {franchise_display_name} "
                    f"player with team=='{team_abbr}', season=='{season}', mp>={MEANINGFUL_MINUTES_FLOOR:.0f} "
                    f"({roster_size} players)."
                ),
            })
        else:
            unsupported.append({
                "team_id": team_abbr,
                "franchise_display_name": franchise_display_name,
                "season_label": season,
                "candidate_count": roster_size,
                "reason": (
                    f"Only {roster_size} rostermate(s) logged >= {MEANINGFUL_MINUTES_FLOOR:.0f} minutes "
                    f"for {team_abbr} in {season} in the locally committed data -- below the "
                    f"{MEANINGFUL_CANDIDATES_FLOOR}-candidate rollability floor. Not fabricated up to "
                    "the floor; excluded from the spinner instead."
                ),
            })

    counts = [e["roster_size"] for e in entries]
    counts_sorted = sorted(counts)
    n = len(counts_sorted)
    median = counts_sorted[n // 2] if n % 2 else (counts_sorted[n // 2 - 1] + counts_sorted[n // 2]) / 2
    has_2025_26 = any(e["season_label"] == "2025-26" for e in entries)
    franchises_represented = sorted({e["team_id"] for e in entries})
    seasons_represented = sorted({e["season_label"] for e in entries})

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "dataset_version": DATASET_VERSION,
        "status": (
            "experimental -- gated behind COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED. "
            "Broad coverage (Phase 6D): every team-season in "
            "cache/processed/regular_1980_2026.parquet with >= "
            f"{MEANINGFUL_CANDIDATES_FLOOR} real rostermates, computed (not hand-picked) -- "
            "supersedes the Warriors-only v0/v1 datasets, both deleted."
        ),
        "coverage_note": (
            f"{len(entries)} of {len(entries) + len(unsupported)} total team-seasons are rollable "
            f"({len(unsupported)} below the {MEANINGFUL_CANDIDATES_FLOOR}-candidate floor -- see "
            "unsupported_team_seasons). Every player_slug is a real, verified rostermate for that "
            "exact season (regular_1980_2026.parquet), never a decade-level or fabricated "
            "approximation."
        ),
        "generation_command": "python scripts/build_experimental_team_year_dataset.py",
        "meaningful_minutes_floor": MEANINGFUL_MINUTES_FLOOR,
        "meaningful_candidates_floor": MEANINGFUL_CANDIDATES_FLOOR,
        "supported_start_season": SUPPORTED_START_SEASON,
        "supported_end_season": SUPPORTED_END_SEASON,
        "season_2025_26_coverage_status": "covered" if has_2025_26 else "not_covered",
        "total_team_seasons": len(entries) + len(unsupported),
        "rollable_team_seasons": len(entries),
        "unsupported_team_season_count": len(unsupported),
        "franchise_count": len(franchises_represented),
        "franchise_ids_represented": franchises_represented,
        "season_count": len(seasons_represented),
        "seasons_represented": seasons_represented,
        "min_candidates_per_rollable_team_season": counts_sorted[0] if counts_sorted else 0,
        "max_candidates_per_rollable_team_season": counts_sorted[-1] if counts_sorted else 0,
        "median_candidates_per_rollable_team_season": float(median) if counts_sorted else 0.0,
        "unsupported_team_seasons": unsupported,
        "exact_team_year_spins": entries,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=False))

    out_size = OUT_PATH.stat().st_size
    print(f"Wrote {len(entries)} rollable team-year entries ({len(unsupported)} unsupported) -> {OUT_PATH.relative_to(REPO_ROOT)} ({out_size:,} bytes)")
    print(f"  Franchises represented: {len(franchises_represented)}")
    print(f"  Seasons represented: {len(seasons_represented)} ({seasons_represented[0]}..{seasons_represented[-1]})")
    print(f"  Candidates per rollable team-season: min={counts_sorted[0]} max={counts_sorted[-1]} median={median}")
    print(f"  2025-26 coverage: {'covered' if has_2025_26 else 'NOT covered'}")
    if unknown_teams:
        print(f"  WARNING: {len(unknown_teams)} team code(s) not in TEAM_ID_TO_NAME (used code as display name): {sorted(unknown_teams)}")
    if unsupported:
        print(f"  Unsupported team-seasons ({len(unsupported)}):")
        for u in unsupported:
            print(f"    {u['franchise_display_name']} {u['season_label']}: {u['candidate_count']} candidates")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
