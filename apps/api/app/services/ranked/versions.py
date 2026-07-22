"""Versioned, immutable configuration for Phase 4.0 ranked duels.

Mirrors the style of ``nba_peak/lineup/config.py``: every constant that affects
a rated outcome is named, versioned, and bumped deliberately rather than
silently tuned. A match/ledger entry pins the version active at its creation
(see ADR-004 §15) so a later bump here never rewrites history — only future
matches roll onto a new version.

These are code constants, not environment variables (``core/config.py``
Settings), because they must be code-reviewed, not operator-configurable.
"""
from __future__ import annotations

from dataclasses import dataclass

from nba_peak.lineup.config import (
    CARD_PROFILE_VERSION,
    LINEUP_MODEL_VERSION,
    RULESET_VERSION,
    SUPPORTED_MODES,
)

# ---------------------------------------------------------------------------
# Ranked queues
#
# One queue per SUPPORTED_MODES entry (ADR-004 §1). Queue identity is the mode
# string itself; the human-facing label is separate from the identity so UI
# copy can change without touching stored data.
# ---------------------------------------------------------------------------
RANKED_QUEUE_MODES: list[str] = list(SUPPORTED_MODES)

RANKED_QUEUE_LABELS: dict[str, str] = {
    "apex_1y": "1Y Apex",
    "prime_3y": "3Y Prime",
    "foundation_5y": "5Y Foundation",
}

RANKED_QUEUE_VERSION = "ranked_queue_v1"

# The board generator branch used for ranked matches (nba_peak/lineup/board.py
# _derive_board_seed's "ranked" key). Independent from the daily/practice/
# challenge board_generation_algorithm value, versioned the same way.
RANKED_BOARD_GENERATOR_VERSION = "ranked_board_v1"

# Pinned model/ruleset/card-pool versions active for RANKED_QUEUE_VERSION.
# A model version bump does not retroactively change queue-version identity;
# it requires a deliberate new ranked_queue_versions row (see migration 011).
RANKED_QUEUE_PINNED_LINEUP_MODEL_VERSION = LINEUP_MODEL_VERSION
RANKED_QUEUE_PINNED_RULESET_VERSION = RULESET_VERSION
RANKED_QUEUE_PINNED_CARD_PROFILE_VERSION = CARD_PROFILE_VERSION
RANKED_QUEUE_PINNED_ANCHOR_ELIGIBILITY_VERSION = RULESET_VERSION

# ---------------------------------------------------------------------------
# Settlement
# ---------------------------------------------------------------------------
RANKED_SETTLEMENT_ALGORITHM_VERSION = "ranked_settlement_v1"

# ---------------------------------------------------------------------------
# Glicko-2 (ADR-004 §6-7)
# ---------------------------------------------------------------------------
GLICKO2_ALGORITHM_VERSION = "glicko2_v1"

GLICKO2_INITIAL_RATING = 1500.0
GLICKO2_INITIAL_RD = 350.0
GLICKO2_INITIAL_VOLATILITY = 0.06

# System constant tau. Glickman recommends 0.3-1.2; smaller values constrain
# volatility to change more slowly. 0.5 is the conservative middle of that
# range, chosen because closed alpha has low match volume per player and we
# do not want a handful of surprising results to swing volatility sharply.
GLICKO2_TAU = 0.5

# Convergence tolerance for the volatility root-find (Illinois algorithm per
# the published Glicko-2 paper, step 5).
GLICKO2_EPSILON = 1e-6

# Bounded iteration — if the root-find has not converged within this many
# iterations, glicko2.py raises Glicko2ConvergenceError rather than returning
# an unconverged, potentially wrong value.
GLICKO2_MAX_VOLATILITY_ITERATIONS = 100

# Display/safety bounds only — never used inside the algorithm itself, only
# to clamp what is rendered or to flag an impossible stored value during audit.
GLICKO2_DISPLAY_RATING_MIN = 100.0
GLICKO2_DISPLAY_RATING_MAX = 3500.0
GLICKO2_DISPLAY_RD_MIN = 30.0
GLICKO2_DISPLAY_RD_MAX = 350.0

# Rating-period strategy (ADR-004 §7): one rating period per settled match.
# Documented explicitly here (not just in prose) so any code inspecting this
# module sees the same claim the ADR and report make.
GLICKO2_RATING_PERIOD_STRATEGY = "one_match_per_period"

