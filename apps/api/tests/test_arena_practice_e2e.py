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

import anyio
import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.repositories.arena_protocols import COMMAND_TYPE_TIMEOUT, CommandRequest
from app.services.arena import bots as bot_service
from app.services.arena import clock
from app.services.arena.modes import registry as mode_registry
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

from nba_peak.three_man_weave.config import ROUNDS

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


def _expire_ceremony(match_id: str) -> None:
    """Let a Three-Man Weave franchise x decade REVEAL run out.

    THE CEREMONY IS A TURN NOW, so a driver that only advanced a bot's think
    delay stopped dead at the top of every round: the reveal belongs to no seat,
    nobody may act on it, and it ends only when its own deadline passes. The
    foundation's sweep is lazy -- it fires on a read -- so a test that wants the
    next pick turn has to let the ceremony expire first, exactly as a real
    client's polling does 3.2 seconds later.

    ONLY THE REVEAL'S DEADLINE IS MOVED. Pulling a PICK turn's deadline back
    would forfeit that seat to the auto-pick, which would quietly turn every
    driver below into a test of the timeout path instead of the one it names.

    Moved to an instant already past rather than shifted by a fixed amount, so
    the helper works for a ceremony of ANY length -- see
    `test_round_ones_ceremony_is_the_modes_own_length` for why that matters.
    """
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    for turn in _memory_arena_repo._turns.get(match_id, []):
        if turn.resolved_at is None and turn.phase == tmw_module.PHASE_REVEAL:
            turn.deadline_at = past


def _poll(client: TestClient, match_id: str) -> dict:
    _age_open_turn(match_id, 5.0)
    _expire_ceremony(match_id)
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
    assert [s["seat_index"] for s in view["seats"]] == [0, 1, 2]
    assert sum(1 for s in view["seats"] if s["is_bot"]) == 2
    assert sum(1 for s in view["seats"] if not s["is_bot"]) == 1
    assert view["rated"] is False
    assert view["status"] == "active"


def test_the_weave_seats_the_human_at_every_seat_across_matches():
    """The human must not always draft first.

    Seat A opens every round-1 snake and seat C takes the back-to-back turn at
    each round boundary, so a player permanently at A never sees the order the
    mode is built around. Drawn from the match seed, so a given match still
    replays into the same seats.
    """
    client = _client_as("user-a")
    seen = set()
    for _ in range(40):
        view = client.post(
            "/api/v1/arena/matches/practice", json={"mode": TMW}
        ).json()
        human = next(s for s in view["seats"] if not s["is_bot"])
        seen.add(human["seat_index"])
        assert view["your_seat_index"] == human["seat_index"]
    assert seen == {0, 1, 2}, f"the human only ever sat at {sorted(seen)}"


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
    bot_names = []
    for seat in view["seats"]:
        name = seat["display_name"]
        assert "_v1" not in name and "_v2" not in name
        assert "random_legal" not in name
        assert "(" not in name
        if seat["is_bot"]:
            bot_names.append(name)
            # Never a numbered placeholder. A two-seat mode says "PEAK3 Bot";
            # a mode that names its own bots supplies real archetypes.
            assert not any(name == f"PEAK3 Bot {n}" for n in range(10)), name
    assert len(set(bot_names)) == len(bot_names), f"duplicate bot names: {bot_names}"


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

    # THE TWO WAITS ARE COUNTED SEPARATELY, and that separation is the point.
    # A seat other than yours holding the turn now means one of two completely
    # different things: a bot is thinking, or the franchise x decade ceremony
    # is running (which belongs to no seat at all). Adding them together would
    # have let a bot regress all the way to needing a timeout while the total
    # stayed under a ceiling loosened to accommodate six ceremonies -- so the
    # budget this test exists to enforce is kept on the bot count alone.
    polls_waiting_on_bots = 0
    polls_waiting_on_ceremony = 0
    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        if view.get("turn_phase") == tmw_module.PHASE_REVEAL:
            polls_waiting_on_ceremony += 1
            view = _poll(client, match_id)
            continue
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
    # UNCHANGED from before the ceremony existed -- that is the guarantee.
    assert polls_waiting_on_bots <= 24, polls_waiting_on_bots
    # Six rounds, six ceremonies. Each costs the poll that expires it plus the
    # one that sees the pick turn; anything beyond that would mean a reveal was
    # being re-entered rather than resolved once.
    assert polls_waiting_on_ceremony <= 18, polls_waiting_on_ceremony
    assert polls_waiting_on_ceremony >= 6, (
        f"only {polls_waiting_on_ceremony} ceremony polls -- every round must "
        "open on a reveal, including the ones the human leads"
    )


