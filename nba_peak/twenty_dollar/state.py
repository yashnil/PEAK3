"""The ascending-auction state machine. Pure rules over a serialisable snapshot.

SHAPE OF THE SNAPSHOT
---------------------
One JSON-safe dict, which the foundation persists as `arena_matches.snapshot`
and hands back to `reduce` unchanged. Nothing here reads a clock, a database or
a file at transition time (see `warm_pool` for why the pool is loaded up
front), so every function in this module is a pure function of its arguments --
which is what lets the foundation call it while holding the match's row lock.

ONE PLAYER ACTS AT A TIME, AND EVERY BID IS PUBLIC
---------------------------------------------------
v1 was sealed-bid: each seat locked a hidden amount and the round resolved when
both had. That model is retired. A lot now runs as an ascending auction:

  * `opening_seat` may open at `MIN_OPENING_BID` or pass.
  * If the opener passes with no live bid, the opponent may open or pass. An
    opener who has passed is OUT of that lot, so an opponent who then opens
    wins at their own opening amount -- there is nobody left to answer.
  * Once a bid stands, the other live seat raises by at least `MIN_RAISE` or
    passes. Passing removes them from the lot and the standing high bidder
    wins at exactly what they said.
  * Both passing with no bid leaves the candidate unsold.

Sequential bidding makes a tie unreachable, which is why the `tie_priority`
token is gone rather than retained. It also means there is NO per-seat secret
in a live lot: budgets, rosters, the standing bid and who is on the clock are
all public, because all four are things a player at a real auction table can
see.

WHAT IS STILL HIDDEN, AND UNTIL WHEN
-------------------------------------
The candidate's exact career-best 1Y PEAK3 score, their published rank and
their component breakdown. Those ARE the thing being bid on: revealing them
mid-lot would turn a judgement about a player into arithmetic. They are
published in full the instant the lot resolves, because at that point they are
the result and a receipt that could not be checked is not a receipt.

`Candidate.public_dict` is the allowlist that enforces it -- named keys copied
in deliberately, never a `dict(state)` with fields deleted. The deletion form
is what leaked an opponent's run id out of a settled head-to-head receipt
(`api/v1/head_to_head.py:183-201`), because a field added upstream is included
by default and nobody remembers to strip it.
"""
from __future__ import annotations

import random
from typing import Optional

from nba_peak.twenty_dollar import feasibility, rules
from nba_peak.twenty_dollar.config import (
    AUTOFILL_PRICE,
    CLOSEOUT_FIT_GUARANTEE_LOTS,
    HARD_MAX_LOTS,
    MARKET_CLOSEOUT,
    MARKET_SKIPS_PER_SEAT,
    MARKET_STANDARD,
    MIN_OPENING_BID,
    MODEL_VERSION,
    POOL_TIERS,
    QUALIFIED_POOL_SIZE,
    ROSTER_SIZE,
    RULESET_VERSION,
    SEAT_COUNT,
    SLOTS,
    STANDARD_MARKET_LOTS,
    STARTING_BUDGET,
)
from nba_peak.twenty_dollar.pool import Candidate, CandidatePool, get_pool

PHASE_AUCTION = "auction"
PHASE_COMPLETE = "complete"

#: Kept as an alias because the foundation stores a phase string on every turn
#: row and an in-flight v1 match would otherwise read as an unknown phase.
PHASE_BIDDING = PHASE_AUCTION

COMMAND_BID = "bid"
COMMAND_PASS = "pass"

#: Why a lot ended, recorded on the history row so a receipt can say it in
#: words rather than inferring it from the numbers.
DECIDED_BY_BID = "bid"
DECIDED_BY_PASS_OUT = "pass_out"
DECIDED_BY_UNSOLD = "unsold"
DECIDED_BY_AUTOFILL = "autofill"

#: Rejection codes. Distinct strings so a route can map them without parsing
#: prose, and so a test asserts on the code rather than on a sentence. Each one
#: is also a reason the UI must be able to render beside a disabled control --
#: see `project`'s `bid_blocked_reason`.
REJECT_NOT_BIDDING = "not_bidding"
REJECT_NOT_YOUR_TURN = "not_your_turn"
REJECT_ROSTER_FULL = "roster_full"
REJECT_BID_NOT_INTEGER = "bid_not_integer"
REJECT_BID_TOO_LOW = "bid_too_low"
REJECT_BID_OVER_MAX = "bid_over_max"
REJECT_CANDIDATE_UNFIT = "candidate_unfit"
REJECT_ALREADY_PASSED = "already_passed"
REJECT_VERSION_MISMATCH = "ruleset_version_mismatch"
#: You are out of market skips and this candidate legally fits you with no
#: standing bid. Opening at $1 is the only move.
REJECT_NO_MARKET_SKIPS = "no_market_skips"


class RulesetVersionMismatch(ValueError):
    """A snapshot written under a different ruleset.

    Refused rather than reinterpreted. A v1 sealed-bid snapshot has no
    `active_seat`, no `current_bid` and a `tie_priority_seat` this ruleset does
    not honour; running v2 transitions over it would settle an auction under
    rules its players never agreed to.
    """


def assert_supported_version(state: dict) -> None:
    stored = state.get("ruleset_version")
    if stored and stored != RULESET_VERSION:
        raise RulesetVersionMismatch(
            f"snapshot was written under {stored!r}; this build plays {RULESET_VERSION!r}"
        )


def warm_pool() -> CandidatePool:
    """Load the candidate pool before any reducer runs.

    A reducer must do no I/O -- it is called inside the match transaction while
    holding a row lock, so one slow file read would become every concurrent
    match's problem (`MatchReducer` constraint 1). `get_pool` is `lru_cache`d,
    so the only question is who pays for the first call. This function exists so
    the answer is "module import", never "whichever match happened to be first".
    """
    return get_pool()


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------


def opening_seat_for(seed: int, seat_count: int = SEAT_COUNT) -> int:
    """Who opens the FIRST lot, from the match seed and nothing else.

    Published in the very first projection, before any candidate is revealed.
    There is no hidden randomness in this mode: the seed is persisted, every
    draw is a keyed stream off it, and the one random decision a player cares
    about is announced up front.
    """
    return random.Random(f"arena:{seed}:opening").randrange(seat_count)


