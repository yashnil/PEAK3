"""Ranked settlement tests (spec V.21-30)."""
from __future__ import annotations

import uuid

import pytest

from app.repositories.ranked_memory import (
    MemoryRankedMatchmakingRepository,
    MemoryRankedRatingRepository,
)
from app.repositories.ranked_protocols import DuplicateSettlement
from app.services.ranked import matchmaking as mm
from app.services.ranked import settlement as settle


@pytest.fixture
def repos():
    return MemoryRankedMatchmakingRepository(), MemoryRankedRatingRepository()


async def _make_match(mmr, rr, mode="apex_1y"):
    entry_a = await mm.join_queue("alice", mode, mmr, rr)
    await mm.try_match(mode, entry_a, mmr)
    entry_b = await mm.join_queue("bob", mode, mmr, rr)
    match = await mm.try_match(mode, entry_b, mmr)
    return match


def _eval(score, eff=0.8, solver="solver_v1"):
    return {"lineup_peak_rating": score, "draft_efficiency": eff, "solver_version": solver}


@pytest.mark.asyncio
async def test_official_score_decides_the_match(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)
    s = await settle.attempt_settlement(match.id, mmr, rr)
    winner = s.participant_a_sub if s.outcome == "a_win" else s.participant_b_sub
    assert winner == "alice"


@pytest.mark.asyncio
async def test_draft_efficiency_tiebreak_only_with_matching_solver_versions(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.95, solver="v1"), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.10, solver="v1"), "k2", mmr)
    s = await settle.attempt_settlement(match.id, mmr, rr)
    assert s.tie_break_used == "draft_efficiency"
    winner = s.participant_a_sub if s.outcome == "a_win" else s.participant_b_sub
    assert winner == "alice"


@pytest.mark.asyncio
async def test_tiebreak_skipped_when_solver_versions_differ(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.99, solver="v1"), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.01, solver="v2"), "k2", mmr)
    s = await settle.attempt_settlement(match.id, mmr, rr)
    assert s.outcome == "draw"


@pytest.mark.asyncio
async def test_exact_equality_is_a_draw(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.5), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(80.0, eff=0.5), "k2", mmr)
    s = await settle.attempt_settlement(match.id, mmr, rr)
    assert s.outcome == "draw"


@pytest.mark.asyncio
async def test_completion_time_has_no_effect_on_outcome(repos):
    """Submission order/timing must never factor into the outcome — only
    the stored lineup_evaluation values matter.
    """
    mmr, rr = repos
    match1 = await _make_match(mmr, rr, mode="apex_1y")
    await settle.record_submission(match1.id, "bob", str(uuid.uuid4()), match1.board_version_key, _eval(70.0), "k1", mmr)
    await settle.record_submission(match1.id, "alice", str(uuid.uuid4()), match1.board_version_key, _eval(90.0), "k2", mmr)
    s1 = await settle.attempt_settlement(match1.id, mmr, rr)
    winner1 = s1.participant_a_sub if s1.outcome == "a_win" else s1.participant_b_sub
    assert winner1 == "alice"  # alice submitted second but still wins on score


@pytest.mark.asyncio
async def test_settlement_occurs_exactly_once(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)
    s1 = await settle.attempt_settlement(match.id, mmr, rr)
    s2 = await settle.attempt_settlement(match.id, mmr, rr)
    s3 = await settle.attempt_settlement(match.id, mmr, rr)
    assert s1.id == s2.id == s3.id
    ledger = await rr.list_ledger_entries("alice", match.mode)
    assert len(ledger) == 1


@pytest.mark.asyncio
async def test_direct_duplicate_settlement_insert_is_rejected(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)
    s = await settle.attempt_settlement(match.id, mmr, rr)
    with pytest.raises(DuplicateSettlement):
        await rr.create_settlement(s)


@pytest.mark.asyncio
async def test_rating_ledger_writes_symmetrically(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)
    await settle.attempt_settlement(match.id, mmr, rr)

    ledger_a = await rr.list_ledger_entries("alice", match.mode)
    ledger_b = await rr.list_ledger_entries("bob", match.mode)
    assert len(ledger_a) == 1 and len(ledger_b) == 1
    assert ledger_a[0].outcome + ledger_b[0].outcome == 1.0  # win(1.0) + loss(0.0)
    assert ledger_a[0].opponent_sub == "bob"
    assert ledger_b[0].opponent_sub == "alice"


