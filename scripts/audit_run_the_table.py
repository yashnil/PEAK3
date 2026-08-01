"""
audit_run_the_table.py
----------------------
Statistical and invariant audit of the RUN THE TABLE engine.

SUPERSEDED BY ``scripts/audit_run_the_table_v2.py`` FOR BALANCE WORK.

This harness is parameterised on ``ACTS`` and still runs correctly against
Standard v2, and its eight hard invariants are still worth having, but two of
the things it MEASURES are no longer the right questions:

* it reports ``ran_the_table`` = "won every battle", whereas v2's win condition
  is "beat the FINAL boss" (`receipt["outcome"] == "table_cleared"`), and it
  reports a `survived` column that v2 deliberately stopped treating as success;
* its four policies all pick cards by ``prime_score`` while battles resolve on
  ``lane_index``, so every win rate here is a LOWER BOUND. The v2 harness adds
  a lane-aware policy for exactly that reason.

Use v2 for balance decisions; keep this one as the smaller, single-process
smoke check.

Samples N run seeds, plays each one to a terminal status under four
deterministic policies, and reports the shape of what the generator actually
produces: roster legality, node feasibility, content reach, economy, boss
difficulty, and replay determinism.

Usage (from repo root):
    python scripts/audit_run_the_table.py [--seeds N] [--json OUT]

Exit codes:
    0  every hard invariant held (soft WARNs may still be printed)
    1  a hard invariant was violated, or the audit could not run

Hard invariants (any violation fails the audit):
    * every starting roster is role-legal, in ROLES order, inside the band
    * no roster ever contains the same player twice
    * every run reaches a terminal status
    * every Draft Room has an offer at or below DRAFT_GUARANTEED_AFFORDABLE_COST
    * a replayed action log reproduces a byte-identical receipt

Soft findings (printed as WARN, do not fail):
    * distribution skew — unreachable cards, unreachable bosses, era gaps
    * dominant strategy — a policy that runs the table too often, or a
      do-nothing policy that runs the table at all
"""

from __future__ import annotations

import argparse
import json
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
from nba_peak.run_the_table.bosses import (  # noqa: E402
    boss_starter_mean,
    resolve_bosses,
)
from nba_peak.run_the_table.cards import CardPool, CardPoolUnavailable, get_pool  # noqa: E402
from nba_peak.run_the_table.config import (  # noqa: E402
    ACTS,
    BENCH_SLOTS,
    BOSS_TARGET_STARTER_MEAN,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    MAX_LIVES,
    ROLES,
    STAGES_PER_ACT,
    STARTER_SLOTS,
    STATUS_NODE_ACTIVE,
    START_ROSTER_PERCENTILE_BAND,
    SYSTEM_IDS,
    version_tuple,
)
from nba_peak.run_the_table.generation import generate_blueprint, stage_for  # noqa: E402
from nba_peak.run_the_table.pricing import price_for, trade_net_cost  # noqa: E402
from nba_peak.run_the_table.receipt import build_receipt  # noqa: E402

POLICIES = ("greedy", "random", "first", "pass")

# Soft thresholds for the dominant-strategy warning. The win condition is
# "ran the table" (all three bosses beaten), not merely surviving three acts —
# surviving is the default outcome because a run only ends early after three
# separate losses.
DOMINANT_RTT_MAX = 0.60
PASSIVE_RTT_MAX = 0.05

