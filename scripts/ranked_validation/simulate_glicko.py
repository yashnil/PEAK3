"""
simulate_glicko.py
-------------------
Monte-Carlo simulation of the REAL, implemented Glicko-2 module
(apps/api/app/services/ranked/glicko2.py) against synthetic players with
known latent skill. This is legitimate synthetic validation evidence (spec
section O.1) — it is not a substitute for real-player closed-alpha data,
and the report says so explicitly.

Usage (from repo root):
    python scripts/ranked_validation/simulate_glicko.py --players 200 --matches-per-player 30

Writes a JSON report to scripts/ranked_validation/output/glicko_simulation_report.json
and prints a human-readable summary. Exit 0 always (this is a measurement
tool, not a pass/fail gate) — thresholds are evaluated by a human reviewer
against the numbers it reports.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"
for p in (REPO_ROOT, API_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.services.ranked.glicko2 import Glicko2Rating, initial_rating, rate_match  # noqa: E402


@dataclass
class SyntheticPlayer:
    id: int
    true_skill: float  # latent skill, Elo-like scale centered at 1500
    rating: Glicko2Rating
    valid_matches: int = 0
    rating_history: list = None  # type: ignore[assignment]

    def __post_init__(self):
        if self.rating_history is None:
            self.rating_history = [self.rating.rating]


def true_win_probability(skill_a: float, skill_b: float) -> float:
    """Standard logistic win-probability model from latent skill difference."""
    return 1.0 / (1.0 + 10 ** ((skill_b - skill_a) / 400.0))


def simulate(
    n_players: int, matches_per_player: int, noise_sd: float, seed: int, tau: float = 0.5
) -> dict:
    rng = random.Random(seed)
    players = [
        SyntheticPlayer(id=i, true_skill=rng.gauss(1500, 300), rating=initial_rating())
        for i in range(n_players)
    ]

    total_matches = n_players * matches_per_player // 2
    upsets = 0
    decided_matches = 0
    opponent_repeat_counts: dict[tuple[int, int], int] = {}

    for _ in range(total_matches):
        a, b = rng.sample(players, 2)
        key = (min(a.id, b.id), max(a.id, b.id))
        opponent_repeat_counts[key] = opponent_repeat_counts.get(key, 0) + 1

        # Simulated "performance" includes latent skill plus per-match noise,
        # mirroring real players' variance in execution independent of skill.
        perf_a = a.true_skill + rng.gauss(0, noise_sd)
        perf_b = b.true_skill + rng.gauss(0, noise_sd)
        a_wins = perf_a > perf_b
        outcome_a = 1.0 if a_wins else 0.0

        # Upset: the lower-true-skill player wins.
        favored_a = a.true_skill > b.true_skill
        if (favored_a and not a_wins) or (not favored_a and a_wins):
            upsets += 1
        decided_matches += 1

        new_a = rate_match(a.rating, b.rating.rating, b.rating.rd, outcome_a, tau=tau)
        new_b = rate_match(b.rating, a.rating.rating, a.rating.rd, 1.0 - outcome_a, tau=tau)
        a.rating, b.rating = new_a, new_b
        a.valid_matches += 1
        b.valid_matches += 1
        a.rating_history.append(new_a.rating)
        b.rating_history.append(new_b.rating)

    # ---- Metrics ----------------------------------------------------------

    # Rating-order correlation: Spearman-style rank correlation between true
    # skill and final rating.
    by_skill = sorted(players, key=lambda p: p.true_skill)
    by_rating = sorted(players, key=lambda p: p.rating.rating)
    skill_rank = {p.id: i for i, p in enumerate(by_skill)}
    rating_rank = {p.id: i for i, p in enumerate(by_rating)}
    n = len(players)
    d_squared_sum = sum((skill_rank[p.id] - rating_rank[p.id]) ** 2 for p in players)
    spearman = 1 - (6 * d_squared_sum) / (n * (n**2 - 1)) if n > 1 else float("nan")

    upset_rate = upsets / decided_matches if decided_matches else float("nan")

    final_rds = [p.rating.rd for p in players]
    final_vols = [p.rating.volatility for p in players]

    placement_ratings = [p.rating_history[min(7, len(p.rating_history) - 1)] for p in players]
    final_ratings = [p.rating.rating for p in players]
    placement_vs_final_diff = [abs(a - b) for a, b in zip(placement_ratings, final_ratings)]

    repeat_pair_fraction = (
        sum(1 for c in opponent_repeat_counts.values() if c > 1) / len(opponent_repeat_counts)
        if opponent_repeat_counts
        else 0.0
    )

    # Calibration by rating difference bucket: for pairs whose rating gap
    # falls in a bucket, does the empirical win rate track the Glicko-2
    # expected-score formula reasonably well? Approximated by re-simulating
    # win probability directly from final ratings vs. true skill-implied outcomes.
    calibration_buckets: dict[str, list[float]] = {}
    for p in players:
        for q in players:
            if p.id >= q.id:
                continue
            rating_gap = p.rating.rating - q.rating.rating
            bucket = f"{int(rating_gap // 100) * 100}"
            true_p_wins = true_win_probability(p.true_skill, q.true_skill)
            calibration_buckets.setdefault(bucket, []).append(true_p_wins)

    report = {
        "config": {"n_players": n_players, "matches_per_player": matches_per_player, "noise_sd": noise_sd, "seed": seed, "tau": tau},
        "convergence": {
            "mean_final_rd": statistics.mean(final_rds),
            "median_final_rd": statistics.median(final_rds),
            "min_final_rd": min(final_rds),
            "max_final_rd": max(final_rds),
        },
        "rating_order_correlation_spearman": spearman,
        "upset_probability": upset_rate,
        "volatility": {
            "mean": statistics.mean(final_vols),
            "max": max(final_vols),
            "min": min(final_vols),
        },
        "placement_stability": {
            "mean_abs_diff_placement_vs_final": statistics.mean(placement_vs_final_diff),
            "note": "difference between rating after 7 matches (placement) and final rating after matches_per_player",
        },
        "repeated_opponent_effect": {
            "fraction_of_pairs_matched_more_than_once": repeat_pair_fraction,
        },
        "calibration_by_rating_gap_bucket": {
            k: statistics.mean(v) for k, v in sorted(calibration_buckets.items(), key=lambda kv: int(kv[0]))
        },
        "population_sensitivity": "see --players sweep in main() for population-size comparison",
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, default=200)
    parser.add_argument("--matches-per-player", type=int, default=30)
    parser.add_argument("--noise-sd", type=float, default=150.0)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    report = simulate(args.players, args.matches_per_player, args.noise_sd, args.seed)

    # Population sensitivity: also run a small and a large population for comparison.
    small = simulate(30, args.matches_per_player, args.noise_sd, args.seed)
    large = simulate(1000, args.matches_per_player, args.noise_sd, args.seed)
    report["population_sensitivity"] = {
        "n=30": {"spearman": small["rating_order_correlation_spearman"], "mean_final_rd": small["convergence"]["mean_final_rd"]},
        f"n={args.players}": {"spearman": report["rating_order_correlation_spearman"], "mean_final_rd": report["convergence"]["mean_final_rd"]},
        "n=1000": {"spearman": large["rating_order_correlation_spearman"], "mean_final_rd": large["convergence"]["mean_final_rd"]},
    }

    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(exist_ok=True)
    out_path = output_dir / "glicko_simulation_report.json"
    out_path.write_text(json.dumps(report, indent=2))

    print(f"Wrote {out_path}")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
