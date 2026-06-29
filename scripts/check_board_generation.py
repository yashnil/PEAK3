#!/usr/bin/env python3
"""Quick board-generation smoke check for Peak Draft.

Generates a small corpus of boards per mode and asserts the structural
invariants: 5 rounds x 3 offers, no duplicate players, and at least one valid
role-completion path. Intended for CI / `make test-board-generation` — for the
full statistical corpus see reports/board_generation/.

Exit code 0 if all boards are valid, 1 otherwise.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from nba_peak.lineup.board import BoardConfig, generate_board
from nba_peak.lineup.config import BOARD_ROUNDS, OFFERS_PER_ROUND, SUPPORTED_MODES
from nba_peak.lineup.solver import _enumerate_all_selections

SECRET = "board-check-secret"
SEEDS_PER_MODE = int(sys.argv[1]) if len(sys.argv) > 1 else 25


def main() -> int:
    failures: list[str] = []
    total = 0
    for mode in SUPPORTED_MODES:
        for seed in range(1, SEEDS_PER_MODE + 1):
            total += 1
            cfg = BoardConfig(mode=mode, board_type="practice", date=None, seed=seed)
            try:
                board = generate_board(cfg, signing_secret=SECRET)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{mode} seed={seed}: generation error: {exc}")
                continue
            if len(board.rounds) != BOARD_ROUNDS:
                failures.append(f"{mode} seed={seed}: rounds={len(board.rounds)}")
            if any(len(r.offers) != OFFERS_PER_ROUND for r in board.rounds):
                failures.append(f"{mode} seed={seed}: a round != {OFFERS_PER_ROUND} offers")
            pids = [c.player_id for r in board.rounds for c in r.offers]
            if len(pids) != len(set(pids)):
                failures.append(f"{mode} seed={seed}: duplicate players on board")
            if not _enumerate_all_selections(board):
                failures.append(f"{mode} seed={seed}: no valid role-completion path")

    print(f"Checked {total} boards across {len(SUPPORTED_MODES)} modes ({SEEDS_PER_MODE} seeds each).")
    if failures:
        print(f"FAILED: {len(failures)} problem(s):")
        for f in failures[:20]:
            print(f"  - {f}")
        return 1
    print("PASS: all boards valid (5x3, no dup players, feasible).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
