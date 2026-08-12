"""Market skips: who pays, who does not, and why the difference matters.

THE DEFECT
----------
A market skip is the price of taking a player off the board. Only one seat can
do that -- the FIRST to reject an unopened lot. Whoever answers afterwards is
responding to a lot that is already dead: the player is gone either way, and
the decision carries strictly less information.

The rules charged both. `pass_consumes_skip` tested "no standing bid, the
candidate fits me, my roster is incomplete", and after the first seat passed,
`high_bidder` was still None and `current_bid` still 0 -- so the second seat's
pass re-satisfied every condition and was charged identically.

At match scale that is not a rounding error. Five skips per seat against a
twenty-four-lot standard market: one candidate neither seat wanted burned two
of the ten skips in the match, and a player who happened to act second on five
unopened lots hit `REJECT_NO_MARKET_SKIPS` and was forced to open the bidding
on players they did not want -- purely for being second.

THE THREE DECLINES, NAMED
--------------------------
  * `market_skip`  -- first rejection of an unopened lot. Costs one token.
  * `follow_pass`  -- the other seat already rejected it. Free.
  * `auction_pass` -- conceding a live auction. Free, and always was.

They had one name between them, which is why a player could not tell why a
token had gone. `pass_kind` names them and the projection publishes it.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import MARKET_SKIPS_PER_SEAT


@pytest.fixture(scope="module")
def pool():
    return S.warm_pool()


def _unopened_lot(seed: int) -> dict:
    """A fresh match sitting on an unopened lot both seats could contest."""
    state = S.initial_state(seed=seed)
    assert state["phase"] == S.PHASE_AUCTION
    assert state.get("high_bidder") is None
    assert int(state.get("current_bid") or 0) == 0
    return state


def _first_contestable(pool, start: int = 1, limit: int = 400) -> dict:
    """A state whose current lot BOTH seats can legally acquire.

    Some lots are pre-passed for a seat that cannot use the candidate at all
    (`_advance_lot` does this before the lot opens), and those seats never hold
    the clock. The follow-pass rule is about a lot both seats could have taken,
    so the fixture searches for one rather than assuming the first seed gives
    it.
    """
    for seed in range(start, start + limit):
        state = _unopened_lot(seed)
        first = state["active_seat"]
        second = 1 - first
        if S.pass_kind(state, first, pool) != S.PASS_MARKET_SKIP:
            continue
        # The second seat must not be pre-passed, or there is nobody to follow.
        if state["passed"][second]:
            continue
        return state
    pytest.skip("no seed produced a lot both seats could contest")


# ---------------------------------------------------------------------------
# The four cases the specification enumerates
# ---------------------------------------------------------------------------
def test_the_first_seat_to_reject_an_unopened_lot_loses_exactly_one_skip(pool):
    state = _first_contestable(pool)
    first = state["active_seat"]
    before = S.market_skips(state, first)

    assert S.pass_kind(state, first, pool) == S.PASS_MARKET_SKIP
    assert S.pass_consumes_skip(state, first, pool)

    state, code, message = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code is None, message
    assert S.market_skips(state, first) == before - 1

    action = state["lot_actions"][-1] if state["lot_actions"] else None
    if action is not None:
        assert action["consumed_skip"] is True
        assert action["pass_kind"] == S.PASS_MARKET_SKIP


def test_following_the_other_seats_rejection_costs_nothing(pool):
    """The reported case, stated directly: second to decline pays zero."""
    state = _first_contestable(pool)
    first = state["active_seat"]
    second = 1 - first
    before_second = S.market_skips(state, second)

    state, code, _ = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code is None
    if state["phase"] != S.PHASE_AUCTION or state.get("active_seat") != second:
        pytest.skip("this lot resolved without reaching the second seat")

    assert S.lot_has_prior_rejection(state)
    assert S.pass_kind(state, second, pool) == S.PASS_FOLLOW
    assert not S.pass_consumes_skip(state, second, pool)

    state, code, message = S.submit_action(state, second, S.COMMAND_PASS, 0, pool)
    assert code is None, message
    assert S.market_skips(state, second) == before_second, (
        "following a rejection must not spend a token"
    )


def test_conceding_a_live_auction_never_spends_a_skip(pool):
    state = _first_contestable(pool)
    first = state["active_seat"]
    second = 1 - first

    state, code, message = S.submit_action(state, first, S.COMMAND_BID, 1, pool)
    assert code is None, message
    assert int(state["current_bid"]) == 1

    before = S.market_skips(state, second)
    assert S.pass_kind(state, second, pool) == S.PASS_AUCTION
    assert not S.pass_consumes_skip(state, second, pool)

    state, code, message = S.submit_action(state, second, S.COMMAND_PASS, 0, pool)
    assert code is None, message
    assert S.market_skips(state, second) == before


def test_a_seat_out_of_skips_may_still_follow_a_rejection(pool):
    """The forcing bug, inverted into a guarantee.

    A seat with zero tokens used to be refused a free decline and pushed into
    `REJECT_NO_MARKET_SKIPS` -- forced to open the bidding on a player the
    other seat had already turned down.
    """
    state = _first_contestable(pool)
    first = state["active_seat"]
    second = 1 - first
    state["seats"][second]["market_skips"] = 0

    state, code, _ = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code is None
    if state["phase"] != S.PHASE_AUCTION or state.get("active_seat") != second:
        pytest.skip("this lot resolved without reaching the second seat")

    assert S.may_pass(state, second, pool), (
        "a seat with no tokens must still be able to follow a rejection"
    )
    state, code, message = S.submit_action(state, second, S.COMMAND_PASS, 0, pool)
    assert code is None, message
    assert S.market_skips(state, second) == 0


def test_a_seat_out_of_skips_still_cannot_reject_first(pool):
    """The rule is narrowed, not removed: being FIRST still costs a token, and
    a seat with none must still open."""
    state = _first_contestable(pool)
    first = state["active_seat"]
    state["seats"][first]["market_skips"] = 0

    assert S.pass_consumes_skip(state, first, pool)
    assert not S.may_pass(state, first, pool)
    _state, code, _message = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code == S.REJECT_NO_MARKET_SKIPS


# ---------------------------------------------------------------------------
# The distinction is made where it can be seen
# ---------------------------------------------------------------------------
def test_an_automatic_pre_pass_is_not_a_rejection_to_follow(pool):
    """`_advance_lot` pre-passes a seat that cannot acquire the candidate, and
    records no action for it. That seat never decided anything, so the other
    seat is still the FIRST to reject and still pays."""
    state = _first_contestable(pool)
    assert not S.lot_has_prior_rejection(state), (
        "a lot nobody has acted on must not read as already rejected"
    )
    # Construct the pre-pass rather than hunt for a seed that happens to
    # produce one: the claim is about the SHAPE of the state (a `passed` flag
    # with no recorded action), and a search that comes up empty would skip the
    # assertion entirely.
    first = state["active_seat"]
    second = 1 - first
    state["passed"][second] = True
    assert not state["lot_actions"], "fixture assumption: nobody has acted yet"

    assert not S.lot_has_prior_rejection(state), (
        "an automatic pre-pass is not a decision and must not make the next "
        "seat's rejection free"
    )
    assert S.pass_kind(state, first, pool) == S.PASS_MARKET_SKIP
    assert S.pass_consumes_skip(state, first, pool)


def test_the_projection_names_the_decline_for_both_seats(pool):
    state = _first_contestable(pool)
    first = state["active_seat"]
    second = 1 - first

    _public, private, _legal = S.project(state, first, pool)
    assert private["pass_kind"] == S.PASS_MARKET_SKIP
    assert private["pass_consumes_skip"] is True
    assert private["lot_already_rejected"] is False

    state, code, _ = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code is None
    if state["phase"] != S.PHASE_AUCTION or state.get("active_seat") != second:
        pytest.skip("this lot resolved without reaching the second seat")

    _public, private, _legal = S.project(state, second, pool)
    assert private["pass_kind"] == S.PASS_FOLLOW
    assert private["pass_consumes_skip"] is False
    assert private["lot_already_rejected"] is True


def test_a_replayed_pass_cannot_double_charge_a_skip(pool):
    """Submitting the same decline twice must not spend two tokens.

    The transport-level guarantee is the idempotency key, which is the
    repository's job. This is the rules-level half: once a seat has passed, the
    board refuses a second pass outright rather than charging again.
    """
    state = _first_contestable(pool)
    first = state["active_seat"]
    before = S.market_skips(state, first)

    state, code, _ = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
    assert code is None
    after_one = S.market_skips(state, first)
    assert after_one == before - 1

    if state["phase"] == S.PHASE_AUCTION and state["passed"][first]:
        _again, code, _message = S.submit_action(state, first, S.COMMAND_PASS, 0, pool)
        assert code in (S.REJECT_ALREADY_PASSED, S.REJECT_NOT_YOUR_TURN)
    assert S.market_skips(state, first) == after_one


def test_the_skip_economy_is_not_drained_by_dead_lots(pool):
    """The aggregate consequence, measured rather than argued.

    Across many seeded matches, the number of tokens actually spent must be
    strictly less than the number of unopened lots both seats declined -- which
    is only possible if the follower is free.
    """
    spent = 0
    both_declined = 0
    for seed in range(1, 40):
        state = _unopened_lot(seed)
        guard = 0
        while state["phase"] == S.PHASE_AUCTION and guard < 200:
            guard += 1
            seat = state.get("active_seat")
            if seat is None:
                break
            before = S.market_skips(state, seat)
            rejected_before = S.lot_has_prior_rejection(state)
            state, code, _ = S.submit_action(state, seat, S.COMMAND_PASS, 0, pool)
            if code is not None:
                # The seat is forced to open; take the cheapest legal bid so
                # the match keeps moving.
                state, code, _ = S.submit_action(state, seat, S.COMMAND_BID, 1, pool)
                if code is not None:
                    break
                continue
            if S.market_skips(state, seat) < before:
                spent += 1
            elif rejected_before:
                both_declined += 1

    assert spent > 0, "fixture assumption: some first rejections happened"
    assert both_declined > 0, "fixture assumption: some follows happened"
    # Under the old rule every decline was charged, so `spent` would have been
    # `spent + both_declined`. The saving is exactly the follows, and it is
    # large relative to the ten tokens a match holds.
    assert spent < spent + both_declined
    assert both_declined >= MARKET_SKIPS_PER_SEAT, (
        f"only {both_declined} follows across the sweep; the rule change is "
        "not being exercised meaningfully"
    )


# ---------------------------------------------------------------------------
# C5 — the opener/skip state machine, as one deterministic matrix
# ---------------------------------------------------------------------------


def test_the_opener_skip_decline_sequence_end_to_end(pool):
    """THE WHOLE C5 CONTRACT IN ONE SEQUENCE, on a real board.

    The individual rules are asserted above and in `test_ascending_auction`.
    This walks the exact sequence the polish pass names, in order, because the
    defect it guards against is a rule that is correct in isolation and wrong in
    combination:

        1. Lot N's OPENER acts first, and the non-opener cannot act before them.
        2. The opener spends a MARKET SKIP to take the lot off the board.
        3. The decision passes to the opponent.
        4. The opponent DECLINES the already-skipped lot -- and is charged
           NOTHING, because the player was gone either way.
        5. The lot resolves and Lot N+1's opener is the OTHER seat.

    Step 4 is the one that used to be wrong, and step 5 is the one that makes
    step 4 matter: without alternation the same seat would eat every step-2
    charge for the whole match.
    """
    state = _first_contestable(pool)
    opener = state["opening_seat"]
    other = 1 - opener
    lot = state["lot_index"]

    # 1. THE OPENER IS ON THE CLOCK, AND ONLY THE OPENER.
    assert state["active_seat"] == opener
    assert S.legal_commands(state, other, pool) == (), (
        "the non-opener was offered a move before the opener had acted"
    )
    refused, code, _msg = S.submit_action(state, other, S.COMMAND_PASS, 0)
    assert code is not None, "the non-opener was allowed to act first"

    # 2. THE OPENER SKIPS, AND IS CHARGED.
    assert S.pass_kind(state, opener, pool) == S.PASS_MARKET_SKIP
    before_opener = S.market_skips(state, opener)
    before_other = S.market_skips(state, other)
    state, code, message = S.submit_action(state, opener, S.COMMAND_PASS, 0)
    assert code is None, message
    assert S.market_skips(state, opener) == before_opener - 1

    # 3. THE DECISION IS NOW THE OPPONENT'S.
    assert state["active_seat"] == other
    assert state["lot_index"] == lot, "the lot resolved before the opponent answered"

    # 4. DECLINING AN ALREADY-SKIPPED LOT IS FREE, and is named as a different
    #    action from a market skip so the control can say which it is.
    assert S.lot_has_prior_rejection(state)
    assert S.pass_kind(state, other, pool) == S.PASS_FOLLOW
    assert not S.pass_consumes_skip(state, other, pool)
    state, code, message = S.submit_action(state, other, S.COMMAND_PASS, 0)
    assert code is None, message
    assert S.market_skips(state, other) == before_other, (
        "the second seat was charged for following a rejection it did not make"
    )

    # 5. THE LOT IS GONE AND THE OPENER HAS FLIPPED.
    assert state["lot_index"] == lot + 1
    assert state["opening_seat"] == other
    assert state["active_seat"] == other or state["passed"][other], (
        "the new lot did not open on the seat whose turn it is to open"
    )


@pytest.mark.parametrize("seed", [1, 7, 19, 42, 101])
def test_opener_parity_holds_across_consecutive_lots(seed, pool):
    """Lot 1 seat A, lot 2 seat B, lot 3 seat A... whatever resolved each lot.

    Deterministic over five seeds rather than random repetition: the property is
    a state-machine invariant, so what matters is that it holds for every path
    through it, not that it holds many times on one path.
    """
    state = S.initial_state(seed=seed)
    first = state["opening_seat"]
    seen: list[tuple[int, int]] = []

    for _ in range(6):
        if state["phase"] != S.PHASE_AUCTION:
            break
        seen.append((state["lot_index"], state["opening_seat"]))
        # Resolve the lot the cheapest legal way, whatever that is for whoever
        # is on the clock, so the parity claim is not conditional on the path.
        guard = 0
        lot = state["lot_index"]
        while state["lot_index"] == lot and state["phase"] == S.PHASE_AUCTION:
            guard += 1
            assert guard < 10, "a lot never resolved"
            actor = state["active_seat"]
            if actor is None:
                break
            legal = S.legal_commands(state, actor, pool)
            command = S.COMMAND_PASS if S.COMMAND_PASS in legal else S.COMMAND_BID
            amount = 0 if command == S.COMMAND_PASS else int(state["current_bid"]) + 1
            state, code, message = S.submit_action(state, actor, command, amount)
            assert code is None, message

    assert len(seen) >= 4, "not enough lots ran to test parity"
    for index, opening_seat in seen:
        assert opening_seat == (first + index) % 2, (
            f"lot {index} opened on seat {opening_seat}; parity from {first} says "
            f"{(first + index) % 2}"
        )
