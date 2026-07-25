#!/usr/bin/env python3
"""Phase 6D Task C: review/audit tool for the 1500-player identity manifest.

Read-only. Makes it obvious who is in the 1500 pool, why they qualified,
which seasons are locally available, and whether a specific player (e.g.
Festus Ezeli) qualifies for the 1500 pool or is merely a real team-year
roster candidate without qualifying (`team_year_roster_only`).

Reads (all already-generated, already-committed-or-experimental files; this
script performs no scraping, no scoring, no data generation itself):
  data/game/experimental/player_pool_1500/candidate_identity_manifest.v1.json
  data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json
  data/generated/final_250_candidates.csv
  data/game/profiles/card_profiles.v3.json
  cache/processed/scored_1980_2026.parquet

Usage:
  python scripts/review_player_pool_manifest.py --summary
  python scripts/review_player_pool_manifest.py --player "Festus Ezeli"
  python scripts/review_player_pool_manifest.py --player "Andre Iguodala"
  python scripts/review_player_pool_manifest.py --criterion "30_mpg"
  python scripts/review_player_pool_manifest.py --criterion "15_ppg"
  python scripts/review_player_pool_manifest.py --criterion "all_defense"
  python scripts/review_player_pool_manifest.py --criterion "mvp_vote"
  python scripts/review_player_pool_manifest.py --criterion "dpoy_vote"
  python scripts/review_player_pool_manifest.py --criterion "all_star"
  python scripts/review_player_pool_manifest.py --csv /tmp/peak3_1500_manifest_review.csv
"""
from __future__ import annotations

import argparse
import csv as csv_module
import json
import re
import sys
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "candidate_identity_manifest.v1.json"
ALL_SEASONS_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "all_seasons_for_identities.v1.json"
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"

# CLI-facing criterion aliases -> manifest's internal criterion keys.
CRITERION_ALIASES = {
    "all_defense": "all_defense",
    "mvp_vote": "mvp_votes",
    "mvp_votes": "mvp_votes",
    "dpoy_vote": "dpoy_votes",
    "dpoy_votes": "dpoy_votes",
    "all_star": "all_star",
    "15_ppg": "15_ppg",
    "30_mpg": "30_mpg",
    "25_mpg": "25_mpg_fallback",
    "25_mpg_fallback": "25_mpg_fallback",
    "championship_starter": "championship_starter_approx",
    "finals_starter": "finals_starter_approx",
}


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _load_canonical_250() -> set[str]:
    if not FINAL_250_PATH.exists():
        return set()
    import csv as _csv
    with FINAL_250_PATH.open() as f:
        return {_slug(row["player"]) for row in _csv.DictReader(f)}


def _load_card_profile_slugs() -> set[str]:
    if not CARD_PROFILES_PATH.exists():
        return set()
    cards = json.loads(CARD_PROFILES_PATH.read_text())
    return {c["player_slug"] for c in cards if c.get("profile_status") != "excluded"}


class ManifestReview:
    def __init__(self) -> None:
        self.manifest = _load_json(MANIFEST_PATH)
        self.all_seasons = _load_json(ALL_SEASONS_PATH)
        if self.manifest is None:
            print(f"ERROR: {MANIFEST_PATH} not found. Run:")
            print("  python scripts/audit_player_pool_expansion.py --write-manifest")
            sys.exit(1)
        self.canonical_250 = _load_canonical_250()
        self.card_profile_slugs = _load_card_profile_slugs()
        self.identities = {i["player_slug"]: i for i in self.manifest["identities"]}

        self._seasons_by_slug: dict[str, list[dict]] = {}
        if self.all_seasons:
            for row in self.all_seasons["rows"]:
                self._seasons_by_slug.setdefault(row["player_slug"], []).append(row)

    def row_for(self, slug: str) -> dict:
        ident = self.identities.get(slug)
        all_seasons_rows = self._seasons_by_slug.get(slug, [])
        scored_count = sum(1 for r in all_seasons_rows if r["score_status"] == "exact_season_scored")
        seasons_sorted = sorted(r["season"] for r in all_seasons_rows)

        qualifies_1500 = ident is not None
        canonical_250 = slug in self.canonical_250
        experimental_card_profile = slug in self.card_profile_slugs
        team_year_roster_only = not qualifies_1500

        notes = []
        if not qualifies_1500:
            notes.append("Not in the 1500-identity manifest -- real team-year roster candidate only "
                         "(if they appear on any exact team-season roster), never upgraded to "
                         "canonical_250/qualifies_1500 status without meeting a real criterion.")
        if qualifies_1500 and not all_seasons_rows:
            notes.append("WARNING: qualifies for the 1500 pool but has no rows in the all-seasons "
                         "table -- indicates an unresolved join, not a real data gap.")

        return {
            "player_slug": slug,
            "player_name": ident["player"] if ident else (all_seasons_rows[0]["player"] if all_seasons_rows else slug),
            "qualifies_1500": qualifies_1500,
            "qualifying_criteria": ident["qualifying_criteria"] if ident else [],
            "qualifying_seasons": ident["qualifying_seasons"] if ident else [],
            "all_available_seasons_count": len(all_seasons_rows),
            "first_season": seasons_sorted[0] if seasons_sorted else None,
            "last_season": seasons_sorted[-1] if seasons_sorted else None,
            "canonical_250": canonical_250,
            "experimental_card_profile": experimental_card_profile,
            "team_year_roster_only": team_year_roster_only,
            "score_coverage_count": scored_count,
            "exact_season_rows_count": len(all_seasons_rows),
            "notes": "; ".join(notes),
        }

    def all_rows(self) -> list[dict]:
        return [self.row_for(slug) for slug in sorted(self.identities.keys())]

    def find_player(self, query: str) -> list[dict]:
        query_slug = _slug(query)
        exact = [r for r in self.all_rows() if r["player_slug"] == query_slug]
        if exact:
            return exact
        # Fall back to substring match on the query slug, or on team-year
        # roster-only players not in the manifest at all (via all_seasons
        # table keys wouldn't have them -- so also check raw regular data
        # is out of scope here; report honestly if not found anywhere).
        return [r for r in self.all_rows() if query_slug in r["player_slug"]]


