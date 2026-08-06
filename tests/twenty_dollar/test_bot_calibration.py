"""The $20 Showdown calibration suite: a thousand deterministic matches.

WHY A SIMULATION SUITE RATHER THAN MORE UNIT TESTS
---------------------------------------------------
Every property this module checks is a claim about a DISTRIBUTION, and a
distribution cannot be asserted from one hand-built state. "The bot does not
irrationally overbid a weak candidate" is not a fact about any single lot -- a
bot that pays $9 for a rank-400 centre once because it is the last slot and
the money is dead is behaving correctly. It is a fact about what happens across
a thousand boards, and it is only falsifiable at that scale.

The two properties that make the suite worth its runtime are the ones a
reviewer cannot check by reading: that EVERY match terminates inside the hard
lot cap, and that the price a candidate fetches actually tracks the tier it was
drawn from. Both were assumptions in the previous ruleset and both were wrong
(a match could run 60 lots of mutual passing, and a bot's ceiling was blind to
who it was bidding on).

DETERMINISM IS THE WHOLE POINT. Every match is a pure function of its seed, so
a failure names a seed a developer can replay in isolation, and re-running the
suite cannot produce a different verdict.
"""
from __future__ import annotations

import random
import statistics
from collections import Counter, defaultdict

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import (
    CLOSEOUT_FIT_GUARANTEE_LOTS,
    HARD_MAX_LOTS,
    MARKET_CLOSEOUT,
    MARKET_SKIPS_PER_SEAT,
    ROSTER_SIZE,
    STANDARD_MARKET_LOTS,
    STARTING_BUDGET,
)
from nba_peak.twenty_dollar.pool import get_pool

#: How many seeds the full sweep runs.
#:
#: The original brief asked for at least a thousand; the production-rescue
#: specification (PART 18) asks for at least two thousand deterministic full
#: bot-versus-bot matches, and names the metrics they must produce. Raised
#: rather than duplicated into a second suite, so there is one number and one
#: definition of "the sweep".
SEED_COUNT = 2000

#: A guard, not a limit. A match that needed this many ACTIONS would already
#: have failed the lot-cap assertion; this exists so a genuine infinite loop
#: fails as a test rather than as a hung CI job.
MAX_ACTIONS = 4000


def _play(seed: int, pool, policy: TwentyDollarBot) -> dict:
    """One full bot-vs-bot match. Pure in `seed`.

    The private projection is built exactly as `services/twenty_dollar/mode.py`
    builds it for a bot seat -- coarse tier included, hidden score excluded --
    so this simulates the shipped opponent rather than a stand-in.
    """
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    actions = 0
    while not S.is_complete(state):
        actions += 1
        assert actions < MAX_ACTIONS, f"seed {seed}: match did not terminate"
        seat_index = state["active_seat"]
        assert seat_index is not None, f"seed {seed}: live match with no seat on the clock"
        public, private, legal = S.project(state, seat_index, pool)
        private = {**private, "candidate_tier": state.get("current_candidate_tier")}
        command, payload = policy.decide(public, private, rng)
        assert command in legal, (
            f"seed {seed}: policy chose {command!r}, legal was {legal}"
        )
        _, code, message = S.submit_action(
            state, seat_index, command, int(payload.get("amount", 0)), pool
        )
        assert code is None, f"seed {seed}: unexpected rejection {code}: {message}"
    return state


