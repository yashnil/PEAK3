"""
audit_run_the_table_v3.py
-------------------------
Statistical and invariant audit of the RUN THE TABLE **Standard v3** engine
(5 acts / 10 decision nodes / 5 bosses / 3 lives / 50 credits).

Adapted from `scripts/audit_run_the_table_v2.py`. Everything v2 measured is
still measured; what is new is the machinery for the two problems the v2 sweep
proved (docs/implementation/run-the-table-balance-v2.json, 100k seeds):

1. **Film Room was dead content.** Pick rate 0.0% for `lane_aware` — zero
   visits in 100,000 runs — and `greedy_overall` took `scout_offers` ZERO
   times against 69,455 `take_credits`. v3 replaces it with Scout & Prepare,
   so this harness adds a seventh policy, `film_aware`, whose whole job is to
   USE the node, and reports Scout & Prepare choice rates and the win
   contribution of a preparation.

2. **The economy was over-generous.** The do-nothing control finished holding
   a mean of 87.6 unspent credits against a 50-credit start. v3 cuts income and
   adds four published sinks, so this harness adds an eighth policy,
   `credit_spending`, which actually uses them, and reports the spec §4 economy
   audit: median credits remaining by policy, the share of runs spending 50 /
   75 / 90% of available credits, clear rate by spend band, the unused-credit
   distribution, and node pick rates.

Seven required policies (spec §4/§7) plus one control:
    random_legal, greedy_overall, lane_aware, economy_aware, look_ahead,
    film_aware, credit_spending          + passive (control)

Usage (from repo root):
    python scripts/audit_run_the_table_v3.py [--seeds N] [--json OUT] [--workers K]

Exit codes:
    0  every hard invariant held (soft WARNs may still be printed)
    1  a hard invariant was violated, or the audit could not run

Hard invariants (any violation fails the audit) — the eleven v2 checks:
    * every starting roster is role-legal, in ROLES order, inside the band
    * no roster ever contains the same player twice
    * every run reaches a terminal status
    * every Draft Room has an offer at or below DRAFT_GUARANTEED_AFFORDABLE_COST
    * no node ever has zero legal actions
    * a replayed action log reproduces a byte-identical receipt
    * credits never go negative
    * a run never continues past zero lives
    * the receipt's outcome is one of exactly three published strings, and
      `table_cleared` is true only when the final boss battle was a win
  ... plus five added for v3's new mechanics:
    * a market is never refreshed more than MARKET_REFRESHES_PER_NODE times
    * a credit sink never leaves a negative balance, and the sink ledger
      reconciles with the receipt
    * a reservation never survives past the Draft Room it was offered in
    * Emergency Recovery never exceeds EMERGENCY_RECOVERY_MAX_PER_RUN
    * a lane preparation is spent by exactly one battle and never leaks forward
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
    roster_total,
)
from nba_peak.run_the_table.bosses import (  # noqa: E402
    BOSS_SPECS,
    boss_lineup_rating,
    boss_slugs,
    boss_starter_mean,
    scout_report,
)
from nba_peak.run_the_table.cards import CardPool, CardPoolUnavailable, get_pool  # noqa: E402
from nba_peak.run_the_table.config import (  # noqa: E402
    ACTS,
    BENCH_SLOTS,
    BOSS_LANE_MARGIN,
    BOSS_RELATIVE_TARGET,
    BOSS_RULE_TARGET_OFFSET,
    BOSS_WIN_CREDITS,
    COMEBACK_CREDITS,
    CREDIT_SINKS,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    EMERGENCY_RECOVERY_COST,
    EMERGENCY_RECOVERY_MAX_PER_RUN,
    LANE_FIELDS,
    BOSS_ELITE_PERCENTILE,
    LANES_TO_WIN,
    MARQUEE_OFFERS_PER_ACT,
    MARQUEE_PERCENTILE_MIN,
    MARKET_REFRESH_COST,
    MARKET_REFRESHES_PER_NODE,
    MAX_LIVES,
    RESERVE_CARD_COST,
    REST_CREDITS,
    ROLE_FOCUS_COST,
    ROLES,
    SCOUT_PREP_LANE_BONUS,
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

#: The seven policies spec §4/§7 requires, plus one control.
POLICIES = (
    "random_legal",
    "greedy_overall",
    "lane_aware",
    "economy_aware",
    "look_ahead",
    "film_aware",
    "credit_spending",
    "passive",
)
CONTROL_POLICY = "passive"
REQUIRED_POLICIES = tuple(p for p in POLICIES if p != CONTROL_POLICY)

# Soft thresholds for the dominant-strategy warning. The win condition is
# "cleared the table" — the final boss beaten — not merely reaching act 5.
DOMINANT_CLEAR_MAX = 0.60
PASSIVE_CLEAR_MAX = 0.02
# A mode nobody can clear is as broken as one everybody clears.
BEST_POLICY_CLEAR_MIN = 0.10

# Spec §4: "a competent policy should usually finish with fewer than 20 credits
# unless intentionally pursuing a bank strategy." Measured as a MEDIAN, because
# a mean is dragged by the tail of runs that died in act 1 holding everything.
COMPETENT_LEFTOVER_MEDIAN_MAX = 20.0
# Policies held to that target. `economy_aware` is exempt by definition — it IS
# the bank strategy the sentence carves out — and `passive` is the control.
COMPETENT_POLICIES = ("greedy_overall", "lane_aware", "look_ahead", "film_aware",
                      "credit_spending")

# Spec §4 spend bands, as a fraction of the credits a run actually had access to
# (starting purse + every credit it earned).
SPEND_BANDS = ((0.0, 0.25), (0.25, 0.50), (0.50, 0.75), (0.75, 0.90), (0.90, 10.0))
SPEND_THRESHOLDS = (0.50, 0.75, 0.90)

MAX_STEPS = 140

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


def _roster_sensitivity(f) -> dict:
    """Per-act difficulty delta, split by how strong the run's roster was.

    The point of a roster-relative opponent is that it is fair to ANY roster,
    so the delta must be flat across strength buckets. If weak rosters saw a
    systematically larger delta than strong ones, the calibration would be
    working only at the median -- which is the absolute-target defect again.
    """
    out: dict = {}
    for act, pairs in sorted(f.rating_vs_delta.items()):
        if not pairs:
            continue
        ordered = sorted(pairs)
        third = max(1, len(ordered) // 3)
        buckets = {
            "weak_third": ordered[:third],
            "middle_third": ordered[third: 2 * third],
            "strong_third": ordered[2 * third:],
        }
        out[f"act_{act}"] = {
            name: {
                "n": len(rows),
                "player_rating_mean": round(
                    sum(r for r, _ in rows) / len(rows), 4
                ) if rows else None,
                "delta_mean": round(sum(d for _, d in rows) / len(rows), 4)
                if rows else None,
            }
            for name, rows in buckets.items()
        }
    return out


def _dist(values) -> dict:
    """Mean and percentiles of a measured distribution.

    The v4 calibration is a statement about DISTRIBUTIONS (act bands must
    overlap; no act may be near-automatic or effectively unwinnable), so a
    single mean per act would not be able to express it.
    """
    vals = sorted(values)
    if not vals:
        return {"n": 0}

    def pct(p: float) -> float:
        if len(vals) == 1:
            return round(vals[0], 4)
        idx = min(len(vals) - 1, max(0, int(round(p * (len(vals) - 1)))))
        return round(vals[idx], 4)

    return {
        "n": len(vals),
        "mean": round(sum(vals) / len(vals), 4),
        "min": round(vals[0], 4),
        "p10": pct(0.10),
        "p25": pct(0.25),
        "median": pct(0.50),
        "p75": pct(0.75),
        "p90": pct(0.90),
        "max": round(vals[-1], 4),
    }


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
        "bad_outcomes", "sink_violations", "refresh_violations",
        "reservation_violations", "recovery_violations", "prep_violations",
        # v4
        "player_boss_collisions", "board_owned_offers", "self_trades",
        "boss_boss_collisions",
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
        # v3
        "sink_uses", "sink_credits", "refreshes_bought", "reservations_made",
        "reservations_bought", "reservations_expired", "role_focus_bought",
        "role_focus_repaired_board", "recoveries_bought", "preps_bought",
        "preps_spent", "preps_flipped_a_lane", "preps_flipped_a_battle",
        "spend_band_runs", "spend_band_cleared", "spend_over_threshold",
        "battles_at_raised_lane_bar",
        # v4
        "marquee_offers_seen", "marquee_bought", "elite_bought",
        "acts_with_a_marquee_offer",
    )
    NESTED_COUNTER_FIELDS = (
        "node_visits", "system_selection_counts", "system_available_counts",
        "boss_outcomes",
    )
    LIST_ACCUM_FIELDS = (
        "spend", "leftover", "lives_left", "ending_act",
        "available_credits", "spend_fraction", "sink_spend",
        # v4 -- keyed by ACT, so the calibration can report the realised
        # difficulty distribution per act rather than a single mean.
        "boss_delta", "player_rating", "boss_rating", "boss_starter_means",
        "boss_elite_counts", "boss_decades", "rating_vs_delta",
    )

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
    # v4: bosses live on the RUN, not the blueprint -- each is generated
    # against the roster it will face when its act begins.
    return S.boss_for_act(st, bp, st.act)


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
    # Spec §3: the opening reveal is server-side progress. Driving it here keeps
    # the reveal action inside the replay proof rather than outside it.
    S.action_reveal(st, bp, "roster", len(st.starters) + len(st.bench))
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
            S.action_choose_node(st, bp, choice.node_id, pool)
            f.node_visits[policy][choice.node_type] += 1

        elif st.status == "node_active":
            plan, opt = S.node_option(bp, st.active_node_id)
            _resolve_node(st, bp, plan, opt, pool, policy, rng, f, v)

        elif st.status == "boss_ready":
            lives_before = st.lives
            # v4 HARD INVARIANT + CALIBRATION MEASUREMENT, taken at the moment
            # the two rosters actually face each other. This is the check the
            # v3 harness did not have: its `duplicate_identities` counter
            # compared the player's roster against ITSELF, which is why 88.5% of
            # runs could start with a boss's own card on the roster and the
            # audit reported zero violations over 800,000 runs.
            _audit_matchup_identities(pool, st, bp, policy, f, v)
            S.action_reveal(st, bp, "boss", len(ROLES) + BENCH_SLOTS)
            prep_before = dict(st.pending_prep) if st.pending_prep else None
            S.action_resolve_boss(st, bp, pool)
            battle = st.battles[-1]
            _audit_preparation(pool, st, bp, battle, prep_before, policy, f, v)
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
            S.action_advance(st, bp, pool)

        if st.credits < 0:
            v["negative_credit_states"] += 1
            f.negative_credit_runs.append((bp.seed, policy, st.credits))
        _audit_v3_mechanics(st, bp, policy, f, v)

    return st


# ---------------------------------------------------------------------------
# v3 mechanic invariants
# ---------------------------------------------------------------------------
def _audit_v3_mechanics(st, bp, policy, f: Findings, v: Violations) -> None:
    """The four new hard invariants, checked after every step."""
    for node_id, count in st.node_refreshes.items():
        if count > MARKET_REFRESHES_PER_NODE:
            v["market_refreshed_over_cap"] += 1
            f.refresh_violations.append((st.seed, policy, node_id, count))
    if st.emergency_recoveries_used > EMERGENCY_RECOVERY_MAX_PER_RUN:
        v["emergency_recovery_over_cap"] += 1
        f.recovery_violations.append((st.seed, policy, st.emergency_recoveries_used))
    for row in st.sink_spend:
        if row["cost"] < 0 or row["sink_id"] not in CREDIT_SINKS:
            v["sink_charged_an_unpublished_price"] += 1
            f.sink_violations.append((st.seed, policy, row))
        elif row["cost"] != CREDIT_SINKS[row["sink_id"]]["cost"]:
            v["sink_charged_an_unpublished_price"] += 1
            f.sink_violations.append((st.seed, policy, row))
    reserved = st.reserved_card
    if reserved and reserved["status"] == "offered":
        # A live-on-the-board reservation is only legal while that node is the
        # one actually open. Anything else means it outlived its Draft Room.
        if st.active_node_id != reserved["offered_node_id"]:
            v["reservation_outlived_its_node"] += 1
            f.reservation_violations.append(
                (st.seed, policy, reserved["offered_node_id"], st.active_node_id)
            )


def _audit_preparation(pool, st, bp, battle, prep_before, policy, f: Findings, v: Violations):
    """A preparation must be spent by exactly one battle and never leak forward."""
    if prep_before is None:
        if battle.lane_bonuses:
            v["preparation_applied_without_being_bought"] += 1
            f.prep_violations.append((st.seed, policy, battle.act, "unbought bonus"))
        return
    if prep_before.get("act") != battle.act:
        return
    if battle.lane_bonuses != {prep_before["lane"]: prep_before["bonus"]}:
        v["preparation_not_applied_to_the_battle_it_was_bought_for"] += 1
        f.prep_violations.append((st.seed, policy, battle.act, battle.lane_bonuses))
        return
    if st.pending_prep is not None:
        v["preparation_leaked_past_its_battle"] += 1
        f.prep_violations.append((st.seed, policy, battle.act, "not cleared"))
        return

    f.preps_spent[policy] += 1
    lane_row = next(l for l in battle.lanes if l.lane == prep_before["lane"])
    if lane_row.winner == "player" and lane_row.margin - prep_before["bonus"] <= 0:
        f.preps_flipped_a_lane[policy] += 1
    # Did the preparation change the OUTCOME? Re-resolve without it.
    starters = [s.card_id for s in st.starters if s.card_id]
    bench = [s.card_id for s in st.bench if s.card_id]
    boss = S.boss_for_act(st, bp, battle.act)
    without = resolve_battle(
        pool, starters, bench, boss, st.systems,
        lives_before=battle.lives_after + (1 if battle.outcome == "loss" else 0),
        comeback_credits=COMEBACK_CREDITS, win_credits=BOSS_WIN_CREDITS,
    )
    if without.outcome != battle.outcome:
        f.preps_flipped_a_battle[policy] += 1


def _audit_matchup_identities(pool, st, bp, policy, f: Findings, v: Violations) -> None:
    """No identity may stand on both sides of a fight. Measured at the fight.

    Also records the realised roster-relative difficulty, which is the quantity
    v4 calibrates on: `boss_lineup_rating - player_lineup_rating`, both scored
    exactly the way `resolve_battle` will score them.
    """
    boss = S.boss_for_act(st, bp, st.act)
    if boss is None:
        return
    starters = [s.card_id for s in st.starters if s.card_id]
    bench = [s.card_id for s in st.bench if s.card_id]
    owned = {pool.get(cid).player_slug for cid in starters + bench}
    theirs = boss_slugs(pool, boss)

    clash = owned & theirs
    if clash:
        v["player_and_boss_share_an_identity"] += 1
        f.player_boss_collisions.append((bp.seed, policy, st.act, sorted(clash)))

    # No two UNBEATEN bosses may share an identity either.
    resolved = {b.act for b in st.battles}
    for act, payload in st.boss_lineups.items():
        if act == st.act or act in resolved:
            continue
        other = boss_slugs(pool, S.boss_from_dict(payload))
        if theirs & other:
            v["two_bosses_share_an_identity"] += 1
            f.boss_boss_collisions.append(
                (bp.seed, policy, st.act, act, sorted(theirs & other))
            )

    player_rating = roster_total(
        player_lane_profile(pool, starters, bench, st.systems, boss.rule_id)
    )
    boss_rating = boss_lineup_rating(pool, boss, st.systems)
    f.boss_delta[st.act].append(round(boss_rating - player_rating, 4))
    f.rating_vs_delta[st.act].append(
        (player_rating, round(boss_rating - player_rating, 4))
    )
    f.player_rating[st.act].append(player_rating)
    f.boss_rating[st.act].append(boss_rating)
    f.boss_starter_means[st.act].append(round(boss_starter_mean(pool, boss), 3))
    f.boss_elite_counts[st.act].append(
        sum(
            1 for cid in list(boss.starter_ids) + list(boss.bench_ids)
            if pool.get(cid).overall_percentile >= BOSS_ELITE_PERCENTILE
        )
    )
    f.boss_decades[st.act].append(
        len({pool.get(cid).anchor_season[:3] for cid in
             list(boss.starter_ids) + list(boss.bench_ids)})
    )


def _count_rule_effect(pool, st, bp, battle, f: Findings) -> None:
    boss = S.boss_for_act(st, bp, battle.act)
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
    if policy in ("economy_aware", "credit_spending"):
        preferred = [s for s in options if s in _ECONOMY_SYSTEMS]
        return preferred[0] if preferred else options[0]
    if policy in ("lane_aware", "look_ahead", "film_aware"):
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
    if policy == "film_aware":
        # The policy whose job is to USE Scout & Prepare. It takes the node
        # whenever the preparation could flip a lane in the fight ahead, and
        # otherwise plays like `lane_aware` — so its pick rate is a measurement
        # of whether the node is worth taking, not an instruction to take it.
        boss = _boss_for(bp, st)
        options.sort(
            key=lambda o: (_film_node_value(st, bp, pool, o, boss), o.node_id)
        )
        return options[0]
    if policy == "credit_spending":
        # Deliberately sink-hungry: markets first (they are where a refresh
        # buys something), then Scout & Prepare (two of the four sinks live
        # there), then Rest / Bank.
        order = ["draft_room", "film_room", "trade_desk", "rest_bank"]
        if st.lives < MAX_LIVES:
            order = ["rest_bank"] + [t for t in order if t != "rest_bank"]
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
    # `lane_aware` deliberately still ranks Scout & Prepare LAST, exactly as it
    # did in v2. Changing this policy would make its v2 and v3 numbers
    # incomparable, and the v2 finding to be re-tested is precisely "the
    # myopic lane-maximiser never takes this node". `film_aware` and
    # `look_ahead` are the policies that evaluate it.
    return 2


def _prep_would_flip(st, bp, pool, boss) -> bool:
    """Would the capped preparation actually flip a lane against this boss?"""
    if boss is None:
        return False
    starters, bench = _roster_ids(st)
    report = scout_report(pool, boss, starters, bench, st.systems)
    return any(row["would_flip"] for row in report["preparations"])


def _best_prep_lane(st, bp, pool, boss):
    """The lane a preparation is worth spending on, or None if none is."""
    if boss is None:
        return None
    starters, bench = _roster_ids(st)
    report = scout_report(pool, boss, starters, bench, st.systems)
    flips = [row for row in report["preparations"] if row["would_flip"]]
    if flips:
        # The cheapest flip: the lane already closest to being taken.
        return max(flips, key=lambda row: (row["margin_before"], row["lane"]))["lane"]
    # Nothing flips: put it where it does the most for the summed-margin
    # tie-break, which is the lane the run is closest to contesting.
    losing = [row for row in report["preparations"] if row["margin_before"] <= 0]
    pool_of_lanes = losing or report["preparations"]
    return max(pool_of_lanes, key=lambda row: (row["margin_before"], row["lane"]))["lane"]


def _film_node_value(st, bp, pool, opt, boss) -> int:
    """Sort key (lower is better) for `film_aware`."""
    if opt.node_type == "film_room" and _prep_would_flip(st, bp, pool, boss):
        return 0
    if st.lives < MAX_LIVES and opt.node_type == "rest_bank":
        return 1
    if opt.node_type == "draft_room":
        return 2
    if opt.node_type == "trade_desk":
        return 3
    if opt.node_type == "film_room":
        return 4
    return 5


def _branch_projection(st, bp, pool, plan, opt, boss) -> float:
    """How good this branch could leave the roster, in lanes then margin."""
    if boss is None:
        return 0.0
    starters, bench = _roster_ids(st)
    base_lanes, base_margin = _lane_projection(pool, starters, bench, st.systems, boss)
    best = (base_lanes, base_margin)
    payload = plan.payloads[opt.node_id]
    if opt.node_type == "film_room":
        # v3: the branch's value is the preparation it can buy. A free +2.5 on
        # one lane is worth a lane whenever it flips one, and worth its margin
        # otherwise — which is exactly the calculation the player is shown.
        if _prep_would_flip(st, bp, pool, boss):
            return (base_lanes + 1) * 1000.0 + base_margin + SCOUT_PREP_LANE_BONUS
        return base_lanes * 1000.0 + base_margin + SCOUT_PREP_LANE_BONUS
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


def _maybe_refresh(st, bp, pool, policy, opt, f: Findings) -> None:
    """`credit_spending` buys the one published refresh when the board is poor.

    "Poor" is measured, not assumed: no legal move that improves the roster.
    That makes the refresh a real decision the harness can price rather than a
    reflex that inflates the sink's usage numbers.
    """
    if policy != "credit_spending":
        return
    if st.node_refreshes.get(opt.node_id, 0) >= MARKET_REFRESHES_PER_NODE:
        return
    if st.credits < MARKET_REFRESH_COST + 4:
        return
    boss = _boss_for(bp, st)
    starters, bench = _roster_ids(st)
    base = _lane_projection(pool, starters, bench, st.systems, boss) if boss else (0, 0.0)
    for cid in S.node_offers(st, bp, opt.node_id, pool):
        card = pool.get(cid)
        for slot in S.legal_slots_for(st, pool, cid):
            if opt.node_type == "draft_room":
                free = S.veteran_minimum_available(
                    card, st.systems, st.veteran_minimum_used_in_act[st.act]
                )
                cost = 0 if free else price_for(card, st.systems)[0]
            else:
                current = S._slot(st, slot).card_id
                if not current:
                    continue
                cost = trade_net_cost(pool.get(current), card, st.systems)["net_cost"]
            if cost > st.credits - MARKET_REFRESH_COST:
                continue
            if boss is not None and _score_candidate(pool, st, boss, slot, cid) > base:
                return  # the board already has something worth buying
    S.action_market_refresh(st, bp, pool)
    f.refreshes_bought[policy] += 1
    f.sink_uses["market_refresh"] += 1
    f.sink_credits["market_refresh"] += MARKET_REFRESH_COST


def _resolve_node(st, bp, plan, opt, pool, policy, rng, f: Findings, v: Violations) -> None:
    node_type = opt.node_type
    key = (policy, node_type)
    boss = _boss_for(bp, st)

    if node_type in ("draft_room", "trade_desk"):
        _maybe_refresh(st, bp, pool, policy, opt, f)

    if node_type == "draft_room":
        offers = S.node_offers(st, bp, opt.node_id, pool)
        affordable = []
        placeable = []
        best_overall = None
        best_lane = None
        best_value = None
        starters, bench = _roster_ids(st)
        base = _lane_projection(pool, starters, bench, st.systems, boss) if boss else (0, 0.0)

        reservation = S.active_reservation(st, opt.node_id)
        for cid in offers:
            card = pool.get(cid)
            if reservation and reservation["card_id"] == cid:
                cost = reservation["locked_cost"]
            else:
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
            # Only pay for value; hoard otherwise so late-act boards are reachable.
            choice = best_value if best_value and best_value[0] >= 0.35 else None
        else:  # lane_aware / look_ahead / film_aware / credit_spending
            choice = best_lane or best_overall

        # v4 ACQUISITION-CEILING MEASUREMENT. The v3 problem was never offer
        # supply, it was budget: 28 cards at >=80 prime all cost 23-30 against a
        # 50-credit start, and the most aggressive spender had the second-worst
        # clear rate in the whole sweep. So both halves are measured -- how often
        # a top-decile card is SEEN, and how often one is actually BOUGHT.
        seen_marquee = [
            cid for cid in offers
            if pool.get(cid).overall_percentile >= MARQUEE_PERCENTILE_MIN
        ]
        if seen_marquee:
            f.marquee_offers_seen[policy] += 1
            f.acts_with_a_marquee_offer[(policy, st.act)] += 1

        if choice:
            S.action_draft_buy(st, bp, choice[1], choice[2], pool, choice[3])
            f.purchases[policy] += 1
            bought = pool.get(choice[1])
            if bought.overall_percentile >= MARQUEE_PERCENTILE_MIN:
                f.marquee_bought[policy] += 1
            if bought.overall_percentile >= BOSS_ELITE_PERCENTILE:
                f.elite_bought[policy] += 1
        else:
            S.action_draft_pass(st, bp, pool)
            f.declines[key] += 1

    elif node_type == "trade_desk":
        incoming = S.node_offers(st, bp, opt.node_id, pool)
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
        elif policy in ("lane_aware", "look_ahead", "film_aware", "credit_spending"):
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
            S.action_decline_trade(st, bp, pool)
            f.declines[key] += 1

    elif node_type == "film_room":
        _resolve_scout_and_prepare(st, bp, plan, opt, pool, policy, rng, boss, f)

    else:  # rest_bank
        if st.lives >= MAX_LIVES:
            f.noop_choice_nodes[(policy, "rest_recover_at_full_lives")] += 1
        # Emergency Recovery is additive to the node's own choice, so it is
        # taken BEFORE it, while the node is still open.
        # Bought only on the last life: at 20 credits it is a survival purchase,
        # not a comfort one, and a probe policy that bought it at two lives
        # would be measuring its own indiscipline rather than the sink.
        if (
            policy in ("credit_spending", "film_aware")
            and st.lives <= 1
            and st.emergency_recoveries_used < EMERGENCY_RECOVERY_MAX_PER_RUN
            and st.credits >= EMERGENCY_RECOVERY_COST
        ):
            S.action_emergency_recovery(st, bp)
            f.recoveries_bought[policy] += 1
            f.sink_uses["emergency_recovery"] += 1
            f.sink_credits["emergency_recovery"] += EMERGENCY_RECOVERY_COST
        if policy == "random_legal":
            choice = rng.choice(list(S.REST_CHOICES))
        else:
            choice = "recover_life" if st.lives < MAX_LIVES else "take_credits"
        S.action_rest_bank(st, bp, choice, pool)
        f.node_choices[(policy, "rest_bank", choice)] += 1


def _resolve_scout_and_prepare(st, bp, plan, opt, pool, policy, rng, boss, f: Findings) -> None:
    """Play one Scout & Prepare node under `policy`.

    Every branch is legal for a broke player because `scout_boss` is free — the
    same "there is always a move" property `draft_pass` gives a Draft Room.
    """
    candidates = plan.payloads[opt.node_id]["reserve_candidate_ids"]

    def _reservable():
        """The candidate worth reserving: the best LANE upgrade we could afford.

        Scored the way a Draft Room purchase is scored, not by prime_score —
        reserving the biggest name and then declining it at the Draft Room
        because it does not improve a lane is how a reservation becomes 5
        credits of pure loss, and the audit needs to price the sink under
        competent use rather than under that mistake.
        """
        if st.reserved_card is not None and st.reserved_card["status"] in ("live", "offered"):
            return None
        if st.credits < S.RESERVE_CARD_COST:
            return None
        if boss is None:
            return None
        starters, bench = _roster_ids(st)
        base = _lane_projection(pool, starters, bench, st.systems, boss)
        best = None
        for cid in candidates:
            cost = price_for(pool.get(cid), st.systems)[0]
            if cost + S.RESERVE_CARD_COST > st.credits:
                continue
            for slot in S.legal_slots_for(st, pool, cid):
                projected = _score_candidate(pool, st, boss, slot, cid)
                if projected > base and (best is None or projected > best[0]):
                    best = (projected, cid)
        return best[1] if best else None

    choice = "scout_boss"
    kwargs: dict = {}

    if policy == "random_legal":
        options = ["scout_boss"]
        if st.credits >= S.ROLE_FOCUS_COST and st.role_focus is None:
            options.append("shape_market")
        if _reservable():
            options.append("reserve_card")
        choice = rng.choice(options)
        if choice == "scout_boss":
            kwargs["lane"] = rng.choice(list(LANE_FIELDS))
        elif choice == "shape_market":
            kwargs["role"] = rng.choice(list(ROLES))
        else:
            kwargs["card_id"] = _reservable()
    elif policy == "credit_spending":
        target = _reservable()
        if target is not None:
            choice, kwargs = "reserve_card", {"card_id": target}
        elif st.role_focus is None and st.credits >= S.ROLE_FOCUS_COST + 8:
            weakest = min(
                ROLES,
                key=lambda r: pool.get(S._slot(st, r).card_id).prime_score,
            )
            choice, kwargs = "shape_market", {"role": weakest}
        else:
            kwargs["lane"] = _best_prep_lane(st, bp, pool, boss) or LANE_FIELDS[0]
    else:
        # passive / greedy / lane_aware / look_ahead / economy_aware / film_aware
        # all take the free preparation; they differ in WHICH lane, which is the
        # measurement that matters.
        if policy == "passive":
            kwargs["lane"] = LANE_FIELDS[0]
        else:
            kwargs["lane"] = _best_prep_lane(st, bp, pool, boss) or LANE_FIELDS[0]

    S.action_film_room(st, bp, choice, pool=pool, **kwargs)
    f.node_choices[(policy, "film_room", choice)] += 1
    if choice == "scout_boss":
        f.preps_bought[policy] += 1
    elif choice == "shape_market":
        f.role_focus_bought[policy] += 1
        f.sink_uses["role_focus"] += 1
        f.sink_credits["role_focus"] += S.ROLE_FOCUS_COST
    else:
        f.reservations_made[policy] += 1
        f.sink_uses["reserve_card"] += 1
        f.sink_credits["reserve_card"] += S.RESERVE_CARD_COST


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
            rng = random.Random(f"rtt-audit-v3:{seed}:{policy}")
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

            spent = receipt["credits_spent"]
            f.spend[policy].append(spent)
            f.leftover[policy].append(st.credits)
            f.lives_left[policy].append(st.lives)
            f.sink_spend[policy].append(receipt["credits_spent_on_sinks"])

            # HARD: the ledger must balance. `available` is every credit the run
            # ever had — the starting purse plus everything it earned — and it
            # must equal what was spent plus what is left.
            earned = sum(b.credits_awarded for b in st.battles) + sum(
                REST_CREDITS for a in st.action_log
                if a.action_type == "rest_bank" and a.payload["choice"] == "take_credits"
            )
            refunds = sum(t["outgoing_refund"] for t in st.trades)
            available = STARTING_CREDITS + earned
            gross_spend = sum(a["cost"] for a in st.acquisitions) + sum(
                t["incoming_cost"] for t in st.trades
            ) + receipt["credits_spent_on_sinks"]
            if STARTING_CREDITS + earned + refunds - gross_spend != st.credits:
                v["credit_ledger_does_not_balance"] += 1
                f.sink_violations.append((seed, policy, "ledger", st.credits))

            f.available_credits[policy].append(available)
            fraction = spent / available if available else 0.0
            f.spend_fraction[policy].append(round(fraction, 4))
            for threshold in SPEND_THRESHOLDS:
                if fraction >= threshold:
                    f.spend_over_threshold[(policy, threshold)] += 1
            for lo, hi in SPEND_BANDS:
                if lo <= fraction < hi:
                    f.spend_band_runs[(policy, lo)] += 1
                    if receipt["table_cleared"]:
                        f.spend_band_cleared[(policy, lo)] += 1
                    break

            # Counted from the ledgers, not from `st.reserved_card` — that field
            # holds only the LAST reservation, so reading it undercounts every
            # run that reserved more than once.
            bought = sum(1 for a in st.acquisitions if a.get("reserved"))
            made = sum(1 for row in st.sink_spend if row["sink_id"] == "reserve_card")
            f.reservations_bought[policy] += bought
            f.reservations_expired[policy] += made - bought
            for battle in st.battles:
                if battle.lanes_to_win != LANES_TO_WIN:
                    f.battles_at_raised_lane_bar[battle.boss_id] += 1

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
        seeds, findings, violations, pool, replays_checked,
        time.time() - started,
    )


def _summarise(seeds, f: Findings, v: Violations, pool, replays_checked, elapsed) -> dict:
    total_runs = sum(f.runs_played.values())
    offered_cards = set(f.card_offer_counts)
    unreachable = sorted(
        c.peak_window_id for c in pool.cards if c.peak_window_id not in offered_cards
    )
    boss_ids = {spec["boss_id"] for spec in BOSS_SPECS}
    unreachable_bosses = sorted(boss_ids - set(f.bosses_faced))

    era = Counter()
    role = Counter()
    for card_id, count in f.card_offer_counts.items():
        card = pool.get(card_id)
        era[decade(card.anchor_season)] += count
        for r in card.eligible_roles:
            role[r] += count

    total_nodes = {
        policy: sum(f.node_visits[policy].values()) for policy in POLICIES
    }

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
            # -- spec §4 economy audit -------------------------------------
            "node_pick_rate": {
                node_type: rate(f.node_visits[policy][node_type], total_nodes[policy])
                for node_type in ("draft_room", "trade_desk", "film_room", "rest_bank")
            },
            "credits_remaining_median": percentile(f.leftover[policy], 0.50),
            "unused_credit_distribution": {
                "p10": percentile(f.leftover[policy], 0.10),
                "p25": percentile(f.leftover[policy], 0.25),
                "p50": percentile(f.leftover[policy], 0.50),
                "p75": percentile(f.leftover[policy], 0.75),
                "p90": percentile(f.leftover[policy], 0.90),
                "mean": mean(f.leftover[policy]),
                "share_under_20": rate(
                    sum(1 for x in f.leftover[policy] if x < 20), played
                ),
            },
            "available_credits": {
                "mean": mean(f.available_credits[policy]),
                "p50": percentile(f.available_credits[policy], 0.50),
            },
            "spend_fraction": {
                "mean": mean(f.spend_fraction[policy]),
                "p50": percentile(f.spend_fraction[policy], 0.50),
            },
            "share_spending_at_least": {
                f"{int(t * 100)}pct": rate(
                    f.spend_over_threshold[(policy, t)], played
                )
                for t in SPEND_THRESHOLDS
            },
            "clear_rate_by_spend_band": {
                f"{int(lo * 100)}-{'100+' if hi > 1 else int(hi * 100)}pct": {
                    "runs": f.spend_band_runs[(policy, lo)],
                    "clear_rate": rate(
                        f.spend_band_cleared[(policy, lo)], f.spend_band_runs[(policy, lo)]
                    ),
                }
                for lo, hi in SPEND_BANDS
            },
            "credit_sinks": {
                "spent_on_sinks_mean": mean(f.sink_spend[policy]),
                "market_refreshes": f.refreshes_bought[policy],
                "reservations_made": f.reservations_made[policy],
                "reservations_bought": f.reservations_bought[policy],
                "reservations_expired": f.reservations_expired[policy],
                "role_focus_bought": f.role_focus_bought[policy],
                "emergency_recoveries": f.recoveries_bought[policy],
            },
            "scout_and_prepare": {
                "visits": f.node_visits[policy]["film_room"],
                "pick_rate": rate(
                    f.node_visits[policy]["film_room"], total_nodes[policy]
                ),
                "preparations_bought": f.preps_bought[policy],
                "preparations_spent": f.preps_spent[policy],
                "preparations_that_flipped_a_lane": f.preps_flipped_a_lane[policy],
                "preparations_that_flipped_a_battle": f.preps_flipped_a_battle[policy],
                "battle_flip_rate": rate(
                    f.preps_flipped_a_battle[policy], f.preps_spent[policy]
                ),
            },
        }

    hard_names = (
        # The eleven v2 invariants.
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
        # v3 mechanics.
        "market_refreshed_over_cap",
        "sink_charged_an_unpublished_price",
        "credit_ledger_does_not_balance",
        "reservation_outlived_its_node",
        "emergency_recovery_over_cap",
        "preparation_applied_without_being_bought",
        "preparation_not_applied_to_the_battle_it_was_bought_for",
        "preparation_leaked_past_its_battle",
        # v4 IDENTITY INTEGRITY. These are the two the v3 harness did not have,
        # and their absence is why the reported defect survived 800,000 audited
        # runs with `duplicate_identities` sitting at zero the whole time: that
        # counter compares the player's roster against ITSELF, so it is blind to
        # the same player standing on both sides of a fight. `_audit_matchup_
        # identities` measures the matchup, at the matchup.
        "player_and_boss_share_an_identity",
        "two_bosses_share_an_identity",
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
    # Spec §4's economy target, measured rather than asserted.
    for policy in COMPETENT_POLICIES:
        median_left = per_policy[policy]["credits_remaining_median"]
        if median_left >= COMPETENT_LEFTOVER_MEDIAN_MAX:
            warnings.append(
                f"over-generous economy: '{policy}' finishes holding a median of "
                f"{median_left} credits (target < {COMPETENT_LEFTOVER_MEDIAN_MAX:.0f})"
            )
    # The v2 failure this whole rewrite exists to fix, restated as two
    # measurements rather than one. A node is dead content if nobody takes it,
    # AND it is dead content if taking it cannot change anything — v2's Film
    # Room failed both. A single policy ignoring it is a legitimate finding
    # about that policy, not a defect, so the check is pooled.
    pooled_film_visits = sum(
        f.node_visits[p]["film_room"] for p in REQUIRED_POLICIES
    )
    pooled_nodes = sum(total_nodes[p] for p in REQUIRED_POLICIES)
    pooled_pick = rate(pooled_film_visits, pooled_nodes)
    if pooled_pick <= 0.02:
        warnings.append(
            f"dead content: competent policies took Scout & Prepare {pooled_pick:.1%} "
            f"of the time (v2's Film Room was 0.0% for lane_aware)"
        )
    flipped = sum(f.preps_flipped_a_battle[p] for p in REQUIRED_POLICIES)
    spent_preps = sum(f.preps_spent[p] for p in REQUIRED_POLICIES)
    if spent_preps and rate(flipped, spent_preps) <= 0.01:
        warnings.append(
            f"inert preparation: only {flipped} of {spent_preps} preparations changed "
            f"a battle outcome"
        )
    for sink_id in CREDIT_SINKS:
        if not f.sink_uses[sink_id]:
            warnings.append(f"credit sink never used by any policy: {sink_id}")

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
                "rest_credits": REST_CREDITS,
                "scout_prep_lane_bonus": SCOUT_PREP_LANE_BONUS,
            },
            "credit_sinks": {
                sink_id: {
                    "cost": spec["cost"],
                    "offered_at": list(spec["offered_at"]),
                    "limit": spec["limit"],
                    "times_used": f.sink_uses[sink_id],
                    "credits_absorbed": f.sink_credits[sink_id],
                }
                for sink_id, spec in CREDIT_SINKS.items()
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
            "market_refreshed_over_cap": f.refresh_violations[:5],
            "sink_charged_an_unpublished_price": f.sink_violations[:5],
            "credit_ledger_does_not_balance": f.sink_violations[:5],
            "reservation_outlived_its_node": f.reservation_violations[:5],
            "emergency_recovery_over_cap": f.recovery_violations[:5],
            "preparation_applied_without_being_bought": f.prep_violations[:5],
            "preparation_not_applied_to_the_battle_it_was_bought_for":
                f.prep_violations[:5],
            "preparation_leaked_past_its_battle": f.prep_violations[:5],
            "player_and_boss_share_an_identity": f.player_boss_collisions[:5],
            "two_bosses_share_an_identity": f.boss_boss_collisions[:5],
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
        # v4: a boss is generated per run, so there is no single lineup to
        # describe. What is fixed is the SPEC (id, act, rule) and the published
        # difficulty target; what is measured is the realised distribution of
        # the roster-relative delta each boss actually landed at.
        "bosses": [
            {
                "boss_id": spec["boss_id"],
                "act": spec["act"],
                "rule_id": spec["rule_id"],
                "is_final": spec["act"] >= ACTS,
                "source": "generated",
                "relative_target": BOSS_RELATIVE_TARGET[i],
                "rule_target_offset": BOSS_RULE_TARGET_OFFSET.get(spec["rule_id"], 0.0),
                "realised_delta": _dist(f.boss_delta[spec["act"]]),
                "player_lineup_rating": _dist(f.player_rating[spec["act"]]),
                "boss_lineup_rating": _dist(f.boss_rating[spec["act"]]),
                "boss_starter_mean": _dist(f.boss_starter_means[spec["act"]]),
                "lane_margin": BOSS_LANE_MARGIN.get(spec["rule_id"], 0.0),
                "times_faced": f.bosses_faced[spec["boss_id"]],
                "lanes_drawn_by_rule": f.lane_drawn_by_rule[spec["rule_id"] or "none"],
                # Share of this boss's battles whose OUTCOME the published rule
                # actually changed, measured by re-resolving with the rule off.
                "rule_decisive_rate": rate(
                    f.rule_decisive[spec["rule_id"] or ""],
                    f.rule_battles[spec["rule_id"] or ""],
                ),
                "rule_decisive_battles": f.rule_decisive[spec["rule_id"] or ""],
            }
            for i, spec in enumerate(BOSS_SPECS)
        ],
        # v4: the acquisition ceiling, measured on both halves. `seen` is how
        # many Draft Rooms carried a top-decile card (the marquee guarantee puts
        # one in every act); `bought` is how many were actually taken. A large
        # gap between them is the intended shape: the opportunity is guaranteed,
        # the credits are not.
        "acquisition_ceiling": {
            "marquee_percentile_min": MARQUEE_PERCENTILE_MIN,
            "marquee_offers_per_act": MARQUEE_OFFERS_PER_ACT,
            "by_policy": {
                policy: {
                    "draft_rooms_showing_a_marquee": f.marquee_offers_seen[policy],
                    "marquee_cards_bought": f.marquee_bought[policy],
                    "top_decile_cards_bought": f.elite_bought[policy],
                    "purchases": f.purchases[policy],
                    "marquee_share_of_purchases": rate(
                        f.marquee_bought[policy], f.purchases[policy]
                    ),
                }
                for policy in sorted(f.runs_played)
            },
            "acts_with_a_marquee_offer": {
                f"{policy}:act_{act}": n
                for (policy, act), n in sorted(f.acts_with_a_marquee_offer.items())
            },
        },
        # v4: does the calibration hold for a WEAK roster as well as a STRONG
        # one? Rosters are bucketed by their own opening lineup rating, and the
        # per-act delta is reported per bucket. A roster-relative design that
        # only worked at the median would be the old absolute-target defect
        # wearing a different hat.
        "roster_strength_sensitivity": _roster_sensitivity(f),
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
    print("RUN THE TABLE — STANDARD v3 ENGINE AUDIT")
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
    # v4: a boss has no single starter mean any more -- it is generated per
    # run -- so the table reports the DISTRIBUTION of the roster-relative delta
    # it actually landed at, against the target it was aiming for.
    print(_row(
        ["boss", "act", "rule", "final", "target", "delta_p10", "delta_med",
         "delta_p90", "faced", "rule_decisive"], bw))
    for boss in result["bosses"]:
        d = boss["realised_delta"]
        target = boss["relative_target"] + boss["rule_target_offset"]
        print(_row(
            [boss["boss_id"], boss["act"], boss["rule_id"],
             "yes" if boss["is_final"] else "", f"{target:+.2f}",
             f"{d.get('p10', 0):+.2f}", f"{d.get('median', 0):+.2f}",
             f"{d.get('p90', 0):+.2f}", boss["times_faced"],
             f"{boss['rule_decisive_rate']:.1%}"],
            bw,
        ))
    print(f"battles decided by          : {result['battle_decided_by']}")
    print()

    acts = meta["run_shape"]["acts"]
    print("-- POLICY SUMMARY " + "-" * 70)
    pw = [17, 8, 8, 8] + [9] * acts + [9, 9, 9]
    print(_row(
        ["policy", "runs", "clear", "reachF"]
        + [f"act{a}_wr" for a in range(1, acts + 1)]
        + ["avg_act", "lives", "spend_p50"],
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
            ]
            + [f"{wr[f'act_{a}']['win_rate']:.1%}" for a in range(1, acts + 1)]
            + [
                stats["average_ending_act"],
                stats["lives_remaining"]["mean"],
                stats["credit_spend"]["p50"],
            ],
            pw,
        ))
    print()
    print(
        "clear = beat the FINAL boss (the only win condition); reachF = reached the\n"
        "final boss at all; * = control policy, not one of the seven required."
    )
    print()

    print("-- OUTCOME DISTRIBUTION " + "-" * 64)
    ow = [17, 16, 24, 16]
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
    ew = [17, 12, 12, 12, 12, 12, 12]
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

    print("-- ECONOMY AUDIT (spec §4) " + "-" * 61)
    aw = [17, 11, 11, 10, 10, 10, 11, 11]
    print(_row(
        ["policy", "avail_p50", "left_MED", "<20 left", ">=50%", ">=75%", ">=90%",
         "sinks_mean"], aw))
    for policy, stats in result["policies"].items():
        share = stats["share_spending_at_least"]
        print(_row(
            [
                policy,
                stats["available_credits"]["p50"],
                stats["credits_remaining_median"],
                f"{stats['unused_credit_distribution']['share_under_20']:.0%}",
                f"{share['50pct']:.0%}",
                f"{share['75pct']:.0%}",
                f"{share['90pct']:.0%}",
                stats["credit_sinks"]["spent_on_sinks_mean"],
            ],
            aw,
        ))
    print("left_MED = median unspent credits; target is under "
          f"{COMPETENT_LEFTOVER_MEDIAN_MAX:.0f} for a competent policy.")
    print()

    print("-- UNUSED-CREDIT DISTRIBUTION " + "-" * 58)
    dw = [17, 9, 9, 9, 9, 9, 9]
    print(_row(["policy", "p10", "p25", "p50", "p75", "p90", "mean"], dw))
    for policy, stats in result["policies"].items():
        d = stats["unused_credit_distribution"]
        print(_row(
            [policy, d["p10"], d["p25"], d["p50"], d["p75"], d["p90"], d["mean"]], dw
        ))
    print()

    print("-- CLEAR RATE BY SPEND BAND " + "-" * 60)
    bands = list(next(iter(result["policies"].values()))["clear_rate_by_spend_band"])
    bw2 = [17] + [16] * len(bands)
    print(_row(["policy"] + bands, bw2))
    for policy, stats in result["policies"].items():
        cells = []
        for band in bands:
            row = stats["clear_rate_by_spend_band"][band]
            cells.append(
                "n/a" if not row["runs"] else f"{row['clear_rate']:.1%} (n={row['runs']})"
            )
        print(_row([policy] + cells, bw2))
    print()

    print("-- NODE PICK RATES " + "-" * 69)
    nw = [17, 13, 13, 13, 13]
    print(_row(["policy", "draft_room", "trade_desk", "film_room", "rest_bank"], nw))
    for policy, stats in result["policies"].items():
        r = stats["node_pick_rate"]
        print(_row(
            [policy] + [f"{r[t]:.1%}" for t in
                        ("draft_room", "trade_desk", "film_room", "rest_bank")],
            nw,
        ))
    print()

    print("-- SCOUT & PREPARE " + "-" * 69)
    sw = [17, 10, 12, 12, 14, 14]
    print(_row(
        ["policy", "pick", "visits", "preps", "flipped_lane", "flipped_battle"], sw))
    for policy, stats in result["policies"].items():
        s = stats["scout_and_prepare"]
        print(_row(
            [policy, f"{s['pick_rate']:.1%}", s["visits"], s["preparations_spent"],
             s["preparations_that_flipped_a_lane"],
             f"{s['preparations_that_flipped_a_battle']} "
             f"({s['battle_flip_rate']:.1%})"],
            sw,
        ))
    print()

    print("-- CREDIT SINKS " + "-" * 72)
    kw2 = [20, 8, 26, 26, 14]
    print(_row(["sink", "cost", "offered at", "limit", "credits"], kw2))
    for sink_id, row in meta["credit_sinks"].items():
        print(_row(
            [sink_id, row["cost"], ",".join(row["offered_at"]), row["limit"],
             row["credits_absorbed"]],
            kw2,
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
        description="Audit the RUN THE TABLE Standard v3 engine."
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
