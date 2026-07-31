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

from nba_peak.run_the_table.bosses import resolve_bosses
from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    FILM_CREDITS,
    MAX_GENERATION_ATTEMPTS,
    NODE_CHOICES_PER_STAGE,
    OFFERS_PER_DRAFT,
    OFFERS_PER_TRADE,
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
def _draft_offers(
    pool: CardPool,
    seed: int,
    node_id: str,
    exclude_slugs: frozenset[str],
    guaranteed_affordable_cost: int,
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
    return [c.peak_window_id for c in picks]


def _trade_offers(
    pool: CardPool, seed: int, node_id: str, exclude_slugs: frozenset[str]
) -> list[str]:
    rng = _rng(seed, f"trade:{node_id}")
    candidates = [c for c in pool.cards if c.player_slug not in exclude_slugs]
    if len(candidates) < OFFERS_PER_TRADE:
        raise RunGenerationError(f"Not enough cards to fill trade node {node_id}")
    picks = rng.sample(candidates, OFFERS_PER_TRADE)
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
        "Film Room",
        "Scout the next boss's lane profile and rule, then take one prep advantage.",
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
    bosses = resolve_bosses(pool)
    boss_slugs = frozenset(
        pool.get(cid).player_slug
        for b in bosses
        for cid in list(b.starter_ids) + list(b.bench_ids)
    )

    # Cards already on the starting roster are excluded from every offer so a
    # run can never be shown a card it already owns. Boss cards stay available:
    # beating The Ceiling with a card off its own bench is a good story, and
    # excluding 21 more cards would thin the anchor pool dangerously.
    exclude = start_slugs

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
                        )
                    }
                elif node_type == "trade_desk":
                    payloads[node_id] = {
                        "incoming_ids": _trade_offers(pool, seed, node_id, exclude)
                    }
                elif node_type == "film_room":
                    payloads[node_id] = {"credits": FILM_CREDITS}
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
        "boss_sources": [b.source for b in bosses],
        "generation_algorithm": "rtt_gen_v1",
    }

    return RunBlueprint(
        seed=seed,
        run_type=run_type,
        date=date,
        starting_starters=starters,
        starting_bench=bench,
        system_offers=system_offers,
        stages=tuple(stages),
        bosses=bosses,
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
