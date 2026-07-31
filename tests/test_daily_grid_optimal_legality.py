"""The best legal grid obeys the game's own rules (Phase 12A).

The Daily Grid tells the player two things: fill nine squares with nine
DIFFERENT players, and here is what PEAK3 would have done. If the second one
breaks the first one, the screen is showing an impossible board and the
percentage it quotes is measured against something the player was never allowed
to build.

These tests pin that the comparison is a single legal assignment, and that the
two consequences of solving the grid AS A WHOLE are reported rather than
papered over:

  * the best legal grid can score LESS than the player on one square (it traded
    that square away) -- `beat_optimal`;
  * it can reuse a player the player already spent elsewhere --
    `optimal_player_user_square`.

See docs/game-design/DAILY_GRID.md and nba_peak/daily_grid/optimal.py.
"""
from __future__ import annotations

import datetime
from collections import Counter

import pytest

from nba_peak.daily_grid.generator import generate_board, get_board
from nba_peak.daily_grid.optimal import build_result, solve_optimal
from nba_peak.daily_grid.pool import load_pool
from nba_peak.daily_grid.scoring import score_cell
from nba_peak.daily_grid.search import unused_answer_for_cell

SAMPLE_DATES = [
    "2026-01-01",
    "2026-03-14",
    "2026-05-05",
    "2026-07-30",
    "2026-11-11",
    "2027-02-02",
]


@pytest.fixture(scope="module")
def pool():
    return load_pool()


def _reference_fill(board, pool):
    """Nine valid answers using nine different players -- a real completed
    board, built the same way a player's would be."""
    used: set[str] = set()
    filled = []
    for cell in board.cells:
        answer = unused_answer_for_cell(board, cell.row, cell.col, frozenset(used))
        assert answer is not None, (board.date, cell.row, cell.col)
        used.add(answer.player_slug)
        filled.append((cell.row, cell.col, answer.id))
    return filled


class TestOptimalIsLegal:
    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_the_optimal_grid_uses_nine_different_players(self, date, pool):
        solution = solve_optimal(get_board(date), pool=pool)
        slugs = [c.player_season.player_slug for c in solution.cells]
        assert len(slugs) == 9
        assert len(set(slugs)) == 9, [s for s, n in Counter(slugs).items() if n > 1]

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_the_optimal_grid_uses_nine_different_seasons(self, date, pool):
        solution = solve_optimal(get_board(date), pool=pool)
        ids = [c.player_season.id for c in solution.cells]
        assert len(set(ids)) == 9

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_every_optimal_answer_is_actually_valid_for_its_square(self, date, pool):
        """Legal means legal on both axes, not just distinct."""
        board = get_board(date)
        solution = solve_optimal(board, pool=pool)
        for optimal_cell in solution.cells:
            cell = board.cell(optimal_cell.row, optimal_cell.col)
            assert optimal_cell.player_season.id in set(cell.answer_ids)

    def test_a_full_year_never_repeats_a_player(self, pool):
        """The invariant has to hold for every board that will ever ship, not
        for a lucky sample -- this is the bug the phase exists to close."""
        start = datetime.date(2026, 1, 1)
        for offset in range(365):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            solution = solve_optimal(get_board(date), pool=pool)
            slugs = [c.player_season.player_slug for c in solution.cells]
            assert len(set(slugs)) == 9, (date, slugs)

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_the_comparison_never_repeats_a_player(self, date, pool):
        """The same assertion at the layer the UI actually reads."""
        board = get_board(date)
        result = build_result(board, _reference_fill(board, pool), pool=pool)
        slugs = [c.optimal_player_season.player_slug for c in result.cells]
        ids = [c.optimal_player_season.id for c in result.cells]
        assert len(set(slugs)) == 9, [s for s, n in Counter(slugs).items() if n > 1]
        assert len(set(ids)) == 9

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_todays_max_is_the_total_of_the_grid_that_is_shown(self, date, pool):
        """The quoted maximum must be the sum of the nine squares displayed --
        not a number from some other, unshown assignment."""
        board = get_board(date)
        result = build_result(board, _reference_fill(board, pool), pool=pool)
        assert result.optimal_total == sum(c.optimal_points for c in result.cells)

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_percent_is_measured_against_the_shown_grid(self, date, pool):
        board = get_board(date)
        result = build_result(board, _reference_fill(board, pool), pool=pool)
        expected = round(100.0 * result.user_total / result.optimal_total, 1)
        assert result.percent_of_best == expected

    @pytest.mark.parametrize("date", SAMPLE_DATES)
    def test_the_legal_grid_is_never_beaten_in_total_by_a_real_board(self, date, pool):
        """It may lose a SQUARE, but it is the maximum over whole legal grids,
        so no legal fill can beat its total."""
        board = get_board(date)
        result = build_result(board, _reference_fill(board, pool), pool=pool)
        assert result.user_total <= result.optimal_total


