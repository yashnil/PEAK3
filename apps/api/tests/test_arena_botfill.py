"""Explicit bot fill: "Fill with bots now" and "Fill empty seats with bots".

Both affordances are in the product brief and neither had a server route. The
waiting half already existed -- the poll IS waiting -- so these cover the half
that lets a player stop waiting on purpose.

THE PROPERTY THAT MATTERS MOST HERE IS `rated`. The invariant
`CHECK (rated = (entry_path = 'public_queue'))` says a public-queue match is
rated and everything else is not, and neither of these routes may become a way
around it: a public match that is bot-filled early must stay RATED (otherwise
"press the button" is a way to farm unrated matches out of a rated queue), and a
private room the host fills must stay UNRATED (otherwise inviting a friend and
then filling is a way to manufacture rating). Both directions are asserted.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    ENTRY_PATH_PRIVATE_ROOM,
    ENTRY_PATH_PUBLIC_QUEUE,
    MATCH_STATUS_ACTIVE,
    SeatUnavailable,
)
from app.services.arena import bots as bot_service
from app.services.arena import matchmaking as mm
from app.services.arena.modes import registry as mode_registry

from tests.test_arena_matchmaking import NOW, DemoMode, ThreeSeatMode


# ---------------------------------------------------------------------------
# Service level
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _bots_registered():
    bot_service.registry.clear()
    bot_service.registry.register(
        bot_service.RandomLegalBot(),
        for_modes=(DemoMode.mode, ThreeSeatMode.mode),
    )
    yield
    bot_service.registry.clear()


@pytest.mark.asyncio
async def test_fill_now_matches_immediately_inside_the_human_window():
    """The whole point: without pressing, `try_match` returns None here."""
    repo = MemoryArenaRepository()
    entry = await mm.join_queue(repo, DemoMode(), "user-a", NOW)

    # Baseline -- the window is open, so the ordinary path keeps waiting.
    assert await mm.try_match(repo, DemoMode(), entry, {}, NOW) is None

    match = await mm.fill_queue_with_bots_now(repo, DemoMode(), "user-a", {}, NOW)
    assert match is not None
    assert match.status == MATCH_STATUS_ACTIVE
    seats = await repo.get_seats(match.match_id)
    assert [s.occupant_kind for s in seats] == ["human", "bot"]


@pytest.mark.asyncio
async def test_a_bot_filled_public_match_is_still_rated():
    repo = MemoryArenaRepository()
    await mm.join_queue(repo, DemoMode(), "user-a", NOW)
    match = await mm.fill_queue_with_bots_now(repo, DemoMode(), "user-a", {}, NOW)
    assert match is not None
    assert match.entry_path == ENTRY_PATH_PUBLIC_QUEUE
    assert match.rated is True, (
        "pressing the button must not change what the match is worth -- "
        "otherwise it is a way to farm unrated matches out of a rated queue"
    )


@pytest.mark.asyncio
async def test_fill_now_only_collapses_the_callers_own_window():
    """B pressing must not drag A into a bot match."""
    repo = MemoryArenaRepository()
    a = await mm.join_queue(repo, ThreeSeatMode(), "user-a", NOW)
    await mm.join_queue(repo, ThreeSeatMode(), "user-b", NOW)

    await repo.collapse_human_preference("user-b", ThreeSeatMode.mode, NOW)

    a_after = await repo.get_queue_entry("user-a", ThreeSeatMode.mode)
    assert a_after is not None
    assert a_after.human_preference_until == a.human_preference_until
    assert a_after.prefers_humans_at(NOW) is True


@pytest.mark.asyncio
async def test_collapsing_is_monotonic_and_never_extends_the_window():
    """A second press must not push the window back out."""
    repo = MemoryArenaRepository()
    await mm.join_queue(repo, DemoMode(), "user-a", NOW)

    first = await repo.collapse_human_preference("user-a", DemoMode.mode, NOW)
    assert first is not None
    later = NOW + timedelta(minutes=5)
    second = await repo.collapse_human_preference("user-a", DemoMode.mode, later)
    assert second is not None
    assert second.human_preference_until == first.human_preference_until


@pytest.mark.asyncio
async def test_fill_now_still_seats_a_waiting_human_before_a_bot():
    """Collapsing removes the reason to keep waiting; it does not skip past
    people who are already available."""
    repo = MemoryArenaRepository()
    await mm.join_queue(repo, DemoMode(), "user-a", NOW)
    await mm.join_queue(repo, DemoMode(), "user-b", NOW)

    match = await mm.fill_queue_with_bots_now(repo, DemoMode(), "user-a", {}, NOW)
    assert match is not None
    seats = await repo.get_seats(match.match_id)
    assert [s.occupant_kind for s in seats] == ["human", "human"]


@pytest.mark.asyncio
async def test_fill_now_returns_none_when_the_caller_is_not_queued():
    repo = MemoryArenaRepository()
    assert await mm.fill_queue_with_bots_now(repo, DemoMode(), "nobody", {}, NOW) is None


@pytest.mark.asyncio
async def test_two_simultaneous_fill_now_presses_create_one_match():
    """The double-click. Exactly one match, one set of bots."""
    repo = MemoryArenaRepository()
    await mm.join_queue(repo, DemoMode(), "user-a", NOW)

    results = await asyncio.gather(
        mm.fill_queue_with_bots_now(repo, DemoMode(), "user-a", {}, NOW),
        mm.fill_queue_with_bots_now(repo, DemoMode(), "user-a", {}, NOW),
    )
    made = [m for m in results if m is not None]
    assert len(made) == 1, "a double-click must not seat two sets of bots"
    assert len(await repo.list_matches_for_sub("user-a")) == 1


# ---------------------------------------------------------------------------
# Private room -- host fill
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_host_fill_seats_bots_and_the_room_stays_unrated():
    repo = MemoryArenaRepository()
    room = await mm.create_private_room(repo, DemoMode(), "host", "Host", NOW)
    assert room.rated is False

    filled = await mm.fill_private_room_with_bots(repo, DemoMode(), room, "host", NOW)
    assert filled.status == MATCH_STATUS_ACTIVE
    assert filled.entry_path == ENTRY_PATH_PRIVATE_ROOM
    assert filled.rated is False, "a host-filled room must never become rated"
    seats = await repo.get_seats(filled.match_id)
    assert [s.occupant_kind for s in seats] == ["human", "bot"]


@pytest.mark.asyncio
async def test_host_fill_pins_the_policy_version_and_the_seats_bot_rating():
    repo = MemoryArenaRepository()
    room = await mm.create_private_room(repo, DemoMode(), "host", "Host", NOW)
    assert room.bot_policy_version is None  # nothing to pin before there are bots

    filled = await mm.fill_private_room_with_bots(repo, DemoMode(), room, "host", NOW)
    assert filled.bot_policy_version is not None
    bot = [s for s in await repo.get_seats(filled.match_id) if s.is_bot][0]
    assert bot.bot_rating is not None
    assert bot.bot_id is not None


@pytest.mark.asyncio
async def test_a_full_room_refuses_a_fill():
    """Also what a double-click gets -- the first press consumed the seats."""
    repo = MemoryArenaRepository()
    room = await mm.create_private_room(repo, DemoMode(), "host", "Host", NOW)
    await mm.fill_private_room_with_bots(repo, DemoMode(), room, "host", NOW)

    with pytest.raises(SeatUnavailable):
        await mm.fill_private_room_with_bots(repo, DemoMode(), room, "host", NOW)


@pytest.mark.asyncio
async def test_two_simultaneous_host_fills_seat_one_set_of_bots():
    repo = MemoryArenaRepository()
    room = await mm.create_private_room(repo, ThreeSeatMode(), "host", "Host", NOW)

    await asyncio.gather(
        mm.fill_private_room_with_bots(repo, ThreeSeatMode(), room, "host", NOW),
        mm.fill_private_room_with_bots(repo, ThreeSeatMode(), room, "host", NOW),
        return_exceptions=True,
    )
    seats = await repo.get_seats(room.match_id)
    assert len(seats) == ThreeSeatMode.seat_count, "no seat may be double-filled"
    assert sum(1 for s in seats if s.is_bot) == ThreeSeatMode.seat_count - 1


@pytest.mark.asyncio
async def test_a_fill_racing_a_human_join_yields_exactly_one_outcome():
    """The seat is taken by the human or by the bot, never by both, and the
    human's join is never rolled back to make room for a bot."""
    repo = MemoryArenaRepository()
    room = await mm.create_private_room(repo, DemoMode(), "host", "Host", NOW)

    await asyncio.gather(
        mm.fill_private_room_with_bots(repo, DemoMode(), room, "host", NOW),
        mm.join_private_room(
            repo, DemoMode(), room.room_code, "guest", "Guest", NOW
        ),
        return_exceptions=True,
    )

    seats = await repo.get_seats(room.match_id)
    assert len(seats) == DemoMode.seat_count, "exactly the seats the mode has"
    assert len({s.seat_index for s in seats}) == len(seats), "no duplicate index"
    contested = [s for s in seats if s.seat_index == 1]
    assert len(contested) == 1, "seat 1 was filled once, by exactly one of them"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


