"""Arena entry paths, the rated policy, and bot behaviour.

Three entry paths, three rated verdicts, and one anti-cheat property that is
asserted structurally rather than by inspection.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    ENTRY_PATH_PRACTICE,
    ENTRY_PATH_PRIVATE_ROOM,
    ENTRY_PATH_PUBLIC_QUEUE,
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_FORMING,
    ActiveQueueEntryExists,
    ArenaMatch,
    ArenaSeat,
    BotPolicy,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    SeatUnavailable,
    SeatView,
    TurnDraft,
)
from app.services.arena import bots as bot_service
from app.services.arena import matchmaking as mm
from app.services.arena.modes import ArenaMode, ModeRegistry, mode_rng

NOW = datetime(2026, 8, 4, 12, 0, 0, tzinfo=timezone.utc)


class DemoMode:
    """A minimal `ArenaMode`. Two seats, one hidden value per seat, so the
    projection has something it could leak and demonstrably does not."""

    mode = "demo_mode"
    mode_version = "demo_v1"
    seat_count = 2
    turn_seconds = 30.0

    def initial_snapshot(self, seed: int, seats) -> dict:
        rng = mode_rng(seed, "deal")
        return {
            "turn": 0,
            "hidden": {str(s.seat_index): rng.randint(1, 100) for s in seats},
            "public": {"played": []},
        }

    def initial_phase(self) -> str:
        return "play"

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        snap = {
            "turn": data.match.snapshot.get("turn", 0) + 1,
            "hidden": dict(data.match.snapshot.get("hidden", {})),
            "public": {
                "played": list(data.match.snapshot.get("public", {}).get("played", []))
                + [data.command.actor_seat_index]
            },
        }
        nxt = (data.command.actor_seat_index or 0) + 1
        return ReducerOutput(
            accepted=True,
            snapshot=snap,
            events=(EventDraft(event_type="played"),),
            resolve_turn="action",
            open_turn=TurnDraft(
                phase="play",
                deadline_at=data.now + timedelta(seconds=self.turn_seconds),
                seat_index=nxt % self.seat_count,
            ),
        )

    def project(self, match, seats, seat_index):
        snap = match.snapshot
        public = dict(snap.get("public", {}))
        private = {"my_hidden": snap.get("hidden", {}).get(str(seat_index))}
        return public, private, ("play", "pass")


class ThreeSeatMode(DemoMode):
    mode = "demo_three"
    seat_count = 3


@pytest.fixture(autouse=True)
def _clean_bot_registry():
    bot_service.registry.clear()
    yield
    bot_service.registry.clear()


# ---------------------------------------------------------------------------
# The rated policy
# ---------------------------------------------------------------------------


def test_rated_policy_is_public_only():
    assert mm.is_rated(ENTRY_PATH_PUBLIC_QUEUE) is True
    assert mm.is_rated(ENTRY_PATH_PRIVATE_ROOM) is False
    assert mm.is_rated(ENTRY_PATH_PRACTICE) is False


@pytest.mark.asyncio
async def test_practice_is_unrated_and_starts_immediately():
    repo = MemoryArenaRepository()
    match = await mm.start_practice(repo, DemoMode(), "user-a", "A", NOW)
    assert match.entry_path == ENTRY_PATH_PRACTICE
    assert match.rated is False
    assert match.status == MATCH_STATUS_ACTIVE  # playable on return
    seats = await repo.get_seats(match.match_id)
    assert [s.occupant_kind for s in seats] == ["human", "bot"]
    assert match.bot_policy_version is not None


@pytest.mark.asyncio
async def test_a_private_room_is_unrated_and_waits_for_a_human():
    repo = MemoryArenaRepository()
    match = await mm.create_private_room(repo, DemoMode(), "user-a", "A", NOW)
    assert match.entry_path == ENTRY_PATH_PRIVATE_ROOM
    assert match.rated is False
    assert match.room_code and len(match.room_code) == 6
    # NEVER auto-filled: one seat, still forming, no bot anywhere.
    seats = await repo.get_seats(match.match_id)
    assert len(seats) == 1
    assert match.status == MATCH_STATUS_FORMING
    assert all(not s.is_bot for s in seats)


@pytest.mark.asyncio
async def test_a_private_room_activates_when_the_last_seat_is_taken():
    repo = MemoryArenaRepository()
    created = await mm.create_private_room(repo, DemoMode(), "user-a", "A", NOW)
    joined = await mm.join_private_room(
        repo, DemoMode(), created.room_code, "user-b", "B", NOW
    )
    assert joined.status == MATCH_STATUS_ACTIVE
    assert len(await repo.get_seats(created.match_id)) == 2
    assert joined.snapshot["public"] == {"played": []}  # mode's initial snapshot


@pytest.mark.asyncio
async def test_the_creator_cannot_join_their_own_room():
    repo = MemoryArenaRepository()
    created = await mm.create_private_room(repo, DemoMode(), "user-a", "A", NOW)
    with pytest.raises(SeatUnavailable):
        await mm.join_private_room(
            repo, DemoMode(), created.room_code, "user-a", "A", NOW
        )


@pytest.mark.asyncio
async def test_a_third_player_cannot_join_a_full_room():
    repo = MemoryArenaRepository()
    created = await mm.create_private_room(repo, DemoMode(), "user-a", "A", NOW)
    await mm.join_private_room(repo, DemoMode(), created.room_code, "user-b", "B", NOW)
    with pytest.raises(SeatUnavailable):
        await mm.join_private_room(
            repo, DemoMode(), created.room_code, "user-c", "C", NOW
        )


@pytest.mark.asyncio
async def test_a_finished_rooms_code_stops_resolving():
    repo = MemoryArenaRepository()
    created = await mm.create_private_room(repo, DemoMode(), "user-a", "A", NOW)
    await repo.expire_match(created.match_id, NOW)
    assert await repo.find_match_by_room_code(created.room_code) is None


# ---------------------------------------------------------------------------
# Public queue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_humans_pair_immediately_regardless_of_the_window():
    """A full table of humans is what the window is holding out FOR, so it does
    not wait once one exists."""
    repo = MemoryArenaRepository()
    mode = DemoMode()
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    b = await mm.join_queue(repo, mode, "user-b", NOW)
    match = await mm.try_match(repo, mode, b, {"user-a": "A", "user-b": "B"}, NOW)

    assert match is not None
    assert match.entry_path == ENTRY_PATH_PUBLIC_QUEUE
    assert match.rated is True
    seats = await repo.get_seats(match.match_id)
    assert sorted(s.occupant_sub for s in seats) == ["user-a", "user-b"]
    assert all(not s.is_bot for s in seats)


@pytest.mark.asyncio
async def test_no_bot_fill_while_the_human_window_is_open():
    repo = MemoryArenaRepository()
    mode = DemoMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    entry = await mm.join_queue(repo, mode, "user-a", NOW)
    assert await mm.try_match(repo, mode, entry, {}, NOW + timedelta(seconds=29)) is None
    assert entry.prefers_humans_at(NOW + timedelta(seconds=29))


@pytest.mark.asyncio
async def test_bots_fill_once_the_window_lapses_and_the_match_is_still_rated():
    """The deliberate product call: waiting out the window must not be a way to
    farm unrated practice while occupying a real queue slot."""
    repo = MemoryArenaRepository()
    mode = DemoMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    entry = await mm.join_queue(repo, mode, "user-a", NOW)
    late = NOW + timedelta(seconds=31)
    match = await mm.try_match(repo, mode, entry, {"user-a": "A"}, late)

    assert match is not None
    assert match.rated is True
    seats = await repo.get_seats(match.match_id)
    assert [s.is_bot for s in seats] == [False, True]
    assert seats[1].bot_rating is not None  # pinned at seat time


@pytest.mark.asyncio
async def test_humans_are_seated_before_bots_when_the_window_lapses():
    """A bot must never displace a person who was available."""
    repo = MemoryArenaRepository()
    mode = ThreeSeatMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    await mm.join_queue(repo, mode, "user-b", NOW)
    late = NOW + timedelta(seconds=31)
    match = await mm.try_match(repo, mode, a, {"user-a": "A", "user-b": "B"}, late)

    seats = await repo.get_seats(match.match_id)
    assert [s.is_bot for s in seats] == [False, False, True]


@pytest.mark.asyncio
async def test_a_second_queue_entry_for_one_mode_is_refused():
    repo = MemoryArenaRepository()
    mode = DemoMode()
    await mm.join_queue(repo, mode, "user-a", NOW)
    with pytest.raises(ActiveQueueEntryExists):
        await mm.join_queue(repo, mode, "user-a", NOW)


@pytest.mark.asyncio
async def test_stale_queue_entries_are_swept_on_join():
    repo = MemoryArenaRepository()
    mode = DemoMode()
    await mm.join_queue(repo, mode, "ghost", NOW)
    # Eleven minutes later the ghost's entry is past its TTL; a new joiner's
    # own request is what cleans it.
    late = NOW + timedelta(minutes=11)
    await mm.join_queue(repo, mode, "user-b", late)
    assert await repo.get_queue_entry("ghost", mode.mode) is None


@pytest.mark.asyncio
async def test_only_one_matchmaker_can_claim_a_set_of_entries():
    repo = MemoryArenaRepository()
    mode = DemoMode()
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    b = await mm.join_queue(repo, mode, "user-b", NOW)
    names = {"user-a": "A", "user-b": "B"}
    first, second = await asyncio.gather(
        mm.try_match(repo, mode, a, names, NOW),
        mm.try_match(repo, mode, b, names, NOW),
    )
    created = [m for m in (first, second) if m is not None]
    assert len(created) == 1, "two matchmakers must not both create a match"


@pytest.mark.asyncio
async def test_cancelling_removes_the_entry():
    repo = MemoryArenaRepository()
    mode = DemoMode()
    await mm.join_queue(repo, mode, "user-a", NOW)
    assert await repo.cancel_queue_entry("user-a", mode.mode) is True
    assert await repo.get_queue_entry("user-a", mode.mode) is None
    assert await repo.cancel_queue_entry("user-a", mode.mode) is False


# ---------------------------------------------------------------------------
# Bots
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_bot_only_ever_receives_a_seat_view():
    """The structural anti-cheat guarantee, asserted rather than assumed: the
    only argument a policy is handed is a `SeatView`, and a `SeatView` carries
    no path to the authoritative state."""
    captured: list[object] = []

    class SpyBot:
        bot_id = "spy_v1"
        policy_version = "spy_v1"
        rating = 1000.0

        async def choose(self, view, rng):
            captured.append(view)
            return bot_service.BotCommand(command_type="play")

    repo = MemoryArenaRepository()
    mode = DemoMode()
    spy = SpyBot()
    bot_service.registry.register(spy, for_modes=(mode.mode,))
    match = await mm.start_practice(repo, mode, "user-a", "A", NOW)
    seats = await repo.get_seats(match.match_id)
    bot_seat = next(s for s in seats if s.is_bot)

    await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, match, bot_seat, spy, NOW, turn_seq=0
    )

    assert len(captured) == 1
    view = captured[0]
    assert isinstance(view, SeatView)
    fields = set(view.__dataclass_fields__)
    assert not fields & {"match", "snapshot", "seats", "repo", "conn"}


@pytest.mark.asyncio
async def test_a_bot_cannot_see_the_opposing_seats_hidden_value():
    """The projection half of the guarantee.

    The two secrets are set EXPLICITLY rather than drawn from the mode's RNG.
    An earlier version of this test dealt them randomly and had to tolerate the
    two values coinciding, which made the leak assertion escapable -- a test
    that can pass without proving anything is worse than no test. Distinct,
    unmistakable sentinels make the assertion exact.
    """
    repo = MemoryArenaRepository()
    mode = DemoMode()
    match = await mm.start_practice(repo, mode, "user-a", "A", NOW)
    seats = await repo.get_seats(match.match_id)

    match.snapshot = {
        "turn": 0,
        "hidden": {"0": "SEAT-ZERO-SECRET", "1": "SEAT-ONE-SECRET"},
        "public": {"played": []},
    }

    public, private, _legal = mode.project(match, tuple(seats), seat_index=1)
    assert private["my_hidden"] == "SEAT-ONE-SECRET"
    # Seat 0's secret must appear nowhere the seat-1 bot can reach.
    blob = repr(public) + repr(private)
    assert "SEAT-ZERO-SECRET" not in blob

    # And symmetrically, so the test cannot pass by the projection simply
    # dropping the `hidden` key for everyone.
    public0, private0, _ = mode.project(match, tuple(seats), seat_index=0)
    assert private0["my_hidden"] == "SEAT-ZERO-SECRET"
    assert "SEAT-ONE-SECRET" not in repr(public0) + repr(private0)


@pytest.mark.asyncio
async def test_the_full_seat_view_handed_to_a_bot_contains_no_opposing_secret():
    """End-to-end version of the test above: not the projection in isolation,
    but the actual `SeatView` object the driver builds and hands to a policy."""
    captured: list[SeatView] = []

    class SpyBot:
        bot_id = "spy2_v1"
        policy_version = "spy2_v1"
        rating = 1000.0

        async def choose(self, view, rng):
            captured.append(view)
            return bot_service.BotCommand(command_type="play")

    repo = MemoryArenaRepository()
    mode = DemoMode()
    spy = SpyBot()
    bot_service.registry.register(spy, for_modes=(mode.mode,))
    match = await mm.start_practice(repo, mode, "user-a", "A", NOW)

    # Stamp unmistakable sentinels into the stored snapshot.
    stored = await repo.get_match(match.match_id)
    stored.snapshot = {
        "turn": 0,
        "hidden": {"0": "HUMAN-SECRET", "1": "BOT-SECRET"},
        "public": {"played": []},
    }
    repo._matches[match.match_id] = stored  # direct store write: test seam

    seats = await repo.get_seats(match.match_id)
    bot_seat = next(s for s in seats if s.is_bot)
    await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, stored, bot_seat, spy, NOW, turn_seq=0
    )

    assert len(captured) == 1
    blob = repr(captured[0])
    assert "BOT-SECRET" in blob, "the bot must see its own private state"
    assert "HUMAN-SECRET" not in blob, "the bot must not see the human's"


@pytest.mark.asyncio
async def test_a_bot_moves_at_most_once_per_turn():
    """The derived idempotency key: two pollers both noticing it is the bot's
    turn must not make the bot move twice."""
    repo = MemoryArenaRepository()
    mode = DemoMode()
    bot = bot_service.RandomLegalBot()
    bot_service.registry.register(bot, for_modes=(mode.mode,))
    match = await mm.start_practice(repo, mode, "user-a", "A", NOW)
    seats = await repo.get_seats(match.match_id)
    bot_seat = next(s for s in seats if s.is_bot)

    a = await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, match, bot_seat, bot, NOW, turn_seq=0
    )
    b = await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, match, bot_seat, bot, NOW, turn_seq=0
    )
    assert a.accepted and not a.replayed
    assert b.replayed


@pytest.mark.asyncio
async def test_a_crashing_bot_does_not_wedge_the_match():
    """The turn stays open and the clock forfeits it -- a defined outcome
    rather than a hang."""

    class BrokenBot:
        bot_id = "broken_v1"
        policy_version = "broken_v1"
        rating = 1000.0

        async def choose(self, view, rng):
            raise RuntimeError("policy exploded")

    repo = MemoryArenaRepository()
    mode = DemoMode()
    broken = BrokenBot()
    bot_service.registry.register(broken, for_modes=(mode.mode,))
    match = await mm.start_practice(repo, mode, "user-a", "A", NOW)
    seats = await repo.get_seats(match.match_id)
    bot_seat = next(s for s in seats if s.is_bot)

    assert await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, match, bot_seat, broken, NOW, turn_seq=0
    ) is None
    assert (await repo.get_match(match.match_id)).status == MATCH_STATUS_ACTIVE
    assert await repo.get_open_turn(match.match_id) is not None


@pytest.mark.asyncio
async def test_bot_choices_are_deterministic_for_one_seed_and_turn():
    """A match must replay identically, so the RNG is derived from the seed and
    a named stream rather than a global source."""
    bot = bot_service.RandomLegalBot()
    view = SeatView(
        match_id="m", mode="demo_mode", seat_index=1, seat_count=2,
        state_version=0, status=MATCH_STATUS_ACTIVE,
        legal_commands=("a", "b", "c", "d", "e"),
    )
    first = [
        (await bot.choose(view, mode_rng(999, f"bot:1:{t}"))).command_type
        for t in range(8)
    ]
    second = [
        (await bot.choose(view, mode_rng(999, f"bot:1:{t}"))).command_type
        for t in range(8)
    ]
    assert first == second
    # A different stream must not reproduce the same sequence, or the named
    # streams are not actually independent.
    other = [
        (await bot.choose(view, mode_rng(999, f"bot:0:{t}"))).command_type
        for t in range(8)
    ]
    assert other != first


def test_the_default_bot_falls_back_rather_than_raising():
    """A mode with no registered policy must still be playable against a
    filler; a hard failure would surface as 'matchmaking is broken'."""
    assert bot_service.registry.default_for("a_mode_nobody_registered") is not None


def test_registering_two_bots_under_one_id_is_refused():
    a = bot_service.RandomLegalBot(bot_id="dup_v1")
    b = bot_service.RandomLegalBot(bot_id="dup_v1")
    bot_service.registry.register(a)
    with pytest.raises(ValueError):
        bot_service.registry.register(b)


# ---------------------------------------------------------------------------
# Mode registry
# ---------------------------------------------------------------------------


def test_registering_two_modes_under_one_name_is_refused():
    """Silently taking the last writer would make which rules ran depend on
    import order."""
    reg = ModeRegistry()
    reg.register(DemoMode())
    with pytest.raises(ValueError):
        reg.register(DemoMode())


def test_demo_mode_satisfies_the_arena_mode_protocol():
    assert isinstance(DemoMode(), ArenaMode)


def test_an_unknown_mode_raises_a_distinguishable_error():
    from app.services.arena.modes import ModeNotRegistered

    reg = ModeRegistry()
    with pytest.raises(ModeNotRegistered):
        reg.get("nope")
