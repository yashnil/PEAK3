#!/usr/bin/env python3
"""Phase 6E Part B: player/team asset manifest schema + fallback-safe seed data.

Builds data/game/assets/player_assets.v1.json and team_assets.v1.json.

Hard constraint (CLAUDE.md / every prior phase): no scraped logos,
headshots, or copyrighted image binaries anywhere in this repo. This script
adds NO image binaries and fabricates NO image URLs -- every entry's
image/logo URL fields are null with license_status="unavailable" and
cache_policy="fallback_only" unless a real, already-committed, non-image
data source justifies otherwise (team primary/secondary colors, which
apps/web/src/lib/team-colors.ts already documents as "real, public,
well-documented NBA team brand colors... deliberately NO logos/wordmarks").

This is a SCHEMA-and-fallback-readiness pass, not an image-sourcing pass:
the runtime (PlayerAvatar, team badges) already renders initials/color
fallbacks with no image at all, so nothing breaks if every entry here stays
image-less indefinitely. Populating real, licensed image_source_url values
later requires explicit license approval per CLAUDE.md's "never fabricate
... licenses" rule and is out of scope for this generator.

Usage:
    python scripts/build_asset_manifests.py
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

FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
OUT_DIR = REPO_ROOT / "data" / "game" / "assets"

PLAYER_ASSETS_VERSION = "player_assets.v1"
TEAM_ASSETS_VERSION = "team_assets.v1"

# Real, public NBA team brand colors -- kept in sync by hand with
# apps/web/src/lib/team-colors.ts (that file is the source of truth for
# rendering; this manifest mirrors the same real values for the small set
# of teams with a stable, still-in-use color identity). Historical/
# relocated franchises not in modern team-colors.ts get null colors here
# (honest "unavailable", not guessed).
TEAM_COLORS: dict[str, tuple[str, str]] = {
    "ATL": ("#E03A3E", "#C1D32F"), "BOS": ("#007A33", "#BA9653"), "BRK": ("#000000", "#FFFFFF"),
    "CHO": ("#1D1160", "#00788C"), "CHI": ("#CE1141", "#000000"), "CLE": ("#860038", "#FDBB30"),
    "DAL": ("#00538C", "#002B5E"), "DEN": ("#0E2240", "#FEC524"), "DET": ("#C8102E", "#1D42BA"),
    "GSW": ("#1D428A", "#FFC72C"), "HOU": ("#CE1141", "#000000"), "IND": ("#002D62", "#FDBB30"),
    "LAC": ("#C8102E", "#1D428A"), "LAL": ("#552583", "#FDB927"), "MEM": ("#5D76A9", "#12173F"),
    "MIA": ("#98002E", "#F9A01B"), "MIL": ("#00471B", "#EEE1C6"), "MIN": ("#0C2340", "#236192"),
    "NOP": ("#0C2340", "#C8102E"), "NYK": ("#006BB6", "#F58426"), "OKC": ("#007AC1", "#EF3B24"),
    "ORL": ("#0077C0", "#C4CED4"), "PHI": ("#006BB6", "#ED174C"), "PHO": ("#1D1160", "#E56020"),
    "POR": ("#E03A3E", "#000000"), "SAC": ("#5A2D81", "#63727A"), "SAS": ("#C4CED4", "#000000"),
    "TOR": ("#CE1141", "#000000"), "UTA": ("#002B5C", "#F9A01B"), "WAS": ("#002B5C", "#E31837"),
}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def build_team_assets() -> dict:
    teams = []
    for team_id, name in sorted(TEAM_ID_TO_NAME.items()):
        colors = TEAM_COLORS.get(team_id)
        teams.append({
            "team_id": team_id,
            "franchise_id": team_id,
            "team_name": name,
            "abbreviation": team_id,
            "logo_url": None,
            "image_provider": None,
            "image_source_url": None,
            "license_status": "unavailable",
            "cache_policy": "fallback_only",
            "primary_color": colors[0] if colors else None,
            "secondary_color": colors[1] if colors else None,
            "fallback_abbreviation_badge": team_id,
        })
    return {
        "asset_manifest_version": TEAM_ASSETS_VERSION,
        "generation_command": "python scripts/build_asset_manifests.py",
        "license_policy": (
            "No logo/wordmark image binaries or URLs are populated by this generator. "
            "primary_color/secondary_color are real, public NBA brand colors (kept in "
            "sync with apps/web/src/lib/team-colors.ts) -- colors are not copyrighted "
            "imagery. Populating logo_url requires a separately license-approved "
            "provider and explicit sign-off before this file is regenerated with real URLs."
        ),
        "team_count": len(teams),
        "teams": teams,
    }


def build_player_assets() -> dict:
    if not FINAL_250_PATH.exists():
        print(f"ERROR: {FINAL_250_PATH} missing -- broken checkout.")
        sys.exit(1)
    names = pd.read_csv(FINAL_250_PATH)["player"].astype(str).tolist()
    players = []
    for name in sorted(set(names)):
        slug = _slug(name)
        parts = name.split()
        initials = (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else name[:2].upper()
        players.append({
            "player_slug": slug,
            "player_name": name,
            "nba_player_id": None,
            "basketball_reference_id": None,
            "headshot_url": None,
            "image_provider": None,
            "image_source_url": None,
            "license_status": "unknown_do_not_cache",
            "cache_policy": "fallback_only",
            "fallback_initials": initials,
            "dominant_team_color": None,
        })
    return {
        "asset_manifest_version": PLAYER_ASSETS_VERSION,
        "generation_command": "python scripts/build_asset_manifests.py",
        "license_policy": (
            "No headshot image binaries or URLs are populated by this generator -- "
            "every entry is license_status='unknown_do_not_cache', cache_policy="
            "'fallback_only'. fallback_initials is computed from the already-committed "
            "canonical player name, not an image asset. Populating headshot_url requires "
            "a licensed provider and explicit approval before this file is regenerated "
            "with real URLs (CLAUDE.md: never commit scraped headshots)."
        ),
        "scope_note": (
            "Seeded from the 250-player canonical pool for this pass -- not yet extended "
            "to the full 1500-identity manifest. Extending coverage is a data task, not a "
            "schema change; the runtime fallback (initials/color) already works for any "
            "player_slug not present in this file at all."
        ),
        "player_count": len(players),
        "players": players,
    }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    team_payload = build_team_assets()
    player_payload = build_player_assets()

    (OUT_DIR / "team_assets.v1.json").write_text(json.dumps(team_payload, indent=2, sort_keys=False))
    (OUT_DIR / "player_assets.v1.json").write_text(json.dumps(player_payload, indent=2, sort_keys=False))

    print(f"Wrote team_assets.v1.json ({team_payload['team_count']} teams)")
    print(f"Wrote player_assets.v1.json ({player_payload['player_count']} players)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
