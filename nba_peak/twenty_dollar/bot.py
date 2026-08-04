"""The $20 Showdown bot: a bidding policy that sees only what a human sees.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload (`bots.py:107-114`) and its own
docstring says so plainly: "a mode whose only legal commands need arguments
will get a rejected command from this bot, and should ship its own policy." A
bid needs an amount, so this exists.

WHAT IT IS ALLOWED TO KNOW, AND WHY THAT IS STRUCTURAL
-------------------------------------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat,
and a seeded `random.Random`. That is the whole input. It cannot see the
opponent's unrevealed bid, the next candidate, or the pool's private ordering,
because none of those is in a `SeatView` and a `SeatView` carries no path back
to the authoritative state (`arena_protocols.py:497-513`).

That is worth stating precisely: the bot is not trusted to avoid cheating, it
is unable to. The cheating version does not fail review, it fails to have
anywhere to read from.

WHAT IT BIDS ON
---------------
The bot faces the same problem a human does -- a name, a season and a position
set, with the score hidden until the round resolves. It therefore CANNOT value
a candidate by `prime_score`, and does not try. It uses only what the
projection gives it:

  * `rank_hint`: absent. Not available pre-reveal, and not smuggled in.
  * position scarcity: how many of its own open slots this player could fill,
    and whether the player covers a slot it will struggle to fill later.
  * budget pressure: dollars per remaining slot, so it does not blow its
    reserve on an early name.
  * opponent need: whether the opponent can legally take this player at all --
    a player the opponent cannot use is one the bot never has to overpay for.
  * tie priority: worth a dollar less when it holds the token, because a tie
    goes its way.

This is a deliberately honest opponent rather than a strong one. It is beatable
by a player who knows the era, which is the point of the mode.
"""
from __future__ import annotations

import random
from typing import Any

from nba_peak.twenty_dollar.config import BOT_POLICY_VERSION, ROSTER_SIZE


class TwentyDollarBot:
    """A bidding policy for The $20 Showdown.

    Registered against the mode so a public queue can fill a seat. Rated
    conservatively: it plays legally and does not strand itself, but it values
    players by position scarcity alone, having no access to the hidden score.
    """

    def __init__(
        self,
        bot_id: str = "twenty_dollar_v1",
        policy_version: str = BOT_POLICY_VERSION,
        rating: float = 1050.0,
    ) -> None:
        self._bot_id = bot_id
        self._policy_version = policy_version
        self._rating = rating

    @property
    def bot_id(self) -> str:
        return self._bot_id

    @property
    def policy_version(self) -> str:
        return self._policy_version

    @property
    def rating(self) -> float:
        return self._rating

    # -- the decision ------------------------------------------------------

    def decide(self, public: dict, private: dict, rng: random.Random) -> tuple[str, dict]:
        """Return `(command_type, payload)` from this seat's own projection.

        Pure and total: every branch returns a legal command. A policy that
        raised would take a seat out of a live match, and a policy that
        returned an illegal bid would simply be rejected by the reducer -- but
        a rejected bot command still burns the turn, so the arithmetic here is
        clamped to `private["max_bid"]` rather than trusting itself.
        """
        max_bid = int(private.get("max_bid", 0))
        if not private.get("can_acquire_candidate") or max_bid < 1:
            return "pass", {}

        seat_index = int(private.get("seat_index", 0))
        seats = public.get("seats") or []
        me = next((s for s in seats if s["seat_index"] == seat_index), None)
        if me is None:
            return "pass", {}

        open_slots = len(me.get("open_slots") or []) or 1
        budget = int(me.get("budget", 0))
        # Dollars available per slot after honouring the reserve. This is the
        # bot's whole sense of "can I afford to be aggressive".
        headroom = budget / max(1, open_slots)

        fits = private.get("candidate_fits") or []
        # A player who fits exactly one of my open slots is worth more than a
        # flexible one when that slot is scarce -- and less when I have many
        # ways to fill it. Both directions matter, so scarcity is the ratio
        # rather than a raw count.
        scarcity = 1.0 + (1.0 / max(1, len(fits)))

        # A candidate the opponent cannot legally take needs no contest. The
        # projection publishes each seat's open slots and roster, so this is
        # inferred from public information exactly as a human would infer it.
        contested = self._opponent_could_use(public, seat_index)
        contest_factor = 1.0 if contested else 0.55

        # Holding the tie token means an equal bid wins, so the bot can shade
        # a dollar lower.
        token_discount = 1 if private.get("holds_tie_priority") else 0

        base = headroom * scarcity * contest_factor
        # A little seeded noise so two bots on the same board do not play an
        # identical, mirrored match. Seeded by the driver, never from a global
        # source, so a match still replays exactly.
        jitter = rng.uniform(0.85, 1.15)
        bid = int(round(base * jitter)) - token_discount

        bid = max(0, min(bid, max_bid))
        # Never leave a slot unfillable: `max_bid` already guarantees the
        # reserve, so a clamp to it is sufficient and no second rule is needed.
        if bid <= 0:
            # Still take a free look when nobody else can use the player.
            return ("bid", {"amount": 1}) if not contested and max_bid >= 1 else ("pass", {})
        return "bid", {"amount": bid}

    @staticmethod
    def _opponent_could_use(public: dict, seat_index: int) -> bool:
        """Could any other seat plausibly want this candidate?

        Uses only published fields: the other seat's remaining budget and how
        many slots it still has open, intersected with the candidate's
        positions. It deliberately does NOT consult a feasibility oracle for
        the opponent -- a human cannot run one either, and giving the bot a
        sharper read of the opponent's roster than a human gets would be a
        quieter form of the same asymmetry `SeatView` exists to prevent.
        """
        candidate = public.get("candidate") or {}
        positions = set(candidate.get("positions") or [])
        for seat in public.get("seats") or []:
            if seat["seat_index"] == seat_index:
                continue
            if seat.get("roster_full"):
                continue
            if int(seat.get("budget", 0)) < 1:
                continue
            if positions & set(seat.get("open_slots") or []):
                return True
        return False

    # -- the foundation's async entry point ---------------------------------

    async def choose(self, view: Any, rng: Any) -> Any:
        """Adapt `decide` to the `BotPolicy` protocol.

        Imported lazily so this module stays importable -- and unit-testable --
        without the API package on the path. `nba_peak/` is the pure-rules
        layer and must not hard-depend on `apps/api`.
        """
        from app.repositories.arena_protocols import BotCommand

        if not view.legal_commands:
            return BotCommand(command_type="pass", payload={})
        command, payload = self.decide(
            dict(view.public_state), dict(view.private_state), rng
        )
        if command not in view.legal_commands:
            command, payload = "pass", {}
        return BotCommand(command_type=command, payload=payload)


__all__ = ["TwentyDollarBot", "ROSTER_SIZE"]