def initial_state(seed: int, seat_count: int = SEAT_COUNT) -> dict:
    """The opening state, a pure function of the seed."""
    pool = warm_pool()
    opener = opening_seat_for(seed, seat_count)
    state: dict = {
        "ruleset_version": RULESET_VERSION,
        # Stamped into the snapshot, not merely inherited from
        # `ArenaMatch.model_version`, so a settled match carries its own
        # provenance and a later change to the platform default cannot rewrite
        # what this auction was scored under.
        "model_version": MODEL_VERSION,
        "seed": int(seed),
        "phase": PHASE_AUCTION,
        "lot_index": 0,
        "max_lots": HARD_MAX_LOTS,
        "standard_market_lots": STANDARD_MARKET_LOTS,
        "market_phase": MARKET_STANDARD,
        # Consecutive CLOSEOUT lots each seat has been offered without a
        # legally fitting candidate. Drives the feasibility guarantee; zero
        # and unused during the standard market.
        "closeout_dry_lots": [0] * seat_count,
        "seats": [
            {
                "budget": STARTING_BUDGET,
                "roster": [],
                "market_skips": MARKET_SKIPS_PER_SEAT,
            }
            for _ in range(seat_count)
        ],
        "offered": [],
        "history": [],
        "current_candidate": None,
        "opening_seat": opener,
        # Alternates after EVERY lot, resolved or unsold (brief rule 5). Held
        # separately from `opening_seat` so the alternation is a property of
        # the match rather than something re-derived from the last winner.
        "next_opening_seat": (opener + 1) % seat_count,
        "active_seat": None,
        "high_bidder": None,
        "current_bid": 0,
        "passed": [False] * seat_count,
        "lot_bids": [0] * seat_count,
        "lot_actions": [],
        "autofilled": False,
    }
    _advance_lot(state, pool, first=True)
    return state


# ---------------------------------------------------------------------------
# Roster helpers
# ---------------------------------------------------------------------------


def _owned(seat: dict, pool: CandidatePool) -> list[tuple[str, frozenset[str]]]:
    return [(e["player_slug"], pool.get(e["player_slug"]).positions) for e in seat["roster"]]


def _filled(seat: dict) -> int:
    return len(seat["roster"])


def _roster_full(seat: dict) -> bool:
    return _filled(seat) >= ROSTER_SIZE


def _taken_slugs(state: dict) -> set[str]:
    out: set[str] = set()
    for seat in state["seats"]:
        for entry in seat["roster"]:
            out.add(entry["player_slug"])
    return out


def _supply(state: dict, pool: CandidatePool) -> feasibility.PositionSupply:
    """Position supply of every QUALIFIED candidate still acquirable by anyone.

    Excludes players already rostered and players already offered -- an offered
    candidate leaves the board for good, so counting them as future fillers
    would make the feasibility check optimistic in exactly the way that strands
    a seat late.

    Counted over `pool.qualified` rather than the whole artifact, because the
    qualified cut is what a lot may actually draw from: a feasibility answer
    that leaned on rank-900 centres nobody will ever be offered would be a
    promise the board cannot keep.

    Built ONCE per call site and then narrowed with `.without(...)` per
    candidate, rather than rebuilt per candidate. The naive form rebuilt a
    five-hundred-element list five hundred times per lot inside the match
    transaction; see `PositionSupply`'s docstring.
    """
    gone = _taken_slugs(state) | set(state["offered"])
    return feasibility.PositionSupply(
        c.positions for c in pool.qualified if c.player_slug not in gone
    )


def market_skips(state: dict, seat_index: int) -> int:
    """How many voluntary skips this seat has left.

    Defaulted rather than assumed present so a snapshot written before the
    counters existed reads as a full allowance instead of crashing -- though
    `assert_supported_version` refuses such a snapshot first, so this is a
    second line rather than the policy.
    """
    return int(state["seats"][seat_index].get("market_skips", MARKET_SKIPS_PER_SEAT))


#: The three ways a seat can decline, named. They had one name between them,
#: which is why a player could not tell why a token had gone.
PASS_MARKET_SKIP = "market_skip"
PASS_FOLLOW = "follow_pass"
PASS_AUCTION = "auction_pass"


def lot_has_prior_rejection(state: dict) -> bool:
    """Has any seat already declined this UNOPENED lot?

    Read from `lot_actions` rather than from `passed`, and the difference is
    load-bearing: `_advance_lot` pre-seeds `passed` for a seat that cannot
    legally acquire the candidate, WITHOUT recording an action. That seat never
    saw the lot and never made a decision, so following it is not following a
    rejection. Only a real, recorded decline opens the lot to a free follow.
    """
    return any(
        action.get("action") == COMMAND_PASS
        for action in (state.get("lot_actions") or [])
    )


def pass_kind(
    state: dict, seat_index: int, pool: Optional[CandidatePool] = None
) -> str:
    """Which of the three declines passing right now would be.

    Published so the control can name the action it is about to take instead
    of calling all three "skip" and letting the counter explain afterwards.
    """
    if state.get("high_bidder") is not None or int(state.get("current_bid") or 0) > 0:
        return PASS_AUCTION
    if pass_consumes_skip(state, seat_index, pool):
        return PASS_MARKET_SKIP
    return PASS_FOLLOW


def pass_consumes_skip(
    state: dict, seat_index: int, pool: Optional[CandidatePool] = None
) -> bool:
    """Would passing right now spend one of this seat's market skips?

    THE FOUR CONDITIONS, ALL REQUIRED. A skip is the price of being the one who
    takes a player off the board, so it is charged only when all four hold:

      1. NO STANDING BID. Passing after someone has bid is ordinary auction
         concession -- you were outbid, not uninterested -- and costs nothing.
         Charging for it would make every contested lot a tax on the loser.
      2. THE CANDIDATE LEGALLY FITS YOU, now or after the rearrangement
         `feasibility` allows. Declining someone you could not have bought is
         not a decision, so it is free (and is usually an automatic pass the
         seat never even saw).
      3. YOUR ROSTER IS INCOMPLETE. A finished seat has nothing to decline.
      4. NOBODY HAS ALREADY REJECTED THIS LOT. This is the condition that was
         missing, and it was the expensive one.

    WHY (4) EXISTS. A market skip buys the right to take a player off the
    board. The FIRST seat to reject an unopened lot is the one making that
    call; the second is answering a lot that is already dead either way -- the
    player is gone whatever they do, and their decision carries strictly less
    information. Charging both meant one worthless candidate burned two of the
    ten skips in a match, and a player who happened to act second on five
    unopened lots was pushed into `REJECT_NO_MARKET_SKIPS` -- forced to open
    the bidding on players they did not want -- purely for being second.

    Published as its own function, and projected, so the UI can warn BEFORE
    the click rather than reporting the charge afterwards.
    """
    if state["phase"] != PHASE_AUCTION:
        return False
    if state.get("high_bidder") is not None or int(state.get("current_bid") or 0) > 0:
        return False
    if lot_has_prior_rejection(state):
        return False
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return False
    slug = state.get("current_candidate")
    if not slug:
        return False
    pool = pool or warm_pool()
    return can_seat_acquire(state, seat_index, pool.get(slug), pool)


