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
from nba_peak.run_the_table.bosses import (
    assert_boss_is_legal,
    boss_reveal_order,
    boss_slugs,
    generate_boss_for_act,
    scout_report,
)
from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    CONCLUDED_STATUSES,
    BENCH_SLOTS,
    BOSS_WIN_CREDITS,
    COMEBACK_CREDITS,
    CREDIT_SINKS,
    EMERGENCY_RECOVERY_COST,
    EMERGENCY_RECOVERY_MAX_PER_RUN,
    LANE_FIELDS,
    LANE_LABELS,
    MARKET_REFRESH_COST,
    MARKET_REFRESHES_PER_NODE,
    MAX_LIVES,
    MAX_SYSTEMS,
    RESERVE_CARD_COST,
    REST_CREDITS,
    REST_LIFE_RECOVERY,
    ROLE_FOCUS_COST,
    ROLES,
    ROSTER_SIZE,
    SCOUT_CHOICES,
    SCOUT_PREP_LANE_BONUS,
    STAGES_PER_ACT,
    STARTING_CREDITS,
    STARTING_LIVES,
    STATUS_BOSS_READY,
    STATUS_BOSS_RESOLVED,
    STATUS_COMPLETE,
    STATUS_FAILED,
    STATUS_NODE_ACTIVE,
    STATUS_NODE_SELECT,
    STATUS_ABANDONED,
    STATUS_SYSTEM_SELECT,
    TERMINAL_STATUSES,
    version_tuple,
)
from nba_peak.run_the_table.generation import (
    market_offers,
    node_option,
    opening_reveal,
    stage_for,
)
from nba_peak.run_the_table.pricing import (
    price_for,
    refund_for,
    trade_net_cost,
    veteran_minimum_available,
)
from nba_peak.run_the_table.schemas import (
    Opponent,
    RosterSlot,
    RunAction,
    RunBlueprint,
    RunState,
)

BENCH_SLOT_IDS = tuple(f"bench_{i + 1}" for i in range(BENCH_SLOTS))

#: Node types that have a refreshable market.
MARKET_NODE_TYPES = ("draft_room", "trade_desk")

#: Reveal targets accepted by :func:`action_reveal`.
REVEAL_TARGETS = ("roster", "boss")