@pytest.fixture(scope="module")
def sweep(pool):
    """Every terminal state, plus the aggregates the assertions read.

    Built once for the module. Two thousand matches is a few seconds of work
    and twenty-odd separate assertions over it; re-simulating per test would be
    twenty times the runtime for identical data.
    """
    policy = TwentyDollarBot()
    states = [_play(seed, pool, policy) for seed in range(SEED_COUNT)]

    lots: list[int] = []
    spend: list[int] = []
    remaining: list[int] = []
    skips_used: list[int] = []
    prices_by_tier: dict[str, list[int]] = defaultdict(list)
    roster_totals: list[float] = []
    timeouts = 0
    extreme_overpays: list[dict] = []
    closeout_matches = 0
    autofilled_matches = 0

    for state in states:
        roster_totals.extend(S.final_scores(state, pool))
        auctioned = [
            record
            for record in state["history"]
            if record["decided_by"] != S.DECIDED_BY_AUTOFILL
        ]
        lots.append(len(auctioned))
        if state.get("market_phase") == MARKET_CLOSEOUT:
            closeout_matches += 1
        if state["autofilled"]:
            autofilled_matches += 1
        for seat in state["seats"]:
            remaining.append(int(seat["budget"]))
            spend.append(STARTING_BUDGET - int(seat["budget"]))
            skips_used.append(MARKET_SKIPS_PER_SEAT - int(seat["market_skips"]))
        for record in auctioned:
            timeouts += sum(1 for flag in record.get("timed_out", ()) if flag)
            if record["winner_seat"] is None or not record.get("candidate_tier"):
                continue
            price = int(record["price"])
            prices_by_tier[record["candidate_tier"]].append(price)
            # AN EXTREME OVERPAYMENT, defined against the tier the candidate was
            # actually drawn from rather than against its hidden score -- the
            # bot cannot see the score, so judging it by one would be scoring a
            # different opponent. More than half the $20 budget on a bottom-tier
            # candidate is the shape PART 18 asks to be counted.
            if record["candidate_tier"] == "251-500" and price > STARTING_BUDGET // 2:
                extreme_overpays.append(
                    {
                        "player": record["candidate"]["player_name"],
                        "price": price,
                        "tier": record["candidate_tier"],
                    }
                )

    return {
        "states": states,
        "lots": lots,
        "spend": spend,
        "remaining": remaining,
        "skips_used": skips_used,
        "prices_by_tier": dict(prices_by_tier),
        "roster_totals": roster_totals,
        "timeouts": timeouts,
        "extreme_overpays": extreme_overpays,
        "closeout_matches": closeout_matches,
        "autofilled_matches": autofilled_matches,
    }


# ---------------------------------------------------------------------------
# Termination
# ---------------------------------------------------------------------------


def test_every_seeded_match_completes(sweep):
    assert len(sweep["states"]) == SEED_COUNT
    assert all(S.is_complete(state) for state in sweep["states"])


def test_every_roster_is_complete_and_legal(sweep, pool):
    from .conftest import assert_terminal_state_is_legal

    for state in sweep["states"]:
        for seat in state["seats"]:
            assert len(seat["roster"]) == ROSTER_SIZE
    # The full structural check is expensive; run it over a deterministic
    # sample rather than not at all, and over the whole sweep for the cheap
    # invariants above.
    for state in sweep["states"][::50]:
        assert_terminal_state_is_legal(state, pool)


def test_no_match_reaches_the_hard_lot_cap(sweep):
    """The cap is a PROOF, not a mechanism. Reaching it would mean the skip
    economy and the closeout market both failed to converge a match."""
    assert max(sweep["lots"]) <= HARD_MAX_LOTS
    assert sweep["autofilled_matches"] == 0, (
        "the auto-fill escape hatch fired, so some match could not finish "
        "through the market"
    )


def test_no_infinite_pass_loop_survives_the_skip_economy(sweep):
    """A match of nothing but passes would run the full cap. None do."""
    assert max(sweep["lots"]) < HARD_MAX_LOTS
    assert statistics.mean(sweep["lots"]) < STANDARD_MARKET_LOTS


def test_the_closeout_market_is_the_exception_not_the_rule(sweep):
    """It exists for the matches that need it and should not be routine."""
    assert sweep["closeout_matches"] < SEED_COUNT * 0.25


# ---------------------------------------------------------------------------
# The closeout guarantee
# ---------------------------------------------------------------------------


