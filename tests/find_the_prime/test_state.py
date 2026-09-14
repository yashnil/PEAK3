"""FIND THE PRIME state machine and hidden-information boundary."""
from __future__ import annotations

import copy
import json

import pytest

from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import scoring as SC
from nba_peak.find_the_prime import state as S
from tests.find_the_prime.conftest import coin_policy, find_values, play_match, silent_policy

SEED = 2718


def _fresh(seats=((0, False), (1, True), (2, True), (3, True))) -> dict:
    return S.initial_state(SEED, list(seats))


def _deciding(state: dict) -> dict:
    while state["phase"] != C.PHASE_DECIDE:
        state = S.timeout(state)
    return state


def _answer(state: dict, start: int | None = None) -> dict:
    round_ = S.current_round(state)
    return {"round_index": state["round_index"], "start_season_end": start if start is not None else S.legal_starts(round_)[0]}


def test_a_full_match_is_nine_rounds_each_with_an_observable_reveal():
    phases: list[tuple] = []
    final = play_match(SEED, [coin_policy] * 4, on_state=lambda s: phases.append((s["phase"], s["round_index"])))
    assert final["phase"] == C.PHASE_COMPLETE and final["ended_by"] == "completed"
    assert [p for p in phases if p[0] == C.PHASE_REVEAL] == [(C.PHASE_REVEAL, r) for r in range(9)]
    assert len(final["round_results"]) == 9
    # The match opens waiting for its table, then runs the intro, then round one.
    assert phases[:3] == [(C.PHASE_ARRIVAL, 0), (C.PHASE_INTRO, 0), (C.PHASE_DECIDE, 0)]


def test_the_last_rounds_reveal_happens_before_completion():
    state = _deciding(_fresh([(i, True) for i in range(4)]))
    while not (state["phase"] == C.PHASE_REVEAL and state["round_index"] == 8):
        state = S.timeout(state)
    public, _, _ = S.project(state, 0)
    assert public["phase"] == C.PHASE_REVEAL and len(public["round_results"]) == 9
    assert S.timeout(state)["phase"] == C.PHASE_COMPLETE


def test_only_real_windows_of_the_right_length_can_be_staged_or_locked():
    state = _deciding(_fresh())
    round_ = S.current_round(state)
    starts = S.legal_starts(round_)
    impossible = max(starts) + 1
    for command in (S.stage, S.lock):
        with pytest.raises(S.RuleError) as err:
            command(state, 0, {"round_index": state["round_index"], "start_season_end": impossible})
        assert err.value.code == S.REJECT_INVALID_WINDOW
        with pytest.raises(S.RuleError) as wrong:
            command(state, 0, {"round_index": state["round_index"] + 1, "start_season_end": starts[0]})
        assert wrong.value.code == S.REJECT_WRONG_ROUND
        with pytest.raises(S.RuleError) as bad:
            command(state, 0, {"round_index": state["round_index"]})
        assert bad.value.code == S.REJECT_BAD_PAYLOAD
    # A season inside the career that starts no window of this length is refused too.
    seasons = [s["season_end"] for s in round_["seasons"]]
    non_starts = [y for y in seasons if y not in starts]
    if non_starts:
        with pytest.raises(S.RuleError):
            S.lock(state, 0, {"round_index": state["round_index"], "start_season_end": non_starts[-1]})


def test_a_lock_is_final_and_nothing_is_accepted_outside_a_decision():
    state = _deciding(_fresh())
    locked = S.lock(state, 0, _answer(state))
    with pytest.raises(S.RuleError) as again:
        S.lock(locked, 0, _answer(locked, S.legal_starts(S.current_round(locked))[-1]))
    assert again.value.code == S.REJECT_ALREADY_LOCKED
    with pytest.raises(S.RuleError) as restage:
        S.stage(locked, 0, _answer(locked))
    assert restage.value.code == S.REJECT_ALREADY_LOCKED
    with pytest.raises(S.RuleError) as early:
        S.lock(_fresh(), 0, {"round_index": 0, "start_season_end": 2000})
    assert early.value.code == S.REJECT_NOT_DECIDING
    final = play_match(SEED, [coin_policy] * 4)
    with pytest.raises(S.RuleError) as late:
        S.lock(final, 0, {"round_index": 8, "start_season_end": 2000})
    assert late.value.code == S.REJECT_MATCH_COMPLETE


