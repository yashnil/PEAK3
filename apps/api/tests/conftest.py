"""Test configuration — provides a TestClient with either real or fixture dataset."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.dataset import dataset_store
from app.main import app

# ---------------------------------------------------------------------------
# Fixture dataset — used when data/web/ has not been generated yet
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
WEB_DATA_DIR = REPO_ROOT / "data" / "web"


def _make_peak(
    player_num: int,
    duration: int,
    rank: int,
    prime_index: float,
) -> dict:
    """Build a synthetic peak window record."""
    player_slug = f"player-{player_num:03d}"
    first = f"First{player_num:03d}"
    last = f"Last{player_num:03d}"
    season = f"200{player_num % 10}-{(player_num % 10) + 1:02d}"
    peak_id = f"{player_slug}-{duration}yr-{season.replace('-', '')}"
    return {
        "id": peak_id,
        "player_id": player_slug,
        "player_slug": player_slug,
        "player_name": f"{first} {last}",
        "duration_years": duration,
        "start_season": season,
        "end_season": season,
        "anchor_season": season,
        "rank": rank,
        "prime_score": round(90.0 - rank * 0.5, 2),
        "prime_index": round(prime_index, 4),
        "components": {
            "statistical_impact": round(prime_index * 0.40, 4),
            "traditional_production": round(prime_index * 0.22, 4),
            "individual_recognition": round(prime_index * 0.21, 4),
            "postseason_individual_value": round(prime_index * 0.13, 4),
            "team_achievement": round(prime_index * 0.03, 4),
            "teammate_adjustment": round(-prime_index * 0.01, 4),
        },
        "data_status": "complete",
    }


def _build_fixture_leaderboards(player_count: int = 30) -> dict[int, list[dict]]:
    durations = [1, 2, 3, 5]
    lbs: dict[int, list[dict]] = {}
    for d in durations:
        rows = []
        for i in range(1, player_count + 1):
            prime_index = round(90.0 - i * 1.5 + (d * 0.1), 4)
            rows.append(_make_peak(i, d, i, prime_index))
        lbs[d] = rows
    return lbs


FIXTURE_LEADERBOARDS = _build_fixture_leaderboards(30)
FIXTURE_METADATA = {
    "schema_version": "1.0.0",
    "model_version": "peak3-2026",
    "generated_at": "2026-06-28T00:00:00Z",
    "source_commit": "fixture",
    "supported_durations": [1, 2, 3, 5],
    "player_count": 30,
    "peak_window_count": 120,
    "source_artifacts": ["fixture"],
}
FIXTURE_METHODOLOGY: dict = {
    "weights": {
        "statistical_impact": 38,
        "traditional_production": 21,
        "individual_recognition": 20,
        "postseason_individual_value": 18,
        "team_achievement": 3,
    }
}


def _load_dataset() -> None:
    """Try real data first; fall back to fixture data."""
    if WEB_DATA_DIR.exists() and (WEB_DATA_DIR / "leaderboards.json").exists():
        dataset_store.load(WEB_DATA_DIR)
    else:
        dataset_store.load_fixture(FIXTURE_LEADERBOARDS, FIXTURE_METADATA, FIXTURE_METHODOLOGY)


# Load once for the entire test session
_load_dataset()


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def fixture_leaderboards() -> dict[int, list[dict]]:
    return FIXTURE_LEADERBOARDS


@pytest.fixture(scope="session")
def fixture_metadata() -> dict:
    return FIXTURE_METADATA
