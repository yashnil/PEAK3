"""Daily Grid API hardening (Phase 11D).

Two things are under test:

  1. RATE LIMITS actually bite, on every Daily Grid route, and a limited
     request is a clean 429 that leaks nothing about the budget.
  2. THE OFFICIAL RESULT is genuinely server-validated -- a client cannot
     report its own score, cannot save an unfinished or fabricated board, and
     cannot read or overwrite anyone else's record.

Rate-limit state is reset before every test by the autouse fixture in
conftest.py, so each test starts with exactly the configured budget and the
order tests run in cannot change the outcome.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from nba_peak.daily_grid.generator import get_board, today_utc_date
from nba_peak.daily_grid.search import unused_answer_for_cell

BOARD_URL = "/api/v1/daily-grid/board"
SEARCH_URL = "/api/v1/daily-grid/search"
ANSWER_URL = "/api/v1/daily-grid/answer"
RESULT_URL = "/api/v1/daily-grid/result"
OFFICIAL_URL = "/api/v1/daily-grid/official"

# Long enough that PyJWT does not warn about a short HMAC key. Test-only, never
# a real credential and never read from the environment.
_TEST_JWT_SECRET = "daily-grid-phase-11d-test-jwt-secret"

FIXED_DATE = "2026-03-14"


def _complete_board_payload(date: str = FIXED_DATE) -> list[dict]:
    """Nine real valid answers using nine different players, from the
    server-side key. Answer-key material with no route -- tests are the only
    caller (see search.unused_answer_for_cell)."""
    board = get_board(date)
    used: set[str] = set()
    filled: list[dict] = []
    for cell in board.cells:
        answer = unused_answer_for_cell(board, cell.row, cell.col, frozenset(used))
        assert answer is not None, (cell.row, cell.col)
        used.add(answer.player_slug)
        filled.append({"row": cell.row, "col": cell.col, "answer_id": answer.id})
    return filled


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def _assert_clean_429(response) -> None:
    """A limited response says 'slow down' and nothing a prober can calibrate
    against -- no budget size, no remaining count, no bucket name."""
    assert response.status_code == 429
    detail = response.json()["detail"]
    assert detail["error_code"] == "rate_limited"
    assert "Retry-After" in response.headers
    assert int(response.headers["Retry-After"]) >= 1

    body = response.text.lower()
    for leak in ("x-ratelimit", "remaining", "bucket", "token"):
        assert leak not in body, f"429 body leaked '{leak}'"
    assert "x-ratelimit-remaining" not in {k.lower() for k in response.headers}


def test_search_is_rate_limited(client: TestClient):
    params = {"q": "jordan", "date": FIXED_DATE, "row": 0, "col": 0}
    for i in range(settings.DAILY_GRID_SEARCH_RATE_LIMIT):
        assert client.get(SEARCH_URL, params=params).status_code == 200, i
    _assert_clean_429(client.get(SEARCH_URL, params=params))


def test_answer_submission_is_rate_limited(client: TestClient):
    body = {
        "date": FIXED_DATE,
        "row": 0,
        "col": 0,
        "answer_id": "not-a-real-answer",
        "used_player_slugs": [],
        "filled_cells": [],
    }
    # A WRONG answer is still a 200 -- being wrong is gameplay, not an error --
    # so this also confirms the limiter counts gameplay, not just failures.
    for i in range(settings.DAILY_GRID_ANSWER_RATE_LIMIT):
        assert client.post(ANSWER_URL, json=body).status_code == 200, i
    _assert_clean_429(client.post(ANSWER_URL, json=body))


def test_result_is_rate_limited(client: TestClient):
    body = {"date": FIXED_DATE, "filled": _complete_board_payload(), "incorrect_attempts": 0}
    for i in range(settings.DAILY_GRID_RESULT_RATE_LIMIT):
        assert client.post(RESULT_URL, json=body).status_code == 200, i
    _assert_clean_429(client.post(RESULT_URL, json=body))


def test_board_is_rate_limited(client: TestClient):
    params = {"date": FIXED_DATE}
    for i in range(settings.DAILY_GRID_BOARD_RATE_LIMIT):
        assert client.get(BOARD_URL, params=params).status_code == 200, i
    _assert_clean_429(client.get(BOARD_URL, params=params))


def test_walking_the_calendar_is_capped(client: TestClient):
    """Replaying an archive board is supported; assembling a corpus of a year's
    boards should not be one loop."""
    allowed = settings.DAILY_GRID_DATE_ENUMERATION_LIMIT
    for i in range(allowed):
        date = f"2026-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}"
        assert client.get(BOARD_URL, params={"date": date}).status_code == 200, date
    # A past date -- a FUTURE board is refused outright now (400), which
    # would mask the 429 this test is about.
    _assert_clean_429(client.get(BOARD_URL, params={"date": "2025-06-06"}))


def test_refetching_one_date_never_costs_enumeration_budget(client: TestClient):
    """Reload, retry and switching back to today must stay free -- the cap is
    on DISTINCT dates, not on board requests."""
    for _ in range(settings.DAILY_GRID_DATE_ENUMERATION_LIMIT * 3):
        assert client.get(BOARD_URL, params={"date": FIXED_DATE}).status_code == 200
    # And a second date is still available afterwards.
    assert client.get(BOARD_URL, params={"date": "2026-03-15"}).status_code == 200


def test_one_routes_budget_does_not_drain_anothers(client: TestClient):
    """Separate scopes: exhausting search must not lock a player out of
    submitting the answer they just found."""
    params = {"q": "jordan", "date": FIXED_DATE, "row": 0, "col": 0}
    for _ in range(settings.DAILY_GRID_SEARCH_RATE_LIMIT):
        client.get(SEARCH_URL, params=params)
    assert client.get(SEARCH_URL, params=params).status_code == 429
    assert client.get(BOARD_URL, params={"date": FIXED_DATE}).status_code == 200
    assert (
        client.post(
            ANSWER_URL,
            json={"date": FIXED_DATE, "row": 0, "col": 0, "answer_id": "x"},
        ).status_code
        == 200
    )


def test_hammering_one_date_does_not_throttle_another(client: TestClient):
    """Search buckets include the date, so an archive board a player opens is
    not throttled by what they were doing on today's."""
    for _ in range(settings.DAILY_GRID_SEARCH_RATE_LIMIT):
        client.get(SEARCH_URL, params={"q": "jordan", "date": FIXED_DATE, "row": 0, "col": 0})
    assert (
        client.get(
            SEARCH_URL, params={"q": "jordan", "date": FIXED_DATE, "row": 0, "col": 0}
        ).status_code
        == 429
    )
    assert (
        client.get(
            SEARCH_URL, params={"q": "jordan", "date": "2026-03-15", "row": 0, "col": 0}
        ).status_code
        == 200
    )


