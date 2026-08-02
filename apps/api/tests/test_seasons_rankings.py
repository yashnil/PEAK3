"""Phase 9B: the Single Seasons board -- generated artifact + served contract.

WHY THIS FILE EXISTS. The rankings surface gained a third board that is
deliberately unlike the other two: one row per SEASON instead of one row per
player, so repeated players are the feature rather than a bug. Two things
therefore need locking down at once, and neither was covered by the existing
suite:

  1. The repetition must survive. Any future "dedupe the rankings" cleanup
     would silently destroy the only board that can answer "what are the best
     single seasons ever?" -- so repeated players are asserted as a
     requirement, not tolerated as an accident.

  2. The minutes serving gate must hold. This board is built straight off
     cache/processed/scored_1980_2026.parquet, whose only minutes gate is
     peak3.regular_minutes_threshold (~12.2 MPG). Without the 25.0 MPG floor in
     scripts/build_top_seasons.py it would republish exactly the low-minute
     leakage the sibling PEAK Index board was just fixed for (see
     test_peak_index_serving_gate.py for that audit and its numbers).

These tests assert the SERVING/shape contract. They deliberately assert nothing
that would require recomputing a score: the board is a pure sort/projection of
already-official values, and the only score-adjacent assertions here are that
the published weight vector is still the official one and that the published
order is still descending.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SEASONS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_seasons.v1.json"
)

# Must match scripts/build_top_seasons.py::MIN_SERVED_SEASON_MPG, and the
# sibling board's MIN_SERVED_ANCHOR_MPG. Duplicated as a literal on purpose --
# if someone lowers the gate in the script, this should fail rather than
# silently follow it down.
EXPECTED_MIN_SEASON_MPG = 25.0

# Real players the audit found being served on thin-sample seasons on the
# sibling board. Each is a legitimate NBA player; the point is only that a
# sub-25-MPG season must not appear on a board of the best seasons ever.
AUDITED_LOW_MINUTE_PLAYERS = [
    "Luka Garza",
    "Gary Payton II",
    "Isaiah Hartenstein",
    "Luke Kornet",
]


@pytest.fixture(scope="module")
def seasons_payload() -> dict:
    if not SEASONS_PATH.exists():
        pytest.skip(
            f"{SEASONS_PATH.name} not generated -- run `python scripts/build_top_seasons.py`"
        )
    return json.loads(SEASONS_PATH.read_text())


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def served(client: TestClient, seasons_payload: dict) -> dict:
    response = client.get("/api/v1/seasons", params={"limit": 1000})
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Payload / response shape
# ---------------------------------------------------------------------------


def test_response_carries_the_provenance_a_reader_needs(served):
    """The board must be self-describing: which artifact, which formula, which
    universe, which minutes floor. A ranking a reader cannot attribute is not
    publishable."""
    assert served["dataset_version"] == "top_1000_seasons.v1"
    assert "statistical_impact=0.38" in served["formula_version"]
    assert served["supported_start_season"] == "1979-80"
    assert served["supported_end_season"] == "2025-26"
    assert served["universe_identity_count"] > 1000
    assert served["total_scored_seasons"] > served["universe_identity_count"]
    assert served["allows_repeated_players"] is True
    assert served["min_season_mpg"] == EXPECTED_MIN_SEASON_MPG
    assert served["serving_gate_note"]


def test_every_row_has_the_lean_table_fields(served):
    rows = served["rows"]
    assert rows, "the seasons board served zero rows"
    assert served["total_available"] == 1000
    for row in rows:
        for field in ("rank", "season_id", "player_slug", "player_name", "season", "prime_score"):
            assert row.get(field) is not None, f"rank {row['rank']} missing {field}"
        assert row["season_id"].endswith(row["season"].replace("-", ""))
        assert "1yr" in row["season_id"]


def test_ranks_are_dense_and_scores_descend(served):
    """A serving gate must not leave holes where an excluded row used to sit,
    and must not reorder what it keeps."""
    rows = served["rows"]
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
    scores = [r["prime_score"] for r in rows]
    assert scores == sorted(scores, reverse=True), "board is not in descending score order"
    indexes = [r["prime_index"] for r in rows]
    assert indexes == sorted(indexes, reverse=True), "raw ordering index is not descending"


def test_jordan_1990_91_is_the_number_one_season(served):
    """The top of the board is the single most visible claim the page makes,
    and it must match the same season the canonical 1Y board ranks first (see
    test_peak_index_serving_gate.py, which pins the identical row)."""
    top = served["rows"][0]
    assert top["player_name"] == "Michael Jordan"
    assert top["season"] == "1990-91"
    assert top["prime_score"] == pytest.approx(97.53, abs=0.01)


# ---------------------------------------------------------------------------
# The point of the board: repeated players
# ---------------------------------------------------------------------------


def test_repeated_players_are_present_by_design(served):
    """The distinguishing feature. Both other boards are best-window-per-player;
    if this one ever becomes one-row-per-player it has silently turned into a
    duplicate of /api/v1/peaks."""
    rows = served["rows"]
    names = [r["player_name"] for r in rows]
    assert len(set(names)) < len(names), "no player repeats -- the per-player cap leaked back in"

    top_50 = names[:50]
    repeated_slots = len(top_50) - len(set(top_50))
    assert repeated_slots > 10, (
        f"only {repeated_slots} of the top 50 slots are repeat appearances -- suspiciously few "
        "for a board where the greatest players held multiple all-time seasons"
    )

    jordan_top_50 = [n for n in top_50 if n == "Michael Jordan"]
    assert len(jordan_top_50) > 1, "Michael Jordan holds only one top-50 season"


def test_a_repeated_players_rows_are_distinct_seasons(served):
    """Repetition must come from different seasons, never from a duplicated
    row or a player-season split across team stints."""
    seen: set[tuple[str, str]] = set()
    ids: set[str] = set()
    for row in served["rows"]:
        key = (row["player_slug"], row["season"])
        assert key not in seen, f"duplicate row for {key}"
        seen.add(key)
        assert row["season_id"] not in ids, f"duplicate season_id {row['season_id']}"
        ids.add(row["season_id"])


# ---------------------------------------------------------------------------
# The minutes serving gate
# ---------------------------------------------------------------------------


def test_every_served_row_clears_the_minutes_floor(served):
    """The core invariant, asserted per row rather than trusting the summary
    counter, so a partially-regenerated artifact cannot pass."""
    for row in served["rows"]:
        mpg = row["season_mpg"]
        assert mpg is not None, (
            f"rank {row['rank']} ({row['player_name']} {row['season']}) has no season_mpg -- "
            "an unknown sample must never be served"
        )
        assert mpg >= EXPECTED_MIN_SEASON_MPG, (
            f"rank {row['rank']}: {row['player_name']} {row['season']} served at {mpg} MPG, "
            f"below the {EXPECTED_MIN_SEASON_MPG} floor"
        )


def test_the_gate_actually_excluded_something(served):
    """Guards against a gate that is present but inert (e.g. wired to a column
    that is always null)."""
    assert served["excluded_low_minute_seasons"] > 0, (
        "the minutes gate skipped zero seasons while filling the board -- the filter is "
        "probably inert"
    )


@pytest.mark.parametrize("player_name", AUDITED_LOW_MINUTE_PLAYERS)
def test_audited_low_minute_players_are_not_served(served, player_name):
    names = {r["player_name"] for r in served["rows"]}
    assert player_name not in names, (
        f"{player_name} is being served on the Single Seasons board -- the minutes gate regressed"
    )


# ---------------------------------------------------------------------------
# Formula provenance
# ---------------------------------------------------------------------------


def test_official_weights_are_intact_in_the_artifact(seasons_payload):
    """Belt-and-braces: prove this artifact still claims the official weight
    vector, so a serving/display change can never be mistaken for cover for a
    formula change."""
    weights = seasons_payload["official_weights"]
    assert weights["statistical_impact"] == pytest.approx(0.38)
    assert weights["traditional_production"] == pytest.approx(0.21)
    assert weights["recognition"] == pytest.approx(0.20)
    assert weights["postseason"] == pytest.approx(0.18)
    assert weights["team_achievement"] == pytest.approx(0.03)
    assert sum(weights.values()) == pytest.approx(1.0)


def test_every_explain_block_publishes_the_official_weight_per_component(seasons_payload):
    """The modal shows "contribution x weight" per component. A None weight
    there would render as a fabricated-looking blank, so the weight must be
    resolved for all five components on every row.

    Phase 9C: the per-component list moved to `component_detail` so that
    `components` could become the flat {key: contribution} dict both boards
    publish on the row AND in the explain block (one shared contract, one
    frontend normalizer). Both shapes are asserted here."""
    expected = {
        "statistical_impact": 0.38,
        "traditional_production": 0.21,
        "individual_recognition": 0.20,
        "postseason_individual_value": 0.18,
        "team_achievement": 0.03,
    }
    for season_id, block in seasons_payload["explain"].items():
        detail = {c["component"]: c["weight"] for c in block["component_detail"]}
        assert detail.keys() == expected.keys(), season_id
        for component, weight in expected.items():
            assert detail[component] == pytest.approx(weight), f"{season_id}/{component}"
        assert block["components"].keys() == expected.keys(), season_id
        assert block["weights"].keys() == expected.keys(), season_id


def test_explain_weights_are_read_from_official_weights_never_retyped(seasons_payload):
    """The published weight vector must be peak3.OFFICIAL_WEIGHTS itself, not a
    literal that can drift. Compared against the model's own dict, mapped
    through the two names that differ between the model and the web contract."""
    import peak3 as P

    key_map = {
        "statistical_impact": "statistical_impact",
        "traditional_production": "traditional_production",
        "individual_recognition": "recognition",
        "postseason_individual_value": "postseason",
        "team_achievement": "team_achievement",
    }
    for season_id, block in list(seasons_payload["explain"].items())[:50]:
        for web_key, model_key in key_map.items():
            assert block["weights"][web_key] == P.OFFICIAL_WEIGHTS[model_key], (
                f"{season_id}/{web_key}"
            )


# ---------------------------------------------------------------------------
# The explain route
# ---------------------------------------------------------------------------


def test_explain_route_returns_the_real_breakdown_for_one_season(client, served):
    """Fetched per row on modal open rather than shipped with the table (the
    explain blocks total ~3.4 MB)."""
    row = served["rows"][0]
    response = client.get(f"/api/v1/seasons/{row['season_id']}/explain")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["season_id"] == row["season_id"]

    block = body["explain"]
    assert block["player_name"] == row["player_name"]
    assert block["season"] == row["season"]
    assert block["rank"] == row["rank"]
    assert block["window_type"] == "single_season"
    assert block["prime_score"] == pytest.approx(row["prime_score"])
    assert block["season_mpg"] >= EXPECTED_MIN_SEASON_MPG

    # Real component values, not placeholders.
    contributions = [c["contribution"] for c in block["component_detail"]]
    assert all(c is not None for c in contributions)
    assert any(c > 0 for c in contributions)

    # The regular-season / non-regular-season split the modal uses to explain
    # the audited close calls must be internally consistent with the components.
    split = block["score_split"]
    by_name = block["components"]
    assert split["regular_season"] == pytest.approx(
        by_name["statistical_impact"] + by_name["traditional_production"], abs=0.01
    )
    assert split["non_regular_season"] == pytest.approx(
        by_name["postseason_individual_value"]
        + by_name["individual_recognition"]
        + by_name["team_achievement"],
        abs=0.01,
    )


def test_explain_route_404s_for_an_unserved_season(client):
    response = client.get("/api/v1/seasons/not-a-real-player-1yr-199091/explain")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "season_not_found"


def test_search_filters_by_player_and_by_season(client):
    by_player = client.get("/api/v1/seasons", params={"search": "jordan"}).json()
    assert by_player["rows"], "no rows for a search that should match Michael Jordan"
    assert all("jordan" in r["player_name"].lower() for r in by_player["rows"])
    assert len(by_player["rows"]) > 1, "search collapsed a repeated player's seasons"

    by_season = client.get("/api/v1/seasons", params={"search": "1990-91"}).json()
    assert by_season["rows"]
    assert all(
        r["season"] == "1990-91" or "1990-91" in r["player_name"].lower()
        for r in by_season["rows"]
    )


def test_pagination_is_a_stable_window_over_the_same_order(client):
    page_1 = client.get("/api/v1/seasons", params={"limit": 25, "offset": 0}).json()
    page_2 = client.get("/api/v1/seasons", params={"limit": 25, "offset": 25}).json()
    assert [r["rank"] for r in page_1["rows"]] == list(range(1, 26))
    assert [r["rank"] for r in page_2["rows"]] == list(range(26, 51))
    assert page_1["total_available"] == page_2["total_available"] == 1000


def test_margins_flag_sub_half_point_gaps_as_effectively_tied(client, served):
    """The audited near-ties (Embiid 2022-23 vs Howard 2008-09 are 0.03 raw
    points apart) are presented as ties rather than as confident orderings, so
    the flag has to be real and has to agree with the published threshold."""
    threshold = served["effective_tie_threshold"]
    assert threshold > 0

    embiid = next(
        r for r in served["rows"]
        if r["player_name"] == "Joel Embiid" and r["season"] == "2022-23"
    )
    block = client.get(f"/api/v1/seasons/{embiid['season_id']}/explain").json()["explain"]
    assert block["effective_tie_threshold"] == pytest.approx(threshold)

    neighbours = [m for m in block["margins"].values() if m is not None]
    assert neighbours, "a mid-board row must have adjacent-rank margins"
    for margin in neighbours:
        assert margin["effectively_tied"] == (margin["gap"] < threshold), (
            f"tie flag disagrees with the {threshold} threshold for {margin}"
        )

    howard = next(
        (m for m in neighbours if m["player_name"] == "Dwight Howard"), None
    )
    assert howard is not None, (
        "Embiid 2022-23 and Howard 2008-09 are 0.03 raw points apart and should be adjacent"
    )
    assert howard["effectively_tied"] is True


# ---------------------------------------------------------------------------
# Phase 9C: the shared two-board row contract
#
# The Peak Windows board shipped no component data at all, so the explain modal
# rendered "Not available for this view" for the entire breakdown. Fixing it
# meant defining ONE row shape both boards publish, so the frontend reads a row
# from either endpoint through one normalizer. These tests pin that shape on the
# Single Seasons side; test_peaks_rankings.py pins the identical shape on the
# other, and both assert the same invariants so the two cannot drift.
# ---------------------------------------------------------------------------

COMPONENT_KEYS = (
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
)


def test_every_row_carries_all_five_components_and_all_six_percentiles(served):
    """The single biggest complaint this closes: a table row with no component
    data cannot explain its own ordering."""
    for row in served["rows"]:
        components = row["components"]
        assert components is not None, f"rank {row['rank']} has no components"
        assert set(components) == set(COMPONENT_KEYS), row["rank"]
        assert all(v is not None for v in components.values()), row["rank"]

        percentiles = row["percentiles"]
        assert percentiles is not None, f"rank {row['rank']} has no percentiles"
        assert set(percentiles) == {*COMPONENT_KEYS, "total"}, row["rank"]
        assert all(v is not None for v in percentiles.values()), row["rank"]


def test_percentiles_are_bounded_zero_to_one_hundred(served):
    for row in served["rows"]:
        for key, value in row["percentiles"].items():
            assert 0.0 <= value <= 100.0, f"rank {row['rank']} {key} percentile = {value}"


def test_components_reconcile_to_the_published_ordering_index(served):
    """The five weighted contributions plus the teammate adjustment ARE the raw
    score; if they did not add up, the modal would be explaining a different
    number than the table ranks by. Asserted loosely (the teammate adjustment is
    only in the explain block) -- the point is that these are the real
    contributions, not decorative values."""
    for row in served["rows"][:50]:
        total = sum(row["components"].values())
        assert total > 0
        # Within the teammate-adjustment band of the raw index.
        assert abs(total - row["prime_index"]) < 25.0, (
            f"rank {row['rank']}: components sum to {total} but prime_index is {row['prime_index']}"
        )


def test_row_id_and_label_are_published_alongside_the_legacy_names(served):
    """`row_id`/`label` are the shared contract; `season_id`/`season` are the
    pre-9C names existing clients read. Both must be present and consistent, so
    neither a new nor an old client sees a blank."""
    for row in served["rows"]:
        assert row["row_id"] == row["season_id"], row["rank"]
        assert row["label"] == row["season"], row["rank"]
        assert row["mpg"] == row["season_mpg"], row["rank"]
        assert isinstance(row["data_completeness"], str) and row["data_completeness"]


def test_strongest_and_weakest_are_percentile_ranked_not_raw_ranked(client, served):
    """THE trap this guards. team_achievement is capped at a 3% weight, so it is
    almost always the numerically smallest contribution -- ranking by raw value
    would name it "the weakness" for literally every row on the board. Ranking by
    percentile is the only way the label means anything."""
    weakest_counts: dict[str, int] = {}
    strongest_counts: dict[str, int] = {}
    sample = served["rows"][:120]
    for row in sample:
        block = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]
        for key in block["weakest_components"]:
            weakest_counts[key] = weakest_counts.get(key, 0) + 1
        for key in block["strongest_components"]:
            strongest_counts[key] = strongest_counts.get(key, 0) + 1

        # And the labels must agree with the percentiles they claim to rank by.
        percentiles = block["percentiles"]
        strongest = block["strongest_components"]
        weakest = block["weakest_components"]
        if strongest and weakest:
            assert min(percentiles[k] for k in strongest) >= max(
                percentiles[k] for k in weakest
            ), f"{row['row_id']}: strongest/weakest disagree with the percentiles"

    assert weakest_counts.get("team_achievement", 0) < len(sample), (
        "team_achievement is in EVERY row's weakest components -- strongest/weakest is being "
        "ranked by raw contribution instead of by percentile"
    )
    # A percentile ranking should spread across components, not collapse.
    assert len(weakest_counts) >= 3, weakest_counts
    assert len(strongest_counts) >= 3, strongest_counts


# ---------------------------------------------------------------------------
# Phase 9C: comparison rails
# ---------------------------------------------------------------------------


def test_explain_publishes_all_three_comparison_rails(client, served):
    row = served["rows"][0]
    block = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]
    comparisons = block["comparisons"]
    for rail in ("same_player", "similar_scores", "same_season_peers"):
        assert rail in comparisons, rail
        for entry in comparisons[rail]:
            # Every entry must be pivotable -- that is the whole point.
            assert entry["row_id"], f"{rail} entry with no row_id"
            assert entry["row_id"] != row["row_id"], f"{rail} includes the row itself"
            assert entry["rank"] >= 1


def test_comparisons_are_deterministic_across_two_calls(client, served):
    """The rails are generated offline and served verbatim, so two calls must
    return byte-identical lists. A dict-ordering or unstable-sort regression
    would show up here as a reordered list."""
    row = served["rows"][250]
    first = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]["comparisons"]
    second = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]["comparisons"]
    assert first == second


def test_same_player_rail_returns_multiple_kobe_seasons_for_a_kobe_row(client, served):
    """The rail that makes the audited Kobe 2007-08 vs 2005-06 controversy
    explorable at all, and only possible on this board because this board allows
    a player to repeat."""
    kobe = next(
        r for r in served["rows"]
        if r["player_slug"] == "kobe-bryant" and r["season"] == "2007-08"
    )
    block = client.get(f"/api/v1/seasons/{kobe['row_id']}/explain").json()["explain"]
    same_player = block["comparisons"]["same_player"]
    assert len(same_player) > 1, "a Kobe row must offer his other served seasons"
    assert all(e["row_id"].startswith("kobe-bryant-") for e in same_player)
    assert "kobe-bryant-1yr-200506" in {e["row_id"] for e in same_player}, (
        "the 2005-06 season the audit contrasts with 2007-08 is not reachable from the modal"
    )
    # Sorted by prime_score desc, per the documented rule.
    scores = [e["prime_score"] for e in same_player]
    assert scores == sorted(scores, reverse=True)


def test_similar_scores_excludes_the_same_player_and_is_rank_tiebroken(client, served):
    row = served["rows"][100]
    block = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]
    similar = block["comparisons"]["similar_scores"]
    assert similar, "a mid-board row must have nearest-score neighbours"
    assert len(similar) <= 6
    assert all(not e["row_id"].startswith(row["player_slug"] + "-") for e in similar), (
        "similar_scores must exclude the same player -- that is what same_player is for"
    )
    # Nearest-first by the documented sort key: the RAW index gap, which is what
    # the board is ranked on. (The calibrated `delta` is monotone with it but not
    # identical, so asserting on `delta` would be asserting the wrong contract.)
    gaps = [abs(e["index_delta"]) for e in similar]
    assert gaps == sorted(gaps)


def test_same_season_peers_are_non_empty_and_share_the_season(client, served):
    row = next(r for r in served["rows"] if r["season"] == "1990-91" and r["rank"] > 1)
    block = client.get(f"/api/v1/seasons/{row['row_id']}/explain").json()["explain"]
    peers = block["comparisons"]["same_season_peers"]
    assert peers, "1990-91 has many served seasons; the peer rail must not be empty"
    assert len(peers) <= 6, "the rail is capped at _MAX_SEASON_PEERS"
    # The rail means "the best seasons of this year", so it must be ordered by
    # score descending -- not by nearness to the row being explained, which is
    # what it used to do and what made the year's leaders droppable.
    scores = [e["prime_score"] for e in peers]
    assert scores == sorted(scores, reverse=True), (
        f"same_season_peers must be best-first, got {scores}"
    )
    suffix = row["season"].replace("-", "")
    assert all(e["row_id"].endswith(suffix) for e in peers), (
        "same_season_peers must all be from the same NBA season"
    )


# ---------------------------------------------------------------------------
# Phase 9C: honesty about missing context
# ---------------------------------------------------------------------------


def test_a_row_missing_optional_context_still_serializes(client, served):
    """Pre-1996 seasons have no DPOY vote share and many rows have no awards
    string. Those must arrive as null and the row must still validate -- never a
    zero, never a 500 (CLAUDE.md: never replace missing data with fabricated
    values)."""
    checked = 0
    for row in served["rows"]:
        response = client.get(f"/api/v1/seasons/{row['row_id']}/explain")
        assert response.status_code == 200, row["row_id"]
        block = response.json()["explain"]
        nulls = [
            block["recognition"]["awards"],
            block["recognition"]["dpoy_vote_share"],
            block["season_stats"]["ppg"],
        ]
        if any(v is None for v in nulls):
            checked += 1
            # A partially-null context block must not have suppressed the parts
            # that ARE real.
            assert block["components"], row["row_id"]
            assert block["season_stats"]["games"] is not None, row["row_id"]
        if checked >= 5:
            break
    assert checked >= 1, "no row with a null optional context field was found to exercise"


def test_per_game_stats_are_null_rather_than_reconstructed(seasons_payload):
    """The scored dataset stores per-75/per-100 rates, not per-game. ppg/rpg/apg
    are published as null with the real rates alongside them; back-solving a
    per-game number from a rate would be exactly the fabrication CLAUDE.md
    forbids."""
    assert seasons_payload["per_game_stats_note"]
    for season_id, block in list(seasons_payload["explain"].items())[:25]:
        stats = block["season_stats"]
        assert stats["ppg"] is None and stats["rpg"] is None and stats["apg"] is None, season_id
        assert stats["pts_per_75"] is not None, season_id
        assert stats["games"] is not None and stats["mpg"] is not None, season_id
