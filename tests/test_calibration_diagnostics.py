"""Pins for the Phase 12B calibration diagnosis.

WHY THESE EXIST. The diagnosis document states specific numbers -- "68.3% of
playoff seasons score below every non-playoff season", "one no-playoff season
reaches the top 50", "TEAM is 0 for exactly the first-round exits". Those claims
are only worth anything if they are re-checkable. Each test here re-derives one
of them from the committed artifacts.

They are NOT assertions that the model is correct. Several pin behaviour the
diagnosis explicitly calls a calibration concern deferred to v2. Pinning them
means a future formula change has to acknowledge what it moved rather than
quietly move it.

See docs/model/PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md.
"""
from __future__ import annotations

from pathlib import Path
from statistics import pstdev

import pandas as pd
import pytest

import peak3 as P
from nba_peak.calibration_diagnostics import (
    ABBR,
    COMPONENT_KEYS,
    Boards,
    markdown_table,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"
)

pytestmark = pytest.mark.skipif(
    not ARTIFACT.exists(), reason="served board artifacts not generated"
)


@pytest.fixture(scope="module")
def boards() -> Boards:
    return Boards.load()


# ---------------------------------------------------------------------------
# The harness itself
# ---------------------------------------------------------------------------

class TestHarness:
    def test_top_fifty_loads_complete_and_in_rank_order(self, boards):
        rows = boards.board("1y", 50)
        assert len(rows) == 50
        assert [r.rank for r in rows] == list(range(1, 51))
        assert all(r.player and r.anchor_season for r in rows)

    def test_every_row_carries_all_five_components(self, boards):
        for row in boards.board("1y", 100):
            assert set(row.components) >= set(COMPONENT_KEYS), row.row_id

    def test_components_sum_to_the_served_index(self, boards):
        """The whole variant sandbox depends on this identity. If it breaks,
        every number in the experiments document is wrong."""
        for row in boards.board("1y", 100):
            if row.prime_index is None:
                continue
            assert sum(row.components.values()) == pytest.approx(row.prime_index, abs=0.6)

    def test_all_four_boards_are_reachable(self, boards):
        for name in ("1y", "3y", "5y", "seasons"):
            assert len(boards.board(name, 10)) == 10

    def test_the_harness_is_deterministic(self, boards):
        """Two loads must agree exactly -- the diagnosis quotes these rows."""
        again = Boards.load()
        a = [(r.rank, r.row_id, r.total) for r in boards.board("1y", 100)]
        b = [(r.rank, r.row_id, r.total) for r in again.board("1y", 100)]
        assert a == b

    def test_markdown_table_renders_the_documented_columns(self, boards):
        out = markdown_table(boards.board("1y", 3), ["rank", "player", "label", "po", "team_ach"])
        lines = out.strip().splitlines()
        assert len(lines) == 5  # header + separator + 3 rows
        assert "Michael Jordan" in out

    def test_peak_windows_board_holds_one_row_per_player(self, boards):
        """A fact the anchor analysis turns on: the 1Y board is a per-player
        best, not a per-season list. Comparing anchors requires the Seasons
        board instead."""
        rows = boards.board("1y")
        names = [r.player for r in rows]
        assert len(names) == len(set(names))
        assert len(boards.find("LeBron James", board="1y")) == 1
        assert len(boards.find("LeBron James", board="seasons")) > 1


# ---------------------------------------------------------------------------
# Postseason: the negative rows, enumerated
# ---------------------------------------------------------------------------

class TestPostseasonNegatives:
    def test_the_two_negative_po_rows_in_the_top_fifty(self, boards):
        """Enumerated, not counted: these are the rows a reader will click on."""
        rows = boards.board("1y", 50)
        negative = [(r.rank, r.player, r.label) for r in rows if r.po < 0]
        assert negative == [
            (22, "Joel Embiid", "2022-23"),
            (50, "Sidney Moncrief", "1982-83"),
        ]

    def test_negative_po_is_possible_at_all(self, boards):
        """The floor exists and bites: PO_PENALTY_CAP bounds how far below
        zero a bad playoff run can drag a season."""
        assert P.PO_PENALTY_CAP == 14
        worst = min(r.po for r in boards.board("1y"))
        assert worst < 0
        assert worst >= -P.PO_PENALTY_CAP * 0.18 - 0.01

    def test_a_negative_po_row_still_reached_the_playoffs(self, boards):
        """The inversion the diagnosis is about: these players PLAYED in the
        postseason and scored below everyone who did not."""
        for row in boards.negative_po("1y", limit=200):
            assert row.made_playoffs == 1, row.row_id
            assert row.po < 0

    def test_a_no_playoff_row_scores_exactly_zero_not_negative(self, boards):
        """Missing the playoffs is worth 0 on both postseason components --
        strictly better than a bad run. This is the inversion, pinned."""
        for row in boards.no_playoffs("1y", limit=200):
            assert row.po == 0.0, row.row_id
            assert row.team_ach == 0.0, row.row_id