class RunActionError(Exception):
    """An illegal or out-of-order action."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_VERSION_LABELS = {
    "ruleset_version": "ruleset",
    "engine_version": "engine",
    "card_pool_version": "card pool",
    "peak3_model_version": "PEAK3 model",
}


def _describe_version_change(saved: dict, current: dict, changed: list[str]) -> str:
    """A specific, human sentence naming what actually changed.

    v1 said only "a different ruleset", for any of four different fields, which
    told a player nothing about whether their run was lost to a rules change, a
    card-pool rebuild, or a model version bump.
    """
    if not changed:
        return "This run's version fingerprint no longer matches the engine. Start a new run."
    if changed == ["ruleset_version"]:
        was = saved.get("ruleset_version") or "an unrecorded ruleset"
        return (
            f"This run was started under the previous ruleset ({was}); the rules have "
            f"since changed to {current['ruleset_version']}, so it can no longer be "
            f"continued. Your completed runs are unaffected — start a new run to play "
            f"the current rules."
        )
    parts = []
    for key in changed:
        was = saved.get(key) or "unrecorded"
        parts.append(f"{_VERSION_LABELS.get(key, key)} {was} → {current.get(key)}")
    return (
        "This run was started under different game versions ("
        + "; ".join(parts)
        + "), so it can no longer be continued. Start a new run."
    )


class VersionMismatch(Exception):
    """A saved run was created under a different ruleset/engine/card pool.

    Carries the specific fields that differ so the API can answer 409 with a
    sentence a player can act on rather than a generic refusal.
    """

    def __init__(
        self, saved: dict, current: dict, message: Optional[str] = None
    ) -> None:
        saved = dict(saved or {})
        current = dict(current or {})
        changed = [k for k, v in current.items() if saved.get(k) != v]
        super().__init__(message or _describe_version_change(saved, current, changed))
        self.saved = saved
        self.current = current
        self.changed_fields = changed


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
    pool: Optional[CardPool] = None,
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
    state = RunState(
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
        scouted_boss_acts=[],
        pending_prep=None,
        role_focus=None,
        reserved_card=None,
        node_refreshes={},
        emergency_recoveries_used=0,
        sink_spend=[],
        reveal_index=0,
        boss_reveal_index={},
        boss_lineups={},
    )
    # NO BOSS IS LOCKED HERE. See `ensure_boss_for_act` for why: an opponent
    # built against the opening roster is stale by the time the act-1 fight
    # happens, because the player spends the whole starting purse in between.
    return state


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


# ---------------------------------------------------------------------------
# The generated boss slate (v4)
# ---------------------------------------------------------------------------
# A boss is generated once, against the roster standing in front of it, and
# then stored. These four functions are the whole of that lifecycle; nothing
# else may build or read a boss.


def assert_roster_identities_unique(state: RunState, pool: CardPool) -> None:
    """Refuse a roster that fields the same identity twice, or a boss's card.

    ON THE WRITE PATH, deliberately. Every acquisition funnels through
    `action_draft_buy` or `action_trade`, and both call this immediately after
    mutating a slot, so a duplicate cannot be persisted even if some future
    caller bypasses `legal_slots_for`. The v3 defect survived a 100,000-seed
    audit because every check that existed lived in a test and every test was
    scoped to one side of the matchup; this one is scoped to the mutation.
    """
    ids = state.all_card_ids()
    slugs = [pool.get(cid).player_slug for cid in ids]
    if len(set(slugs)) != len(slugs):
        dupes = sorted({s for s in slugs if slugs.count(s) > 1})
        raise RunActionError(
            "duplicate_identity",
            f"That would put the same player on the roster twice: {', '.join(dupes)}.",
        )
    resolved = {b.act for b in state.battles}
    for act, payload in state.boss_lineups.items():
        if act in resolved:
            continue
        clash = sorted(set(slugs) & set(boss_slugs(pool, boss_from_dict(payload))))
        if clash:
            raise RunActionError(
                "duplicate_identity",
                f"{', '.join(clash)} is on the act-{act} opponent's roster; the "
                f"same player cannot play both sides of a fight you have not "
                f"finished.",
            )


def boss_to_dict(boss: Opponent) -> dict:
    return {
        "boss_id": boss.boss_id,
        "name": boss.name,
        "tagline": boss.tagline,
        "act": boss.act,
        "rule_id": boss.rule_id,
        "starter_ids": list(boss.starter_ids),
        "bench_ids": list(boss.bench_ids),
        "source": boss.source,
    }


def boss_from_dict(d: dict) -> Opponent:
    return Opponent(
        boss_id=d["boss_id"],
        name=d["name"],
        tagline=d["tagline"],
        act=int(d["act"]),
        rule_id=d.get("rule_id"),
        starter_ids=tuple(d["starter_ids"]),
        bench_ids=tuple(d["bench_ids"]),
        source=d.get("source", "generated"),
    )


def locked_boss_acts(state: RunState) -> list[int]:
    return sorted(state.boss_lineups)


def unavailable_slugs(state: RunState, pool: CardPool) -> frozenset[str]:
    """Identities this run may neither be offered nor acquire.

    Two sources, and both are load-bearing:

    * every identity already on the roster -- a board must never offer a card
      the run holds, whenever it was acquired;
    * every identity on a LOCKED boss the run has not yet beaten.

    The second is the subtle half. A boss is generated excluding the roster as
    it stands when its act begins, so it cannot collide at that moment -- but
    the player then plays two more decision nodes before fighting it, and
    without this a card bought at either of them could walk straight onto the
    board opposite its own twin. Bosses for acts already resolved are NOT
    excluded: beating The Ceiling and then signing one of its players is a good
    story and creates no duplicate, because that lineup will never be fielded
    again.
    """
    out = set(roster_slugs(state, pool))
    resolved = {b.act for b in state.battles}
    for act, payload in state.boss_lineups.items():
        if act in resolved:
            continue
        out |= boss_slugs(pool, boss_from_dict(payload))
    return frozenset(out)


def boss_exclusion_slugs(state: RunState, pool: CardPool) -> frozenset[str]:
    """Identities a newly-generated boss may not field.

    Everything `unavailable_slugs` covers, PLUS any card the player currently
    holds a live reservation on.

    THE RESERVATION CLAUSE IS NOT DEFENSIVE, it fixes a real interaction. A
    reservation is bought at a Scout & Prepare node in act N and redeemed at
    the next Draft Room, which is frequently in act N+1 -- and act N+1's boss is
    locked in between. Without this, the boss could take the very card the
    player had just paid five credits to hold, and the reservation would arrive
    at the Draft Room unbuyable because acquiring it would duplicate an
    identity. The player would have been charged for nothing, by a rule they
    could not see coming.
    """
    out = set(unavailable_slugs(state, pool))
    reserved = state.reserved_card
    if reserved and reserved.get("status") in ("live", "offered"):
        out.add(pool.get(reserved["card_id"]).player_slug)
    return frozenset(out)


def ensure_boss_for_act(
    state: RunState,
    blueprint: RunBlueprint,
    act: int,
    pool: Optional[CardPool] = None,
) -> Opponent:
    """Lock this act's boss, or return the one already locked.

    WHEN THIS IS CALLED IS A CALIBRATION DECISION, and it was measured rather
    than guessed. The obvious moment is "when the act begins", and that is what
    this did first -- but a player then plays two decision nodes before the
    fight, and at act 1 they do it holding the entire 50-credit starting purse.
    Measured over 200 seeds x 8 policies, the act-1 boss was built for a target
    of -0.74 and the fight actually happened at a MEDIAN delta of -7.70: the
    opponent was calibrated against a roster that no longer existed by the time
    it took the floor, and every policy's act-1 win rate ran away accordingly.

    So the lineup is locked at the moment it first becomes VISIBLE, which is
    exactly one of two points:

      * the player opens a Scout & Prepare node (`action_choose_node`), because
        the scout report shows the opponent and it must not move afterwards; or
      * the run reaches the boss (`_advance_after_node` sets BOSS_READY).

    That keeps the opponent honest for a player who walks straight in, and it
    turns scouting into a genuine strategic act rather than only an information
    purchase: freezing the opponent early and then upgrading against it is a
    real edge, bought with the node choice that paid for it.

    Idempotent by construction: once `state.boss_lineups[act]` exists it is
    returned untouched, so a replay, a resume and a repeated call all serve the
    lineup that was actually locked.
    """
    pool = pool or get_pool()
    existing = state.boss_lineups.get(act)
    if existing is not None:
        return boss_from_dict(existing)

    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    # Every identity the run owns, every identity another still-unbeaten boss
    # already fields (so two bosses cannot share a player either), and any card
    # the player has paid to reserve.
    exclude = boss_exclusion_slugs(state, pool)
    boss = generate_boss_for_act(
        pool,
        blueprint.seed,
        act,
        starters,
        bench,
        state.systems,
        exclude,
    )
    state.boss_lineups[act] = boss_to_dict(boss)
    return boss


def boss_for_act(
    state: RunState,
    blueprint: RunBlueprint,
    act: int,
    pool: Optional[CardPool] = None,
) -> Optional[Opponent]:
    """The locked boss for an act, or None if this run has no such act.

    A READ. It never generates -- an act whose boss has not been locked yet is
    an act the player has not reached, and inventing a lineup for it here would
    be exactly the "second copy of the truth" the persistence model exists to
    avoid. Callers that need a boss to exist call `ensure_boss_for_act`.
    """
    if not 1 <= act <= ACTS:
        return None
    payload = state.boss_lineups.get(act)
    if payload is None:
        return None
    boss = boss_from_dict(payload)
    # Cheap, and it is the only thing standing between a corrupted or
    # hand-edited snapshot and a battle resolved against an illegal lineup.
    assert_boss_is_legal(pool or get_pool(), boss)
    return boss


def available_system_offer(state: RunState) -> tuple[str, ...]:
    """The pending System offer with anything already held removed.

    The post-Boss-1 offer is drawn independently of the first, so it can name a
    System the player already runs. Three are always offered and at most one
    can be held, so at least two legal choices always remain.
    """
    offer = state.pending_system_offer or ()
    return tuple(s for s in offer if s not in state.systems)


def active_role_focus(state: RunState, node_id: str) -> Optional[str]:
    """The role a paid Role Focus is guaranteeing on this node's board, if any."""
    focus = state.role_focus
    if focus and focus.get("consumed_node_id") == node_id:
        return focus["role"]
    return None


