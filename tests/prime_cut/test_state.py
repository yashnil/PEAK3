"""PRIME CUT state machine: phases, quotas, forced calls, timeouts, forfeits,
and the hidden-information boundary."""
from __future__ import annotations

import copy
import json

import pytest

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import state as S
from tests.prime_cut.conftest import coin_policy, find_values, keep_first_policy, play_match

SEED = 4040


def _to_card(state: dict) -> dict:
    """Advance through the intro and heat opening to the first card."""
    while state["phase"] != C.PHASE_CARD:
        state = S.timeout(state)
    return state


def _payload(state: dict) -> dict:
    return {"heat_index": state["heat_index"], "card_index": state["card_index"]}


def _fresh(seats=((0, False), (1, True), (2, True), (3, True))) -> dict:
    return S.initial_state(SEED, list(seats))


def test_a_full_match_is_three_heats_of_eight_cards_in_2y_3y_5y_order():
    phases: list[tuple] = []
    final = play_match(SEED, [coin_policy] * 4, on_state=lambda s: phases.append((s["phase"], s["heat_index"], s["card_index"])))
    assert final["phase"] == C.PHASE_COMPLETE and final["ended_by"] == "completed"
    assert [h["duration"] for h in final["heat_results"]] == [2, 3, 5]
    assert phases[0] == (C.PHASE_INTRO, 0, None)
    assert [p for p in phases if p[0] == C.PHASE_HEAT_REVEAL] == [(C.PHASE_HEAT_REVEAL, 0, None), (C.PHASE_HEAT_REVEAL, 1, None)]
    assert [p for p in phases if p[0] == C.PHASE_HEAT_OPEN] == [(C.PHASE_HEAT_OPEN, h, None) for h in range(3)]
    for seat in final["seats"]:
        for heat_decisions in seat["decisions"]:
            assert [d["card_index"] for d in heat_decisions] == list(range(8))
            assert sum(d["decision"] == C.DECISION_KEEP for d in heat_decisions) == 4


def test_the_heat_reveal_is_a_state_a_client_can_observe_before_the_next_heat():
    state = _to_card(_fresh([(i, True) for i in range(4)]))
    while state["phase"] != C.PHASE_HEAT_REVEAL:
        if state["phase"] == C.PHASE_CARD:
            for seat_index in S.undecided_seats(state):
                legal = S.legal_commands(state, seat_index)
                decision = C.DECISION_KEEP if C.COMMAND_KEEP in legal else C.DECISION_CUT
                state = S.decide(state, seat_index, decision, _payload(state))
                if state["phase"] != C.PHASE_CARD:
                    break
        else:
            state = S.timeout(state)
    assert state["heat_index"] == 0 and len(state["heat_results"]) == 1
    public, _, _ = S.project(state, 0)
    assert public["phase"] == C.PHASE_HEAT_REVEAL
    assert public["heat_results"][0]["optimal_card_indexes"]
    assert S.timeout(state)["phase"] == C.PHASE_HEAT_OPEN


def test_a_seat_cannot_keep_a_fifth_card_or_cut_a_fifth_card():
    state = _to_card(_fresh())
    for card in range(4):
        state = S.decide(state, 0, C.DECISION_KEEP, _payload(state))
        for bot in (1, 2, 3):
            state = S.decide(state, bot, C.DECISION_CUT, _payload(state))
    # Seat 0 now has four keeps: its call on card 4 is a forced CUT.
    assert S.decision_for(S._seat(state, 0), 0, 4)["auto"] == C.AUTO_FORCED
    assert C.COMMAND_KEEP not in S.legal_commands(state, 0)
    # Bots have four cuts each: their calls are forced KEEPs, so the card was
    # forced for every seat and parked as a real, observable phase.
    assert state["phase"] == C.PHASE_CARD_FORCED
    with pytest.raises(S.RuleError) as err:
        S.decide(state, 0, C.DECISION_KEEP, _payload(state))
    assert err.value.code == S.REJECT_NOT_DECIDING


