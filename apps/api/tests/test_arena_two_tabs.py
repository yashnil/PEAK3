"""Two tabs, a double click, a reload, a late press -- through the real routes.

The room acknowledges a press immediately and lets the server decide
(`lib/game-feel`). That is only safe if every way a client can be BEHIND the
server is refused precisely and leaves the authoritative state untouched:

  * a second tab of the same seat acting on a version the first tab already
    moved past;
  * the same press arriving twice (a double click, or a retry after a lost
    response);
  * a reload in the middle of a turn, which must hand the seat back exactly
    the state it left -- including a staged, uncommitted Weave choice, which
    stays private to that seat;
  * a press that lands after the clock already resolved the turn.

The repository-level races are pinned in `test_arena_action_races.py`; these
pin the same guarantees at the HTTP seam the browser actually uses, for both
Three-Man Weave and the $20 Showdown.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.dependencies import _memory_arena_repo

from tests.test_arena_practice_e2e import (  # noqa: F401 (the fixture registers real modes)
    TMW,
    TWENTY,
    _client_as,
    _human_pick,
    _poll,
    _real_modes_registered,
    _start_practice,
)

COMMANDS = "/api/v1/arena/matches/{}/commands"


def _post(client, match_id: str, command: str, payload: dict, version: int, key: str) -> dict:
    response = client.post(
        COMMANDS.format(match_id),
        json={
            "command_type": command,
            "payload": payload,
            "expected_state_version": version,
            "idempotency_key": key,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def _read(client, match_id: str) -> dict:
    response = client.get(f"/api/v1/arena/matches/{match_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _until_you_can(client, view: dict, command: str) -> dict:
    """Poll (aging bots and seatless turns) until `command` is legal for you."""
    for _ in range(200):
        if view["current_turn_seat_index"] == view["your_seat_index"] and command in view["legal_commands"]:
            return view
        view = _poll(client, view["match_id"])
    raise AssertionError(f"{command} never became legal")


def _your_picks(view: dict) -> list[tuple[str, str]]:
    """Your drafted players, as (slot, player) pairs off your public roster."""
    roster = next(r for r in view["public_state"]["rosters"] if r["seat_index"] == view["your_seat_index"])
    return sorted((slot, pick["player_slug"]) for slot, pick in roster["slots"].items() if pick)


def _expire_your_turn(match_id: str) -> None:
    past = datetime.now(timezone.utc) - timedelta(seconds=120)
    for turn in _memory_arena_repo._turns.get(match_id, []):
        if turn.resolved_at is None and turn.seat_index is not None:
            turn.deadline_at = past


# ---------------------------------------------------------------------------
# Three-Man Weave
# ---------------------------------------------------------------------------


def test_a_second_weave_tab_cannot_pick_over_the_first():
    tab_a = _client_as("user-a")
    view = _until_you_can(tab_a, _start_practice(tab_a, TMW), "tmw_pick")
    match_id = view["match_id"]
    tab_b = _client_as("user-a")
    stale = _read(tab_b, match_id)
    assert stale["state_version"] == view["state_version"]

    first = _post(tab_a, match_id, "tmw_pick", _human_pick(view), view["state_version"], "tab-a-pick-0001")
    assert first["accepted"], first
    picked = _your_picks(first["match"])
    assert len(picked) == len(_your_picks(view)) + 1

    # Tab B still shows the old version and presses its own choice.
    late = _post(tab_b, match_id, "tmw_pick", _human_pick(stale), stale["state_version"], "tab-b-pick-0001")
    assert late["accepted"] is False
    assert late["rejection_code"] == "stale_state_version"

    # The authoritative state is tab A's, and tab B's next read converges on it.
    now = _read(tab_b, match_id)
    assert _your_picks(now) == picked
    assert now["state_version"] >= first["match"]["state_version"]


def test_a_double_clicked_weave_pick_drafts_once():
    client = _client_as("user-a")
    view = _until_you_can(client, _start_practice(client, TMW), "tmw_pick")
    match_id = view["match_id"]
    payload = _human_pick(view)

    first = _post(client, match_id, "tmw_pick", payload, view["state_version"], "double-click-0001")
    second = _post(client, match_id, "tmw_pick", payload, view["state_version"], "double-click-0001")

    assert first["accepted"] and first["replayed"] is False
    assert second["accepted"] and second["replayed"] is True
    assert _your_picks(second["match"]) == _your_picks(first["match"])
    assert len(_your_picks(_read(client, match_id))) == len(_your_picks(view)) + 1


def test_a_reload_hands_back_the_staged_choice_and_only_to_its_seat():
    client = _client_as("user-a")
    view = _until_you_can(client, _start_practice(client, TMW), "tmw_stage_pick")
    match_id = view["match_id"]
    legal = view["private_state"]["legal_picks"]
    slug = sorted(legal)[0]
    staged = _post(
        client, match_id, "tmw_stage_pick", {"player_slug": slug, "slot_type": legal[slug][0]},
        view["state_version"], "stage-0001",
    )
    assert staged["accepted"], staged

    reloaded = _read(_client_as("user-a"), match_id)
    assert reloaded["private_state"]["staged_pick"]["player_slug"] == slug
    assert reloaded["current_turn_seat_index"] == view["your_seat_index"]
    # Staging is a seat's in-progress thinking: never on the public projection.
    assert slug not in reloaded["public_state"]["drafted_identities"]
    assert "staged" not in repr(reloaded["public_state"])


def test_a_weave_pick_after_the_clock_resolved_the_turn_is_refused():
    client = _client_as("user-a")
    view = _until_you_can(client, _start_practice(client, TMW), "tmw_pick")
    match_id = view["match_id"]
    before = len(_your_picks(view))

    _expire_your_turn(match_id)
    late = _post(client, match_id, "tmw_pick", _human_pick(view), view["state_version"], "late-pick-0001")

    assert late["accepted"] is False
    assert late["rejection_code"] == "stale_state_version"
    # The clock's own resolution stands: exactly one pick for the seat, made by
    # the timeout, and the refused press changed nothing on top of it.
    after = _read(client, match_id)
    assert len(_your_picks(after)) == before + 1


# ---------------------------------------------------------------------------
# The $20 Showdown
# ---------------------------------------------------------------------------


def _showdown_turn(client) -> dict:
    return _until_you_can(client, _start_practice(client, TWENTY), "pass")


def _bid_or_pass(view: dict) -> tuple[str, dict]:
    private = view["private_state"]
    if "bid" in view["legal_commands"] and private["minimum_bid"] <= private["max_bid"]:
        return "bid", {"amount": private["minimum_bid"]}
    return "pass", {}


def test_a_second_showdown_tab_cannot_act_on_a_lot_the_first_already_moved():
    tab_a = _client_as("user-a")
    view = _showdown_turn(tab_a)
    match_id = view["match_id"]
    tab_b = _client_as("user-a")
    stale = _read(tab_b, match_id)

    command, payload = _bid_or_pass(view)
    first = _post(tab_a, match_id, command, payload, view["state_version"], "tab-a-act-0001")
    assert first["accepted"], first

    late = _post(tab_b, match_id, "pass", {}, stale["state_version"], "tab-b-act-0001")
    assert late["accepted"] is False
    assert late["rejection_code"] == "stale_state_version"
    now = _read(tab_b, match_id)
    assert now["state_version"] >= first["match"]["state_version"]
    if now["state_version"] == first["match"]["state_version"]:
        # Nothing moved since tab A's press (the bot has not replied yet):
        # tab B reads exactly tab A's outcome, untouched by its refused pass.
        assert now["public_state"]["seats"] == first["match"]["public_state"]["seats"]


def test_a_double_clicked_showdown_bid_is_applied_once():
    client = _client_as("user-a")
    view = _showdown_turn(client)
    match_id = view["match_id"]
    command, payload = _bid_or_pass(view)

    first = _post(client, match_id, command, payload, view["state_version"], "double-bid-0001")
    second = _post(client, match_id, command, payload, view["state_version"], "double-bid-0001")

    assert first["accepted"] and first["replayed"] is False
    assert second["accepted"] and second["replayed"] is True
    assert second["match"]["state_version"] == first["match"]["state_version"]
    assert second["match"]["public_state"] == first["match"]["public_state"]


def test_a_showdown_reload_mid_turn_returns_the_same_turn():
    client = _client_as("user-a")
    view = _showdown_turn(client)
    reloaded = _read(_client_as("user-a"), view["match_id"])
    assert reloaded["state_version"] == view["state_version"]
    assert reloaded["current_turn_seat_index"] == view["your_seat_index"]
    assert reloaded["legal_commands"] == view["legal_commands"]
    assert reloaded["private_state"] == view["private_state"]