def may_pass(
    state: dict, seat_index: int, pool: Optional[CandidatePool] = None
) -> bool:
    """Is passing a legal move for this seat right now?

    False in exactly one situation: the pass would consume a skip and the seat
    has none left. At that point the seat must open at `MIN_OPENING_BID` -- a
    dollar, which the reserve rule guarantees they are holding.

    This is what makes the skip economy a RULE rather than a scoreboard. An
    unlimited-pass auction has a dominant waiting strategy; a bounded one makes
    every skip a decision with a cost.
    """
    if not pass_consumes_skip(state, seat_index, pool):
        return True
    return market_skips(state, seat_index) > 0


def can_seat_acquire(
    state: dict,
    seat_index: int,
    candidate: Candidate,
    pool: CandidatePool,
    supply: Optional[feasibility.PositionSupply] = None,
) -> bool:
    """May this seat legally win this candidate?

    Three conditions, all required: the roster has room, the seat can afford at
    least a dollar under the reserve rule, and taking the player leaves a
    roster that can still be completed from what remains (brief rule 12).

    `supply` is the caller's cached, still-available position histogram. Passed
    in wherever this is called in a loop so the histogram is built once per lot
    rather than once per candidate; computed here when absent so a one-off
    caller does not have to know about it.
    """
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return False
    if rules.max_legal_bid(seat["budget"], _filled(seat)) < MIN_OPENING_BID:
        return False
    base = supply if supply is not None else _supply(state, pool)
    return feasibility.can_acquire(
        _owned(seat, pool), candidate.positions, base.without(candidate.positions)
    )


# ---------------------------------------------------------------------------
# Candidate selection
# ---------------------------------------------------------------------------


def _lot_stream(seed: int, lot_index: int) -> random.Random:
    """One generator per lot, keyed by lot index.

    Keyed rather than sequential so that adding a future draw cannot shift the
    candidate an existing lot produces -- the property that lets an RTT seed
    still generate the same board after new generation code shipped
    (`run_the_table/generation.py:45-46`).
    """
    return random.Random(f"arena:{seed}:candidate:{lot_index}")


def _available_candidates(state: dict, pool: CandidatePool) -> list[Candidate]:
    """Every qualified player still on the board, in canonical pool order.

    THE STANDARD MARKET DRAWS FROM THIS AND NOTHING NARROWER, which is a
    deliberate reversal. An earlier ruleset filtered each lot to candidates at
    least one seat could legally win, on the reasoning that an unwinnable lot
    is a wasted one. The effect in play was worse than the waste: as rosters
    filled, the board visibly converged on whatever position each participant
    was missing, so the last few lots served the answer instead of asking a
    question. A player with only PG open saw only point guards.

    So a lot is now a draw from the market, not a delivery. A candidate neither
    seat can use simply goes unsold -- both seats auto-pass at no cost to their
    skips -- and the lot counter still advances, which is what keeps
    termination provable without narrowing the pool.
    """
    gone = _taken_slugs(state) | set(state["offered"])
    return [c for c in pool.qualified if c.player_slug not in gone]


def _fits_seat(
    state: dict,
    seat_index: int,
    candidates: list[Candidate],
    pool: CandidatePool,
) -> list[Candidate]:
    """Those candidates this seat could legally win.

    Asked once per distinct POSITION SET rather than once per player: five
    slots admit at most 31 non-empty sets, so this is about 31 feasibility
    calls instead of 500. The answers are identical by construction -- nothing
    `can_seat_acquire` reads varies across candidates sharing a position set.
    """
    supply = _supply(state, pool)
    verdict: dict[frozenset[str], bool] = {}
    out: list[Candidate] = []
    for candidate in candidates:
        cached = verdict.get(candidate.positions)
        if cached is None:
            cached = can_seat_acquire(state, seat_index, candidate, pool, supply)
            verdict[candidate.positions] = cached
        if cached:
            out.append(candidate)
    return out


def _incomplete_seats(state: dict) -> list[int]:
    return [i for i, seat in enumerate(state["seats"]) if not _roster_full(seat)]


def _closeout_priority_seats(state: dict) -> list[int]:
    """Which incomplete seats, if any, this closeout lot must try to serve.

    THE FEASIBILITY GUARANTEE, AND WHY IT IS A ROTATION RATHER THAN A FILTER.
    The closeout market exists because a roster is still incomplete after the
    standard market, so it has to converge -- but "make every remaining
    candidate fit the missing position" would turn the endgame into a vending
    machine, which is the failure this rule is written to avoid as much as the
    stall it is written to prevent. So the market keeps drawing freely, and the
    draw is only overridden once a seat has been offered
    `CLOSEOUT_FIT_GUARANTEE_LOTS - 1` consecutive lots it could not use. Two
    misses in a row are normal; a third is not allowed to happen.

    Returned as a LIST, longest-waiting first, so the caller can prefer a
    candidate who serves every waiting seat at once. That preference is what
    keeps the bound tight: with two seats waiting and one candidate to offer,
    a candidate fitting both resets both.

    THE ONE CASE THE BOUND SLIPS, stated rather than hidden: if two seats are
    both waiting and NO single available candidate fits both, one of them must
    wait one further lot -- there is one lot and two mutually exclusive needs,
    so no draw can satisfy both. That seat is then the unique longest-waiting
    and is served next, so the worst case is
    `CLOSEOUT_FIT_GUARANTEE_LOTS` consecutive unusable lots rather than the
    usual `CLOSEOUT_FIT_GUARANTEE_LOTS - 1`. The tests assert the worst case,
    not the usual one.
    """
    if state.get("market_phase") != MARKET_CLOSEOUT:
        return []
    dry = state.get("closeout_dry_lots") or [0] * len(state["seats"])
    waiting = sorted(
        (
            (-dry[index], index)
            for index in _incomplete_seats(state)
            if dry[index] >= CLOSEOUT_FIT_GUARANTEE_LOTS - 1
        )
    )
    return [index for _rank, index in waiting]


