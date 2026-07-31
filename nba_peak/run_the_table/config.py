"""Versioned configuration for RUN THE TABLE.

Every tunable number in the game lives here. Nothing in the engine may
hard-code a threshold, weight, price coefficient, or roster size — the UI
reads these same values through the API so displayed rules and applied rules
can never drift apart.

Bumping ``RULESET_VERSION`` invalidates saved runs (see
``nba_peak.run_the_table.state.assert_version_compatible``).
"""
from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Versioning
# ---------------------------------------------------------------------------
ENGINE_VERSION: Final[str] = "run_the_table_v1"
RULESET_VERSION: Final[str] = "rtt_ruleset_v1"

# The card pool is the committed card-profile artifact. Kept in sync with
# nba_peak.lineup.config.CARD_PROFILE_VERSION so a card-pool rebuild is a
# visible, versioned event rather than a silent data swap.
CARD_POOL_VERSION: Final[str] = "v3"

# PEAK3 model artifact the card values come from.
PEAK3_MODEL_VERSION: Final[str] = "peak3_official_weights_v1"

# P0 ships the 3-year prime variant only. 1Y/5Y are deferred; the engine is
# parameterised on this value so enabling them is a config change plus a
# balance pass, not a rewrite.
DURATION_YEARS: Final[int] = 3
SUPPORTED_DURATIONS: Final[tuple[int, ...]] = (3,)


def version_tuple() -> dict[str, str]:
    """Full version fingerprint stamped onto every run and every saved result."""
    return {
        "engine_version": ENGINE_VERSION,
        "ruleset_version": RULESET_VERSION,
        "card_pool_version": CARD_POOL_VERSION,
        "peak3_model_version": PEAK3_MODEL_VERSION,
    }


def version_key(seed: int) -> str:
    """Stable opaque key encoding seed + the full version tuple.

    Mirrors ``nba_peak.lineup.board.make_board_version_key`` so persistence
    uniqueness works the same way across game modes.
    """
    return (
        f"rtt-{seed}@{ENGINE_VERSION}:{RULESET_VERSION}:"
        f"{CARD_POOL_VERSION}:{PEAK3_MODEL_VERSION}"
    )


# ---------------------------------------------------------------------------
# Canonical PEAK3 component lanes
# ---------------------------------------------------------------------------
# These are the repository's canonical component field names as emitted by
# scripts/build_web_dataset.py into data/web/peak_windows.json. They are NOT
# aliases — do not rename them here. ``teammate_adjustment`` is deliberately
# excluded: it is run context, not a capability lane (same rationale as
# nba_peak.lineup.config DNA v2).
LANE_FIELDS: Final[tuple[str, ...]] = (
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
)

# Display labels + design-token keys. Token names match the --comp-* custom
# properties documented in CLAUDE.md.
LANE_LABELS: Final[dict[str, str]] = {
    "statistical_impact": "Statistical Impact",
    "traditional_production": "Traditional Production",
    "individual_recognition": "Individual Recognition",
    "postseason_individual_value": "Playoff Rate Impact",
    "team_achievement": "Team Result",
}
LANE_TOKENS: Final[dict[str, str]] = {
    "statistical_impact": "si",
    "traditional_production": "tp",
    "individual_recognition": "rec",
    "postseason_individual_value": "po",
    "team_achievement": "team",
}

# Official PEAK3 weights, reproduced for display only. The engine never
# re-derives a PEAK3 score from these; they explain to the player how much of
# the overall number each lane accounts for.
LANE_PEAK3_WEIGHTS: Final[dict[str, float]] = {
    "statistical_impact": 0.38,
    "traditional_production": 0.21,
    "individual_recognition": 0.20,
    "postseason_individual_value": 0.18,
    "team_achievement": 0.03,
}

