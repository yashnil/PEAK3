"""Peak Draft server-authoritative state machine.

All transitions are validated here. The state machine ensures:
- No duplicate actions (idempotency keys)
- No out-of-order rounds
- Hold/Reframe used at most once
- Completed games cannot be mutated
- Card membership and role eligibility enforced
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# Add repo root to sys.path so nba_peak is importable from the API
_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.lineup.board import BoardConfig, generate_board
from nba_peak.lineup.schemas import (
    Board,
    CardProfile,
    DraftGameState,
    GameAction,
)
from nba_peak.lineup.scoring import evaluate_lineup
from nba_peak.lineup.solver import _assign_roles, solve_board, board_percentile

VALID_MODES = {"apex_1y": 1, "prime_3y": 3, "foundation_5y": 5}
ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]


class DraftError(ValueError):
    """A state-machine validation error carrying a stable machine-readable code.

    Subclasses ValueError so existing `except ValueError` handlers still catch it.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Game creation
# ---------------------------------------------------------------------------

def create_draft_game(
    mode: str,
    board_type: str,
    date: str | None,
    seed: int | None,
    signing_secret: str,
) -> DraftGameState:
    """Create a new draft game from the given parameters."""
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Valid: {list(VALID_MODES.keys())}")
    if board_type not in {"daily", "practice", "challenge"}:
        raise ValueError(f"Invalid board_type '{board_type}'")
    if board_type == "daily" and not date:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    config = BoardConfig(mode=mode, board_type=board_type, date=date, seed=seed)
    board = generate_board(config, signing_secret=signing_secret)

    now = datetime.now(timezone.utc).isoformat()
    return DraftGameState(
        game_id="",  # set by store
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


# ---------------------------------------------------------------------------
# Current offers helper
# ---------------------------------------------------------------------------

def _current_offers(state: DraftGameState) -> list[CardProfile]:
    """Return the current offers for the active round.

    Hold mechanic:
    - In the SAME round hold was used: offer the 2 non-held cards (held card is saved for next)
    - In rounds AFTER the hold round: held card appears alongside 2 new round cards
    """
    r = state.current_round
    if r in state.reframed_rounds:
        branch = state.board.reframe_branches.get(r, [])
        return branch
    round_obj = next((ro for ro in state.board.rounds if ro.round_number == r), None)
    if round_obj is None:
        return []

    if state.held_card_id and not _held_card_consumed(state):
        held = _find_card_by_id(state.board, state.held_card_id)
        if held:
            if state.hold_round is not None and r == state.hold_round:
                # Same round: exclude held card (user picks from remaining 2)
                return [c for c in round_obj.offers if c.peak_window_id != state.held_card_id]
            else:
                # Later round: held card + 2 new from this round
                new_offers = [c for c in round_obj.offers if c.peak_window_id != state.held_card_id][:2]
                return [held] + new_offers

    return list(round_obj.offers)


def _held_card_consumed(state: DraftGameState) -> bool:
    """True if the held card was already selected in a prior round."""
    return any(s.get("card_id") == state.held_card_id for s in state.selections)


def _find_card_by_id(board: Board, peak_window_id: str) -> CardProfile | None:
    for rnd in board.rounds:
        for c in rnd.offers:
            if c.peak_window_id == peak_window_id:
                return c
    for branch in board.reframe_branches.values():
        for c in branch:
            if c.peak_window_id == peak_window_id:
                return c
    return None


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def action_select_card(
    state: DraftGameState,
    card_id: str,
    role: str,
    idempotency_key: str | None = None,
) -> DraftGameState:
    """Select a card and assign it to a role."""
    # Idempotency first: a retried final-round selection must return the
    # completed state instead of raising "already complete".
    if idempotency_key and any(
        a.idempotency_key == idempotency_key for a in state.action_log
    ):
        return state  # duplicate submission, return unchanged

    _assert_active(state)

    current_offers = _current_offers(state)
    offer_ids = {c.peak_window_id for c in current_offers}
    if card_id not in offer_ids:
        raise DraftError(
            "card_not_offered",
            f"Card '{card_id}' is not in the current offers for round {state.current_round}",
        )

    if role not in ROLES:
        raise DraftError("invalid_role", f"Invalid role '{role}'. Valid: {ROLES}")

    # Check role is available (not already filled)
    filled_roles = {s["role"] for s in state.selections}
    if role in filled_roles:
        raise DraftError("role_filled", f"Role '{role}' is already filled")

    # Check card is eligible for the role
    card = next(c for c in current_offers if c.peak_window_id == card_id)
    if role not in card.eligible_roles:
        raise DraftError(
            "role_not_eligible",
            f"Card '{card_id}' ({card.player_name}) is not eligible for role '{role}'",
        )

    # Check card not already selected
    selected_ids = {s["card_id"] for s in state.selections}
    if card_id in selected_ids:
        raise DraftError("card_already_selected", f"Card '{card_id}' has already been selected")

    now = datetime.now(timezone.utc).isoformat()
    new_state = _clone(state)
    new_state.selections = state.selections + [{"round": state.current_round, "card_id": card_id, "role": role}]
    # Record decision replay: the offers shown this round and the choice made.
    new_state.round_history = state.round_history + [{
        "round": state.current_round,
        "reframed": state.current_round in state.reframed_rounds,
        "offer_ids": [c.peak_window_id for c in current_offers],
        "selected_card_id": card_id,
        "role": role,
    }]
    new_state.action_log = state.action_log + [
        GameAction(
            action_type="select_card",
            round_number=state.current_round,
            card_id=card_id,
            role_assigned=role,
            idempotency_key=idempotency_key,
        )
    ]
    new_state.last_action_at = now

    # Release hold only if: held card was presented this round AND user selected something else
    r = state.current_round
    if state.held_card_id and state.hold_round is not None and r > state.hold_round:
        # Held card was an option this round; if not selected, release it
        if card_id != state.held_card_id:
            new_state.held_card_id = None
            new_state.hold_round = None
        else:
            # Held card was selected — consume the hold
            new_state.held_card_id = None
            new_state.hold_round = None

    # Advance round or complete
    if state.current_round == 5:
        new_state.status = "draft_complete"
        new_state.lineup_evaluation = _finalize(new_state)
    else:
        new_state.current_round = state.current_round + 1
        new_state.status = "round_active"

    return new_state


def action_use_hold(
    state: DraftGameState,
    card_id: str,
    idempotency_key: str | None = None,
) -> DraftGameState:
    """Save one card from the current offers to appear next round."""
    if idempotency_key and any(a.idempotency_key == idempotency_key for a in state.action_log):
        return state

    _assert_active(state)

    if state.hold_used:
        raise DraftError("hold_already_used", "Hold has already been used in this game")
    if state.current_round == 5:
        raise DraftError("hold_final_round", "Hold cannot be used in the final round")

    current_offers = _current_offers(state)
    offer_ids = {c.peak_window_id for c in current_offers}
    if card_id not in offer_ids:
        raise DraftError("card_not_offered", f"Card '{card_id}' is not in the current offers")

    now = datetime.now(timezone.utc).isoformat()
    new_state = _clone(state)
    new_state.held_card_id = card_id
    new_state.hold_round = state.current_round
    new_state.hold_used = True
    new_state.action_log = state.action_log + [
        GameAction(
            action_type="use_hold",
            round_number=state.current_round,
            card_id=card_id,
            idempotency_key=idempotency_key,
        )
    ]
    new_state.last_action_at = now
    # Hold does NOT advance the round — user still must select from this round
    new_state.status = "hold_pending"
    return new_state


def action_use_reframe(
    state: DraftGameState,
    idempotency_key: str | None = None,
) -> DraftGameState:
    """Replace current round's offers with the pre-computed reframe branch."""
    if idempotency_key and any(a.idempotency_key == idempotency_key for a in state.action_log):
        return state

    _assert_active(state)

    if state.reframe_used:
        raise DraftError("reframe_already_used", "Reframe has already been used in this game")

    reframe_branch = state.board.reframe_branches.get(state.current_round)
    if not reframe_branch or len(reframe_branch) < 3:
        raise DraftError("reframe_unavailable", f"No valid reframe branch for round {state.current_round}")

    now = datetime.now(timezone.utc).isoformat()
    new_state = _clone(state)
    new_state.reframe_used = True
    new_state.reframed_rounds = state.reframed_rounds + [state.current_round]
    new_state.action_log = state.action_log + [
        GameAction(
            action_type="use_reframe",
            round_number=state.current_round,
            idempotency_key=idempotency_key,
        )
    ]
    new_state.last_action_at = now
    new_state.status = "reframe_pending"
    return new_state


def action_confirm_after_tool(state: DraftGameState) -> DraftGameState:
    """After using Hold or Reframe (which don't select), set status back to round_active."""
    if state.status in ("hold_pending", "reframe_pending"):
        new_state = _clone(state)
        new_state.status = "round_active"
        return new_state
    return state


# ---------------------------------------------------------------------------
# Finalise
# ---------------------------------------------------------------------------

def _finalize(state: DraftGameState) -> object:
    """Compute the final lineup evaluation after all 5 cards are selected."""
    board = state.board
    selected_cards: list[CardProfile] = []
    role_assignments: dict[str, str] = {}

    for sel in state.selections:
        card = _find_card_by_id(board, sel["card_id"])
        if card:
            selected_cards.append(card)
            role_assignments[sel["role"]] = sel["card_id"]

    if len(selected_cards) != 5:
        return None

    # Solve board to get context
    solver_result = solve_board(board)
    optimum = solver_result["board_optimum"]
    floor = solver_result["board_floor"]
    all_ratings = solver_result["all_ratings"]

    ev = evaluate_lineup(
        cards=selected_cards,
        role_assignments=role_assignments,
        board_optimum=optimum,
        board_floor=floor,
        solver_version=solver_result["solver_version"],
    )

    # Attach board percentile
    ev.board_percentile = board_percentile(ev.lineup_peak_rating, all_ratings)
    return ev


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_active(state: DraftGameState) -> None:
    if state.status == "draft_complete":
        raise DraftError("game_complete", "This draft game is already complete")
    if state.status == "expired":
        raise DraftError("game_expired", "This draft game has expired")


def _clone(state: DraftGameState) -> DraftGameState:
    """Create a shallow copy for mutation."""
    return DraftGameState(
        game_id=state.game_id,
        board=state.board,
        status=state.status,
        current_round=state.current_round,
        selections=list(state.selections),
        held_card_id=state.held_card_id,
        hold_round=state.hold_round,
        hold_used=state.hold_used,
        reframe_used=state.reframe_used,
        reframed_rounds=list(state.reframed_rounds),
        action_log=list(state.action_log),
        created_at=state.created_at,
        last_action_at=state.last_action_at,
        mode=state.mode,
        duration_years=state.duration_years,
        lineup_evaluation=state.lineup_evaluation,
        round_history=list(state.round_history),
    )


def get_public_state(state: DraftGameState) -> dict:
    """Build the public game state for API response.

    Never includes future offers, reframe branch offers before they're used,
    solver optimum, private seeds, or receipt conclusions before completion.
    """
    current_offers_data = []
    if state.status not in ("draft_complete", "expired"):
        for card in _current_offers(state):
            current_offers_data.append(_card_to_public(card))

    selected_cards_data = []
    for sel in state.selections:
        card = _find_card_by_id(state.board, sel["card_id"])
        if card:
            selected_cards_data.append({
                "round": sel["round"],
                "role": sel["role"],
                "card": _card_to_public(card),
            })

    held_card_data = None
    if state.held_card_id and not _held_card_consumed(state):
        held = _find_card_by_id(state.board, state.held_card_id)
        if held:
            held_card_data = _card_to_public(held)

    filled_roles = {s["role"] for s in state.selections}
    open_roles = [r for r in ROLES if r not in filled_roles]

    # Decision replay: offers shown and choice made for each completed round.
    # Contains only rounds already played, so it leaks no future offers.
    round_history_data = []
    for rh in state.round_history:
        offers = []
        for cid in rh.get("offer_ids", []):
            c = _find_card_by_id(state.board, cid)
            if c:
                offers.append(_card_to_public(c))
        round_history_data.append({
            "round": rh["round"],
            "reframed": rh.get("reframed", False),
            "offers": offers,
            "selected_card_id": rh["selected_card_id"],
            "role": rh["role"],
        })

    # Compute current DNA from selected cards so far
    current_dna = None
    if state.selections:
        from nba_peak.lineup.coverage import compute_coverage_score
        selected_cards = []
        for sel in state.selections:
            c = _find_card_by_id(state.board, sel["card_id"])
            if c:
                selected_cards.append(c)
        if selected_cards:
            _, dna = compute_coverage_score(selected_cards)
            current_dna = dna.as_dict()

    result = {
        "game_id": state.game_id,
        "mode": state.mode,
        "duration_years": state.duration_years,
        "board_type": state.board.board_type,
        "status": state.status,
        "current_round": state.current_round if state.status != "draft_complete" else 5,
        "total_rounds": 5,
        "current_offers": current_offers_data,
        "selected_cards": selected_cards_data,
        "round_history": round_history_data,
        "open_roles": open_roles,
        "current_dna": current_dna,
        "hold_available": not state.hold_used and state.current_round < 5,
        "held_card": held_card_data,
        "reframe_available": not state.reframe_used,
        "reframed_this_round": state.current_round in state.reframed_rounds,
        "hold_used": state.hold_used,
        "reframe_used": state.reframe_used,
        "board_metadata": {
            "board_id": state.board.board_id,
            "lineup_model_version": state.board.metadata.get("lineup_model_version"),
            "ruleset_version": state.board.metadata.get("ruleset_version"),
            "card_pool_version": state.board.metadata.get("card_pool_version"),
            # Missing-data transparency: how many cards were available vs placed.
            "card_pool_size": state.board.metadata.get("card_pool_size"),
            "cards_placed": state.board.metadata.get("cards_placed"),
            "excluded_profiles": state.board.metadata.get("excluded_profiles"),
        },
    }

    # Only add evaluation data after completion
    if state.status == "draft_complete" and state.lineup_evaluation is not None:
        ev = state.lineup_evaluation
        result["lineup_evaluation"] = {
            "lineup_peak_rating": ev.lineup_peak_rating,
            "talent_score": ev.talent_score,
            "coverage_score": ev.coverage_score,
            "synergy_total": ev.synergy_total,
            "final_dna": ev.final_dna.as_dict(),
            "role_assignments": ev.role_assignments,
            "board_optimum": ev.board_optimum,
            "board_floor": ev.board_floor,
            "draft_efficiency": ev.draft_efficiency,
            "board_percentile": ev.board_percentile,
            "solver_version": ev.solver_version,
            "lineup_model_version": ev.lineup_model_version,
            "ruleset_version": ev.ruleset_version,
            "completeness": ev.completeness,
            "missing_data_warnings": ev.missing_data_warnings,
            "synergy_items": [
                {
                    "rule_id": si.rule_id,
                    "rule_type": si.rule_type,
                    "title": si.title,
                    "description": si.description,
                    "triggered": si.triggered,
                    "adjustment": si.adjustment,
                }
                for si in ev.synergy_items if si.triggered
            ],
            "receipt_items": [
                {
                    "id": ri.id,
                    "item_type": ri.item_type,
                    "title": ri.title,
                    "plain_language": ri.plain_language,
                    "signed_value": ri.signed_value,
                    "input_ids": ri.input_ids,
                    "rule_id": ri.rule_id,
                    "model_version": ri.model_version,
                    "confidence": ri.confidence,
                }
                for ri in ev.receipt_items
            ],
        }

    return result


def _card_to_public(card: CardProfile) -> dict:
    """Serialize a card for public API response (no prime_index)."""
    return {
        "peak_window_id": card.peak_window_id,
        "player_id": card.player_id,
        "player_slug": card.player_slug,
        "player_name": card.player_name,
        "duration_years": card.duration_years,
        "start_season": card.start_season,
        "end_season": card.end_season,
        "anchor_season": card.anchor_season,
        "individual_peak_score": card.individual_peak_score,
        "individual_peak_rank": card.individual_peak_rank,
        "eligible_roles": card.eligible_roles,
        "primary_role": card.primary_role,
        "lineup_dna": card.lineup_dna.as_dict(),
        "data_completeness": card.data_completeness,
        "profile_status": card.profile_status,
    }
