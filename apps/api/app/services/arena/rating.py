"""Turning a settled Arena match into rating changes.

ONE RATING IMPLEMENTATION IN THIS REPOSITORY. `app/services/ranked/glicko2.py`
is Glickman's published algorithm implemented step-for-step with the paper's own
step numbers, and it is REUSED here rather than reimplemented. Nothing in this
module does rating arithmetic; it decides WHO PLAYED WHOM and hands that to
`rate_period`.

N PLAYERS -> PAIRWISE, IN ONE RATING PERIOD
-------------------------------------------
Glicko-2 is a two-player system. A three-player match is decomposed into the
pairings it contains -- first beat second and third, second beat third -- and
all of a player's opponents are passed to `rate_period` as ONE rating period,
because they were faced simultaneously in one match.

That is the distinction that matters, and it is not cosmetic. Rating a
three-player match as two independent one-match periods would apply the first
opponent's result, move the player's rating and RD, and then judge the second
opponent against the moved value -- so the answer would depend on the order the
opponents happened to be iterated in. `rate_period` accumulates both terms
against the SAME pre-match rating (Glickman's Step 3/4 summations), which is
both order-independent and what the paper actually specifies. `rate_match` is a
thin one-opponent wrapper over it, so the two-player $20 Showdown gets the
identical treatment with a single term.

TIES SHARE A PLACEMENT. `arena_match_results.placement` uses standard
competition ranking (foundation:511-513): a three-way tie is 1/1/1, and the seat
after a two-way tie for first is 3. So the pairwise score is decided by
COMPARING placements, never by assuming placement 1 means "won" -- in a 1/1/1
match every pairing is a draw and every rating barely moves, which is correct.

WHY THERE IS NO DAILY CAP
-------------------------
A per-day match cap punishes the honest high-volume player -- the person most
engaged with the mode -- to inconvenience an abuser who can simply spread the
same activity across more accounts or more days. Three controls are used
instead, and each addresses a different half of the problem:

  * CALIBRATED BOT RATINGS. Farming bots is only profitable if the bot's rating
    is wrong. It is pinned per seat at seat time (`bots.bot_seat`), so beating
    a bot moves a rating by exactly what beating something of that strength is
    worth, and a player far above it gains ~nothing.
  * A BOUNDED PER-MATCH CHANGE. See MAX_RATING_CHANGE_PER_MATCH below. This
    caps the damage any single match can do without limiting how many a player
    may enjoy.
  * VISIBLE ACTIVATIONS. `arena_rating_history.unbounded_post_rating` and
    `bound_applied` record what Glicko-2 wanted before the bound was applied,
    so repeated large clamps are queryable. A control whose activations are
    invisible cannot be monitored, and "add a cap" would have been a guess
    where this is a measurement.

PRIVATE AND PRACTICE CANNOT REACH THIS MODULE. `arena_matches` carries
`CHECK (rated = (entry_path = 'public_queue'))` and `arena_match_results.rated`
is a settlement-time copy of that verdict. `rating_inputs_for_match` refuses any
result whose `rated` is False rather than filtering it out silently, so the
invariant is stated twice -- once in the database and once here -- and a bug
that let an unrated match through fails loudly instead of quietly minting
rating.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Sequence

from app.services.ranked.glicko2 import (
    RATING_DECIMALS,
    Glicko2Opponent,
    Glicko2Rating,
    initial_rating,
    rate_period,
)
from app.services.ranked.versions import GLICKO2_ALGORITHM_VERSION

#: This module's own version string, distinct from the ranked queue's.
#:
#: Composed rather than reused verbatim: the arithmetic is shared with ranked,
#: but the DECOMPOSITION (how a three-player match becomes pairings) is this
#: module's decision, and a change to it must be traceable without implying the
#: underlying algorithm also changed.
ARENA_RATING_ALGORITHM_VERSION = f"arena_pairwise_v1+{GLICKO2_ALGORITHM_VERSION}"

#: The most a single match may move a rating, in Glicko-1 display points.
#:
#: A BLAST-RADIUS LIMIT, NOT A FRAUD DETECTOR. It caps how far one settlement
#: can move a rating, so that a single anomalous match -- a placement assigned
#: wrongly, a bot seated with a plausible-but-wrong calibration, an unusual
#: convergence -- cannot write a number that no later correction can un-see.
#: Players screenshot leaderboards; an unrecoverable spike is a support problem
#: long after the row is fixed.
#:
#: 400 IS MEASURED, NOT GUESSED. Actual unbounded deltas from this module
#: (three-player sweeps unless noted):
#:
#:     established (RD 50) beats two peers                 +14
#:     established beats two much weaker                    +2
#:     established loses to two much weaker                -28
#:     two-player, established beats peer                   +7
#:     mid-RD (150) sweeps two peers                       +90
#:     provisional (RD 350) sweeps two peers               +247
#:     provisional sweeps two RD-50 opponents              +234
#:     provisional sweeps two 2800-rated opponents       +1386
#:
#: So 400 never binds for established or mid-RD play, and never binds for a
#: provisional player against peers. It binds only for a provisional player
#: against opposition far outside their rating -- deliberately, and at a cost
#: stated plainly: such a player reaches their true rating over a few matches
#: rather than one. That is the trade for the guarantee.
#:
#: IT IS NOT THE DEFENCE AGAINST CORRUPT DATA, and should not be mistaken for
#: one. A genuinely absurd opponent rating does not produce a large delta to
#: clamp -- it raises `OverflowError` inside glicko2's volatility solve, which
#: is a loud failure and the better outcome. This bound handles values that are
#: wrong but plausible; the algorithm handles values that are impossible.
#:
#: Deliberately NOT a balance knob. Lowering it until it routinely binds would
#: replace Glicko-2 with a slower linear system while still calling itself
#: Glicko-2 -- which is exactly why every activation is recorded in
#: `arena_rating_history.bound_applied` rather than being invisible.
MAX_RATING_CHANGE_PER_MATCH = 400.0

#: The rating deviation attributed to a bot opponent.
#:
#: A bot has no rating history to estimate uncertainty from, but it also needs
#: none: its rating is a CALIBRATED CONSTANT pinned onto the seat at seat time,
#: not an estimate that could be stale. 50 reflects that -- low, matching a
#: well-established player, so beating a bot informs the player's rating about
#: as much as beating a known-strength human would.
#:
#: Not zero, which would claim perfect knowledge of a bot's true strength and
#: make bot results dominate a player's rating. The bot is calibrated, not
#: omniscient.
BOT_OPPONENT_RD = 50.0


@dataclass(frozen=True)
class PairwiseOpponent:
    """One opponent faced in this match, and the result against them."""

    seat_index: int
    score: float  # 1.0 win, 0.5 draw, 0.0 loss -- from placement comparison
    rating: float
    rd: float
    was_bot: bool

    def as_dict(self) -> dict:
        return {
            "opponent_seat": self.seat_index,
            "score": self.score,
            "opponent_rating": self.rating,
            "opponent_rd": self.rd,
            "was_bot": self.was_bot,
        }


@dataclass(frozen=True)
class SeatRatingInput:
    """Everything needed to rate one seat's result in one match."""

    seat_index: int
    owner_sub: str
    placement: int
    pre: Glicko2Rating
    opponents: tuple[PairwiseOpponent, ...] = field(default_factory=tuple)

    @property
    def had_bot_opponent(self) -> bool:
        return any(o.was_bot for o in self.opponents)