# ---------------------------------------------------------------------------
# Roster shape
# ---------------------------------------------------------------------------
# 5 starters + 2 bench. Decided after the architecture audit: the repository's
# role model (nba_peak.lineup.board.ROLES) is exactly five roles, and Peak
# Draft already ships a 5-role legality solver we reuse verbatim. A 5+2 roster
# keeps one full role-legal five on the floor plus a shallow bench whose weight
# is the lever two Systems and one boss rule pull on. 5+3 was rejected: with
# only 28 anchor-eligible cards in the 3Y pool, a third bench slot dilutes the
# bench-weight decision without adding a meaningful choice.
ROLES: Final[tuple[str, ...]] = (
    "lead_creator",
    "guard_wing",
    "wing_forward",
    "forward_big",
    "anchor",
)
STARTER_SLOTS: Final[int] = 5
BENCH_SLOTS: Final[int] = 2
ROSTER_SIZE: Final[int] = STARTER_SLOTS + BENCH_SLOTS

# ---------------------------------------------------------------------------
# Starting resources
# ---------------------------------------------------------------------------
STARTING_CREDITS: Final[int] = 40
STARTING_LIVES: Final[int] = 3
MAX_LIVES: Final[int] = 3

# The starting roster is drawn from this percentile band of the eligible 3Y
# pool, ordered by prime_score. Deliberately middle-tier: high enough to be a
# real team, low enough that every act demands upgrades.
START_ROSTER_PERCENTILE_BAND: Final[tuple[float, float]] = (0.28, 0.68)

# ---------------------------------------------------------------------------
# Pricing
# ---------------------------------------------------------------------------
# base_cost = PRICE_BASE + round(PRICE_SPAN * percentile ** PRICE_EXPONENT)
# `percentile` is the card's rank percentile in [0, 1] by prime_score within
# the eligible 3Y pool. Monotonic non-decreasing in percentile by construction.
PRICE_BASE: Final[int] = 4
PRICE_SPAN: Final[int] = 26
PRICE_EXPONENT: Final[float] = 2.0
PRICE_MIN: Final[int] = 1
PRICE_MAX: Final[int] = 30

# ---------------------------------------------------------------------------
# Trades
# ---------------------------------------------------------------------------
# Outgoing cards refund this fraction of their *current* price, rounded down.
TRADE_REFUND_PCT: Final[float] = 0.50

# ---------------------------------------------------------------------------
# Battle
# ---------------------------------------------------------------------------
STARTER_WEIGHT: Final[float] = 1.00
BENCH_WEIGHT_DEFAULT: Final[float] = 0.35
BENCH_WEIGHT_DEEP_ROTATION: Final[float] = 0.65
BENCH_WEIGHT_TOP_HEAVY: Final[float] = 0.15

LANES_TO_WIN: Final[int] = 3
# Lane scores are 0-100 normalised floats rounded to LANE_ROUNDING decimals
# before comparison, then compared with this epsilon. Rounding first makes the
# comparison stable across platforms; the epsilon guards float representation.
LANE_ROUNDING: Final[int] = 4
LANE_EPSILON: Final[float] = 1e-6

# Losing a battle costs one life and grants this consolation so one early
# mistake does not end the experience.
COMEBACK_CREDITS: Final[int] = 8

# ---------------------------------------------------------------------------
# Run shape
# ---------------------------------------------------------------------------
ACTS: Final[int] = 3
STAGES_PER_ACT: Final[int] = 2          # decision nodes before each boss
NODE_CHOICES_PER_STAGE: Final[int] = 2  # branching factor
DECISION_NODES: Final[int] = ACTS * STAGES_PER_ACT   # 6
BATTLES: Final[int] = ACTS                            # 3

NODE_TYPES: Final[tuple[str, ...]] = ("draft_room", "trade_desk", "film_room", "rest_bank")
OFFERS_PER_DRAFT: Final[int] = 3
OFFERS_PER_TRADE: Final[int] = 3