def _auth(sub: str) -> AuthSubject:
    return AuthSubject(sub=sub, email=f"{sub}@t.com", is_anonymous=False, raw_claims={})


def _client_as(sub: str) -> TestClient:
    subject = _auth(sub)
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture
def _routes_ready():
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
    mode_registry.register(DemoMode())
    mode_registry.register(ThreeSeatMode())

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
    app.dependency_overrides.clear()


def test_fill_now_route_matches_the_caller(_routes_ready):
    c = _client_as("user-a")
    c.post(f"/api/v1/arena/queue/{DemoMode.mode}/join")
    r = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "matched"
    assert r.json()["match_id"]


def test_fill_now_route_is_idempotent_across_two_presses(_routes_ready):
    c = _client_as("user-a")
    c.post(f"/api/v1/arena/queue/{DemoMode.mode}/join")
    first = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now").json()
    second = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now").json()
    assert second["status"] == "matched"
    assert second["match_id"] == first["match_id"], (
        "the second press must return the first match, not create another"
    )
    assert len(c.get("/api/v1/arena/matches").json()["matches"]) == 1


def test_fill_now_route_for_a_caller_who_never_queued(_routes_ready):
    c = _client_as("stranger")
    r = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now")
    assert r.status_code == 200
    assert r.json()["status"] == "not_in_queue"


