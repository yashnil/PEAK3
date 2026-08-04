"""The auction state machine. Pure rules over a serialisable snapshot.

SHAPE OF THE SNAPSHOT
---------------------
One JSON-safe dict, which the foundation persists as `arena_matches.snapshot`
and hands back to `reduce` unchanged. Nothing here reads a clock, a database or
a file at transition time (see `warm_pool` for why the pool is loaded up
front), so every function in this module is a pure function of its arguments --
which is what lets the foundation call it while holding the match's row lock.

THE SECRET LIVES IN `seats[i]["bid"]` AND NOWHERE ELSE
------------------------------------------------------
A locked bid is stored on its own seat and is removed by `project` for every
other seat. It is deliberately NOT stored in a shared `bids` list: a shared
structure invites a projection that filters it, and a filter that forgets one
key leaks. Keeping each secret on the seat it belongs to means the projection
can drop whole seats rather than pick fields out of them.

WHAT IS PUBLIC DURING A ROUND, AND WHY
---------------------------------------
`locked` (a boolean) is public; `bid` (the amount) is not. Publishing that an
opponent has acted is what makes simultaneous sealed bidding playable -- a UI
that could not say "waiting for the other seat" would look broken -- and it
reveals nothing about the amount. This is a deliberate disclosure, recorded
here so it reads as a decision rather than an oversight.
"""
from __future__ import annotations

import random
from typing import Optional

from nba_peak.twenty_dollar import feasibility, rules
from nba_peak.twenty_dollar.config import (
    AUTOFILL_PRICE,
    MAX_ROUNDS,
    MODEL_VERSION,
    ROSTER_SIZE,
    RULESET_VERSION,
    SEAT_COUNT,
    SLOTS,
    STARTING_BUDGET,
    TIMEOUT_BID,
)
from nba_peak.twenty_dollar.pool import Candidate, CandidatePool, get_pool

PHASE_BIDDING = "bidding"
PHASE_COMPLETE = "complete"

COMMAND_BID = "bid"
COMMAND_PASS = "pass"

#: Rejection codes. Distinct strings so a route can map them without parsing
#: prose, and so a test asserts on the code rather than on a sentence.
REJECT_NOT_BIDDING = "not_bidding"
REJECT_ALREADY_LOCKED = "already_locked"
REJECT_ROSTER_FULL = "roster_full"
REJECT_BID_NOT_INTEGER = "bid_not_integer"
REJECT_BID_NEGATIVE = "bid_negative"
REJECT_BID_OVER_MAX = "bid_over_max"
REJECT_CANDIDATE_UNFIT = "candidate_unfit"


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


