"""Postseason Value / Team Achievement audit pins (Phase 12A).

Companion to docs/model/POSTSEASON_TEAM_AUDIT.md. Manual review flagged a set
of PO/TEAM values as suspicious; the audit found no formula bug, so the point
of this file is to PIN the flagged values and the structural properties that
produce them.

Two reasons these exist:

  1. If someone later "fixes" one of these numbers because it looks wrong, this
     file makes them do it deliberately -- with a failing test that names the
     case and points at the audit -- rather than silently moving scores.
  2. Several of the properties (0 for a missed postseason, bounded negatives,
     sample shrinkage) are counterintuitive enough that they must be asserted
     rather than assumed, because the rankings modal now explains them to users
     and the explanation has to stay true.

NO tolerance-free equality on scores: values are pinned to 2 decimal places
against the committed scored table, which is the artifact the leaderboards and
the served boards are built from.
"""
from __future__ import annotations

import pandas as pd
import pytest

from nba_peak.daily_grid.pool import (
    PLAYOFF_ROUND_CHAMPION,
    PLAYOFF_ROUND_FINALS,
    PLAYOFF_ROUND_MISSED,
    SCORED_PATH,
    canonical_playoff_round,
    load_pool,
)

_MULTI_TEAM = {"2TM", "3TM", "4TM", "5TM", "TOT"}


@pytest.fixture(scope="module")
def scored() -> pd.DataFrame:
    df = pd.read_parquet(SCORED_PATH)
    return df[~df["team"].isin(_MULTI_TEAM)].copy()


def row(scored: pd.DataFrame, player: str, season: str) -> pd.Series:
    match = scored[(scored["player"] == player) & (scored["season"] == season)]
    assert len(match) == 1, f"expected exactly one row for {player} {season}, got {len(match)}"
    return match.iloc[0]


# ---------------------------------------------------------------------------
# The flagged cases, with the value each one is expected to hold
# ---------------------------------------------------------------------------

# (player, season, postseason_perf, team_achievement) -- see the audit's case
# table. Tolerance is 0.01; these come from the committed scored artifact.
AUDIT_CASES = [
    ("Hakeem Olajuwon", "1993-94", 50.73, 100.00),
    ("Manu Ginobili", "2004-05", 57.15, 69.77),
    ("Victor Wembanyama", "2025-26", 40.28, 65.60),
    ("Dwight Howard", "2008-09", 45.61, 46.19),
    ("Kobe Bryant", "2007-08", 32.55, 65.60),
    ("Klay Thompson", "2015-16", 15.62, 48.61),
    ("Scottie Pippen", "1995-96", 14.75, 72.26),
    ("Jalen Brunson", "2024-25", 14.40, 47.56),
    ("Jimmy Butler", "2022-23", 13.79, 61.57),
    ("Jalen Brunson", "2025-26", 10.49, 100.00),
    ("Scottie Pippen", "1993-94", 5.91, 23.35),
    ("David Robinson", "1994-95", 5.18, 42.34),
    ("Jalen Brunson", "2023-24", 2.08, 24.60),
    ("David Robinson", "1993-94", 0.47, 0.00),
    ("Victor Wembanyama", "2024-25", 0.00, 0.00),
    ("Kobe Bryant", "2005-06", -0.60, 0.00),
    ("Joel Embiid", "2022-23", -2.10, 24.60),
    ("Klay Thompson", "2014-15", -8.09, 68.67),
]


@pytest.mark.parametrize("player,season,po,team", AUDIT_CASES)
def test_flagged_case_holds_its_audited_value(scored, player, season, po, team):
    """If this fails, a scoring change moved a case the audit examined. That may
    be correct -- but update docs/model/POSTSEASON_TEAM_AUDIT.md with it."""
    r = row(scored, player, season)
    assert float(r["postseason_perf"]) == pytest.approx(po, abs=0.01)
    assert float(r["team_achievement"]) == pytest.approx(team, abs=0.01)


