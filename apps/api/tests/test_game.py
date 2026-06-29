"""Tests for game endpoints (daily, endless, answer)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Daily game
# ---------------------------------------------------------------------------

def test_daily_game_returns_10_duels(client: TestClient) -> None:
    resp = client.get("/api/v1/game/daily?years=1&date=2026-06-28")
    assert resp.status_code == 200
    body = resp.json()
    assert body["duel_count"] == 10
    assert len(body["duels"]) == 10
    assert "session_token" in body
    assert body["session_token"]


def test_daily_game_deterministic(client: TestClient) -> None:
    """Same date + years should always produce the same challenge."""
    resp1 = client.get("/api/v1/game/daily?years=1&date=2026-06-15")
    resp2 = client.get("/api/v1/game/daily?years=1&date=2026-06-15")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["duels"] == resp2.json()["duels"]


def test_daily_game_different_dates_differ(client: TestClient) -> None:
    resp1 = client.get("/api/v1/game/daily?years=1&date=2026-06-01")
    resp2 = client.get("/api/v1/game/daily?years=1&date=2026-07-01")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    ids1 = [d["id"] for d in resp1.json()["duels"]]
    ids2 = [d["id"] for d in resp2.json()["duels"]]
    assert ids1 != ids2


def test_daily_game_invalid_years(client: TestClient) -> None:
    resp = client.get("/api/v1/game/daily?years=4&date=2026-06-28")
    assert resp.status_code == 422


def test_daily_game_no_self_matchups(client: TestClient) -> None:
    resp = client.get("/api/v1/game/daily?years=1&date=2026-06-28")
    assert resp.status_code == 200
    for duel in resp.json()["duels"]:
        assert duel["left"]["player_slug"] != duel["right"]["player_slug"]


def test_daily_game_no_duplicate_pairs(client: TestClient) -> None:
    resp = client.get("/api/v1/game/daily?years=1&date=2026-06-28")
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["duels"]]
    assert len(ids) == len(set(ids))


def test_daily_game_same_duration(client: TestClient) -> None:
    for years in [1, 2, 3, 5]:
        resp = client.get(f"/api/v1/game/daily?years={years}&date=2026-06-28")
        assert resp.status_code == 200
        for duel in resp.json()["duels"]:
            assert duel["left"]["duration_years"] == years
            assert duel["right"]["duration_years"] == years


def test_daily_game_no_scores_in_public_payload(client: TestClient) -> None:
    resp = client.get("/api/v1/game/daily?years=1&date=2026-06-28")
    assert resp.status_code == 200
    for duel in resp.json()["duels"]:
        for side in ("left", "right"):
            peak = duel[side]
            assert "prime_index" not in peak
            assert "prime_score" not in peak
            assert "rank" not in peak
            assert "components" not in peak


# ---------------------------------------------------------------------------
# Endless game
# ---------------------------------------------------------------------------

def test_endless_game_with_explicit_seed_is_deterministic(client: TestClient) -> None:
    resp1 = client.get("/api/v1/game/endless?years=1&seed=42")
    resp2 = client.get("/api/v1/game/endless?years=1&seed=42")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["duels"] == resp2.json()["duels"]


def test_endless_game_no_seed_generates_one(client: TestClient) -> None:
    resp = client.get("/api/v1/game/endless?years=1")
    assert resp.status_code == 200
    assert "seed" in resp.json()
    assert isinstance(resp.json()["seed"], int)


def test_endless_game_count_respected(client: TestClient) -> None:
    resp = client.get("/api/v1/game/endless?years=1&seed=1&count=5")
    assert resp.status_code == 200
    body = resp.json()
    assert body["duel_count"] == 5
    assert len(body["duels"]) == 5


def test_endless_game_count_max_50(client: TestClient) -> None:
    resp = client.get("/api/v1/game/endless?years=1&seed=1&count=51")
    assert resp.status_code == 422


def test_endless_game_no_self_matchups(client: TestClient) -> None:
    resp = client.get("/api/v1/game/endless?years=1&seed=99")
    assert resp.status_code == 200
    for duel in resp.json()["duels"]:
        assert duel["left"]["player_slug"] != duel["right"]["player_slug"]


def test_endless_game_no_duplicate_pairs(client: TestClient) -> None:
    resp = client.get("/api/v1/game/endless?years=1&seed=99")
    assert resp.status_code == 200
    ids = [d["id"] for d in resp.json()["duels"]]
    assert len(ids) == len(set(ids))


# ---------------------------------------------------------------------------
# Answer endpoint
# ---------------------------------------------------------------------------

def _get_daily_session(client: TestClient, years: int = 1) -> tuple[str, list[dict]]:
    """Helper — returns (session_token, duels list)."""
    resp = client.get(f"/api/v1/game/daily?years={years}&date=2026-06-28")
    assert resp.status_code == 200
    body = resp.json()
    return body["session_token"], body["duels"]


def test_answer_correct_selection(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    duel = duels[0]

    # We don't know the right answer from the public payload, so try left first
    for selected in (duel["left"]["peak_id"], duel["right"]["peak_id"]):
        resp = client.post(
            "/api/v1/game/answer",
            json={
                "session_token": token,
                "duel_id": duel["id"],
                "selected_peak_id": selected,
                "elapsed_ms": 4000,
                "current_streak": 0,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "correct" in body
        assert isinstance(body["correct"], bool)
        if body["correct"]:
            assert body["arena_points_awarded"] > 0
            assert body["updated_streak"] == 1
        else:
            assert body["arena_points_awarded"] == 0
            assert body["updated_streak"] == 0
        break  # only test one selection


def test_answer_wrong_selection_gives_zero_points(client: TestClient) -> None:
    """Answer both options; verify that the wrong one gives 0 points and resets streak."""
    token, duels = _get_daily_session(client, years=1)
    duel = duels[0]

    results = {}
    for selected in (duel["left"]["peak_id"], duel["right"]["peak_id"]):
        resp = client.post(
            "/api/v1/game/answer",
            json={
                "session_token": token,
                "duel_id": duel["id"],
                "selected_peak_id": selected,
                "elapsed_ms": 8000,
                "current_streak": 5,
            },
        )
        assert resp.status_code == 200
        results[selected] = resp.json()

    correct_body = next(b for b in results.values() if b["correct"])
    wrong_body = next(b for b in results.values() if not b["correct"])

    assert wrong_body["arena_points_awarded"] == 0
    assert wrong_body["updated_streak"] == 0
    assert correct_body["arena_points_awarded"] > 0


def test_answer_tampered_token_returns_400(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    tampered = token[:-4] + "XXXX"
    resp = client.post(
        "/api/v1/game/answer",
        json={
            "session_token": tampered,
            "duel_id": duels[0]["id"],
            "selected_peak_id": duels[0]["left"]["peak_id"],
            "elapsed_ms": 3000,
            "current_streak": 0,
        },
    )
    assert resp.status_code == 400


def test_answer_invalid_duel_id_returns_400(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    resp = client.post(
        "/api/v1/game/answer",
        json={
            "session_token": token,
            "duel_id": "duel-doesnotexist",
            "selected_peak_id": duels[0]["left"]["peak_id"],
            "elapsed_ms": 3000,
            "current_streak": 0,
        },
    )
    assert resp.status_code == 400


def test_answer_invalid_peak_selection_returns_400(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    duel = duels[0]
    resp = client.post(
        "/api/v1/game/answer",
        json={
            "session_token": token,
            "duel_id": duel["id"],
            "selected_peak_id": "not-a-valid-peak-id",
            "elapsed_ms": 3000,
            "current_streak": 0,
        },
    )
    assert resp.status_code == 400


def test_answer_arena_points_non_negative(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    duel = duels[0]
    resp = client.post(
        "/api/v1/game/answer",
        json={
            "session_token": token,
            "duel_id": duel["id"],
            "selected_peak_id": duel["left"]["peak_id"],
            "elapsed_ms": 500,  # below floor — speed bonus = 0
            "current_streak": 0,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["arena_points_awarded"] >= 0


def test_answer_response_has_explanation(client: TestClient) -> None:
    token, duels = _get_daily_session(client, years=1)
    duel = duels[0]
    resp = client.post(
        "/api/v1/game/answer",
        json={
            "session_token": token,
            "duel_id": duel["id"],
            "selected_peak_id": duel["left"]["peak_id"],
            "elapsed_ms": 4000,
            "current_streak": 2,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "explanation" in body
    assert isinstance(body["explanation"], str)
    assert len(body["explanation"]) > 0


def test_answer_response_no_scores_in_public_before_answer(client: TestClient) -> None:
    """Public duel payload should not expose prime_index before answering."""
    resp = client.get("/api/v1/game/daily?years=1&date=2026-06-28")
    assert resp.status_code == 200
    for duel in resp.json()["duels"]:
        assert "prime_index" not in duel["left"]
        assert "prime_index" not in duel["right"]
