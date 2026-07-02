"""Full DraftGameState <-> plain-dict (JSONB-safe) serialization.

This is the shared implementation both `app/repositories/postgres.py` (real
game persistence) and `app/services/ranked/board.py` (board-only, reused
for the ranked hidden-board snapshot) depend on. Previously,
`postgres.py::_deserialize_game_state` was an unconditional
`NotImplementedError` stub — every read of a Postgres-backed game failed.

`dataclasses.asdict()` already handles the dict *direction* for any nested
dataclass graph; the missing half was reconstructing typed dataclass
instances (Board, CardProfile, LineupDNA, SynergyItem, ReceiptItem,
LineupEvaluation, GameAction) back from plain dicts, which the rest of the
state machine and solver code require (they access `.attribute`, not
`["attribute"]`).
"""
from __future__ import annotations

import dataclasses
from typing import Any

from nba_peak.lineup.schemas import (
    Board,
    CardProfile,
    DraftGameState,
    GameAction,
    LineupDNA,
    LineupEvaluation,
    ReceiptItem,
    RoundOffers,
    SynergyItem,
)


def board_to_dict(board: Board) -> dict:
    """Serialize a Board (including nested CardProfile/LineupDNA dataclasses)
    to a plain JSON-safe dict.
    """
    return dataclasses.asdict(board)


def board_from_dict(d: dict) -> Board:
    """Reconstruct a Board from a stored dict payload.

    JSON round-tripping turns the ``reframe_branches`` dict's integer keys
    into strings, so they are converted back to int here.
    """
    rounds = [
        RoundOffers(
            round_number=r["round_number"],
            offers=[CardProfile.from_dict(c) for c in r["offers"]],
        )
        for r in d["rounds"]
    ]
    reframe_branches = {
        int(round_num): [CardProfile.from_dict(c) for c in cards]
        for round_num, cards in d["reframe_branches"].items()
    }
    return Board(
        board_id=d["board_id"],
        mode=d["mode"],
        duration_years=d["duration_years"],
        board_type=d["board_type"],
        date=d.get("date"),
        seed=d["seed"],
        rounds=rounds,
        reframe_branches=reframe_branches,
        metadata=d["metadata"],
    )


def _lineup_dna_from_dict(d: dict | None) -> LineupDNA | None:
    if d is None:
        return None
    return LineupDNA(
        primary_creation=d["primary_creation"],
        scoring_pressure=d["scoring_pressure"],
        individual_validation=d["individual_validation"],
        postseason_translation=d["postseason_translation"],
        team_context=d["team_context"],
        context_completeness=d["context_completeness"],
    )


def _synergy_item_from_dict(d: dict) -> SynergyItem:
    return SynergyItem(
        rule_id=d["rule_id"],
        rule_type=d["rule_type"],
        title=d["title"],
        description=d["description"],
        triggered=d["triggered"],
        adjustment=d["adjustment"],
    )


def _receipt_item_from_dict(d: dict) -> ReceiptItem:
    return ReceiptItem(
        id=d["id"],
        item_type=d["item_type"],
        title=d["title"],
        plain_language=d["plain_language"],
        signed_value=d.get("signed_value"),
        input_ids=d["input_ids"],
        rule_id=d.get("rule_id"),
        model_version=d["model_version"],
        confidence=d["confidence"],
    )


def lineup_evaluation_from_dict(d: dict | None) -> LineupEvaluation | None:
    if d is None:
        return None
    return LineupEvaluation(
        lineup_model_version=d["lineup_model_version"],
        ruleset_version=d["ruleset_version"],
        card_profile_version=d["card_profile_version"],
        lineup_peak_rating=d["lineup_peak_rating"],
        talent_score=d["talent_score"],
        coverage_score=d["coverage_score"],
        synergy_total=d["synergy_total"],
        raw_before_synergy=d["raw_before_synergy"],
        final_dna=_lineup_dna_from_dict(d["final_dna"]),
        role_assignments=d["role_assignments"],
        synergy_items=[_synergy_item_from_dict(s) for s in d["synergy_items"]],
        receipt_items=[_receipt_item_from_dict(r) for r in d["receipt_items"]],
        cards_evaluated=d["cards_evaluated"],
        missing_data_warnings=d["missing_data_warnings"],
        completeness=d["completeness"],
        board_optimum=d.get("board_optimum"),
        board_floor=d.get("board_floor"),
        draft_efficiency=d.get("draft_efficiency"),
        board_percentile=d.get("board_percentile"),
        solver_version=d.get("solver_version"),
    )


def _game_action_from_dict(d: dict) -> GameAction:
    return GameAction(
        action_type=d["action_type"],
        round_number=d["round_number"],
        card_id=d.get("card_id"),
        role_assigned=d.get("role_assigned"),
        idempotency_key=d.get("idempotency_key"),
    )


def game_state_to_dict(state: DraftGameState) -> dict:
    """Serialize a full DraftGameState to a plain JSON-safe dict."""
    return dataclasses.asdict(state)


def game_state_from_dict(d: dict[str, Any]) -> DraftGameState:
    """Reconstruct a full DraftGameState from a stored dict payload —
    the real implementation `postgres.py` was missing.
    """
    return DraftGameState(
        game_id=d["game_id"],
        board=board_from_dict(d["board"]),
        status=d["status"],
        current_round=d["current_round"],
        selections=d["selections"],
        held_card_id=d.get("held_card_id"),
        hold_round=d.get("hold_round"),
        hold_used=d["hold_used"],
        reframe_used=d["reframe_used"],
        reframed_rounds=d["reframed_rounds"],
        action_log=[_game_action_from_dict(a) for a in d["action_log"]],
        created_at=d["created_at"],
        last_action_at=d["last_action_at"],
        mode=d["mode"],
        duration_years=d["duration_years"],
        lineup_evaluation=lineup_evaluation_from_dict(d.get("lineup_evaluation")),
        round_history=d.get("round_history", []),
        owner_sub=d.get("owner_sub"),
    )


__all__ = [
    "board_from_dict",
    "board_to_dict",
    "game_state_from_dict",
    "game_state_to_dict",
    "lineup_evaluation_from_dict",
]
