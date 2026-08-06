"""Local bot practice on an anon-cookie subject — and everything it must not open.

WHY THIS EXISTS. Every Arena route required a real Supabase `auth.uid()`, for a
reason that is exactly right for a shared match and has never applied to
practice: an anon subject can be discarded by clearing a cookie, and in a
three-seat match that means abandoning two other people mid-clock. Practice
involves nobody else. The consequence of not distinguishing the two was that
reviewing bot practice on a laptop required a hosted Supabase project, so the
local Multiplayer page could not be played at all.

`PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED` is the switch, and the load-bearing
property is that a DEPLOYED API CANNOT HOLD IT: `Settings` raises at startup if
it is set with `DEBUG=False`. That is asserted here too, because a switch whose
whole value is "production cannot have this" is worth a test that fails if
production ever can.

The rest of this file is the blast radius: what the flag opens (practice, and
acting inside a match you already hold a seat in) and what it must not (the
queue, private rooms, match history, and above all somebody else's match).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.auth import (
    ANON_COOKIE_NAME,
    AuthSubject,
    create_anon_subject_cookie,
    get_optional_auth,
    get_required_auth,
)
from app.core.config import Settings, settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.services.arena import bots as bot_service
from app.services.arena.modes import registry as mode_registry

from tests.test_arena_routes import RouteTestMode


@pytest.fixture(autouse=True)
def _arena_closed_alpha():
    """The exact posture the manual review was in: Arena on, bots on, public
    queue OFF, ratings and leaderboard off, closed alpha."""
    original = (
        settings.ARENA_ENABLED,
        settings.ARENA_PUBLIC_QUEUE_ENABLED,
        settings.ARENA_BOTS_ENABLED,
        settings.ARENA_ALPHA_ALLOWLIST,
        settings.ARENA_ANONYMOUS_PRACTICE_ENABLED,
    )
    settings.ARENA_ENABLED = True
    settings.ARENA_PUBLIC_QUEUE_ENABLED = False
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_ANONYMOUS_PRACTICE_ENABLED = True

    mode_registry.clear()
    mode_registry.register(RouteTestMode())
    bot_service.registry.clear()
    bot_service.registry.register(
        bot_service.RandomLegalBot(), for_modes=(RouteTestMode.mode,)
    )
    for attr in (
        "_matches", "_seats", "_events", "_turns", "_results", "_commands",
        "_queue", "_match_locks",
    ):
        getattr(_memory_arena_repo, attr).clear()

    # No auth override at all: these tests are ABOUT the unauthenticated path,
    # so an override would test something else entirely.
    app.dependency_overrides.clear()
    yield
    (
        settings.ARENA_ENABLED,
        settings.ARENA_PUBLIC_QUEUE_ENABLED,
        settings.ARENA_BOTS_ENABLED,
        settings.ARENA_ALPHA_ALLOWLIST,
        settings.ARENA_ANONYMOUS_PRACTICE_ENABLED,
    ) = original
    mode_registry.clear()
    bot_service.registry.clear()
    app.dependency_overrides.clear()


def _guest() -> TestClient:
    """A browser with no Supabase session at all — the local review's browser."""
    return TestClient(app)


def _guest_with_cookie(sub: str) -> TestClient:
    """A guest whose signed identity cookie is already established."""
    client = TestClient(app)
    client.cookies.set(
        ANON_COOKIE_NAME, create_anon_subject_cookie(sub, settings.SIGNING_SECRET)
    )
    return client


def _account(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@t.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


# ---------------------------------------------------------------------------
# The switch itself
# ---------------------------------------------------------------------------


def test_a_deployed_api_refuses_to_start_with_anonymous_practice_on():
    """The whole value of this flag is that production cannot have it."""
    with pytest.raises(ValidationError) as excinfo:
        Settings(
            DEBUG=False,
            ARENA_ENABLED=True,
            ARENA_BOTS_ENABLED=True,
            ARENA_READINESS_LEVEL="closed_alpha",
            ARENA_ANONYMOUS_PRACTICE_ENABLED=True,
            SUPABASE_URL="https://example.supabase.co",
            DATABASE_URL="postgresql://u:p@h:5432/db",
            SIGNING_SECRET="a-real-secret-value-for-this-test-only",
        )
    assert "ANONYMOUS_PRACTICE" in str(excinfo.value)


def test_the_flag_is_refused_without_the_capabilities_it_depends_on():
    for kwargs in (
        {"ARENA_ENABLED": False, "ARENA_BOTS_ENABLED": False},
        {"ARENA_ENABLED": True, "ARENA_BOTS_ENABLED": False},
    ):
        with pytest.raises(ValidationError):
            Settings(
                DEBUG=True,
                ARENA_READINESS_LEVEL="closed_alpha",
                ARENA_ANONYMOUS_PRACTICE_ENABLED=True,
                **kwargs,
            )


def test_off_by_default_a_guest_is_still_refused():
    settings.ARENA_ANONYMOUS_PRACTICE_ENABLED = False
    r = _guest().post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 401
    assert r.json()["detail"]["error_code"] == "authentication_required"


# ---------------------------------------------------------------------------
# What it opens
# ---------------------------------------------------------------------------


def test_a_guest_can_start_bot_practice():
    client = _guest()
    r = client.post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["entry_path"] == "practice"
    assert view["rated"] is False
    assert view["your_seat_index"] == 0
    # And the identity was ISSUED, not assumed: the cookie is on the response,
    # so the next request is the same person.
    assert ANON_COOKIE_NAME in client.cookies


def test_a_guest_can_poll_and_act_inside_their_own_practice_match():
    client = _guest()
    match_id = client.post(
        "/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode}
    ).json()["match_id"]

    poll = client.get(f"/api/v1/arena/matches/{match_id}")
    assert poll.status_code == 200
    assert poll.json()["your_seat_index"] == 0

    command = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play",
            "payload": {},
            "idempotency_key": "guest-play-1",
            "expected_state_version": poll.json()["state_version"],
        },
    )
    assert command.status_code == 200, command.text
    assert command.json()["accepted"] is True

    assert client.get(f"/api/v1/arena/matches/{match_id}/events").status_code == 200
    assert client.get(f"/api/v1/arena/matches/{match_id}/results").status_code == 200


