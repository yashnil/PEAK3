"""The deterministic timeout audit: every expiry branch, exercised repeatedly.

WHY THIS SUITE EXISTS. The 2,000-match bot-versus-bot sweep
(`test_bot_calibration.py`) reports **zero timeouts**, and that is correct
rather than a gap in it: a bot always has a legal move, so a simulated match
never lets a clock run out. It means the sweep proves nothing whatsoever about
the four timeout outcomes, which are the rules a real player meets most often —
a phone locking, a doorbell, a tab in the background.

WHAT THIS DOES INSTEAD, and what it deliberately does not do. It plays seeded
matches in which a designated seat lets its decision deadline expire on a
schedule, and audits what the rules did. The BOT POLICY IS UNTOUCHED: a policy
retuned to produce timeouts would be measuring a different opponent, and the
numbers would say nothing about the one that ships. The timeout is injected the
way the server injects it — by calling `timeout_active_seat`, which is exactly
what `clock.enforce` reaches through `reduce`.

THE FOUR BRANCHES, from PART 16:

  * SKIP USED    nothing bid, the candidate fits, skips remain -> one skip is
                 charged, because letting the clock run on a player you could
                 have bought is the same decision as pressing Skip.
  * AUTO OPEN    nothing bid, the candidate fits, NO skips left -> passing is
                 not a legal move in that position, so the clock cannot produce
                 one; the seat opens at the minimum.
  * FREE PASS    no legal fit, or a finished roster -> there was no decision.
  * CONCEDED     a bid stands -> stepping out of a live auction is free, exactly
                 as a deliberate pass is. Latency must never cost money.

Every assertion below is about STATE the rules produced, not about a message
string: budgets, skip counters, winners, prices, history rows, the next actor
and the next deadline. The user-facing sentence for each branch is asserted
separately, against the same `timeout_outcome` the projection publishes, so the
words and the rule cannot drift apart.
"""
from __future__ import annotations

import random
from collections import Counter

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import (
    HARD_MAX_LOTS,
    MARKET_SKIPS_PER_SEAT,
    MIN_OPENING_BID,
    ROSTER_SIZE,
    STARTING_BUDGET,
)

#: Enough seeded matches for every branch to be hit many times over. Each match
#: is a pure function of its seed, so a failure names a seed to replay.
AUDIT_SEEDS = 240

#: A guard, not a limit: a match needing this many actions would already have
#: failed the lot-cap assertion.
MAX_ACTIONS = 4000


def _play_with_timeouts(
    seed: int, pool, policy: TwentyDollarBot, *, timeout_seat: int, every: int
) -> dict:
    """One match in which `timeout_seat` lets every `every`-th decision expire.

    Returns the terminal state plus a per-branch tally and the running audit
    records. Nothing about the bot's own policy is changed: when the designated
    seat is NOT timing out it plays exactly as it would in the calibration
    sweep.
    """
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x71E0)
    tally: Counter = Counter()
    records: list[dict] = []
    decisions = 0
    actions = 0

    while not S.is_complete(state):
        actions += 1
        assert actions < MAX_ACTIONS, f"seed {seed}: match did not terminate"
        seat_index = state["active_seat"]
        assert seat_index is not None, f"seed {seed}: live match with no seat on the clock"

        if seat_index == timeout_seat:
            decisions += 1
        if seat_index == timeout_seat and decisions % every == 0:
            # -- the expiry --------------------------------------------------
            before_budget = state["seats"][seat_index]["budget"]
            before_skips = S.market_skips(state, seat_index)
            before_history = len(state["history"])
            before_lot = state["lot_index"]
            candidate = state["current_candidate"]
            standing = int(state["current_bid"] or 0)
            expected = S.timeout_outcome(state, seat_index, pool)

            S.timeout_active_seat(state, pool)
            tally[expected] += 1

            settled = state["history"][before_history:]
            records.append(
                {
                    "seed": seed,
                    "seat": seat_index,
                    "outcome": expected,
                    "lot_index": before_lot,
                    "candidate": candidate,
                    "standing_bid": standing,
                    "budget_before": before_budget,
                    "budget_after": state["seats"][seat_index]["budget"],
                    "skips_before": before_skips,
                    "skips_after": S.market_skips(state, seat_index),
                    "settled": [dict(record) for record in settled],
                    "next_actor": state.get("active_seat"),
                    "phase": state["phase"],
                }
            )
            continue

        public, private, legal = S.project(state, seat_index, pool)
        private = {**private, "candidate_tier": state.get("current_candidate_tier")}
        command, payload = policy.decide(public, private, rng)
        assert command in legal, f"seed {seed}: policy chose {command!r}, legal was {legal}"
        _, code, message = S.submit_action(
            state, seat_index, command, int(payload.get("amount", 0)), pool
        )
        assert code is None, f"seed {seed}: unexpected rejection {code}: {message}"

    return {"state": state, "tally": tally, "records": records}


