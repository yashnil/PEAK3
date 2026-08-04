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
# Standard v3: 5 acts / 10 decision nodes / 5 bosses / 3 lives / 50 credits, with
# the final boss required to clear the table. See
# DAILY_RTT_PVP_SECURITY_PLAN §4.3.
#
# v3 changes the rules in three ways that make a v2 run unreplayable, which is
# why this bump is mandatory rather than cosmetic:
#   1. the run is five acts long, not four;
#   2. the Film Room is now Scout & Prepare and pays no credits at all;
#   3. mid-run income is cut and four published credit sinks are added.
# `state.assert_version_compatible` refuses a saved v2 run on sight, and
# `daily.daily_seed` is salted by this string so every daily board changes too.
#
# v4 changes three more things that make a v3 run unreplayable:
#   1. boss lineups are GENERATED PER RUN, relative to the roster that will
#      face them, instead of one fixed curated slate shared by every player;
#   2. no identity may appear on both the player's roster and a boss's roster
#      -- which changes which cards a run can be dealt and offered at all;
#   3. every market board excludes identities the run already owns, and each
#      act guarantees one top-decile "marquee" offer.
# The same refusal path applies: a v3 snapshot is rejected, not reinterpreted.
RULESET_VERSION: Final[str] = "rtt_ruleset_v4"
# The ruleset a saved run or a challenge token carries when it names no ruleset
# at all. Only v1 predates the field, so "unversioned" and "v1" are the same
# statement -- and inferring it is what lets an old challenge link report the
# rules it was actually minted under instead of silently claiming the new ones.
LEGACY_RULESET_VERSION: Final[str] = "rtt_ruleset_v1"

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
# v2 raised this from 40 to 50 because v2 adds a fourth act (two more decision
# nodes and one more boss) without adding a life. The extra 10 credits are
# roughly one mid-board card -- enough to arrive at the new final boss with a
# roster that can contest it, not enough to buy the top of the board.
#
# v3 adds a FIFTH act and holds this at 50 on purpose. The measured v2 problem
# was not a small starting purse, it was mid-run income: the do-nothing control
# finished holding a mean of 87.6 unspent credits against a 50-credit start,
# because Rest (12) + Film (10) + boss win (10) + comeback (8) roughly doubled
# the budget over eight nodes. v3 cuts every one of those income lines and adds
# four published sinks instead of touching the starting purse, so the opening
# decision a player already understands is unchanged.
STARTING_CREDITS: Final[int] = 50
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
# Outgoing cards refund this fraction of their *base* (undiscounted) price,
# rounded down -- see `pricing.refund_for`, which is the behaviour of record.
# This comment said "current" price for a long time and was simply wrong; the
# guided tour copied it into user-facing copy, where it promised players a
# refund that does not match the number the Trade Desk prints beside it.
# Basing the refund on base cost is what stops a price-discount System from
# being used to buy cheap and sell dear.
#
# v4: 0.50 -> 0.60. The measured acquisition-ceiling problem was budget, not
# supply (see MARQUEE_PERCENTILE_MIN). A 50% refund on a mid-board card returns
# 5-7 credits against a 23-30 credit marquee, so trading up was never a route
# to the top of the board -- only hoarding was, which is why the do-nothing
# banker out-cleared the aggressive spender 27.4% to 0.66%. 0.60 makes a
# trade-up fund roughly a quarter of a marquee instead of a fifth, which is
# enough to make the Trade Desk a real path to one without making a round-trip
# profitable: `refund_for` still floors, and the refund is still strictly less
# than the price, so churning a card still loses credits.
TRADE_REFUND_PCT: Final[float] = 0.60

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
#
# v3: 8 -> 6. There is one more battle in the run, so the same per-battle
# consolation would have paid MORE in total on a five-act run than it did on a
# four-act one, in a version whose whole economic problem was that mid-run
# income doubled the budget.
COMEBACK_CREDITS: Final[int] = 6

