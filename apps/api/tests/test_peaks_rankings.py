"""Phase 9C: the Peak Windows board's component + explainability contract.

WHY THIS FILE EXISTS. The Peak Windows board published rank/slug/name/window/
anchor/team/prime_score/completeness and NOTHING else -- no component
contributions, no percentiles, no per-row identifier. The explainability modal
therefore rendered "Not available for this view" for the entire component
breakdown, which was the single biggest complaint about the rankings surface: an
ordering the page could not explain.

The data was never missing. nba_peak.leaderboards.build_leaderboard() already
returns every official weighted contribution for every window it publishes
("SI contribution" / "Avg SI contribution", ...) -- scripts/build_top_peaks.py
was discarding all of them. Nothing new is computed anywhere: the contributions
are peak3.nyear_window_decomposition's own output and the only derived numbers
are percentile RANKS of those real contributions within the served board.

What these tests lock down:

  1. The shared two-board row contract. Both this board and /api/v1/seasons must
     publish the same row shape (row_id, label, components, percentiles, mpg,
     data_completeness) so the frontend reads either through ONE normalizer.
     test_seasons_rankings.py asserts the identical invariants on the other side;
     if the two ever drift, both files fail.

  2. strongest/weakest ranked by PERCENTILE, never by raw contribution.
     team_achievement is capped at a 3% weight, so it is almost always the
     numerically smallest contribution -- raw ranking would name it "the
     weakness" for literally every row on the board. This is asserted
     statistically, not anecdotally.

  3. Determinism. The comparison rails are generated offline and served
     verbatim, so two calls must return identical lists; an unstable sort would
     make the modal's "similar scores" reshuffle between opens.

  4. Honesty about missing context. The scored dataset has no per-game
     columns and no pre-1996 DPOY vote share; those arrive as null and the row
     still validates. Nothing is ever zero-filled (CLAUDE.md: never replace
     missing data with fabricated values).

The Phase 9B serving-gate invariants live in test_peak_index_serving_gate.py and
are deliberately NOT duplicated here.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import peak3 as P  # noqa: E402

PEAKS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
)

WINDOWS = ("1y", "3y", "5y")

COMPONENT_KEYS = (
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
)

# The web contract's component names mapped to peak3.OFFICIAL_WEIGHTS' own keys.
# Two of the five differ; the mapping is spelled out so the assertion compares
# against the model's dict rather than against re-typed literals.
OFFICIAL_WEIGHT_KEYS = {
    "statistical_impact": "statistical_impact",
    "traditional_production": "traditional_production",
    "individual_recognition": "recognition",
    "postseason_individual_value": "postseason",
    "team_achievement": "team_achievement",
}


@pytest.fixture(scope="module")
def peaks_payload() -> dict:
    if not PEAKS_PATH.exists():
        pytest.skip(f"{PEAKS_PATH.name} not generated -- run `python scripts/build_top_peaks.py`")
    return json.loads(PEAKS_PATH.read_text())


@pytest.fixture(scope="module")
def client(peaks_payload: dict) -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def boards(client: TestClient) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for window in WINDOWS:
        response = client.get("/api/v1/peaks", params={"window": window, "limit": 1000})
        assert response.status_code == 200, response.text
        out[window] = response.json()
    return out


# ---------------------------------------------------------------------------
# The shared two-board row contract
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("window", WINDOWS)
def test_every_row_carries_all_five_components(boards, window):
    """The defect this closes. A row with no component data cannot explain its
    own ordering, and the modal had nothing to render."""
    rows = boards[window]["rows"]
    assert rows, f"{window} served zero rows"
    for row in rows:
        components = row["components"]
        assert components is not None, f"{window} rank {row['rank']} has no components"
        assert set(components) == set(COMPONENT_KEYS), f"{window} rank {row['rank']}"
        assert all(v is not None for v in components.values()), f"{window} rank {row['rank']}"
        assert any(v > 0 for v in components.values()), f"{window} rank {row['rank']}"


@pytest.mark.parametrize("window", WINDOWS)
def test_every_row_carries_all_six_percentiles_bounded_zero_to_one_hundred(boards, window):
    for row in boards[window]["rows"]:
        percentiles = row["percentiles"]
        assert percentiles is not None, f"{window} rank {row['rank']} has no percentiles"
        assert set(percentiles) == {*COMPONENT_KEYS, "total"}, f"{window} rank {row['rank']}"
        for key, value in percentiles.items():
            assert value is not None, f"{window} rank {row['rank']} {key} percentile is null"
            assert 0.0 <= value <= 100.0, (
                f"{window} rank {row['rank']} {key} percentile = {value}, outside 0-100"
            )


@pytest.mark.parametrize("window", WINDOWS)
def test_the_total_percentile_tracks_the_published_ordering(boards, window):
    """A percentile of the total must be monotone with rank -- if it were not,
    it would be ranking something other than the score the board is sorted by."""
    totals = [row["percentiles"]["total"] for row in boards[window]["rows"]]
    assert totals == sorted(totals, reverse=True), f"{window} total percentile is not monotone"
    assert totals[0] == pytest.approx(100.0)


@pytest.mark.parametrize("window", WINDOWS)
def test_rows_carry_row_id_label_and_mpg_alongside_the_legacy_names(boards, window):
    """`row_id`/`label`/`mpg` are the shared contract; `window_label`/
    `anchor_season`/`anchor_season_mpg` are the pre-9C names existing clients
    read. Both must be present so neither a new nor an old client sees a blank."""
    n = int(window[0])
    for row in boards[window]["rows"]:
        row_id = row["row_id"]
        assert row_id, f"{window} rank {row['rank']} has no row_id"
        expected = f"{row['player_slug']}-{n}yr-{row['anchor_season'].replace('-', '')}"
        assert row_id == expected, f"{window} rank {row['rank']}: {row_id} != {expected}"
        assert row["window"] == window
        assert row["mpg"] == row["anchor_season_mpg"]
        assert row["prime_index"] is not None
        assert isinstance(row["data_completeness"], str) and row["data_completeness"]

        if n == 1:
            assert row["label"] == row["anchor_season"]
        else:
            # A window's label is its human span, not the generator's compact
            # "1988-89-1990-91" form, which reads as an ambiguous date range.
            assert " to " in row["label"], f"{window} rank {row['rank']} label={row['label']!r}"
            start, end = row["label"].split(" to ")
            assert len(start) == 7 and len(end) == 7
            assert end >= start


def test_row_ids_are_unique_across_all_three_duration_boards(boards):
    """One explain route serves all three boards, so a collision between a 1Y
    and a 3Y row would silently serve the wrong breakdown."""
    seen: dict[str, str] = {}
    for window in WINDOWS:
        for row in boards[window]["rows"]:
            assert row["row_id"] not in seen, (
                f"{row['row_id']} appears in both {seen.get(row['row_id'])} and {window}"
            )
            seen[row["row_id"]] = window


def test_the_table_payload_stays_lean(boards):
    """Payload discipline: the explain blocks live in the same generated
    artifact but must NEVER ride along with the table -- the rankings page would
    otherwise pay ~18 MB for a modal most visitors never open."""
    heavy = {
        "explain",
        "comparisons",
        "component_detail",
        "season_stats",
        "recognition",
        "postseason",
        "team_context",
        "role_and_sample",
        "caveats",
        "score_split",
        "weights",
    }
    for window in WINDOWS:
        assert "explain" not in boards[window], f"{window} response shipped the explain blocks"
        for row in boards[window]["rows"]:
            leaked = heavy & set(row)
            assert not leaked, f"{window} rank {row['rank']} leaked heavy fields: {leaked}"


# ---------------------------------------------------------------------------
# The explain route
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("window", WINDOWS)
def test_explain_route_returns_the_real_breakdown_for_a_known_row(client, boards, window):
    row = boards[window]["rows"][0]
    response = client.get(f"/api/v1/peaks/{row['row_id']}/explain")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["row_id"] == row["row_id"]

    block = body["explain"]
    assert block["player_name"] == row["player_name"]
    assert block["rank"] == row["rank"]
    assert block["label"] == row["label"]
    assert block["window_type"] == f"{window[0]}Y"
    assert block["prime_score"] == pytest.approx(row["prime_score"])
    assert block["components"] == row["components"]
    assert block["percentiles"] == row["percentiles"]
    assert block["anchor_season_mpg"] == row["anchor_season_mpg"]

    # The window's seasons, and the anchor among them.
    seasons = block["seasons_in_window"]
    assert len(seasons) == int(window[0]), f"{window}: {seasons}"
    assert row["anchor_season"] in seasons

    # The regular-season / non-regular-season split must reconcile with the
    # same official contributions the block publishes.
    split = block["score_split"]
    components = block["components"]
    assert split["regular_season"] == pytest.approx(
        components["statistical_impact"] + components["traditional_production"], abs=0.01
    )
    assert split["postseason"] == pytest.approx(components["postseason_individual_value"], abs=0.01)
    assert split["recognition"] == pytest.approx(components["individual_recognition"], abs=0.01)
    assert split["team"] == pytest.approx(components["team_achievement"], abs=0.01)
    assert split["non_regular_season"] == pytest.approx(
        components["postseason_individual_value"]
        + components["individual_recognition"]
        + components["team_achievement"],
        abs=0.01,
    )


def test_explain_route_404s_with_a_stable_error_code_for_garbage(client):
    for bogus in ("not-a-real-player-1yr-199091", "garbage", "michael-jordan-9yr-199091"):
        response = client.get(f"/api/v1/peaks/{bogus}/explain")
        assert response.status_code == 404, bogus
        assert response.json()["detail"]["error_code"] == "peak_row_not_found", bogus


def test_explain_weights_equal_official_weights_exactly(client, boards):
    """THE authoritative weight vector, read out of peak3.OFFICIAL_WEIGHTS by
    the generator and never re-typed as a literal in TypeScript or in the API
    layer. Compared here against the model's own dict."""
    for window in WINDOWS:
        for row in boards[window]["rows"][:20]:
            block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
            weights = block["weights"]
            assert set(weights) == set(COMPONENT_KEYS), row["row_id"]
            for web_key, model_key in OFFICIAL_WEIGHT_KEYS.items():
                assert weights[web_key] == P.OFFICIAL_WEIGHTS[model_key], (
                    f"{row['row_id']}/{web_key}"
                )
            assert sum(weights.values()) == pytest.approx(1.0)


