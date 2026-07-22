"""Ranked board assignment (ADR-004 §3).

Reuses ``nba_peak/lineup/board.py::generate_board`` completely unmodified —
its existing ``elif config.seed is not None`` branch in ``_derive_board_seed``
already supports any non-"daily" ``board_type`` with an explicit seed, so
``board_type="ranked"`` needs no change to the authoritative model directory.

The seed is derived from the match's own UUID (assigned once, server-side,
before the board is generated), so the board is reproducible from the
match's identity alone. The generated ``Board`` is additionally persisted in
full (``ranked_matches.board_snapshot``) so that a later default change
(card pool version bump, etc.) can never alter an in-flight or historical
match — the stored snapshot, not regeneration, is what both participants'
games are built from (ADR-004 §3 "Rejected" alternative).
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from app.core.config import settings
from app.services.draft.serialization import board_from_dict, board_to_dict
from app.services.ranked.versions import RANKED_BOARD_GENERATOR_VERSION
from nba_peak.lineup.board import BoardConfig, generate_board, make_board_version_key
from nba_peak.lineup.schemas import Board, DraftGameState

VALID_MODES = {"apex_1y": 1, "prime_3y": 3, "foundation_5y": 5}


def derive_ranked_seed(match_id: str) -> int:
    """Deterministic seed derived from the match's own identity.

    Unlike daily boards (HMAC over date+mode with the signing secret so the
    seed can't be predicted ahead of the date), a ranked match_id is a
    server-generated UUID assigned at pairing time — there is nothing to
    predict ahead of time, so a plain hash (not HMAC) is sufficient here.
    """
    h = hashlib.sha256(f"ranked:{match_id}".encode()).hexdigest()
    return int(h, 16) % (2**31)


def generate_ranked_board(mode: str, match_id: str) -> Board:
    """Generate the one immutable board for a ranked match.

    Called exactly once, at match creation. The returned Board is persisted
    (see ``board_to_dict``) and never regenerated for this match again.
    """
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid ranked mode '{mode}'. Valid: {list(VALID_MODES.keys())}")

    config = BoardConfig(
        mode=mode,
        board_type="ranked",
        date=None,
        seed=derive_ranked_seed(match_id),
    )
    return generate_board(config, signing_secret=settings.SIGNING_SECRET)


def ranked_board_version_key(board: Board) -> str:
    """The stored version-tuple key for a ranked board snapshot, reusing the
    same encoding as daily/practice/challenge boards (ADR-002 §5) but with
    the ranked-specific board-generator version substituted in.
    """
    return make_board_version_key(
        board.board_id,
        board.metadata["lineup_model_version"],
        board.metadata["ruleset_version"],
        board.metadata["card_pool_version"],
        RANKED_BOARD_GENERATOR_VERSION,
    )


def create_participant_game_state(board: Board, mode: str) -> DraftGameState:
    """Build a fresh DraftGameState for one ranked participant from the
    match's shared, already-generated Board.

    Mirrors app.services.draft.state.create_draft_game's return shape
    exactly, substituting "use the provided Board" for "generate a new one" —
    every subsequent state-machine action (action_select_card, action_use_hold,
    action_use_reframe, action_confirm_after_tool) and the existing
    `/draft/games/{id}/actions` endpoint operate identically regardless of
    how the DraftGameState was constructed.
    """
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid ranked mode '{mode}'. Valid: {list(VALID_MODES.keys())}")

    now = datetime.now(timezone.utc).isoformat()
    return DraftGameState(
        game_id="",  # set by the game repository on create
        board=board,
        status="round_active",
        current_round=1,
        selections=[],
        held_card_id=None,
        hold_round=None,
        hold_used=False,
        reframe_used=False,
        reframed_rounds=[],
        action_log=[],
        created_at=now,
        last_action_at=now,
        mode=mode,
        duration_years=VALID_MODES[mode],
        lineup_evaluation=None,
        round_history=[],
    )


__all__ = [
    "board_from_dict",
    "board_to_dict",
    "create_participant_game_state",
    "derive_ranked_seed",
    "generate_ranked_board",
    "ranked_board_version_key",
]
