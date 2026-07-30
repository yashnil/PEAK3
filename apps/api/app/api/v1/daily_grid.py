"""Daily Grid Challenge API endpoints (Phase 11A).

Routes:
  GET  /api/v1/daily-grid/board?date=YYYY-MM-DD   - today's (or a given date's) 3x3 board
  GET  /api/v1/daily-grid/search?q=...            - player-season lookup for filling a cell
  POST /api/v1/daily-grid/answer                  - server-side answer validation + scoring
  GET  /api/v1/daily-grid/constraints             - the shipped constraint taxonomy

This router is a thin transport shell. Every rule -- what a board is, what
counts as an answer, what a cell is worth -- lives in nba_peak/daily_grid/,
which is the tested authority; nothing here re-derives or second-guesses it.
No scoring is computed in this layer, and no data is read at request time
beyond the process-cached pool (CLAUDE.md: no network access in a request).

THE ANSWER KEY STAYS SERVER-SIDE. `GridBoard.as_public_dict()` strips it and
`DailyGridBoardResponse` re-states the allowed fields, so a cell exposes only
its two constraint ids and a coarse `rarity_bucket` -- never `answer_ids`,
never the raw answer count. The search route deliberately returns INELIGIBLE
hits too (marked `eligible: false`): silently hiding them would let a player
read the answer set off the search box without ever submitting.

A WRONG ANSWER IS HTTP 200. `POST /answer` returns `{"valid": false, reason,
reason_code}` with a 200 -- guessing wrong is the game working, not a
transport failure. Only a malformed request (bad date, out-of-range cell,
oversized payload) is 4xx.

These handlers are sync `def` on purpose: board generation, search and
validation are CPU-bound over in-process pandas/numpy data with no awaits, so
FastAPI runs them in its threadpool instead of blocking the event loop.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.models.daily_grid import (
    GRID_SIZE,
    DailyGridBoardResponse,
    DailyGridSearchResponse,
    GridConstraint,
    GridResultRequest,
    GridResultResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
)
from nba_peak.daily_grid.constraints import all_constraints
from nba_peak.daily_grid.generator import (
    GRID_SIZE as MODEL_GRID_SIZE,
    GridBoard,
    InvalidGridDate,
    get_board,
    today_utc_date,
    validate_grid_date,
)
from nba_peak.daily_grid.optimal import build_result
from nba_peak.daily_grid.search import MAX_LIMIT, DEFAULT_LIMIT, search_player_seasons
from nba_peak.daily_grid.validation import InvalidCell, validate_answer

router = APIRouter()

# Longest query string worth evaluating. Anything past this is not a player
# name; the search scans every season in the pool, so the input is bounded
# before it gets there rather than after.
_MAX_QUERY_LENGTH = 100


def _error_detail(message: str, error_code: str) -> dict:
    """Same error envelope the other Arena routers use."""
    return {"error_code": error_code, "message": message}


def _resolve_board(date: Optional[str]) -> GridBoard:
    """The board for `date`, or today's (UTC) when omitted.

    `get_board` is process-cached and a pure function of (date, version), so
    repeat requests for the same day cost nothing and can never disagree.
    """
    try:
        board_date = validate_grid_date(date) if date is not None else today_utc_date()
    except InvalidGridDate as exc:
        raise HTTPException(
            status_code=400, detail=_error_detail(str(exc), "invalid_grid_date")
        )
    return get_board(board_date)


def _require_in_bounds(row: int, col: int) -> None:
    if not (0 <= row < GRID_SIZE and 0 <= col < GRID_SIZE):
        raise HTTPException(
            status_code=400,
            detail=_error_detail(
                f"cell ({row}, {col}) is outside the {GRID_SIZE}x{GRID_SIZE} board",
                "invalid_cell",
            ),
        )


# ---------------------------------------------------------------------------
# Board
# ---------------------------------------------------------------------------

@router.get("/daily-grid/board", response_model=DailyGridBoardResponse)
def get_daily_grid_board(
    date: Optional[str] = Query(
        None, max_length=32, description="YYYY-MM-DD (UTC); defaults to today"
    ),
) -> DailyGridBoardResponse:
    """Today's board, or a specific date's.

    Same date, same board, for every player worldwide -- the board is derived
    from a date-seeded generator, not stored, so any date (past or future)
    resolves to the one board that date will ever have.
    """
    board = _resolve_board(date)
    return DailyGridBoardResponse(**board.as_public_dict())


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@router.get("/daily-grid/search", response_model=DailyGridSearchResponse)
def search_daily_grid(
    q: str = Query(..., max_length=_MAX_QUERY_LENGTH, description="player name, optionally with a season"),
    date: Optional[str] = Query(
        None, max_length=32, description="YYYY-MM-DD (UTC); defaults to today"
    ),
    row: Optional[int] = Query(None, description="0-2; scope results to a cell"),
    col: Optional[int] = Query(None, description="0-2; required whenever row is given"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, description=f"clamped to {MAX_LIMIT}"),
) -> DailyGridSearchResponse:
    """Candidate player-seasons for a query.

    With (row, col) supplied the results are RANKED so seasons valid for that
    cell come first -- but invalid ones are still returned and marked, which
    is what keeps the answer key server-side. Without them every hit comes
    back with `eligible: null`.

    A query shorter than the search module's minimum returns an empty list on
    HTTP 200: a half-typed name is not an error, it is just not a query yet.
    """
    if (row is None) != (col is None):
        raise HTTPException(
            status_code=400,
            detail=_error_detail(
                "row and col must be supplied together to scope a search to a cell",
                "incomplete_cell",
            ),
        )

    board: Optional[GridBoard] = None
    if row is not None and col is not None:
        _require_in_bounds(row, col)
        board = _resolve_board(date)
    elif date is not None:
        # Validate it even when unused, so a typo'd date is never silently
        # accepted here and then rejected by /board or /answer.
        _resolve_board(date)

    hits = search_player_seasons(
        query=q,
        board=board,
        row=row,
        col=col,
        limit=min(limit, MAX_LIMIT),
    )
    return DailyGridSearchResponse(
        query=q, results=[hit.as_dict() for hit in hits]
    )


# ---------------------------------------------------------------------------
# Answer submission
# ---------------------------------------------------------------------------

@router.post(
    "/daily-grid/answer",
    response_model=SubmitAnswerResponse,
    response_model_exclude_none=True,
)
def submit_daily_grid_answer(body: SubmitAnswerRequest) -> SubmitAnswerResponse:
    """Check one submitted player-season against one cell.

    The client never holds the answer key, so this is the only thing that
    decides whether a guess is right. An invalid answer is a 200 carrying the
    specific reason it missed -- see the module docstring.

    `used_player_slugs` / `filled_cells` come from the client and enforce the
    one-identity-per-board rule as a convenience guard only (Phase 11A stores
    no server-side board state; local progress is explicitly not cheat-proof,
    CLAUDE.md Security). Constraint validity -- the part that must be right --
    is decided from server data alone.
    """
    board = _resolve_board(body.date)

    try:
        result = validate_answer(
            board=board,
            row=body.row,
            col=body.col,
            answer_id=body.answer_id,
            used_player_slugs=body.used_player_slugs,
            filled_cells=[tuple(cell) for cell in body.filled_cells],
        )
    except InvalidCell as exc:
        # Unreachable through the request model's bounds; kept so a future
        # bounds change cannot turn a bad cell into a 500.
        raise HTTPException(status_code=400, detail=_error_detail(str(exc), "invalid_cell"))

    return SubmitAnswerResponse(**result.as_dict())


# ---------------------------------------------------------------------------
# Result / today's maximum
# ---------------------------------------------------------------------------

@router.post("/daily-grid/result", response_model=GridResultResponse)
def get_daily_grid_result(body: GridResultRequest) -> GridResultResponse:
    """Compare a COMPLETED board against today's maximum.

    THIS IS THE ONLY ROUTE THAT RETURNS ANSWER-KEY MATERIAL, so completion is
    enforced here rather than trusted:

      - all nine squares must be present, each exactly once;
      - every submitted answer is re-run through the full validator against
        server data;
      - the no-duplicate-player rule is re-checked across the whole board.

    A client that has not genuinely finished gets a 400 and learns nothing. It
    would otherwise be trivial to post nine junk ids and read back the
    optimal solution -- which is the whole puzzle.

    Not a GET: the board state is the request body, and a URL carrying nine
    answer ids would end up in logs and browser history.
    """
    board = _resolve_board(body.date)

    expected_cells = MODEL_GRID_SIZE * MODEL_GRID_SIZE
    coords = [(cell.row, cell.col) for cell in body.filled]
    if len(body.filled) != expected_cells or len(set(coords)) != expected_cells:
        raise HTTPException(
            status_code=400,
            detail=_error_detail(
                "the result comparison is available once all nine squares are "
                f"locked (got {len(set(coords))} of {expected_cells})",
                "board_incomplete",
            ),
        )

    # Re-validate every square from scratch. `used_player_slugs` accumulates as
    # we go, so a board that reuses a player identity is rejected here even
    # though each square would pass on its own.
    used: list[str] = []
    for cell in body.filled:
        try:
            result = validate_answer(
                board=board,
                row=cell.row,
                col=cell.col,
                answer_id=cell.answer_id,
                used_player_slugs=used,
            )
        except InvalidCell as exc:
            raise HTTPException(
                status_code=400, detail=_error_detail(str(exc), "invalid_cell")
            )
        if not result.valid or result.player_season is None:
            raise HTTPException(
                status_code=400,
                detail=_error_detail(
                    f"square ({cell.row}, {cell.col}) is not a valid locked answer: "
                    f"{result.reason or 'rejected'}",
                    "board_not_valid",
                ),
            )
        used.append(result.player_season.player_slug)

    grid_result = build_result(
        board=board,
        filled=[(cell.row, cell.col, cell.answer_id) for cell in body.filled],
        incorrect_attempts=body.incorrect_attempts,
    )
    return GridResultResponse(**grid_result.as_dict())


# ---------------------------------------------------------------------------
# Constraint taxonomy
# ---------------------------------------------------------------------------

@router.get("/daily-grid/constraints", response_model=list[GridConstraint])
def get_daily_grid_constraints() -> list[GridConstraint]:
    """Every constraint the game can ever put on an axis.

    Static reference for a methodology/explainer surface. Labels and
    descriptions only -- no answer sets, no counts, so this is safe to serve
    publicly even though it enumerates the whole taxonomy.
    """
    return [GridConstraint(**constraint.as_dict()) for constraint in all_constraints()]
