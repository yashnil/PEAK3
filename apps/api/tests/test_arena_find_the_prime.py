"""FIND THE PRIME through the real Arena routes and the real foundation.

Rules are tested database-free in `tests/find_the_prime/`. This file tests the
seam: seat-gated routes, real simultaneous turns with grace, staged-choice
timeouts, lazy bots, persisted versioned results, and that no response or event
carries a window score before its round is revealed.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.services.arena import bots as bot_service
from app.services.arena import clock
from app.services.arena import matchmaking as mm
from app.services.arena.modes import ArenaMode, registry as mode_registry
from app.services.find_the_prime import mode as ftp_module
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime import state as rules

MODE = C.MODE_ID
SEED = 555_123


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _enabled(monkeypatch):
    saved = {n: getattr(settings, n) for n in ("ARENA_ENABLED", "ARENA_BOTS_ENABLED", "ARENA_ALPHA_ALLOWLIST", "ARENA_FIND_THE_PRIME_ENABLED")}
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_FIND_THE_PRIME_ENABLED = True
    mode_registry.clear()
    bot_service.registry.clear()
    for module in (tmw_module, td_module, ftp_module):
        mode_registry.register(module.mode)
        bot_service.registry.register(module.bot, for_modes=(module.mode.mode,))
    for attr in ("_matches", "_seats", "_events", "_turns", "_results", "_commands", "_queue", "_match_locks"):
        getattr(_memory_arena_repo, attr).clear()
    monkeypatch.setattr(mm, "_new_seed", lambda: SEED)
    yield
    app.dependency_overrides.clear()
    for n, v in saved.items():
        setattr(settings, n, v)


def _open_turn(match_id: str):
    return next((t for t in _memory_arena_repo._turns.get(match_id, []) if t.resolved_at is None), None)


def _age_for_bots(match_id: str, seconds: float = 30.0) -> None:
    turn = _open_turn(match_id)
    if turn is not None:
        turn.opened_at = turn.opened_at - timedelta(seconds=seconds)


def _expire(match_id: str) -> None:
    turn = _open_turn(match_id)
    if turn is not None:
        turn.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=clock.ACTION_GRACE_SECONDS + 1)


def _get(client: TestClient, match_id: str) -> dict:
    response = client.get(f"/api/v1/arena/matches/{match_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _command(client, match_id, view, command, payload, key=None) -> dict:
    response = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": command,
            "payload": payload,
            "expected_state_version": view["state_version"],
            "idempotency_key": key or f"h-{view['state_version']:05d}-{command}-{json.dumps(payload, sort_keys=True)}"[:128],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _start(client: TestClient) -> dict:
    response = client.post("/api/v1/arena/matches/practice", json={"mode": MODE})
    assert response.status_code == 200, response.text
    return response.json()


def _to_phase(client, match_id, phase, limit=30) -> dict:
    view = _get(client, match_id)
    for _ in range(limit):
        if view["public_state"]["phase"] == phase:
            return view
        _expire(match_id)
        view = _get(client, match_id)
    raise AssertionError(f"never reached {phase}")


def _payload(view: dict, start: int) -> dict:
    return {"round_index": view["public_state"]["round_index"], "start_season_end": start}


def test_the_mode_satisfies_the_contract_and_bots_carry_tier_ratings():
    assert isinstance(ftp_module.mode, ArenaMode)
    assert bot_service.registry.default_for(MODE) is ftp_module.bot
    client = _client_as("ftp-1")
    view = _start(client)
    seats = _memory_arena_repo._seats[view["match_id"]]
    assert len(seats) == 4
    for seat in seats:
        if seat.is_bot:
            assert seat.bot_rating == C.BOT_TIER_RATINGS[rules.bot_tier_for(SEED, seat.seat_index)]
    assert view["turn_phase"] == C.PHASE_ARRIVAL and view["current_turn_seat_index"] is None


def test_a_decision_is_a_timed_simultaneous_turn_with_the_career_rail_and_no_scores():
    client = _client_as("ftp-2")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    assert view["turn_total_seconds"] == pytest.approx(C.DECIDE_SECONDS, abs=0.5)
    assert view["current_turn_seat_index"] is None
    prompt = view["public_state"]["prompt"]
    assert prompt["legal_starts"] and prompt["seasons"] and prompt["player_name"]
    blob = json.dumps(view)
    for forbidden in ("prime_score", "prime_index", "best_window_id", "window_scores", "canonical_rank", "best_score"):
        assert forbidden not in blob
    board = _memory_arena_repo._matches[match_id].snapshot["board"]
    for later in board["rounds"][1:]:
        assert later["player_slug"] not in blob or later["player_slug"] == prompt["player_slug"]
    events_blob = json.dumps(client.get(f"/api/v1/arena/matches/{match_id}/events").json())
    assert "prime_score" not in events_blob and "best_window_id" not in events_blob


def test_staging_is_private_moves_the_bracket_and_is_locked_for_you_at_timeout():
    client = _client_as("ftp-3")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    starts = view["public_state"]["prompt"]["legal_starts"]
    first = _command(client, match_id, view, C.COMMAND_STAGE, _payload(view, starts[0]))
    assert first["accepted"] and first["match"]["private_state"]["staged_start"] == starts[0]
    moved = _command(client, match_id, first["match"], C.COMMAND_STAGE, _payload(first["match"], starts[-1]))
    assert moved["accepted"] and moved["match"]["private_state"]["staged_start"] == starts[-1]
    # Other seats' public view never says where.
    assert str(starts[-1]) not in json.dumps(moved["match"]["public_state"]["seats"])
    you = view["your_seat_index"]
    _expire(match_id)
    revealed = _get(client, match_id)
    assert revealed["public_state"]["phase"] == C.PHASE_REVEAL
    row = next(r for r in revealed["public_state"]["round_results"][0]["seats"] if r["seat_index"] == you)
    assert row["start_season_end"] == starts[-1] and row["locked_by"] == C.LOCKED_BY_STAGED_TIMEOUT


def test_no_selection_at_timeout_scores_zero_and_the_best_window_is_never_chosen_for_you():
    client = _client_as("ftp-4")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    you = view["your_seat_index"]
    _expire(match_id)
    revealed = _get(client, match_id)
    row = next(r for r in revealed["public_state"]["round_results"][0]["seats"] if r["seat_index"] == you)
    assert row["window_id"] is None and row["points"] == 0.0 and row["locked_by"] == C.NO_ANSWER_TIMEOUT


def test_the_grace_window_keeps_a_just_late_lock_alive():
    client = _client_as("ftp-5")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    turn = _open_turn(match_id)
    turn.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=clock.ACTION_GRACE_SECONDS - 1)
    start = view["public_state"]["prompt"]["legal_starts"][0]
    out = _command(client, match_id, view, C.COMMAND_LOCK, _payload(view, start))
    assert out["accepted"], out


def test_bad_commands_are_refused_with_their_own_codes():
    client = _client_as("ftp-6")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    starts = view["public_state"]["prompt"]["legal_starts"]
    invalid = _command(client, match_id, view, C.COMMAND_LOCK, _payload(view, max(starts) + 3), key="invalid-window-01")
    assert not invalid["accepted"] and invalid["rejection_code"] == rules.REJECT_INVALID_WINDOW
    fresh = invalid["match"]
    wrong_round = _command(client, match_id, fresh, C.COMMAND_LOCK, {"round_index": 4, "start_season_end": starts[0]}, key="wrong-round-0001")
    assert not wrong_round["accepted"] and wrong_round["rejection_code"] == rules.REJECT_WRONG_ROUND
    locked = _command(client, match_id, fresh, C.COMMAND_LOCK, _payload(fresh, starts[0]), key="lock-once-000001")
    assert locked["accepted"]
    twice = _command(client, match_id, locked["match"], C.COMMAND_LOCK, _payload(locked["match"], starts[-1]), key="lock-twice-00001")
    assert not twice["accepted"] and twice["rejection_code"] == rules.REJECT_ALREADY_LOCKED
    stale = _command(client, match_id, view, C.COMMAND_STAGE, _payload(view, starts[0]), key="stale-stage-0001")
    assert not stale["accepted"] and stale["rejection_code"] == "stale_state_version"
    assert _client_as("ftp-outsider").get(f"/api/v1/arena/matches/{match_id}").status_code == 403


def test_a_reconnect_restores_the_prompt_the_staged_window_and_the_clock():
    client = _client_as("ftp-7")
    match_id = _start(client)["match_id"]
    view = _to_phase(client, match_id, C.PHASE_DECIDE)
    start = view["public_state"]["prompt"]["legal_starts"][1]
    _command(client, match_id, view, C.COMMAND_STAGE, _payload(view, start))
    again = _get(_client_as("ftp-7"), match_id)
    assert again["private_state"]["staged_start"] == start
    assert again["public_state"]["prompt"] == view["public_state"]["prompt"]
    assert again["turn_seconds_remaining"] is not None


def _play_through(client, match_id) -> tuple[dict, list[int]]:
    reveals = []
    view = _get(client, match_id)
    for _ in range(300):
        public = view["public_state"]
        if view["status"] == "completed":
            return view, reveals
        if public["phase"] == C.PHASE_DECIDE and C.COMMAND_LOCK in view["legal_commands"]:
            start = public["prompt"]["legal_starts"][len(public["prompt"]["legal_starts"]) // 2]
            view = _command(client, match_id, view, C.COMMAND_LOCK, _payload(view, start))["match"]
            _age_for_bots(match_id)
            view = _get(client, match_id)
            continue
        if public["phase"] == C.PHASE_DECIDE:
            _age_for_bots(match_id)
            nxt = _get(client, match_id)
            if nxt["state_version"] == view["state_version"]:
                _expire(match_id)
                nxt = _get(client, match_id)
            view = nxt
            continue
        if public["phase"] == C.PHASE_REVEAL:
            reveals.append(public["round_index"])
        _expire(match_id)
        view = _get(client, match_id)
    raise AssertionError("did not complete")


def test_a_full_match_reveals_all_nine_rounds_and_persists_versioned_results_out_of_900():
    client = _client_as("ftp-8")
    match_id = _start(client)["match_id"]
    view, reveals = _play_through(client, match_id)
    assert sorted(set(reveals)) == list(range(9))
    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()["results"]
    assert len(results) == 4
    for result in results:
        detail = result["detail"]
        assert detail["max_total"] == 900.0 and 0 <= result["score"] <= 900
        assert detail["rounds_scored"] == 9
        assert detail["ruleset_version"] == C.RULESET_VERSION
        assert detail["artifact_version"] == "career_windows.v1"
        assert detail["model_version"] == "peak3-v1"
        assert "exact_windows" in detail and "total_regret" in detail
    assert view["public_state"]["placements"]


def test_bot_picks_replay_identically_for_the_same_seed():
    def run(sub):
        client = _client_as(sub)
        match_id = _start(client)["match_id"]
        _play_through(client, match_id)
        snapshot = _memory_arena_repo._matches[match_id].snapshot
        return [[(a["round_index"], a["start_season_end"]) for a in s["answers"]] for s in snapshot["seats"] if s["is_bot"]]

    assert run("ftp-replay-a") == run("ftp-replay-b")


# ---------------------------------------------------------------------------
# Arrival: a slow client cannot miss the intro, and the match cannot advance
# behind it
# ---------------------------------------------------------------------------


def _arrive_late(match_id: str, seconds: float) -> None:
    """Put the open turn `seconds` into the past, exactly as a client whose
    route took that long to load and render would find it on its first read."""
    turn = _open_turn(match_id)
    turn.opened_at = turn.opened_at - timedelta(seconds=seconds)
    turn.deadline_at = turn.deadline_at - timedelta(seconds=seconds)


def test_a_client_slower_than_the_whole_intro_still_opens_on_it_and_starts_its_clock():
    client = _client_as("ftp-late")
    created = _start(client)
    match_id = created["match_id"]
    assert created["turn_phase"] == C.PHASE_ARRIVAL
    assert created["turn_total_seconds"] == pytest.approx(C.ARRIVAL_BACKSTOP_SECONDS, abs=0.5)
    # Later than the intro plus the action grace: with the intro timed from
    # creation, this first read landed after it had already expired.
    _arrive_late(match_id, C.INTRO_SECONDS + clock.ACTION_GRACE_SECONDS + 3)
    _age_for_bots(match_id)
    view = _get(client, match_id)
    assert view["turn_phase"] == C.PHASE_ARRIVAL
    assert view["state_version"] == created["state_version"], "the match advanced before anyone saw the intro"
    assert view["public_state"]["prompt"] is None and view["public_state"]["round_results"] == []
    assert C.COMMAND_INTRO_SEEN in view["legal_commands"]
    assert not set(view["legal_commands"]) & {C.COMMAND_STAGE, C.COMMAND_LOCK}

    out = _command(client, match_id, view, C.COMMAND_INTRO_SEEN, {})
    assert out["accepted"], out
    intro = out["match"]
    assert intro["turn_phase"] == C.PHASE_INTRO
    # The WHOLE intro, measured from the moment it was on screen.
    assert intro["turn_seconds_remaining"] == pytest.approx(C.INTRO_SECONDS, abs=0.5)
    assert C.COMMAND_INTRO_SEEN not in intro["legal_commands"]

    again = _command(client, match_id, intro, C.COMMAND_INTRO_SEEN, {}, key="ftp-late-seen-again")
    assert not again["accepted"] and again["rejection_code"] == rules.REJECT_INTRO_STARTED
    assert again["match"]["turn_phase"] == C.PHASE_INTRO


def test_the_arrival_backstop_runs_the_whole_intro_rather_than_skipping_to_play():
    client = _client_as("ftp-absent")
    match_id = _start(client)["match_id"]
    _expire(match_id)
    view = _get(client, match_id)
    assert view["turn_phase"] == C.PHASE_INTRO
    assert view["turn_seconds_remaining"] == pytest.approx(C.INTRO_SECONDS, abs=0.5)


def test_with_two_humans_the_intro_clock_waits_for_both_of_them():
    host = _client_as("ftp-host")
    room = host.post("/api/v1/arena/matches/private", json={"mode": MODE})
    assert room.status_code == 200, room.text
    match_id, code = room.json()["match_id"], room.json()["room_code"]
    guest = _client_as("ftp-guest")
    joined = guest.post("/api/v1/arena/matches/private/join", json={"room_code": code})
    assert joined.status_code == 200, joined.text
    host = _client_as("ftp-host")
    filled = host.post(f"/api/v1/arena/matches/{match_id}/fill-bots")
    assert filled.status_code == 200, filled.text

    view = _get(host, match_id)
    assert view["turn_phase"] == C.PHASE_ARRIVAL
    out = _command(host, match_id, view, C.COMMAND_INTRO_SEEN, {})
    assert out["accepted"] and out["match"]["turn_phase"] == C.PHASE_ARRIVAL
    arrived = {s["seat_index"]: s["arrived"] for s in out["match"]["public_state"]["seats"]}
    assert sorted(arrived.values()) == [False, True, True, True]

    guest = _client_as("ftp-guest")
    view = _get(guest, match_id)
    assert view["turn_phase"] == C.PHASE_ARRIVAL and C.COMMAND_INTRO_SEEN in view["legal_commands"]
    out = _command(guest, match_id, view, C.COMMAND_INTRO_SEEN, {})
    assert out["accepted"] and out["match"]["turn_phase"] == C.PHASE_INTRO
    assert out["match"]["turn_seconds_remaining"] == pytest.approx(C.INTRO_SECONDS, abs=0.5)