# Winning a battle pays this. v1 paid NOTHING for a win and 8 credits for a
# loss, so the only battle income in the game went to the player who was losing
# -- a run that won every fight was strictly poorer than one that lost, which is
# the opposite of what the economy should reward. The win reward is larger than
# the comeback so winning is never the poorer branch, and both are small
# relative to PRICE_MAX (30) so battles remain a test of the roster rather than
# an income stream.
#
# v3: 10 -> 9. Same reasoning as COMEBACK_CREDITS, and the ordering invariant
# (win pays strictly more than the comeback) is preserved and asserted in tests.
BOSS_WIN_CREDITS: Final[int] = 9

# ---------------------------------------------------------------------------
# Run shape
# ---------------------------------------------------------------------------
# v3: 4 -> 5 acts. Everything below derives from it, so the run shape is one
# number rather than five that can drift apart.
ACTS: Final[int] = 5
STAGES_PER_ACT: Final[int] = 2          # decision nodes before each boss
NODE_CHOICES_PER_STAGE: Final[int] = 2  # branching factor
DECISION_NODES: Final[int] = ACTS * STAGES_PER_ACT   # 10
BATTLES: Final[int] = ACTS                            # 5

# ``film_room`` is the stable node-type identifier. Its player-facing identity
# in v3 is "Scout & Prepare" (see _NODE_COPY in generation.py): the id is kept
# so an API/UI switch on node_type keeps resolving, while the *choices* changed
# completely -- which is where a stale client fails loudly instead of quietly.
NODE_TYPES: Final[tuple[str, ...]] = ("draft_room", "trade_desk", "film_room", "rest_bank")
OFFERS_PER_DRAFT: Final[int] = 3
OFFERS_PER_TRADE: Final[int] = 3

# Every generated Draft Room contains at least one offer whose BASE cost is at
# or below this number, so a player who has spent down to nothing still has a
# real move rather than only the escape hatch of passing.
#
# It is chosen, not derived. v3 lowers it from 10 to 8 so it stays at or below
# REST_CREDITS: the Film Room no longer pays credits at all, so Rest / Bank is
# now the ONLY node that restores a spent-out player, and the guarantee has to
# be reachable from a single visit to it. It still covers a large share of the
# card pool (72 of 174 at CARD_POOL_VERSION v3), so the guarantee never
# collapses every board onto the same handful of cheap cards.
#
# It must stay >= the pool's minimum base cost (PRICE_BASE, or the guarantee is
# unsatisfiable) and < STARTING_CREDITS (or it is the identity filter and
# therefore no guarantee at all -- which is exactly the bug this constant
# replaces). tests/run_the_table/test_generation.py asserts both, and asserts
# the guarantee holds on every Draft Room over a seed sweep.
DRAFT_GUARANTEED_AFFORDABLE_COST: Final[int] = 8

# ---------------------------------------------------------------------------
# The marquee guarantee (v4)
# ---------------------------------------------------------------------------
# MEASURED PROBLEM: the v3 boards already offered elite cards -- a best-branch
# sweep over 2,000 seeds found the best card reachable in a run had a median
# prime_score of 91.31, and a typical blueprint put 4-5 cards at or above 80 on
# some board. High-ceiling acquisition was never an OFFER problem. It was a
# BUDGET problem: all 28 pool cards at >=80 prime cost 23-30 credits against a
# 50-credit start, a mid-tier card refunds only 5-7, and the policy that spent
# most aggressively (`credit_spending`) had the second-WORST clear rate in the
# whole sweep at 0.66%.
#
# v4 fixes both halves, using existing game concepts rather than new mechanics:
#
#   1. MARQUEE_PERCENTILE_MIN + one guaranteed marquee offer per act makes the
#      opportunity real in EVERY act rather than a function of which branch the
#      seed happened to put a star on. It is the same construction as the
#      affordability guarantee at draft slot 0, inverted: one slot on one board
#      per act is reserved for the top decile.
#   2. TRADE_REFUND_PCT rises (see below) so the trade-up path can actually
#      fund one of these, which is what turns the guarantee from a display case
#      into a decision.
#
# Scarcity is preserved BY PRICE, not by hiding the card: one marquee per act,
# still costing 23-30 against a purse that funds roughly one of them per run,
# still needing a legal role slot, and still competing with the other branch of
# the same stage. A weak run gets no free superstar; a strong run cannot farm
# them.
MARQUEE_PERCENTILE_MIN: Final[float] = 0.90
MARQUEE_OFFERS_PER_ACT: Final[int] = 1

