"""Serialise a RUN THE TABLE run state to and from plain JSON.

Mirrors ``apps/api/app/services/perfect_season/serialization.py``. Only the
minimum needed to rebuild the state is stored: the seed regenerates the
blueprint, so bosses, offers and the map are never persisted.
"""
from __future__ import annotations

from nba_peak.run_the_table.schemas import (
    BattleResult,
    LaneResult,
    RosterSlot,
    RunAction,
    RunState,
)

SNAPSHOT_SCHEMA_VERSION = 1


def _lane_to_dict(l: LaneResult) -> dict:
    return {
        "lane": l.lane,
        "label": l.label,
        "player_score": l.player_score,
        "opponent_score": l.opponent_score,
        "winner": l.winner,
        "margin": l.margin,
        "tie_broken_by_rule": l.tie_broken_by_rule,
        "player_top_card_id": l.player_top_card_id,
        "opponent_top_card_id": l.opponent_top_card_id,
    }


def _battle_to_dict(b: BattleResult) -> dict:
    return {
        "boss_id": b.boss_id,
        "act": b.act,
        "lanes": [_lane_to_dict(l) for l in b.lanes],
        "player_lanes_won": b.player_lanes_won,
        "opponent_lanes_won": b.opponent_lanes_won,
        "ties": b.ties,
        "outcome": b.outcome,
        "decided_by": b.decided_by,
        "summed_margin": b.summed_margin,
        "player_roster_total": b.player_roster_total,
        "opponent_roster_total": b.opponent_roster_total,
        "bench_weight": b.bench_weight,
        "rule_id": b.rule_id,
        "lives_after": b.lives_after,
        "credits_awarded": b.credits_awarded,
    }


def state_to_dict(state: RunState) -> dict:
    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "run_id": state.run_id,
        "seed": state.seed,
        "run_type": state.run_type,
        "date": state.date,
        "status": state.status,
        "act": state.act,
        "stage": state.stage,
        "credits": state.credits,
        "lives": state.lives,
        "starters": [
            {"slot_id": s.slot_id, "is_starter": s.is_starter, "role": s.role,
             "card_id": s.card_id}
            for s in state.starters
        ],
        "bench": [
            {"slot_id": s.slot_id, "is_starter": s.is_starter, "role": s.role,
             "card_id": s.card_id}
            for s in state.bench
        ],
        "systems": list(state.systems),
        "veteran_minimum_used_in_act": {
            str(k): v for k, v in state.veteran_minimum_used_in_act.items()
        },
        "pending_system_offer": (
            list(state.pending_system_offer) if state.pending_system_offer else None
        ),
        "active_node_id": state.active_node_id,
        "scouted_stage_keys": list(state.scouted_stage_keys),
        "resolved_node_ids": list(state.resolved_node_ids),
        "battles": [_battle_to_dict(b) for b in state.battles],
        "action_log": [
            {
                "action_type": a.action_type,
                "act": a.act,
                "stage": a.stage,
                "payload": a.payload,
                "idempotency_key": a.idempotency_key,
            }
            for a in state.action_log
        ],
        "acquisitions": list(state.acquisitions),
        "trades": list(state.trades),
        "created_at": state.created_at,
        "last_action_at": state.last_action_at,
        "owner_sub": state.owner_sub,
        "versions": dict(state.versions),
    }


def state_from_dict(d: dict) -> RunState:
    if d.get("schema_version") != SNAPSHOT_SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported run snapshot schema_version {d.get('schema_version')!r}; "
            f"expected {SNAPSHOT_SCHEMA_VERSION}"
        )
    return RunState(
        run_id=d["run_id"],
        seed=d["seed"],
        run_type=d["run_type"],
        date=d.get("date"),
        status=d["status"],
        act=d["act"],
        stage=d["stage"],
        credits=d["credits"],
        lives=d["lives"],
        starters=[RosterSlot(**s) for s in d["starters"]],
        bench=[RosterSlot(**s) for s in d["bench"]],
        systems=list(d["systems"]),
        veteran_minimum_used_in_act={
            int(k): v for k, v in d["veteran_minimum_used_in_act"].items()
        },
        pending_system_offer=(
            tuple(d["pending_system_offer"]) if d.get("pending_system_offer") else None
        ),
        active_node_id=d.get("active_node_id"),
        scouted_stage_keys=list(d.get("scouted_stage_keys", [])),
        resolved_node_ids=list(d.get("resolved_node_ids", [])),
        battles=[
            BattleResult(
                **{**b, "lanes": tuple(LaneResult(**l) for l in b["lanes"])}
            )
            for b in d["battles"]
        ],
        action_log=[RunAction(**a) for a in d["action_log"]],
        acquisitions=list(d.get("acquisitions", [])),
        trades=list(d.get("trades", [])),
        created_at=d["created_at"],
        last_action_at=d["last_action_at"],
        owner_sub=d.get("owner_sub"),
        versions=dict(d.get("versions", {})),
    )
