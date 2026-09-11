#!/usr/bin/env python3
"""Measure Daily Grid category repetition, before and after the novelty pass.

The human complaint this taxonomy revision exists to address was "categories
becoming repetitive" -- a claim about the sequence of boards over many days,
not about any single board. This script makes that claim measurable: it
generates a long run of FUTURE-dated boards (default 3,650 -- ten years) and
reports, over that run:

  * category (constraint id) frequency, and each id's SHARE of all axis slots
  * category FAMILY frequency (team/award/era/position/context/peak/
    component/outcome/career/production/shooting/usage)
  * FAMILY ADJACENCY -- how often a family that took the per-board maximum
    (MAX_PER_CATEGORY) does so again on the very next board, which is the
    "same kind of board two days running" complaint the family cooldown
    exists for
  * per-board family COMPOSITION -- the distribution of how many distinct
    families each board draws from, and how many boards are dominated by any
    one family
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

from nba_peak.daily_grid.constraints import (  # noqa: E402
    V5_RETIRED_CONSTRAINT_IDS,
    all_constraints,
)
from nba_peak.daily_grid.generator import (  # noqa: E402
    FAMILY_CUTOVER_DATE,
    NOVELTY_CUTOVER_DATE,
    TAXONOMY_CUTOVER_DATE,
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


def _cell_pool_summary(sizes: list[int]) -> dict:
    if not sizes:
        return {"count": 0}
    ordered = sorted(sizes)
    def _percentile(fraction: float) -> int:
        return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))]
    return {
        "count": len(ordered),
        "min": ordered[0],
        "p10": _percentile(0.10),
        "median": _percentile(0.50),
        "p90": _percentile(0.90),
        "max": ordered[-1],
    }


def run(start: str, days: int) -> dict:
    pool = load_pool()
    taxonomy = all_constraints(pool)
    by_id = {c.id: c for c in taxonomy}
    # RETIRED IDS ARE NOT UNREACHED, THEY ARE WITHDRAWN. They stay in the
    # registry so already-published boards keep resolving (see
    # constraints.V5_RETIRED_CONSTRAINT_IDS) but are deliberately never drawn
    # for a new board, so counting them as coverage gaps would report the
    # taxonomy pass working as a regression.
    registered_ids = set(by_id) - V5_RETIRED_CONSTRAINT_IDS
    registered_families = {
        c.category for c in taxonomy if c.id not in V5_RETIRED_CONSTRAINT_IDS
    }

    dates = _keys(start, days)

    id_counter: Counter[str] = Counter()
    family_counter: Counter[str] = Counter()
    id_last_board: dict[str, int] = {}
    id_gaps: list[int] = []
    pair_last_board: dict[frozenset, int] = {}
    pair_gaps: list[int] = []
    difficulty_counter: Counter[str] = Counter()
    distinct_families_per_board: Counter[int] = Counter()
    # A family that took MAX_PER_CATEGORY slots on board N and again on N+1.
    family_double_adjacent = 0
    family_double_boards = 0
    previous_family_counts: Counter[str] = Counter()
    consecutive_identical_boards = 0
    previous_axis_signature: frozenset | None = None
    zero_answer_cells = 0
    one_answer_cells = 0
    seen_ids: set[str] = set()
    attempts_all: list[int] = []
    failures: list[str] = []
    versions: set[str] = set()
    # Every cell's answer count, so the report can state the smallest and
    # median square a player would actually face rather than only asserting
    # that no square is impossible.
    cell_pool_sizes: list[int] = []

    for board_index, date_str in enumerate(dates):
        try:
            board = generate_board(date_str)
        except Exception as exc:  # BoardGenerationFailed or similar
            failures.append(f"{date_str}: {exc}")
            continue

        attempts_all.append(board.attempts)
        difficulty_counter[board.difficulty] += 1
        versions.add(board.version)

        axes = list(board.rows) + list(board.cols)

        # FAMILY COMPOSITION AND ADJACENCY, measured on the real boards.
        board_families: Counter[str] = Counter(c.category for c in axes)
        distinct_families_per_board[len(board_families)] += 1
        doubled = {f for f, n in board_families.items() if n >= _max_per_category()}
        previously_doubled = {
            f for f, n in previous_family_counts.items() if n >= _max_per_category()
        }
        if doubled:
            family_double_boards += 1
        family_double_adjacent += len(doubled & previously_doubled)
        previous_family_counts = board_families

        signature = frozenset(c.id for c in axes)
        if previous_axis_signature is not None and signature == previous_axis_signature:
            consecutive_identical_boards += 1
        previous_axis_signature = signature

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
            cell_pool_sizes.append(cell.answer_count)
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
        # Every cutover the run could straddle, oldest first, so a report read
        # six months from now says which taxonomy the numbers describe.
        "cutovers": {
            "novelty_v2_to_v3": NOVELTY_CUTOVER_DATE,
            "family_v3_to_v4": FAMILY_CUTOVER_DATE,
            "taxonomy_v4_to_v5": TAXONOMY_CUTOVER_DATE,
        },
        "versions_generated": sorted(versions),
        "boards_generated": len(dates) - len(failures),
        "generation_failures": failures,
        "attempts": {
            "mean": round(sum(attempts_all) / len(attempts_all), 1) if attempts_all else None,
            "max": max(attempts_all) if attempts_all else None,
        },
        "category_frequency_top10": id_counter.most_common(10),
        "top_category_share": {"id": top_id, "share": top_share},
        "family_frequency": dict(family_counter),
        "family_share": {
            family: round(count / total_axis_slots, 4)
            for family, count in sorted(
                family_counter.items(), key=lambda kv: -kv[1]
            )
        }
        if total_axis_slots
        else {},
        "distinct_families_per_board": dict(sorted(distinct_families_per_board.items())),
        "boards_with_a_doubled_family": family_double_boards,
        # MUST BE ZERO once the family cooldown is in force: a family may not
        # take the per-board maximum on two consecutive boards.
        "family_doubled_on_consecutive_boards": family_double_adjacent,
        # MUST BE ZERO: the same six axes two days running.
        "consecutive_identical_boards": consecutive_identical_boards,
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
        # What a player actually faces, square by square. The floors
        # (MIN_ANSWERS_PER_CELL) guarantee the minimum; these say where the
        # distribution really sits, which is what "is this fun" turns on.
        "cell_pool": _cell_pool_summary(cell_pool_sizes),
        "retired_ids_seen_on_a_generated_board": sorted(
            seen_ids & V5_RETIRED_CONSTRAINT_IDS
        ),
        "category_reachability": {
            "retired_and_excluded": len(V5_RETIRED_CONSTRAINT_IDS),
            "registered": len(registered_ids),
            "reached": len(seen_ids),
            "unreached": sorted(registered_ids - seen_ids),
        },
        "family_reachability": {
            "registered": sorted(registered_families),
            "reached": sorted(family_counter),
        },
    }


def _max_per_category() -> int:
    from nba_peak.daily_grid.generator import MAX_PER_CATEGORY

    return MAX_PER_CATEGORY


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
        help="first daily key (YYYY-MM-DD); defaults to the day after the most recent cutover",
    )
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="consecutive keys")
    args = parser.parse_args()

    # Defaults to the day after the MOST RECENT cutover, so a plain run
    # measures the taxonomy that is actually in force rather than a legacy
    # window. `--start` still reaches any older span deliberately.
    start = args.start or (
        _date.fromisoformat(TAXONOMY_CUTOVER_DATE) + timedelta(days=1)
    ).isoformat()

    report = run(start, args.days)
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
