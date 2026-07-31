"""Model versioning: v1 must stay reproducible and v2 must stay separate.

The failure this guards against is not a wrong score -- it is a RIGHT score
under the WRONG label. Two scoring models now exist; if a v2 number is ever
served as v1, or a v1 artifact is quietly overwritten with v2 content, every
saved run, leaderboard row and screenshot that references a score becomes
unverifiable. These tests make that specific outcome impossible to reach
silently.

See docs/model/PEAK3_V2_FORMULA_DESIGN.md section 7.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

import peak3 as P
from nba_peak import formula_version as FV

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
V1_PEAKS = ARTIFACTS / "top_1000_peaks.v1.json"
V2_PEAKS = ARTIFACTS / "top_1000_peaks.v2.json"
V1_SEASONS = ARTIFACTS / "top_1000_seasons.v1.json"
V2_SEASONS = ARTIFACTS / "top_1000_seasons.v2.json"


def _load(path: Path) -> dict:
    if not path.exists():
        pytest.skip(f"{path.name} not generated")
    return json.loads(path.read_text())


# ---------------------------------------------------------------------------
# The version registry
# ---------------------------------------------------------------------------

class TestRegistry:
    def test_v1_description_is_byte_identical_to_the_original_literal(self):
        """Committed artifacts, saved 82-0 runs and leaderboard rows carry this
        exact string. Regenerating it differently orphans all of them, so it is
        pinned character for character rather than merely 'starts with v1'."""
        assert FV.V1_DESCRIPTION == (
            "peak3_official_weights_v1 (statistical_impact=0.38, "
            "traditional_production=0.21, recognition=0.20, postseason=0.18, "
            "team_achievement=0.03)"
        )

    def test_the_description_is_built_from_official_weights_not_retyped(self):
        """The whole point of the module: if a weight changed, the string must
        change too. Before this, four hand-typed copies would have kept claiming
        the old weights."""
        for key, value in P.OFFICIAL_WEIGHTS.items():
            assert f"{key}={value:.2f}" in FV.V1_DESCRIPTION, key

    def test_v2_keeps_the_same_weights_and_says_what_changed(self):
        assert "peak3_official_weights_v2" in FV.V2_DESCRIPTION
        for key, value in P.OFFICIAL_WEIGHTS.items():
            assert f"{key}={value:.2f}" in FV.V2_DESCRIPTION, key
        assert "postseason" in FV.V2_DESCRIPTION.lower()

    def test_v1_is_the_default(self):
        """v2 stays a labelled preview until its blast radius is reviewed."""
        assert FV.DEFAULT_FORMULA_VERSION == FV.PEAK3_V1
        assert FV.is_default(None) is True
        assert FV.is_default(FV.PEAK3_V2) is False

    def test_normalize_rejects_unknown_versions_loudly(self):
        """A silently-defaulted bad version would mislabel scores, which is worse
        than a hard failure at the edge."""
        assert FV.normalize(None) == FV.PEAK3_V1
        assert FV.normalize("peak3_v2") == FV.PEAK3_V2
        with pytest.raises(ValueError):
            FV.normalize("peak3_v3")
        with pytest.raises(ValueError):
            FV.normalize("")

    def test_every_version_has_a_human_label(self):
        for version in FV.ALL_FORMULA_VERSIONS:
            assert FV.label(version)
            assert FV.description(version)

    def test_the_four_former_copies_now_come_from_here(self):
        """Regression guard for the duplication that made versioning impossible."""
        from nba_peak.perfect_season import config as ps_config
        assert ps_config.EXPERIMENTAL_FORMULA_VERSION == FV.V1_DESCRIPTION


# ---------------------------------------------------------------------------
# score_dataset dispatch
# ---------------------------------------------------------------------------

class TestDispatch:
    def test_default_is_v1(self):
        import inspect
        sig = inspect.signature(P.score_dataset)
        assert sig.parameters["formula_version"].default == "peak3_v1"

    def test_unknown_version_raises_before_doing_any_work(self):
        with pytest.raises(ValueError, match="unknown formula_version"):
            P.score_dataset(None, None, "peak3_v3")


# ---------------------------------------------------------------------------
# The artifacts stay separate
# ---------------------------------------------------------------------------

class TestArtifactSeparation:
    def test_each_artifact_declares_its_own_model_version(self):
        assert _load(V1_PEAKS)["model_version"] == "peak3_v1"
        assert _load(V2_PEAKS)["model_version"] == "peak3_v2"
        assert _load(V1_SEASONS)["model_version"] == "peak3_v1"
        assert _load(V2_SEASONS)["model_version"] == "peak3_v2"

    def test_v1_and_v2_are_different_files(self):
        assert V1_PEAKS != V2_PEAKS
        assert _load(V1_PEAKS)["dataset_version"] == "top_1000_peaks.v1"
        assert _load(V2_PEAKS)["dataset_version"] == "top_1000_peaks.v2"

    def test_v1_artifact_carries_the_v1_formula_string(self):
        assert _load(V1_PEAKS)["formula_version"] == FV.V1_DESCRIPTION
        assert _load(V2_PEAKS)["formula_version"] == FV.V2_DESCRIPTION

    def test_every_row_and_explain_block_is_stamped(self):
        for path, expected in ((V1_PEAKS, "peak3_v1"), (V2_PEAKS, "peak3_v2")):
            data = _load(path)
            for bucket in data["windows"].values():
                for row in bucket["rows"]:
                    assert row["model_version"] == expected, row["row_id"]
            for block in data["explain"].values():
                assert block["model_version"] == expected, block["row_id"]

    def test_the_two_boards_really_do_differ(self):
        """Guards the opposite failure: a 'v2' artifact that is silently a copy
        of v1 would pass every separation check above."""
        a = {r["row_id"]: r["prime_score"]
             for r in _load(V1_PEAKS)["windows"]["1y"]["rows"]}
        b = {r["row_id"]: r["prime_score"]
             for r in _load(V2_PEAKS)["windows"]["1y"]["rows"]}
        shared = set(a) & set(b)
        assert len(shared) > 500
        assert sum(1 for k in shared if a[k] != b[k]) > 100

    def test_v2_scored_dataset_does_not_overwrite_v1(self):
        v1 = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
        v2 = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.v2.parquet"
        assert v1.resolve() != v2.resolve()


# ---------------------------------------------------------------------------
# v1 preservation
# ---------------------------------------------------------------------------

class TestV1Preservation:
    """v1's numbers are the contract. Anything here failing means a v2 change
    leaked into v1."""

    def test_shipped_v1_top_ten_is_unchanged(self):
        expected = [
            ("Michael Jordan", "1990-91", 97.53),
            ("LeBron James", "2008-09", 95.85),
            ("Stephen Curry", "2015-16", 93.90),
            ("Shaquille O'Neal", "1999-00", 93.56),
            ("Nikola Jokic", "2022-23", 93.48),
            ("Shai Gilgeous-Alexander", "2024-25", 92.90),
            ("Tim Duncan", "2002-03", 91.84),
            ("Giannis Antetokounmpo", "2019-20", 91.28),
            ("Magic Johnson", "1986-87", 90.62),
            ("Hakeem Olajuwon", "1993-94", 90.50),
        ]
        rows = sorted(_load(V1_PEAKS)["windows"]["1y"]["rows"], key=lambda r: r["rank"])[:10]
        assert [(r["player_name"], r["label"], r["prime_score"]) for r in rows] == expected

    def test_v1_postseason_constants_are_untouched(self):
        """v2 defines its own PO2_* constants; v1's must not have been retuned
        on the way past."""
        assert P.PO_BASELINE == 25.0
        assert P.PO_PENALTY_CAP == 14.0
        assert P.PO_DEEPRUN_QUAL_THR == 42.0
        assert P.PO_DOMINANCE_KNEE == 50.0
        assert P.PO_ELEV_SCALE == 0.55

    def test_official_weights_are_untouched(self):
        assert P.OFFICIAL_WEIGHTS == {
            "statistical_impact": 0.38,
            "traditional_production": 0.21,
            "recognition": 0.20,
            "postseason": 0.18,
            "team_achievement": 0.03,
        }

    def test_v2_reuses_v1_calibration_anchors(self):
        """Refitting calibration for v2 would move every score for reasons
        unrelated to the postseason fix and break v1<->v2 comparability."""
        assert P.CALIBRATION_ANCHORS_RAW == [-10, 0, 12, 18, 26, 34, 42, 50, 60, 73, 85, 92, 112]
        assert P.CALIBRATION_ANCHORS_CAL == [3, 15, 37, 46, 56, 64, 73, 81, 88, 93, 97, 99, 100]


# ---------------------------------------------------------------------------
# The other four components are shared, not forked
# ---------------------------------------------------------------------------

class TestOnlyPostseasonChanged:
    @pytest.fixture(scope="class")
    def frames(self):
        v1 = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
        v2 = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.v2.parquet"
        if not (v1.exists() and v2.exists()):
            pytest.skip("scored datasets not generated")
        return pd.read_parquet(v1), pd.read_parquet(v2)

    @pytest.mark.parametrize("column", [
        "statistical_impact",
        "traditional_production",
        "recognition",
        "contrib_recognition",
        "team_achievement",
        "contrib_team_achievement",
        "teammate_adjustment",
    ])
    def test_component_is_bit_identical_across_versions(self, frames, column):
        a, b = frames
        assert len(a) == len(b)
        pd.testing.assert_series_equal(a[column], b[column], check_names=False)

    def test_postseason_is_the_one_that_moved(self, frames):
        a, b = frames
        assert not a["postseason_perf"].equals(b["postseason_perf"])

    def test_v2_keeps_v1s_postseason_value_for_comparison(self, frames):
        """A v2 row can always be compared against what v1 said for the same
        row, without loading a second file."""
        a, b = frames
        assert "postseason_perf_v1" in b.columns
        pd.testing.assert_series_equal(
            a["postseason_perf"], b["postseason_perf_v1"], check_names=False)