def test_explain_component_detail_pairs_each_contribution_with_its_weight(client, boards):
    """The modal's bar chart needs contribution, weight and percentile per
    component. A None weight would render as a fabricated-looking blank."""
    row = boards["3y"]["rows"][5]
    block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
    detail = {c["component"]: c for c in block["component_detail"]}
    assert set(detail) == set(COMPONENT_KEYS)
    for key, entry in detail.items():
        assert entry["contribution"] == pytest.approx(row["components"][key])
        assert entry["percentile"] == pytest.approx(row["percentiles"][key])
        assert entry["weight"] == P.OFFICIAL_WEIGHTS[OFFICIAL_WEIGHT_KEYS[key]]


# ---------------------------------------------------------------------------
# strongest / weakest: percentile-ranked, never raw-ranked
# ---------------------------------------------------------------------------


def test_strongest_and_weakest_are_percentile_ranked_not_raw_ranked(peaks_payload):
    """THE trap. team_achievement is capped at a 3% weight, so it is almost
    always the numerically SMALLEST contribution -- ranking weakest by raw value
    would name it the weakness for literally every row on the board, which is
    both useless and misleading. Asserted over the whole artifact rather than one
    row, because a single row cannot distinguish the two rankings."""
    explain = peaks_payload["explain"]
    assert explain, "the artifact carries no explain blocks"

    weakest_counts: dict[str, int] = {}
    strongest_counts: dict[str, int] = {}
    raw_weakest_matches = 0
    for block in explain.values():
        for key in block["weakest_components"]:
            weakest_counts[key] = weakest_counts.get(key, 0) + 1
        for key in block["strongest_components"]:
            strongest_counts[key] = strongest_counts.get(key, 0) + 1

        # The labels must agree with the percentiles they claim to rank by.
        percentiles = block["percentiles"]
        strongest = block["strongest_components"]
        weakest = block["weakest_components"]
        assert min(percentiles[k] for k in strongest) >= max(percentiles[k] for k in weakest), (
            f"{block['row_id']}: strongest/weakest disagree with the published percentiles"
        )

        # How often the naive raw ranking would have agreed. If the code were
        # raw-ranked, this would be 100%.
        raw_order = sorted(COMPONENT_KEYS, key=lambda k: block["components"][k])
        if set(raw_order[:2]) == set(weakest):
            raw_weakest_matches += 1

    total = len(explain)
    assert weakest_counts.get("team_achievement", 0) < total, (
        "team_achievement is in EVERY row's weakest components -- strongest/weakest is being "
        "ranked by raw contribution instead of by percentile"
    )
    assert raw_weakest_matches < total, (
        "the weakest pair matches a raw-contribution ranking for every single row -- the "
        "percentile ranking is not actually being used"
    )
    # A percentile ranking spreads across components instead of collapsing onto
    # the lowest-weight one.
    assert len(weakest_counts) >= 4, weakest_counts
    assert len(strongest_counts) >= 4, strongest_counts


