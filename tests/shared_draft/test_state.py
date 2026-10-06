"""SHARED DRAFT rules: the pool, the board, the order, exclusivity, legality.

Pure rules, no database. The Arena seam is tested in
`apps/api/tests/test_arena_shared_draft.py`.
"""
from __future__ import annotations

import itertools
import json
import random
from collections import Counter

import pytest

from nba_peak.perfect_season.career_positions import primary_position
from nba_peak.shared_draft import config as C
from nba_peak.shared_draft import state as S
from nba_peak.shared_draft.pool import SEASONS_PATH, latest_season_slugs, get_latest_season_pool, latest_completed_season
from nba_peak.twenty_dollar.pool import get_pool as showdown_pool

SEEDS = range(200)


def _drafting(seed: int, seats=((0, False), (1, True))) -> dict:
    """A match through arrival and intro, at pick one."""
    state = S.initial_state(seed, list(seats))
    state = S.timeout(state)  # arrival backstop -> intro
    state = S.timeout(state)  # intro -> pick
    assert state["phase"] == C.PHASE_PICK
    return state


def _play(state: dict, chooser) -> dict:
    while state["phase"] != C.PHASE_COMPLETE:
        seat = S.current_seat(state)
        state = S.pick(state, seat, {"card_index": chooser(state, seat)})
    return state


# ---------------------------------------------------------------------------
# Who is eligible (latest completed season -- not a roster check), and their card
# ---------------------------------------------------------------------------


def test_eligible_means_a_row_in_the_latest_scored_season():
    rows = json.loads(SEASONS_PATH.read_text())["rows"]
    latest = latest_completed_season()
    # Derived from the data, never a hand-kept list or a hard-coded year.
    assert latest == max(r["season_end"] for r in rows if r["score_status"] == "exact_season_scored")
    assert latest_season_slugs() == {r["player_slug"] for r in rows if r["season_end"] == latest}


def test_every_card_is_a_latest_season_player_on_an_official_completed_card():
    pool = get_latest_season_pool()
    active = latest_season_slugs()
    showdown = {c.row_id: c for c in showdown_pool().candidates}
    for slot in C.SLOTS:
        assert len(pool.depth(slot)) >= C.POSITION_DEPTH
        for card in pool.depth(slot):
            assert card.player_slug in active
            assert card.position == slot == primary_position(card.player_slug)
            # The card IS the published canonical 1Y row -- same id, same score.
            published = showdown[card.row_id]
            assert published.prime_score == card.prime_score
            assert published.anchor_season == card.peak_season
            # Never a season later than the latest completed one.
            assert int(card.peak_season[:4]) + 1 <= pool.latest_season_end


def test_no_card_uses_an_in_progress_season():
    data = json.loads(
        (SEASONS_PATH.parent / "top_1000_peaks.v1.json").read_text()
    )["windows"]["1y"]["rows"]
    in_progress = {r["row_id"] for r in data if r.get("season_in_progress")}
    for slot in C.SLOTS:
        assert not {c.row_id for c in get_latest_season_pool().depth(slot)} & in_progress


# ---------------------------------------------------------------------------
# The board
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("seed", list(SEEDS)[:60])
def test_a_board_is_twelve_distinct_cards_with_at_least_two_per_position(seed):
    board = S.generate_board(seed)["cards"]
    assert len(board) == C.BOARD_SIZE == 12
    assert len({c["player_slug"] for c in board}) == len(board)
    counts = Counter(c["position"] for c in board)
    assert set(counts) == set(C.SLOTS)
    assert all(n >= C.CARDS_PER_POSITION for n in counts.values())
    assert [c["card_index"] for c in board] == list(range(len(board)))


def test_boards_are_deterministic_and_vary_by_seed():
    assert S.generate_board(11) == S.generate_board(11)
    boards = {tuple(c["player_slug"] for c in S.generate_board(seed)["cards"]) for seed in SEEDS}
    assert len(boards) == len(SEEDS)


def test_board_order_is_not_score_order():
    """Scores are hidden; board order must not leak them."""
    sorted_boards = 0
    for seed in SEEDS:
        cards = S.generate_board(seed)["cards"]
        for slot in C.SLOTS:
            scores = [c["prime_score"] for c in cards if c["position"] == slot]
            if scores == sorted(scores, reverse=True):
                sorted_boards += 1
    # Each position is shuffled: about half of 2-card columns read descending.
    assert sorted_boards < 0.7 * len(SEEDS) * len(C.SLOTS)


# ---------------------------------------------------------------------------
# Order, exclusivity, legality
# ---------------------------------------------------------------------------


