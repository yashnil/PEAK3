"""Daily Grid Challenge API endpoints.

Routes:
  GET  /api/v1/daily-grid/board?date=YYYY-MM-DD   - today's (or a given date's) 3x3 board
  GET  /api/v1/daily-grid/search?q=...            - player-season lookup for filling a cell
  POST /api/v1/daily-grid/answer                  - server-side answer validation + scoring
  POST /api/v1/daily-grid/result                  - post-completion comparison vs today's max
  POST /api/v1/daily-grid/official                - save one official result (signed-in only)
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

RATE LIMITED (Phase 11D). Every route here is metered per client per minute --
see `_enforce` below and app/core/rate_limit.py. This is the only router in the
project that carries limits, because it is the only one that answers repeated
questions about a secret it is trying to keep. The limits are set far above
human play (nine squares is ~9 searches) and far below what enumerating an
answer set needs. A limited request is a 429 carrying `Retry-After` and nothing
else: the response never says which bucket was hit or how full it is, because
that is a free calibration signal for whoever is probing.

These handlers are sync `def` on purpose: board generation, search and
validation are CPU-bound over in-process pandas/numpy data with no awaits, so
FastAPI runs them in its threadpool instead of blocking the event loop.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import RequiredAuth
from app.core.dependencies import DailyGridResultRepoDep
from app.models.daily_grid import (
    GRID_SIZE,
    MAX_BOARD_CELLS,
    DailyGridBoardResponse,
    DailyGridSearchResponse,
    GridConstraint,
    GridResultRequest,
    GridResultResponse,
    OfficialResultRequest,
    OfficialResultResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
)
from app.repositories.daily_grid_protocols import DailyGridResult
from app.core.config import settings
from app.core.rate_limit import RateLimitRule, client_key, limiter
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
from nba_peak.daily_grid.search import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    MAX_QUERY_LENGTH,
    search_player_seasons,
)
from nba_peak.daily_grid.validation import InvalidCell, validate_answer

router = APIRouter()

# Longest query string worth evaluating. Anything past this is not a player
# name; the search scans every season in the pool, so the input is bounded
# before it gets there rather than after. Taken from the search module rather
# than restated, so the transport bound and the scan bound cannot drift.
_MAX_QUERY_LENGTH = MAX_QUERY_LENGTH


def _error_detail(message: str, error_code: str) -> dict:
    """Same error envelope the other Arena routers use."""
    return {"error_code": error_code, "message": message}


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def _enforce(request: Request, scope: str, limit: int, *extra: str) -> None:
    """Meter one request, or raise 429.

    `extra` adds dimensions to the bucket key. The search and answer routes
    pass the board date, so hammering one day's board cannot exhaust the budget
    for another -- which keeps a legitimate player who opens an archive board
    from being throttled by whatever they were doing on today's.

    The response is deliberately uninformative beyond "slow down". There is no
    `X-RateLimit-Remaining` on the success path and no bucket name in the error
    body: a running count of how many requests are left is exactly the
    calibration signal a prober wants, and it would let them ride just under
    the limit indefinitely. `Retry-After` is the one thing a well-behaved
    client genuinely needs, and it says nothing about the budget's size.
    """
    if not settings.DAILY_GRID_RATE_LIMIT_ENABLED:
        return
    rule = RateLimitRule(
        limit=limit, window_seconds=settings.DAILY_GRID_RATE_LIMIT_WINDOW_SECONDS
    )
    verdict = limiter.check(client_key(request, scope, *extra), rule)
    _raise_if_denied(verdict)


def _enforce_distinct_dates(request: Request, board_date: str) -> None:
    """Cap how many DIFFERENT board dates one client may pull per window.

    Re-fetching a date already seen in the window is free, so reloading,
    retrying and switching back and forth between today and one archive board
    are all unaffected. What this costs is walking the calendar.
    """
    if not settings.DAILY_GRID_RATE_LIMIT_ENABLED:
        return
    rule = RateLimitRule(
        limit=settings.DAILY_GRID_DATE_ENUMERATION_LIMIT,
        window_seconds=settings.DAILY_GRID_RATE_LIMIT_WINDOW_SECONDS,
    )
    verdict = limiter.check_distinct(
        client_key(request, "daily_grid:dates"), board_date, rule
    )
    _raise_if_denied(verdict)


def _raise_if_denied(verdict) -> None:
    if verdict.allowed:
        return
    raise HTTPException(
        status_code=429,
        detail=_error_detail(
            "Too many Daily Grid requests. Please slow down and try again shortly.",
            "rate_limited",
        ),
        headers={"Retry-After": str(verdict.retry_after_seconds)},
    )


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
    request: Request,
    date: Optional[str] = Query(
        None, max_length=32, description="YYYY-MM-DD (UTC); defaults to today"
    ),
) -> DailyGridBoardResponse:
    """Today's board, or a specific date's.

    Same date, same board, for every player worldwide -- the board is derived
    from a date-seeded generator, not stored, so any date (past or future)
    resolves to the one board that date will ever have.

    Two limits apply. The first is the ordinary per-minute board budget. The
    second caps DISTINCT DATES per client: replaying an archive board is a
    supported feature, so walking the calendar is not blocked, but assembling
    an offline corpus of a year's boards should cost more than one loop. It is
    keyed on the date itself, so re-fetching the SAME date (reload, retry,
    coming back to today) never consumes date-enumeration budget.
    """
    board = _resolve_board(date)
    _enforce(request, "daily_grid:board", settings.DAILY_GRID_BOARD_RATE_LIMIT)
    _enforce_distinct_dates(request, board.date)
    return DailyGridBoardResponse(**board.as_public_dict())


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

@router.get("/daily-grid/search", response_model=DailyGridSearchResponse)
def search_daily_grid(
    request: Request,
    q: str = Query(..., max_length=_MAX_QUERY_LENGTH, description="player name, optionally with a season"),
    date: Optional[str] = Query(
        None, max_length=32, description="YYYY-MM-DD (UTC); defaults to today"
    ),
    row: Optional[int] = Query(None, description="0-2; scope results to a cell"),
    col: Optional[int] = Query(None, description="0-2; required whenever row is given"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, description=f"clamped to {MAX_LIMIT}"),
    used: list[str] = Query(
        default_factory=list,
        max_length=MAX_BOARD_CELLS,
        description="player slugs already placed on this board; marks their seasons `used`",
    ),
) -> DailyGridSearchResponse:
    """Candidate player-seasons for a query.

    With (row, col) supplied the results are RANKED so seasons the player can
    actually use come first -- but unusable ones are still returned and marked
    (`status`, `selectable`), which is what keeps the answer key server-side
    while sparing the player a submit-to-find-out loop. Without them every hit
    comes back `unknown`.

    `used` is the client's own board state, so reporting `status: "used"` tells
    it nothing it did not already know -- and it is reported even for a query
    whose eligibility verdict was withheld.

    A query shorter than the search module's minimum returns an empty list on
    HTTP 200: a half-typed name is not an error, it is just not a query yet.

    Rate limited per client per board date -- this is the endpoint an answer-key
    harvester would actually use, so it carries the tightest budget of the four.
    """
    _enforce(request, "daily_grid:search", settings.DAILY_GRID_SEARCH_RATE_LIMIT, date or "")

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
        used_player_slugs=used,
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
def submit_daily_grid_answer(request: Request, body: SubmitAnswerRequest) -> SubmitAnswerResponse:
    """Check one submitted player-season against one cell.

    The client never holds the answer key, so this is the only thing that
    decides whether a guess is right. An invalid answer is a 200 carrying the
    specific reason it missed -- see the module docstring.

    `used_player_slugs` / `filled_cells` come from the client and enforce the
    one-identity-per-board rule as a convenience guard only (Phase 11A stores
    no server-side board state; local progress is explicitly not cheat-proof,
    CLAUDE.md Security). Constraint validity -- the part that must be right --
    is decided from server data alone.

    Rate limited per client per board date. A player fills nine squares and
    makes some mistakes; a script testing candidate ids against a cell to find
    the answer set makes far more, and this is where that costs something.
    """
    _enforce(request, "daily_grid:answer", settings.DAILY_GRID_ANSWER_RATE_LIMIT, body.date)
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

def _revalidate_completed_board(board: GridBoard, filled) -> None:
    """Prove a claimed-complete board is genuinely complete and genuinely
    valid, or raise 400.

    THE TRUST BOUNDARY for both routes that consume a finished board -- the
    result comparison (which returns answer-key material) and the official save
    (which writes a durable record). Shared rather than duplicated on purpose:
    two copies of "is this board real?" is two chances for one of them to drift
    into being more permissive than the other, and the more permissive one
    would be the one an attacker used.

    Checks, in order:
      - all nine squares present, each exactly once;
      - every answer re-run through the full validator against server data;
      - the no-duplicate-player rule re-checked across the whole board
        (`used` accumulates, so a board reusing an identity is rejected even
        though each square would pass alone).

    Nothing from the client is trusted here beyond the nine (row, col,
    answer_id) triples, and each of those is checked against the server's own
    board.
    """
    expected_cells = MODEL_GRID_SIZE * MODEL_GRID_SIZE
    coords = [(cell.row, cell.col) for cell in filled]
    if len(filled) != expected_cells or len(set(coords)) != expected_cells:
        raise HTTPException(
            status_code=400,
            detail=_error_detail(
                "the result comparison is available once all nine squares are "
                f"locked (got {len(set(coords))} of {expected_cells})",
                "board_incomplete",
            ),
        )

    used: list[str] = []
    for cell in filled:
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

@router.post("/daily-grid/result", response_model=GridResultResponse)
def get_daily_grid_result(request: Request, body: GridResultRequest) -> GridResultResponse:
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

    Rate limited per client per board date. The client calls this once per
    completed board and caches the answer, so the budget is generous; it exists
    because this is the route that RETURNS the key, and a caller who could
    somehow satisfy the validator repeatedly should still not be able to do it
    at machine speed.
    """
    _enforce(request, "daily_grid:result", settings.DAILY_GRID_RESULT_RATE_LIMIT, body.date)
    board = _resolve_board(body.date)
    _revalidate_completed_board(board, body.filled)

    grid_result = build_result(
        board=board,
        filled=[(cell.row, cell.col, cell.answer_id) for cell in body.filled],
        incorrect_attempts=body.incorrect_attempts,
    )
    return GridResultResponse(**grid_result.as_dict())


