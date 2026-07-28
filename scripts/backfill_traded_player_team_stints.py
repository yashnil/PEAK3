#!/usr/bin/env python3
"""Phase 7A Part A: backfill real per-team stint rows for traded players.

Root cause of the "DeMarcus Cousins missing from 2016-17 Kings" bug:
cache/processed/regular_1980_2026.parquet has exactly ONE row per
(player, season) -- for a player traded mid-season, that row is the
combined "2TM"/"3TM"/etc. aggregate, never the individual per-team splits.
scripts/build_experimental_team_year_dataset.py correctly excludes those
aggregate rows (a "2TM" row is not a real, rollable franchise), but the
side effect is that a traded player silently vanishes from BOTH real teams
he actually played for that season.

This script fixes the DATA gap, not the exclusion logic (which stays
correct): basketball-reference.com's leaguewide per-game table
(https://www.basketball-reference.com/leagues/NBA_{end_year}_per_game.html)
lists the individual team rows alongside the aggregate row for every
traded player -- one page fetch per SEASON (47 total, 1979-80..2025-26),
not one per player, so this is a bounded, one-time, offline backfill, not
a live-request scrape (CLAUDE.md's "never scrape during a web request"
rule is about the FastAPI backend at runtime; this mirrors the existing
peak3.py --rebuild-data offline pattern).

Output: data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json
-- ONLY the individual-team rows for players who have a multi-team
aggregate row in our existing regular_1980_2026.parquet. Never touches
cache/processed/*.parquet or the canonical scored dataset -- this is a
pure roster-membership supplement, read by
scripts/build_experimental_team_year_dataset.py to add traded players back
onto every real team-season they belong to. No PEAK3 score is computed or
altered here (CLAUDE.md: never calculate scores outside peak3.py).

Usage:
    python scripts/backfill_traded_player_team_stints.py --dry-run
    python scripts/backfill_traded_player_team_stints.py --write
    python scripts/backfill_traded_player_team_stints.py --write --seasons 2016-17,2022-23
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
HTML_CACHE_DIR = REPO_ROOT / "cache" / "html" / "nba_per_game"
OUT_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "traded_player_team_stints.v1.json"

DATASET_VERSION = "traded_player_team_stints.v1"
_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM"}
PER_GAME_URL_TMPL = "https://www.basketball-reference.com/leagues/NBA_{end_year}_per_game.html"
REQUEST_TIMEOUT_S = 20
FETCH_DELAY_S = 10.0
RATE_LIMIT_RETRY_DELAY_S = 45.0
MAX_RATE_LIMIT_RETRIES = 3


def _slug(name: str) -> str:
    # ASCII-fold first (matches CLAUDE.md's player-slug convention and the
    # local parquet data's own slugs) -- without this, "Bojan Bogdanović"
    # and "Jusuf Nurkić" fail to match their un-accented local slugs.
    folded = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")


def _season_end_year(season: str) -> int:
    """'1979-80' -> 1980, '1999-00' -> 2000, '2016-17' -> 2017."""
    start_str, end_str = season.split("-")
    start = int(start_str)
    end_suffix = int(end_str)
    century = (start // 100) * 100
    end = century + end_suffix
    if end <= start:
        end += 100
    return end


def _fetch_html(url: str, cache_path: Path) -> Optional[str]:
    if cache_path.exists():
        return cache_path.read_text()
    for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PEAK3-data-backfill-script/1.0"})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(html)
            return html
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < MAX_RATE_LIMIT_RETRIES:
                wait = RATE_LIMIT_RETRY_DELAY_S * (attempt + 1)
                print(f"  Rate limited (429) on {url} -- waiting {wait:.0f}s before retry {attempt + 1}/{MAX_RATE_LIMIT_RETRIES}")
                time.sleep(wait)
                continue
            print(f"  WARNING: fetch failed for {url}: {exc}")
            return None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            print(f"  WARNING: fetch failed for {url}: {exc}")
            return None
    return None


def _parse_per_game_table(html: str) -> Optional[pd.DataFrame]:
    # Pass via StringIO, not the raw string -- some pandas/lxml versions
    # try to treat a bare string argument as a filename/URL rather than
    # inline HTML content, which fails on a multi-megabyte page.
    import io
    try:
        tables = pd.read_html(io.StringIO(html), attrs={"id": "per_game_stats"})
    except (ValueError, ImportError) as exc:
        print(f"  WARNING: could not parse per_game_stats table: {exc}")
        return None
    if not tables:
        return None
    df = tables[0]
    # BR repeats the header row every ~20 rows for readability -- those
    # repeated rows have Player == "Player" and must be dropped.
    df = df[df["Player"] != "Player"].copy()
    return df


def backfill_season(season: str, multi_team_players: set[str]) -> list[dict]:
    """Returns real per-team stint rows for every player in
    `multi_team_players` (already-lowercased-slug set) who has an
    individual (non-aggregate) row in this season's leaguewide table."""
    end_year = _season_end_year(season)
    url = PER_GAME_URL_TMPL.format(end_year=end_year)
    cache_path = HTML_CACHE_DIR / f"NBA_{end_year}_per_game.html"
    html = _fetch_html(url, cache_path)
    if html is None:
        return []
    df = _parse_per_game_table(html)
    if df is None:
        return []

    df["player_slug"] = df["Player"].astype(str).map(_slug)
    individual = df[~df["Team"].isin(_MULTI_TEAM_CODES) & df["Team"].notna() & (df["Team"] != "TOT")]

    stints = []
    for _, r in individual.iterrows():
        slug = r["player_slug"]
        if slug not in multi_team_players:
            continue
        try:
            games = float(r["G"])
            mp_per_g = float(r["MP"])
        except (ValueError, TypeError):
            continue
        stints.append({
            "player_slug": slug,
            "player_name": str(r["Player"]),
            "season": season,
            "team_id": str(r["Team"]),
            "position": str(r["Pos"]) if pd.notna(r.get("Pos")) else None,
            "games": games,
            "minutes_total_estimate": round(mp_per_g * games, 1),
            "source_provenance": f"{url} (per_game_stats table, individual-team row, fetched live)",
        })
    return stints


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--seasons", type=str, default=None, help="Comma-separated season list to limit the run (e.g. 2016-17,2022-23)")
    args = parser.parse_args()
    if not args.dry_run and not args.write:
        parser.print_help()
        return 1

    if not REGULAR_PATH.exists():
        print(f"ERROR: {REGULAR_PATH} missing -- broken checkout.")
        return 1

    reg = pd.read_parquet(REGULAR_PATH)
    multi = reg[reg["team"].isin(_MULTI_TEAM_CODES)].dropna(subset=["player", "season"]).copy()
    multi["player_slug"] = multi["player"].map(_slug)

    seasons = sorted(multi["season"].unique())
    if args.seasons:
        wanted = {s.strip() for s in args.seasons.split(",")}
        seasons = [s for s in seasons if s in wanted]

    print(f"Backfilling {len(seasons)} season(s) with multi-team rows ...")
    all_stints: list[dict] = []
    unresolved_players: list[dict] = []
    for i, season in enumerate(seasons):
        season_players = set(multi[multi["season"] == season]["player_slug"])
        stints = backfill_season(season, season_players)
        found_slugs = {s["player_slug"] for s in stints}
        for slug in sorted(season_players - found_slugs):
            unresolved_players.append({
                "player_slug": slug, "season": season,
                "reason": "not_found_as_individual_team_row_in_br_per_game_table",
            })
        all_stints.extend(stints)
        print(f"  [{i + 1}/{len(seasons)}] {season}: {len(season_players)} traded player(s) in local data, "
              f"{len(found_slugs)} resolved with real per-team stints")
        if not (HTML_CACHE_DIR / f"NBA_{_season_end_year(season)}_per_game.html").exists():
            time.sleep(FETCH_DELAY_S)

    by_player_season: dict[str, list[dict]] = {}
    for s in all_stints:
        key = f"{s['player_slug']}|{s['season']}"
        by_player_season.setdefault(key, []).append(s)

    payload = {
        "dataset_version": DATASET_VERSION,
        "generation_command": "python scripts/backfill_traded_player_team_stints.py --write",
        "scope_note": (
            "Only covers players whose season row in cache/processed/regular_1980_2026.parquet "
            "is a multi-team aggregate (2TM/3TM/4TM/5TM) -- every stint here is a REAL "
            "individual-team row fetched live from basketball-reference.com's leaguewide "
            "per-game table, never fabricated or hand-typed. games/minutes_total_estimate "
            "computed from that page's per-game MP x G, an estimate (not the exact box-score "
            "total) but sourced from real per-game data, not invented."
        ),
        "total_stint_rows": len(all_stints),
        "total_player_seasons_covered": len(by_player_season),
        "unresolved_count": len(unresolved_players),
        "unresolved": unresolved_players,
        "stints_by_player_season": by_player_season,
    }

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Seasons processed:            {len(seasons)}")
    print(f"Real per-team stint rows:     {len(all_stints)}")
    print(f"Player-seasons covered:       {len(by_player_season)}")
    print(f"Unresolved (not found):       {len(unresolved_players)}")

    if args.write:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, indent=2))
        print(f"\nWrote {OUT_PATH.relative_to(REPO_ROOT)}")
    else:
        print("\n(--dry-run: no files written)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