def _one_slot_short(seed: int, pool, missing: str = "C") -> dict:
    """A state in the closeout market with both seats needing the same slot.

    THE CLOSEOUT MARKET IS DRIVEN DIRECTLY HERE RATHER THAN PLAYED INTO, and
    that is the honest way round. Across a thousand bot-vs-bot matches the
    closeout market opens twice, because the skip economy converges almost
    every match inside 24 lots -- which is the point of the skip economy and a
    good thing. A property tested on a sample of two is not tested.

    So the state is constructed at exactly the shape the closeout market
    exists for: both rosters one slot short of complete, in the same scarce
    position, at the lot the standard market ends on. That is the hardest case
    the feasibility guarantee has to survive, and it is where "serve the
    missing position every lot" would be most tempting.
    """
    state = S.initial_state(seed=seed)
    filled = [slot for slot in ("PG", "SG", "SF", "PF", "C") if slot != missing]

    # Real players from the qualified pool, each fitting exactly one of the
    # slots we want filled -- no fabricated cards.
    chosen: dict[int, list] = {0: [], 1: []}
    used: set[str] = set()
    for seat_index in (0, 1):
        for slot in filled:
            for candidate in pool.qualified:
                if candidate.player_slug in used:
                    continue
                if candidate.positions == frozenset({slot}):
                    chosen[seat_index].append(candidate)
                    used.add(candidate.player_slug)
                    break
            else:  # pragma: no cover - the pool has singles at every slot
                pytest.skip(f"no single-position {slot} left in the qualified pool")

    for seat_index, candidates in chosen.items():
        state["seats"][seat_index]["roster"] = [
            {
                "player_slug": candidate.player_slug,
                "price": 1,
                "lot_index": index,
                "round_index": index,
            }
            for index, candidate in enumerate(candidates)
        ]
        state["seats"][seat_index]["budget"] = 8
        state["offered"].extend(c.player_slug for c in candidates)

    state["lot_index"] = STANDARD_MARKET_LOTS
    S._advance_lot(state, pool)
    return state


def _closeout_offers(seed: int, pool, missing: str = "C") -> list:
    """Every closeout lot's candidate, in order, as `(slug, fits)`.

    READ FROM `history`, NOT FROM THE LIVE LOOP. A candidate neither seat can
    use never becomes an actionable lot at all -- `_advance_lot` sees that no
    seat can act, resolves it unsold and draws again, all inside one call. A
    driver that only recorded the lots it was handed control of would
    therefore record exactly the fitting ones and conclude the market only
    serves the missing position, which is the opposite of the truth.

    Rosters are frozen (every lot is declined), so "fits" reduces exactly to
    "can play the one slot both seats still need" -- asserted against
    `can_seat_acquire` in `test_the_fit_shorthand_matches_the_real_check`
    rather than assumed.
    """
    state = _one_slot_short(seed, pool)
    guard = 0
    while not S.is_complete(state) and state.get("current_candidate"):
        guard += 1
        assert guard < 100, f"seed {seed}: closeout market did not terminate"
        S._resolve_lot(state, pool, decided_by=S.DECIDED_BY_UNSOLD)
    return [
        (
            record["candidate"]["player_slug"],
            missing in (record["candidate"].get("positions") or []),
        )
        for record in state["history"]
        if record["decided_by"] != S.DECIDED_BY_AUTOFILL
        and record["lot_index"] >= STANDARD_MARKET_LOTS
    ]


def test_the_fit_shorthand_matches_the_real_check(pool):
    """`_closeout_offers` reduces "fits" to a position test. Justify it."""
    state = _one_slot_short(11, pool)
    candidate = pool.get(state["current_candidate"])
    for index in (0, 1):
        assert S.can_seat_acquire(state, index, candidate, pool) == (
            "C" in candidate.positions
        )


def test_the_standard_market_hands_over_to_the_closeout_market(pool):
    state = _one_slot_short(11, pool)
    assert state["market_phase"] == MARKET_CLOSEOUT
    assert state["lot_index"] >= STANDARD_MARKET_LOTS


@pytest.mark.parametrize("seed", [11, 202, 3003, 40404, 555555])
def test_the_closeout_market_never_starves_an_incomplete_roster(seed, pool):
    """No incomplete roster waits more than `CLOSEOUT_FIT_GUARANTEE_LOTS`.

    Measured on the SEQUENCE of what was offered, because a seat served
    eventually is not the same as a seat never starved.
    """
    dry = 0
    offers = _closeout_offers(seed, pool)
    assert offers, f"seed {seed}: the closeout market offered nothing"
    for slug, fits in offers:
        dry = 0 if fits else dry + 1
        assert dry <= CLOSEOUT_FIT_GUARANTEE_LOTS, (
            f"seed {seed}: both seats went {dry} closeout lots without a "
            f"legally fitting candidate (last was {slug})"
        )


def test_the_closeout_market_still_offers_players_nobody_needs(pool):
    """The guarantee must not become "every card fits the missing position".

    A closeout market that served the answer every lot would be a vending
    machine. With both seats needing a centre, at least some lots must still be
    guards and forwards drawn from the open market.
    """
    non_fitting = 0
    total = 0
    for seed in (11, 202, 3003, 40404, 555555, 6060, 777777):
        for _slug, fits in _closeout_offers(seed, pool):
            total += 1
            if not fits:
                non_fitting += 1
    assert total > 0
    assert non_fitting > 0, (
        "every closeout candidate fitted an incomplete roster -- the market is "
        "serving the missing position rather than drawing from it"
    )
    assert non_fitting / total > 0.25, (
        f"only {non_fitting} of {total} closeout candidates were players the "
        "stuck rosters could not use -- the market is too tailored"
    )
    assert non_fitting < total, "the guarantee never fired"


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------


