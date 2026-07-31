"""The "why THIS season?" block on the 1Y board.

The 1Y board publishes each player's HIGHEST-SCORING single season. For several
players that is not the season the public remembers, and the margin is tiny --
LeBron's 2008-09 beat his 2012-13 title year by 0.16. Readers read the absence of
the famous season as a bug.

This is a CLARITY fix, not a scoring one: it states the rule and shows what the
anchor narrowly beat. These tests pin that it stays descriptive -- in particular
that a title season is never promoted to the anchor.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
PEAKS = (REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
         / "top_1000_peaks.v1.json")


@pytest.fixture(scope="module")
def peaks() -> dict:
    if not PEAKS.exists():
        pytest.skip("peaks artifact not generated")
    return json.loads(PEAKS.read_text())


def _block(peaks: dict, row_id: str) -> dict:
    block = peaks["explain"].get(row_id)
    if block is None:
        pytest.skip(f"{row_id} not served")
    return block


class TestShape:
    def test_every_one_year_row_states_how_its_season_was_chosen(self, peaks):
        for row in peaks["windows"]["1y"]["rows"]:
            block = peaks["explain"].get(row["row_id"])
            if block is None:
                continue
            assert block["anchor_selection"]["basis"] == "highest-scoring single season"

    def test_multi_season_windows_carry_no_nearby_seasons(self, peaks):
        """A 3Y/5Y window already spans several seasons, so there is nothing to
        explain and the section must not render."""
        for window in ("3y", "5y"):
            for row in peaks["windows"][window]["rows"]:
                block = peaks["explain"].get(row["row_id"])
                if block is None:
                    continue
                assert block["anchor_selection"]["nearby_iconic_seasons"] == []

    def test_entries_are_well_formed(self, peaks):
        seen = 0
        for block in peaks["explain"].values():
            for entry in block["anchor_selection"]["nearby_iconic_seasons"]:
                seen += 1
                assert entry["markers"], "a nearby season must say why it is iconic"
                assert set(entry["markers"]) <= {"champion", "Finals MVP", "MVP"}
                assert entry["margin"] > 0, "only seasons the anchor actually beat"
                assert entry["prime_score"] is not None
        assert seen > 0


class TestSelectionRules:
    def test_only_narrowly_beaten_seasons_appear(self, peaks):
        """A season that lost by a wide margin is not a competing explanation;
        surfacing it would be noise."""
        from scripts.build_top_peaks import NEARBY_SEASON_MAX_MARGIN
        for block in peaks["explain"].values():
            for entry in block["anchor_selection"]["nearby_iconic_seasons"]:
                assert entry["margin"] <= NEARBY_SEASON_MAX_MARGIN

    def test_the_anchor_never_lists_itself(self, peaks):
        for block in peaks["explain"].values():
            anchor = block["anchor_season"]
            for entry in block["anchor_selection"]["nearby_iconic_seasons"]:
                assert entry["season"] != anchor

    def test_entries_are_ordered_by_margin_so_output_is_stable(self, peaks):
        for block in peaks["explain"].values():
            entries = block["anchor_selection"]["nearby_iconic_seasons"]
            margins = [e["margin"] for e in entries]
            assert margins == sorted(margins)

    def test_the_list_is_capped(self, peaks):
        from scripts.build_top_peaks import NEARBY_SEASON_LIMIT
        for block in peaks["explain"].values():
            assert len(block["anchor_selection"]["nearby_iconic_seasons"]) <= NEARBY_SEASON_LIMIT

    def test_a_title_season_is_never_promoted_to_the_anchor(self, peaks):
        """The decisive property. This block EXPLAINS the choice; it must not
        change it. Every listed season scores strictly below the anchor."""
        for block in peaks["explain"].values():
            anchor_score = block["prime_score"]
            for entry in block["anchor_selection"]["nearby_iconic_seasons"]:
                assert entry["prime_score"] < anchor_score, block["row_id"]


class TestKnownCases:
    """The three cases Phase 12B measured, with their published margins."""

    @pytest.mark.parametrize("row_id,season,margin", [
        ("lebron-james-1yr-200809", "2012-13", 0.16),
        ("kobe-bryant-1yr-200708", "2008-09", 0.20),
        ("scottie-pippen-1yr-199394", "1995-96", 0.56),
    ])
    def test_the_narrowly_beaten_iconic_season_is_surfaced(self, peaks, row_id, season, margin):
        block = _block(peaks, row_id)
        entries = {e["season"]: e for e in block["anchor_selection"]["nearby_iconic_seasons"]}
        assert season in entries, f"{row_id} should surface {season}"
        assert entries[season]["margin"] == pytest.approx(margin, abs=0.02)

    def test_lebrons_title_seasons_are_labelled_as_such(self, peaks):
        block = _block(peaks, "lebron-james-1yr-200809")
        entry = next(e for e in block["anchor_selection"]["nearby_iconic_seasons"]
                     if e["season"] == "2012-13")
        assert "champion" in entry["markers"]
        assert "Finals MVP" in entry["markers"]

    def test_a_player_with_no_close_iconic_season_gets_an_empty_list(self, peaks):
        """Not every row has something to explain, and inventing one would be
        worse than saying nothing."""
        counts = [len(b["anchor_selection"]["nearby_iconic_seasons"])
                  for b in peaks["explain"].values()]
        assert counts.count(0) > 100


class TestDeterminism:
    def test_rebuilding_the_map_gives_the_same_answer(self):
        import pandas as pd
        from scripts.build_top_peaks import _nearby_iconic_seasons
        path = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
        if not path.exists():
            pytest.skip("scored dataset not generated")
        scored = pd.read_parquet(path)
        first = _nearby_iconic_seasons(scored)
        second = _nearby_iconic_seasons(scored)
        assert first == second
        assert len(first) > 0
