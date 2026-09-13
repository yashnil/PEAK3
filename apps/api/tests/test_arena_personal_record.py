"""A player's own record in a mode: streaks, bests, PB for one match.

The arithmetic is a pure function (`services/arena/personal.py`) and is tested
directly with synthetic rows. One route test then proves the endpoint reads the
caller's own persisted results and nobody else's.
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
from app.services.arena import clock
from app.services.arena.modes import registry as mode_registry
from app.services.arena.personal import PersonalResultRow, compute_record
from app.services.prime_cut import mode as pc_module


def _row(match_id: str, outcome: str, score: float, placement: int = 1, rated: bool = False, **detail) -> PersonalResultRow:
    return PersonalResultRow(match_id=match_id, placement=placement, outcome=outcome, score=score,
                             rated=rated, seat_count=4, detail=detail)


def test_win_streaks_count_outright_wins_and_a_shared_first_ends_one():
    rows = [
        _row("a", "win", 60), _row("b", "win", 70), _row("c", "draw", 80),
        _row("d", "win", 50), _row("e", "win", 55), _row("f", "win", 40),
    ]
    record = compute_record(rows)
    assert record.matches_played == 6 and record.wins == 5
    assert record.current_win_streak == 3 and record.longest_win_streak == 3
    assert record.best_score == 80


def test_a_loss_resets_the_current_streak_but_not_the_longest():
    record = compute_record([_row("a", "win", 1), _row("b", "win", 2), _row("c", "loss", 3, placement=3)])
    assert record.current_win_streak == 0 and record.longest_win_streak == 2
    assert record.podiums == 2  # placement 3 of 4 is not a podium


def test_personal_best_is_judged_against_matches_before_this_one():
    rows = [_row("a", "loss", 70, 2), _row("b", "loss", 65, 3), _row("c", "win", 72), _row("d", "loss", 71, 2)]
    first = compute_record(rows, match_id="a")
    assert first.is_personal_best and first.previous_best_score is None
    worse = compute_record(rows, match_id="b")
    assert not worse.is_personal_best and worse.previous_best_score == 70
    better = compute_record(rows, match_id="c")
    assert better.is_personal_best and better.previous_best_score == 70 and better.streak_after_match == 1
    after = compute_record(rows, match_id="d")
    assert not after.is_personal_best and after.previous_best_score == 72


def test_detail_bests_skip_missing_or_non_numeric_values():
    rows = [_row("a", "win", 1, heat_2y=80.0), _row("b", "win", 1, heat_2y=None), _row("c", "win", 1, heat_2y=91.5, heat_3y="x")]
    record = compute_record(rows, detail_keys=("heat_2y", "heat_3y"))
    assert record.bests == {"heat_2y": 91.5}


def test_rated_matches_are_counted_separately():
    record = compute_record([_row("a", "win", 1, rated=True), _row("b", "win", 1)])
    assert record.rated_matches == 1 and record.matches_played == 2


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


def _client_as(sub: str) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


@pytest.fixture(autouse=True)
def _arena():
    saved = {n: getattr(settings, n) for n in ("ARENA_ENABLED", "ARENA_BOTS_ENABLED", "ARENA_ALPHA_ALLOWLIST", "ARENA_PRIME_CUT_ENABLED")}
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_PRIME_CUT_ENABLED = True
    mode_registry.register(pc_module.mode)
    bot_service.registry.register(pc_module.bot, for_modes=("prime_cut",))
    for attr in ("_matches", "_seats", "_events", "_turns", "_results", "_commands", "_queue", "_match_locks"):
        getattr(_memory_arena_repo, attr).clear()
    yield
    app.dependency_overrides.clear()
    for n, v in saved.items():
        setattr(settings, n, v)


def _conceded_match(client: TestClient) -> str:
    view = client.post("/api/v1/arena/matches/practice", json={"mode": "prime_cut"}).json()
    match_id = view["match_id"]
    out = client.post(
        f"/api/v1/arena/matches/{match_id}/commands",
        json={"command_type": "pc_forfeit", "payload": {}, "expected_state_version": view["state_version"],
              "idempotency_key": f"forfeit-{match_id}"[:64]},
    ).json()
    assert out["accepted"] and out["match"]["status"] == "completed"
    return match_id


def test_the_route_reports_only_the_callers_own_completed_matches():
    alice = _client_as("record-alice")
    first = _conceded_match(alice)
    second = _conceded_match(alice)
    body = alice.get(f"/api/v1/arena/modes/prime_cut/me?match_id={second}").json()
    assert body["mode"] == "prime_cut"
    assert body["matches_played"] == 2 and body["wins"] == 0
    assert body["current_win_streak"] == 0 and body["match_found"] is True
    assert body["ratings_enabled"] is False and body["match_rating_change"] is None

    bob = _client_as("record-bob")
    other = bob.get(f"/api/v1/arena/modes/prime_cut/me?match_id={first}").json()
    assert other["matches_played"] == 0 and other["match_found"] is False


def test_the_route_404s_an_unknown_mode():
    assert _client_as("record-carol").get("/api/v1/arena/modes/not_a_mode/me").status_code == 404