def test_the_bot_spends_most_of_its_budget_but_never_all_blindly(sweep):
    """Unspent money scores nothing, so hoarding is a loss. Emptying the bank
    on lot two would be worse."""
    mean_spend = statistics.mean(sweep["spend"])
    assert STARTING_BUDGET * 0.45 < mean_spend < STARTING_BUDGET * 0.95
    assert min(sweep["remaining"]) >= 0


def test_the_reserve_rule_is_never_breached(sweep):
    """A seat always holds at least a dollar for every slot it still owes.

    Checked on terminal states, where every roster is full, so the surviving
    claim is the simpler one: nothing went negative and nothing was bought
    that could not be paid for.
    """
    for state in sweep["states"]:
        for seat in state["seats"]:
            assert seat["budget"] >= 0
            assert sum(entry["price"] for entry in seat["roster"]) <= STARTING_BUDGET


def test_price_rises_with_candidate_tier(sweep):
    """The property the previous bot did not have.

    Its ceiling was a share of the remaining budget, so a rank-400 player in
    an early lot cost the same as a top-ten peak. Prices must now separate by
    the band a candidate was drawn from -- strictly, and by a real margin.
    """
    prices = sweep["prices_by_tier"]
    assert set(prices) >= {"1-100", "101-250", "251-500"}
    elite = statistics.mean(prices["1-100"])
    middle = statistics.mean(prices["101-250"])
    deep = statistics.mean(prices["251-500"])
    assert elite > middle > deep
    assert elite > deep * 2, (
        f"elite {elite:.2f} vs deep {deep:.2f}: the bands are not separated"
    )


def test_a_bottom_tier_candidate_rarely_consumes_a_large_share_of_a_budget(sweep):
    """Scottie Barnes must not escalate merely because he fits.

    A high price on a rank-251+ player is ALLOWED -- it is correct when it is
    the last slot and the money is otherwise dead -- so this bounds the
    frequency rather than forbidding the case.
    """
    deep = sweep["prices_by_tier"]["251-500"]
    extravagant = [price for price in deep if price > STARTING_BUDGET * 0.4]
    assert len(extravagant) / len(deep) < 0.05, (
        f"{len(extravagant)} of {len(deep)} bottom-tier buys took over 40% of a "
        "starting budget"
    )
    assert statistics.median(deep) <= 2


# ---------------------------------------------------------------------------
# Skips
# ---------------------------------------------------------------------------


def test_the_skip_allowance_binds_without_dominating(sweep):
    """Five skips should be a real constraint that most matches do not exhaust.

    If nobody ever spends one the economy is decoration; if everybody runs out
    the game is forced bidding rather than judgement.
    """
    used = sweep["skips_used"]
    assert max(used) <= MARKET_SKIPS_PER_SEAT
    assert statistics.mean(used) > 0.5, "skips are never used -- the rule is inert"
    exhausted = sum(1 for value in used if value == MARKET_SKIPS_PER_SEAT)
    assert exhausted / len(used) < 0.5, "most seats run out -- the allowance is too tight"


# ---------------------------------------------------------------------------
# Imperfection
# ---------------------------------------------------------------------------


def test_the_bot_is_not_always_the_same_bot(sweep):
    """A deterministic policy still has to produce varied play.

    If every match spent the same money on the same shape of roster, the
    "imperfect" calibration would be a comment rather than a behaviour.
    """
    assert len(set(sweep["spend"])) > 8
    assert statistics.pstdev(sweep["spend"]) > 1.5


def test_neither_seat_wins_the_money_battle_systematically(sweep):
    """The opener alternates, so neither seat should end richer on average by
    more than noise. A large gap would mean the bot's own turn order beat it."""
    first = sweep["spend"][0::2]
    second = sweep["spend"][1::2]
    assert abs(statistics.mean(first) - statistics.mean(second)) < 2.0


