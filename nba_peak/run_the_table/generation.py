"""Deterministic run generation for RUN THE TABLE.

A :class:`RunBlueprint` is a pure function of
``(seed, ruleset_version, engine_version, card_pool_version)``. Generating the
same seed twice produces a byte-identical blueprint; the audit script proves
this over thousands of seeds.

Sub-seed convention follows the repository's existing pattern
(``nba_peak/lineup/board.py``, ``nba_peak/perfect_season/board.py``): a derived
``random.Random`` per stream, keyed by a descriptive string, so adding a stream
later does not shift any existing stream's output.
"""
from __future__ import annotations

import random
from typing import Optional

from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    MARQUEE_OFFERS_PER_ACT,
    MARQUEE_PERCENTILE_MIN,
    MAX_GENERATION_ATTEMPTS,
    NODE_CHOICES_PER_STAGE,
    OFFERS_PER_DRAFT,
    OFFERS_PER_TRADE,
    RESERVE_CHOICES_OFFERED,
    REST_CREDITS,
    ROLES,
    STAGES_PER_ACT,
    START_ROSTER_PERCENTILE_BAND,
    SYSTEM_CHOICES_OFFERED,
    SYSTEM_IDS,
    version_tuple,
)
from nba_peak.run_the_table.pricing import price_for
from nba_peak.run_the_table.schemas import NodeOption, RunBlueprint, StagePlan


class RunGenerationError(RuntimeError):
    """A seed could not produce a legal run. Always a bug, never a valid state."""


def _rng(seed: int, stream: str) -> random.Random:
    return random.Random(f"rtt:{seed}:{stream}")