def initial_state(seed: int, seat_count: int = SEAT_COUNT) -> dict:
    """The opening state, a pure function of the seed.

    The tie-priority holder is decided here and published immediately -- it is
    in the very first projection, before any candidate is revealed, which is
    what the brief means by "shown before the first auction". There is no
    hidden randomness anywhere in this mode: the seed is persisted, every draw
    is a keyed stream off it, and the one random decision a player cares about
    is announced up front.
    """
    pool = warm_pool()
    state: dict = {
        "ruleset_version": RULESET_VERSION,
        # Stamped into the snapshot, not merely inherited from
        # `ArenaMatch.model_version`, so a settled match carries its own
        # provenance and a later change to the platform default cannot rewrite
        # what this auction was scored under.
        "model_version": MODEL_VERSION,
        "seed": int(seed),
        "phase": PHASE_BIDDING,
        "round_index": 0,
        "tie_priority_seat": rules.initial_tie_priority(seed, seat_count=seat_count),
        "seats": [
            {
                "budget": STARTING_BUDGET,
                "roster": [],
                "bid": None,
                "locked": False,
            }
            for _ in range(seat_count)
        ],
        "offered": [],
        "history": [],
        "current_candidate": None,
        "autofilled": False,
        "max_rounds": MAX_ROUNDS,
    }
    _advance_candidate(state, pool)
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
    """Position supply of every candidate still acquirable by anyone.

    Excludes players already rostered and players already offered and passed --
    an offered candidate leaves the board for good, so counting them as future
    fillers would make the feasibility check optimistic in exactly the way that
    strands a seat late.

    Built ONCE per call site and then narrowed with `.without(...)` per
    candidate, rather than rebuilt per candidate. The naive form rebuilt a
    thousand-element list a thousand times per round inside the match
    transaction; see `PositionSupply`'s docstring.
    """
    gone = _taken_slugs(state) | set(state["offered"])
    return feasibility.PositionSupply(
        c.positions for c in pool.candidates if c.player_slug not in gone
    )


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
    roster that can still be completed from what remains.

    `supply` is the caller's cached, still-available position histogram. Passed
    in wherever this is called in a loop so the histogram is built once per
    round rather than once per candidate; computed here when absent so a
    one-off caller does not have to know about it.
    """
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return False
    if rules.max_legal_bid(seat["budget"], _filled(seat)) < 1:
        return False
    base = supply if supply is not None else _supply(state, pool)
    return feasibility.can_acquire(
        _owned(seat, pool), candidate.positions, base.without(candidate.positions)
    )


# ---------------------------------------------------------------------------
# Candidate selection
# ---------------------------------------------------------------------------


def _candidate_stream(seed: int, round_index: int) -> random.Random:
    """One generator per round, keyed by round.

    Keyed rather than sequential so that adding a future draw cannot shift the
    candidate an existing round produces -- the property that lets an RTT seed
    still generate the same board after new generation code shipped
    (`run_the_table/generation.py:45-46`).
    """
    return random.Random(f"arena:{seed}:candidate:{round_index}")


def _eligible_candidates(state: dict, pool: CandidatePool) -> list[Candidate]:
    """Players worth putting on the board this round.

    Filtered to those AT LEAST ONE seat could legally win. A candidate no one
    can acquire is not a decision, it is a wasted round -- and a board that
    kept offering them is how a pass-loop starts. This is also where the
    brief's "candidate generation must account for BOTH participants'
    unresolved positions" is enforced: eligibility is asked per seat and the
    union is offered.
    """
    gone = _taken_slugs(state) | set(state["offered"])
    supply = _supply(state, pool)
    seats = range(len(state["seats"]))

    # Eligibility depends on a candidate's POSITION SET, not their identity,
    # and five slots admit at most 31 non-empty sets. So the question is asked
    # once per distinct set and reused, instead of once per player -- about 31
    # feasibility calls per seat per round instead of 1,000. The answers are
    # identical by construction: nothing `can_seat_acquire` reads varies across
    # candidates sharing a position set.
    verdict: dict[frozenset[str], bool] = {}
    out: list[Candidate] = []
    for candidate in pool.candidates:
        if candidate.player_slug in gone:
            continue
        cached = verdict.get(candidate.positions)
        if cached is None:
            cached = any(
                can_seat_acquire(state, i, candidate, pool, supply) for i in seats
            )
            verdict[candidate.positions] = cached
        if cached:
            out.append(candidate)
    return out


def _advance_candidate(state: dict, pool: CandidatePool) -> None:
    """Put the next candidate on the board, or end the match.

    Termination is decided here and it is decided three ways, in order:

      1. Both rosters full -> the match is over, normally.
      2. No eligible candidate remains -> the remaining slots are auto-filled
         deterministically. Reaching this against the committed 1000-player
         pool would require a pathological board; it is implemented rather than
         asserted-impossible because "cannot happen" is not a termination
         proof.
      3. `MAX_ROUNDS` reached -> auto-fill as well. This is the case that makes
         termination a proof rather than a hope: two seats that pass forever
         cannot walk the pool.
    """
    if all(_roster_full(s) for s in state["seats"]):
        _complete(state)
        return
    if state["round_index"] >= state["max_rounds"]:
        _autofill(state, pool, reason="max_rounds")
        return

    eligible = _eligible_candidates(state, pool)
    if not eligible:
        _autofill(state, pool, reason="pool_exhausted")
        return

    rng = _candidate_stream(state["seed"], state["round_index"])
    chosen = rng.choice(eligible)
    state["current_candidate"] = chosen.player_slug
    state["offered"].append(chosen.player_slug)
    for seat in state["seats"]:
        seat["bid"] = None
        seat["locked"] = False


# ---------------------------------------------------------------------------
# Bidding
# ---------------------------------------------------------------------------


def legal_commands(state: dict, seat_index: int, pool: Optional[CandidatePool] = None) -> tuple[str, ...]:
    """What this seat may issue right now.

    `pass` is always offered alongside `bid` while a round is live. That is
    partly a rule (a pass is a real move) and partly a foundation contract:
    `RandomLegalBot` emits an EMPTY payload, so a mode whose only legal command
    needed an amount would hand the baseline bot a guaranteed rejection
    (`bots.py:75-83`). A parameter-free `pass` means the baseline degrades to a
    legal move rather than an error, even though this mode ships its own
    policy.
    """
    if state["phase"] != PHASE_BIDDING:
        return ()
    seat = state["seats"][seat_index]
    if seat["locked"] or _roster_full(seat):
        return ()
    return (COMMAND_BID, COMMAND_PASS)


def submit_bid(
    state: dict,
    seat_index: int,
    amount: int,
    pool: Optional[CandidatePool] = None,
) -> tuple[dict, Optional[str], Optional[str]]:
    """Lock one seat's sealed bid. Returns `(state, reject_code, reject_message)`.

    The state is mutated in place on the caller's own copy -- `reduce` deep-
    copies before calling, so this never touches committed state.

    THE CLAMP IS THE SERVER'S. `amount` arrives from a request body and is
    checked against `rules.max_legal_bid` computed here, from the persisted
    budget. A client's idea of its own maximum is a display value and is never
    consulted.
    """
    pool = pool or warm_pool()
    if state["phase"] != PHASE_BIDDING:
        return state, REJECT_NOT_BIDDING, "This match is not taking bids."
    seat = state["seats"][seat_index]
    if _roster_full(seat):
        return state, REJECT_ROSTER_FULL, "Your roster is already complete."
    if seat["locked"]:
        return state, REJECT_ALREADY_LOCKED, "You have already locked a bid this round."

    if isinstance(amount, bool) or not isinstance(amount, int):
        # bool is a subclass of int and `True` would silently bid one dollar.
        return state, REJECT_BID_NOT_INTEGER, "A bid must be a whole number of dollars."
    if amount < 0:
        return state, REJECT_BID_NEGATIVE, "A bid cannot be negative."

    if amount > 0:
        ceiling = rules.max_legal_bid(seat["budget"], _filled(seat))
        if amount > ceiling:
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

    seat["bid"] = int(amount)
    seat["locked"] = True
    return state, None, None


def all_locked(state: dict) -> bool:
    """True once every seat that CAN act this round has locked.

    A seat with a full roster is not waited on -- it has no move to make, and
    blocking the round on it would hang the match the moment one side finishes
    first.
    """
    return all(
        seat["locked"] or _roster_full(seat) for seat in state["seats"]
    )


def resolve_round(state: dict, pool: Optional[CandidatePool] = None) -> dict:
    """Settle the current candidate and move to the next.

    Called when every live seat has locked, and also on a turn timeout -- a
    seat that never locked is treated as having bid `TIMEOUT_BID` (zero, a
    pass). Never as a forfeit: a slow connection must not cost a roster slot,
    and an auction where timing out is worse than passing would make latency
    part of the strategy.
    """
    pool = pool or warm_pool()
    candidate = pool.get(state["current_candidate"])

    bids: list[Optional[int]] = []
    timed_out: list[bool] = []
    for index, seat in enumerate(state["seats"]):
        if _roster_full(seat):
            bids.append(0)
            timed_out.append(False)
            continue
        if not seat["locked"]:
            bids.append(TIMEOUT_BID)
            timed_out.append(True)
            continue
        # A locked bid the seat can no longer legally honour is demoted to a
        # pass rather than silently bought. Reachable only if a rule changed
        # between lock and resolve; recorded rather than assumed impossible.
        amount = int(seat["bid"] or 0)
        if amount > 0 and not can_seat_acquire(state, index, candidate, pool):
            amount = 0
        bids.append(amount)
        timed_out.append(False)

    outcome = rules.resolve(bids, state["tie_priority_seat"])

    record: dict = {
        "round_index": state["round_index"],
        "candidate": candidate.revealed_dict(),
        "bids": [int(b or 0) for b in bids],
        "timed_out": timed_out,
        "winner_seat": outcome.winner_seat,
        "price": outcome.price,
        "decided_by": outcome.decided_by,
        "levels": [dict(level) for level in outcome.levels],
        "tie_priority_seat": state["tie_priority_seat"],
        "tie_priority_used": outcome.tie_priority_used,
        "slot_options": [],
    }

    if outcome.winner_seat is not None:
        seat = state["seats"][outcome.winner_seat]
        slots = feasibility.fillable_slots(_owned(seat, pool), candidate.positions)
        # The slot(s) this purchase could occupy AT THE TIME OF PURCHASE.
        # Recorded on the history record as `slot_options` for the receipt, and
        # deliberately NOT written onto the roster entry as "the" slot: a later
        # purchase can rearrange a multi-position player, so the authoritative
        # slot is the live global assignment `project` recomputes. Storing a
        # purchase-time slot and displaying it would put two players on the
        # same slot on a legal roster.
        seat["budget"] -= outcome.price
        seat["roster"].append(
            {
                "player_slug": candidate.player_slug,
                "price": outcome.price,
                "round_index": state["round_index"],
            }
        )
        record["slot_options"] = list(slots)

    state["tie_priority_seat"] = rules.next_tie_priority(
        state["tie_priority_seat"], outcome, seat_count=len(state["seats"])
    )
    state["history"].append(record)
    state["round_index"] += 1
    state["current_candidate"] = None
    for seat in state["seats"]:
        seat["bid"] = None
        seat["locked"] = False

    _advance_candidate(state, pool)
    return state


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

    Deterministic, from a keyed stream, and recorded in the history with its
    reason so a receipt can say a slot was auto-filled rather than won. A
    silently auto-filled roster would misreport what the player actually did.
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
                for c in pool.candidates
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
                    "round_index": state["round_index"],
                    "autofilled": True,
                }
            )
            state["offered"].append(chosen.player_slug)
            state["history"].append(
                {
                    "round_index": state["round_index"],
                    "candidate": chosen.revealed_dict(),
                    "bids": [0] * len(state["seats"]),
                    "timed_out": [False] * len(state["seats"]),
                    "winner_seat": seat_index,
                    "price": price,
                    "decided_by": "autofill",
                    "levels": [],
                    "tie_priority_seat": state["tie_priority_seat"],
                    "tie_priority_used": False,
                    "slot_options": list(slots),
                    "autofill_reason": reason,
                }
            )
    state["autofilled"] = True
    _complete(state)


def _complete(state: dict) -> None:
    state["phase"] = PHASE_COMPLETE
    state["current_candidate"] = None
    for seat in state["seats"]:
        seat["bid"] = None
        seat["locked"] = False


def is_complete(state: dict) -> bool:
    return state["phase"] == PHASE_COMPLETE


# ---------------------------------------------------------------------------
# Projection -- the hidden-information boundary
# ---------------------------------------------------------------------------


def project(state: dict, seat_index: int, pool: Optional[CandidatePool] = None) -> tuple[dict, dict, tuple[str, ...]]:
    """`(public_state, private_state, legal_commands)` for one seat.

    THIS FUNCTION IS THE ONLY THING STANDING BETWEEN A SEALED BID AND ITS
    OPPONENT. It is written as a positive allowlist: every key in the output is
    named here and copied in deliberately. It never starts from `state` and
    deletes -- that is the construction that leaked an opponent's run id out of
    a settled receipt (`api/v1/head_to_head.py:183-201`), because a later field
    added upstream is included by default and nobody remembers to strip it.

    What crosses to the other seat while a round is live: budget, roster,
    filled-slot count, and the boolean `locked`. What does not: `bid`, under
    any name, at any time before the round resolves. After a round resolves the
    amounts appear in `history`, because at that point they are the result.
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
                # The amount is absent. Only the fact of having acted crosses,
                # which is what makes "waiting for the other seat" renderable.
                "locked": bool(seat["locked"]),
                "roster": [
                    {
                        "player_slug": entry["player_slug"],
                        "player_name": pool.get(entry["player_slug"]).player_name,
                        "price": entry["price"],
                        "slot": slot_of.get(entry["player_slug"]),
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
        "round_index": state["round_index"],
        "max_rounds": state["max_rounds"],
        "tie_priority_seat": state["tie_priority_seat"],
        "seats": seats_public,
        "slots": list(SLOTS),
        "autofilled": state["autofilled"],
        # Identity and positions only, until the round resolves. The score and
        # the components ARE the thing being bid on.
        "candidate": candidate.public_dict() if candidate else None,
        "history": [dict(record) for record in state["history"]],
    }

    seat = state["seats"][seat_index]
    private = {
        "seat_index": seat_index,
        # Your own bid, and only ever your own.
        "your_bid": seat["bid"],
        "your_locked": bool(seat["locked"]),
        "max_bid": rules.max_legal_bid(seat["budget"], _filled(seat)),
        "reserve_floor": rules.reserve_floor(_filled(seat)),
        "holds_tie_priority": state["tie_priority_seat"] == seat_index,
        "candidate_fits": (
            list(feasibility.fillable_slots(_owned(seat, pool), candidate.positions))
            if candidate
            else []
        ),
        "can_acquire_candidate": (
            can_seat_acquire(state, seat_index, candidate, pool) if candidate else False
        ),
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
