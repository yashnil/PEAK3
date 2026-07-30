"""Phase 9B: the PEAK Index serving gate + inclusion-universe guards.

WHY THIS FILE EXISTS. An audit of user-reported "why is this bench player
ranked above a real starter?" complaints found the responsible path had ZERO
test coverage: nothing under apps/api/tests/ or apps/web/src/tests/
referenced /api/v1/peaks, get_peaks, or top_1000_peaks, and nothing anywhere
asserted a minutes floor on any served ranking. The defect was therefore
invisible to CI even though the model's own test suite names some of the same
players as negative controls.

The measured defect, before the fix: scripts/build_top_peaks.py built its
universe from every identity in the scored parquet, and the only minutes gate
anywhere upstream was peak3.regular_minutes_threshold (1000 minutes / 82
games ~= 12.2 MPG). Result: 269 of 1000 served rows (26.9%) were sub-25-MPG
seasons and 106 (10.6%) were sub-20-MPG -- e.g. Luka Garza served at rank 307
on a 16.2 MPG season, Gary Payton II at 194 on 17.6 MPG.

Note the sharpest symptom, which these tests now prevent regressing:
Isaiah Hartenstein is simultaneously a hardcoded NEGATIVE CONTROL in
tests/test_validation.py::ROLE_CONTROLS (the model suite names him as an
example of a player who must NOT rank like a star) and was being served at
rank 212, above Deandre Ayton. The guard existed; it just wasn't wired to the
surface users actually see.

These tests assert the SERVING contract only. They deliberately assert
nothing about any score: the fix is a display/serving gate that never touched
peak3.py, OFFICIAL_WEIGHTS, calibrate_score(), or a single stored value.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PEAKS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
)

# Must match scripts/build_top_peaks.py::MIN_SERVED_ANCHOR_MPG. Duplicated as a
# literal on purpose -- if someone lowers the gate in the script, this test
# should fail rather than silently follow it down.
EXPECTED_MIN_ANCHOR_MPG = 25.0

# Real players the audit found being served on thin-sample seasons. Each is a
# legitimate NBA player and a fine CourtBuilder card -- the point is only that
# a sub-25-MPG season should not appear on a board titled "PEAK Index".
AUDITED_LOW_MINUTE_PLAYERS = [
    "Luka Garza",            # 16.2 MPG, served at rank 307
    "Gary Payton II",        # 17.6 MPG, served at rank 194
    "Daniel Gafford",        # 21.5 MPG, out-indexed a 34 MPG All-NBA wing
    "Isaiah Hartenstein",    # 17.9 MPG, and a ROLE_CONTROLS negative control
    "Luke Kornet",
]


@pytest.fixture(scope="module")
def peaks_payload() -> dict:
    if not PEAKS_PATH.exists():
        pytest.skip(
            f"{PEAKS_PATH.name} not generated -- run `python scripts/build_top_peaks.py`"
        )
    return json.loads(PEAKS_PATH.read_text())


def _all_windows(payload: dict):
    for key, window in payload["windows"].items():
        yield key, window


def test_every_served_row_clears_the_minutes_gate(peaks_payload):
    """The core invariant. Asserted per row rather than trusting the summary
    counter, so a partially-regenerated file can't pass."""
    for key, window in _all_windows(peaks_payload):
        rows = window["rows"]
        assert rows, f"{key} window served zero rows"
        for row in rows:
            mpg = row.get("anchor_season_mpg")
            assert mpg is not None, (
                f"{key} rank {row['rank']} ({row['player_name']}) has no anchor_season_mpg -- "
                "an unknown sample must never be served"
            )
            assert mpg >= EXPECTED_MIN_ANCHOR_MPG, (
                f"{key} rank {row['rank']}: {row['player_name']} {row['anchor_season']} "
                f"served at {mpg} MPG, below the {EXPECTED_MIN_ANCHOR_MPG} gate"
            )


def test_each_window_records_the_gate_it_applied(peaks_payload):
    """The artifact must be self-describing -- a reader should not have to
    diff the script to learn which universe they're looking at."""
    for key, window in _all_windows(peaks_payload):
        assert window["min_anchor_season_mpg"] == EXPECTED_MIN_ANCHOR_MPG, key
        assert window["excluded_low_minute_windows"] >= 0
        assert window["row_count"] == len(window["rows"]), key


def test_the_gate_actually_excluded_something(peaks_payload):
    """Guards against a gate that is present but inert (e.g. wired to a
    column that is always null). The audit measured hundreds of sub-25-MPG
    windows, so a zero here means the filter silently stopped working."""
    excluded = {k: w["excluded_low_minute_windows"] for k, w in _all_windows(peaks_payload)}
    assert excluded["1y"] > 100, (
        f"expected the 1Y gate to exclude many thin-sample windows, got {excluded['1y']} -- "
        "the filter is probably inert"
    )
    assert sum(excluded.values()) > 0


