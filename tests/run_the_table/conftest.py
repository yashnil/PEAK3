"""Shared fixtures for the RUN THE TABLE engine tests.

The deterministic play policies live here (rather than being imported from a
scratch file) so the suite is completely self-contained: `pytest tests/` on a
fresh clone must exercise every one of them.
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.run_the_table import state as S  # noqa: E402
from nba_peak.run_the_table.cards import CardPool, get_pool  # noqa: E402
from nba_peak.run_the_table.config import (  # noqa: E402
    LANE_FIELDS,
    ROLES,
)
from nba_peak.run_the_table.generation import generate_blueprint, stage_for  # noqa: E402
from nba_peak.run_the_table.pricing import price_for, trade_net_cost  # noqa: E402
from nba_peak.run_the_table.schemas import PoolStats, RunCard  # noqa: E402


# ---------------------------------------------------------------------------
# Deterministic play policies
# ---------------------------------------------------------------------------
def play(seed, rng, pool=None, policy="greedy", bp=None):
    """Drive a whole run to a terminal status under a fixed, deterministic policy.

    Supported policies:
      * ``greedy``  — always take the Draft Room, buy the biggest legal upgrade
      * ``random``  — pick uniformly from the legal options using ``rng``
      * ``first``   — always take the first offered node / first offered System
      * ``pass``    — take every node but never buy or trade anything

    Returns ``(blueprint, final_state)``.
    """
    pool = pool or get_pool()
    bp = bp or generate_blueprint(seed)
    st = S.create_run(bp, f"run-{seed}")
    guard = 0
    while st.status not in ("complete", "failed"):
        guard += 1
        if guard > 80:
            raise RuntimeError(f"stuck at {st.status} act{st.act} stage{st.stage}")
        if st.status == "system_select":
            offer = S.available_system_offer(st)
            S.action_select_system(
                st, bp, offer[0] if policy == "first" else rng.choice(list(offer))
            )
        elif st.status == "node_select":
            plan = stage_for(bp, st.act, st.stage)
            opts = list(plan.options)
            if policy == "greedy":
                opts.sort(key=lambda o: 0 if o.node_type == "draft_room" else 1)
                choice = opts[0]
            elif policy == "first":
                choice = opts[0]
            else:
                choice = rng.choice(opts)
            S.action_choose_node(st, bp, choice.node_id)
        elif st.status == "node_active":
            plan, opt = S.node_option(bp, st.active_node_id)
            t = opt.node_type
            if t == "draft_room":
                best = None
                for cid in plan.payloads[opt.node_id]["offer_ids"]:
                    card = pool.get(cid)
                    cost, _ = price_for(card, st.systems)
                    free = S.veteran_minimum_available(
                        card, st.systems, st.veteran_minimum_used_in_act[st.act]
                    )
                    charge = 0 if free else cost
                    if charge > st.credits:
                        continue
                    for slot in S.legal_slots_for(st, pool, cid):
                        if slot not in ROLES:
                            continue
                        cur = pool.get(S._slot(st, slot).card_id).prime_score
                        gain = card.prime_score - cur
                        if gain > 0 and (best is None or gain > best[0]):
                            best = (gain, cid, slot, free)
                if best and policy != "pass":
                    S.action_draft_buy(st, bp, best[1], best[2], pool, best[3])
                else:
                    S.action_draft_pass(st, bp)
            elif t == "trade_desk":
                done = False
                if policy == "greedy":
                    for cid in plan.payloads[opt.node_id]["incoming_ids"]:
                        card = pool.get(cid)
                        for slot in S.legal_slots_for(st, pool, cid):
                            if slot not in ROLES:
                                continue
                            out = pool.get(S._slot(st, slot).card_id)
                            b = trade_net_cost(out, card, st.systems)
                            if b["net_cost"] <= st.credits and card.prime_score > out.prime_score:
                                S.action_trade(st, bp, slot, cid, pool)
                                done = True
                                break
                        if done:
                            break
                if not done:
                    S.action_decline_trade(st, bp)
            elif t == "film_room":
                S.action_film_room(
                    st,
                    bp,
                    "take_credits" if policy == "greedy" else rng.choice(list(S.FILM_CHOICES)),
                )
            else:
                S.action_rest_bank(
                    st, bp, "recover_life" if st.lives < 3 else "take_credits"
                )
        elif st.status == "boss_ready":
            S.action_resolve_boss(st, bp, pool)
        elif st.status == "boss_resolved":
            S.action_advance(st, bp)
    return bp, st


@pytest.fixture(scope="session")
def play_policy():
    """The deterministic play-policy driver (see :func:`play`)."""
    return play


@pytest.fixture(scope="session")
def pool() -> CardPool:
    """The real, committed 3-year card pool. Process-cached, so this is cheap."""
    return get_pool()


@pytest.fixture(scope="session")
def blueprints(pool):
    """Memoised blueprint factory so 300-seed sweeps stay fast."""
    cache: dict[int, object] = {}

    def _get(seed: int):
        if seed not in cache:
            cache[seed] = generate_blueprint(seed, pool=pool)
        return cache[seed]

    return _get


@pytest.fixture
def rng():
    return random.Random(20260731)


# ---------------------------------------------------------------------------
# Synthetic card pools — used where a hand-computed expected value is needed
# ---------------------------------------------------------------------------
def make_card(
    card_id: str,
    lane_index: dict[str, float] | float,
    *,
    slug: str | None = None,
    roles: tuple[str, ...] = ROLES,
    prime_score: float = 60.0,
    overall_percentile: float = 0.5,
    base_cost: int = 10,
    lane_percentiles: dict[str, float] | float | None = None,
) -> RunCard:
    """Build a fully-specified :class:`RunCard` with exact lane values.

    ``lane_index`` / ``lane_percentiles`` accept a scalar to set every lane to
    the same value, or a dict keyed by lane name.
    """
    if isinstance(lane_index, (int, float)):
        idx = {lane: float(lane_index) for lane in LANE_FIELDS}
    else:
        idx = {lane: float(lane_index[lane]) for lane in LANE_FIELDS}
    if lane_percentiles is None:
        pcts = {lane: 50.0 for lane in LANE_FIELDS}
    elif isinstance(lane_percentiles, (int, float)):
        pcts = {lane: float(lane_percentiles) for lane in LANE_FIELDS}
    else:
        pcts = {lane: float(lane_percentiles[lane]) for lane in LANE_FIELDS}
    slug = slug or card_id
    return RunCard(
        peak_window_id=card_id,
        player_id=card_id,
        player_slug=slug,
        player_name=slug.replace("-", " ").title(),
        duration_years=3,
        start_season="1990-91",
        end_season="1992-93",
        anchor_season="1991-92",
        prime_score=prime_score,
        prime_index=prime_score,
        overall_percentile=overall_percentile,
        eligible_roles=tuple(roles),
        primary_role=roles[0] if roles else None,
        lane_values=dict(idx),
        lane_index=idx,
        lane_percentiles=pcts,
        base_cost=base_cost,
        data_completeness="complete",
    )


def make_pool(cards) -> CardPool:
    """Wrap hand-built cards in a real :class:`CardPool` with honest stats."""
    lane_min = {
        lane: min(c.lane_index[lane] for c in cards) for lane in LANE_FIELDS
    }
    lane_max = {
        lane: max(c.lane_index[lane] for c in cards) for lane in LANE_FIELDS
    }
    stats = PoolStats(
        duration_years=3,
        card_count=len(cards),
        excluded_count=0,
        lane_min=lane_min,
        lane_max=lane_max,
        prime_score_min=min(c.prime_score for c in cards),
        prime_score_max=max(c.prime_score for c in cards),
    )
    return CardPool(list(cards), stats)


@pytest.fixture
def card_factory():
    return make_card


@pytest.fixture
def pool_factory():
    return make_pool