@dataclass(frozen=True)
class SeatRatingOutcome:
    """One seat's computed rating change, ready to persist."""

    seat_index: int
    owner_sub: str
    placement: int
    pre: Glicko2Rating
    post: Glicko2Rating
    unbounded_post_rating: float
    bound_applied: bool
    opponents: tuple[PairwiseOpponent, ...]

    @property
    def had_bot_opponent(self) -> bool:
        return any(o.was_bot for o in self.opponents)


class UnratedMatch(RuntimeError):
    """Raised when a rating pass is handed a match that must not be rated.

    Deliberately an exception and not a silent filter: `rated` is already
    guaranteed by a database CHECK, so a False reaching here means something
    upstream is wrong, and continuing quietly would mint rating from a private
    room. See the module docstring.
    """


def pairwise_score(my_placement: int, their_placement: int) -> float:
    """The Glicko-2 score for one pairing, from two placements.

    Lower placement is better. Equal placements are a draw -- which is how a
    shared placement (a tie) is expressed, and why this compares rather than
    special-casing placement 1.
    """
    if my_placement < their_placement:
        return 1.0
    if my_placement > their_placement:
        return 0.0
    return 0.5


def rating_inputs_for_match(
    results: Sequence[dict],
    ratings_by_sub: dict[str, Glicko2Rating],
) -> list[SeatRatingInput]:
    """Decompose one settled match into per-human-seat rating inputs.

    `results` is one dict per seat, carrying at least `seat_index`,
    `placement`, `rated`, `was_bot`, and -- for human seats -- `owner_sub`; bot
    seats carry `bot_rating`. This is the shape
    `arena_match_results JOIN arena_match_seats` produces, passed as plain dicts
    so this function is testable without a database.

    Bots are rated AGAINST but never rated: a bot has no persistent rating to
    update, and giving one would let a player farm a number that then makes
    future wins over it worth more.
    """
    for row in results:
        if not row.get("rated"):
            raise UnratedMatch(
                f"seat {row.get('seat_index')} belongs to an unrated match; "
                "private-room and practice results must never reach the rating "
                "pass (arena_matches CHECK rated = (entry_path = 'public_queue'))"
            )

    inputs: list[SeatRatingInput] = []
    for row in results:
        if row.get("was_bot"):
            continue  # rated against, never rated
        owner_sub = row["owner_sub"]
        opponents: list[PairwiseOpponent] = []
        for other in results:
            if other["seat_index"] == row["seat_index"]:
                continue
            if other.get("was_bot"):
                # The CALIBRATED rating pinned on the seat at seat time. Read,
                # never recomputed -- a recalibration must not change what a
                # settled match was played against.
                opp_rating = float(other["bot_rating"])
                opp_rd = BOT_OPPONENT_RD
            else:
                opp = ratings_by_sub.get(other["owner_sub"]) or initial_rating()
                opp_rating, opp_rd = opp.rating, opp.rd
            opponents.append(
                PairwiseOpponent(
                    seat_index=other["seat_index"],
                    score=pairwise_score(row["placement"], other["placement"]),
                    rating=opp_rating,
                    rd=opp_rd,
                    was_bot=bool(other.get("was_bot")),
                )
            )
        inputs.append(
            SeatRatingInput(
                seat_index=row["seat_index"],
                owner_sub=owner_sub,
                placement=row["placement"],
                pre=ratings_by_sub.get(owner_sub) or initial_rating(),
                opponents=tuple(opponents),
            )
        )
    return inputs