def active_reservation(state: RunState, node_id: str) -> Optional[dict]:
    """The reservation currently sitting on this node's board, if any."""
    reserved = state.reserved_card
    if reserved and reserved.get("status") == "offered" and reserved.get(
        "offered_node_id"
    ) == node_id:
        return reserved
    return None


def node_offers(
    state: RunState, blueprint: RunBlueprint, node_id: str, pool: Optional[CardPool] = None
) -> list[str]:
    """The board this node is actually offering right now.

    THE single source of truth for both the API's render and the state
    machine's legality check, so a card the player can see is exactly a card the
    player can buy. Composes the three live modifiers (refresh, role focus,
    reservation) through :func:`generation.market_offers`.
    """
    pool = pool or get_pool()
    reservation = active_reservation(state, node_id)
    reserved_id = reservation["card_id"] if reservation else None
    # A reservation is a card the player already paid to hold, so it is never
    # substituted away -- but it must not be double-counted as "owned" either,
    # because it is not on the roster yet.
    exclude = unavailable_slugs(state, pool)
    if reserved_id:
        exclude = exclude - {pool.get(reserved_id).player_slug}
    return market_offers(
        pool,
        blueprint,
        node_id,
        refresh_index=state.node_refreshes.get(node_id, 0),
        role_focus=active_role_focus(state, node_id),
        reserved_card_id=reserved_id,
        exclude_slugs=exclude,
    )