def test_the_bot_replays_identically_from_the_same_seed(pool):
    policy = TwentyDollarBot()
    for seed in (3, 1234, 99999):
        first = _play(seed, pool, policy)
        second = _play(seed, pool, policy)
        assert [
            (r["candidate"]["player_slug"], r["winner_seat"], r["price"])
            for r in first["history"]
        ] == [
            (r["candidate"]["player_slug"], r["winner_seat"], r["price"])
            for r in second["history"]
        ]


def test_the_bot_does_not_read_the_hidden_score(pool):
    """Structural, not behavioural: the projection it is handed has no score.

    Asserted over the actual dicts the policy receives, recursively, so a
    future field carrying a score reopens this as a failure rather than as a
    quiet capability.
    """
    banned = {"prime_score", "rank", "components", "component_index"}
    state = S.initial_state(seed=4242)
    public, private, _ = S.project(state, state["active_seat"], pool)
    private = {**private, "candidate_tier": state.get("current_candidate_tier")}

    def walk(node, path):
        if isinstance(node, dict):
            for key, value in node.items():
                assert key not in banned, f"{path}.{key} reached the bot"
                walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for item in node:
                walk(item, path)

    walk(public.get("candidate"), "public.candidate")
    walk(private, "private")
    # And the tier really is only the coarse band, not a rank.
    assert private["candidate_tier"] in {"1-100", "101-250", "251-500", "unranked"}


def test_a_human_pass_does_not_force_a_bot_pass_over_many_seeds(pool):
    """The reported v1 defect, at distribution scale.

    Seat 0 declines everything the rules allow. If the bot mirrored that,
    almost nothing would be bought.
    """
    from .conftest import always_pass, bot_strategy, play_match

    bought = 0
    for seed in range(60):
        state = play_match(
            seed, pool, seat_strategies={0: always_pass, 1: bot_strategy()}
        )
        bought += sum(
            1
            for record in state["history"]
            if record["winner_seat"] == 1
            and record["decided_by"] != S.DECIDED_BY_AUTOFILL
        )
    assert bought > 60 * 2, "the bot largely mirrored the human's passing"


def test_the_bot_makes_bounded_nonoptimal_decisions(pool):
    """Its two deliberate errors are real, bounded and countable.

    Measured where the ceiling actually decides something: WITH A STANDING BID
    near the bot's valuation. On an opening bid the answer is always "$1",
    because an ascending bidder raises by the minimum -- so a test run there
    would be measuring the auction format, not the policy.
    """
    policy = TwentyDollarBot()
    state = S.initial_state(seed=2024)
    opener = state["active_seat"]
    other = 1 - opener
    # Walk the price up to roughly where a top-100 candidate is valued, so the
    # stay/step-away decision is genuinely marginal. Below the ceiling the
    # answer is always "raise" and above it always "step away"; only at the
    # ceiling do the jitter and the stretch/flinch draws decide anything.
    S.submit_action(state, opener, S.COMMAND_BID, 6, pool)

    public, private, _ = S.project(state, other, pool)
    private = {**private, "candidate_tier": "1-100"}

    decisions = Counter()
    for index in range(500):
        command, payload = policy.decide(public, private, random.Random(f"s{index}"))
        decisions[(command, payload.get("amount"))] += 1

    assert len(decisions) > 1, (
        "the policy answered identically on every stream -- the calibrated "
        "jitter and the stretch/flinch draws are not reaching the decision"
    )
    stays = sum(count for (command, _), count in decisions.items() if command == "bid")
    # BOTH answers must occur. A bot that always stays is walkable; one that
    # always folds at its ceiling is readable.
    assert 0 < stays < 500


def test_a_redundant_candidate_is_valued_below_a_needed_one(pool):
    """Marginal roster improvement, isolated.

    The same coarse tier, the same budget, the same lot -- but one seat can
    use the candidate and the other has that slot filled. The second must not
    pay more, and in practice must value them at nothing.
    """
    policy = TwentyDollarBot()
    state = S.initial_state(seed=91)
    seat_index = state["active_seat"]
    public, private, _ = S.project(state, seat_index, pool)
    needed = {**private, "candidate_tier": "1-100"}
    redundant = {**needed, "candidate_fits": [], "can_acquire_candidate": False}

    rng = random.Random("fixed")
    needed_ceiling = policy.ceiling(public, needed, random.Random("fixed"))
    redundant_ceiling = policy.ceiling(public, redundant, rng)
    assert redundant_ceiling == 0
    assert needed_ceiling > 0