# ---------------------------------------------------------------------------
# Comparison rails
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("window", WINDOWS)
def test_explain_publishes_all_three_comparison_rails(client, boards, window):
    row = boards[window]["rows"][10]
    block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
    comparisons = block["comparisons"]
    for rail in ("same_player", "similar_scores", "same_season_peers"):
        assert rail in comparisons, rail
        for entry in comparisons[rail]:
            # Every entry must be pivotable -- that is the whole point of the
            # rail, and a modal that cannot navigate is just more text.
            assert entry["row_id"], f"{window}/{rail} entry with no row_id"
            assert entry["row_id"] != row["row_id"], f"{window}/{rail} includes the row itself"
            assert entry["rank"] >= 1


def test_every_comparison_target_is_a_real_served_row(peaks_payload):
    """A row_id in a rail that no explain block answers would 404 the modal
    mid-pivot."""
    explain = peaks_payload["explain"]
    known = set(explain)
    for row_id, block in explain.items():
        for rail, entries in block["comparisons"].items():
            for entry in entries:
                assert entry["row_id"] in known, (
                    f"{row_id}/{rail} points at {entry['row_id']}, which is not served"
                )


def test_comparisons_are_deterministic_across_two_calls(client, boards):
    """The rails are generated offline and served verbatim, so two calls must
    return identical lists. An unstable sort would make "similar scores"
    reshuffle every time the modal opens."""
    for window in WINDOWS:
        row = boards[window]["rows"][100]
        first = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]["comparisons"]
        second = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]["comparisons"]
        assert first == second, window


