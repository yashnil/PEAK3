"""CourtLineupState <-> plain-dict (JSONB-safe) serialization.

Mirrors app/services/draft/serialization.py's role for DraftGameState.
"""
from __future__ import annotations

import dataclasses
from typing import Any

from nba_peak.perfect_season.schemas import (
    CourtLineupState,
    CourtSlot,
    LineupFitComponents,
    PerfectSeasonBoard,
    SimulationResult,
    SpinPrompt,
)


def court_state_to_dict(state: CourtLineupState) -> dict:
    return dataclasses.asdict(state)


def court_state_from_dict(d: dict) -> CourtLineupState:
    board_d = d["board"]
    board = PerfectSeasonBoard(
        board_id=board_d["board_id"],
        mode=board_d["mode"],
        duration_years=board_d["duration_years"],
        board_type=board_d["board_type"],
        seed=board_d["seed"],
        spins=[SpinPrompt(**s) for s in board_d["spins"]],
        card_pool_version=board_d["card_pool_version"],
        eligibility_ruleset_version=board_d["eligibility_ruleset_version"],
        board_generator_version=board_d["board_generator_version"],
        interim_team_data_version=board_d.get("interim_team_data_version"),
        metadata=board_d.get("metadata", {}),
        experimental_team_year_data_version=board_d.get("experimental_team_year_data_version"),
    )

    slots = [CourtSlot(**s) for s in d["slots"]]

    sim_d = d.get("simulation_result")
    simulation_result: SimulationResult | None = None
    if sim_d:
        fit_d = sim_d["fit_components"]
        simulation_result = SimulationResult(
            lineup_model_version=sim_d["lineup_model_version"],
            simulator_version=sim_d["simulator_version"],
            fit_components=LineupFitComponents(**fit_d),
            wins=sim_d["wins"],
            losses=sim_d["losses"],
            expected_wins=sim_d["expected_wins"],
            expected_wins_low=sim_d["expected_wins_low"],
            expected_wins_high=sim_d["expected_wins_high"],
            decisive_factors=sim_d["decisive_factors"],
            is_perfect_season=sim_d["is_perfect_season"],
            experimental_notice=sim_d["experimental_notice"],
            lineup_peak_score=sim_d.get("lineup_peak_score", 0.0),
        )

    return CourtLineupState(
        game_id=d["game_id"],
        board=board,
        status=d["status"],
        current_round=d["current_round"],
        slots=slots,
        pending_selection_peak_window_id=d.get("pending_selection_peak_window_id"),
        pending_selection_spin_id=d.get("pending_selection_spin_id"),
        simulation_result=simulation_result,
        created_at=d.get("created_at", ""),
        last_action_at=d.get("last_action_at", ""),
        mode=d.get("mode", ""),
        duration_years=d.get("duration_years", 1),
        owner_sub=d.get("owner_sub"),
    )