# ---------------------------------------------------------------------------
# Structural properties the rankings modal now explains to users
# ---------------------------------------------------------------------------

class TestPostseasonContract:
    def test_missing_the_playoffs_is_exactly_zero(self, scored):
        """Not negative, not a positive default: 0 means 'no evidence'."""
        missed = scored[~scored["made_playoffs"].astype(bool)]
        assert len(missed) > 1000
        assert (missed["postseason_perf"] == 0.0).all()

    def test_a_missed_postseason_outranks_a_bad_one(self, scored):
        """The counterintuitive consequence, asserted so the docs stay honest:
        a player who never qualified scores HIGHER than one who qualified and
        played below the replacement baseline. See the audit, section 5.1."""
        wemby = row(scored, "Victor Wembanyama", "2024-25")  # missed playoffs
        klay = row(scored, "Klay Thompson", "2014-15")       # champion, poor run
        assert float(wemby["postseason_perf"]) == 0.0
        assert float(klay["postseason_perf"]) < 0.0
        assert float(wemby["postseason_perf"]) > float(klay["postseason_perf"])

    def test_negative_postseason_is_bounded(self, scored):
        """PO_PENALTY_CAP bounds the downside so one bad series cannot erase a
        season. Asserted because the modal tells users the floor exists."""
        played = scored[scored["made_playoffs"].astype(bool)]
        assert played["postseason_perf"].min() > -20.0

    def test_a_tiny_playoff_sample_is_shrunk_not_trusted(self, scored):
        """David Robinson 1993-94: four playoff games. His raw level is solidly
        positive; sample reliability cuts it to near zero."""
        r = row(scored, "David Robinson", "1993-94")
        assert float(r["po_g"]) == 4.0
        assert float(r["po_sample_reliab"]) < 0.25
        assert float(r["po_abs_level"]) > 5.0          # the raw level is fine
        assert float(r["po_level_value"]) < 2.5        # what survives shrinkage

    def test_winning_does_not_by_itself_create_postseason_value(self, scored):
        """The clearest demonstration in the dataset: Klay's championship year
        scores LOWER than his Finals-loss year, because he played better in the
        loss. PO is rate performance, not winning."""
        title = row(scored, "Klay Thompson", "2014-15")
        loss = row(scored, "Klay Thompson", "2015-16")
        assert float(title["championship"]) == 1.0
        assert float(loss["championship"]) == 0.0
        assert float(loss["postseason_perf"]) > float(title["postseason_perf"])


class TestTeamAchievementContract:
    def test_no_playoffs_or_first_round_exit_is_exactly_zero(self, scored):
        first_round = scored[
            scored["made_playoffs"].astype(bool) & (scored["playoff_round_score"] <= 30.0)
        ]
        assert len(first_round) > 100
        assert (first_round["team_achievement"] == 0.0).all()
        missed = scored[~scored["made_playoffs"].astype(bool)]
        assert (missed["team_achievement"] == 0.0).all()

    def test_team_achievement_is_bounded_to_a_hundred(self, scored):
        assert scored["team_achievement"].max() <= 100.0
        assert scored["team_achievement"].min() >= 0.0

    def test_team_achievement_reads_the_round_flags_not_the_label(self, scored):
        """Brunson 2025-26 is the case that exposed the stale label: the string
        said Conference Finals while every flag said champion. TEAM scored from
        the flags and was correct."""
        r = row(scored, "Jalen Brunson", "2025-26")
        assert float(r["championship"]) == 1.0
        assert float(r["team_achievement"]) == pytest.approx(100.0, abs=0.01)

    def test_team_achievement_cannot_offset_an_individual_gap(self, scored):
        """3% weight, max 3.0 index points -- asserted because the modal says so."""
        assert scored["contrib_team_achievement"].max() <= 3.0 + 1e-9


