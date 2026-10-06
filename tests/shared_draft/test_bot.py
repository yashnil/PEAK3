"""SHARED DRAFT bot: legal always, strong, not deterministic, never a throw."""
from __future__ import annotations

import random
from collections import Counter

from nba_peak.shared_draft import bot as B
from nba_peak.shared_draft import config as C
from nba_peak.shared_draft import state as S

SEEDS = range(150)


def _drafting(seed: int) -> dict:
    return S.timeout(S.timeout(S.initial_state(seed, [(0, True), (1, True)])))


def _bot(state, seat, rng):
    public, private, _ = S.project(state, seat, is_bot=True)
    return B.choose(B.options(public, private), rng)["card_index"]


def _greedy(state, seat, rng):
    cards = state["board"]["cards"]
    return max(S.legal_cards(state, seat), key=lambda c: (cards[c]["prime_score"], -c))


def _match(seed: int, policies) -> dict:
    state = _drafting(seed)
    while state["phase"] != C.PHASE_COMPLETE:
        seat = S.current_seat(state)
        rng = random.Random(f"{seed}:{seat}:{state['pick_index']}")
        state = S.pick(state, seat, {"card_index": policies[seat](state, seat, rng)})
    return state


def test_every_bot_pick_is_legal_and_every_match_completes():
    for seed in SEEDS:
        final = _match(seed, {0: _bot, 1: _bot})
        assert len(final["picks"]) == 10


def test_the_bot_beats_a_greedy_best_score_drafter_more_often_than_not():
    """Denial and need are worth something: a drafter that only takes the best
    remaining score is beaten clearly, from either side of the snake."""
    wins = margin = games = 0
    for seed in SEEDS:
        for bot_seat in (0, 1):
            policies = {bot_seat: _bot, 1 - bot_seat: _greedy}
            final = _match(seed, policies)
            diff = S.roster_total(final, bot_seat) - S.roster_total(final, 1 - bot_seat)
            wins += diff > 0
            margin += diff
            games += 1
    assert wins / games >= 0.58, wins / games
    assert margin / games > 3.0


def test_the_bot_is_not_a_deterministic_argmax():
    picks = deviations = 0
    for seed in SEEDS:
        state = _drafting(seed)
        while state["phase"] != C.PHASE_COMPLETE:
            seat = S.current_seat(state)
            public, private, _ = S.project(state, seat, is_bot=True)
            options = B.options(public, private)
            chosen = B.choose(options, random.Random(f"{seed}:{state['pick_index']}"))
            picks += 1
            deviations += chosen is not B.viable(options)[0]
            state = S.pick(state, seat, {"card_index": chosen["card_index"]})
    assert 0.08 <= deviations / picks <= 0.35, deviations / picks


def test_same_seeded_situation_same_pick_and_different_seeds_vary():
    varied = 0
    for seed in range(40):
        # Mid-draft: an opening pick is usually one clear star; by pick four
        # the board holds real near-peer decisions.
        state = _drafting(seed)
        for _ in range(3):
            seat = S.current_seat(state)
            state = S.pick(state, seat, {"card_index": _bot(state, seat, random.Random(seed))})
        seat = S.current_seat(state)
        public, private, _ = S.project(state, seat, is_bot=True)
        options = B.options(public, private)
        assert B.choose(options, random.Random(7)) == B.choose(options, random.Random(7))
        seen = {B.choose(options, random.Random(r))["card_index"] for r in range(60)}
        varied += len(seen) > 1
    assert varied >= 10, varied


def test_no_pick_is_ever_a_throw():
    for seed in SEEDS:
        state = _drafting(seed)
        while state["phase"] != C.PHASE_COMPLETE:
            seat = S.current_seat(state)
            public, private, _ = S.project(state, seat, is_bot=True)
            options = B.options(public, private)
            chosen = B.choose(options, random.Random(f"{seed}:{state['pick_index']}"))
            best = max(o["score"] for o in options)
            assert best - chosen["score"] <= C.BOT_MAX_QUALITY_REGRET_POINTS
            assert B.viable(options)[0]["utility"] - chosen["utility"] <= C.BOT_REGRET_CAP
            state = S.pick(state, seat, {"card_index": chosen["card_index"]})


def test_denial_is_priced_when_the_opponent_needs_the_position():
    """Scripted: two centres on the board, the opponent still needs one and
    picks next. Taking the better centre denies them the gap."""
    public = {
        "order": [0, 1, 1, 0],
        "pick_index": 0,
        "cards": [
            {"card_index": 0, "position": "C", "drafted_by": None},
            {"card_index": 1, "position": "C", "drafted_by": None},
            {"card_index": 2, "position": "PG", "drafted_by": None},
            {"card_index": 3, "position": "PG", "drafted_by": None},
        ],
        "seats": [
            {"seat_index": 0, "roster": {"PG": None, "C": None}},
            {"seat_index": 1, "roster": {"PG": None, "C": None}},
        ],
    }
    private = {"seat_index": 0, "legal_cards": [0, 1, 2, 3],
               "card_scores": {"0": 90.0, "1": 60.0, "2": 85.0, "3": 82.0}}
    options = {o["card_index"]: o for o in B.options(public, private)}
    assert options[0]["denial"] == 30.0
    assert options[2]["denial"] == 3.0
    # The scarce, contested centre beats the marginally better-looking guard
    # decision on margin, and the bot takes it every time.
    assert options[0]["utility"] > options[2]["utility"]
    picks = Counter(B.choose(list(options.values()), random.Random(r))["card_index"] for r in range(200))
    assert picks[0] == 200


def test_deliberation_is_rng_free_and_bounded():
    state = _drafting(3)
    seat = S.current_seat(state)
    public, private, _ = S.project(state, seat, is_bot=True)
    value = B.deliberation(public, private)
    assert value == B.deliberation(public, private)
    assert 0.0 <= value <= 1.0