def scout_and_prepare_options(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
) -> dict:
    """Everything a Scout & Prepare node offers right now, priced and gated.

    One accessor so the API never restates a price or re-derives a legality
    rule: what this returns is exactly what :func:`action_film_room` will
    accept. ``affordable`` and ``available`` are separate on purpose — a client
    should be able to show a locked option WITH its reason rather than hiding
    it, which is how a player learns the sink exists.
    """
    pool = pool or get_pool()
    plan, option = _active_node(state, blueprint)
    if option.node_type != "film_room":
        raise RunActionError("wrong_node_type", "The open node is not a Scout & Prepare.")

    boss = boss_for_act(state, blueprint, state.act, pool)
    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    report = (
        scout_report(pool, boss, starters, bench, state.systems) if boss else None
    )

    reservation_live = state.reserved_card is not None and state.reserved_card[
        "status"
    ] in ("live", "offered")
    candidates = []
    for card_id in plan.payloads[option.node_id]["reserve_candidate_ids"]:
        card = pool.get(card_id)
        cost, modifiers = price_for(card, state.systems)
        candidates.append(
            {
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "prime_score": card.prime_score,
                "locked_cost": cost,
                "modifiers": modifiers,
                "legal_slots": legal_slots_for(state, pool, card_id),
            }
        )

    return {
        "node_id": option.node_id,
        "choices": [
            {
                "id": "scout_boss",
                "name": "Scout the Boss",
                "cost": 0,
                "available": True,
                "unavailable_reason": None,
                "prep_bonus": SCOUT_PREP_LANE_BONUS,
                "report": report,
            },
            {
                "id": "shape_market",
                "name": CREDIT_SINKS["role_focus"]["name"],
                "cost": ROLE_FOCUS_COST,
                "available": state.role_focus is None
                and state.credits >= ROLE_FOCUS_COST,
                "unavailable_reason": (
                    "role_focus_active" if state.role_focus is not None
                    else "insufficient_credits" if state.credits < ROLE_FOCUS_COST
                    else None
                ),
                "roles": list(ROLES),
                "summary": CREDIT_SINKS["role_focus"]["summary"],
            },
            {
                "id": "reserve_card",
                "name": CREDIT_SINKS["reserve_card"]["name"],
                "cost": RESERVE_CARD_COST,
                "available": not reservation_live
                and state.credits >= RESERVE_CARD_COST,
                "unavailable_reason": (
                    "reservation_active" if reservation_live
                    else "insufficient_credits" if state.credits < RESERVE_CARD_COST
                    else None
                ),
                "candidates": candidates,
                "summary": CREDIT_SINKS["reserve_card"]["summary"],
            },
        ],
    }


def reveal_progress(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
) -> dict:
    """The opening and boss reveals, plus how far each has already got.

    Spec §3: the server preselects the authoritative cards and the client only
    animates to them, so the whole reveal — including a partially-completed one
    after a refresh — is answerable from one call.
    """
    pool = pool or get_pool()
    boss = boss_for_act(state, blueprint, state.act, pool)
    return {
        "roster": {
            "slots": opening_reveal(pool, blueprint),
            "revealed": state.reveal_index,
            "total": ROSTER_SIZE,
            "complete": state.reveal_index >= ROSTER_SIZE,
        },
        "boss": (
            {
                "act": boss.act,
                "boss_id": boss.boss_id,
                "name": boss.name,
                "tagline": boss.tagline,
                "rule_id": boss.rule_id,
                "source": boss.source,
                "slots": boss_reveal_order(pool, boss),
                "revealed": state.boss_reveal_index.get(state.act, 0),
                "total": ROSTER_SIZE,
                "complete": state.boss_reveal_index.get(state.act, 0) >= ROSTER_SIZE,
            }
            if boss else None
        ),
    }


def credit_sink_total(state: RunState) -> int:
    """Credits this run has spent on published sinks rather than on cards."""
    return sum(row["cost"] for row in state.sink_spend)


def _spend(state: RunState, sink_id: str, cost: int, detail: dict) -> None:
    """Charge a published sink, or refuse. Never lets the balance go negative."""
    if cost > state.credits:
        raise RunActionError(
            "insufficient_credits",
            f"That costs {cost} credits; you have {state.credits}.",
        )
    state.credits -= cost
    state.sink_spend.append(
        {
            "sink_id": sink_id,
            "cost": cost,
            "act": state.act,
            "stage": state.stage,
            **detail,
        }
    )


def _open_node_effects(state: RunState, node_type: str, node_id: str) -> None:
    """Bind the paid, one-shot market effects to the node being opened.

    Done here, at open time, rather than lazily inside the offer accessor, so
    that "which node did my Role Focus apply to" is recorded state a replay
    reproduces exactly instead of a re-derivation that could disagree.
    """
    if node_type not in MARKET_NODE_TYPES:
        return
    focus = state.role_focus
    if focus and focus.get("consumed_node_id") is None:
        focus["consumed_node_id"] = node_id
    reserved = state.reserved_card
    if (
        node_type == "draft_room"
        and reserved
        and reserved.get("status") == "live"
    ):
        reserved["status"] = "offered"
        reserved["offered_node_id"] = node_id


