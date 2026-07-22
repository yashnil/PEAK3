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
import hashlib
import json
import secrets
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Query, Response

# Ensure repo root is on sys.path for nba_peak imports
_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.dependencies import (
    AchievementRepoDep,
    ChallengeRepoDep,
    DailyCompletionRepoDep,
    GameRepoDep,
    ProgressionRepoDep,
    RecordRepoDep,
    ResultSnapshotRepoDep,
    StreakRepoDep,
)
from app.core.security import create_session_token, verify_session_token
from app.models.draft import (
    ChallengeMeta,
    ChallengeComparisonResponse,
    ComparisonCard,
    ComparisonPlayer,
    CreateDraftGameRequest,
    DecisiveFactor,
    DraftActionRequest,
    DraftMetaResponse,
    PublicGameStateResponse,
)
from app.repositories.protocols import ChallengeRecord, DailyCompletion, ResultSnapshot
from app.services.draft import state as state_machine
from app.services.draft.state import DraftError, _find_card_by_id
from app.services.progression.engine import process_game_completion


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
async def create_game(
    body: CreateDraftGameRequest,
    auth: OptionalAuth,
    response: Response,
    game_repo: GameRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicGameStateResponse:
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

    game_state.owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    game_id = await game_repo.create_game(game_state)
    game_state.game_id = game_id
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Daily shortcut
# ---------------------------------------------------------------------------

@router.get("/draft/daily", response_model=PublicGameStateResponse)
async def get_daily(
    auth: OptionalAuth,
    response: Response,
    game_repo: GameRepoDep,
    mode: str = Query(default="prime_3y"),
    date: str = Query(default=""),
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
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

    game_state.owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    game_id = await game_repo.create_game(game_state)
    game_state.game_id = game_id
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Get game state
# ---------------------------------------------------------------------------

@router.get("/draft/games/{game_id}", response_model=PublicGameStateResponse)
async def get_game(game_id: str, game_repo: GameRepoDep) -> PublicGameStateResponse:
    game_state = await game_repo.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    return PublicGameStateResponse(**state_machine.get_public_state(game_state))


# ---------------------------------------------------------------------------
# Submit action
# ---------------------------------------------------------------------------

@router.post("/draft/games/{game_id}/actions", response_model=PublicGameStateResponse)
async def submit_action(
    game_id: str,
    body: DraftActionRequest,
    game_repo: GameRepoDep,
    daily_repo: DailyCompletionRepoDep,
    result_repo: ResultSnapshotRepoDep,
    progression_repo: ProgressionRepoDep,
    record_repo: RecordRepoDep,
    achievement_repo: AchievementRepoDep,
    streak_repo: StreakRepoDep,
) -> PublicGameStateResponse:
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await game_repo.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    was_already_complete = game_state.status == "draft_complete"

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

    await game_repo.save_game(new_state)

    if new_state.status == "draft_complete" and not was_already_complete and new_state.owner_sub:
        await _record_completion(
            new_state, result_repo, daily_repo, progression_repo, record_repo, achievement_repo, streak_repo,
        )

    return PublicGameStateResponse(**state_machine.get_public_state(new_state))


async def _record_completion(
    game_state,
    result_repo: ResultSnapshotRepoDep,
    daily_repo: DailyCompletionRepoDep,
    progression_repo: ProgressionRepoDep,
    record_repo: RecordRepoDep,
    achievement_repo: AchievementRepoDep,
    streak_repo: StreakRepoDep,
) -> None:
    """Persist the durable result of a completed Practice/Daily/Challenge game.

    Runs once, at the draft_complete transition. Result snapshot + (for Daily)
    completion record are the durable source History reads from. Progression
    (XP/records/achievements/streak) is additive and must never fail the
    draft response — mirrors the same ordering used for ranked matches.
    """
    owner_sub = game_state.owner_sub
    board = game_state.board
    ev = game_state.lineup_evaluation
    payload = _snapshot_from_game(game_state)
    completed_at = datetime.now(timezone.utc)
    result_id = str(uuid.uuid4())

    result = ResultSnapshot(
        id=result_id,
        owner_sub=owner_sub,
        game_id=game_state.game_id,
        board_id=board.board_id,
        board_type=board.board_type,
        mode=game_state.mode,
        lineup_peak_rating=ev.lineup_peak_rating,
        draft_efficiency=ev.draft_efficiency,
        board_percentile=ev.board_percentile,
        completed_at=completed_at,
        payload=payload,
    )
    await result_repo.record_result(result)

    if board.board_type == "daily":
        completion = DailyCompletion(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            board_id=board.board_id,
            mode=game_state.mode,
            date=board.date or "",
            game_id=game_state.game_id,
            lineup_peak_rating=ev.lineup_peak_rating,
            draft_efficiency=ev.draft_efficiency,
            board_percentile=ev.board_percentile,
            hold_used=game_state.hold_used,
            reframe_used=game_state.reframe_used,
            completed_at=completed_at,
            result_snapshot=payload,
        )
        await daily_repo.record_completion(completion)

    try:
        await process_game_completion(
            owner_sub=owner_sub,
            result_snapshot=payload,
            result_id=result_id,
            board_type=board.board_type,
            mode=game_state.mode,
            completed_at=completed_at,
            tz_name="UTC",
            progression_repo=progression_repo,
            record_repo=record_repo,
            achievement_repo=achievement_repo,
            streak_repo=streak_repo,
            is_first_ever_game=True,
            is_self_challenge=False,
        )
    except Exception:
        # Progression is additive; a failure here must never surface as a
        # draft-completion failure to the client.
        pass


# ---------------------------------------------------------------------------
# Challenge helpers
# ---------------------------------------------------------------------------

_MODE_LABELS: dict[str, str] = {
    "apex_1y": "1Y Apex",
    "prime_3y": "3Y Prime",
    "foundation_5y": "5Y Foundation",
}


def _board_label(mode: str, date: str | None) -> str:
    """Return a human-readable board label such as 'Jun 29 · 1Y Apex'."""
    mode_label = _MODE_LABELS.get(mode, mode)
    if date:
        d = datetime.fromisoformat(date)
        day = d.strftime("%d").lstrip("0")
        return f"{d.strftime('%b')} {day} · {mode_label}"
    return f"Practice · {mode_label}"


def _serialize_lineup_evaluation(ev: object) -> dict | None:
    """Serialize a LineupEvaluation dataclass to a plain dict for snapshot storage."""
    if ev is None:
        return None
    return {
        "lineup_peak_rating": ev.lineup_peak_rating,  # type: ignore[attr-defined]
        "talent_score": ev.talent_score,  # type: ignore[attr-defined]
        "coverage_score": ev.coverage_score,  # type: ignore[attr-defined]
        "synergy_total": ev.synergy_total,  # type: ignore[attr-defined]
        "draft_efficiency": ev.draft_efficiency,  # type: ignore[attr-defined]
        "board_percentile": ev.board_percentile,  # type: ignore[attr-defined]
        "final_dna": ev.final_dna.as_dict() if ev.final_dna else None,  # type: ignore[attr-defined]
        "synergy_items": [
            {
                "rule_id": si.rule_id,
                "rule_type": si.rule_type,
                "title": si.title,
                "description": si.description,
                "triggered": si.triggered,
                "adjustment": si.adjustment,
            }
            for si in ev.synergy_items  # type: ignore[attr-defined]
        ],
    }


def _snapshot_from_game(game_state: object) -> dict:
    """Build a serialisable snapshot dict from a DraftGameState."""
    selected_cards = []
    for sel in game_state.selections:  # type: ignore[attr-defined]
        card = _find_card_by_id(game_state.board, sel["card_id"])  # type: ignore[attr-defined]
        if card:
            selected_cards.append({
                "round": sel["round"],
                "role": sel["role"],
                "card": {
                    "peak_window_id": card.peak_window_id,
                    "player_name": card.player_name,
                    "individual_peak_score": card.individual_peak_score,
                    "anchor_season": card.anchor_season,
                    "individual_peak_rank": card.individual_peak_rank,
                    "lineup_dna": card.lineup_dna.as_dict() if card.lineup_dna else None,
                },
            })
    return {
        "selected_cards": selected_cards,
        "lineup_evaluation": _serialize_lineup_evaluation(game_state.lineup_evaluation),  # type: ignore[attr-defined]
        "hold_used": game_state.hold_used,  # type: ignore[attr-defined]
        "reframe_used": game_state.reframe_used,  # type: ignore[attr-defined]
        "board_id": game_state.board.board_id,  # type: ignore[attr-defined]
        "mode": game_state.mode,  # type: ignore[attr-defined]
    }


def _build_comparison_player_from_snapshot(snapshot: dict, display_name: str) -> ComparisonPlayer:
    """Build a ComparisonPlayer from a stored snapshot dict."""
    lineup_eval = snapshot.get("lineup_evaluation") or {}
    return ComparisonPlayer(
        display_name=display_name,
        lineup_peak_rating=lineup_eval.get("lineup_peak_rating", 0.0),
        talent_score=lineup_eval.get("talent_score", 0.0),
        coverage_score=lineup_eval.get("coverage_score", 0.0),
        synergy_total=lineup_eval.get("synergy_total", 0.0),
        draft_efficiency=lineup_eval.get("draft_efficiency"),
        board_percentile=lineup_eval.get("board_percentile"),
        selected_cards=[
            ComparisonCard(
                round=sc["round"],
                role=sc["role"],
                player_name=sc["card"]["player_name"],
                individual_peak_score=sc["card"]["individual_peak_score"],
                anchor_season=sc["card"]["anchor_season"],
            )
            for sc in snapshot.get("selected_cards", [])
        ],
        final_dna=lineup_eval.get("final_dna"),
        synergy_items=lineup_eval.get("synergy_items", []),
        hold_used=snapshot.get("hold_used", False),
        reframe_used=snapshot.get("reframe_used", False),
    )


# ---------------------------------------------------------------------------
# Challenge links
# ---------------------------------------------------------------------------

@router.post("/draft/challenges")
async def create_challenge(
    game_id: str,
    game_repo: GameRepoDep,
    challenge_repo: ChallengeRepoDep,
    include_spoilers: bool = False,
) -> dict:
    game_state = await game_repo.get_game(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")

    if game_state.status != "draft_complete":
        raise HTTPException(
            status_code=400,
            detail="Game must be complete (draft_complete) before creating a challenge",
        )

    board = game_state.board

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=7)

    # The challenge token encodes only the board params needed to reproduce it.
    # A unique nonce is added so two tokens for the same board are always distinct.
    token_payload: dict = {
        "board_type": board.board_type,
        "mode": game_state.mode,
        "duration_years": game_state.duration_years,
        "board_id": board.board_id,
        "nonce": secrets.token_hex(8),
    }
    if board.board_type == "daily" and board.date:
        token_payload["date"] = board.date
    elif board.board_type in ("practice", "challenge"):
        # For practice boards the seed is safe to include (it's the point of challenge links)
        token_payload["seed"] = board.seed

    challenge_token = create_session_token(
        token_payload, settings.SIGNING_SECRET, ttl_seconds=7 * 86400  # 7 days
    )

    # Persist challenger snapshot so comparison works later
    token_hash = hashlib.sha256(challenge_token.encode()).hexdigest()[:32]
    snapshot = _snapshot_from_game(game_state)

    record = ChallengeRecord(
        token_hash=token_hash,
        challenger_game_id=game_id,
        board_id=board.board_id,
        mode=game_state.mode,
        board_type=board.board_type,
        duration_years=game_state.duration_years,
        seed=board.seed if board.board_type != "daily" else None,
        date=board.date,
        created_at=now,
        expires_at=expires_at,
        challenger_snapshot=snapshot,
        anon_subject_id=game_state.owner_sub,
    )
    await challenge_repo.store_challenge(record)

    return {
        "challenge_token": challenge_token,
        "public_url_path": f"/c/{challenge_token}",
        "board_id": board.board_id,
        "mode": game_state.mode,
        "spoiler_free": not include_spoilers,
    }


def _verify_challenge_token(token: str) -> dict:
    """Verify a challenge token and return the payload.

    Raises HTTPException with a distinct, public-safe error code for each failure mode:
    - token_malformed       — wrong structure (not 2 dot-separated base64 parts)
    - token_invalid_signature — valid structure but HMAC does not match
    - challenge_expired     — valid signature but exp is in the past
    """
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="token_malformed")

    encoded_payload, encoded_sig = parts[0], parts[1]

    import base64 as _b64, hmac as _hmac, hashlib as _hs, json as _json
    def _b64d(s: str) -> bytes:
        padding = 4 - len(s) % 4
        if padding != 4:
            s += "=" * padding
        return _b64.urlsafe_b64decode(s)

    expected_sig = _hmac.new(
        settings.SIGNING_SECRET.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        _hs.sha256,
    ).digest()
    expected_encoded = base64.urlsafe_b64encode(expected_sig).rstrip(b"=").decode("ascii")

    if not _hmac.compare_digest(encoded_sig, expected_encoded):
        raise HTTPException(status_code=400, detail="token_invalid_signature")

    try:
        payload = _json.loads(_b64d(encoded_payload).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="token_malformed")

    exp = payload.get("exp")
    if exp is None or int(time.time()) > exp:
        raise HTTPException(status_code=400, detail="challenge_expired")

    return payload


@router.get("/draft/challenges/{token}/meta", response_model=ChallengeMeta)
async def get_challenge_meta(token: str, challenge_repo: ChallengeRepoDep) -> ChallengeMeta:
    """Return spoiler-safe metadata for a challenge token."""
    payload = _verify_challenge_token(token)

    token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
    record = await challenge_repo.get_challenge(token_hash)
    if record is None:
        raise HTTPException(status_code=404, detail="challenge_not_found")

    now = datetime.now(timezone.utc)
    status = "open" if now <= record.expires_at else "expired"
    label = _board_label(record.mode, record.date)

    return ChallengeMeta(
        board_id=record.board_id,
        mode=record.mode,
        duration_years=record.duration_years,
        board_label=label,
        challenger_display="A PEAK3 player",
        created_at=record.created_at.isoformat(),
        expires_at=record.expires_at.isoformat(),
        status=status,
    )


@router.get("/draft/challenges/{token}/comparison", response_model=ChallengeComparisonResponse)
async def get_challenge_comparison(
    token: str,
    challenge_repo: ChallengeRepoDep,
    game_repo: GameRepoDep,
    recipient_game_id: str = Query(...),
) -> ChallengeComparisonResponse:
    """Compare a completed recipient game against the stored challenger snapshot."""
    _verify_challenge_token(token)

    token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
    record = await challenge_repo.get_challenge(token_hash)
    if record is None:
        raise HTTPException(status_code=404, detail="challenge_not_found")

    # Return cached settlement if already computed
    if record.settlement is not None:
        return ChallengeComparisonResponse.model_validate(record.settlement)

    # Validate recipient game
    recipient_game = await game_repo.get_game(recipient_game_id)
    if recipient_game is None:
        raise HTTPException(status_code=404, detail="Recipient game not found or expired")

    if recipient_game.status != "draft_complete":
        raise HTTPException(status_code=400, detail="Recipient game must be complete")

    if recipient_game.board.board_id != record.board_id:
        raise HTTPException(status_code=400, detail="board_mismatch")

    if recipient_game_id == record.challenger_game_id:
        raise HTTPException(status_code=400, detail="cannot_compare_self")

    # Build both players
    challenger_player = _build_comparison_player_from_snapshot(
        record.challenger_snapshot, "Challenger"
    )
    recipient_snapshot = _snapshot_from_game(recipient_game)
    recipient_player = _build_comparison_player_from_snapshot(recipient_snapshot, "You")

    # Determine outcome: primary = lineup_peak_rating; tiebreaker = draft_efficiency
    c_rating = challenger_player.lineup_peak_rating
    r_rating = recipient_player.lineup_peak_rating

    if abs(c_rating - r_rating) > 0.001:
        outcome = "challenger_wins" if c_rating > r_rating else "recipient_wins"
    else:
        c_eff = challenger_player.draft_efficiency
        r_eff = recipient_player.draft_efficiency
        if (
            c_eff is not None
            and r_eff is not None
            and abs(c_eff - r_eff) > 0.001
        ):
            outcome = "challenger_wins" if c_eff > r_eff else "recipient_wins"
        else:
            outcome = "draw"

    # Build decisive factors (talent, coverage, synergy)
    decisive_factors: list[DecisiveFactor] = []
    for factor_name, c_val, r_val in [
        ("talent_edge", challenger_player.talent_score, recipient_player.talent_score),
        ("coverage_edge", challenger_player.coverage_score, recipient_player.coverage_score),
        ("synergy_edge", challenger_player.synergy_total, recipient_player.synergy_total),
    ]:
        if c_val > r_val:
            winner = "challenger"
        elif r_val > c_val:
            winner = "recipient"
        else:
            winner = "tied"
        decisive_factors.append(DecisiveFactor(
            factor=factor_name,
            winner=winner,
            challenger_value=c_val,
            recipient_value=r_val,
        ))

    settled_at = datetime.now(timezone.utc).isoformat()
    board_label = _board_label(record.mode, record.date)

    response = ChallengeComparisonResponse(
        outcome=outcome,
        challenger=challenger_player,
        recipient=recipient_player,
        decisive_factors=decisive_factors,
        settled_at=settled_at,
        mode=record.mode,
        board_label=board_label,
    )

    # Cache the settlement so repeated calls return instantly
    await challenge_repo.save_settlement(token_hash, response.model_dump())

    return response


@router.get("/draft/challenges/{token}", response_model=PublicGameStateResponse)
async def load_challenge(
    token: str,
    auth: OptionalAuth,
    response: Response,
    game_repo: GameRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicGameStateResponse:
    payload = _verify_challenge_token(token)

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

    game_state.owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    game_id = await game_repo.create_game(game_state)
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