# Every generated Draft Room contains at least one offer whose BASE cost is at
# or below this number, so a player who has spent down to nothing still has a
# real move rather than only the escape hatch of passing.
#
# It is chosen, not derived. It equals FILM_CREDITS and sits below
# REST_CREDITS, so taking a single low-agency node always restores the ability
# to take the guaranteed offer; and it covers half the card pool (87 of 174 at
# CARD_POOL_VERSION v3), so the guarantee never collapses every board onto the
# same handful of cheap cards.
#
# It must stay >= the pool's minimum base cost (PRICE_BASE, or the guarantee is
# unsatisfiable) and < STARTING_CREDITS (or it is the identity filter and
# therefore no guarantee at all -- which is exactly the bug this constant
# replaces). tests/run_the_table/test_generation.py asserts both, and asserts
# the guarantee holds on every Draft Room over a seed sweep.
DRAFT_GUARANTEED_AFFORDABLE_COST: Final[int] = 10

# Rest / Bank
REST_CREDITS: Final[int] = 12
REST_LIFE_RECOVERY: Final[int] = 1

# Film Room
FILM_SCOUT_REVEALS_OFFERS: Final[bool] = True
FILM_CREDITS: Final[int] = 10

# Maximum generation attempts before the seed is declared infeasible. A seed
# that exhausts this is a bug, not a valid state — generation raises.
MAX_GENERATION_ATTEMPTS: Final[int] = 60

# ---------------------------------------------------------------------------
# Systems
# ---------------------------------------------------------------------------
MAX_SYSTEMS: Final[int] = 2
SYSTEM_CHOICES_OFFERED: Final[int] = 3

# Percentile thresholds are on the same [0, 1] prime_score percentile scale
# used by pricing.
MONEYBALL_PERCENTILE_MAX: Final[float] = 0.55
MONEYBALL_DISCOUNT: Final[float] = 0.35

NO_HARDWARE_RECOGNITION_PCT_MAX: Final[float] = 40.0
NO_HARDWARE_IMPACT_PCT_MIN: Final[float] = 60.0
NO_HARDWARE_DISCOUNT: Final[float] = 0.40

TWO_WAY_BALANCE_MAX_SPREAD: Final[float] = 28.0
TWO_WAY_IMPACT_PCT_MIN: Final[float] = 45.0
TWO_WAY_DISCOUNT: Final[float] = 0.30
# Upper bound is load-bearing: an all-time great is "balanced" because every
# lane is near the ceiling, so without this the System is a 30% GOAT coupon —
# the exact opposite of the scarcity it is supposed to create.
TWO_WAY_MAX_PERCENTILE: Final[float] = 0.78

TRADE_MACHINE_REFUND_PCT: Final[float] = 0.70

VETERAN_MINIMUM_PERCENTILE_MAX: Final[float] = 0.35
VETERAN_MINIMUM_USES_PER_ACT: Final[int] = 1

