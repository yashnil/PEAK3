#!/usr/bin/env python3
"""Phase 7A Part G: developer inspection CLI for "why isn't X here?" questions.

Shows exactly what PEAK Season's team-year engine knows about one exact
team-season (candidates, score status/source, identity-pool membership,
raw/scored row provenance, warnings) -- and, with --player, a focused
report on one player's resolution for that team-season, including the
Phase 7A Part A traded-player-stint fallback path.

Usage:
    python scripts/inspect_team_season.py --team "Sacramento Kings" --season "2016-17"
    python scripts/inspect_team_season.py --team SAC --season 2016-17 --player "DeMarcus Cousins"
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import pandas as pd  # noqa: E402

from nba_peak.perfect_season.exact_season import (  # noqa: E402
    TEAM_ID_TO_NAME,
    _load_1500_pool_slugs,
    _load_canonical_250_slugs,
    _load_traded_stints,
    resolve_player_season_card,
)

_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM", "TOT"}


def _slug(name: str) -> str:
    folded = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")


def resolve_team_id(raw: str) -> str | None:
    if raw.upper() in TEAM_ID_TO_NAME:
        return raw.upper()
    key = raw.lower().replace(" ", "")
    for team_id, name in TEAM_ID_TO_NAME.items():
        if name.lower().replace(" ", "") == key:
            return team_id
    return None


def inspect_team_season(team_id: str, season: str) -> None:
    franchise_name = TEAM_ID_TO_NAME.get(team_id, team_id)
    print("=" * 72)
    print(f"{franchise_name} ({team_id}) -- {season}")
    print("=" * 72)

    regular = pd.read_parquet(REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet")
    regular["player_slug"] = regular["player"].map(_slug)
    direct_rows = regular[
        (regular["team"] == team_id) & (regular["season"] == season) & (~regular["team"].isin(_MULTI_TEAM_CODES))
    ]

    traded_stints = _load_traded_stints()
    traded_rows = [
        (slug, team, sea, s) for (slug, team, sea), s in traded_stints.items()
        if team == team_id and sea == season
    ]

    canon = _load_canonical_250_slugs()
    pool1500 = _load_1500_pool_slugs()

    all_slugs = sorted(set(direct_rows["player_slug"]) | {r[0] for r in traded_rows})
    if not all_slugs:
        print("No candidates found for this team-season (no direct rows, no traded-stint rows).")
        return

    print(f"\n{len(all_slugs)} candidate(s):\n")
    for slug in all_slugs:
        card = resolve_player_season_card(slug, team_id, season)
        if card is None:
            print(f"  {slug:28s}  UNRESOLVED (in roster list but resolve_player_season_card returned None -- bug)")
            continue
        pool_status = "canonical_250" if slug in canon else ("qualifies_1500" if slug in pool1500 else "team_year_roster_only")
        print(
            f"  {card.player_name:28s} pos={card.position or '?':4s} "
            f"score_status={card.score_status:24s} score_source={card.score_source:24s} "
            f"pool={pool_status}"
            + (f" score={card.season_score:.1f}" if card.season_score is not None else "")
        )

    warnings = []
    if len(all_slugs) < 8:
        warnings.append(f"Only {len(all_slugs)} candidates -- below the 8-candidate rollability floor, not spinnable.")
    if warnings:
        print("\nWarnings:")
        for w in warnings:
            print(f"  - {w}")


def inspect_player(team_id: str, season: str, player_name: str) -> None:
    slug = _slug(player_name)
    franchise_name = TEAM_ID_TO_NAME.get(team_id, team_id)
    print("=" * 72)
    print(f"{player_name} ({slug}) -- {franchise_name} ({team_id}) {season}")
    print("=" * 72)

    regular = pd.read_parquet(REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet")
    regular["player_slug"] = regular["player"].map(_slug)
    raw_rows = regular[(regular["player_slug"] == slug) & (regular["season"] == season)]
    print(f"\nRaw regular_1980_2026.parquet rows for {season}: {len(raw_rows)}")
    for _, r in raw_rows.iterrows():
        print(f"  team={r['team']:5s} g={r['g']:.0f} mp={r['mp']:.0f} pos={r.get('pos', '?')}")

    scored_raw = pd.read_parquet(REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet")
    scored_raw["player_slug"] = scored_raw["player"].map(_slug)
    scored_rows = scored_raw[(scored_raw["player_slug"] == slug) & (scored_raw["season"] == season)]
    print(f"\nRaw scored_1980_2026.parquet rows for {season}: {len(scored_rows)}")
    for _, r in scored_rows.iterrows():
        print(f"  team={r['team']:5s} prime_score={r['prime_score']:.2f}")

    stints = _load_traded_stints()
    stint = stints.get((slug, team_id, season))
    print(f"\nTraded-stint entry for ({team_id}, {season}): {stint if stint else 'none'}")

    canon = _load_canonical_250_slugs()
    pool1500 = _load_1500_pool_slugs()
    print(f"\nIdentity pool membership:")
    print(f"  canonical_250: {slug in canon}")
    print(f"  qualifies_1500: {slug in pool1500}")

    card = resolve_player_season_card(slug, team_id, season)
    print(f"\nresolve_player_season_card({slug!r}, {team_id!r}, {season!r}):")
    if card is None:
        print("  -> None (NOT a real candidate for this exact team-season)")
        warnings = []
        if not raw_rows.empty and team_id not in set(raw_rows["team"]):
            other_teams = sorted(set(raw_rows["team"]) - _MULTI_TEAM_CODES)
            warnings.append(f"Player has a row this season, but for team(s) {other_teams or ['(multi-team aggregate only)']}, not {team_id}.")
        if stint is None and not raw_rows.empty:
            warnings.append(
                "No traded-player-stint entry found either -- if this player really did play for "
                f"{team_id} in {season}, run scripts/backfill_traded_player_team_stints.py --seasons {season}."
            )
        for w in warnings:
            print(f"  Warning: {w}")
    else:
        print(f"  exact_player_season_key = {card.exact_player_season_key}")
        print(f"  score_status  = {card.score_status}")
        print(f"  score_source  = {card.score_source}")
        print(f"  season_score  = {card.season_score}")
        print(f"  games_played  = {card.games_played}")
        print(f"  position      = {card.position}")
        print(f"  source_provenance = {card.source_provenance}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--team", required=True, help="Team abbreviation (SAC) or display name (\"Sacramento Kings\")")
    parser.add_argument("--season", required=True, help="e.g. 2016-17")
    parser.add_argument("--player", default=None, help="Optional: focus on one player, e.g. \"DeMarcus Cousins\"")
    args = parser.parse_args()

    team_id = resolve_team_id(args.team)
    if team_id is None:
        print(f"ERROR: unknown team '{args.team}'. Use a Basketball-Reference abbreviation or exact display name.")
        return 1

    if args.player:
        inspect_player(team_id, args.season, args.player)
    else:
        inspect_team_season(team_id, args.season)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
