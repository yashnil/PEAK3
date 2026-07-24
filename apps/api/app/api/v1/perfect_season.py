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
from nba_peak.perfect_season.board import coverage_summary, experimental_team_year_summary, interim_team_summary
from nba_peak.perfect_season.config import SLOT_TYPES, SUPPORTED_MODES
from nba_peak.perfect_season.exact_season import TEAM_ID_TO_NAME, resolve_player_season_card
from nba_peak.perfect_season.simulation import compute_exact_fit_components, simulate_exact_season
from pydantic import BaseModel

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
    team_year_summary = experimental_team_year_summary()
    return CourtBuilderReadinessResponse(
        readiness_level=settings.COURTBUILDER_READINESS_LEVEL,
        courtbuilder_enabled=settings.COURTBUILDER_ENABLED,
        team_spin_enabled=settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        interim_team_data_version=summary["dataset_version"] or "unavailable",
        interim_team_franchise_count=summary["franchise_count"],
        interim_team_franchise_names=summary["franchise_names"],
        coverage=CourtBuilderCoverageSummary(**coverage),
        team_year_enabled=settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
        experimental_team_year_data_version=team_year_summary["dataset_version"] or "unavailable",
        experimental_team_year_franchise_count=team_year_summary["franchise_count"],
        experimental_team_year_franchise_names=team_year_summary["franchise_names"],
        experimental_team_year_season_count=team_year_summary["season_count"],
        experimental_team_year_season_labels=team_year_summary["season_labels"],
        total_team_season_count=team_year_summary.get("total_team_season_count", 0),
        rollable_team_season_count=team_year_summary.get("rollable_team_season_count", 0),
        min_candidates_per_team_season=team_year_summary.get("min_candidates", 0),
        max_candidates_per_team_season=team_year_summary.get("max_candidates", 0),
        median_candidates_per_team_season=team_year_summary.get("median_candidates", 0.0),
        open_pool_enabled=False,
        sample_supported_team_seasons=team_year_summary.get("sample_supported_team_seasons", []),
        low_coverage_team_seasons=team_year_summary.get("low_coverage_team_seasons", []),
        season_2025_26_coverage_status=team_year_summary.get("season_2025_26_coverage_status", "not_covered"),
        warnings=team_year_summary.get("warnings", []),
        supported_franchise_count=team_year_summary.get("franchise_count", 0),
        teams_represented_in_spinner=team_year_summary.get("franchise_ids", []),
        seasons_represented_in_spinner=team_year_summary.get("seasons_represented", []),
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
            team_year_enabled=settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
        )
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_state.owner_sub = owner_sub
    game_id = await court_repo.create_lineup(game_state)
    game_state.game_id = game_id
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


# ---------------------------------------------------------------------------
# Get game state
# ---------------------------------------------------------------------------

@router.get("/perfect-season/games/{game_id}", response_model=PublicCourtStateResponse)
async def get_game(game_id: str, court_repo: CourtLineupRepoDep) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


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
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


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
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


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
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


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
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


# ---------------------------------------------------------------------------
# Phase 6F Part G: developer-only manual lineup simulator (bypasses the
# spinner entirely). Gated OFF by default -- never exposed publicly unless a
# human explicitly sets PEAK3_DEV_TOOLS_ENABLED=true or
# PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev. Uses the SAME
# resolve_player_season_card/simulate_exact_season the real game uses -- no
# separate/duplicated scoring logic. Prefer scripts/simulate_peak_season_lineup.py
# for actual calibration work; this endpoint exists for quick in-browser/
# API-client checks in a local dev environment.
# ---------------------------------------------------------------------------

class DevSlotInput(BaseModel):
    slot: str
    player_slug: str
    season: str
    team: str  # team_id (e.g. "GSW") or exact display name (e.g. "Golden State Warriors")


class DevSimulateLineupRequest(BaseModel):
    slots: list[DevSlotInput]
    allow_unscored: bool = False


def _dev_tools_enabled() -> bool:
    return settings.DEV_TOOLS_ENABLED or settings.COURTBUILDER_READINESS_LEVEL == "internal_dev"


def _resolve_dev_team_id(raw: str) -> Optional[str]:
    if raw.upper() in TEAM_ID_TO_NAME:
        return raw.upper()
    key = raw.lower().replace(" ", "-")
    for team_id, name in TEAM_ID_TO_NAME.items():
        if name.lower().replace(" ", "-") == key:
            return team_id
    return None


@router.post("/perfect-season/dev/simulate-lineup")
async def dev_simulate_lineup(body: DevSimulateLineupRequest) -> dict:
    if not _dev_tools_enabled():
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "dev_tools_not_enabled",
                "message": "Set PEAK3_DEV_TOOLS_ENABLED=true or PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev "
                           "to use this endpoint. Prefer scripts/simulate_peak_season_lineup.py for calibration work.",
            },
        )

    by_slot = {s.slot: s for s in body.slots}
    missing = [s for s in SLOT_TYPES if s not in by_slot]
    if missing:
        raise HTTPException(status_code=400, detail={"error_code": "missing_slots", "message": f"Missing slot(s): {missing}"})

    cards = []
    warnings: list[str] = []
    for slot in SLOT_TYPES:
        e = by_slot[slot]
        team_id = _resolve_dev_team_id(e.team)
        if team_id is None:
            raise HTTPException(status_code=400, detail={"error_code": "unknown_team", "message": f"Unrecognized team '{e.team}' for slot {slot}"})
        card = resolve_player_season_card(e.player_slug, team_id, e.season)
        if card is None:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "unresolvable_card", "message": f"[{slot}] '{e.player_slug}' has no real roster record for {team_id} {e.season}"},
            )
        if card.season != e.season or card.team_id != team_id:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "exact_season_mismatch", "message": f"[{slot}] resolved {card.team_id} {card.season} != requested {team_id} {e.season}"},
            )
        if card.score_status != "exact_season_scored" and not body.allow_unscored:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "unscored_card", "message": f"[{slot}] {card.player_name} {card.team_id} {card.season} is unscored -- pass allow_unscored=true to include it"},
            )
        if card.score_status != "exact_season_scored":
            warnings.append(f"{slot}: {card.player_name} {card.team_id} {card.season} is unscored ({card.score_status})")
        cards.append(card)

    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    fit = compute_exact_fit_components(cards, SLOT_TYPES)
    scored_count = sum(1 for c in cards if c.score_status == "exact_season_scored")

    return {
        "cards": [
            {
                "slot": slot, "player_slug": c.player_slug, "player_name": c.player_name,
                "team_id": c.team_id, "team_name": c.team_name, "season": c.season,
                "position": c.position, "season_score": c.season_score, "score_status": c.score_status,
            }
            for slot, c in zip(SLOT_TYPES, cards)
        ],
        "fit_components": fit.as_dict(),
        "wins": result.wins,
        "losses": result.losses,
        "expected_wins": result.expected_wins,
        "expected_wins_low": result.expected_wins_low,
        "expected_wins_high": result.expected_wins_high,
        "is_perfect_season": result.is_perfect_season,
        "lineup_peak_score": result.lineup_peak_score,
        "score_coverage": f"{scored_count}/{len(cards)}",
        "best_pick": result.best_pick,
        "structural_weakness": result.structural_weakness,
        "decisive_factors": result.decisive_factors,
        "warnings": warnings,
    }
