"""The API must never serve one scoring model's numbers under another's name.

Two PEAK3 formula versions now exist. A score is only meaningful alongside the
model that produced it, so every board and explain response states its model
version, v1 stays the default for callers that do not ask, and the two artifacts
can never be crossed.

The failure being prevented is subtle: not a 500, but a plausible-looking board
of v2 numbers that a client renders as v1.

See docs/model/PEAK3_V2_FORMULA_DESIGN.md section 7.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak import formula_version as FV  # noqa: E402

ARTIFACTS = _repo_root / "data" / "game" / "experimental" / "player_pool_1500"
V2_PEAKS = ARTIFACTS / "top_1000_peaks.v2.json"
V2_SEASONS = ARTIFACTS / "top_1000_seasons.v2.json"

requires_v2 = pytest.mark.skipif(
    not (V2_PEAKS.exists() and V2_SEASONS.exists()),
    reason="v2 artifacts not generated",
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------------------
# The default never moves by accident
# ---------------------------------------------------------------------------

class TestDefault:
    def test_peaks_defaults_to_v1(self, client):
        body = client.get("/api/v1/peaks", params={"window": "1y", "limit": 5}).json()
        assert body["model_version"] == "peak3_v1"
        assert body["is_default_model"] is True
        assert body["model_label"] == "PEAK3 v1"

    def test_seasons_defaults_to_v1(self, client):
        body = client.get("/api/v1/seasons", params={"limit": 5}).json()
        assert body["model_version"] == "peak3_v1"
        assert body["is_default_model"] is True

    def test_every_row_carries_the_version(self, client):
        body = client.get("/api/v1/peaks", params={"window": "1y", "limit": 20}).json()
        assert all(r["model_version"] == "peak3_v1" for r in body["rows"])

    def test_the_formula_string_matches_the_registry(self, client):
        body = client.get("/api/v1/peaks", params={"window": "1y", "limit": 1}).json()
        assert body["formula_version"] == FV.V1_DESCRIPTION


# ---------------------------------------------------------------------------
# v2 is reachable, and clearly labelled as not the default
# ---------------------------------------------------------------------------

@requires_v2
class TestPreview:
    def test_v2_is_served_when_asked_for(self, client):
        body = client.get(
            "/api/v1/peaks",
            params={"window": "1y", "limit": 5, "model_version": "peak3_v2"}).json()
        assert body["model_version"] == "peak3_v2"
        assert body["is_default_model"] is False
        assert "preview" in body["model_label"].lower()
        assert body["formula_version"] == FV.V2_DESCRIPTION

    def test_v2_seasons_are_served_when_asked_for(self, client):
        body = client.get(
            "/api/v1/seasons",
            params={"limit": 5, "model_version": "peak3_v2"}).json()
        assert body["model_version"] == "peak3_v2"
        assert body["is_default_model"] is False

    def test_v2_rows_are_stamped_v2(self, client):
        body = client.get(
            "/api/v1/peaks",
            params={"window": "1y", "limit": 20, "model_version": "peak3_v2"}).json()
        assert all(r["model_version"] == "peak3_v2" for r in body["rows"])

    def test_the_two_versions_really_serve_different_numbers(self, client):
        """Guards the inverse failure: a v2 route that quietly returns v1 would
        satisfy every label assertion above."""
        v1 = client.get("/api/v1/peaks", params={"window": "1y", "limit": 200}).json()
        v2 = client.get(
            "/api/v1/peaks",
            params={"window": "1y", "limit": 200, "model_version": "peak3_v2"}).json()
        a = {r["row_id"]: r["prime_score"] for r in v1["rows"]}
        b = {r["row_id"]: r["prime_score"] for r in v2["rows"]}
        shared = set(a) & set(b)
        assert len(shared) > 100
        assert sum(1 for k in shared if a[k] != b[k]) > 20

    def test_explain_is_stamped_with_the_version_that_was_asked_for(self, client):
        rows = client.get(
            "/api/v1/peaks",
            params={"window": "1y", "limit": 1, "model_version": "peak3_v2"}).json()["rows"]
        row_id = rows[0]["row_id"]
        body = client.get(
            f"/api/v1/peaks/{row_id}/explain",
            params={"model_version": "peak3_v2"}).json()
        assert body["explain"]["model_version"] == "peak3_v2"

    def test_an_explain_row_only_resolves_within_its_own_version(self, client):
        """Cross-version lookups must not silently fall back to the other board."""
        body = client.get("/api/v1/peaks/not-a-real-row-1yr-199091/explain")
        assert body.status_code == 404


# ---------------------------------------------------------------------------
# Bad input fails loudly
# ---------------------------------------------------------------------------

class TestRejection:
    @pytest.mark.parametrize("bad", ["peak3_v3", "v1", "", "PEAK3_V1"])
    def test_unknown_versions_are_rejected_not_defaulted(self, client, bad):
        """Silently defaulting would mislabel scores, which is the exact failure
        this whole mechanism exists to prevent."""
        response = client.get(
            "/api/v1/peaks", params={"window": "1y", "model_version": bad})
        assert response.status_code == 422
        assert response.json()["detail"]["error_code"] == "unknown_model_version"

    def test_seasons_rejects_the_same_way(self, client):
        response = client.get("/api/v1/seasons", params={"model_version": "nope"})
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Other surfaces keep their own version
# ---------------------------------------------------------------------------

class TestOtherSurfacesUnaffected:
    def test_the_duel_dataset_keeps_its_own_separate_version(self, client):
        """Peak Duel and /leaderboards read data/web, a different pipeline with
        its own `model_version` namespace (`peak3-v1`, hyphenated, set in
        scripts/build_web_dataset.py). This phase touched neither, so that field
        must not have acquired a peaks formula version -- above all not
        `peak3_v2`, which would mean the duel had silently changed models."""
        body = client.get("/api/v1/meta").json()
        assert body["model_version"] not in FV.ALL_FORMULA_VERSIONS
        assert "v2" not in body["model_version"]

    def test_asking_peaks_for_v2_does_not_change_a_later_default_request(self, client):
        """The per-version cache must not leak across requests."""
        client.get("/api/v1/peaks",
                   params={"window": "1y", "limit": 5, "model_version": "peak3_v2"})
        body = client.get("/api/v1/peaks", params={"window": "1y", "limit": 5}).json()
        assert body["model_version"] == "peak3_v1"
        assert body["formula_version"] == FV.V1_DESCRIPTION
