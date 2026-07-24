#!/usr/bin/env python3
"""Phase 6A Goal 5: experimental team+YEAR (exact season) roster dataset.

Builds real, non-fabricated exact-team-season roster entries -- the
replacement direction for CourtBuilder's team+decade spins (product decision:
"roll a random team AND a random exact season, not a decade"). Every
player_slug listed here is read directly from
cache/processed/regular_1980_2026.parquet's own team/season/mp columns for
that exact team-season -- no roster is hand-typed or guessed.

Deliberately narrow scope for this pass (Stage E, see
docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md): only the three
Golden State Warriors seasons audited this session
(scripts/audit_player_pool_expansion.py), where every rostermate has already
been verified to exist in local data. This is NOT the full team+year
coverage the eventual official mode needs -- see coverage_note below and
docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md's Phase 6A section for
the broader-coverage follow-up plan. The engine that consumes this dataset
(nba_peak.perfect_season.board.generate_team_year_board) is gated behind
COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED and never used for the
official/global CourtBuilder mode while coverage is this narrow.

A roster slot is included only if the player logged >=50 minutes for that
team in that season (regular_1980_2026.parquet's `mp` column) -- the same
"meaningful involvement, not a single cameo appearance" threshold already
used elsewhere in this codebase (nba_peak/context/title_role.py's
`po_mp >= 50` postseason-minutes floor), reused here for consistency rather
than inventing a new cutoff. Whether a listed player_slug actually resolves
to a playable candidate at a given board duration is decided later, at board
generation time, by intersecting with the real card pool (250-pool + the
Phase 6A experimental card extension) -- this dataset only records real roster
membership, never card availability.

Usage:
    python scripts/build_experimental_team_year_dataset.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent

REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"
EXPERIMENTAL_CARDS_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "card_profiles.experimental.json"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "courtbuilder_team_year.experimental.v0.json"

DATASET_VERSION = "courtbuilder_team_year.experimental.v0"

MEANINGFUL_MINUTES_FLOOR = 50.0

# (team abbreviation as used in regular_1980_2026.parquet, season, display
# name, display season label). Scope deliberately limited to the audited GSW
# rotation seasons for this pass -- see module docstring.
TEAM_YEAR_ENTRIES: list[tuple[str, str, str, str]] = [
    ("GSW", "2015-16", "Golden State Warriors", "2015-16"),
    ("GSW", "2016-17", "Golden State Warriors", "2016-17"),
    ("GSW", "2017-18", "Golden State Warriors", "2017-18"),
]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _resolvable_slugs() -> set[str]:
    """Union of player_slugs with a real, resolvable card at any duration --
    canonical 250-pool + the Phase 6A experimental extension. Used only to
    annotate coverage (`resolvable_count`), never to filter the real roster
    list itself (a real rostermate stays listed even with zero resolvable
    cards -- the board generator already silently drops unresolvable slugs,
    same discipline as the existing team-decade path)."""
    slugs: set[str] = set()
    if CARD_PROFILES_PATH.exists():
        with CARD_PROFILES_PATH.open() as f:
            for d in json.load(f):
                if d.get("profile_status") != "excluded":
                    slugs.add(d["player_slug"])
    if EXPERIMENTAL_CARDS_PATH.exists():
        with EXPERIMENTAL_CARDS_PATH.open() as f:
            for d in json.load(f)["cards"]:
                slugs.add(d["player_slug"])
    return slugs


def main() -> int:
    if not REGULAR_PATH.exists():
        print(f"ERROR: {REGULAR_PATH} missing -- broken checkout.")
        return 1

    regular = pd.read_parquet(REGULAR_PATH)
    resolvable = _resolvable_slugs()

    entries = []
    for team_abbr, season, franchise_display_name, season_label in TEAM_YEAR_ENTRIES:
        rows = regular[
            (regular["team"] == team_abbr)
            & (regular["season"] == season)
            & (regular["mp"] >= MEANINGFUL_MINUTES_FLOOR)
        ].sort_values("mp", ascending=False)

        roster_names = rows["player"].tolist()
        player_slugs = [_slug(n) for n in roster_names]
        resolvable_slugs = [s for s in player_slugs if s in resolvable]

        entries.append({
            "spin_id": f"{_slug(franchise_display_name)}-{season.replace('-', '')}",
            "franchise_display_name": franchise_display_name,
            "season_label": season_label,
            "player_slugs": player_slugs,
            "resolvable_player_slugs": resolvable_slugs,
            "resolvable_count": len(resolvable_slugs),
            "roster_size": len(player_slugs),
            "source_provenance": (
                f"cache/processed/regular_1980_2026.parquet: every {franchise_display_name} "
                f"player with team=='{team_abbr}', season=='{season}', mp>={MEANINGFUL_MINUTES_FLOOR:.0f} "
                f"({len(player_slugs)} players)."
            ),
        })

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "dataset_version": DATASET_VERSION,
        "status": (
            "experimental -- NOT canonical, gated behind "
            "COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED, never used for the "
            "official/global CourtBuilder mode. Direction: team+YEAR (exact "
            "season), replacing team+decade -- see Phase 6A goal 5."
        ),
        "coverage_note": (
            f"Deliberately narrow: only {len(TEAM_YEAR_ENTRIES)} exact team-seasons "
            "(the audited Golden State Warriors 2015-16/2016-17/2017-18 rotations). "
            "Every player_slug is a real, verified rostermate for that exact season "
            "(regular_1980_2026.parquet), never a decade-level approximation. Some "
            "rostermates have no resolvable card yet (see resolvable_count vs "
            "roster_size per entry) -- they are still listed for roster-accuracy "
            "transparency but will not appear as spin candidates until a card "
            "exists for them (silently dropped by the board generator, same "
            "discipline as the existing team-decade path)."
        ),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generation_command": "python scripts/build_experimental_team_year_dataset.py",
        "meaningful_minutes_floor": MEANINGFUL_MINUTES_FLOOR,
        "exact_team_year_spins": entries,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2))

    print(f"Wrote {len(entries)} team-year entries -> {OUT_PATH.relative_to(REPO_ROOT)}")
    for e in entries:
        print(
            f"  {e['franchise_display_name']} {e['season_label']}: "
            f"{e['roster_size']} real rostermates, {e['resolvable_count']} resolvable "
            f"({', '.join(e['player_slugs'])})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