def _draw_candidate(
    eligible: list[Candidate], rng: random.Random
) -> tuple[Candidate, str]:
    """Pick one candidate, star-weighted across `POOL_TIERS`.

    Returns `(candidate, tier_label)` so the history row can record which band
    the player came from -- otherwise "the pool feels top-heavy" is an argument
    nobody can settle with data.

    THE DRAW IS ADJUSTED ONLY FOR LEGALITY. A tier whose candidates are all
    already taken, or all infeasible for both rosters, cannot supply one; the
    draw then falls to the NEAREST tier that can, in order, and finally to any
    eligible candidate. It is never re-weighted for strength, era or name
    recognition, because a board that quietly reached for a famous player would
    be the hand-picking CLAUDE.md forbids.
    """
    by_tier: list[tuple[str, list[Candidate], float]] = []
    for first, last, weight in POOL_TIERS:
        members = [c for c in eligible if first <= c.rank <= last]
        by_tier.append((f"{first}-{last}", members, weight))

    live = [(label, members, weight) for label, members, weight in by_tier if members]
    if not live:
        # No candidate carries a rank inside any published tier. Unreachable
        # against the committed artifact (every qualified row has a rank in
        # 1..500) and handled rather than asserted away.
        return rng.choice(eligible), "unranked"

    total = sum(weight for _, _, weight in live)
    roll = rng.random() * total
    for label, members, weight in live:
        roll -= weight
        if roll <= 0:
            return rng.choice(members), label
    label, members, _ = live[-1]
    return rng.choice(members), label


def _advance_lot(state: dict, pool: CandidatePool, *, first: bool = False) -> None:
    """Put the next candidate up, or end the match.

    Termination is decided here and it is decided four ways, in order:

      1. Both rosters full -> the match is over, normally.
      2. `HARD_MAX_LOTS` reached -> auto-fill the remaining slots. This is the
         case that makes termination a proof rather than a hope: two seats that
         pass forever cannot walk the pool. The skip economy and the closeout
         market together mean this should be unreachable, which is exactly why
         it is implemented and asserted against over a thousand seeds.
      3. The standard market has run its 24 lots with a roster still
         incomplete -> switch to the CLOSEOUT MARKET, which keeps drawing but
         guarantees each incomplete roster a usable candidate on a bounded
         schedule.
      4. No candidate remains at all -> auto-fill. Reaching this against the
         qualified 500 would require a pathological board; implemented rather
         than asserted-impossible because "cannot happen" is not a proof.
    """
    if all(_roster_full(s) for s in state["seats"]):
        _complete(state)
        return
    if state["lot_index"] >= state["max_lots"]:
        _autofill(state, pool, reason="max_lots")
        return

    # The standard market is over the moment its lot budget is spent and
    # somebody still has a slot open. Recomputed from `lot_index` rather than
    # latched, so a rehydrated snapshot cannot disagree with its own history.
    if state["lot_index"] >= int(
        state.get("standard_market_lots", STANDARD_MARKET_LOTS)
    ):
        state["market_phase"] = MARKET_CLOSEOUT

    available = _available_candidates(state, pool)
    if not available:
        _autofill(state, pool, reason="pool_exhausted")
        return

    rng = _lot_stream(state["seed"], state["lot_index"])
    # THE DRAW IS FREE FIRST, GUARANTEED SECOND. Even in the closeout market
    # the market draws from the whole board; only if that draw misses the seat
    # that has waited longest is it redrawn among candidates that seat can
    # actually use. A closeout lot is therefore usually still a real market
    # lot, and non-fitting candidates keep appearing.
    chosen, tier_label = _draw_candidate(available, rng)
    priority = _closeout_priority_seats(state)
    if priority and not any(
        can_seat_acquire(state, index, chosen, pool) for index in priority
    ):
        # Prefer a candidate who serves EVERY waiting seat, and fall back to
        # the longest-waiting one alone. The fallback is the only path by which
        # a seat waits a third lot; see `_closeout_priority_seats`.
        fitting = _fits_seat(state, priority[0], available, pool)
        for index in priority[1:]:
            both = _fits_seat(state, index, fitting, pool)
            if both:
                fitting = both
        if fitting:
            chosen, tier_label = _draw_candidate(fitting, rng)

    state["current_candidate"] = chosen.player_slug
    state["current_candidate_tier"] = tier_label
    state["offered"].append(chosen.player_slug)

    # Update every incomplete seat's dry counter against the candidate that is
    # ACTUALLY going up, so the guarantee is measured on what was offered
    # rather than on what was intended.
    if state.get("market_phase") == MARKET_CLOSEOUT:
        dry = list(state.get("closeout_dry_lots") or [0] * len(state["seats"]))
        for index in range(len(state["seats"])):
            if _roster_full(state["seats"][index]):
                dry[index] = 0
            elif can_seat_acquire(state, index, chosen, pool):
                dry[index] = 0
            else:
                dry[index] += 1
        state["closeout_dry_lots"] = dry

    if not first:
        state["opening_seat"] = state["next_opening_seat"]
    state["next_opening_seat"] = (state["opening_seat"] + 1) % len(state["seats"])

    state["current_bid"] = 0
    state["high_bidder"] = None
    state["lot_bids"] = [0] * len(state["seats"])
    state["lot_actions"] = []
    # A seat that cannot legally win this player is out of the lot before it
    # starts, rather than being handed a turn whose only legal move is a pass.
    # That is what stops a finished roster from being asked to bid, and it is
    # why `active_seat` below can never land on a seat with nothing to do.
    state["passed"] = [
        not can_seat_acquire(state, i, chosen, pool) for i in range(len(state["seats"]))
    ]
    state["active_seat"] = _next_actor(state, state["opening_seat"])
    if state["active_seat"] is None:
        # NOBODY CAN USE THIS CANDIDATE, which is now a normal outcome rather
        # than an impossible one: the market draws without regard to either
        # roster's needs. The lot resolves unsold, no skip is charged to
        # anyone, and the counter advances -- so a run of unusable candidates
        # walks the match toward its bounds rather than hanging it.
        _resolve_lot(state, pool, decided_by=DECIDED_BY_UNSOLD)


def _next_actor(state: dict, start: int) -> Optional[int]:
    """The next seat, from `start` inclusive, that has not passed out."""
    count = len(state["seats"])
    for offset in range(count):
        index = (start + offset) % count
        if not state["passed"][index]:
            return index
    return None


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


