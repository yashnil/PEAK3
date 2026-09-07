"""The $20 Showdown bot: a bidder that prices the ROSTER, not the player.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload (`bots.py`) and its own docstring
says so plainly: "a mode whose only legal commands need arguments will get a
rejected command from this bot, and should ship its own policy." A bid needs an
amount.

WHAT IT IS ALLOWED TO KNOW, AND WHY THAT IS STRUCTURAL
-------------------------------------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat,
and a seeded `random.Random`. That is the whole input. It cannot see the next
candidate, an action the human has not submitted, or -- crucially -- the
candidate's exact hidden PEAK3 score, because none of those is in a `SeatView`
and a `SeatView` carries no path back to the authoritative state.

The bot is not trusted to avoid cheating; it is unable to. The cheating version
does not fail review, it fails to have anywhere to read from.

THE ONE CONCESSION: A COARSE BAND, NEVER THE SCORE
---------------------------------------------------
A human bidder brings knowledge the projection does not carry -- they know
roughly where a 2016-17 Kawhi Leonard sits among all-time peaks, and the
rankings page is public. So the mode's adapter puts a COARSE RANK BAND
(`config.BOT_RANK_BANDS`: 1-10 / 11-25 / 26-50 / 51-100 / 101-250 / 251-500)
into a BOT seat's private projection and nowhere else, alongside the three-way
draw tier v3 used. A band cannot rank two candidates inside it, cannot be turned
back into a price without the roster context below, and is absent for a human
seat, so no human ever sees a rank either.

v4: WHAT IT VALUES, AND HOW THAT BECOMES A PRICE
-------------------------------------------------
v3 priced a candidate by tier value minus a fixed replacement value, times a
few multipliers. Simulated against a rank-aware opponent it ended matches with
seven dollars unspent on average, let a top-100 player go for $2 in a sixth
of matches, and could not tell the fifth-best peak from the ninety-fifth.

v4 is a utility model with four moving parts, all read from the projection:

  * POINTS         what the band is plausibly worth on the final scoreboard,
                   in PEAK3 points (`_BAND_POINTS`, the published board's
                   own band means).
  * REPLACEMENT    what this seat can still expect to get for a slot from
                   the remaining market. It FALLS as the chances to fill the
                   slot run out (`_replacement_level`): early, a modest
                   101-250 player for a dollar; in the last lots, whatever
                   autofill would hand over.
  * MONEY RATE     how many points a marginal dollar buys, from how much
                   discretionary budget is left per open slot
                   (`_points_per_dollar`). Rich and nearly full: a dollar is
                   cheap and the ceiling rises. Poor and empty: a dollar is
                   dear and the ceiling falls. Unspent money scores nothing,
                   so this is what stops the bot finishing with a wallet.
  * ROSTER FIT     a candidate who fills exactly one of the open slots is
                   worth a little more than one with several ways in; a
                   candidate who fills nothing is worth nothing.

    ceiling = 1 + max(0, points - replacement) / rate, then fit, phase and
    endgame adjustments, then the reserve rule and `max_bid` as hard caps.

v5: THE OPPORTUNITY COST OF MONEY, AND LESS PRECISION
-----------------------------------------------------
Simulated against a rank-aware human proxy, v4 won about four matches in
five, and a tenth of its self-play matches were decided by lot four: two stars
bought for most of the budget, then a wallet of two dollars while the second
half of the board -- where a top-ten peak went for $2 -- played out without
it. Two structural causes, both in the valuation rather than in the auction:

  * THE EARLY REPLACEMENT LEVEL WAS TOO LOW. `_REPLACEMENT_EARLY` (64) was
    only reached at nine expected chances per slot, which no board ever
    offers; at lot 0 the level was about 51 points, below the 101-250 band's
    own mean. Every top-100 candidate therefore looked 27-40 points better
    than "what I could get otherwise", which is not true on a board that
    draws four lots in ten from the top hundred. v5 reaches the early level
    at about three chances per slot (`_REPLACEMENT_SPAN_CHANCES`).
  * MONEY HAD NO OPTION VALUE. The discretionary budget was everything above
    a dollar per open slot, so after one star the second was priced against
    a fair share of what was left, never against the premium lots still to
    come. v5 holds a LIQUIDITY RESERVE per other open slot
    (`_liquidity_per_slot`): a fraction of a dollar or more early, decaying
    to nothing as the market runs out, that a single lot may not spend. An
    early star is still allowed -- the cap is a share of the liquid money,
    not a prohibition -- but a second one is priced as what it costs the
    rest of the roster.
  * A RICH SEAT EXPECTED NO MORE THAN A POOR ONE. On a dry stretch of board
    v4 filled slots with dollar players while holding fifteen dollars, then
    met the first star with one slot left. The replacement level now rises
    with the discretionary money per open slot (`_REPLACEMENT_MONEY_SLOPE`):
    a seat that can outbid anyone for the next 51-100 peak should not settle
    for a 101-250 one at a dollar.
  * MONEY WAS PRICED THE SAME WITH NOBODY LEFT TO OUTBID. Once the opponent
    is down to a slot or two, or to the reserve, every later lot costs a
    dollar; `_contest_urgency` reads that from the public board and lets the
    liquidity reserve and the money rate relax, so the money is spent while
    there is still a contest to spend it in rather than left in the wallet.

And LESS PRECISION, without less intelligence. A human's price for a player is
an opinion held for the whole lot, not a fresh draw on every raise, so v5 forms
a PER-LOT OPINION (`_opinion`) from a stream keyed on public lot facts -- the
candidate, the lot index, both budgets -- that shifts the candidate's points up
or down by a fraction of a band some of the time, scales the ceiling a little,
and blurs the pacing cap. Deterministic, so a match replays exactly; keyed on
nothing hidden, so it cannot leak; and it produces the two moments a good
opponent produces: "it paid too much for that" and "it let that one go".

OPPONENT AWARENESS, FROM PUBLIC FIELDS ONLY. The opponent's remaining budget,
open slots and skips are on the board for everybody. The bot reads them to
know whether a lot is contested and whether the opponent can afford to fight
for it; it never reads a feasibility oracle for the other seat.

THE SKIP ECONOMY. Opening at $1 on a candidate the bot does not want risks
winning them for $1 and burning a slot; passing burns a market skip. The bot
opens when the candidate is at or near replacement level, opens more readily
when its skips are running out, and follows the opponent's rejection for free
when a near-replacement player is on offer for a dollar.

IMPERFECT ON PURPOSE. A seeded jitter moves the ceiling by up to about 10%,
and with a small seeded probability the bot either stretches one dollar past
its ceiling, steps away one dollar short, or answers a raise with a two-dollar
jump. All are things real bidders do, all are bounded, and none can produce an
illegal bid: every amount is clamped to `private["max_bid"]`, which the server
recomputes from the persisted budget.

INDEPENDENCE FROM THE HUMAN'S ACTION IS THE POINT. `decide` never asks what the
other seat just did; it asks what the CURRENT board is worth to it. A human
pass therefore leaves the bot free to open at $1 and take the player.

`decision_kind` is the PRESENTATION hook: it classifies the decision the bot
is about to make (a quick pass, an ordinary raise, a contested call, a bidding
war) so the mode can pick a think time that reads like the decision. It never
changes what the bot decides.
"""
from __future__ import annotations