# Rest / Bank
# v3: 12 -> 11. Two more decision nodes in the run means the same deposit is
# taken more often; the total banked over a run is what the balance pass
# measures, not the per-visit number.
REST_CREDITS: Final[int] = 11
REST_LIFE_RECOVERY: Final[int] = 1

# ---------------------------------------------------------------------------
# Scout & Prepare (the v2 Film Room)
# ---------------------------------------------------------------------------
# MEASURED PROBLEM (docs/implementation/run-the-table-balance-v2.json, 100k
# seeds x 6 policies): the v2 Film Room was dead content. Pick rate was 0.0%
# for `lane_aware` -- zero visits in 100,000 runs -- 5.5% for `look_ahead`, and
# 8.7% for `greedy_overall`, which took `scout_offers` ZERO times against 69,455
# `take_credits`. Its information could not change a later decision, so every
# competent policy either avoided the node or treated it as a 10-credit ATM.
#
# v3 replaces it rather than expanding it. There is no "take credits" option at
# all -- FILM_CREDITS is deleted, not set to zero -- and all three choices are
# actionable:
#
#   A. Scout the Boss   free    boss rule + its two best lanes + its worst lane
#                               + a projected matchup, then ONE capped
#                               preparation bonus on one lane of your choosing
#                               for the next battle only.
#   B. Shape the Market  6      pick a role; the next market is guaranteed to
#                               carry at least one legal offer for it, and the
#                               next stage's boards are revealed.
#   C. Reserve a Card    5      three deterministic future cards are revealed;
#                               reserve one at its price TODAY and it appears in
#                               the next Draft Room.
#
# A is free by design: it is what keeps the node from dead-ending a player who
# has spent everything, exactly as `draft_pass` does at a Draft Room.
SCOUT_CHOICES: Final[tuple[str, ...]] = ("scout_boss", "shape_market", "reserve_card")

# The preparation bonus is a player-side, single-lane, single-battle modifier on
# the 0-100 lane index. Chosen at 2.5: large enough to flip a lane the player is
# losing narrowly, small enough that it cannot carry an outclassed roster (the
# Final Boss's published margin band alone is 4.0).
SCOUT_PREP_LANE_BONUS: Final[float] = 2.5

# How many future cards "Reserve a Future Card" reveals. Deterministic per node.
RESERVE_CHOICES_OFFERED: Final[int] = 3

# ---------------------------------------------------------------------------
# Credit sinks (spec §4)
# ---------------------------------------------------------------------------
# Four published prices. Every one of them is server-authoritative: the engine
# charges, the client only displays.
#
# MARKET_REFRESH_COST is the spec's number. It is deliberately just under a
# mid-board card so refreshing is a real alternative to buying, and it is capped
# at one refresh per node so it cannot become a re-roll slot machine.
MARKET_REFRESH_COST: Final[int] = 7
MARKET_REFRESHES_PER_NODE: Final[int] = 1

# Reserving costs less than shaping the market because it commits the player to
# one named card, while a role focus keeps every card in that role live.
RESERVE_CARD_COST: Final[int] = 5
ROLE_FOCUS_COST: Final[int] = 6

# Emergency Recovery is the run's largest sink and its only way to convert
# credits directly into survival. It is deliberately expensive -- 40% of the
# starting purse, more than the priciest card on the board minus its refund --
# and capped at once per run, so a bank strategy can buy exactly one mistake
# back and never a whole run's worth. It is additive to the free `recover_life`
# choice at the same node, so a Rest / Bank visit can take a player from one
# life to three; that is what makes it worth its price rather than a strictly
# worse version of the free option.
EMERGENCY_RECOVERY_COST: Final[int] = 20
EMERGENCY_RECOVERY_MAX_PER_RUN: Final[int] = 1