def legal_commands(
    state: dict, seat_index: int, pool: Optional[CandidatePool] = None
) -> tuple[str, ...]:
    """What this seat may issue right now.

    ONLY THE ACTIVE SEAT HAS ANY MOVE. That is the whole difference from v1,
    and it is what makes the clock fair: `arena_turns` names one seat, the
    deadline starts when that turn is created, and a seat that is not on the
    clock is not on a clock at all.

    `pass` is offered alongside `bid` whenever the seat is live. That is partly
    a rule (a pass is a real move) and partly a foundation contract:
    `RandomLegalBot` emits an EMPTY payload (`bots.py:75-83`), so a mode whose
    only legal command needed an amount would hand the baseline bot a
    guaranteed rejection. A parameter-free `pass` means the baseline degrades
    to a legal move rather than an error.
    """
    if state["phase"] != PHASE_AUCTION:
        return ()
    if state.get("active_seat") != seat_index:
        return ()
    if state["passed"][seat_index]:
        return ()
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return ()
    can_bid = rules.can_afford_minimum(
        seat["budget"], _filled(seat), state["current_bid"]
    )
    # PASSING IS NOT ALWAYS AVAILABLE. A seat out of market skips, facing a
    # candidate it can legally use with nothing bid, must open. That is the
    # rule that removes the waiting strategy; see `may_pass`.
    can_pass = may_pass(state, seat_index, pool)
    if can_bid and can_pass:
        return (COMMAND_BID, COMMAND_PASS)
    if can_bid:
        return (COMMAND_BID,)
    # Out of legal money for this lot. Passing is still a real move and is
    # still offered, so the seat is never left with nothing to submit -- an
    # unaffordable lot is not something a skip should be spent on either.
    return (COMMAND_PASS,)


def submit_action(
    state: dict,
    seat_index: int,
    command: str,
    amount: object = 0,
    pool: Optional[CandidatePool] = None,
) -> tuple[dict, Optional[str], Optional[str]]:
    """Apply one seat's action. Returns `(state, reject_code, reject_message)`.

    The state is mutated in place on the caller's own copy -- `reduce` deep-
    copies before calling, so this never touches committed state.

    THE CEILING IS THE SERVER'S. `amount` arrives from a request body and is
    checked against `rules.max_legal_bid` computed here, from the persisted
    budget. A client's idea of its own maximum is a display value and is never
    consulted.
    """
    pool = pool or warm_pool()
    if state["phase"] != PHASE_AUCTION:
        return state, REJECT_NOT_BIDDING, "This match is not taking bids."
    if state.get("active_seat") != seat_index:
        return (
            state,
            REJECT_NOT_YOUR_TURN,
            "It is not your turn to act on this player.",
        )
    if state["passed"][seat_index]:
        return state, REJECT_ALREADY_PASSED, "You have already passed on this player."

    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return state, REJECT_ROSTER_FULL, "Your roster is already complete."

    if command == COMMAND_PASS:
        if not may_pass(state, seat_index, pool):
            return (
                state,
                REJECT_NO_MARKET_SKIPS,
                "You are out of market skips. This player fits your roster and "
                f"nobody has bid, so you must open at ${MIN_OPENING_BID}.",
            )
        _apply_pass(state, seat_index, pool, timed_out=False)
        return state, None, None

    if command != COMMAND_BID:
        return state, REJECT_NOT_BIDDING, f"{command!r} is not a move in this mode."

    if not rules.is_whole_dollars(amount):
        return state, REJECT_BID_NOT_INTEGER, "A bid must be a whole number of dollars."

    value = int(amount)  # type: ignore[arg-type]
    floor = rules.minimum_bid(state["current_bid"])
    if value < floor:
        return (
            state,
            REJECT_BID_TOO_LOW,
            (
                f"The opening bid is ${floor}."
                if state["current_bid"] <= 0
                else f"You must raise to at least ${floor}."
            ),
        )

    ceiling = rules.max_legal_bid(seat["budget"], _filled(seat))
    if value > ceiling:
        return (
            state,
            REJECT_BID_OVER_MAX,
            f"Your maximum bid is ${ceiling}: every slot you still have to fill "
            f"must keep at least ${rules.MIN_RESERVE_PER_SLOT} behind it.",
        )

    candidate = pool.get(state["current_candidate"])
    if not can_seat_acquire(state, seat_index, candidate, pool):
        return (
            state,
            REJECT_CANDIDATE_UNFIT,
            "You cannot complete a legal roster if you win this player.",
        )

    _apply_bid(state, seat_index, value, pool)
    return state, None, None


#: What a timeout actually did, recorded on the action and published so the UI
#: can say it in words. Four outcomes, four different consequences -- naming
#: them is the whole point, because the reported defect was a player who could
#: not tell which had happened to them.
TIMEOUT_SKIP_USED = "skip_used"
TIMEOUT_AUTO_OPEN = "auto_open"
TIMEOUT_FREE_PASS = "free_pass"
TIMEOUT_CONCEDED = "conceded"


def timeout_outcome(state: dict, seat_index: int, pool: Optional[CandidatePool] = None) -> str:
    """What an expiry WOULD do to this seat right now.

    Published as its own function and projected, so the control can state the
    consequence BEFORE the clock runs out -- "Timeout will use 1 market skip"
    versus "Timeout concedes this auction" are different warnings and a player
    is entitled to the right one. Computed from the live lot, so it is the same
    answer `timeout_active_seat` will reach a moment later.
    """
    pool = pool or warm_pool()
    if state.get("high_bidder") is not None or int(state.get("current_bid") or 0) > 0:
        # A live auction. Stepping out is ordinary concession and always free.
        return TIMEOUT_CONCEDED
    if not pass_consumes_skip(state, seat_index, pool):
        # Either the candidate cannot legally fit or the roster is done. There
        # was no decision to make, so there is nothing to charge for.
        return TIMEOUT_FREE_PASS
    if market_skips(state, seat_index) > 0:
        return TIMEOUT_SKIP_USED
    return TIMEOUT_AUTO_OPEN


