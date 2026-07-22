"""
check_ranked_board_corpus.py
------------------------------
Ranked-specific board-generation corpus check (spec section Y "ranked board
corpus"), exercising app.services.ranked.board.generate_ranked_board end to
end (match-id-derived seed, board_type="ranked" tag) rather than the
underlying nba_peak.lineup.board.generate_board directly — this is the
exact code path a real ranked match uses. Checks structural invariants (5x3,
no duplicate players, feasible role completion) and additionally that two
independent calls with the SAME match_id produce a byte-identical board
(the hidden-board-fairness guarantee), and that distinct match_ids never
collide.

Usage (from repo root):
    python scripts/ranked_validation/check_ranked_board_corpus.py --n 1000
"""
from __future__ import annotations

import argparse
import dataclasses
import sys
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"
for p in (REPO_ROOT, API_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.services.ranked.board import generate_ranked_board  # noqa: E402
from nba_peak.lineup.board import _can_fill_all_roles  # noqa: E402
from nba_peak.lineup.config import BOARD_ROUNDS, OFFERS_PER_ROUND, SUPPORTED_MODES  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=1000, help="boards per mode")
    args = parser.parse_args()

    failures: list[str] = []
    total = 0
    seen_seeds: dict[str, set[int]] = {mode: set() for mode in SUPPORTED_MODES}

    for mode in SUPPORTED_MODES:
        for i in range(args.n):
            total += 1
            match_id = str(uuid.uuid4())
            try:
                board = generate_ranked_board(mode, match_id)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{mode} match={match_id}: generation error: {exc}")
                continue

            if board.board_type != "ranked":
                failures.append(f"{mode} match={match_id}: board_type={board.board_type!r}, expected 'ranked'")
            if len(board.rounds) != BOARD_ROUNDS:
                failures.append(f"{mode} match={match_id}: rounds={len(board.rounds)}")
            if any(len(r.offers) != OFFERS_PER_ROUND for r in board.rounds):
                failures.append(f"{mode} match={match_id}: a round != {OFFERS_PER_ROUND} offers")
            pids = [c.player_id for r in board.rounds for c in r.offers]
            if len(pids) != len(set(pids)):
                failures.append(f"{mode} match={match_id}: duplicate players on board")
            if not _can_fill_all_roles([r.offers for r in board.rounds]):
                failures.append(f"{mode} match={match_id}: no valid role-completion path")

            if board.seed in seen_seeds[mode]:
                failures.append(f"{mode} match={match_id}: seed collision ({board.seed}) across distinct match ids")
            seen_seeds[mode].add(board.seed)

    # Determinism spot-check: same match_id -> identical board (ignoring the
    # generated_at timestamp, which is metadata, not board content).
    spot_match_id = str(uuid.uuid4())
    board_a = generate_ranked_board(SUPPORTED_MODES[0], spot_match_id)
    board_b = generate_ranked_board(SUPPORTED_MODES[0], spot_match_id)

    def _strip_ts(b):
        d = dataclasses.asdict(b)
        d["metadata"] = {k: v for k, v in d["metadata"].items() if k != "generated_at"}
        return d

    if _strip_ts(board_a) != _strip_ts(board_b):
        failures.append("determinism spot-check FAILED: same match_id produced different boards")

    print(f"Checked {total} ranked boards across {len(SUPPORTED_MODES)} modes ({args.n} match ids each).")
    print("Determinism spot-check: " + ("PASS" if _strip_ts(board_a) == _strip_ts(board_b) else "FAIL"))
    if failures:
        print(f"FAILED: {len(failures)} problem(s):")
        for f in failures[:20]:
            print(f"  - {f}")
        return 1
    print("PASS: all ranked boards valid (5x3, no dup players, feasible, correctly tagged, no seed collisions).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