import random
from typing import Any, Optional

from nba_peak.twenty_dollar.config import (
    BOT_DIFFICULTY_LABEL,
    BOT_DISPLAY_NAME,
    BOT_POLICY_VERSION,
    BOT_THINK_KIND_CONTESTED,
    BOT_THINK_KIND_ORDINARY,
    BOT_THINK_KIND_QUICK,
    BOT_THINK_KIND_WAR,
    HARD_MAX_LOTS,
    MARKET_CLOSEOUT,
    MIN_RESERVE_PER_SLOT,
    ROSTER_SIZE,
    STANDARD_MARKET_LOTS,
)

COMMAND_BID = "bid"
COMMAND_PASS = "pass"

#: How far the bot's ceiling may drift from one RAISE to the next inside a
#: lot. Small: the per-lot opinion below carries most of the variation, and a
#: ceiling that wandered freely between raises would be walkable.
_JITTER = (0.94, 1.06)

#: THE PER-LOT OPINION. Formed once per lot from public facts (see
#: `_opinion`), never from the score, never from the driver's stream.
#:
#:   * with `_MISJUDGE_CHANCE` the candidate is read as roughly half a band
#:     better than the band says (a believable overvaluation), and with the
#:     same chance half a band worse (a believable undervaluation);
#:   * the ceiling is scaled by a factor inside `_OPINION_SCALE`;
#:   * the pacing share is blurred by up to `_PACING_BLUR`.
_MISJUDGE_CHANCE = 0.22
_MISJUDGE_POINTS = 8.0
_OPINION_SCALE = (0.80, 1.20)
_PACING_BLUR = 0.14

