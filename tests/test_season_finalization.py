"""No finished season may be labelled "in progress" (Phase 12B).

THE BUG THIS CLOSES. Both ranking generators carried
`_IN_PROGRESS_SEASON = "2025-26"` and stamped every row from that season as
still being played. The justification was `season_progress_pct < 1.0` -- a value
that is below 1.0 for EVERY season since at least 2016-17 (2021-22 sits at
0.939, lower than 2025-26's 0.951), so it never distinguished a live season from
a finished one. The constant was just the newest season when it was written.

The replacement derives the answer: a season is finished when the data says who
won it -- a champion and a Finals MVP. These tests pin both halves: that the
derivation is right, and that no served row claims otherwise.

See docs/model/PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md section 2.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from nba_peak.season_status import (
    in_progress_seasons,
    is_season_in_progress,
    resolved_seasons,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
PEAKS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
)
SEASONS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_seasons.v1.json"
)

_MULTI_TEAM = {"2TM", "3TM", "4TM", "5TM", "TOT"}


@pytest.fixture(scope="module")
def scored() -> pd.DataFrame:
    return pd.read_parquet(SCORED_PATH)


@pytest.fixture(scope="module")
def peaks() -> dict:
    if not PEAKS_PATH.exists():
        pytest.skip("served peaks artifact not generated")
    return json.loads(PEAKS_PATH.read_text())


@pytest.fixture(scope="module")
def seasons_artifact() -> dict:
    if not SEASONS_PATH.exists():
        pytest.skip("served seasons artifact not generated")
    return json.loads(SEASONS_PATH.read_text())


def _peak_rows(peaks: dict):
    for bucket in peaks["windows"].values():
        yield from bucket["rows"]


def _season_rows(artifact: dict):
    yield from (artifact.get("seasons") or artifact.get("rows") or [])


# ---------------------------------------------------------------------------
# The derivation itself
# ---------------------------------------------------------------------------

class TestDerivation:
    def test_every_season_in_the_dataset_has_resolved_playoffs(self, scored):
        """A season with a champion AND a Finals MVP is over. All 47 qualify."""
        assert in_progress_seasons(scored) == set()
        assert len(resolved_seasons(scored)) == scored["season"].nunique()

    def test_2025_26_is_finished(self, scored):
        assert is_season_in_progress(scored, "2025-26") is False

    def test_the_old_justification_would_have_flagged_almost_everything(self, scored):
        """`season_progress_pct < 1.0` was the stated reason for the hardcoded
        constant. Pinned so nobody reintroduces it: it is true of ten recent
        seasons, including ones that ended years ago."""
        by_season = scored.groupby("season")["season_progress_pct"].max()
        below_one = by_season[by_season < 1.0]
        assert len(below_one) >= 10
        # 2021-22 is LESS "complete" by that metric than 2025-26.
        assert below_one["2021-22"] < below_one["2025-26"]

    def test_an_unresolved_season_is_still_detected(self):
        """The point of deriving rather than hardcoding: a genuinely unfinished
        season must still be caught."""
        frame = pd.DataFrame(
            [
                {"season": "2024-25", "championship": 1, "finals_mvp": 0},
                {"season": "2024-25", "championship": 0, "finals_mvp": 1},
                # A season underway: games played, nobody has won anything.
                {"season": "2026-27", "championship": 0, "finals_mvp": 0},
            ]
        )
        assert in_progress_seasons(frame) == {"2026-27"}
        assert is_season_in_progress(frame, "2026-27") is True
        assert is_season_in_progress(frame, "2024-25") is False

    def test_a_champion_without_a_finals_mvp_is_not_yet_resolved(self):
        """Both markers are required -- a partially-populated bracket must not
        read as finished."""
        frame = pd.DataFrame([{"season": "2026-27", "championship": 1, "finals_mvp": 0}])
        assert in_progress_seasons(frame) == {"2026-27"}

    def test_missing_columns_degrade_to_in_progress_not_to_finished(self):
        """Fail safe: a dataset built without postseason context must not
        silently claim every season is final."""
        frame = pd.DataFrame([{"season": "2024-25"}])
        assert in_progress_seasons(frame) == {"2024-25"}
        assert resolved_seasons(frame) == set()


# ---------------------------------------------------------------------------
# The served artifacts
# ---------------------------------------------------------------------------

class TestServedRows:
    def test_no_peak_window_row_claims_to_be_in_progress(self, peaks):
        flagged = [r["row_id"] for r in _peak_rows(peaks) if r.get("season_in_progress")]
        assert flagged == [], flagged[:10]

    def test_no_single_season_row_claims_to_be_in_progress(self, seasons_artifact):
        flagged = [
            r["row_id"] for r in _season_rows(seasons_artifact) if r.get("season_in_progress")
        ]
        assert flagged == [], flagged[:10]

    def test_no_explain_block_carries_an_in_progress_caveat(self, peaks, seasons_artifact):
        """The caveat is separate from the flag and had to be cleared too."""
        for artifact in (peaks, seasons_artifact):
            for block in (artifact.get("explain") or {}).values():
                for caveat in block.get("caveats") or []:
                    assert "still in progress" not in caveat.lower(), (
                        block.get("row_id"),
                        caveat,
                    )

    def test_2025_26_rows_exist_and_are_finalized(self, peaks):
        """Guards against 'fixing' the label by dropping the season."""
        rows = [r for r in _peak_rows(peaks) if r.get("anchor_season") == "2025-26"]
        assert len(rows) >= 20
        assert all(r.get("season_in_progress") is False for r in rows)


# ---------------------------------------------------------------------------
# The two rows the review named
# ---------------------------------------------------------------------------

class TestFlaggedRows:
    def test_wembanyama_2025_26_is_final_and_unreduced(self, peaks, scored):
        """The brief is explicit that a high Wembanyama row is not itself
        suspicious. What must be true is that the row uses complete final data
        and is not labelled in progress -- NOT that it scores lower."""
        block = peaks["explain"]["victor-wembanyama-1yr-202526"]
        assert block["season_in_progress"] is False
        assert not any("still in progress" in c.lower() for c in block["caveats"])

        raw = scored[
            (scored["player"] == "Victor Wembanyama") & (scored["season"] == "2025-26")
        ].iloc[0]
        # Final awards and a resolved postseason, not partial data.
        assert float(raw["dpoy_rank"]) == 1.0
        assert float(raw["all_nba_team"]) == 1.0
        assert float(raw["po_g"]) > 0
        assert float(raw["finals_appearance"]) == 1.0
        # And the row is still the score the model produced.
        assert block["prime_score"] == pytest.approx(90.06, abs=0.01)

    def test_wembanyamas_only_caveat_is_a_real_durability_signal(self, peaks, scored):
        """He played 64 of 82 games. That flag is information about the season,
        not evidence the data is incomplete."""
        block = peaks["explain"]["victor-wembanyama-1yr-202526"]
        assert len(block["caveats"]) == 1
        assert "availability" in block["caveats"][0].lower()
        raw = scored[
            (scored["player"] == "Victor Wembanyama") & (scored["season"] == "2025-26")
        ].iloc[0]
        assert float(raw["g"]) == 64.0

    def test_sga_2024_25_is_final_with_full_award_and_title_context(self, peaks, scored):
        """Fixture for the row the brief says must NOT be treated as suspicious.
        Asserts completeness only -- deliberately makes no claim about whether
        rank 6 is correct."""
        block = peaks["explain"]["shai-gilgeous-alexander-1yr-202425"]
        assert block["season_in_progress"] is False
        assert block["caveats"] == []

        raw = scored[
            (scored["player"] == "Shai Gilgeous-Alexander") & (scored["season"] == "2024-25")
        ].iloc[0]
        assert float(raw["mvp_rank"]) == 1.0
        assert float(raw["championship"]) == 1.0
        assert float(raw["finals_mvp"]) == 1.0
        assert float(raw["po_g"]) == 23.0


# ---------------------------------------------------------------------------
# The fix moved labels, not scores
# ---------------------------------------------------------------------------

class TestNoScoreMovement:
    def test_top_ten_peak_windows_are_unchanged(self, peaks):
        """The finalization fix is display-only. These are the shipped values
        from before it; if one moves, something other than a label changed."""
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
        rows = sorted(peaks["windows"]["1y"]["rows"], key=lambda r: r["rank"])[:10]
        actual = [(r["player_name"], r["label"], r["prime_score"]) for r in rows]
        assert actual == [(p, s, sc) for p, s, sc in expected]

    def test_the_2025_26_rows_kept_their_scores(self, peaks):
        block = peaks["explain"]["victor-wembanyama-1yr-202526"]
        assert block["rank"] == 12
        assert block["prime_score"] == pytest.approx(90.06, abs=0.01)
