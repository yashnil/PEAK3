"""Arena HTTP surface: gating, authorization, and the polling contract.

Uses the real FastAPI app through TestClient with `dependency_overrides` for
auth -- the same pattern as tests/test_ranked_placements_leaderboard.py and
tests/test_phase3_auth.py.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    ResultDraft,
    TurnDraft,
    VISIBILITY_SEAT,
)
from app.services.arena import bots as bot_service
from app.services.arena.modes import registry as mode_registry


class RouteTestMode:
    """Two seats, alternating turns, one seat-private event per play, and a
    completion after four plays."""

    mode = "route_test_mode"
    mode_version = "rt_v1"
    seat_count = 2
    turn_seconds = 30.0

    def initial_snapshot(self, seed, seats):
        return {"plays": [], "secrets": {}}

    def initial_phase(self):
        return "play"

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        if data.command.command_type == COMMAND_TYPE_TIMEOUT:
            return ReducerOutput(
                accepted=True,
                snapshot={**data.match.snapshot, "timed_out": True},
                events=(EventDraft(event_type="turn_timeout"),),
                resolve_turn="timeout",
                status="completed",
                results=(
                    ResultDraft(seat_index=0, placement=1, score=1.0, outcome="win"),
                    ResultDraft(seat_index=1, placement=2, score=0.0, outcome="loss"),
                ),
            )
        if data.command.command_type != "play":
            return ReducerOutput(
                accepted=False, rejection_code="illegal_move",
                rejection_message="Only 'play' is legal.",
            )
        seat = data.command.actor_seat_index or 0
        plays = list(data.match.snapshot.get("plays", [])) + [seat]
        secrets = {**data.match.snapshot.get("secrets", {}), str(seat): f"S{seat}"}
        snapshot = {"plays": plays, "secrets": secrets}
        if len(plays) >= 4:
            return ReducerOutput(
                accepted=True, snapshot=snapshot,
                events=(EventDraft(event_type="finished"),),
                resolve_turn="action", status="completed",
                results=(
                    ResultDraft(seat_index=0, placement=1, score=2.0, outcome="win"),
                    ResultDraft(seat_index=1, placement=2, score=1.0, outcome="loss"),
                ),
            )
        return ReducerOutput(
            accepted=True, snapshot=snapshot,
            events=(
                EventDraft(event_type="played", actor_seat_index=seat),
                EventDraft(
                    event_type="my_secret", actor_seat_index=seat,
                    visibility=VISIBILITY_SEAT, visible_to_seat=seat,
                    payload={"value": f"SECRET-FOR-{seat}"},
                ),
            ),
            resolve_turn="action",
            open_turn=TurnDraft(
                phase="play",
                deadline_at=data.now + timedelta(seconds=self.turn_seconds),
                seat_index=(seat + 1) % 2,
            ),
        )

    def project(self, match, seats, seat_index):
        snap = match.snapshot
        public = {"plays": list(snap.get("plays", []))}
        private = {"mine": snap.get("secrets", {}).get(str(seat_index))}
        return public, private, ("play",)


def _auth(sub: str) -> AuthSubject:
    return AuthSubject(
        sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={}
    )


def _client_as(sub: str) -> TestClient:
    subject = _auth(sub)
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _arena_enabled_and_isolated():
    original = (
        settings.ARENA_ENABLED,
        settings.ARENA_PUBLIC_QUEUE_ENABLED,
        settings.ARENA_BOTS_ENABLED,
        settings.ARENA_ALPHA_ALLOWLIST,
    )
    settings.ARENA_ENABLED = True
    settings.ARENA_PUBLIC_QUEUE_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []

    mode_registry.clear()
    mode_registry.register(RouteTestMode())
    bot_service.registry.clear()
    bot_service.registry.register(
        bot_service.RandomLegalBot(), for_modes=(RouteTestMode.mode,)
    )

    # Isolate the module-level memory singleton between tests.
    for attr in (
        "_matches", "_seats", "_events", "_turns", "_results", "_commands",
        "_queue", "_match_locks",
    ):
        getattr(_memory_arena_repo, attr).clear()

    yield

    (
        settings.ARENA_ENABLED,
        settings.ARENA_PUBLIC_QUEUE_ENABLED,
        settings.ARENA_BOTS_ENABLED,
        settings.ARENA_ALPHA_ALLOWLIST,
    ) = original
    mode_registry.clear()
    bot_service.registry.clear()
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Gating -- the default posture
# ---------------------------------------------------------------------------


def test_readiness_answers_even_when_the_arena_is_off():
    """The web app must be able to fail closed cleanly rather than guess why it
    got a 403."""
    settings.ARENA_ENABLED = False
    settings.ARENA_PUBLIC_QUEUE_ENABLED = False
    settings.ARENA_BOTS_ENABLED = False
    client = _client_as("user-a")
    r = client.get("/api/v1/arena/readiness")
    assert r.status_code == 200
    assert r.json()["arena_enabled"] is False


def test_every_play_route_is_refused_while_the_arena_is_off():
    settings.ARENA_ENABLED = False
    settings.ARENA_PUBLIC_QUEUE_ENABLED = False
    settings.ARENA_BOTS_ENABLED = False
    client = _client_as("user-a")
    for method, path, body in (
        ("post", "/api/v1/arena/matches/practice", {"mode": RouteTestMode.mode}),
        ("post", "/api/v1/arena/matches/private", {"mode": RouteTestMode.mode}),
        ("post", "/api/v1/arena/matches/private/join", {"room_code": "ABCDEF"}),
        ("post", f"/api/v1/arena/queue/{RouteTestMode.mode}/join", None),
        ("get", f"/api/v1/arena/queue/{RouteTestMode.mode}/status", None),
        ("get", "/api/v1/arena/matches", None),
    ):
        r = getattr(client, method)(path, json=body) if body else getattr(client, method)(path)
        assert r.status_code == 403, path
        assert r.json()["detail"]["error_code"] == "arena_not_enabled"


def test_an_account_outside_the_allowlist_is_refused():
    settings.ARENA_ALPHA_ALLOWLIST = ["someone-else"]
    client = _client_as("user-a")
    r = client.post("/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_in_alpha_allowlist"


def test_an_anonymous_caller_is_refused():
    subject = AuthSubject(sub="anon:x", email=None, is_anonymous=True, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    client = TestClient(app)
    r = client.post("/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "arena_requires_account"


def test_practice_is_refused_when_bots_are_disabled():
    """Practice IS a bot match; with bots off there is nothing to start."""
    settings.ARENA_BOTS_ENABLED = False
    client = _client_as("user-a")
    r = client.post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "bots_disabled"


def test_an_unknown_mode_is_a_404():
    client = _client_as("user-a")
    r = client.post("/api/v1/arena/matches/private", json={"mode": "no_such_mode"})
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "unknown_mode"


# ---------------------------------------------------------------------------
# Entry paths over HTTP
# ---------------------------------------------------------------------------


def test_a_private_room_returns_its_code_to_the_creator_only_while_forming():
    client = _client_as("user-a")
    r = client.post("/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode})
    assert r.status_code == 200
    body = r.json()
    assert body["rated"] is False
    assert body["status"] == "forming"
    assert body["room_code"] and len(body["room_code"]) == 6
    assert body["your_seat_index"] == 0


def test_a_second_player_joins_by_code_and_the_match_activates():
    a = _client_as("user-a")
    created = a.post(
        "/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode}
    ).json()

    b = _client_as("user-b")
    joined = b.post(
        "/api/v1/arena/matches/private/join",
        json={"room_code": created["room_code"]},
    )
    assert joined.status_code == 200
    assert joined.json()["status"] == "active"
    assert joined.json()["your_seat_index"] == 1


def test_a_bad_room_code_is_a_404():
    client = _client_as("user-a")
    r = client.post("/api/v1/arena/matches/private/join", json={"room_code": "ZZZZZZ"})
    assert r.status_code == 404
    assert r.json()["detail"]["error_code"] == "room_not_found"


def test_practice_starts_active_and_unrated_with_a_bot_seat():
    client = _client_as("user-a")
    body = client.post(
        "/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode}
    ).json()
    assert body["status"] == "active"
    assert body["rated"] is False
    assert [s["is_bot"] for s in body["seats"]] == [False, True]
    assert body["seats"][1]["bot_rating"] is not None


def test_a_public_queue_match_is_rated():
    a = _client_as("user-a")
    assert a.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join").json()["status"] == "waiting"
    b = _client_as("user-b")
    matched = b.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join").json()
    assert matched["status"] == "matched"

    view = b.get(f"/api/v1/arena/matches/{matched['match_id']}").json()
    assert view["rated"] is True
    assert view["entry_path"] == "public_queue"
    assert all(not s["is_bot"] for s in view["seats"])


def test_joining_the_queue_twice_is_a_409():
    a = _client_as("user-a")
    a.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join")
    r = a.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join")
    assert r.status_code == 409
    assert r.json()["detail"]["error_code"] == "already_in_queue"


def test_the_queue_can_be_closed_independently_of_the_arena():
    settings.ARENA_PUBLIC_QUEUE_ENABLED = False
    client = _client_as("user-a")
    r = client.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "queue_disabled"
    # But a private room still works.
    assert client.post(
        "/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode}
    ).status_code == 200


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


def _two_player_match() -> tuple[TestClient, TestClient, str]:
    a = _client_as("user-a")
    created = a.post(
        "/api/v1/arena/matches/private", json={"mode": RouteTestMode.mode}
    ).json()
    b = _client_as("user-b")
    b.post(
        "/api/v1/arena/matches/private/join", json={"room_code": created["room_code"]}
    )
    # `_client_as` mutates a process-wide override, so re-bind each client's
    # identity at use time rather than trusting the object captured above.
    return a, b, created["match_id"]


def test_a_stranger_holding_a_match_id_gets_403_not_404():
    _a, _b, match_id = _two_player_match()
    stranger = _client_as("user-z")
    r = stranger.get(f"/api/v1/arena/matches/{match_id}")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_a_participant"


def test_a_stranger_cannot_submit_a_command():
    _a, _b, match_id = _two_player_match()
    stranger = _client_as("user-z")
    r = stranger.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "stranger-key-1", "expected_state_version": 1,
        },
    )
    assert r.status_code == 403


def test_a_stranger_cannot_read_the_event_log():
    _a, _b, match_id = _two_player_match()
    stranger = _client_as("user-z")
    assert stranger.get(f"/api/v1/arena/matches/{match_id}/events").status_code == 403


def test_a_client_cannot_send_the_reserved_timeout_command():
    """Without this a client could forfeit an opponent's turn on demand."""
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    view = a.get(f"/api/v1/arena/matches/{match_id}").json()
    r = a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": COMMAND_TYPE_TIMEOUT, "payload": {},
            "idempotency_key": "forge-key-01",
            "expected_state_version": view["state_version"],
        },
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "reserved_command"