#: What a band is plausibly worth on the final scoreboard, in PEAK3 points.
#: These are the published 1Y board's own band means, rounded; nothing here is
#: recomputed from the model.
_BAND_POINTS: dict[str, float] = {
    "1-10": 93.0,
    "11-25": 88.0,
    "26-50": 78.0,
    "51-100": 67.0,
    "101-250": 57.0,
    "251-500": 47.0,
}
#: Used when only the three-way draw tier reached the projection (an older
#: adapter, a test built the v3 way). The top tier is deliberately valued at
#: its band-weighted mean rather than its ceiling: guessing high would make an
#: unknown candidate expensive, which is the failure mode.
_TIER_POINTS: dict[str, float] = {
    "1-100": 72.0,
    "101-250": 57.0,
    "251-500": 47.0,
}
_DEFAULT_POINTS = 57.0

#: Replacement level, in points, at the two ends of the market.
#: `_REPLACEMENT_EARLY` is what a patient seat can still expect for a slot
#: with plenty of lots to come: roughly a 51-100 peak, because four lots in
#: ten are drawn from the top hundred and a seat that waits will see several.
#: `_REPLACEMENT_LATE` is what autofill hands over. Between them the level
#: falls with the chances left per open slot (`_REPLACEMENT_SPAN_CHANCES`).
#:
#: v5: `_REPLACEMENT_SPAN_CHANCES` was 8, so the early level was never
#: reached (a fresh board offers about three usable chances per slot) and the
#: bot priced every early lot against a 251-500 replacement. Three chances
#: per slot on a board that draws 40% of lots from the top hundred is worth
#: about a 51-100 peak, so that is where the curve now tops out.
_REPLACEMENT_EARLY = 57.0
_REPLACEMENT_LATE = 47.0
_REPLACEMENT_SPAN_CHANCES = 2.5

#: A RICH seat can expect more from the market than a poor one: with eight
#: dollars a slot it will win the next 51-100 peak that comes along, with two
#: it will not. So the replacement level rises with the discretionary money
#: per open slot above the opening fair share, by this many points per
#: dollar, capped. This is what stops a seat holding $15 filling two slots
#: with dollar players on a dry stretch of board and finding, three lots
#: later, that it has one slot for fifteen dollars.
_REPLACEMENT_MONEY_SLOPE = 0.8
_REPLACEMENT_MONEY_CAP = 8.0

#: LIQUIDITY: the money a seat keeps per OTHER open slot, above the rules'
#: one-dollar reserve, so that it can still answer a premium lot later.
#: `_LIQUIDITY_PER_SLOT` dollars when there are plenty of chances left,
#: falling to nothing as the chances per slot approach one -- the market is
#: ending and money is about to score nothing. This is what makes a second
#: early star cost what it costs the rest of the roster.
_LIQUIDITY_PER_SLOT = 1.2
_LIQUIDITY_SPAN_CHANCES = 2.5