def _close_node_effects(state: RunState, node_id: str) -> None:
    """Retire the one-shot market effects this node consumed.

    A reservation expires after the Draft Room it appeared in, whether or not it
    was bought; a Role Focus is spent by the market it shaped. Both are stated
    on the sink's published summary, and both are enforced here rather than by
    the client.
    """
    focus = state.role_focus
    if focus and focus.get("consumed_node_id") == node_id:
        state.role_focus = None
    reserved = state.reserved_card
    if reserved and reserved.get("offered_node_id") == node_id and reserved[
        "status"
    ] == "offered":
        reserved["status"] = "expired"


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
    card already on the roster (same player) is never legal anywhere -- INCLUDING
    the slot it currently occupies.

    THAT LAST CLAUSE IS A FIX, NOT A RESTATEMENT. The previous implementation
    discounted the current occupant (`owned - {occupant}`) so that a slot could
    be refilled, which had the unintended consequence that a card was reported
    legal for the slot IT WAS ALREADY IN. `action_trade` had no
    `outgoing != incoming` guard, so trading a card for itself passed every
    check and charged `cost - refund` for a no-op -- 7 credits on a 14-cost
    card. Refilling still works, because an incoming card that is NOT the
    occupant still clears `owned - {occupant}`; what no longer works is
    swapping a player for himself.

    A card on a locked, still-unbeaten boss is also never legal: acquiring one
    would put the same identity on both sides of a fight that has already been
    scouted. See `unavailable_slugs`.
    """
    card = pool.get(card_id)
    owned = roster_slugs(state, pool)
    if card.player_slug in owned:
        return []
    blocked = unavailable_slugs(state, pool)
    if card.player_slug in blocked:
        return []
    out: list[str] = []
    for s in state.starters:
        if s.role in card.eligible_roles:
            out.append(s.slot_id)
    for s in state.bench:
        out.append(s.slot_id)
    return out


# ---------------------------------------------------------------------------
# Progression
# ---------------------------------------------------------------------------
def _advance_after_node(
    state: RunState, blueprint: RunBlueprint, pool: Optional[CardPool] = None
) -> None:
    if state.active_node_id:
        _close_node_effects(state, state.active_node_id)
    state.active_node_id = None
    if state.stage < STAGES_PER_ACT:
        state.stage += 1
        state.status = STATUS_NODE_SELECT
    else:
        state.stage = STAGES_PER_ACT + 1
        state.status = STATUS_BOSS_READY
        # Arriving at the boss is the latest possible moment to fix it, and
        # therefore the one that calibrates against the roster that will
        # actually play. A player who scouted has already locked it; this is a
        # no-op for them.
        ensure_boss_for_act(state, blueprint, state.act, pool)


def _advance_after_boss(
    state: RunState, blueprint: RunBlueprint, pool: Optional[CardPool] = None
) -> None:
    # Belt and braces: `action_resolve_boss` already ends the run the instant
    # lives hit zero, so this branch is unreachable through the action API. It
    # stays because a state loaded from anywhere else must not be able to walk
    # into another act on a dead run.
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
    else:
        state.act += 1
        state.stage = 1
        state.status = STATUS_NODE_SELECT
    # The next act's opponent is NOT locked here -- it is locked when it first
    # becomes visible, either at a Scout & Prepare node or on arrival at the
    # boss. See `ensure_boss_for_act`.


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
    pool: Optional[CardPool] = None,
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
    _open_node_effects(state, option.node_type, node_id)
    if option.node_type == "film_room":
        # Opening Scout & Prepare SHOWS the opponent, so it is fixed here and
        # cannot move afterwards. That is what the node is for -- and freezing
        # the boss before spending the act's remaining credits against it is a
        # real edge, which is what makes this node worth choosing.
        ensure_boss_for_act(state, blueprint, state.act, pool)
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
    offers = node_offers(state, blueprint, option.node_id, pool)
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
    # A reserved card is charged the price it was RESERVED at, which is the
    # whole of what the 5-credit reservation buys. Everything else is priced
    # live, under whatever Systems the run holds now.
    reservation = active_reservation(state, option.node_id)
    reserved_here = bool(reservation and reservation["card_id"] == card_id)
    if reserved_here:
        cost = reservation["locked_cost"]
        modifiers = list(reservation["locked_modifiers"])
    else:
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
    assert_roster_identities_unique(state, pool)
    if free:
        state.veteran_minimum_used_in_act[state.act] = True
    if reserved_here:
        reservation["status"] = "used"

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
            "reserved": reserved_here,
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
    _advance_after_node(state, blueprint, pool)
    return state


def action_draft_pass(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
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
    _advance_after_node(state, blueprint, pool)
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
    incoming_ids = node_offers(state, blueprint, option.node_id, pool)
    if incoming_card_id not in incoming_ids:
        raise RunActionError("card_not_offered", "That card is not on this trade board.")

    slot = _slot(state, outgoing_slot_id)
    if not slot.card_id:
        raise RunActionError("empty_slot", "There is no card in that slot to trade.")
    # A trade must move an identity. Trading a card for itself was legal under
    # v3 and cost `incoming_cost - refund` for no change whatsoever; it is
    # refused here EXPLICITLY as well as being unreachable through
    # `legal_slots_for`, because a rule this cheap to state should not depend
    # on a second function continuing to imply it.
    if pool.get(slot.card_id).player_slug == pool.get(incoming_card_id).player_slug:
        raise RunActionError(
            "same_player_trade",
            f"{pool.get(incoming_card_id).player_name} is already in that slot; "
            f"a trade has to change the roster.",
        )
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
    assert_roster_identities_unique(state, pool)
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
    _advance_after_node(state, blueprint, pool)
    return state


def action_decline_trade(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
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
    _advance_after_node(state, blueprint, pool)
    return state


#: v3 Scout & Prepare choices. The v2 pair ("scout_offers", "take_credits") is
#: gone: `take_credits` was 89% of every Film Room visit a competent policy ever
#: made, and `scout_offers` could not change a later decision. A stale client
#: sending either now fails loudly with `unknown_choice` rather than silently
#: buying something different.
FILM_CHOICES = SCOUT_CHOICES
REST_CHOICES = ("recover_life", "take_credits")


def action_market_refresh(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Spend MARKET_REFRESH_COST to replace this node's board, once (spec §4).

    Server-authoritative and deterministic: the replacement board is a pure
    function of the seed, the node, and the refresh index, so refreshing is a
    real decision with a known cost rather than a re-roll.
    """
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type not in MARKET_NODE_TYPES:
        raise RunActionError(
            "wrong_node_type", "Only a Draft Room or a Trade Desk has a market to refresh."
        )
    used = state.node_refreshes.get(option.node_id, 0)
    if used >= MARKET_REFRESHES_PER_NODE:
        raise RunActionError(
            "refresh_limit",
            f"This market can only be refreshed {MARKET_REFRESHES_PER_NODE} time(s).",
        )

    _spend(state, "market_refresh", MARKET_REFRESH_COST, {"node_id": option.node_id})
    state.node_refreshes[option.node_id] = used + 1
    # The node stays open: refreshing is not a move, it buys a different board
    # to make a move on.
    _record(state, "market_refresh", {"node_id": option.node_id}, idempotency_key)
    return state


