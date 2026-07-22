"""Durable history endpoints.

Routes:
  GET  /api/v1/history              — paginated result history for authenticated user
  GET  /api/v1/history/{result_id}  — single historical result snapshot
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import RequiredAuth
from app.core.dependencies import DailyCompletionRepoDep, ResultSnapshotRepoDep

router = APIRouter()


class HistoryItem(BaseModel):
    id: str
    board_type: str
    mode: str
    date: Optional[str] = None
    board_id: str
    lineup_peak_rating: float
    draft_efficiency: Optional[float] = None
    board_percentile: Optional[float] = None
    hold_used: Optional[bool] = None
    reframe_used: Optional[bool] = None
    completed_at: str


class HistoryResponse(BaseModel):
    items: list[HistoryItem]
    next_cursor: Optional[str] = None
    total: int


class ResultSnapshotResponse(BaseModel):
    id: str
    board_type: str
    mode: str
    board_id: str
    lineup_peak_rating: float
    draft_efficiency: Optional[float] = None
    board_percentile: Optional[float] = None
    completed_at: str
    payload: dict


# ---------------------------------------------------------------------------
# GET /history
# ---------------------------------------------------------------------------


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    auth: RequiredAuth,
    result_repo: ResultSnapshotRepoDep,
    daily_repo: DailyCompletionRepoDep,
    limit: int = Query(default=20, ge=1, le=100),
    before_id: Optional[str] = Query(default=None),
) -> HistoryResponse:
    """Return paginated result history for the authenticated user.

    Results are sourced from result_snapshots (all game types) and daily_completions.
    Daily completions include hold/reframe metadata.
    """
    results = await result_repo.list_results(auth.sub, limit=limit + 1, before_id=before_id)
    daily_completions = await daily_repo.list_completions(auth.sub, limit=200)
    completions = {c.board_id: c for c in daily_completions}

    has_more = len(results) > limit
    results = results[:limit]

    items = []
    for r in results:
        completion = completions.get(r.board_id)
        items.append(HistoryItem(
            id=r.id,
            board_type=r.board_type,
            mode=r.mode,
            date=r.payload.get("date"),
            board_id=r.board_id,
            lineup_peak_rating=r.lineup_peak_rating,
            draft_efficiency=r.draft_efficiency,
            board_percentile=r.board_percentile,
            hold_used=completion.hold_used if completion else None,
            reframe_used=completion.reframe_used if completion else None,
            completed_at=r.completed_at.isoformat() if hasattr(r.completed_at, "isoformat") else r.completed_at,
        ))

    next_cursor = results[-1].id if has_more and items else None

    return HistoryResponse(
        items=items,
        next_cursor=next_cursor,
        total=len(items),
    )


# ---------------------------------------------------------------------------
# GET /history/{result_id}
# ---------------------------------------------------------------------------


@router.get("/history/{result_id}", response_model=ResultSnapshotResponse)
async def get_result_snapshot(
    result_id: str,
    auth: RequiredAuth,
    result_repo: ResultSnapshotRepoDep,
) -> ResultSnapshotResponse:
    """Return a single historical result snapshot.

    Only the owner can access their own snapshots.
    The payload is the immutable result stored at completion time.
    """
    result = await result_repo.get_result(result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="result_not_found")

    if result.owner_sub != auth.sub:
        raise HTTPException(status_code=403, detail="access_denied")

    return ResultSnapshotResponse(
        id=result.id,
        board_type=result.board_type,
        mode=result.mode,
        board_id=result.board_id,
        lineup_peak_rating=result.lineup_peak_rating,
        draft_efficiency=result.draft_efficiency,
        board_percentile=result.board_percentile,
        completed_at=result.completed_at.isoformat() if hasattr(result.completed_at, "isoformat") else result.completed_at,
        payload=result.payload,
    )