def timeout_active_seat(state: dict, pool: Optional[CandidatePool] = None) -> dict:
    """The clock expired on whoever was on it, for that seat only.

    NEVER A FORFEIT, and never applied to the other seat -- they were not on
    the clock, and a timeout that passed both would resolve lots nobody
    actually declined. That was possible in v1, where one shared deadline
    covered a simultaneous round.

    WHAT AN EXPIRY COSTS, AND WHY IT NOW COSTS SOMETHING. A timeout used to be
    a free pass in every situation, which produced the reported "I used a skip
    and the counter still says five": a player who let the clock run on a
    candidate they could have bought paid nothing, so the counter was correct
    and inexplicable at the same time. Worse, it made waiting strictly better
    than skipping -- the exact dominant-waiting strategy the skip economy
    exists to remove -- because an expired clock declined a player for free
    while pressing the button cost one.

    The four outcomes, matching `timeout_outcome`:

      * CONCEDED. A bid stands; stepping out of a live auction is free, exactly
        as a deliberate pass is. Latency must never cost money.
      * SKIP USED. Nothing bid, the candidate fits, skips remain: this is the
        same decision as pressing Skip and is charged the same.
      * AUTO OPEN. Nothing bid, the candidate fits, NO skips remain. Passing is
        not a legal move in that position (`may_pass`), so the clock cannot
        produce one; the seat opens at `MIN_OPENING_BID`, which the reserve
        rule guarantees they are holding. A silent illegal pass here would have
        been a rule the timeout path quietly broke.
      * FREE PASS. No legal fit, or a finished roster. There was no decision.
    """
    pool = pool or warm_pool()
    if state["phase"] != PHASE_AUCTION:
        return state
    active = state.get("active_seat")
    if active is None:
        return state

    outcome = timeout_outcome(state, active, pool)
    if outcome == TIMEOUT_AUTO_OPEN:
        value = rules.minimum_bid(int(state.get("current_bid") or 0))
        _apply_bid(state, active, value, pool, timed_out=True)
        return state
    _apply_pass(
        state,
        active,
        pool,
        timed_out=True,
        charge_skip=(outcome == TIMEOUT_SKIP_USED),
    )
    return state


def _apply_bid(
    state: dict,
    seat_index: int,
    value: int,
    pool: CandidatePool,
    *,
    timed_out: bool = False,
) -> None:
    state["current_bid"] = value
    state["high_bidder"] = seat_index
    state["lot_bids"][seat_index] = value
    state["lot_actions"].append(
        {
            "seat_index": seat_index,
            "action": COMMAND_BID,
            "amount": value,
            # A BID THE CLOCK MADE, not the player. Recorded so the feed can say
            # "Time expired -- automatic $1 opening bid" rather than showing an
            # ordinary bid the player never chose to make.
            "timed_out": bool(timed_out),
            "auto_opened": bool(timed_out),
        }
    )
    if timed_out:
        state.setdefault("lot_timeouts", [False] * len(state["seats"]))
        state["lot_timeouts"][seat_index] = True
    nxt = _next_actor(state, (seat_index + 1) % len(state["seats"]))
    if nxt is None or nxt == seat_index:
        # Nobody live is left to answer. Brief rule 7: a seat that already
        # passed out cannot come back in, so an opener who passed and then
        # watched the opponent open has lost the lot at that opening amount.
        _resolve_lot(state, pool, decided_by=DECIDED_BY_PASS_OUT)
        return
    state["active_seat"] = nxt


def _apply_pass(
    state: dict,
    seat_index: int,
    pool: CandidatePool,
    *,
    timed_out: bool,
    charge_skip: Optional[bool] = None,
) -> None:
    # CHARGED BEFORE THE PASS IS APPLIED, because `pass_consumes_skip` reads
    # the live lot -- once `passed` is set and the lot may resolve, the
    # conditions it tests have already moved.
    #
    # `charge_skip` lets the TIMEOUT path state the answer it already computed
    # (`timeout_outcome`) rather than have it re-derived here from a state that
    # has not moved yet but soon will. A deliberate pass passes None and the
    # rule below decides, which is the only path that may charge implicitly.
    # NAMED BEFORE THE PASS IS APPLIED, for the same reason the charge is:
    # `pass_kind` reads the live lot, and applying the pass moves it.
    kind = pass_kind(state, seat_index, pool)
    charged = (
        pass_consumes_skip(state, seat_index, pool)
        if charge_skip is None
        else bool(charge_skip)
    )
    if not charged and kind == PASS_MARKET_SKIP:
        # The timeout path can override the charge (it passes the answer
        # `timeout_outcome` already published). The recorded name must follow
        # the money, or a receipt would claim a token was spent that was not.
        kind = PASS_FOLLOW
    if charged:
        seat = state["seats"][seat_index]
        seat["market_skips"] = max(0, int(seat.get("market_skips", 0)) - 1)

    state["passed"][seat_index] = True
    state["lot_actions"].append(
        {
            "seat_index": seat_index,
            "action": COMMAND_PASS,
            "amount": 0,
            "timed_out": bool(timed_out),
            # Recorded on the action so a receipt can say which passes cost
            # something rather than inferring it from a counter that has since
            # changed.
            "consumed_skip": bool(charged),
            # ...and WHICH of the three declines it was. `consumed_skip` alone
            # cannot distinguish "you followed the other seat's rejection" from
            # "you conceded a live auction"; both are free and they mean
            # completely different things to a player.
            "pass_kind": kind,
        }
    )
    if timed_out:
        state.setdefault("lot_timeouts", [False] * len(state["seats"]))
        state["lot_timeouts"][seat_index] = True

    if state["high_bidder"] is not None:
        # A live bid stands and the only seat who could answer it has stepped
        # out. The standing high bidder wins at exactly what they said.
        _resolve_lot(state, pool, decided_by=DECIDED_BY_PASS_OUT)
        return

    nxt = _next_actor(state, (seat_index + 1) % len(state["seats"]))
    if nxt is None:
        _resolve_lot(state, pool, decided_by=DECIDED_BY_UNSOLD)
        return
    state["active_seat"] = nxt


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def _resolve_lot(
    state: dict, pool: CandidatePool, decided_by: Optional[str] = None
) -> None:
    """Settle the standing lot, then put the next candidate up."""
    candidate = pool.get(state["current_candidate"])
    winner = state["high_bidder"]
    price = int(state["current_bid"]) if winner is not None else 0
    if decided_by is None:
        decided_by = DECIDED_BY_BID if winner is not None else DECIDED_BY_UNSOLD

    slot_options: list[str] = []
    if winner is not None:
        seat = state["seats"][winner]
        slot_options = list(
            feasibility.fillable_slots(_owned(seat, pool), candidate.positions)
        )
        # The slot(s) this purchase could occupy AT THE TIME OF PURCHASE.
        # Recorded on the history row for the receipt, and deliberately NOT
        # written onto the roster entry as "the" slot: a later purchase can
        # rearrange a multi-position player, so the authoritative slot is the
        # live global assignment `project` recomputes. Storing a purchase-time
        # slot and displaying it would put two players on the same slot on a
        # roster that is in fact perfectly legal.
        seat["budget"] -= price
        seat["roster"].append(
            {
                "player_slug": candidate.player_slug,
                "price": price,
                "lot_index": state["lot_index"],
                "round_index": state["lot_index"],
            }
        )

    timed_out = state.get("lot_timeouts") or [False] * len(state["seats"])
    record: dict = {
        "lot_index": state["lot_index"],
        # `round_index` is the receipt's own key and predates the rename. Kept
        # as the same number rather than migrated, so a settled v1 receipt and
        # a v2 one read identically.
        "round_index": state["lot_index"],
        "candidate": candidate.revealed_dict(),
        "candidate_tier": state.get("current_candidate_tier"),
        "opening_seat": state["opening_seat"],
        # The highest amount each seat committed on this lot. Zero for a seat
        # that only ever passed, which is what the receipt's counterfactual
        # reads to answer "what would it have cost you".
        "bids": [int(b) for b in state["lot_bids"]],
        "timed_out": list(timed_out),
        "winner_seat": winner,
        "price": price,
        "decided_by": decided_by,
        "actions": [dict(a) for a in state["lot_actions"]],
        "slot_options": slot_options,
    }
    state["history"].append(record)

    state["lot_index"] += 1
    state["current_candidate"] = None
    state["current_candidate_tier"] = None
    state["active_seat"] = None
    state["high_bidder"] = None
    state["current_bid"] = 0
    state["lot_timeouts"] = [False] * len(state["seats"])
    _advance_lot(state, pool)