def action_film_room(
    state: RunState,
    blueprint: RunBlueprint,
    choice: str,
    lane: Optional[str] = None,
    role: Optional[str] = None,
    card_id: Optional[str] = None,
    pool: Optional[CardPool] = None,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Resolve a Scout & Prepare node (spec §5).

    Every branch produces something the player can act on: information plus a
    preparation, market control, or a reserved asset. There is no "take the
    credits and ignore it" branch, which is what the v2 node degenerated into.
    """
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    pool = pool or get_pool()
    plan, option = _active_node(state, blueprint)
    if option.node_type != "film_room":
        raise RunActionError("wrong_node_type", "The open node is not a Scout & Prepare.")
    if choice not in FILM_CHOICES:
        raise RunActionError(
            "unknown_choice", f"Scout & Prepare choice must be one of {FILM_CHOICES}."
        )

    payload: dict = {"choice": choice}

    if choice == "scout_boss":
        # Free, and always legal — the node must never dead-end a player who has
        # spent everything, exactly as `draft_pass` never can.
        if lane not in LANE_FIELDS:
            raise RunActionError(
                "unknown_lane",
                f"Choose one of the five lanes to prepare: {', '.join(LANE_FIELDS)}.",
            )
        if state.act not in state.scouted_boss_acts:
            state.scouted_boss_acts.append(state.act)
        state.pending_prep = {
            "lane": lane,
            "label": LANE_LABELS[lane],
            "bonus": SCOUT_PREP_LANE_BONUS,
            "act": state.act,
        }
        payload["lane"] = lane

    elif choice == "shape_market":
        if role not in ROLES:
            raise RunActionError(
                "unknown_role", f"Choose one of the five roles: {', '.join(ROLES)}."
            )
        if state.role_focus is not None:
            raise RunActionError(
                "role_focus_active", "You already have a Role Focus waiting on a market."
            )
        _spend(state, "role_focus", ROLE_FOCUS_COST, {"role": role})
        state.role_focus = {
            "role": role,
            "acquired_act": state.act,
            "acquired_stage": state.stage,
            "consumed_node_id": None,
        }
        # Market control includes seeing what you are shaping: the rest of this
        # act plus the next act's opener are revealed.
        for s in blueprint.stages:
            if (s.act == state.act and s.stage > state.stage) or (
                s.act == state.act + 1 and s.stage == 1
            ):
                key = f"a{s.act}s{s.stage}"
                if key not in state.scouted_stage_keys:
                    state.scouted_stage_keys.append(key)
        payload["role"] = role

    else:  # reserve_card
        candidates = plan.payloads[option.node_id]["reserve_candidate_ids"]
        if card_id not in candidates:
            raise RunActionError(
                "card_not_offered", "That card is not one of the revealed future cards."
            )
        if state.reserved_card is not None and state.reserved_card["status"] in (
            "live",
            "offered",
        ):
            raise RunActionError(
                "reservation_active", "You already have a card reserved."
            )
        if not legal_slots_for(state, pool, card_id):
            raise RunActionError(
                "illegal_slot", "That player is already on your roster."
            )
        locked_cost, locked_modifiers = price_for(pool.get(card_id), state.systems)
        _spend(
            state,
            "reserve_card",
            RESERVE_CARD_COST,
            {"card_id": card_id, "locked_cost": locked_cost},
        )
        state.reserved_card = {
            "card_id": card_id,
            "locked_cost": locked_cost,
            "locked_modifiers": locked_modifiers,
            "reserved_act": state.act,
            "reserved_stage": state.stage,
            "offered_node_id": None,
            "status": "live",
        }
        payload["card_id"] = card_id

    state.resolved_node_ids.append(option.node_id)
    _record(state, "film_room", payload, idempotency_key)
    _advance_after_node(state, blueprint, pool)
    return state


def action_emergency_recovery(
    state: RunState,
    blueprint: RunBlueprint,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Buy one life back at a Rest / Bank, at the published price (spec §4).

    Additive to the free ``recover_life`` choice at the same node — that is what
    makes it worth EMERGENCY_RECOVERY_COST rather than a strictly worse version
    of a free option — and capped at EMERGENCY_RECOVERY_MAX_PER_RUN per run, so
    credits can buy exactly one mistake back and never a whole run's worth.
    """
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_NODE_ACTIVE)
    plan, option = _active_node(state, blueprint)
    if option.node_type != "rest_bank":
        raise RunActionError(
            "wrong_node_type", "Emergency Recovery is only offered at a Rest / Bank."
        )
    if state.emergency_recoveries_used >= EMERGENCY_RECOVERY_MAX_PER_RUN:
        raise RunActionError(
            "recovery_limit",
            f"Emergency Recovery can only be used "
            f"{EMERGENCY_RECOVERY_MAX_PER_RUN} time(s) per run.",
        )
    if state.lives >= MAX_LIVES:
        raise RunActionError(
            "lives_full", f"You already have the maximum of {MAX_LIVES} lives."
        )

    _spend(state, "emergency_recovery", EMERGENCY_RECOVERY_COST, {})
    state.lives = min(MAX_LIVES, state.lives + 1)
    state.emergency_recoveries_used += 1
    # Like a refresh, this is not the node's move: the Rest / Bank choice is
    # still to be made.
    _record(state, "emergency_recovery", {}, idempotency_key)
    return state


