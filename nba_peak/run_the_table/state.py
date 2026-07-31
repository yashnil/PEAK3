"""Run state machine for RUN THE TABLE.

Every mutation is a pure ``(state, blueprint, args) -> state`` function that
appends to ``action_log``. Because the blueprint is derived from the seed and
the log is complete, :func:`replay` can rebuild any state exactly — which is
what makes save/resume, challenge links, and the determinism audit all the
same mechanism.

Invalid actions raise :class:`RunActionError` with a stable ``code`` the API
maps to an HTTP error and the UI shows as plain language.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Optional

from nba_peak.run_the_table.battle import resolve_battle
from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    COMEBACK_CREDITS,
    FILM_CREDITS,
    MAX_LIVES,
    MAX_SYSTEMS,
    REST_CREDITS,
    REST_LIFE_RECOVERY,
    ROLES,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STARTING_LIVES,
    STATUS_BOSS_READY,
    STATUS_BOSS_RESOLVED,
    STATUS_COMPLETE,
    STATUS_FAILED,
    STATUS_NODE_ACTIVE,
    STATUS_NODE_SELECT,
    STATUS_SYSTEM_SELECT,
    TERMINAL_STATUSES,
    version_tuple,
)
from nba_peak.run_the_table.generation import node_option, stage_for
from nba_peak.run_the_table.pricing import (
    price_for,
    refund_for,
    trade_net_cost,
    veteran_minimum_available,
)
from nba_peak.run_the_table.schemas import (
    RosterSlot,
    RunAction,
    RunBlueprint,
    RunState,
)

BENCH_SLOT_IDS = tuple(f"bench_{i + 1}" for i in range(BENCH_SLOTS))


class RunActionError(Exception):
    """An illegal or out-of-order action."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class VersionMismatch(Exception):
    """A saved run was created under a different ruleset/engine/card pool."""

    def __init__(self, saved: dict, current: dict) -> None:
        super().__init__(
            "This run was created under a different ruleset and can no longer be "
            "replayed. Start a new run."
        )
        self.saved = saved
        self.current = current


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def assert_version_compatible(saved_versions: dict) -> None:
    """Reject a saved run whose versions no longer match the engine.

    Deliberately strict: silently replaying a run under changed rules would
    produce a result that never actually happened.
    """
    current = version_tuple()
    for key, value in current.items():
        if saved_versions.get(key) != value:
            raise VersionMismatch(saved_versions, current)


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------
def create_run(
    blueprint: RunBlueprint,
    run_id: str,
    owner_sub: Optional[str] = None,
    created_at: Optional[str] = None,
) -> RunState:
    ts = created_at or _now()
    starters = [
        RosterSlot(slot_id=role, is_starter=True, role=role, card_id=cid)
        for role, cid in zip(ROLES, blueprint.starting_starters)
    ]
    bench = [
        RosterSlot(slot_id=sid, is_starter=False, role=None, card_id=cid)
        for sid, cid in zip(BENCH_SLOT_IDS, blueprint.starting_bench)
    ]
    return RunState(
        run_id=run_id,
        seed=blueprint.seed,
        run_type=blueprint.run_type,
        date=blueprint.date,
        status=STATUS_SYSTEM_SELECT,
        act=1,
        stage=1,
        credits=STARTING_CREDITS,
        lives=STARTING_LIVES,
        starters=starters,
        bench=bench,
        systems=[],
        veteran_minimum_used_in_act={a: False for a in range(1, ACTS + 1)},
        pending_system_offer=blueprint.system_offers[0],
        active_node_id=None,
        scouted_stage_keys=[],
        resolved_node_ids=[],
        battles=[],
        action_log=[],
        acquisitions=[],
        trades=[],
        created_at=ts,
        last_action_at=ts,
        owner_sub=owner_sub,
        versions=version_tuple(),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _slot(state: RunState, slot_id: str) -> RosterSlot:
    for s in state.starters + state.bench:
        if s.slot_id == slot_id:
            return s
    raise RunActionError("unknown_slot", f"No roster slot '{slot_id}'")


def roster_slugs(state: RunState, pool: CardPool) -> set[str]:
    return {pool.get(cid).player_slug for cid in state.all_card_ids()}


def available_system_offer(state: RunState) -> tuple[str, ...]:
    """The pending System offer with anything already held removed.

    The post-Boss-1 offer is drawn independently of the first, so it can name a
    System the player already runs. Three are always offered and at most one
    can be held, so at least two legal choices always remain.
    """
    offer = state.pending_system_offer or ()
    return tuple(s for s in offer if s not in state.systems)


def _guard(state: RunState, expected: str) -> None:
    if state.status in TERMINAL_STATUSES:
        raise RunActionError("run_finished", "This run has already ended.")
    if state.status != expected:
        raise RunActionError(
            "wrong_status",
            f"Expected the run to be at '{expected}' but it is at '{state.status}'.",
        )


def _record(state: RunState, action_type: str, payload: dict, key: Optional[str]) -> None:
    state.action_log.append(
        RunAction(
            action_type=action_type,
            act=state.act,
            stage=state.stage,
            payload=payload,
            idempotency_key=key,
        )
    )
    state.last_action_at = _now()


def _already_applied(state: RunState, key: Optional[str]) -> bool:
    return bool(key) and any(a.idempotency_key == key for a in state.action_log)


def legal_slots_for(state: RunState, pool: CardPool, card_id: str) -> list[str]:
    """Slots this card may legally occupy.

    A starter slot requires role eligibility; bench slots accept any card. A
    card already on the roster (same player) is never legal anywhere.
    """
    card = pool.get(card_id)
    owned = roster_slugs(state, pool)
    out: list[str] = []
    for s in state.starters:
        if s.role in card.eligible_roles:
            occupant = pool.get(s.card_id).player_slug if s.card_id else None
            if card.player_slug not in (owned - {occupant}):
                out.append(s.slot_id)
    for s in state.bench:
        occupant = pool.get(s.card_id).player_slug if s.card_id else None
        if card.player_slug not in (owned - {occupant}):
            out.append(s.slot_id)
    return out


# ---------------------------------------------------------------------------
# Progression
# ---------------------------------------------------------------------------
def _advance_after_node(state: RunState) -> None:
    state.active_node_id = None
    if state.stage < STAGES_PER_ACT:
        state.stage += 1
        state.status = STATUS_NODE_SELECT
    else:
        state.stage = STAGES_PER_ACT + 1
        state.status = STATUS_BOSS_READY


def _advance_after_boss(state: RunState, blueprint: RunBlueprint) -> None:
    if state.lives <= 0:
        state.status = STATUS_FAILED
        return
    if state.act >= ACTS:
        state.status = STATUS_COMPLETE
        return
    # A second System is offered once, after Boss 1.
    if state.act == 1 and len(state.systems) < MAX_SYSTEMS:
        state.pending_system_offer = blueprint.system_offers[1]
        state.act += 1
        state.stage = 1
        state.status = STATUS_SYSTEM_SELECT
        return
    state.act += 1
    state.stage = 1
    state.status = STATUS_NODE_SELECT


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------
def action_select_system(
    state: RunState,
    blueprint: RunBlueprint,
    system_id: str,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_SYSTEM_SELECT)
    offer = state.pending_system_offer or ()
    if system_id not in offer:
        raise RunActionError("system_not_offered", "That System was not offered here.")
    if system_id in state.systems:
        raise RunActionError("system_already_held", "You already run that System.")
    if len(state.systems) >= MAX_SYSTEMS:
        raise RunActionError("system_limit", f"You can hold at most {MAX_SYSTEMS} Systems.")

    state.systems.append(system_id)
    state.pending_system_offer = None
    state.status = STATUS_NODE_SELECT
    _record(state, "select_system", {"system_id": system_id}, idempotency_key)
    return state


def action_choose_node(
    state: RunState,
    blueprint: RunBlueprint,
    node_id: str,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_SELECT)
    plan, option = node_option(blueprint, node_id)
    if plan.act != state.act or plan.stage != state.stage:
        raise RunActionError(
            "node_not_available", "That node belongs to a different stage of the run."
        )
    state.active_node_id = node_id
    state.status = STATUS_NODE_ACTIVE
    _record(state, "choose_node", {"node_id": node_id, "node_type": option.node_type},
            idempotency_key)
    return state


def _active_node(state: RunState, blueprint: RunBlueprint) -> tuple:
    if not state.active_node_id:
        raise RunActionError("no_active_node", "No node is currently open.")
    return node_option(blueprint, state.active_node_id)


def action_draft_buy(
    state: RunState,
    blueprint: RunBlueprint,
    card_id: str,
    slot_id: str,
    pool: Optional[CardPool] = None,
    use_veteran_minimum: bool = False,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    pool = pool or get_pool()
    plan, option = _active_node(state, blueprint)
    if option.node_type != "draft_room":
        raise RunActionError("wrong_node_type", "The open node is not a Draft Room.")
    offers = plan.payloads[option.node_id]["offer_ids"]
    if card_id not in offers:
        raise RunActionError("card_not_offered", "That card is not on this board.")

    card = pool.get(card_id)
    if slot_id not in legal_slots_for(state, pool, card_id):
        raise RunActionError(
            "illegal_slot",
            f"{card.player_name} is not eligible for that slot, or is already on your roster.",
        )

    free = use_veteran_minimum and veteran_minimum_available(
        card, state.systems, state.veteran_minimum_used_in_act[state.act]
    )
    cost, modifiers = price_for(card, state.systems)
    charged = 0 if free else cost
    if charged > state.credits:
        raise RunActionError(
            "insufficient_credits",
            f"{card.player_name} costs {charged} credits; you have {state.credits}.",
        )

    slot = _slot(state, slot_id)
    replaced = slot.card_id
    # No refund here. Buying in the Draft Room releases the card you displace
    # for nothing; the Trade Desk is the only place a departing card returns
    # credits. That difference is what makes the two node types a real choice
    # rather than "Trade Desk but with more options", and it is what keeps the
    # economy from inflating past the point where every run ends in GOATs.
    refund = 0

    state.credits = state.credits - charged
    slot.card_id = card_id
    if free:
        state.veteran_minimum_used_in_act[state.act] = True

    state.acquisitions.append(
        {
            "card_id": card_id,
            "slot_id": slot_id,
            "cost": charged,
            "list_cost": cost,
            "modifiers": modifiers,
            "replaced_card_id": replaced,
            "refund": refund,
            "act": state.act,
            "stage": state.stage,
            "veteran_minimum": free,
        }
    )
    state.resolved_node_ids.append(option.node_id)
    _record(
        state,
        "draft_buy",
        {
            "card_id": card_id,
            "slot_id": slot_id,
            "use_veteran_minimum": use_veteran_minimum,
        },
        idempotency_key,
    )
    _advance_after_node(state)
    return state


def action_draft_pass(
    state: RunState,
    blueprint: RunBlueprint,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type != "draft_room":
        raise RunActionError("wrong_node_type", "The open node is not a Draft Room.")
    state.resolved_node_ids.append(option.node_id)
    _record(state, "draft_pass", {}, idempotency_key)
    _advance_after_node(state)
    return state


def action_trade(
    state: RunState,
    blueprint: RunBlueprint,
    outgoing_slot_id: str,
    incoming_card_id: str,
    pool: Optional[CardPool] = None,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    pool = pool or get_pool()
    plan, option = _active_node(state, blueprint)
    if option.node_type != "trade_desk":
        raise RunActionError("wrong_node_type", "The open node is not a Trade Desk.")
    incoming_ids = plan.payloads[option.node_id]["incoming_ids"]
    if incoming_card_id not in incoming_ids:
        raise RunActionError("card_not_offered", "That card is not on this trade board.")

    slot = _slot(state, outgoing_slot_id)
    if not slot.card_id:
        raise RunActionError("empty_slot", "There is no card in that slot to trade.")
    # legal_slots_for already discounts the current occupant, so the slot being
    # emptied is offered back when the incoming card is eligible for it.
    if outgoing_slot_id not in legal_slots_for(state, pool, incoming_card_id):
        raise RunActionError(
            "illegal_slot",
            "That incoming card is not eligible for the slot you are emptying.",
        )

    outgoing = pool.get(slot.card_id)
    incoming = pool.get(incoming_card_id)
    breakdown = trade_net_cost(outgoing, incoming, state.systems)
    if breakdown["net_cost"] > state.credits:
        raise RunActionError(
            "insufficient_credits",
            f"That trade costs {breakdown['net_cost']} net credits; you have {state.credits}.",
        )

    state.credits -= breakdown["net_cost"]
    slot.card_id = incoming_card_id
    state.trades.append(
        {
            "outgoing_card_id": outgoing.peak_window_id,
            "incoming_card_id": incoming_card_id,
            "slot_id": outgoing_slot_id,
            **breakdown,
            "act": state.act,
            "stage": state.stage,
        }
    )
    state.resolved_node_ids.append(option.node_id)
    _record(
        state,
        "trade",
        {"outgoing_slot_id": outgoing_slot_id, "incoming_card_id": incoming_card_id},
        idempotency_key,
    )
    _advance_after_node(state)
    return state


def action_decline_trade(
    state: RunState,
    blueprint: RunBlueprint,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type != "trade_desk":
        raise RunActionError("wrong_node_type", "The open node is not a Trade Desk.")
    state.resolved_node_ids.append(option.node_id)
    _record(state, "decline_trade", {}, idempotency_key)
    _advance_after_node(state)
    return state


FILM_CHOICES = ("scout_offers", "take_credits")
REST_CHOICES = ("recover_life", "take_credits")


def action_film_room(
    state: RunState,
    blueprint: RunBlueprint,
    choice: str,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type != "film_room":
        raise RunActionError("wrong_node_type", "The open node is not a Film Room.")
    if choice not in FILM_CHOICES:
        raise RunActionError("unknown_choice", f"Film Room choice must be one of {FILM_CHOICES}.")

    if choice == "scout_offers":
        # Unlock the remaining stages of this act plus the next stage, so the
        # advantage is real but bounded and fully replayable.
        for s in blueprint.stages:
            if (s.act == state.act and s.stage > state.stage) or (
                s.act == state.act + 1 and s.stage == 1
            ):
                key = f"a{s.act}s{s.stage}"
                if key not in state.scouted_stage_keys:
                    state.scouted_stage_keys.append(key)
    else:
        state.credits += FILM_CREDITS

    state.resolved_node_ids.append(option.node_id)
    _record(state, "film_room", {"choice": choice}, idempotency_key)
    _advance_after_node(state)
    return state


def action_rest_bank(
    state: RunState,
    blueprint: RunBlueprint,
    choice: str,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type != "rest_bank":
        raise RunActionError("wrong_node_type", "The open node is not a Rest / Bank.")
    if choice not in REST_CHOICES:
        raise RunActionError("unknown_choice", f"Rest choice must be one of {REST_CHOICES}.")

    if choice == "recover_life":
        state.lives = min(MAX_LIVES, state.lives + REST_LIFE_RECOVERY)
    else:
        state.credits += REST_CREDITS

    state.resolved_node_ids.append(option.node_id)
    _record(state, "rest_bank", {"choice": choice}, idempotency_key)
    _advance_after_node(state)
    return state


def action_resolve_boss(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
    idempotency_key: Optional[str] = None,
) -> RunState:
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_BOSS_READY)
    pool = pool or get_pool()
    boss = blueprint.bosses[state.act - 1]

    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    if len(starters) != len(ROLES):
        raise RunActionError(
            "incomplete_roster", "Every starting slot must be filled before a battle."
        )

    result = resolve_battle(
        pool,
        starters,
        bench,
        boss,
        state.systems,
        lives_before=state.lives,
        comeback_credits=COMEBACK_CREDITS,
    )
    state.battles.append(result)
    state.lives = result.lives_after
    state.credits += result.credits_awarded
    state.status = STATUS_BOSS_RESOLVED
    _record(state, "resolve_boss", {"boss_id": boss.boss_id}, idempotency_key)
    return state


def action_advance(
    state: RunState,
    blueprint: RunBlueprint,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Acknowledge a resolved battle and move to the next act, or finish."""
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_BOSS_RESOLVED)
    _record(state, "advance", {}, idempotency_key)
    _advance_after_boss(state, blueprint)
    return state


# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------
_DISPATCH = {
    "select_system": lambda st, bp, p, a: action_select_system(st, bp, a.payload["system_id"]),
    "choose_node": lambda st, bp, p, a: action_choose_node(st, bp, a.payload["node_id"]),
    "draft_buy": lambda st, bp, p, a: action_draft_buy(
        st, bp, a.payload["card_id"], a.payload["slot_id"], p,
        a.payload.get("use_veteran_minimum", False),
    ),
    "draft_pass": lambda st, bp, p, a: action_draft_pass(st, bp),
    "trade": lambda st, bp, p, a: action_trade(
        st, bp, a.payload["outgoing_slot_id"], a.payload["incoming_card_id"], p
    ),
    "decline_trade": lambda st, bp, p, a: action_decline_trade(st, bp),
    "film_room": lambda st, bp, p, a: action_film_room(st, bp, a.payload["choice"]),
    "rest_bank": lambda st, bp, p, a: action_rest_bank(st, bp, a.payload["choice"]),
    "resolve_boss": lambda st, bp, p, a: action_resolve_boss(st, bp, p),
    "advance": lambda st, bp, p, a: action_advance(st, bp),
}


def replay(
    blueprint: RunBlueprint,
    actions: list[RunAction],
    run_id: str,
    owner_sub: Optional[str] = None,
    pool: Optional[CardPool] = None,
) -> RunState:
    """Rebuild a run state by re-applying its action log to a fresh run.

    Used by the determinism audit and available as a recovery path if a stored
    state snapshot is ever corrupted while its log survives.
    """
    pool = pool or get_pool()
    state = create_run(blueprint, run_id, owner_sub)
    for action in actions:
        handler = _DISPATCH.get(action.action_type)
        if handler is None:
            raise RunActionError("unknown_action", f"Cannot replay '{action.action_type}'.")
        state = handler(state, blueprint, pool, action)
    return state


def clone(state: RunState) -> RunState:
    return copy.deepcopy(state)
