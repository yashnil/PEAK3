"""
ranked_replay.py
-----------------
Independent audit tool: replays the ranked rating ledger from its versioned
initial state and compares the recomputed ratings against what is actually
stored, per queue. Never mutates the database.

The ledger (rating_ledger_entries) is the source of truth (ADR-004 §9); this
tool exists so that claim can be checked mechanically rather than trusted.

Usage (from repo root):
    python scripts/ranked_replay.py --database-url postgresql://... [--mode apex_1y]
    python scripts/ranked_replay.py --database-url postgresql://... --all-modes

Exit 0 if every replayed value matches the stored value exactly (after
rounding to the same precision the ledger itself uses), 1 if any drift is
found or the algorithm does not converge on a stored entry.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"
for p in (REPO_ROOT, API_ROOT):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from app.services.ranked.glicko2 import (  # noqa: E402
    Glicko2ConvergenceError,
    Glicko2Rating,
    rate_match,
)
from app.services.ranked.versions import (  # noqa: E402
    GLICKO2_INITIAL_RATING,
    GLICKO2_INITIAL_RD,
    GLICKO2_INITIAL_VOLATILITY,
    RANKED_QUEUE_MODES,
)


class ReplayDiscrepancy:
    def __init__(self, entry_id: int, owner_sub: str, mode: str, field: str, stored, replayed):
        self.entry_id = entry_id
        self.owner_sub = owner_sub
        self.mode = mode
        self.field = field
        self.stored = stored
        self.replayed = replayed

    def __str__(self) -> str:
        return (
            f"ledger id={self.entry_id} owner={self.owner_sub} mode={self.mode} "
            f"field={self.field}: stored={self.stored} replayed={self.replayed}"
        )


async def _fetch_ledger(pool, mode: str) -> list[dict]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM rating_ledger_entries WHERE mode = $1 ORDER BY id ASC",
            mode,
        )
    return [dict(r) for r in rows]


def replay_mode(entries: list[dict]) -> list[ReplayDiscrepancy]:
    """Pure function: given a mode's ledger entries in id order, recompute
    each user's rating trajectory from the versioned initial state and
    compare against the stored post_* values. No I/O.
    """
    discrepancies: list[ReplayDiscrepancy] = []
    current: dict[str, Glicko2Rating] = {}

    for entry in entries:
        if entry["entry_type"] != "settlement":
            # Reversals/inactivity adjustments are not part of the primary
            # replay chain in this pass; flagged separately by ranked_audit.py.
            continue

        owner_sub = entry["owner_sub"]
        pre = current.get(
            owner_sub,
            Glicko2Rating(rating=GLICKO2_INITIAL_RATING, rd=GLICKO2_INITIAL_RD, volatility=GLICKO2_INITIAL_VOLATILITY),
        )

        # The stored pre_* must itself match our running computed state —
        # otherwise a prior entry was skipped/mutated out of band.
        for field, stored_val, computed_val in (
            ("pre_rating", float(entry["pre_rating"]), pre.rating),
            ("pre_rd", float(entry["pre_rd"]), pre.rd),
            ("pre_volatility", float(entry["pre_volatility"]), pre.volatility),
        ):
            if abs(stored_val - computed_val) > 1e-6:
                discrepancies.append(ReplayDiscrepancy(entry["id"], owner_sub, entry["mode"], field, stored_val, computed_val))

        try:
            recomputed = rate_match(
                pre, float(entry["opponent_pre_rating"]), float(entry["opponent_pre_rd"]), float(entry["outcome"])
            )
        except Glicko2ConvergenceError as exc:
            discrepancies.append(ReplayDiscrepancy(entry["id"], owner_sub, entry["mode"], "convergence", "converged", str(exc)))
            current[owner_sub] = pre
            continue

        for field, stored_val, computed_val in (
            ("post_rating", float(entry["post_rating"]), recomputed.rating),
            ("post_rd", float(entry["post_rd"]), recomputed.rd),
            ("post_volatility", float(entry["post_volatility"]), recomputed.volatility),
        ):
            if abs(stored_val - computed_val) > 1e-4:
                discrepancies.append(ReplayDiscrepancy(entry["id"], owner_sub, entry["mode"], field, stored_val, computed_val))

        current[owner_sub] = recomputed

    return discrepancies


async def main_async(database_url: str, modes: list[str]) -> int:
    import asyncpg

    pool = await asyncpg.create_pool(database_url)
    try:
        total_discrepancies = 0
        for mode in modes:
            entries = await _fetch_ledger(pool, mode)
            discrepancies = replay_mode(entries)
            print(f"[{mode}] {len(entries)} ledger entries replayed, {len(discrepancies)} discrepancies")
            for d in discrepancies:
                print(f"  DRIFT: {d}")
            total_discrepancies += len(discrepancies)
        return 1 if total_discrepancies > 0 else 0
    finally:
        await pool.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--mode", action="append", dest="modes", choices=RANKED_QUEUE_MODES)
    args = parser.parse_args()

    modes = args.modes or list(RANKED_QUEUE_MODES)
    return asyncio.run(main_async(args.database_url, modes))


if __name__ == "__main__":
    sys.exit(main())