def action_rest_bank(
    state: RunState,
    blueprint: RunBlueprint,
    choice: str,
    pool: Optional[CardPool] = None,
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
    _advance_after_node(state, blueprint, pool)
    return state


def action_reveal(
    state: RunState,
    blueprint: RunBlueprint,
    target: str = "roster",
    count: int = 1,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Advance a slot-by-slot reveal, server-side (spec §3).

    The reveal is presentation, but its PROGRESS is state: a refresh mid-reveal
    must resume rather than restart, and "skip all" must be a thing the server
    knows happened. ``count`` may exceed what is left; it saturates at the
    roster size, which is what makes the skip-all button one call.

    Deliberately not a gate on anything: a client that never calls this can
    still play the run, so an older client is degraded, not broken.
    """
    if _already_applied(state, idempotency_key):
        return state
    if state.status in TERMINAL_STATUSES:
        raise RunActionError("run_finished", "This run has already ended.")
    if target not in REVEAL_TARGETS:
        raise RunActionError(
            "unknown_reveal_target", f"Reveal target must be one of {REVEAL_TARGETS}."
        )
    if count < 1:
        raise RunActionError("invalid_count", "Reveal at least one slot.")

    if target == "roster":
        state.reveal_index = min(ROSTER_SIZE, state.reveal_index + count)
        payload = {"target": target, "count": count, "revealed": state.reveal_index}
    else:
        act = state.act
        if boss_for_act(state, blueprint, act) is None:
            raise RunActionError(
                "no_boss_for_act", f"This run has no boss for act {act}."
            )
        seen = state.boss_reveal_index.get(act, 0)
        state.boss_reveal_index[act] = min(ROSTER_SIZE, seen + count)
        payload = {
            "target": target,
            "act": act,
            "count": count,
            "revealed": state.boss_reveal_index[act],
        }

    _record(state, "reveal", payload, idempotency_key)
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
    # Guarded: a state restored from a snapshot carries its own `act`, and an
    # unguarded lookup turns any drift into a 500. `boss_for_act` returns None
    # both for an out-of-range act and for one whose boss was never locked,
    # and both are the same answer to the player.
    boss = boss_for_act(state, blueprint, state.act, pool)
    if boss is None:
        raise RunActionError(
            "no_boss_for_act",
            f"This run has no boss for act {state.act}; it has {ACTS} acts.",
        )

    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    if len(starters) != len(ROLES):
        raise RunActionError(
            "incomplete_roster", "Every starting slot must be filled before a battle."
        )

    # The Scout & Prepare preparation is spent HERE, on this act's boss, whether
    # or not it helped. It is cleared before the result is recorded so it can
    # never leak into a later battle.
    prep = state.pending_prep
    lane_bonuses: dict[str, float] = {}
    if prep and prep.get("act") == state.act:
        lane_bonuses = {prep["lane"]: prep["bonus"]}
        state.pending_prep = None

    result = resolve_battle(
        pool,
        starters,
        bench,
        boss,
        state.systems,
        lives_before=state.lives,
        comeback_credits=COMEBACK_CREDITS,
        win_credits=BOSS_WIN_CREDITS,
        lane_bonuses=lane_bonuses,
    )
    state.battles.append(result)
    state.lives = result.lives_after
    state.credits += result.credits_awarded
    # THE RUN ENDS THE MOMENT LIVES HIT ZERO, checked here rather than only in
    # `_advance_after_boss`. In v1 the only zero-lives check sat behind an
    # `advance` action the client had to send, so a run was "still going" until
    # it was acknowledged. The battle just resolved is in `state.battles`, and a
    # terminal payload carries every battle plus the receipt, so the reveal is
    # still fully available on the result screen.
    state.status = STATUS_FAILED if state.lives <= 0 else STATUS_BOSS_RESOLVED
    _record(state, "resolve_boss", {"boss_id": boss.boss_id}, idempotency_key)
    return state


def abandon_run(
    state: RunState,
    successor_run_id: Optional[str] = None,
    abandoned_at: Optional[str] = None,
) -> RunState:
    """Retire an unfinished run because the player started another one.

    DELIBERATELY NOT AN `action_*`. Every other mutation here is a move inside
    a run and is replayed from the action log; this is the run ENDING, from
    outside it. It takes no blueprint and no pool because it consults no rules:
    there is no legality question in "I quit". It is also not recorded in the
    action log, because a replay reconstructs how a run was PLAYED and quitting
    is not a move.

    Refuses a run that already concluded. A completed or failed run is a RESULT
    the player earned, and relabelling it "abandoned" because they pressed a
    button on the results screen would rewrite history and strip a receipt they
    are entitled to. `runs.restart_run` routes those to a plain new run instead.

    Idempotent: abandoning an already-abandoned run returns it untouched, which
    is what makes the double-click path safe all the way down to the engine.
    """
    if state.status == STATUS_ABANDONED:
        return state
    if state.status in CONCLUDED_STATUSES:
        raise RunActionError(
            "run_already_finished",
            "This run is already finished; it cannot be abandoned.",
        )
    state.status = STATUS_ABANDONED
    state.abandoned_at = abandoned_at or _now()
    state.successor_run_id = successor_run_id
    # No node stays open on a run nobody is playing.
    state.active_node_id = None
    state.last_action_at = state.abandoned_at
    return state


def action_advance(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Acknowledge a resolved battle and move to the next act, or finish.

    Takes the pool because advancing an act LOCKS THAT ACT'S BOSS
    (`_advance_after_boss` -> `ensure_boss_for_act`), which needs the card pool
    to build a lineup. Under v3 this action only moved counters.
    """
    if _already_applied(state, idempotency_key):
        return state
    _guard(state, STATUS_BOSS_RESOLVED)
    _record(state, "advance", {}, idempotency_key)
    _advance_after_boss(state, blueprint, pool)
    return state


# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------
_DISPATCH = {
    "select_system": lambda st, bp, p, a: action_select_system(st, bp, a.payload["system_id"]),
    "choose_node": lambda st, bp, p, a: action_choose_node(
        st, bp, a.payload["node_id"], p
    ),
    "draft_buy": lambda st, bp, p, a: action_draft_buy(
        st, bp, a.payload["card_id"], a.payload["slot_id"], p,
        a.payload.get("use_veteran_minimum", False),
    ),
    "draft_pass": lambda st, bp, p, a: action_draft_pass(st, bp, p),
    "trade": lambda st, bp, p, a: action_trade(
        st, bp, a.payload["outgoing_slot_id"], a.payload["incoming_card_id"], p
    ),
    "decline_trade": lambda st, bp, p, a: action_decline_trade(st, bp, p),
    "market_refresh": lambda st, bp, p, a: action_market_refresh(st, bp, p),
    "film_room": lambda st, bp, p, a: action_film_room(
        st, bp, a.payload["choice"],
        lane=a.payload.get("lane"),
        role=a.payload.get("role"),
        card_id=a.payload.get("card_id"),
        pool=p,
    ),
    "rest_bank": lambda st, bp, p, a: action_rest_bank(st, bp, a.payload["choice"], p),
    "emergency_recovery": lambda st, bp, p, a: action_emergency_recovery(st, bp),
    "reveal": lambda st, bp, p, a: action_reveal(
        st, bp, a.payload.get("target", "roster"), a.payload.get("count", 1)
    ),
    "resolve_boss": lambda st, bp, p, a: action_resolve_boss(st, bp, p),
    "advance": lambda st, bp, p, a: action_advance(st, bp, p),
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
    state = create_run(blueprint, run_id, owner_sub, pool=pool)
    for action in actions:
        handler = _DISPATCH.get(action.action_type)
        if handler is None:
            raise RunActionError("unknown_action", f"Cannot replay '{action.action_type}'.")
        state = handler(state, blueprint, pool, action)
    return state


def clone(state: RunState) -> RunState:
    return copy.deepcopy(state)