SYSTEMS: Final[tuple[dict, ...]] = (
    {
        "id": "moneyball",
        "name": "Moneyball",
        "summary": f"Cards in the bottom {round(MONEYBALL_PERCENTILE_MAX * 100)}% "
                   f"of PEAK3 3Y overall cost {round(MONEYBALL_DISCOUNT * 100)}% less.",
        "affects": "price",
    },
    {
        "id": "deep_rotation",
        "name": "Deep Rotation",
        # The boss caveat is load-bearing, not hedging: `battle.bench_weight_for`
        # lets a boss rule fix the bench weight for BOTH teams, which makes this
        # System redundant against Strength in Numbers and nullifies it against
        # Top Heavy. Saying "in every lane" without saying that was a claim the
        # engine does not honour.
        "summary": f"Your bench counts at {BENCH_WEIGHT_DEEP_ROTATION:.2f} instead of "
                   f"{BENCH_WEIGHT_DEFAULT:.2f} in every lane — unless a boss rule fixes "
                   f"the bench weight for both teams.",
        "affects": "battle",
    },
    {
        "id": "no_hardware",
        "name": "No Hardware",
        "summary": f"Cards below the {round(NO_HARDWARE_RECOGNITION_PCT_MAX)}th percentile in "
                   f"Individual Recognition but above the {round(NO_HARDWARE_IMPACT_PCT_MIN)}th "
                   f"percentile in Statistical Impact cost "
                   f"{round(NO_HARDWARE_DISCOUNT * 100)}% less.",
        "affects": "price",
    },
    {
        "id": "two_way_value",
        "name": "Two-Way Value",
        # TWO_WAY_MAX_PERCENTILE was applied but never published, so eight of the
        # pool's best cards (LeBron, Jordan, Jokic, Curry, Duncan, Giannis,
        # Durant, Hakeem) satisfied every stated condition and were still charged
        # full price. Every clause `pricing.qualifies_two_way` reads is now named.
        "summary": f"Cards in the bottom {round(TWO_WAY_MAX_PERCENTILE * 100)}% of PEAK3 3Y "
                   f"overall whose five component percentiles span "
                   f"{round(TWO_WAY_BALANCE_MAX_SPREAD)} points or less, with Statistical "
                   f"Impact above the {round(TWO_WAY_IMPACT_PCT_MIN)}th percentile, cost "
                   f"{round(TWO_WAY_DISCOUNT * 100)}% less.",
        "affects": "price",
    },
    {
        "id": "trade_machine",
        "name": "Trade Machine",
        "summary": f"Outgoing cards refund {round(TRADE_MACHINE_REFUND_PCT * 100)}% "
                   f"instead of {round(TRADE_REFUND_PCT * 100)}%.",
        "affects": "economy",
    },
    {
        "id": "veteran_minimum",
        # `state.action_draft_buy` is the only action that consults
        # `pricing.veteran_minimum_available`, so the discount is unreachable at
        # a Trade Desk. The summary now says where it works.
        "name": "Veteran Minimum",
        "summary": f"In the Draft Room only: {VETERAN_MINIMUM_USES_PER_ACT} card per act "
                   f"in the bottom {round(VETERAN_MINIMUM_PERCENTILE_MAX * 100)}% of PEAK3 3Y "
                   f"overall costs 0 credits.",
        "affects": "economy",
    },
)

SYSTEM_IDS: Final[tuple[str, ...]] = tuple(s["id"] for s in SYSTEMS)

# ---------------------------------------------------------------------------
# Published-threshold contract
# ---------------------------------------------------------------------------
# Every config constant each System's APPLIED rule reads, mapped to the exact
# rendering that must appear in that System's published ``summary``.
#
# This table exists because the drift it prevents already happened once:
# ``qualifies_two_way`` read TWO_WAY_MAX_PERCENTILE while the summary never
# mentioned it, so the published rule matched 26 cards and the applied rule
# matched 3. A prose summary and a predicate cannot be diffed by a machine;
# this table can. tests/run_the_table/test_cards_and_pricing.py walks it, so
# adding a condition to a predicate without publishing it fails there.
#
# Renderings are DERIVED from the constants, never retyped: changing a
# threshold changes both the summary and the expected substring together.
SYSTEM_PUBLISHED_THRESHOLDS: Final[dict[str, dict[str, str]]] = {
    "moneyball": {
        "MONEYBALL_PERCENTILE_MAX": f"bottom {round(MONEYBALL_PERCENTILE_MAX * 100)}%",
        "MONEYBALL_DISCOUNT": f"{round(MONEYBALL_DISCOUNT * 100)}% less",
    },
    "deep_rotation": {
        "BENCH_WEIGHT_DEEP_ROTATION": f"{BENCH_WEIGHT_DEEP_ROTATION:.2f}",
        "BENCH_WEIGHT_DEFAULT": f"{BENCH_WEIGHT_DEFAULT:.2f}",
    },
    "no_hardware": {
        "NO_HARDWARE_RECOGNITION_PCT_MAX":
            f"{round(NO_HARDWARE_RECOGNITION_PCT_MAX)}th percentile in Individual Recognition",
        "NO_HARDWARE_IMPACT_PCT_MIN":
            f"{round(NO_HARDWARE_IMPACT_PCT_MIN)}th percentile in Statistical Impact",
        "NO_HARDWARE_DISCOUNT": f"{round(NO_HARDWARE_DISCOUNT * 100)}% less",
    },
    "two_way_value": {
        "TWO_WAY_MAX_PERCENTILE": f"bottom {round(TWO_WAY_MAX_PERCENTILE * 100)}%",
        "TWO_WAY_BALANCE_MAX_SPREAD": f"{round(TWO_WAY_BALANCE_MAX_SPREAD)} points or less",
        "TWO_WAY_IMPACT_PCT_MIN": f"{round(TWO_WAY_IMPACT_PCT_MIN)}th percentile",
        "TWO_WAY_DISCOUNT": f"{round(TWO_WAY_DISCOUNT * 100)}% less",
    },
    "trade_machine": {
        "TRADE_MACHINE_REFUND_PCT": f"{round(TRADE_MACHINE_REFUND_PCT * 100)}%",
        "TRADE_REFUND_PCT": f"{round(TRADE_REFUND_PCT * 100)}%",
    },
    "veteran_minimum": {
        "VETERAN_MINIMUM_USES_PER_ACT": f"{VETERAN_MINIMUM_USES_PER_ACT} card per act",
        "VETERAN_MINIMUM_PERCENTILE_MAX": f"bottom {round(VETERAN_MINIMUM_PERCENTILE_MAX * 100)}%",
    },
}


