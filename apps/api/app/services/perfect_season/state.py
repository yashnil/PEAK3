"""CourtBuilder (82-0 Peak Season) server-authoritative state machine.

Mirrors app/services/draft/state.py's role for Peak Draft, but for the
court-based game grammar (ADR-005; PHASE_5_DATA_MODEL.md entity 8).

State machine (master plan Sec 16.6, adapted):
  selection_pending -> placement_pending -> (repeat 8x) ->
  rounds_complete -> result_ready
(create_perfect_season_game() constructs a state that starts directly at
selection_pending -- there is no separate "created" status value.)

All transitions are validated here. No exact prime_score/prime_index is ever
included in the public state for the CURRENT round's candidates -- only for
already-placed (locked) slots (ADR-005 Decision 6). This module never
computes or approximates the canonical PEAK3 score itself.
"""
from __future__ import annotations

import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.perfect_season.board import find_spin, generate_board, resolve_card
from nba_peak.perfect_season.config import SLOT_TYPES, TOTAL_ROUNDS
from nba_peak.perfect_season.schemas import CourtLineupState, CourtSlot
from nba_peak.perfect_season.simulation import simulate_season

VALID_MODES = {"apex_1y": 1, "prime_3y": 3, "foundation_5y": 5}


class CourtError(ValueError):
    """A CourtBuilder state-machine validation error with a stable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Game creation
# ---------------------------------------------------------------------------

def create_perfect_season_game(
    mode: str,
    seed: Optional[int],
    team_spin_enabled: bool,
    board_type: str = "practice",
) -> CourtLineupState:
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Valid: {list(VALID_MODES.keys())}")
    if board_type != "practice":
        # Phase 5C vertical slice supports practice only -- see
        # PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 3. Daily/ranked are later phases.
        raise ValueError(f"board_type '{board_type}' is not supported in this phase")

    resolved_seed = seed if seed is not None else secrets.randbelow(2 ** 31)
    board = generate_board(mode=mode, seed=resolved_seed, board_type=board_type, team_spin_enabled=team_spin_enabled)

    now = datetime.now(timezone.utc).isoformat()
    slots = [CourtSlot(slot_type=st) for st in SLOT_TYPES]

    return CourtLineupState(
        game_id="",  # set by repository
        board=board,
        status="selection_pending",
        current_round=1,
        slots=slots,
        created_at=now,
        last_action_at=now,
        mode=mode,
        duration_years=VALID_MODES[mode],
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_active(state: CourtLineupState) -> None:
    if state.status in ("rounds_complete", "result_ready"):
        raise CourtError("game_already_complete", "This CourtBuilder attempt is already complete")


def _used_player_slugs(state: CourtLineupState) -> set[str]:
    used = set()
    for slot in state.slots:
        if slot.peak_window_id:
            # peak_window_id format: {player_slug}-{n}yr-{anchor_nodash}
            card = resolve_card_by_window_id(state, slot.peak_window_id)
            if card:
                used.add(card.player_slug)
    return used


def resolve_card_by_window_id(state: CourtLineupState, peak_window_id: str):
    from nba_peak.lineup.board import _load_profiles
    by_dur = _load_profiles()
    for card in by_dur.get(state.duration_years, []):
        if card.peak_window_id == peak_window_id:
            return card
    return None


def get_open_slot_types(state: CourtLineupState) -> list[str]:
    return [s.slot_type for s in state.slots if s.peak_window_id is None]


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def action_select_player(
    state: CourtLineupState,
    player_slug: str,
) -> CourtLineupState:
    """Select a player from the current round's spin candidates.

    Does not place them yet -- a separate action_place_card call assigns
    them to a court/bench slot. Selecting again before placing replaces the
    pending selection (no explicit "undo" action needed for this).
    """
    _assert_active(state)
    if state.status not in ("selection_pending",):
        raise CourtError("select_not_allowed", f"Cannot select in status '{state.status}'")

    spin = find_spin(state.board, state.current_round)
    if spin is None:
        raise CourtError("round_not_found", f"No spin for round {state.current_round}")

    if player_slug not in spin.candidate_player_slugs:
        raise CourtError(
            "player_not_offered",
            f"Player '{player_slug}' is not a candidate for round {state.current_round}",
        )

    if player_slug in _used_player_slugs(state):
        raise CourtError(
            "player_already_used",
            f"Player '{player_slug}' is already on this roster",
        )

    card = resolve_card(player_slug, state.duration_years)
    if card is None:
        raise CourtError(
            "card_not_resolvable",
            f"Player '{player_slug}' has no resolvable card at this duration",
        )

    state.pending_selection_peak_window_id = card.peak_window_id
    state.pending_selection_spin_id = spin.spin_id
    state.status = "placement_pending"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_place_card(
    state: CourtLineupState,
    slot_type: str,
) -> CourtLineupState:
    """Place the pending selection into a court/bench slot.

    Soft placement -- any open slot_type is legal regardless of the
    player's real position (master plan Sec 5.5). Advances to the next
    round, or to 'rounds_complete' if this was the final slot.
    """
    _assert_active(state)
    if state.status != "placement_pending" or not state.pending_selection_peak_window_id:
        raise CourtError("place_not_allowed", "No pending selection to place")

    if slot_type not in SLOT_TYPES:
        raise CourtError("invalid_slot", f"Unknown slot_type '{slot_type}'")

    slot = next((s for s in state.slots if s.slot_type == slot_type), None)
    if slot is None or slot.peak_window_id is not None:
        raise CourtError("slot_not_open", f"Slot '{slot_type}' is not open")

    slot.peak_window_id = state.pending_selection_peak_window_id
    slot.round_number = state.current_round
    slot.resolved_via_spin_id = state.pending_selection_spin_id

    state.pending_selection_peak_window_id = None
    state.pending_selection_spin_id = None
    state.last_action_at = datetime.now(timezone.utc).isoformat()

    filled = sum(1 for s in state.slots if s.peak_window_id is not None)
    if filled >= TOTAL_ROUNDS:
        state.status = "rounds_complete"
    else:
        state.current_round += 1
        state.status = "selection_pending"

    return state


def action_complete_game(state: CourtLineupState) -> CourtLineupState:
    """Run the v0 simulation and freeze the result. Idempotent -- calling
    this again on an already-result_ready state returns the same result
    unchanged rather than re-simulating (results must be reproducible, not
    regenerated on every call)."""
    if state.status == "result_ready":
        return state
    if state.status != "rounds_complete":
        raise CourtError("not_ready_to_complete", f"Cannot complete in status '{state.status}'")

    cards = []
    for slot in state.slots:
        if not slot.peak_window_id:
            raise CourtError("incomplete_roster", "Not all slots are filled")
        card = resolve_card_by_window_id(state, slot.peak_window_id)
        if card is None:
            raise CourtError("card_not_resolvable", f"Could not resolve slot card '{slot.peak_window_id}'")
        cards.append(card)

    state.simulation_result = simulate_season(cards, state.board.seed)
    state.status = "result_ready"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


# ---------------------------------------------------------------------------
# Public state serialization (never exposes scores for un-locked candidates)
# ---------------------------------------------------------------------------

def get_public_state(state: CourtLineupState) -> dict:
    """Build the client-visible state.

    ADR-005 Decision 6, ruthlessly enforced here: the current round's
    candidate list contains ONLY player_slug + display context, never
    prime_score/prime_index/rank. Already-placed slots DO include the
    resolved card's score, since the pick is already locked.
    """
    spin = find_spin(state.board, state.current_round) if state.status == "selection_pending" else None

    current_spin_public = None
    if spin is not None:
        current_spin_public = {
            "round_number": spin.round_number,
            "spin_type": spin.spin_type,
            "franchise_display_name": spin.franchise_display_name,
            "era_label": spin.era_label,
            "candidates": [
                {"player_slug": slug, "player_name": _display_name_for_slug(slug, state.duration_years)}
                for slug in spin.candidate_player_slugs
                if slug not in _used_player_slugs(state)
            ],
        }

    pending_card_public = None
    if state.pending_selection_peak_window_id:
        card = resolve_card_by_window_id(state, state.pending_selection_peak_window_id)
        if card:
            pending_card_public = {
                "peak_window_id": card.peak_window_id,
                "player_name": card.player_name,
                # No score here either -- still not locked into a slot yet.
            }

    slots_public = []
    for slot in state.slots:
        entry: dict = {"slot_type": slot.slot_type, "filled": slot.peak_window_id is not None}
        if slot.peak_window_id:
            card = resolve_card_by_window_id(state, slot.peak_window_id)
            if card:
                entry.update({
                    "peak_window_id": card.peak_window_id,
                    "player_name": card.player_name,
                    "anchor_season": card.anchor_season,
                    "individual_peak_score": card.individual_peak_score,
                    "individual_peak_rank": card.individual_peak_rank,
                    "resolved_via_spin_id": slot.resolved_via_spin_id,
                })
        slots_public.append(entry)

    simulation_public = None
    if state.simulation_result:
        r = state.simulation_result
        simulation_public = {
            "lineup_model_version": r.lineup_model_version,
            "simulator_version": r.simulator_version,
            "fit_components": r.fit_components.as_dict(),
            "wins": r.wins,
            "losses": r.losses,
            "expected_wins": r.expected_wins,
            "expected_wins_low": r.expected_wins_low,
            "expected_wins_high": r.expected_wins_high,
            "decisive_factors": r.decisive_factors,
            "is_perfect_season": r.is_perfect_season,
            "experimental_notice": r.experimental_notice,
        }

    return {
        "game_id": state.game_id,
        "status": state.status,
        "mode": state.mode,
        "current_round": state.current_round,
        "total_rounds": TOTAL_ROUNDS,
        "current_spin": current_spin_public,
        "pending_selection": pending_card_public,
        "slots": slots_public,
        "board_seed": state.board.seed,
        "card_pool_version": state.board.card_pool_version,
        "board_generator_version": state.board.board_generator_version,
        "interim_team_data_version": state.board.interim_team_data_version,
        "simulation_result": simulation_public,
    }


def _display_name_for_slug(player_slug: str, duration_years: int) -> str:
    card = resolve_card(player_slug, duration_years)
    return card.player_name if card else player_slug
