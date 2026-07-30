"""Phase 6F Part C: read-only lookup over the ESPN-backed asset manifests.

Pure data access -- no network calls, no FastAPI dependency (callers in
apps/api decide whether/when to expose a URL based on
Settings.ENABLE_EXTERNAL_ASSET_URLS; this module just answers "what URL, if
any, do we have for this player/team" from the committed manifest files).

Returns None whenever an entry is missing, unresolved, or the manifest
files themselves aren't present -- never fabricates a URL.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
ASSETS_DIR = REPO_ROOT / "data" / "game" / "assets"
PLAYER_ASSETS_PATH = ASSETS_DIR / "player_assets.v3.json"  # Phase 7A Part B: v2 -> v3 (NBA_CDN provider added)
TEAM_ASSETS_PATH = ASSETS_DIR / "team_assets.v2.json"

_PLAYER_CACHE: Optional[dict[str, dict]] = None
_TEAM_CACHE: Optional[dict[str, dict]] = None
_TEAM_BY_NAME_CACHE: Optional[dict[str, dict]] = None


def _load_player_assets() -> dict[str, dict]:
    global _PLAYER_CACHE
    if _PLAYER_CACHE is None:
        if PLAYER_ASSETS_PATH.exists():
            data = json.loads(PLAYER_ASSETS_PATH.read_text())
            _PLAYER_CACHE = {p["player_slug"]: p for p in data.get("players", [])}
        else:
            _PLAYER_CACHE = {}
    return _PLAYER_CACHE


def _load_team_assets() -> dict[str, dict]:
    global _TEAM_CACHE
    if _TEAM_CACHE is None:
        if TEAM_ASSETS_PATH.exists():
            data = json.loads(TEAM_ASSETS_PATH.read_text())
            _TEAM_CACHE = {t["team_id"]: t for t in data.get("teams", [])}
        else:
            _TEAM_CACHE = {}
    return _TEAM_CACHE


def _load_team_assets_by_name() -> dict[str, dict]:
    """team_name -> team asset entry. Phase 8F: the DEFAULT CourtBuilder
    engine (nba_peak.perfect_season.board.generate_board -- what actually
    runs unless COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=true) never
    captures a team_id on its SpinPrompts at all (the interim dataset,
    data/game/interim/courtbuilder_team_seasons.v3.json, only carries
    franchise_display_name, e.g. "Chicago Bulls" -- no abbreviation). Rather
    than thread a new team_id field through SpinPrompt/board.py/state.py
    just for this, this name-keyed index lets get_team_logo_url_by_name
    resolve a logo straight from the same real, already-verified
    team_assets.v2.json entries used elsewhere -- no new data, no
    fabrication, just a second lookup key into the existing manifest."""
    global _TEAM_BY_NAME_CACHE
    if _TEAM_BY_NAME_CACHE is None:
        _TEAM_BY_NAME_CACHE = {t["team_name"]: t for t in _load_team_assets().values() if t.get("team_name")}
    return _TEAM_BY_NAME_CACHE


def clear_caches() -> None:
    """Used in tests."""
    global _PLAYER_CACHE, _TEAM_CACHE, _TEAM_BY_NAME_CACHE
    _PLAYER_CACHE = None
    _TEAM_CACHE = None
    _TEAM_BY_NAME_CACHE = None


def get_player_headshot_url(player_slug: str) -> Optional[str]:
    entry = _load_player_assets().get(player_slug)
    if not entry or entry.get("resolution_status") != "resolved":
        return None
    return entry.get("headshot_url")


def get_team_logo_url(team_id: str) -> Optional[str]:
    entry = _load_team_assets().get(team_id)
    if not entry or entry.get("resolution_status") != "resolved":
        return None
    return entry.get("logo_url")


def get_team_logo_url_by_name(franchise_display_name: Optional[str]) -> Optional[str]:
    """Same contract as get_team_logo_url, keyed by the real franchise
    display name (e.g. "Chicago Bulls") instead of a team_id -- see
    _load_team_assets_by_name's docstring for why this exists."""
    if not franchise_display_name:
        return None
    entry = _load_team_assets_by_name().get(franchise_display_name)
    if not entry or entry.get("resolution_status") != "resolved":
        return None
    return entry.get("logo_url")
