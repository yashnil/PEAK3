"""Ranked duel API endpoints (Phase 4.0).

Routes:
  GET  /api/v1/ranked/readiness                         - safe diagnostic (no auth)
  GET  /api/v1/ranked/queues                            - list queues
  POST /api/v1/ranked/queues/{mode}/join                - join a queue
  POST /api/v1/ranked/queues/{mode}/cancel               - cancel queue entry
  GET  /api/v1/ranked/queues/{mode}/status               - matchmaking status
  GET  /api/v1/ranked/matches/{match_id}                 - match public state
  POST /api/v1/ranked/matches/{match_id}/game            - create/get your game_id
  GET  /api/v1/ranked/matches/{match_id}/game            - your public game state
  POST /api/v1/ranked/matches/{match_id}/actions         - submit an authoritative action
  GET  /api/v1/ranked/matches/{match_id}/settlement      - settled result or pending state
  GET  /api/v1/ranked/queues/{mode}/rating               - your queue rating
  GET  /api/v1/ranked/queues/{mode}/placement            - your placement state
  GET  /api/v1/ranked/queues/{mode}/rating-history       - your rating ledger
  GET  /api/v1/ranked/queues/{mode}/leaderboard          - queue leaderboard
  GET  /api/v1/ranked/queues/{mode}/leaderboard/me       - your surrounding rank

Board state (future offers, reframe branches, opponent picks/score/progress
before settlement) is never included in any response — the same
hidden-information discipline as /draft/* (see app/api/v1/draft.py).
"""
from __future__ import annotations

import dataclasses
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import RequiredAuth
from app.core.config import settings
from app.core.dependencies import (
    AchievementRepoDep,
    GameRepoDep,
    ProgressionRepoDep,
    RankedMatchmakingRepoDep,
    RankedRatingRepoDep,
    RecordRepoDep,
    StreakRepoDep,
)
from app.models.ranked import (
    JoinQueueResponse,
    LeaderboardEntry,
    LeaderboardResponse,
    MatchmakingStatusResponse,
    PendingSettlementResponse,
    PlacementStateResponse,
    QueueRatingResponse,
    RankedMatchPublic,
    RankedParticipantPublic,
    RankedQueueInfo,
    RankedQueuesResponse,
    RankedReadinessResponse,
    RankedSettlementView,
    RatingChange,
    RatingHistoryEntry,
    RatingHistoryResponse,
    SurroundingRankResponse,
)
from app.services.draft import state as state_machine
from app.services.draft.state import DraftError
from app.services.progression.engine import process_game_completion
from app.services.ranked import matchmaking as ranked_matchmaking
from app.services.ranked import settlement as ranked_settlement
from app.services.ranked.board import board_from_dict, create_participant_game_state
from app.services.ranked.versions import (
    GLICKO2_ALGORITHM_VERSION,
    RANKED_QUEUE_LABELS,
    RANKED_QUEUE_MODES,
    RANKED_QUEUE_VERSION,
    division_for_rating,
)

router = APIRouter()


def _error_detail(exc: Exception, default_code: str = "invalid_request") -> dict:
    code = exc.code if isinstance(exc, DraftError) else default_code
    return {"error_code": code, "message": str(exc)}


def _require_ranked_access(auth: RequiredAuth) -> None:
    if not settings.RANKED_ENABLED:
        raise HTTPException(status_code=403, detail={"error_code": "ranked_not_enabled", "message": "Ranked is not enabled."})
    if auth.is_anonymous:
        raise HTTPException(status_code=403, detail={"error_code": "ranked_requires_account", "message": "Ranked requires a signed-in account."})
    allowlist = settings.RANKED_ALPHA_ALLOWLIST
    if allowlist and auth.sub not in allowlist:
        raise HTTPException(status_code=403, detail={"error_code": "not_in_alpha_allowlist", "message": "Ranked is closed-alpha; this account is not on the allowlist."})


def _require_mode(mode: str) -> None:
    if mode not in RANKED_QUEUE_MODES:
        raise HTTPException(status_code=404, detail={"error_code": "unknown_queue", "message": f"Unknown ranked queue '{mode}'"})


# ---------------------------------------------------------------------------
# Readiness (no auth — safe diagnostic, no integrity internals)
# ---------------------------------------------------------------------------