@pytest.mark.parametrize("player_name", AUDITED_LOW_MINUTE_PLAYERS)
def test_audited_low_minute_players_are_no_longer_served(peaks_payload, player_name):
    """Regression test for the exact user complaint ("why is Luka Garza in
    the rankings?"). Scoped to the 1Y board, where every one of these was
    being served."""
    served = {row["player_name"] for row in peaks_payload["windows"]["1y"]["rows"]}
    assert player_name not in served, (
        f"{player_name} is being served on the 1Y PEAK Index again -- the minutes gate regressed"
    )


def test_the_board_is_still_full_and_densely_ranked(peaks_payload):
    """The gate must not have hollowed out the product. The 1Y board should
    still serve a full TOP_N, and ranks must be a dense 1..N with no gaps
    where an excluded row used to sit."""
    one_year = peaks_payload["windows"]["1y"]
    assert one_year["row_count"] == 1000, (
        f"1Y board served only {one_year['row_count']} rows -- the gate is filtering too hard, "
        "or the cap is being applied before the filter"
    )
    for window_key, window in _all_windows(peaks_payload):
        ranks = [row["rank"] for row in window["rows"]]
        assert ranks == list(range(1, len(ranks) + 1)), f"{window_key} ranks are not dense 1..N"


def test_scores_and_ordering_were_not_touched_by_the_serving_gate(peaks_payload):
    """The fix is a serving filter, not a re-scoring. Descending score order
    must be preserved exactly, and the top of the board must be unchanged --
    if a formula or sort had shifted, this is where it would show."""
    for window_key, window in _all_windows(peaks_payload):
        scores = [row["prime_score"] for row in window["rows"]]
        assert scores == sorted(scores, reverse=True), f"{window_key} is not in descending score order"

    top_1y = peaks_payload["windows"]["1y"]["rows"][0]
    assert top_1y["player_name"] == "Michael Jordan"
    assert top_1y["anchor_season"] == "1990-91"
    assert top_1y["prime_score"] == pytest.approx(97.53, abs=0.01)


def test_the_explain_payload_is_not_a_second_ungated_surface(peaks_payload):
    """Phase 9C added a per-row explain block to the SAME artifact. It is keyed
    only by served row_ids, so it must never become a back door that publishes a
    thin-sample window the table declined to show. Asserted per block: every
    explain block corresponds to a served row and reports the same
    gate-clearing minutes."""
    explain = peaks_payload.get("explain")
    if not explain:
        pytest.skip("this artifact predates the Phase 9C explain block")

    served_ids: dict[str, float] = {}
    for _, window in _all_windows(peaks_payload):
        for row in window["rows"]:
            served_ids[row["row_id"]] = row["anchor_season_mpg"]

    assert set(explain) == set(served_ids), (
        "the explain block and the served rows disagree -- one of them is publishing a window the "
        "other does not"
    )
    for row_id, block in explain.items():
        assert block["anchor_season_mpg"] == served_ids[row_id], row_id
        assert block["anchor_season_mpg"] >= EXPECTED_MIN_ANCHOR_MPG, row_id
        assert block["min_anchor_season_mpg"] == EXPECTED_MIN_ANCHOR_MPG, row_id
        # And no comparison rail may point at an unserved window.
        for rail, entries in block["comparisons"].items():
            for entry in entries:
                assert entry["row_id"] in served_ids, f"{row_id}/{rail} -> {entry['row_id']}"


def test_the_gate_fields_survived_the_phase_9c_row_expansion(peaks_payload):
    """Phase 9C widened the row (components, percentiles, row_id, label, mpg).
    The gate's own fields must still be present and consistent -- `mpg` is the
    shared rankings contract's name for exactly the number the gate tests, so a
    drift between the two would let the UI display one figure while the gate
    enforced another."""
    for key, window in _all_windows(peaks_payload):
        for row in window["rows"]:
            assert row["anchor_season_mpg"] is not None, f"{key} rank {row['rank']}"
            assert row["mpg"] == row["anchor_season_mpg"], f"{key} rank {row['rank']}"


def test_formula_provenance_is_still_the_official_unmodified_weights(peaks_payload):
    """Belt-and-braces: prove this artifact still claims the official weight
    vector, so a serving-gate change can never be mistaken for cover for a
    formula change."""
    weights = peaks_payload["official_weights"]
    assert weights["statistical_impact"] == pytest.approx(0.38)
    assert weights["traditional_production"] == pytest.approx(0.21)
    assert weights["recognition"] == pytest.approx(0.20)
    assert weights["postseason"] == pytest.approx(0.18)
    assert weights["team_achievement"] == pytest.approx(0.03)
    assert sum(weights.values()) == pytest.approx(1.0)
