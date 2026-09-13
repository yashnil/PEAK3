"""The additive foundation hooks the multi-year-window modes rely on.

Every hook here is OPT-IN and defaults to the behaviour the foundation already
had. Each test below asserts BOTH halves: what a mode that declares the hook
gets, and that a mode without it is unchanged. The existing suites
(`test_arena_foundation.py`, `test_arena_practice_e2e.py`, ...) are the other
half of the regression evidence -- none of them declares these hooks.

  * `simultaneous_action_grace(phase)` -- clock grace on a seatless DECISION turn
  * `simultaneous_bot_think_seconds(seed, seat, turn_seq)` -- per-seat bot pacing
    on a simultaneous turn, with a fresh match per bot and a version-scoped key
  * `bot_seat_rating(seed, seat_index)` -- a tier's own pinned rating
  * per-mode rollout flags on readiness and every entry path
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import Settings, settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
    TURN_RESOLUTION_ACTION,
    TURN_RESOLUTION_TIMEOUT,
    ArenaMatch,
    ArenaSeat,
    BotCommand,
    CommandRequest,
    ReducerInput,
    ReducerOutput,
    TurnDraft,
)
from app.services.arena import bots as bot_service
from app.services.arena import clock
from app.services.arena.modes import registry as mode_registry
from app.services.three_man_weave import mode as tmw_module
from app.services.twenty_dollar import mode as td_module

NOW = datetime(2026, 9, 13, 12, 0, 0, tzinfo=timezone.utc)
DECIDE = "decide"
DECISION_SECONDS = 12.0


# ---------------------------------------------------------------------------
# A minimal four-seat simultaneous-decision mode
# ---------------------------------------------------------------------------


class SimultaneousMode:
    """Every seat locks once per turn; the turn resolves when all have."""

    def __init__(self, name: str = "test_simul", *, hooks: bool = True, think=None, rating=None):
        self._name = name
        self._hooks = hooks
        self._think = think or {1: 2.0, 2: 4.0, 3: 6.0}
        if hooks:
            self.simultaneous_action_grace = lambda phase: phase == DECIDE
            self.simultaneous_bot_think_seconds = lambda seed, seat, turn_seq: self._think[seat]
        if rating is not None:
            self.bot_seat_rating = rating

    mode_version = "test_simul_v1"
    seat_count = 4
    turn_seconds = DECISION_SECONDS

    @property
    def mode(self) -> str:
        return self._name

    def initial_phase(self) -> str:
        return DECIDE

    def initial_turn_seat(self, snapshot):
        return None

    def phase_accepts_action(self, phase: str) -> bool:
        return phase == DECIDE

    def initial_snapshot(self, seed, seats):
        return {"locked": {}}

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        locked = dict(data.match.snapshot.get("locked", {}))
        if data.command.command_type == COMMAND_TYPE_TIMEOUT:
            return ReducerOutput(accepted=True, snapshot={"locked": locked, "timed_out": True},
                                 resolve_turn=TURN_RESOLUTION_TIMEOUT)
        seat = data.command.actor_seat_index
        if str(seat) in locked:
            return ReducerOutput(accepted=False, rejection_code="already_locked", rejection_message="Locked.")
        locked[str(seat)] = data.now.isoformat()
        done = len(locked) == data.match.seat_count
        return ReducerOutput(
            accepted=True,
            snapshot={"locked": locked},
            resolve_turn=TURN_RESOLUTION_ACTION if done else None,
        )

    def project(self, match, seats, seat_index):
        locked = (match.snapshot or {}).get("locked", {})
        legal = () if str(seat_index) in locked else ("lock",)
        return {"locked": sorted(locked)}, {}, legal


class LockBot:
    bot_id = "test_simul_bot"
    policy_version = "test_simul_bot_v1"
    rating = 1200.0

    async def choose(self, view, rng):
        return BotCommand(command_type="lock", payload={}) if "lock" in view.legal_commands else None


#: ONE instance for the whole file: the bot registry refuses a second, different
#: object under an id it already holds.
LOCK_BOT = LockBot()


def _snapshot_bot_registry():
    return (dict(bot_service.registry._policies), dict(bot_service.registry._default_by_mode))


def _restore_bot_registry(saved) -> None:
    bot_service.registry._policies.clear()
    bot_service.registry._policies.update(saved[0])
    bot_service.registry._default_by_mode.clear()
    bot_service.registry._default_by_mode.update(saved[1])


def _seats(match_id: str) -> list[ArenaSeat]:
    seats = [ArenaSeat(match_id=match_id, seat_index=0, occupant_kind="human",
                       occupant_sub="user-a", display_name="Human")]
    for i in (1, 2, 3):
        seats.append(ArenaSeat(match_id=match_id, seat_index=i, occupant_kind="bot",
                               bot_id=LockBot.bot_id, bot_rating=1200.0, display_name=f"Bot {i}"))
    return seats


async def _simultaneous_match(repo: MemoryArenaRepository, mode: SimultaneousMode) -> ArenaMatch:
    m = ArenaMatch(
        match_id=str(uuid.uuid4()), mode=mode.mode, mode_version=mode.mode_version,
        model_version="peak3_v1", seat_count=4, entry_path="practice", rated=False,
        seed=99, created_by="user-a", expires_at=NOW + timedelta(hours=2),
        status=MATCH_STATUS_ACTIVE, created_at=NOW, updated_at=NOW, snapshot={"locked": {}},
    )
    await repo.create_match(m, _seats(m.match_id))
    await repo.apply_command(
        CommandRequest(match_id=m.match_id, idempotency_key="open-simul-0001",
                       command_type="__open__", actor_sub=None, issued_at=NOW),
        lambda d: ReducerOutput(
            accepted=True,
            open_turn=TurnDraft(phase=DECIDE, deadline_at=NOW + timedelta(seconds=DECISION_SECONDS), seat_index=None),
        ),
        NOW,
    )
    return await repo.get_match(m.match_id)


@pytest.fixture
def bot_registry():
    saved = _snapshot_bot_registry()
    bot_service.registry.register(LOCK_BOT, for_modes=("test_simul",))
    yield LOCK_BOT
    _restore_bot_registry(saved)


# ---------------------------------------------------------------------------
# Clock grace
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_simultaneous_decision_turn_gets_the_grace_when_the_mode_asks():
    repo = MemoryArenaRepository()
    mode = SimultaneousMode()
    m = await _simultaneous_match(repo, mode)
    inside_grace = NOW + timedelta(seconds=DECISION_SECONDS + clock.ACTION_GRACE_SECONDS - 0.5)
    assert await clock.enforce(repo, m.match_id, mode.reduce, inside_grace, mode=mode) is None
    past_grace = NOW + timedelta(seconds=DECISION_SECONDS + clock.ACTION_GRACE_SECONDS + 0.5)
    fired = await clock.enforce(repo, m.match_id, mode.reduce, past_grace, mode=mode)
    assert fired is not None and fired.accepted


@pytest.mark.asyncio
async def test_a_seatless_turn_without_the_hook_is_swept_at_its_deadline_exactly_as_before():
    repo = MemoryArenaRepository()
    mode = SimultaneousMode(hooks=False)
    m = await _simultaneous_match(repo, mode)
    just_past = NOW + timedelta(seconds=DECISION_SECONDS + 0.5)
    fired = await clock.enforce(repo, m.match_id, mode.reduce, just_past, mode=mode)
    assert fired is not None and fired.accepted
    # And a caller that passes no mode at all gets the same, old behaviour.
    m2 = await _simultaneous_match(repo, SimultaneousMode())
    fired2 = await clock.enforce(repo, m2.match_id, mode.reduce, just_past)
    assert fired2 is not None and fired2.accepted


# ---------------------------------------------------------------------------
# Simultaneous bot pacing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bots_lock_on_their_own_think_time_and_several_can_land_in_one_pass(bot_registry):
    repo = MemoryArenaRepository()
    mode = SimultaneousMode(think={1: 2.0, 2: 4.0, 3: 4.5})
    m = await _simultaneous_match(repo, mode)

    steps = await bot_service.drive_pending_bots(repo, mode, mode.reduce, m.match_id, NOW + timedelta(seconds=2.5))
    assert steps == 1
    assert sorted((await repo.get_match(m.match_id)).snapshot["locked"]) == ["1"]

    # Seats 2 and 3 are both due. Before the refetch fix the second bot in a
    # pass submitted the version read at the top of the loop and was refused.
    steps = await bot_service.drive_pending_bots(repo, mode, mode.reduce, m.match_id, NOW + timedelta(seconds=5.0))
    assert steps == 2
    assert sorted((await repo.get_match(m.match_id)).snapshot["locked"]) == ["1", "2", "3"]


@pytest.mark.asyncio
async def test_a_bot_that_lost_a_version_race_can_still_decide_in_the_same_turn(bot_registry):
    repo = MemoryArenaRepository()
    mode = SimultaneousMode(think={1: 2.0, 2: 2.0, 3: 2.0})
    stale = await _simultaneous_match(repo, mode)
    turn = await repo.get_open_turn(stale.match_id)
    at = NOW + timedelta(seconds=3)

    # The human locks first, bumping the version the bot is about to use.
    human = await repo.apply_command(
        CommandRequest(match_id=stale.match_id, idempotency_key="human-lock-0001", command_type="lock",
                       actor_sub="user-a", actor_seat_index=0,
                       expected_state_version=stale.state_version, issued_at=at),
        mode.reduce, at,
    )
    assert human.accepted
    seat1 = next(s for s in await repo.get_seats(stale.match_id) if s.seat_index == 1)
    lost = await bot_service.drive_bot_seat(
        repo, mode, mode.reduce, stale, seat1, bot_registry, at, turn.turn_seq,
        idempotency_suffix=f":v{stale.state_version}",
    )
    assert lost is not None and not lost.accepted and lost.rejection_code == "stale_state_version"

    steps = await bot_service.drive_pending_bots(repo, mode, mode.reduce, stale.match_id, at)
    assert steps == 3
    assert sorted((await repo.get_match(stale.match_id)).snapshot["locked"]) == ["0", "1", "2", "3"]


# ---------------------------------------------------------------------------
# Tier ratings
# ---------------------------------------------------------------------------


def test_bot_seat_rating_defaults_to_the_policy_and_honours_the_hook():
    policy = LockBot()
    assert bot_service.bot_seat_rating(SimultaneousMode(), 7, 1, policy) == policy.rating
    tiered = SimultaneousMode(rating=lambda seed, seat: 1000.0 + 100 * seat)
    assert bot_service.bot_seat_rating(tiered, 7, 3, policy) == 1300.0
    for broken in (lambda s, i: 0.0, lambda s, i: math.nan, lambda s, i: 1 / 0):
        assert bot_service.bot_seat_rating(SimultaneousMode(rating=broken), 7, 1, policy) == policy.rating

    assert bot_service.bot_seat("m", 1, policy).bot_rating == policy.rating
    assert bot_service.bot_seat("m", 1, policy, rating=1450.0).bot_rating == 1450.0


# ---------------------------------------------------------------------------
# Per-mode rollout flags
# ---------------------------------------------------------------------------


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture
def flagged_modes():
    saved = {
        name: getattr(settings, name)
        for name in ("ARENA_ENABLED", "ARENA_BOTS_ENABLED", "ARENA_ALPHA_ALLOWLIST",
                     "ARENA_PRIME_CUT_ENABLED", "ARENA_FIND_THE_PRIME_ENABLED")
    }
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_PRIME_CUT_ENABLED = False
    settings.ARENA_FIND_THE_PRIME_ENABLED = False

    snapshot_modes = {name: mode_registry.get(name) for name in mode_registry.names()}
    snapshot_bots = _snapshot_bot_registry()
    mode_registry.clear()
    mode_registry.register(tmw_module.mode)
    mode_registry.register(td_module.mode)
    fake_cut = SimultaneousMode("prime_cut")
    fake_prime = SimultaneousMode("find_the_prime")
    mode_registry.register(fake_cut)
    mode_registry.register(fake_prime)
    bot_service.registry.register(LOCK_BOT, for_modes=("prime_cut", "find_the_prime"))
    yield
    app.dependency_overrides.clear()
    mode_registry.clear()
    for mode in snapshot_modes.values():
        mode_registry.register(mode)
    _restore_bot_registry(snapshot_bots)
    for name, value in saved.items():
        setattr(settings, name, value)
    for attr in ("_matches", "_seats", "_events", "_turns", "_results", "_commands", "_queue", "_match_locks"):
        getattr(_memory_arena_repo, attr).clear()


def _served(client: TestClient) -> set[str]:
    body = client.get("/api/v1/arena/readiness").json()
    return {m["id"] for m in body["modes"]}


def test_a_disabled_mode_is_not_published_and_existing_modes_are(flagged_modes):
    client = _client_as("flag-user")
    served = _served(client)
    assert {"three_man_weave", "twenty_dollar"} <= served
    assert "prime_cut" not in served and "find_the_prime" not in served

    settings.ARENA_PRIME_CUT_ENABLED = True
    served = _served(client)
    assert "prime_cut" in served and "find_the_prime" not in served


def test_every_entry_path_refuses_a_disabled_mode(flagged_modes):
    client = _client_as("flag-user-2")
    settings.ARENA_PUBLIC_QUEUE_ENABLED = True
    try:
        for method, path, body in (
            ("post", "/api/v1/arena/matches/practice", {"mode": "find_the_prime"}),
            ("post", "/api/v1/arena/matches/private", {"mode": "find_the_prime"}),
            ("post", "/api/v1/arena/queue/find_the_prime/join", None),
            ("get", "/api/v1/arena/queue/find_the_prime/status", None),
            ("post", "/api/v1/arena/queue/find_the_prime/fill-now", None),
        ):
            response = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
            assert response.status_code == 403, (path, response.status_code, response.text)
            assert response.json()["detail"]["error_code"] == "mode_not_enabled"
    finally:
        settings.ARENA_PUBLIC_QUEUE_ENABLED = False


def test_switching_a_mode_off_never_strands_a_match_in_progress(flagged_modes):
    client = _client_as("flag-user-3")
    settings.ARENA_PRIME_CUT_ENABLED = True
    started = client.post("/api/v1/arena/matches/practice", json={"mode": "prime_cut"})
    assert started.status_code == 200, started.text
    match_id = started.json()["match_id"]

    settings.ARENA_PRIME_CUT_ENABLED = False
    assert client.get(f"/api/v1/arena/matches/{match_id}").status_code == 200
    assert client.post("/api/v1/arena/matches/practice", json={"mode": "prime_cut"}).status_code == 403


def test_the_existing_modes_have_no_switch(flagged_modes):
    client = _client_as("flag-user-4")
    for mode in ("three_man_weave", "twenty_dollar"):
        response = client.post("/api/v1/arena/matches/practice", json={"mode": mode})
        assert response.status_code == 200, (mode, response.text)


def test_a_mode_switch_without_the_arena_refuses_to_start():
    for flag in ("ARENA_PRIME_CUT_ENABLED", "ARENA_FIND_THE_PRIME_ENABLED"):
        with pytest.raises(ValueError, match=flag):
            Settings(DEBUG=True, ARENA_ENABLED=False, **{flag: True})
    ok = Settings(DEBUG=True, ARENA_ENABLED=True, ARENA_READINESS_LEVEL="internal_dev",
                  ARENA_PRIME_CUT_ENABLED=True, ARENA_FIND_THE_PRIME_ENABLED=True)
    assert ok.ARENA_PRIME_CUT_ENABLED and ok.ARENA_FIND_THE_PRIME_ENABLED