# ---------------------------------------------------------------------------
# Termination
# ---------------------------------------------------------------------------


def _autofill(state: dict, pool: CandidatePool, *, reason: str) -> None:
    """Fill every remaining slot deterministically, then complete.

    The escape hatch that makes termination provable. Each filled slot costs
    `AUTOFILL_PRICE`, which the reserve rule guarantees the seat is holding: a
    seat with `k` unfilled slots has at least `k` dollars by construction
    (`rules.is_solvent`), and that invariant is asserted over a full random
    match in the tests.

    Deterministic, from a keyed stream, drawn from the QUALIFIED pool, and
    recorded in the history with its reason so a receipt can say a slot was
    auto-filled rather than won. A silently auto-filled roster would misreport
    what the player actually did.
    """
    rng = random.Random(f"arena:{state['seed']}:autofill")
    for seat_index, seat in enumerate(state["seats"]):
        guard = 0
        while not _roster_full(seat) and guard < ROSTER_SIZE * 4:
            guard += 1
            gone = _taken_slugs(state) | set(state["offered"])
            supply = _supply(state, pool)
            owned = _owned(seat, pool)
            options = [
                c
                for c in pool.qualified
                if c.player_slug not in gone
                and feasibility.can_acquire(
                    owned, c.positions, supply.without(c.positions)
                )
            ]
            if not options:
                break
            chosen = rng.choice(options)
            slots = feasibility.fillable_slots(_owned(seat, pool), chosen.positions)
            price = min(AUTOFILL_PRICE, seat["budget"])
            seat["budget"] -= price
            seat["roster"].append(
                {
                    "player_slug": chosen.player_slug,
                    "price": price,
                    "lot_index": state["lot_index"],
                    "round_index": state["lot_index"],
                    "autofilled": True,
                }
            )
            state["offered"].append(chosen.player_slug)
            state["history"].append(
                {
                    "lot_index": state["lot_index"],
                    "round_index": state["lot_index"],
                    "candidate": chosen.revealed_dict(),
                    "candidate_tier": None,
                    "opening_seat": state["opening_seat"],
                    "bids": [0] * len(state["seats"]),
                    "timed_out": [False] * len(state["seats"]),
                    "winner_seat": seat_index,
                    "price": price,
                    "decided_by": DECIDED_BY_AUTOFILL,
                    "actions": [],
                    "slot_options": list(slots),
                    "autofill_reason": reason,
                }
            )
    state["autofilled"] = True
    _complete(state)


def _complete(state: dict) -> None:
    state["phase"] = PHASE_COMPLETE
    state["current_candidate"] = None
    state["current_candidate_tier"] = None
    state["active_seat"] = None
    state["high_bidder"] = None
    state["current_bid"] = 0
    state["passed"] = [True] * len(state["seats"])


def is_complete(state: dict) -> bool:
    return state["phase"] == PHASE_COMPLETE


# ---------------------------------------------------------------------------
# Projection -- the hidden-information boundary
# ---------------------------------------------------------------------------


def _bid_blocked_reason(
    state: dict, seat_index: int, candidate: Optional[Candidate], pool: CandidatePool
) -> Optional[str]:
    """Why this seat cannot bid right now, as a machine-readable reason.

    Published so the UI can EXPLAIN a disabled control instead of merely
    greying it out. A "Bid" button that does nothing and says nothing is the
    single most common way a rules-correct game reads as broken, and it is
    listed in the brief as a defect in its own right ("never silently skip the
    user").
    """
    if state["phase"] != PHASE_AUCTION:
        return "match_complete"
    if candidate is None:
        return "no_candidate"
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return "roster_full"
    if state["passed"][seat_index]:
        return "passed_out"
    if state.get("active_seat") != seat_index:
        return "not_your_turn"
    # MONEY BEFORE POSITIONS, because `can_seat_acquire` is False for both and
    # "you cannot afford this" is the more specific -- and more actionable --
    # of the two answers. A player told "position infeasible" when the real
    # problem is a $3 reserve will go looking for a roster bug that is not
    # there.
    if not rules.can_afford_minimum(
        seat["budget"], _filled(seat), state["current_bid"]
    ):
        return "insufficient_reserve"
    if not can_seat_acquire(state, seat_index, candidate, pool):
        return "position_infeasible"
    return None