def test_same_player_rail_reaches_kobes_other_peak_windows(client, boards):
    """On this board a player holds at most ONE row per duration
    (build_leaderboard is best-window-per-player), so the same_player rail spans
    durations -- that is what makes "Kobe's best single season vs his best
    three-year run" explorable at all. The seasons board's own multi-season rail
    is asserted in test_seasons_rankings.py."""
    kobe = next(r for r in boards["1y"]["rows"] if r["player_slug"] == "kobe-bryant")
    block = client.get(f"/api/v1/peaks/{kobe['row_id']}/explain").json()["explain"]
    same_player = block["comparisons"]["same_player"]
    assert len(same_player) > 1, "a Kobe row must reach his other served peak windows"
    assert all(e["row_id"].startswith("kobe-bryant-") for e in same_player)
    windows = {e["window"] for e in same_player}
    # 2y joined the served boards; the rail must reach it too, because that rail
    # is the only route from a player's 1Y row to their 2Y window.
    assert windows == {"2y", "3y", "5y"}, (
        f"expected Kobe's 2Y, 3Y and 5Y windows to be reachable from his 1Y row, got {windows}"
    )
    # Sorted by prime_score desc, per the documented rule.
    scores = [e["prime_score"] for e in same_player]
    assert scores == sorted(scores, reverse=True)


def test_similar_scores_excludes_the_same_player_and_stays_within_the_duration(client, boards):
    """Comparing a 1Y score to a 5Y score is not comparing like with like, so
    the nearest-score rail is scoped to the same duration board."""
    for window in WINDOWS:
        row = boards[window]["rows"][200] if len(boards[window]["rows"]) > 200 else boards[window]["rows"][-1]
        block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
        similar = block["comparisons"]["similar_scores"]
        assert similar, f"{window}: a mid-board row must have nearest-score neighbours"
        assert len(similar) <= 6, window
        marker = f"-{window[0]}yr-"
        for entry in similar:
            assert marker in entry["row_id"], f"{window}: {entry['row_id']} is a different duration"
            assert not entry["row_id"].startswith(row["player_slug"] + "-"), (
                "similar_scores must exclude the same player -- that is what same_player is for"
            )
        # Nearest-first by the documented sort key: the RAW index gap, which is
        # what the board is ranked on. (The calibrated `delta` is monotone with
        # it but not identical, so asserting on `delta` would be asserting the
        # wrong contract.)
        gaps = [abs(entry["index_delta"]) for entry in similar]
        assert gaps == sorted(gaps), window


