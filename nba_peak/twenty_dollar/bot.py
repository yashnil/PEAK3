"""The $20 Showdown bot: an ascending-auction policy that sees only what a human sees.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload (`bots.py:75-83`) and its own docstring
says so plainly: "a mode whose only legal commands need arguments will get a
rejected command from this bot, and should ship its own policy." A bid needs an
amount. That gap is not hypothetical -- it is the defect this file's previous
version was written to fix and which shipped anyway, because the policy existed
but was never REGISTERED: `registry.default_for("twenty_dollar")` fell through
to the random baseline, whose empty-payload `bid` reduces to a $0 bid, i.e. a
pass. The result looked exactly like the reported symptom, "when the human
passes, the bot passes too" -- the bot was passing on every lot, whatever the
human did. Registration now happens in `app/services/twenty_dollar/mode.py`
beside the mode's own, and a test asserts the resolved policy is this one.

WHAT IT IS ALLOWED TO KNOW, AND WHY THAT IS STRUCTURAL
-------------------------------------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat,
and a seeded `random.Random`. That is the whole input. It cannot see the next
candidate, the candidate's hidden PEAK3 score, or an action the human has not
submitted, because none of those is in a `SeatView` and a `SeatView` carries no
path back to the authoritative state (`arena_protocols.py:540-578`).

That is worth stating precisely: the bot is not trusted to avoid cheating, it
is unable to. The cheating version does not fail review, it fails to have
anywhere to read from.

HOW IT DECIDES, WITH NO SCORE TO READ
--------------------------------------
The bot faces the same problem a human does -- a name, a season, a team and a
position set, with the score hidden until the lot resolves. It therefore CANNOT
value a candidate by `prime_score`, and does not try. It sets a private ceiling
from things the projection publishes, and then plays a normal ascending auction
against it:

  * FAIR SHARE. Dollars available for this slot after honouring the reserve on
    every other open slot. This is the spine of the valuation.
  * URGENCY. Money is worth nothing at the final whistle (brief rule 18), so
    the ceiling rises as slots fill and the last open slot is worth the whole
    legal maximum.
  * POSITION SCARCITY. A candidate who fits exactly one of the bot's open slots
    is worth more than a flexible one; a candidate who fits none is worth zero.
  * CONTEST. Whether the opponent could legally use this player at all,
    inferred from published budgets, open slots and rosters -- exactly as a
    human would infer it.

Then: raise to the minimum legal increment while the standing bid is under the
ceiling, and pass the moment it is not. It does not jump, and it does not
shade -- both would be bluffing strategies that need a read on an opponent it
cannot form.

INDEPENDENCE FROM THE HUMAN'S ACTION IS THE POINT. `decide` never asks what the
other seat just did; it asks what the CURRENT board is worth to it. A human
pass therefore leaves the bot free to open at $1 and take the player, which is
the behaviour the brief requires and the opposite of what v1 shipped.

This is a deliberately honest opponent rather than a strong one. It is beatable
by a player who knows the era, which is the point of the mode.
"""
from __future__ import annotations

import random
from typing import Any

from nba_peak.twenty_dollar.config import (
    BOT_DIFFICULTY_LABEL,
    BOT_DISPLAY_NAME,
    BOT_POLICY_VERSION,
    MIN_RESERVE_PER_SLOT,
    ROSTER_SIZE,
)

#: How far the bot's ceiling may drift between two matches on the same board.
#: Small, and seeded by the driver, so a match still replays exactly while two
#: bots on one board do not play an identical mirrored game.
_JITTER = (0.88, 1.12)