# ---------------------------------------------------------------------------
# Official account-backed result (Phase 11D)
# ---------------------------------------------------------------------------

@router.post("/daily-grid/official", response_model=OfficialResultResponse)
async def save_official_daily_grid_result(
    request: Request,
    body: OfficialResultRequest,
    auth: RequiredAuth,
    repo: DailyGridResultRepoDep,
) -> OfficialResultResponse:
    """Save one OFFICIAL completed Daily Grid for the signed-in user.

    The durable counterpart to the localStorage archive anonymous players get.
    Local history is not cheat-proof and is explicitly not eligible for ranking
    (CLAUDE.md Security); a row written here was watched by the server.

    WHAT IS ACTUALLY VERIFIED. The whole board is re-validated square by square
    through the SAME helper the result comparison uses
    (`_revalidate_completed_board`), and every stored number -- score, today's
    maximum, percentage, squares matched -- is RECOMPUTED from the board by
    `build_result`. Nothing scored comes from the request body. The client
    cannot report a score at all, so it cannot report a false one.

    The two exceptions are honest and marked as such: `elapsed_seconds` is
    client wall-clock (the server does not time attempts) and `theme` is
    display copy, re-derived from the board rather than trusted. Neither is
    scored. That asymmetry is precisely why the timer must not become a scoring
    term before the server times attempts itself.

    IDEMPOTENT. A second POST for the same board returns the existing record
    with `created: false` and HTTP 200. A daily attempt happens once; a retry
    after a reload or a flaky network is not a new attempt, and letting it
    overwrite would let a player resubmit until they liked the number.

    NOT A LEADERBOARD. Nothing here is public, nothing ranks these rows, and
    there is no read route for anyone but the owner. Phase 11D builds the
    record a leaderboard would need and deliberately stops.
    """
    _enforce(request, "daily_grid:official", settings.DAILY_GRID_RESULT_RATE_LIMIT, body.date)
    board = _resolve_board(body.date)
    _revalidate_completed_board(board, body.filled)

    # Recomputed server-side, exactly as the comparison route does it.
    grid_result = build_result(
        board=board,
        filled=[(cell.row, cell.col, cell.answer_id) for cell in body.filled],
        incorrect_attempts=body.incorrect_attempts,
    )

    record = DailyGridResult(
        id="",
        owner_sub=auth.sub,
        board_id=board.board_id,
        board_date=board.date,
        board_version=board.version,
        # From the server's own board, not from `body.theme` -- the request
        # field exists so a client can echo what it displayed, never so it can
        # decide what is stored.
        board_theme=board.theme,
        score=grid_result.user_total,
        optimal_total=grid_result.optimal_total,
        percent_of_best=grid_result.percent_of_best,
        squares_matching_optimal=grid_result.squares_matching_optimal,
        incorrect_attempts=body.incorrect_attempts,
        elapsed_seconds=body.elapsed_seconds,
        played_on_board_date=board.date == today_utc_date(),
        answers=[cell.answer_id for cell in body.filled],
    )

    saved, created = await repo.save_result(record)
    return OfficialResultResponse(
        official_saved=True,
        created=created,
        board_id=saved.board_id,
        board_date=saved.board_date,
        board_version=saved.board_version,
        score=saved.score,
        optimal_total=saved.optimal_total,
        percent_of_best=saved.percent_of_best,
        squares_matching_optimal=saved.squares_matching_optimal,
        played_on_board_date=saved.played_on_board_date,
        saved_at=saved.created_at.isoformat(),
    )


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
