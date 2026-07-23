"""82-0 Peak Season / CourtBuilder API endpoints (Phase 5C vertical slice).

Routes:
  GET  /api/v1/perfect-season/readiness           - safe diagnostic (no auth)
  POST /api/v1/perfect-season/games               - create a new practice game
  GET  /api/v1/perfect-season/games/{id}          - get current public state
  POST /api/v1/perfect-season/games/{id}/select   - select a candidate player
  POST /api/v1/perfect-season/games/{id}/cancel   - cancel the pending selection, back to candidates
  POST /api/v1/perfect-season/games/{id}/place    - place the pending selection into a slot
  POST /api/v1/perfect-season/games/{id}/complete - run the v0 simulation and freeze the result

No exact PEAK3 score/rank for any un-placed candidate is ever included in any
response (ADR-005 Decision 6) -- see app/services/perfect_season/state.py's
get_public_state for the enforcement point. Every route is gated behind
COURTBUILDER_ENABLED / COURTBUILDER_ALPHA_ALLOWLIST -- see
docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md Decision 7.

CourtBuilder is anonymous-friendly by design (ADR-005 Decision 1): unlike
ranked, this router uses OptionalAuth + resolve_owner_sub, never requires a
signed-in account.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Query, Response

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.dependencies import CourtLineupRepoDep
from app.models.perfect_season import (
    CancelSelectionRequest,
    CompleteGameRequest,
    CourtBuilderCoverageSummary,
    CourtBuilderReadinessResponse,
    CreatePerfectSeasonGameRequest,
    PlaceCardRequest,
    PublicCourtStateResponse,
    SelectPlayerRequest,
)
from app.services.perfect_season import state as state_machine
from app.services.perfect_season.state import CourtError
from nba_peak.perfect_season.board import coverage_summary, interim_team_summary
from nba_peak.perfect_season.config import SUPPORTED_MODES

router = APIRouter()


def _error_detail(exc: Exception, default_code: str = "invalid_request") -> dict:
    code = exc.code if isinstance(exc, CourtError) else default_code
    return {"error_code": code, "message": str(exc)}


def _require_courtbuilder_enabled() -> None:
    if not settings.COURTBUILDER_ENABLED:
        raise HTTPException(
            status_code=403,
            detail={"error_code": "courtbuilder_not_enabled", "message": "CourtBuilder is not enabled."},
        )


def _check_allowlist(owner_sub: str) -> None:
    allowlist = settings.COURTBUILDER_ALPHA_ALLOWLIST
    if allowlist and owner_sub not in allowlist:
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "not_in_alpha_allowlist",
                "message": "CourtBuilder is closed-alpha; this session is not on the allowlist.",
            },
        )


# ---------------------------------------------------------------------------
# Readiness (no auth -- safe diagnostic, no integrity internals)
# ---------------------------------------------------------------------------

@router.get("/perfect-season/readiness", response_model=CourtBuilderReadinessResponse)
async def get_readiness(
    mode: str = Query("apex_1y", description="Mode to compute duration-aware coverage for"),
) -> CourtBuilderReadinessResponse:
    summary = interim_team_summary()
    if mode not in SUPPORTED_MODES:
        mode = "apex_1y"
    coverage = coverage_summary(mode)
    return CourtBuilderReadinessResponse(
        readiness_level=settings.COURTBUILDER_READINESS_LEVEL,
        courtbuilder_enabled=settings.COURTBUILDER_ENABLED,
        team_spin_enabled=settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        interim_team_data_version=summary["dataset_version"] or "unavailable",
        interim_team_franchise_count=summary["franchise_count"],
        interim_team_franchise_names=summary["franchise_names"],
        coverage=CourtBuilderCoverageSummary(**coverage),
    )


# ---------------------------------------------------------------------------
# Create game
# ---------------------------------------------------------------------------

@router.post("/perfect-season/games", response_model=PublicCourtStateResponse)
async def create_game(
    body: CreatePerfectSeasonGameRequest,
    auth: OptionalAuth,
    response: Response,
    court_repo: CourtLineupRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    _check_allowlist(owner_sub)

    if body.mode not in SUPPORTED_MODES:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_mode", "message": f"Unknown mode '{body.mode}'"},
        )

    try:
        game_state = state_machine.create_perfect_season_game(
            mode=body.mode,
            seed=body.seed,
            team_spin_enabled=settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        )
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_state.owner_sub = owner_sub
    game_id = await court_repo.create_lineup(game_state)
    game_state.game_id = game_id
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Get game state
# ---------------------------------------------------------------------------

@router.get("/perfect-season/games/{game_id}", response_model=PublicCourtStateResponse)
async def get_game(game_id: str, court_repo: CourtLineupRepoDep) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Select / place / complete
# ---------------------------------------------------------------------------

@router.post("/perfect-season/games/{game_id}/select", response_model=PublicCourtStateResponse)
async def select_player(
    game_id: str,
    body: SelectPlayerRequest,
    court_repo: CourtLineupRepoDep,
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    try:
        new_state = state_machine.action_select_player(game_state, body.player_slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state))


@router.post("/perfect-season/games/{game_id}/cancel", response_model=PublicCourtStateResponse)
async def cancel_selection(
    game_id: str,
    body: CancelSelectionRequest,
    court_repo: CourtLineupRepoDep,
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    try:
        new_state = state_machine.action_cancel_selection(game_state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state))


@router.post("/perfect-season/games/{game_id}/place", response_model=PublicCourtStateResponse)
async def place_card(
    game_id: str,
    body: PlaceCardRequest,
    court_repo: CourtLineupRepoDep,
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    try:
        new_state = state_machine.action_place_card(game_state, body.slot_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state))


@router.post("/perfect-season/games/{game_id}/complete", response_model=PublicCourtStateResponse)
async def complete_game(
    game_id: str,
    body: CompleteGameRequest,
    court_repo: CourtLineupRepoDep,
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    try:
        new_state = state_machine.action_complete_game(game_state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state))