#: Every published credit sink, id -> (price, where it is offered). Enumerated
#: so the API can publish the price list without restating any number, and so
#: the audit can walk it.
CREDIT_SINKS: Final[dict[str, dict]] = {
    "market_refresh": {
        "id": "market_refresh",
        "name": "Market Refresh",
        "cost": MARKET_REFRESH_COST,
        "offered_at": ("draft_room", "trade_desk"),
        "limit": f"{MARKET_REFRESHES_PER_NODE} per node",
        "summary": f"Spend {MARKET_REFRESH_COST} credits to replace the current offers "
                   f"once. The replacement board is fixed by the seed, not rolled.",
    },
    "reserve_card": {
        "id": "reserve_card",
        "name": "Reserve a Card",
        "cost": RESERVE_CARD_COST,
        "offered_at": ("film_room",),
        "limit": "one live reservation at a time",
        "summary": f"Spend {RESERVE_CARD_COST} credits to reserve one revealed future card "
                   f"at its price today. It appears in the next Draft Room and expires "
                   f"after it.",
    },
    "role_focus": {
        "id": "role_focus",
        "name": "Role Focus",
        "cost": ROLE_FOCUS_COST,
        "offered_at": ("film_room",),
        "limit": "applies to the next market only",
        "summary": f"Spend {ROLE_FOCUS_COST} credits to guarantee at least one offer in the "
                   f"next market fits the role you choose.",
    },
    "emergency_recovery": {
        "id": "emergency_recovery",
        "name": "Emergency Recovery",
        "cost": EMERGENCY_RECOVERY_COST,
        "offered_at": ("rest_bank",),
        "limit": f"{EMERGENCY_RECOVERY_MAX_PER_RUN} per run",
        "summary": f"Spend {EMERGENCY_RECOVERY_COST} credits to recover one life, on top of "
                   f"whatever you take from this node. Once per run.",
    },
}

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

# v4: 0.70 -> 0.78, tracking the TRADE_REFUND_PCT rise so the System keeps the
# same ~18-point edge over the base refund it was designed with rather than
# being squeezed to a 10-point rounding difference. Still strictly below 1.0,
# so a buy-then-sell round trip continues to lose credits under it.
TRADE_MACHINE_REFUND_PCT: Final[float] = 0.78

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
        # v1 SHIPPED THIS AS A NET NERF. `battle.lane_score` is a weighted MEAN,
        # so raising the bench weight pulls the roster's lane score toward the
        # bench -- which LOWERS it whenever the bench is weaker than the
        # starters, i.e. for every generated starting roster and for every play
        # pattern that upgrades starters first. The published summary said the
        # bench "counts more"; the applied effect made you worse.
        #
        # v2 fixes the mechanic rather than the wording: the player's lane score
        # is the BETTER of the two bench weights, per lane. The bench can now
        # only ever help, which is what a player buying "Deep Rotation" is
        # buying. The boss caveat is still load-bearing: a boss rule that fixes
        # the bench weight for both teams overrides the choice entirely.
        "summary": f"Your bench counts at {BENCH_WEIGHT_DEEP_ROTATION:.2f} instead of "
                   f"{BENCH_WEIGHT_DEFAULT:.2f} in every lane where that helps you, and "
                   f"never in a lane where it would hurt — unless a boss rule fixes the "
                   f"bench weight for both teams.",
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
        # `battle.player_bench_weight_candidates` reads BOSS_BENCH_WEIGHT to
        # decide when a boss rule collapses the choice, so the summary has to
        # say that a boss rule can take the perk away.
        "BOSS_BENCH_WEIGHT": "unless a boss rule fixes the bench weight for both teams",
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
#
# LANE MARGIN RULES. `BOSS_LANE_MARGIN` raises the margin a lane must be won by
# before either side takes it; anything closer is drawn and nobody gets it.
#
# This replaces v1's `the_wall` tie-break, which read "Traditional Production
# wins any exact lane tie" and fired ZERO times in 120,000 audited battles:
# lane scores are rounded to LANE_ROUNDING (4) decimals, so an exact tie between
# two different rosters essentially cannot occur and the Act-1 tutorial boss was
# effectively rule-less. A published margin band is the same idea -- "a lane you
# have not really won is not yours" -- expressed as a threshold that fires.
#
# Symmetric by construction: the band is applied to |margin|, so it takes lanes
# away from both teams identically.
BOSS_LANE_MARGIN: Final[dict[str, float]] = {
    "the_wall": 1.5,
    "the_standard": 4.0,
}