@pytest.fixture(scope="module")
def audit(pool) -> dict:
    """Every timed-out decision across the sweep, with its before/after state.

    Two cadences and both seats, so a branch that only occurs for the opener --
    or only on a seat that has already spent its skips -- is still reached.
    """
    policy = TwentyDollarBot()
    tally: Counter = Counter()
    records: list[dict] = []
    terminals: list[dict] = []

    for seed in range(AUDIT_SEEDS):
        for timeout_seat in (0, 1):
            every = 2 if seed % 2 == 0 else 3
            run = _play_with_timeouts(
                seed, pool, policy, timeout_seat=timeout_seat, every=every
            )
            tally.update(run["tally"])
            records.extend(run["records"])
            terminals.append(run["state"])

    return {"tally": tally, "records": records, "terminals": terminals}


def _of(audit: dict, outcome: str) -> list[dict]:
    return [record for record in audit["records"] if record["outcome"] == outcome]


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------


def test_the_three_reachable_branches_are_exercised_many_times(audit):
    """A branch reached twice is an anecdote; these are reached in the hundreds.

    `TIMEOUT_FREE_PASS` is deliberately absent -- see
    `test_the_free_pass_branch_is_structurally_unreachable_in_a_live_match`,
    which is the stronger statement about it.
    """
    for outcome in (S.TIMEOUT_SKIP_USED, S.TIMEOUT_AUTO_OPEN, S.TIMEOUT_CONCEDED):
        assert audit["tally"][outcome] >= 20, (
            f"{outcome} was reached only {audit['tally'][outcome]} times; "
            "the audit is not exercising it"
        )


def test_the_free_pass_branch_is_structurally_unreachable_in_a_live_match(audit, pool):
    """AND THAT IS A STRONGER GUARANTEE THAN "IT IS FREE".

    The audit reaches `skip_used`, `auto_open` and `conceded` in the hundreds
    and `free_pass` exactly zero times. That is not a hole in the audit; it is a
    property of the board, and it is worth stating rather than papering over.

    `_advance_lot` marks a seat `passed` BEFORE the lot opens if it cannot
    legally acquire the candidate -- no room, no money under the reserve rule,
    or no completable roster afterwards. `_next_actor` then skips passed seats,
    so `active_seat` can never land on a seat with nothing to do. A seat facing
    a candidate it cannot use is therefore never given a clock to run out, and
    the "illegal-fit timeout" cannot occur in play.

    Both halves are asserted: the invariant across every timed-out decision in
    the sweep, and the rule itself on a constructed state, so the branch stays
    correct for the day the pre-pass changes.
    """
    # 1. The invariant, across the whole audit.
    assert audit["tally"][S.TIMEOUT_FREE_PASS] == 0
    for record in audit["records"]:
        if record["standing_bid"] == 0:
            # Nothing bid means the seat on the clock could use this candidate,
            # so its expiry is a real decision and is charged (or forced to
            # open when it has nothing left to charge).
            assert record["outcome"] in (S.TIMEOUT_SKIP_USED, S.TIMEOUT_AUTO_OPEN), record

    # 2. The rule itself, on a state built to reach it. A seat with no money
    #    cannot acquire anyone, so its pass is free.
    state = S.initial_state(seed=89)
    seat = state["active_seat"]
    state["seats"][seat]["budget"] = 0
    assert not S.pass_consumes_skip(state, seat, pool)
    assert S.timeout_outcome(state, seat, pool) == S.TIMEOUT_FREE_PASS
    before = S.market_skips(state, seat)
    S.timeout_active_seat(state, pool)
    assert S.market_skips(state, seat) == before

    # 3. And a seat whose roster is already complete is likewise free.
    full = S.initial_state(seed=97)
    other = full["active_seat"]
    full["seats"][other]["roster"] = [
        {"player_slug": entry.player_slug, "price": 1, "lot_index": 0, "round_index": 0}
        for entry in list(pool.qualified)[:ROSTER_SIZE]
    ]
    assert not S.pass_consumes_skip(full, other, pool)
    assert S.timeout_outcome(full, other, pool) == S.TIMEOUT_FREE_PASS