# ---------------------------------------------------------------------------
# THE FRANCHISE x DECADE CEREMONY, THROUGH THE REAL ROUTES
#
# The mode's own suite (`test_three_man_weave_mode.py`) proves the reducer's
# arithmetic. What can only be seen HERE is the wiring: that the foundation
# opens the turn the mode asked for, that the bot driver leaves it alone, that
# the route refuses a command against it, and that a reconnecting client can
# reconstruct it from what the API sends.
# ---------------------------------------------------------------------------


def _open_turn(match_id: str):
    """The match's currently open turn, straight out of the repository."""
    turns = [t for t in _memory_arena_repo._turns.get(match_id, []) if t.resolved_at is None]
    assert len(turns) == 1, f"expected exactly one open turn, found {len(turns)}"
    return turns[0]


def _weave_with_human_at_seat(client: TestClient, seat_index: int) -> dict:
    """A practice match whose HUMAN sits at `seat_index`.

    The seat is drawn from the match seed (`config.human_seat_index`), so it is
    found by creating matches rather than by asking for one -- the same fact
    `test_the_weave_seats_the_human_at_every_seat_across_matches` relies on.
    """
    for _ in range(80):
        view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
        if view["your_seat_index"] == seat_index:
            return view
    raise AssertionError(f"no practice match seated the human at {seat_index}")


