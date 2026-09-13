"""PRIME CUT through the real Arena routes and the real foundation.

The rules are tested without a database in `tests/prime_cut/` at the repository
root. This file tests the SEAM and the product guarantees that only exist once
the mode is plugged in: seat-gated routes, real turns and deadlines, lazy bots,
persisted results, and -- above all -- that no response ever carries a live or
future card's score.

Time is driven the way `test_arena_practice_e2e.py` drives it: the open turn's
`opened_at` is aged so bots may move, and a seatless phase's deadline is moved
into the past so the foundation's own lazy sweep fires on the next read.
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
from app.repositories.arena_protocols import COMMAND_TYPE_TIMEOUT, CommandRequest
from app.services.arena import bots as bot_service
from app.services.arena import clock
from app.services.arena import matchmaking as mm
from app.services.arena.modes import ArenaMode, registry as mode_registry
from app.services.prime_cut import mode as pc_module
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut import state as rules

MODE = C.MODE_ID
SEED = 777_001


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _prime_cut_enabled(monkeypatch):
    saved = {
        name: getattr(settings, name)
        for name in ("ARENA_ENABLED", "ARENA_BOTS_ENABLED", "ARENA_ALPHA_ALLOWLIST", "ARENA_PRIME_CUT_ENABLED")
    }
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_PRIME_CUT_ENABLED = True
    mode_registry.clear()
    bot_service.registry.clear()
    for module in (tmw_module, td_module, pc_module):
        mode_registry.register(module.mode)
        bot_service.registry.register(module.bot, for_modes=(module.mode.mode,))
    for attr in ("_matches", "_seats", "_events", "_turns", "_results", "_commands", "_queue", "_match_locks"):
        getattr(_memory_arena_repo, attr).clear()
    monkeypatch.setattr(mm, "_new_seed", lambda: SEED)
    yield
    app.dependency_overrides.clear()
    for name, value in saved.items():
        setattr(settings, name, value)


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


def _open_turn(match_id: str):
    return next((t for t in _memory_arena_repo._turns.get(match_id, []) if t.resolved_at is None), None)


def _age_for_bots(match_id: str, seconds: float = 20.0) -> None:
    turn = _open_turn(match_id)
    if turn is not None:
        turn.opened_at = turn.opened_at - timedelta(seconds=seconds)


def _expire_open_turn(match_id: str) -> None:
    """Move the open turn past its deadline AND the action grace."""
    turn = _open_turn(match_id)
    if turn is not None:
        turn.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=clock.ACTION_GRACE_SECONDS + 1)


def _get(client: TestClient, match_id: str) -> dict:
    response = client.get(f"/api/v1/arena/matches/{match_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _command(client: TestClient, match_id: str, view: dict, command: str, payload: dict, key: str | None = None) -> dict:
    response = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": command,
            "payload": payload,
            "expected_state_version": view["state_version"],
            "idempotency_key": key or f"human-{view['state_version']:05d}-{command}-{json.dumps(payload, sort_keys=True)}"[:128],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _start(client: TestClient) -> dict:
    response = client.post("/api/v1/arena/matches/practice", json={"mode": MODE})
    assert response.status_code == 200, response.text
    return response.json()


def _advance_to(client: TestClient, match_id: str, phase: str, limit: int = 20) -> dict:
    view = _get(client, match_id)
    for _ in range(limit):
        if view["public_state"]["phase"] == phase:
            return view
        _expire_open_turn(match_id)
        view = _get(client, match_id)
    raise AssertionError(f"never reached {phase}; at {view['public_state']['phase']}")


def _play_card(client: TestClient, match_id: str, view: dict, *, prefer: str = C.COMMAND_KEEP) -> dict:
    """The human decides; bots are then allowed to think and move."""
    public = view["public_state"]
    payload = {"heat_index": public["heat_index"], "card_index": public["card_index"]}
    legal = view["legal_commands"]
    command = prefer if prefer in legal else next(c for c in legal if c in (C.COMMAND_KEEP, C.COMMAND_CUT))
    out = _command(client, match_id, view, command, payload)
    assert out["accepted"], out
    _age_for_bots(match_id)
    return _get(client, match_id)


def _play_to_completion(client: TestClient, match_id: str, *, prefer: str = C.COMMAND_KEEP) -> dict:
    view = _get(client, match_id)
    for _ in range(400):
        public = view["public_state"]
        if view["status"] == "completed":
            return view
        if public["phase"] == C.PHASE_CARD and view["legal_commands"] and any(
            c in view["legal_commands"] for c in (C.COMMAND_KEEP, C.COMMAND_CUT)
        ):
            view = _play_card(client, match_id, view, prefer=prefer)
            continue
        if public["phase"] == C.PHASE_CARD:
            _age_for_bots(match_id)
            view = _get(client, match_id)
            if view["public_state"]["phase"] == C.PHASE_CARD and view["public_state"]["card_index"] == public["card_index"]:
                _expire_open_turn(match_id)
                view = _get(client, match_id)
            continue
        _expire_open_turn(match_id)
        view = _get(client, match_id)
    raise AssertionError("match did not complete")


def _all_values(obj) -> list:
    if isinstance(obj, dict):
        return [k for k in obj] + [v for value in obj.values() for v in _all_values(value)]
    if isinstance(obj, list):
        return [v for value in obj for v in _all_values(value)]
    return [obj]


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------


def test_the_mode_satisfies_the_arena_contract_and_is_registered_with_its_bot():
    assert isinstance(pc_module.mode, ArenaMode)
    assert mode_registry.get(MODE) is pc_module.mode
    assert bot_service.registry.default_for(MODE) is pc_module.bot
    assert pc_module.mode.seat_count == 4


def test_practice_seats_one_human_and_three_tiered_bots_with_honest_ratings():
    client = _client_as("pc-user-1")
    view = _start(client)
    seats = _memory_arena_repo._seats[view["match_id"]]
    bots = [s for s in seats if s.is_bot]
    assert len(seats) == 4 and len(bots) == 3
    for seat in bots:
        tier = rules.bot_tier_for(SEED, seat.seat_index)
        assert seat.bot_rating == C.BOT_TIER_RATINGS[tier]
    public_seats = view["public_state"]["seats"]
    assert all(s["bot_tier"] for s in public_seats if s["is_bot"])
    assert all(s["display_name"] for s in public_seats)
    assert view["rated"] is False


def test_the_intro_and_heat_opening_are_real_timed_phases_nobody_plays():
    client = _client_as("pc-user-2")
    view = _start(client)
    assert view["turn_phase"] == C.PHASE_INTRO
    assert view["current_turn_seat_index"] is None
    assert view["turn_total_seconds"] == pytest.approx(C.INTRO_SECONDS, abs=0.5)
    assert all(c not in view["legal_commands"] for c in (C.COMMAND_KEEP, C.COMMAND_CUT))
    view = _advance_to(client, view["match_id"], C.PHASE_HEAT_OPEN)
    assert view["public_state"]["current_card"] is None
    view = _advance_to(client, view["match_id"], C.PHASE_CARD)
    assert view["turn_total_seconds"] == pytest.approx(C.CARD_SECONDS, abs=0.5)
    assert set(view["legal_commands"]) >= {C.COMMAND_KEEP, C.COMMAND_CUT}


def test_no_response_ever_carries_a_live_or_future_card_score():
    client = _client_as("pc-user-3")
    view = _start(client)
    match_id = view["match_id"]
    board = _memory_arena_repo._matches[match_id].snapshot["board"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    for _ in range(5):
        heat = view["public_state"]["heat_index"]
        card_index = view["public_state"]["card_index"]
        blob = json.dumps(view)
        # No score-bearing key at all in a live heat.
        assert "prime_score" not in blob and "prime_index" not in blob and "canonical_rank" not in blob
        for card in board["heats"][heat]["cards"][card_index + 1:]:
            assert card["window_id"] not in blob and card["player_name"] not in blob
        for later in board["heats"][heat + 1:]:
            for card in later["cards"]:
                assert card["window_id"] not in blob
        events = client.get(f"/api/v1/arena/matches/{match_id}/events").json()
        events_blob = json.dumps(events)
        assert "prime_score" not in events_blob
        if any(c in view["legal_commands"] for c in (C.COMMAND_KEEP, C.COMMAND_CUT)):
            view = _play_card(client, match_id, view, prefer=C.COMMAND_CUT)
        else:
            # This seat's call on the card is already recorded (a forced call,
            # once four CUTs are used): let the bots think, then the clock run.
            _age_for_bots(match_id)
            view = _get(client, match_id)
            if view["public_state"]["phase"] == C.PHASE_CARD_FORCED:
                _expire_open_turn(match_id)
                view = _get(client, match_id)
        if view["public_state"]["phase"] != C.PHASE_CARD:
            break


def test_a_human_never_learns_another_seats_call_before_the_heat_resolves():
    client = _client_as("pc-user-4")
    view = _start(client)
    match_id = view["match_id"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    _age_for_bots(match_id)
    view = _get(client, match_id)
    locked_bots = [s for s in view["public_state"]["seats"] if s["is_bot"] and s["locked"]]
    assert locked_bots, "bots should have locked once their think time elapsed"
    events = client.get(f"/api/v1/arena/matches/{match_id}/events").json()["events"]
    for event in events:
        if event["event_type"] == pc_module.EVENT_DECISION:
            assert event["actor_seat_index"] == view["your_seat_index"]
    assert '"decision"' not in json.dumps(view["public_state"]["seats"])


def test_decisions_are_irreversible_and_every_bad_command_is_refused_cleanly():
    client = _client_as("pc-user-5")
    view = _start(client)
    match_id = view["match_id"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    public = view["public_state"]
    payload = {"heat_index": public["heat_index"], "card_index": public["card_index"]}

    first = _command(client, match_id, view, C.COMMAND_KEEP, payload)
    assert first["accepted"]
    replay = _command(client, match_id, view, C.COMMAND_KEEP, payload)
    assert replay["replayed"] is True

    fresh = first["match"]
    again = _command(client, match_id, fresh, C.COMMAND_CUT, payload, key="change-my-mind-0001")
    assert not again["accepted"] and again["rejection_code"] == rules.REJECT_ALREADY_DECIDED

    stale = _command(client, match_id, view, C.COMMAND_CUT, payload, key="stale-version-0001")
    assert not stale["accepted"] and stale["rejection_code"] == "stale_state_version"

    wrong = _command(client, match_id, fresh, C.COMMAND_CUT, {"heat_index": 0, "card_index": 6}, key="wrong-card-0001")
    assert not wrong["accepted"]

    reserved = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={"command_type": COMMAND_TYPE_TIMEOUT, "payload": {}, "expected_state_version": fresh["state_version"],
              "idempotency_key": "impersonate-clock-01"},
    )
    assert reserved.status_code == 400

    outsider = _client_as("pc-outsider")
    assert outsider.get(f"/api/v1/arena/matches/{match_id}").status_code == 403


def test_a_card_nobody_decides_is_resolved_by_the_documented_timeout_rule():
    client = _client_as("pc-user-6")
    view = _start(client)
    match_id = view["match_id"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    you = view["your_seat_index"]
    # Inside the grace window the card is still open.
    turn = _open_turn(match_id)
    turn.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=clock.ACTION_GRACE_SECONDS - 1)
    assert _get(client, match_id)["public_state"]["card_index"] == 0
    _expire_open_turn(match_id)
    view = _get(client, match_id)
    snapshot = _memory_arena_repo._matches[match_id].snapshot
    mine = rules.decision_for(rules._seat(snapshot, you), 0, 0)
    assert mine == {"card_index": 0, "decision": C.DECISION_CUT, "auto": C.AUTO_TIMEOUT}
    assert view["public_state"]["card_index"] == 1


def test_a_reconnect_mid_heat_restores_the_same_board_and_the_same_private_state():
    client = _client_as("pc-user-7")
    view = _start(client)
    match_id = view["match_id"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    view = _play_card(client, match_id, view, prefer=C.COMMAND_KEEP)
    view = _play_card(client, match_id, view, prefer=C.COMMAND_CUT)
    reconnected = _client_as("pc-user-7")
    again = _get(reconnected, match_id)
    for key in ("public_state", "private_state", "legal_commands", "state_version"):
        assert again[key] == _get(client, match_id)[key]
    decisions = again["private_state"]["decisions"]
    assert [d["decision"] for d in decisions[:2]] == [C.DECISION_KEEP, C.DECISION_CUT]
    assert again["turn_seconds_remaining"] is not None


def test_a_full_match_completes_with_real_versioned_results_and_an_observable_heat_reveal():
    client = _client_as("pc-user-8")
    view = _start(client)
    match_id = view["match_id"]
    seen_reveal = []

    view = _get(client, match_id)
    for _ in range(600):
        public = view["public_state"]
        if public["phase"] == C.PHASE_HEAT_REVEAL:
            seen_reveal.append(public["heat_index"])
            assert view["turn_total_seconds"] == pytest.approx(C.HEAT_REVEAL_SECONDS, abs=0.5)
            assert len(public["heat_results"]) == public["heat_index"] + 1
            latest = public["heat_results"][-1]
            assert len(latest["optimal_card_indexes"]) == 4
            assert all("prime_score" in c for c in latest["cards"])
        if view["status"] == "completed":
            break
        if public["phase"] == C.PHASE_CARD and any(c in view["legal_commands"] for c in (C.COMMAND_KEEP, C.COMMAND_CUT)):
            view = _play_card(client, match_id, view)
            continue
        if public["phase"] == C.PHASE_CARD:
            _age_for_bots(match_id)
            nxt = _get(client, match_id)
            if nxt["state_version"] == view["state_version"]:
                _expire_open_turn(match_id)
                nxt = _get(client, match_id)
            view = nxt
            continue
        _expire_open_turn(match_id)
        view = _get(client, match_id)

    assert view["status"] == "completed"
    assert sorted(set(seen_reveal)) == [0, 1]
    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()["results"]
    assert len(results) == 4
    placements = sorted(r["placement"] for r in results)
    assert placements[0] == 1
    for result in results:
        detail = result["detail"]
        assert detail["ruleset_version"] == C.RULESET_VERSION
        assert detail["board_version"] == C.BOARD_VERSION
        assert detail["artifact_version"] == "career_windows.v1"
        assert detail["model_version"] == "peak3-v1"
        assert set(k for k in detail if k.startswith("heat_") and k.endswith("y")) == {"heat_2y", "heat_3y", "heat_5y"}
        assert result["score"] == pytest.approx(
            round((detail["heat_2y"] + detail["heat_3y"] + detail["heat_5y"]) / 3, 2), abs=0.01
        )
    assert view["public_state"]["placements"]


def test_bot_decisions_replay_identically_for_the_same_seed():
    def run(sub: str) -> list:
        client = _client_as(sub)
        view = _start(client)
        match_id = view["match_id"]
        _play_to_completion(client, match_id, prefer=C.COMMAND_CUT)
        snapshot = _memory_arena_repo._matches[match_id].snapshot
        return [
            [[(d["card_index"], d["decision"], d["auto"]) for d in heat] for heat in seat["decisions"]]
            for seat in snapshot["seats"] if seat["is_bot"]
        ]

    assert run("pc-replay-a") == run("pc-replay-b")


def test_conceding_as_the_only_human_ends_the_match_with_a_loss():
    client = _client_as("pc-user-9")
    view = _start(client)
    match_id = view["match_id"]
    view = _advance_to(client, match_id, C.PHASE_CARD)
    out = _command(client, match_id, view, C.COMMAND_FORFEIT, {})
    assert out["accepted"]
    assert out["match"]["status"] == "completed"
    you = view["your_seat_index"]
    results = {r["seat_index"]: r for r in client.get(f"/api/v1/arena/matches/{match_id}/results").json()["results"]}
    assert results[you]["placement"] == 4 and results[you]["outcome"] == "loss"
    assert results[you]["detail"]["forfeited"] is True
