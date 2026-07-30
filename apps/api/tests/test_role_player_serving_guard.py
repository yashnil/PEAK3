"""Phase 10D: role-aware guards on both served PEAK Index boards.

`test_peak_index_serving_gate.py` and `test_seasons_rankings.py` already assert
the raw `MIN_SERVED_ANCHOR_MPG` / `MIN_SERVED_SEASON_MPG` floor. These tests
assert the thing that floor was a PROXY for: that no season the model itself
classifies as a bench role is published as a ranked PEAK Index entry.

Why that is not the same assertion. `peak3.classify_roles` labels a season
"Low-minute specialist" when `mpg_pct < 35 OR mp_pct < 22` -- ERA-RELATIVE
minutes percentiles, not raw MPG. So the role label catches two populations a
flat 25.0 cannot: a player above 25 MPG who is still bottom-third for minutes
in a high-minute era, and an injury-shortened season with a healthy per-game
average but very few total minutes. If the two ever disagree, this file fails
and the raw-MPG tests still pass.

Phase 9B's own recommended-guards list asked for exactly this and it was never
written. It also noted that `tests/test_validation.py`'s existing role guard
only inspected the top 50, which is why Daniel Gafford (164) and Gary Payton II
(194) went undetected; the model-side companion to this file now reaches 250.

These guards are deliberately CATEGORICAL rather than a list of named players.
Phase 9B's hardcoded controls (Harrell/Hartenstein/Capela/Splitter) could not
catch Luka Garza, because Garza was not on the list -- and the next one will
not be either.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
POOL_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
PEAKS_PATH = POOL_DIR / "top_1000_peaks.v1.json"
SEASONS_PATH = POOL_DIR / "top_1000_seasons.v1.json"
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"

BENCH_ROLE = "Low-minute specialist"

pytestmark = pytest.mark.skipif(
    not (PEAKS_PATH.exists() and SEASONS_PATH.exists() and SCORED_PATH.exists()),
    reason="requires the generated ranking artifacts and the scored parquet",
)


@pytest.fixture(scope="module")
def role_by_player_season() -> dict[tuple[str, str], str]:
    import pandas as pd

    scored = pd.read_parquet(SCORED_PATH, columns=["player", "season", "role", "mpg"])
    return {(r.player, r.season): r.role for r in scored.itertuples(index=False)}


@pytest.fixture(scope="module")
def mpg_by_player_season() -> dict[tuple[str, str], float]:
    import pandas as pd

    scored = pd.read_parquet(SCORED_PATH, columns=["player", "season", "mpg"])
    return {(r.player, r.season): float(r.mpg) for r in scored.itertuples(index=False)}


@pytest.fixture(scope="module")
def peaks_payload() -> dict:
    return json.loads(PEAKS_PATH.read_text())


@pytest.fixture(scope="module")
def seasons_payload() -> dict:
    return json.loads(SEASONS_PATH.read_text())


def _peak_rows(payload: dict):
    for window, block in payload["windows"].items():
        for row in block["rows"]:
            yield window, row


# ---------------------------------------------------------------------------
# The categorical guard
# ---------------------------------------------------------------------------

def test_no_bench_role_season_is_served_on_the_peaks_board(peaks_payload, role_by_player_season):
    offenders = [
        (window, row["rank"], row["player_name"], row["anchor_season"])
        for window, row in _peak_rows(peaks_payload)
        if role_by_player_season.get((row["player_name"], row["anchor_season"])) == BENCH_ROLE
    ]
    assert offenders == [], (
        "seasons the model itself classifies as bench roles are being published "
        f"as ranked peak windows: {offenders[:10]}"
    )


def test_no_bench_role_season_is_served_on_the_seasons_board(seasons_payload, role_by_player_season):
    offenders = [
        (row["rank"], row["player_name"], row["season"])
        for row in seasons_payload["rows"]
        if role_by_player_season.get((row["player_name"], row["season"])) == BENCH_ROLE
    ]
    assert offenders == [], (
        f"bench-role seasons published on the single-season board: {offenders[:10]}"
    )


def test_the_guard_is_not_vacuous(role_by_player_season):
    """A categorical guard that matches nothing in the source data would pass
    forever without asserting anything. The bench-role population must be
    large in the parquet -- it is only absent from the SERVED boards."""
    bench = [k for k, v in role_by_player_season.items() if v == BENCH_ROLE]
    assert len(bench) > 500, (
        f"only {len(bench)} bench-role seasons exist in the scored parquet; if "
        "classify_roles changed its labels, these guards stopped testing anything"
    )


def test_every_served_row_resolves_to_a_real_scored_season(
    peaks_payload, seasons_payload, role_by_player_season
):
    """The guards above silently pass for any row whose (player, season) key
    fails to resolve, since `.get()` returns None. This pins that the join
    actually lands."""
    unresolved_peaks = [
        (row["player_name"], row["anchor_season"])
        for _, row in _peak_rows(peaks_payload)
        if (row["player_name"], row["anchor_season"]) not in role_by_player_season
    ]
    unresolved_seasons = [
        (row["player_name"], row["season"])
        for row in seasons_payload["rows"]
        if (row["player_name"], row["season"]) not in role_by_player_season
    ]
    assert unresolved_peaks == [], f"peaks rows not found in the parquet: {unresolved_peaks[:5]}"
    assert unresolved_seasons == [], f"seasons rows not found in the parquet: {unresolved_seasons[:5]}"


# ---------------------------------------------------------------------------
# Named cases from the Phase 9B / 10D audits
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("player_name", [
    "Luka Garza", "Gary Payton II", "Daniel Gafford", "Luke Kornet",
])
def test_audited_bench_players_are_absent_from_both_boards(
    player_name, peaks_payload, seasons_payload
):
    """These five were the reported symptom. Kept as an explicit, readable
    regression alongside the categorical guard -- not as a substitute for it."""
    on_peaks = [r["rank"] for _, r in _peak_rows(peaks_payload) if r["player_name"] == player_name]
    on_seasons = [r["rank"] for r in seasons_payload["rows"] if r["player_name"] == player_name]
    assert on_peaks == [], f"{player_name} served on the peaks board at rank(s) {on_peaks}"
    assert on_seasons == [], f"{player_name} served on the seasons board at rank(s) {on_seasons}"


def test_isaiah_hartenstein_is_only_served_for_starter_workload_seasons(
    peaks_payload, seasons_payload, mpg_by_player_season
):
    """Hartenstein is a hardcoded negative control in
    tests/test_validation.py::ROLE_CONTROLS AND was being served at rank 212
    above Deandre Ayton -- Phase 9B's tidiest illustration that the guard
    existed but was not wired to the surface users see.

    He is NOT banned outright: his 25-28 MPG seasons are legitimate rotation
    starter workloads. What must never be served again is a sub-gate season.
    """
    served = [
        (r["player_name"], r["anchor_season"]) for _, r in _peak_rows(peaks_payload)
        if r["player_name"] == "Isaiah Hartenstein"
    ] + [
        (r["player_name"], r["season"]) for r in seasons_payload["rows"]
        if r["player_name"] == "Isaiah Hartenstein"
    ]
    for key in served:
        assert mpg_by_player_season[key] >= peaks_payload["min_anchor_season_mpg"], (
            f"Hartenstein {key[1]} served at {mpg_by_player_season[key]:.1f} MPG"
        )


# ---------------------------------------------------------------------------
# Ranking universe vs candidate universe
# ---------------------------------------------------------------------------

def test_roster_only_candidates_may_exist_without_being_ranked():
    """The two universes are deliberately different, and this is the test that
    says so. Gary Payton II legitimately belongs in the CourtBuilder candidate
    manifest (he was a real championship rotation player, which 82-0 needs for
    historically accurate rosters) AND legitimately does not belong in a
    ranked peak-value index at 17.6 MPG. A future change that "fixes" one by
    collapsing it into the other should fail here."""
    manifest = json.loads((POOL_DIR / "candidate_identity_manifest.v1.json").read_text())
    slugs = {i["player_slug"] for i in manifest["identities"]}
    assert "gary-payton-ii" in slugs, (
        "GPII must remain a CourtBuilder candidate -- removing him would break "
        "historically accurate Warriors rosters in 82-0"
    )
    assert manifest["criteria_logic"]["scope"], "the manifest must document that it is not the ranking universe"
