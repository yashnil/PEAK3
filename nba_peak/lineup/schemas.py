"""Data schemas for the experimental lineup model.

Uses plain dataclasses (no Pydantic) so this module has no extra dependencies.
FastAPI Pydantic models that wrap these live in apps/api/app/models/draft.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class LineupDNA:
    """Six data-derived DNA dimensions (v2).

    Each dimension maps directly to a named PEAK3 component field.
    Removed from v1: peer_quality_adjustment (teammate_adjustment is context,
    not a lineup capability — it belongs in receipts and provenance, not Coverage).

    Data constraint: the PEAK3 dataset has only 6 aggregate component scores
    per window. Per-stat breakdowns (defensive rating, rebound rate, block rate,
    position metadata) are not available at the card-profile layer. This 6-dimension
    schema is the maximum defensible from the available data.
    """
    primary_creation: float          # ← statistical_impact (advanced metrics, defensive value included)
    scoring_pressure: float          # ← traditional_production (box score scoring + rebounding)
    individual_validation: float     # ← individual_recognition (MVP, All-NBA, DPOY, titles)
    postseason_translation: float    # ← postseason_individual_value (floored 0; includes availability)
    team_context: float              # ← team_achievement (championship + Finals contributions)
    context_completeness: float      # ← data_status (data quality; affects lineup confidence)

    def as_dict(self) -> dict[str, float]:
        return {
            "primary_creation":       self.primary_creation,
            "scoring_pressure":       self.scoring_pressure,
            "individual_validation":  self.individual_validation,
            "postseason_translation": self.postseason_translation,
            "team_context":           self.team_context,
            "context_completeness":   self.context_completeness,
        }


@dataclass
class CardProfile:
    """A single peak window with its role and DNA profile."""
    peak_window_id: str
    profile_version: str
    player_id: str
    player_slug: str
    player_name: str
    duration_years: int
    start_season: str
    end_season: str
    anchor_season: str
    individual_peak_score: float   # prime_display (0-100)
    individual_peak_rank: int
    prime_index: float             # internal ordering value (not displayed before reveal)
    eligible_roles: list[str]
    primary_role: Optional[str]
    lineup_dna: LineupDNA
    data_completeness: str
    profile_status: str            # verified_data_derived | provisional_data_derived | excluded

    @classmethod
    def from_dict(cls, d: dict) -> "CardProfile":
        dna_raw = d["lineup_dna"]
        dna = LineupDNA(
            primary_creation=dna_raw["primary_creation"],
            scoring_pressure=dna_raw["scoring_pressure"],
            individual_validation=dna_raw["individual_validation"],
            postseason_translation=dna_raw["postseason_translation"],
            team_context=dna_raw["team_context"],
            context_completeness=dna_raw["context_completeness"],
        )
        return cls(
            peak_window_id=d["peak_window_id"],
            profile_version=d["profile_version"],
            player_id=d["player_id"],
            player_slug=d["player_slug"],
            player_name=d["player_name"],
            duration_years=d["duration_years"],
            start_season=d["start_season"],
            end_season=d["end_season"],
            anchor_season=d["anchor_season"],
            individual_peak_score=d["individual_peak_score"],
            individual_peak_rank=d["individual_peak_rank"],
            prime_index=d.get("prime_index", 0.0),
            eligible_roles=d["eligible_roles"],
            primary_role=d.get("primary_role"),
            lineup_dna=dna,
            data_completeness=d.get("data_completeness", "unknown"),
            profile_status=d.get("profile_status", "unknown"),
        )


@dataclass
class RoundOffers:
    """Three card offers for one draft round."""
    round_number: int          # 1-5
    offers: list[CardProfile]  # exactly 3


@dataclass
class Board:
    """A fully generated Peak Draft board (private server-side structure)."""
    board_id: str
    mode: str
    duration_years: int
    board_type: str            # daily | practice | challenge
    date: Optional[str]        # for daily boards
    seed: int                  # for reproducibility
    rounds: list[RoundOffers]  # 5 rounds
    reframe_branches: dict[int, list[CardProfile]]  # round → 3 alt cards
    metadata: dict


@dataclass
class SynergyItem:
    """Result of evaluating one synergy rule."""
    rule_id: str
    rule_type: str             # positive | negative
    title: str
    description: str
    triggered: bool
    adjustment: float          # 0.0 if not triggered


@dataclass
class ReceiptItem:
    """One entry in the Peak Receipt."""
    id: str
    item_type: str             # talent_core | strength | weakness | interaction | data_warning | efficiency
    title: str
    plain_language: str
    signed_value: Optional[float]  # positive or negative magnitude
    input_ids: list[str]           # peak_window_ids contributing
    rule_id: Optional[str]
    model_version: str
    confidence: float              # 0-1 based on data completeness


@dataclass
class LineupEvaluation:
    """Complete result of evaluating a 5-card lineup."""
    # Version metadata
    lineup_model_version: str
    ruleset_version: str
    card_profile_version: str

    # Core scores
    lineup_peak_rating: float    # 0-100 composite
    talent_score: float          # 0-100 talent layer
    coverage_score: float        # 0-100 coverage layer
    synergy_total: float         # bounded adjustment applied to weighted sum
    raw_before_synergy: float    # talent*w + coverage*w before synergy

    # Components detail
    final_dna: LineupDNA         # aggregated lineup DNA
    role_assignments: dict[str, str]   # role → peak_window_id
    synergy_items: list[SynergyItem]
    receipt_items: list[ReceiptItem]

    # Completeness
    cards_evaluated: int         # should be 5
    missing_data_warnings: list[str]
    completeness: float          # 0-1

    # Board context (set by solver)
    board_optimum: Optional[float] = None
    board_floor: Optional[float] = None
    draft_efficiency: Optional[float] = None
    board_percentile: Optional[float] = None
    solver_version: Optional[str] = None


@dataclass
class GameAction:
    """A recorded action in the draft state machine."""
    action_type: str              # select_card | use_hold | use_reframe | complete
    round_number: int
    card_id: Optional[str] = None        # for select_card, use_hold
    role_assigned: Optional[str] = None  # for select_card
    idempotency_key: Optional[str] = None


@dataclass
class DraftGameState:
    """Complete game state (server-side, includes private data)."""
    game_id: str
    board: Board
    status: str                  # board_loaded | round_active | selection_pending |
                                 # hold_pending | reframe_pending | draft_complete | expired
    current_round: int           # 1-5
    selections: list[dict]       # [{round, card_id, role}]
    held_card_id: Optional[str]
    hold_round: Optional[int]   # which round hold was used in
    hold_used: bool
    reframe_used: bool
    reframed_rounds: list[int]   # which rounds were reframed
    action_log: list[GameAction]
    created_at: str
    last_action_at: str
    mode: str
    duration_years: int
    lineup_evaluation: Optional[LineupEvaluation]   # set on completion
    # Decision replay: the offers shown and the choice made, per completed round.
    # Only contains rounds already played (never future offers).
    round_history: list[dict] = field(default_factory=list)
