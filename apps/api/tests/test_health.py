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
