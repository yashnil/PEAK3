"""Tests for daily board determinism, board_id format, and date validation."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

# Ensure nba_peak is importable in test context
_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))


# ---------------------------------------------------------------------------
# 1. Same date + mode → same board_id
# ---------------------------------------------------------------------------

def test_same_date_mode_same_board(client: TestClient) -> None:
    """Two daily games with the same date and mode produce the same board_id."""
    date = "2026-06-28"
    mode = "prime_3y"
    resp1 = client.get(f"/api/v1/draft/daily?mode={mode}&date={date}")
    resp2 = client.get(f"/api/v1/draft/daily?mode={mode}&date={date}")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert (
        resp1.json()["board_metadata"]["board_id"]
        == resp2.json()["board_metadata"]["board_id"]
    )


# ---------------------------------------------------------------------------
# 2. Different date → different board_id
# ---------------------------------------------------------------------------

def test_different_date_different_board(client: TestClient) -> None:
    """Two daily games with different dates produce different board_ids."""
    mode = "prime_3y"
    resp1 = client.get(f"/api/v1/draft/daily?mode={mode}&date=2026-06-28")
    resp2 = client.get(f"/api/v1/draft/daily?mode={mode}&date=2026-06-27")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert (
        resp1.json()["board_metadata"]["board_id"]
        != resp2.json()["board_metadata"]["board_id"]
    )


# ---------------------------------------------------------------------------
# 3. Same date, different mode → different board_id
# ---------------------------------------------------------------------------

def test_different_mode_different_board(client: TestClient) -> None:
    """Same date but different modes produce different board_ids."""
    date = "2026-06-28"
    resp1 = client.get(f"/api/v1/draft/daily?mode=prime_3y&date={date}")
    resp2 = client.get(f"/api/v1/draft/daily?mode=apex_1y&date={date}")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert (
        resp1.json()["board_metadata"]["board_id"]
        != resp2.json()["board_metadata"]["board_id"]
    )


# ---------------------------------------------------------------------------
# 4. Future date → 400
# ---------------------------------------------------------------------------

def test_future_date_rejected(client: TestClient) -> None:
    """A date in the future returns 400 — only released dates are playable."""
    resp = client.get("/api/v1/draft/daily?mode=prime_3y&date=2027-01-01")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 5. board_id format matches expected pattern
# ---------------------------------------------------------------------------

def test_daily_board_id_format(client: TestClient) -> None:
    """Daily board_id follows the pattern 'daily-{mode}-{date}'."""
    date = "2026-06-28"
    mode = "prime_3y"
    resp = client.get(f"/api/v1/draft/daily?mode={mode}&date={date}")
    assert resp.status_code == 200
    board_id = resp.json()["board_metadata"]["board_id"]
    assert board_id == f"daily-{mode}-{date}"
