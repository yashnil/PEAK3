"""Bot practice, driven through the real HTTP routes and the real modes.

WHY THIS FILE EXISTS SEPARATELY FROM THE MODE TESTS. Every defect this pass
fixed was invisible to a mode-level test and visible the moment a real match ran
end to end:

  * The mode's bot policy existed but was never REGISTERED, so
    `registry.default_for` returned the payload-free baseline. The reducer read
    its empty `bid` as a $0 bid, i.e. a pass, on every lot -- and the Three-Man
    Weave equivalent was rejected outright, so every bot pick waited out a
    45-second clock.
  * `_open_play` hardcoded the first turn onto seat 0, while The $20 Showdown's
    opening bidder comes from the seed. Half of all matches opened with the
    clock on a seat that had no legal move.

Neither is reachable without registering the actual modes, seating actual bots
and polling actual routes, which is what this file does. `mode_registry` and the
bot registry are restored from the real modules rather than stubbed, so a
regression in registration fails HERE.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.services.arena import bots as bot_service
from app.services.arena.modes import registry as mode_registry
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

TMW = "three_man_weave"
TWENTY = "twenty_dollar"


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(
        sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={}
    )
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _real_modes_registered():
    """Restore the REAL registrations, whatever earlier files left behind.

    Several suites clear both registries as a seam they own. Re-registering the
    modules' own singletons is a no-op when they are already there and a repair
    when they are not, so this file is order-independent while still asserting
    against the genuine objects.
    """
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
    bot_service.registry.clear()
    mode_registry.register(td_module.mode)
    mode_registry.register(tmw_module.mode)
    bot_service.registry.register(td_module.bot, for_modes=(TWENTY,))
    bot_service.registry.register(tmw_module.bot, for_modes=(TMW,))

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


def _age_open_turn(match_id: str, seconds: float) -> None:
    """Backdate the open turn so a bot's think delay has elapsed.

    `BOT_THINK_SECONDS` is enforced against the STORED `opened_at`, which is
    what stops a client shortening it by polling faster. A test cannot wait a
    real second per bot move eighteen times, so it moves the stored instant
    instead of the clock -- the same thing the real world does more slowly.
    """
    for turn in _memory_arena_repo._turns.get(match_id, []):
        if turn.resolved_at is None:
            turn.opened_at = turn.opened_at - timedelta(seconds=seconds)


def _poll(client: TestClient, match_id: str) -> dict:
    _age_open_turn(match_id, 5.0)
    response = client.get(f"/api/v1/arena/matches/{match_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _command(client: TestClient, match_id: str, view: dict, command: str, payload: dict) -> dict:
    response = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={
            "command_type": command,
            "payload": payload,
            "expected_state_version": view["state_version"],
            "idempotency_key": f"human-{view['state_version']:05d}-{command}",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Seating and naming
# ---------------------------------------------------------------------------


def test_three_man_weave_practice_seats_one_human_and_two_bots():
    client = _client_as("user-a")
    view = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TMW}
    ).json()
    assert view["seat_count"] == 3
    assert [s["is_bot"] for s in view["seats"]] == [False, True, True]
    assert view["rated"] is False
    assert view["status"] == "active"


def test_twenty_dollar_practice_seats_one_human_and_one_bot():
    client = _client_as("user-a")
    view = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TWENTY}
    ).json()
    assert view["seat_count"] == 2
    assert [s["is_bot"] for s in view["seats"]] == [False, True]


@pytest.mark.parametrize("mode", [TMW, TWENTY])
def test_no_seat_name_leaks_an_implementation_label(mode):
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": mode}).json()
    for seat in view["seats"]:
        name = seat["display_name"]
        assert "_v1" not in name and "_v2" not in name
        assert "random_legal" not in name
        assert "(" not in name
        if seat["is_bot"]:
            assert name.startswith("PEAK3 Bot")


def test_the_showdowns_first_turn_belongs_to_the_seed_drawn_opener():
    """`_open_play` used to hardcode seat 0. Over enough matches the opener
    must be seat 1 sometimes, and the clock must be on whoever it is."""
    client = _client_as("user-a")
    seen = set()
    for _ in range(25):
        view = client.post(
            "/api/v1/arena/matches/practice", json={"mode": TWENTY}
        ).json()
        opener = view["public_state"]["opening_seat"]
        seen.add(opener)
        assert view["public_state"]["active_seat"] == opener
        assert view["current_turn_seat_index"] == opener
    assert seen == {0, 1}, "the opening bidder never varied"


# ---------------------------------------------------------------------------
# The clock
# ---------------------------------------------------------------------------


def test_the_human_gets_the_full_window_when_their_turn_opens():
    """The reported defect: a lot advancing before the player could act.

    `seconds_remaining` is reported ONLY to the seat on the clock, and it is
    the full turn length the moment the turn is created.
    """
    client = _client_as("user-a")
    view = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TWENTY}
    ).json()
    if view["your_seat_index"] != view["public_state"]["active_seat"]:
        # The bot opens. Poll until the clock comes back to the human.
        view = _poll(client, view["match_id"])
    assert view["current_turn_seat_index"] == view["your_seat_index"]
    assert view["seconds_remaining"] is not None
    assert view["seconds_remaining"] > td_module.TURN_SECONDS - 5


def test_a_bot_does_not_move_inside_its_own_think_delay():
    """Without the delay a whole lot could resolve between two frames."""
    client = _client_as("user-a")
    created = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TWENTY}
    ).json()
    match_id = created["match_id"]
    # A poll that does NOT backdate the turn: nothing may have moved.
    immediate = client.get(f"/api/v1/arena/matches/{match_id}").json()
    assert immediate["state_version"] == created["state_version"]


# ---------------------------------------------------------------------------
# Full matches
# ---------------------------------------------------------------------------


def test_a_twenty_dollar_bot_practice_match_completes_with_two_legal_rosters():
    client = _client_as("user-a")
    view = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TWENTY}
    ).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]

    for _ in range(600):
        if view["public_state"]["phase"] == "complete":
            break
        if view["current_turn_seat_index"] != you:
            view = _poll(client, match_id)
            continue
        private = view["private_state"]
        if "bid" in view["legal_commands"] and private["minimum_bid"] <= private["max_bid"]:
            result = _command(
                client, match_id, view, "bid", {"amount": private["minimum_bid"]}
            )
        else:
            result = _command(client, match_id, view, "pass", {})
        assert result["accepted"], result
        view = result["match"]

    assert view["public_state"]["phase"] == "complete", "the match never finished"
    for seat in view["public_state"]["seats"]:
        assert len(seat["roster"]) == 5
        assert seat["budget"] >= 0
        assert sorted(seat["assignment"]) == ["C", "PF", "PG", "SF", "SG"]

    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()
    assert len(results["results"]) == 2
    assert all(r["score"] > 0 for r in results["results"])


def test_the_showdown_bot_buys_players_rather_than_passing_on_everything():
    """THE REPORTED DEFECT. A human who passes on every lot must still lose
    players to a bot that decided independently."""
    client = _client_as("user-a")
    view = client.post(
        "/api/v1/arena/matches/practice", json={"mode": TWENTY}
    ).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]

    for _ in range(600):
        if view["public_state"]["phase"] == "complete":
            break
        if view["current_turn_seat_index"] != you:
            view = _poll(client, match_id)
            continue
        result = _command(client, match_id, view, "pass", {})
        view = result["match"]

    bot_seat = view["public_state"]["seats"][1 - you]
    bought = [entry for entry in bot_seat["roster"] if not entry["autofilled"]]
    assert bought, "the bot passed on every lot the human declined"
    assert bot_seat["budget"] < 20


def test_a_three_man_weave_bot_practice_match_completes_six_rounds():
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]

    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        if view["current_turn_seat_index"] != you:
            view = _poll(client, match_id)
            continue
        legal = view["private_state"].get("legal_picks") or {}
        assert legal, "the human seat was given a turn with no legal pick"
        slug = sorted(legal)[0]
        result = _command(
            client, match_id, view, "tmw_pick",
            {"player_slug": slug, "slot_type": legal[slug][0]},
        )
        assert result["accepted"], result
        view = result["match"]

    state = view["public_state"]
    assert state["is_complete"], "the draft never finished"
    for roster in state["rosters"]:
        assert roster["complete"], roster["seat_index"]
        assert sum(1 for pick in roster["slots"].values() if pick) == 6

    # Brief: no duplicate identities anywhere in the match.
    drafted = [
        pick["player_slug"]
        for roster in state["rosters"]
        for pick in roster["slots"].values()
        if pick
    ]
    assert len(drafted) == len(set(drafted)) == 18

    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()
    assert len(results["results"]) == 3
    assert sorted(r["placement"] for r in results["results"])[0] == 1


def test_the_weaves_snake_order_is_exactly_the_published_one():
    """A-B-C / C-B-A across all six rounds, observed from the live match."""
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]
    order: list[int] = []
    # Keyed on `state_version`, NOT on "the seat changed". Round 1 ends on seat
    # C and round 2 begins on seat C, so a de-duplicating collector would drop
    # the turn at every snake fold -- and would have reported a correct draft
    # as broken.
    seen_versions: set[int] = set()

    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        seat = view["current_turn_seat_index"]
        version = view["state_version"]
        if seat is not None and version not in seen_versions:
            seen_versions.add(version)
            order.append(seat)
        if seat != you:
            view = _poll(client, match_id)
            continue
        legal = view["private_state"].get("legal_picks") or {}
        slug = sorted(legal)[0]
        view = _command(
            client, match_id, view, "tmw_pick",
            {"player_slug": slug, "slot_type": legal[slug][0]},
        )["match"]

    expected: list[int] = []
    for round_number in range(6):
        expected.extend([0, 1, 2] if round_number % 2 == 0 else [2, 1, 0])
    assert order == expected


def test_a_bot_never_holds_a_weave_turn_for_a_full_human_clock():
    """Bots must not stall. Two bot picks per round used to cost 90 seconds of
    wall clock; here they resolve on consecutive polls."""
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]

    polls_waiting_on_bots = 0
    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        if view["current_turn_seat_index"] != you:
            polls_waiting_on_bots += 1
            view = _poll(client, match_id)
            continue
        legal = view["private_state"].get("legal_picks") or {}
        slug = sorted(legal)[0]
        view = _command(
            client, match_id, view, "tmw_pick",
            {"player_slug": slug, "slot_type": legal[slug][0]},
        )["match"]

    assert view["public_state"]["is_complete"]
    # 12 bot picks in a 3-seat, 6-round draft. One poll each is the floor; a
    # generous ceiling still fails loudly if a bot ever needs a timeout.
    assert polls_waiting_on_bots <= 24, polls_waiting_on_bots


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", [TMW, TWENTY])
def test_both_modes_are_published_by_readiness_with_their_seat_counts(mode):
    client = _client_as("user-a")
    readiness = client.get("/api/v1/arena/readiness").json()
    entry = next(m for m in readiness["modes"] if m["id"] == mode)
    assert entry["seat_count"] == (3 if mode == TMW else 2)


@pytest.mark.parametrize("mode", [TMW, TWENTY])
def test_an_account_outside_the_closed_alpha_cannot_start_either_mode(mode):
    settings.ARENA_ALPHA_ALLOWLIST = ["someone-else"]
    client = _client_as("user-a")
    response = client.post("/api/v1/arena/matches/practice", json={"mode": mode})
    assert response.status_code == 403
    assert response.json()["detail"]["error_code"] == "not_in_alpha_allowlist"


@pytest.mark.parametrize("mode", [TMW, TWENTY])
def test_a_private_room_is_never_auto_filled(mode):
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/private", json={"mode": mode}).json()
    assert view["status"] == "forming"
    assert len([s for s in view["seats"] if s["is_bot"]]) == 0
    # Polling does not conjure opponents either.
    again = _poll(client, view["match_id"])
    assert again["status"] == "forming"
    assert len(again["seats"]) == 1


@pytest.mark.parametrize("mode", [TMW, TWENTY])
def test_a_host_can_fill_their_own_room_on_request(mode):
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/private", json={"mode": mode}).json()
    filled = client.post(
        f"/api/v1/arena/matches/{view['match_id']}/fill-bots"
    ).json()
    assert filled["status"] == "active"
    assert len(filled["seats"]) == filled["seat_count"]
    assert filled["rated"] is False