def test_quota_rejections_carry_their_own_codes():
    state = _to_card(_fresh([(0, False), (1, False), (2, True), (3, True)]))
    for _ in range(4):
        state = S.decide(state, 0, C.DECISION_KEEP, _payload(state))
        state = S.decide(state, 1, C.DECISION_KEEP, _payload(state)) if S.decision_for(S._seat(state, 1), 0, state["card_index"]) is None else state
        for bot in (2, 3):
            if state["phase"] == C.PHASE_CARD and S.decision_for(S._seat(state, bot), 0, state["card_index"]) is None:
                state = S.decide(state, bot, C.DECISION_KEEP if state["card_index"] % 2 else C.DECISION_CUT, _payload(state))
    # Manually check the rejection on a seat with a full keep quota.
    probe = copy.deepcopy(state)
    probe["phase"] = C.PHASE_CARD
    seat = S._seat(probe, 0)
    seat["decisions"][0] = [d for d in seat["decisions"][0] if d["auto"] is None]
    with pytest.raises(S.RuleError) as err:
        S.decide(probe, 0, C.DECISION_KEEP, _payload(probe))
    assert err.value.code in (S.REJECT_KEEPS_FULL, S.REJECT_WRONG_CARD)


def test_duplicate_stale_and_out_of_phase_decisions_are_refused():
    state = _to_card(_fresh())
    payload = _payload(state)
    state = S.decide(state, 0, C.DECISION_KEEP, payload)
    with pytest.raises(S.RuleError) as dup:
        S.decide(state, 0, C.DECISION_CUT, payload)
    assert dup.value.code == S.REJECT_ALREADY_DECIDED
    with pytest.raises(S.RuleError) as stale:
        S.decide(state, 1, C.DECISION_KEEP, {"heat_index": 0, "card_index": 5})
    assert stale.value.code == S.REJECT_WRONG_CARD
    with pytest.raises(S.RuleError) as wrong_heat:
        S.decide(state, 1, C.DECISION_KEEP, {"heat_index": 2, "card_index": 0})
    assert wrong_heat.value.code == S.REJECT_WRONG_CARD
    with pytest.raises(S.RuleError) as bad:
        S.decide(state, 1, C.DECISION_KEEP, {})
    assert bad.value.code == S.REJECT_BAD_PAYLOAD
    with pytest.raises(S.RuleError) as no_seat:
        S.decide(state, 9, C.DECISION_KEEP, payload)
    assert no_seat.value.code == S.REJECT_NO_SUCH_SEAT
    intro = _fresh()
    with pytest.raises(S.RuleError) as early:
        S.decide(intro, 0, C.DECISION_KEEP, {"heat_index": 0, "card_index": 0})
    assert early.value.code == S.REJECT_NOT_DECIDING


def test_nothing_is_accepted_after_completion():
    final = play_match(SEED, [coin_policy] * 4)
    with pytest.raises(S.RuleError) as err:
        S.decide(final, 0, C.DECISION_KEEP, {"heat_index": 2, "card_index": 7})
    assert err.value.code == S.REJECT_MATCH_COMPLETE
    with pytest.raises(S.RuleError):
        S.timeout(final)
    with pytest.raises(S.RuleError):
        S.forfeit(final, 0)


def test_a_timeout_cuts_when_a_cut_remains_and_keeps_when_none_does():
    state = _to_card(_fresh())
    state = S.timeout(state)  # nobody decided card 0
    for seat in state["seats"]:
        assert seat["decisions"][0][0] == {"card_index": 0, "decision": C.DECISION_CUT, "auto": C.AUTO_TIMEOUT}
    # Burn three more timeouts: every seat has cut four.
    for _ in range(3):
        state = S.timeout(state)
    assert state["phase"] == C.PHASE_CARD_FORCED
    for seat in state["seats"]:
        assert S.decision_for(seat, 0, 4) == {"card_index": 4, "decision": C.DECISION_KEEP, "auto": C.AUTO_FORCED}


def test_a_timeout_never_depends_on_the_card():
    base = _to_card(_fresh())
    swapped = copy.deepcopy(base)
    swapped["board"]["heats"][0]["cards"][0]["prime_score"] = 1.0
    assert S.timeout(base)["seats"][0]["decisions"][0][0]["decision"] == S.timeout(swapped)["seats"][0]["decisions"][0][0]["decision"]


def test_the_only_human_forfeiting_ends_the_match_with_them_last():
    state = _to_card(_fresh())
    ended = S.forfeit(state, 0)
    assert ended["phase"] == C.PHASE_COMPLETE and ended["ended_by"] == "forfeit"
    from nba_peak.prime_cut import scoring

    places = scoring.placements(ended)
    assert places[0] == (4, "loss")


