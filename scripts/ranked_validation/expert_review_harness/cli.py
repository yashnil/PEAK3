"""
expert_review_harness/cli.py
------------------------------
A working blind pairwise-review tool for basketball reviewers (spec section
O.5). It presents two lineups (Left/Right, randomized) WITHOUT the model's
score or which "side" the model preferred, collects a reviewer's pick,
confidence, and optional reasoning under a pseudonym, and appends the
result to a local JSONL file.

This tool intentionally ships with ZERO review records. Populating this
file with invented reviewer opinions would be fabricated evidence — see
the Phase 4.0 report's explicit refusal to do that. Real use requires a
human reviewer running this CLI.

Usage (from repo root):
    python scripts/ranked_validation/expert_review_harness/cli.py review \\
        --fixtures scripts/ranked_validation/output/face_validity_fixtures.json \\
        --reviewer-pseudonym reviewer_1

    python scripts/ranked_validation/expert_review_harness/cli.py report
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

REVIEWS_PATH = Path(__file__).resolve().parent / "reviews.jsonl"


def _load_fixtures(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def _present_pair(fixture_a: dict, fixture_b: dict, rng: random.Random) -> tuple[dict, dict, bool]:
    """Randomize left/right order. Returns (left, right, swapped)."""
    if rng.random() < 0.5:
        return fixture_a, fixture_b, False
    return fixture_b, fixture_a, True


def run_review_session(fixtures_path: Path, reviewer_pseudonym: str, seed: int | None = None) -> None:
    fixtures = _load_fixtures(fixtures_path)
    if len(fixtures) < 2:
        print("Need at least 2 fixtures to form a pairwise comparison.")
        return

    rng = random.Random(seed)
    a, b = rng.sample(fixtures, 2)
    left, right, swapped = _present_pair(a, b, rng)

    print("=== Blind pairwise review ===")
    print("No model answer is shown before your response.\n")
    print(f"LEFT  ({left['id']}): {left['description']}")
    print(f"RIGHT ({right['id']}): {right['description']}\n")

    pick = input("Which lineup do you judge stronger? [left/right/tie]: ").strip().lower()
    if pick not in ("left", "right", "tie"):
        print("Invalid input; aborting without recording.")
        return
    confidence = input("Confidence (1-5): ").strip()
    reasoning = input("Optional reasoning (press enter to skip): ").strip() or None

    record = {
        "reviewer_pseudonym": reviewer_pseudonym,
        "left_fixture_id": left["id"],
        "right_fixture_id": right["id"],
        "order_swapped": swapped,
        "pick": pick,
        "confidence": confidence,
        "reasoning": reasoning,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }

    with REVIEWS_PATH.open("a") as f:
        f.write(json.dumps(record) + "\n")
    print(f"\nRecorded to {REVIEWS_PATH}")


def report() -> None:
    if not REVIEWS_PATH.exists() or REVIEWS_PATH.stat().st_size == 0:
        print(
            "No review records exist yet (scripts/ranked_validation/expert_review_harness/reviews.jsonl "
            "is empty or absent). This is expected until real human reviewers run "
            "`cli.py review` — no data is fabricated here."
        )
        return

    records = [json.loads(line) for line in REVIEWS_PATH.read_text().splitlines() if line.strip()]
    print(f"{len(records)} review record(s) found.")

    by_pair: dict[tuple[str, str], list[dict]] = {}
    for r in records:
        key = tuple(sorted([r["left_fixture_id"], r["right_fixture_id"]]))
        by_pair.setdefault(key, []).append(r)

    print(f"{len(by_pair)} distinct fixture pair(s) reviewed.")
    for pair, pair_records in by_pair.items():
        picks = [r["pick"] for r in pair_records]
        print(f"  {pair}: {len(pair_records)} review(s), picks={picks}")

    # Inter-rater agreement export (only meaningful with >=2 reviewers per pair).
    disagreements = [
        pair for pair, pair_records in by_pair.items()
        if len({r["pick"] for r in pair_records}) > 1
    ]
    if disagreements:
        print(f"\n{len(disagreements)} pair(s) show reviewer disagreement — see disagreement review queue below:")
        for pair in disagreements:
            print(f"  DISAGREEMENT: {pair}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    review_parser = sub.add_parser("review", help="Run one blind pairwise review session")
    review_parser.add_argument("--fixtures", type=Path, required=True)
    review_parser.add_argument("--reviewer-pseudonym", type=str, required=True)
    review_parser.add_argument("--seed", type=int, default=None)

    sub.add_parser("report", help="Summarize recorded reviews and export agreement stats")

    args = parser.parse_args()
    if args.command == "review":
        run_review_session(args.fixtures, args.reviewer_pseudonym, args.seed)
    elif args.command == "report":
        report()
    return 0


if __name__ == "__main__":
    sys.exit(main())
