"""A saved Daily Grid result stays readable across a taxonomy cutover.

WHY THIS FILE EXISTS. The v5 taxonomy pass RETIRED seventeen constraints --
the PEAK3-native `peak`/`component` families and the per-75-possession
production bands (see `constraints.V5_RETIRED_CONSTRAINT_IDS`). Retired means
"never drawn for a NEW board", and it must never come to mean "gone", because
boards built from those ids have already been played and their results are
persisted.

Three separate mechanisms have to hold for that to be true, and each fails in
a different, quiet way:

  1. THE LOOKUP KEY. A stored result is keyed on (owner, board date, board
     VERSION). If any read path ever used `DAILY_GRID_VERSION` -- the current
     constant -- instead of the version the DATE resolves to, every pre-v5 row
     would become invisible the moment v5 shipped: the player's history would
     silently empty and the board would offer them a fresh attempt at a board
     they had already completed.

  2. ID RESOLUTION. `constraint_by_id` reads the FULL registry, not the
     version-filtered population. `optimal.build_result` calls it for every
     square to label the comparison, so a retired id that had actually been
     deleted would turn every archived-board result into a KeyError -- a 500
     on the one route that shows a player what they did.

  3. NO REINTERPRETATION. A pre-v5 date must still generate its own board,
     under its own version, with its own axis LABELS -- not today's taxonomy
     applied to yesterday's date.

The model-layer tests (tests/test_daily_grid.py::TestVersionCutover,
::TestV5Taxonomy) pin the generator side of this. What they do not touch is
the PERSISTED path: a row in the results table, read back through the API with
the new taxonomy active. That is what this file covers.

2026-09-09 is the date used throughout, and it is chosen rather than
convenient: it is a `daily_grid.v4` board whose first row axis is
`shoot_efficiency`, one of the ids v5 retires. A board that merely predates v5
would exercise (1) and (3) but not (2).
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from app.core.dependencies import _memory_daily_grid_result_repo
from app.repositories.daily_grid_protocols import DailyGridResult
from nba_peak.daily_grid.constraints import (
    V5_ADDED_CONSTRAINT_IDS,
    V5_RETIRED_CONSTRAINT_IDS,
    constraint_by_id,
)
from nba_peak.daily_grid.generator import (
    DAILY_GRID_VERSION,
    DAILY_GRID_VERSION_V4,
    DAILY_GRID_VERSION_V5,
    TAXONOMY_CUTOVER_DATE,
    get_board,
    today_utc_date,
)
from nba_peak.daily_grid.search import unused_answer_for_cell

BOARD_URL = "/api/v1/daily-grid/board"
RESULT_URL = "/api/v1/daily-grid/result"
OFFICIAL_URL = "/api/v1/daily-grid/official"
RESULTS_URL = "/api/v1/daily-grid/results"
CONSTRAINTS_URL = "/api/v1/daily-grid/constraints"

_TEST_JWT_SECRET = "daily-grid-legacy-compat-test-jwt-secret"

#: A `daily_grid.v4` board whose row axis `shoot_efficiency` is retired by v5.
#: Pinned as a constant with its expected version asserted below, so a future
#: cutover that swallowed this date would fail loudly here rather than silently
#: turning this whole file into a test of the current taxonomy.
RETIRED_AXIS_DATE = "2026-09-09"
RETIRED_AXIS_ID = "shoot_efficiency"


def _token(sub: str) -> str:
    import jwt

    return jwt.encode({"sub": sub, "aud": "authenticated"}, _TEST_JWT_SECRET, algorithm="HS256")


@pytest.fixture
def auth_headers(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", _TEST_JWT_SECRET, raising=False)

    def make(sub: str) -> dict:
        return {"Authorization": f"Bearer {_token(sub)}"}

    return make


def _complete_board_payload(date: str) -> list[dict]:
    """Nine real valid answers using nine different players, from the
    server-side key (see search.unused_answer_for_cell -- tests only)."""
    board = get_board(date)
    used: set[str] = set()
    filled: list[dict] = []
    for cell in board.cells:
        answer = unused_answer_for_cell(board, cell.row, cell.col, frozenset(used))
        assert answer is not None, (cell.row, cell.col)
        used.add(answer.player_slug)
        filled.append({"row": cell.row, "col": cell.col, "answer_id": answer.id})
    return filled


def _seed_legacy_row(owner: str, date: str, version: str) -> DailyGridResult:
    """Write a result row the way a save BEFORE the cutover would have.

    Inserted straight into the repository rather than through `POST /official`
    on purpose: the point is a row that already existed, written by code that
    knew nothing about v5, so nothing about today's save path may be involved
    in producing it.
    """
    row = DailyGridResult(
        id="",
        owner_sub=owner,
        board_id=f"daily-grid-{version.split('.')[-1]}-{date}",
        board_date=date,
        board_version=version,
        board_theme="Efficiency Night",
        score=640,
        optimal_total=800,
        percent_of_best=80.0,
        squares_matching_optimal=3,
        incorrect_attempts=2,
        elapsed_seconds=390,
        played_on_board_date=True,
        answers=[f"answer-{i}" for i in range(9)],
        created_at=datetime.now(timezone.utc),
    )
    import asyncio

    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        _memory_daily_grid_result_repo.save_result(row)
    )
    return row


# ---------------------------------------------------------------------------
# The premise. If these stop holding, every assertion below is testing nothing.
# ---------------------------------------------------------------------------

def test_the_fixture_date_really_is_a_pre_v5_board_built_from_a_retired_axis():
    board = get_board(RETIRED_AXIS_DATE)
    assert DAILY_GRID_VERSION == DAILY_GRID_VERSION_V5, "v5 must be the active taxonomy"
    assert board.version == DAILY_GRID_VERSION_V4
    assert RETIRED_AXIS_ID in V5_RETIRED_CONSTRAINT_IDS
    assert RETIRED_AXIS_ID in {c.id for c in board.rows} | {c.id for c in board.cols}


# ---------------------------------------------------------------------------
# 1. A pre-v5 saved result is still loadable after the cutover
# ---------------------------------------------------------------------------

class TestPreCutoverResultsStayReadable:
    def test_a_row_written_under_a_pre_v5_version_is_still_listed(
        self, client: TestClient, auth_headers
    ):
        """The history route reads stored rows directly, so this is the
        narrowest possible statement of "the record survived"."""
        _seed_legacy_row("legacy-reader", RETIRED_AXIS_DATE, DAILY_GRID_VERSION_V4)

        response = client.get(RESULTS_URL, headers=auth_headers("legacy-reader"))
        assert response.status_code == 200
        results = response.json()["results"]
        assert len(results) == 1
        assert results[0]["board_date"] == RETIRED_AXIS_DATE
        assert results[0]["board_version"] == DAILY_GRID_VERSION_V4
        assert results[0]["score"] == 640

    def test_the_boards_own_lookup_key_still_finds_that_row(
        self, client: TestClient, auth_headers
    ):
        """THE FAILURE THIS CLOSES. `_attempt_status` looks the row up by
        (owner, board.date, board.VERSION), and `board.version` comes from
        `_version_for_date`. If any of that ever read the current-version
        constant instead, a player who had completed this board would be handed
        a blank one and told to start again."""
        _seed_legacy_row("legacy-attempt", RETIRED_AXIS_DATE, DAILY_GRID_VERSION_V4)

        response = client.get(
            BOARD_URL,
            params={"date": RETIRED_AXIS_DATE},
            headers=auth_headers("legacy-attempt"),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["version"] == DAILY_GRID_VERSION_V4
        assert body["attempt_status"] == "completed"

    def test_a_signed_in_player_with_no_row_is_not_told_they_finished_it(
        self, client: TestClient, auth_headers
    ):
        """The other side of the same lookup: `completed` above has to mean the
        row was actually found, not that the route says so for everyone."""
        response = client.get(
            BOARD_URL,
            params={"date": RETIRED_AXIS_DATE},
            headers=auth_headers("legacy-nobody"),
        )
        assert response.status_code == 200
        assert response.json()["attempt_status"] == "not_started"

    def test_re_saving_that_board_finds_the_existing_row_rather_than_a_v5_one(
        self, client: TestClient, auth_headers
    ):
        """A pre-cutover row and a post-cutover save of the same board must be
        the SAME record. If the save wrote `daily_grid.v5` for this date, the
        uniqueness key would not collide and the player would end up with two
        results for one board -- the exact shape
        `test_a_board_version_bump_is_a_new_result_not_a_conflict` describes as
        correct for a genuine revision and wrong for this."""
        _seed_legacy_row("legacy-resave", RETIRED_AXIS_DATE, DAILY_GRID_VERSION_V4)

        response = client.post(
            OFFICIAL_URL,
            json={
                "date": RETIRED_AXIS_DATE,
                "filled": _complete_board_payload(RETIRED_AXIS_DATE),
                "incorrect_attempts": 0,
            },
            headers=auth_headers("legacy-resave"),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["created"] is False, "the pre-cutover row must be the one that stands"
        assert body["board_version"] == DAILY_GRID_VERSION_V4
        assert body["score"] == 640, "the stored result, not a freshly computed one"

        history = client.get(RESULTS_URL, headers=auth_headers("legacy-resave")).json()
        assert len(history["results"]) == 1


# ---------------------------------------------------------------------------
# 2. Retired ids still resolve through their historical taxonomy version
# ---------------------------------------------------------------------------

class TestRetiredConstraintsStillResolve:
    def test_every_retired_id_still_resolves_by_id(self):
        """`constraint_by_id` reads the full registry, which is what an
        archived board's axes, its rejection sentences and its result
        comparison all depend on."""
        for constraint_id in sorted(V5_RETIRED_CONSTRAINT_IDS):
            constraint = constraint_by_id(constraint_id)
            assert constraint.id == constraint_id
            assert constraint.short_label

    def test_the_public_constraints_route_still_enumerates_them(self, client: TestClient):
        """A client resolving an archived board's axis id against this route
        must still find it. Retired means "not drawn", not "not published"."""
        response = client.get(CONSTRAINTS_URL)
        assert response.status_code == 200
        published = {c["id"] for c in response.json()}
        assert V5_RETIRED_CONSTRAINT_IDS <= published

    def test_the_pre_v5_board_still_serves_its_retired_axis_with_its_own_label(
        self, client: TestClient
    ):
        """The label is part of the published board. `shoot_efficiency` is
        replaced in v5 by `shoot_elite_efficiency` ("Elite Efficiency"), and
        this board must still read the way it read on the day it was played."""
        response = client.get(BOARD_URL, params={"date": RETIRED_AXIS_DATE})
        assert response.status_code == 200
        axes = {c["id"]: c for c in response.json()["rows"]}
        assert RETIRED_AXIS_ID in axes
        assert axes[RETIRED_AXIS_ID]["short_label"] == "Elite TS+"

    def test_the_result_comparison_of_that_board_renders(self, client: TestClient):
        """THE 500 THIS CLOSES. `optimal.build_result` calls `constraint_by_id`
        for every square to label the comparison; a deleted retired id would
        make this route raise on any archived board that used one."""
        response = client.post(
            RESULT_URL,
            json={
                "date": RETIRED_AXIS_DATE,
                "filled": _complete_board_payload(RETIRED_AXIS_DATE),
                "incorrect_attempts": 0,
            },
        )
        assert response.status_code == 200
        cells = response.json()["cells"]
        assert len(cells) == 9
        # The comparison prints the constraint's full `label`, which for this
        # id is the one v5 replaced rather than renamed -- "Elite Efficiency"
        # here would mean an archived board had been relabelled.
        labels = {cell["row_constraint_label"] for cell in cells}
        assert "Elite Shooting Efficiency" in labels, labels
        assert "Elite Efficiency" not in labels, labels


# ---------------------------------------------------------------------------
# 3. No historical result is reinterpreted using v5 semantics
# ---------------------------------------------------------------------------

class TestNoV5Reinterpretation:
    def test_the_pre_v5_board_carries_no_v5_constraint(self, client: TestClient):
        board = client.get(BOARD_URL, params={"date": RETIRED_AXIS_DATE}).json()
        axis_ids = {c["id"] for c in board["rows"]} | {c["id"] for c in board["cols"]}
        assert not (axis_ids & V5_ADDED_CONSTRAINT_IDS), axis_ids

    def test_the_served_board_is_identical_to_the_generator_s_own(self, client: TestClient):
        """The API must not be re-deriving anything: same version, same board
        id, same hash, same axes as `get_board` produces for that date."""
        served = client.get(BOARD_URL, params={"date": RETIRED_AXIS_DATE}).json()
        expected = get_board(RETIRED_AXIS_DATE)
        assert served["version"] == expected.version
        assert served["board_id"] == expected.board_id
        assert served["board_hash"] == expected.board_hash
        assert [c["id"] for c in served["rows"]] == [c.id for c in expected.rows]
        assert [c["id"] for c in served["cols"]] == [c.id for c in expected.cols]

    def test_the_live_board_was_not_moved_by_the_cutover(self, client: TestClient):
        """TODAY IS THE CUTOVER DATE ITSELF, and the ladder is "at or before",
        so the live board is still v4 -- retired axes included. That is the
        guarantee, not an oversight: a player part-way through today's grid
        must not have it change underneath them. The first v5 board is
        tomorrow's.
        """
        served = client.get(BOARD_URL).json()
        expected = get_board(today_utc_date())
        assert served["version"] == expected.version
        assert served["board_id"] == expected.board_id
        assert served["board_hash"] == expected.board_hash

    def test_the_first_post_cutover_date_really_does_switch_taxonomy(self):
        """The control, and it has to be taken at the model layer: the future
        is deliberately closed to board requests, so the first v5 date cannot
        be fetched through the API today. Without this, every assertion above
        would still pass if the cutover had simply never taken effect."""
        first_v5 = date.fromisoformat(TAXONOMY_CUTOVER_DATE) + timedelta(days=1)
        board = get_board(first_v5.isoformat())
        assert board.version == DAILY_GRID_VERSION_V5
        axis_ids = {c.id for c in board.rows} | {c.id for c in board.cols}
        assert not (axis_ids & V5_RETIRED_CONSTRAINT_IDS), axis_ids