def test_fill_now_route_refuses_cleanly_when_bots_are_disabled(_routes_ready):
    c = _client_as("user-a")
    c.post(f"/api/v1/arena/queue/{DemoMode.mode}/join")
    settings.ARENA_BOTS_ENABLED = False
    r = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "bots_disabled"
    # And the refusal changed nothing -- still queued, still waiting.
    status = c.get(f"/api/v1/arena/queue/{DemoMode.mode}/status").json()
    assert status["status"] == "waiting"


def test_host_fill_route_fills_and_stays_unrated(_routes_ready):
    host = _client_as("host")
    room = host.post(
        "/api/v1/arena/matches/private", json={"mode": DemoMode.mode}
    ).json()
    r = host.post(f"/api/v1/arena/matches/{room['match_id']}/fill-bots")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rated"] is False
    assert body["status"] == MATCH_STATUS_ACTIVE


def test_only_the_host_may_fill_a_private_room(_routes_ready):
    host = _client_as("host")
    room = host.post(
        "/api/v1/arena/matches/private", json={"mode": ThreeSeatMode.mode}
    ).json()

    guest = _client_as("guest")
    guest.post(
        "/api/v1/arena/matches/private/join", json={"room_code": room["room_code"]}
    )
    r = guest.post(f"/api/v1/arena/matches/{room['match_id']}/fill-bots")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "not_room_host", (
        "holding a seat is not the same authority as having opened the room"
    )


def test_host_fill_route_refuses_a_public_queue_match(_routes_ready):
    c = _client_as("user-a")
    c.post(f"/api/v1/arena/queue/{DemoMode.mode}/join")
    match_id = c.post(f"/api/v1/arena/queue/{DemoMode.mode}/fill-now").json()["match_id"]

    r = c.post(f"/api/v1/arena/matches/{match_id}/fill-bots")
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "not_a_private_room"


def test_host_fill_route_refuses_cleanly_when_bots_are_disabled(_routes_ready):
    host = _client_as("host")
    room = host.post(
        "/api/v1/arena/matches/private", json={"mode": DemoMode.mode}
    ).json()
    settings.ARENA_BOTS_ENABLED = False
    r = host.post(f"/api/v1/arena/matches/{room['match_id']}/fill-bots")
    assert r.status_code == 403
    assert r.json()["detail"]["error_code"] == "bots_disabled"
    # Nothing half-seated: the room is still forming with its one human.
    assert len(host.get(f"/api/v1/arena/matches/{room['match_id']}").json()["seats"]) == 1


def test_a_second_host_fill_reports_no_empty_seats(_routes_ready):
    host = _client_as("host")
    room = host.post(
        "/api/v1/arena/matches/private", json={"mode": DemoMode.mode}
    ).json()
    assert host.post(f"/api/v1/arena/matches/{room['match_id']}/fill-bots").status_code == 200
    second = host.post(f"/api/v1/arena/matches/{room['match_id']}/fill-bots")
    assert second.status_code == 409
    assert second.json()["detail"]["error_code"] == "no_empty_seats"


def test_readiness_publishes_a_seat_count_for_every_registered_mode(_routes_ready):
    r = _client_as("user-a").get("/api/v1/arena/readiness")
    assert r.status_code == 200
    modes = r.json()["modes"]
    assert {m["id"] for m in modes} == {DemoMode.mode, ThreeSeatMode.mode}
    by_id = {m["id"]: m["seat_count"] for m in modes}
    assert by_id[DemoMode.mode] == DemoMode.seat_count
    assert by_id[ThreeSeatMode.mode] == ThreeSeatMode.seat_count
    # The number the lobby draws is the number the matchmaker seats -- one
    # publisher, so the deleted `seatCountHint` cannot come back as a drifting
    # second copy.
    for m in modes:
        assert m["seat_count"] == mode_registry.get(m["id"]).seat_count