def project(
    state: dict, seat_index: int, pool: Optional[CandidatePool] = None
) -> tuple[dict, dict, tuple[str, ...]]:
    """`(public_state, private_state, legal_commands)` for one seat.

    A POSITIVE ALLOWLIST. Every key in the output is named here and copied in
    deliberately; it never starts from `state` and deletes. The deletion form
    is what leaked an opponent's run id out of a settled head-to-head receipt
    (`api/v1/head_to_head.py:183-201`), because a later field added upstream is
    included by default and nobody remembers to strip it.

    WHAT DOES NOT CROSS while a lot is live: the candidate's `prime_score`,
    `rank`, `components` and `component_index`. `Candidate.public_dict` is the
    allowlist that keeps them out, and `history` -- which carries the full
    `revealed_dict` -- only ever holds lots that have already resolved.

    Everything else about a live lot IS public, and that is a rule rather than
    an oversight: an ascending auction where the standing bid were secret would
    be a different game, and both budgets and both rosters are visible at a
    real auction table.
    """
    pool = pool or warm_pool()
    candidate = (
        pool.get(state["current_candidate"]) if state["current_candidate"] else None
    )

    seats_public: list[dict] = []
    for index, seat in enumerate(state["seats"]):
        owned = _owned(seat, pool)
        fit = feasibility.evaluate(owned, (), require_future=False)
        # A player's slot comes from the LIVE global assignment, recomputed
        # from the whole roster every time -- never from the slot that happened
        # to motivate the purchase.
        #
        # Those two answers genuinely differ, and a real match found the case:
        # Brian Grant (`{C, PF, SF}`) was bought when SF was his first open
        # slot, and a later Mike Bantom (`{SF}`) purchase pushed him to C.
        # Surfacing the purchase-time slot would have shown two players at SF
        # on a roster that is in fact perfectly legal, which reads as a scoring
        # bug rather than as the multi-position rearrangement it is.
        slot_of = {slug: slot for slot, slug in fit.assignment.items()}
        seats_public.append(
            {
                "seat_index": index,
                "budget": seat["budget"],
                "filled_slots": _filled(seat),
                "roster_full": _roster_full(seat),
                "in_lot": not state["passed"][index],
                "lot_bid": int(state["lot_bids"][index]) if state["lot_bids"] else 0,
                # PUBLIC FOR BOTH SEATS. How many skips your opponent has left
                # is a real strategic fact -- it tells you whether they can
                # still afford to wait you out -- and hiding it would make the
                # rule invisible rather than tactical.
                "market_skips": market_skips(state, index),
                "roster": [
                    {
                        "player_slug": entry["player_slug"],
                        "player_name": pool.get(entry["player_slug"]).player_name,
                        "anchor_season": pool.get(entry["player_slug"]).anchor_season,
                        "price": entry["price"],
                        "slot": slot_of.get(entry["player_slug"]),
                        "prime_score": pool.get(entry["player_slug"]).prime_score,
                        "autofilled": bool(entry.get("autofilled", False)),
                    }
                    for entry in seat["roster"]
                ],
                "assignment": fit.assignment if fit.feasible else {},
                "open_slots": list(fit.open_slots) if fit.feasible else list(SLOTS),
            }
        )

    public = {
        "ruleset_version": state["ruleset_version"],
        "model_version": state["model_version"],
        "phase": state["phase"],
        "lot_index": state["lot_index"],
        "max_lots": state["max_lots"],
        "standard_market_lots": int(
            state.get("standard_market_lots", STANDARD_MARKET_LOTS)
        ),
        "market_phase": state.get("market_phase", MARKET_STANDARD),
        "market_skips_per_seat": MARKET_SKIPS_PER_SEAT,
        # Kept under their v1 names as well so a surface that reads either
        # spelling renders. One number, published twice, never recomputed.
        "round_index": state["lot_index"],
        "max_rounds": state["max_lots"],
        "seats": seats_public,
        "slots": list(SLOTS),
        "autofilled": state["autofilled"],
        "opening_seat": state["opening_seat"],
        "next_opening_seat": state["next_opening_seat"],
        "active_seat": state.get("active_seat"),
        "high_bidder": state.get("high_bidder"),
        "current_bid": int(state.get("current_bid") or 0),
        "minimum_bid": rules.minimum_bid(int(state.get("current_bid") or 0)),
        "lot_actions": [dict(a) for a in state.get("lot_actions") or []],
        # Identity and positions only, until the lot resolves. The score and
        # the components ARE the thing being bid on.
        "candidate": candidate.public_dict() if candidate else None,
        "qualified_pool_size": QUALIFIED_POOL_SIZE,
        "history": [dict(record) for record in state["history"]],
    }

    seat = state["seats"][seat_index]
    max_bid = rules.max_legal_bid(seat["budget"], _filled(seat))
    minimum = rules.minimum_bid(int(state.get("current_bid") or 0))
    private = {
        "seat_index": seat_index,
        "is_your_turn": state.get("active_seat") == seat_index,
        "max_bid": max_bid,
        "minimum_bid": minimum,
        "reserve_floor": rules.reserve_floor(_filled(seat)),
        "your_lot_bid": int(state["lot_bids"][seat_index]) if state["lot_bids"] else 0,
        "in_lot": not state["passed"][seat_index],
        "candidate_fits": (
            list(feasibility.fillable_slots(_owned(seat, pool), candidate.positions))
            if candidate
            else []
        ),
        "can_acquire_candidate": (
            can_seat_acquire(state, seat_index, candidate, pool) if candidate else False
        ),
        "bid_blocked_reason": _bid_blocked_reason(state, seat_index, candidate, pool),
        "market_skips": market_skips(state, seat_index),
        # WOULD PASSING COST ME A SKIP? Published so the control can warn
        # before the click instead of reporting the charge afterwards, and so
        # a player can tell an ordinary concession (free) from a genuine skip.
        "pass_consumes_skip": pass_consumes_skip(state, seat_index, pool),
        # ...and WHICH decline it would be, by name: `market_skip` (you are the
        # first to reject an unopened lot, and it costs a token), `follow_pass`
        # (the other seat already rejected it, so the player is gone either way
        # and this is free) or `auction_pass` (conceding a live auction, also
        # free). The control says the name; the count is not left to explain it
        # after the fact.
        "pass_kind": pass_kind(state, seat_index, pool),
        "lot_already_rejected": lot_has_prior_rejection(state),
        "can_pass": may_pass(state, seat_index, pool),
        # WHAT THE CLOCK WILL DO IF IT REACHES ZERO, named before it does.
        # One of `skip_used` / `auto_open` / `free_pass` / `conceded`. The four
        # have genuinely different costs, and a timer that counts down without
        # saying which one is coming is the defect PART 16 names: "the timer
        # does not clearly explain the consequence of expiration".
        "timeout_outcome": timeout_outcome(state, seat_index, pool),
    }

    return public, private, legal_commands(state, seat_index, pool)


def final_scores(state: dict, pool: Optional[CandidatePool] = None) -> list[float]:
    """Each seat's total: the sum of its five career-best 1Y `prime_score`s.

    Read from the artifact, never recomputed. Rounded at the end rather than
    per-player so the displayed total is the sum of the displayed parts.
    """
    pool = pool or warm_pool()
    return [
        round(sum(pool.get(e["player_slug"]).prime_score for e in seat["roster"]), 2)
        for seat in state["seats"]
    ]
