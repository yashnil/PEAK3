"""
ranked_audit.py
----------------
Independent audit tool covering the Phase 4.0 spec's Section N checklist.
Never mutates the database. Reports discrepancies; does not fix them.

Usage (from repo root):
    python scripts/ranked_audit.py --database-url postgresql://...

Exit 0 if every check is clean, 1 if any finding is reported.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


CHECKS: dict[str, str] = {
    "duplicate_settlement_ledger_updates": """
        SELECT owner_sub, match_id, COUNT(*) AS n
        FROM rating_ledger_entries
        WHERE entry_type = 'settlement'
        GROUP BY owner_sub, match_id
        HAVING COUNT(*) > 1
    """,
    "missing_opponent_ledger_entry": """
        SELECT s.match_id, s.participant_a_sub, s.participant_b_sub
        FROM ranked_match_settlements s
        WHERE (
            SELECT COUNT(*) FROM rating_ledger_entries l
            WHERE l.match_id = s.match_id AND l.entry_type = 'settlement'
        ) <> 2
    """,
    "asymmetric_outcomes": """
        SELECT s.match_id, a.outcome AS a_outcome, b.outcome AS b_outcome
        FROM ranked_match_settlements s
        JOIN rating_ledger_entries a ON a.match_id = s.match_id AND a.owner_sub = s.participant_a_sub AND a.entry_type = 'settlement'
        JOIN rating_ledger_entries b ON b.match_id = s.match_id AND b.owner_sub = s.participant_b_sub AND b.entry_type = 'settlement'
        WHERE a.outcome + b.outcome <> 1.0
    """,
    "mismatched_algorithm_versions": """
        SELECT match_id, COUNT(DISTINCT algorithm_version) AS distinct_versions
        FROM rating_ledger_entries
        WHERE entry_type = 'settlement'
        GROUP BY match_id
        HAVING COUNT(DISTINCT algorithm_version) > 1
    """,
    "settlement_without_rating": """
        SELECT s.match_id
        FROM ranked_match_settlements s
        WHERE NOT EXISTS (
            SELECT 1 FROM rating_ledger_entries l WHERE l.match_id = s.match_id AND l.entry_type = 'settlement'
        )
    """,
    "rating_without_settlement": """
        SELECT l.match_id
        FROM rating_ledger_entries l
        WHERE l.entry_type = 'settlement'
        AND NOT EXISTS (
            SELECT 1 FROM ranked_match_settlements s WHERE s.match_id = l.match_id
        )
    """,
    "impossible_placement_counts": """
        SELECT owner_sub, mode, valid_matches_completed, required_matches
        FROM placement_states
        WHERE valid_matches_completed > required_matches
           OR (established = true AND valid_matches_completed < required_matches)
    """,
    "non_rated_game_included": """
        SELECT m.id AS match_id, m.board_snapshot->>'board_type' AS board_type
        FROM ranked_matches m
        WHERE m.board_snapshot->>'board_type' IS NOT NULL
          AND m.board_snapshot->>'board_type' <> 'ranked'
    """,
    "settlement_referencing_mismatched_board": """
        SELECT s.match_id, s.board_version_key, m.board_version_key AS match_board_version_key
        FROM ranked_match_settlements s
        JOIN ranked_matches m ON m.id = s.match_id
        WHERE s.board_version_key IS DISTINCT FROM m.board_version_key
    """,
    "submission_referencing_mismatched_board": """
        SELECT sub.match_id, sub.owner_sub, sub.board_version_key, m.board_version_key AS match_board_version_key
        FROM ranked_match_submissions sub
        JOIN ranked_matches m ON m.id = sub.match_id
        WHERE sub.board_version_key IS DISTINCT FROM m.board_version_key
    """,
    "self_match": """
        SELECT match_id, participant_a_sub, participant_b_sub
        FROM ranked_match_settlements
        WHERE participant_a_sub = participant_b_sub
    """,
    "queue_rating_without_placement_state": """
        SELECT q.owner_sub, q.mode
        FROM queue_ratings q
        LEFT JOIN placement_states p ON p.owner_sub = q.owner_sub AND p.mode = q.mode
        WHERE p.owner_sub IS NULL
    """,
}


async def run_audit(database_url: str) -> int:
    import asyncpg

    pool = await asyncpg.create_pool(database_url)
    findings = 0
    try:
        for name, sql in CHECKS.items():
            async with pool.acquire() as conn:
                rows = await conn.fetch(sql)
            status = "CLEAN" if not rows else f"{len(rows)} FINDING(S)"
            print(f"[{name}] {status}")
            for row in rows[:20]:
                print(f"  {dict(row)}")
            findings += len(rows)
        return 1 if findings > 0 else 0
    finally:
        await pool.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    args = parser.parse_args()
    return asyncio.run(run_audit(args.database_url))


if __name__ == "__main__":
    sys.exit(main())
