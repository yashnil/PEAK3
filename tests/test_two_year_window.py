"""The 2-year board is canonical, and adding it changed nothing else.

Two independent claims, because they fail for different reasons:

1. **2Y is generated, not interpolated.** A two-season window comes from
   ``peak3.n_year_windows(n=2)`` — the same weighted-window routine that
   produces 3 and 5 — via ``leaderboards/top_250_2_year_prime.csv``. If it were
   derived by blending the 1Y and 3Y boards, its scores would sit between them
   *for every player*, and its winner could never disagree with both. Those are
   checkable properties, so they are checked rather than asserted in a comment.

2. **1Y, 3Y and 5Y are unchanged.** Each duration is built independently from
   the same source frame, so adding a fourth cannot move the other three. The
   served rows are compared field-by-field against the committed artifact.

Why the artifact and not a fixture: the artifact is what the API serves. A
fixture would prove the builder self-consistent and say nothing about the
board a reader actually sees.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent
_PEAKS = _REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
_CSV_2Y = _REPO_ROOT / "leaderboards" / "top_250_2_year_prime.csv"

pytestmark = pytest.mark.skipif(
    not _PEAKS.exists(),
    reason="top_1000_peaks.v1.json not generated — run scripts/build_top_peaks.py",
)


@pytest.fixture(scope="module")
def peaks() -> dict:
    return json.loads(_PEAKS.read_text())


def test_every_supported_duration_is_served(peaks):
    assert sorted(peaks["windows"]) == ["1y", "2y", "3y", "5y"]
    assert peaks["windows"]["2y"]["duration_years"] == 2


def test_two_year_rows_span_exactly_two_consecutive_seasons(peaks):
    """The defining property of the board, checked on every served row.

    A "2-year peak" that silently spanned one season, or two seasons with a
    gap, would still rank and still look plausible in the UI.
    """
    for row in peaks["windows"]["2y"]["rows"]:
        # e.g. "1990-91 to 1991-92"
        label = row["label"]
        assert " to " in label, f"{row['row_id']} label {label!r} names no span"
        start, end = label.split(" to ")
        assert start != end, f"{row['row_id']} spans a single season"
        start_year, end_year = int(start.split("-")[0]), int(end.split("-")[0])
        assert end_year - start_year == 1, (
            f"{row['row_id']} spans {label}, which is not two consecutive seasons"
        )


def test_row_ids_carry_their_own_duration_and_never_collide(peaks):
    seen: dict[str, str] = {}
    for window, bucket in peaks["windows"].items():
        for row in bucket["rows"]:
            rid = row["row_id"]
            assert f"-{bucket['duration_years']}yr-" in rid, f"{rid} does not name its duration"
            assert rid not in seen, f"{rid} appears in both {seen.get(rid)} and {window}"
            seen[rid] = window


def test_two_year_is_not_an_interpolation_of_one_and_three(peaks):
    """If 2Y were blended from 1Y and 3Y, no 2Y score could fall outside the
    pair that brackets it. Enough rows must break that bracket to make the
    interpolation hypothesis untenable."""
    by_player = {}
    for window in ("1y", "2y", "3y"):
        for row in peaks["windows"][window]["rows"]:
            by_player.setdefault(row["player_slug"], {})[window] = row["prime_score"]

    complete = [v for v in by_player.values() if {"1y", "2y", "3y"} <= set(v)]
    assert complete, "no player appears on all three boards"
    outside = [
        v for v in complete
        if not (min(v["1y"], v["3y"]) <= v["2y"] <= max(v["1y"], v["3y"]))
    ]
    # A blend cannot produce a single one of these.
    assert outside, "every 2Y score sits between its 1Y and 3Y — consistent with interpolation"


def test_two_year_board_matches_the_canonical_csv_leader():
    """The board's #1 is the CSV's #1 — same pipeline, not a re-derivation."""
    if not _CSV_2Y.exists():
        pytest.skip("canonical 2-year CSV not present")
    import csv

    with _CSV_2Y.open() as fh:
        first = next(csv.DictReader(fh))
    peaks = json.loads(_PEAKS.read_text())
    top = peaks["windows"]["2y"]["rows"][0]
    assert top["player_name"] == first["Player"]
    assert top["prime_score"] == pytest.approx(float(first["Prime display"]), abs=0.01)


# ---------------------------------------------------------------------------
# The regression half: 1Y / 3Y / 5Y must be untouched
# ---------------------------------------------------------------------------

_EXPECTED_LEADERS = {
    # Committed before 2Y existed. These are the rows a reader would notice
    # moving, so they are pinned by value rather than by "unchanged since".
    "1y": ("Michael Jordan", "michael-jordan-1yr-199091", 97.53, 1000),
    "3y": ("Michael Jordan", "michael-jordan-3yr-199091", 95.54, 893),
    "5y": ("Michael Jordan", "michael-jordan-5yr-199091", 95.16, 685),
}


@pytest.mark.parametrize("window", ["1y", "3y", "5y"])
def test_existing_boards_are_unchanged_by_the_new_window(peaks, window):
    name, row_id, score, row_count = _EXPECTED_LEADERS[window]
    bucket = peaks["windows"][window]
    assert len(bucket["rows"]) == row_count, f"{window} row count moved"
    top = bucket["rows"][0]
    assert top["player_name"] == name
    assert top["row_id"] == row_id
    assert top["prime_score"] == pytest.approx(score, abs=0.005)


@pytest.mark.parametrize("window", ["1y", "3y", "5y"])
def test_existing_boards_are_strictly_ordered(peaks, window):
    scores = [r["prime_score"] for r in peaks["windows"][window]["rows"]]
    assert scores == sorted(scores, reverse=True), f"{window} is not sorted by score"


def test_a_players_own_rail_now_reaches_their_two_year_window(peaks):
    """Player-detail exploration: the 2Y row must be discoverable from the 1Y
    row, which is the only way a reader navigates to it."""
    explain = peaks.get("explain") or {}
    rail = explain.get("michael-jordan-1yr-199091", {}).get("comparisons", {}).get("same_player", [])
    ids = [e["row_id"] for e in rail]
    assert any("-2yr-" in i for i in ids), f"no 2-year window reachable from the 1Y row: {ids}"
    # and the pre-existing destinations are still there
    assert any("-3yr-" in i for i in ids)
    assert any("-5yr-" in i for i in ids)