MAX_STEPS = 80


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
# Blueprint-level structural checks (policy independent)
# ---------------------------------------------------------------------------
def audit_blueprint(pool: CardPool, bp, findings: "Findings") -> None:
    starters, bench = bp.starting_starters, bp.starting_bench
    lo, hi = START_ROSTER_PERCENTILE_BAND

    if len(starters) != STARTER_SLOTS or len(bench) != BENCH_SLOTS:
        findings.illegal_rosters.append(
            (bp.seed, f"roster shape {len(starters)}+{len(bench)}")
        )
        return

    for role, card_id in zip(ROLES, starters):
        if not pool.has(card_id):
            findings.illegal_rosters.append((bp.seed, f"{card_id} not in pool"))
            return
        if not pool.get(card_id).is_eligible_for(role):
            findings.illegal_rosters.append((bp.seed, f"{card_id} cannot play {role}"))

    all_ids = list(starters) + list(bench)
    slugs = [pool.get(cid).player_slug for cid in all_ids if pool.has(cid)]
    if len(set(slugs)) != len(slugs):
        dupes = [s for s, n in Counter(slugs).items() if n > 1]
        findings.duplicate_identities.append((bp.seed, dupes))

    for cid in all_ids:
        if not pool.has(cid):
            continue
        pct = pool.get(cid).overall_percentile
        if not (lo <= pct <= hi):
            findings.out_of_band.append((bp.seed, cid, round(pct, 4)))

    # Content reach + structural feasibility.
    for cid in all_ids:
        findings.card_offer_counts[cid] += 1
        findings.roster_card_counts[cid] += 1
    for role, cid in zip(ROLES, starters):
        if pool.has(cid):
            findings.start_role_fills[role] += 1

    for plan in bp.stages:
        for opt in plan.options:
            findings.node_type_counts[opt.node_type] += 1
            if opt.node_type == "draft_room":
                offers = plan.payloads[opt.node_id]["offer_ids"]
                for cid in offers:
                    findings.card_offer_counts[cid] += 1
                    findings.draft_offer_counts[cid] += 1
                # Checked against the PUBLISHED guarantee, not against
                # STARTING_CREDITS. PRICE_MAX is 30 and the run starts with 40,
                # so the old bound could not be violated by any board the
                # generator is capable of producing -- an invariant that cannot
                # fail is not an invariant.
                cheapest = min(pool.get(cid).base_cost for cid in offers)
                if cheapest > DRAFT_GUARANTEED_AFFORDABLE_COST:
                    findings.unaffordable_boards.append((bp.seed, opt.node_id, cheapest))
            elif opt.node_type == "trade_desk":
                for cid in plan.payloads[opt.node_id]["incoming_ids"]:
                    findings.card_offer_counts[cid] += 1
                    findings.trade_offer_counts[cid] += 1

    for offer in bp.system_offers:
        for sid in offer:
            findings.system_offer_counts[sid] += 1


# ---------------------------------------------------------------------------
# Instrumented playthrough
# ---------------------------------------------------------------------------
def play(bp, pool: CardPool, policy: str, rng: random.Random, findings: "Findings"):
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
            chosen = offer[0] if policy == "first" else rng.choice(list(offer))
            S.action_select_system(st, bp, chosen)
            findings.system_selection_counts[policy][chosen] += 1
            findings.system_available_counts[policy][len(offer)] += 1

        elif st.status == "node_select":
            plan = stage_for(bp, st.act, st.stage)
            options = list(plan.options)
            if policy == "greedy":
                options.sort(key=lambda o: 0 if o.node_type == "draft_room" else 1)
                choice = options[0]
            elif policy == "first":
                choice = options[0]
            else:
                choice = rng.choice(options)
            S.action_choose_node(st, bp, choice.node_id)
            findings.node_visits[policy][choice.node_type] += 1

        elif st.status == "node_active":
            plan, opt = S.node_option(bp, st.active_node_id)
            _resolve_node(st, bp, plan, opt, pool, policy, rng, findings)

        elif st.status == "boss_ready":
            S.action_resolve_boss(st, bp, pool)
            battle = st.battles[-1]
            findings.boss_outcomes[policy][(battle.act, battle.outcome)] += 1
            findings.boss_decided_by[battle.decided_by] += 1
            findings.bosses_faced[battle.boss_id] += 1

        elif st.status == "boss_resolved":
            S.action_advance(st, bp)

        if st.credits < 0:
            findings.negative_credit_runs.append((bp.seed, policy, st.credits))

    return st


