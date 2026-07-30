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
Sec 2.0, restated 1:1 here as executable checks against real columns).

CRITERIA LOGIC -- read this before "fixing" the gate (Phase 10D):
  Sec 2.0's wording is "Include every player ... who matches **at least one**
  of:", and "averaged 30+ MPG in any season" is one of the listed items. The
  gate below is therefore a deliberate OR-chain over basketball-significance
  routes, with 25+ MPG as a TIERED FALLBACK that fires only if the OR-chain
  yields fewer than TARGET_IDENTITIES. `fallback_25mpg_count == 0` is NOT
  evidence of a bug -- it is the correct, documented outcome whenever the
  primary routes already clear the target.
  docs/implementation/PHASE_9B_RANKINGS_AUDIT.md Sec 4 asserted the intended
  rule was "(15+ PPG OR award) AND (30+ MPG, fallback 25+)" and read the zero
  fallback count as self-reported proof of a bug. Both claims are wrong
  against Sec 2.0; see that document's Phase 10D correction. The REAL defect
  in this file was criterion 6 -- see below.

  1. Any All-Defensive team selection      -> all_defense_team notna
  2. Any MVP vote getter                   -> mvp_rank notna
  3. Any DPOY vote getter                  -> dpoy_rank notna
  4. Any All-Star                          -> all_star == 1
  5. All-Star runner-up / near-selection   -> NOT COMPUTABLE from local data;
                                               reported as an explicit
                                               unsupported-criteria warning,
                                               never silently skipped.
  6. Any 15+ PPG season                    -> ESTIMATED per-game scoring, see
                                               PPG_CAVEAT below. No genuine
                                               per-game points column exists
                                               in any locally committed file
                                               (verified: only BR's per_poss.html
                                               / "per 100 possessions" table was
                                               ever scraped for pts/trb/ast --
                                               see peak3.py's BREF per_poss
                                               fetch calls; no totals.html or
                                               per_game.html points column
                                               exists locally). Sec 2.0 asks
                                               for a per-game VOLUME threshold,
                                               so the rate is converted to an
                                               estimated per-game figure with
                                               the player's real minutes
                                               (MPG_TO_PPG_NOTE) rather than
                                               compared as a bare rate.
                                               Reported as an estimate
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
  - PPG criterion changed: v0 compared `regular_1980_2026.parquet`'s raw `pts`
    column (verified to be per-100-possessions, not per-game -- e.g. Stephen
    Curry's 2015-16 row shows pts=42.5, matching the per-100 conversion of
    his real 30.1 PPG, not 30.1 itself) directly against MIN_PPG=15.0. v1
    switched to `pts_per75`.

v1 manifest, Phase 10D revision -- criterion 6 corrected for real:
  The v0->v1 change did NOT fix the defect it claimed to. `pts_per75` is
  EXACTLY `pts_per100 * 0.75` in scored_1980_2026.parquet (verified: the
  ratio pts_per100/pts_per75 is 1.3333... for all 11,429 rows, zero
  variance). So v1 compared the SAME per-possession rate against the SAME
  threshold, merely rescaled -- which only LOWERED the effective bar from 15
  per-100 to 20 per-100. It never addressed the actual problem, which is
  that Sec 2.0 asks for a per-game VOLUME ("averaged 15+ PPG") and both v0
  and v1 implemented a per-minute RATE.

  The difference is not cosmetic. A rate criterion admits any efficient
  low-minute scorer: 1,660 season-rows cleared `pts_per75 >= 15` on under 25
  MPG, including seasons whose estimated real scoring was under 6 PPG.
  Luka Garza's 2025-26 (16.2 MPG, ~8.5 estimated PPG) entered the manifest
  with `qualifying_criteria: ["15_ppg"]` and nothing else -- a bench player
  admitted through a criterion named for a starter's scoring volume.

  Phase 10D converts the rate to an estimated per-game volume before
  comparing (see MPG_TO_PPG_NOTE / PPG_CAVEAT) and renames the criterion
  `15_ppg_est` so no reader mistakes it for a measured value.
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
# Phase 10D bumps the CONTENT version but deliberately keeps the FILENAME at
# `candidate_identity_manifest.v1.json`: five runtime/test/doc consumers resolve
# that exact path (exact_season.py, build_experimental_team_year_dataset.py,
# review_player_pool_manifest.py, audit_player_portrait_coverage.py,
# apps/api/tests/test_perfect_season.py), and renaming the file would couple a
# criteria correction to a path migration for no benefit. The version string
# below is what tells a reader which criteria produced the file.
MANIFEST_VERSION = "player_pool_1500_manifest.v1.1"
ALL_SEASONS_VERSION = "all_seasons_for_identities.v1"
SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"