def test_same_season_peers_are_non_empty_and_share_the_anchor_season(client, boards):
    """For a window, "peers" means rows sharing the ANCHOR season -- the season
    whose context the modal is showing."""
    row = next(
        r for r in boards["1y"]["rows"]
        if r["anchor_season"] == "1990-91" and r["rank"] > 1
    )
    block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
    peers = block["comparisons"]["same_season_peers"]
    assert peers, "1990-91 anchors many served windows; the peer rail must not be empty"
    assert len(peers) <= 5
    suffix = row["anchor_season"].replace("-", "")
    assert all(e["row_id"].endswith(suffix) for e in peers), (
        "same_season_peers must all share the anchor season"
    )
    assert all(e["player_name"] != row["player_name"] for e in peers)


# ---------------------------------------------------------------------------
# Honesty about anchor-season context and missing data
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("window", ("3y", "5y"))
def test_multi_year_windows_label_their_context_as_anchor_season_only(client, boards, window):
    """The parquet has no window-averaged box score, so a window's context
    blocks are the ANCHOR season's row. Presenting that as a multi-season average
    would be a quiet fabrication, so every multi-year block says so in a caveat
    and every context block names the season it came from."""
    row = boards[window]["rows"][3]
    block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
    assert any("ANCHOR season" in c for c in block["caveats"]), block["caveats"]
    for key in ("season_stats", "recognition", "postseason", "team_context", "role_and_sample"):
        assert block[key]["season"] == row["anchor_season"], key
    assert block["season_stats"]["is_anchor_season_only"] is True


def test_single_season_windows_carry_no_anchor_only_caveat(client, boards):
    row = boards["1y"]["rows"][3]
    block = client.get(f"/api/v1/peaks/{row['row_id']}/explain").json()["explain"]
    assert not any("ANCHOR season" in c for c in block["caveats"]), block["caveats"]
    assert block["season_stats"]["is_anchor_season_only"] is False


def test_a_row_missing_optional_context_still_serializes(client, boards):
    """Pre-1996 seasons have no DPOY vote share and many windows have no awards
    string. Those must arrive as null and the row must still validate -- never a
    zero, never a 500 (CLAUDE.md: never replace missing data with fabricated
    values)."""
    checked = 0
    for row in boards["5y"]["rows"]:
        response = client.get(f"/api/v1/peaks/{row['row_id']}/explain")
        assert response.status_code == 200, row["row_id"]
        block = response.json()["explain"]
        optional = [
            block["recognition"]["awards"],
            block["recognition"]["dpoy_vote_share"],
            block["season_stats"]["ppg"],
        ]
        if any(value is None for value in optional):
            checked += 1
            # A partially-null context block must not have suppressed the parts
            # that ARE real.
            assert block["components"], row["row_id"]
            assert block["season_stats"]["games"] is not None, row["row_id"]
            assert block["percentiles"]["total"] is not None, row["row_id"]
        if checked >= 5:
            break
    assert checked >= 1, "no row with a null optional context field was found to exercise"


def test_per_game_stats_are_null_rather_than_reconstructed(peaks_payload):
    """The scored dataset stores per-75/per-100 rates, not per-game. ppg/rpg/apg
    are published as null with the real rates alongside them; back-solving a
    per-game number from a rate would be exactly the fabrication CLAUDE.md
    forbids."""
    assert peaks_payload["per_game_stats_note"]
    for row_id, block in list(peaks_payload["explain"].items())[:25]:
        stats = block["season_stats"]
        assert stats["ppg"] is None and stats["rpg"] is None and stats["apg"] is None, row_id
        assert stats["pts_per_75"] is not None, row_id
        assert stats["games"] is not None and stats["mpg"] is not None, row_id


def test_artifact_documents_its_row_id_and_percentile_methods(peaks_payload):
    """A percentile is a rank of already-official contributions, never a new
    score -- the artifact has to say so, because a reader who mistakes it for a
    score has misread the whole board."""
    assert peaks_payload["row_id_convention"] == "{player_slug}-{n}yr-{anchor_season_no_dashes}"
    assert "rank(pct=True)" in peaks_payload["percentile_method"]
    assert "never a new score" in peaks_payload["percentile_method"]
    assert peaks_payload["explain_note"]
    assert len(peaks_payload["explain"]) == sum(
        window["row_count"] for window in peaks_payload["windows"].values()
    ), "every served row must have exactly one explain block"


def test_response_surfaces_the_serving_gate_for_the_ui_to_state(boards):
    for window in WINDOWS:
        board = boards[window]
        assert board["min_anchor_season_mpg"] == 25.0, window
        assert board["excluded_low_minute_windows"] > 0, window
        assert board["serving_gate_note"], window
