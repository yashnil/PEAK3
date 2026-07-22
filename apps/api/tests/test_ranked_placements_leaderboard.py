"""Ranked placement and leaderboard tests (spec V.31-38), using the real
FastAPI app through TestClient with dependency_overrides for auth — the
same pattern as tests/test_phase3_auth.py.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import (
    _memory_ranked_matchmaking_repo,
    _memory_ranked_rating_repo,
)
from app.main import app


def _auth(sub: str) -> AuthSubject:
    return AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=False, raw_claims={})


@pytest.fixture(autouse=True)
def _ranked_enabled_and_isolated_repos():
    original = (
        settings.RANKED_ENABLED, settings.RANKED_MATCHMAKING_ENABLED,
        settings.RANKED_RATING_WRITES_ENABLED, settings.RANKED_PUBLIC_LEADERBOARD_ENABLED,
        settings.RANKED_ALPHA_ALLOWLIST,
    )
    settings.RANKED_ENABLED = True
    settings.RANKED_MATCHMAKING_ENABLED = True
    settings.RANKED_RATING_WRITES_ENABLED = True
    settings.RANKED_PUBLIC_LEADERBOARD_ENABLED = True
    settings.RANKED_ALPHA_ALLOWLIST = []

    # Isolate module-level memory singletons between tests.
    _memory_ranked_matchmaking_repo._queue_entries.clear()
    _memory_ranked_matchmaking_repo._matches.clear()
    _memory_ranked_matchmaking_repo._participants.clear()
    _memory_ranked_matchmaking_repo._submissions.clear()
    _memory_ranked_matchmaking_repo._opponent_history.clear()
    _memory_ranked_rating_repo._periods.clear()
    _memory_ranked_rating_repo._settlements.clear()
    _memory_ranked_rating_repo._ledger.clear()
    _memory_ranked_rating_repo._queue_ratings.clear()
    _memory_ranked_rating_repo._placement_states.clear()

    yield

    (
        settings.RANKED_ENABLED, settings.RANKED_MATCHMAKING_ENABLED,
        settings.RANKED_RATING_WRITES_ENABLED, settings.RANKED_PUBLIC_LEADERBOARD_ENABLED,
        settings.RANKED_ALPHA_ALLOWLIST,
    ) = original
    app.dependency_overrides.clear()


def _client_as(sub: str) -> TestClient:
    subject = _auth(sub)
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


def _solve_round_plan(rounds_raw) -> dict[int, tuple[str, str]]:
    """Backtracking search returning one (card_id, role) choice per round
    that fills all 5 roles — mirrors nba_peak.lineup.board._can_fill_all_roles,
    but returns the actual assignment instead of just True/False.

    The board is only guaranteed feasible via *some* full assignment (found
    by this backtracking search over all 5 rounds at once); a player who can
    only see one round at a time cannot always find that assignment via a
    purely greedy round-by-round heuristic. Tests are allowed this oracle
    view of the whole board precisely because they need a reliably
    completable script to drive many matches through the hidden-information
    API without flakiness — a real player's greedy/heuristic experience
    (and its occasional dead-ends) is exactly what
    scripts/ranked_validation/slice_audit.py measures instead of asserting on.
    """
    n_rounds = len(rounds_raw)
    roles_all = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
    plan: dict[int, tuple[str, str]] = {}

    def search(r_idx: int, filled: set[str]) -> bool:
        if r_idx == n_rounds:
            return set(roles_all) == filled
        for card in rounds_raw[r_idx]:
            for role in card.eligible_roles:
                if role not in filled:
                    plan[r_idx] = (card.peak_window_id, role)
                    if search(r_idx + 1, filled | {role}):
                        return True
                    del plan[r_idx]
        return False

    assert search(0, set()), "board reported feasible but no assignment found"
    return plan


def _play_full_game(client: TestClient, match_id: str, matchmaking_repo) -> dict:
    """Play a full ranked game by precomputing a guaranteed-valid round plan
    from the match's actual board (test-only oracle access), then executing
    it action-by-action through the real hidden-information API.
    """
    import asyncio

    from app.services.ranked.board import board_from_dict

    match = asyncio.run(matchmaking_repo.get_match(match_id))
    board = board_from_dict(match.board_snapshot)
    plan = _solve_round_plan([r.offers for r in board.rounds])

    r = client.post(f"/api/v1/ranked/matches/{match_id}/game")
    state = r.json()
    while state["status"] != "draft_complete":
        card_id, role = plan[state["current_round"] - 1]
        r = client.post(
            f"/api/v1/ranked/matches/{match_id}/actions",
            json={"action": "select_card", "card_id": card_id, "role": role, "idempotency_key": str(uuid.uuid4())},
        )
        state = r.json()
    return state


def _play_one_match(mode: str, sub_a: str, sub_b: str) -> None:
    client_a = _client_as(sub_a)
    r = client_a.post(f"/api/v1/ranked/queues/{mode}/join")
    client_b = _client_as(sub_b)
    r = client_b.post(f"/api/v1/ranked/queues/{mode}/join")
    match_id = r.json()["match_id"]
    assert match_id is not None

    _play_full_game(_client_as(sub_a), match_id, _memory_ranked_matchmaking_repo)
    _play_full_game(_client_as(sub_b), match_id, _memory_ranked_matchmaking_repo)


def test_seven_valid_matches_establish_the_queue():
    for i in range(7):
        _play_one_match("apex_1y", "player_x", f"opponent_{i}")

    client = _client_as("player_x")
    r = client.get("/api/v1/ranked/queues/apex_1y/placement")
    body = r.json()
    assert body["valid_matches_completed"] == 7
    assert body["established"] is True

    r = client.get("/api/v1/ranked/queues/apex_1y/rating")
    body = r.json()
    assert body["established"] is True
    assert body["rating"] is not None


def test_placement_progress_shown_before_established():
    _play_one_match("prime_3y", "newbie", "opp1")
    client = _client_as("newbie")
    r = client.get("/api/v1/ranked/queues/prime_3y/rating")
    body = r.json()
    assert body["established"] is False
    assert body["rating"] is None  # exact rating hidden during placements
    assert body["uncertainty_label"] == "still in placements"


def test_leaderboard_excludes_provisional_and_includes_established():
    for i in range(7):
        _play_one_match("apex_1y", "established_player", f"filler_{i}")
    _play_one_match("apex_1y", "provisional_player", "another_filler")

    client = _client_as("established_player")
    r = client.get("/api/v1/ranked/queues/apex_1y/leaderboard")
    body = r.json()
    subs = {e["owner_sub"] for e in body["entries"]}
    assert "established_player" in subs
    assert "provisional_player" not in subs


def test_leaderboard_respects_public_flag():
    settings.RANKED_PUBLIC_LEADERBOARD_ENABLED = False
    client = _client_as("anyone")
    r = client.get("/api/v1/ranked/queues/apex_1y/leaderboard")
    body = r.json()
    assert body["enabled"] is False
    assert body["entries"] == []


def test_non_participant_cannot_access_private_match():
    client_a = _client_as("owner1")
    r = client_a.post("/api/v1/ranked/queues/apex_1y/join")
    client_b = _client_as("owner2")
    r = client_b.post("/api/v1/ranked/queues/apex_1y/join")
    match_id = r.json()["match_id"]

    client_stranger = _client_as("stranger")
    r = client_stranger.get(f"/api/v1/ranked/matches/{match_id}")
    assert r.status_code == 403


def test_division_assignment_uses_configured_version():
    from app.services.ranked.versions import DIVISION_VERSION, division_for_rating
    assert DIVISION_VERSION.endswith("_provisional")
    assert division_for_rating(500.0, valid_matches=50) == "Prospect"
    assert division_for_rating(2200.0, valid_matches=50) == "Legend"
    # Legend suppressed without enough valid matches, per configured minimum.
    assert division_for_rating(2200.0, valid_matches=1) == "MVP"


def test_cursor_pagination_is_stable():
    for i in range(3):
        _play_one_match("foundation_5y", f"lb_player_{i}", f"lb_opp_{i}")
    # each of the 6 users has 1 valid match -> none established yet with default
    # 7-match requirement; use direct repo access to force-establish for a
    # deterministic pagination check instead of playing 7 rounds x 6 users.
    import asyncio
    from app.services.ranked.versions import GLICKO2_ALGORITHM_VERSION

    async def _force_establish():
        for i in range(6):
            sub = f"lb_player_{i}" if i < 3 else f"lb_opp_{i - 3}"
            rating = await _memory_ranked_rating_repo.get_queue_rating(sub, "foundation_5y")
            rating.rating = 1500.0 + i * 10
            rating.established = True
            await _memory_ranked_rating_repo.update_queue_rating(rating)
            placement = await _memory_ranked_rating_repo.get_placement_state(sub, "foundation_5y")
            placement.established = True
            placement.valid_matches_completed = 7
            await _memory_ranked_rating_repo.update_placement_state(placement)

    asyncio.run(_force_establish())

    client = _client_as("viewer")
    r1 = client.get("/api/v1/ranked/queues/foundation_5y/leaderboard?limit=2")
    page1 = r1.json()
    assert len(page1["entries"]) == 2
    cursor = page1["next_cursor"]
    assert cursor is not None

    r2 = client.get(f"/api/v1/ranked/queues/foundation_5y/leaderboard?limit=2&cursor={cursor}")
    page2 = r2.json()
    page1_subs = {e["owner_sub"] for e in page1["entries"]}
    page2_subs = {e["owner_sub"] for e in page2["entries"]}
    assert page1_subs.isdisjoint(page2_subs)