@router.get("/ranked/readiness", response_model=RankedReadinessResponse)
async def get_readiness(rating_repo: RankedRatingRepoDep) -> RankedReadinessResponse:
    pending_matches = await rating_repo.count_pending_settlements()
    last_settlement = await rating_repo.last_settlement_time()
    return RankedReadinessResponse(
        readiness_level=settings.RANKED_READINESS_LEVEL,
        ranked_enabled=settings.RANKED_ENABLED,
        matchmaking_enabled=settings.RANKED_MATCHMAKING_ENABLED,
        rating_writes_enabled=settings.RANKED_RATING_WRITES_ENABLED,
        public_leaderboard_enabled=settings.RANKED_PUBLIC_LEADERBOARD_ENABLED,
        rating_algorithm_version=GLICKO2_ALGORITHM_VERSION,
        queue_versions={mode: RANKED_QUEUE_VERSION for mode in RANKED_QUEUE_MODES},
        pending_match_count=pending_matches,
        pending_rating_count=pending_matches,
        last_successful_settlement_at=last_settlement.isoformat() if last_settlement else None,
    )


# ---------------------------------------------------------------------------
# Queues
# ---------------------------------------------------------------------------

@router.get("/ranked/queues", response_model=RankedQueuesResponse)
async def list_queues() -> RankedQueuesResponse:
    from app.services.ranked.versions import default_queue_versions
    versions = default_queue_versions()
    return RankedQueuesResponse(
        queues=[
            RankedQueueInfo(
                mode=mode, label=RANKED_QUEUE_LABELS[mode],
                queue_version=v.queue_version, rating_algorithm_version=v.rating_algorithm_version,
                placement_count=v.placement_count,
            )
            for mode, v in versions.items()
        ],
        ranked_enabled=settings.RANKED_ENABLED,
        matchmaking_enabled=settings.RANKED_MATCHMAKING_ENABLED,
    )


@router.post("/ranked/queues/{mode}/join", response_model=JoinQueueResponse)
async def join_queue(
    mode: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep, rating_repo: RankedRatingRepoDep
) -> JoinQueueResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    if not settings.RANKED_MATCHMAKING_ENABLED:
        raise HTTPException(status_code=403, detail={"error_code": "matchmaking_disabled", "message": "Matchmaking is not currently enabled."})

    try:
        entry = await ranked_matchmaking.join_queue(auth.sub, mode, matchmaking_repo, rating_repo)
    except Exception as exc:  # ActiveQueueEntryExists
        raise HTTPException(status_code=409, detail={"error_code": "already_in_queue", "message": str(exc)})

    match = await ranked_matchmaking.try_match(mode, entry, matchmaking_repo)
    if match is not None:
        return JoinQueueResponse(status="matched", mode=mode, queue_entry_id=entry.id, match_id=match.id)
    return JoinQueueResponse(status="waiting", mode=mode, queue_entry_id=entry.id)


@router.post("/ranked/queues/{mode}/cancel")
async def cancel_queue(mode: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep) -> dict:
    _require_ranked_access(auth)
    _require_mode(mode)
    cancelled = await matchmaking_repo.cancel_queue_entry(auth.sub, mode)
    return {"cancelled": cancelled}


@router.get("/ranked/queues/{mode}/status", response_model=MatchmakingStatusResponse)
async def queue_status(mode: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep) -> MatchmakingStatusResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    entry = await matchmaking_repo.get_active_queue_entry(auth.sub, mode)
    if entry is None:
        active_matches = await matchmaking_repo.list_active_matches_for_user(auth.sub)
        for m in active_matches:
            if m.mode == mode:
                return MatchmakingStatusResponse(status="matched", mode=mode, match_id=m.id)
        return MatchmakingStatusResponse(status="not_in_queue", mode=mode)
    waited = (datetime.now(timezone.utc) - entry.joined_at).total_seconds()
    return MatchmakingStatusResponse(status="waiting", mode=mode, waited_seconds=waited)


# ---------------------------------------------------------------------------
# Match + game
# ---------------------------------------------------------------------------

async def _get_participant_or_404(match_id: str, auth: RequiredAuth, matchmaking_repo):
    match = await matchmaking_repo.get_match(match_id)
    if match is None:
        raise HTTPException(status_code=404, detail={"error_code": "match_not_found", "message": "No such ranked match."})
    participant = await matchmaking_repo.get_participant(match_id, auth.sub)
    if participant is None:
        raise HTTPException(status_code=403, detail={"error_code": "not_a_participant", "message": "You are not a participant in this match."})
    return match, participant