# ---------------------------------------------------------------------------
# Starting roster
# ---------------------------------------------------------------------------
def generate_starting_roster(
    pool: CardPool, seed: int
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """A role-legal, duplicate-free 5 + 2 roster from the middle tier.

    Roles are filled scarcest-first (``anchor`` has by far the fewest eligible
    cards), which is what makes the search succeed on the first attempt for
    essentially every seed instead of backtracking.
    """
    lo, hi = START_ROSTER_PERCENTILE_BAND
    band = pool.by_percentile_band(lo, hi)
    if len(band) < len(ROLES) + BENCH_SLOTS:
        raise RunGenerationError(
            f"Starting-roster band [{lo}, {hi}] holds only {len(band)} cards; "
            f"need at least {len(ROLES) + BENCH_SLOTS}."
        )

    scarcity = sorted(ROLES, key=lambda r: sum(1 for c in band if r in c.eligible_roles))

    for attempt in range(MAX_GENERATION_ATTEMPTS):
        rng = _rng(seed, f"start-roster:{attempt}")
        used_slugs: set[str] = set()
        by_role: dict[str, str] = {}
        ok = True
        for role in scarcity:
            options = [
                c for c in band
                if role in c.eligible_roles and c.player_slug not in used_slugs
            ]
            if not options:
                ok = False
                break
            pick = rng.choice(options)
            by_role[role] = pick.peak_window_id
            used_slugs.add(pick.player_slug)
        if not ok:
            continue
        rest = [c for c in band if c.player_slug not in used_slugs]
        if len(rest) < BENCH_SLOTS:
            continue
        bench = rng.sample(rest, BENCH_SLOTS)
        return (
            tuple(by_role[r] for r in ROLES),
            tuple(c.peak_window_id for c in bench),
        )

    raise RunGenerationError(
        f"Could not build a legal starting roster for seed {seed} after "
        f"{MAX_GENERATION_ATTEMPTS} attempts."
    )


# ---------------------------------------------------------------------------
# Systems
# ---------------------------------------------------------------------------
def generate_system_offers(seed: int) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Two independent offers of three Systems each.

    The second offer excludes nothing up front — the state machine filters out
    an already-held System at selection time, and always leaves at least one
    legal choice because three are offered and at most one can be held.
    """
    rng = _rng(seed, "systems")
    first = tuple(rng.sample(SYSTEM_IDS, SYSTEM_CHOICES_OFFERED))
    second = tuple(rng.sample(SYSTEM_IDS, SYSTEM_CHOICES_OFFERED))
    return first, second


# ---------------------------------------------------------------------------
# Node offers
# ---------------------------------------------------------------------------
def marquee_candidates(pool: CardPool, exclude_slugs: frozenset[str] = frozenset()) -> list[str]:
    """The cards that satisfy the marquee guarantee, in canonical order.

    A marquee card is one at or above ``MARQUEE_PERCENTILE_MIN`` of the pool by
    prime_score -- the top decile, 28 cards at CARD_POOL_VERSION v3, all of
    them costing 23-30 credits. See the constant for why the guarantee exists
    and why price, not scarcity of supply, is what keeps it honest.
    """
    return [
        c.peak_window_id
        for c in pool.cards
        if c.overall_percentile >= MARQUEE_PERCENTILE_MIN
        and c.player_slug not in exclude_slugs
    ]


def _place_marquee(
    pool: CardPool,
    rng: random.Random,
    picks: list[str],
    exclude_slugs: frozenset[str],
    protected_index: Optional[int],
) -> list[str]:
    """Force one marquee card onto this board if it does not already carry one.

    ``protected_index`` is the slot the caller may NOT overwrite -- slot 0 of a
    Draft Room carries the affordability guarantee, and a board that is
    guaranteed to hold a card a broke player can buy must not have that
    guarantee replaced by one they certainly cannot. The marquee therefore
    lands on the LAST slot, exactly as Role Focus does and for the same reason.
    """
    if any(
        pool.get(cid).overall_percentile >= MARQUEE_PERCENTILE_MIN for cid in picks
    ):
        return picks
    on_board = {pool.get(cid).player_slug for cid in picks}
    candidates = marquee_candidates(pool, exclude_slugs | frozenset(on_board))
    if not candidates:
        # Unreachable with the real pool (28 marquee cards against a 7-card
        # roster) but the engine must not fabricate an offer.
        raise RunGenerationError("No marquee card is available for this board")
    out = list(picks)
    target = len(out) - 1
    if protected_index is not None and target == protected_index:
        target = max(0, len(out) - 2)
    out[target] = rng.choice(candidates)
    return out


def _draft_offers(
    pool: CardPool,
    seed: int,
    node_id: str,
    exclude_slugs: frozenset[str],
    guaranteed_affordable_cost: int,
    require_marquee: bool = False,
) -> list[str]:
    """Three offers, at least one of them cheap enough for a broke player.

    The guarantee is on ``DRAFT_GUARANTEED_AFFORDABLE_COST``, NOT on
    ``STARTING_CREDITS``. That distinction is the whole point: ``PRICE_MAX`` is
    30, so filtering at the 40-credit starting budget accepted every card in the
    pool and the "guaranteed affordable anchor" was an unconstrained random
    draw. Filtering at a published, genuinely low cost makes the guarantee mean
    something a player who has spent everything can actually use.

    Combined with the always-legal "pass" action this makes a dead-end node
    impossible, and it bounds how bad a Draft Room can be rather than merely
    asserting that it is not infinitely bad.
    """
    rng = _rng(seed, f"draft:{node_id}")
    candidates = [c for c in pool.cards if c.player_slug not in exclude_slugs]
    if len(candidates) < OFFERS_PER_DRAFT:
        raise RunGenerationError(f"Not enough cards to fill draft node {node_id}")

    affordable = [c for c in candidates if c.base_cost <= guaranteed_affordable_cost]
    if not affordable:
        # Cannot happen with the real pool (min base cost is PRICE_BASE = 4, well
        # under the guarantee) but the engine must not fabricate an offer if it
        # ever does -- an unsatisfiable guarantee is a config bug, not a board.
        raise RunGenerationError(
            f"No card exists at or below the guaranteed affordable cost of "
            f"{guaranteed_affordable_cost} credits for node {node_id}"
        )

    # Guarantee: slot 0 is always affordable; slots 1-2 are drawn freely so the
    # node still presents an aspirational, unaffordable option worth saving for.
    anchor = rng.choice(affordable)
    rest_pool = [c for c in candidates if c.player_slug != anchor.player_slug]
    rng.shuffle(rest_pool)
    picks = [anchor]
    seen = {anchor.player_slug}
    for c in rest_pool:
        if len(picks) >= OFFERS_PER_DRAFT:
            break
        if c.player_slug in seen:
            continue
        picks.append(c)
        seen.add(c.player_slug)
    if len(picks) < OFFERS_PER_DRAFT:
        raise RunGenerationError(f"Could not fill draft node {node_id}")

    rng.shuffle(picks)
    ids = [c.peak_window_id for c in picks]
    if require_marquee:
        # The anchor is affordability-guaranteed and must survive, so tell
        # `_place_marquee` which slot it occupies after the shuffle.
        anchor_index = ids.index(anchor.peak_window_id)
        ids = _place_marquee(pool, rng, ids, exclude_slugs, anchor_index)
    return ids


def _trade_offers(
    pool: CardPool,
    seed: int,
    node_id: str,
    exclude_slugs: frozenset[str],
    require_marquee: bool = False,
) -> list[str]:
    rng = _rng(seed, f"trade:{node_id}")
    candidates = [c for c in pool.cards if c.player_slug not in exclude_slugs]
    if len(candidates) < OFFERS_PER_TRADE:
        raise RunGenerationError(f"Not enough cards to fill trade node {node_id}")
    picks = rng.sample(candidates, OFFERS_PER_TRADE)
    ids = [c.peak_window_id for c in picks]
    if require_marquee:
        # No affordability guarantee on a trade board, so no protected slot.
        ids = _place_marquee(pool, rng, ids, exclude_slugs, None)
    return ids


def _reserve_candidates(
    pool: CardPool, seed: int, node_id: str, exclude_slugs: frozenset[str]
) -> list[str]:
    """The future cards "Reserve a Future Card" reveals at this node.

    Deterministic per node and generated up front, so the set a player is shown
    is part of the blueprint rather than something the server invents when
    asked. Drawn from the whole pool minus the starting roster, exactly like a
    Draft Room board, so a reservation can be genuinely aspirational.
    """
    rng = _rng(seed, f"reserve:{node_id}")
    candidates = [c for c in pool.cards if c.player_slug not in exclude_slugs]
    if len(candidates) < RESERVE_CHOICES_OFFERED:
        raise RunGenerationError(f"Not enough cards to fill reserve node {node_id}")
    picks = rng.sample(candidates, RESERVE_CHOICES_OFFERED)
    return [c.peak_window_id for c in picks]


_NODE_COPY: dict[str, tuple[str, str]] = {
    "draft_room": (
        "Draft Room",
        "Three exact peak windows on the board. Buy one and slot it, or pass and bank the credits.",
    ),
    "trade_desk": (
        "Trade Desk",
        "Send one card out for a published refund, and choose from three legal replacements.",
    ),
    "film_room": (
        "Scout & Prepare",
        "Scout the next boss and prepare one lane, shape the next market, or "
        "reserve a future card at today's price.",
    ),
    "rest_bank": (
        "Rest / Bank",
        "Recover a life, or take a fixed credit deposit. One or the other.",
    ),
}


def _stage_node_types(seed: int, act: int, stage: int) -> tuple[str, str]:
    """Two genuinely different node types for this stage.

    Constraints that make the branch a real decision rather than two identical
    doors:
      * the two options are never the same type;
      * the very first stage always offers a Draft Room, so a new player's
        first decision is the one the tutorial copy describes;
      * Rest / Bank is never paired against Film Room (two low-agency options).
    """
    rng = _rng(seed, f"nodes:{act}:{stage}")
    if act == 1 and stage == 1:
        other = rng.choice(["trade_desk", "film_room", "rest_bank"])
        pair = ["draft_room", other]
        rng.shuffle(pair)
        return pair[0], pair[1]

    while True:
        a, b = rng.sample(["draft_room", "trade_desk", "film_room", "rest_bank"], 2)
        if {a, b} == {"rest_bank", "film_room"}:
            continue
        return a, b


_MARKET_NODE_TYPES = ("draft_room", "trade_desk")


def _marquee_node_ids(seed: int) -> frozenset[str]:
    """Which node in each act carries the guaranteed top-decile offer.

    Deterministic, one keyed stream, chosen among the act's market nodes only.
    Every stage is guaranteed to contain at least one market node -- the two
    non-market types (``rest_bank`` and ``film_room``) are the one pair
    ``_stage_node_types`` refuses to emit -- so a market node always exists to
    receive the guarantee.
    """
    rng = _rng(seed, "marquee")
    out: set[str] = set()
    for act in range(1, ACTS + 1):
        market_nodes: list[str] = []
        for stage in range(1, STAGES_PER_ACT + 1):
            for idx, node_type in enumerate(_stage_node_types(seed, act, stage)):
                if node_type in _MARKET_NODE_TYPES:
                    market_nodes.append(f"a{act}s{stage}o{idx}")
        if not market_nodes:
            raise RunGenerationError(
                f"Act {act} of seed {seed} has no market node to carry the "
                f"marquee guarantee."
            )
        out.update(rng.sample(market_nodes, min(MARQUEE_OFFERS_PER_ACT, len(market_nodes))))
    return frozenset(out)


def generate_blueprint(
    seed: int,
    run_type: str = "standard",
    date: Optional[str] = None,
    pool: Optional[CardPool] = None,
) -> RunBlueprint:
    """Build the complete deterministic content of a run."""
    pool = pool or get_pool()
    starters, bench = generate_starting_roster(pool, seed)
    start_slugs = frozenset(pool.get(cid).player_slug for cid in starters + bench)
    system_offers = generate_system_offers(seed)

    # v4: NO BOSS GENERATION HERE. Under v3 this function resolved the five
    # curated bosses, computed their slugs, and then threw that set away --
    # which is exactly how the same player ended up on both rosters. The
    # dependency now runs the other way: the roster is drawn from the seed
    # first, and each boss is generated against it when its act begins
    # (`state.ensure_boss_for_act`), excluding every identity the run owns. A
    # collision is therefore impossible by construction rather than prevented
    # by a filter somebody has to remember to apply.
    #
    # Cards already on the starting roster are still excluded from every board
    # here, so an opening board can never offer a card the run already holds.
    # Cards acquired LATER are excluded at read time instead -- see
    # `market_offers`, which takes the run's live owned-identity set, because a
    # board fixed at blueprint time cannot know what act 3 bought.
    exclude = start_slugs

    # One board per act is guaranteed to carry a top-decile card. Which one is
    # decided here, deterministically, from a stream of its own so it cannot
    # shift any existing stream. It is chosen among the act's MARKET nodes only
    # (every stage has at least one -- `_stage_node_types` never pairs the two
    # non-market types), so the guarantee always has somewhere to land.
    marquee_nodes = _marquee_node_ids(seed)

    stages: list[StagePlan] = []
    for act in range(1, ACTS + 1):
        for stage in range(1, STAGES_PER_ACT + 1):
            type_a, type_b = _stage_node_types(seed, act, stage)
            options: list[NodeOption] = []
            payloads: dict[str, dict] = {}
            for idx, node_type in enumerate((type_a, type_b)):
                node_id = f"a{act}s{stage}o{idx}"
                title, summary = _NODE_COPY[node_type]
                options.append(
                    NodeOption(
                        node_id=node_id, node_type=node_type, title=title, summary=summary
                    )
                )
                is_marquee = node_id in marquee_nodes
                if node_type == "draft_room":
                    # The budget the guarantee is written against is the WORST
                    # case, not the starting one: a player arriving here may have
                    # spent every credit they had. So the anchor offer is capped
                    # at the published DRAFT_GUARANTEED_AFFORDABLE_COST, which a
                    # single Rest / Bank or Film Room always restores them to.
                    payloads[node_id] = {
                        "offer_ids": _draft_offers(
                            pool, seed, node_id, exclude,
                            DRAFT_GUARANTEED_AFFORDABLE_COST,
                            require_marquee=is_marquee,
                        )
                    }
                elif node_type == "trade_desk":
                    payloads[node_id] = {
                        "incoming_ids": _trade_offers(
                            pool, seed, node_id, exclude, require_marquee=is_marquee
                        )
                    }
                elif node_type == "film_room":
                    # No "credits" key at all. Scout & Prepare pays nothing —
                    # that is the point of the v3 replacement, and leaving a
                    # zeroed credit field here would let a client keep
                    # advertising an ATM that no longer exists.
                    payloads[node_id] = {
                        "reserve_candidate_ids": _reserve_candidates(
                            pool, seed, node_id, exclude
                        )
                    }
                else:
                    payloads[node_id] = {"credits": REST_CREDITS}

            stages.append(
                StagePlan(act=act, stage=stage, options=tuple(options), payloads=payloads)
            )

    metadata = {
        **version_tuple(),
        "card_pool_size": len(pool),
        "excluded_profiles": pool.stats.excluded_count,
        "duration_years": pool.stats.duration_years,
        # v4: no `boss_sources`. The blueprint no longer knows the bosses --
        # they are generated per act against the live roster and recorded on the
        # run state, which is where `Opponent.source` now lives.
        "marquee_node_ids": sorted(marquee_nodes),
        "generation_algorithm": "rtt_gen_v2",
    }

    return RunBlueprint(
        seed=seed,
        run_type=run_type,
        date=date,
        starting_starters=starters,
        starting_bench=bench,
        system_offers=system_offers,
        stages=tuple(stages),
        metadata=metadata,
    )


def stage_for(blueprint: RunBlueprint, act: int, stage: int) -> StagePlan:
    for s in blueprint.stages:
        if s.act == act and s.stage == stage:
            return s
    raise KeyError(f"No stage plan for act {act} stage {stage}")


def node_option(blueprint: RunBlueprint, node_id: str) -> tuple[StagePlan, NodeOption]:
    for s in blueprint.stages:
        for o in s.options:
            if o.node_id == node_id:
                return s, o
    raise KeyError(f"Unknown node id '{node_id}'")


# ---------------------------------------------------------------------------
# Live market offers (v3)
# ---------------------------------------------------------------------------
# A node's board is no longer simply ``plan.payloads[node_id]``. Three published
# player actions can change it before it is played:
#
#   * Market Refresh replaces it once, with a deterministic second board;
#   * Role Focus guarantees it carries at least one offer for a chosen role;
#   * a live reservation adds the reserved card to the next Draft Room.
#
# :func:`market_offers` is the single place those three compose, and it is a
# pure function of (blueprint, pool, node_id, refresh_index, role_focus,
# reserved_card_id). The state machine calls it to validate a purchase and the
# API layer calls it to render the board, so what is shown and what is legal
# cannot drift apart. Everything it draws uses its own keyed stream, so none of
# it can shift an existing stream's output.
_OFFER_KEY = {"draft_room": "offer_ids", "trade_desk": "incoming_ids"}


def starting_roster_slugs(pool: CardPool, blueprint: RunBlueprint) -> frozenset[str]:
    """The identities excluded from every generated board for this run."""
    return frozenset(
        pool.get(cid).player_slug
        for cid in list(blueprint.starting_starters) + list(blueprint.starting_bench)
    )


def refreshed_offers(
    pool: CardPool,
    blueprint: RunBlueprint,
    node_id: str,
    refresh_index: int,
) -> list[str]:
    """The deterministic replacement board for a refreshed market.

    Stream key is exactly spec §6's ``seed + act + stage + node_type +
    refresh_index``, so the same seed always buys the same second board and a
    client can never re-roll for a better one.

    The replacement excludes the identities on the board it replaces, so paying
    7 credits always produces a genuinely different market rather than a shuffle
    that may return the same three cards.
    """
    plan, option = node_option(blueprint, node_id)
    key = _OFFER_KEY.get(option.node_type)
    if key is None:
        raise RunGenerationError(f"Node {node_id} has no refreshable market")
    if refresh_index < 1:
        raise RunGenerationError("refresh_index must be at least 1")

    base_ids = plan.payloads[node_id][key]
    exclude = starting_roster_slugs(pool, blueprint) | {
        pool.get(cid).player_slug for cid in base_ids
    }
    stream = (
        f"refresh:{plan.act}:{plan.stage}:{option.node_type}:{refresh_index}"
    )
    rng = _rng(blueprint.seed, stream)
    candidates = [c for c in pool.cards if c.player_slug not in exclude]

    if option.node_type == "trade_desk":
        if len(candidates) < OFFERS_PER_TRADE:
            raise RunGenerationError(f"Not enough cards to refresh trade node {node_id}")
        return [c.peak_window_id for c in rng.sample(candidates, OFFERS_PER_TRADE)]

    # A refreshed Draft Room keeps the affordability guarantee: a player who
    # just spent 7 of their last credits refreshing must not be handed a board
    # they cannot touch.
    affordable = [c for c in candidates if c.base_cost <= DRAFT_GUARANTEED_AFFORDABLE_COST]
    if not affordable or len(candidates) < OFFERS_PER_DRAFT:
        raise RunGenerationError(f"Not enough cards to refresh draft node {node_id}")
    anchor = rng.choice(affordable)
    rest = [c for c in candidates if c.player_slug != anchor.player_slug]
    rng.shuffle(rest)
    picks = [anchor]
    seen = {anchor.player_slug}
    for c in rest:
        if len(picks) >= OFFERS_PER_DRAFT:
            break
        if c.player_slug in seen:
            continue
        picks.append(c)
        seen.add(c.player_slug)
    rng.shuffle(picks)
    return [c.peak_window_id for c in picks]


def _apply_role_focus(
    pool: CardPool,
    blueprint: RunBlueprint,
    node_id: str,
    ids: list[str],
    role: str,
    refresh_index: int,
) -> list[str]:
    """Guarantee at least one offer on this board is legal for ``role``.

    If the board already carries one, Role Focus changes nothing — the player
    paid for a guarantee, not for a shuffle. Otherwise the LAST offer is
    replaced by a deterministically drawn card that can play the role. The last
    slot is chosen rather than the first because slot 0 of a Draft Room carries
    the affordability guarantee.
    """
    if any(role in pool.get(cid).eligible_roles for cid in ids):
        return ids
    exclude = starting_roster_slugs(pool, blueprint) | {
        pool.get(cid).player_slug for cid in ids
    }
    candidates = [
        c for c in pool.cards
        if role in c.eligible_roles and c.player_slug not in exclude
    ]
    if not candidates:
        # Unreachable with the real pool (the scarcest role, `anchor`, has 28
        # eligible cards) but the engine must not fabricate an offer.
        raise RunGenerationError(
            f"No card outside the roster can play '{role}' for node {node_id}"
        )
    rng = _rng(blueprint.seed, f"role-focus:{node_id}:{role}:{refresh_index}")
    out = list(ids)
    out[-1] = rng.choice(candidates).peak_window_id
    return out


def _substitute_owned(
    pool: CardPool,
    blueprint: RunBlueprint,
    node_id: str,
    ids: list[str],
    exclude_slugs: frozenset[str],
    refresh_index: int,
) -> list[str]:
    """Replace any offer the run already owns with a deterministic stand-in.

    THE BLUEPRINT CANNOT DO THIS. A board is fixed from the seed, so the only
    identities it can exclude up front are the ones already known then -- the
    STARTING roster. Under v3 that was the whole exclusion set, so a card bought
    in act 1 stayed on every later board it appeared on: measured over 500
    seeds, the same identity appeared on two or more boards in 499 of them, and
    the concrete case is seed 1, where `larry-nance-3yr-199192` sits on the act-1
    draft board and the act-3 trade board.

    Applied at READ time, from the run's live owned set, so a board can never
    offer a card the roster already holds no matter when it was acquired. The
    substitute is drawn from a keyed stream, so the same run always sees the
    same replacement and a client cannot re-roll for a better one.

    ``exclude_slugs`` also carries every identity on a boss this run has locked
    and not yet beaten -- see `state.unavailable_slugs` for why acquiring one
    has to be impossible rather than merely discouraged.
    """
    offending = [cid for cid in ids if pool.get(cid).player_slug in exclude_slugs]
    if not offending:
        return ids

    rng = _rng(blueprint.seed, f"substitute:{node_id}:{refresh_index}")
    out = list(ids)
    on_board = {pool.get(cid).player_slug for cid in ids}
    for cid in offending:
        blocked = exclude_slugs | frozenset(on_board)
        candidates = [c for c in pool.cards if c.player_slug not in blocked]
        if not candidates:
            raise RunGenerationError(
                f"No card remains to replace an owned offer at node {node_id}"
            )
        replacement = rng.choice(candidates)
        out[out.index(cid)] = replacement.peak_window_id
        on_board.discard(pool.get(cid).player_slug)
        on_board.add(replacement.player_slug)
    return out


def market_offers(
    pool: CardPool,
    blueprint: RunBlueprint,
    node_id: str,
    *,
    refresh_index: int = 0,
    role_focus: Optional[str] = None,
    reserved_card_id: Optional[str] = None,
    exclude_slugs: frozenset[str] = frozenset(),
) -> list[str]:
    """The card ids actually on this node's board, after every live modifier.

    Composition order is fixed and published: refresh first (it replaces the
    whole board), then role focus (it repairs whatever board survived), then the
    owned-identity substitution (nothing the run holds may be offered), then the
    reservation (it is an addition the player already paid for and can never be
    refreshed away).

    The substitution runs AFTER role focus on purpose: role focus may itself
    introduce a card the run owns, and a guarantee that hands back a duplicate
    is not a guarantee.
    """
    plan, option = node_option(blueprint, node_id)
    key = _OFFER_KEY.get(option.node_type)
    if key is None:
        raise RunGenerationError(f"Node {node_id} has no market")

    if refresh_index:
        ids = refreshed_offers(pool, blueprint, node_id, refresh_index)
    else:
        ids = list(plan.payloads[node_id][key])

    if role_focus:
        ids = _apply_role_focus(
            pool, blueprint, node_id, ids, role_focus, refresh_index
        )

    if exclude_slugs:
        ids = _substitute_owned(
            pool, blueprint, node_id, ids, exclude_slugs, refresh_index
        )

    if reserved_card_id and option.node_type == "draft_room":
        if reserved_card_id not in ids:
            ids = ids + [reserved_card_id]

    return ids


# ---------------------------------------------------------------------------
# Opening reveal (spec §3)
# ---------------------------------------------------------------------------
REVEAL_SLOT_LABELS: dict[str, str] = {
    "lead_creator": "Lead Creator",
    "guard_wing": "Guard/Wing",
    "wing_forward": "Wing/Forward",
    "forward_big": "Forward/Big",
    "anchor": "Anchor",
    "bench_1": "Bench 1",
    "bench_2": "Bench 2",
}


def opening_reveal(pool: CardPool, blueprint: RunBlueprint) -> list[dict]:
    """The authoritative, ordered opening-roster reveal.

    Seven slots in the published order: Lead Creator, Guard/Wing, Wing/Forward,
    Forward/Big, Anchor, Bench 1, Bench 2. The server preselects every card; the
    client only animates to what is already decided, which is what makes "same
    seed = same roster" survive a reel, a skip, and a mid-reveal refresh.
    """
    out: list[dict] = []
    for idx, (role, card_id) in enumerate(zip(ROLES, blueprint.starting_starters)):
        card = pool.get(card_id)
        out.append(
            {
                "order": idx,
                "slot_id": role,
                "label": REVEAL_SLOT_LABELS[role],
                "role": role,
                "is_starter": True,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "window": f"{card.start_season}–{card.end_season}",
                "prime_score": card.prime_score,
                "base_cost": card.base_cost,
            }
        )
    for idx, card_id in enumerate(blueprint.starting_bench):
        slot_id = f"bench_{idx + 1}"
        card = pool.get(card_id)
        out.append(
            {
                "order": len(ROLES) + idx,
                "slot_id": slot_id,
                "label": REVEAL_SLOT_LABELS[slot_id],
                "role": None,
                "is_starter": False,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "window": f"{card.start_season}–{card.end_season}",
                "prime_score": card.prime_score,
                "base_cost": card.base_cost,
            }
        )
    return out


def offer_prices(
    pool: CardPool, card_ids: list[str], systems: list[str]
) -> list[dict]:
    """Priced, display-ready offer payloads."""
    out = []
    for cid in card_ids:
        card = pool.get(cid)
        cost, modifiers = price_for(card, systems)
        out.append({"card_id": cid, "cost": cost, "modifiers": modifiers})
    return out
