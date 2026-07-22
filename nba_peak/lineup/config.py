"""Versioned configuration for the experimental lineup model v2.

All weights, thresholds, and rules are here so they can be changed in one place
and the version bumped without touching game-domain logic.

v2 changes vs v1:
  - DNA: removed peer_quality_adjustment (teammate_adjustment is context, not capability)
  - DNA: 7 → 6 dimensions; all 6 map directly to PEAK3 components + data_status
  - Data constraint: no per-stat breakdowns exist at card-profile layer; interior_defense,
    perimeter_defense, rebounding dimensions cannot be derived without fabrication
  - Roles: anchor redesigned — removed interior_defensive_profile (low-TP proxy) and
    playoff_team_contributor (team success alone); added recognition_validated_anchor
    (high recognition + low TP = recognition came from non-scoring contributions)
  - RULESET_VERSION: ruleset_v1 → ruleset_v2
  - CARD_PROFILE_VERSION: v1 → v2

v1 changes vs v0:
  - DNA: removed peak_tier and prime_index_normalized (rank-derived)
  - DNA: added peer_quality_adjustment (now removed in v2)
  - Anchor: added interior_defensive_profile and playoff_team_contributor (now removed in v2)
"""
from __future__ import annotations

LINEUP_MODEL_VERSION = "experimental_lineup_v3"
RULESET_VERSION = "ruleset_v3"
CARD_PROFILE_VERSION = "v3"

# ---------------------------------------------------------------------------
# Lineup peak rating weights
# Blueprint hypothesis: talent dominates
# ---------------------------------------------------------------------------
TALENT_WEIGHT: float = 0.78
COVERAGE_WEIGHT: float = 0.14
SYNERGY_WEIGHT: float = 0.08

# ---------------------------------------------------------------------------
# Talent scoring — diminishing contribution weights for 5 sorted peaks
# Weights sum to 1.0. Best peak contributes most.
# ---------------------------------------------------------------------------
TALENT_CARD_WEIGHTS: list[float] = [0.35, 0.27, 0.20, 0.12, 0.06]

# individual_peak_score normalisation range for talent
TALENT_SCORE_MIN: float = 0.0
TALENT_SCORE_MAX: float = 100.0  # prime_display scores are already 0-100

# ---------------------------------------------------------------------------
# Coverage — DNA dimension saturation parameters
# Each additional card covering the same dimension yields less benefit.
# saturation_alpha: weight of nth card = 1 / (1 + alpha * (n-1))
# ---------------------------------------------------------------------------
COVERAGE_SATURATION_ALPHA: float = 0.40
COVERAGE_CATASTROPHIC_HOLE_THRESHOLD: float = 15.0   # dimension score triggering penalty
COVERAGE_CATASTROPHIC_HOLE_PENALTY: float = 8.0      # flat penalty per hole

# DNA dimension names (must match card profile keys)
# v2: 6 dimensions. Removed peer_quality_adjustment (teammate_adjustment = context, not capability).
# All 6 map directly to PEAK3 component fields. No rank-derived or context-derived values.
# NOTE: per-stat breakdowns (defensive rating, rebound rate, block rate, position) are not
# available at card-profile layer, so interior_defense / perimeter_defense cannot be added
# without fabricating values. See docs/model/LINEUP_DNA_V2.md for data provenance.
DNA_DIMENSIONS: list[str] = [
    "primary_creation",
    "scoring_pressure",
    "individual_validation",
    "postseason_translation",
    "team_context",
    "context_completeness",
]

# ---------------------------------------------------------------------------
# Synergy rules — bounded, named, receipt-generating adjustments
# ---------------------------------------------------------------------------
SYNERGY_RULES: list[dict] = [
    # POSITIVE SYNERGIES
    {
        "id": "creator_anchor_balance",
        "type": "positive",
        "title": "Creator + Anchor balance",
        "description": "Lineup includes a lead creator and a postseason anchor.",
        "requires_roles": ["lead_creator", "anchor"],
        "adjustment": 0.018,
    },
    {
        "id": "scoring_depth",
        "type": "positive",
        "title": "Scoring depth",
        "description": "Three or more cards have scoring_pressure DNA >= 55.",
        "scoring_pressure_count": 3,
        "scoring_pressure_threshold": 55.0,
        "adjustment": 0.012,
    },
    {
        "id": "validation_core",
        "type": "positive",
        "title": "Peer-validated core",
        "description": "Two or more cards with individual_validation >= 75 (recognised elite).",
        "validation_count": 2,
        "validation_threshold": 75.0,
        "adjustment": 0.010,
    },
    # NEGATIVE SYNERGIES
    {
        "id": "no_lead_creator",
        "type": "negative",
        "title": "No lead creator",
        "description": "Lineup has no card eligible for the lead_creator role.",
        "missing_role": "lead_creator",
        "adjustment": -0.030,
    },
    {
        "id": "no_anchor",
        "type": "negative",
        "title": "No anchor",
        "description": "Lineup has no card eligible for the anchor role.",
        "missing_role": "anchor",
        "adjustment": -0.020,
    },
    {
        "id": "creation_overload",
        "type": "negative",
        "title": "Creation overload",
        "description": "Four or more cards with primary_creation >= 65 (likely redundant ball-handling).",
        "creation_count": 4,
        "creation_threshold": 65.0,
        "adjustment": -0.018,
    },
    {
        "id": "scoring_desert",
        "type": "negative",
        "title": "Scoring desert",
        "description": "Fewer than two cards with scoring_pressure >= 40.",
        "scoring_pressure_count_max": 2,
        "scoring_pressure_threshold": 40.0,
        "adjustment": -0.015,
    },
]

# Synergy bounds
SYNERGY_MAX: float = 0.06
SYNERGY_MIN: float = -0.06

# ---------------------------------------------------------------------------
# Board generation
# ---------------------------------------------------------------------------
BOARD_ROUNDS: int = 5
OFFERS_PER_ROUND: int = 3
REFRAME_POOL_MULTIPLIER: int = 3   # draw this many extra cards for reframe alternates
MAX_BOARD_ATTEMPTS: int = 50       # retries before giving up on feasibility
MIN_SCORE_SPREAD_WITHIN_ROUND: float = 3.0   # min prime_score spread in one round's offers

SUPPORTED_MODES: list[str] = ["apex_1y", "prime_3y", "foundation_5y"]
MODE_TO_YEARS: dict[str, int] = {
    "apex_1y": 1,
    "prime_3y": 3,
    "foundation_5y": 5,
}

# ---------------------------------------------------------------------------
# Solver — simulation policies
# ---------------------------------------------------------------------------
SIMULATION_POLICIES: list[str] = [
    "random_valid",
    "greedy_talent",
    "role_first",
    "dna_balance",
]
SIMULATION_N: int = 200    # random valid simulations per policy
FLOOR_PERCENTILE: float = 5.0   # percentile used as board floor for draft_efficiency