@router.get("/ranked/matches/{match_id}", response_model=RankedMatchPublic)
async def get_match(match_id: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep) -> RankedMatchPublic:
    _require_ranked_access(auth)
    match, participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)
    participants = await matchmaking_repo.get_participants(match_id)
    opponent = next(p for p in participants if p.owner_sub != auth.sub)

    opponent_status = "hidden"
    if match.status == "settled":
        opponent_status = opponent.status

    return RankedMatchPublic(
        match_id=match.id, mode=match.mode, status=match.status, settlement_status=match.settlement_status,
        deadline=match.deadline.isoformat(),
        you=RankedParticipantPublic(status=participant.status, game_id=participant.game_id),
        opponent_status=opponent_status,
    )


@router.post("/ranked/matches/{match_id}/game")
async def start_or_get_game(match_id: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep, game_repo: GameRepoDep) -> dict:
    _require_ranked_access(auth)
    match, participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)

    if participant.game_id:
        game_state = await game_repo.get_game(participant.game_id)
        if game_state is not None:
            return state_machine.get_public_state(game_state)

    board = board_from_dict(match.board_snapshot)
    game_state = create_participant_game_state(board, match.mode)
    game_id = await game_repo.create_game(game_state)
    game_state.game_id = game_id
    await matchmaking_repo.set_participant_game(match_id, auth.sub, game_id)
    await matchmaking_repo.set_participant_status(match_id, auth.sub, "in_progress")
    return state_machine.get_public_state(game_state)


@router.get("/ranked/matches/{match_id}/game")
async def get_game_state(match_id: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep, game_repo: GameRepoDep) -> dict:
    _require_ranked_access(auth)
    _match, participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)
    if not participant.game_id:
        raise HTTPException(status_code=404, detail={"error_code": "game_not_started", "message": "Game has not been started yet."})
    game_state = await game_repo.get_game(participant.game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail={"error_code": "game_not_found", "message": "Game not found."})
    return state_machine.get_public_state(game_state)


@router.post("/ranked/matches/{match_id}/actions")
async def submit_action(
    match_id: str, body: dict, auth: RequiredAuth,
    matchmaking_repo: RankedMatchmakingRepoDep, rating_repo: RankedRatingRepoDep, game_repo: GameRepoDep,
    progression_repo: ProgressionRepoDep, record_repo: RecordRepoDep,
    achievement_repo: AchievementRepoDep, streak_repo: StreakRepoDep,
) -> dict:
    _require_ranked_access(auth)
    match, participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)
    if not participant.game_id:
        raise HTTPException(status_code=400, detail={"error_code": "game_not_started", "message": "Start the game before submitting actions."})

    game_state = await game_repo.get_game(participant.game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail={"error_code": "game_not_found", "message": "Game not found."})

    action = body.get("action")
    idempotency_key = body.get("idempotency_key")
    try:
        if action == "select_card":
            new_state = state_machine.action_select_card(game_state, body["card_id"], body["role"], idempotency_key)
        elif action == "use_hold":
            new_state = state_machine.action_use_hold(game_state, body["card_id"], idempotency_key)
        elif action == "use_reframe":
            new_state = state_machine.action_use_reframe(game_state, idempotency_key)
        elif action == "confirm":
            new_state = state_machine.action_confirm_after_tool(game_state)
        else:
            raise HTTPException(status_code=400, detail={"error_code": "invalid_action", "message": f"Unknown action '{action}'"})
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await game_repo.save_game(new_state)

    if new_state.status == "draft_complete" and participant.status != "complete":
        await matchmaking_repo.set_participant_status(match_id, auth.sub, "complete", completed_at=datetime.now(timezone.utc))
        lineup_payload = dataclasses.asdict(new_state.lineup_evaluation)
        await ranked_settlement.record_submission(
            match_id, auth.sub, participant.game_id, match.board_version_key,
            lineup_payload, idempotency_key or str(uuid.uuid4()), matchmaking_repo,
        )
        settlement = await ranked_settlement.attempt_settlement(match_id, matchmaking_repo, rating_repo)
        if settlement is None:
            await matchmaking_repo.set_participant_status(match_id, auth.sub, "awaiting_opponent")
        elif settings.RANKED_RATING_WRITES_ENABLED:
            # Participation XP only — identical regardless of outcome/rating/
            # division (ADR-004 §17). Called after the rating ledger
            # transaction has already committed (see settlement.py), and never
            # allowed to raise into the settlement response: a progression
            # failure must not appear as a ranked-match failure to the client.
            try:
                await process_game_completion(
                    owner_sub=auth.sub,
                    result_snapshot=lineup_payload,
                    result_id=settlement.id,
                    board_type="ranked",
                    mode=match.mode,
                    completed_at=datetime.now(timezone.utc),
                    tz_name="UTC",
                    progression_repo=progression_repo,
                    record_repo=record_repo,
                    achievement_repo=achievement_repo,
                    streak_repo=streak_repo,
                )
            except Exception:
                pass

    return state_machine.get_public_state(new_state)