def test_a_deep_tier_candidate_is_valued_below_an_elite_one(pool):
    """The tier is the only thing that changes; the price must follow it."""
    policy = TwentyDollarBot()
    state = S.initial_state(seed=91)
    seat_index = state["active_seat"]
    public, private, _ = S.project(state, seat_index, pool)

    ceilings = {
        tier: policy.ceiling(
            public, {**private, "candidate_tier": tier}, random.Random("fixed")
        )
        for tier in ("1-100", "101-250", "251-500")
    }
    assert ceilings["1-100"] > ceilings["101-250"] >= ceilings["251-500"]


# ---------------------------------------------------------------------------
# PART 18's reported metrics
# ---------------------------------------------------------------------------


def test_no_extreme_overpayment_for_a_bottom_tier_candidate(sweep):
    """PART 18: the bot must not "overpay irrationally for redundant weak
    players".

    Judged against the TIER the candidate was drawn from, not against its
    hidden score -- the bot cannot see the score, so scoring it by one would be
    grading a different opponent. Spending more than half of $20 on a
    rank-251-500 candidate is the shape being counted.

    Not asserted as zero: a seat whose last slot needs a centre, holding money
    it cannot otherwise spend, is behaving correctly when it pays up. Asserted
    as RARE, because a policy that did it routinely would be the defect.
    """
    total_sold = sum(len(prices) for prices in sweep["prices_by_tier"].values())
    rate = len(sweep["extreme_overpays"]) / max(1, total_sold)
    assert rate < 0.01, (
        f"{len(sweep['extreme_overpays'])} of {total_sold} sales were more than "
        f"half a budget on a bottom-tier candidate ({rate:.3%})"
    )


def test_no_timeouts_occur_in_a_bot_versus_bot_sweep(sweep):
    """A bot always has a legal move, so a simulated match never times out.

    Worth asserting rather than assuming: a policy that returned an illegal
    command would be resolved through the mode's timeout path in production
    (`bots._resolve_stalled_bot_turn`), and the symptom there is a silently
    worse opponent rather than an error.
    """
    assert sweep["timeouts"] == 0


def test_final_roster_scores_are_a_real_distribution(sweep):
    """Not a fixed answer, and not noise.

    Two identical rosters every match would mean the auction decides nothing;
    a spread as wide as the pool would mean the reserve rule is not binding.
    """
    totals = sweep["roster_totals"]
    assert len(totals) == 2 * SEED_COUNT
    assert all(total > 0 for total in totals)
    spread = statistics.pstdev(totals)
    assert 5.0 < spread < 60.0, spread


def test_simulation_report_is_printable(sweep, capsys):
    """Emits the metrics PART 18 asks to be reported.

    A test rather than a script so the numbers come from the same run CI
    already pays for, and so they cannot drift from what is actually asserted.
    """
    lots = sweep["lots"]
    with capsys.disabled():
        print("\n--- $20 Showdown bot-vs-bot simulation ---")
        print(f"  matches                          {SEED_COUNT}")
        print(f"  completion rate                  {len(sweep['states']) / SEED_COUNT:.4f}")
        print(f"  max auctioned lots               {max(lots)}")
        print(f"  mean auctioned lots              {statistics.fmean(lots):.2f}")
        print(f"  hard lot cap                     {HARD_MAX_LOTS}")
        print(f"  closeout matches                 {sweep['closeout_matches']}")
        print(f"  auto-filled matches              {sweep['autofilled_matches']}")
        for tier in sorted(sweep["prices_by_tier"]):
            prices = sweep["prices_by_tier"][tier]
            print(
                f"  mean price · tier {tier:<9}    ${statistics.fmean(prices):.2f} "
                f"(n={len(prices)}, max=${max(prices)})"
            )
        print(f"  mean spend per seat              ${statistics.fmean(sweep['spend']):.2f}")
        print(f"  mean budget remaining            ${statistics.fmean(sweep['remaining']):.2f}")
        print(f"  mean market skips used           {statistics.fmean(sweep['skips_used']):.2f}")
        print(
            f"  final roster score               "
            f"mean {statistics.fmean(sweep['roster_totals']):.1f} "
            f"sd {statistics.pstdev(sweep['roster_totals']):.1f}"
        )
        print(f"  illegal actions                  0 (asserted in _play)")
        print(f"  timeouts                         {sweep['timeouts']}")
        print(f"  extreme overpayments             {len(sweep['extreme_overpays'])}")
