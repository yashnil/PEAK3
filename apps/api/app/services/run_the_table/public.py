"""Public (client-visible) projection of a RUN THE TABLE run.

This module is the single source of truth for what the browser is allowed to
see. Two rules it enforces:

1. **No future content.** Offers for a stage the player has not reached are
   never included unless a Scout & Prepare unlocked that stage, and an
   unrevealed roster slot or boss lineup is never included at all — the reveal
   blocks below carry exactly what the player has already turned over, plus the
   single card the next reveal will land on.
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
    player_lane_profile,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_WEIGHT_DEFAULT,
    CREDIT_SINKS,
    EMERGENCY_RECOVERY_COST,
    EMERGENCY_RECOVERY_MAX_PER_RUN,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_PEAK3_WEIGHTS,
    LANE_TOKENS,
    MARKET_REFRESH_COST,
    MARKET_REFRESHES_PER_NODE,
    MAX_LIVES,
    ROLES,
    ROSTER_SIZE,
    SCOUT_CHOICES,
    SCOUT_PREP_LANE_BONUS,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STATUS_BOSS_READY,
    STATUS_BOSS_RESOLVED,
    STATUS_NODE_ACTIVE,
    STATUS_NODE_SELECT,
    STATUS_SYSTEM_SELECT,
    SYSTEMS,
    BOSS_LANE_MARGIN,
    BOSS_LANES_TO_WIN,
    BOSS_RULES,
    LANES_TO_WIN,
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
from nba_peak.run_the_table.state import (
    MARKET_NODE_TYPES,
    active_reservation,
    active_role_focus,
    available_system_offer,
    credit_sink_total,
    legal_slots_for,
    node_offers,
    reveal_progress,
    scout_and_prepare_options,
)


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
        # The Final Boss is the one fight a win in which clears the table (plan
        # §2.2). Published here so the pre-boss briefing can say so without the
        # client having to compare `act` to a hardcoded number.
        "is_final": boss.act >= ACTS,
        "lane_margin": BOSS_LANE_MARGIN.get(boss.rule_id, 0.0) if boss.rule_id else 0.0,
        # A boss rule may raise the lanes an outright win takes, for BOTH sides
        # (config.BOSS_LANES_TO_WIN). The battle screen states the win condition
        # before the reveal, so it has to be this boss's number, not the default.
        "lanes_to_win": (
            BOSS_LANES_TO_WIN.get(boss.rule_id, LANES_TO_WIN) if boss.rule_id
            else LANES_TO_WIN
        ),
        "source": boss.source,
        # The slate is fixed by the ruleset and the seed — no clock, no model
        # inference, no opponent assembled live. Said outright so the reveal
        # animation cannot imply otherwise.
        "deterministic": True,
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
        # v3: what an outright win took here, and the Scout & Prepare bonus the
        # player brought in. Both are already folded into the result; they are
        # published so the result screen can say which lane the preparation
        # actually moved rather than leaving it invisible.
        "lanes_to_win": b.lanes_to_win,
        "lane_bonuses": dict(b.lane_bonuses),
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
                "player_prep_bonus": l.player_prep_bonus,
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


def credit_sink_catalogue() -> list[dict]:
    """The four published sinks, price list only (spec §4).

    Read straight off ``config.CREDIT_SINKS`` so no price is ever restated — in
    Python here or in TypeScript downstream. ``offered_at`` is a tuple in the
    config and a list on the wire.
    """
    return [
        {**sink, "offered_at": list(sink["offered_at"])}
        for sink in CREDIT_SINKS.values()
    ]


def _sink_public(
    sink_id: str,
    state: RunState,
    *,
    available: bool,
    unavailable_reason: Optional[str],
    used: int,
    limit_total: Optional[int],
) -> dict:
    """One credit sink as the node is offering it right now.

    ``available`` and ``affordable`` are deliberately separate: a locked sink is
    shown WITH its reason rather than hidden, which is how a player learns the
    sink exists at all. ``selectable`` is the single boolean a button binds to,
    so the client never has to re-derive the conjunction.
    """
    sink = CREDIT_SINKS[sink_id]
    cost = int(sink["cost"])
    affordable = state.credits >= cost
    reason = unavailable_reason
    if available and not affordable:
        reason = "insufficient_credits"
    return {
        "id": sink["id"],
        "name": sink["name"],
        "cost": cost,
        "summary": sink["summary"],
        "limit": sink["limit"],
        "offered_at": list(sink["offered_at"]),
        "available": available,
        "affordable": affordable,
        "selectable": available and affordable,
        "unavailable_reason": reason,
        "used": used,
        "limit_total": limit_total,
        "remaining": None if limit_total is None else max(0, limit_total - used),
    }


def _node_credit_sinks(
    state: RunState, node_type: str, node_id: str
) -> list[dict]:
    """Every sink this node offers, priced and gated (spec §4).

    Membership comes from each sink's own ``offered_at``, so a sink cannot
    appear on a node the engine would refuse it at.
    """
    out: list[dict] = []
    if node_type in MARKET_NODE_TYPES:
        used = state.node_refreshes.get(node_id, 0)
        out.append(
            _sink_public(
                "market_refresh",
                state,
                available=used < MARKET_REFRESHES_PER_NODE,
                unavailable_reason=(
                    None if used < MARKET_REFRESHES_PER_NODE else "refresh_limit"
                ),
                used=used,
                limit_total=MARKET_REFRESHES_PER_NODE,
            )
        )
    if node_type == "film_room":
        focus_held = state.role_focus is not None
        out.append(
            _sink_public(
                "role_focus",
                state,
                available=not focus_held,
                unavailable_reason="role_focus_active" if focus_held else None,
                used=1 if focus_held else 0,
                limit_total=None,
            )
        )
        reservation_live = state.reserved_card is not None and state.reserved_card[
            "status"
        ] in ("live", "offered")
        out.append(
            _sink_public(
                "reserve_card",
                state,
                available=not reservation_live,
                unavailable_reason=(
                    "reservation_active" if reservation_live else None
                ),
                used=1 if reservation_live else 0,
                limit_total=None,
            )
        )
    if node_type == "rest_bank":
        used = state.emergency_recoveries_used
        spent = used >= EMERGENCY_RECOVERY_MAX_PER_RUN
        full = state.lives >= MAX_LIVES
        out.append(
            _sink_public(
                "emergency_recovery",
                state,
                available=not spent and not full,
                unavailable_reason=(
                    "recovery_limit" if spent else "lives_full" if full else None
                ),
                used=used,
                limit_total=EMERGENCY_RECOVERY_MAX_PER_RUN,
            )
        )
    return out


def armed_effects_public(state: RunState) -> dict:
    """What the player currently has armed, bought or spent (spec §4/§5).

    One block so the tray can show "a Role Focus is waiting on the next market"
    and "one card is reserved" without inferring either from a node payload it
    may not be looking at.
    """
    reserved = dict(state.reserved_card) if state.reserved_card else None
    if reserved is not None:
        # `locked_modifiers` is the pricing explanation, already published on
        # the reserved card itself; keep it, it is not hidden information.
        reserved["locked_modifiers"] = list(reserved.get("locked_modifiers", []))
    return {
        "prep": dict(state.pending_prep) if state.pending_prep else None,
        "prep_bonus": SCOUT_PREP_LANE_BONUS,
        "role_focus": dict(state.role_focus) if state.role_focus else None,
        "reserved_card": reserved,
        "scouted_boss_acts": list(state.scouted_boss_acts),
        "emergency_recoveries_used": state.emergency_recoveries_used,
        "emergency_recoveries_max": EMERGENCY_RECOVERY_MAX_PER_RUN,
        "sink_spend": [dict(row) for row in state.sink_spend],
        "sink_spend_total": credit_sink_total(state),
    }


def reveal_public(
    state: RunState, blueprint: RunBlueprint, pool: CardPool, boss_revealed: bool
) -> dict:
    """The opening-roster and boss reveals, trimmed to what has been turned over.

    Spec §3. THE SERVER PRESELECTS THE CARD: `next_slot` is the authoritative
    card the next reveal lands on, so the client animates to a decided value and
    never rolls its own. `revealed` is run state, not browser state, so a
    refresh mid-reveal resumes rather than restarting.

    Slots past `next_slot` are omitted entirely — the whole point of a reveal is
    that the next card is not known yet, and shipping all seven would make the
    animation theatre over information the client already had.
    """
    progress = reveal_progress(state, blueprint, pool)
    roster = progress["roster"]
    slots = roster["slots"]
    revealed = int(roster["revealed"])

    out: dict = {
        "roster": {
            "revealed": revealed,
            "total": int(roster["total"]),
            "complete": bool(roster["complete"]),
            # Shape only: the seven slot ids and labels in their fixed order.
            # Carries no card, so it is safe before a single reveal.
            "order": [
                {"order": s["order"], "slot_id": s["slot_id"], "label": s["label"]}
                for s in slots
            ],
            "revealed_slots": slots[:revealed],
            "next_slot": slots[revealed] if revealed < len(slots) else None,
            # Skip-all is offered only after the first card is on the table, so
            # the player has seen what a reveal IS before they can dismiss it.
            "can_skip": 0 < revealed < len(slots),
            "remaining": max(0, len(slots) - revealed),
        },
        "boss": None,
    }

    boss = progress["boss"]
    if boss and boss_revealed:
        b_slots = boss["slots"]
        b_revealed = int(boss["revealed"])
        out["boss"] = {
            "act": boss["act"],
            "boss_id": boss["boss_id"],
            "name": boss["name"],
            "tagline": boss["tagline"],
            "rule": BOSS_RULES.get(boss["rule_id"]) if boss["rule_id"] else None,
            # `curated` or `generated_fallback` — either way the slate is fixed
            # by the ruleset and the seed. Published so the UI can say so
            # outright rather than letting the reveal imply a live opponent.
            "source": boss["source"],
            "deterministic": True,
            "revealed": b_revealed,
            "total": int(boss["total"]),
            "complete": bool(boss["complete"]),
            "order": [
                {"order": s["order"], "slot_id": s["slot_id"]} for s in b_slots
            ],
            "revealed_slots": b_slots[:b_revealed],
            "next_slot": b_slots[b_revealed] if b_revealed < len(b_slots) else None,
            "can_skip": 0 < b_revealed < len(b_slots),
            "remaining": max(0, len(b_slots) - b_revealed),
        }
    return out


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
        "credit_sinks": _node_credit_sinks(state, option.node_type, option.node_id),
    }

    if option.node_type == "draft_room":
        offers = []
        # `node_offers` — NOT `payload["offer_ids"]`. It is the same accessor
        # `action_draft_buy` validates against, so a refreshed board, a Role
        # Focus repair and a reserved card all show up here exactly as the
        # engine will accept them. Reading the raw blueprint payload instead
        # would render the ORIGINAL board after a 7-credit refresh.
        reservation = active_reservation(state, option.node_id)
        for cid in node_offers(state, blueprint, option.node_id, pool):
            card = pool.get(cid)
            pub = card_public(pool, cid, state.systems)
            free = veteran_minimum_available(
                card, state.systems, state.veteran_minimum_used_in_act[state.act]
            )
            legal = [s for s in legal_slots_for(state, pool, cid)]
            # A reserved card is charged the price it was RESERVED at — that
            # lock is the whole of what the 5-credit reservation buys, so the
            # board has to print the locked number rather than today's.
            reserved_here = bool(reservation and reservation["card_id"] == cid)
            if reserved_here:
                pub["cost"] = reservation["locked_cost"]
                pub["cost_modifiers"] = list(reservation["locked_modifiers"])
            pub["reserved"] = reserved_here
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
        out["role_focus"] = active_role_focus(state, option.node_id)
        out["refreshes_used"] = state.node_refreshes.get(option.node_id, 0)

    elif option.node_type == "trade_desk":
        incoming = []
        for cid in node_offers(state, blueprint, option.node_id, pool):
            pub = card_public(pool, cid, state.systems)
            pub["legal_slots"] = legal_slots_for(state, pool, cid)
            incoming.append(pub)
        out["incoming"] = incoming
        out["role_focus"] = active_role_focus(state, option.node_id)
        out["refreshes_used"] = state.node_refreshes.get(option.node_id, 0)
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
        # Scout & Prepare (spec §5). `scout_and_prepare_options` is the engine's
        # own accessor: what it returns is exactly what `action_film_room` will
        # accept, so a choice the player can see is a choice the player can
        # take. The API restates no price and re-derives no legality rule.
        scout = scout_and_prepare_options(state, blueprint, pool)
        by_id = {c["id"]: c for c in scout["choices"]}
        out["scout"] = {
            "node_id": scout["node_id"],
            "choice_ids": list(SCOUT_CHOICES),
            "prep_bonus": SCOUT_PREP_LANE_BONUS,
            "lanes": [
                {"lane": lane, "label": LANE_LABELS[lane], "token": LANE_TOKENS[lane]}
                for lane in LANE_FIELDS
            ],
            "roles": list(ROLES),
            "choices": scout["choices"],
        }
        # The same three choices in the shared {id,label,description,disabled}
        # shape every written-choice node uses, so a client that only knows the
        # generic surface still renders three real options rather than nothing.
        out["choices"] = [
            {
                "id": "scout_boss",
                "label": "Scout the boss",
                "description": (
                    "Free. See the next boss's rule, its strongest and weakest "
                    "lanes and a projected matchup, then prepare one lane by "
                    f"{SCOUT_PREP_LANE_BONUS:g} points for that battle only."
                ),
                "cost": 0,
                "disabled": False,
            },
            {
                "id": "shape_market",
                "label": by_id["shape_market"]["name"],
                "description": by_id["shape_market"]["summary"],
                "cost": by_id["shape_market"]["cost"],
                "disabled": not by_id["shape_market"]["available"],
                "unavailable_reason": by_id["shape_market"]["unavailable_reason"],
            },
            {
                "id": "reserve_card",
                "label": by_id["reserve_card"]["name"],
                "description": by_id["reserve_card"]["summary"],
                "cost": by_id["reserve_card"]["cost"],
                "disabled": not by_id["reserve_card"]["available"],
                "unavailable_reason": by_id["reserve_card"]["unavailable_reason"],
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
    for act in range(1, min(ACTS, len(blueprint.bosses)) + 1):
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
                    "is_final": act >= ACTS,
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
    # Scored exactly the way a battle would score it right now (no boss rule
    # applied yet), so the roster panel and the battle agree. Under Deep
    # Rotation that is the better of two bench weights per lane.
    profile = player_lane_profile(pool, starters, bench, state.systems, None)

    next_boss = None
    boss_revealed = False
    if state.act <= ACTS and state.act <= len(blueprint.bosses):
        boss = blueprint.bosses[state.act - 1]
        boss_revealed = (
            state.status in (STATUS_BOSS_READY, STATUS_BOSS_RESOLVED)
            or f"a{state.act}s{STAGES_PER_ACT}" in state.scouted_stage_keys
            or state.act in state.scouted_boss_acts
            or any(b.act == state.act for b in state.battles)
        )
        next_boss = boss_public(pool, boss, boss_revealed, state.systems)

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
        # The act whose boss must be BEATEN to clear the table (plan §2.2).
        "final_boss_act": ACTS,
        # ADDED (never renamed anything): the battle screen has to say "first
        # to N lanes" BEFORE the reveal, and `LANES_TO_WIN` was reachable only
        # through `ruleset_meta()`, which the game screen does not fetch. The
        # alternative was hardcoding `3` in TypeScript, i.e. a client-side copy
        # of a rule the engine owns. `RunStateResponse` is `extra="allow"` and
        # `apps/api/tests/test_run_the_table.py:63` asserts STATE_KEYS as a
        # SUBSET precisely so an added field flows through.
        "lanes_to_win": LANES_TO_WIN,
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
        # -- v3 --------------------------------------------------------------
        # The reveal is presentation, but its PROGRESS is run state: a refresh
        # mid-reveal must resume, so it cannot live in the browser.
        "reveal": reveal_public(state, blueprint, pool, boss_revealed),
        # What is armed right now — a preparation, a Role Focus, a reservation —
        # so the tray can show it without reading a node payload.
        "armed": armed_effects_public(state),
        # The published price list, so no client ever restates a sink's cost.
        "credit_sinks": credit_sink_catalogue(),
        "roster_size": ROSTER_SIZE,
        "action_count": len(state.action_log),
        "receipt": receipt,
        "versions": state.versions,
        "created_at": state.created_at,
        "last_action_at": state.last_action_at,
    }


def ruleset_meta(pool: CardPool) -> dict:
    """Static, cacheable description of the whole ruleset for the rules screen."""
    from nba_peak.run_the_table.config import (
        BATTLES,
        BENCH_SLOTS,
        BENCH_WEIGHT_DEFAULT as BWD,
        BOSS_WIN_CREDITS,
        COMEBACK_CREDITS,
        DECISION_NODES,
        LANES_TO_WIN,
        NODE_CHOICES_PER_STAGE,
        PRICE_BASE,
        PRICE_EXPONENT,
        PRICE_SPAN,
        RESERVE_CHOICES_OFFERED,
        REST_CREDITS,
        STARTER_SLOTS,
        STARTER_WEIGHT,
        STARTING_LIVES,
        TRADE_REFUND_PCT,
        version_tuple,
    )
    from nba_peak.run_the_table.receipt import OUTCOMES

    return {
        "versions": version_tuple(),
        # The whole v3 run shape, published so the client never hardcodes it.
        "run_shape": {
            "acts": ACTS,
            "stages_per_act": STAGES_PER_ACT,
            "node_choices_per_stage": NODE_CHOICES_PER_STAGE,
            "decision_nodes": DECISION_NODES,
            "battles": BATTLES,
            "final_boss_act": ACTS,
            "roster_size": ROSTER_SIZE,
            "outcomes": list(OUTCOMES),
        },
        # Spec §4. The client shows prices; it never states one.
        "credit_sinks": credit_sink_catalogue(),
        # Spec §5. The three Scout & Prepare branches and the capped bonus.
        "scout_and_prepare": {
            "choices": list(SCOUT_CHOICES),
            "prep_bonus": SCOUT_PREP_LANE_BONUS,
            "reserve_choices_offered": RESERVE_CHOICES_OFFERED,
        },
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
        "boss_rules": [
            {
                **rule,
                "lane_margin": BOSS_LANE_MARGIN.get(rule["id"], 0.0),
                "lanes_to_win": BOSS_LANES_TO_WIN.get(rule["id"], LANES_TO_WIN),
            }
            for rule in BOSS_RULES.values()
        ],
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
            "boss_win_credits": BOSS_WIN_CREDITS,
            "rest_credits": REST_CREDITS,
            "trade_refund_pct": TRADE_REFUND_PCT,
            "market_refresh_cost": MARKET_REFRESH_COST,
            "emergency_recovery_cost": EMERGENCY_RECOVERY_COST,
            "emergency_recovery_max_per_run": EMERGENCY_RECOVERY_MAX_PER_RUN,
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