def cmd_summary(review: ManifestReview) -> None:
    m = review.manifest
    print("=" * 72)
    print("1500-Player Identity Manifest -- Summary")
    print("=" * 72)
    print(f"Manifest version:        {m['manifest_version']}")
    print(f"Supported season range:  {m['supported_start_season']} .. {m['supported_end_season']}")
    print(f"Target identities:       {m['target_identities']}")
    print(f"Final identity count:    {m['final_identity_count']}")
    print(f"  via primary criteria:  {m['primary_criteria_count']}")
    print(f"  via 25+ MPG fallback:  {m['fallback_25mpg_count']}")
    if review.all_seasons:
        print(f"All-seasons table rows: {review.all_seasons['row_count']:,}")
        if review.all_seasons.get("warnings"):
            print("All-seasons table warnings:")
            for w in review.all_seasons["warnings"]:
                print(f"  - {w}")
    print(f"\nPPG caveat: {m.get('ppg_caveat', '(none recorded)')}")
    print("\nCriterion definitions:")
    for key, label in m.get("criteria_definitions", {}).items():
        n = sum(1 for i in m["identities"] if key in i["qualifying_criteria"])
        print(f"  {label:65s} {n:5d}")


def cmd_player(review: ManifestReview, query: str) -> None:
    matches = review.find_player(query)
    if not matches:
        print(f"No match found for '{query}' in the 1500-identity manifest or all-seasons table.")
        print("This means: not a qualifying 1500-pool identity, and not present in the all-seasons "
              "table (which only covers qualifying identities). They may still be a real team-year "
              "roster candidate for a specific team-season -- check "
              "courtbuilder_team_year.experimental.v2.json's `candidates` directly for that.")
        return
    for row in matches:
        print("=" * 72)
        print(f"{row['player_name']}  (slug={row['player_slug']})")
        print("=" * 72)
        for k in ["qualifies_1500", "qualifying_criteria", "qualifying_seasons",
                  "all_available_seasons_count", "first_season", "last_season",
                  "canonical_250", "experimental_card_profile", "team_year_roster_only",
                  "score_coverage_count", "exact_season_rows_count"]:
            print(f"  {k:30s} {row[k]}")
        if row["notes"]:
            print(f"  {'notes':30s} {row['notes']}")


def cmd_criterion(review: ManifestReview, criterion: str) -> None:
    key = CRITERION_ALIASES.get(criterion)
    if key is None:
        print(f"Unknown criterion '{criterion}'. Valid: {sorted(CRITERION_ALIASES.keys())}")
        sys.exit(1)
    matches = [i for i in review.manifest["identities"] if key in i["qualifying_criteria"]]
    print(f"{len(matches)} identities qualify via '{criterion}' (internal key: {key}):")
    for i in sorted(matches, key=lambda x: x["player"]):
        print(f"  {i['player']:30s} slug={i['player_slug']:30s} seasons={i['qualifying_seasons'][:3]}{'...' if len(i['qualifying_seasons']) > 3 else ''}")


def cmd_csv(review: ManifestReview, out_path: str) -> None:
    rows = review.all_rows()
    if not rows:
        print("No rows to write.")
        return
    fieldnames = list(rows[0].keys())
    with open(out_path, "w", newline="") as f:
        writer = csv_module.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            r = dict(r)
            r["qualifying_criteria"] = ";".join(r["qualifying_criteria"])
            r["qualifying_seasons"] = ";".join(r["qualifying_seasons"])
            writer.writerow(r)
    print(f"Wrote {len(rows)} rows -> {out_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--player", type=str)
    parser.add_argument("--criterion", type=str)
    parser.add_argument("--csv", type=str)
    args = parser.parse_args()

    if not any([args.summary, args.player, args.criterion, args.csv]):
        parser.print_help()
        return 1

    review = ManifestReview()

    if args.summary:
        cmd_summary(review)
    if args.player:
        cmd_player(review, args.player)
    if args.criterion:
        cmd_criterion(review, args.criterion)
    if args.csv:
        cmd_csv(review, args.csv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
