"""
slice_audit.py
---------------
Distribution audit of the REAL committed card pool (data/game/profiles/
card_profiles.v3.json — the same file the board generator reads) by mode,
era, role, and data-completeness (spec section O.2). This is real analysis
of real data, not synthetic evidence — it is meant to surface era/role bias
that would make ranked boards unfair to certain playstyles or unfairly easy
in one duration mode vs another.

Usage (from repo root):
    python scripts/ranked_validation/slice_audit.py
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"

ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
MODE_LABELS = {1: "apex_1y", 3: "prime_3y", 5: "foundation_5y"}


def _era_bucket(anchor_season: str) -> str:
    try:
        start_year = int(anchor_season.split("-")[0])
    except (ValueError, IndexError):
        return "unknown"
    decade = (start_year // 10) * 10
    return f"{decade}s"


def audit(cards: list[dict]) -> dict:
    report: dict = {"total_cards": len(cards), "by_mode": {}}

    excluded = [c for c in cards if c.get("profile_status") == "excluded"]
    report["excluded_profiles"] = len(excluded)

    active = [c for c in cards if c.get("profile_status") != "excluded"]

    for duration, mode in MODE_LABELS.items():
        mode_cards = [c for c in active if c["duration_years"] == duration]
        mode_report: dict = {"card_pool_size": len(mode_cards)}

        # Role eligibility distribution — a low count for a role is a real
        # "role-completion difficulty" signal (fewer valid offers exist for
        # boards that need that role filled).
        role_counts: dict[str, int] = {r: 0 for r in ROLES}
        role_scores: dict[str, list[float]] = {r: [] for r in ROLES}
        for c in mode_cards:
            for r in c.get("eligible_roles", []):
                if r in role_counts:
                    role_counts[r] += 1
                    role_scores[r].append(c["individual_peak_score"])
        mode_report["role_eligible_count"] = role_counts
        mode_report["role_mean_score"] = {
            r: (round(statistics.mean(v), 2) if v else None) for r, v in role_scores.items()
        }

        # Era distribution
        era_counts: dict[str, int] = defaultdict(int)
        for c in mode_cards:
            era_counts[_era_bucket(c["anchor_season"])] += 1
        mode_report["era_distribution"] = dict(sorted(era_counts.items()))

        # Data completeness
        completeness_counts: dict[str, int] = defaultdict(int)
        for c in mode_cards:
            completeness_counts[c.get("data_completeness", "unknown")] += 1
        mode_report["data_completeness_distribution"] = dict(completeness_counts)

        # Primary-role distribution (archetype proxy)
        primary_role_counts: dict[str, int] = defaultdict(int)
        for c in mode_cards:
            primary_role_counts[c.get("primary_role") or "none"] += 1
        mode_report["primary_role_distribution"] = dict(primary_role_counts)

        # Score distribution
        scores = [c["individual_peak_score"] for c in mode_cards]
        if scores:
            mode_report["score_distribution"] = {
                "mean": round(statistics.mean(scores), 2),
                "median": round(statistics.median(scores), 2),
                "stdev": round(statistics.stdev(scores), 2) if len(scores) > 1 else 0.0,
                "min": round(min(scores), 2),
                "max": round(max(scores), 2),
            }

        report["by_mode"][mode] = mode_report

    return report


def main() -> int:
    if not CARD_PROFILES_PATH.exists():
        print(f"ERROR: {CARD_PROFILES_PATH} not found. Run `python scripts/build_card_profiles.py` first.")
        return 1

    cards = json.loads(CARD_PROFILES_PATH.read_text())
    report = audit(cards)

    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(exist_ok=True)
    out_path = output_dir / "slice_audit_report.json"
    out_path.write_text(json.dumps(report, indent=2))

    print(f"Wrote {out_path}")
    print(json.dumps(report, indent=2))

    # Flag (not fail) any role with a strikingly small pool for a mode —
    # a human reviewer decides whether this is acceptable for alpha.
    print("\n--- Flags for human review ---")
    for mode, mode_report in report["by_mode"].items():
        pool = mode_report["card_pool_size"]
        for role, count in mode_report["role_eligible_count"].items():
            if pool > 0 and count / pool < 0.05:
                print(f"  FLAG: {mode} / {role}: only {count}/{pool} cards eligible ({count / pool:.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