MPG_TO_PPG_NOTE = (
    "ppg_est = pts_per100 * mpg / 48. This is the standard per-100 -> per-game "
    "identity under one stated assumption: that a team averages ~100 "
    "possessions per 48 minutes, so a player on the floor for `mpg` minutes "
    "sees roughly 100 * mpg/48 possessions. Both inputs are real committed "
    "columns of scored_1980_2026.parquet -- no value is invented, and the "
    "only approximation is the flat league-pace constant (real pace ranges "
    "~90-105 by era, which is exactly the residual error measured below)."
)

# Measured against 30 hand-verified real PPG figures spanning 1980-2026 and
# every role tier (Jordan 1986-87 through Gary Payton II 2021-22). Recorded
# here as numbers, not adjectives, so the criterion's accuracy is auditable
# rather than asserted -- and re-checked by
# tests/test_player_pool_inclusion.py::test_ppg_estimator_accuracy_on_known_seasons.
PPG_EST_ACCURACY = {
    "validation_sample_size": 30,
    "mean_bias_ppg": 1.26,
    "median_bias_ppg": 1.31,
    "mean_absolute_error_ppg": 1.30,
    "max_overestimate_ppg": 3.51,
    "max_underestimate_ppg": -0.38,
    "share_within_2_ppg": 0.80,
    "share_overestimated": 0.93,
    "bias_direction": (
        "Over-estimates 93% of the time (residual is unmodelled pace). For an "
        "inclusion criterion this is the SAFE direction: it over-admits at the "
        "margin rather than silently excluding a real 15-PPG scorer."
    ),
}

PPG_CAVEAT = (
    "No genuine per-game points column exists in any locally committed source "
    "(only Basketball-Reference's per-100-possessions table was ever scraped "
    "for pts/trb/ast -- see peak3.py's BREF per_poss.html fetch calls; no "
    "totals.html/per_game.html points column exists locally). Sec 2.0 asks for "
    "a per-game VOLUME threshold ('averaged 15+ PPG in any season'), so this "
    "criterion converts the committed per-possession rate into an ESTIMATED "
    "per-game figure using the player's real minutes -- " + MPG_TO_PPG_NOTE +
    " Measured accuracy over 30 hand-verified seasons: mean absolute error "
    "1.30 PPG, mean bias +1.26 PPG, 80% within +/-2.0 PPG, over-estimating 93% "
    "of the time. It is NOT a measured value: read 'qualifies via 15_ppg_est' "
    "as 'estimated to have averaged 15+ points per game', not as a precise "
    "claim. NOTE (Phase 10D): the pre-10D versions of this criterion compared "
    "the per-possession RATE (`pts`/`pts_per100` in v0, the arithmetically "
    "identical `pts_per75` in v1) directly against 15.0, which admitted "
    "efficient bench scorers -- 1,660 season-rows under 25 MPG, some with "
    "estimated real scoring below 6 PPG -- under a criterion named for a "
    "starter's volume."
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
    "15_ppg_est": "15+ estimated PPG season (pts_per100 x mpg / 48, see PPG_CAVEAT)",
    "championship_starter_approx": "Championship + meaningful minutes (approximation)",
    "finals_starter_approx": "Finals + meaningful minutes (approximation)",
    "30_mpg": "30+ MPG season",
    "25_mpg_fallback": "25+ MPG season (fallback tier -- only listed when the "
                       "identity was ACTUALLY admitted through the fallback)",
}

