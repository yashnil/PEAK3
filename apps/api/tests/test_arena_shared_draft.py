"""SHARED DRAFT through the real Arena routes and the real foundation.

The rules are tested without a database in `tests/shared_draft/`. This file
tests the SEAM: seat-gated routes, the arrival contract, real seat turns with
full pick clocks, lazy bots, shared-pool exclusivity across two real clients,
persisted results, reconnects, the rollout switch, and that no response
carries a score before the draft is complete.

Time is driven the way `test_arena_prime_cut.py` drives it.
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
from app.services.shared_draft import mode as sd_module
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

from nba_peak.shared_draft import config as C
from nba_peak.shared_draft import state as rules

MODE = C.MODE_ID
SEED = 424_242


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _shared_draft_enabled(monkeypatch):
    saved = {
        name: getattr(settings, name)
        for name in ("ARENA_ENABLED", "ARENA_BOTS_ENABLED", "ARENA_ALPHA_ALLOWLIST", "ARENA_SHARED_DRAFT_ENABLED")
    }
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_SHARED_DRAFT_ENABLED = True
    mode_registry.clear()
    bot_service.registry.clear()
    for module in (tmw_module, td_module, sd_module):
        mode_registry.register(module.mode)
        bot_service.registry.register(module.bot, for_modes=(module.mode.mode,))
    for attr in ("_matches", "_seats", "_events", "_turns", "_results", "_commands", "_queue", "_match_locks"):
        getattr(_memory_arena_repo, attr).clear()
    monkeypatch.setattr(mm, "_new_seed", lambda: SEED)
    yield
    app.dependency_overrides.clear()
    for name, value in saved.items():
        setattr(settings, name, value)


def _open_turn(match_id: str):
    return next((t for t in _memory_arena_repo._turns.get(match_id, []) if t.resolved_at is None), None)


def _age_for_bots(match_id: str, seconds: float = 20.0) -> None:
    turn = _open_turn(match_id)
    if turn is not None:
        turn.opened_at = turn.opened_at - timedelta(seconds=seconds)


def _expire_open_turn(match_id: str) -> None:
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


def _to_draft(client: TestClient, view: dict) -> dict:
    match_id = view["match_id"]
    if C.COMMAND_INTRO_SEEN in view["legal_commands"]:
        view = _command(client, match_id, view, C.COMMAND_INTRO_SEEN, {})["match"]
    for _ in range(4):
        if view["public_state"]["phase"] == C.PHASE_PICK:
            return view
        _expire_open_turn(match_id)
        view = _get(client, match_id)
    raise AssertionError(f"never opened the draft; at {view['public_state']['phase']}")


def _play_to_completion(client: TestClient, match_id: str) -> dict:
    view = _get(client, match_id)
    for _ in range(60):
        if view["status"] == "completed":
            return view
        if C.COMMAND_PICK in view["legal_commands"]:
            card = view["private_state"]["legal_cards"][-1]
            out = _command(client, match_id, view, C.COMMAND_PICK,
                           {"card_index": card, "pick_number": view["public_state"]["pick_index"] + 1})
            assert out["accepted"], out
            view = out["match"]
            continue
        _age_for_bots(match_id)
        view = _get(client, match_id)
    raise AssertionError("match did not complete")


# ---------------------------------------------------------------------------


def test_the_mode_satisfies_the_arena_contract_and_is_registered_with_its_bot():
    assert isinstance(sd_module.mode, ArenaMode)
    assert mode_registry.get(MODE) is sd_module.mode
    assert bot_service.registry.default_for(MODE) is sd_module.bot
    assert sd_module.mode.seat_count == 2


def test_readiness_lists_the_mode_only_while_its_switch_is_on():
    client = _client_as("sd-ready")
    def listed():
        return {m["id"]: m["seat_count"] for m in client.get("/api/v1/arena/readiness").json()["modes"]}

    assert listed()[MODE] == 2
    settings.ARENA_SHARED_DRAFT_ENABLED = False
    assert MODE not in listed()
    refused = client.post("/api/v1/arena/matches/practice", json={"mode": MODE})
    assert refused.status_code == 403
    assert refused.json()["detail"]["error_code"] == "mode_not_enabled"


def test_practice_seats_one_human_against_one_rated_bot_and_opens_on_arrival():
    client = _client_as("sd-user-1")
    view = _start(client)
    seats = _memory_arena_repo._seats[view["match_id"]]
    assert len(seats) == 2 and sum(s.is_bot for s in seats) == 1
    assert next(s for s in seats if s.is_bot).bot_rating == C.BOT_RATING
    assert view["turn_phase"] == C.PHASE_ARRIVAL
    assert view["current_turn_seat_index"] is None
    assert C.COMMAND_PICK not in view["legal_commands"]
    assert len(view["public_state"]["cards"]) == C.BOARD_SIZE


def test_the_intro_clock_starts_at_arrival_and_the_first_pick_gets_a_full_clock():
    client = _client_as("sd-user-2")
    view = _start(client)
    match_id = view["match_id"]
    # A slow client: the match sat in arrival well past the intro's length.
    turn = _open_turn(match_id)
    turn.opened_at -= timedelta(seconds=C.INTRO_SECONDS * 2)
    view = _get(client, match_id)
    assert view["turn_phase"] == C.PHASE_ARRIVAL, "arrival must not expire on the intro's clock"
    view = _command(client, match_id, view, C.COMMAND_INTRO_SEEN, {})["match"]
    assert view["turn_phase"] == C.PHASE_INTRO
    assert view["turn_total_seconds"] == pytest.approx(C.INTRO_SECONDS, abs=0.5)
    _expire_open_turn(match_id)
    view = _get(client, match_id)
    assert view["turn_phase"] == C.PHASE_PICK
    assert view["turn_total_seconds"] == pytest.approx(C.PICK_SECONDS, abs=0.5)
    assert view["current_turn_seat_index"] == rules.pick_order(SEED)[0]


def test_the_arrival_backstop_opens_the_intro_and_never_a_pick():
    client = _client_as("sd-user-3")
    view = _start(client)
    match_id = view["match_id"]
    _expire_open_turn(match_id)
    view = _get(client, match_id)
    assert view["turn_phase"] == C.PHASE_INTRO
    assert view["public_state"]["picks"] == []


def test_a_full_practice_match_completes_with_persisted_results_and_scores_revealed():
    client = _client_as("sd-user-4")
    view = _to_draft(client, _start(client))
    match_id = view["match_id"]
    # Before completion: no score anywhere a human can read.
    for blob in (json.dumps(view), json.dumps(client.get(f"/api/v1/arena/matches/{match_id}/events").json())):
        assert "prime_score" not in blob and "card_scores" not in blob and "roster_total" not in blob
    final = _play_to_completion(client, match_id)
    public = final["public_state"]
    assert public["phase"] == C.PHASE_COMPLETE
    assert all("prime_score" in card for card in public["cards"])
    assert {p["seat_index"] for p in public["placements"]} == {0, 1}
    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()
    rows = results["results"]
    assert len(rows) == 2
    for row in rows:
        seat = next(s for s in public["seats"] if s["seat_index"] == row["seat_index"])
        assert row["score"] == pytest.approx(seat["roster_total"])
        assert row["detail"]["roster_total"] == pytest.approx(seat["roster_total"])


def test_bots_wait_their_think_time_and_never_pick_out_of_turn():
    client = _client_as("sd-user-5")
    view = _to_draft(client, _start(client))
    match_id = view["match_id"]
    you = view["your_seat_index"]
    order = view["public_state"]["order"]
    if order[0] == you:
        view = _command(client, match_id, view, C.COMMAND_PICK, {"card_index": view["private_state"]["legal_cards"][0]})["match"]
    # The bot's turn: inside its think time it has not moved.
    assert view["current_turn_seat_index"] != you
    before = len(view["public_state"]["picks"])
    view = _get(client, match_id)
    assert len(view["public_state"]["picks"]) == before
    _age_for_bots(match_id)
    view = _get(client, match_id)
    assert len(view["public_state"]["picks"]) == before + 1
    assert view["public_state"]["picks"][-1]["seat_index"] != you


def test_a_card_the_bot_drafted_is_refused_to_the_human():
    client = _client_as("sd-user-6")
    view = _to_draft(client, _start(client))
    match_id = view["match_id"]
    you = view["your_seat_index"]
    while True:
        drafted_by_bot = [c for c in view["public_state"]["cards"] if c["drafted_by"] not in (None, you)]
        if drafted_by_bot and C.COMMAND_PICK in view["legal_commands"]:
            break
        if C.COMMAND_PICK in view["legal_commands"]:
            view = _command(client, match_id, view, C.COMMAND_PICK, {"card_index": view["private_state"]["legal_cards"][0]})["match"]
        else:
            _age_for_bots(match_id)
            view = _get(client, match_id)
    taken = drafted_by_bot[0]["card_index"]
    assert taken not in view["private_state"]["legal_cards"]
    out = _command(client, match_id, view, C.COMMAND_PICK, {"card_index": taken}, key="steal-0001")
    assert not out["accepted"] and out["rejection_code"] == rules.REJECT_CARD_TAKEN


def test_an_unanswered_pick_times_out_to_the_first_legal_card_in_board_order():
    client = _client_as("sd-user-7")
    view = _to_draft(client, _start(client))
    match_id = view["match_id"]
    you = view["your_seat_index"]
    while view["current_turn_seat_index"] != you:
        _age_for_bots(match_id)
        view = _get(client, match_id)
    expected = view["private_state"]["legal_cards"][0]
    # Inside the grace window the pick is still open.
    turn = _open_turn(match_id)
    turn.deadline_at = datetime.now(timezone.utc) - timedelta(seconds=clock.ACTION_GRACE_SECONDS - 1)
    assert _get(client, match_id)["current_turn_seat_index"] == you
    _expire_open_turn(match_id)
    view = _get(client, match_id)
    mine = [p for p in view["public_state"]["picks"] if p["seat_index"] == you]
    assert mine[-1]["card_index"] == expected and mine[-1]["auto"] == C.AUTO_TIMEOUT


def test_two_humans_in_a_private_room_share_one_pool():
    host = _client_as("sd-host")
    created = host.post("/api/v1/arena/matches/private", json={"mode": MODE})
    assert created.status_code == 200, created.text
    room = created.json()
    guest = _client_as("sd-guest")
    joined = guest.post("/api/v1/arena/matches/private/join", json={"room_code": room["room_code"]})
    assert joined.status_code == 200, joined.text
    match_id = room["match_id"]

    def as_user(sub):
        return _client_as(sub)

    for sub in ("sd-host", "sd-guest"):
        client = as_user(sub)
        view = _get(client, match_id)
        if C.COMMAND_INTRO_SEEN in view["legal_commands"]:
            _command(client, match_id, view, C.COMMAND_INTRO_SEEN, {})
    _expire_open_turn(match_id)
    seen = set()
    for _ in range(C.ROSTER_SIZE * 2):
        for sub in ("sd-host", "sd-guest"):
            client = as_user(sub)
            view = _get(client, match_id)
            if C.COMMAND_PICK in view["legal_commands"]:
                card = view["private_state"]["legal_cards"][0]
                assert card not in seen
                out = _command(client, match_id, view, C.COMMAND_PICK, {"card_index": card})
                assert out["accepted"], out
                seen.add(card)
                break
    final = _get(as_user("sd-host"), match_id)
    assert final["status"] == "completed"
    assert len(seen) == 10
