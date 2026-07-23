#!/usr/bin/env python3
"""Manual review hook for CourtBuilder's team + era wheel coverage.

Samples many seeds per mode and prints the resulting franchise/era
distribution plus the duration-aware coverage summary (total/playable/
sparse/excluded combinations). This is the "is the spinner actually broad,
or does it keep landing on the same few dynasties?" check referenced in
docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md and the Phase 5X.5 audit that
found (and fixed) two dead player_slugs silently starving several
franchises out of the wheel entirely -- see
data/game/interim/courtbuilder_team_seasons.v3.json's own coverage_note.

Usage:
    python scripts/check_courtbuilder_wheel_coverage.py [seeds_per_mode]

Exit code 0 always (this is a diagnostic printout, not a pass/fail gate --
the CI-facing distribution assertions live in
apps/api/tests/test_perfect_season.py).
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from nba_peak.perfect_season.board import coverage_summary, generate_board
from nba_peak.perfect_season.config import SUPPORTED_MODES

SEEDS_PER_MODE = int(sys.argv[1]) if len(sys.argv) > 1 else 300


def main() -> int:
    for mode in SUPPORTED_MODES:
        print(f"\n{'=' * 60}\n{mode}\n{'=' * 60}")

        cov = coverage_summary(mode)
        print(
            f"coverage: {cov['playable_combinations']}/{cov['total_combinations']} playable, "
            f"{cov['sparse_combinations']} sparse (1 candidate), "
            f"{cov['excluded_zero_candidate_combinations']} excluded (0 candidates)"
        )

        franchise_counter: Counter[str] = Counter()
        era_counter: Counter[str] = Counter()
        for seed in range(1, SEEDS_PER_MODE + 1):
            board = generate_board(mode=mode, seed=seed, team_spin_enabled=True)
            for spin in board.spins:
                if spin.franchise_display_name:
                    franchise_counter[spin.franchise_display_name] += 1
                if spin.era_label:
                    era_counter[spin.era_label] += 1

        total_franchises_in_dataset = len(cov["per_team"])
        seen_franchises = len(franchise_counter)
        print(
            f"franchise coverage across {SEEDS_PER_MODE} seeds: "
            f"{seen_franchises}/{total_franchises_in_dataset} franchises appeared at least once"
        )
        if seen_franchises < total_franchises_in_dataset:
            missing = set(cov["per_team"]) - set(franchise_counter)
            print(f"  ** NEVER APPEARED: {sorted(missing)} **")

        total = sum(franchise_counter.values()) or 1
        print("franchise distribution:")
        for name, count in franchise_counter.most_common():
            print(f"  {name:28s} {count:5d}  ({count / total * 100:5.1f}%)")

        etotal = sum(era_counter.values()) or 1
        print("era distribution:")
        for name, count in sorted(era_counter.items()):
            print(f"  {name:10s} {count:5d}  ({count / etotal * 100:5.1f}%)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