class TestGridWideConsequencesAreReported:
    """Solving the grid as a whole has two visible side effects. Both used to be
    shown as something else; these pin that they are now named."""

    def _first_case(self, pool, predicate):
        start = datetime.date(2026, 1, 1)
        for offset in range(40):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            result = build_result(board, _reference_fill(board, pool), pool=pool)
            for cell in result.cells:
                if predicate(cell):
                    return date, result, cell
        return None, None, None

    def test_a_square_the_player_wins_is_reported_as_beaten_not_as_max(self, pool):
        """The bug: `points_left` floors at 0, so a square where the player
        outscored the assignment rendered as 'no better answer existed'."""
        date, _, cell = self._first_case(pool, lambda c: c.user_points > c.optimal_points)
        assert date is not None, "no board produced a square the reference fill wins"
        assert cell.beat_optimal is True
        assert cell.points_left == 0
        # `matched_optimal` stays true (points_left is 0), which is exactly why
        # `beat_optimal` had to be a separate flag rather than a re-definition.
        assert cell.matched_optimal is True

    def test_a_square_the_player_ties_is_not_flagged_as_beaten(self, pool):
        date, result, _ = self._first_case(pool, lambda c: c.user_points == c.optimal_points)
        assert date is not None
        for cell in result.cells:
            if cell.user_points == cell.optimal_points:
                assert cell.beat_optimal is False

    def test_an_optimal_pick_the_player_used_elsewhere_names_that_square(self, pool):
        """The reported symptom: the same name appears twice down the list, once
        as the player's pick and once as the optimal grid's. It is legal; the
        fix is to say where they spent them."""
        date, result, cell = self._first_case(
            pool, lambda c: c.optimal_player_user_square is not None
        )
        assert date is not None, "no board produced a user/optimal identity overlap"
        assert isinstance(cell.optimal_player_user_square, str)
        assert cell.optimal_player_user_square
        # The named square must be one this very board actually has.
        board = get_board(date)
        from nba_peak.daily_grid.constraints import constraint_by_id

        labels = {
            f"{constraint_by_id(c.row_constraint_id).short_label}"
            f" x {constraint_by_id(c.col_constraint_id).short_label}"
            for c in board.cells
        }
        assert cell.optimal_player_user_square in labels

    def test_a_square_matching_the_players_own_pick_reports_no_overlap(self, pool):
        """An optimal answer identical to what the player put in THIS square is
        already reported by `matched_optimal`; repeating it as an overlap note
        would read as 'you played them somewhere else'."""
        start = datetime.date(2026, 1, 1)
        checked = 0
        for offset in range(40):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            result = build_result(board, _reference_fill(board, pool), pool=pool)
            for cell in result.cells:
                same = (
                    cell.optimal_player_season.player_slug
                    == cell.user_player_season.player_slug
                )
                if same:
                    assert cell.optimal_player_user_square is None
                    checked += 1
        assert checked > 0, "no board had the player matching the optimal identity"


class TestLegalGridVsIsolatedMax:
    """The two concepts the brief asks to keep distinct."""

    def test_a_squares_isolated_max_can_exceed_the_legal_grids_value_there(self, pool):
        """This is WHY the distinction matters: taking every square's isolated
        best would produce a higher total that no legal board can reach."""
        found = False
        start = datetime.date(2026, 1, 1)
        for offset in range(20):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            solution = solve_optimal(board, pool=pool)
            for cell, optimal_cell in zip(board.cells, solution.cells):
                isolated = max(
                    score_cell(pool.by_id[a], cell).arena_points for a in cell.answer_ids
                )
                assert isolated >= optimal_cell.cell_score.arena_points
                if isolated > optimal_cell.cell_score.arena_points:
                    found = True
        assert found, (
            "no board showed a square whose isolated max beats the legal grid -- "
            "the distinction this phase documents would be vacuous"
        )

    def test_the_sum_of_isolated_maxima_is_not_what_is_quoted(self, pool):
        """`optimal_total` must be the legal grid's total, which is generally
        LOWER than the (unreachable) sum of per-square maxima."""
        board = get_board("2026-03-14")
        solution = solve_optimal(board, pool=pool)
        isolated_sum = sum(
            max(score_cell(pool.by_id[a], cell).arena_points for a in cell.answer_ids)
            for cell in board.cells
        )
        assert solution.total_points <= isolated_sum

    def test_a_repeating_optimal_would_fail_loudly(self, pool, monkeypatch):
        """The invariant is asserted in build_result, not merely assumed. If the
        solver ever regressed, the screen must not quietly show an illegal grid."""
        board = get_board("2026-03-14")
        real = solve_optimal(board, pool=pool)

        class _Repeating:
            board_id = real.board_id
            date = real.date
            total_points = real.total_points
            exact = True
            # Every square answered by the first cell's player.
            cells = tuple(
                type(c)(
                    row=c.row,
                    col=c.col,
                    player_season=real.cells[0].player_season,
                    cell_score=c.cell_score,
                )
                for c in real.cells
            )

            def cell(self, row, col):
                for candidate in self.cells:
                    if candidate.row == row and candidate.col == col:
                        return candidate
                raise KeyError

        monkeypatch.setattr(
            "nba_peak.daily_grid.optimal.get_optimal", lambda b, pool=None: _Repeating()
        )
        with pytest.raises(RuntimeError, match="repeats a player"):
            build_result(board, _reference_fill(board, pool), pool=pool)
