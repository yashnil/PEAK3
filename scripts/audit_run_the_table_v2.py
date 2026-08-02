"""
audit_run_the_table_v2.py
-------------------------
Statistical and invariant audit of the RUN THE TABLE **Standard v2** engine
(4 acts / 8 decision nodes / 4 bosses / 3 lives / 50 credits).

Built from `scripts/audit_run_the_table.py` — same eight hard invariants, same
determinism proof, same content-reach reporting — with the four changes v2's
balance work needs:

1. **Five policies, not four.** The v1 harness picked cards by ``prime_score``
   while battles resolve on ``lane_index``, so every win rate it measured was a
   LOWER BOUND on what is achievable. `lane_aware` closes that gap by choosing
   the move that wins the most lanes against the boss actually standing in
   front of it, which is information the game already gives the player.
   `economy_aware` and `look_ahead` probe the other two axes a real player
   plays on. `passive` is retained as a sixth CONTROL (not one of the five):
   it is the do-nothing baseline the "decisions must matter" check needs.

2. **Clear rate, not survival rate.** v2's win condition is
   ``receipt["outcome"] == "table_cleared"``: complete AND the final boss won.
   Surviving four acts while losing every fight is `ended_at_final_boss`.

3. **Per-boss win rates over four acts**, plus the outcome distribution, the
   lane-margin rules' firing rates, perk pick/win rates, and where each battle
   was decided.

4. **Multiprocessing over seed ranges.** The card pool is immutable and
   ``get_pool()`` is lru_cached, so each worker builds it once and shares
   nothing else. 100,000 seeds x 6 policies is ~600,000 runs.

Usage (from repo root):
    python scripts/audit_run_the_table_v2.py [--seeds N] [--json OUT] [--workers K]

Exit codes:
    0  every hard invariant held (soft WARNs may still be printed)
    1  a hard invariant was violated, or the audit could not run

Hard invariants (any violation fails the audit):
    * every starting roster is role-legal, in ROLES order, inside the band
    * no roster ever contains the same player twice
    * every run reaches a terminal status
    * every Draft Room has an offer at or below DRAFT_GUARANTEED_AFFORDABLE_COST
    * a replayed action log reproduces a byte-identical receipt
    * credits never go negative
    * a run never continues past zero lives
    * the receipt's outcome is one of exactly three published strings, and
      `table_cleared` is true only when the final boss battle was a win
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import multiprocessing as mp
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from nba_peak.run_the_table import state as S  # noqa: E402
from nba_peak.run_the_table.battle import (  # noqa: E402
    bench_weight_for,
    player_lane_profile,
    resolve_battle,
    roster_lane_profile,
)
from nba_peak.run_the_table.bosses import (  # noqa: E402
    boss_starter_mean,
    resolve_bosses,
)
from nba_peak.run_the_table.cards import CardPool, CardPoolUnavailable, get_pool  # noqa: E402
from nba_peak.run_the_table.config import (  # noqa: E402
    ACTS,
    BENCH_SLOTS,
    BOSS_LANE_MARGIN,
    BOSS_TARGET_STARTER_MEAN,
    BOSS_WIN_CREDITS,
    COMEBACK_CREDITS,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    LANE_FIELDS,
    LANES_TO_WIN,
    MAX_LIVES,
    ROLES,
    STAGES_PER_ACT,
    STARTER_SLOTS,
    STARTING_CREDITS,
    STARTING_LIVES,
    STATUS_NODE_ACTIVE,
    START_ROSTER_PERCENTILE_BAND,
    SYSTEM_IDS,
    version_tuple,
)
from nba_peak.run_the_table.generation import generate_blueprint, stage_for  # noqa: E402
from nba_peak.run_the_table.pricing import price_for, trade_net_cost  # noqa: E402
from nba_peak.run_the_table.receipt import OUTCOMES, build_receipt  # noqa: E402

#: The five policies §7 requires, plus one control.
POLICIES = (
    "random_legal",
    "greedy_overall",
    "lane_aware",
    "economy_aware",
    "look_ahead",
    "passive",
)
CONTROL_POLICY = "passive"
REQUIRED_POLICIES = tuple(p for p in POLICIES if p != CONTROL_POLICY)

# Soft thresholds for the dominant-strategy warning. The win condition is
# "cleared the table" — the final boss beaten — not merely reaching act 4.
DOMINANT_CLEAR_MAX = 0.60
PASSIVE_CLEAR_MAX = 0.02
# A mode nobody can clear is as broken as one everybody clears.
BEST_POLICY_CLEAR_MIN = 0.10

MAX_STEPS = 100

# Systems whose effect is economic (price or refund). `economy_aware` prefers
# these; `lane_aware` prefers the battle system.
_ECONOMY_SYSTEMS = ("moneyball", "no_hardware", "two_way_value", "veteran_minimum",
                    "trade_machine")


# ---------------------------------------------------------------------------
# Small stats helpers (no numpy dependency — this script must run anywhere)
# ---------------------------------------------------------------------------
def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    pos = q * (len(ordered) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(ordered) - 1)
    frac = pos - lo
    return round(ordered[lo] * (1 - frac) + ordered[hi] * frac, 3)


def mean(values: list[float]) -> float:
    return round(sum(values) / len(values), 3) if values else 0.0


def rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def decade(anchor_season: str) -> str:
    """'1991-92' -> '1990s'. Anchor seasons are always 'YYYY-YY'."""
    try:
        year = int(anchor_season.split("-")[0])
    except (ValueError, AttributeError, IndexError):
        return "unknown"
    return f"{year - year % 10}s"


# ---------------------------------------------------------------------------
# Accumulator — mergeable so workers can each keep their own
# ---------------------------------------------------------------------------
_EXAMPLE_CAP = 5


class Findings:
    LIST_FIELDS = (
        "illegal_rosters", "duplicate_identities", "out_of_band",
        "unaffordable_boards", "dead_end_runs", "dead_end_nodes",
        "replay_mismatches", "negative_credit_runs", "zombie_runs",
        "bad_outcomes",
    )
    COUNTER_FIELDS = (
        "card_offer_counts", "draft_offer_counts", "trade_offer_counts",
        "roster_card_counts", "node_type_counts", "start_role_fills",
        "system_offer_counts", "bosses_faced", "boss_decided_by",
        "lane_drawn_by_rule", "lane_results", "rule_decisive", "rule_battles",
        "purchases", "trades", "declines", "no_affordable_offer",
        "no_placeable_offer", "no_upgrade_available", "noop_choice_nodes",
        "node_choices", "completions", "table_cleared", "outcomes",
        "runs_played", "reached_final_boss", "system_wins", "system_runs",
        "ending_acts", "system_runs_by_policy", "system_wins_by_policy",
    )
    NESTED_COUNTER_FIELDS = (
        "node_visits", "system_selection_counts", "system_available_counts",
        "boss_outcomes",
    )
    LIST_ACCUM_FIELDS = ("spend", "leftover", "lives_left", "ending_act")

    def __init__(self) -> None:
        for name in self.LIST_FIELDS:
            setattr(self, name, [])
        for name in self.COUNTER_FIELDS:
            setattr(self, name, Counter())
        for name in self.NESTED_COUNTER_FIELDS:
            setattr(self, name, defaultdict(Counter))
        for name in self.LIST_ACCUM_FIELDS:
            setattr(self, name, defaultdict(list))

    def merge(self, other: "Findings") -> None:
        for name in self.LIST_FIELDS:
            mine = getattr(self, name)
            mine.extend(getattr(other, name)[: max(0, _EXAMPLE_CAP * 4 - len(mine))])
            # Violation COUNTS must survive truncation, so they are tracked
            # separately from the examples.
        for name in self.COUNTER_FIELDS:
            getattr(self, name).update(getattr(other, name))
        for name in self.NESTED_COUNTER_FIELDS:
            mine = getattr(self, name)
            for key, counter in getattr(other, name).items():
                mine[key].update(counter)
        for name in self.LIST_ACCUM_FIELDS:
            mine = getattr(self, name)
            for key, values in getattr(other, name).items():
                mine[key].extend(values)


class Violations(Counter):
    """Counts of hard-invariant violations, kept separately from examples."""


# ---------------------------------------------------------------------------
# Blueprint-level structural checks (policy independent)
# ---------------------------------------------------------------------------
def audit_blueprint(pool: CardPool, bp, f: Findings, v: Violations) -> None:
    starters, bench = bp.starting_starters, bp.starting_bench
    lo, hi = START_ROSTER_PERCENTILE_BAND

    if len(starters) != STARTER_SLOTS or len(bench) != BENCH_SLOTS:
        v["illegal_starting_rosters"] += 1
        f.illegal_rosters.append((bp.seed, f"roster shape {len(starters)}+{len(bench)}"))
        return

    for role, card_id in zip(ROLES, starters):
        if not pool.has(card_id):
            v["illegal_starting_rosters"] += 1
            f.illegal_rosters.append((bp.seed, f"{card_id} not in pool"))
            return
        if not pool.get(card_id).is_eligible_for(role):
            v["illegal_starting_rosters"] += 1
            f.illegal_rosters.append((bp.seed, f"{card_id} cannot play {role}"))

    all_ids = list(starters) + list(bench)
    slugs = [pool.get(cid).player_slug for cid in all_ids if pool.has(cid)]
    if len(set(slugs)) != len(slugs):
        v["duplicate_identities"] += 1
        f.duplicate_identities.append(
            (bp.seed, [s for s, n in Counter(slugs).items() if n > 1])
        )

    for cid in all_ids:
        if not pool.has(cid):
            continue
        pct = pool.get(cid).overall_percentile
        if not (lo <= pct <= hi):
            v["rosters_outside_percentile_band"] += 1
            f.out_of_band.append((bp.seed, cid, round(pct, 4)))

    for cid in all_ids:
        f.card_offer_counts[cid] += 1
        f.roster_card_counts[cid] += 1
    for role, cid in zip(ROLES, starters):
        if pool.has(cid):
            f.start_role_fills[role] += 1

    for plan in bp.stages:
        for opt in plan.options:
            f.node_type_counts[opt.node_type] += 1
            if opt.node_type == "draft_room":
                offers = plan.payloads[opt.node_id]["offer_ids"]
                for cid in offers:
                    f.card_offer_counts[cid] += 1
                    f.draft_offer_counts[cid] += 1
                cheapest = min(pool.get(cid).base_cost for cid in offers)
                if cheapest > DRAFT_GUARANTEED_AFFORDABLE_COST:
                    v["draft_boards_above_guaranteed_affordable_cost"] += 1
                    f.unaffordable_boards.append((bp.seed, opt.node_id, cheapest))
            elif opt.node_type == "trade_desk":
                for cid in plan.payloads[opt.node_id]["incoming_ids"]:
                    f.card_offer_counts[cid] += 1
                    f.trade_offer_counts[cid] += 1

    for offer in bp.system_offers:
        for sid in offer:
            f.system_offer_counts[sid] += 1


# ---------------------------------------------------------------------------
# Lane projection — the information a player actually has
# ---------------------------------------------------------------------------
def _boss_for(bp, st):
    idx = st.act - 1
    if 0 <= idx < len(bp.bosses):
        return bp.bosses[idx]
    return None


def _boss_profile(pool: CardPool, boss, systems) -> dict[str, float]:
    _, o_bw = bench_weight_for(systems, boss.rule_id)
    return roster_lane_profile(pool, boss.starter_ids, boss.bench_ids, o_bw)


def _lane_projection(pool, starters, bench, systems, boss) -> tuple[int, float]:
    """(lanes won, summed margin) against this boss under its own rule.

    Exactly the comparison `resolve_battle` performs, including the published
    lane-margin band — so a policy that maximises this is playing the rules it
    was shown, not a private model.
    """
    rule = boss.rule_id
    mine = player_lane_profile(pool, starters, bench, systems, rule)
    theirs = _boss_profile(pool, boss, systems)
    band = max(1e-6, BOSS_LANE_MARGIN.get(rule, 0.0) if rule else 0.0)
    won = 0
    total = 0.0
    for lane in LANE_FIELDS:
        margin = mine[lane] - theirs[lane]
        total += margin
        if margin > band:
            won += 1
    return won, round(total, 4)


def _roster_ids(st):
    return (
        [s.card_id for s in st.starters if s.card_id],
        [s.card_id for s in st.bench if s.card_id],
    )


def _with_swap(starters, bench, slot_index, card_id, is_starter):
    s = list(starters)
    b = list(bench)
    if is_starter:
        s[slot_index] = card_id
    else:
        b[slot_index] = card_id
    return s, b


def _slot_position(st, slot_id):
    for i, s in enumerate(st.starters):
        if s.slot_id == slot_id:
            return i, True
    for i, s in enumerate(st.bench):
        if s.slot_id == slot_id:
            return i, False
    raise KeyError(slot_id)


def _score_candidate(pool, st, boss, slot_id, card_id):
    """Projected (lanes, margin) if this card went into this slot."""
    starters, bench = _roster_ids(st)
    idx, is_starter = _slot_position(st, slot_id)
    s, b = _with_swap(starters, bench, idx, card_id, is_starter)
    return _lane_projection(pool, s, b, st.systems, boss)


# ---------------------------------------------------------------------------
# Instrumented playthrough
# ---------------------------------------------------------------------------
def play(bp, pool: CardPool, policy: str, rng: random.Random, f: Findings, v: Violations):
    """Play one run to a terminal status, recording node-level observations."""
    st = S.create_run(bp, f"rtt-audit-{bp.seed}-{policy}")
    steps = 0
    while st.status not in ("complete", "failed"):
        steps += 1
        if steps > MAX_STEPS:
            raise RuntimeError(
                f"run did not terminate: status={st.status} act={st.act} stage={st.stage}"
            )

        if st.status == "system_select":
            offer = S.available_system_offer(st)
            if not offer:
                raise RuntimeError("system_select with no legal choice")
            chosen = _choose_system(policy, offer, rng)
            S.action_select_system(st, bp, chosen)
            f.system_selection_counts[policy][chosen] += 1
            f.system_available_counts[policy][len(offer)] += 1

        elif st.status == "node_select":
            plan = stage_for(bp, st.act, st.stage)
            choice = _choose_node(st, bp, pool, plan, policy, rng)
            S.action_choose_node(st, bp, choice.node_id)
            f.node_visits[policy][choice.node_type] += 1

        elif st.status == "node_active":
            plan, opt = S.node_option(bp, st.active_node_id)
            _resolve_node(st, bp, plan, opt, pool, policy, rng, f, v)

        elif st.status == "boss_ready":
            lives_before = st.lives
            S.action_resolve_boss(st, bp, pool)
            battle = st.battles[-1]
            f.boss_outcomes[policy][(battle.act, battle.outcome)] += 1
            f.boss_decided_by[battle.decided_by] += 1
            f.bosses_faced[battle.boss_id] += 1
            for lane in battle.lanes:
                f.lane_results[(battle.rule_id or "none", lane.winner)] += 1
                if lane.tie_broken_by_rule:
                    f.lane_drawn_by_rule[battle.rule_id or "none"] += 1
            # Does the published rule actually decide anything? v1's `the_wall`
            # tie-break fired 0 times in 120,000 battles, so this is measured
            # rather than assumed: re-resolve the same battle with the rule
            # switched off and see whether the result changes.
            _count_rule_effect(pool, st, bp, battle, f)
            # HARD: a run must not continue past zero lives.
            if st.lives <= 0 and st.status != "failed":
                v["runs_continuing_past_zero_lives"] += 1
                f.zombie_runs.append((bp.seed, policy, st.act, st.status))
            if lives_before <= 0:
                v["runs_continuing_past_zero_lives"] += 1
                f.zombie_runs.append((bp.seed, policy, st.act, "fought with 0 lives"))

        elif st.status == "boss_resolved":
            S.action_advance(st, bp)

        if st.credits < 0:
            v["negative_credit_states"] += 1
            f.negative_credit_runs.append((bp.seed, policy, st.credits))

    return st


def _count_rule_effect(pool, st, bp, battle, f: Findings) -> None:
    boss = bp.bosses[battle.act - 1]
    if not boss.rule_id:
        return
    f.rule_battles[boss.rule_id] += 1
    ruleless = dataclasses.replace(boss, rule_id=None)
    starters = [s.card_id for s in st.starters if s.card_id]
    bench = [s.card_id for s in st.bench if s.card_id]
    counterfactual = resolve_battle(
        pool, starters, bench, ruleless, st.systems,
        lives_before=battle.lives_after + (1 if battle.outcome == "loss" else 0),
        comeback_credits=COMEBACK_CREDITS, win_credits=BOSS_WIN_CREDITS,
    )
    if counterfactual.outcome != battle.outcome:
        f.rule_decisive[boss.rule_id] += 1


def _choose_system(policy, offer, rng):
    options = list(offer)
    if policy == "passive":
        return options[0]
    if policy == "economy_aware":
        preferred = [s for s in options if s in _ECONOMY_SYSTEMS]
        return preferred[0] if preferred else options[0]
    if policy in ("lane_aware", "look_ahead"):
        # Deep Rotation is the only System that touches battle resolution, so a
        # lane-maximising player takes it when offered; otherwise the cheapest
        # broad discount, because credits convert into lanes.
        if "deep_rotation" in options:
            return "deep_rotation"
        preferred = [s for s in options if s in _ECONOMY_SYSTEMS]
        return preferred[0] if preferred else options[0]
    # greedy_overall is greedy on CARDS and indifferent on Systems, on purpose:
    # it is the harness's unconfounded perk probe. Every other competent policy
    # prefers a particular System, which makes their per-System clear rates a
    # measurement of the policy rather than of the System.
    return rng.choice(options)


def _choose_node(st, bp, pool, plan, policy, rng):
    options = list(plan.options)
    if policy == "random_legal":
        return rng.choice(options)
    if policy == "passive":
        return options[0]
    if policy == "greedy_overall":
        options.sort(key=lambda o: (0 if o.node_type == "draft_room" else 1, o.node_id))
        return options[0]
    if policy == "economy_aware":
        # Bank early, spend late: credits are worth more once the boards ahead
        # are known to be the expensive ones.
        want_credits = st.credits < 25 or st.act <= 1
        order = (
            ["rest_bank", "film_room", "draft_room", "trade_desk"]
            if want_credits
            else ["draft_room", "trade_desk", "rest_bank", "film_room"]
        )
        options.sort(key=lambda o: (order.index(o.node_type), o.node_id))
        return options[0]
    if policy == "lane_aware":
        boss = _boss_for(bp, st)
        options.sort(key=lambda o: (_node_lane_value(st, bp, pool, plan, o, boss), o.node_id))
        return options[0]
    # look_ahead: score each branch by the best projection reachable inside it.
    boss = _boss_for(bp, st)
    scored = []
    for opt in options:
        scored.append((-_branch_projection(st, bp, pool, plan, opt, boss), opt.node_id, opt))
    scored.sort()
    return scored[0][2]


def _node_lane_value(st, bp, pool, plan, opt, boss) -> int:
    """Sort key (lower is better) for a node type, from a lane perspective."""
    if opt.node_type == "draft_room":
        return 0
    if opt.node_type == "trade_desk":
        return 1
    if st.lives < MAX_LIVES and opt.node_type == "rest_bank":
        return 0
    return 2


def _branch_projection(st, bp, pool, plan, opt, boss) -> float:
    """How good this branch could leave the roster, in lanes then margin."""
    if boss is None:
        return 0.0
    starters, bench = _roster_ids(st)
    base_lanes, base_margin = _lane_projection(pool, starters, bench, st.systems, boss)
    best = (base_lanes, base_margin)
    payload = plan.payloads[opt.node_id]
    if opt.node_type == "draft_room":
        for cid in payload["offer_ids"]:
            card = pool.get(cid)
            free = S.veteran_minimum_available(
                card, st.systems, st.veteran_minimum_used_in_act[st.act]
            )
            cost = 0 if free else price_for(card, st.systems)[0]
            if cost > st.credits:
                continue
            for slot in S.legal_slots_for(st, pool, cid):
                got = _score_candidate(pool, st, boss, slot, cid)
                if got > best:
                    best = got
    elif opt.node_type == "trade_desk":
        for cid in payload["incoming_ids"]:
            card = pool.get(cid)
            for slot in S.legal_slots_for(st, pool, cid):
                current = S._slot(st, slot).card_id
                if not current:
                    continue
                net = trade_net_cost(pool.get(current), card, st.systems)["net_cost"]
                if net > st.credits:
                    continue
                got = _score_candidate(pool, st, boss, slot, cid)
                if got > best:
                    best = got
    elif opt.node_type == "rest_bank" and st.lives < MAX_LIVES:
        # A life is worth a lane when the alternative is losing the run.
        best = (best[0] + 1, best[1])
    return best[0] * 1000.0 + best[1]


def _resolve_node(st, bp, plan, opt, pool, policy, rng, f: Findings, v: Violations) -> None:
    node_type = opt.node_type
    key = (policy, node_type)
    boss = _boss_for(bp, st)

    if node_type == "draft_room":
        offers = plan.payloads[opt.node_id]["offer_ids"]
        affordable = []
        placeable = []
        best_overall = None
        best_lane = None
        best_value = None
        starters, bench = _roster_ids(st)
        base = _lane_projection(pool, starters, bench, st.systems, boss) if boss else (0, 0.0)

        for cid in offers:
            card = pool.get(cid)
            cost, _ = price_for(card, st.systems)
            free = S.veteran_minimum_available(
                card, st.systems, st.veteran_minimum_used_in_act[st.act]
            )
            charge = 0 if free else cost
            if charge > st.credits:
                continue
            affordable.append(cid)
            slots = [s for s in S.legal_slots_for(st, pool, cid) if s in ROLES]
            if slots:
                placeable.append(cid)
            for slot in slots:
                current = pool.get(S._slot(st, slot).card_id)
                gain = card.prime_score - current.prime_score
                if gain > 0 and (best_overall is None or gain > best_overall[0]):
                    best_overall = (gain, cid, slot, free)
                if gain > 0:
                    per_credit = gain / max(1, charge)
                    if best_value is None or per_credit > best_value[0]:
                        best_value = (per_credit, cid, slot, free)
                if boss is not None:
                    projected = _score_candidate(pool, st, boss, slot, cid)
                    if projected > base and (
                        best_lane is None or projected > best_lane[0]
                    ):
                        best_lane = (projected, cid, slot, free)

        pass_legal = st.status == STATUS_NODE_ACTIVE and node_type == "draft_room"
        if not affordable:
            f.no_affordable_offer[key] += 1
            if not pass_legal:
                v["nodes_with_no_legal_action"] += 1
                f.dead_end_nodes.append((st.seed, opt.node_id, policy))
        if affordable and not placeable:
            f.no_placeable_offer[key] += 1
        if best_overall is None:
            f.no_upgrade_available[key] += 1

        choice = None
        if policy == "passive":
            choice = None
        elif policy == "random_legal":
            pool_of_moves = [
                (cid, slot, S.veteran_minimum_available(
                    pool.get(cid), st.systems, st.veteran_minimum_used_in_act[st.act]))
                for cid in affordable
                for slot in S.legal_slots_for(st, pool, cid)
            ]
            legal_moves = [
                m for m in pool_of_moves
                if (0 if m[2] else price_for(pool.get(m[0]), st.systems)[0]) <= st.credits
            ]
            if legal_moves and rng.random() < 0.75:
                cid, slot, free = rng.choice(legal_moves)
                choice = (None, cid, slot, free)
        elif policy == "greedy_overall":
            choice = best_overall
        elif policy == "economy_aware":
            # Only pay for value; hoard otherwise so act 3/4 boards are reachable.
            choice = best_value if best_value and best_value[0] >= 0.35 else None
        else:  # lane_aware / look_ahead
            choice = best_lane or best_overall

        if choice:
            S.action_draft_buy(st, bp, choice[1], choice[2], pool, choice[3])
            f.purchases[policy] += 1
        else:
            S.action_draft_pass(st, bp)
            f.declines[key] += 1

    elif node_type == "trade_desk":
        incoming = plan.payloads[opt.node_id]["incoming_ids"]
        legal = []
        best_overall = None
        best_lane = None
        starters, bench = _roster_ids(st)
        base = _lane_projection(pool, starters, bench, st.systems, boss) if boss else (0, 0.0)

        for cid in incoming:
            card = pool.get(cid)
            for slot in S.legal_slots_for(st, pool, cid):
                current_id = S._slot(st, slot).card_id
                if not current_id:
                    continue
                out_card = pool.get(current_id)
                breakdown = trade_net_cost(out_card, card, st.systems)
                if breakdown["net_cost"] > st.credits:
                    continue
                legal.append((cid, slot))
                if slot in ROLES and card.prime_score > out_card.prime_score:
                    gain = card.prime_score - out_card.prime_score
                    if best_overall is None or gain > best_overall[0]:
                        best_overall = (gain, cid, slot)
                if boss is not None:
                    projected = _score_candidate(pool, st, boss, slot, cid)
                    if projected > base and (best_lane is None or projected > best_lane[0]):
                        best_lane = (projected, cid, slot)

        if not legal:
            f.no_affordable_offer[key] += 1
        if best_overall is None:
            f.no_upgrade_available[key] += 1

        move = None
        if policy in ("greedy_overall",):
            move = best_overall
        elif policy in ("lane_aware", "look_ahead"):
            move = best_lane or best_overall
        elif policy == "random_legal" and legal and rng.random() < 0.5:
            cid, slot = rng.choice(legal)
            move = (None, cid, slot)
        elif policy == "economy_aware" and best_overall:
            # Trades refund, so a strictly-improving trade is taken whenever it
            # is affordable — that is the economy play.
            move = best_overall

        if move:
            S.action_trade(st, bp, move[2], move[1], pool)
            f.trades[policy] += 1
        else:
            S.action_decline_trade(st, bp)
            f.declines[key] += 1

    elif node_type == "film_room":
        is_last_stage = st.act == ACTS and st.stage == STAGES_PER_ACT
        if is_last_stage:
            f.noop_choice_nodes[(policy, "film_room_scout_at_end")] += 1
        if policy == "random_legal":
            choice = rng.choice(list(S.FILM_CHOICES))
        elif policy == "passive":
            choice = "scout_offers"
        else:
            choice = "take_credits"
        S.action_film_room(st, bp, choice)
        f.node_choices[(policy, "film_room", choice)] += 1

    else:  # rest_bank
        if st.lives >= MAX_LIVES:
            f.noop_choice_nodes[(policy, "rest_recover_at_full_lives")] += 1
        if policy == "random_legal":
            choice = rng.choice(list(S.REST_CHOICES))
        else:
            choice = "recover_life" if st.lives < MAX_LIVES else "take_credits"
        S.action_rest_bank(st, bp, choice)
        f.node_choices[(policy, "rest_bank", choice)] += 1


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------
def _audit_range(args) -> tuple[Findings, Violations, int]:
    lo, hi, replay_every = args
    pool = get_pool()
    f = Findings()
    v = Violations()
    replays = 0

    for seed in range(lo, hi):
        try:
            bp = generate_blueprint(seed, pool=pool)
        except Exception as exc:
            v["dead_end_runs"] += 1
            f.dead_end_runs.append((seed, "generation", repr(exc)))
            continue

        audit_blueprint(pool, bp, f, v)

        for policy in POLICIES:
            rng = random.Random(f"rtt-audit-v2:{seed}:{policy}")
            try:
                st = play(bp, pool, policy, rng, f, v)
            except Exception as exc:
                v["dead_end_runs"] += 1
                f.dead_end_runs.append((seed, policy, repr(exc)))
                continue

            receipt = build_receipt(st, bp, pool)
            outcome = receipt["outcome"]
            final = receipt["final_boss"]
            if outcome not in OUTCOMES:
                v["receipt_outcome_not_published"] += 1
                f.bad_outcomes.append((seed, policy, outcome))
            cleared_truth = (
                st.status == "complete" and final is not None and final["outcome"] == "win"
            )
            if receipt["table_cleared"] != cleared_truth:
                v["table_cleared_disagrees_with_final_boss"] += 1
                f.bad_outcomes.append((seed, policy, "table_cleared mismatch"))
            if receipt["table_cleared"] and outcome != "table_cleared":
                v["table_cleared_disagrees_with_final_boss"] += 1
                f.bad_outcomes.append((seed, policy, "outcome/flag mismatch"))

            f.runs_played[policy] += 1
            f.outcomes[(policy, outcome)] += 1
            if st.status == "complete":
                f.completions[policy] += 1
            if receipt["reached_final_boss"]:
                f.reached_final_boss[policy] += 1
            if receipt["table_cleared"]:
                f.table_cleared[policy] += 1
                for sid in st.systems:
                    f.system_wins[sid] += 1
                    f.system_wins_by_policy[(policy, sid)] += 1
            for sid in st.systems:
                f.system_runs[sid] += 1
                f.system_runs_by_policy[(policy, sid)] += 1

            ending_act = st.battles[-1].act if st.battles else st.act
            f.ending_acts[(policy, ending_act)] += 1
            f.ending_act[policy].append(ending_act)

            spent = sum(a["cost"] for a in st.acquisitions) + sum(
                max(0, t["net_cost"]) for t in st.trades
            )
            f.spend[policy].append(spent)
            f.leftover[policy].append(st.credits)
            f.lives_left[policy].append(st.lives)

            if policy == "lane_aware" and replay_every and seed % replay_every == 0:
                replays += 1
                _replay_matches(bp, st, pool, seed, f, v)

    return f, v, replays


def _replay_matches(bp, st, pool, seed, f: Findings, v: Violations) -> bool:
    """Re-generate the blueprint, re-apply the log, compare receipts byte for byte."""
    try:
        fresh_bp = generate_blueprint(seed, pool=pool)
        rebuilt = S.replay(fresh_bp, st.action_log, st.run_id, pool=pool)
        original = json.dumps(
            build_receipt(st, bp, pool), sort_keys=True, separators=(",", ":"), default=str
        )
        replayed = json.dumps(
            build_receipt(rebuilt, fresh_bp, pool),
            sort_keys=True, separators=(",", ":"), default=str,
        )
    except Exception as exc:
        v["replay_receipt_mismatches"] += 1
        f.replay_mismatches.append((seed, f"replay raised {exc!r}"))
        return False
    if original != replayed:
        v["replay_receipt_mismatches"] += 1
        f.replay_mismatches.append((seed, "receipt differed"))
        return False
    return True


# ---------------------------------------------------------------------------
# Audit driver
# ---------------------------------------------------------------------------
def run_audit(seeds: int, replay_sample: int, workers: int, quiet: bool = False) -> dict:
    started = time.time()
    pool = get_pool()
    bosses = resolve_bosses(pool)

    replay_every = max(1, seeds // max(1, replay_sample))
    chunk = max(1, seeds // max(1, workers * 4))
    ranges = [
        (lo, min(lo + chunk, seeds), replay_every) for lo in range(0, seeds, chunk)
    ]

    findings = Findings()
    violations = Violations()
    replays_checked = 0

    if workers > 1:
        with mp.get_context("fork").Pool(workers) as p:
            for i, (f, v, r) in enumerate(p.imap_unordered(_audit_range, ranges)):
                findings.merge(f)
                violations.update(v)
                replays_checked += r
                if not quiet:
                    print(
                        f"  ... chunk {i + 1}/{len(ranges)} "
                        f"({time.time() - started:.0f}s)",
                        flush=True,
                    )
    else:
        for i, rng_args in enumerate(ranges):
            f, v, r = _audit_range(rng_args)
            findings.merge(f)
            violations.update(v)
            replays_checked += r
            if not quiet:
                print(
                    f"  ... chunk {i + 1}/{len(ranges)} ({time.time() - started:.0f}s)",
                    flush=True,
                )

    return _summarise(
        seeds, findings, violations, pool, bosses, replays_checked,
        time.time() - started,
    )


def _summarise(seeds, f: Findings, v: Violations, pool, bosses, replays_checked, elapsed) -> dict:
    total_runs = sum(f.runs_played.values())
    offered_cards = set(f.card_offer_counts)
    unreachable = sorted(
        c.peak_window_id for c in pool.cards if c.peak_window_id not in offered_cards
    )
    boss_ids = {b.boss_id for b in bosses}
    unreachable_bosses = sorted(boss_ids - set(f.bosses_faced))

    era = Counter()
    role = Counter()
    for card_id, count in f.card_offer_counts.items():
        card = pool.get(card_id)
        era[decade(card.anchor_season)] += count
        for r in card.eligible_roles:
            role[r] += count

    per_policy = {}
    for policy in POLICIES:
        played = f.runs_played[policy]
        outcomes = {}
        for act in range(1, ACTS + 1):
            wins = f.boss_outcomes[policy][(act, "win")]
            losses = f.boss_outcomes[policy][(act, "loss")]
            draws = f.boss_outcomes[policy][(act, "draw")]
            fought = wins + losses + draws
            outcomes[f"act_{act}"] = {
                "fought": fought,
                "wins": wins,
                "losses": losses,
                "draws": draws,
                "win_rate": rate(wins, fought),
                "reach_rate": rate(fought, played),
            }
        per_policy[policy] = {
            "runs": played,
            "is_control": policy == CONTROL_POLICY,
            "clear_rate": rate(f.table_cleared[policy], played),
            "completion_rate": rate(f.completions[policy], played),
            "reached_final_boss_rate": rate(f.reached_final_boss[policy], played),
            "outcome_distribution": {
                outcome: rate(f.outcomes[(policy, outcome)], played)
                for outcome in OUTCOMES
            },
            "average_ending_act": mean([float(x) for x in f.ending_act[policy]]),
            "ending_act_distribution": {
                f"act_{act}": rate(f.ending_acts[(policy, act)], played)
                for act in range(1, ACTS + 1)
            },
            "boss_win_rates": outcomes,
            "purchases": f.purchases[policy],
            "trades": f.trades[policy],
            "credit_spend": {
                "mean": mean(f.spend[policy]),
                "p10": percentile(f.spend[policy], 0.10),
                "p50": percentile(f.spend[policy], 0.50),
                "p90": percentile(f.spend[policy], 0.90),
                "max": max(f.spend[policy]) if f.spend[policy] else 0,
            },
            "credits_left_over": {
                "mean": mean(f.leftover[policy]),
                "p50": percentile(f.leftover[policy], 0.50),
                "p90": percentile(f.leftover[policy], 0.90),
            },
            "lives_remaining": {
                "mean": mean([float(x) for x in f.lives_left[policy]]),
                "p50": percentile([float(x) for x in f.lives_left[policy]], 0.50),
            },
            "systems_selected": dict(f.system_selection_counts[policy].most_common()),
            "nodes_visited": dict(f.node_visits[policy]),
            "no_affordable_offer_nodes": {
                node_type: f.no_affordable_offer[(policy, node_type)]
                for node_type in ("draft_room", "trade_desk")
            },
            "affordable_but_unplaceable_nodes": {
                "draft_room": f.no_placeable_offer[(policy, "draft_room")]
            },
            "no_upgrade_available_nodes": {
                node_type: f.no_upgrade_available[(policy, node_type)]
                for node_type in ("draft_room", "trade_desk")
            },
            "noop_choice_nodes": {
                label: count
                for (pol, label), count in f.noop_choice_nodes.items()
                if pol == policy
            },
            "node_choices": {
                f"{node_type}:{choice}": count
                for (pol, node_type, choice), count in f.node_choices.items()
                if pol == policy
            },
        }

    hard_names = (
        "illegal_starting_rosters",
        "duplicate_identities",
        "rosters_outside_percentile_band",
        "draft_boards_above_guaranteed_affordable_cost",
        "nodes_with_no_legal_action",
        "dead_end_runs",
        "replay_receipt_mismatches",
        "negative_credit_states",
        "runs_continuing_past_zero_lives",
        "receipt_outcome_not_published",
        "table_cleared_disagrees_with_final_boss",
    )
    hard = {name: v[name] for name in hard_names}

    # Perk clear rate is CONFOUNDED BY POLICY: a policy that always takes the
    # battle System and also clears rarely drags that System's headline number
    # down for reasons that have nothing to do with the System. So the pooled
    # rate is reported alongside a per-policy breakdown, and `random_legal` —
    # the only policy that picks uniformly at random from what it is offered —
    # is called out as the unconfounded estimate.
    perks = {
        sid: {
            "offered": f.system_offer_counts[sid],
            "picked": sum(f.system_selection_counts[p][sid] for p in POLICIES),
            "runs_held": f.system_runs[sid],
            "runs_cleared": f.system_wins[sid],
            "clear_rate_when_held": rate(f.system_wins[sid], f.system_runs[sid]),
            # None (not 0.0) when a policy never picks this System: "never
            # chosen" and "chosen and never cleared" are different statements.
            "clear_rate_when_held_by_policy": {
                p: (
                    rate(
                        f.system_wins_by_policy[(p, sid)],
                        f.system_runs_by_policy[(p, sid)],
                    )
                    if f.system_runs_by_policy[(p, sid)] else None
                )
                for p in POLICIES
            },
            "runs_held_by_policy": {
                p: f.system_runs_by_policy[(p, sid)] for p in POLICIES
            },
            # `greedy_overall` picks Systems uniformly at random and plays a
            # competent card game, so its per-System clear rate is the estimate
            # with the policy confound removed at a measurable base rate.
            "unconfounded_clear_rate": rate(
                f.system_wins_by_policy[("greedy_overall", sid)],
                f.system_runs_by_policy[("greedy_overall", sid)],
            ),
        }
        for sid in SYSTEM_IDS
    }

    warnings: list[str] = []
    if unreachable:
        warnings.append(
            f"{len(unreachable)}/{len(pool)} cards were never offered across "
            f"{seeds} seeds (first: {', '.join(unreachable[:5])})"
        )
    if unreachable_bosses:
        warnings.append(f"bosses never faced: {', '.join(unreachable_bosses)}")
    missing_systems = sorted(set(SYSTEM_IDS) - set(f.system_offer_counts))
    if missing_systems:
        warnings.append(f"systems never offered: {', '.join(missing_systems)}")
    for policy in POLICIES:
        clear = per_policy[policy]["clear_rate"]
        if clear > DOMINANT_CLEAR_MAX:
            warnings.append(
                f"dominant strategy: policy '{policy}' cleared the table {clear:.1%} "
                f"of runs (> {DOMINANT_CLEAR_MAX:.0%})"
            )
    passive_clear = per_policy[CONTROL_POLICY]["clear_rate"]
    if passive_clear > PASSIVE_CLEAR_MAX:
        warnings.append(
            f"do-nothing play cleared the table {passive_clear:.1%} of runs "
            f"(> {PASSIVE_CLEAR_MAX:.0%}) — decisions do not matter enough"
        )
    best = max(per_policy[p]["clear_rate"] for p in REQUIRED_POLICIES)
    if best < BEST_POLICY_CLEAR_MIN:
        warnings.append(
            f"unclearable: the best policy cleared the table only {best:.1%} of runs "
            f"(< {BEST_POLICY_CLEAR_MIN:.0%})"
        )
    if era:
        top_era, top_count = era.most_common(1)[0]
        share = top_count / sum(era.values())
        if share > 0.45:
            warnings.append(
                f"era skew: {share:.1%} of offered cards are from the {top_era}"
            )

    return {
        "meta": {
            "seeds": seeds,
            "policies": list(POLICIES),
            "required_policies": list(REQUIRED_POLICIES),
            "control_policy": CONTROL_POLICY,
            "runs_played": total_runs,
            "replays_checked": replays_checked,
            "elapsed_seconds": round(elapsed, 1),
            "card_pool_size": len(pool),
            "versions": version_tuple(),
            "run_shape": {
                "acts": ACTS,
                "stages_per_act": STAGES_PER_ACT,
                "decision_nodes": ACTS * STAGES_PER_ACT,
                "battles": ACTS,
                "starting_lives": STARTING_LIVES,
                "starting_credits": STARTING_CREDITS,
                "lanes_to_win": LANES_TO_WIN,
                "boss_win_credits": BOSS_WIN_CREDITS,
                "comeback_credits": COMEBACK_CREDITS,
            },
        },
        "hard_invariants": hard,
        "hard_invariant_examples": {
            "illegal_starting_rosters": f.illegal_rosters[:5],
            "duplicate_identities": f.duplicate_identities[:5],
            "rosters_outside_percentile_band": f.out_of_band[:5],
            "draft_boards_above_guaranteed_affordable_cost": f.unaffordable_boards[:5],
            "nodes_with_no_legal_action": f.dead_end_nodes[:5],
            "dead_end_runs": f.dead_end_runs[:5],
            "replay_receipt_mismatches": f.replay_mismatches[:5],
            "negative_credit_states": f.negative_credit_runs[:5],
            "runs_continuing_past_zero_lives": f.zombie_runs[:5],
            "receipt_outcome_not_published": f.bad_outcomes[:5],
            "table_cleared_disagrees_with_final_boss": f.bad_outcomes[:5],
        },
        "content_distribution": {
            "distinct_cards_offered": len(offered_cards),
            "distinct_cards_in_draft_rooms": len(f.draft_offer_counts),
            "distinct_cards_in_trade_desks": len(f.trade_offer_counts),
            "distinct_cards_in_starting_rosters": len(f.roster_card_counts),
            "unreachable_cards": unreachable,
            "unreachable_bosses": unreachable_bosses,
            "node_types": dict(f.node_type_counts.most_common()),
            "era_by_anchor_decade": dict(sorted(era.items())),
            "role_eligibility_of_offered_cards": dict(role.most_common()),
            "starting_roster_role_fills": dict(f.start_role_fills.most_common()),
            "system_offer_counts": dict(f.system_offer_counts.most_common()),
            "most_offered_cards": [
                {"card_id": cid, "player": pool.get(cid).player_name, "times": n}
                for cid, n in f.card_offer_counts.most_common(5)
            ],
            "least_offered_cards": [
                {"card_id": cid, "player": pool.get(cid).player_name, "times": n}
                for cid, n in f.card_offer_counts.most_common()[-5:]
            ],
        },
        "bosses": [
            {
                "boss_id": b.boss_id,
                "act": b.act,
                "rule_id": b.rule_id,
                "is_final": b.act >= ACTS,
                "source": b.source,
                "starter_mean": round(boss_starter_mean(pool, b), 3),
                "target": BOSS_TARGET_STARTER_MEAN[i],
                "lane_margin": BOSS_LANE_MARGIN.get(b.rule_id, 0.0) if b.rule_id else 0.0,
                "times_faced": f.bosses_faced[b.boss_id],
                "lanes_drawn_by_rule": f.lane_drawn_by_rule[b.rule_id or "none"],
                # Share of this boss's battles whose OUTCOME the published rule
                # actually changed, measured by re-resolving with the rule off.
                "rule_decisive_rate": rate(
                    f.rule_decisive[b.rule_id or ""], f.rule_battles[b.rule_id or ""]
                ),
                "rule_decisive_battles": f.rule_decisive[b.rule_id or ""],
            }
            for i, b in enumerate(bosses)
        ],
        "battle_decided_by": dict(f.boss_decided_by.most_common()),
        "lane_outcomes_by_rule": {
            f"{rule}:{winner}": n for (rule, winner), n in f.lane_results.most_common()
        },
        "perks": perks,
        "policies": per_policy,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def _row(cells: list[str], widths: list[int]) -> str:
    return "  ".join(str(c).ljust(w) for c, w in zip(cells, widths)).rstrip()


def print_report(result: dict) -> bool:
    meta = result["meta"]
    hard = result["hard_invariants"]
    failed = {k: n for k, n in hard.items() if n}

    print("=" * 88)
    print("RUN THE TABLE — STANDARD v2 ENGINE AUDIT")
    print("=" * 88)
    shape = meta["run_shape"]
    print(
        f"seeds={meta['seeds']}  runs={meta['runs_played']}  "
        f"policies={','.join(meta['policies'])}  pool={meta['card_pool_size']}  "
        f"elapsed={meta['elapsed_seconds']}s"
    )
    print(
        f"shape: {shape['acts']} acts / {shape['decision_nodes']} decision nodes / "
        f"{shape['battles']} bosses / {shape['starting_lives']} lives / "
        f"{shape['starting_credits']} credits / first to {shape['lanes_to_win']}"
    )
    print(f"versions: {meta['versions']['ruleset_version']} / "
          f"{meta['versions']['engine_version']} / pool {meta['versions']['card_pool_version']}")
    print()

    print("-- HARD INVARIANTS " + "-" * 69)
    widths = [58, 12]
    print(_row(["check", "violations"], widths))
    for name, count in hard.items():
        print(_row([name, count], widths))
    print()

    print("-- BOSSES " + "-" * 78)
    bw = [22, 5, 22, 8, 14, 10, 12, 14, 16]
    print(_row(
        ["boss", "act", "rule", "final", "starter_mean", "target", "faced",
         "lanes_drawn", "rule_decisive"], bw))
    for boss in result["bosses"]:
        print(_row(
            [boss["boss_id"], boss["act"], boss["rule_id"],
             "yes" if boss["is_final"] else "", boss["starter_mean"],
             boss["target"], boss["times_faced"], boss["lanes_drawn_by_rule"],
             f"{boss['rule_decisive_rate']:.1%}"],
            bw,
        ))
    print(f"battles decided by          : {result['battle_decided_by']}")
    print()

    print("-- POLICY SUMMARY " + "-" * 70)
    pw = [15, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9]
    print(_row(
        ["policy", "runs", "clear", "reachF", "act1_wr", "act2_wr", "act3_wr",
         "act4_wr", "avg_act", "lives", "spend_p50"],
        pw,
    ))
    for policy, stats in result["policies"].items():
        wr = stats["boss_win_rates"]
        print(_row(
            [
                policy + ("*" if stats["is_control"] else ""),
                stats["runs"],
                f"{stats['clear_rate']:.1%}",
                f"{stats['reached_final_boss_rate']:.0%}",
                f"{wr['act_1']['win_rate']:.1%}",
                f"{wr['act_2']['win_rate']:.1%}",
                f"{wr['act_3']['win_rate']:.1%}",
                f"{wr['act_4']['win_rate']:.1%}",
                stats["average_ending_act"],
                stats["lives_remaining"]["mean"],
                stats["credit_spend"]["p50"],
            ],
            pw,
        ))
    print()
    print(
        "clear = beat the FINAL boss (the only win condition); reachF = reached the\n"
        "final boss at all; * = control policy, not one of the five required."
    )
    print()

    print("-- OUTCOME DISTRIBUTION " + "-" * 64)
    ow = [15, 16, 24, 16]
    print(_row(["policy"] + list(OUTCOMES), ow))
    for policy, stats in result["policies"].items():
        dist = stats["outcome_distribution"]
        print(_row([policy] + [f"{dist[o]:.1%}" for o in OUTCOMES], ow))
    print()

    print("-- PERKS " + "-" * 79)
    kw = [20, 12, 12, 14, 22, 26]
    print(_row(
        ["system", "offered", "picked", "runs_held",
         "clear_rate_when_held", "unconfounded (greedy)"], kw))
    for sid, row in result["perks"].items():
        print(_row(
            [sid, row["offered"], row["picked"], row["runs_held"],
             f"{row['clear_rate_when_held']:.1%}",
             f"{row['unconfounded_clear_rate']:.2%}"],
            kw,
        ))
    print("per-policy clear rate when held (policy confound removed; "
          "n/a = that policy never picks it):")
    for sid, row in result["perks"].items():
        by = row["clear_rate_when_held_by_policy"]
        held = row["runs_held_by_policy"]
        print(f"  {sid:<18} " + "  ".join(
            f"{p.split('_')[0]}=" + ("n/a" if not held[p] else f"{by[p]:.1%}")
            for p in result["meta"]["policies"]
        ))
    print()

    print("-- ECONOMY " + "-" * 77)
    ew = [15, 12, 12, 12, 12, 12, 12]
    print(_row(
        ["policy", "spend_p10", "spend_p50", "spend_p90", "left_p50", "left_p90",
         "lives_p50"], ew))
    for policy, stats in result["policies"].items():
        print(_row(
            [policy, stats["credit_spend"]["p10"], stats["credit_spend"]["p50"],
             stats["credit_spend"]["p90"], stats["credits_left_over"]["p50"],
             stats["credits_left_over"]["p90"], stats["lives_remaining"]["p50"]],
            ew,
        ))
    print()

    print("-- CONTENT DISTRIBUTION " + "-" * 64)
    content = result["content_distribution"]
    print(f"distinct cards offered      : {content['distinct_cards_offered']} "
          f"of {meta['card_pool_size']}")
    print(f"unreachable cards           : {len(content['unreachable_cards'])}")
    print(f"node types                  : {content['node_types']}")
    print(f"era (anchor decade)         : {content['era_by_anchor_decade']}")
    print(f"lane outcomes by rule       : {result['lane_outcomes_by_rule']}")
    print()

    for warning in result["warnings"]:
        print(f"WARN  {warning}")
    if result["warnings"]:
        print()

    if failed:
        print("=" * 88)
        print("FAIL — hard invariants violated")
        print("=" * 88)
        for name, count in failed.items():
            print(f"  {name}: {count}")
            for example in result["hard_invariant_examples"].get(name, [])[:5]:
                print(f"      e.g. {example}")
        print()
        return False

    print("=" * 88)
    print(
        f"PASS — {len(hard)} hard invariants held across {meta['seeds']} seeds "
        f"({meta['runs_played']} runs, {meta['replays_checked']} replay checks). "
        f"{len(result['warnings'])} soft warning(s)."
    )
    print("=" * 88)
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit the RUN THE TABLE Standard v2 engine."
    )
    parser.add_argument("--seeds", type=int, default=100_000, help="run seeds to sample")
    parser.add_argument("--json", dest="json_out", type=Path, default=None,
                        help="write the full result dict to this path")
    parser.add_argument("--replay-sample", type=int, default=400,
                        help="how many runs to re-generate and replay for determinism")
    parser.add_argument("--workers", type=int, default=0,
                        help="worker processes (0 = cpu_count - 1)")
    parser.add_argument("--quiet", action="store_true", help="suppress progress lines")
    args = parser.parse_args(argv)

    if args.seeds < 1:
        print("FAIL — --seeds must be at least 1", file=sys.stderr)
        return 1

    workers = args.workers or max(1, (mp.cpu_count() or 2) - 1)

    try:
        result = run_audit(args.seeds, args.replay_sample, workers, quiet=args.quiet)
    except CardPoolUnavailable as exc:
        print("=" * 88)
        print("FAIL — card pool unavailable")
        print("=" * 88)
        print(f"  {exc}")
        return 1

    ok = print_report(result)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(result, indent=2, default=str))
        print(f"wrote {args.json_out}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