# ---------------------------------------------------------------------------
# The polling / command contract
# ---------------------------------------------------------------------------


def test_a_command_advances_the_version_and_the_client_echoes_it_back():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    view = a.get(f"/api/v1/arena/matches/{match_id}").json()
    v0 = view["state_version"]

    r = a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "play-key-0001", "expected_state_version": v0,
        },
    ).json()
    assert r["accepted"] is True and r["replayed"] is False
    assert r["match"]["state_version"] == v0 + 1
    assert r["match"]["public_state"]["plays"] == [0]


def test_a_stale_version_is_refused_over_http():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    v0 = a.get(f"/api/v1/arena/matches/{match_id}").json()["state_version"]
    a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "play-key-0001", "expected_state_version": v0,
        },
    )
    b = _client_as("user-b")
    r = b.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "play-key-0002", "expected_state_version": v0,
        },
    ).json()
    assert r["accepted"] is False
    assert r["rejection_code"] == "stale_state_version"


def test_a_replayed_idempotency_key_applies_nothing_over_http():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    v0 = a.get(f"/api/v1/arena/matches/{match_id}").json()["state_version"]
    body = {
        "command_type": "play", "payload": {},
        "idempotency_key": "play-key-0001", "expected_state_version": v0,
    }
    first = a.post(f"/api/v1/arena/matches/{match_id}/commands", json=body).json()
    second = a.post(f"/api/v1/arena/matches/{match_id}/commands", json=body).json()

    assert first["replayed"] is False and second["replayed"] is True
    assert second["match"]["state_version"] == first["match"]["state_version"]
    assert second["match"]["public_state"]["plays"] == [0]