def system_by_id(system_id: str) -> dict:
    for s in SYSTEMS:
        if s["id"] == system_id:
            return s
    raise KeyError(f"Unknown system '{system_id}'")


# ---------------------------------------------------------------------------
# Boss rules
# ---------------------------------------------------------------------------
# A boss rule is a transparent, symmetric modification of battle resolution.
# It may never modify an individual player's canonical component values.
BOSS_RULES: Final[dict[str, dict]] = {
    "the_wall": {
        "id": "the_wall",
        "name": "The Wall",
        "summary": "Traditional Production wins any exact lane tie, for both teams.",
    },
    "strength_in_numbers": {
        "id": "strength_in_numbers",
        "name": "Strength in Numbers",
        "summary": f"Bench weight is {BENCH_WEIGHT_DEEP_ROTATION:.2f} for both teams.",
    },
    "top_heavy": {
        "id": "top_heavy",
        "name": "Top Heavy",
        "summary": f"Bench weight is {BENCH_WEIGHT_TOP_HEAVY:.2f} for both teams — "
                   "starters decide it.",
    },
}

# Difficulty targets: the mean prime_score of each boss's five starters. Tuned
# against the real 3Y pool via scripts/audit_run_the_table.py so a base roster
# usually beats Boss 1, needs upgrades for Boss 2, and needs a strong run for
# Boss 3. Curated boss rosters are validated against these bands in tests.
BOSS_TARGET_STARTER_MEAN: Final[tuple[float, float, float]] = (61.0, 65.0, 70.0)
BOSS_TARGET_TOLERANCE: Final[float] = 2.5

# ---------------------------------------------------------------------------
# Run status values
# ---------------------------------------------------------------------------
STATUS_SYSTEM_SELECT: Final[str] = "system_select"
STATUS_NODE_SELECT: Final[str] = "node_select"
STATUS_NODE_ACTIVE: Final[str] = "node_active"
STATUS_BOSS_READY: Final[str] = "boss_ready"
STATUS_BOSS_RESOLVED: Final[str] = "boss_resolved"
STATUS_COMPLETE: Final[str] = "complete"
STATUS_FAILED: Final[str] = "failed"

TERMINAL_STATUSES: Final[frozenset[str]] = frozenset({STATUS_COMPLETE, STATUS_FAILED})

RUN_TYPES: Final[tuple[str, ...]] = ("standard", "daily", "challenge")
