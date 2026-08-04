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
from nba_peak.run_the_table.state import VersionMismatch

# 1 -> 2 with rtt_ruleset_v3. The snapshot SHAPE changed, not just the rules:
# `RunState` gained Scout & Prepare state (`scouted_boss_acts`, `pending_prep`,
# `role_focus`), the credit-sink ledger (`reserved_card`, `node_refreshes`,
# `emergency_recoveries_used`, `sink_spend`) and reveal progress
# (`reveal_index`, `boss_reveal_index`); `BattleResult` gained `lanes_to_win`
# and `lane_bonuses`, and `LaneResult` gained `player_prep_bonus`.
#
# A v1 snapshot deserialised under this schema would silently default every one
# of those to "nothing armed, nothing spent, nothing revealed" — a run that
# never happened. The bump refuses it instead, which is the same answer the
# ruleset gate gives and is reported through the same 409.
#
# 2 -> 3 for the receipt-breakdown fields (SYNTHESIS_CONTRACT.md §2.3):
# `LaneResult` gained `pre_perk_rating` and `bench_adjustment`, the residual
# decomposition of `player_score` a receipt needs to explain a lane's rating
# without the client recomputing anything. Same reasoning as the 1->2 bump: a
# v2 snapshot loaded under this schema would silently default both new fields
# to 0.0 — a receipt claiming "no bench effect, no baseline" for a battle that
# may have had either — so the bump refuses it instead of guessing.
SNAPSHOT_SCHEMA_VERSION = 3


class SnapshotSchemaMismatch(VersionMismatch):
    """A stored snapshot written by a different serialiser generation.

    A SUBCLASS OF VersionMismatch ON PURPOSE. This used to be a bare
    ``ValueError``, which is not in the router's error ladder
    (``apps/api/app/api/v1/run_the_table.py``) and therefore surfaced as an
    unhandled **HTTP 500** — a stored row the server itself wrote being reported
    as a server crash. The ladder already maps ``VersionMismatch`` to 409 with a
    human message, and "this save predates the current format" is exactly that
    answer, so inheriting is what makes the mapping correct without the router
    (owned by another track) having to change at all.
    """

    def __init__(self, found: object, expected: int = SNAPSHOT_SCHEMA_VERSION) -> None:
        super().__init__(
            saved={"snapshot_schema_version": str(found)},
            current={"snapshot_schema_version": str(expected)},
            message=(
                f"This run was saved in an older format (snapshot schema "
                f"{found!r}, current {expected}) and can no longer be continued. "
                f"Start a new run."
            ),
        )
        self.found = found
        self.expected = expected


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
        # v3: the Scout & Prepare bonus already folded into `player_score`.
        # Persisted because the result screen states which lane the preparation
        # actually moved, and a re-read must be able to say the same thing.
        "player_prep_bonus": l.player_prep_bonus,
        # v4 (schema 3): the receipt breakdown. Both already folded into
        # `player_score`; persisted so a re-read reconstructs the same
        # explanation rather than one recomputed from a roster that may have
        # since changed.
        "pre_perk_rating": l.pre_perk_rating,
        "bench_adjustment": l.bench_adjustment,
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
        # v3: a boss rule may raise the lanes an outright win takes
        # (config.BOSS_LANES_TO_WIN), and the preparation the player brought in
        # is published per lane. Both are read back by the receipt.
        "lanes_to_win": b.lanes_to_win,
        "lane_bonuses": dict(b.lane_bonuses),
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
        # -- v3 -------------------------------------------------------------
        # Scout & Prepare, the four credit sinks, and reveal progress. Every one
        # of these is state the player PAID for or progress they already made,
        # so none of it may be re-derived on load: a reservation, a role focus
        # and a half-finished reveal all have to survive a refresh exactly as
        # they were. `boss_reveal_index` is keyed by act, and JSON object keys
        # are strings, so it is stringified here and re-inted below — the same
        # treatment `veteran_minimum_used_in_act` already gets.
        "scouted_boss_acts": list(state.scouted_boss_acts),
        "pending_prep": dict(state.pending_prep) if state.pending_prep else None,
        "role_focus": dict(state.role_focus) if state.role_focus else None,
        "reserved_card": dict(state.reserved_card) if state.reserved_card else None,
        "node_refreshes": dict(state.node_refreshes),
        "emergency_recoveries_used": state.emergency_recoveries_used,
        "sink_spend": [dict(row) for row in state.sink_spend],
        "reveal_index": state.reveal_index,
        "boss_reveal_index": {str(k): v for k, v in state.boss_reveal_index.items()},
    }


def state_from_dict(d: dict) -> RunState:
    if d.get("schema_version") != SNAPSHOT_SCHEMA_VERSION:
        raise SnapshotSchemaMismatch(d.get("schema_version"))
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
        scouted_boss_acts=list(d.get("scouted_boss_acts", [])),
        pending_prep=dict(d["pending_prep"]) if d.get("pending_prep") else None,
        role_focus=dict(d["role_focus"]) if d.get("role_focus") else None,
        reserved_card=dict(d["reserved_card"]) if d.get("reserved_card") else None,
        node_refreshes=dict(d.get("node_refreshes", {})),
        emergency_recoveries_used=int(d.get("emergency_recoveries_used", 0)),
        sink_spend=[dict(row) for row in d.get("sink_spend", [])],
        reveal_index=int(d.get("reveal_index", 0)),
        boss_reveal_index={
            int(k): v for k, v in (d.get("boss_reveal_index") or {}).items()
        },
    )
