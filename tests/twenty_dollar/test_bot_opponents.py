"""The $20 Showdown bot v5 calibration against OPPONENT PROXIES.

`test_bot_calibration.py` measures the bot against itself, which pins its
economics (prices track tiers, money is spent, matches terminate) but says
nothing about how it fares against a bidder who plays differently. The v4
policy passed every self-play property and still won about four matches in
five against a competent rank-aware human proxy, with a tenth of its matches
decided by two star purchases before lot four. v5's brief was "formidable but
beatable": 60-70% against that proxy, symmetric in self-play, and without the
early double-star blowout. This module holds those numbers.

THE OPPONENTS ARE PART OF THE SPECIFICATION. Each is written from the public
rules alone, sees exactly what the bot sees (the seat projection plus the
coarse public rank band -- never the hidden score), and is deterministic in
the match seed, so a band asserted here is a fixed number for a fixed policy
rather than a sample. The sweeps are small (a few hundred seeds) because they
are CI guards on a calibration done at 2,000 seeds per opponent; the bands
are wide enough that the smaller sample cannot drift across them, and narrow
enough that a return to v4's numbers fails.
"""
from __future__ import annotations

import random
import statistics

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import STANDARD_MARKET_LOTS, STARTING_BUDGET, rank_band

from .conftest import bot_strategy, play_match

# ---------------------------------------------------------------------------
# The rank-aware human proxy
# ---------------------------------------------------------------------------

#: A competent human's reservation price by public rank band, in dollars,
#: when holding the opening fair share of discretionary money per open slot
#: (about $3.20). Scaled up when richer per slot, down when poorer.
PROXY_RESERVATION = {
    "1-10": 9.0, "11-25": 7.0, "26-50": 5.0, "51-100": 3.0, "101-250": 1.5, "251-500": 1.0,
}
PROXY_OPEN_BANDS = {"1-10", "11-25", "26-50", "51-100", "101-250"}


def _seat(public: dict, seat_index: int) -> dict:
    for seat in public["seats"]:
        if seat["seat_index"] == seat_index:
            return seat
    raise AssertionError(seat_index)


def _proxy_decide(public: dict, private: dict, rng: random.Random) -> tuple[str, int]:
    """THE RANK-AWARE HUMAN PROXY.

    Values a candidate by its public rank band; prefers filling roster needs
    (a single-fit candidate, a scarce centre or point guard); pays up to a
    rank-based reservation price scaled by how rich it is per open slot,
    with about a dollar of seeded noise; respects the budget and the reserve
    rule; spends down when the market is nearly over; and spends its market
    skips on sub-101 candidates while it has skips to spare.
    """
    minimum = int(private["minimum_bid"])
    max_bid = int(private["max_bid"])
    fits = list(private.get("candidate_fits") or [])
    can_pass = private.get("can_pass", True)
    if minimum > max_bid or not private.get("can_acquire_candidate") or not fits:
        return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)

    me = _seat(public, private["seat_index"])
    open_slots = list(me["open_slots"])
    n_open = max(1, len(open_slots))
    budget = int(me["budget"])
    discretionary = max(0, budget - (n_open - 1))
    band = private.get("candidate_band", "251-500")
    lots_left = max(0, STANDARD_MARKET_LOTS - int(public["lot_index"])) + 3
    standing = int(public.get("current_bid") or 0)

    base = PROXY_RESERVATION.get(band, 1.0)
    base *= min(1.6, max(0.4, (discretionary / n_open) / 3.2))
    usable = [slot for slot in fits if slot in open_slots] or fits
    if len(usable) == 1:
        base *= 1.1
    if any(slot in ("C", "PG") for slot in usable):
        base += 0.3
    if lots_left / n_open <= 2.5 and band in PROXY_OPEN_BANDS:
        base = max(base, discretionary * 0.8)
    reservation = int(round(base + rng.gauss(0, 0.9)))
    reservation = max(1, min(reservation, discretionary, max_bid))

    if standing <= 0:
        skips = int(private.get("market_skips", 0))
        wants = (
            band in PROXY_OPEN_BANDS
            or skips <= n_open
            or private.get("lot_already_rejected")
        )
        if wants or not can_pass:
            return S.COMMAND_BID, min(minimum, max_bid)
        return S.COMMAND_PASS, 0
    if minimum <= reservation:
        return S.COMMAND_BID, minimum
    return (S.COMMAND_PASS, 0) if can_pass else (S.COMMAND_BID, minimum)


def rank_aware_proxy(state, seat_index, pool, rng):
    """`conftest.Strategy` adapter: the proxy sees the bot's own projection."""
    public, private, _ = S.project(state, seat_index, pool)
    private = {
        **private,
        "candidate_band": rank_band(pool.get(state["current_candidate"]).rank),
    }
    return _proxy_decide(public, private, rng)


# ---------------------------------------------------------------------------
# Measurement
# ---------------------------------------------------------------------------

#: An EARLY BLOWOUT, defined measurably: a seat's first two purchases both
#: land inside the first `EARLY_LOTS` lots, together cost at least
#: `EARLY_SHARE` of the starting budget, and that seat goes on to win by at
#: least `DECIDED_MARGIN` points -- the match was decided by the front-load.
#: `HEAVY_SHARE` is the v4 double-star shape ($12+ on two players).
EARLY_LOTS = 6
EARLY_SHARE = 0.5
HEAVY_SHARE = 0.6
DECIDED_MARGIN = 10.0