# ---------------------------------------------------------------------------
# No-playoff seasons
# ---------------------------------------------------------------------------

class TestNoPlayoffRows:
    def test_exactly_one_no_playoff_season_reaches_the_top_fifty(self, boards):
        rows = boards.board("1y", 50)
        missed = [(r.rank, r.player, r.label) for r in rows if r.made_playoffs == 0]
        assert missed == [(47, "Kevin Love", "2013-14")]

    def test_a_no_playoff_season_forfeits_twenty_one_percent_of_the_formula(self, boards):
        """PO (18%) + TEAM (3%). The reason no such season ranks higher is
        structural, not a penalty applied on top."""
        love = boards.find("Kevin Love", "2013-14", board="1y")[0]
        assert love.po == 0.0
        assert love.team_ach == 0.0
        assert P.OFFICIAL_WEIGHTS["postseason"] + P.OFFICIAL_WEIGHTS["team_achievement"] == (
            pytest.approx(0.21)
        )


# ---------------------------------------------------------------------------
# Team achievement
# ---------------------------------------------------------------------------

class TestTeamAdvancementMapping:
    def test_the_documented_anchors(self):
        assert P.ADVANCEMENT_ANCHORS == {30.0: 0.0, 50.0: 30.0, 70.0: 58.0, 85.0: 80.0, 100.0: 100.0}

    @pytest.mark.parametrize(
        "flags,expected",
        [
            ({"championship": 1}, 100.0),
            ({"finals_appearance": 1}, 80.0),
            ({"conf_finals": 1}, 58.0),
            ({}, 0.0),
        ],
    )
    def test_round_flags_map_to_their_anchor(self, flags, expected):
        row = pd.Series({"playoff_round_score": None, **flags})
        assert P._advancement_value(row) == pytest.approx(expected)

    def test_a_first_round_exit_is_exactly_zero(self):
        """Not a small number -- zero. The component has no baseline."""
        row = pd.Series({"playoff_round_score": 30.0})
        assert P._advancement_value(row) == 0.0
        assert P.team_achievement_row(row) == 0.0

    def test_interpolation_between_anchors_is_monotonic(self):
        values = [
            P._advancement_value(pd.Series({"playoff_round_score": float(x)}))
            for x in range(30, 101, 5)
        ]
        assert values == sorted(values)
        assert values[0] == 0.0
        assert values[-1] == 100.0

    def test_zero_advancement_short_circuits_the_role_multiplier(self):
        """A high-usage star on a first-round loser still gets 0: the role
        multiplier scales achievement, it cannot create it."""
        row = pd.Series({"playoff_round_score": 30.0, "creation": 40.0, "usg_pct": 38.0})
        assert P.team_achievement_row(row) == 0.0

    def test_served_team_values_stay_inside_the_three_point_ceiling(self, boards):
        """The single most misread number in the review. TEAM's entire range is
        3 index points; a championship cannot outweigh a component gap."""
        values = [r.team_ach for r in boards.board("1y")]
        assert min(values) == 0.0
        assert max(values) <= 3.0 + 1e-9
        assert max(values) == pytest.approx(3.0, abs=0.01)

    def test_zero_team_rows_all_lack_a_series_win(self, boards):
        """No mismatch in either direction across the served board."""
        for row in boards.board("1y"):
            if row.team_ach == 0.0:
                assert row.championship != 1 and row.finals_appearance != 1, row.row_id
            if row.championship == 1:
                assert row.team_ach > 0.0, row.row_id

    def test_the_zero_team_rows_in_the_top_fifty(self, boards):
        rows = boards.board("1y", 50)
        zeros = [(r.rank, r.player, r.label) for r in rows if r.team_ach == 0.0]
        assert zeros == [
            (24, "Russell Westbrook", "2016-17"),
            (26, "Tracy McGrady", "2002-03"),
            (43, "Rudy Gobert", "2018-19"),
            (47, "Kevin Love", "2013-14"),
        ]


# ---------------------------------------------------------------------------
# Recognition
# ---------------------------------------------------------------------------

class TestRecognitionRange:
    def test_rec_uses_its_entire_available_range_in_the_top_hundred(self, boards):
        """The finding behind the REC sensitivity table: REC spans 0 to its full
        20-point weight inside the top 100, so it separates rows more than any
        other component -- including the 38%-weighted Statistical Impact."""
        rows = boards.board("1y", 100)
        rec = [r.rec for r in rows]
        assert min(rec) == pytest.approx(0.0, abs=0.01)
        assert max(rec) == pytest.approx(20.0, abs=0.01)

    def test_rec_separates_rows_more_than_any_other_component(self, boards):
        """Measured as standard deviation, not raw range. Statistical Impact
        has a wider span (22.1 points to REC's 20.0) purely because its weight
        is larger; REC still varies more from row to row (sigma 5.58 vs 4.91),
        which is what actually drives ordering.

        The distinction matters: it is why the REC variants (I15/I25) disrupt
        the board more than any other experiment despite REC carrying half of
        Statistical Impact's weight."""
        rows = boards.board("1y", 100)

        def sigma(key: str) -> float:
            return pstdev([r.components[key] for r in rows])

        sigmas = {ABBR[k]: sigma(k) for k in COMPONENT_KEYS}
        assert max(sigmas, key=sigmas.get) == "REC"
        assert sigmas["REC"] > sigmas["SI"]

    def test_scaling_rec_is_deterministic_and_order_preserving_within_a_row(self, boards):
        """The sensitivity experiment multiplies REC by a constant. Pinned so
        the published table can be regenerated exactly."""
        rows = boards.board("1y", 100)
        for factor in (0.85, 0.75):
            a = [r.rec * factor for r in rows]
            b = [r.rec * factor for r in rows]
            assert a == b
            assert all(x <= r.rec + 1e-9 for x, r in zip(a, rows))


