"""The $20 Showdown bot: a bidder that prices the ROSTER, not the player.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload (`bots.py:75-83`) and its own docstring
says so plainly: "a mode whose only legal commands need arguments will get a
rejected command from this bot, and should ship its own policy." A bid needs an
amount.

WHAT IT IS ALLOWED TO KNOW, AND WHY THAT IS STRUCTURAL
-------------------------------------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat,
and a seeded `random.Random`. That is the whole input. It cannot see the next
candidate, an action the human has not submitted, or -- crucially -- the
candidate's exact hidden PEAK3 score, because none of those is in a `SeatView`
and a `SeatView` carries no path back to the authoritative state
(`arena_protocols.py:540-578`).

The bot is not trusted to avoid cheating; it is unable to. The cheating version
does not fail review, it fails to have anywhere to read from.

THE ONE CONCESSION: A COARSE TIER, NEVER THE SCORE
---------------------------------------------------
A human bidder brings knowledge the projection does not carry -- they know
roughly where a 2016-17 Kawhi Leonard sits among all-time peaks. A bot has
none, so the mode's adapter puts a THREE-BAND TIER (top 100 / 101-250 /
251-500) into a BOT seat's private projection and nowhere else.

That is deliberately coarse and deliberately not the score:

  * A tier cannot rank two candidates inside it, so the bot still cannot tell
    the 8th-best peak from the 80th. Between two top-100 players it is
    guessing exactly as a casual human would.
  * It cannot be turned back into a price. Every valuation below multiplies
    the tier by roster context, so the same tier produces very different
    ceilings depending on what the bot still needs.
  * It is absent for a human seat, so no human ever sees a rank either.

WHAT IT ACTUALLY VALUES: MARGINAL ROSTER IMPROVEMENT
-----------------------------------------------------
The previous policy priced a candidate by "fair share of remaining budget"
times a scarcity nudge. That produced the reported behaviour: Scottie Barnes
escalating to a high bid purely because he fit, and money spent on modest
players early because early money is plentiful. Fair share is a BUDGET fact,
not a ROSTER fact, so it could not distinguish an upgrade from a duplicate.

v3 prices the DELTA this candidate makes to the roster:

  * TIER VALUE      how good they plausibly are, from the coarse band.
  * MARGINAL GAIN   tier value minus what this seat can already expect to get
                    for the slot from the remaining market. A player who is
                    only as good as the replacement the market will hand over
                    for $1 is worth about $1.
  * NEED            zero if they fill nothing; full if they fill a slot that
                    is open and hard to fill.
  * SCARCITY        how narrow their position set is against the slots this
                    seat still has to fill.
  * CONTEST         whether the opponent could plausibly use them, inferred
                    only from published budgets, rosters and open slots.
  * BUDGET PRESSURE the reserve floor is respected absolutely, and the ceiling
                    rises as slots fill because unspent money scores nothing.
  * MARKET PHASE    a closeout lot for a slot the bot still needs is worth
                    more than the same player in lot three, because the
                    remaining chances to fill it are running out.

Then it plays a normal ascending auction against that ceiling: raise by the
minimum legal increment while the standing bid is under it, and step away when
it is not.

IMPERFECT ON PURPOSE
--------------------
A seeded jitter moves the ceiling by up to about 12%, and with a small seeded
probability the bot either stretches one dollar past its ceiling or steps away
one dollar short. Both are things real bidders do, both are bounded, and
neither can produce an illegal bid: every amount is clamped to
`private["max_bid"]`, which the server recomputes from the persisted budget.

INDEPENDENCE FROM THE HUMAN'S ACTION IS THE POINT. `decide` never asks what the
other seat just did; it asks what the CURRENT board is worth to it. A human
pass therefore leaves the bot free to open at $1 and take the player.
"""
from __future__ import annotations

import random
from typing import Any, Optional

from nba_peak.twenty_dollar.config import (
    BOT_DIFFICULTY_LABEL,
    BOT_DISPLAY_NAME,
    BOT_POLICY_VERSION,
    MARKET_CLOSEOUT,
    MIN_RESERVE_PER_SLOT,
    ROSTER_SIZE,
    STARTING_BUDGET,
)

COMMAND_BID = "bid"
COMMAND_PASS = "pass"

