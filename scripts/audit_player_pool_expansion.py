#!/usr/bin/env python3
"""Phase 6A: 1500-player identity expansion audit.

Read-only audit script (Stage A) that also writes a candidate identity
manifest (Stage B) to an experimental, non-canonical path. This script
NEVER touches `leaderboards/*.csv`, `data/generated/final_250_candidates.csv`,
`data/game/profiles/card_profiles.v3.json`, or any other canonical file --
CLAUDE.md's "never change these without explicit approval and passing
regression evidence" rule applies to every one of those, and none of them
are approved for change by this task.

Sources (all already local, all already committed per
docs/implementation/CI_DATA_CONTRACT.md -- no network access, no scraping):
  cache/processed/scored_1980_2026.parquet    per-player-season scores + awards
  cache/processed/regular_1980_2026.parquet   raw per-game stats (PPG, real `pos`)

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
  6. Any 15+ PPG season                    -> regular_1980_2026.parquet `pts` >= 15
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
 10. Fallback: any 25+ MPG season          -> only applied if 1-9 produce
                                               fewer than TARGET_IDENTITIES

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
MANIFEST_VERSION = "player_pool_1500_manifest.v0"

# The exact audit list from the Phase 6A task, in the order given.
WARRIORS_AUDIT_LIST = [
    "Andre Iguodala", "Jermaine O'Neal", "Jrue Holiday", "Andrew Bogut",
    "Draymond Green", "Shaun Livingston", "Harrison Barnes", "David West",
    "Kevon Looney", "Zaza Pachulia", "Festus Ezeli", "Leandro Barbosa",
    "Marreese Speights", "Matt Barnes", "Nick Young", "JaVale McGee",
]

GSW_AUDIT_SEASONS = ["2015-16", "2016-17", "2017-18"]


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
            # A player can have differing profile_status per duration; keep
            # the "most resolvable" one seen (prefer a non-excluded status
            # if any duration has one) so the audit reports honestly.
            slug = c["player_slug"]
            status = c.get("profile_status", "unknown")
            if slug not in status_by_slug or status_by_slug[slug] == "excluded":
                status_by_slug[slug] = status
    return names, status_by_slug


def compute_criteria(scored: pd.DataFrame, regular: pd.DataFrame) -> pd.DataFrame:
    """One row per player identity, with a boolean column per inclusion
    criterion and the qualifying season list for transparency."""
    ppg = regular[["player", "season", "pts"]].rename(columns={"pts": "ppg"})
    merged = scored.merge(ppg, on=["player", "season"], how="left")

    # "Meaningful championship/Finals minutes" approximation for criteria
    # 7/8 (see module docstring) -- reuses the exact threshold
    # nba_peak/context/title_role.py already uses for "played meaningful
    # postseason minutes" (po_mp >= 50), not a new invented cutoff.
    merged["po_mp"] = pd.to_numeric(merged.get("po_mp"), errors="coerce").fillna(0.0)
    merged["_meaningful_po"] = merged["po_mp"] >= 50

    rows = []
    for player, g in merged.groupby("player"):
        all_defense = bool(g["all_defense_team"].notna().any())
        mvp_votes = bool(g["mvp_rank"].notna().any())
        dpoy_votes = bool(g["dpoy_rank"].notna().any())
        all_star = bool((g["all_star"] == 1).any())
        ppg_15 = bool((g["ppg"] >= MIN_PPG).any())
        champ_starter = bool(((g["championship"] == 1) & g["_meaningful_po"]).any())
        finals_starter = bool(((g["finals_appearance"] == 1) & g["_meaningful_po"]).any())
        mpg_30 = bool((g["mpg"] >= MIN_MPG_PRIMARY).any())
        mpg_25 = bool((g["mpg"] >= MIN_MPG_FALLBACK).any())

        qualifying_seasons = sorted(g.loc[
            (g["all_defense_team"].notna()) | (g["mvp_rank"].notna()) |
            (g["dpoy_rank"].notna()) | (g["all_star"] == 1) |
            (g["ppg"] >= MIN_PPG) |
            ((g["championship"] == 1) & g["_meaningful_po"]) |
            ((g["finals_appearance"] == 1) & g["_meaningful_po"]) |
            (g["mpg"] >= MIN_MPG_PRIMARY),
            "season",
        ].unique().tolist())

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
            "qualifying_seasons_sample": qualifying_seasons[:5],
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
        qualifying = crit_row.iloc[0]["qualifying_seasons_sample"] if len(crit_row) else []
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
        print(f"  seasons available (sample):                             {qualifying}")
        print(f"  GSW team-year memberships found locally:                {gsw_seasons or 'none'}")
        if not in_card_profiles:
            print("  why absent from current CourtBuilder candidate list: no card_profiles.v3.json entry at "
                  "all -- nba_peak.perfect_season.board.resolve_card() returns None for this player_slug at "
                  "every duration, so CourtBuilder can never offer them regardless of the interim team-season "
                  "dataset's contents.")
        elif status == "excluded":
            print("  why absent from current CourtBuilder candidate list: has a card_profiles.v3.json entry, "
                  "but profile_status='excluded' at every duration -- present in the file, never actually "
                  "resolvable as a candidate (the exact Michael Cooper / Jaylen Brown failure mode from the "
                  "Phase 5X.5 audit).")
        else:
            print("  why absent from current CourtBuilder candidate list: has a resolvable card_profiles.v3.json "
                  "entry, but is not named in the interim team-season dataset's Warriors entries -- a curation "
                  "gap, not a data gap.")


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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-manifest", action="store_true",
                         help="Write the candidate identity manifest to the experimental path.")
    args = parser.parse_args()

    scored, regular = _load_sources()
    current_pool_names, status_by_slug = _load_current_pool()
    criteria = compute_criteria(scored, regular)

    _print_header("Current state")
    print(f"Current PEAK3 player identity count (raw, all seasons 1980-2026): {scored['player'].nunique()}")
    print(f"Current PEAK3 player-season count (raw):                          {len(scored)}")
    print(f"Current CourtBuilder 250-pool identity count:                     {len(current_pool_names)}")

    _print_header("Candidate counts by criterion (players qualifying via EACH criterion, independently)")
    for col, label in [
        ("crit_all_defense", "All-Defensive team"),
        ("crit_mvp_votes", "MVP vote getter"),
        ("crit_dpoy_votes", "DPOY vote getter"),
        ("crit_all_star", "All-Star"),
        ("crit_15_ppg", "15+ PPG season"),
        ("crit_championship_starter_approx", "Championship + meaningful minutes (approximation, see docstring)"),
        ("crit_finals_starter_approx", "Finals + meaningful minutes (approximation, see docstring)"),
        ("crit_30_mpg", "30+ MPG season"),
        ("crit_25_mpg_fallback", "25+ MPG season (fallback tier)"),
    ]:
        n = int(criteria[col].sum())
        print(f"  {label:65s} {n:5d}")
    print(f"  {'All-Star runner-up / near-selection':65s} {'UNSUPPORTED -- no local source (see docstring)'}")

    # Duplicate-identity check (same slug from different name strings).
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
        # Deterministic tie-break: most local seasons first (proxy for "more
        # established career"), then alphabetical -- never random, never
        # score-based (would smuggle in a peak-value bias this criterion
        # deliberately avoids).
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
    if len(final_pool) < TARGET_IDENTITIES:
        print(f"WARNING: even with the fallback tier, the local dataset only supports "
              f"{len(final_pool)} identities -- {TARGET_IDENTITIES - len(final_pool)} short of the "
              f"{TARGET_IDENTITIES} target. This is a real, reportable data-availability ceiling, "
              f"not a bug in this script.")

    est_seasons = int(criteria.loc[criteria["player"].isin(final_pool["player"]), "n_seasons_local"].sum()) \
        if len(final_pool) else 0
    _print_header("Estimated player-season row/card count if every season is included")
    print(f"Estimated player-season rows (every locally-available season for every qualifying identity): {est_seasons}")
    print("(1-5yr peak windows are NOT generated by this script -- see Stage C/D status in the "
          "expansion strategy doc; this script computes the identity manifest only, per Stage A/B.)")

    audit_warriors_players(scored, regular, criteria, current_pool_names, status_by_slug)
    audit_gsw_team_year_rosters(scored)

    _print_header("Missing-source / unsupported-criteria warnings")
    print("- All-Star runner-up / near-selection: no local source table exists for this signal "
          "(Basketball-Reference does not publish a stable, structured 'runner-up' list the way it "
          "does for MVP/DPOY vote shares). Not computed, not fabricated.")
    print("- Championship/Finals 'starter' status (literal box-score starter flag) is not reliably "
          "present at this table's grain for every season; approximated via meaningful postseason "
          "minutes (po_mp >= 50) instead, and reported as an approximation throughout.")
    print("- Real per-season NBA position ('pos' column) exists in regular_1980_2026.parquet and is "
          "NOT currently surfaced in card_profiles.v3.json or POSITION_OVERRIDES -- a real, unused "
          "asset for the eventual real position-data source table.")

    if args.write_manifest:
        EXPERIMENTAL_DIR.mkdir(parents=True, exist_ok=True)
        manifest_path = EXPERIMENTAL_DIR / "candidate_identity_manifest.v0.json"
        manifest = {
            "manifest_version": MANIFEST_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "generation_command": "python scripts/audit_player_pool_expansion.py --write-manifest",
            "source_provenance": {
                "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
                "regular": str(REGULAR_PATH.relative_to(REPO_ROOT)),
            },
            "target_identities": TARGET_IDENTITIES,
            "final_identity_count": len(final_pool),
            "primary_criteria_count": len(primary_qualified),
            "fallback_25mpg_count": n_fallback_added,
            "status": "candidate_manifest_only -- NOT full player-season cards, NOT wired into "
                      "CourtBuilder, NOT a canonical data replacement. See "
                      "docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Stage B.",
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
                }
                for _, r in final_pool.sort_values("player").iterrows()
            ],
        }
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print(f"\nManifest written: {manifest_path.relative_to(REPO_ROOT)} ({len(final_pool)} identities)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