def _resolve_node(st, bp, plan, opt, pool, policy, rng, findings) -> None:
    node_type = opt.node_type
    key = (policy, node_type)

    if node_type == "draft_room":
        offers = plan.payloads[opt.node_id]["offer_ids"]
        affordable = []
        placeable = []
        best = None
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
                current = pool.get(S._slot(st, slot).card_id).prime_score
                gain = card.prime_score - current
                if gain > 0 and (best is None or gain > best[0]):
                    best = (gain, cid, slot, free)

        # `action_draft_pass` guards on exactly two things: the run being at
        # node_active, and the open node being a Draft Room. Both hold here, so
        # a pass is legal. Computed rather than assumed, so a future guard that
        # breaks the escape hatch shows up as a hard failure.
        pass_legal = st.status == STATUS_NODE_ACTIVE and node_type == "draft_room"
        if not affordable:
            findings.no_affordable_offer[key] += 1
            if not pass_legal:
                findings.dead_end_nodes.append((st.seed, opt.node_id, policy))
        if affordable and not placeable:
            findings.no_placeable_offer[key] += 1
        if best is None:
            findings.no_upgrade_available[key] += 1

        if best and policy != "pass":
            S.action_draft_buy(st, bp, best[1], best[2], pool, best[3])
            findings.purchases[policy] += 1
        else:
            S.action_draft_pass(st, bp)
            findings.declines[key] += 1

    elif node_type == "trade_desk":
        incoming = plan.payloads[opt.node_id]["incoming_ids"]
        legal = []
        upgrade = None
        for cid in incoming:
            card = pool.get(cid)
            for slot in S.legal_slots_for(st, pool, cid):
                if slot not in ROLES:
                    continue
                out_card = pool.get(S._slot(st, slot).card_id)
                breakdown = trade_net_cost(out_card, card, st.systems)
                if breakdown["net_cost"] > st.credits:
                    continue
                legal.append((cid, slot))
                if upgrade is None and card.prime_score > out_card.prime_score:
                    upgrade = (cid, slot)

        if not legal:
            findings.no_affordable_offer[key] += 1
            if st.status != STATUS_NODE_ACTIVE:
                findings.dead_end_nodes.append((st.seed, opt.node_id, policy))
        if upgrade is None:
            findings.no_upgrade_available[key] += 1

        if upgrade and policy == "greedy":
            S.action_trade(st, bp, upgrade[1], upgrade[0], pool)
            findings.trades[policy] += 1
        else:
            S.action_decline_trade(st, bp)
            findings.declines[key] += 1

    elif node_type == "film_room":
        is_last_stage = st.act == ACTS and st.stage == STAGES_PER_ACT
        if is_last_stage:
            # Nothing left to scout: the scout branch is a genuine no-op here.
            findings.noop_choice_nodes[(policy, "film_room_scout_at_end")] += 1
        choice = (
            "take_credits" if policy == "greedy" else rng.choice(list(S.FILM_CHOICES))
        )
        S.action_film_room(st, bp, choice)
        findings.node_choices[(policy, "film_room", choice)] += 1

    else:  # rest_bank
        if st.lives >= MAX_LIVES:
            # Recovering a life at full health does nothing.
            findings.noop_choice_nodes[(policy, "rest_recover_at_full_lives")] += 1
        choice = "recover_life" if st.lives < MAX_LIVES else "take_credits"
        S.action_rest_bank(st, bp, choice)
        findings.node_choices[(policy, "rest_bank", choice)] += 1


