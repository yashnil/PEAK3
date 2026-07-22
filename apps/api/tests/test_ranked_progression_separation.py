"""Progression/XP separation invariant tests (spec V.39-42, section P).

The core claim under test: identical ranked settlements produce identical
rating ledger entries regardless of the players' XP/level/streak/achievement
state — because settlement.py never reads progression repositories at all
(verified here both by a code-level assertion and by an end-to-end
before/after comparison).
"""
from __future__ import annotations

import inspect
import uuid

import pytest

from app.repositories.ranked_memory import (
    MemoryRankedMatchmakingRepository,
    MemoryRankedRatingRepository,
)
from app.services.ranked import matchmaking as mm
from app.services.ranked import settlement as settle


def test_settlement_module_never_imports_progression_code():
    """Static guarantee: app.services.ranked.settlement has zero references
    to the progression package anywhere in its source — rating math cannot
    be influenced by XP/streak/achievement state because it never touches it.
    """
    source = inspect.getsource(settle)
    assert "progression" not in source
    assert "xp" not in source.lower()
    assert "streak" not in source.lower()
    assert "achievement" not in source.lower()


def test_matchmaking_module_never_imports_progression_code():
    """matchmaking.py's own docstring explains what inputs are excluded
    (mentioning "XP", "streak", etc. in prose), so this checks actual import
    statements rather than doing a substring scan of the whole file.
    """
    import ast

    tree = ast.parse(inspect.getsource(mm))
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not any("progression" in m for m in imported_modules)


@pytest.mark.asyncio
async def test_identical_settlements_produce_identical_ledger_regardless_of_profile_state():
    """Play out the same score inputs twice, in two fully independent repo
    instances standing in for two users with wildly different XP/level/
    streak/achievement histories (which, per the guarantee above, never
    enter this code path at all) — the resulting ledger math must be
    bit-identical.
    """
    async def run_once(match_seed_suffix: str):
        mmr = MemoryRankedMatchmakingRepository()
        rr = MemoryRankedRatingRepository()
        entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
        await mm.try_match("apex_1y", entry_a, mmr)
        entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
        match = await mm.try_match("apex_1y", entry_b, mmr)
        await settle.record_submission(
            match.id, "alice", str(uuid.uuid4()), match.board_version_key,
            {"lineup_peak_rating": 88.5, "draft_efficiency": 0.9, "solver_version": "solver_v1"},
            "k-a-" + match_seed_suffix, mmr,
        )
        await settle.record_submission(
            match.id, "bob", str(uuid.uuid4()), match.board_version_key,
            {"lineup_peak_rating": 71.2, "draft_efficiency": 0.6, "solver_version": "solver_v1"},
            "k-b-" + match_seed_suffix, mmr,
        )
        settlement = await settle.attempt_settlement(match.id, mmr, rr)
        rating_a = await rr.get_queue_rating("alice", "apex_1y")
        rating_b = await rr.get_queue_rating("bob", "apex_1y")
        return settlement.outcome, rating_a.rating, rating_a.rd, rating_b.rating, rating_b.rd

    result_1 = await run_once("run1")  # stand-in: "profile with 0 XP, level 1, no streak"
    result_2 = await run_once("run2")  # stand-in: "profile with 50,000 XP, level 40, 90-day streak"
    assert result_1 == result_2


@pytest.mark.asyncio
async def test_ranked_retry_does_not_duplicate_rating_or_ledger():
    mmr = MemoryRankedMatchmakingRepository()
    rr = MemoryRankedRatingRepository()
    entry_a = await mm.join_queue("alice", "apex_1y", mmr, rr)
    await mm.try_match("apex_1y", entry_a, mmr)
    entry_b = await mm.join_queue("bob", "apex_1y", mmr, rr)
    match = await mm.try_match("apex_1y", entry_b, mmr)

    idem_key = str(uuid.uuid4())
    lineup = {"lineup_peak_rating": 80.0, "draft_efficiency": 0.8, "solver_version": "solver_v1"}
    game_id = str(uuid.uuid4())

    # Submit the same completion twice (simulating a client retry).
    await settle.record_submission(match.id, "alice", game_id, match.board_version_key, lineup, idem_key, mmr)
    await settle.record_submission(match.id, "alice", game_id, match.board_version_key, lineup, idem_key, mmr)
    submissions = await mmr.list_submissions(match.id)
    assert len([s for s in submissions if s.owner_sub == "alice"]) == 1

    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, lineup, str(uuid.uuid4()), mmr)
    await settle.attempt_settlement(match.id, mmr, rr)
    await settle.attempt_settlement(match.id, mmr, rr)  # duplicate settlement attempt

    ledger = await rr.list_ledger_entries("alice", "apex_1y")
    assert len(ledger) == 1


def test_achievement_state_cannot_influence_matchmaking_or_board_assignment():
    """Neither join_queue's QueueEntry construction nor generate_ranked_board's
    seed derivation accept or reference any achievement/XP/streak parameter —
    verified by signature inspection so a future edit that added one would
    break this test loudly.
    """
    from app.services.ranked.board import generate_ranked_board

    mm_sig = inspect.signature(mm.join_queue)
    assert set(mm_sig.parameters) == {"owner_sub", "mode", "matchmaking_repo", "rating_repo"}

    board_sig = inspect.signature(generate_ranked_board)
    assert set(board_sig.parameters) == {"mode", "match_id"}