#: THE CONTEST: money only matters while somebody can bid against it. Once
#: the opponent's roster is full, or their budget is down to the reserve,
#: every remaining lot costs a dollar and liquidity held past that point is
#: money left on the table. So as the opponent runs short of OPEN SLOTS, a
#: dollar is worth less to keep (the money rate and the liquidity reserve
#: are both scaled by `_CONTEST_URGENCY`, keyed by the opponent's open
#: slots; the last entry also covers an opponent who is out of money or
#: full). The replacement level is NOT scaled: what the market will still
#: offer does not change when the opponent stops bidding.
_CONTEST_URGENCY: dict[int, float] = {2: 0.75, 1: 0.5, 0: 0.5}

#: PACING: the largest share of discretionary money one player may take while
#: this many slots are still open. Stops the double blow-out -- two stars at
#: nine dollars each by lot four, then nothing left to answer a bargain with.
_PACING_SHARE = {5: 0.65, 4: 0.65, 3: 0.85}

#: How many of the remaining lots a seat can expect to be usable AND worth
#: opening on -- draws that fit the roster, are not skipped by both, and are
#: not walked away from. Calibrated from bot-vs-bot sweeps rather than chosen.
_USABLE_LOT_SHARE = 0.55

#: The money rate: points per dollar when a seat holds the opening fair share
#: of discretionary money per slot ($16 over five slots). The exponent says how
#: quickly a dollar gets cheaper as the seat gets richer per slot.
_BASE_POINTS_PER_DOLLAR = 4.2
_FAIR_SHARE_REFERENCE = 3.2
_MONEY_ELASTICITY = 0.85

#: A candidate who fills exactly one open slot is worth this much more than
#: one with several ways in.
_SINGLE_FIT_PREMIUM = 1.10
#: The closeout market is the last chance to fill a slot competitively.
_CLOSEOUT_PREMIUM = 1.25

#: Below this many expected usable lots PER OPEN SLOT the bot treats the
#: market as ending: money is about to be worthless, so the ceiling becomes
#: the whole discretionary budget.
_ENDGAME_CHANCES = 1.25

#: How far below replacement a candidate may sit and still be opened on at $1
#: rather than skipped, in points. Widened when skips are running out and when
#: the opponent has already declined (a free follow).
_OPEN_TOLERANCE = 2.0
_OPEN_TOLERANCE_LOW_SKIPS = 6.0
_OPEN_TOLERANCE_FREE_FOLLOW = 4.0

#: How often the bot makes a small, bounded, deliberate error.
_STRETCH_CHANCE = 0.14   # one dollar past the ceiling
_FLINCH_CHANCE = 0.12    # steps away one dollar early
_JUMP_CHANCE = 0.18      # answers a raise with a two-dollar jump