def test_a_forfeit_with_another_human_left_keeps_the_match_going():
    state = _to_card(_fresh([(0, False), (1, False), (2, True), (3, True)]))
    after = S.forfeit(state, 1)
    assert after["phase"] == C.PHASE_CARD
    assert S.decision_for(S._seat(after, 1), 0, 0)["auto"] == C.AUTO_FORFEIT
    assert S.legal_commands(after, 1) == ()
    with pytest.raises(S.RuleError) as err:
        S.decide(after, 1, C.DECISION_KEEP, _payload(after))
    assert err.value.code == S.REJECT_SEAT_FORFEITED


def test_transitions_never_mutate_their_input():
    state = _to_card(_fresh())
    frozen = json.dumps(state, sort_keys=True)
    S.decide(state, 0, C.DECISION_KEEP, _payload(state))
    S.timeout(state)
    S.forfeit(state, 1)
    S.project(state, 0)
    S.project(state, 1, is_bot=True)
    assert json.dumps(state, sort_keys=True) == frozen


def test_replaying_the_same_decisions_reproduces_the_same_match():
    a = play_match(9191, [coin_policy, keep_first_policy, coin_policy, coin_policy])
    b = play_match(9191, [coin_policy, keep_first_policy, coin_policy, coin_policy])
    assert a == b


# ---------------------------------------------------------------------------
# Hidden information
# ---------------------------------------------------------------------------


def _mid_heat(card: int = 3) -> dict:
    state = _to_card(_fresh())
    for _ in range(card):
        for seat_index in S.undecided_seats(state):
            state = S.decide(state, seat_index, C.DECISION_CUT if S.counts(S._seat(state, seat_index), 0)[1] < 4 else C.DECISION_KEEP, _payload(state))
            if state["phase"] != C.PHASE_CARD:
                break
    # Seat 1 has decided card `card`; seat 0 has not.
    state = S.decide(state, 1, C.DECISION_KEEP, _payload(state))
    return state


def test_a_human_never_receives_a_live_or_future_card_score_or_rank():
    state = _mid_heat()
    public, private, _ = S.project(state, 0)
    blob = json.dumps([public, private])
    assert find_values([public, private], lambda v: v in ("prime_score", "prime_index", "canonical_rank")) == []
    heat = state["board"]["heats"][0]
    for card in heat["cards"]:
        assert f"{card['prime_score']}" not in blob or card["prime_score"] in (0, 1)
    future = heat["cards"][state["card_index"] + 1:]
    for card in future:
        assert card["window_id"] not in blob
        assert card["player_name"] not in blob
    for later_heat in state["board"]["heats"][1:]:
        for card in later_heat["cards"]:
            assert card["window_id"] not in blob


def test_every_seat_sees_the_same_card_and_nobody_sees_another_seats_call():
    state = _mid_heat()
    cards = {json.dumps(S.project(state, seat)[0]["current_card"], sort_keys=True) for seat in range(4)}
    assert len(cards) == 1
    public0, private0, _ = S.project(state, 0)
    # Seat 1 locked: seat 0 may know THAT, never WHAT.
    assert next(s for s in public0["seats"] if s["seat_index"] == 1)["locked"] is True
    assert "decision" not in json.dumps(public0["seats"])
    assert all(d["card_index"] <= state["card_index"] for d in private0["decisions"])
    seat1_call = S.decision_for(S._seat(state, 1), 0, state["card_index"])
    assert seat1_call not in private0["decisions"] or seat1_call == private0["current_decision"]


def test_a_bot_sees_the_current_and_past_scores_and_nothing_from_the_future():
    state = _mid_heat()
    public, private, _ = S.project(state, 2, is_bot=True)
    heat = state["board"]["heats"][0]
    c = state["card_index"]
    assert private["current_card_score"] == heat["cards"][c]["prime_score"]
    assert private["seen_card_scores"] == [card["prime_score"] for card in heat["cards"][: c + 1]]
    blob = json.dumps([public, private])
    for card in heat["cards"][c + 1:]:
        assert card["window_id"] not in blob
    for later_heat in state["board"]["heats"][1:]:
        for card in later_heat["cards"]:
            assert card["window_id"] not in blob


def test_scores_are_revealed_only_once_their_heat_has_resolved():
    final = play_match(SEED, [coin_policy] * 4)
    public, _, _ = S.project(final, 0)
    assert len(public["heat_results"]) == 3
    for reveal in public["heat_results"]:
        assert all("prime_score" in card for card in reveal["cards"])
        assert len(reveal["optimal_card_indexes"]) == 4
