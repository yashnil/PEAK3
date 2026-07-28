#!/usr/bin/env python3
"""Phase 7A Part D: randomness audit for the PEAK Season team+season spinner.

Answers, with real data over many seeds, not intuition: is the spinner
truly uniform over rollable team-seasons, or does it silently favor
"stud-heavy" rosters? Calls the exact same generate_team_year_board() the
real game uses -- no separate/approximated RNG path.

Usage:
    python scripts/audit_peak_season_spinner_randomness.py --seeds 10000
    python scripts/audit_peak_season_spinner_randomness.py --seeds 10000 --output /tmp/spinner_audit.json
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from statistics import mean

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nba_peak.perfect_season.board import generate_team_year_board, get_rollable_team_year_entries  # noqa: E402
from nba_peak.perfect_season.exact_season import resolve_player_season_card  # noqa: E402

# Score-based metrics (average top-candidate score, "high-star rate") need
# to resolve real PEAK3 scores per candidate, which is much more expensive
# than the pure team/season distribution sweep -- computed on a bounded
# sample of the requested seeds, not all of them, and clearly labeled as a
# sample in the report.
SCORE_SAMPLE_SEEDS = 500
HIGH_STAR_TOP_SCORE_FLOOR = 80.0
LOADED_ROLL_AVG_SCORE_FLOOR = 75.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seeds", type=int, default=10_000)
    parser.add_argument("--mode", type=str, default="apex_1y")
    parser.add_argument("--output", type=str, default=None)
    args = parser.parse_args()

    entries = get_rollable_team_year_entries()
    total_rollable = len(entries)
    print(f"Total rollable team-seasons in the dataset: {total_rollable}")
    print(f"Sweeping {args.seeds} seeds (mode={args.mode}) ...")

    team_counter: Counter[str] = Counter()
    season_counter: Counter[str] = Counter()
    ts_counter: Counter[tuple[str, str]] = Counter()
    candidate_counts: list[int] = []
    determinism_ok = True
    loaded_rolls: list[dict] = []
    top_scores: list[float] = []
    avg_scores: list[float] = []

    for seed in range(args.seeds):
        board = generate_team_year_board(mode=args.mode, seed=seed)
        for spin in board.spins:
            team_counter[spin.team_id] += 1
            season_counter[spin.era_label] += 1
            ts_counter[(spin.team_id, spin.era_label)] += 1
            candidate_counts.append(len(spin.candidate_player_slugs))

        if seed < 50:
            # Determinism check: same seed generated twice must produce the
            # exact same board (same team/season per round).
            board2 = generate_team_year_board(mode=args.mode, seed=seed)
            if [s.team_id for s in board.spins] != [s.team_id for s in board2.spins] or \
               [s.era_label for s in board.spins] != [s.era_label for s in board2.spins]:
                determinism_ok = False

        if seed < SCORE_SAMPLE_SEEDS:
            for spin in board.spins:
                scores = []
                for slug in spin.candidate_player_slugs:
                    card = resolve_player_season_card(slug, spin.team_id, spin.era_label)
                    if card is not None and card.season_score is not None:
                        scores.append(card.season_score)
                if scores:
                    top = max(scores)
                    avg = mean(scores)
                    top_scores.append(top)
                    avg_scores.append(avg)
                    if avg >= LOADED_ROLL_AVG_SCORE_FLOOR:
                        loaded_rolls.append({
                            "seed": seed, "team_id": spin.team_id, "season": spin.era_label,
                            "avg_candidate_score": round(avg, 1), "top_candidate_score": round(top, 1),
                        })

        if (seed + 1) % max(1, args.seeds // 10) == 0:
            print(f"  ... {seed + 1}/{args.seeds}")

    unique_ts_hit = len(ts_counter)
    # Different-seeds-usually-differ check: compare round-1 rolls across a
    # spread of seeds.
    round1_rolls = set()
    for seed in range(0, args.seeds, max(1, args.seeds // 200)):
        b = generate_team_year_board(mode=args.mode, seed=seed)
        round1_rolls.add((b.spins[0].team_id, b.spins[0].era_label))
    different_seeds_differ = len(round1_rolls) > 1

    high_star_rolls = sum(1 for s in top_scores if s >= HIGH_STAR_TOP_SCORE_FLOOR)
    high_star_rate = high_star_rolls / len(top_scores) if top_scores else None

    report = {
        "seeds_swept": args.seeds,
        "mode": args.mode,
        "total_rollable_team_seasons": total_rollable,
        "unique_team_seasons_hit": unique_ts_hit,
        "unique_team_seasons_hit_pct": round(100.0 * unique_ts_hit / total_rollable, 1) if total_rollable else None,
        "average_candidate_count": round(mean(candidate_counts), 2) if candidate_counts else None,
        "top_20_most_frequent_teams": team_counter.most_common(20),
        "top_20_most_frequent_seasons": season_counter.most_common(20),
        "score_sample_seeds": min(args.seeds, SCORE_SAMPLE_SEEDS),
        "average_top_candidate_score_in_sample": round(mean(top_scores), 2) if top_scores else None,
        "average_candidate_score_in_sample": round(mean(avg_scores), 2) if avg_scores else None,
        "high_star_team_season_rate": (
            f"{high_star_rate:.1%} of sampled rolls had a top candidate scoring >= {HIGH_STAR_TOP_SCORE_FLOOR}"
            if high_star_rate is not None else "no scored candidates in sample"
        ),
        "example_historically_loaded_seeds": loaded_rolls[:20],
        "determinism_same_seed_same_roll": determinism_ok,
        "different_seeds_usually_differ": different_seeds_differ,
        "sampling_method": (
            "Uniform draw over the full rollable team-season entries list per round -- "
            "nba_peak.perfect_season.board.generate_team_year_board: "
            "`entry = entries[rng.randrange(len(entries))]`. No star-power weighting exists "
            "anywhere in this code path -- verified by reading board.py, not just asserted here."
        ),
    }

    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    for k, v in report.items():
        if k in ("top_20_most_frequent_teams", "top_20_most_frequent_seasons", "example_historically_loaded_seeds"):
            continue
        print(f"{k}: {v}")
    print("\nTop 10 most frequent teams:")
    for team, count in report["top_20_most_frequent_teams"][:10]:
        print(f"  {team}: {count} ({100 * count / (args.seeds * 8):.2f}% of all rolls)")
    print("\nTop 10 most frequent seasons:")
    for season, count in report["top_20_most_frequent_seasons"][:10]:
        print(f"  {season}: {count} ({100 * count / (args.seeds * 8):.2f}% of all rolls)")

    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2))
        print(f"\nWrote {args.output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
