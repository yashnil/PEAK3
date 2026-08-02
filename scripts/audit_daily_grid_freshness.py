#!/usr/bin/env python3
"""Prove that consecutive Daily Grid boards are actually different.

The reported bug was "the board is stale". Measurement, not assumption, is the
only way to answer that, and the answer turned out to be split:

  * board GENERATION was never stale -- over 365 consecutive daily keys the
    seeds, criteria signatures and board ids were 365/365 distinct;
  * the THEME LABEL was -- 25.5 % of adjacent day pairs shared one, runs
    reached six days, `Award Season` took 38.6 % of the year, and `Open Court`
    was unreachable.

This script re-measures all of it, for every identity a player can actually
see, and writes the evidence to
`docs/implementation/daily-grid-freshness-audit.json`. `unintended_duplicates`
is the assertion that matters: it must be empty, and each entry names the
exact field and the exact pair of dates that collided.

No network, no clock dependency, no hidden state: boards are a pure function of
(date, taxonomy version) over committed data, so this run reproduces exactly on
any machine. The window is fixed by default rather than relative to today for
the same reason -- an artifact that changes when you re-run it tomorrow is not
evidence.

    .venv/bin/python3 scripts/audit_daily_grid_freshness.py
    .venv/bin/python3 scripts/audit_daily_grid_freshness.py --start 2027-01-01 --days 365
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date as _date
from datetime import timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.daily_grid.generator import (  # noqa: E402
    DAILY_GRID_VERSION,
    THEME_LABELS,
    get_board,
    theme_candidates,
)
from nba_peak.daily_key import DAILY_TIMEZONE, daily_window  # noqa: E402

# The reported-stale window: 2026-07-31 and 2026-08-01 were identical in both
# theme and difficulty before this pass, so the default span contains the exact
# pair the bug report was about.
DEFAULT_START = "2026-07-01"
DEFAULT_DAYS = 60

OUTPUT_PATH = REPO_ROOT / "docs" / "implementation" / "daily-grid-freshness-audit.json"


def _keys(start: str, days: int) -> list[str]:
    first = _date.fromisoformat(start)
    return [(first + timedelta(days=offset)).isoformat() for offset in range(days)]


def _describe(daily_key: str) -> dict:
    board = get_board(daily_key)
    window = daily_window(daily_key)
    return {
        "daily_key": daily_key,
        "board_id": board.board_id,
        "seed": board.seed,
        "theme_id": board.theme_id,
        "theme": board.theme,
        # Every description that is TRUE of these axes, rarest first. The
        # published `theme_id` is the first of these that was not also true of
        # the previous day's board -- recording the list is what makes that
        # claim checkable rather than assertable.
        "theme_candidates": list(theme_candidates(board.rows, board.cols)),
        "difficulty": board.difficulty,
        "board_hash": board.board_hash,
        "criteria": {
            "rows": [c.id for c in board.rows],
            "cols": [c.id for c in board.cols],
        },
        "starts_at": window.starts_at.isoformat().replace("+00:00", "Z"),
        "ends_at": window.ends_at.isoformat().replace("+00:00", "Z"),
    }


def _duplicates(days: list[dict]) -> list[dict]:
    """Every collision a player could notice, with the pair that caused it.

    Four identities, checked across the WHOLE window rather than pairwise:
    two dates a month apart sharing a criteria signature is the same bug as two
    adjacent ones, it is just harder to see. The theme is checked only on
    ADJACENT days, because a theme is one of eight labels and must repeat
    across a 60-day window -- what must never happen is two neighbours sharing
    one, which is the defect this pass fixed.
    """
    found: list[dict] = []

    for field in ("seed", "board_hash", "board_id", "criteria_signature"):
        seen: dict[str, str] = {}
        for day in days:
            if field == "criteria_signature":
                value = json.dumps(day["criteria"], sort_keys=True)
            else:
                value = str(day[field])
            if value in seen:
                found.append(
                    {
                        "field": field,
                        "dates": [seen[value], day["daily_key"]],
                        "value": value,
                        "why_unintended": (
                            "two distinct daily keys resolve to the same board identity"
                        ),
                    }
                )
            else:
                seen[value] = day["daily_key"]

    for earlier, later in zip(days, days[1:]):
        if earlier["theme_id"] == later["theme_id"]:
            found.append(
                {
                    "field": "theme_id",
                    "dates": [earlier["daily_key"], later["daily_key"]],
                    "value": later["theme_id"],
                    "why_unintended": (
                        "adjacent daily keys published the same theme label -- the "
                        "defect this audit exists to detect (D5)"
                    ),
                }
            )

    return found


def _longest_theme_run(days: list[dict]) -> int:
    longest = run = 1
    for earlier, later in zip(days, days[1:]):
        run = run + 1 if earlier["theme_id"] == later["theme_id"] else 1
        longest = max(longest, run)
    return longest


def build_audit(start: str, days_count: int) -> dict:
    days = [_describe(key) for key in _keys(start, days_count)]
    theme_counts = Counter(day["theme_id"] for day in days)
    difficulty_counts = Counter(day["difficulty"] for day in days)
    adjacent_theme_and_difficulty = sum(
        1
        for a, b in zip(days, days[1:])
        if (a["theme_id"], a["difficulty"]) == (b["theme_id"], b["difficulty"])
    )

    return {
        "generated_by": "scripts/audit_daily_grid_freshness.py",
        "board_version": DAILY_GRID_VERSION,
        "timezone": DAILY_TIMEZONE,
        "window": {"start": start, "days": days_count, "end": days[-1]["daily_key"]},
        "summary": {
            "days": len(days),
            "distinct_seeds": len({d["seed"] for d in days}),
            "distinct_board_hashes": len({d["board_hash"] for d in days}),
            "distinct_board_ids": len({d["board_id"] for d in days}),
            "distinct_criteria_signatures": len(
                {json.dumps(d["criteria"], sort_keys=True) for d in days}
            ),
            "adjacent_pairs": len(days) - 1,
            "adjacent_identical_theme": sum(
                1 for a, b in zip(days, days[1:]) if a["theme_id"] == b["theme_id"]
            ),
            "adjacent_identical_theme_and_difficulty": adjacent_theme_and_difficulty,
            "longest_identical_theme_run": _longest_theme_run(days),
            "min_theme_candidates": min(len(d["theme_candidates"]) for d in days),
            "themes_reachable": len(theme_counts),
            "themes_defined": len(THEME_LABELS),
            "theme_distribution": {
                theme_id: theme_counts.get(theme_id, 0) for theme_id in THEME_LABELS
            },
            "difficulty_distribution": dict(sorted(difficulty_counts.items())),
            "assertions": {
                "every_day_has_a_distinct_seed": len({d["seed"] for d in days}) == len(days),
                "every_day_has_a_distinct_board_hash": (
                    len({d["board_hash"] for d in days}) == len(days)
                ),
                "every_day_has_a_distinct_criteria_signature": (
                    len({json.dumps(d["criteria"], sort_keys=True) for d in days}) == len(days)
                ),
                "no_adjacent_day_repeats_its_theme": all(
                    a["theme_id"] != b["theme_id"] for a, b in zip(days, days[1:])
                ),
                "every_board_has_at_least_two_true_descriptions": (
                    min(len(d["theme_candidates"]) for d in days) >= 2
                ),
            },
        },
        # MUST BE EMPTY. Anything here is a real collision between two dates.
        "unintended_duplicates": _duplicates(days),
        "days": days,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", default=DEFAULT_START, help="first daily key (YYYY-MM-DD)")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="consecutive keys")
    parser.add_argument("--out", default=str(OUTPUT_PATH), help="output JSON path")
    args = parser.parse_args()

    audit = build_audit(args.start, args.days)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(audit, indent=2) + "\n")

    summary = audit["summary"]
    print(f"wrote {out}")
    print(f"  days                        {summary['days']}")
    print(f"  distinct seeds              {summary['distinct_seeds']}")
    print(f"  distinct board hashes       {summary['distinct_board_hashes']}")
    print(f"  distinct criteria           {summary['distinct_criteria_signatures']}")
    print(f"  adjacent identical themes   {summary['adjacent_identical_theme']}")
    print(f"  longest theme run           {summary['longest_identical_theme_run']}")
    print(f"  themes reachable            {summary['themes_reachable']}/{summary['themes_defined']}")
    print(f"  unintended duplicates       {len(audit['unintended_duplicates'])}")

    if audit["unintended_duplicates"]:
        for duplicate in audit["unintended_duplicates"]:
            print(f"    ! {duplicate['field']} {duplicate['dates']}", file=sys.stderr)
        return 1
    if not all(summary["assertions"].values()):
        for name, ok in summary["assertions"].items():
            if not ok:
                print(f"    ! assertion failed: {name}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
