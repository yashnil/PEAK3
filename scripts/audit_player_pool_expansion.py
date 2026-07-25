#!/usr/bin/env python3
"""Phase 6A/6D: 1500-player identity expansion audit + manifest generator.

Read-only audit (Stage A) that also writes a candidate identity manifest
(Stage B) plus an all-seasons-for-qualifying-identities table (Stage C) to
an experimental, non-canonical path. This script NEVER touches
`leaderboards/*.csv`, `data/generated/final_250_candidates.csv`,
`data/game/profiles/card_profiles.v3.json`, or any other canonical file --
CLAUDE.md's "never change these without explicit approval and passing
regression evidence" rule applies to every one of those, and none of them
are approved for change by this task.

Sources (all already local, all already committed per
docs/implementation/CI_DATA_CONTRACT.md -- no network access, no scraping):
  cache/processed/scored_1980_2026.parquet    per-player-season scores + awards
  cache/processed/regular_1980_2026.parquet   raw per-season stats (real `pos`)

Inclusion criteria (docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md
Sec 2.0, restated 1:1 here as executable checks against real columns):
  1. Any All-Defensive team selection      -> all_defense_team notna
  2. Any MVP vote getter                   -> mvp_rank notna
  3. Any DPOY vote getter                  -> dpoy_rank notna
  4. Any All-Star                          -> all_star == 1
  5. All-Star runner-up / near-selection   -> NOT COMPUTABLE from local data;
                                               reported as an explicit
                                               unsupported-criteria warning,
                                               never silently skipped.
  6. Any 15+ PPG-equivalent season         -> KNOWN APPROXIMATION, see
                                               PPG_CAVEAT below -- no genuine
                                               per-game points column exists
                                               in any locally committed file
                                               (verified: only BR's per_poss.html
                                               / "per 100 possessions" table was
                                               ever scraped for pts/trb/ast --
                                               see peak3.py's BREF per_poss
                                               fetch calls; no totals.html or
                                               per_game.html points column
                                               exists locally). Approximated
                                               via `pts_per75` (per-75-
                                               possessions, an existing
                                               scored_1980_2026.parquet
                                               column, closer to a per-game
                                               feel than the raw per-100
                                               column the v0 manifest
                                               mistakenly used) against the
                                               same MIN_PPG threshold.
                                               Reported as an approximation
                                               everywhere, never presented as
                                               literal PPG.
  7. Any championship starter              -> championship == 1 AND GS-based
                                               "started" signal is NOT present
                                               in the per-game table at the
                                               season-aggregate grain used
                                               here; approximated via
                                               meaningful postseason minutes
                                               (po_mp >= 50, reusing
                                               nba_peak/context/title_role.py's
                                               own threshold) on a champion
                                               team -- reported as an
                                               approximation, not fabricated
                                               as literal "started" data.
  8. Any Finals starter                    -> finals_appearance == 1, same
                                               meaningful-minutes approximation
                                               as (7).
  9. Any 30+ MPG season                    -> scored_1980_2026.parquet `mpg` >= 30
                                               (real per-game minutes: mpg is
                                               computed from real total
                                               minutes/games, not a per-100
                                               proxy -- trustworthy as-is)
 10. Fallback: any 25+ MPG season          -> only applied if 1-9 produce
                                               fewer than TARGET_IDENTITIES

v1 manifest (Phase 6D) additions over v0:
  - PPG criterion fixed: v0 compared `regular_1980_2026.parquet`'s raw `pts`
    column (verified to be per-100-possessions, not per-game -- e.g. Stephen
    Curry's 2015-16 row shows pts=42.5, matching the per-100 conversion of
    his real 30.1 PPG, not 30.1 itself) directly against MIN_PPG=15.0. That
    silently over/under-qualified players depending on pace. v1 uses
    `pts_per75` instead (see PPG_CAVEAT) -- still an approximation, but a
    documented, less-wrong one, and now labeled as such everywhere it
    surfaces (manifest, review script, docs).
  - Full qualifying_seasons list (not a 5-item sample).
  - A companion all-seasons-for-qualifying-identities table (every locally
    available REGULAR-SEASON row for every qualifying identity, through
    2025-26 -- rookie/bench/decline/traded/low-minute seasons included, not
    just qualifying ones) written to a separate file
    (all_seasons_for_identities.v1.json).
  - criterion-by-season explanation embedded per identity (which seasons
    triggered which criteria).
  - Explicit unresolved-join warnings (slug collisions, 2TM/3TM aggregate
    rows that can't be resolved to one exact team).

Usage:
    python scripts/audit_player_pool_expansion.py [--write-manifest]

Exit code 0 always (diagnostic report), unless the required source parquet
files are missing, in which case it exits 1 with a clear message -- a
missing source file means a broken checkout, not something to silently
degrade around.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
EXPERIMENTAL_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"

TARGET_IDENTITIES = 1500
MIN_PPG = 15.0
MIN_MPG_PRIMARY = 30.0
MIN_MPG_FALLBACK = 25.0
MANIFEST_VERSION = "player_pool_1500_manifest.v1"
ALL_SEASONS_VERSION = "all_seasons_for_identities.v1"
SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"

PPG_CAVEAT = (
    "No genuine per-game points column exists in any locally committed source "
    "(only Basketball-Reference's per-100-possessions table was ever scraped "
    "for pts/trb/ast -- see peak3.py's BREF per_poss.html fetch calls; no "
    "totals.html/per_game.html points column exists locally). This criterion "
    "uses `pts_per75` (per-75-possessions, already computed in "
    "scored_1980_2026.parquet) as an approximation of scoring volume, "
    "compared against the same 15.0 threshold. It is NOT literal PPG -- "
    "treat 'qualifies via 15_ppg' as 'high per-possession scoring output', "
    "not a precise 15.0-points-per-game claim."
)

# The exact audit list from the Phase 6A task, in the order given.
WARRIORS_AUDIT_LIST = [
    "Andre Iguodala", "Jermaine O'Neal", "Jrue Holiday", "Andrew Bogut",
    "Draymond Green", "Shaun Livingston", "Harrison Barnes", "David West",
    "Kevon Looney", "Zaza Pachulia", "Festus Ezeli", "Leandro Barbosa",
    "Marreese Speights", "Matt Barnes", "Nick Young", "JaVale McGee",
]

GSW_AUDIT_SEASONS = ["2015-16", "2016-17", "2017-18"]

CRITERION_LABELS = {
    "all_defense": "All-Defensive team",
    "mvp_votes": "MVP vote getter",
    "dpoy_votes": "DPOY vote getter",
    "all_star": "All-Star",
    "15_ppg": "15+ PPG-equivalent season (pts_per75 proxy, see PPG_CAVEAT)",
    "championship_starter_approx": "Championship + meaningful minutes (approximation)",
    "finals_starter_approx": "Finals + meaningful minutes (approximation)",
    "30_mpg": "30+ MPG season",
    "25_mpg_fallback": "25+ MPG season (fallback tier)",
}


def _slug(name: str) -> str:
    """ASCII-folded, hyphenated slug -- mirrors nba_peak/candidates.py::_pid
    and the player_slug convention already used by card_profiles.v3.json."""
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _load_sources() -> tuple[pd.DataFrame, pd.DataFrame]:
    missing = [p for p in (SCORED_PATH, REGULAR_PATH) if not p.exists()]
    if missing:
        print("ERROR: required source file(s) missing -- broken checkout, not a data gap:")
        for p in missing:
            print(f"  {p}")
        sys.exit(1)
    scored = pd.read_parquet(SCORED_PATH)
    regular = pd.read_parquet(REGULAR_PATH)
    return scored, regular


def _load_current_pool() -> tuple[set[str], dict[str, str]]:
    """Returns (current 250-pool player names, {player_slug: profile_status})."""
    names: set[str] = set()
    if FINAL_250_PATH.exists():
        names = set(pd.read_csv(FINAL_250_PATH)["player"].astype(str))
    status_by_slug: dict[str, str] = {}
    if CARD_PROFILES_PATH.exists():
        with CARD_PROFILES_PATH.open() as f:
            cards = json.load(f)
        for c in cards:
            slug = c["player_slug"]
            status = c.get("profile_status", "unknown")
            if slug not in status_by_slug or status_by_slug[slug] == "excluded":
                status_by_slug[slug] = status
    return names, status_by_slug


def compute_criteria(scored: pd.DataFrame, regular: pd.DataFrame) -> pd.DataFrame:
    """One row per player identity, with a boolean column per inclusion
    criterion and the FULL qualifying season list (v1: no truncation)."""
    ppg = regular[["player", "season", "pts"]].rename(columns={"pts": "ppg_per100_DO_NOT_USE"})
    merged = scored.merge(ppg, on=["player", "season"], how="left")
    # v1 fix: pts_per75 (already in scored_1980_2026.parquet), not the raw
    # per-100-possessions `pts` column from `regular` -- see PPG_CAVEAT.
    merged["ppg_proxy"] = pd.to_numeric(merged.get("pts_per75"), errors="coerce")

    merged["po_mp"] = pd.to_numeric(merged.get("po_mp"), errors="coerce").fillna(0.0)
    merged["_meaningful_po"] = merged["po_mp"] >= 50

    rows = []
    for player, g in merged.groupby("player"):
        all_defense = bool(g["all_defense_team"].notna().any())
        mvp_votes = bool(g["mvp_rank"].notna().any())
        dpoy_votes = bool(g["dpoy_rank"].notna().any())
        all_star = bool((g["all_star"] == 1).any())
        ppg_15 = bool((g["ppg_proxy"] >= MIN_PPG).any())
        champ_starter = bool(((g["championship"] == 1) & g["_meaningful_po"]).any())
        finals_starter = bool(((g["finals_appearance"] == 1) & g["_meaningful_po"]).any())
        mpg_30 = bool((g["mpg"] >= MIN_MPG_PRIMARY).any())
        mpg_25 = bool((g["mpg"] >= MIN_MPG_FALLBACK).any())

        qual_mask = (
            (g["all_defense_team"].notna()) | (g["mvp_rank"].notna()) |
            (g["dpoy_rank"].notna()) | (g["all_star"] == 1) |
            (g["ppg_proxy"] >= MIN_PPG) |
            ((g["championship"] == 1) & g["_meaningful_po"]) |
            ((g["finals_appearance"] == 1) & g["_meaningful_po"]) |
            (g["mpg"] >= MIN_MPG_PRIMARY)
        )
        # criterion-by-season: which specific criteria each qualifying season triggered.
        season_criteria: dict[str, list[str]] = {}
        for _, r in g[qual_mask].iterrows():
            hit = []
            if pd.notna(r["all_defense_team"]):
                hit.append("all_defense")
            if pd.notna(r["mvp_rank"]):
                hit.append("mvp_votes")
            if pd.notna(r["dpoy_rank"]):
                hit.append("dpoy_votes")
            if r["all_star"] == 1:
                hit.append("all_star")
            if r["ppg_proxy"] >= MIN_PPG:
                hit.append("15_ppg")
            if r["championship"] == 1 and r["_meaningful_po"]:
                hit.append("championship_starter_approx")
            if r["finals_appearance"] == 1 and r["_meaningful_po"]:
                hit.append("finals_starter_approx")
            if r["mpg"] >= MIN_MPG_PRIMARY:
                hit.append("30_mpg")
            season_criteria[str(r["season"])] = hit

        rows.append({
            "player": player,
            "player_slug": _slug(player),
            "career_start": int(g["season_end"].min()),
            "career_end": int(g["season_end"].max()),
            "n_seasons_local": len(g),
            "crit_all_defense": all_defense,
            "crit_mvp_votes": mvp_votes,
            "crit_dpoy_votes": dpoy_votes,
            "crit_all_star": all_star,
            "crit_all_star_runner_up": None,  # unsupported, see docstring
            "crit_15_ppg": ppg_15,
            "crit_championship_starter_approx": champ_starter,
            "crit_finals_starter_approx": finals_starter,
            "crit_30_mpg": mpg_30,
            "crit_25_mpg_fallback": mpg_25,
            "qualifies_primary": any([
                all_defense, mvp_votes, dpoy_votes, all_star, ppg_15,
                champ_starter, finals_starter, mpg_30,
            ]),
            "qualifying_seasons_full": sorted(season_criteria.keys()),
            "season_criteria": season_criteria,
        })
    return pd.DataFrame(rows)


def _print_header(title: str) -> None:
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def audit_warriors_players(scored: pd.DataFrame, regular: pd.DataFrame, criteria: pd.DataFrame,
                            current_pool_names: set[str], status_by_slug: dict[str, str]) -> None:
    _print_header("Warriors 2010s rotation player audit (named list)")
    for name in WARRIORS_AUDIT_LIST:
        rows = scored[scored["player"] == name]
        slug = _slug(name)
        exists_local = len(rows) > 0
        in_final_250_csv = name in current_pool_names
        in_card_profiles = slug in status_by_slug
        status = status_by_slug.get(slug, "NOT IN card_profiles.v3.json")
        gsw_rows = rows[rows["team"] == "GSW"] if exists_local else rows
        gsw_seasons = sorted(gsw_rows["season"].unique().tolist()) if len(gsw_rows) else []
        crit_row = criteria[criteria["player"] == name]
        qualifying = crit_row.iloc[0]["qualifying_seasons_full"] if len(crit_row) else []
        met = [
            c.replace("crit_", "") for c in [
                "crit_all_defense", "crit_mvp_votes", "crit_dpoy_votes", "crit_all_star",
                "crit_15_ppg", "crit_championship_starter_approx", "crit_finals_starter_approx",
                "crit_30_mpg",
            ] if len(crit_row) and bool(crit_row.iloc[0][c])
        ]

        print(f"\n{name}  (slug={slug})")
        print(f"  exists in local raw data (scored_1980_2026.parquet)?    {'YES' if exists_local else 'NO'} ({len(rows)} seasons)")
        print(f"  in final_250_candidates.csv (pre-card-build selection)? {'YES' if in_final_250_csv else 'NO'}")
        print(f"  has an entry in generated card_profiles.v3.json?        {'YES' if in_card_profiles else 'NO'}")
        print(f"  profile_status (if present):                            {status}")
        print(f"  qualifying criteria met:                                {met or 'none of the primary criteria'}")
        print(f"  seasons available (qualifying):                         {qualifying}")
        print(f"  GSW team-year memberships found locally:                {gsw_seasons or 'none'}")


def audit_gsw_team_year_rosters(scored: pd.DataFrame) -> None:
    _print_header("Warriors 2015-16 / 2016-17 / 2017-18 real team-year rosters (local data)")
    for season in GSW_AUDIT_SEASONS:
        roster = scored[(scored["team"] == "GSW") & (scored["season"] == season)].sort_values("mpg", ascending=False)
        print(f"\nGSW {season}: {len(roster)} players found locally")
        for _, r in roster.iterrows():
            tags = []
            if r.get("all_star") == 1:
                tags.append("All-Star")
            if r.get("championship") == 1:
                tags.append("champion")
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            print(f"    {r['player']:22s} mpg={r['mpg']:.1f}{tag_str}")


def _build_all_seasons_table(final_pool: pd.DataFrame, regular: pd.DataFrame, scored: pd.DataFrame) -> tuple[list[dict], list[str]]:
    """Every locally-available REGULAR-SEASON row (rookie/bench/decline/
    traded/low-minute seasons included) for every qualifying identity,
    through 2025-26. Multi-team (2TM/3TM) aggregate rows are included but
    flagged -- they cannot be resolved to one exact team-season (see
    nba_peak/perfect_season/exact_season.py's own documented limitation)."""
    multi_team_codes = {"2TM", "3TM", "4TM", "5TM"}
    qualifying_slugs = set(final_pool["player_slug"])
    reg = regular.copy()
    reg["player_slug"] = reg["player"].map(_slug)
    reg = reg[reg["player_slug"].isin(qualifying_slugs)]

    scored_keys = set(zip(scored["player"], scored["team"], scored["season"]))

    warnings: list[str] = []
    dupe_check = reg.groupby("player_slug")["player"].nunique()
    collisions = dupe_check[dupe_check > 1]
    if len(collisions):
        for slug in collisions.index:
            names = sorted(reg.loc[reg["player_slug"] == slug, "player"].unique().tolist())
            warnings.append(f"slug collision: '{slug}' maps to multiple raw names {names} -- rows merged under one slug.")

    multi_team_rows = reg[reg["team"].isin(multi_team_codes)]
    if len(multi_team_rows):
        warnings.append(
            f"{len(multi_team_rows)} multi-team aggregate rows (2TM/3TM) included for traded-season "
            "players -- no per-team split exists locally, so these rows carry team='2TM'/'3TM' "
            "rather than a single exact team (see exact_season.py's documented limitation)."
        )

    rows = []
    for _, r in reg.sort_values(["player_slug", "season_end"]).iterrows():
        key = (r["player"], r["team"], r["season"])
        rows.append({
            "player_slug": r["player_slug"],
            "player": r["player"],
            "season": r["season"],
            "team": r["team"],
            "season_end": int(r["season_end"]),
            "games_played": float(r["g"]) if pd.notna(r["g"]) else None,
            "position": r["pos"] if pd.notna(r.get("pos")) else None,
            "is_multi_team_row": bool(r["team"] in multi_team_codes),
            "score_status": "exact_season_scored" if key in scored_keys else "exact_season_unscored",
        })
    return rows, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-manifest", action="store_true",
                         help="Write the v1 candidate identity manifest + all-seasons table to the experimental path.")
    args = parser.parse_args()

    scored, regular = _load_sources()
    current_pool_names, status_by_slug = _load_current_pool()
    criteria = compute_criteria(scored, regular)

    _print_header("Current state")
    print(f"Current PEAK3 player identity count (raw, all seasons 1980-2026): {scored['player'].nunique()}")
    print(f"Current PEAK3 player-season count (raw):                          {len(scored)}")
    print(f"Current CourtBuilder 250-pool identity count:                     {len(current_pool_names)}")
    print(f"Supported season range:                                           {SUPPORTED_START_SEASON} .. {SUPPORTED_END_SEASON}")
    print(f"2025-26 rows present in scored data:                              {(scored['season']=='2025-26').sum()}")
    print(f"2025-26 rows present in raw data:                                 {(regular['season']=='2025-26').sum()}")

    _print_header("PPG criterion caveat (read before trusting 15_ppg)")
    print(PPG_CAVEAT)

    _print_header("Candidate counts by criterion (players qualifying via EACH criterion, independently)")
    for col, label in [
        ("crit_all_defense", "All-Defensive team"),
        ("crit_mvp_votes", "MVP vote getter"),
        ("crit_dpoy_votes", "DPOY vote getter"),
        ("crit_all_star", "All-Star"),
        ("crit_15_ppg", "15+ PPG-equivalent (pts_per75 proxy)"),
        ("crit_championship_starter_approx", "Championship + meaningful minutes (approximation)"),
        ("crit_finals_starter_approx", "Finals + meaningful minutes (approximation)"),
        ("crit_30_mpg", "30+ MPG season"),
        ("crit_25_mpg_fallback", "25+ MPG season (fallback tier)"),
    ]:
        n = int(criteria[col].sum())
        print(f"  {label:65s} {n:5d}")
    print(f"  {'All-Star runner-up / near-selection':65s} {'UNSUPPORTED -- no local source (see docstring)'}")

    dupe_slugs = criteria.groupby("player_slug").filter(lambda g: len(g) > 1)
    _print_header("Duplicate identity check")
    if len(dupe_slugs):
        print(f"WARNING: {dupe_slugs['player_slug'].nunique()} slug collisions found:")
        for slug, g in dupe_slugs.groupby("player_slug"):
            print(f"  {slug}: {g['player'].tolist()}")
    else:
        print("No duplicate identities (by slug) found across all local players.")

    primary_qualified = criteria[criteria["qualifies_primary"]].copy()
    _print_header("Primary-criteria expansion result")
    print(f"Identities qualifying via primary criteria (1-9, excluding fallback): {len(primary_qualified)}")
    reaches_target = len(primary_qualified) >= TARGET_IDENTITIES
    print(f"Reaches {TARGET_IDENTITIES}-identity target without fallback?          {'YES' if reaches_target else 'NO'}")

    final_pool = primary_qualified
    n_fallback_added = 0
    if not reaches_target:
        fallback_candidates = criteria[~criteria["qualifies_primary"] & criteria["crit_25_mpg_fallback"]].copy()
        needed = TARGET_IDENTITIES - len(primary_qualified)
        fallback_candidates = fallback_candidates.sort_values(
            ["n_seasons_local", "player"], ascending=[False, True]
        )
        added = fallback_candidates.head(needed)
        n_fallback_added = len(added)
        final_pool = pd.concat([primary_qualified, added], ignore_index=True)
        print(f"25+ MPG fallback identities needed to reach target:                   {needed}")
        print(f"25+ MPG fallback identities actually available:                       {len(fallback_candidates)}")
        print(f"25+ MPG fallback identities added:                                    {n_fallback_added}")

    _print_header("Final candidate identity count")
    print(f"Final candidate identity count: {len(final_pool)}")
    print(f"  (of which {len(primary_qualified)} via primary criteria, {n_fallback_added} via 25+ MPG fallback)")

    est_seasons = int(criteria.loc[criteria["player"].isin(final_pool["player"]), "n_seasons_local"].sum()) \
        if len(final_pool) else 0
    _print_header("Player-season row count if every season is included")
    print(f"Player-season rows (every locally-available REGULAR season for every qualifying identity): {est_seasons}")

    audit_warriors_players(scored, regular, criteria, current_pool_names, status_by_slug)
    audit_gsw_team_year_rosters(scored)

    _print_header("Missing-source / unsupported-criteria warnings")
    print("- All-Star runner-up / near-selection: no local source table exists for this signal.")
    print("- Championship/Finals 'starter' status is approximated via meaningful postseason minutes "
          "(po_mp >= 50), not a literal box-score starter flag.")
    print(f"- 15+ PPG: {PPG_CAVEAT}")

    if args.write_manifest:
        EXPERIMENTAL_DIR.mkdir(parents=True, exist_ok=True)
        manifest_path = EXPERIMENTAL_DIR / "candidate_identity_manifest.v1.json"
        identities_sorted = final_pool.sort_values("player")
        manifest = {
            "manifest_version": MANIFEST_VERSION,
            "generation_command": "python scripts/audit_player_pool_expansion.py --write-manifest",
            "source_provenance": {
                "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
                "regular": str(REGULAR_PATH.relative_to(REPO_ROOT)),
            },
            "supported_start_season": SUPPORTED_START_SEASON,
            "supported_end_season": SUPPORTED_END_SEASON,
            "criteria_definitions": CRITERION_LABELS,
            "ppg_caveat": PPG_CAVEAT,
            "target_identities": TARGET_IDENTITIES,
            "final_identity_count": len(final_pool),
            "primary_criteria_count": len(primary_qualified),
            "fallback_25mpg_count": n_fallback_added,
            "status": "candidate_manifest_v1 -- identity list + criteria are real and generated "
                      "from committed local data; NOT yet wired into CourtBuilder gameplay, NOT a "
                      "canonical data replacement. See docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md.",
            "identities": [
                {
                    "player": r["player"],
                    "player_slug": r["player_slug"],
                    "career_start": r["career_start"],
                    "career_end": r["career_end"],
                    "n_seasons_local": r["n_seasons_local"],
                    "already_in_250_pool": r["player"] in current_pool_names,
                    "qualifying_criteria": [
                        c.replace("crit_", "") for c in [
                            "crit_all_defense", "crit_mvp_votes", "crit_dpoy_votes",
                            "crit_all_star", "crit_15_ppg", "crit_championship_starter_approx",
                            "crit_finals_starter_approx", "crit_30_mpg", "crit_25_mpg_fallback",
                        ] if r[c]
                    ],
                    "qualifying_seasons": r["qualifying_seasons_full"],
                    "season_criteria": r["season_criteria"],
                }
                for _, r in identities_sorted.iterrows()
            ],
        }
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=False))
        manifest_size = manifest_path.stat().st_size
        print(f"\nManifest written: {manifest_path.relative_to(REPO_ROOT)} ({len(final_pool)} identities, {manifest_size:,} bytes)")

        all_seasons_rows, join_warnings = _build_all_seasons_table(final_pool, regular, scored)
        all_seasons_path = EXPERIMENTAL_DIR / "all_seasons_for_identities.v1.json"
        all_seasons_payload = {
            "dataset_version": ALL_SEASONS_VERSION,
            "generation_command": "python scripts/audit_player_pool_expansion.py --write-manifest",
            "source_provenance": {
                "regular": str(REGULAR_PATH.relative_to(REPO_ROOT)),
                "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            },
            "supported_start_season": SUPPORTED_START_SEASON,
            "supported_end_season": SUPPORTED_END_SEASON,
            "identity_count": len(final_pool),
            "row_count": len(all_seasons_rows),
            "warnings": join_warnings,
            "rows": all_seasons_rows,
        }
        all_seasons_path.write_text(json.dumps(all_seasons_payload, indent=2, sort_keys=False))
        all_seasons_size = all_seasons_path.stat().st_size
        print(f"All-seasons table written: {all_seasons_path.relative_to(REPO_ROOT)} ({len(all_seasons_rows):,} rows, {all_seasons_size:,} bytes)")
        if join_warnings:
            print("All-seasons table warnings:")
            for w in join_warnings:
                print(f"  - {w}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
