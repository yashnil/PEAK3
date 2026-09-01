"""Tests for health endpoints."""
import pytest
from fastapi.testclient import TestClient


def test_health_returns_200(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "peak3-arena-api"


def test_health_readiness_returns_200_when_loaded(client: TestClient) -> None:
    resp = client.get("/health/readiness")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["dataset_loaded"] is True
    assert body["player_count"] > 0
    assert body["duration_count"] > 0


def test_health_readiness_reports_repository_mode(client: TestClient) -> None:
    """public-platform-readiness Batch P1: the test client's app never sets
    app.state.db_pool, so this must read "memory" — the same signal that, when
    it silently held for a real deploy, was indistinguishable from a healthy
    Postgres-backed one without reading server startup logs."""
    resp = client.get("/health/readiness")
    assert resp.status_code == 200
    assert resp.json()["repository_mode"] == "memory"
