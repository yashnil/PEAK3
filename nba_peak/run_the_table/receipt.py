"""Final run receipt for RUN THE TABLE.

Everything on the result screen is computed here, deterministically, from the
finished state. There is no prose generation, no model inference, and no
subjective judgement — each headline is a lookup or an arithmetic comparison
over values the player already saw.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.run_the_table.battle import (
    player_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    LANE_FIELDS,
    LANE_LABELS,
    ROLES,
    STARTING_CREDITS,
    STARTING_LIVES,
    STATUS_COMPLETE,
    system_by_id,
)
from nba_peak.run_the_table.schemas import RunBlueprint, RunState

# ---------------------------------------------------------------------------
# Outcome taxonomy (AUTH_DAILY_BALANCE_PLAN §2.2)
# ---------------------------------------------------------------------------
# Exactly three outcomes. "RUN COMPLETE" is retired: v1 printed it both for a
# clean sweep and for a run that survived every act without beating a single
# boss, i.e. victory framing on a losing run.
OUTCOME_TABLE_CLEARED = "table_cleared"
OUTCOME_ENDED_AT_FINAL_BOSS = "ended_at_final_boss"
OUTCOME_ENDED_IN_ACT = "ended_in_act"

VERDICT_TABLE_CLEARED = "TABLE CLEARED"
VERDICT_ENDED_AT_FINAL_BOSS = "RUN ENDED AT THE FINAL BOSS"

OUTCOMES = (OUTCOME_TABLE_CLEARED, OUTCOME_ENDED_AT_FINAL_BOSS, OUTCOME_ENDED_IN_ACT)

# ---------------------------------------------------------------------------
# Semantic receipt items (AUTH_DAILY_BALANCE_PLAN §2.3)
# ---------------------------------------------------------------------------
# `kind` — and only `kind` — carries valence. `value` is always the true,
# unnegated magnitude of what the label states, so a holding of 68 credits is
# 68 and is neutral, never −68 and red.
ITEM_KINDS = ("benefit", "cost", "neutral", "record")
ITEM_UNITS = ("credits", "score", "lanes", "percentage")

# Legacy `reasons` kinds, kept so a receipt saved under v1 and a receipt built
# now render through the same deprecated path for one release.
_LEGACY_KINDS = ("lane_strength", "lane_weakness", "acquisition", "economy")


def _item(
    kind: str,
    label: str,
    value: Optional[float] = None,
    unit: Optional[str] = None,
    display: Optional[str] = None,
) -> dict:
    """One ReceiptItem. Omits absent optional keys rather than emitting nulls."""
    assert kind in ITEM_KINDS, kind
    assert unit is None or unit in ITEM_UNITS, unit
    out: dict = {"kind": kind, "label": label}
    if value is not None:
        out["value"] = value
    if unit is not None:
        out["unit"] = unit
    if display is not None:
        out["display"] = display
    return out


def _legacy_reason(item: dict, legacy_kind: str) -> dict:
    """Project a ReceiptItem back onto the deprecated `reasons` shape.

    The sign is derived from `kind` here, at the very edge, and only for the
    deprecated field — which is the whole point of the change: the engine no
    longer negates a real quantity so that a shared colour helper paints it red.
    A `neutral` holding therefore comes out positive, as it always should have.
    """
    value = item.get("value", 0)
    return {
        "kind": legacy_kind,
        "text": item["label"],
        "signed_value": -value if item["kind"] == "cost" else value,
    }


def _marginal_contribution(
    pool: CardPool,
    starters: list[str],
    bench: list[str],
    card_id: str,
    systems: list[str],
) -> float:
    """Drop-one marginal contribution to the roster's overall weighted total.

    The run MVP is the card whose removal costs the roster the most. This is a
    real counterfactual on published lane values, not a popularity heuristic.

    Scored under the player's own Systems so it reconciles with the
    ``roster_total`` printed beside it.
    """
    full = roster_total(player_lane_profile(pool, starters, bench, systems, None))
    if card_id in starters:
        reduced_s = [c for c in starters if c != card_id]
        reduced_b = bench
    else:
        reduced_s = starters
        reduced_b = [c for c in bench if c != card_id]
    if not reduced_s and not reduced_b:
        return full
    without = roster_total(
        player_lane_profile(pool, reduced_s, reduced_b, systems, None)
    )
    return round(full - without, 4)


def _card_summary(pool: CardPool, card_id: str) -> dict:
    c = pool.get(card_id)
    return {
        "card_id": c.peak_window_id,
        "player_name": c.player_name,
        "player_slug": c.player_slug,
        "anchor_season": c.anchor_season,
        "window": f"{c.start_season}–{c.end_season}",
        "prime_score": c.prime_score,
        "base_cost": c.base_cost,
    }


def build_receipt(
    state: RunState,
    blueprint: RunBlueprint,
    pool: Optional[CardPool] = None,
) -> dict:
    """Deterministic result payload for the completion screen."""
    pool = pool or get_pool()

    starters = [s.card_id for s in state.starters if s.card_id]
    bench = [s.card_id for s in state.bench if s.card_id]
    all_cards = starters + bench

    bosses_defeated = sum(1 for b in state.battles if b.outcome == "win")
    battles_lost = sum(1 for b in state.battles if b.outcome == "loss")
    battles_drawn = sum(1 for b in state.battles if b.outcome == "draw")

    # --- outcome taxonomy --------------------------------------------------
    # The Final Boss is the last act's boss. A win there is the ONLY way to
    # clear the table: beating bosses 1-3 and then drawing or losing act 4 is
    # explicitly not a clear, and a draw counts as neither a win nor a loss.
    final_act = ACTS
    final_battle = next((b for b in state.battles if b.act == final_act), None)
    reached_final_boss = final_battle is not None
    table_cleared = (
        state.status == STATUS_COMPLETE
        and final_battle is not None
        and final_battle.outcome == "win"
    )

    if table_cleared:
        outcome = OUTCOME_TABLE_CLEARED
        verdict = VERDICT_TABLE_CLEARED
        ended_in_act = None
    elif reached_final_boss:
        outcome = OUTCOME_ENDED_AT_FINAL_BOSS
        verdict = VERDICT_ENDED_AT_FINAL_BOSS
        ended_in_act = final_act
    else:
        outcome = OUTCOME_ENDED_IN_ACT
        ended_in_act = state.battles[-1].act if state.battles else state.act
        verdict = f"RUN ENDED IN ACT {ended_in_act}"

    # Scored the way the player was actually scored: Deep Rotation takes the
    # better of two bench weights per lane, so a flat re-weight here would print
    # a roster profile that no battle ever used.
    profile = player_lane_profile(pool, starters, bench, state.systems, None)
    total = roster_total(profile)

    # --- run MVP -----------------------------------------------------------
    contributions = [
        {
            **_card_summary(pool, cid),
            "marginal_contribution": _marginal_contribution(
                pool, starters, bench, cid, list(state.systems)
            ),
            "is_starter": cid in starters,
        }
        for cid in all_cards
    ]
    contributions.sort(key=lambda x: (-x["marginal_contribution"], x["card_id"]))
    mvp = contributions[0] if contributions else None

    # --- best acquisition --------------------------------------------------
    # Value = prime_score gained over the card it replaced, per credit spent.
    best_acquisition = None
    for a in state.acquisitions:
        gained = pool.get(a["card_id"]).prime_score
        lost = pool.get(a["replaced_card_id"]).prime_score if a["replaced_card_id"] else 0.0
        delta = round(gained - lost, 2)
        spend = max(1, a["cost"])
        value = round(delta / spend, 4)
        row = {
            **_card_summary(pool, a["card_id"]),
            "cost": a["cost"],
            "score_delta": delta,
            "value_per_credit": value,
            "replaced": (
                _card_summary(pool, a["replaced_card_id"])
                if a["replaced_card_id"] else None
            ),
            "act": a["act"],
        }
        if best_acquisition is None or (
            row["value_per_credit"],
            row["score_delta"],
            row["card_id"],
        ) > (
            best_acquisition["value_per_credit"],
            best_acquisition["score_delta"],
            best_acquisition["card_id"],
        ):
            best_acquisition = row

    # --- most valuable trade ----------------------------------------------
    best_trade = None
    for t in state.trades:
        gained = pool.get(t["incoming_card_id"]).prime_score
        lost = pool.get(t["outgoing_card_id"]).prime_score
        delta = round(gained - lost, 2)
        row = {
            "incoming": _card_summary(pool, t["incoming_card_id"]),
            "outgoing": _card_summary(pool, t["outgoing_card_id"]),
            "net_cost": t["net_cost"],
            "score_delta": delta,
            "act": t["act"],
        }
        if best_trade is None or (delta, row["incoming"]["card_id"]) > (
            best_trade["score_delta"],
            best_trade["incoming"]["card_id"],
        ):
            best_trade = row

    # --- closest battle ----------------------------------------------------
    closest = None
    for b in state.battles:
        tightest = min(abs(l.margin) for l in b.lanes)
        row = {
            "boss_id": b.boss_id,
            "act": b.act,
            "outcome": b.outcome,
            "lanes": f"{b.player_lanes_won}-{b.opponent_lanes_won}",
            "tightest_lane_margin": round(tightest, 4),
            "summed_margin": b.summed_margin,
        }
        if closest is None or row["tightest_lane_margin"] < closest["tightest_lane_margin"]:
            closest = row

    # --- economy -----------------------------------------------------------
    spent = sum(a["cost"] for a in state.acquisitions) + sum(
        max(0, t["net_cost"]) for t in state.trades
    )
    refunded = sum(a["refund"] for a in state.acquisitions) + sum(
        t["outgoing_refund"] for t in state.trades
    )

    # --- "why this run worked / failed" ------------------------------------
    lane_ranked = sorted(profile.items(), key=lambda kv: -kv[1])
    strongest_lane, strongest_val = lane_ranked[0]
    weakest_lane, weakest_val = lane_ranked[-1]

    if table_cleared:
        headline = "Cleared the table."
    elif reached_final_boss:
        headline = (
            "Drew the Final Boss."
            if final_battle.outcome == "draw"
            else "Reached the Final Boss and could not close it out."
        )
    else:
        headline = f"Out of lives in Act {ended_in_act}."

    lane_wins: dict[str, int] = {lane: 0 for lane in LANE_FIELDS}
    for b in state.battles:
        for l in b.lanes:
            if l.winner == "player":
                lane_wins[l.lane] += 1

    # --- semantic receipt items -------------------------------------------
    # (item, legacy `reasons` kind or None). See §2.3: `kind` carries valence,
    # `value` is the true magnitude of what the label says.
    paired: list[tuple[dict, Optional[str]]] = []

    battles_played = len(state.battles)
    if state.battles:
        best_lane_id = max(lane_wins, key=lambda k: (lane_wins[k], k))
        best_wins = lane_wins[best_lane_id]
        paired.append(
            (
                _item(
                    "benefit" if best_wins else "neutral",
                    f"{LANE_LABELS[best_lane_id]} won {best_wins} of "
                    f"{battles_played} battles.",
                    value=best_wins,
                    unit="lanes",
                    display=f"{best_wins} of {battles_played} battles",
                ),
                "lane_strength",
            )
        )
        worst_lane_id = min(lane_wins, key=lambda k: (lane_wins[k], k))
        if lane_wins[worst_lane_id] == 0:
            paired.append(
                (
                    _item(
                        "cost",
                        f"{LANE_LABELS[worst_lane_id]} never won a lane.",
                        value=0,
                        unit="lanes",
                        display=f"0 of {battles_played} battles",
                    ),
                    "lane_weakness",
                )
            )
        paired.append(
            (
                _item(
                    "record",
                    f"Beat {bosses_defeated} of {ACTS} bosses.",
                    value=bosses_defeated,
                    display=f"{bosses_defeated} of {ACTS}",
                ),
                None,
            )
        )

    if best_acquisition:
        delta = best_acquisition["score_delta"]
        if delta >= 0:
            item = _item(
                "benefit",
                f"{best_acquisition['player_name']} for {best_acquisition['cost']} "
                f"credits was the run's best value, worth {delta:+.2f} PEAK3 points.",
                value=delta,
                unit="score",
            )
        else:
            # The best move of the run was still a downgrade. Say so, with the
            # magnitude the label states — the sign never lives in `value`.
            item = _item(
                "cost",
                f"{best_acquisition['player_name']} for {best_acquisition['cost']} "
                f"credits was the run's best buy and still cost "
                f"{abs(delta):.2f} PEAK3 points.",
                value=round(abs(delta), 2),
                unit="score",
            )
        paired.append((item, "acquisition"))

    if state.credits >= 15 and not table_cleared:
        # NEUTRAL, and 68 rather than −68. v1 emitted `-state.credits` purely so
        # a shared signedColorVar() would paint it red, and the UI then printed
        # the negated number beside the sentence "Finished holding 68 unspent
        # credits" while the Credits section two blocks above printed 68.
        paired.append(
            (
                _item(
                    "neutral",
                    f"Finished holding {state.credits} unspent credits.",
                    value=state.credits,
                    unit="credits",
                ),
                "economy",
            )
        )

    paired.append(
        (
            _item(
                "record",
                f"Finished with {state.lives} of {STARTING_LIVES} lives.",
                value=state.lives,
                display=f"{state.lives} of {STARTING_LIVES}",
            ),
            None,
        )
    )

    items = [item for item, _ in paired]
    reasons = [
        _legacy_reason(item, legacy)
        for item, legacy in paired
        if legacy is not None
    ]

    # --- share story -------------------------------------------------------
    system_names = [system_by_id(s)["name"] for s in state.systems]
    achievement = (
        f"cleared the table, all {ACTS} bosses"
        if table_cleared
        else f"{bosses_defeated} of {ACTS} bosses"
    )
    if system_names and mvp:
        story = (
            f"{' + '.join(system_names)} — {achievement} "
            f"with {mvp['player_name']} {mvp['anchor_season']} as run MVP."
        )
    elif mvp:
        story = f"{achievement}, {mvp['player_name']} as run MVP."
    else:
        story = headline

    return {
        "verdict": verdict,
        "outcome": outcome,
        "headline": headline,
        "story": story,
        "table_cleared": table_cleared,
        # Deprecated alias of `table_cleared`, kept for one release so a client
        # that has not shipped the new field yet still renders.
        "ran_the_table": table_cleared,
        "reached_final_boss": reached_final_boss,
        "final_boss": (
            {
                "act": final_battle.act,
                "boss_id": final_battle.boss_id,
                "outcome": final_battle.outcome,
            }
            if final_battle else None
        ),
        "ended_in_act": ended_in_act,
        "acts_total": ACTS,
        "bosses_defeated": bosses_defeated,
        "battles_lost": battles_lost,
        "battles_drawn": battles_drawn,
        "record": f"{bosses_defeated}-{battles_lost}",
        "lives_remaining": state.lives,
        "systems": [
            {"id": s, "name": system_by_id(s)["name"], "summary": system_by_id(s)["summary"]}
            for s in state.systems
        ],
        "starters": [
            {"slot_id": s.slot_id, "role": s.role, **_card_summary(pool, s.card_id)}
            for s in state.starters if s.card_id
        ],
        "bench": [
            {"slot_id": s.slot_id, "role": None, **_card_summary(pool, s.card_id)}
            for s in state.bench if s.card_id
        ],
        "lane_profile": [
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "value": profile[lane],
                "lanes_won": lane_wins[lane],
            }
            for lane in LANE_FIELDS
        ],
        "roster_total": total,
        "strongest_lane": {"lane": strongest_lane, "label": LANE_LABELS[strongest_lane],
                           "value": strongest_val},
        "weakest_lane": {"lane": weakest_lane, "label": LANE_LABELS[weakest_lane],
                         "value": weakest_val},
        "run_mvp": mvp,
        "marginal_contributions": contributions,
        "best_acquisition": best_acquisition,
        "best_trade": best_trade,
        "closest_battle": closest,
        "credits_spent": spent,
        "credits_refunded": refunded,
        "credits_remaining": state.credits,
        "starting_credits": STARTING_CREDITS,
        # The contract (§2.3). `reasons` is the deprecated projection of these.
        "items": items,
        "reasons": reasons,
        "battles": [
            {
                "act": b.act,
                "boss_id": b.boss_id,
                "outcome": b.outcome,
                "decided_by": b.decided_by,
                "player_lanes_won": b.player_lanes_won,
                "opponent_lanes_won": b.opponent_lanes_won,
                "rule_id": b.rule_id,
            }
            for b in state.battles
        ],
        "seed": state.seed,
        "run_type": state.run_type,
        "date": state.date,
        "versions": state.versions,
    }
