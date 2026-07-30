#!/usr/bin/env python3
"""Phase 8C: player portrait coverage audit.

Offline by default (reads only the already-committed manifests/datasets on
disk -- no network calls, safe to run in CI) -- reports, per pool:

  - total eligible players (union of the 250-canonical pool and the full
    team-year candidate pool, the same union
    scripts/build_espn_asset_manifests.py already resolves against)
  - portraits resolved, with a provider breakdown (ESPN roster match / ESPN
    broader athlete-pool match / NBA_CDN)
  - unresolved players in the 250-canonical pool (named list -- the
    highest-visibility pool)
  - unresolved players in the 1500-identity pool (named list, cross-
    referenced against candidate_identity_manifest.v1.json's curated
    entries -- a distinct, smaller pool from the full ~3,494-name team-year
    candidate set)
  - licensing / cache-policy statement (restates the existing
    unknown_do_not_cache / dev_hotlink_preview_only policy -- this script
    never changes it, only reports it)
  - an honest NBA CDN reachability statement, re-verifiable live with
    --recheck-nba-cdn (off by default -- this script stays a fast, offline,
    deterministic CI-safe report unless a human explicitly asks for a live
    check)

Never fabricates a resolution, an ID, or a URL -- purely reads and
summarizes what scripts/build_espn_asset_manifests.py already wrote.

Usage:
    python scripts/audit_player_portrait_coverage.py
    python scripts/audit_player_portrait_coverage.py --output /tmp/portrait_audit.json
    python scripts/audit_player_portrait_coverage.py --recheck-nba-cdn
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "data" / "game" / "assets"
PLAYER_ASSETS_PATH = ASSETS_DIR / "player_assets.v3.json"
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
IDENTITY_1500_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "candidate_identity_manifest.v1.json"
)
TEAM_YEAR_DATASET_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "courtbuilder_team_year.experimental.v3.json"
)

REPORT_VERSION = "portrait_coverage_audit.v1"
NBA_CDN_STATS_ENDPOINT = "https://stats.nba.com/stats/commonallplayers"
NBA_CDN_STATIC_ENDPOINT = "https://cdn.nba.com/static/json/staticData/Players.json"


def _slug(name: str) -> str:
    """Same convention as scripts/build_espn_asset_manifests.py::_slug --
    ASCII-fold before slugifying so diacritic names match the real
    player_slug used everywhere else (never a garbage key)."""
    folded = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")


def _load_resolved_manifest() -> dict[str, dict]:
    if not PLAYER_ASSETS_PATH.exists():
        print(f"ERROR: {PLAYER_ASSETS_PATH} missing -- run scripts/build_espn_asset_manifests.py --write first.")
        sys.exit(1)
    data = json.loads(PLAYER_ASSETS_PATH.read_text())
    return {p["player_slug"]: p for p in data.get("players", [])}


def _load_250_pool() -> dict[str, str]:
    """slug -> display name, for the 250-canonical pool."""
    if not FINAL_250_PATH.exists():
        return {}
    names = sorted(set(pd.read_csv(FINAL_250_PATH)["player"].astype(str).tolist()))
    return {_slug(n): n for n in names}


def _load_1500_identity_pool() -> dict[str, str]:
    """slug -> display name, for the curated identity pool -- distinct from
    the broader team-year candidate pool below. Size is whatever the
    manifest's criteria currently produce (1,390 after the Phase 10D PPG-
    criterion correction; 1,510 before it); never hardcode a count here."""
    if not IDENTITY_1500_PATH.exists():
        return {}
    data = json.loads(IDENTITY_1500_PATH.read_text())
    return {entry["player_slug"]: entry["player"] for entry in data.get("identities", [])}


def _load_team_year_pool() -> dict[str, str]:
    """slug -> display name, for every player reachable as a PEAK Season
    team-year roster candidate (the broadest pool -- ~3,494 names as of
    this pass)."""
    if not TEAM_YEAR_DATASET_PATH.exists():
        return {}
    data = json.loads(TEAM_YEAR_DATASET_PATH.read_text())
    out: dict[str, str] = {}
    for spin in data.get("exact_team_year_spins", []):
        for candidate in spin.get("candidates", []):
            slug = candidate.get("player_slug")
            name = candidate.get("player_name")
            if slug and name:
                out[slug] = name
    return out


def _check_nba_cdn_reachability() -> dict[str, str]:
    """Live HEAD/GET check of the two NBA endpoints the NBA_CDN provider
    would need -- only called when --recheck-nba-cdn is passed. Never
    invents a result; reports exactly what the request returned (or the
    connection error)."""
    results = {}
    for label, url in (("stats.nba.com", NBA_CDN_STATS_ENDPOINT), ("cdn.nba.com static JSON", NBA_CDN_STATIC_ENDPOINT)):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PEAK3-portrait-audit/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                results[label] = f"HTTP {resp.status}"
        except urllib.error.HTTPError as exc:
            results[label] = f"HTTP {exc.code}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            results[label] = f"unreachable ({exc})"
    return results


def build_report(recheck_nba_cdn: bool = False) -> dict:
    resolved_by_slug = _load_resolved_manifest()
    pool_250 = _load_250_pool()
    pool_1500 = _load_1500_identity_pool()
    pool_team_year = _load_team_year_pool()

    eligible = dict(pool_250)
    eligible.update(pool_team_year)  # team-year pool is a superset in practice, but union defensively either way

    resolved_slugs = {
        slug for slug, entry in resolved_by_slug.items()
        if entry.get("resolution_status") == "resolved" and slug in eligible
    }
    provider_counts: dict[str, int] = {}
    for slug in resolved_slugs:
        provider = resolved_by_slug[slug].get("image_provider") or "unknown"
        provider_counts[provider] = provider_counts.get(provider, 0) + 1

    unresolved_250 = sorted(
        (pool_250[slug] for slug in pool_250 if slug not in resolved_slugs),
        key=str.lower,
    )
    unresolved_1500 = sorted(
        (pool_1500[slug] for slug in pool_1500 if slug not in resolved_slugs),
        key=str.lower,
    )

    resolved_250_count = len(pool_250) - len(unresolved_250)
    resolved_1500_count = len(pool_1500) - len(unresolved_1500)

    nba_cdn_status = (
        "Not rechecked this run (pass --recheck-nba-cdn for a live check)."
        if not recheck_nba_cdn
        else json.dumps(_check_nba_cdn_reachability())
    )

    return {
        "report_version": REPORT_VERSION,
        "generation_command": "python scripts/audit_player_portrait_coverage.py",
        "pools": {
            "eligible_total": {
                "description": "Union of the 250-canonical pool and the full team-year candidate pool.",
                "count": len(eligible),
                "resolved": len(resolved_slugs),
                "resolved_pct": round(100 * len(resolved_slugs) / len(eligible), 1) if eligible else 0.0,
            },
            "canonical_250": {
                "description": "The all-time top-250 canonical pool (data/generated/final_250_candidates.csv).",
                "count": len(pool_250),
                "resolved": resolved_250_count,
                "resolved_pct": round(100 * resolved_250_count / len(pool_250), 1) if pool_250 else 0.0,
                "unresolved_players": unresolved_250,
            },
            "identity_1500": {
                "description": "The curated 1500-identity pool (candidate_identity_manifest.v1.json).",
                "count": len(pool_1500),
                "resolved": resolved_1500_count,
                "resolved_pct": round(100 * resolved_1500_count / len(pool_1500), 1) if pool_1500 else 0.0,
                "unresolved_players": unresolved_1500,
            },
            "team_year_full_pool": {
                "description": "Every player reachable as a PEAK Season team-year roster candidate.",
                "count": len(pool_team_year),
                "resolved": len(resolved_slugs & set(pool_team_year)),
                "resolved_pct": (
                    round(100 * len(resolved_slugs & set(pool_team_year)) / len(pool_team_year), 1)
                    if pool_team_year else 0.0
                ),
            },
        },
        "provider_breakdown": provider_counts,
        "licensing": {
            "license_status": "unknown_do_not_cache",
            "cache_policy": "dev_hotlink_preview_only",
            "runtime_gate": "PEAK3_ENABLE_EXTERNAL_ASSET_URLS (default off) -- production shows initials-only "
                             "fallback; a resolved URL only ever renders when a developer explicitly opts in "
                             "locally. No image binaries are ever downloaded or committed.",
        },
        "nba_cdn_status": {
            "provider_state": "real, tested code path -- currently 0 resolutions",
            "reason": (
                "No locally committed data file (parquet/CSV/JSON) contains a verified NBA.com person_id for "
                "any player -- our pipeline is Basketball-Reference-sourced end to end and has never carried "
                "this ID. A crosswalk file (data/game/assets/nba_player_id_crosswalk.json) is supported by "
                "scripts/build_espn_asset_manifests.py if one is ever added from a verified source, but none "
                "exists today -- never fabricated to force a resolution count up."
            ),
            "reachability": nba_cdn_status,
        },
    }


def print_report(report: dict) -> None:
    print("=" * 70)
    print("PEAK Season player portrait coverage audit")
    print("=" * 70)
    for pool_key, pool in report["pools"].items():
        print(f"\n{pool_key}: {pool['description']}")
        print(f"  total: {pool['count']}  resolved: {pool['resolved']} ({pool['resolved_pct']}%)")
        if "unresolved_players" in pool:
            n = len(pool["unresolved_players"])
            print(f"  unresolved: {n}")

    print("\nProvider breakdown (resolved portraits):")
    for provider, count in sorted(report["provider_breakdown"].items(), key=lambda kv: -kv[1]):
        print(f"  {provider}: {count}")

    print("\nLicensing:")
    for k, v in report["licensing"].items():
        print(f"  {k}: {v}")

    print("\nNBA CDN status:")
    for k, v in report["nba_cdn_status"].items():
        print(f"  {k}: {v}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", type=str, default=None, help="Write the full JSON report to this path.")
    parser.add_argument(
        "--recheck-nba-cdn", action="store_true",
        help="Live-check stats.nba.com/cdn.nba.com reachability (optional, offline-safe when omitted).",
    )
    args = parser.parse_args()

    report = build_report(recheck_nba_cdn=args.recheck_nba_cdn)
    print_report(report)

    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2))
        print(f"\nWrote {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