def test_a_staged_window_is_locked_at_timeout_and_no_selection_scores_zero():
    state = _deciding(_fresh())
    starts = S.legal_starts(S.current_round(state))
    state = S.stage(state, 0, _answer(state, starts[-1]))
    state = S.stage(state, 0, _answer(state, starts[0]))  # the LATEST staged counts
    revealed = S.timeout(state)
    rows = {row["seat_index"]: row for row in revealed["round_results"][0]["seats"]}
    assert rows[0]["start_season_end"] == starts[0]
    assert rows[0]["locked_by"] == C.LOCKED_BY_STAGED_TIMEOUT
    for bot in (1, 2, 3):
        assert rows[bot]["window_id"] is None and rows[bot]["points"] == 0.0
        assert rows[bot]["locked_by"] == C.NO_ANSWER_TIMEOUT


def test_a_timeout_never_picks_the_best_window_for_a_silent_seat():
    final = play_match(SEED, [silent_policy] * 4)
    for result in final["round_results"]:
        assert all(row["window_id"] is None for row in result["seats"])
    assert all(SC.seat_totals(final, i)["total"] == 0.0 for i in range(4))


def test_staging_resets_between_rounds():
    state = _deciding(_fresh())
    state = S.stage(state, 0, _answer(state))
    state = S.timeout(S.timeout(state))  # reveal, then next round
    assert state["phase"] == C.PHASE_DECIDE and state["round_index"] == 1
    assert S._seat(state, 0)["staged"] is None and S._seat(state, 0)["locked"] is None


def test_the_only_human_forfeiting_ends_the_match_with_them_last():
    state = _deciding(_fresh())
    ended = S.forfeit(state, 0)
    assert ended["phase"] == C.PHASE_COMPLETE and ended["ended_by"] == "forfeit"
    assert SC.placements(ended)[0] == (4, "loss")


def test_transitions_never_mutate_their_input_and_replays_are_identical():
    state = _deciding(_fresh())
    frozen = json.dumps(state, sort_keys=True)
    S.stage(state, 0, _answer(state))
    S.lock(state, 0, _answer(state))
    S.timeout(state)
    S.forfeit(state, 1)
    S.project(state, 1, is_bot=True)
    assert json.dumps(state, sort_keys=True) == frozen
    assert play_match(4242, [coin_policy] * 4) == play_match(4242, [coin_policy] * 4)


# ---------------------------------------------------------------------------
# Hidden information
# ---------------------------------------------------------------------------


def test_before_the_reveal_a_human_sees_the_career_but_no_score_best_or_rank():
    state = _deciding(_fresh())
    state = S.lock(state, 1, _answer(state))
    public, private, legal = S.project(state, 0)
    assert find_values([public, private], lambda v: v in ("prime_score", "prime_index", "best_window_id",
                                                        "equivalent_window_ids", "canonical_rank", "scale",
                                                        "best_score", "window_scores")) == []
    prompt = public["prompt"]
    round_ = S.current_round(state)
    assert prompt["legal_starts"] == S.legal_starts(round_)
    assert prompt["player_name"] == round_["player_name"]
    assert set(legal) == {C.COMMAND_STAGE, C.COMMAND_LOCK, C.COMMAND_FORFEIT}
    blob = json.dumps([public, private])
    assert round_["best_window_id"] not in blob
    for later in state["board"]["rounds"][1:]:
        assert later["player_name"] not in blob or later["player_name"] == round_["player_name"]


def test_a_seat_knows_another_seat_locked_but_never_where():
    state = _deciding(_fresh())
    starts = S.legal_starts(S.current_round(state))
    state = S.stage(state, 1, _answer(state, starts[-1]))
    state = S.lock(state, 2, _answer(state, starts[-1]))
    public, private, _ = S.project(state, 0)
    seats = {s["seat_index"]: s for s in public["seats"]}
    assert seats[2]["locked"] is True and seats[1]["locked"] is False
    assert private["staged_start"] is None and private["locked_start"] is None
    assert "staged" not in json.dumps(public)