# ---------------------------------------------------------------------------
# Accumulator
# ---------------------------------------------------------------------------
class Findings:
    def __init__(self) -> None:
        # hard
        self.illegal_rosters: list = []
        self.duplicate_identities: list = []
        self.out_of_band: list = []
        self.unaffordable_boards: list = []
        self.dead_end_runs: list = []
        self.dead_end_nodes: list = []
        self.replay_mismatches: list = []
        self.negative_credit_runs: list = []

        # content reach
        self.card_offer_counts: Counter = Counter()
        self.draft_offer_counts: Counter = Counter()
        self.trade_offer_counts: Counter = Counter()
        self.roster_card_counts: Counter = Counter()
        self.node_type_counts: Counter = Counter()
        self.start_role_fills: Counter = Counter()
        self.system_offer_counts: Counter = Counter()
        self.bosses_faced: Counter = Counter()
        self.boss_decided_by: Counter = Counter()

        # per-policy
        self.node_visits: dict = defaultdict(Counter)
        self.system_selection_counts: dict = defaultdict(Counter)
        self.system_available_counts: dict = defaultdict(Counter)
        self.boss_outcomes: dict = defaultdict(Counter)
        self.purchases: Counter = Counter()
        self.trades: Counter = Counter()
        self.declines: Counter = Counter()
        self.no_affordable_offer: Counter = Counter()
        self.no_placeable_offer: Counter = Counter()
        self.no_upgrade_available: Counter = Counter()
        self.noop_choice_nodes: Counter = Counter()
        self.node_choices: Counter = Counter()

        self.completions: Counter = Counter()
        self.ran_the_table: Counter = Counter()
        self.spend: dict = defaultdict(list)
        self.leftover: dict = defaultdict(list)
        self.runs_played: Counter = Counter()