#: How far the bot's ceiling may drift between two matches on the same board.
#: Small, and seeded by the driver, so a match still replays exactly while two
#: bots on one board do not play an identical mirrored game.
_JITTER = (0.88, 1.12)

#: What a coarse tier is plausibly worth, as a fraction of the whole budget, to
#: a seat with all five slots to fill. Calibrated so a top-100 peak is worth
#: about a third of the bank and a rank-400 player is worth close to the $1
#: floor -- which is the shape the price distribution has to have for "spend
#: most of your money on a weak marginal upgrade" to be irrational rather than
#: merely discouraged.
_TIER_VALUE = {
    "1-100": 0.34,
    "101-250": 0.16,
    "251-500": 0.07,
}
#: Used when no tier reached the projection at all (a human seat's policy in a
#: test, a future tier label). Deliberately the middle band: guessing high
#: would make an unknown candidate expensive, which is the failure mode.
_DEFAULT_TIER_VALUE = 0.16

#: What the bot assumes it can still get for a slot from the remaining market,
#: as a fraction of budget. Subtracted from tier value to give the MARGINAL
#: gain -- the reason a merely-fine player is cheap.
_REPLACEMENT_VALUE = 0.06

#: How often the bot makes a small, bounded, deliberate error.
_STRETCH_CHANCE = 0.10   # one dollar past the ceiling
_FLINCH_CHANCE = 0.08    # steps away one dollar early