# ---------------------------------------------------------------------------
# Input hygiene
# ---------------------------------------------------------------------------

def test_an_oversized_query_is_rejected_not_scanned(client: TestClient):
    response = client.get(SEARCH_URL, params={"q": "a" * 5000})
    assert response.status_code == 422


def test_padded_queries_do_not_multiply_into_distinct_scans(client: TestClient):
    """Whitespace-padded variants of one query must normalize to the same
    thing, so they cannot be used to make each request look novel."""
    plain = client.get(SEARCH_URL, params={"q": "olajuwon"}).json()["results"]
    padded = client.get(SEARCH_URL, params={"q": "  olajuwon   "}).json()["results"]
    dotted = client.get(SEARCH_URL, params={"q": "olajuwon..."}).json()["results"]
    assert [h["id"] for h in plain] == [h["id"] for h in padded] == [h["id"] for h in dotted]


def test_the_response_size_is_capped_however_large_the_limit_asked_for(client: TestClient):
    response = client.get(SEARCH_URL, params={"q": "ja", "limit": 10_000})
    assert response.status_code == 200
    assert len(response.json()["results"]) <= 50


# ---------------------------------------------------------------------------
# Probing resistance
# ---------------------------------------------------------------------------

def test_the_result_route_is_not_an_oracle_for_a_single_square(client: TestClient):
    """The classic probe: submit eight real answers plus one candidate and read
    the response to learn whether the candidate was right. Rejected before any
    answer-key material is computed."""
    filled = _complete_board_payload()
    probe = [*filled[:8], {**filled[8], "answer_id": "michael-jordan-199091-chi"}]
    response = client.post(
        RESULT_URL, json={"date": FIXED_DATE, "filled": probe, "incorrect_attempts": 0}
    )
    assert response.status_code == 400
    body = response.text
    for leak in ("optimal_total", "optimal_player_season", "percent_of_best", "biggest_miss"):
        assert leak not in body