def test_the_order_is_a_two_team_snake_with_a_seeded_opener():
    openers = Counter()
    for seed in SEEDS:
        order = S.pick_order(seed)
        a = order[0]
        b = 1 - a
        assert order == [a, b, b, a, a, b, b, a, a, b]
        assert order.count(0) == order.count(1) == C.ROSTER_SIZE
        openers[a] += 1
    assert 70 <= openers[0] <= 130


def test_arrival_waits_for_humans_and_bots_are_pre_arrived():
    state = S.initial_state(3, [(0, False), (1, True)])
    assert state["phase"] == C.PHASE_ARRIVAL
    with pytest.raises(S.RuleError) as exc:
        S.pick(state, S.pick_order(3)[0], {"card_index": 0})
    assert exc.value.code == S.REJECT_NOT_PICKING
    state = S.intro_seen(state, 0)
    assert state["phase"] == C.PHASE_INTRO
    with pytest.raises(S.RuleError):
        S.intro_seen(state, 0)


def test_two_humans_both_have_to_arrive():
    state = S.initial_state(3, [(0, False), (1, False)])
    state = S.intro_seen(state, 1)
    assert state["phase"] == C.PHASE_ARRIVAL
    state = S.intro_seen(state, 0)
    assert state["phase"] == C.PHASE_INTRO


def test_the_arrival_backstop_opens_the_intro_never_a_pick():
    state = S.timeout(S.initial_state(3, [(0, False), (1, False)]))
    assert state["phase"] == C.PHASE_INTRO
    assert state["picks"] == []


def test_a_drafted_card_is_locked_out_for_the_other_seat():
    state = _drafting(5)
    first = S.current_seat(state)
    card = S.legal_cards(state, first)[0]
    state = S.pick(state, first, {"card_index": card})
    second = S.current_seat(state)
    assert second != first
    assert card not in S.legal_cards(state, second)
    with pytest.raises(S.RuleError) as exc:
        S.pick(state, second, {"card_index": card})
    assert exc.value.code == S.REJECT_CARD_TAKEN
    public, _, _ = S.project(state, second)
    assert public["cards"][card]["drafted_by"] == first
    assert public["cards"][card]["pick_number"] == 1


def test_out_of_turn_filled_slot_and_stale_picks_are_refused():
    state = _drafting(9)
    first = S.current_seat(state)
    other = 1 - first
    with pytest.raises(S.RuleError) as exc:
        S.pick(state, other, {"card_index": 0})
    assert exc.value.code == S.REJECT_NOT_YOUR_TURN
    with pytest.raises(S.RuleError) as exc:
        S.pick(state, first, {"card_index": 0, "pick_number": 2})
    assert exc.value.code == S.REJECT_WRONG_PICK
    with pytest.raises(S.RuleError) as exc:
        S.pick(state, first, {})
    assert exc.value.code == S.REJECT_BAD_PAYLOAD
    # Fill a slot, then try to fill it again on this seat's next turn.
    cards = state["board"]["cards"]
    taken = S.legal_cards(state, first)[0]
    state = S.pick(state, first, {"card_index": taken})
    while S.current_seat(state) != first:
        seat = S.current_seat(state)
        avoid = [c for c in S.legal_cards(state, seat) if cards[c]["position"] != cards[taken]["position"]]
        state = S.pick(state, seat, {"card_index": (avoid or S.legal_cards(state, seat))[0]})
    same = [
        c["card_index"] for c in cards
        if c["position"] == cards[taken]["position"] and c["card_index"] not in S.taken_by(state)
    ]
    if same:
        with pytest.raises(S.RuleError) as exc:
            S.pick(state, first, {"card_index": same[0]})
        assert exc.value.code == S.REJECT_SLOT_FILLED


def test_no_order_of_picks_can_strand_a_roster():
    """Exhaustive over an adversarial policy family: whichever legal card each
    side takes, every seat always has a legal pick and finishes with exactly
    one card per position."""
    for seed in list(SEEDS)[:40]:
        for strategy in ("first", "last", "deny", "random"):
            rng = random.Random(seed)

            def chooser(state, seat):
                legal = S.legal_cards(state, seat)
                assert legal, f"seed {seed}: seat {seat} stranded"
                if strategy == "first":
                    return legal[0]
                if strategy == "last":
                    return legal[-1]
                if strategy == "deny":
                    # Take a card at a position the OTHER seat still needs.
                    needs = set(S.open_positions(state, 1 - seat))
                    cards = state["board"]["cards"]
                    return next((c for c in legal if cards[c]["position"] in needs), legal[0])
                return rng.choice(legal)

            final = _play(_drafting(seed), chooser)
            for seat in (0, 1):
                assert all(card is not None for card in S.roster(final, seat).values())
            assert len({p["card_index"] for p in final["picks"]}) == 10


def test_a_timed_out_pick_takes_the_first_legal_card_in_board_order():
    state = _drafting(21)
    seat = S.current_seat(state)
    expected = S.legal_cards(state, seat)[0]
    after = S.timeout(state)
    assert after["picks"][-1] == {"pick_number": 1, "seat_index": seat, "card_index": expected, "auto": C.AUTO_TIMEOUT}