class TwentyDollarBot:
    """A bidding policy for The $20 Showdown's ascending auction."""

    def __init__(
        self,
        bot_id: str = "twenty_dollar_v3",
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
        """USER-FACING. Never `bot_id`, never `policy_version`."""
        return f"{BOT_DISPLAY_NAME} · {BOT_DIFFICULTY_LABEL}"

    # -- the valuation -----------------------------------------------------

    def ceiling(self, public: dict, private: dict, rng: random.Random) -> int:
        """The most this bot will pay for the candidate on the board.

        Computed BEFORE the standing bid is consulted, and deliberately not a
        function of it: a ceiling that moved with the price is a bot that can
        be walked up indefinitely by an opponent who has noticed.
        """
        max_bid = int(private.get("max_bid", 0))
        if max_bid < 1 or not private.get("can_acquire_candidate"):
            return 0

        seat_index = int(private.get("seat_index", 0))
        me = _seat(public, seat_index)
        if me is None:
            return 0

        fits = list(private.get("candidate_fits") or [])
        if not fits:
            # Fills nothing on this roster. Worth nothing, whoever they are.
            return 0

        open_slots = list(me.get("open_slots") or [])
        remaining = max(1, len(open_slots))
        budget = int(me.get("budget", 0))

        # 1. TIER VALUE, in dollars of the starting bank.
        tier_share = _TIER_VALUE.get(
            str(private.get("candidate_tier") or ""), _DEFAULT_TIER_VALUE
        )

        # 2. MARGINAL GAIN over what the market will still supply for this
        #    slot. This is the term that makes a redundant or modest player
        #    cheap however much money is lying around.
        marginal = max(0.0, tier_share - _REPLACEMENT_VALUE)
        value = marginal * STARTING_BUDGET

        # 3. SCARCITY. A candidate who fits exactly one of the slots I still
        #    have to fill is worth more than a flexible one; a candidate with
        #    several ways in is one I can afford to lose.
        usable = [slot for slot in fits if slot in open_slots] or fits
        value *= 1.0 + 0.30 / max(1, len(usable))

        # 4. URGENCY. Unspent money scores nothing at the final whistle, so
        #    the last slots are worth spending on -- but the reserve for every
        #    OTHER open slot is honoured absolutely, which is what stops the
        #    bot stranding itself.
        spendable = max(
            0, budget - (remaining - 1) * MIN_RESERVE_PER_SLOT
        )
        filled = int(me.get("filled_slots", 0))
        value *= 1.0 + 0.18 * filled
        if remaining <= 1:
            # One slot left and no future to save for: the whole legal maximum
            # is rational, subject only to whether the lot is contested.
            value = float(max_bid)

        # 5. MARKET PHASE. In the closeout market the chances to fill this
        #    slot are visibly running out, so the same player is worth more.
        if public.get("market_phase") == MARKET_CLOSEOUT:
            value *= 1.35

        # 6. CONTEST. An uncontested player still deserves a bid -- just not a
        #    fight. Inferred only from what a human at the table can see.
        if not self._opponent_could_use(public, seat_index):
            value *= 0.6

        value *= rng.uniform(*_JITTER)
        return max(0, min(int(round(value)), spendable, max_bid))

    def decide(
        self, public: dict, private: dict, rng: random.Random
    ) -> tuple[str, dict]:
        """Return `(command_type, payload)` from this seat's own projection.

        Pure and total: every branch returns a legal command, and every amount
        is clamped to `private["max_bid"]` rather than trusted, because a
        rejected bot command still burns the turn.
        """
        if not private.get("is_your_turn"):
            # Defensive: the driver only calls a policy whose seat is on the
            # clock, so reaching this means the projection and the turn row
            # disagree. Passing is the safe answer; bidding would not be.
            return self._decline(private)

        minimum = int(private.get("minimum_bid", 1))
        max_bid = int(private.get("max_bid", 0))
        if minimum > max_bid or not private.get("can_acquire_candidate"):
            return self._decline(private)

        limit = self.ceiling(public, private, rng)

        # THE BOUNDED MISTAKES. One dollar either way, drawn from the same
        # seeded stream as everything else, so a match still replays exactly.
        # A stretch can never breach `max_bid`, and a flinch can never make an
        # unaffordable bid -- both are clamped below.
        roll = rng.random()
        if roll < _STRETCH_CHANCE:
            limit += 1
        elif roll < _STRETCH_CHANCE + _FLINCH_CHANCE:
            limit -= 1

        if minimum > limit:
            return self._decline(private)

        # Ascending auctions are won a dollar at a time. Raising to the
        # minimum keeps the ceiling private and never overpays for an
        # uncontested player.
        return COMMAND_BID, {"amount": min(minimum, max_bid)}

    @staticmethod
    def _decline(private: dict) -> tuple[str, dict]:
        """Step away -- or open at the floor when the rules forbid stepping away.

        A seat out of market skips facing a candidate it can legally use, with
        nothing bid, MUST open. Submitting a pass there would be rejected and
        burn the turn, so the policy plays the move the rules leave it: the
        minimum legal bid. That is not the bot changing its mind, it is the
        skip economy applying to the bot exactly as it applies to a human.
        """
        if private.get("can_pass", True):
            return COMMAND_PASS, {}
        minimum = int(private.get("minimum_bid", 1))
        max_bid = int(private.get("max_bid", 0))
        if minimum > max_bid:  # pragma: no cover - the reserve guarantees $1
            return COMMAND_PASS, {}
        return COMMAND_BID, {"amount": minimum}

    @staticmethod
    def _opponent_could_use(public: dict, seat_index: int) -> bool:
        """Could any other seat plausibly want this candidate?

        Uses only published fields: the other seat's remaining budget, how many
        slots it still has open, whether it is still live in this lot, and how
        many market skips it has left -- intersected with the candidate's
        positions. It deliberately does NOT consult a feasibility oracle for
        the opponent; a human cannot run one either, and giving the bot a
        sharper read of the opponent's roster than a human gets would be a
        quieter form of the same asymmetry `SeatView` exists to prevent.
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
            # An opponent with no skips left is FORCED to open on a candidate
            # that fits them, which makes the lot contested whether or not they
            # want it. Read from the same public counter a human reads.
            if int(seat.get("market_skips", 1)) <= 0 and positions:
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
            # The rules moved under the decision (a skip spent, a lot
            # resolved). Fall back to whatever IS legal rather than burning the
            # turn on a rejection.
            command = view.legal_commands[0]
            payload = (
                {"amount": int(dict(view.private_state).get("minimum_bid", 1))}
                if command == COMMAND_BID
                else {}
            )
        return BotCommand(command_type=command, payload=payload)


def _seat(public: dict, seat_index: int) -> Optional[dict]:
    for seat in public.get("seats") or []:
        if seat.get("seat_index") == seat_index:
            return seat
    return None


__all__ = ["COMMAND_BID", "COMMAND_PASS", "ROSTER_SIZE", "TwentyDollarBot"]