class TestOneScoringPath:
    def test_rankings_and_duel_read_the_same_exported_component(self):
        """Both surfaces consume `components.postseason_individual_value` from
        the same generated peak windows. If a second PO path ever appears, the
        Duel and the rankings modal could disagree about the same player."""
        import json
        from pathlib import Path

        peaks = Path("data/game/experimental/player_pool_1500/top_1000_peaks.v1.json")
        if not peaks.exists():
            pytest.skip("served peaks artifact not generated")
        data = json.loads(peaks.read_text())
        block = data["explain"]["michael-jordan-1yr-199091"]
        assert "postseason_individual_value" in block["components"]
        assert "team_achievement" in block["components"]
        # The weighting the API and the UI both display.
        assert block["weights"]["postseason_individual_value"] == 0.18
        assert block["weights"]["team_achievement"] == 0.03


# ---------------------------------------------------------------------------
# The one bug the audit found: a stale playoff_round label
# ---------------------------------------------------------------------------

class TestPlayoffRoundLabelRepair:
    def test_the_raw_artifact_still_contains_the_inconsistency(self, scored):
        """Documents the bug rather than hiding it: the repair is in the pool,
        not in the parquet, so the raw table still disagrees with itself. If
        this ever stops failing, the source data was fixed upstream and
        canonical_playoff_round() can be revisited."""
        mismatched = scored[
            (scored["championship"] == 1) & (scored["playoff_round"] != "Champion")
        ]
        assert len(mismatched) > 0
        # ...and it is confined to the one season the audit identified.
        assert set(mismatched["season"]) == {"2025-26"}

    def test_the_pool_label_always_agrees_with_the_flags(self):
        """The repair. Every consumer that shows a round to a player reads this."""
        frame = load_pool().frame
        champs = frame[frame["championship"] == 1]
        assert len(champs) > 0
        assert (champs["playoff_round"] == PLAYOFF_ROUND_CHAMPION).all()

        finals = frame[frame["finals_appearance"] == 1]
        assert finals["playoff_round"].isin(
            [PLAYOFF_ROUND_FINALS, PLAYOFF_ROUND_CHAMPION]
        ).all()

        missed = frame[~frame["made_playoffs"].astype(bool)]
        assert (missed["playoff_round"] == PLAYOFF_ROUND_MISSED).all()
        played = frame[frame["made_playoffs"].astype(bool)]
        assert (played["playoff_round"] != PLAYOFF_ROUND_MISSED).all()

    def test_the_repaired_label_reaches_the_player_season_records(self):
        pool = load_pool()
        brunson = pool.by_id.get("jalen-brunson-202526-nyk")
        assert brunson is not None
        assert brunson.champion is True
        assert brunson.playoff_round == PLAYOFF_ROUND_CHAMPION

    @pytest.mark.parametrize(
        "flags,expected",
        [
            ({"made_playoffs": False}, PLAYOFF_ROUND_MISSED),
            ({"made_playoffs": True, "championship": 1}, PLAYOFF_ROUND_CHAMPION),
            ({"made_playoffs": True, "finals_appearance": 1}, PLAYOFF_ROUND_FINALS),
            ({"made_playoffs": True, "conf_finals": 1}, "Conference Finals"),
            ({"made_playoffs": True, "playoff_round_score": 50.0}, "Conference Semifinals"),
            ({"made_playoffs": True, "playoff_round_score": 30.0}, "First Round"),
        ],
    )
    def test_canonical_label_is_derived_deepest_flag_first(self, flags, expected):
        assert canonical_playoff_round(flags) == expected

    def test_a_champion_is_never_described_as_a_lesser_round(self):
        """The user-visible symptom: the Daily Grid rejection sentence reads this
        label, so a champion described as 'conference finals' is a false claim
        printed to the player as a teaching sentence."""
        assert (
            canonical_playoff_round(
                {
                    "made_playoffs": True,
                    "championship": 1,
                    "conf_finals": 1,
                    # The stale string, deliberately wrong.
                    "playoff_round": "Conference Finals",
                }
            )
            == PLAYOFF_ROUND_CHAMPION
        )