# Inactivity RD growth. Glicko-2 widens RD toward its ceiling when a player is
# inactive: RD' = min(sqrt(RD^2 + c^2 * t), RD_MAX), t = elapsed rating
# periods since last activity. Rating periods are per-match (not fixed
# calendar periods) in v1, so t is measured in elapsed days and c is
# calibrated so a fully-converged rating (RD at the display floor) returns to
# the initial RD ceiling after RANKED_INACTIVITY_FULL_RESET_DAYS of no rated
# activity in that queue.
RANKED_INACTIVITY_FULL_RESET_DAYS = 90.0
GLICKO2_INACTIVITY_C = (
    (GLICKO2_DISPLAY_RD_MAX**2 - GLICKO2_DISPLAY_RD_MIN**2) / RANKED_INACTIVITY_FULL_RESET_DAYS
) ** 0.5

# ---------------------------------------------------------------------------
# Placements (ADR-004 §8)
# ---------------------------------------------------------------------------
RANKED_PLACEMENT_MATCH_COUNT = 7

# ---------------------------------------------------------------------------
# Divisions (ADR-004 §10) — explicitly provisional for closed alpha.
#
# Thresholds are placeholders generated from the initial-rating assumption
# (median player centers on GLICKO2_INITIAL_RATING) and refined by
# scripts/ranked_validation/simulate_glicko.py's distribution report before
# any migration to a v2 threshold set. They are NOT derived from intuition
# about "what an All-Star should mean" — see ADR-004 §10 and the Phase 4.0
# report distribution section.
# ---------------------------------------------------------------------------
DIVISION_VERSION = "division_v1_provisional"

DIVISION_THRESHOLDS: list[tuple[float, str]] = [
    (0.0, "Prospect"),
    (1350.0, "Rotation"),
    (1500.0, "Starter"),
    (1650.0, "All-Star"),
    (1800.0, "All-NBA"),
    (1950.0, "MVP"),
    (2100.0, "Legend"),
]

# Legend requires both a rating above its threshold AND a minimum number of
# valid rated matches, so a single lucky early match cannot mint a "Legend."
DIVISION_LEGEND_MIN_VALID_MATCHES = 30

# MVP/Legend remain suppressed from any public-facing display (leaderboards,
# public profile) until the queue's established (placement-complete, non-
# provisional) population reaches this size.
DIVISION_HIGH_TIER_MIN_QUEUE_POPULATION = 100


def division_for_rating(rating: float, valid_matches: int) -> str:
    """Return the division label for a rating under DIVISION_VERSION.

    Pure function of (rating, valid_matches) — never RD, XP, or any
    progression state, per ADR-004 §10/§17.
    """
    label = DIVISION_THRESHOLDS[0][1]
    for threshold, name in DIVISION_THRESHOLDS:
        if rating >= threshold:
            label = name
        else:
            break
    if label == "Legend" and valid_matches < DIVISION_LEGEND_MIN_VALID_MATCHES:
        # Fall back to the next-highest division until activity is sufficient.
        label = "MVP"
    return label


@dataclass(frozen=True)
class RankedQueueVersion:
    """One row's worth of pinned configuration for a ranked queue version.

    Mirrors infra/migrations/011_ranked_config.sql's ranked_queue_versions
    table — this dataclass is the in-code mirror used by services that do not
    want to round-trip through a repository just to read immutable constants.
    """

    mode: str
    ruleset_version: str = RANKED_QUEUE_PINNED_RULESET_VERSION
    lineup_model_version: str = RANKED_QUEUE_PINNED_LINEUP_MODEL_VERSION
    card_pool_version: str = RANKED_QUEUE_PINNED_CARD_PROFILE_VERSION
    board_generator_version: str = RANKED_BOARD_GENERATOR_VERSION
    anchor_eligibility_version: str = RANKED_QUEUE_PINNED_ANCHOR_ELIGIBILITY_VERSION
    rating_algorithm_version: str = GLICKO2_ALGORITHM_VERSION
    placement_count: int = RANKED_PLACEMENT_MATCH_COUNT
    queue_version: str = RANKED_QUEUE_VERSION


def default_queue_versions() -> dict[str, RankedQueueVersion]:
    return {mode: RankedQueueVersion(mode=mode) for mode in RANKED_QUEUE_MODES}
