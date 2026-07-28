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


def clear_caches() -> None:
    """Used in tests."""
    global _PLAYER_CACHE, _TEAM_CACHE
    _PLAYER_CACHE = None
    _TEAM_CACHE = None


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