# ---------------------------------------------------------------------------
# Audit driver
# ---------------------------------------------------------------------------
def run_audit(seeds: int, replay_sample: int, quiet: bool = False) -> dict:
    started = time.time()
    pool = get_pool()
    bosses = resolve_bosses(pool)
    findings = Findings()

    replay_every = max(1, seeds // max(1, replay_sample))
    replays_checked = 0

    for seed in range(seeds):
        if not quiet and seed and seed % 2000 == 0:
            print(f"  ... {seed}/{seeds} seeds ({time.time() - started:.0f}s)", flush=True)

        try:
            bp = generate_blueprint(seed, pool=pool)
        except Exception as exc:  # generation failure is a hard dead end
            findings.dead_end_runs.append((seed, "generation", repr(exc)))
            continue

        audit_blueprint(pool, bp, findings)

        for policy in POLICIES:
            rng = random.Random(f"rtt-audit:{seed}:{policy}")
            try:
                st = play(bp, pool, policy, rng, findings)
            except Exception as exc:
                findings.dead_end_runs.append((seed, policy, repr(exc)))
                continue

            findings.runs_played[policy] += 1
            if st.status == "complete":
                findings.completions[policy] += 1
            wins = sum(1 for b in st.battles if b.outcome == "win")
            if st.status == "complete" and wins == ACTS:
                findings.ran_the_table[policy] += 1

            spent = sum(a["cost"] for a in st.acquisitions) + sum(
                max(0, t["net_cost"]) for t in st.trades
            )
            findings.spend[policy].append(spent)
            findings.leftover[policy].append(st.credits)

            if policy == "greedy" and seed % replay_every == 0:
                replays_checked += 1
                _replay_matches(bp, st, pool, seed, findings)

    return _summarise(
        seeds, findings, pool, bosses, replays_checked, time.time() - started
    )


def _replay_matches(bp, st, pool, seed, findings) -> bool:
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
        findings.replay_mismatches.append((seed, f"replay raised {exc!r}"))
        return False
    if original != replayed:
        findings.replay_mismatches.append((seed, "receipt differed"))
        return False
    return True


def _summarise(seeds, f: Findings, pool, bosses, replays_checked, elapsed) -> dict:
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
            }
        per_policy[policy] = {
            "runs": played,
            "completion_rate": rate(f.completions[policy], played),
            "ran_the_table_rate": rate(f.ran_the_table[policy], played),
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

    hard = {
        "illegal_starting_rosters": len(f.illegal_rosters),
        "duplicate_identities": len(f.duplicate_identities),
        "rosters_outside_percentile_band": len(f.out_of_band),
        "draft_boards_above_guaranteed_affordable_cost": len(f.unaffordable_boards),
        "nodes_with_no_legal_action": len(f.dead_end_nodes),
        "dead_end_runs": len(f.dead_end_runs),
        "replay_receipt_mismatches": len(f.replay_mismatches),
        "negative_credit_states": len(f.negative_credit_runs),
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
        rtt = per_policy[policy]["ran_the_table_rate"]
        if rtt > DOMINANT_RTT_MAX:
            warnings.append(
                f"dominant strategy: policy '{policy}' ran the table {rtt:.1%} of runs "
                f"(> {DOMINANT_RTT_MAX:.0%})"
            )
    passive = per_policy["pass"]["ran_the_table_rate"]
    if passive > PASSIVE_RTT_MAX:
        warnings.append(
            f"do-nothing play ran the table {passive:.1%} of runs "
            f"(> {PASSIVE_RTT_MAX:.0%}) — decisions do not matter enough"
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
            "runs_played": total_runs,
            "replays_checked": replays_checked,
            "elapsed_seconds": round(elapsed, 1),
            "card_pool_size": len(pool),
            "versions": version_tuple(),
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
                "source": b.source,
                "starter_mean": round(boss_starter_mean(pool, b), 3),
                "target": BOSS_TARGET_STARTER_MEAN[i],
                "times_faced": f.bosses_faced[b.boss_id],
            }
            for i, b in enumerate(bosses)
        ],
        "battle_decided_by": dict(f.boss_decided_by.most_common()),
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
    failed = {k: v for k, v in hard.items() if v}

    print("=" * 78)
    print("RUN THE TABLE — ENGINE AUDIT")
    print("=" * 78)
    print(
        f"seeds={meta['seeds']}  runs={meta['runs_played']}  "
        f"policies={','.join(meta['policies'])}  pool={meta['card_pool_size']}  "
        f"elapsed={meta['elapsed_seconds']}s"
    )
    print(f"versions: {meta['versions']['ruleset_version']} / "
          f"{meta['versions']['engine_version']} / pool {meta['versions']['card_pool_version']}")
    print()

    print("-- HARD INVARIANTS " + "-" * 59)
    widths = [52, 12]
    print(_row(["check", "violations"], widths))
    for name, count in hard.items():
        print(_row([name, count], widths))
    print()

    print("-- CONTENT DISTRIBUTION " + "-" * 54)
    content = result["content_distribution"]
    print(f"distinct cards offered      : {content['distinct_cards_offered']} "
          f"of {meta['card_pool_size']}  "
          f"(draft {content['distinct_cards_in_draft_rooms']}, "
          f"trade {content['distinct_cards_in_trade_desks']}, "
          f"starting rosters {content['distinct_cards_in_starting_rosters']})")
    print(f"unreachable cards           : {len(content['unreachable_cards'])}")
    print(f"unreachable bosses          : {len(content['unreachable_bosses'])}")
    print(f"node types                  : {content['node_types']}")
    print(f"era (anchor decade)         : {content['era_by_anchor_decade']}")
    print(f"role eligibility of offers  : {content['role_eligibility_of_offered_cards']}")
    print(f"starting role fills         : {content['starting_roster_role_fills']}")
    print(f"system offer counts         : {content['system_offer_counts']}")
    print()

    print("-- BOSSES " + "-" * 68)
    bw = [22, 5, 22, 14, 10, 12]
    print(_row(["boss", "act", "rule", "starter_mean", "target", "faced"], bw))
    for boss in result["bosses"]:
        print(_row(
            [boss["boss_id"], boss["act"], boss["rule_id"], boss["starter_mean"],
             boss["target"], boss["times_faced"]],
            bw,
        ))
    print(f"battles decided by          : {result['battle_decided_by']}")
    print()

    print("-- POLICY SUMMARY " + "-" * 60)
    pw = [9, 8, 12, 10, 9, 9, 9, 9, 9, 9]
    print(_row(
        ["policy", "runs", "survived", "ran_table", "act1_wr", "act2_wr", "act3_wr",
         "spend_p10", "spend_p50", "spend_p90"],
        pw,
    ))
    for policy, stats in result["policies"].items():
        print(_row(
            [
                policy,
                stats["runs"],
                f"{stats['completion_rate']:.1%}",
                f"{stats['ran_the_table_rate']:.1%}",
                f"{stats['boss_win_rates']['act_1']['win_rate']:.1%}",
                f"{stats['boss_win_rates']['act_2']['win_rate']:.1%}",
                f"{stats['boss_win_rates']['act_3']['win_rate']:.1%}",
                stats["credit_spend"]["p10"],
                stats["credit_spend"]["p50"],
                stats["credit_spend"]["p90"],
            ],
            pw,
        ))
    print()
    print(
        "survived = finished act 3 with a life left (the default outcome: a run only\n"
        "ends early after three separate losses); ran_table = beat all three bosses,\n"
        "which is the win condition the dominant-strategy check is applied to."
    )
    print()

    print("-- NO-OP / UNAFFORDABLE NODES " + "-" * 48)
    nw = [9, 36, 12, 36]
    print(_row(
        ["policy", "no_affordable_offer", "unplaceable", "no_upgrade_available"], nw
    ))
    for policy, stats in result["policies"].items():
        print(_row(
            [
                policy,
                stats["no_affordable_offer_nodes"],
                stats["affordable_but_unplaceable_nodes"]["draft_room"],
                stats["no_upgrade_available_nodes"],
            ],
            nw,
        ))
    print()
    print("no-op choice branches (the option exists but changes nothing):")
    for policy, stats in result["policies"].items():
        print(f"  {policy:<9} {stats['noop_choice_nodes'] or '{}'}")
    print()

    print("-- SYSTEM SELECTION " + "-" * 58)
    for policy, stats in result["policies"].items():
        print(f"{policy:<9} {stats['systems_selected']}")
    print()

    for warning in result["warnings"]:
        print(f"WARN  {warning}")
    if result["warnings"]:
        print()

    if failed:
        print("=" * 78)
        print("FAIL — hard invariants violated")
        print("=" * 78)
        for name, count in failed.items():
            print(f"  {name}: {count}")
            for example in result["hard_invariant_examples"].get(name, [])[:5]:
                print(f"      e.g. {example}")
        print()
        return False

    print("=" * 78)
    print(
        f"PASS — {len(hard)} hard invariants held across {meta['seeds']} seeds "
        f"({meta['runs_played']} runs, {meta['replays_checked']} replay checks). "
        f"{len(result['warnings'])} soft warning(s)."
    )
    print("=" * 78)
    return True


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Audit the RUN THE TABLE engine.")
    parser.add_argument("--seeds", type=int, default=10000, help="run seeds to sample")
    parser.add_argument("--json", dest="json_out", type=Path, default=None,
                        help="write the full result dict to this path")
    parser.add_argument("--replay-sample", type=int, default=250,
                        help="how many runs to re-generate and replay for determinism")
    parser.add_argument("--quiet", action="store_true", help="suppress progress lines")
    args = parser.parse_args(argv)

    if args.seeds < 1:
        print("FAIL — --seeds must be at least 1", file=sys.stderr)
        return 1

    try:
        result = run_audit(args.seeds, args.replay_sample, quiet=args.quiet)
    except CardPoolUnavailable as exc:
        print("=" * 78)
        print("FAIL — card pool unavailable")
        print("=" * 78)
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
