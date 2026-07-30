"""Daily Grid Challenge (Phase 11A) — API-layer tests.

The model layer is already covered by tests/test_daily_grid.py at the repo
root (84 tests: taxonomy correctness, determinism, solvability, validation).
These tests cover only what the HTTP layer adds:

  1. the routes are wired and return the shapes in
     apps/web/src/types/daily-grid.ts
  2. THE ANSWER KEY NEVER CROSSES THE WIRE -- asserted against the serialized
     JSON, not against the Python object, since the response model is the
     thing being trusted
  3. a wrong answer is HTTP 200 with a reason; only a malformed request is 4xx
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.daily_grid.generator import GRID_SIZE, get_board, today_utc_date
from nba_peak.daily_grid.pool import load_pool
from nba_peak.daily_grid.search import MAX_LIMIT, MIN_QUERY_LENGTH, unused_answer_for_cell

BOARD_URL = "/api/v1/daily-grid/board"
SEARCH_URL = "/api/v1/daily-grid/search"
ANSWER_URL = "/api/v1/daily-grid/answer"
CONSTRAINTS_URL = "/api/v1/daily-grid/constraints"

# A fixed past date, so every assertion below is about one specific,
# reproducible board rather than about whatever today happens to generate.
FIXED_DATE = "2026-03-14"
OTHER_DATE = "2026-03-15"

# Exactly the fields GridCellSpec declares in the TS contract. Asserted as an
# equality, not a subset: an extra key here is the failure mode this whole
# file exists to catch.
CELL_KEYS = {"row", "col", "row_constraint_id", "col_constraint_id", "rarity_bucket"}
CONSTRAINT_KEYS = {"id", "label", "short_label", "category", "description"}
CARD_KEYS = {
    "id",
    "player_slug",
    "player_name",
    "season",
    "team",
    "team_name",
    "position",
    "prime_score",
    "label",
}
CELL_SCORE_KEYS = {
    "arena_points",
    "quality_points",
    "rarity_bucket",
    "rarity_label",
    "rarity_multiplier",
    "rarity_bonus",
}

# Anything that would hand a player the answers, directly or by arithmetic.
FORBIDDEN_KEYS = {
    "answer_ids",
    "answer_count",
    "answers",
    "player_slugs",
    "seed",
    "attempts",
    "total_answers",
    "distinct_player_count",
}


def _all_keys(payload) -> set[str]:
    """Every key anywhere in a nested JSON payload."""
    keys: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            keys.add(key)
            keys |= _all_keys(value)
    elif isinstance(payload, list):
        for item in payload:
            keys |= _all_keys(item)
    return keys


def _known_good_answer(date: str = FIXED_DATE, row: int = 0, col: int = 0):
    """A real valid answer for a cell, straight from the server-side key.

    This is answer-key material and has no route on purpose -- tests are the
    only caller (see search.unused_answer_for_cell).
    """
    board = get_board(date)
    answer = unused_answer_for_cell(board, row, col)
    assert answer is not None, f"no unused answer for ({row}, {col}) on {date}"
    return answer


# ---------------------------------------------------------------------------
# GET /board
# ---------------------------------------------------------------------------

def test_board_returns_three_by_three_grid(client: TestClient):
    response = client.get(BOARD_URL, params={"date": FIXED_DATE})
    assert response.status_code == 200
    body = response.json()
    assert len(body["rows"]) == GRID_SIZE
    assert len(body["cols"]) == GRID_SIZE
    assert len(body["cells"]) == GRID_SIZE * GRID_SIZE
    assert body["date"] == FIXED_DATE
    assert body["board_id"] == f"daily-grid-v1-{FIXED_DATE}"
    assert body["difficulty"] in {"easy", "medium", "hard"}
    assert body["rules"] == {"unique_player_identity": True, "grid_size": GRID_SIZE}


def test_board_constraints_have_contract_shape(client: TestClient):
    body = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    for constraint in body["rows"] + body["cols"]:
        assert set(constraint) == CONSTRAINT_KEYS
        assert constraint["label"] and constraint["short_label"] and constraint["description"]


def test_board_cells_reference_their_row_and_col_constraints(client: TestClient):
    body = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    row_ids = [c["id"] for c in body["rows"]]
    col_ids = [c["id"] for c in body["cols"]]
    seen = set()
    for cell in body["cells"]:
        assert cell["row_constraint_id"] == row_ids[cell["row"]]
        assert cell["col_constraint_id"] == col_ids[cell["col"]]
        seen.add((cell["row"], cell["col"]))
    assert seen == {(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE)}


def test_board_is_deterministic_for_a_date(client: TestClient):
    first = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    second = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    assert first == second


def test_different_dates_give_different_boards(client: TestClient):
    first = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    second = client.get(BOARD_URL, params={"date": OTHER_DATE}).json()
    assert first["board_id"] != second["board_id"]
    # The axes themselves differ, not just the id/date labels.
    assert [c["id"] for c in first["rows"]] != [c["id"] for c in second["rows"]] or [
        c["id"] for c in first["cols"]
    ] != [c["id"] for c in second["cols"]]


def test_board_defaults_to_todays_utc_board(client: TestClient):
    default = client.get(BOARD_URL).json()
    today = today_utc_date()
    explicit = client.get(BOARD_URL, params={"date": today}).json()
    assert default["date"] == today
    assert default == explicit


@pytest.mark.parametrize(
    "bad_date",
    ["not-a-date", "2026-13-01", "2026-02-30", "03-14-2026", "2026/03/14", ""],
)
def test_board_rejects_malformed_date(client: TestClient, bad_date: str):
    response = client.get(BOARD_URL, params={"date": bad_date})
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_grid_date"


# ---------------------------------------------------------------------------
# The answer key never crosses the wire
# ---------------------------------------------------------------------------

def test_board_response_carries_no_answer_key(client: TestClient):
    """The whole game: a cell may expose its two constraints and a coarse
    rarity bucket, and nothing else. Asserted on the serialized JSON."""
    body = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()

    present = _all_keys(body)
    assert not (present & FORBIDDEN_KEYS), f"leaked: {present & FORBIDDEN_KEYS}"

    for cell in body["cells"]:
        assert set(cell) == CELL_KEYS
        assert cell["rarity_bucket"] in {
            "very_rare",
            "rare",
            "uncommon",
            "common",
            "very_common",
        }

    # No player identity of any kind appears in a board payload.
    raw = client.get(BOARD_URL, params={"date": FIXED_DATE}).text
    answer = _known_good_answer()
    assert answer.player_slug not in raw
    assert answer.id not in raw


def test_board_top_level_keys_are_exactly_the_contract(client: TestClient):
    body = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    assert set(body) == {
        "board_id",
        "date",
        "version",
        "difficulty",
        "rows",
        "cols",
        "cells",
        "rules",
    }


# ---------------------------------------------------------------------------
# GET /search
# ---------------------------------------------------------------------------

def test_search_returns_candidate_seasons(client: TestClient):
    response = client.get(SEARCH_URL, params={"q": "jordan"})
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == "jordan"
    assert len(body["results"]) > 0
    for hit in body["results"]:
        assert set(hit) == CARD_KEYS | {"eligible"}
        assert "jordan" in hit["player_name"].lower()
    # Unscoped search cannot say anything about eligibility.
    assert all(hit["eligible"] is None for hit in body["results"])


def test_search_scoped_to_a_cell_ranks_eligible_hits_first(client: TestClient):
    """A query that NAMES a player gets season-level help.

    Uses the player's full name, not their surname: a surname can match more
    than MAX_IDENTITIES_FOR_ELIGIBILITY distinct players ("James", "Jordan",
    "Johnson"), which the search deliberately treats as a broad query and
    answers with no eligibility at all -- see the broad-query test below.
    """
    answer = _known_good_answer(FIXED_DATE, 0, 0)

    response = client.get(
        SEARCH_URL,
        params={
            "q": answer.player_name,
            "date": FIXED_DATE,
            "row": 0,
            "col": 0,
            "limit": MAX_LIMIT,
        },
    )
    assert response.status_code == 200
    results = response.json()["results"]

    eligibility = [hit["eligible"] for hit in results]
    assert eligibility[0] is True
    # Every eligible hit precedes every ineligible one.
    assert eligibility == sorted(eligibility, key=lambda e: 0 if e else 1)
    assert answer.id in {hit["id"] for hit in results}


@pytest.mark.parametrize("broad_query", ["an", "er", "on", "ar"])
def test_search_broad_query_reveals_no_eligibility(
    client: TestClient, broad_query: str
):
    """The bulk answer-key harvest the eligibility gate exists to stop.

    A meaningless substring matches hundreds of players; if eligibility
    ranking applied, a large share of a cell's real answer set would sort to
    the top of the response for a caller who knows nothing. Broad queries must
    come back entirely unflagged.
    """
    response = client.get(
        SEARCH_URL,
        params={
            "q": broad_query,
            "date": FIXED_DATE,
            "row": 1,
            "col": 1,
            "limit": MAX_LIMIT,
        },
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert results, "a broad query should still return candidates"
    assert all(hit["eligible"] is None for hit in results)


@pytest.mark.parametrize("short_query", ["", "j"])
def test_search_below_min_query_length_returns_empty_200(client: TestClient, short_query: str):
    assert len(short_query) < MIN_QUERY_LENGTH
    response = client.get(SEARCH_URL, params={"q": short_query})
    assert response.status_code == 200
    assert response.json() == {"query": short_query, "results": []}


def test_search_honours_limit_and_clamps_to_max(client: TestClient):
    small = client.get(SEARCH_URL, params={"q": "james", "limit": 3}).json()
    assert len(small["results"]) == 3

    # Over MAX_LIMIT is clamped, not rejected.
    huge = client.get(SEARCH_URL, params={"q": "james", "limit": 10_000})
    assert huge.status_code == 200
    assert len(huge.json()["results"]) <= MAX_LIMIT


def test_search_rejects_limit_below_one(client: TestClient):
    assert client.get(SEARCH_URL, params={"q": "james", "limit": 0}).status_code == 422


@pytest.mark.parametrize("params", [{"row": 0}, {"col": 1}])
def test_search_requires_row_and_col_together(client: TestClient, params: dict):
    response = client.get(SEARCH_URL, params={"q": "jordan", "date": FIXED_DATE, **params})
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "incomplete_cell"


@pytest.mark.parametrize("row,col", [(3, 0), (0, 3), (-1, 0), (0, -1), (99, 99)])
def test_search_rejects_out_of_range_cell(client: TestClient, row: int, col: int):
    response = client.get(
        SEARCH_URL, params={"q": "jordan", "date": FIXED_DATE, "row": row, "col": col}
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_cell"


def test_search_rejects_malformed_date(client: TestClient):
    response = client.get(SEARCH_URL, params={"q": "jordan", "date": "2026-99-99"})
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_grid_date"


# ---------------------------------------------------------------------------
# POST /answer
# ---------------------------------------------------------------------------

def test_valid_answer_scores_the_cell(client: TestClient):
    answer = _known_good_answer(FIXED_DATE, 1, 1)
    response = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": 1, "col": 1, "answer_id": answer.id},
    )
    assert response.status_code == 200
    body = response.json()

    assert body["valid"] is True
    # Optional fields are OMITTED, not sent as null (the TS contract marks
    # them `?`, and `reason` is meaningless on a correct answer).
    assert "reason" not in body
    assert "reason_code" not in body

    assert set(body["player_season"]) == CARD_KEYS
    assert body["player_season"]["id"] == answer.id
    assert body["player_season"]["label"] == answer.label

    score = body["cell_score"]
    assert set(score) == CELL_SCORE_KEYS
    assert score["arena_points"] > 0
    assert score["arena_points"] <= 150  # 100 * the largest rarity multiplier
    assert score["quality_points"] == pytest.approx(answer.prime_score, abs=0.01)
    assert score["rarity_multiplier"] >= 1.0
    assert score["rarity_label"]


def test_valid_answer_matches_the_cells_rarity_bucket(client: TestClient):
    """The score's rarity term must be the same bucket the public board
    advertised for that cell -- otherwise the explanation lies."""
    board = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    cell = next(c for c in board["cells"] if (c["row"], c["col"]) == (2, 2))
    answer = _known_good_answer(FIXED_DATE, 2, 2)

    body = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": 2, "col": 2, "answer_id": answer.id},
    ).json()
    assert body["cell_score"]["rarity_bucket"] == cell["rarity_bucket"]


def test_unknown_answer_id_is_200_and_invalid(client: TestClient):
    response = client.post(
        ANSWER_URL,
        json={
            "date": FIXED_DATE,
            "row": 0,
            "col": 0,
            "answer_id": "not-a-real-player-199091-chi",
        },
    )
    # Being wrong is gameplay, not a transport error.
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["reason_code"] == "unknown_answer"
    assert body["reason"]
    assert "player_season" not in body
    assert "cell_score" not in body


def test_wrong_but_real_season_fails_a_constraint_with_a_reason(client: TestClient):
    """A real player-season that simply does not fit the square gets a
    specific, teachable reason -- not a generic 'invalid'."""
    board = get_board(FIXED_DATE)
    valid_ids = set(board.cell(0, 0).answer_ids)
    pool = load_pool()
    wrong = next(ps for ps in pool.seasons if ps.id not in valid_ids)

    body = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": 0, "col": 0, "answer_id": wrong.id},
    ).json()
    assert body["valid"] is False
    assert body["reason_code"] == "constraint_failed"
    assert wrong.label in body["reason"]
    # The card still comes back: the client shows what the player picked.
    assert body["player_season"]["id"] == wrong.id
    assert "cell_score" not in body


def test_reusing_a_player_identity_is_rejected(client: TestClient):
    answer = _known_good_answer(FIXED_DATE, 1, 1)
    body = client.post(
        ANSWER_URL,
        json={
            "date": FIXED_DATE,
            "row": 1,
            "col": 1,
            "answer_id": answer.id,
            "used_player_slugs": [answer.player_slug],
        },
    ).json()
    assert body["valid"] is False
    assert body["reason_code"] == "player_already_used"
    assert answer.player_name in body["reason"]
    assert "cell_score" not in body


def test_submitting_into_a_filled_cell_is_rejected(client: TestClient):
    answer = _known_good_answer(FIXED_DATE, 1, 1)
    body = client.post(
        ANSWER_URL,
        json={
            "date": FIXED_DATE,
            "row": 1,
            "col": 1,
            "answer_id": answer.id,
            "filled_cells": [[1, 1]],
        },
    ).json()
    assert body["valid"] is False
    assert body["reason_code"] == "cell_filled"


def test_answer_response_never_carries_the_key(client: TestClient):
    answer = _known_good_answer(FIXED_DATE, 0, 1)
    body = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": 0, "col": 1, "answer_id": answer.id},
    ).json()
    assert not (_all_keys(body) & FORBIDDEN_KEYS)


@pytest.mark.parametrize("row,col", [(3, 0), (0, 3), (-1, 0), (0, -1)])
def test_answer_rejects_out_of_range_cell(client: TestClient, row: int, col: int):
    response = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": row, "col": col, "answer_id": "whatever-199091-chi"},
    )
    assert 400 <= response.status_code < 500


def test_answer_rejects_malformed_date(client: TestClient):
    response = client.post(
        ANSWER_URL,
        json={"date": "2026-02-30", "row": 0, "col": 0, "answer_id": "x-199091-chi"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_grid_date"


def test_answer_rejects_oversized_client_state(client: TestClient):
    """A 3x3 board can never have more than nine filled cells or nine used
    identities; anything larger is a malformed payload."""
    answer = _known_good_answer(FIXED_DATE, 0, 0)
    too_many = client.post(
        ANSWER_URL,
        json={
            "date": FIXED_DATE,
            "row": 0,
            "col": 0,
            "answer_id": answer.id,
            "used_player_slugs": [f"player-{i}" for i in range(50)],
        },
    )
    assert too_many.status_code == 422

    too_many_cells = client.post(
        ANSWER_URL,
        json={
            "date": FIXED_DATE,
            "row": 0,
            "col": 0,
            "answer_id": answer.id,
            "filled_cells": [[0, 0]] * 25,
        },
    )
    assert too_many_cells.status_code == 422


def test_answer_defaults_used_and_filled_to_empty(client: TestClient):
    """Neither list is required -- an opening move sends neither."""
    answer = _known_good_answer(FIXED_DATE, 2, 0)
    body = client.post(
        ANSWER_URL,
        json={"date": FIXED_DATE, "row": 2, "col": 0, "answer_id": answer.id},
    ).json()
    assert body["valid"] is True


def test_answer_requires_an_answer_id(client: TestClient):
    response = client.post(ANSWER_URL, json={"date": FIXED_DATE, "row": 0, "col": 0})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# GET /constraints
# ---------------------------------------------------------------------------

def test_constraints_returns_the_shipped_taxonomy(client: TestClient):
    response = client.get(CONSTRAINTS_URL)
    assert response.status_code == 200
    body = response.json()
    assert len(body) > 20
    ids = [c["id"] for c in body]
    assert len(ids) == len(set(ids))
    categories = set()
    for constraint in body:
        assert set(constraint) == CONSTRAINT_KEYS
        categories.add(constraint["category"])
    assert categories <= {
        "team",
        "award",
        "era",
        "position",
        "peak",
        "component",
        "outcome",
    }
    # Reference data only -- no answer information anywhere in it.
    assert not (_all_keys(body) & FORBIDDEN_KEYS)


def test_constraints_cover_every_id_a_board_can_use(client: TestClient):
    known = {c["id"] for c in client.get(CONSTRAINTS_URL).json()}
    board = client.get(BOARD_URL, params={"date": FIXED_DATE}).json()
    for constraint in board["rows"] + board["cols"]:
        assert constraint["id"] in known
