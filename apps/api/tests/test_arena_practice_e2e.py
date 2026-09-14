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

import math
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
from app.services.arena import matchmaking as mm
from app.services.arena.modes import registry as mode_registry
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

from nba_peak.three_man_weave.config import BOT_THINK_SECONDS_MAX, ROUNDS

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


#: How much of a bot's think time ONE `_poll` lets elapse, in seconds.
#:
#: Three-Man Weave draws its think time from 4-10 seconds per (seat, turn)
#: (`nba_peak.three_man_weave.config.bot_think_seconds`), so under this driver
#: a bot pick legitimately costs `ceil(think / 5)` polls: one when the draw is
#: under five seconds, two otherwise. A test that budgets polls per bot turn
#: must budget from THIS number and the reply the server publishes, never from
#: a flat "one poll per pick" -- see
#: `test_a_bot_never_holds_a_weave_turn_for_a_full_human_clock`.
BOT_AGE_PER_POLL_SECONDS = 5.0


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
    """Let a SEATLESS turn -- a ceremony or a pre-match intro -- run out.

    THE CEREMONY IS A TURN, so a driver that only advanced a bot's think delay
    stopped dead at the top of every round: it belongs to no seat, nobody may
    act on it, and it ends only when its own deadline passes. The foundation's
    sweep is lazy -- it fires on a read -- so a test that wants the next
    playable turn has to let the ceremony expire first, exactly as a real
    client's polling does a few seconds later.

    KEYED ON `seat_index is None` RATHER THAN ON A PHASE NAME. It used to name
    Three-Man Weave's `PHASE_REVEAL` specifically, and the $20 Showdown's new
    pre-match intro (`twenty_dollar.mode.PHASE_INTRO`) is exactly the same kind
    of turn for exactly the same reason -- so every driver in this file hung on
    it until the phase list was updated. "A turn nobody is on the clock for" is
    the property that actually matters and it is the one the foundation itself
    keys on (`clock.enforce` charges no action-grace to such a turn), so this
    now needs no maintenance when the next mode adds one.

    ONLY A SEATLESS TURN'S DEADLINE IS MOVED. Pulling a seated turn's deadline
    back would forfeit that seat to its auto-resolution, which would quietly
    turn every driver below into a test of the timeout path instead of the one
    it names.

    Moved to an instant already past rather than shifted by a fixed amount, so
    the helper works for a ceremony of ANY length -- see
    `test_round_ones_ceremony_is_the_modes_own_length` for why that matters.
    """
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    for turn in _memory_arena_repo._turns.get(match_id, []):
        if turn.resolved_at is None and turn.seat_index is None:
            turn.deadline_at = past


def _poll(client: TestClient, match_id: str) -> dict:
    """Sweep past whichever seatless turn (if any) is open, exactly one
    phase transition at a time, then read the match as a real client would.

    Both of Three-Man Weave's seatless phases -- the briefing and the
    ceremony -- are short, server-timed turns that end on their own deadline
    (`three_man_weave.mode.PHASE_INTRO`/`PHASE_REVEAL`), so one helper covers
    both: move the open seatless turn's deadline into the past and let the
    foundation's own lazy sweep fire on the read. A bot's think delay is aged
    on the same call so a bot turn advances under polling alone.
    """
    _age_open_turn(match_id, BOT_AGE_PER_POLL_SECONDS)
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


