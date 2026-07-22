"""Ranked settlement (ADR-004 §5, §9; spec sections H, I).

Settlement is attempted every time a participant's submission is recorded.
It only actually settles once both participants have submitted — otherwise
it is a no-op (the match stays in 'awaiting_opponent' from the completed
participant's perspective). This makes "two simultaneous completion
requests create one result" and "API restart preserves pending settlement"
true by construction: settlement re-derives everything from durably stored
submissions/participants, never from in-process state.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.repositories.ranked_protocols import (
    DuplicateSettlement,
    MatchSubmission,
    PlacementState,
    QueueRating,
    RankedMatchmakingRepository,
    RankedRatingRepository,
    RankedSettlement,
    RatingLedgerEntry,
    RatingPeriod,
)
from app.services.ranked.glicko2 import Glicko2Rating, rate_match
from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    RANKED_SETTLEMENT_ALGORITHM_VERSION,
)

SCORE_DECIMALS = 4  # matches NUMERIC(8,4) column precision — exact comparison basis


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _round(value: float | None, decimals: int = SCORE_DECIMALS) -> float | None:
    return None if value is None else round(value, decimals)


async def record_submission(
    match_id: str,
    owner_sub: str,
    game_id: str,
    board_version_key: str,
    lineup_evaluation: dict,
    idempotency_key: str,
    matchmaking_repo: RankedMatchmakingRepository,
) -> MatchSubmission:
    participant = await matchmaking_repo.get_participant(match_id, owner_sub)
    if participant is None:
        raise ValueError(f"no participant {owner_sub} in match {match_id}")

    submission = MatchSubmission(
        id=str(uuid.uuid4()),
        match_id=match_id,
        participant_id=participant.id,
        owner_sub=owner_sub,
        game_id=game_id,
        board_version_key=board_version_key,
        lineup_evaluation=lineup_evaluation,
        solver_version=lineup_evaluation.get("solver_version", "unknown"),
        submitted_at=_now(),
        idempotency_key=idempotency_key,
    )
    recorded = await matchmaking_repo.record_submission(submission)
    await matchmaking_repo.set_participant_status(match_id, owner_sub, "complete", completed_at=_now())
    return recorded


def _decide_outcome(
    score_a: float, score_b: float, eff_a: float | None, eff_b: float | None,
    solver_a: str, solver_b: str,
) -> tuple[str, str | None]:
    """Returns (outcome, tie_break_used). outcome in {'a_win','b_win','draw'}."""
    if score_a > score_b:
        return "a_win", None
    if score_b > score_a:
        return "b_win", None

    # Exact tie on the primary comparison — try Draft Efficiency, but only
    # if both sides were produced by the same solver version (ADR-004 §5).
    if solver_a == solver_b and eff_a is not None and eff_b is not None:
        if eff_a > eff_b:
            return "a_win", "draft_efficiency"
        if eff_b > eff_a:
            return "b_win", "draft_efficiency"

    return "draw", "none"


async def attempt_settlement(
    match_id: str,
    matchmaking_repo: RankedMatchmakingRepository,
    rating_repo: RankedRatingRepository,
) -> RankedSettlement | None:
    """Attempt to settle a match. Returns the settlement if it just settled
    or was already settled (idempotent), or None if still awaiting the
    other participant's submission.
    """
    existing = await rating_repo.get_settlement(match_id)
    if existing is not None:
        return existing

    match = await matchmaking_repo.get_match(match_id)
    if match is None:
        raise ValueError(f"no such match {match_id}")

    participants = await matchmaking_repo.get_participants(match_id)
    if len(participants) != 2:
        raise ValueError(f"match {match_id} does not have exactly two participants")

    submissions = await matchmaking_repo.list_submissions(match_id)
    if len(submissions) < 2:
        return None  # awaiting the other participant

    by_slot = {p.owner_sub: p for p in participants}
    sub_by_owner = {s.owner_sub: s for s in submissions}
    slot0 = next(p for p in participants if p.slot == 0)
    slot1 = next(p for p in participants if p.slot == 1)
    sub_a, sub_b = sub_by_owner[slot0.owner_sub], sub_by_owner[slot1.owner_sub]
    part_a, part_b = by_slot[slot0.owner_sub], by_slot[slot1.owner_sub]

    # Settlement cannot reference mismatched boards — verified again here
    # (in addition to the DB trigger) so a Postgres-less memory-repo test
    # environment still enforces the invariant.
    if sub_a.board_version_key != match.board_version_key or sub_b.board_version_key != match.board_version_key:
        raise ValueError(f"board_version_key mismatch for match {match_id}")

    score_a = _round(sub_a.lineup_evaluation.get("lineup_peak_rating"))
    score_b = _round(sub_b.lineup_evaluation.get("lineup_peak_rating"))
    eff_a = _round(sub_a.lineup_evaluation.get("draft_efficiency"))
    eff_b = _round(sub_b.lineup_evaluation.get("draft_efficiency"))

    outcome, tie_break_used = _decide_outcome(
        score_a, score_b, eff_a, eff_b, sub_a.solver_version, sub_b.solver_version
    )

    now = _now()
    period = RatingPeriod(
        id=str(uuid.uuid4()), mode=match.mode, queue_version=match.queue_version,
        match_id=match_id, algorithm_version=GLICKO2_ALGORITHM_VERSION, opened_at=now,
    )
    settlement = RankedSettlement(
        id=str(uuid.uuid4()), match_id=match_id, rating_period_id=period.id,
        settlement_algorithm_version=RANKED_SETTLEMENT_ALGORITHM_VERSION,
        board_version_key=match.board_version_key,
        participant_a_sub=part_a.owner_sub, participant_b_sub=part_b.owner_sub,
        participant_a_score=score_a, participant_b_score=score_b,
        participant_a_draft_efficiency=eff_a, participant_b_draft_efficiency=eff_b,
        participant_a_solver_version=sub_a.solver_version, participant_b_solver_version=sub_b.solver_version,
        tie_break_used=tie_break_used, outcome=outcome, created_at=now,
        audit_metadata={
            "primary_comparison_a": score_a, "primary_comparison_b": score_b,
            "draft_efficiency_a": eff_a, "draft_efficiency_b": eff_b,
        },
    )

    # Glicko-2 score convention: 1.0 win, 0.5 draw, 0.0 loss, from each side's
    # own perspective, against the OTHER side's pre-match snapshot (frozen at
    # match creation — ADR-004 §7's one-match-per-period strategy).
    outcome_a = 1.0 if outcome == "a_win" else 0.5 if outcome == "draw" else 0.0
    outcome_b = 1.0 - outcome_a if outcome != "draw" else 0.5

    rating_a = Glicko2Rating(rating=part_a.pre_match_rating, rd=part_a.pre_match_rd, volatility=part_a.pre_match_volatility)
    rating_b = Glicko2Rating(rating=part_b.pre_match_rating, rd=part_b.pre_match_rd, volatility=part_b.pre_match_volatility)

    new_a = rate_match(rating_a, part_b.pre_match_rating, part_b.pre_match_rd, outcome_a)
    new_b = rate_match(rating_b, part_a.pre_match_rating, part_a.pre_match_rd, outcome_b)

    ledger_a = RatingLedgerEntry(
        owner_sub=part_a.owner_sub, mode=match.mode, match_id=match_id, rating_period_id=period.id,
        pre_rating=part_a.pre_match_rating, pre_rd=part_a.pre_match_rd, pre_volatility=part_a.pre_match_volatility,
        opponent_sub=part_b.owner_sub, opponent_pre_rating=part_b.pre_match_rating,
        opponent_pre_rd=part_b.pre_match_rd, opponent_pre_volatility=part_b.pre_match_volatility,
        outcome=outcome_a, post_rating=new_a.rating, post_rd=new_a.rd, post_volatility=new_a.volatility,
        algorithm_version=GLICKO2_ALGORITHM_VERSION, created_at=now,
    )
    ledger_b = RatingLedgerEntry(
        owner_sub=part_b.owner_sub, mode=match.mode, match_id=match_id, rating_period_id=period.id,
        pre_rating=part_b.pre_match_rating, pre_rd=part_b.pre_match_rd, pre_volatility=part_b.pre_match_volatility,
        opponent_sub=part_a.owner_sub, opponent_pre_rating=part_a.pre_match_rating,
        opponent_pre_rd=part_a.pre_match_rd, opponent_pre_volatility=part_a.pre_match_volatility,
        outcome=outcome_b, post_rating=new_b.rating, post_rd=new_b.rd, post_volatility=new_b.volatility,
        algorithm_version=GLICKO2_ALGORITHM_VERSION, created_at=now,
    )

    queue_rating_a = await rating_repo.get_queue_rating(part_a.owner_sub, match.mode)
    queue_rating_b = await rating_repo.get_queue_rating(part_b.owner_sub, match.mode)
    placement_a = await rating_repo.get_placement_state(part_a.owner_sub, match.mode)
    placement_b = await rating_repo.get_placement_state(part_b.owner_sub, match.mode)

    updated_ratings = []
    updated_placements = []
    for rating_state, new_val, placement_state in (
        (queue_rating_a, new_a, placement_a),
        (queue_rating_b, new_b, placement_b),
    ):
        rating_state.rating = new_val.rating
        rating_state.rd = new_val.rd
        rating_state.volatility = new_val.volatility
        rating_state.valid_rated_matches += 1
        rating_state.last_rated_activity_at = now
        # Placement completes independently of established status below; a
        # queue is marked established the moment placement_count is reached,
        # regardless of the exact rating at that instant.
        placement_state.valid_matches_completed += 1
        if placement_state.valid_matches_completed >= placement_state.required_matches and not placement_state.established:
            placement_state.established = True
            placement_state.established_at = now
        rating_state.established = placement_state.established
        updated_ratings.append(rating_state)
        updated_placements.append(placement_state)

    try:
        committed = await rating_repo.commit_settlement(
            period, settlement, [ledger_a, ledger_b], updated_ratings, updated_placements
        )
    except DuplicateSettlement:
        return await rating_repo.get_settlement(match_id)

    await matchmaking_repo.set_match_rating_period(match_id, period.id)
    await matchmaking_repo.set_match_status(match_id, "settled", settlement_status="settled")
    await matchmaking_repo.set_participant_post_match_rating(
        match_id, part_a.owner_sub, new_a.rating, new_a.rd, new_a.volatility
    )
    await matchmaking_repo.set_participant_post_match_rating(
        match_id, part_b.owner_sub, new_b.rating, new_b.rd, new_b.volatility
    )

    return committed


__all__ = ["attempt_settlement", "record_submission"]