def test_a_rejected_board_never_names_a_better_answer(client: TestClient):
    response = client.post(
        RESULT_URL,
        json={
            "date": FIXED_DATE,
            "filled": [{"row": 0, "col": 0, "answer_id": "junk"}],
            "incorrect_attempts": 0,
        },
    )
    assert response.status_code == 400
    assert "optimal" not in response.text


def test_search_still_carries_no_score_under_hardening(client: TestClient):
    """The 11C guarantee must survive the 11D changes."""
    body = client.get(
        SEARCH_URL, params={"q": "Hakeem Olajuwon", "date": FIXED_DATE, "row": 0, "col": 0}
    ).json()
    assert body["results"]
    for hit in body["results"]:
        assert "prime_score" not in hit
        assert "arena_points" not in hit
        assert "points" not in hit


# ---------------------------------------------------------------------------
# Official account-backed result
# ---------------------------------------------------------------------------

def _token(sub: str) -> str:
    """A Supabase-shaped JWT this API will accept, signed with the configured
    test secret. Never a real credential."""
    import jwt

    secret = settings.SUPABASE_JWT_SECRET or _TEST_JWT_SECRET
    return jwt.encode({"sub": sub, "email": f"{sub}@example.test"}, secret, algorithm="HS256")


@pytest.fixture
def auth_headers(monkeypatch):
    """Configure a JWT secret for the process and return a header factory."""
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", _TEST_JWT_SECRET, raising=False)

    def make(sub: str) -> dict:
        return {"Authorization": f"Bearer {_token(sub)}"}

    return make


def _official_body(date: str = FIXED_DATE, **overrides) -> dict:
    return {
        "date": date,
        "filled": _complete_board_payload(date),
        "incorrect_attempts": 2,
        "elapsed_seconds": 390,
        **overrides,
    }


def test_official_save_requires_authentication(client: TestClient):
    """Anonymous play is never blocked, but an anonymous player gets the local
    archive rather than a durable record."""
    response = client.post(OFFICIAL_URL, json=_official_body())
    assert response.status_code == 401