def test_the_idempotency_key_and_expected_version_are_mandatory():
    """An optional key is a key nobody sends, and a retry without one
    double-applies a move."""
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    r = a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={"command_type": "play", "payload": {}},
    )
    assert r.status_code == 422


def test_a_short_idempotency_key_is_refused():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    r = a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "1", "expected_state_version": 1,
        },
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Hidden information over HTTP
# ---------------------------------------------------------------------------


def test_the_response_never_carries_the_raw_snapshot_or_seed():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    body = a.get(f"/api/v1/arena/matches/{match_id}").json()
    assert "snapshot" not in body
    assert "seed" not in body
    assert "secrets" not in body.get("public_state", {})


def test_a_seat_never_sees_another_seats_subject():
    """An auth.uid() is an identifier for a person; showing one player another's
    is a privacy leak dressed as a label."""
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    body = a.get(f"/api/v1/arena/matches/{match_id}").json()
    blob = str(body)
    assert "user-b" not in blob
    for seat in body["seats"]:
        assert "occupant_sub" not in seat


def test_seat_private_events_are_filtered_over_http():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    v0 = a.get(f"/api/v1/arena/matches/{match_id}").json()["state_version"]
    a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "play-key-0001", "expected_state_version": v0,
        },
    )

    seen_by_a = a.get(f"/api/v1/arena/matches/{match_id}/events").json()["events"]
    b = _client_as("user-b")
    seen_by_b = b.get(f"/api/v1/arena/matches/{match_id}/events").json()["events"]

    assert any(e["event_type"] == "my_secret" for e in seen_by_a)
    assert not any(e["event_type"] == "my_secret" for e in seen_by_b)
    assert "SECRET-FOR-0" not in str(seen_by_b)
    # The public event still reaches the opponent.
    assert any(e["event_type"] == "played" for e in seen_by_b)