def _human_pick(view: dict) -> dict:
    """A pick payload a REAL player could press, from the seat's own projection.

    THE OLD DRIVER TOOK `sorted(legal_picks)[0]` AND CRASHED WHEN IT WAS EMPTY.
    `legal_picks` answers "who fits an OPEN slot right now". A late-draft seat
    can legitimately have none -- one open slot (say PG) and nobody on the roll
    who plays there directly -- while `candidate_fits` still offers a player who
    fits once the seat's own roster is rearranged. The pick surface
    (`PickOverlay`) sends exactly that: the candidate, the slot the server's
    plan lands them on, and the plan itself as `placements`. So does this.

    A seat with NO selectable candidate at all is the hang tmw_ruleset_v3 made
    unreachable (`draft.round_keepers`); it fails here loudly by name.
    """
    private = view["private_state"]
    legal = private.get("legal_picks") or {}
    if legal:
        slug = sorted(legal)[0]
        return {"player_slug": slug, "slot_type": legal[slug][0]}
    fits = private.get("candidate_fits") or {}
    for slug in sorted(fits):
        fit = fits[slug]
        if fit["state"] == "fits_after_rearrangement" and fit.get("plan"):
            landed = next(slot for slot, placed in fit["plan"].items() if placed == slug)
            return {"player_slug": slug, "slot_type": landed, "placements": fit["plan"]}
    raise AssertionError(
        "the seat on the clock has no selectable candidate: "
        f"open={private.get('open_slots')} fits={ {k: v['state'] for k, v in fits.items()} }"
    )


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
            # Never the emergency-fallback label, numbered or not. Every live
            # seating path supplies a seed-derived name instead -- this mode's
            # own scheme (Three-Man Weave's archetypes) or the shared curated
            # pool (`bots.BOT_NAME_POOL`) -- so the fallback should not be
            # reachable here at all.
            assert bot_service.BOT_DISPLAY_NAME not in name, name
    assert len(set(bot_names)) == len(bot_names), f"duplicate bot names: {bot_names}"


def test_the_showdowns_first_turn_belongs_to_the_seed_drawn_opener():
    """`_open_play` used to hardcode seat 0. Over enough matches the opener
    must be seat 1 sometimes, and the clock must be on whoever it is.

    A MATCH NOW OPENS ON THE INTRO, which belongs to no seat -- that is what
    makes the briefing cost the opening bidder none of their own 25 seconds.
    So the guarantee is asserted one step later, on the first turn anybody is
    actually handed, which is a stricter place for it than the hook's return
    value: it is the turn a player really receives.
    """
    client = _client_as("user-a")
    seen = set()
    for _ in range(25):
        view = client.post(
            "/api/v1/arena/matches/practice", json={"mode": TWENTY}
        ).json()
        opener = view["public_state"]["opening_seat"]
        seen.add(opener)
        assert view["public_state"]["active_seat"] == opener
        # The intro turn names nobody, so BOTH seats see its clock.
        assert view["turn_phase"] == td_module.PHASE_INTRO
        assert view["current_turn_seat_index"] is None
        # ...and when it ends, the auction turn is the seed-drawn opener's.
        after = _poll(client, view["match_id"])
        assert after["turn_phase"] != td_module.PHASE_INTRO
        assert after["current_turn_seat_index"] == opener
    assert seen == {0, 1}, "the opening bidder never varied"