def test_official_save_records_a_server_computed_result(client: TestClient, auth_headers):
    response = client.post(OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-a"))
    assert response.status_code == 200
    body = response.json()
    assert body["official_saved"] is True
    assert body["created"] is True
    assert body["board_date"] == FIXED_DATE
    assert body["board_version"] == "daily_grid.v2"
    assert body["score"] > 0
    assert body["optimal_total"] >= body["score"]
    assert 0 < body["percent_of_best"] <= 100.0
    assert body["played_on_board_date"] is False  # a fixed past date


def test_the_client_cannot_report_its_own_score(client: TestClient, auth_headers):
    """The request model has no score field at all, so a client sending one is
    ignored rather than trusted -- and the stored number is the one the server
    computed from the board."""
    honest = client.post(
        OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-honest")
    ).json()
    inflated = client.post(
        OFFICIAL_URL,
        json={**_official_body(), "score": 999_999, "percent_of_best": 100.0},
        headers=auth_headers("user-liar"),
    ).json()
    assert inflated["score"] == honest["score"]
    assert inflated["percent_of_best"] == honest["percent_of_best"]
    assert inflated["score"] != 999_999


def test_a_second_submit_is_idempotent_not_a_new_attempt(client: TestClient, auth_headers):
    headers = auth_headers("user-retry")
    first = client.post(OFFICIAL_URL, json=_official_body(), headers=headers).json()
    second = client.post(OFFICIAL_URL, json=_official_body(), headers=headers).json()
    assert first["created"] is True
    assert second["created"] is False
    assert second["official_saved"] is True
    assert second["saved_at"] == first["saved_at"]
    assert second["score"] == first["score"]


def test_a_resubmit_cannot_overwrite_a_worse_first_attempt(client: TestClient, auth_headers):
    """The point of idempotency here: the FIRST attempt is the official one.
    Re-submitting a different (better) board for the same day must not replace
    it, or a player could grind until they liked the number."""
    headers = auth_headers("user-grinder")
    first = client.post(
        OFFICIAL_URL, json=_official_body(incorrect_attempts=9), headers=headers
    ).json()
    again = client.post(
        OFFICIAL_URL, json=_official_body(incorrect_attempts=0), headers=headers
    ).json()
    assert again["created"] is False
    assert again["saved_at"] == first["saved_at"]


def test_an_incomplete_board_cannot_be_saved(client: TestClient, auth_headers):
    body = _official_body()
    body["filled"] = body["filled"][:5]
    response = client.post(OFFICIAL_URL, json=body, headers=auth_headers("user-b"))
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "board_incomplete"


def test_a_junk_board_cannot_be_saved(client: TestClient, auth_headers):
    body = _official_body()
    body["filled"] = [{"row": r, "col": c, "answer_id": "junk"} for r in range(3) for c in range(3)]
    response = client.post(OFFICIAL_URL, json=body, headers=auth_headers("user-c"))
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "board_not_valid"


def test_a_board_reusing_one_player_cannot_be_saved(client: TestClient, auth_headers):
    """The distinct-identity rule is re-checked across the whole board, not
    trusted from the client's own `used` bookkeeping."""
    filled = _complete_board_payload()
    filled[1]["answer_id"] = filled[0]["answer_id"]
    response = client.post(
        OFFICIAL_URL,
        json={"date": FIXED_DATE, "filled": filled, "incorrect_attempts": 0},
        headers=auth_headers("user-d"),
    )
    assert response.status_code == 400


def test_saving_never_returns_answer_key_material(client: TestClient, auth_headers):
    """The save response is a receipt, not a second copy of the comparison."""
    body = client.post(
        OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-e")
    ).text
    for leak in ("optimal_player_season", "biggest_miss", "answer_ids", "cells"):
        assert leak not in body


def test_two_users_get_independent_records(client: TestClient, auth_headers):
    a = client.post(OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-1")).json()
    b = client.post(OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-2")).json()
    # Both are first-time saves: one user's record must not satisfy another's.
    assert a["created"] is True
    assert b["created"] is True


def test_an_archive_replay_is_saved_but_flagged(client: TestClient, auth_headers):
    """Replays are recorded honestly rather than rejected, and never promoted
    to a live daily attempt."""
    body = client.post(
        OFFICIAL_URL, json=_official_body(), headers=auth_headers("user-replay")
    ).json()
    assert body["played_on_board_date"] is False


def test_todays_board_is_flagged_as_a_live_attempt(client: TestClient, auth_headers):
    today = today_utc_date()
    response = client.post(
        OFFICIAL_URL, json=_official_body(today), headers=auth_headers("user-today")
    )
    assert response.status_code == 200
    assert response.json()["played_on_board_date"] is True


def test_an_unverifiable_elapsed_time_is_bounded(client: TestClient, auth_headers):
    """The clock is client-reported and stored presentationally, so it is
    bounded rather than believed. It is never scored."""
    response = client.post(
        OFFICIAL_URL,
        json=_official_body(elapsed_seconds=999_999),
        headers=auth_headers("user-f"),
    )
    assert response.status_code == 422


def test_official_save_is_rate_limited(client: TestClient, auth_headers):
    headers = auth_headers("user-flood")
    body = _official_body()
    for _ in range(settings.DAILY_GRID_RESULT_RATE_LIMIT):
        client.post(OFFICIAL_URL, json=body, headers=headers)
    _assert_clean_429(client.post(OFFICIAL_URL, json=body, headers=headers))