def test_every_weave_round_opens_on_a_ceremony_that_belongs_to_no_seat():
    """ROUND 1 AND EVERY LATER ROUND, observed live across a whole match.

    The earlier repair showed the ceremony only on rounds a BOT led, so a test
    that sampled a single round could pass while the product requirement had
    been deleted for a third of them. This walks all six.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]

    # Round 1 opens on the ceremony, before anybody has done anything at all.
    assert view["turn_phase"] == tmw_module.PHASE_REVEAL
    assert view["current_turn_seat_index"] is None
    assert view["public_state"]["current_round"] == 1

    rounds_that_opened_on_a_ceremony = set()
    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        if view["turn_phase"] == tmw_module.PHASE_REVEAL:
            # A ceremony belongs to nobody, and always has a roll to show --
            # showing it IS the ceremony.
            assert view["current_turn_seat_index"] is None
            assert view["public_state"]["current_roll"] is not None
            rounds_that_opened_on_a_ceremony.add(view["public_state"]["current_round"])
        if view["current_turn_seat_index"] != you:
            view = _poll(client, match_id)
            continue
        legal = view["private_state"].get("legal_picks") or {}
        slug = sorted(legal)[0]
        view = _command(
            client, match_id, view, "tmw_pick",
            {"player_slug": slug, "slot_type": legal[slug][0]},
        )["match"]

    assert view["public_state"]["is_complete"]
    assert rounds_that_opened_on_a_ceremony == set(range(1, ROUNDS + 1))


def test_a_round_the_human_leads_gets_the_ceremony_AND_the_full_window():
    """THE REGRESSION THAT MUST NEVER COME BACK, end to end.

    Round 1's snake opens on seat A, so a match that seated the human at 0 is a
    HUMAN-LED round -- the exact case the earlier fix had deleted the ceremony
    from, on the grounds that showing it spent 2.3 seconds of a 45-second clock
    that was already running.

    BOTH halves are asserted, because either one alone was achievable before:
    the ceremony PLAYS, and the pick window that follows it is FULL, measured
    from the ceremony's end rather than from when the round opened.
    """
    client = _client_as("user-a")
    view = _weave_with_human_at_seat(client, 0)
    match_id = view["match_id"]

    # The ceremony plays, for the human, on the round the human leads.
    assert view["turn_phase"] == tmw_module.PHASE_REVEAL
    assert view["current_turn_seat_index"] is None
    assert view["public_state"]["current_seat"] == 0 == view["your_seat_index"]
    ceremony_seq = _open_turn(match_id).turn_seq

    # Now let it run out, exactly as a real client's polling does.
    view = _poll(client, match_id)

    assert view["turn_phase"] == tmw_module.PHASE_PICK
    assert view["current_turn_seat_index"] == 0
    turn = _open_turn(match_id)
    assert turn.turn_seq != ceremony_seq, "the ceremony's own turn was reused"
    # THE WHOLE POINT: the window is `TURN_SECONDS` long measured from the
    # instant the ceremony ended. A window measured from when the ROUND opened
    # would be short by the ceremony's entire duration.
    assert (turn.deadline_at - turn.opened_at).total_seconds() == pytest.approx(
        tmw_module.TURN_SECONDS, abs=0.5
    )
    assert view["seconds_remaining"] > tmw_module.TURN_SECONDS - 1


def test_no_seat_can_act_while_a_weave_ceremony_is_open():
    """Nobody drafts under the reveal -- not the human, and not the bots.

    The bot half cannot be seen from the mode at all. Without
    `phase_accepts_bot_action`, `drive_pending_bots` reads the ceremony's
    `seat_index is None` as a SIMULTANEOUS turn and lets every bot seat play, so
    a whole round would be drafted underneath a reveal nobody had seen.
    """
    from app.services.arena import bots as bot_module

    client = _client_as("user-a")
    view = _weave_with_human_at_seat(client, 0)
    match_id = view["match_id"]
    assert view["turn_phase"] == tmw_module.PHASE_REVEAL

    # 1. THE HUMAN. A perfectly legal pick, refused for WHEN it arrived.
    legal = view["private_state"].get("legal_picks") or {}
    assert legal, "the projection still offers this seat its legal picks"
    slug = sorted(legal)[0]
    refused = _command(
        client, match_id, view, "tmw_pick",
        {"player_slug": slug, "slot_type": legal[slug][0]},
    )
    assert refused["accepted"] is False
    assert refused["rejection_code"] == "not_your_turn"

    # 2. THE BOTS. Driven directly, with every think delay long since elapsed,
    #    so nothing except the phase is holding them back.
    _age_open_turn(match_id, 120.0)
    steps = anyio.run(
        bot_module.drive_pending_bots,
        _memory_arena_repo,
        tmw_module.mode,
        tmw_module.mode.reduce,
        match_id,
        datetime.now(timezone.utc),
    )
    assert steps == 0, "a bot drafted underneath the ceremony"

    # 3. AND NOTHING MOVED: same version, same turn, same board.
    after = client.get(f"/api/v1/arena/matches/{match_id}").json()
    assert after["state_version"] == view["state_version"]
    assert after["turn_phase"] == tmw_module.PHASE_REVEAL
    assert after["public_state"]["rosters"] == view["public_state"]["rosters"]
    assert after["public_state"]["current_roll"] == view["public_state"]["current_roll"]


def test_replaying_the_ceremonys_timeout_applies_nothing_twice():
    """The sweep's key is derived from `(match, turn_seq)`, never random.

    Two clients polling in the same instant both fire the ceremony's timeout.
    The second must be recognised as a REPLAY at the storage layer rather than
    opening a second pick turn or moving the first one's deadline.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    ceremony = _open_turn(match_id)
    assert ceremony.phase == tmw_module.PHASE_REVEAL

    key = clock.timeout_idempotency_key(match_id, ceremony.turn_seq)
    now = datetime.now(timezone.utc)

    def _fire():
        return anyio.run(
            _memory_arena_repo.apply_command,
            CommandRequest(
                match_id=match_id,
                idempotency_key=key,
                command_type=COMMAND_TYPE_TIMEOUT,
                payload={"turn_seq": ceremony.turn_seq, "seat_index": None},
                actor_sub=None,
                actor_seat_index=None,
                expected_state_version=None,
                issued_at=now,
            ),
            clock.guard_timeout(tmw_module.mode.reduce, ceremony.turn_seq),
            now,
        )

    first = _fire()
    assert first.accepted and not first.replayed
    opened = _open_turn(match_id)
    assert opened.phase == tmw_module.PHASE_PICK

    second = _fire()
    assert second.replayed is True, "the identical key was applied a second time"
    again = _open_turn(match_id)
    assert again.turn_seq == opened.turn_seq, "the replay opened a second turn"
    assert again.phase == tmw_module.PHASE_PICK
    assert again.deadline_at == opened.deadline_at, "the replay moved the clock"