@router.get("/ranked/matches/{match_id}/settlement")
async def get_settlement(
    match_id: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep, rating_repo: RankedRatingRepoDep
):
    _require_ranked_access(auth)
    match, participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)
    settlement = await rating_repo.get_settlement(match_id)
    if settlement is None:
        return PendingSettlementResponse(status="awaiting_opponent", match_id=match_id)

    you_are_a = settlement.participant_a_sub == auth.sub
    your_score = settlement.participant_a_score if you_are_a else settlement.participant_b_score
    opp_score = settlement.participant_b_score if you_are_a else settlement.participant_a_score
    if settlement.outcome == "draw":
        outcome = "draw"
    elif (settlement.outcome == "a_win") == you_are_a:
        outcome = "win"
    else:
        outcome = "loss"

    ledger = await rating_repo.list_ledger_entries(auth.sub, match.mode)
    my_entry = next((e for e in ledger if e.match_id == match_id), None)
    placement = await rating_repo.get_placement_state(auth.sub, match.mode)

    rating_change = RatingChange(
        prior_rating=my_entry.pre_rating if my_entry else participant.pre_match_rating,
        new_rating=my_entry.post_rating if my_entry else participant.pre_match_rating,
        delta=(my_entry.post_rating - my_entry.pre_rating) if my_entry else 0.0,
        prior_rd=my_entry.pre_rd if my_entry else participant.pre_match_rd,
        new_rd=my_entry.post_rd if my_entry else participant.pre_match_rd,
    )
    placement_progress = None
    if not placement.established:
        placement_progress = f"Placement {placement.valid_matches_completed} of {placement.required_matches}"

    return RankedSettlementView(
        match_id=match_id, outcome=outcome, your_score=your_score, opponent_score=opp_score,
        tie_break_used=settlement.tie_break_used, rating_change=rating_change,
        placement_progress=placement_progress, division_change=None,
        settled_at=settlement.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Rating / placement / history
# ---------------------------------------------------------------------------

@router.get("/ranked/queues/{mode}/rating", response_model=QueueRatingResponse)
async def get_rating(mode: str, auth: RequiredAuth, rating_repo: RankedRatingRepoDep) -> QueueRatingResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    rating = await rating_repo.get_queue_rating(auth.sub, mode)
    placement = await rating_repo.get_placement_state(auth.sub, mode)

    if not placement.established:
        return QueueRatingResponse(
            mode=mode, established=False, rating=None, rd=None,
            uncertainty_label="still in placements", valid_rated_matches=rating.valid_rated_matches,
        )
    label = "provisional" if rating.rd > 100 else "established"
    return QueueRatingResponse(
        mode=mode, established=True, rating=rating.rating, rd=rating.rd, uncertainty_label=label,
        valid_rated_matches=rating.valid_rated_matches,
        division=division_for_rating(rating.rating, rating.valid_rated_matches),
    )


@router.get("/ranked/queues/{mode}/placement", response_model=PlacementStateResponse)
async def get_placement(mode: str, auth: RequiredAuth, rating_repo: RankedRatingRepoDep) -> PlacementStateResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    placement = await rating_repo.get_placement_state(auth.sub, mode)
    return PlacementStateResponse(
        mode=mode, valid_matches_completed=placement.valid_matches_completed,
        required_matches=placement.required_matches, established=placement.established,
    )


@router.get("/ranked/queues/{mode}/rating-history", response_model=RatingHistoryResponse)
async def get_rating_history(mode: str, auth: RequiredAuth, rating_repo: RankedRatingRepoDep) -> RatingHistoryResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    entries = await rating_repo.list_ledger_entries(auth.sub, mode)
    return RatingHistoryResponse(
        mode=mode,
        entries=[
            RatingHistoryEntry(
                match_id=e.match_id,
                outcome="win" if e.outcome == 1.0 else "draw" if e.outcome == 0.5 else "loss",
                pre_rating=e.pre_rating, post_rating=e.post_rating, delta=e.post_rating - e.pre_rating,
                created_at=e.created_at.isoformat(),
            )
            for e in entries
        ],
    )


# ---------------------------------------------------------------------------
# Leaderboard
#
# The pagination cursor must encode the FULL ranking key of the last row on
# the previous page — rating, RD, valid_rated_matches, owner_sub — not just
# rating+owner_sub. Dropping rd/valid_rated_matches let a row with a tied
# rating re-appear across a page boundary (caught by
# test_ranked_placements_leaderboard.py::test_cursor_pagination_is_stable).
# ---------------------------------------------------------------------------

def _build_leaderboard_cursor(rating) -> str:
    return f"{rating.rating}|{rating.rd}|{rating.valid_rated_matches}|{rating.owner_sub}"


def _parse_leaderboard_cursor(cursor: str | None) -> tuple[float, float, int, str] | None:
    if not cursor:
        return None
    rating_str, rd_str, valid_matches_str, owner = cursor.split("|", 3)
    return float(rating_str), float(rd_str), int(valid_matches_str), owner

@router.get("/ranked/queues/{mode}/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(mode: str, rating_repo: RankedRatingRepoDep, cursor: str | None = None, limit: int = 50) -> LeaderboardResponse:
    _require_mode(mode)
    if not settings.RANKED_PUBLIC_LEADERBOARD_ENABLED:
        return LeaderboardResponse(
            mode=mode, enabled=False, entries=[], updated_at=datetime.now(timezone.utc).isoformat(),
            queue_version=RANKED_QUEUE_VERSION, rating_algorithm_version=GLICKO2_ALGORITHM_VERSION,
        )
    after = _parse_leaderboard_cursor(cursor)
    ratings = await rating_repo.get_leaderboard(mode, limit, after)
    entries = [
        LeaderboardEntry(rank=i + 1, owner_sub=r.owner_sub, rating=r.rating, rd=r.rd, division=division_for_rating(r.rating, r.valid_rated_matches))
        for i, r in enumerate(ratings)
        if r.established
    ]
    next_cursor = _build_leaderboard_cursor(ratings[-1]) if len(ratings) == limit else None
    return LeaderboardResponse(
        mode=mode, enabled=True, entries=entries, next_cursor=next_cursor,
        updated_at=datetime.now(timezone.utc).isoformat(),
        queue_version=RANKED_QUEUE_VERSION, rating_algorithm_version=GLICKO2_ALGORITHM_VERSION,
    )


@router.get("/ranked/queues/{mode}/leaderboard/me", response_model=SurroundingRankResponse)
async def get_surrounding_rank(mode: str, auth: RequiredAuth, rating_repo: RankedRatingRepoDep) -> SurroundingRankResponse:
    _require_ranked_access(auth)
    _require_mode(mode)
    if not settings.RANKED_PUBLIC_LEADERBOARD_ENABLED:
        return SurroundingRankResponse(mode=mode, your_rank=None, entries=[])

    all_ratings = await rating_repo.get_leaderboard(mode, 100_000, None)
    established = [r for r in all_ratings if r.established]
    idx = next((i for i, r in enumerate(established) if r.owner_sub == auth.sub), None)
    if idx is None:
        return SurroundingRankResponse(mode=mode, your_rank=None, entries=[])

    window = established[max(0, idx - 2): idx + 3]
    start_rank = max(0, idx - 2) + 1
    entries = [
        LeaderboardEntry(rank=start_rank + i, owner_sub=r.owner_sub, rating=r.rating, rd=r.rd, division=division_for_rating(r.rating, r.valid_rated_matches))
        for i, r in enumerate(window)
    ]
    return SurroundingRankResponse(mode=mode, your_rank=idx + 1, entries=entries)


# ---------------------------------------------------------------------------
# Debug-only test oracle — NEVER available outside DEBUG mode.
#
# Playwright e2e fixtures need a deterministic, always-completable play-
# through, but a real player can only see one round at a time and a naive
# greedy strategy can legitimately dead-end on a board that is only
# feasible via a specific role ordering (see nba_peak.lineup.board.
# _can_fill_all_roles — feasibility is proven by backtracking over the
# whole board, not by every greedy round-by-round path). This endpoint lets
# the e2e suite read the full board once, offline, to script a guaranteed-
# valid play-through — mirroring the same oracle technique already used in
# apps/api/tests/test_ranked_placements_leaderboard.py. It is not part of
# the hidden-information contract participants rely on in production: it
# is 404 whenever DEBUG is not enabled, matching the closed-alpha-only
# posture of the rest of Phase 4.0.
# ---------------------------------------------------------------------------

@router.get("/ranked/_debug/matches/{match_id}/board")
async def debug_get_match_board(match_id: str, auth: RequiredAuth, matchmaking_repo: RankedMatchmakingRepoDep) -> dict:
    if not settings.DEBUG:
        raise HTTPException(status_code=404, detail={"error_code": "not_found", "message": "Not found."})
    match, _participant = await _get_participant_or_404(match_id, auth, matchmaking_repo)
    return match.board_snapshot