def rate_seat(seat: SeatRatingInput) -> SeatRatingOutcome:
    """Rate one seat: all its opponents, one rating period, then the bound.

    EVERY OPPONENT IN ONE CALL. See the module docstring -- passing them one at
    a time would make the result depend on iteration order.
    """
    post = rate_period(
        seat.pre,
        [
            Glicko2Opponent(rating=o.rating, rd=o.rd, score=o.score)
            for o in seat.opponents
        ],
    )

    unbounded = post.rating
    delta = unbounded - seat.pre.rating
    bound_applied = abs(delta) > MAX_RATING_CHANGE_PER_MATCH
    if bound_applied:
        bounded = seat.pre.rating + (
            MAX_RATING_CHANGE_PER_MATCH if delta > 0 else -MAX_RATING_CHANGE_PER_MATCH
        )
        # RD and volatility are NOT bounded. They describe how confident the
        # system is, not how much was won, and clamping them would claim a
        # certainty the algorithm did not reach -- which would then distort
        # every subsequent match. Only the visible score is bounded.
        post = Glicko2Rating(
            rating=round(bounded, RATING_DECIMALS),
            rd=post.rd,
            volatility=post.volatility,
        )

    return SeatRatingOutcome(
        seat_index=seat.seat_index,
        owner_sub=seat.owner_sub,
        placement=seat.placement,
        pre=seat.pre,
        post=post,
        unbounded_post_rating=round(unbounded, RATING_DECIMALS),
        bound_applied=bound_applied,
        opponents=seat.opponents,
    )


