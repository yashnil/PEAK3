"""The SHARED DRAFT bot: strong, opinionated, not a solver.

WHAT IT WEIGHS, per legal card, in PEAK3 points:

  * VALUE       the card's published score -- what it adds to the roster total.
  * NEED        what waiting would cost at this position: the gap between this
                card and the card we would realistically be left with there.
                If the opponent still needs the position and picks before our
                next turn, they will likely take the best of what remains, so
                our fallback is the SECOND-best other card; otherwise the best.
  * DENIAL      what the pick takes from the opponent: when they still need
                this position and this card is the best one left there, the gap
                to the next-best card is exactly what we deny them.

  * MARGIN      a one-ply look-ahead: take this card, then let both sides
                draft greedily to the end, and read our total minus theirs.
                It is what makes need and denial bite in the right order.

    utility = margin

NEED and DENIAL are reported on every option (and asserted by the tests) but do
not enter the utility separately: the margin already prices both, and adding
them on top was measured to make the bot WEAKER (500 seeded matches against a
greedy best-score drafter: 0.60 win rate with need 0.5 / denial 0.55 added,
0.67 with the margin alone). Value is the first term of the margin itself.

THEN IT CHOOSES WITH BOUNDED NOISE rather than taking the maximum:

  1. THE QUALITY GATE. A card more than `BOT_MAX_QUALITY_REGRET_POINTS` below
     the best card we may legally take is never considered, so no draw can be a
     throw. When one card survives, it is taken -- no randomness is consumed.
  2. Survivors within `BOT_REGRET_CAP` utility of the best are perturbed with
     Gumbel noise at `BOT_TEMPERATURE` and the highest perturbed utility wins
     -- a softmax draw. A clearly better pick stays overwhelmingly likely;
     near-peers genuinely vary.

It is one ply deep on purpose. A minimax search over the shared board would be
a solver, and the brief is an opponent with judgement rather than an oracle.

WHAT IT KNOWS. The projection hands a bot seat the board's scores
(`private.card_scores`) -- its stand-in for basketball knowledge, the same
stated trade Three-Man Weave's bot makes. It reads nothing the match has not
already produced, and the RNG is the driver's seeded stream, so a replay of the
same match makes the same picks.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any, Optional

from nba_peak.shared_draft import config as C


@dataclass(frozen=True)
class SharedDraftCommand:
    command_type: str
    payload: dict


def _opponent_picks_before_our_next(order: list[int], pick_index: int, me: int) -> int:
    """How many picks the opponent makes between this pick and our next one."""
    count = 0
    for seat in order[pick_index + 1:]:
        if seat == me:
            break
        count += 1
    return count


def _rollout_margin(public: dict, scores: dict[int, float], me: int, first: int) -> float:
    """Our roster total minus theirs if we take `first` now and BOTH sides then
    draft greedily (best legal score) to the end. One look-ahead, not a search:
    it prices need and denial into one number without solving the board."""
    cards = {c["card_index"]: c for c in public["cards"]}
    taken = {i for i, c in cards.items() if c.get("drafted_by") is not None}
    open_slots = {
        s["seat_index"]: {slot for slot, card in (s.get("roster") or {}).items() if card is None}
        for s in public["seats"]
    }
    totals = {s["seat_index"]: 0.0 for s in public["seats"]}
    order = public["order"]
    by_score = sorted(cards, key=lambda i: (-scores[i], i))
    for step in range(public["pick_index"], len(order)):
        seat = order[step]
        if step == public["pick_index"]:
            choice = first
        else:
            choice = next(
                (i for i in by_score if i not in taken and cards[i]["position"] in open_slots[seat]), None
            )
            if choice is None:  # pragma: no cover - two cards per position
                continue
        taken.add(choice)
        open_slots[seat].discard(cards[choice]["position"])
        totals[seat] += scores[choice]
    them = next(i for i in totals if i != me)
    return totals[me] - totals[them]


def options(public: dict, private: dict) -> list[dict]:
    """Every legal card, scored and ranked best-first (ties by board order)."""
    me = private["seat_index"]
    legal = set(private.get("legal_cards") or ())
    scores = {int(k): float(v) for k, v in (private.get("card_scores") or {}).items()}
    if not legal or not scores:
        return []
    cards = public["cards"]
    available = [c for c in cards if c.get("drafted_by") is None]
    opponent = next(s for s in public["seats"] if s["seat_index"] != me)
    opponent_needs = {slot for slot, card in (opponent.get("roster") or {}).items() if card is None}
    contested_before_next = _opponent_picks_before_our_next(public["order"], public["pick_index"], me) > 0

    out = []
    for card in cards:
        index = card["card_index"]
        if index not in legal:
            continue
        value = scores[index]
        position = card["position"]
        others = sorted(
            (scores[c["card_index"]] for c in available if c["position"] == position and c["card_index"] != index),
            reverse=True,
        )
        contested = position in opponent_needs
        if not others:
            fallback = 0.0 if contested else value
        elif contested and contested_before_next:
            fallback = others[1] if len(others) > 1 else (0.0 if others[0] >= value else others[0])
        else:
            fallback = others[0]
        need = max(0.0, value - fallback)
        denial = max(0.0, value - others[0]) if contested and others else (value if contested else 0.0)
        margin = _rollout_margin(public, scores, me, index)
        utility = margin
        out.append(
            {"card_index": index, "position": position, "score": value, "need": need,
             "denial": denial, "margin": margin, "utility": utility}
        )
    out.sort(key=lambda o: (-o["utility"], o["card_index"]))
    return out


def viable(opts: list[dict]) -> list[dict]:
    """`opts` minus every card the quality gate excludes, order preserved."""
    if not opts:
        return []
    floor = max(o["score"] for o in opts) - C.BOT_MAX_QUALITY_REGRET_POINTS
    return [o for o in opts if o["score"] >= floor]


def choose(opts: list[dict], rng: random.Random) -> Optional[dict]:
    survivors = viable(opts)
    if not survivors:
        return None
    best = survivors[0]
    contenders = [o for o in survivors if best["utility"] - o["utility"] <= C.BOT_REGRET_CAP]
    if len(contenders) == 1:
        return best

    def perturbed(option: dict) -> float:
        u = min(max(rng.random(), 1e-12), 1 - 1e-12)
        return option["utility"] - C.BOT_TEMPERATURE * math.log(-math.log(u))

    return max(contenders, key=perturbed)


def deliberation(public: dict, private: dict) -> float:
    """How hard the pick LOOKS, 0 (obvious) .. 1 (agonising). RNG-free;
    drives think time only."""
    survivors = viable(options(public, private))
    if len(survivors) < 2:
        return 0.1
    gap = survivors[0]["utility"] - survivors[1]["utility"]
    return round(max(0.0, min(1.0, 1.0 - gap / C.BOT_REGRET_CAP)), 4)


class SharedDraftBot:
    bot_id = "shared_draft_bot_v1"
    policy_version = C.BOT_POLICY_VERSION
    rating = C.BOT_RATING

    def decide(self, public: dict, private: dict, rng: random.Random) -> Optional[tuple[str, dict]]:
        picked = choose(options(public, private), rng)
        if picked is None:
            return None
        return C.COMMAND_PICK, {"card_index": picked["card_index"], "pick_number": public["pick_index"] + 1}

    async def choose(self, view: Any, rng: Any) -> Optional[SharedDraftCommand]:
        if C.COMMAND_PICK not in (view.legal_commands or ()):
            return None
        decision = self.decide(dict(view.public_state), dict(view.private_state), rng)
        if decision is None:
            return None
        command, payload = decision
        return SharedDraftCommand(command_type=command, payload=payload)