# The gate's own semantics, published in the manifest so a future reader does
# not have to re-derive them from the code (Phase 9B re-derived them wrongly).
CRITERIA_LOGIC = {
    "primary": "OR",
    "primary_routes": [
        "all_defense", "mvp_votes", "dpoy_votes", "all_star", "15_ppg_est",
        "championship_starter_approx", "finals_starter_approx", "30_mpg",
    ],
    "fallback_route": "25_mpg_fallback",
    "fallback_condition": (
        "Applied ONLY when the primary OR-chain yields fewer than "
        "target_identities. fallback_25mpg_count == 0 therefore means the "
        "primary routes already cleared the target -- it is the documented "
        "outcome, not a defect."
    ),
    "source_of_truth": (
        "docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Sec 2.0 -- "
        "'Include every player ... who matches at least one of:', with "
        "'averaged 30+ MPG in any season' listed as one of those routes. "
        "Minutes is an admission route by design, not a conjunct."
    ),
    "scope": (
        "This manifest defines the CANDIDATE UNIVERSE for identity labeling "
        "(exact_season.py's identity_pool_status). It is NOT the PEAK Index "
        "ranking universe: the served rankings apply their own, stricter "
        "minutes gate (scripts/build_top_peaks.py::MIN_SERVED_ANCHOR_MPG and "
        "scripts/build_top_seasons.py::MIN_SERVED_SEASON_MPG). A player can "
        "legitimately be a CourtBuilder candidate and correctly absent from "
        "the rankings."
    ),
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
    # Phase 10D: the `regular` parquet is no longer joined here. It was only
    # ever merged to carry `pts` in under the name `ppg_per100_DO_NOT_USE` --
    # a column the criteria never read after v1 switched to `pts_per75`. Both
    # inputs the PPG criterion now needs (`pts_per100`, `mpg`) live in
    # `scored`. The parameter is retained because callers pass it and the
    # audit's other sections use it.
    merged = scored.copy()
    # Phase 10D: convert the committed per-possession RATE into an ESTIMATED
    # per-game VOLUME before comparing against MIN_PPG. v0 compared
    # `pts` (per-100) and v1 compared `pts_per75` -- which is exactly
    # pts_per100 * 0.75, i.e. the same rate rescaled, so v1 never fixed
    # anything. Sec 2.0's criterion is a per-game average; a rate is not one.
    # See MPG_TO_PPG_NOTE / PPG_CAVEAT for the identity and its measured error.
    merged["ppg_est"] = (
        pd.to_numeric(merged.get("pts_per100"), errors="coerce")
        * pd.to_numeric(merged.get("mpg"), errors="coerce") / 48.0
    )

    merged["po_mp"] = pd.to_numeric(merged.get("po_mp"), errors="coerce").fillna(0.0)
    merged["_meaningful_po"] = merged["po_mp"] >= 50

    rows = []
    for player, g in merged.groupby("player"):
        all_defense = bool(g["all_defense_team"].notna().any())
        mvp_votes = bool(g["mvp_rank"].notna().any())
        dpoy_votes = bool(g["dpoy_rank"].notna().any())
        all_star = bool((g["all_star"] == 1).any())
        ppg_15 = bool((g["ppg_est"] >= MIN_PPG).any())
        champ_starter = bool(((g["championship"] == 1) & g["_meaningful_po"]).any())
        finals_starter = bool(((g["finals_appearance"] == 1) & g["_meaningful_po"]).any())
        mpg_30 = bool((g["mpg"] >= MIN_MPG_PRIMARY).any())
        mpg_25 = bool((g["mpg"] >= MIN_MPG_FALLBACK).any())

        qual_mask = (
            (g["all_defense_team"].notna()) | (g["mvp_rank"].notna()) |
            (g["dpoy_rank"].notna()) | (g["all_star"] == 1) |
            (g["ppg_est"] >= MIN_PPG) |
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
            if r["ppg_est"] >= MIN_PPG:
                hit.append("15_ppg_est")
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
            c.replace("crit_", "").replace("15_ppg", "15_ppg_est") for c in [
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

    _print_header("PPG criterion caveat (read before trusting 15_ppg_est)")
    print(PPG_CAVEAT)

    _print_header("Candidate counts by criterion (players qualifying via EACH criterion, independently)")
    for col, label in [
        ("crit_all_defense", "All-Defensive team"),
        ("crit_mvp_votes", "MVP vote getter"),
        ("crit_dpoy_votes", "DPOY vote getter"),
        ("crit_all_star", "All-Star"),
        ("crit_15_ppg", "15+ estimated PPG (pts_per100 x mpg / 48)"),
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

    # Phase 10D: record the route each identity was ACTUALLY admitted through.
    # Before this, `qualifying_criteria` listed `25_mpg_fallback` for every
    # identity whose crit_25_mpg_fallback flag was true (1,206 of 1,510),
    # including the entire primary-qualified population -- so the manifest
    # simultaneously reported "fallback_25mpg_count: 0" and tagged 80% of its
    # identities with the fallback criterion. Only genuine fallback admissions
    # carry the tag now, which makes the count and the tags agree.
    primary_qualified = primary_qualified.copy()
    primary_qualified["admitted_via"] = "primary"

    final_pool = primary_qualified
    n_fallback_added = 0
    if not reaches_target:
        fallback_candidates = criteria[~criteria["qualifies_primary"] & criteria["crit_25_mpg_fallback"]].copy()
        needed = TARGET_IDENTITIES - len(primary_qualified)
        fallback_candidates = fallback_candidates.sort_values(
            ["n_seasons_local", "player"], ascending=[False, True]
        )
        added = fallback_candidates.head(needed).copy()
        added["admitted_via"] = "25_mpg_fallback"
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
    print(f"- 15+ estimated PPG: {PPG_CAVEAT}")

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
            "criteria_logic": CRITERIA_LOGIC,
            "ppg_caveat": PPG_CAVEAT,
            "ppg_estimator": MPG_TO_PPG_NOTE,
            "ppg_estimator_accuracy": PPG_EST_ACCURACY,
            "target_identities": TARGET_IDENTITIES,
            "reached_target_identities": len(final_pool) >= TARGET_IDENTITIES,
            "final_identity_count": len(final_pool),
            "primary_criteria_count": len(primary_qualified),
            "fallback_25mpg_count": n_fallback_added,
            "status": "candidate_manifest_v1.1 -- identity list + criteria are real and generated "
                      "from committed local data; NOT a canonical data replacement. Read at runtime "
                      "ONLY to classify identity_pool_status (a display label); it never gates "
                      "CourtBuilder roster availability, which is derived independently from "
                      "regular_1980_2026.parquet. See "
                      "docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md.",
            "revision_note": "Phase 10D: criterion `15_ppg` (a per-possession RATE compared "
                             "against a per-game threshold) replaced by `15_ppg_est` (estimated "
                             "per-game volume); `25_mpg_fallback` no longer tagged on identities "
                             "that did not enter through the fallback tier. See ppg_caveat and "
                             "criteria_logic.",
            "identities": [
                {
                    "player": r["player"],
                    "player_slug": r["player_slug"],
                    "career_start": r["career_start"],
                    "career_end": r["career_end"],
                    "n_seasons_local": r["n_seasons_local"],
                    "already_in_250_pool": r["player"] in current_pool_names,
                    "admitted_via": r["admitted_via"],
                    # `25_mpg_fallback` is deliberately NOT derived from the
                    # crit_ flag here -- it is a tiered ADMISSION ROUTE, and
                    # listing it for a player who was already admitted on
                    # awards/scoring/30-MPG misrepresents why they are in the
                    # pool. See CRITERIA_LOGIC.
                    "qualifying_criteria": [
                        c.replace("crit_", "").replace("15_ppg", "15_ppg_est")
                        for c in [
                            "crit_all_defense", "crit_mvp_votes", "crit_dpoy_votes",
                            "crit_all_star", "crit_15_ppg", "crit_championship_starter_approx",
                            "crit_finals_starter_approx", "crit_30_mpg",
                        ] if r[c]
                    ] + (["25_mpg_fallback"] if r["admitted_via"] == "25_mpg_fallback" else []),
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