def test_no_lot_can_expire_settle_or_draw_a_bot_action_while_the_intro_is_up():
    """THE INVARIANT: no actionable auction lot may expire or settle before
    the player has entered the match.

    Driven through the real HTTP routes with a real bot seat, exactly like
    every other test in this file, so a regression here is one a live match
    could actually hit. `_age_open_turn` backdates `opened_at` by the bot's
    full think delay on every poll -- the same call `_poll` makes -- but,
    unlike `_poll`, this test does NOT also call `_expire_ceremony`: the
    intro's own (separate) deadline is left untouched, so the seatless intro
    turn stays open for every one of these polls. If a bot's think-delay
    check were keyed on elapsed time alone rather than gated by
    `phase_accepts_action`/`phase_accepts_bot_action`, this is exactly the
    condition that would let it fire underneath the briefing.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TWENTY}).json()
    match_id = view["match_id"]
    assert view["turn_phase"] == td_module.PHASE_INTRO
    assert view["current_turn_seat_index"] is None

    before = view["public_state"]
    before_candidate = before["candidate"]["player_slug"] if before["candidate"] else None
    assert before_candidate is not None, "a lot must already be drawn for the intro to guard"

    for _ in range(5):
        _age_open_turn(match_id, 5.0)  # bot "think" time elapses many times over...
        after = client.get(f"/api/v1/arena/matches/{match_id}").json()
        # ...but the intro's OWN deadline was never moved, so it is still up,
        # and NOTHING about the lot may have changed underneath it.
        assert after["turn_phase"] == td_module.PHASE_INTRO
        assert after["current_turn_seat_index"] is None
        assert after["public_state"]["candidate"]["player_slug"] == before_candidate
        assert after["public_state"]["lot_index"] == before["lot_index"]
        assert after["public_state"]["history"] == before["history"]
        assert all(len(seat["roster"]) == 0 for seat in after["public_state"]["seats"])
        assert all(seat["lot_bid"] == 0 for seat in after["public_state"]["seats"])

    # Only once the intro's own deadline is (separately) let to pass does the
    # first auction turn -- and the ability for anybody to act on the SAME
    # lot -- exist at all. The candidate itself never changed; only its clock
    # started.
    after = _poll(client, match_id)
    assert after["turn_phase"] != td_module.PHASE_INTRO
    assert after["public_state"]["candidate"]["player_slug"] == before_candidate
    assert after["public_state"]["lot_index"] == before["lot_index"]


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
    # END THE INTRO FIRST. It is a real turn belonging to no seat, so no
    # auction clock exists until it closes -- which is the whole point of it.
    view = _poll(client, view["match_id"])
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
        result = _command(client, match_id, view, "tmw_pick", _human_pick(view))
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
        view = _command(client, match_id, view, "tmw_pick", _human_pick(view))["match"]

    expected: list[int] = []
    for round_number in range(6):
        expected.extend([0, 1, 2] if round_number % 2 == 0 else [2, 1, 0])
    assert order == expected


#: Practice seeds whose TWELVE bot picks ALL draw a think time above
#: `BOT_AGE_PER_POLL_SECONDS`, one per human seat (`config.human_seat_index`).
#: Found by an offline scan of `bot_think_seconds(seed, seat, turn_seq)` over
#: the draft's turn schedule (intro = turn 0, then per round one ceremony turn
#: and three picks in snake order); every draw is at least 5.5 s so none sits
#: on the one-poll/two-poll boundary. This is the configuration that made the
#: flat ceiling fail: two polls per pick, twelve picks, plus the briefing.
WEAVE_SLOW_BOT_SEEDS = {0: 40, 1: 37, 2: 49}


@pytest.mark.parametrize(
    "seed",
    [None, *WEAVE_SLOW_BOT_SEEDS.values()],
    ids=["seed-drawn", *(f"slow-bots-human-seat-{i}" for i in WEAVE_SLOW_BOT_SEEDS)],
)
def test_a_bot_never_holds_a_weave_turn_for_a_full_human_clock(monkeypatch, seed):
    """Bots must not stall. Two bot picks per round used to cost 90 seconds of
    wall clock; here every one resolves inside the reply time the server
    publishes for it.

    THE GUARANTEE IS PER TURN, NOT A FLAT POLL COUNT. The server publishes
    `bot_reply_in_seconds` -- how long until the bot on the clock is allowed
    to move -- and `_poll` lets exactly `BOT_AGE_PER_POLL_SECONDS` of that
    elapse per call. So the poll that first covers the published reply is the
    one that must carry the move (the driver is lazy: the first read after
    the think time has elapsed applies it). A bot needing even one poll more
    than `ceil(reply / BOT_AGE_PER_POLL_SECONDS)` is a bot being held past
    its own published clock, which is the regression this test exists for.

    WHY THE OLD FLAT CEILING FLAKED. `polls_waiting_on_bots <= 24` was set when
    a bot thought for 1-5 s and so always moved on the first aged poll (12
    polls, 2x slack). Two things then changed underneath it: the think time
    became 4-10 s (a pick now costs one poll or two, so twelve picks max out
    at exactly 24), and the briefing became a seatless server turn
    (`PHASE_INTRO`) whose one poll this driver was filing under "waiting on
    bots". The count was therefore `1 + sum(ceil(think_i / 5))`, and for the
    ~11% of seeds where all twelve draws land at or above 5 s it is 25. The
    briefing now has its own bucket, the per-turn budget is derived from the
    published reply, and the worst case is pinned by seed so it runs every
    time rather than one run in nine.

    Runs once on a production-drawn seed and once per human seat on a seed
    whose every bot draw is slow -- the pinned cases are exactly the ones that
    used to fail, and on them the bot count must land ON the derived ceiling,
    which is what proves the arithmetic rather than merely tolerating it.
    """
    if seed is not None:
        monkeypatch.setattr(mm, "_new_seed", lambda: seed)
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]
    if seed is not None:
        assert _memory_arena_repo._matches[match_id].seed == seed
        assert you == next(s for s, v in WEAVE_SLOW_BOT_SEEDS.items() if v == seed)

    # THE THREE WAITS ARE COUNTED SEPARATELY, and that separation is the point.
    # A seat other than yours holding the turn now means one of three
    # completely different things: a bot is thinking, the franchise x decade
    # ceremony is running, or the pre-match briefing is up (the last two
    # belong to no seat at all). Adding them together would let a bot regress
    # all the way to needing a timeout while the total stayed under a ceiling
    # loosened to accommodate the seatless phases -- so the budget this test
    # exists to enforce is kept on the bot turns alone.
    polls_waiting_on_briefing = 0
    polls_waiting_on_bots = 0
    polls_waiting_on_ceremony = 0
    # One record per bot turn: the reply the server published the first time
    # the turn was seen, and how many polls it then took to resolve. A bot
    # turn is "the same turn" while `state_version` is unchanged -- the only
    # command that can move the version during a bot's wait is the bot's own.
    bot_turns: list[dict] = []
    waiting: dict | None = None
    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        phase = view.get("turn_phase")
        if phase == tmw_module.PHASE_INTRO:
            assert view["current_turn_seat_index"] is None
            polls_waiting_on_briefing += 1
            view = _poll(client, match_id)
            continue
        if phase == tmw_module.PHASE_REVEAL:
            assert view["current_turn_seat_index"] is None
            polls_waiting_on_ceremony += 1
            view = _poll(client, match_id)
            continue
        seat = view["current_turn_seat_index"]
        if seat != you:
            polls_waiting_on_bots += 1
            reply = view["bot_reply_in_seconds"]
            assert reply is not None, (
                f"a bot seat {seat} is on the clock in phase {phase!r} with no "
                "published reply time"
            )
            assert 0.0 <= reply <= BOT_THINK_SECONDS_MAX, reply
            if waiting is None or waiting["version"] != view["state_version"]:
                waiting = {
                    "version": view["state_version"], "seat": seat,
                    "reply": reply, "polls": 0,
                }
                bot_turns.append(waiting)
            waiting["polls"] += 1
            # EVERY BOT TURN RESOLVES WITHIN ITS PUBLISHED REPLY. The published
            # value is rounded to the millisecond, so half a millisecond is
            # allowed back before dividing; it never adds a poll except when
            # the reply sits on an exact multiple of the aging step.
            budget = max(1, math.ceil((waiting["reply"] + 0.0005) / BOT_AGE_PER_POLL_SECONDS))
            assert waiting["polls"] <= budget, (
                f"bot seat {seat} published a reply of {waiting['reply']}s "
                f"(budget {budget} polls of {BOT_AGE_PER_POLL_SECONDS}s) and "
                f"still held the turn on poll {waiting['polls']}"
            )
            view = _poll(client, match_id)
            continue
        waiting = None
        view = _command(client, match_id, view, "tmw_pick", _human_pick(view))["match"]

    assert view["public_state"]["is_complete"]
    # The briefing is one seatless turn and `_poll` expires it on sight.
    assert polls_waiting_on_briefing == 1, polls_waiting_on_briefing
    # 12 bot picks in a 3-seat, 6-round draft, every one of them seen.
    assert len(bot_turns) == ROUNDS * 2, [t["seat"] for t in bot_turns]
    # The ceiling, DERIVED rather than declared: the longest think time the
    # foundation lets a mode name, in polls, per bot pick. 6 x 2 x ceil(10/5)
    # = 24 today, and it moves with the constants instead of going stale.
    polls_per_pick_at_most = math.ceil(BOT_THINK_SECONDS_MAX / BOT_AGE_PER_POLL_SECONDS)
    ceiling = ROUNDS * 2 * polls_per_pick_at_most
    assert polls_waiting_on_bots <= ceiling, (polls_waiting_on_bots, ceiling)
    if seed is not None:
        # The pinned seeds are the worst case by construction: every reply
        # is longer than one poll's aging, so every pick costs the maximum
        # and the total lands exactly on the ceiling -- neither above it
        # (a stalled bot) nor below it (the seed is not the case it claims).
        assert all(t["reply"] > BOT_AGE_PER_POLL_SECONDS for t in bot_turns), (
            [t["reply"] for t in bot_turns]
        )
        assert polls_waiting_on_bots == ceiling, (polls_waiting_on_bots, ceiling)
    # Six rounds, six ceremonies. Each costs the poll that expires it plus the
    # one that sees the pick turn; anything beyond that would mean a reveal was
    # being re-entered rather than resolved once.
    assert polls_waiting_on_ceremony <= 18, polls_waiting_on_ceremony
    assert polls_waiting_on_ceremony >= 6, (
        f"only {polls_waiting_on_ceremony} ceremony polls -- every round must "
        "open on a reveal, including the ones the human leads"
    )


#: Practice seeds that HUNG the match under tmw_ruleset_v2 with this exact
#: driver: a later drafter in a round was stranded with nothing selectable, its
#: timeout found no auto-pick, and the timeout was refused on every read. 2037
#: stranded the human seat (open slot PG only); 666 stranded a bot seat.
WEAVE_FORMERLY_HUNG_SEEDS = (2037, 666)


@pytest.mark.parametrize("seed", WEAVE_FORMERLY_HUNG_SEEDS)
def test_the_seeds_that_used_to_hang_the_weave_now_finish(monkeypatch, seed):
    monkeypatch.setattr(mm, "_new_seed", lambda: seed)
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]
    assert _memory_arena_repo._matches[match_id].seed == seed

    stalled_polls = 0
    for _ in range(400):
        if view["public_state"]["is_complete"]:
            break
        if view["current_turn_seat_index"] != you:
            before = view["state_version"]
            view = _poll(client, match_id)
            # A bot turn or a seatless phase must MOVE under polling. Two
            # consecutive unchanged polls on a seated bot turn (each ages the
            # bot's think time by `BOT_AGE_PER_POLL_SECONDS`, more than half the
            # longest draw) is the old hang.
            stalled_polls = stalled_polls + 1 if view["state_version"] == before else 0
            assert stalled_polls <= 2, f"seed {seed}: the match stopped moving at version {before}"
            continue
        stalled_polls = 0
        result = _command(client, match_id, view, "tmw_pick", _human_pick(view))
        assert result["accepted"], result
        view = result["match"]

    assert view["public_state"]["is_complete"], f"seed {seed} did not finish"
    rosters = view["public_state"]["rosters"]
    assert all(roster["complete"] for roster in rosters)
    drafted = [pick["player_slug"] for roster in rosters for pick in roster["slots"].values() if pick]
    assert len(drafted) == len(set(drafted)) == ROUNDS * 3


def test_no_reachable_state_has_an_open_turn_with_no_seat_no_command_and_no_deadline():
    """THE DEADLOCK INVARIANT, reported from manual testing as: a match sits on
    Round 1 / Pick 1 with the franchise and decade visible, "Rolling the next
    franchise and decade" and "Standing by" forever, no ceremony, no pick
    surface, no legal command anywhere.

    Every state observed while walking a fresh VS-BOTS match from creation
    through its opening roll and into the draft must satisfy at least one of:

      A. `current_turn_seat_index` is this human's own seat, and the private
         projection actually offers a legal pick (`legal_picks` non-empty) --
         an actionable human turn, not merely an advertised one.
      B. `current_turn_seat_index` names a bot seat -- and the bot resolves
         it within a bounded number of polls, proving the driver is actually
         reachable rather than merely registered.
      C. There is no open turn at all, and the match's status is terminal
         (`completed`/`abandoned`) -- a legitimate stopping point.

    And never: an open turn -- seated or seatless -- that persists with no
    seat on it, no bot able to resolve it, and no human command the private
    projection will accept. Walked for all three human seat assignments
    (`config.human_seat_index` rotates it), since the reported defect could in
    principle depend on whether the human leads round one or not.
    """
    for target_seat in range(3):
        client = _client_as(f"user-seat-{target_seat}")
        view = _weave_with_human_at_seat(client, target_seat)
        match_id = view["match_id"]
        you = view["your_seat_index"]
        assert you == target_seat

        polls_waiting_on_bots_or_ceremony = 0
        for _ in range(120):
            if view["public_state"]["is_complete"]:
                break

            match_row = _memory_arena_repo._matches[match_id]
            turn = next(
                (t for t in _memory_arena_repo._turns.get(match_id, []) if t.resolved_at is None),
                None,
            )
            if turn is None:
                assert match_row.status in ("completed", "abandoned"), (
                    f"seat {target_seat}: no open turn and match status is "
                    f"{match_row.status!r} -- a live match with nothing "
                    "scheduled and nothing actionable"
                )
                break

            # EVERY OPEN TURN CARRIES A SCHEDULED TRANSITION. A turn with no
            # deadline at all could never be swept by `clock.enforce`, which
            # is exactly the "no scheduled server transition" shape named in
            # the report.
            assert turn.deadline_at is not None, (
                f"seat {target_seat}: an open turn with no deadline at all"
            )

            if turn.seat_index == you:
                # (A) THE HUMAN'S OWN TURN MUST BE ACTIONABLE, not merely
                # open: at least one SELECTABLE candidate, directly or by
                # rearranging (`_human_pick` raises by name when there is
                # none -- that is the deadlock itself).
                view = _command(client, match_id, view, "tmw_pick", _human_pick(view))["match"]
                continue

            # (B) EITHER A BOT'S TURN OR A SEATLESS PHASE (the briefing or the
            # ceremony). Both must actually advance under polling alone --
            # `_poll` is exactly a real client's own polling: it ages a bot's
            # think delay and sweeps an overdue seatless turn -- never a
            # test-only shortcut into the reducer.
            polls_waiting_on_bots_or_ceremony += 1
            view = _poll(client, match_id)

        assert polls_waiting_on_bots_or_ceremony < 120, (
            f"seat {target_seat}: never became actionable within the poll "
            "budget -- this is the reported deadlock"
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

    # Every match opens on the pre-match briefing first (`PHASE_INTRO`), not
    # directly on the ceremony -- see `test_the_intro_phase_gates_everything_
    # else`. One poll (the same generic seatless-turn sweep every other test
    # in this file already uses) is that briefing being dismissed/expiring,
    # exactly as `GameIntro`'s own skip command does in the real client.
    view = _poll(client, match_id)

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
        view = _command(client, match_id, view, "tmw_pick", _human_pick(view))["match"]

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
    # Past the pre-match briefing (`PHASE_INTRO`) first -- see
    # `test_the_intro_phase_gates_everything_else` for that phase on its own.
    view = _poll(client, match_id)

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
    # Past the pre-match briefing (`PHASE_INTRO`) first -- see
    # `test_the_intro_phase_gates_everything_else` for that phase on its own.
    view = _poll(client, match_id)
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
    # Past the pre-match briefing (`PHASE_INTRO`) first -- see
    # `test_the_intro_phase_gates_everything_else` for that phase on its own.
    _poll(client, match_id)
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

    # Past the pre-match briefing (`PHASE_INTRO`) first -- see
    # `test_the_intro_phase_gates_everything_else` for that phase on its own.
    # This test is specifically about reconnecting mid-CEREMONY, so it has to
    # actually be in the ceremony before measuring anything about it.
    _poll(host, match_id)

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


# ---------------------------------------------------------------------------
# THE PRE-MATCH BRIEFING (`PHASE_INTRO`), THROUGH THE REAL ROUTES
#
# The briefing is a short, SERVER-TIMED phase every client renders against
# the same clock (game-feel reconstruction). What can only be seen here is
# the wiring: the foundation opens it with the mode's own length, publishes
# its timeline to every seat, refuses every command against it, leaves the
# bots alone, and ends it -- for the whole table at once -- on its own
# deadline, never on any one player's click.
# ---------------------------------------------------------------------------


def test_the_intro_phase_gates_everything_else():
    """WHILE THE BRIEFING IS UP, NOTHING MOVES -- and nobody can end it early.

    Ages the turn's `opened_at` by two seconds (well inside `INTRO_SECONDS`)
    while leaving `deadline_at` untouched, then reads the match with a PLAIN
    GET, exactly as a real client's own poll would.
    """
    from app.services.arena import bots as bot_module

    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]

    assert view["turn_phase"] == tmw_module.PHASE_INTRO
    assert view["current_turn_seat_index"] is None
    # THE TIMELINE IS PUBLISHED, not just a countdown: which turn this is,
    # how long it is, and how far in the server is.
    assert view["turn_seq"] is not None
    assert view["turn_total_seconds"] == pytest.approx(tmw_module.INTRO_SECONDS, abs=0.5)
    assert 0.0 <= view["turn_elapsed_seconds"] <= view["turn_total_seconds"]
    assert view["turn_seconds_remaining"] == pytest.approx(
        view["turn_total_seconds"] - view["turn_elapsed_seconds"], abs=0.5
    )
    before_rosters = view["public_state"]["rosters"]
    assert all(
        all(pick is None for pick in roster["slots"].values()) for roster in before_rosters
    ), "a fresh match must not already have picks"

    _age_open_turn(match_id, 2.0)

    after = client.get(f"/api/v1/arena/matches/{match_id}").json()
    # 1. Still the briefing, still nobody's turn, nothing written.
    assert after["turn_phase"] == tmw_module.PHASE_INTRO
    assert after["current_turn_seat_index"] is None
    assert after["state_version"] == view["state_version"]
    assert after["turn_elapsed_seconds"] >= 2.0

    # 2. No fallback pick occurred, and no roster changed at all.
    assert after["public_state"]["rosters"] == before_rosters
    assert after["public_state"]["current_round"] == 1

    # 3. No bot draft progression, driven directly with every think delay
    #    long since elapsed.
    _age_open_turn(match_id, 150.0)
    steps = anyio.run(
        bot_module.drive_pending_bots,
        _memory_arena_repo,
        tmw_module.mode,
        tmw_module.mode.reduce,
        match_id,
        datetime.now(timezone.utc),
    )
    assert steps == 0, "a bot acted underneath the pre-match briefing"

    # 4. A human pick attempt is refused for when it arrived.
    refreshed = client.get(f"/api/v1/arena/matches/{match_id}").json()
    refused = _command(
        client, match_id, refreshed, "tmw_pick",
        {"player_slug": "anyone", "slot_type": "PG"},
    )
    assert refused["accepted"] is False
    assert refused["rejection_code"] == "not_your_turn"

    # 5. NOBODY CAN END IT EARLY. The former skip commands are refused with a
    #    specific reason and the phase is untouched.
    for command in ("tmw_skip_intro", "tmw_skip_reveal"):
        refused_skip = _command(client, match_id, refreshed, command, {})
        assert refused_skip["accepted"] is False, command
        assert refused_skip["rejection_code"] == tmw_module.REJECT_SHARED_TIMELINE, command
        assert refused_skip["match"]["turn_phase"] == tmw_module.PHASE_INTRO, command

    # 6. ITS OWN DEADLINE ENDS IT, on a plain read, and the ceremony that
    #    follows gets its FULL window measured from that sweep.
    _expire_ceremony(match_id)
    swept = client.get(f"/api/v1/arena/matches/{match_id}").json()
    assert swept["turn_phase"] == tmw_module.PHASE_REVEAL
    assert swept["current_turn_seat_index"] is None
    ceremony = _open_turn(match_id)
    assert ceremony.phase == tmw_module.PHASE_REVEAL
    assert (ceremony.deadline_at - ceremony.opened_at).total_seconds() == pytest.approx(
        tmw_module.OPENING_REVEAL_SECONDS, abs=0.5
    )
    assert swept["turn_total_seconds"] == pytest.approx(
        tmw_module.OPENING_REVEAL_SECONDS, abs=0.5
    )

    # And the normal sequence resumes correctly from there: the ceremony runs
    # out too, and the FIRST pick turn gets a full, undiminished window.
    resumed = _poll(client, match_id)
    assert resumed["turn_phase"] == tmw_module.PHASE_PICK
    pick_turn = _open_turn(match_id)
    assert (pick_turn.deadline_at - pick_turn.opened_at).total_seconds() == pytest.approx(
        tmw_module.TURN_SECONDS, abs=0.5
    )
    assert resumed["turn_total_seconds"] == pytest.approx(tmw_module.TURN_SECONDS, abs=0.5)


def test_every_seat_enters_the_match_on_the_same_server_timeline():
    """THREE HUMANS, ONE TIMELINE. Every seat sees the same briefing turn
    (same `turn_seq`, same length), no seat can end it for the others, and
    when its deadline passes every seat lands on the same ceremony turn --
    none of them on a click.
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

    seqs = set()
    for sub in ("user-a", "user-b", "user-c"):
        client = _client_as(sub)
        view = client.get(f"/api/v1/arena/matches/{match_id}").json()
        assert view["status"] == "active", sub
        assert view["turn_phase"] == tmw_module.PHASE_INTRO, sub
        assert view["current_turn_seat_index"] is None, sub
        assert view["turn_total_seconds"] == pytest.approx(tmw_module.INTRO_SECONDS, abs=0.5), sub
        seqs.add(view["turn_seq"])
        refused = _command(
            client, match_id, view, "tmw_pick",
            {"player_slug": "anyone", "slot_type": "PG"},
        )
        assert refused["accepted"] is False, sub
        assert refused["rejection_code"] == "not_your_turn", sub
        skipped = _command(client, match_id, view, "tmw_skip_intro", {})
        assert skipped["accepted"] is False, sub
        assert skipped["rejection_code"] == tmw_module.REJECT_SHARED_TIMELINE, sub
        assert skipped["match"]["turn_phase"] == tmw_module.PHASE_INTRO, sub
    assert len(seqs) == 1, "every seat must be watching the same briefing turn"

    _expire_ceremony(match_id)
    reveal_seqs = set()
    for sub in ("user-a", "user-b", "user-c"):
        client = _client_as(sub)
        view = client.get(f"/api/v1/arena/matches/{match_id}").json()
        assert view["turn_phase"] == tmw_module.PHASE_REVEAL, sub
        assert view["current_turn_seat_index"] is None, sub
        reveal_seqs.add(view["turn_seq"])
    assert len(reveal_seqs) == 1, "every seat must land on the same ceremony turn"