def test_the_practice_match_survives_a_reload_because_the_cookie_does():
    """A guest identity that changed per request would make every second call a
    403 -- the exact failure `resolve_owner_sub`'s docstring records for
    CourtBuilder. Asserted here rather than assumed."""
    client = _guest()
    first = client.post(
        "/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode}
    ).json()["match_id"]
    # A brand-new client carrying the SAME cookie is the same person.
    cookie = client.cookies.get(ANON_COOKIE_NAME)
    reloaded = TestClient(app)
    reloaded.cookies.set(ANON_COOKIE_NAME, cookie)
    assert reloaded.get(f"/api/v1/arena/matches/{first}").status_code == 200


# ---------------------------------------------------------------------------
# What it must NOT open
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/v1/arena/matches/private", {"mode": RouteTestMode.mode}),
        ("post", "/api/v1/arena/matches/private/join", {"room_code": "ABC123"}),
        ("post", f"/api/v1/arena/queue/{RouteTestMode.mode}/join", None),
        ("get", f"/api/v1/arena/queue/{RouteTestMode.mode}/status", None),
        ("post", f"/api/v1/arena/queue/{RouteTestMode.mode}/cancel", None),
        ("post", f"/api/v1/arena/queue/{RouteTestMode.mode}/fill-now", None),
        ("get", "/api/v1/arena/matches", None),
    ],
)
def test_a_guest_cannot_reach_anything_that_involves_another_person(method, path, body):
    client = _guest()
    call = getattr(client, method)
    r = call(path, json=body) if body is not None else call(path)
    assert r.status_code == 403, path
    assert r.json()["detail"]["error_code"] == "arena_requires_account", path


def test_a_guest_cannot_reach_someone_elses_match():
    """The gate that was always here and still is: `_seat_or_403` reads the
    caller's seat row, so a match id is worth a 403 and nothing more."""
    owner = _account("user-a")
    match_id = owner.post(
        "/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode}
    ).json()["match_id"]
    app.dependency_overrides.clear()

    stranger = _guest_with_cookie("anon:stranger")
    for path in (
        f"/api/v1/arena/matches/{match_id}",
        f"/api/v1/arena/matches/{match_id}/events",
        f"/api/v1/arena/matches/{match_id}/results",
    ):
        r = stranger.get(path)
        assert r.status_code == 403, path
        assert r.json()["detail"]["error_code"] == "not_a_participant", path

    r = stranger.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": "play",
            "payload": {},
            "idempotency_key": "stranger-play-1",
            "expected_state_version": 0,
        },
    )
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_a_participant"


def test_one_guest_cannot_reach_another_guests_match():
    a = _guest()
    match_id = a.post(
        "/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode}
    ).json()["match_id"]

    b = _guest_with_cookie("anon:someone-else")
    r = b.get(f"/api/v1/arena/matches/{match_id}")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_a_participant"


def test_the_arena_master_switch_still_wins():
    settings.ARENA_ENABLED = False
    r = _guest().post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "arena_not_enabled"


def test_bots_off_still_refuses_practice_for_a_guest():
    settings.ARENA_BOTS_ENABLED = False
    r = _guest().post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "bots_disabled"


# ---------------------------------------------------------------------------
# A signed-in closed-alpha account is unaffected
# ---------------------------------------------------------------------------


def test_a_signed_in_account_still_reaches_bot_practice_with_the_queue_closed():
    """The staging requirement: closed-alpha accounts must reach bot practice
    on a deployed API, where the guest path does not exist."""
    settings.ARENA_ANONYMOUS_PRACTICE_ENABLED = False
    client = _account("user-a")
    r = client.post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 200, r.text
    assert r.json()["rated"] is False


def test_the_allowlist_still_applies_to_accounts():
    settings.ARENA_ALPHA_ALLOWLIST = ["someone-else"]
    client = _account("user-a")
    r = client.post("/api/v1/arena/matches/practice", json={"mode": RouteTestMode.mode})
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_in_alpha_allowlist"


def test_the_public_queue_is_closed_for_accounts_too():
    """`ARENA_PUBLIC_QUEUE_ENABLED=False` is the posture under test, and it must
    stay closed for everybody -- exposing bot practice must not have opened
    matchmaking as a side effect."""
    client = _account("user-a")
    r = client.post(f"/api/v1/arena/queue/{RouteTestMode.mode}/join")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "queue_disabled"


def test_readiness_reports_the_closed_alpha_posture_without_auth():
    r = TestClient(app).get("/api/v1/arena/readiness")
    assert r.status_code == 200
    body = r.json()
    assert body["arena_enabled"] is True
    assert body["bots_enabled"] is True
    assert body["public_queue_enabled"] is False
    assert body["readiness_level"] == settings.ARENA_READINESS_LEVEL
    assert RouteTestMode.mode in [m["id"] for m in body["modes"]]