def test_a_timeout_never_takes_the_best_card_by_construction():
    """The stall exploit: if a timeout took the best card, never picking would
    be a perfect strategy. Over many boards the auto-pick is the best legal
    card no more often than a uniform draw would be."""
    best = 0
    for seed in SEEDS:
        state = _drafting(seed)
        seat = S.current_seat(state)
        legal = S.legal_cards(state, seat)
        cards = state["board"]["cards"]
        top = max(legal, key=lambda c: cards[c]["prime_score"])
        best += S.timeout(state)["picks"][-1]["card_index"] == top
    assert best / len(SEEDS) < 0.35


def test_input_state_is_never_mutated():
    state = _drafting(4)
    snapshot = json.dumps(state, sort_keys=True)
    seat = S.current_seat(state)
    S.pick(state, seat, {"card_index": S.legal_cards(state, seat)[0]})
    S.timeout(state)
    S.forfeit(state, 0)
    assert json.dumps(state, sort_keys=True) == snapshot


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


def test_the_roster_total_is_the_sum_of_the_five_published_scores():
    final = _play(_drafting(8), lambda st, seat: S.legal_cards(st, seat)[0])
    cards = final["board"]["cards"]
    for seat in (0, 1):
        expected = sum(cards[c]["prime_score"] for c in S.roster(final, seat).values())
        assert S.roster_total(final, seat) == pytest.approx(expected)
    places = S.placements(final)
    totals = {seat: S.roster_total(final, seat) for seat in (0, 1)}
    winner = max(totals, key=totals.get)
    assert places[winner] == (1, "win")
    assert places[1 - winner] == (2, "loss")


def test_equal_totals_draw():
    final = _play(_drafting(8), lambda st, seat: S.legal_cards(st, seat)[0])
    for card in final["board"]["cards"]:
        card["prime_score"] = 50.0
    assert S.placements(final) == {0: (1, "draw"), 1: (1, "draw")}


def test_a_forfeit_ends_the_match_and_the_conceding_seat_loses():
    state = _drafting(8)
    after = S.forfeit(state, 0)
    assert after["phase"] == C.PHASE_COMPLETE and after["ended_by"] == "forfeit"
    assert S.placements(after) == {0: (2, "loss"), 1: (1, "win")}


# ---------------------------------------------------------------------------
# Hidden information
# ---------------------------------------------------------------------------


def _all_keys(value) -> set[str]:
    if isinstance(value, dict):
        return set(value) | set().union(*(_all_keys(v) for v in value.values())) if value else set()
    if isinstance(value, list):
        return set().union(*(_all_keys(v) for v in value)) if value else set()
    return set()


def test_no_human_sees_a_score_until_the_draft_is_complete():
    state = _drafting(13)
    while state["phase"] != C.PHASE_COMPLETE:
        for seat in (0, 1):
            public, private, _ = S.project(state, seat, is_bot=False)
            keys = _all_keys(public) | _all_keys(private)
            assert not keys & {"prime_score", "rank", "components", "card_scores", "roster_total", "component_totals"}
        seat = S.current_seat(state)
        state = S.pick(state, seat, {"card_index": S.legal_cards(state, seat)[-1]})
    public, _, legal = S.project(state, 0)
    assert legal == ()
    assert all("prime_score" in card for card in public["cards"])
    assert {row["seat_index"] for row in public["placements"]} == {0, 1}


def test_a_bot_seat_reads_board_scores_and_only_while_drafting():
    state = _drafting(13)
    _, private, _ = S.project(state, 1, is_bot=True)
    assert len(private["card_scores"]) == C.BOARD_SIZE


def test_legal_cards_are_only_published_to_the_seat_on_the_clock():
    state = _drafting(17)
    seat = S.current_seat(state)
    _, mine, my_legal = S.project(state, seat)
    _, theirs, their_legal = S.project(state, 1 - seat)
    assert mine["legal_cards"] and C.COMMAND_PICK in my_legal
    assert theirs["legal_cards"] == [] and C.COMMAND_PICK not in their_legal


def test_every_pick_sequence_pair_is_unique_per_board():
    """Duplicate-player prevention across the whole draft."""
    for seed in list(SEEDS)[:30]:
        final = _play(_drafting(seed), lambda st, seat: random.Random(seed + st["pick_index"]).choice(S.legal_cards(st, seat)))
        slugs = [final["board"]["cards"][p["card_index"]]["player_slug"] for p in final["picks"]]
        assert len(slugs) == len(set(slugs))
        for a, b in itertools.combinations((0, 1), 2):
            assert not set(S.roster(final, a).values()) & set(S.roster(final, b).values())
