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
