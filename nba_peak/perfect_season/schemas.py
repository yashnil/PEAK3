"""Data schemas for the experimental 82-0 Peak Season / CourtBuilder model.

Plain dataclasses (no Pydantic), mirroring nba_peak/lineup/schemas.py's own
convention -- FastAPI Pydantic wrappers live in
apps/api/app/models/perfect_season.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from nba_peak.lineup.schemas import CardProfile


@dataclass
class SpinPrompt:
    """One round's spin prompt -- the team+decade/exact-team-season context
    (or the open-pool fallback when team spins are disabled).

    `candidate_player_slugs` is resolved once, at spin time, from the
    interim team dataset intersected with the current duration's card pool
    (or from a shuffled duration-filtered pool for the open-pool fallback).
    It is never re-resolved later -- the same discipline ADR-001/ADR-004 Sec 15
    already establish for board snapshots.
    """
    round_number: int  # 1..TOTAL_ROUNDS
    spin_type: str  # "team_decade" | "exact_team_season" | "open_pool"
    spin_id: Optional[str]  # interim dataset spin_id, or None for open_pool
    franchise_display_name: Optional[str]
    era_label: Optional[str]  # decade_label or season_label, or None for open_pool
    candidate_player_slugs: list[str]


@dataclass
class PerfectSeasonBoard:
    """A fully generated CourtBuilder board (private server-side structure).

    Mirrors nba_peak.lineup.schemas.Board's role in Peak Draft: immutable
    once created, referenced by every attempt against it. `card_pool_version`
    and `eligibility_ruleset_version` are pinned here at generation time
    (PHASE_5_DATA_MODEL.md entity 11's versioning requirement), never
    re-resolved from current defaults after creation.
    """
    board_id: str
    mode: str
    duration_years: int
    board_type: str  # "practice" only in Phase 5C -- see vertical slice doc Sec 0
    seed: int
    spins: list[SpinPrompt]  # exactly TOTAL_ROUNDS prompts
    card_pool_version: str
    eligibility_ruleset_version: str
    board_generator_version: str
    interim_team_data_version: Optional[str]  # None if team spins were disabled
    metadata: dict


@dataclass
class CourtSlot:
    """One roster position -- five starters + three bench (soft assignment,
    never a hard eligibility lock; master plan Sec 5.5).
    """
    slot_type: str  # e.g. "starter_1".."starter_5", "bench_1".."bench_3"
    round_number: Optional[int] = None  # which round filled this slot
    peak_window_id: Optional[str] = None
    resolved_via_spin_id: Optional[str] = None


@dataclass
class LineupFitComponents:
    """Lineup-fit dimensions (master plan Sec 5.6) -- explicitly separate from
    the canonical PEAK3 score (ADR-005 Decision 4). Components, never one
    unexplained number.
    """
    talent_core: float
    creation_coverage: float
    scoring_coverage: float
    postseason_pedigree: float
    team_context_depth: float
    role_overlap_penalty: float  # negative or zero; redundancy penalty

    def as_dict(self) -> dict[str, float]:
        return {
            "talent_core": self.talent_core,
            "creation_coverage": self.creation_coverage,
            "scoring_coverage": self.scoring_coverage,
            "postseason_pedigree": self.postseason_pedigree,
            "team_context_depth": self.team_context_depth,
            "role_overlap_penalty": self.role_overlap_penalty,
        }


@dataclass
class SimulationResult:
    """The v0 simulation output -- frozen once at completion (mirrors
    PHASE_5_DATA_MODEL.md entity 10, lineup_score_snapshot).

    Explicitly labeled experimental everywhere it is surfaced
    (config.SIMULATOR_EXPERIMENTAL_NOTICE) -- never presented as a scientific
    prediction (ADR-005 Decision 4).
    """
    lineup_model_version: str
    simulator_version: str
    fit_components: LineupFitComponents
    wins: int
    losses: int
    expected_wins: float
    expected_wins_low: float
    expected_wins_high: float
    decisive_factors: list[str]
    is_perfect_season: bool
    experimental_notice: str


@dataclass
class CourtLineupState:
    """Complete CourtBuilder game state (server-side, includes private data).

    Mirrors nba_peak.lineup.schemas.DraftGameState's role for Peak Draft, but
    for the court-based game grammar -- deliberately a distinct type
    (PHASE_5_DATA_MODEL.md entity 8's open question, resolved: new narrow
    shape, not a DraftGameState subtype).
    """
    game_id: str
    board: PerfectSeasonBoard
    status: str
    # created -> prompt_active -> selection_locked -> placement_active ->
    # rounds_complete -> simulating -> result_ready
    # (master plan Sec 16.6's proposed 82-0 state machine)
    current_round: int  # 1..TOTAL_ROUNDS
    slots: list[CourtSlot]  # exactly TOTAL_ROUNDS slots, in SLOT_TYPES order
    # The candidate offered for the current round's selection step, before
    # being placed into a slot. Cleared once placed.
    pending_selection_peak_window_id: Optional[str] = None
    pending_selection_spin_id: Optional[str] = None
    simulation_result: Optional[SimulationResult] = None
    created_at: str = ""
    last_action_at: str = ""
    mode: str = ""
    duration_years: int = 1
    # Server-resolved only, never client-trusted (PHASE_5_DATA_MODEL.md
    # entity 8; same discipline as DraftGameState.owner_sub post-4.0A fix).
    owner_sub: Optional[str] = None


# Re-exported so callers of this module do not need to import
# nba_peak.lineup.schemas directly just to type-hint a resolved card.
__all__ = [
    "CardProfile",
    "SpinPrompt",
    "PerfectSeasonBoard",
    "CourtSlot",
    "LineupFitComponents",
    "SimulationResult",
    "CourtLineupState",
]