def test_the_intros_own_deadline_opens_the_ceremony_for_the_table():
    """PAST `INTRO_SECONDS`, THE MATCH ADVANCES -- it does not abandon.

    The old 30-minute "abandon the match" backstop existed only because the
    briefing was a client dialog with no auto-dismiss. A timed phase needs no
    such backstop: reaching its deadline means the briefing has been shown,
    and the ceremony that follows is the same safe transition the ceremony's
    own expiry makes. Backdates BOTH `opened_at` and `deadline_at` well past
    the phase, then reads with a plain GET.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    assert view["turn_phase"] == tmw_module.PHASE_INTRO
    before_rosters = view["public_state"]["rosters"]

    turn = _open_turn(match_id)
    elapsed = timedelta(seconds=tmw_module.INTRO_SECONDS + 120.0)
    for stored in _memory_arena_repo._turns.get(match_id, []):
        if stored.turn_seq == turn.turn_seq:
            stored.opened_at = stored.opened_at - elapsed
            stored.deadline_at = stored.deadline_at - elapsed

    after = client.get(f"/api/v1/arena/matches/{match_id}").json()
    assert after["status"] == "active"
    assert after["turn_phase"] == tmw_module.PHASE_REVEAL
    assert after["current_turn_seat_index"] is None
    # Nothing was played by the transition itself.
    assert after["public_state"]["rosters"] == before_rosters
    assert after["public_state"]["current_round"] == 1
    # And the ceremony's window is measured from the sweep, not from the
    # long-past deadline: a reconnecting client lands INSIDE it.
    assert 0.0 <= after["turn_elapsed_seconds"] <= after["turn_total_seconds"]
    assert after["turn_total_seconds"] == pytest.approx(
        tmw_module.OPENING_REVEAL_SECONDS, abs=0.5
    )


def test_round_ones_ceremony_is_the_modes_own_length():
    """ROUND ONE'S CEREMONY IS NOT A 45-SECOND DECISION.

    The FIRST turn of a match is opened by `matchmaking._open_play`, which
    asks the mode for a phase (`initial_phase`) and for that phase's own
    length (`modes.phase_seconds`). The ceremony that follows the briefing is
    opened by the reducer with `OPENING_REVEAL_SECONDS`; this pins that the
    seam is honoured end to end and that the ceremony is a short beat, not a
    decision window.
    """
    client = _client_as("user-a")
    view = client.post("/api/v1/arena/matches/practice", json={"mode": TMW}).json()
    match_id = view["match_id"]
    _poll(client, match_id)
    turn = _open_turn(match_id)
    assert turn.phase == tmw_module.PHASE_REVEAL
    held = (turn.deadline_at - turn.opened_at).total_seconds()
    assert held == pytest.approx(tmw_module.OPENING_REVEAL_SECONDS, abs=0.5), held
    assert held < tmw_module.TURN_SECONDS / 2, (
        f"round one held the ceremony for {held}s against a "
        f"{tmw_module.TURN_SECONDS}s decision window"
    )


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