def _first_two_spend(state: dict, seat_index: int) -> int | None:
    bought = [
        record
        for record in state["history"]
        if record["winner_seat"] == seat_index
        and record["decided_by"] != S.DECIDED_BY_AUTOFILL
    ]
    if len(bought) < 2 or bought[1]["lot_index"] >= EARLY_LOTS:
        return None
    return int(bought[0]["price"]) + int(bought[1]["price"])


def _blowouts(state: dict, pool, share: float) -> set[int]:
    scores = S.final_scores(state, pool)
    out = set()
    for seat_index in (0, 1):
        spent = _first_two_spend(state, seat_index)
        if spent is None or spent < STARTING_BUDGET * share:
            continue
        if scores[seat_index] - scores[1 - seat_index] >= DECIDED_MARGIN:
            out.add(seat_index)
    return out


def _versus(seed: int, pool, opponent) -> tuple[float, dict]:
    """One match, bot in seat `seed % 2`. Returns `(bot_win, state)`; a tie
    counts half, as it does on the scoreboard."""
    bot_seat = seed % 2
    state = play_match(
        seed, pool, seat_strategies={bot_seat: bot_strategy(), 1 - bot_seat: opponent}
    )
    scores = S.final_scores(state, pool)
    mine, theirs = scores[bot_seat], scores[1 - bot_seat]
    return (1.0 if mine > theirs else 0.5 if mine == theirs else 0.0), state


PROXY_SEEDS = 200
SELF_SEEDS = 300


@pytest.fixture(scope="module")
def proxy_sweep(pool):
    return [_versus(seed, pool, rank_aware_proxy) for seed in range(PROXY_SEEDS)]


@pytest.fixture(scope="module")
def self_sweep(pool):
    return [_versus(seed, pool, bot_strategy()) for seed in range(SELF_SEEDS)]


# ---------------------------------------------------------------------------
# The v5 bands
# ---------------------------------------------------------------------------


def test_the_proxy_plays_legally_and_finishes(proxy_sweep, pool):
    from .conftest import assert_terminal_state_is_legal

    for _, state in proxy_sweep[::20]:
        assert S.is_complete(state)
        assert_terminal_state_is_legal(state, pool)


def test_the_bot_is_formidable_but_beatable_against_a_rank_aware_human(proxy_sweep):
    """THE v5 TARGET BAND. v4 measured 78% on these same seeds; v5 is
    calibrated to 60-70% at two thousand seeds, and this two-hundred-seed
    guard holds 55-75% so that neither a slide back toward oppressive nor a
    collapse into a pushover ships unnoticed."""
    wins = statistics.fmean(win for win, _ in proxy_sweep)
    assert 0.55 <= wins <= 0.75, f"bot wins {wins:.1%} of {PROXY_SEEDS} vs the proxy"


def test_the_bot_does_not_hoard_against_a_human(proxy_sweep):
    """It should still spend real money against an opponent who does: a bot
    that wins by waiting for the human to fill their roster and then buying
    stars for a dollar is a different, worse opponent."""
    spend = [
        STARTING_BUDGET - int(state["seats"][seed % 2]["budget"])
        for seed, (_, state) in enumerate(proxy_sweep)
    ]
    assert statistics.fmean(spend) > STARTING_BUDGET * 0.45, statistics.fmean(spend)


def test_self_play_is_symmetric(self_sweep):
    """Neither the opening seat nor the seat parity should decide a match."""
    wins = statistics.fmean(win for win, _ in self_sweep)
    assert 0.40 <= wins <= 0.60, f"seat-alternating self-play win rate {wins:.1%}"


def test_early_double_star_blowouts_are_rare_in_self_play(self_sweep, pool):
    """v4 front-loaded two purchases worth half the budget inside the first
    six lots and won on it in 18.8% of self-play matches (either seat), 5.5%
    with the heavy $12+ double-star shape. v5 measured 5% and under 1%; the
    ceilings here are the halfway marks, so a regression toward v4 fails."""
    early = sum(1 for _, state in self_sweep if _blowouts(state, pool, EARLY_SHARE))
    heavy = sum(1 for _, state in self_sweep if _blowouts(state, pool, HEAVY_SHARE))
    assert early / SELF_SEEDS < 0.10, f"{early} of {SELF_SEEDS} self-play matches were early blowouts"
    assert heavy / SELF_SEEDS < 0.03, f"{heavy} of {SELF_SEEDS} were heavy ($12+) double-star blowouts"


def test_early_blowouts_are_rare_against_a_human(proxy_sweep, pool):
    """The same shape, from the bot's seat, against the proxy."""
    early = sum(
        1 for seed, (_, state) in enumerate(proxy_sweep) if seed % 2 in _blowouts(state, pool, EARLY_SHARE)
    )
    assert early / PROXY_SEEDS < 0.09, f"{early} of {PROXY_SEEDS}: the bot front-loaded and won on it"


def test_the_per_lot_opinion_is_deterministic_and_never_reads_the_score(pool):
    """The opinion stream is keyed on public lot facts only; the same board
    forms the same opinion, and a different budget forms a different one."""
    policy = TwentyDollarBot()
    state = S.initial_state(seed=77)
    seat_index = state["active_seat"]
    public, private, _ = S.project(state, seat_index, pool)
    private = {**private, "candidate_band": "26-50"}
    first = policy._opinion(public, private)
    again = policy._opinion(public, private)
    assert first == again
    richer = {**public, "seats": [{**seat, "budget": seat["budget"] - 3} for seat in public["seats"]]}
    assert policy._opinion(richer, private) != first
    assert abs(first["shift"]) in (0.0, 8.0)
    assert 0.80 <= first["scale"] <= 1.20