def test_a_seats_private_projection_is_its_own_only():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    v0 = a.get(f"/api/v1/arena/matches/{match_id}").json()["state_version"]
    a.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play", "payload": {},
            "idempotency_key": "play-key-0001", "expected_state_version": v0,
        },
    )
    b = _client_as("user-b")
    assert b.get(f"/api/v1/arena/matches/{match_id}").json()["private_state"]["mine"] is None
    a = _client_as("user-a")
    assert a.get(f"/api/v1/arena/matches/{match_id}").json()["private_state"]["mine"] == "S0"


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


def test_results_are_empty_until_the_match_completes_then_participant_only():
    _a, _b, match_id = _two_player_match()
    a = _client_as("user-a")
    assert a.get(f"/api/v1/arena/matches/{match_id}/results").json()["results"] == []

    # Four plays completes the match.
    for i in range(4):
        client = _client_as("user-a" if i % 2 == 0 else "user-b")
        v = client.get(f"/api/v1/arena/matches/{match_id}").json()["state_version"]
        client.post(
            f"/api/v1/arena/matches/{match_id}/commands",
            json={
                "command_type": "play", "payload": {},
                "idempotency_key": f"play-key-{i:04d}", "expected_state_version": v,
            },
        )

    a = _client_as("user-a")
    body = a.get(f"/api/v1/arena/matches/{match_id}/results").json()
    assert [r["placement"] for r in body["results"]] == [1, 2]
    assert body["rated"] is False  # private room

    stranger = _client_as("user-z")
    assert stranger.get(
        f"/api/v1/arena/matches/{match_id}/results"
    ).status_code == 403