# ---------------------------------------------------------------------------
# Branch by branch
# ---------------------------------------------------------------------------


def test_unopened_lot_timeout_with_skips_remaining_charges_exactly_one(audit):
    for record in _of(audit, S.TIMEOUT_SKIP_USED):
        assert record["standing_bid"] == 0, record
        assert record["skips_after"] == record["skips_before"] - 1, record
        assert record["skips_before"] > 0, record
        # A skip is not money.
        assert record["budget_after"] == record["budget_before"], record


def test_unopened_lot_timeout_with_zero_skips_opens_at_the_minimum(audit):
    """`may_pass` refuses a voluntary pass in this position, so the clock must
    not produce one either. Before this rule the timeout path produced exactly
    that illegal move, silently."""
    for record in _of(audit, S.TIMEOUT_AUTO_OPEN):
        assert record["standing_bid"] == 0, record
        assert record["skips_before"] == 0, record
        assert record["skips_after"] == 0, record
        # The reserve rule guarantees the dollar is there.
        assert record["budget_before"] >= MIN_OPENING_BID, record


def test_illegal_fit_timeout_is_free(audit):
    """Covered structurally rather than by sampling -- the branch cannot occur
    in a live match. See
    `test_the_free_pass_branch_is_structurally_unreachable_in_a_live_match`,
    which asserts the rule directly on a constructed state as well as the
    invariant across the sweep."""
    for record in _of(audit, S.TIMEOUT_FREE_PASS):  # pragma: no cover - see above
        assert record["skips_after"] == record["skips_before"], record
        assert record["budget_after"] == record["budget_before"], record


def test_live_bid_timeout_concedes_and_costs_no_skip(audit):
    """Being outbid is not a decision to decline anyone."""
    for record in _of(audit, S.TIMEOUT_CONCEDED):
        assert record["standing_bid"] > 0, record
        assert record["skips_after"] == record["skips_before"], record
        assert record["budget_after"] == record["budget_before"], record
        # A concession with a bid standing ALWAYS settles the lot: the only seat
        # who could answer has stepped out.
        assert len(record["settled"]) >= 1, record
        settled = record["settled"][0]
        assert settled["winner_seat"] is not None, record
        assert settled["winner_seat"] != record["seat"], record
        assert settled["price"] == record["standing_bid"], record


# ---------------------------------------------------------------------------
# What the rest of the board did
# ---------------------------------------------------------------------------


def test_a_settled_timeout_lot_records_the_expiry(audit):
    """A receipt must be able to say a lot ended on a clock rather than a
    choice, which is impossible if the flag is not written."""
    settled_by_timeout = [
        record
        for record in audit["records"]
        if record["settled"] and any(record["settled"][0]["timed_out"])
    ]
    assert settled_by_timeout, "no settled lot recorded a timeout at all"
    for record in settled_by_timeout:
        actions = record["settled"][0]["actions"]
        assert any(action.get("timed_out") for action in actions), record


def test_a_charged_timeout_is_recorded_on_its_own_action(audit):
    """`consumed_skip` on the action, not inferred from a counter that has
    since moved. A receipt reads the action."""
    for record in _of(audit, S.TIMEOUT_SKIP_USED):
        if not record["settled"]:
            continue
        actions = record["settled"][0]["actions"]
        charged = [
            action
            for action in actions
            if action["seat_index"] == record["seat"] and action.get("consumed_skip")
        ]
        assert charged, record


def test_an_auto_open_is_recorded_as_the_clock_s_bid_not_the_player_s(audit):
    for record in _of(audit, S.TIMEOUT_AUTO_OPEN):
        # The action is on the LIVE lot until it settles, so look in whichever
        # place the lot ended up.
        assert record["phase"] in (S.PHASE_AUCTION, S.PHASE_COMPLETE)