def test_a_reconnect_mid_ceremony_reconstructs_it_for_every_seat():
    """A reload during the reveal is answered by STATE, not by an animation.

    THREE HUMAN SEATS, not one human and two bots, because the claim is about
    every seat: `_build_view` publishes `seconds_remaining` when the open turn
    names no seat, which is exactly the ceremony's shape, and that is what lets
    all three participants count the same beat down. With bots in the other two
    chairs there is nobody to ask.
    """
    host = _client_as("user-a")
    room = host.post("/api/v1/arena/matches/private", json={"mode": TMW}).json()
    match_id = room["match_id"]
    for sub in ("user-b", "user-c"):
        guest = _client_as(sub)
        joined = guest.post(
            "/api/v1/arena/matches/private/join", json={"room_code": room["room_code"]}
        )
        assert joined.status_code == 200, joined.text

    window = (
        _open_turn(match_id).deadline_at - _open_turn(match_id).opened_at
    ).total_seconds()
    seen_seats = set()
    for sub in ("user-a", "user-b", "user-c"):
        # A fresh client per seat: `_client_as` rewires the shared dependency
        # overrides, so the identity is whoever asked most recently.
        client = _client_as(sub)
        view = client.get(f"/api/v1/arena/matches/{match_id}").json()
        assert view["status"] == "active", sub
        seen_seats.add(view["your_seat_index"])
        # THE THREE FIELDS A RECONNECTING CLIENT NEEDS, for THIS seat.
        assert view["turn_phase"] == tmw_module.PHASE_REVEAL, sub
        assert view["current_turn_seat_index"] is None, sub
        assert view["seconds_remaining"] is not None, sub
        # Strictly inside the ceremony's own window: a client that read this as
        # a full window would restart the reveal, and one that read it as zero
        # would skip it.
        assert 0 < view["seconds_remaining"] <= window, sub
        # The roll is on the board throughout -- showing it IS the ceremony.
        assert view["public_state"]["current_roll"] is not None, sub
    assert seen_seats == {0, 1, 2}


def test_round_ones_ceremony_is_the_modes_own_length():
    """ROUND ONE'S CEREMONY IS NOT A 45-SECOND DECISION.

    THE DEFECT THIS PINS. The FIRST turn of a match is not opened by the mode's
    reducer -- `matchmaking._open_play` opens it. It asked the mode which PHASE
    to open, via `initial_phase()`, and then stamped the deadline as
    `now + mode.turn_seconds`: the DECISION window. So rounds two through six,
    whose turns come from the mode's own `TurnDraft`, held the ceremony for
    `REVEAL_SECONDS`, and round one held it for forty-five seconds -- a player
    stared at the reveal for three quarters of a minute before the first panel
    opened.

    The seam that was missing is `modes.phase_seconds`: a mode may now say how
    long a PHASE lasts, not only how long a decision does. This test is the
    contract for it, and it is deliberately measured against the mode's own
    constant rather than a literal, so changing `REVEAL_SECONDS` cannot leave a
    stale number here.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    turn = _open_turn(view["match_id"])
    assert turn.phase == tmw_module.PHASE_REVEAL
    held = (turn.deadline_at - turn.opened_at).total_seconds()
    assert held == pytest.approx(tmw_module.REVEAL_SECONDS, abs=0.5), held
    # And emphatically NOT the decision window, which is what it used to be.
    assert held < tmw_module.TURN_SECONDS / 2, (
        f"round one held the ceremony for {held}s against a "
        f"{tmw_module.TURN_SECONDS}s decision window"
    )


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
