"""Final run receipt for RUN THE TABLE.

Everything on the result screen is computed here, deterministically, from the
finished state. There is no prose generation, no model inference, and no
subjective judgement — each headline is a lookup or an arithmetic comparison
over values the player already saw.
"""
from __future__ import annotations

from typing import Optional

from nba_peak.run_the_table.battle import (
    bench_weight_for,
    roster_lane_profile,
    roster_total,
)
from nba_peak.run_the_table.cards import CardPool, get_pool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_WEIGHT_DEFAULT,
    LANE_FIELDS,
    LANE_LABELS,
    ROLES,
    STARTING_CREDITS,
    STATUS_COMPLETE,
    system_by_id,
)
from nba_peak.run_the_table.schemas import RunBlueprint, RunState


def _marginal_contribution(
    pool: CardPool, starters: list[str], bench: list[str], card_id: str, bench_weight: float
) -> float:
    """Drop-one marginal contribution to the roster's overall weighted total.

    The run MVP is the card whose removal costs the roster the most. This is a
    real counterfactual on published lane values, not a popularity heuristic.
    """
    full = roster_total(roster_lane_profile(pool, starters, bench, bench_weight))
    if card_id in starters:
        reduced_s = [c for c in starters if c != card_id]
        reduced_b = bench
    else:
        reduced_s = starters
        reduced_b = [c for c in bench if c != card_id]
    if not reduced_s and not reduced_b:
        return full
    without = roster_total(roster_lane_profile(pool, reduced_s, reduced_b, bench_weight))
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
    ran_the_table = state.status == STATUS_COMPLETE and bosses_defeated == ACTS

    p_bw, _ = bench_weight_for(state.systems, None)
    profile = roster_lane_profile(pool, starters, bench, p_bw)
    total = roster_total(profile)

    # --- run MVP -----------------------------------------------------------
    contributions = [
        {
            **_card_summary(pool, cid),
            "marginal_contribution": _marginal_contribution(
                pool, starters, bench, cid, p_bw
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

    if ran_the_table:
        verdict = "RUN COMPLETE"
        headline = "Ran the table."
    elif state.status == STATUS_COMPLETE:
        verdict = "RUN COMPLETE"
        headline = (
            f"Survived all three acts, beat {bosses_defeated} of {ACTS}."
            if bosses_defeated else "Survived all three acts without a win."
        )
    else:
        verdict = "RUN ENDED"
        failed_act = state.battles[-1].act if state.battles else state.act
        headline = f"Out of lives in Act {failed_act}."

    lane_wins: dict[str, int] = {lane: 0 for lane in LANE_FIELDS}
    for b in state.battles:
        for l in b.lanes:
            if l.winner == "player":
                lane_wins[l.lane] += 1

    reasons: list[dict] = []
    if state.battles:
        best_lane_id = max(lane_wins, key=lambda k: (lane_wins[k], k))
        reasons.append(
            {
                "kind": "lane_strength",
                "text": (
                    f"{LANE_LABELS[best_lane_id]} won {lane_wins[best_lane_id]} of "
                    f"{len(state.battles)} battles."
                ),
                "signed_value": lane_wins[best_lane_id],
            }
        )
        worst_lane_id = min(lane_wins, key=lambda k: (lane_wins[k], k))
        if lane_wins[worst_lane_id] == 0:
            reasons.append(
                {
                    "kind": "lane_weakness",
                    "text": f"{LANE_LABELS[worst_lane_id]} never won a lane.",
                    "signed_value": 0,
                }
            )
    if best_acquisition:
        reasons.append(
            {
                "kind": "acquisition",
                "text": (
                    f"{best_acquisition['player_name']} for {best_acquisition['cost']} "
                    f"credits was the run's best value."
                ),
                "signed_value": best_acquisition["score_delta"],
            }
        )
    if state.credits >= 15 and bosses_defeated < ACTS:
        reasons.append(
            {
                "kind": "economy",
                "text": f"Finished holding {state.credits} unspent credits.",
                "signed_value": -state.credits,
            }
        )

    # --- share story -------------------------------------------------------
    system_names = [system_by_id(s)["name"] for s in state.systems]
    if system_names and mvp:
        story = (
            f"{' + '.join(system_names)} — "
            f"{'defeated all three bosses' if ran_the_table else f'{bosses_defeated} of {ACTS} bosses'}"
            f" with {mvp['player_name']} {mvp['anchor_season']} as run MVP."
        )
    elif mvp:
        story = f"{bosses_defeated} of {ACTS} bosses, {mvp['player_name']} as run MVP."
    else:
        story = headline

    return {
        "verdict": verdict,
        "headline": headline,
        "story": story,
        "ran_the_table": ran_the_table,
        "bosses_defeated": bosses_defeated,
        "battles_lost": battles_lost,
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