class TwentyDollarBot:
    """A bidding policy for The $20 Showdown's ascending auction."""

    def __init__(
        self,
        bot_id: str = "twenty_dollar_v5",
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

    @staticmethod
    def candidate_points(private: dict) -> float:
        """What the candidate is plausibly worth on the scoreboard, in points."""
        band = str(private.get("candidate_band") or "")
        if band in _BAND_POINTS:
            return _BAND_POINTS[band]
        tier = str(private.get("candidate_tier") or "")
        return _TIER_POINTS.get(tier, _DEFAULT_POINTS)

    @staticmethod
    def _chances_per_slot(public: dict, open_slots: int) -> float:
        """Expected usable lots still to come, per slot this seat has to fill."""
        lot_index = int(public.get("lot_index", 0))
        standard = int(public.get("standard_market_lots", STANDARD_MARKET_LOTS))
        hard_max = int(public.get("max_lots", HARD_MAX_LOTS))
        if public.get("market_phase") == MARKET_CLOSEOUT:
            remaining = max(0, hard_max - lot_index)
        else:
            # The standard market plus a conservative slice of the closeout
            # that follows it when a roster is still short.
            remaining = max(0, standard - lot_index) + min(4, max(0, hard_max - standard))
        return (remaining * _USABLE_LOT_SHARE) / max(1, open_slots)

    @staticmethod
    def _replacement_level(chances: float, fair_share: float = _FAIR_SHARE_REFERENCE) -> float:
        """What a slot can still expect from the market, given the chances
        left and the money per slot this seat can bring to them."""
        span = _REPLACEMENT_EARLY - _REPLACEMENT_LATE
        fraction = max(0.0, min(1.0, (chances - 1.0) / _REPLACEMENT_SPAN_CHANCES))
        money = max(
            0.0,
            min(_REPLACEMENT_MONEY_CAP, (fair_share - _FAIR_SHARE_REFERENCE) * _REPLACEMENT_MONEY_SLOPE),
        )
        return _REPLACEMENT_LATE + span * fraction + money * fraction

    @staticmethod
    def _contest_urgency(public: dict, seat_index: int) -> float:
        """How much a kept dollar is still worth, from the opponent's public
        open slots and budget. 1.0 while they can keep bidding for a while."""
        open_slots = 0
        for seat in public.get("seats") or []:
            if seat.get("seat_index") == seat_index or seat.get("roster_full"):
                continue
            slots = len(seat.get("open_slots") or [])
            discretionary = int(seat.get("budget", 0)) - (slots - 1) * MIN_RESERVE_PER_SLOT
            if slots <= 0 or discretionary < 2:
                continue  # can only ever bid the reserve dollar: not a contest
            open_slots += slots
        if open_slots >= 3:
            return 1.0
        return _CONTEST_URGENCY.get(open_slots, 1.0)

    @staticmethod
    def _liquidity_per_slot(chances: float) -> float:
        """Dollars kept liquid per OTHER open slot, above the rules' reserve."""
        fraction = max(0.0, min(1.0, (chances - 1.0) / _LIQUIDITY_SPAN_CHANCES))
        return _LIQUIDITY_PER_SLOT * fraction

    @staticmethod
    def _opinion(public: dict, private: dict) -> dict:
        """This seat's opinion of THIS lot: a shift in points, a scale on the
        ceiling and a blur on the pacing cap. Held for the whole lot.

        Keyed on public facts that are fixed while the lot is live -- who is
        up, which lot it is, which seat is deciding and what both budgets are
        -- so every raise inside the lot is priced from the same opinion, a
        replay reproduces it exactly, and two matches with different boards
        form different opinions. Nothing hidden is in the key; there is
        nothing hidden in the projection to put there.
        """
        candidate = public.get("candidate") or {}
        budgets = ",".join(
            str(int(seat.get("budget", 0))) for seat in public.get("seats") or []
        )
        key = (
            f"tds-opinion:{candidate.get('player_slug', '')}:{public.get('lot_index', 0)}"
            f":{private.get('seat_index', 0)}:{budgets}"
        )
        stream = random.Random(key)
        roll = stream.random()
        shift = 0.0
        if roll < _MISJUDGE_CHANCE:
            shift = _MISJUDGE_POINTS
        elif roll < 2 * _MISJUDGE_CHANCE:
            shift = -_MISJUDGE_POINTS
        return {
            "shift": shift,
            "scale": stream.uniform(*_OPINION_SCALE),
            "pacing_blur": stream.uniform(-_PACING_BLUR, _PACING_BLUR),
        }

    @staticmethod
    def _points_per_dollar(discretionary: int, open_slots: int) -> float:
        """How many points a marginal dollar has to buy to be worth spending."""
        fair_share = max(0.5, discretionary / max(1, open_slots))
        return _BASE_POINTS_PER_DOLLAR * (_FAIR_SHARE_REFERENCE / fair_share) ** _MONEY_ELASTICITY

    def valuation(self, public: dict, private: dict) -> dict:
        """Every intermediate the ceiling is built from, for tests and reports.

        Deterministic: no RNG is consulted here. `ceiling` is the pre-jitter
        ceiling in whole dollars; `decide` applies the seeded jitter and the
        bounded mistakes on top.
        """
        max_bid = int(private.get("max_bid", 0))
        seat_index = int(private.get("seat_index", 0))
        me = _seat(public, seat_index)
        empty = {
            "points": 0.0, "replacement": 0.0, "rate": 0.0, "chances": 0.0,
            "urgency": 1.0, "discretionary": 0, "liquid": 0, "want": -999.0,
            "ceiling": 0, "endgame": False,
        }
        if max_bid < 1 or not private.get("can_acquire_candidate") or me is None:
            return empty

        fits = list(private.get("candidate_fits") or [])
        if not fits:
            return empty  # fills nothing on this roster; worth nothing, whoever they are

        open_slots = list(me.get("open_slots") or [])
        remaining = max(1, len(open_slots))
        budget = int(me.get("budget", 0))
        discretionary = max(0, budget - (remaining - 1) * MIN_RESERVE_PER_SLOT)

        opinion = self._opinion(public, private)
        points = self.candidate_points(private) + opinion["shift"]
        chances = self._chances_per_slot(public, remaining)
        replacement = self._replacement_level(chances, discretionary / remaining)
        # Money is only worth keeping while there is somebody to outbid.
        urgency = self._contest_urgency(public, seat_index)
        # THE LIQUID BUDGET: what this one lot may draw on once every other
        # open slot keeps its reserve AND its share of future optionality.
        liquid = max(
            0,
            int(
                discretionary
                - (remaining - 1) * self._liquidity_per_slot(chances) * urgency
            ),
        )
        rate = self._points_per_dollar(discretionary, remaining) * urgency
        want = points - replacement

        value = (1.0 + max(0.0, want) / rate) * opinion["scale"]

        usable = [slot for slot in fits if slot in open_slots] or fits
        if len(usable) == 1:
            value *= _SINGLE_FIT_PREMIUM
        if public.get("market_phase") == MARKET_CLOSEOUT:
            value *= _CLOSEOUT_PREMIUM

        pacing = _PACING_SHARE.get(remaining)
        if pacing is not None:
            pacing = max(0.3, min(0.95, pacing + opinion["pacing_blur"]))
            value = min(value, max(1.0, liquid * pacing))
        value = min(value, max(1.0, float(liquid)))

        endgame = chances <= _ENDGAME_CHANCES
        if endgame and want > -8.0:
            # Money is about to be worthless. Anything at or near replacement
            # is worth the whole discretionary budget; a genuinely poor
            # candidate still gets the ordinary price, because autofill would
            # hand over one just as poor for a dollar.
            value = max(value, float(discretionary))

        ceiling = max(0, min(int(round(value)), discretionary, max_bid))
        return {
            "points": points, "replacement": replacement, "rate": rate,
            "chances": chances, "urgency": urgency, "discretionary": discretionary,
            "liquid": liquid, "want": want, "ceiling": ceiling, "endgame": endgame,
        }

    def ceiling(self, public: dict, private: dict, rng: random.Random) -> int:
        """The most this bot will pay for the candidate on the board.

        Computed BEFORE the standing bid is consulted, and deliberately not a
        function of it: a ceiling that moved with the price is a bot that can
        be walked up indefinitely by an opponent who has noticed.
        """
        base = self.valuation(public, private)["ceiling"]
        if base <= 0:
            return 0
        max_bid = int(private.get("max_bid", 0))
        return max(0, min(int(round(base * rng.uniform(*_JITTER))), max_bid))

    def _wants_to_open(self, public: dict, private: dict) -> bool:
        """With nothing bid, is this candidate worth a dollar and a slot?"""
        v = self.valuation(public, private)
        if v["ceiling"] <= 0:
            return False
        seat_index = int(private.get("seat_index", 0))
        me = _seat(public, seat_index) or {}
        open_slots = max(1, len(me.get("open_slots") or []))
        skips = int(private.get("market_skips", 0))
        tolerance = _OPEN_TOLERANCE
        if skips < open_slots:
            tolerance = _OPEN_TOLERANCE_LOW_SKIPS
        if private.get("lot_already_rejected") or not private.get("pass_consumes_skip", True):
            tolerance = max(tolerance, _OPEN_TOLERANCE_FREE_FOLLOW)
        if v["endgame"]:
            tolerance = max(tolerance, 8.0)
        return v["want"] >= -tolerance

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

        standing = int(public.get("current_bid") or 0)
        if standing <= 0:
            # THE OPENING DECISION is about the slot and the skip, not the
            # ceiling: opening costs a dollar and risks a slot; passing costs
            # a token. See `_wants_to_open`.
            if self._wants_to_open(public, private):
                return COMMAND_BID, {"amount": min(minimum, max_bid)}
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

        amount = minimum
        # A JUMP RAISE, occasionally, when the ceiling is well clear of the
        # price: it ends a walk-up sooner and makes the ceiling harder to
        # read. Never past the ceiling, never past the legal maximum -- and
        # never against an opponent who could not answer the minimum anyway
        # (their budget is public; raising against nobody is not a tactic).
        if (
            limit - minimum >= 3
            and self._opponent_can_answer(public, private, minimum)
            and rng.random() < _JUMP_CHANCE
        ):
            amount = minimum + 1
        return COMMAND_BID, {"amount": max(1, min(amount, limit, max_bid))}

    def decision_kind(self, public: dict, private: dict) -> str:
        """Which KIND of decision the bot is about to make -- presentation only.

        Read by the mode's think-time hook. Deterministic and RNG-free, so
        every poller computes the same answer for the same turn.
        """
        if not private.get("is_your_turn") or not private.get("can_acquire_candidate"):
            return BOT_THINK_KIND_QUICK
        minimum = int(private.get("minimum_bid", 1))
        max_bid = int(private.get("max_bid", 0))
        if minimum > max_bid:
            return BOT_THINK_KIND_QUICK
        standing = int(public.get("current_bid") or 0)
        v = self.valuation(public, private)
        if standing <= 0:
            return BOT_THINK_KIND_ORDINARY if self._wants_to_open(public, private) else BOT_THINK_KIND_QUICK
        raises = sum(1 for a in (public.get("lot_actions") or []) if a.get("action") == COMMAND_BID)
        if minimum > v["ceiling"] + 1:
            return BOT_THINK_KIND_QUICK  # a price it was never going to pay
        if v["ceiling"] >= 4 and abs(minimum - v["ceiling"]) <= 1:
            return BOT_THINK_KIND_CONTESTED
        if raises >= 4:
            return BOT_THINK_KIND_WAR
        return BOT_THINK_KIND_ORDINARY

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
    def _opponent_can_answer(public: dict, private: dict, amount: int) -> bool:
        """Could the other seat still legally raise over `amount`?

        Read from the published budget and filled-slot count, through the
        same reserve rule the server applies. Used only to decide whether a
        jump raise has anyone to jump over.
        """
        seat_index = int(private.get("seat_index", 0))
        for seat in public.get("seats") or []:
            if seat.get("seat_index") == seat_index:
                continue
            if seat.get("roster_full") or not seat.get("in_lot", True):
                continue
            filled = int(seat.get("filled_slots", 0))
            open_after = max(0, ROSTER_SIZE - filled - 1)
            legal_max = int(seat.get("budget", 0)) - open_after * MIN_RESERVE_PER_SLOT
            if legal_max >= amount + 1:
                return True
        return False

    @staticmethod
    def _opponent_could_use(public: dict, seat_index: int) -> bool:
        """Could any other seat plausibly want this candidate?

        Uses only published fields: the other seat's remaining budget, how many
        slots it still has open, whether it is still live in this lot, and how
        many market skips it has left -- intersected with the candidate's
        positions. It deliberately does NOT consult a feasibility oracle for
        the opponent; a human cannot run one either.
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
