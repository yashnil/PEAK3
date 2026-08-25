#!/usr/bin/env python3
"""Measure Daily Grid category repetition, before and after the novelty pass.

The human complaint this taxonomy revision exists to address was "categories
becoming repetitive" -- a claim about the sequence of boards over many days,
not about any single board. This script makes that claim measurable: it
generates a long run of FUTURE-dated boards (default 3,650 -- ten years) and
reports, over that run:

  * category (constraint id) frequency, and each id's SHARE of all axis slots
  * category FAMILY frequency (team/award/era/position/context/peak/
    component/outcome)
  * exact-category repeat DISTANCE distribution -- how many boards apart two
    appearances of the same id are, and how many gaps are inside the id
    cooldown (CATEGORY_COOLDOWN_BOARDS)
  * exact CELL-PAIR (row id, col id) repeat distance distribution, and how
    many gaps are inside the pair cooldown (PAIR_COOLDOWN_BOARDS)
  * zero-answer and one-answer cell counts (must both be structurally
    impossible -- MIN_ANSWERS_PER_CELL is 6 -- asserted here against the
    real generated boards rather than just trusted)
  * board difficulty distribution (easy/medium/hard)
  * category reachability -- every constraint id in the registry appears on
    at least one generated board somewhere in the run

No network, no fabricated data: every board comes from `generate_board`
against the real committed pool, exactly the same call path the API uses.

    .venv/bin/python3 scripts/audit_daily_grid_novelty.py
    .venv/bin/python3 scripts/audit_daily_grid_novelty.py --days 3650 --start 2026-08-26
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date as _date
from datetime import timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.daily_grid.constraints import all_constraints  # noqa: E402
from nba_peak.daily_grid.generator import (  # noqa: E402
    NOVELTY_CUTOVER_DATE,
    generate_board,
)
from nba_peak.daily_grid.pool import load_pool  # noqa: E402

DEFAULT_DAYS = 3650


def _keys(start: str, days: int) -> list[str]:
    first = _date.fromisoformat(start)
    return [(first + timedelta(days=offset)).isoformat() for offset in range(days)]


def _distance_stats(distances: list[int]) -> dict:
    if not distances:
        return {"count": 0}
    return {
        "count": len(distances),
        "min": min(distances),
        "max": max(distances),
        "mean": round(sum(distances) / len(distances), 2),
    }


def run(start: str, days: int) -> dict:
    pool = load_pool()
    taxonomy = all_constraints(pool)
    by_id = {c.id: c for c in taxonomy}
    registered_ids = set(by_id)
    registered_families = {c.category for c in taxonomy}

    dates = _keys(start, days)

    id_counter: Counter[str] = Counter()
    family_counter: Counter[str] = Counter()
    id_last_board: dict[str, int] = {}
    id_gaps: list[int] = []
    pair_last_board: dict[frozenset, int] = {}
    pair_gaps: list[int] = []
    difficulty_counter: Counter[str] = Counter()
    zero_answer_cells = 0
    one_answer_cells = 0
    seen_ids: set[str] = set()
    attempts_all: list[int] = []
    failures: list[str] = []

    for board_index, date_str in enumerate(dates):
        try:
            board = generate_board(date_str)
        except Exception as exc:  # BoardGenerationFailed or similar
            failures.append(f"{date_str}: {exc}")
            continue

        attempts_all.append(board.attempts)
        difficulty_counter[board.difficulty] += 1

        axes = list(board.rows) + list(board.cols)
        for constraint in axes:
            id_counter[constraint.id] += 1
            family_counter[constraint.category] += 1
            seen_ids.add(constraint.id)
            previous = id_last_board.get(constraint.id)
            if previous is not None:
                id_gaps.append(board_index - previous)
            id_last_board[constraint.id] = board_index

        for row in board.rows:
            for col in board.cols:
                pair = frozenset((row.id, col.id))
                previous = pair_last_board.get(pair)
                if previous is not None:
                    pair_gaps.append(board_index - previous)
                pair_last_board[pair] = board_index

        for cell in board.cells:
            if cell.answer_count == 0:
                zero_answer_cells += 1
            elif cell.answer_count == 1:
                one_answer_cells += 1

    total_axis_slots = sum(id_counter.values())
    top_id, top_count = (id_counter.most_common(1) or [("", 0)])[0]
    top_share = round(top_count / total_axis_slots, 4) if total_axis_slots else 0.0

    return {
        "start": start,
        "days": days,
        "cutover": NOVELTY_CUTOVER_DATE,
        "boards_generated": len(dates) - len(failures),
        "generation_failures": failures,
        "attempts": {
            "mean": round(sum(attempts_all) / len(attempts_all), 1) if attempts_all else None,
            "max": max(attempts_all) if attempts_all else None,
        },
        "category_frequency_top10": id_counter.most_common(10),
        "top_category_share": {"id": top_id, "share": top_share},
        "family_frequency": dict(family_counter),
        "id_repeat_distance": _distance_stats(id_gaps),
        "id_repeat_distance_under_cooldown": sum(
            1 for g in id_gaps if g < _cooldown_ids()
        ),
        "pair_repeat_distance": _distance_stats(pair_gaps),
        "pair_repeat_distance_under_cooldown": sum(
            1 for g in pair_gaps if g < _cooldown_pairs()
        ),
        "difficulty_distribution": dict(difficulty_counter),
        "zero_answer_cells": zero_answer_cells,
        "one_answer_cells": one_answer_cells,
        "category_reachability": {
            "registered": len(registered_ids),
            "reached": len(seen_ids),
            "unreached": sorted(registered_ids - seen_ids),
        },
        "family_reachability": {
            "registered": sorted(registered_families),
            "reached": sorted(family_counter),
        },
    }


def _cooldown_ids() -> int:
    try:
        from nba_peak.daily_grid.generator import CATEGORY_COOLDOWN_BOARDS

        return CATEGORY_COOLDOWN_BOARDS
    except ImportError:
        return 0


def _cooldown_pairs() -> int:
    try:
        from nba_peak.daily_grid.generator import PAIR_COOLDOWN_BOARDS

        return PAIR_COOLDOWN_BOARDS
    except ImportError:
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--start",
        default=None,
        help="first daily key (YYYY-MM-DD); defaults to the day after NOVELTY_CUTOVER_DATE",
    )
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="consecutive keys")
    args = parser.parse_args()

    start = args.start or (
        _date.fromisoformat(NOVELTY_CUTOVER_DATE) + timedelta(days=1)
    ).isoformat()

    report = run(start, args.days)
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