class TwentyDollarBot:
    """A bidding policy for The $20 Showdown's ascending auction.

    Registered against the mode so practice and a bot-filled public queue have a
    real opponent. Rated conservatively: it plays legally, never strands itself,
    and values players by budget and position scarcity alone, having no access
    to the hidden score.
    """

    def __init__(
        self,
        bot_id: str = "twenty_dollar_v2",
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

    @property
    def display_name(self) -> str:
        """USER-FACING. Never `bot_id`, never `policy_version`.

        The lobby once rendered "PEAK3 bot (random_legal_v1)" because the seat's
        display name was built from the id. It is authored here instead, so an
        implementation label has no path to a screen.
        """
        return f"{BOT_DISPLAY_NAME} · {BOT_DIFFICULTY_LABEL}"

    # -- the decision ------------------------------------------------------

    def ceiling(self, public: dict, private: dict, rng: random.Random) -> int:
        """The most this bot will pay for the candidate on the board.

        Computed BEFORE the standing bid is consulted, and deliberately not a
        function of it: a ceiling that moved with the price is a bot that can be
        walked up indefinitely by an opponent who has noticed.
        """
        max_bid = int(private.get("max_bid", 0))
        if max_bid < 1 or not private.get("can_acquire_candidate"):
            return 0

        seat_index = int(private.get("seat_index", 0))
        me = _seat(public, seat_index)
        if me is None:
            return 0

        open_slots = len(me.get("open_slots") or []) or 1
        budget = int(me.get("budget", 0))

        # Dollars genuinely available for THIS slot: what is left once every
        # other open slot keeps its reserve.
        share = (budget - (open_slots - 1) * MIN_RESERVE_PER_SLOT) / open_slots

        # Unspent money scores nothing, so the last slots are worth spending on.
        filled = int(me.get("filled_slots", 0))
        urgency = 1.0 + 0.22 * filled
        if open_slots <= 1:
            # One slot left and no future to save for: the legal maximum is the
            # rational ceiling, subject only to whether the lot is contested.
            share, urgency = float(max_bid), 1.0

        fits = private.get("candidate_fits") or []
        # A player who fits exactly one of my open slots is worth more than a
        # flexible one when that slot is scarce -- and less when I have many
        # ways to fill it. Both directions matter, so scarcity is the ratio
        # rather than a raw count.
        scarcity = 1.0 + (1.0 / max(1, len(fits)))
        scarcity = min(scarcity, 2.0) / 1.5  # centred near 1.0

        contested = self._opponent_could_use(public, seat_index)
        # An uncontested player still deserves a bid -- just not a fight. The
        # bot opens at the minimum and takes them.
        contest_factor = 1.0 if contested else 0.6

        value = share * urgency * scarcity * contest_factor * rng.uniform(*_JITTER)
        return max(0, min(int(round(value)), max_bid))

    def decide(
        self, public: dict, private: dict, rng: random.Random
    ) -> tuple[str, dict]:
        """Return `(command_type, payload)` from this seat's own projection.

        Pure and total: every branch returns a legal command. A policy that
        raised would take a seat out of a live match, and a policy that returned
        an illegal bid would simply be rejected by the reducer -- but a rejected
        bot command still burns the turn, so the arithmetic here is clamped to
        `private["max_bid"]` rather than trusting itself.
        """
        if not private.get("is_your_turn"):
            # Defensive: the driver only calls a policy whose seat is on the
            # clock, so reaching this means the projection and the turn row
            # disagree. Passing is the safe answer; bidding would not be.
            return COMMAND_PASS, {}

        minimum = int(private.get("minimum_bid", 1))
        max_bid = int(private.get("max_bid", 0))
        if minimum > max_bid or not private.get("can_acquire_candidate"):
            return COMMAND_PASS, {}

        limit = self.ceiling(public, private, rng)
        if minimum > limit:
            return COMMAND_PASS, {}

        # Ascending auctions are won a dollar at a time. Raising to the minimum
        # keeps the bot's ceiling private and never overpays for an uncontested
        # player.
        return COMMAND_BID, {"amount": minimum}

    @staticmethod
    def _opponent_could_use(public: dict, seat_index: int) -> bool:
        """Could any other seat plausibly want this candidate?

        Uses only published fields: the other seat's remaining budget, how many
        slots it still has open, and whether it is still live in this lot,
        intersected with the candidate's positions. It deliberately does NOT
        consult a feasibility oracle for the opponent -- a human cannot run one
        either, and giving the bot a sharper read of the opponent's roster than
        a human gets would be a quieter form of the same asymmetry `SeatView`
        exists to prevent.
        """
        candidate = public.get("candidate") or {}
        positions = set(candidate.get("positions") or [])
        for seat in public.get("seats") or []:
            if seat.get("seat_index") == seat_index:
                continue
            if seat.get("roster_full"):
                continue
            if not seat.get("in_lot", True):
                continue  # already passed out of this lot
            if int(seat.get("budget", 0)) < 1:
                continue
            if positions & set(seat.get("open_slots") or []):
                return True
        return False

    # -- the foundation's async entry point ---------------------------------

    async def choose(self, view: Any, rng: Any) -> Any:
        """Adapt `decide` to the `BotPolicy` protocol.

        Imported lazily so this module stays importable -- and unit-testable --
        without the API package on the path. `nba_peak/` is the pure-rules layer
        and must not hard-depend on `apps/api`.
        """
        from app.repositories.arena_protocols import BotCommand

        if not view.legal_commands:
            return BotCommand(command_type=COMMAND_PASS, payload={})
        command, payload = self.decide(
            dict(view.public_state), dict(view.private_state), rng
        )
        if command not in view.legal_commands:
            command, payload = COMMAND_PASS, {}
        return BotCommand(command_type=command, payload=payload)


COMMAND_BID = "bid"
COMMAND_PASS = "pass"


def _seat(public: dict, seat_index: int):
    for seat in public.get("seats") or []:
        if seat.get("seat_index") == seat_index:
            return seat
    return None


__all__ = ["TwentyDollarBot", "ROSTER_SIZE"]
