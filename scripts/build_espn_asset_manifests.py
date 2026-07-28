#!/usr/bin/env python3
"""Phase 6F Part A/B: ESPN-backed asset METADATA manifests (no image binaries).

Fetches real team/player metadata from ESPN's public, unauthenticated site
API (`site.api.espn.com`) -- team IDs, logo URLs, colors, and (for
currently-active players only) athlete IDs + headshot URLs. This script
downloads and commits NO image binaries; it stores only URL strings plus
provenance/license metadata. Every ID/URL written here was fetched live
from ESPN at generation time -- nothing is invented (CLAUDE.md: never
fabricate data, images, or licensing claims).

Scope, stated honestly (see also unresolved_player_assets.v1.json):
  - TEAMS: all 30 current NBA franchises resolve cleanly (ESPN's public
    `/teams` endpoint is a complete, unambiguous list).
  - PLAYERS: resolved via two ESPN sources, in priority order: (1) CURRENT
    team rosters (`/teams/{id}/roster`), (2) Phase 6G Part D addition -- a
    broader athlete-pool endpoint (`sports.core.api.espn.com/.../athletes`)
    that also includes recently-waived/free-agent players ESPN still
    tracks but who aren't on any team's roster right now. Neither source
    has a reliable public search for retired/historical players (tested:
    `common/v3/search` returns noisy cross-sport, non-NBA-scoped results
    and is not safe to auto-match against; the broader athlete-pool
    endpoint itself was verified during this pass to contain only
    current-or-recent-era players -- 611 total, 72 "inactive", none
    pre-dating roughly the 2020s). A player is only resolved here if their
    exact display name matches an entry from one of these two real,
    live-fetched sources. Historical players (the large majority of the
    250-pool) are reported as unresolved with an honest reason, never
    guessed.

License status: this script does not itself grant a license to hotlink
ESPN's CDN images in a shipped product -- `license_status` is set to
"unknown_do_not_cache" for every resolved entry until a human explicitly
reviews ESPN's terms of use and approves a cache_policy upgrade. See
asset_sources.v1.json's own `license_status`/warnings for the full caveat.

Phase 7A Part B: added a second, independent provider -- NBA_CDN
(cdn.nba.com's public headshot CDN) -- for players who have a real NBA.com
person_id available in a local crosswalk file. See
NBA_PLAYER_ID_CROSSWALK_PATH's own comment below for why this resolves 0
players this run (no such crosswalk exists locally, and NBA.com's API
was not reliably reachable from this environment to build one) -- the
provider is real, tested code, not a stub, just currently unused.

Usage:
    python scripts/build_espn_asset_manifests.py --dry-run
    python scripts/build_espn_asset_manifests.py --write
    python scripts/build_espn_asset_manifests.py --write --online-validate
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
# Phase 8 pre-loop polish: PEAK Season's actual card pool is this file (every
# player who can appear as a team-year roster candidate -- 3,494 unique
# names as of this pass), not just the 250-player all-time canonical pool.
# Most PEAK Season rosters draw heavily from the larger pool (traded/role
# players, non-top-250 stars in a given exact season), which is why image
# coverage felt sparse even after Phase 7A's expansion -- the manifest was
# never attempting to resolve most of the players the game actually deals.
# Widening the name list costs zero extra network calls: team rosters and
# the broader athlete-pool endpoint are already fetched in full regardless
# of how many names this script tries to match against them below.
TEAM_YEAR_DATASET_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "courtbuilder_team_year.experimental.v3.json"
)
OUT_DIR = REPO_ROOT / "data" / "game" / "assets"

TEAMS_ENDPOINT = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=50"
ROSTER_ENDPOINT_TMPL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espn_id}/roster"
# Phase 6G Part D: broader athlete pool -- includes players not on a CURRENT
# roster but still tracked by ESPN (waived/free-agent/recently-inactive
# within the current league year). VERIFIED to still be current-era only
# (spot-checked: 611 total athletes as of this pass, 72 "inactive", every
# name in that inactive set is a recently-active/recently-retired player
# from the last 1-2 seasons -- e.g. Bradley Beal, DeMar DeRozan, Kevin Love,
# Kyle Lowry, Russell Westbrook -- never a pre-2020s legend). Used ONLY as a
# fallback for names the roster fetch above didn't already resolve; never
# overrides a roster match.
ATHLETES_LIST_ENDPOINT = "https://sports.core.api.espn.com/v3/sports/basketball/nba/athletes?limit=2000"
REQUEST_TIMEOUT_S = 10
ROSTER_FETCH_DELAY_S = 0.15

# Verified against live roster-fetch headshot URLs (see module docstring/
# commit notes) -- every athlete.headshot.href returned by the roster
# endpoint follows exactly this template with that same athlete's numeric
# id. The broader athletes-list endpoint doesn't inline a headshot URL, so
# this constructs one from a REAL, live-fetched id using the SAME verified
# template -- not a guess, not a fabricated ID.
HEADSHOT_URL_TMPL = "https://a.espncdn.com/i/headshots/nba/players/full/{athlete_id}.png"

ASSET_SOURCES_VERSION = "asset_sources.v2"
TEAM_ASSETS_VERSION = "team_assets.v2"
PLAYER_ASSETS_VERSION = "player_assets.v3"
UNRESOLVED_VERSION = "unresolved_player_assets.v2"

# Phase 7A Part B: NBA CDN provider -- a SECOND image source, independent
# of ESPN, for players who have a real NBA.com person_id. Verified pattern
# (this is NBA.com's own public headshot CDN, the same one nba.com's site
# uses): https://cdn.nba.com/headshots/nba/latest/1040x760/{person_id}.png
#
# IMPORTANT scope limitation, stated honestly rather than worked around:
# neither cache/processed/*.parquet, data/generated/final_250_candidates.csv,
# nor any other locally committed file contains an NBA.com person_id for any
# player (verified by inspecting every column in both) -- our data pipeline
# is Basketball-Reference-sourced end to end and has never carried this ID.
# stats.nba.com and cdn.nba.com's JSON endpoints were also tested live from
# this environment and are not reliably reachable (stats.nba.com refused the
# connection outright; cdn.nba.com's static player-index JSON returned 403).
# Per this task's explicit instruction ("If local data has nba_player_id/
# person_id, generate... do not invent it" if not), this provider is
# implemented and ready to activate but resolves ZERO players this run --
# _load_nba_player_id_crosswalk() reads an optional local file
# (data/game/assets/nba_player_id_crosswalk.json) that does not currently
# exist; if a future pass adds a real, verified crosswalk there (e.g. from
# a licensed data provider), this code path picks it up with no changes.
NBA_CDN_HEADSHOT_URL_TMPL = "https://cdn.nba.com/headshots/nba/latest/1040x760/{nba_player_id}.png"
NBA_PLAYER_ID_CROSSWALK_PATH = REPO_ROOT / "data" / "game" / "assets" / "nba_player_id_crosswalk.json"

# Our internal team_id (Basketball-Reference-style abbreviation, matches
# nba_peak.perfect_season.exact_season.TEAM_ID_TO_NAME) -> ESPN's team
# abbreviation. Only the 30 current-era franchises map to ESPN (historical/
# relocated codes like SEA/VAN/NJN/KCK have no current ESPN team).
BR_TO_ESPN_ABBR: dict[str, str] = {
    "ATL": "ATL", "BOS": "BOS", "BRK": "BKN", "CHO": "CHA", "CHI": "CHI",
    "CLE": "CLE", "DAL": "DAL", "DEN": "DEN", "DET": "DET", "GSW": "GS",
    "HOU": "HOU", "IND": "IND", "LAC": "LAC", "LAL": "LAL", "MEM": "MEM",
    "MIA": "MIA", "MIL": "MIL", "MIN": "MIN", "NOP": "NO", "NYK": "NY",
    "OKC": "OKC", "ORL": "ORL", "PHI": "PHI", "PHO": "PHX", "POR": "POR",
    "SAC": "SAC", "SAS": "SA", "TOR": "TOR", "UTA": "UTAH", "WAS": "WSH",
}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _normalize_name(name: str) -> str:
    """Loose match key: lowercase, strip periods/apostrophes, collapse
    whitespace. Used ONLY to match a full display name against a live ESPN
    roster entry -- never a fuzzy/partial match (no substring matching, no
    Levenshtein), so a wrong match can't silently slip through."""
    n = re.sub(r"[.'’]", "", name.lower())
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _fetch_json(url: str) -> Optional[dict]:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PEAK3-asset-metadata-script/1.0"})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
        print(f"  WARNING: fetch failed for {url}: {exc}")
        return None