# ---------------------------------------------------------------------------
# Anchor selection
# ---------------------------------------------------------------------------

class TestAnchorSelection:
    """The 1Y board picks each player's highest-scoring season. For several
    players that is not the season the public remembers, and the margin is
    small. Pinned to keep the published gaps honest."""

    @pytest.mark.parametrize(
        "player,chosen,alternative,max_gap",
        [
            ("LeBron James", "2008-09", "2012-13", 0.5),
            ("Kobe Bryant", "2007-08", "2008-09", 0.5),
            ("Scottie Pippen", "1993-94", "1995-96", 1.0),
        ],
    )
    def test_the_chosen_anchor_wins_by_a_small_margin(
        self, boards, player, chosen, alternative, max_gap
    ):
        seasons = {r.label: r for r in boards.find(player, board="seasons")}
        assert chosen in seasons and alternative in seasons, sorted(seasons)
        gap = seasons[chosen].total - seasons[alternative].total
        assert gap > 0, f"{player}: {chosen} should be the higher-scoring season"
        assert gap <= max_gap, f"{player}: gap {gap:.2f} is no longer narrow"

    def test_the_one_year_anchor_matches_the_players_best_season(self, boards):
        """The selection rule, verified rather than assumed."""
        for row in boards.board("1y", 50):
            seasons = boards.find(row.player, board="seasons")
            if not seasons:
                continue
            best = max(seasons, key=lambda r: r.total)
            assert row.anchor_season == best.anchor_season, row.player


# ---------------------------------------------------------------------------
# Formula variants
# ---------------------------------------------------------------------------

class TestFormulaVariants:
    """The variants are a sandbox: they must never touch production, and their
    published movement numbers must reproduce."""

    @pytest.fixture(scope="class")
    def variant_run(self):
        from scripts.experiment_formula_variants import run

        return run("1y", 100)

    def test_the_baseline_variant_moves_nothing(self, variant_run):
        baseline = variant_run["results"]["A"]
        assert baseline["moved_rows"] == 0
        assert baseline["max_move"] == 0
        assert baseline["top10_retained"] == 10

    def test_every_documented_variant_is_present(self, variant_run):
        assert set(variant_run["results"]) == {
            "A", "B", "C", "D", "E", "H4", "H5", "I15", "I25", "J",
        }

    def test_variant_c_moves_no_row_in_the_top_hundred(self, variant_run):
        """The surgical PO floor. Its whole argument is that it is narrow."""
        assert variant_run["results"]["C"]["moved_rows"] == 0

    def test_no_variant_dislodges_jordan_from_first(self, variant_run):
        rows = {r.row_id: r for r in variant_run["rows"]}
        for key, result in variant_run["results"].items():
            top = next(rid for rid, rank in result["ranks"].items() if rank == 1)
            assert rows[top].player == "Michael Jordan", key

    def test_the_flagged_rows_barely_move_under_any_variant(self, variant_run):
        """The central conclusion: across ten alternatives, the seasons the
        review objected to stay put. If this fails, one of the variants found
        something the diagnosis missed."""
        rows = {r.row_id: r for r in variant_run["rows"]}
        flagged = {
            "Shai Gilgeous-Alexander": "2024-25",
            "Victor Wembanyama": "2025-26",
            "Karl Malone": "1996-97",
        }
        for player, season in flagged.items():
            row_id = next(
                rid for rid, r in rows.items()
                if r.player == player and r.label == season
            )
            moves = {k: res["moves"][row_id] for k, res in variant_run["results"].items()}
            assert all(m == 0 for m in moves.values()), (player, moves)

    def test_running_the_variants_writes_nothing(self, variant_run):
        """Read-only by construction; asserted so a future edit cannot quietly
        make the sandbox a generator."""
        import scripts.experiment_formula_variants as mod
        source = Path(mod.__file__).read_text()
        for forbidden in ("write_text", "to_parquet", "to_csv", "json.dump", "open("):
            assert forbidden not in source, forbidden

    def test_the_variant_run_is_deterministic(self):
        from scripts.experiment_formula_variants import run

        a = run("1y", 50)["results"]["I25"]["ranks"]
        b = run("1y", 50)["results"]["I25"]["ranks"]
        assert a == b
