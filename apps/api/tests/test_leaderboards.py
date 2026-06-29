"""Tests for leaderboard and player endpoints."""
import pytest
from fastapi.testclient import TestClient


def test_leaderboards_default_returns_200(client: TestClient) -> None:
    resp = client.get("/api/v1/leaderboards")
    assert resp.status_code == 200
    body = resp.json()
    assert "rows" in body
    assert "total" in body
    assert isinstance(body["rows"], list)


def test_leaderboards_valid_years(client: TestClient) -> None:
    for years in [1, 2, 3, 5]:
        resp = client.get(f"/api/v1/leaderboards?years={years}")
        assert resp.status_code == 200, f"Failed for years={years}"
        body = resp.json()
        assert body["duration"] == years


def test_leaderboards_invalid_years_returns_422(client: TestClient) -> None:
    for bad in [0, 4, 6, 99]:
        resp = client.get(f"/api/v1/leaderboards?years={bad}")
        assert resp.status_code == 422, f"Expected 422 for years={bad}, got {resp.status_code}"


def test_leaderboards_pagination(client: TestClient) -> None:
    resp_full = client.get("/api/v1/leaderboards?years=1&limit=5&offset=0")
    resp_page2 = client.get("/api/v1/leaderboards?years=1&limit=5&offset=5")
    assert resp_full.status_code == 200
    assert resp_page2.status_code == 200

    full_rows = resp_full.json()["rows"]
    page2_rows = resp_page2.json()["rows"]

    # Rows should be different
    if full_rows and page2_rows:
        assert full_rows[0]["id"] != page2_rows[0]["id"]


def test_leaderboards_limit_enforced(client: TestClient) -> None:
    resp = client.get("/api/v1/leaderboards?years=1&limit=3")
    assert resp.status_code == 200
    assert len(resp.json()["rows"]) <= 3


def test_leaderboards_search(client: TestClient) -> None:
    # Get the first player name from the leaderboard
    resp = client.get("/api/v1/leaderboards?years=1&limit=1")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    if not rows:
        pytest.skip("No rows in leaderboard")

    first_name = rows[0]["player_name"]
    # Search with a partial match (first word of the name)
    partial = first_name.split()[0]
    resp_search = client.get(f"/api/v1/leaderboards?years=1&search={partial}")
    assert resp_search.status_code == 200
    result_names = [r["player_name"] for r in resp_search.json()["rows"]]
    assert any(partial.lower() in n.lower() for n in result_names)


def test_leaderboards_search_no_match(client: TestClient) -> None:
    resp = client.get("/api/v1/leaderboards?years=1&search=ZZZNOMATCH999")
    assert resp.status_code == 200
    body = resp.json()
    assert body["rows"] == []
    assert body["total"] == 0


def test_player_search(client: TestClient) -> None:
    resp = client.get("/api/v1/players/search?q=First")
    assert resp.status_code == 200
    body = resp.json()
    assert "players" in body
    assert isinstance(body["players"], list)


def test_player_search_empty_q_returns_422(client: TestClient) -> None:
    resp = client.get("/api/v1/players/search?q=")
    assert resp.status_code == 422


def test_player_search_deduplication(client: TestClient) -> None:
    resp = client.get("/api/v1/players/search?q=First&limit=50")
    assert resp.status_code == 200
    players = resp.json()["players"]
    slugs = [p["player_slug"] for p in players]
    assert len(slugs) == len(set(slugs)), "Duplicate player slugs in search results"


def test_player_search_available_durations(client: TestClient) -> None:
    resp = client.get("/api/v1/players/search?q=First001&limit=1")
    assert resp.status_code == 200
    players = resp.json()["players"]
    if players:
        durations = players[0]["available_durations"]
        assert isinstance(durations, list)
        assert all(d in [1, 2, 3, 5] for d in durations)


def test_player_slug_lookup(client: TestClient) -> None:
    # Get any player slug from leaderboard
    resp = client.get("/api/v1/leaderboards?years=1&limit=1")
    rows = resp.json()["rows"]
    if not rows:
        pytest.skip("No rows")
    slug = rows[0]["player_slug"]

    detail_resp = client.get(f"/api/v1/players/{slug}")
    assert detail_resp.status_code == 200
    body = detail_resp.json()
    assert body["player_slug"] == slug
    assert "windows" in body
    assert len(body["windows"]) >= 1


def test_player_slug_not_found(client: TestClient) -> None:
    resp = client.get("/api/v1/players/no-such-player-ever")
    assert resp.status_code == 404