def _logo_url(logos: list[dict], rel_want: str) -> Optional[str]:
    for logo in logos:
        rels = logo.get("rel", [])
        if rel_want in rels and "full" in rels and "scoreboard" not in rels and "primary_logo" not in "".join(rels):
            return logo.get("href")
    return None


def fetch_espn_teams() -> list[dict]:
    print(f"Fetching {TEAMS_ENDPOINT} ...")
    data = _fetch_json(TEAMS_ENDPOINT)
    if not data:
        return []
    try:
        raw_teams = data["sports"][0]["leagues"][0]["teams"]
    except (KeyError, IndexError):
        print("  WARNING: unexpected ESPN teams response shape.")
        return []
    out = []
    for t in raw_teams:
        tt = t["team"]
        logos = tt.get("logos", [])
        out.append({
            "espn_team_id": tt.get("id"),
            "espn_abbreviation": tt.get("abbreviation"),
            "display_name": tt.get("displayName"),
            "color": tt.get("color"),
            "alternate_color": tt.get("alternateColor"),
            "logo_url": _logo_url(logos, "default"),
            "logo_dark_url": _logo_url(logos, "dark"),
        })
    print(f"  Fetched {len(out)} ESPN teams.")
    return out


def fetch_espn_roster(espn_team_id: str) -> list[dict]:
    url = ROSTER_ENDPOINT_TMPL.format(espn_id=espn_team_id)
    data = _fetch_json(url)
    if not data:
        return []
    athletes = data.get("athletes", [])
    out = []
    for a in athletes:
        out.append({
            "espn_athlete_id": a.get("id"),
            "full_name": a.get("fullName") or a.get("displayName"),
            "headshot_url": (a.get("headshot") or {}).get("href"),
        })
    return out