# Boss rules that fix the bench weight for BOTH teams. Listed here rather than
# branched on inside `battle.bench_weight_for` so the set is enumerable by the
# published-threshold test.
BOSS_BENCH_WEIGHT: Final[dict[str, float]] = {
    "strength_in_numbers": BENCH_WEIGHT_DEEP_ROTATION,
    "top_heavy": BENCH_WEIGHT_TOP_HEAVY,
}

# Boss rules that raise how many lanes an outright win takes, for BOTH teams.
# v3's Final Boss uses this. Symmetric by construction: `battle.resolve_battle`
# reads one threshold and compares both sides' lane counts against it, so the
# only thing the rule can do is push more battles down into the published
# summed-margin tie-break -- which is a statement about the whole roster rather
# than about three lanes.
BOSS_LANES_TO_WIN: Final[dict[str, int]] = {
    "the_long_series": 4,
}

BOSS_RULES: Final[dict[str, dict]] = {
    "the_wall": {
        "id": "the_wall",
        "name": "The Wall",
        "summary": f"A lane is only taken if it is won by more than "
                   f"{BOSS_LANE_MARGIN['the_wall']:.2f} points. Anything closer is "
                   f"drawn and neither team gets it.",
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
    "the_standard": {
        "id": "the_standard",
        "name": "The Standard",
        "summary": f"A lane is only taken if it is won by more than "
                   f"{BOSS_LANE_MARGIN['the_standard']:.2f} points. Anything closer is "
                   f"drawn and neither team gets it.",
    },
    "the_long_series": {
        "id": "the_long_series",
        "name": "The Long Series",
        "summary": f"{BOSS_LANES_TO_WIN['the_long_series']} of the 5 lanes are needed to win "
                   f"outright, for both teams. Anything short of that is settled by the "
                   f"total margin across all five lanes.",
    },
}

# Every constant each boss rule's APPLIED behaviour reads, mapped to the exact
# rendering that must appear in that rule's published summary. Same contract as
# SYSTEM_PUBLISHED_THRESHOLDS and walked by the same style of test, so a boss
# rule can never quietly apply a threshold it did not publish.
BOSS_RULE_PUBLISHED_THRESHOLDS: Final[dict[str, dict[str, str]]] = {
    "the_wall": {
        "BOSS_LANE_MARGIN": f"{BOSS_LANE_MARGIN['the_wall']:.2f} points",
    },
    "strength_in_numbers": {
        "BOSS_BENCH_WEIGHT": f"{BENCH_WEIGHT_DEEP_ROTATION:.2f}",
    },
    "top_heavy": {
        "BOSS_BENCH_WEIGHT": f"{BENCH_WEIGHT_TOP_HEAVY:.2f}",
    },
    "the_standard": {
        "BOSS_LANE_MARGIN": f"{BOSS_LANE_MARGIN['the_standard']:.2f} points",
    },
    "the_long_series": {
        "BOSS_LANES_TO_WIN": f"{BOSS_LANES_TO_WIN['the_long_series']} of the 5 lanes",
    },
}

# ---------------------------------------------------------------------------
# Boss difficulty (v4: ROSTER-RELATIVE)
# ---------------------------------------------------------------------------
# v3 targeted an ABSOLUTE mean prime_score for each boss's five starters
# (61.0 / 65.0 / 70.0 / 74.5 / 76.5). Measured over 100,000 seeds x 8 policies
# (docs/implementation/run-the-table-balance-v3.json) that produced a run whose
# first fight was decided before it started and whose last one usually was too:
# act-1 win rate 97-99% for every competent policy, act-5 win rate 0.2-35%.
# An absolute target cannot do better, because the thing it is NOT measured
# against is the only thing that matters -- the roster actually standing across
# from it.
#
# v4 targets a DELTA on the authoritative lineup rating instead:
#
#     boss_target = player_lineup_rating + BOSS_RELATIVE_TARGET[act]
#                                        + BOSS_RULE_TARGET_OFFSET[rule]
#                                        + jitter
#
# `player_lineup_rating` is `battle.roster_total(player_lane_profile(...))` --
# the exact number the roster panel prints and the battle scores, not a
# prime_score mean and not a recomputed PEAK3 score. Same scale, both sides.
#
# THE NUMBERS ARE MEASURED, NOT CHOSEN. A sweep of 120 starting rosters x 6
# rules x 7 deltas established the local sensitivity: near parity, one point of
# lineup rating is worth roughly 13 percentage points of win rate, and the
# curve is monotonic over the whole band used here. The per-act deltas below
# are the inverse of that curve evaluated at the target midpoints, then
# corrected by the measured act-over-act drift of a live run (the player
# upgrades twice INSIDE an act after the boss is locked, and gains up to two
# Systems and a Scout preparation over the run, all of which push the realised
# rate above the static-roster rate).
# FITTED AGAINST LIVE RUNS, not against a static roster. A first pass set these
# from a 120-roster x 6-rule sweep that fought every boss with an UNMODIFIED
# starting five; measured against real play (300 seeds x 8 policies through the
# balance audit) that under-shot, because a live run also carries up to two
# Systems and a Scout preparation. These are the second iteration, solved from
# the realised per-act win rates so each act lands on the middle of its band.
BOSS_RELATIVE_TARGET: Final[tuple[float, ...]] = (0.57, 1.26, 1.28, 2.98, 2.91)

# ---------------------------------------------------------------------------
# How hard the opponent tracks the roster
# ---------------------------------------------------------------------------
# A boss that tracked the roster 1:1 is perfectly fair and almost pointless: it
# makes every fight the same fight, so building a better team buys nothing.
# Measured at full tracking, the do-nothing control cleared the table 15.8% of
# the time against the best policy's 32% -- a 2x spread across the entire skill
# range, when the whole game is the decisions.
#
# So the opponent tracks the roster PARTIALLY. Its target is anchored at a
# published reference rating and moves at BOSS_ROSTER_TRACKING of whatever the
# roster has gained above it:
#
#     target = ANCHOR + TRACKING * (player_rating - ANCHOR) + act_target
#
# At TRACKING = 1.0 this is pure rubber-banding. At 0.0 it is v3's absolute
# target, which is the defect. 0.72 keeps a weak roster's fight winnable -- a
# roster still near the anchor sees essentially no change -- while a roster that
# has been built up to 47 faces an opponent roughly 6.6 rating points below
# where full tracking would have put it. That gap IS the reward for playing
# well, and it is why an upgrade is worth buying.
#
# BOSS_ROSTER_ANCHOR is the median opening lineup rating over 600 seeds (23.36).
# It is a measured property of START_ROSTER_PERCENTILE_BAND, not a free
# parameter: every run starts at it, so at act 1 the tracking term is ~0 and the
# act target alone decides the fight.
BOSS_ROSTER_ANCHOR: Final[float] = 23.36
BOSS_ROSTER_TRACKING: Final[float] = 0.90

# Per-rule correction. At an identical delta the five rules do NOT produce an
# identical win rate, so a rule that is intrinsically easier for the player gets
# a HARDER opponent and vice versa -- otherwise the act band would mean five
# different things depending on which boss occupied it, and the act ramp and the
# rule assignment would be two uncontrolled variables measured as one.
#
# Also refitted from live play. The residual of each rule against a linear fit
# of win rate on delta (slope ~0.114 win rate per rating point, measured across
# the same 300-seed sweep) is what each number below converts back into rating
# points. Note the SUM of an act's entry here and its BOSS_RELATIVE_TARGET is
# the quantity that must rise monotonically -- neither half does on its own, and
# neither half is meaningful alone.
BOSS_RULE_TARGET_OFFSET: Final[dict[str, float]] = {
    "the_wall": 0.06,
    "strength_in_numbers": 0.33,
    "top_heavy": 0.91,
    "the_standard": -0.77,
    "the_long_series": 0.13,
}


def boss_combined_target(act: int, rule_id: str | None) -> float:
    """The published difficulty delta for an act, rule correction included.

    THIS is the number that must rise act over act, and the one every test and
    the balance audit compare a realised delta against. Published as a function
    so nothing has to add the two halves by hand and get the pairing wrong.
    """
    idx = max(0, min(len(BOSS_RELATIVE_TARGET) - 1, act - 1))
    return BOSS_RELATIVE_TARGET[idx] + (
        BOSS_RULE_TARGET_OFFSET.get(rule_id, 0.0) if rule_id else 0.0
    )

# Deterministic per-(seed, act) spread on the target, applied as
# uniform(-JITTER, +JITTER). This is what makes the per-act win-rate
# DISTRIBUTIONS OVERLAP rather than sit in five disjoint tiers: at ~13 points
# of win rate per point of rating, +/-0.6 is roughly +/-8 percentage points, so
# an individual act-4 boss can and does land harder than an individual act-5
# boss while act 5 stays hardest in aggregate. Deliberately not tunable per
# act -- a wider spread late would read as "the last boss is random".
BOSS_TARGET_JITTER: Final[float] = 0.75

# How close the search must get to the target before it stops looking. In
# rating points, on the same scale as BOSS_RELATIVE_TARGET.
BOSS_TARGET_TOLERANCE: Final[float] = 0.25

# Candidate lineups sampled per boss. 220 is where the measured miss-distance
# from the target stops improving materially (p95 miss 0.21 at 220 vs 0.19 at
# 600) while keeping a five-boss run inside the audit's time budget: the whole
# search is ~0.12 ms per candidate lineup.
BOSS_SEARCH_ATTEMPTS: Final[int] = 220

# How many cards from the top decile of the pool a boss should field. Difficulty
# is supposed to come from the TARGET, not from stacking GOATs: an opponent that
# hits its band with five all-time greats and one that hits it with a balanced
# seven are the same difficulty, and only one of them is interesting to play.
#
# A SOFT CAP, PRICED -- NOT A HARD FILTER, and that distinction was measured.
# As a hard filter it was unreachable at the top of the range: a player who had
# built a 47-rating roster by act 5 needed a ~49-rating opponent, no lineup of
# two-or-fewer elites could get there, and the strongest third of rosters
# therefore faced act-5 bosses at a mean delta of -0.09 while the weakest third
# faced +2.03. The cap was quietly handing the best players the easiest final
# boss -- the same "unfair to a roster it has not seen" failure the absolute
# targets had, arriving through a different door.
#
# Each card above the cap now costs BOSS_ELITE_OVERFLOW_PENALTY rating points
# of equivalent difficulty miss, so the search takes a third elite only when it
# buys more accuracy than that. Below the top of the range nothing changes; at
# the top the opponent can still be built.
BOSS_ELITE_PERCENTILE: Final[float] = 0.90
BOSS_MAX_ELITE_CARDS: Final[int] = 2
BOSS_ELITE_OVERFLOW_PENALTY: Final[float] = 0.50

# Relative weights of the three terms the lineup search optimises. Difficulty
# accuracy dominates by an order of magnitude on purpose: a boss that expresses
# its rule beautifully at the wrong difficulty is a balance regression, while a
# boss at the right difficulty that merely fits its rule loosely is not.
BOSS_WEIGHT_TARGET: Final[float] = 10.0
BOSS_WEIGHT_RULE_EXPRESSION: Final[float] = 1.0
BOSS_WEIGHT_DIVERSITY: Final[float] = 0.6

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

# v4: the player walked away from an unfinished run to start another one. It is
# over and cannot be resumed -- but it was never PLAYED to a conclusion, so it
# is deliberately not one of the two statuses that earn anything.
STATUS_ABANDONED: Final[str] = "abandoned"

# A run that can no longer be acted on. All three, because `state._guard` reads
# this to refuse further actions and an abandoned run must refuse them.
TERMINAL_STATUSES: Final[frozenset[str]] = frozenset(
    {STATUS_COMPLETE, STATUS_FAILED, STATUS_ABANDONED}
)

# A run that was played to a conclusion and therefore HAS a result.
#
# THE SPLIT IS THE POINT. `TERMINAL_STATUSES` answers "may this run be acted
# on"; this answers "did this run earn anything". Collapsing them would hand an
# abandoned run a receipt -- and with it a verdict, a record, a run MVP and
# every downstream reward that reads one -- for a run the player quit. Somebody
# who abandons in act 1 with three lives intact must not receive the same
# artifact as somebody who lost three battles.
CONCLUDED_STATUSES: Final[frozenset[str]] = frozenset(
    {STATUS_COMPLETE, STATUS_FAILED}
)

RUN_TYPES: Final[tuple[str, ...]] = ("standard", "daily", "challenge")
