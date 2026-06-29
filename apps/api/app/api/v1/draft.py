"""Peak Draft API endpoints.

Routes:
  POST /api/v1/draft/games          - create a new game (daily | practice | challenge)
  GET  /api/v1/draft/daily          - shortcut for today's daily board
  GET  /api/v1/draft/games/{id}     - get current public game state
  POST /api/v1/draft/games/{id}/actions  - submit an action
  POST /api/v1/draft/challenges     - create a challenge link from a completed game
  GET  /api/v1/draft/challenges/{token}  - load a challenge board
  GET  /api/v1/draft/meta           - model and mode metadata

Private board state (future offers, reframe branches, solver output, seeds) is
NEVER included in any response. The client only sees the current round's offers.
"""
from __future__ import annotations

import base64
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

# Ensure repo root is on sys.path for nba_peak imports
_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from app.core.security import create_session_token, verify_session_token
from app.models.draft import (
    CreateDraftGameRequest,
    DraftActionRequest,
    DraftMetaResponse,
    PublicGameStateResponse,
)
from app.services.draft import state as state_machine
from app.services.draft import store
from app.services.draft.state import DraftError


def _error_detail(exc: Exception, default_code: str = "invalid_request") -> dict:
    """Build a stable, machine-readable error body: {error_code, message}."""
    code = exc.code if isinstance(exc, DraftError) else default_code
    return {"error_code": code, "message": str(exc)}

from nba_peak.lineup.config import (
    CARD_PROFILE_VERSION,
    LINEUP_MODEL_VERSION,
    RULESET_VERSION,
    SUPPORTED_MODES,
    MODE_TO_YEARS,
)

router = APIRouter()

ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
DNA_DIMENSIONS = [
    "primary_creation", "scoring_pressure", "individual_validation",
    "postseason_translation", "team_context", "context_completeness",
]


# ---------------------------------------------------------------------------
# Create game
# ---------------------------------------------------------------------------

@router.post("/draft/games", response_model=PublicGameStateResponse)
async def create_game(body: CreateDraftGameRequest) -> PublicGameStateResponse:
    try:
        game_state = state_machine.create_draft_game(
            mode=body.mode,
            board_type=body.board_type,
            date=body.date,
            seed=body.seed,
            signing_secret=settings.SIGNING_SECRET,
        )
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_id = store.create_game(game_state)
    game_state.game_id = game_id
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Daily shortcut
# ---------------------------------------------------------------------------

@router.get("/draft/daily", response_model=PublicGameStateResponse)
async def get_daily(
    mode: str = Query(default="prime_3y"),
    date: str = Query(default=""),
) -> PublicGameStateResponse:
    if not date:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        game_state = state_machine.create_draft_game(
            mode=mode,
            board_type="daily",
            date=date,
            seed=None,
            signing_secret=settings.SIGNING_SECRET,
        )
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_id = store.create_game(game_state)
    game_state.game_id = game_id
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Get game state
# ---------------------------------------------------------------------------

@router.get("/draft/games/{game_id}", response_model=PublicGameStateResponse)
async def get_game(game_id: str) -> PublicGameStateResponse:
    game_state = store.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Submit action
# ---------------------------------------------------------------------------

@router.post("/draft/games/{game_id}/actions", response_model=PublicGameStateResponse)
async def submit_action(game_id: str, body: DraftActionRequest) -> PublicGameStateResponse:
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = store.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    try:
        action = body.action
        if action == "select_card":
            if not body.card_id:
                raise ValueError("card_id is required for select_card")
            if not body.role:
                raise ValueError("role is required for select_card")
            new_state = state_machine.action_select_card(
                game_state, body.card_id, body.role, body.idempotency_key
            )
        elif action == "use_hold":
            if not body.card_id:
                raise ValueError("card_id is required for use_hold")
            new_state = state_machine.action_use_hold(
                game_state, body.card_id, body.idempotency_key
            )
        elif action == "use_reframe":
            new_state = state_machine.action_use_reframe(
                game_state, body.idempotency_key
            )
        elif action == "confirm":
            new_state = state_machine.action_confirm_after_tool(game_state)
        else:
            raise ValueError(f"Unknown action '{action}'")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    store.save_game(new_state)
    return PublicGameStateResponse(**state_machine.get_public_state(new_state))


# ---------------------------------------------------------------------------
# Challenge links
# ---------------------------------------------------------------------------

@router.post("/draft/challenges")
async def create_challenge(game_id: str, include_spoilers: bool = False) -> dict:
    game_state = store.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    board = game_state.board

    # The challenge token encodes only the board params needed to reproduce it
    # (not the seed, which is derived server-side for daily boards)
    token_payload = {
        "board_type": board.board_type,
        "mode": game_state.mode,
        "duration_years": game_state.duration_years,
        "board_id": board.board_id,
    }
    if board.board_type == "daily" and board.date:
        token_payload["date"] = board.date
    elif board.board_type in ("practice", "challenge"):
        # For practice boards the seed is safe to include (it's the point of challenge links)
        token_payload["seed"] = board.seed

    challenge_token = create_session_token(
        token_payload, settings.SIGNING_SECRET, ttl_seconds=7 * 86400  # 7 days
    )

    return {
        "challenge_token": challenge_token,
        "public_url_path": f"/c/{challenge_token}",
        "board_id": board.board_id,
        "mode": game_state.mode,
        "spoiler_free": not include_spoilers,
    }


@router.get("/draft/challenges/{token}", response_model=PublicGameStateResponse)
async def load_challenge(token: str) -> PublicGameStateResponse:
    payload = verify_session_token(token, settings.SIGNING_SECRET)
    if payload is None:
        raise HTTPException(status_code=400, detail="Invalid or expired challenge token")

    try:
        game_state = state_machine.create_draft_game(
            mode=payload["mode"],
            board_type=payload.get("board_type", "challenge"),
            date=payload.get("date"),
            seed=payload.get("seed"),
            signing_secret=settings.SIGNING_SECRET,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_id = store.create_game(game_state)
    game_state.game_id = game_id
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

@router.get("/draft/meta", response_model=DraftMetaResponse)
async def get_draft_meta() -> DraftMetaResponse:
    return DraftMetaResponse(
        supported_modes=SUPPORTED_MODES,
        mode_descriptions={
            "apex_1y": "1-Year Apex — The single greatest season peak",
            "prime_3y": "3-Year Prime — A 3-season window of excellence",
            "foundation_5y": "5-Year Foundation — A sustained 5-year peak",
        },
        roles=ROLES,
        dna_dimensions=DNA_DIMENSIONS,
        lineup_model_version=LINEUP_MODEL_VERSION,
        ruleset_version=RULESET_VERSION,
        card_pool_version=CARD_PROFILE_VERSION,
        experimental_notice=(
            "The Peak Draft lineup model is experimental. "
            "Lineup ratings are not a prediction of win totals or objective basketball truth. "
            "They reflect a hypothetical scoring model applied to PEAK3 individual scores."
        ),
    )
