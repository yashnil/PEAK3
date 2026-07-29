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
    spin_type: str  # "team_decade" | "exact_team_season" | "team_year" | "open_pool"
    spin_id: Optional[str]  # interim dataset spin_id, or None for open_pool
    franchise_display_name: Optional[str]
    era_label: Optional[str]  # decade_label or season_label, or None for open_pool
    candidate_player_slugs: list[str]
    # Phase 6C: the exact team-season roll, required for team_year spins so
    # action_select_player can resolve an exact PlayerSeasonCard (never a
    # career-peak substitute) via nba_peak.perfect_season.exact_season.
    # None for team_decade/exact_team_season/open_pool spins (those still
    # resolve via the legacy CardProfile path).
    team_id: Optional[str] = None


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
    # Phase 6A: set only for boards built by generate_team_year_board() (the
    # experimental team+YEAR engine) -- None for every team+decade/open_pool
    # board from generate_board(). Kept as a distinct field from
    # interim_team_data_version rather than overloading it, since the two
    # engines read different, independently-versioned datasets.
    experimental_team_year_data_version: Optional[str] = None


@dataclass
class CourtSlot:
    """One roster position -- five position-anchored starters (PG/SG/SF/PF/C)
    + three plain, unrestricted bench slots (bench_1/bench_2/bench_3). Soft
    assignment, never a hard eligibility lock (master plan Sec 5.5) -- any
    player may be placed in any slot; `role_fit` records how well the v1
    archetype approximation says they fit, for display only.
    """
    slot_type: str  # e.g. "PG".."C", "bench_1", "bench_2", "bench_3"
    round_number: Optional[int] = None  # which round filled this slot
    peak_window_id: Optional[str] = None
    resolved_via_spin_id: Optional[str] = None
    # "primary" | "secondary" | "off_position" | "flexible" -- set at
    # placement time by nba_peak.perfect_season.positions.classify_fit().
    # Display-only; never gates whether a placement is legal.
    role_fit: Optional[str] = None
    # Phase 6C: set instead of peak_window_id for team_year-mode boards --
    # an exact_season.PlayerSeasonCard.exact_player_season_key. The two
    # fields are mutually exclusive per slot (never both set), reflecting
    # the two entirely distinct card types (PeakWindowCard vs
    # PlayerSeasonCard) rather than overloading peak_window_id's meaning.
    exact_player_season_key: Optional[str] = None


@dataclass
class LineupFitComponents:
    """Lineup-fit dimensions (master plan Sec 5.6) -- explicitly separate from
    the canonical PEAK3 score (ADR-005 Decision 4). Components, never one
    unexplained number.

    PEAK3 product philosophy (see simulation.py's module docstring for the
    full rationale): a roster with several elite all-time peaks is NOT
    penalized just for having a lot of star talent -- there is no
    "too many stars"/"role redundancy" component here. `talent_core` and
    `bench_strength` are peak-value measures; `positional_fit` is the one
    component tied to a real board constraint (whether starters are placed
    at their eligible position), never to how much raw talent is on the
    roster.
    """
    talent_core: float
    bench_strength: float
    positional_fit: float  # 0-100; starters-only, real position constraint
    creation_coverage: float
    scoring_coverage: float
    postseason_pedigree: float
    team_context_depth: float

    def as_dict(self) -> dict[str, float]:
        return {
            "talent_core": self.talent_core,
            "bench_strength": self.bench_strength,
            "positional_fit": self.positional_fit,
            "creation_coverage": self.creation_coverage,
            "scoring_coverage": self.scoring_coverage,
            "postseason_pedigree": self.postseason_pedigree,
            "team_context_depth": self.team_context_depth,
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
    # Phase 6A Goal 9: the durable, comparable score -- mean of the 8 placed
    # cards' real individual_peak_score values (0-100). See
    # simulation.py::simulate_season's own comment for why this, not the
    # noisy 82-0 record, is the "compare across runs" number.
    lineup_peak_score: float = 0.0
    # Phase 6F Part F: structural result explanation, computed server-side
    # (single source of truth -- see simulation.py::_best_pick_exact /
    # _structural_weakness_exact) so the UI never has to re-derive "weakness"
    # from raw score alone. best_pick is the highest real-score contributor;
    # structural_weakness prioritizes ROSTER CONSTRUCTION issues (off-position
    # starters named with their real position, missing wing/big coverage,
    # thin bench) over "whichever legend happened to score lowest" -- see
    # module docstring's "never blame a strong player for a fit problem" rule.
    best_pick: str | None = None
    structural_weakness: str | None = None
    # Phase 8 pre-loop polish: one-sentence plain-English explainer for
    # structural_weakness -- see simulation.py::_COMPONENT_EXPLAINERS. Exists
    # because a bare label like "thin bench depth" reads as a real basketball
    # insult on its own; the detail clarifies it's relative to PEAK3's 0-100
    # all-time-peak scale, not an absolute real-world judgment. None when the
    # weakness text is already fully self-explanatory (a named off-position
    # starter, a data-coverage gap, or the below-contender bare-name
    # fallback) or for legacy peak-window boards (same scope as best_pick).
    structural_weakness_detail: str | None = None
    # Phase 7A Part F: "weakness" | "ceiling_limiter" -- for a contender/
    # dynasty-tier result (wins >= 65), the UI should frame
    # structural_weakness as what's capping the ceiling ("Ceiling limiter:
    # bench strength"), not as a fault ("Weakness: ..."), since at that win
    # level nothing about the roster is actually bad. None for legacy
    # peak-window boards (same scope as best_pick/structural_weakness).
    weakness_framing: str | None = None
    # Phase 8H: "what PEAK3 would have picked" recap -- one entry per round,
    # computed post-completion only (result_ready already reveals every
    # placed card's real score; this extends the same reveal to the
    # UNPICKED candidates from each round, which is new information but
    # never shown before the roster is locked -- see
    # state.py::_compute_peak_picks_recap). None for a game that hasn't
    # completed. Each entry is a plain dict (not a further-nested dataclass,
    # matching LineupFitComponents.as_dict()'s existing plain-dict-at-the-
    # API-boundary convention): round_number, slot_type, picked_player_name,
    # picked_score, peak_pick_player_name, peak_pick_score, matched (bool).
    peak_picks_recap: list[dict] | None = None


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
    # Phase 6C: set instead of pending_selection_peak_window_id when the
    # current round is a team_year spin -- see CourtSlot.exact_player_season_key.
    pending_selection_exact_season_key: Optional[str] = None
    pending_selection_spin_id: Optional[str] = None
    simulation_result: Optional[SimulationResult] = None
    created_at: str = ""
    last_action_at: str = ""
    mode: str = ""
    duration_years: int = 1
    # Server-resolved only, never client-trusted (PHASE_5_DATA_MODEL.md
    # entity 8; same discipline as DraftGameState.owner_sub post-4.0A fix).
    owner_sub: Optional[str] = None
    # Phase 7A Part C: up to 3 team respins + 3 season respins for the
    # WHOLE 8-round run (never per-round -- Phase 6G's original per-round
    # reset was a bug), only usable while the current round's status is
    # "selection_pending" (locked the instant a player is selected -- see
    # action_select_player). NEVER reset by action_place_card -- once a
    # budget hits its max anywhere in the run, it stays disabled for every
    # remaining round. respin_history is a full receipt of every respin
    # this attempt has ever used, across all rounds -- never cleared, so
    # the final data receipt can show it.
    team_respins_used: int = 0
    season_respins_used: int = 0
    respin_history: list[dict] = field(default_factory=list)


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