def rate_match_results(
    results: Sequence[dict],
    ratings_by_sub: dict[str, Glicko2Rating],
) -> list[SeatRatingOutcome]:
    """The whole pass for one match: decompose, then rate every human seat.

    Every seat is rated against the ratings as they stood BEFORE this match --
    `ratings_by_sub` is read once and never updated mid-loop -- so two players
    in the same match cannot see different versions of each other, and the
    result does not depend on which seat is processed first.
    """
    return [rate_seat(s) for s in rating_inputs_for_match(results, ratings_by_sub)]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def settle_match_rating(
    arena_repo,
    rating_repo,
    match,
    now: Optional[datetime] = None,
) -> int:
    """Record the rating changes for a completed rated match. Returns rows written.

    LAZY AND IDEMPOTENT, because there is no background worker in this
    application. This is called from the same `_advance` path that runs the
    clock and drives bots, so it fires on the next request that touches the
    match -- and it is therefore called many times for one match. The unique
    index `arena_rating_history_one_per_player_match_idx` is what makes every
    call after the first write nothing; there is deliberately no "already
    rated?" read to decide, because that check-then-write is the race two
    concurrent requests both win.

    Returns 0, not an error, for a match that is not finished, not rated, or
    already rated. Only the first of those three is a state that will change.
    """
    from app.repositories.arena_protocols import MATCH_STATUS_COMPLETED
    from app.repositories.arena_rating_protocols import ArenaRatingHistoryEntry

    if match.status != MATCH_STATUS_COMPLETED or not match.rated:
        return 0

    results = await arena_repo.get_results(match.match_id)
    if not results:
        return 0
    seats = {s.seat_index: s for s in await arena_repo.get_seats(match.match_id)}

    rows: list[dict] = []
    for result in results:
        seat = seats.get(result.seat_index)
        row = {
            "seat_index": result.seat_index,
            "placement": result.placement,
            "rated": result.rated,
            "was_bot": result.was_bot,
        }
        if result.was_bot:
            # The calibrated rating pinned at seat time. Read from the seat,
            # never recomputed -- the whole point of pinning it.
            row["bot_rating"] = seat.bot_rating if seat else None
            if row["bot_rating"] is None:
                # A bot seat with no pinned rating cannot be rated against
                # without inventing a number, and inventing one would silently
                # decide what a rated match was worth. Skip the whole match.
                return 0
        else:
            if seat is None or not seat.occupant_sub:
                return 0
            row["owner_sub"] = seat.occupant_sub
        rows.append(row)

    humans = [r["owner_sub"] for r in rows if not r["was_bot"]]
    if not humans:
        return 0

    current = await rating_repo.get_ratings_for_subs(humans, match.mode)
    as_glicko = {
        sub: Glicko2Rating(rating=r.rating, rd=r.rd, volatility=r.volatility)
        for sub, r in current.items()
    }

    outcomes = rate_match_results(rows, as_glicko)
    entries = [
        ArenaRatingHistoryEntry(
            owner_sub=o.owner_sub,
            mode=match.mode,
            match_id=match.match_id,
            pre_rating=o.pre.rating,
            pre_rd=o.pre.rd,
            pre_volatility=o.pre.volatility,
            post_rating=o.post.rating,
            post_rd=o.post.rd,
            post_volatility=o.post.volatility,
            unbounded_post_rating=o.unbounded_post_rating,
            bound_applied=o.bound_applied,
            placement=o.placement,
            opponents=[op.as_dict() for op in o.opponents],
            had_bot_opponent=o.had_bot_opponent,
            bot_policy_version=match.bot_policy_version,
            algorithm_version=ARENA_RATING_ALGORITHM_VERSION,
        )
        for o in outcomes
    ]
    return await rating_repo.record_match_rating(entries, now or _now())


__all__ = [
    "ARENA_RATING_ALGORITHM_VERSION",
    "BOT_OPPONENT_RD",
    "MAX_RATING_CHANGE_PER_MATCH",
    "PairwiseOpponent",
    "SeatRatingInput",
    "SeatRatingOutcome",
    "UnratedMatch",
    "pairwise_score",
    "rate_match_results",
    "rate_seat",
    "rating_inputs_for_match",
]
