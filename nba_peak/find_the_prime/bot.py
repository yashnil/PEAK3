"""FIND THE PRIME bots: career knowledge with a tier-sized, career-shaped error.

WHAT A BOT KNOWS. Its `SeatView`: the current prompt (player, duration, legal
starts) and, for bot seats only, the current round's canonical window scores.
Nothing from a future round is in the projection, so nothing future can
influence a choice.

HOW IT READS A CAREER. Each window's read is its canonical score plus an error
that is CORRELATED along the timeline -- an AR(1) walk with
`BOT_NOISE_CORRELATION` -- scaled by the tier's `BOT_TIER_NOISE`. Independent
per-window noise would make a weak bot pick random seasons; correlated noise
makes it misremember WHEN a player was great by a plausible stretch, which is
the mistake a real fan makes ("his best years were a little later than that").
The bot locks the window with the highest read; an exact tie in reads takes the
earlier start.

DETERMINISTIC: all randomness is the driver-seeded `rng`.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

from nba_peak.find_the_prime import config as C


@dataclass(frozen=True)
class FindThePrimeCommand:
    """The two fields the Arena bot driver reads. See `prime_cut.bot`."""

    command_type: str
    payload: dict = field(default_factory=dict)


def choose_start(*, tier: str, window_scores: list[tuple[int, float]], rng: Any) -> int:
    sigma = C.BOT_TIER_NOISE[tier]
    rho = C.BOT_NOISE_CORRELATION
    innovation = math.sqrt(1.0 - rho * rho)
    walk = 0.0
    best_start: Optional[int] = None
    best_read = -math.inf
    for index, (start, score) in enumerate(sorted(window_scores)):
        draw = rng.gauss(0.0, 1.0)
        walk = draw if index == 0 else rho * walk + innovation * draw
        read = score + sigma * walk
        if read > best_read:
            best_read, best_start = read, start
    assert best_start is not None
    return best_start


class FindThePrimeBot:
    bot_id = "find_the_prime_bot_v1"
    policy_version = C.BOT_POLICY_VERSION
    rating = C.BOT_TIER_RATINGS["starter"]

    async def choose(self, view: Any, rng: Any) -> Optional[FindThePrimeCommand]:
        if C.COMMAND_LOCK not in view.legal_commands:
            return None
        public = view.public_state
        private = view.private_state
        start = choose_start(
            tier=private["bot_tier"],
            window_scores=[(int(s), float(v)) for s, v in private["window_scores"]],
            rng=rng,
        )
        return FindThePrimeCommand(
            command_type=C.COMMAND_LOCK,
            payload={"round_index": public["round_index"], "start_season_end": start},
        )
