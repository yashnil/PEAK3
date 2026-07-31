"""Public (client-visible) projection of a RUN THE TABLE run.

This module is the single source of truth for what the browser is allowed to
see. Two rules it enforces:

1. **No future content.** Offers for a stage the player has not reached are
   never included unless a Film Room scout unlocked that stage.
2. **No hidden numbers.** Everything the UI displays — price, lane value,
   discount, boss rule — is present here with the same value the engine used,
   so a player can always reconcile what they were shown against what happened.

Note on ADR-005 Decision 6 (scores withheld until reveal): that rule exists for
Peak Draft, where the game *is* guessing which card is better. RUN THE TABLE is
a front-office game — the requirement is explicitly that a Draft Room shows
"cost, role eligibility, overall PEAK3 score, and compact component
fingerprint". Withholding the score here would make the core decision unplayable.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.run_the_table.battle import (
    bench_weight_for,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_WEIGHT_DEFAULT,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_PEAK3_WEIGHTS,
    LANE_TOKENS,
    MAX_LIVES,
    ROLES,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STATUS_BOSS_READY,
    STATUS_BOSS_RESOLVED,
    STATUS_NODE_ACTIVE,
    STATUS_NODE_SELECT,
    STATUS_SYSTEM_SELECT,
    SYSTEMS,
    BOSS_RULES,
    TERMINAL_STATUSES,
    system_by_id,
)
from nba_peak.run_the_table.generation import node_option, stage_for
from nba_peak.run_the_table.pricing import (
    price_for,
    refund_for,
    veteran_minimum_available,
)
from nba_peak.run_the_table.receipt import build_receipt
from nba_peak.run_the_table.schemas import Opponent, RunBlueprint, RunState
from nba_peak.run_the_table.state import available_system_offer, legal_slots_for


def card_public(pool: CardPool, card_id: str, systems: list[str] | None = None) -> dict:
    """One card, fully priced and explained."""
    c = pool.get(card_id)
    systems = systems or []
    cost, modifiers = price_for(c, systems)
    return {
        "card_id": c.peak_window_id,
        "player_name": c.player_name,
        "player_slug": c.player_slug,
        "start_season": c.start_season,
        "end_season": c.end_season,
        "anchor_season": c.anchor_season,
        "window_label": f"{c.start_season} – {c.end_season}",
        "prime_score": c.prime_score,
        "overall_percentile": round(c.overall_percentile * 100, 1),
        "eligible_roles": list(c.eligible_roles),
        "primary_role": c.primary_role,
        "lane_index": c.lane_index,
        "lane_percentiles": c.lane_percentiles,
        "base_cost": c.base_cost,
        "cost": cost,
        "cost_modifiers": modifiers,
        "refund_value": refund_for(c, systems),
    }


def _slot_public(pool: CardPool, slot, systems: list[str]) -> dict:
    return {
        "slot_id": slot.slot_id,
        "role": slot.role,
        "is_starter": slot.is_starter,
        "card": card_public(pool, slot.card_id, systems) if slot.card_id else None,
    }


def _system_public(system_id: str) -> dict:
    s = system_by_id(system_id)
    return {"id": s["id"], "name": s["name"], "summary": s["summary"], "affects": s["affects"]}


def boss_public(
    pool: CardPool, boss: Opponent, revealed: bool, systems: list[str]
) -> dict:
    """Boss card.

    ``revealed`` is True once the player reaches that boss, or earlier if a
    Film Room scout unlocked it. Unrevealed bosses expose only act, name and
    rule — enough to plan against, never the exact roster.
    """
    rule = BOSS_RULES.get(boss.rule_id) if boss.rule_id else None
    out = {
        "boss_id": boss.boss_id,
        "name": boss.name,
        "tagline": boss.tagline,
        "act": boss.act,
        "rule": rule,
        "source": boss.source,
        "revealed": revealed,
    }
    if revealed:
        _, o_bw = bench_weight_for(systems, boss.rule_id)
        profile = roster_lane_profile(pool, boss.starter_ids, boss.bench_ids, o_bw)
        out["starters"] = [card_public(pool, cid, []) for cid in boss.starter_ids]
        out["bench"] = [card_public(pool, cid, []) for cid in boss.bench_ids]
        out["lane_profile"] = [
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "token": LANE_TOKENS[lane],
                "value": profile[lane],
            }
            for lane in LANE_FIELDS
        ]
        out["roster_total"] = roster_total(profile)
    return out


def _battle_public(pool: CardPool, b) -> dict:
    return {
        "boss_id": b.boss_id,
        "act": b.act,
        "outcome": b.outcome,
        "decided_by": b.decided_by,
        "player_lanes_won": b.player_lanes_won,
        "opponent_lanes_won": b.opponent_lanes_won,
        "ties": b.ties,
        "summed_margin": b.summed_margin,
        "player_roster_total": b.player_roster_total,
        "opponent_roster_total": b.opponent_roster_total,
        "bench_weight": b.bench_weight,
        "rule_id": b.rule_id,
        "credits_awarded": b.credits_awarded,
        "lives_after": b.lives_after,
        "lanes": [
            {
                "lane": l.lane,
                "label": l.label,
                "token": LANE_TOKENS[l.lane],
                "player_score": l.player_score,
                "opponent_score": l.opponent_score,
                "winner": l.winner,
                "margin": l.margin,
                "tie_broken_by_rule": l.tie_broken_by_rule,
                "player_top_card": (
                    card_public(pool, l.player_top_card_id, [])
                    if l.player_top_card_id else None
                ),
                "opponent_top_card": (
                    card_public(pool, l.opponent_top_card_id, [])
                    if l.opponent_top_card_id else None
                ),
            }
            for l in b.lanes
        ],
    }


def _active_node_public(
    state: RunState, blueprint: RunBlueprint, pool: CardPool
) -> Optional[dict]:
    if state.status != STATUS_NODE_ACTIVE or not state.active_node_id:
        return None
    plan, option = node_option(blueprint, state.active_node_id)
    payload = plan.payloads[option.node_id]
    out: dict = {
        "node_id": option.node_id,
        "node_type": option.node_type,
        "title": option.title,
        "summary": option.summary,
    }

    if option.node_type == "draft_room":
        offers = []
        for cid in payload["offer_ids"]:
            card = pool.get(cid)
            pub = card_public(pool, cid, state.systems)
            free = veteran_minimum_available(
                card, state.systems, state.veteran_minimum_used_in_act[state.act]
            )
            legal = [s for s in legal_slots_for(state, pool, cid)]
            pub["veteran_minimum_eligible"] = free
            pub["effective_cost"] = 0 if free else pub["cost"]
            pub["legal_slots"] = legal
            pub["affordable"] = pub["effective_cost"] <= state.credits
            pub["selectable"] = pub["affordable"] and bool(legal)
            pub["blocked_reason"] = (
                None if pub["selectable"]
                else ("Not enough credits" if not pub["affordable"] else "No legal slot")
            )
            offers.append(pub)
        out["offers"] = offers
        out["can_pass"] = True

    elif option.node_type == "trade_desk":
        incoming = []
        for cid in payload["incoming_ids"]:
            pub = card_public(pool, cid, state.systems)
            pub["legal_slots"] = legal_slots_for(state, pool, cid)
            incoming.append(pub)
        out["incoming"] = incoming
        out["outgoing_options"] = [
            {
                "slot_id": s.slot_id,
                "role": s.role,
                "is_starter": s.is_starter,
                "card": card_public(pool, s.card_id, state.systems),
                "refund": refund_for(pool.get(s.card_id), state.systems),
            }
            for s in state.starters + state.bench
            if s.card_id
        ]
        out["can_decline"] = True

    elif option.node_type == "film_room":
        out["choices"] = [
            {
                "id": "scout_offers",
                "label": "Scout ahead",
                "description": "Reveal the offers waiting in the rest of this act and the next.",
            },
            {
                "id": "take_credits",
                "label": f"Bank {payload['credits']} credits",
                "description": "Take the credits instead of the intel.",
            },
        ]
    else:  # rest_bank
        out["choices"] = [
            {
                "id": "recover_life",
                "label": "Recover a life",
                "description": f"Back up to {MAX_LIVES} lives, if you have lost any.",
                "disabled": state.lives >= MAX_LIVES,
            },
            {
                "id": "take_credits",
                "label": f"Bank {payload['credits']} credits",
                "description": "Take the credits instead.",
            },
        ]
    return out


def _stage_options_public(state: RunState, blueprint: RunBlueprint) -> Optional[list[dict]]:
    if state.status != STATUS_NODE_SELECT:
        return None
    plan = stage_for(blueprint, state.act, state.stage)
    return [
        {
            "node_id": o.node_id,
            "node_type": o.node_type,
            "title": o.title,
            "summary": o.summary,
        }
        for o in plan.options
    ]


def _map_public(state: RunState, blueprint: RunBlueprint) -> list[dict]:
    """The run ladder. Never leaks unresolved future node content, only shape."""
    out = []
    for act in range(1, ACTS + 1):
        stages = []
        for stage in range(1, STAGES_PER_ACT + 1):
            plan = stage_for(blueprint, act, stage)
            resolved = [o.node_id for o in plan.options if o.node_id in state.resolved_node_ids]
            is_current = (
                state.act == act
                and state.stage == stage
                and state.status in (STATUS_NODE_SELECT, STATUS_NODE_ACTIVE)
            )
            done = bool(resolved)
            stages.append(
                {
                    "act": act,
                    "stage": stage,
                    "state": "done" if done else ("current" if is_current else "locked"),
                    "chosen_node_id": resolved[0] if resolved else None,
                    "chosen_node_type": next(
                        (o.node_type for o in plan.options if o.node_id in resolved), None
                    ),
                    "option_types": [o.node_type for o in plan.options],
                    "scouted": f"a{act}s{stage}" in state.scouted_stage_keys,
                }
            )
        battle = next((b for b in state.battles if b.act == act), None)
        stages_done = all(s["state"] == "done" for s in stages)
        out.append(
            {
                "act": act,
                "stages": stages,
                "boss": {
                    "boss_id": blueprint.bosses[act - 1].boss_id,
                    "name": blueprint.bosses[act - 1].name,
                    "state": (
                        "won" if battle and battle.outcome == "win"
                        else "lost" if battle and battle.outcome == "loss"
                        else "drawn" if battle and battle.outcome == "draw"
                        else "current" if stages_done and state.act == act
                        else "locked"
                    ),
                },
            }
        )
    return out


def public_state(state: RunState, blueprint: RunBlueprint, pool: CardPool) -> dict:
    """Complete client payload for a run."""
    p_bw, _ = bench_weight_for(state.systems, None)
    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    profile = roster_lane_profile(pool, starters, bench, p_bw)

    next_boss = None
    if state.act <= ACTS:
        boss = blueprint.bosses[state.act - 1]
        revealed = (
            state.status in (STATUS_BOSS_READY, STATUS_BOSS_RESOLVED)
            or f"a{state.act}s{STAGES_PER_ACT}" in state.scouted_stage_keys
            or any(b.act == state.act for b in state.battles)
        )
        next_boss = boss_public(pool, boss, revealed, state.systems)

    receipt = (
        build_receipt(state, blueprint, pool)
        if state.status in TERMINAL_STATUSES else None
    )

    return {
        "run_id": state.run_id,
        "seed": state.seed,
        "run_type": state.run_type,
        "date": state.date,
        "status": state.status,
        "act": state.act,
        "stage": state.stage,
        "acts_total": ACTS,
        "stages_per_act": STAGES_PER_ACT,
        "credits": state.credits,
        "lives": state.lives,
        "max_lives": MAX_LIVES,
        "starting_credits": STARTING_CREDITS,
        "starters": [_slot_public(pool, s, state.systems) for s in state.starters],
        "bench": [_slot_public(pool, s, state.systems) for s in state.bench],
        "systems": [_system_public(s) for s in state.systems],
        "pending_system_offer": (
            [_system_public(s) for s in available_system_offer(state)]
            if state.status == STATUS_SYSTEM_SELECT else None
        ),
        "stage_options": _stage_options_public(state, blueprint),
        "active_node": _active_node_public(state, blueprint, pool),
        "next_boss": next_boss,
        "map": _map_public(state, blueprint),
        "battles": [_battle_public(pool, b) for b in state.battles],
        "lane_profile": [
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "token": LANE_TOKENS[lane],
                "value": profile[lane],
                "peak3_weight": LANE_PEAK3_WEIGHTS[lane],
            }
            for lane in LANE_FIELDS
        ],
        "roster_total": roster_total(profile),
        "bench_weight": p_bw,
        "veteran_minimum_used_this_act": state.veteran_minimum_used_in_act.get(state.act, False),
        "action_count": len(state.action_log),
        "receipt": receipt,
        "versions": state.versions,
        "created_at": state.created_at,
        "last_action_at": state.last_action_at,
    }


def ruleset_meta(pool: CardPool) -> dict:
    """Static, cacheable description of the whole ruleset for the rules screen."""
    from nba_peak.run_the_table.config import (
        BENCH_SLOTS,
        BENCH_WEIGHT_DEFAULT as BWD,
        COMEBACK_CREDITS,
        LANES_TO_WIN,
        PRICE_BASE,
        PRICE_EXPONENT,
        PRICE_SPAN,
        STARTER_SLOTS,
        STARTER_WEIGHT,
        STARTING_LIVES,
        TRADE_REFUND_PCT,
        version_tuple,
    )

    return {
        "versions": version_tuple(),
        "lanes": [
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "token": LANE_TOKENS[lane],
                "peak3_weight": LANE_PEAK3_WEIGHTS[lane],
                "pool_min": pool.stats.lane_min[lane],
                "pool_max": pool.stats.lane_max[lane],
            }
            for lane in LANE_FIELDS
        ],
        "systems": [_system_public(s["id"]) for s in SYSTEMS],
        "boss_rules": list(BOSS_RULES.values()),
        "roster": {
            "starters": STARTER_SLOTS,
            "bench": BENCH_SLOTS,
            "roles": list(ROLES),
        },
        "economy": {
            "starting_credits": STARTING_CREDITS,
            "starting_lives": STARTING_LIVES,
            "max_lives": MAX_LIVES,
            "comeback_credits": COMEBACK_CREDITS,
            "trade_refund_pct": TRADE_REFUND_PCT,
            "price_formula": (
                f"base_cost = {PRICE_BASE} + round({PRICE_SPAN} × percentile^{PRICE_EXPONENT:g})"
            ),
        },
        "battle": {
            "starter_weight": STARTER_WEIGHT,
            "bench_weight": BWD,
            "lanes_to_win": LANES_TO_WIN,
            "tie_break_order": ["summed lane margin", "overall weighted roster total", "exact draw"],
        },
        "card_pool": {
            "duration_years": pool.stats.duration_years,
            "card_count": pool.stats.card_count,
            "excluded_count": pool.stats.excluded_count,
            "prime_score_min": pool.stats.prime_score_min,
            "prime_score_max": pool.stats.prime_score_max,
        },
    }
