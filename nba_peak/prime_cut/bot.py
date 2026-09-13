"""PRIME CUT bots: basketball judgement with a tier-sized error bar.

WHAT A BOT KNOWS. Exactly its `SeatView` (see `app/services/arena/bots.py`):
the current card's canonical score and the scores of cards ALREADY dealt in
this heat, placed there by `state.project` for bot seats only. It never sees a
card that has not been dealt -- the projection does not contain one -- so its
choice cannot depend on the future order.

HOW IT DECIDES. Each read is the true score plus Gaussian noise whose size is
the tier's (`BOT_TIER_NOISE`): a Rotation-level bot misjudges peaks by ~10
display points, an MVP-level bot by ~2. It then solves the question a human is
solving -- "is this one of the best four I will see?" -- against a PRIOR over
what a PRIME CUT heat usually contains (estimated once from fixed-seed boards,
never from the live match), shifted toward what this heat has shown so far:

    expected better future cards ~= future_cards * (1 - F(read))
    keep  iff  that is below keeps_left - 0.5

A forced card has one legal command and is taken without a read.

DETERMINISTIC. All randomness comes from the `rng` the driver seeds per
(match, seat, turn); the prior uses fixed seeds. A replay makes the same calls.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from functools import lru_cache
from statistics import fmean
from typing import Any, Optional

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut.board import generate_board


@dataclass(frozen=True)
class PrimeCutCommand:
    """What the bot decided: the two fields the Arena driver reads.

    Deliberately NOT `app.repositories.arena_protocols.BotCommand`: this rules
    package depends on neither FastAPI nor the repositories, and the driver
    (`app/services/arena/bots.py::drive_bot_seat`) only ever reads
    `command_type` and `payload`, so any object with both is a bot command.
    """

    command_type: str
    payload: dict = field(default_factory=dict)


@lru_cache(maxsize=None)
def prior_scores(duration: int) -> tuple[float, ...]:
    heat_index = C.HEAT_DURATIONS.index(duration)
    scores: list[float] = []
    for seed in range(C.BOT_PRIOR_SEEDS):
        heat = generate_board(10_000_000 + seed)["heats"][heat_index]
        scores.extend(card["prime_score"] for card in heat["cards"])
    return tuple(sorted(scores))


def _cdf(sorted_scores: tuple[float, ...], value: float) -> float:
    return bisect.bisect_right(sorted_scores, value) / len(sorted_scores)


def decide_keep(
    *,
    tier: str,
    duration: int,
    current_score: float,
    seen_scores: list[float],
    keeps_left: int,
    cards_left: int,
    rng: Any,
) -> bool:
    """True to KEEP. Pure given `rng`; exposed for calibration tests."""
    sigma = C.BOT_TIER_NOISE[tier]
    read = current_score + rng.gauss(0.0, sigma)
    past_reads = [s + rng.gauss(0.0, sigma) for s in seen_scores[:-1]]
    future = cards_left - 1
    if future <= 0:
        return keeps_left > 0

    prior = prior_scores(duration)
    observed = past_reads + [read]
    # A heat is dealt around its own cut line; what it has shown so far moves
    # the prior toward it, more as more cards are seen.
    shift = (fmean(observed) - fmean(prior)) * (len(observed) / (len(observed) + 3.0))
    better_future = future * (1.0 - _cdf(prior, read - shift))
    return better_future < keeps_left - 0.5


class PrimeCutBot:
    """The registered policy for every PRIME CUT bot seat. One object, four
    tiers: the tier comes from the seat's own projection."""

    bot_id = "prime_cut_bot_v1"
    policy_version = C.BOT_POLICY_VERSION
    #: The policy's default rating; each seat pins its TIER's rating instead
    #: (`PrimeCutMode.bot_seat_rating`).
    rating = C.BOT_TIER_RATINGS["starter"]

    async def choose(self, view: Any, rng: Any) -> Optional[PrimeCutCommand]:
        legal = [c for c in view.legal_commands if c in (C.COMMAND_KEEP, C.COMMAND_CUT)]
        if not legal:
            return None
        public = view.public_state
        private = view.private_state
        payload = {"heat_index": public["heat_index"], "card_index": public["card_index"]}
        if len(legal) == 1:
            return PrimeCutCommand(command_type=legal[0], payload=payload)
        keep = decide_keep(
            tier=private["bot_tier"],
            duration=public["durations"][public["heat_index"]],
            current_score=private["current_card_score"],
            seen_scores=list(private["seen_card_scores"]),
            keeps_left=private["keeps_left"],
            cards_left=private["cards_left"],
            rng=rng,
        )
        return PrimeCutCommand(command_type=C.COMMAND_KEEP if keep else C.COMMAND_CUT, payload=payload)