def test_a_bot_sees_only_the_current_rounds_window_scores():
    state = _deciding(_fresh())
    public, private, _ = S.project(state, 2, is_bot=True)
    round_ = S.current_round(state)
    assert private["window_scores"] == [[w["start_season_end"], w["prime_score"]] for w in round_["windows"]]
    blob = json.dumps([public, private])
    for later in state["board"]["rounds"][1:]:
        for window in later["windows"]:
            assert window["window_id"] not in blob


def test_the_reveal_publishes_the_ridge_every_seats_window_and_the_best():
    state = _deciding(_fresh())
    state = S.lock(state, 0, _answer(state))
    revealed = S.timeout(state)
    public, _, _ = S.project(revealed, 0)
    reveal = public["round_results"][0]
    assert all("prime_score" in w for w in reveal["windows"])
    assert reveal["best_window_id"] == S.current_round(revealed)["best_window_id"]
    assert {row["seat_index"] for row in reveal["seats"]} == {0, 1, 2, 3}


# ---------------------------------------------------------------------------
# Arrival: the intro's clock waits for the table
# ---------------------------------------------------------------------------


def test_a_match_opens_waiting_for_its_humans_and_only_their_arrival_starts_the_intro():
    state = _fresh()
    assert state["phase"] == C.PHASE_ARRIVAL
    public, private, legal = S.project(state, 0)
    assert public["prompt"] is None and private["staged_start"] is None
    assert set(legal) == {C.COMMAND_INTRO_SEEN, C.COMMAND_FORFEIT}
    assert {s["seat_index"]: s["arrived"] for s in public["seats"]} == {0: False, 1: True, 2: True, 3: True}
    # No gameplay while the table is arriving: nothing to stage or lock.
    for command in (S.stage, S.lock):
        with pytest.raises(S.RuleError) as err:
            command(state, 0, {"round_index": 0, "start_season_end": S.legal_starts(S.current_round(state))[0]})
        assert err.value.code == S.REJECT_NOT_DECIDING
    started = S.intro_seen(state, 0)
    assert started["phase"] == C.PHASE_INTRO and started["round_index"] == 0
    assert S.legal_commands(started, 0) == (C.COMMAND_FORFEIT,)


def test_the_intro_waits_for_every_human_seat_and_cannot_be_reported_twice():
    state = _fresh([(0, False), (1, False), (2, True), (3, True)])
    one = S.intro_seen(state, 0)
    assert one["phase"] == C.PHASE_ARRIVAL
    with pytest.raises(S.RuleError) as again:
        S.intro_seen(one, 0)
    assert again.value.code == S.REJECT_INTRO_ALREADY_SEEN
    with pytest.raises(S.RuleError) as bot:
        S.intro_seen(one, 2)
    assert bot.value.code == S.REJECT_INTRO_ALREADY_SEEN
    both = S.intro_seen(one, 1)
    assert both["phase"] == C.PHASE_INTRO
    with pytest.raises(S.RuleError) as late:
        S.intro_seen(both, 1)
    assert late.value.code == S.REJECT_INTRO_STARTED


def test_the_arrival_backstop_opens_the_intro_never_the_first_round():
    state = _fresh([(0, False), (1, False), (2, True), (3, True)])
    state = S.intro_seen(state, 0)
    backstop = S.timeout(state)
    assert backstop["phase"] == C.PHASE_INTRO and backstop["round_results"] == []
    assert S.timeout(backstop)["phase"] == C.PHASE_DECIDE


def test_the_absent_seat_conceding_starts_the_intro_for_the_seat_that_arrived():
    state = S.intro_seen(_fresh([(0, False), (1, False), (2, True), (3, True)]), 0)
    conceded = S.forfeit(state, 1)
    assert conceded["phase"] == C.PHASE_INTRO
    alone = S.forfeit(_fresh(), 0)
    assert alone["phase"] == C.PHASE_COMPLETE and alone["ended_by"] == "forfeit"