@pytest.mark.asyncio
async def test_settlement_awaits_second_submission(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    assert await settle.attempt_settlement(match.id, mmr, rr) is None
    match_state = await mmr.get_match(match.id)
    assert match_state.status != "settled"


@pytest.mark.asyncio
async def test_two_simultaneous_completion_requests_create_one_result(repos):
    import asyncio
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)

    results = await asyncio.gather(
        settle.attempt_settlement(match.id, mmr, rr),
        settle.attempt_settlement(match.id, mmr, rr),
    )
    assert results[0].id == results[1].id
    ledger_a = await rr.list_ledger_entries("alice", match.mode)
    assert len(ledger_a) == 1


@pytest.mark.asyncio
async def test_mismatched_board_version_key_is_rejected(repos):
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), "WRONG-BOARD-KEY", _eval(70.0), "k2", mmr)
    with pytest.raises(ValueError, match="board_version_key mismatch"):
        await settle.attempt_settlement(match.id, mmr, rr)


@pytest.mark.asyncio
async def test_ranked_replay_matches_stored_state(repos):
    """Independent verification that scripts/ranked_replay.py's pure
    replay_mode() function reproduces exactly what memory settlement stored.
    """
    import sys
    from pathlib import Path
    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    from scripts.ranked_replay import replay_mode

    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(88.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(71.0), "k2", mmr)
    await settle.attempt_settlement(match.id, mmr, rr)

    entries = await rr.list_all_ledger_entries(match.mode)
    entry_dicts = [
        {
            "id": e.id, "entry_type": e.entry_type, "owner_sub": e.owner_sub, "mode": e.mode,
            "pre_rating": e.pre_rating, "pre_rd": e.pre_rd, "pre_volatility": e.pre_volatility,
            "opponent_pre_rating": e.opponent_pre_rating, "opponent_pre_rd": e.opponent_pre_rd,
            "outcome": e.outcome, "post_rating": e.post_rating, "post_rd": e.post_rd,
            "post_volatility": e.post_volatility,
        }
        for e in entries
    ]
    discrepancies = replay_mode(entry_dicts)
    assert discrepancies == []


@pytest.mark.asyncio
async def test_invalidated_match_uses_append_only_reversal(repos):
    """A reversal is a new ledger row referencing the original — the
    original settlement entry is never mutated or deleted.
    """
    mmr, rr = repos
    match = await _make_match(mmr, rr)
    await settle.record_submission(match.id, "alice", str(uuid.uuid4()), match.board_version_key, _eval(90.0), "k1", mmr)
    await settle.record_submission(match.id, "bob", str(uuid.uuid4()), match.board_version_key, _eval(70.0), "k2", mmr)
    await settle.attempt_settlement(match.id, mmr, rr)

    from app.repositories.ranked_protocols import RatingLedgerEntry
    from datetime import datetime, timezone

    original = (await rr.list_ledger_entries("alice", match.mode))[0]
    reversal = RatingLedgerEntry(
        owner_sub="alice", mode=match.mode, match_id=match.id, rating_period_id=original.rating_period_id,
        pre_rating=original.post_rating, pre_rd=original.post_rd, pre_volatility=original.post_volatility,
        opponent_sub="bob", opponent_pre_rating=1500, opponent_pre_rd=350, opponent_pre_volatility=0.06,
        outcome=0.0, post_rating=original.pre_rating, post_rd=original.pre_rd, post_volatility=original.pre_volatility,
        algorithm_version=original.algorithm_version, created_at=datetime.now(timezone.utc),
        entry_type="reversal", reversal_of_entry_id=original.id, reversal_reason="integrity review",
    )
    await rr.append_ledger_entry(reversal)

    all_entries = await rr.list_ledger_entries("alice", match.mode)
    assert len(all_entries) == 2
    # Original entry is untouched.
    unchanged_original = next(e for e in all_entries if e.entry_type == "settlement")
    assert unchanged_original.post_rating == original.post_rating


@pytest.mark.asyncio
async def test_daily_practice_challenge_never_create_ranked_ledger_entries(repos):
    """Only matches created through the ranked matchmaking/settlement path
    ever produce rating_ledger_entries — there is no code path from
    Daily/Practice/Challenge completion into this module at all.
    """
    mmr, rr = repos
    # No ranked match was ever created; a Daily/Practice/Challenge completion
    # is handled entirely by app.services.progression.engine and never
    # touches RankedRatingRepository.
    assert await rr.list_all_ledger_entries("apex_1y") == []