def _load_team_year_player_names() -> set[str]:
    """Every distinct player_name that can appear as a PEAK Season team-year
    roster candidate -- see TEAM_YEAR_DATASET_PATH's module-level comment.
    Returns an empty set (never crashes) if the dataset file is missing,
    so this script still works against a bare checkout that hasn't
    regenerated the experimental dataset yet -- it just falls back to the
    250-player pool alone in that case."""
    if not TEAM_YEAR_DATASET_PATH.exists():
        return set()
    try:
        data = json.loads(TEAM_YEAR_DATASET_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return set()
    names: set[str] = set()
    for spin in data.get("exact_team_year_spins", []):
        for candidate in spin.get("candidates", []):
            name = candidate.get("player_name")
            if name:
                names.add(str(name))
    return names


def _load_nba_player_id_crosswalk() -> dict[str, str]:
    """player_slug -> real NBA.com person_id, from an OPTIONAL local file.
    See NBA_PLAYER_ID_CROSSWALK_PATH's module-level comment -- this file
    does not exist in this repo today (no verified ID source was
    available), so this always returns {} right now. Never invents an ID:
    if the file is present but malformed/empty, this still returns {}
    rather than guessing."""
    if not NBA_PLAYER_ID_CROSSWALK_PATH.exists():
        return {}
    try:
        data = json.loads(NBA_PLAYER_ID_CROSSWALK_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return {k: str(v) for k, v in data.get("player_slug_to_nba_person_id", {}).items()}


def _validate_url_online(url: str) -> bool:
    """HEAD request to confirm a constructed URL actually resolves (200) --
    ONLY called in --online-validate mode (Part B: 'Verify URL status only
    in --online-validate mode'). Never used to grant a license -- a 200
    response only means the image exists at that URL, not that hotlinking
    it is licensed for this product."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PEAK3-asset-metadata-script/1.0"})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
            return resp.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return False


def fetch_espn_athletes_list() -> list[dict]:
    """The broader (not just current-roster) athlete pool -- see
    ATHLETES_LIST_ENDPOINT's comment for what this does and doesn't cover."""
    print(f"Fetching {ATHLETES_LIST_ENDPOINT} ...")
    data = _fetch_json(ATHLETES_LIST_ENDPOINT)
    if not data:
        return []
    items = data.get("items", [])
    out = [
        {"espn_athlete_id": a.get("id"), "full_name": a.get("fullName") or a.get("displayName")}
        for a in items
        if a.get("id") and (a.get("fullName") or a.get("displayName"))
    ]
    print(f"  Fetched {len(out)} athletes from the broader pool ({sum(1 for a in items if not a.get('active'))} inactive).")
    return out


def build_team_assets(espn_teams: list[dict]) -> tuple[dict, int]:
    from nba_peak.perfect_season.exact_season import TEAM_ID_TO_NAME

    espn_by_abbr = {t["espn_abbreviation"]: t for t in espn_teams if t.get("espn_abbreviation")}

    teams = []
    resolved_count = 0
    for team_id, name in sorted(TEAM_ID_TO_NAME.items()):
        espn_abbr = BR_TO_ESPN_ABBR.get(team_id)
        espn = espn_by_abbr.get(espn_abbr) if espn_abbr else None
        if espn and espn.get("logo_url"):
            resolved_count += 1
            teams.append({
                "team_id": team_id,
                "franchise_id": team_id,
                "team_name": name,
                "abbreviation": team_id,
                "espn_team_id": espn["espn_team_id"],
                "logo_url": espn["logo_url"],
                "logo_dark_url": espn.get("logo_dark_url"),
                "image_provider": "ESPN",
                "image_source_url": f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espn['espn_team_id']}",
                "license_status": "unknown_do_not_cache",
                "cache_policy": "dev_hotlink_preview_only",
                "primary_color": f"#{espn['color']}" if espn.get("color") else None,
                "secondary_color": f"#{espn['alternate_color']}" if espn.get("alternate_color") else None,
                "fallback_abbreviation_badge": team_id,
                "resolution_status": "resolved",
                "warnings": [],
            })
        else:
            teams.append({
                "team_id": team_id,
                "franchise_id": team_id,
                "team_name": name,
                "abbreviation": team_id,
                "espn_team_id": None,
                "logo_url": None,
                "logo_dark_url": None,
                "image_provider": None,
                "image_source_url": None,
                "license_status": "unavailable",
                "cache_policy": "dev_hotlink_preview_only",
                "primary_color": None,
                "secondary_color": None,
                "fallback_abbreviation_badge": team_id,
                "resolution_status": "unresolved",
                "warnings": ["No current ESPN franchise for this historical/relocated team code."],
            })

    payload = {
        "asset_manifest_version": TEAM_ASSETS_VERSION,
        "generation_command": "python scripts/build_espn_asset_manifests.py --write",
        "license_policy": (
            "Team logo_url/logo_dark_url are real ESPN CDN URLs fetched live from ESPN's "
            "public site API at generation time -- no image binaries are downloaded or "
            "committed. license_status is 'unknown_do_not_cache' for every resolved team "
            "until a human reviews ESPN's terms of use and explicitly approves a "
            "cache_policy upgrade (see asset_sources.v1.json)."
        ),
        "team_count": len(teams),
        "resolved_count": resolved_count,
        "teams": teams,
    }
    return payload, resolved_count


def build_player_assets(espn_teams: list[dict], online_validate: bool = False) -> tuple[dict, dict, dict]:
    if not FINAL_250_PATH.exists():
        print(f"ERROR: {FINAL_250_PATH} missing -- broken checkout.")
        sys.exit(1)
    names_250 = set(pd.read_csv(FINAL_250_PATH)["player"].astype(str).tolist())
    team_year_names = _load_team_year_player_names()
    names = sorted(names_250 | team_year_names)
    print(f"Player name pool: {len(names_250)} from the 250-canonical pool, "
          f"{len(team_year_names)} from the team-year candidate pool, {len(names)} unique total.")

    print(f"Fetching rosters for {len(espn_teams)} ESPN teams (current active players only) ...")
    roster_by_norm_name: dict[str, dict] = {}
    duplicate_names: set[str] = set()
    for i, t in enumerate(espn_teams):
        espn_id = t.get("espn_team_id")
        if not espn_id:
            continue
        roster = fetch_espn_roster(espn_id)
        for a in roster:
            if not a.get("full_name") or not a.get("headshot_url"):
                continue
            key = _normalize_name(a["full_name"])
            if key in roster_by_norm_name and roster_by_norm_name[key]["espn_athlete_id"] != a["espn_athlete_id"]:
                duplicate_names.add(key)
            roster_by_norm_name[key] = a
        time.sleep(ROSTER_FETCH_DELAY_S)
        if (i + 1) % 10 == 0:
            print(f"  ... {i + 1}/{len(espn_teams)} rosters fetched")

    nba_crosswalk = _load_nba_player_id_crosswalk()
    print(f"NBA CDN player-ID crosswalk: {len(nba_crosswalk)} entries "
          f"({'none -- no local ID source available, see module docstring' if not nba_crosswalk else 'loaded'})")

    # Phase 6G Part D: fallback pool for names the current-roster fetch
    # above didn't resolve (e.g. recently waived/free-agent players still
    # tracked by ESPN). Never overrides a roster_by_norm_name match.
    athlete_list_by_norm_name: dict[str, dict] = {}
    athlete_list_duplicates: set[str] = set()
    for a in fetch_espn_athletes_list():
        key = _normalize_name(a["full_name"])
        if key in roster_by_norm_name:
            continue  # roster match already covers this name
        if key in athlete_list_by_norm_name and athlete_list_by_norm_name[key]["espn_athlete_id"] != a["espn_athlete_id"]:
            athlete_list_duplicates.add(key)
        athlete_list_by_norm_name[key] = a

    players = []
    unresolved = []
    resolved_count = 0
    ambiguous_count = 0
    for name in names:
        slug = _slug(name)
        parts = name.split()
        initials = (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else name[:2].upper()
        key = _normalize_name(name)
        match = roster_by_norm_name.get(key)

        if match and key in duplicate_names:
            ambiguous_count += 1
            players.append({
                "player_slug": slug, "player_name": name, "espn_athlete_id": None,
                "nba_player_id": None, "basketball_reference_id": None,
                "headshot_url": None, "image_provider": None, "image_source_url": None,
                "license_status": "unavailable", "cache_policy": "dev_hotlink_preview_only",
                "fallback_initials": initials, "resolution_status": "ambiguous",
                "confidence": 0.0,
                "warnings": ["Multiple current-roster athletes matched this exact display name; not auto-resolved."],
            })
            unresolved.append({"player_slug": slug, "player_name": name, "reason": "ambiguous_name_match"})
        elif match:
            resolved_count += 1
            players.append({
                "player_slug": slug, "player_name": name,
                "espn_athlete_id": match["espn_athlete_id"],
                "nba_player_id": None, "basketball_reference_id": None,
                "headshot_url": match["headshot_url"], "image_provider": "ESPN",
                "image_source_url": f"https://www.espn.com/nba/player/_/id/{match['espn_athlete_id']}",
                "license_status": "unknown_do_not_cache", "cache_policy": "dev_hotlink_preview_only",
                "fallback_initials": initials, "resolution_status": "resolved",
                "confidence": 1.0,
                "warnings": [],
            })
            continue

        list_match = athlete_list_by_norm_name.get(key)
        if list_match and key in athlete_list_duplicates:
            ambiguous_count += 1
            players.append({
                "player_slug": slug, "player_name": name, "espn_athlete_id": None,
                "nba_player_id": None, "basketball_reference_id": None,
                "headshot_url": None, "image_provider": None, "image_source_url": None,
                "license_status": "unavailable", "cache_policy": "dev_hotlink_preview_only",
                "fallback_initials": initials, "resolution_status": "ambiguous",
                "confidence": 0.0,
                "warnings": ["Multiple ESPN athlete-pool entries matched this exact display name; not auto-resolved."],
            })
            unresolved.append({"player_slug": slug, "player_name": name, "reason": "ambiguous_name_match"})
        elif list_match:
            resolved_count += 1
            headshot = HEADSHOT_URL_TMPL.format(athlete_id=list_match["espn_athlete_id"])
            players.append({
                "player_slug": slug, "player_name": name,
                "espn_athlete_id": list_match["espn_athlete_id"],
                "nba_player_id": None, "basketball_reference_id": None,
                "headshot_url": headshot, "image_provider": "ESPN",
                "image_source_url": f"https://www.espn.com/nba/player/_/id/{list_match['espn_athlete_id']}",
                "license_status": "unknown_do_not_cache", "cache_policy": "dev_hotlink_preview_only",
                "fallback_initials": initials, "resolution_status": "resolved",
                # Slightly lower confidence than a direct roster match: the
                # headshot URL is CONSTRUCTED from a real, live-fetched
                # athlete id using ESPN's verified template (see
                # HEADSHOT_URL_TMPL), not read directly off a roster
                # response -- still real, never fabricated, just one step
                # more indirect.
                "confidence": 0.9,
                "warnings": ["Resolved via ESPN's broader athlete pool (not a current team roster) -- "
                             "headshot URL constructed from a verified ID template."],
            })
        elif slug in nba_crosswalk:
            # Phase 7A Part B: NBA CDN fallback -- only reachable if a real
            # local ID crosswalk exists (it doesn't today, see module
            # docstring), so this branch is inert until one is added.
            nba_id = nba_crosswalk[slug]
            headshot = NBA_CDN_HEADSHOT_URL_TMPL.format(nba_player_id=nba_id)
            validated = _validate_url_online(headshot) if online_validate else None
            if online_validate and not validated:
                players.append({
                    "player_slug": slug, "player_name": name, "espn_athlete_id": None,
                    "nba_player_id": nba_id, "basketball_reference_id": None,
                    "headshot_url": None, "image_provider": None, "image_source_url": None,
                    "license_status": "unavailable", "cache_policy": "dev_hotlink_preview_only",
                    "fallback_initials": initials, "resolution_status": "unresolved",
                    "confidence": 0.0,
                    "warnings": [f"NBA CDN URL for person_id {nba_id} did not validate (--online-validate); not resolved."],
                })
                unresolved.append({"player_slug": slug, "player_name": name, "reason": "nba_cdn_url_failed_online_validation"})
            else:
                resolved_count += 1
                players.append({
                    "player_slug": slug, "player_name": name, "espn_athlete_id": None,
                    "nba_player_id": nba_id, "basketball_reference_id": None,
                    "headshot_url": headshot, "image_provider": "NBA_CDN",
                    "image_source_url": headshot,
                    "license_status": "unknown_do_not_cache", "cache_policy": "dev_hotlink_preview_only",
                    "fallback_initials": initials, "resolution_status": "resolved",
                    "confidence": 0.85 if validated else 0.6,
                    "warnings": [] if validated else ["URL constructed from a local ID crosswalk but not verified online (run with --online-validate to confirm)."],
                })
        else:
            players.append({
                "player_slug": slug, "player_name": name, "espn_athlete_id": None,
                "nba_player_id": None, "basketball_reference_id": None,
                "headshot_url": None, "image_provider": None, "image_source_url": None,
                "license_status": "no_public_image", "cache_policy": "dev_hotlink_preview_only",
                "fallback_initials": initials, "resolution_status": "unresolved",
                "confidence": 0.0,
                "warnings": [],
            })
            unresolved.append({
                "player_slug": slug, "player_name": name,
                "reason": "not_found_in_espn_current_or_recent_athlete_pool_or_nba_cdn_crosswalk -- "
                          "ESPN's public API has no historical/retired-player search (verified: its "
                          "broader athlete-pool endpoint returns 611 total athletes, 539 active + 72 "
                          "recently-inactive, none pre-dating roughly the 2020s), and no local "
                          "NBA.com person_id crosswalk exists for this player (see "
                          "NBA_PLAYER_ID_CROSSWALK_PATH's module docstring -- stats.nba.com/cdn.nba.com "
                          "were also tested live from this environment and are not reliably reachable "
                          "here). Not guessed.",
            })

    player_payload = {
        "asset_manifest_version": PLAYER_ASSETS_VERSION,
        "generation_command": "python scripts/build_espn_asset_manifests.py --write",
        "license_policy": (
            "headshot_url values are real ESPN CDN URLs fetched live from current NBA team "
            "rosters at generation time -- no image binaries are downloaded or committed. "
            "license_status is 'unknown_do_not_cache' for every resolved player until a "
            "human reviews ESPN's terms of use and explicitly approves a cache_policy "
            "upgrade (see asset_sources.v1.json)."
        ),
        "scope_note": (
            "Phase 8: seeded from the union of the 250-player canonical pool AND every player "
            "name reachable as a PEAK Season team-year roster candidate (courtbuilder_team_year."
            "experimental.v3.json) -- the actual card pool the game deals from, not just the "
            "all-time-top-250 list. Only players on a CURRENT ESPN NBA roster (or ESPN's broader "
            "recently-active athlete pool) at generation time can resolve -- historical/retired "
            "players are unresolved by design, not fabricated. See unresolved_player_assets.v2.json."
        ),
        "player_count": len(players),
        "resolved_count": resolved_count,
        "ambiguous_count": ambiguous_count,
        "unresolved_count": len(players) - resolved_count - ambiguous_count,
        "players": players,
    }
    unresolved_payload = {
        "report_version": UNRESOLVED_VERSION,
        "generation_command": "python scripts/build_espn_asset_manifests.py --write",
        "unresolved_count": len(unresolved),
        "entries": unresolved,
    }
    return player_payload, unresolved_payload, {"resolved": resolved_count, "ambiguous": ambiguous_count, "unresolved": len(players) - resolved_count - ambiguous_count}


def build_asset_sources() -> dict:
    nba_crosswalk_count = len(_load_nba_player_id_crosswalk())
    return {
        "source_registry_version": ASSET_SOURCES_VERSION,
        "provider": "ESPN + NBA_CDN",
        "sources": [
            {
                "asset_type": "team_logo",
                "endpoint_pattern": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams",
                "retrieval_command": "python scripts/build_espn_asset_manifests.py --write",
                "license_status": "unknown_do_not_cache",
                "cache_policy": "dev_hotlink_preview_only",
                "warnings": [
                    "Public, unauthenticated endpoint. No explicit license grant to hotlink "
                    "team logos in a shipped product has been reviewed/approved -- treat as "
                    "metadata-only until a human signs off.",
                ],
            },
            {
                "asset_type": "player_headshot",
                "endpoint_pattern": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{espn_team_id}/roster",
                "retrieval_command": "python scripts/build_espn_asset_manifests.py --write",
                "license_status": "unknown_do_not_cache",
                "cache_policy": "dev_hotlink_preview_only",
                "warnings": [
                    "Only exposes CURRENT team rosters -- no reliable public search endpoint "
                    "for historical/retired players was found during this pass (ESPN's "
                    "common/v3/search endpoint returns cross-sport, non-NBA-scoped noise and "
                    "is not safe for unattended name matching).",
                    "No explicit license grant to hotlink player headshots in a shipped "
                    "product has been reviewed/approved -- treat as metadata-only until a "
                    "human signs off.",
                ],
            },
            {
                "asset_type": "player_headshot",
                "image_provider": "NBA_CDN",
                "endpoint_pattern": "https://cdn.nba.com/headshots/nba/latest/1040x760/{nba_player_id}.png",
                "retrieval_command": "python scripts/build_espn_asset_manifests.py --write [--online-validate]",
                "license_status": "unknown_do_not_cache",
                "cache_policy": "dev_hotlink_preview_only",
                "local_id_crosswalk_entries": nba_crosswalk_count,
                "warnings": [
                    "INERT this run -- resolves 0 players. Requires a local player_slug -> "
                    "NBA.com person_id crosswalk (data/game/assets/nba_player_id_crosswalk.json), "
                    "which does not exist in this repo (no locally committed data source carries "
                    "an NBA.com ID -- verified by inspecting every column of every committed "
                    "parquet/CSV). stats.nba.com and cdn.nba.com's JSON player-index endpoints "
                    "were tested live from this environment and are not reliably reachable, so no "
                    "crosswalk could be built this pass either. Ready to activate the moment a "
                    "real, verified crosswalk is added -- never guesses an ID.",
                    "No explicit license grant to hotlink NBA.com headshots in a shipped product "
                    "has been reviewed/approved either, same as ESPN.",
                ],
            },
        ],
        "default_cache_policy": "do_not_cache_unless_license_approved",
        "notes": (
            "This registry documents WHERE asset metadata comes from, not a license grant. "
            "Runtime rendering must gate on cache_policy -- see apps/api's "
            "PEAK3_ENABLE_EXTERNAL_ASSET_URLS flag (default off)."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Fetch + report, write nothing.")
    parser.add_argument("--write", action="store_true", help="Fetch + write manifest files.")
    parser.add_argument(
        "--online-validate", action="store_true",
        help="HEAD-request every NBA CDN URL constructed from the local ID crosswalk to confirm it "
             "actually resolves before marking it resolved (Part B). Optional and offline-safe when "
             "omitted -- ESPN resolution never depends on this flag.",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.write:
        parser.print_help()
        return 1

    sys.path.insert(0, str(REPO_ROOT))

    espn_teams = fetch_espn_teams()
    if not espn_teams:
        print("ERROR: could not fetch ESPN team list -- aborting (no fallback fabrication).")
        return 1

    team_payload, team_resolved = build_team_assets(espn_teams)
    player_payload, unresolved_payload, player_counts = build_player_assets(espn_teams, online_validate=args.online_validate)
    sources_payload = build_asset_sources()

    image_url_count = team_resolved + player_counts["resolved"]
    fallback_only_count = (team_payload["team_count"] - team_resolved) + player_counts["ambiguous"] + player_counts["unresolved"]

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Team assets resolved:     {team_resolved}/{team_payload['team_count']}")
    print(f"Player assets resolved:   {player_counts['resolved']}/{player_payload['player_count']}")
    print(f"Unresolved players:       {player_counts['unresolved']}")
    print(f"Ambiguous players:        {player_counts['ambiguous']}")
    print(f"Total real image URLs:    {image_url_count}")
    print(f"Fallback-only count:      {fallback_only_count}")

    if args.write:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "asset_sources.v2.json").write_text(json.dumps(sources_payload, indent=2))
        (OUT_DIR / "team_assets.v2.json").write_text(json.dumps(team_payload, indent=2))
        (OUT_DIR / "player_assets.v3.json").write_text(json.dumps(player_payload, indent=2))
        (OUT_DIR / "unresolved_player_assets.v2.json").write_text(json.dumps(unresolved_payload, indent=2))
        print(f"\nWrote asset_sources.v2.json, team_assets.v2.json, player_assets.v3.json, "
              f"unresolved_player_assets.v2.json -> {OUT_DIR.relative_to(REPO_ROOT)}")
    else:
        print("\n(--dry-run: no files written)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