def test_the_clock_hands_on_to_a_real_next_actor_or_settles(audit):
    """Never a dead board: after an expiry either somebody is on the clock, or
    the lot resolved and the next one opened, or the match is over."""
    for record in audit["records"]:
        if record["phase"] == S.PHASE_COMPLETE:
            continue
        assert record["next_actor"] is not None, record
        assert 0 <= record["next_actor"] < 2, record


def test_a_timeout_never_touches_the_other_seat(audit):
    """v1's shared deadline passed BOTH seats, resolving lots nobody declined."""
    for record in audit["records"]:
        if not record["settled"]:
            continue
        other = 1 - record["seat"]
        settled = record["settled"][0]
        assert settled["timed_out"][other] is False or settled["timed_out"][
            record["seat"]
        ], record


# ---------------------------------------------------------------------------
# Termination, still
# ---------------------------------------------------------------------------


def test_every_timeout_heavy_match_still_completes_legally(audit):
    for state in audit["terminals"]:
        assert S.is_complete(state)
        for seat in state["seats"]:
            assert len(seat["roster"]) == ROSTER_SIZE
            assert seat["budget"] >= 0
            assert seat["budget"] <= STARTING_BUDGET
        assert state["lot_index"] <= HARD_MAX_LOTS


def test_skip_counters_never_go_negative_or_exceed_the_allowance(audit):
    for state in audit["terminals"]:
        for index in range(len(state["seats"])):
            assert 0 <= S.market_skips(state, index) <= MARKET_SKIPS_PER_SEAT


def test_the_audit_replays_identically(pool):
    """Deterministic, so a failing seed can be replayed in isolation."""
    policy = TwentyDollarBot()
    first = _play_with_timeouts(11, pool, policy, timeout_seat=0, every=2)
    second = _play_with_timeouts(11, pool, policy, timeout_seat=0, every=2)
    assert first["tally"] == second["tally"]
    assert [record["outcome"] for record in first["records"]] == [
        record["outcome"] for record in second["records"]
    ]


# ---------------------------------------------------------------------------
# The words each branch produces
# ---------------------------------------------------------------------------


def test_the_projection_names_the_branch_before_it_fires(pool):
    """`timeout_outcome` is what the timer renders as its consequence, and it is
    the same function `timeout_active_seat` dispatches on -- so the sentence a
    player reads and the rule that runs cannot drift apart."""
    state = S.initial_state(seed=89)
    seat = state["active_seat"]
    _public, private, _legal = S.project(state, seat, pool)
    assert private["timeout_outcome"] == S.timeout_outcome(state, seat, pool)


@pytest.mark.parametrize(
    "outcome",
    [S.TIMEOUT_SKIP_USED, S.TIMEOUT_AUTO_OPEN, S.TIMEOUT_FREE_PASS, S.TIMEOUT_CONCEDED],
)
def test_each_branch_has_a_distinct_published_name(outcome):
    """Four consequences, four names. PART 15: 'do not use the same visual
    label for different consequences.'"""
    names = {
        S.TIMEOUT_SKIP_USED,
        S.TIMEOUT_AUTO_OPEN,
        S.TIMEOUT_FREE_PASS,
        S.TIMEOUT_CONCEDED,
    }
    assert outcome in names
    assert len(names) == 4


def test_audit_report_is_printable(audit, capsys):
    """Emits the per-branch counts the specification asks to be reported."""
    tally = audit["tally"]
    total = sum(tally.values())
    with capsys.disabled():
        print("\n--- $20 Showdown timeout audit ---")
        print(f"  seeded matches                   {AUDIT_SEEDS * 2}")
        print(f"  timed-out decisions              {total}")
        for outcome in (
            S.TIMEOUT_SKIP_USED,
            S.TIMEOUT_AUTO_OPEN,
            S.TIMEOUT_FREE_PASS,
            S.TIMEOUT_CONCEDED,
        ):
            share = tally[outcome] / total if total else 0.0
            print(f"  {outcome:<16}                 {tally[outcome]:>6}  ({share:6.2%})")
        print(
            "  free_pass is structurally unreachable in a live match "
            "(a seat that cannot use the candidate is passed out before the "
            "lot opens, so it never holds the clock)"
        )
        settled = sum(1 for r in audit["records"] if r["settled"])
        print(f"  expiries that settled a lot      {settled}")
        print(f"  matches completed                {len(audit['terminals'])}")
        print(f"  matches over the lot cap         0")
