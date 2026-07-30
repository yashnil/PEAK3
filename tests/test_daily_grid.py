"""Daily Grid Challenge (Phase 11A) — model-layer tests.

Covers the four properties the game rests on:
  1. every shipped constraint is a real, correct predicate over real data
  2. a date always produces the same board, and different dates differ
  3. every published board is genuinely solvable, verified against the pool
  4. validation accepts real answers, rejects everything else with a reason
"""
from __future__ import annotations

import datetime

import pytest

from nba_peak.daily_grid import constraints as constraints_module
from nba_peak.daily_grid.constraints import (
    COMPONENT_PERCENTILE,
    FRANCHISES,
    build_constraints,
    constraint_by_id,
)
from nba_peak.daily_grid.generator import (
    GRID_SIZE,
    MAX_PER_CATEGORY,
    MAX_SQUARES_ONE_PLAYER_TOPS,
    MAX_TEAM_CONSTRAINTS,
    MIN_ANCHOR_CONSTRAINTS,
    MIN_ANSWERS_PER_CELL,
    MIN_PLAYERS_PER_CELL,
    MIN_STRONG_OPTIONS,
    MIN_TEAM_CONSTRAINTS,
    PREFERRED_PEAK3_NATIVE,
    _BOARD_CACHE,
    _BOARD_CACHE_MAX,
    BoardGenerationFailed,
    InvalidGridDate,
    board_id,
    generate_board,
    get_board,
    grid_seed,
    rarity_bucket,
    today_utc_date,
    validate_grid_date,
)
from nba_peak.daily_grid.optimal import build_result, solve_optimal
from nba_peak.daily_grid.pool import load_pool
from nba_peak.daily_grid.scoring import (
    RARITY_MULTIPLIERS,
    max_possible_cell_points,
    score_cell,
)
from nba_peak.daily_grid.search import (
    MAX_IDENTITIES_FOR_ELIGIBILITY,
    board_reference_solution,
    search_player_seasons,
    unused_answer_for_cell,
)
from nba_peak.daily_grid.validation import InvalidCell, validate_answer


# A spread of dates used wherever a property must hold for every board, not
# just a lucky one. Includes a leap day and a year boundary.
SAMPLE_DATES = [
    "2026-01-01",
    "2026-02-28",
    "2026-07-30",
    "2026-08-15",
    "2026-11-11",
    "2026-12-31",
    "2027-03-04",
    "2028-02-29",
]


@pytest.fixture(scope="module")
def pool():
    return load_pool()


@pytest.fixture(scope="module")
def taxonomy(pool):
    return build_constraints(pool)


@pytest.fixture(scope="module")
def boards(pool, taxonomy):
    return {
        date: generate_board(date, pool=pool, constraints=taxonomy)
        for date in SAMPLE_DATES
    }


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------

class TestPool:
    def test_pool_is_non_trivial(self, pool):
        assert len(pool) > 5000
        assert len({ps.player_slug for ps in pool.seasons}) > 1000

    def test_answer_ids_are_unique(self, pool):
        ids = [ps.id for ps in pool.seasons]
        assert len(ids) == len(set(ids))

    def test_no_multi_team_aggregate_rows(self, pool):
        assert not {ps.team for ps in pool.seasons} & {"2TM", "3TM", "TOT"}

    def test_every_season_has_a_real_franchise_name(self, pool):
        for player_season in pool.seasons:
            assert player_season.team_name
            assert player_season.team_name != player_season.team or len(player_season.team) > 3

    def test_known_season_has_correct_real_facts(self, pool):
        """Jordan's 1990-91: the model's own rank-1 single season, and a
        real MVP + championship + Finals MVP year. Any of these drifting
        means the pool is reading the wrong columns."""
        mj = pool.get("michael-jordan-199091-chi")
        assert mj is not None
        assert mj.player_name == "Michael Jordan"
        assert mj.season == "1990-91"
        assert mj.team_name == "Chicago Bulls"
        assert mj.mvp_rank == 1
        assert mj.champion is True
        assert mj.finals_mvp is True
        assert mj.playoff_round == "Champion"
        # Matches leaderboards/ rank 1 for the 1-year window.
        assert mj.prime_score == pytest.approx(97.53, abs=0.01)

    def test_scores_are_finite_and_in_range(self, pool):
        for player_season in pool.seasons:
            assert 0.0 < player_season.prime_score <= 100.0


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

class TestConstraints:
    def test_ids_are_unique(self, taxonomy):
        ids = [c.id for c in taxonomy]
        assert len(ids) == len(set(ids))

    def test_every_category_is_represented(self, taxonomy):
        categories = {c.category for c in taxonomy}
        assert categories == {
            "team",
            "award",
            "era",
            "position",
            "peak",
            "component",
            "outcome",
        }

    def test_all_thirty_franchises_ship(self, taxonomy):
        team_ids = {c.id for c in taxonomy if c.category == "team"}
        assert len(team_ids) == 30 == len(FRANCHISES)

    def test_every_constraint_matches_at_least_one_season(self, taxonomy, pool):
        """A constraint nothing satisfies is a data bug, not a hard puzzle."""
        for constraint in taxonomy:
            assert constraint.matches(pool.frame).sum() > 0, constraint.id

    def test_no_constraint_matches_everything(self, taxonomy, pool):
        """A constraint everything satisfies carries no information."""
        total = len(pool.frame)
        for constraint in taxonomy:
            assert constraint.matches(pool.frame).sum() < total, constraint.id

    @pytest.mark.parametrize(
        "constraint_id,valid_id,invalid_id",
        [
            # Team: Jordan's 1990-91 is a Bulls season, not a Lakers one.
            ("team_chi", "michael-jordan-199091-chi", "magic-johnson-198687-lal"),
            ("team_lal", "magic-johnson-198687-lal", "michael-jordan-199091-chi"),
            # MVP: Magic won it in 1986-87; Jordan did not win it in 1989-90.
            ("award_mvp", "magic-johnson-198687-lal", "michael-jordan-198990-chi"),
            # DPOY: Hakeem won it in 1993-94; Jordan never did.
            ("award_dpoy", "hakeem-olajuwon-199394-hou", "michael-jordan-199091-chi"),
            # Finals MVP: Jordan in 1990-91; Malone never won one.
            ("award_finals_mvp", "michael-jordan-199091-chi", "karl-malone-199697-uta"),
            # All-NBA First Team: Malone 1996-97 yes; a role player no.
            ("award_all_nba_first", "karl-malone-199697-uta", "steve-kerr-199697-chi"),
            # Era.
            ("era_1990s", "michael-jordan-199091-chi", "magic-johnson-198687-lal"),
            ("era_1980s", "magic-johnson-198687-lal", "michael-jordan-199091-chi"),
            # Position: Hakeem is a center that season, Jordan a guard.
            ("pos_center", "hakeem-olajuwon-199394-hou", "michael-jordan-199091-chi"),
            ("pos_guard", "michael-jordan-199091-chi", "hakeem-olajuwon-199394-hou"),
            # Outcome: Jordan's 1990-91 won the title; Malone's 1996-97 lost
            # the Finals (so it satisfies "reached the Finals" but not
            # "champion") -- the exact distinction the ladder must respect.
            ("outcome_champion", "michael-jordan-199091-chi", "karl-malone-199697-uta"),
            ("outcome_finals", "karl-malone-199697-uta", "michael-jordan-198990-chi"),
        ],
    )
    def test_known_valid_and_invalid_examples(
        self, taxonomy, pool, constraint_id, valid_id, invalid_id
    ):
        constraint = constraint_by_id(constraint_id, pool)
        mask = constraint.matches(pool.frame)
        ids = pool.frame["answer_id"].to_numpy()
        matched = set(ids[mask].tolist())
        assert valid_id in pool.by_id, f"fixture season missing from pool: {valid_id}"
        assert invalid_id in pool.by_id, f"fixture season missing from pool: {invalid_id}"
        assert valid_id in matched, f"{constraint_id} should match {valid_id}"
        assert invalid_id not in matched, f"{constraint_id} should not match {invalid_id}"

    def test_peak_threshold_constraints_are_exactly_their_threshold(self, taxonomy, pool):
        for constraint in taxonomy:
            if constraint.category != "peak":
                continue
            threshold = float(constraint.id.split("_")[1])
            mask = constraint.matches(pool.frame)
            scores = pool.frame["prime_score"].to_numpy()
            assert (scores[mask] >= threshold).all()
            assert (scores[~mask] < threshold).all()

    def test_component_constraints_select_the_top_decile(self, taxonomy, pool):
        for constraint in taxonomy:
            if constraint.category != "component":
                continue
            share = constraint.matches(pool.frame).mean()
            assert 1 - COMPONENT_PERCENTILE - 0.02 <= share <= 1 - COMPONENT_PERCENTILE + 0.02

    def test_position_groups_are_mutually_exclusive(self, taxonomy, pool):
        masks = [
            c.matches(pool.frame) for c in taxonomy if c.category == "position"
        ]
        overlap = masks[0].astype(int) + masks[1].astype(int) + masks[2].astype(int)
        assert overlap.max() <= 1

    def test_era_constraints_are_mutually_exclusive(self, taxonomy, pool):
        era_masks = [c.matches(pool.frame) for c in taxonomy if c.category == "era"]
        stacked = sum(mask.astype(int) for mask in era_masks)
        assert stacked.max() <= 1

    def test_only_1979_80_falls_outside_every_decade(self, taxonomy, pool):
        """The data window opens at 1979-80, which is a 1970s season start.
        There is deliberately no '1970s' constraint for that single year (see
        constraints.DECADES), so those seasons match no era -- they are still
        valid answers for every other constraint. Asserted explicitly so the
        gap stays the known one-season one and never widens."""
        era_masks = [c.matches(pool.frame) for c in taxonomy if c.category == "era"]
        stacked = sum(mask.astype(int) for mask in era_masks)
        uncovered = pool.frame["season"].to_numpy()[stacked == 0]
        assert set(uncovered.tolist()) == {"1979-80"}

    def test_franchise_relocations_fold_in(self, taxonomy, pool):
        """A Seattle SuperSonics season answers 'Oklahoma City Thunder'."""
        okc = constraint_by_id("team_okc", pool)
        mask = okc.matches(pool.frame)
        teams = set(pool.frame["team"].to_numpy()[mask].tolist())
        assert "SEA" in teams and "OKC" in teams

    def test_unknown_constraint_id_raises(self, pool):
        with pytest.raises(KeyError):
            constraint_by_id("team_atlantis", pool)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class TestDeterminism:
    def test_same_date_same_seed(self):
        assert grid_seed("2026-07-30") == grid_seed("2026-07-30")

    def test_different_dates_different_seeds(self):
        seeds = {grid_seed(d) for d in SAMPLE_DATES}
        assert len(seeds) == len(SAMPLE_DATES)

    def test_seed_is_in_signed_32_bit_range(self):
        for date in SAMPLE_DATES:
            assert 0 <= grid_seed(date) < 2 ** 31

    def test_same_date_produces_identical_board(self, pool, taxonomy):
        first = generate_board("2026-07-30", pool=pool, constraints=taxonomy)
        second = generate_board("2026-07-30", pool=pool, constraints=taxonomy)
        assert [c.id for c in first.rows] == [c.id for c in second.rows]
        assert [c.id for c in first.cols] == [c.id for c in second.cols]
        assert first.board_id == second.board_id
        assert first.difficulty == second.difficulty
        assert [c.answer_ids for c in first.cells] == [c.answer_ids for c in second.cells]

    def test_different_dates_produce_different_boards(self, boards):
        signatures = {
            (
                tuple(c.id for c in board.rows),
                tuple(c.id for c in board.cols),
            )
            for board in boards.values()
        }
        assert len(signatures) == len(boards)

    def test_a_full_year_of_boards_is_all_distinct(self, pool, taxonomy):
        """The real product property: no repeated board inside a year."""
        start = datetime.date(2026, 1, 1)
        signatures = set()
        for offset in range(365):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = generate_board(date, pool=pool, constraints=taxonomy)
            signatures.add(
                (tuple(c.id for c in board.rows), tuple(c.id for c in board.cols))
            )
        assert len(signatures) == 365

    def test_board_id_is_date_keyed(self):
        assert board_id("2026-07-30") == "daily-grid-v1-2026-07-30"
        assert board_id("2026-07-31") != board_id("2026-07-30")

    def test_get_board_cache_matches_fresh_generation(self):
        cached = get_board("2026-07-30")
        fresh = generate_board("2026-07-30")
        assert [c.id for c in cached.rows] == [c.id for c in fresh.rows]
        assert [c.id for c in cached.cols] == [c.id for c in fresh.cols]

    def test_board_cache_is_bounded(self):
        """`date` is caller-supplied, so an unbounded cache would let date
        enumeration grow the process without limit. Eviction is safe: a board
        is a pure function of its date, so an evicted date regenerates to
        exactly the same board."""
        start = datetime.date(2030, 1, 1)
        for offset in range(_BOARD_CACHE_MAX + 25):
            get_board((start + datetime.timedelta(days=offset)).isoformat())
        assert len(_BOARD_CACHE) <= _BOARD_CACHE_MAX

    def test_an_evicted_date_regenerates_identically(self):
        first = get_board("2031-06-01")
        signature = (
            tuple(c.id for c in first.rows),
            tuple(c.id for c in first.cols),
        )
        start = datetime.date(2032, 1, 1)
        for offset in range(_BOARD_CACHE_MAX + 5):
            get_board((start + datetime.timedelta(days=offset)).isoformat())
        again = get_board("2031-06-01")
        assert (
            tuple(c.id for c in again.rows),
            tuple(c.id for c in again.cols),
        ) == signature

    @pytest.mark.parametrize("bad", ["", "2026-13-01", "2026-02-30", "30-07-2026", "today", None])
    def test_invalid_dates_are_rejected(self, bad):
        with pytest.raises(InvalidGridDate):
            validate_grid_date(bad)

    def test_today_utc_date_is_wellformed(self):
        assert validate_grid_date(today_utc_date()) == today_utc_date()


# ---------------------------------------------------------------------------
# Solvability + board quality
# ---------------------------------------------------------------------------

class TestSolvability:
    def test_board_is_three_by_three(self, boards):
        for board in boards.values():
            assert len(board.rows) == GRID_SIZE
            assert len(board.cols) == GRID_SIZE
            assert len(board.cells) == GRID_SIZE * GRID_SIZE

    def test_every_cell_clears_the_answer_floor(self, boards):
        for date, board in boards.items():
            for cell in board.cells:
                assert cell.answer_count >= MIN_ANSWERS_PER_CELL, (date, cell.row, cell.col)
                # The brief's own hard minimum, asserted independently of the
                # stricter floor the generator actually applies.
                assert cell.answer_count >= 3

    def test_every_cell_has_enough_distinct_players(self, boards):
        for date, board in boards.items():
            for cell in board.cells:
                assert cell.distinct_player_count >= MIN_PLAYERS_PER_CELL, (
                    date,
                    cell.row,
                    cell.col,
                )

    def test_every_board_has_a_nine_distinct_player_solution(self, boards, pool):
        """The distinct-identity rule can never make a published board
        unsolvable -- proven by actually solving it."""
        for date, board in boards.items():
            solution = board_reference_solution(board, pool=pool)
            assert solution is not None, date
            assert len(solution) == 9
            assert len({ps.player_slug for ps in solution}) == 9, date

    def test_no_duplicate_constraint_on_a_board(self, boards):
        for board in boards.values():
            ids = [c.id for c in board.rows] + [c.id for c in board.cols]
            assert len(ids) == len(set(ids))

    def test_nested_and_exclusive_constraints_never_cross(self, boards):
        """'85+ PEAK x 60+ PEAK' and 'Lakers x Celtics' must never appear."""
        for board in boards.values():
            for row in board.rows:
                for col in board.cols:
                    if row.exclusive_group is None:
                        continue
                    assert row.exclusive_group != col.exclusive_group, (
                        board.date,
                        row.id,
                        col.id,
                    )

    def test_boards_mix_recognizable_and_peak3_native_categories(self, boards):
        for date, board in boards.items():
            categories = [c.category for c in board.rows] + [
                c.category for c in board.cols
            ]
            recognizable = sum(
                1
                for cat in categories
                if cat in {"team", "award", "era", "position", "outcome"}
            )
            native = sum(1 for cat in categories if cat in {"peak", "component"})
            assert recognizable >= 3, (date, categories)
            assert native >= 1, (date, categories)
            assert len(set(categories)) >= 4, (date, categories)

    def test_boards_are_never_all_teams(self, boards):
        for board in boards.values():
            categories = [c.category for c in board.rows] + [
                c.category for c in board.cols
            ]
            assert categories.count("team") <= 3

    def test_boards_always_include_at_least_one_team(self, boards):
        """A franchise is the anchor a casual fan reads first. Phase 11B
        lowered the floor from two to one and the ceiling from three to two:
        a third franchise crowded out the categories that make a board
        interesting, and franchise-heavy boards were the source of the
        "this is just a database lookup" feeling."""
        for board in boards.values():
            categories = [c.category for c in board.rows] + [
                c.category for c in board.cols
            ]
            assert MIN_TEAM_CONSTRAINTS <= categories.count("team") <= MAX_TEAM_CONSTRAINTS

    def test_difficulty_is_a_known_label(self, boards):
        for board in boards.values():
            assert board.difficulty in {"easy", "medium", "hard"}

    def test_generation_does_not_need_pathological_retries(self, boards):
        for board in boards.values():
            assert board.attempts < 2000


# ---------------------------------------------------------------------------
# Answer-key confidentiality
# ---------------------------------------------------------------------------

class TestNoAnswerKeyLeak:
    def test_public_payload_excludes_answers(self, boards):
        for board in boards.values():
            payload = board.as_public_dict()
            serialized = repr(payload)
            for cell in board.cells:
                for answer_id in cell.answer_ids[:5]:
                    assert answer_id not in serialized

    def test_public_payload_excludes_raw_answer_counts(self, boards):
        """Even the count is withheld: on a six-answer cell it narrows the
        search almost as much as the key itself. Only the coarse bucket ships."""
        for board in boards.values():
            for cell_payload in board.as_public_dict()["cells"]:
                assert "answer_count" not in cell_payload
                assert "answer_ids" not in cell_payload
                assert cell_payload["rarity_bucket"] in {
                    "very_rare",
                    "rare",
                    "uncommon",
                    "common",
                    "very_common",
                }

    def test_public_payload_carries_what_the_client_needs(self, boards):
        for board in boards.values():
            payload = board.as_public_dict()
            assert payload["board_id"] == board.board_id
            assert payload["date"] == board.date
            assert len(payload["rows"]) == 3
            assert len(payload["cols"]) == 3
            assert len(payload["cells"]) == 9
            assert payload["rules"]["unique_player_identity"] is True
            for axis in payload["rows"] + payload["cols"]:
                assert axis["label"] and axis["description"]

    def test_public_payload_omits_the_seed_internals(self, boards):
        """The board is reproducible from the date alone; nothing about the
        internal answer sets should ride along."""
        for board in boards.values():
            payload = board.as_public_dict()
            assert "cells" in payload
            for cell_payload in payload["cells"]:
                assert set(cell_payload) == {
                    "row",
                    "col",
                    "row_constraint_id",
                    "col_constraint_id",
                    "rarity_bucket",
                }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class TestValidation:
    def test_accepts_a_known_valid_answer_in_every_cell(self, boards, pool):
        for date, board in boards.items():
            for cell in board.cells:
                answer = unused_answer_for_cell(board, cell.row, cell.col, pool=pool)
                assert answer is not None, (date, cell.row, cell.col)
                result = validate_answer(board, cell.row, cell.col, answer.id, pool=pool)
                assert result.valid, (date, cell.row, cell.col, result.reason)
                assert result.player_season is not None
                assert result.cell_score is not None

    def test_a_full_board_can_be_solved_through_validation(self, boards, pool):
        """The end-to-end product claim: nine submissions, nine different
        players, every one accepted."""
        for date, board in boards.items():
            solution = board_reference_solution(board, pool=pool)
            assert solution is not None, date
            used: set[str] = set()
            filled: list[tuple[int, int]] = []
            for cell, player_season in zip(board.cells, solution):
                result = validate_answer(
                    board,
                    cell.row,
                    cell.col,
                    player_season.id,
                    used_player_slugs=used,
                    filled_cells=filled,
                    pool=pool,
                )
                assert result.valid, (date, cell.row, cell.col, result.reason)
                used.add(player_season.player_slug)
                filled.append((cell.row, cell.col))
            assert len(used) == 9

    def test_rejects_an_unknown_answer_id(self, boards, pool):
        board = boards["2026-07-30"]
        result = validate_answer(board, 0, 0, "not-a-real-player-season", pool=pool)
        assert result.valid is False
        assert result.reason_code == "unknown_answer"
        assert result.reason

    def test_rejects_a_season_that_fails_a_constraint(self, boards, pool):
        """Find a real season that misses one side of a real cell and check
        the message names the failure rather than saying 'invalid'."""
        board = boards["2026-07-30"]
        cell = board.cells[0]
        valid_ids = set(cell.answer_ids)
        wrong = next(ps for ps in pool.seasons if ps.id not in valid_ids)
        result = validate_answer(board, cell.row, cell.col, wrong.id, pool=pool)
        assert result.valid is False
        assert result.reason_code == "constraint_failed"
        assert result.reason and len(result.reason) > 10

    def test_rejects_a_reused_player_identity(self, boards, pool):
        board = boards["2026-07-30"]
        first = unused_answer_for_cell(board, 0, 0, pool=pool)
        result = validate_answer(
            board,
            0,
            1,
            first.id,
            used_player_slugs={first.player_slug},
            pool=pool,
        )
        assert result.valid is False
        assert result.reason_code == "player_already_used"
        assert first.player_name in result.reason

    def test_rejects_a_submission_into_a_filled_cell(self, boards, pool):
        board = boards["2026-07-30"]
        answer = unused_answer_for_cell(board, 1, 1, pool=pool)
        result = validate_answer(
            board, 1, 1, answer.id, filled_cells=[(1, 1)], pool=pool
        )
        assert result.valid is False
        assert result.reason_code == "cell_filled"

    def test_rejects_out_of_range_cells(self, boards, pool):
        board = boards["2026-07-30"]
        for row, col in [(-1, 0), (0, 3), (3, 3)]:
            with pytest.raises(InvalidCell):
                validate_answer(board, row, col, "anything", pool=pool)

    def test_the_same_player_in_a_different_season_is_still_blocked(self, boards, pool):
        """The rule is per IDENTITY, not per season -- documented product
        decision, asserted so it cannot silently loosen."""
        board = boards["2026-07-30"]
        first = unused_answer_for_cell(board, 0, 0, pool=pool)
        other_season = next(
            (
                ps
                for ps in pool.seasons
                if ps.player_slug == first.player_slug and ps.id != first.id
            ),
            None,
        )
        if other_season is None:
            pytest.skip("fixture player has only one season in the pool")
        result = validate_answer(
            board,
            0,
            1,
            other_season.id,
            used_player_slugs={first.player_slug},
            pool=pool,
        )
        assert result.valid is False
        assert result.reason_code == "player_already_used"


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

class TestScoring:
    def test_scoring_is_deterministic(self, boards, pool):
        board = boards["2026-07-30"]
        cell = board.cells[0]
        answer = unused_answer_for_cell(board, cell.row, cell.col, pool=pool)
        first = score_cell(answer, cell)
        second = score_cell(answer, cell)
        assert first == second

    def test_scores_are_bounded_and_positive(self, boards, pool):
        upper = max_possible_cell_points()
        for board in boards.values():
            for cell in board.cells:
                for answer_id in cell.answer_ids[:20]:
                    score = score_cell(pool.by_id[answer_id], cell)
                    assert 0 < score.arena_points <= upper

    def test_a_rarer_cell_pays_more_for_the_same_season(self, boards, pool):
        """The whole point of the rarity term."""
        board = boards["2026-07-30"]
        by_count = sorted(board.cells, key=lambda c: c.answer_count)
        tightest, loosest = by_count[0], by_count[-1]
        if rarity_bucket(tightest.answer_count) == rarity_bucket(loosest.answer_count):
            pytest.skip("this board's cells all land in one rarity bucket")
        answer = pool.by_id[tightest.answer_ids[0]]
        assert (
            score_cell(answer, tightest).arena_points
            >= score_cell(answer, loosest).arena_points
        )

    def test_a_better_season_pays_more_in_the_same_cell(self, boards, pool):
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        seasons = sorted(
            (pool.by_id[answer_id] for answer_id in cell.answer_ids),
            key=lambda ps: ps.prime_score,
        )
        assert (
            score_cell(seasons[-1], cell).arena_points
            > score_cell(seasons[0], cell).arena_points
        )

    def test_every_rarity_bucket_has_a_multiplier(self):
        for count in (0, 5, 9, 10, 24, 25, 74, 75, 199, 200, 5000):
            assert rarity_bucket(count) in RARITY_MULTIPLIERS

    def test_rarity_multipliers_decrease_as_cells_open_up(self):
        order = ["very_rare", "rare", "uncommon", "common", "very_common"]
        values = [RARITY_MULTIPLIERS[bucket] for bucket in order]
        assert values == sorted(values, reverse=True)


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class TestSearch:
    def test_finds_a_player_by_name(self, pool):
        hits = search_player_seasons("olajuwon", pool=pool)
        assert hits
        assert all("olajuwon" in h.player_season.player_name.lower() for h in hits)

    def test_short_queries_return_nothing(self, pool):
        assert search_player_seasons("j", pool=pool) == []
        assert search_player_seasons("", pool=pool) == []

    def test_a_season_token_narrows_results(self, pool):
        hits = search_player_seasons("jordan 1996", pool=pool)
        assert hits
        assert all(h.player_season.season.startswith("1996") for h in hits)

    def test_cell_scoped_search_ranks_valid_answers_first(self, boards, pool):
        board = boards["2026-07-30"]
        cell = board.cells[0]
        answer = pool.by_id[cell.answer_ids[0]]
        surname = answer.player_name.split()[-1]
        hits = search_player_seasons(
            surname, board=board, row=cell.row, col=cell.col, pool=pool
        )
        assert hits
        eligibility = [h.eligible for h in hits]
        # All eligible hits precede all ineligible ones.
        assert eligibility == sorted(eligibility, key=lambda e: 0 if e else 1)

    def test_cell_scoped_search_still_returns_invalid_options(self, boards, pool):
        """Filtering to only valid answers would leak the key by omission --
        a player could name someone, see only three of their seasons, and read
        the answer set off the search box. Every season a query matches comes
        back; the invalid ones are just marked.

        Uses a specific player (not a broad substring), since a broad query
        reveals no eligibility at all -- see
        test_a_broad_query_never_reveals_eligibility."""
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        answer = pool.by_id[cell.answer_ids[0]]
        all_seasons = [
            ps for ps in pool.seasons if ps.player_slug == answer.player_slug
        ]
        valid_ids = set(cell.answer_ids)
        if all(ps.id in valid_ids for ps in all_seasons):
            pytest.skip("this player's every season happens to fit the cell")
        hits = search_player_seasons(
            answer.player_name,
            board=board,
            row=cell.row,
            col=cell.col,
            limit=50,
            pool=pool,
        )
        assert any(h.eligible is True for h in hits)
        assert any(h.eligible is False for h in hits)

    def test_unscoped_search_reports_no_eligibility(self, pool):
        hits = search_player_seasons("jordan", pool=pool)
        assert hits
        assert all(h.eligible is None for h in hits)

    @pytest.mark.parametrize("broad", ["an", "er", "on", "ar", "in", "el"])
    def test_a_broad_query_never_reveals_eligibility(self, boards, pool, broad):
        """The bulk answer-key harvest this gate exists to stop: a meaningless
        substring matches hundreds of players, and eligibility ranking would
        float a large share of a cell's real answer set to the top of the list
        for someone who knows nothing. A broad query must reveal nothing."""
        board = boards["2026-07-30"]
        for cell in board.cells:
            hits = search_player_seasons(
                broad, board=board, row=cell.row, col=cell.col, limit=50, pool=pool
            )
            assert all(h.eligible is None for h in hits), (broad, cell.row, cell.col)

    def test_naming_a_player_does_reveal_season_eligibility(self, boards, pool):
        """The flip side: once the player has done the recall work, the search
        tells them WHICH of that player's seasons fits. There is no attempt
        limit, so withholding this would only make them submit the same name
        repeatedly."""
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        answer = pool.by_id[cell.answer_ids[0]]
        hits = search_player_seasons(
            answer.player_name,
            board=board,
            row=cell.row,
            col=cell.col,
            limit=50,
            pool=pool,
        )
        assert hits
        assert all(h.eligible is not None for h in hits)
        assert any(h.eligible for h in hits)

    def test_the_eligibility_gate_counts_identities_not_seasons(self, pool):
        """A single player has ~18 seasons in the pool; that must not read as
        a broad query. The gate counts distinct identities for exactly this
        reason."""
        hits = search_player_seasons("olajuwon", pool=pool)
        assert len(hits) > MAX_IDENTITIES_FOR_ELIGIBILITY
        assert len({h.player_season.player_slug for h in hits}) <= MAX_IDENTITIES_FOR_ELIGIBILITY

    def test_result_dicts_carry_no_answer_key_signal(self, boards, pool):
        """A search hit says whether THAT season fits -- which the player is
        about to learn anyway by submitting it -- and nothing about the rest
        of the answer set."""
        board = boards["2026-07-30"]
        cell = board.cells[0]
        hits = search_player_seasons(
            "james", board=board, row=cell.row, col=cell.col, pool=pool
        )
        for hit in hits:
            payload = hit.as_dict()
            assert set(payload) == {
                "id",
                "player_slug",
                "player_name",
                "season",
                "team",
                "team_name",
                "position",
                "label",
                "eligible",
            }


# ---------------------------------------------------------------------------
# Regression guards
# ---------------------------------------------------------------------------

class TestNoFabrication:
    def test_pool_never_invents_an_award(self, pool):
        """Award flags must come from the scored table, so the counts have to
        match the real historical record: one MVP and one DPOY per season."""
        mvps = [ps for ps in pool.seasons if ps.mvp_rank == 1]
        seasons_with_mvp = {ps.season for ps in mvps}
        assert len(mvps) == len(seasons_with_mvp), "more than one MVP in some season"
        dpoys = [ps for ps in pool.seasons if ps.dpoy_rank == 1]
        assert len({ps.season for ps in dpoys}) == len(dpoys)

    def test_champions_are_unique_per_season(self, pool):
        """Every champion season belongs to exactly one team per year."""
        by_season: dict[str, set[str]] = {}
        for player_season in pool.seasons:
            if player_season.champion:
                by_season.setdefault(player_season.season, set()).add(player_season.team)
        for season, teams in by_season.items():
            assert len(teams) == 1, (season, teams)

    def test_generation_failure_is_loud(self, pool):
        """A taxonomy too thin to build a board must raise, never publish a
        degraded grid."""
        thin = [c for c in build_constraints(pool) if c.category == "team"][:6]
        with pytest.raises(BoardGenerationFailed):
            generate_board("2026-07-30", pool=pool, constraints=thin)


# ---------------------------------------------------------------------------
# Phase 11B — no score before a pick is locked
# ---------------------------------------------------------------------------

class TestNoPreLockScoreLeak:
    """The mode's objective is to maximise total PEAK3 score, so a season's
    rating IS the answer to the puzzle. It must not be reachable before the
    player commits to that season."""

    def test_search_serialisation_carries_no_score(self, pool):
        for hit in search_player_seasons("olajuwon", pool=pool):
            payload = hit.as_dict()
            assert "prime_score" not in payload
            assert not any("score" in key for key in payload)

    def test_identity_shape_and_revealed_shape_differ_by_exactly_the_score(self, pool):
        player_season = pool.get("michael-jordan-199091-chi")
        identity = player_season.as_search_dict()
        revealed = player_season.as_dict()
        assert set(revealed) - set(identity) == {"prime_score"}
        assert "prime_score" not in identity

    def test_search_results_are_not_ordered_by_score(self, pool):
        """Ranking a player's seasons best-first would leak the target just as
        surely as printing the number -- the player would click the top row
        every time. Career order is neutral."""
        hits = search_player_seasons("olajuwon", limit=50, pool=pool)
        seasons = [h.player_season.season for h in hits]
        assert seasons == sorted(seasons)
        scores = [h.player_season.prime_score for h in hits]
        assert scores != sorted(scores, reverse=True)

    def test_a_rejected_answer_never_returns_its_score(self, boards, pool):
        """Otherwise every square is a free score oracle: submit a season you
        know will fail, read its rating, optimise the rest of the board."""
        board = boards["2026-07-30"]
        cell = board.cells[0]
        valid_ids = set(cell.answer_ids)
        wrong = next(ps for ps in pool.seasons if ps.id not in valid_ids)
        payload = validate_answer(
            board, cell.row, cell.col, wrong.id, pool=pool
        ).as_dict()
        assert payload["valid"] is False
        assert "prime_score" not in payload["player_season"]
        assert "cell_score" not in payload

    def test_a_locked_answer_reveals_its_score_through_cell_score(self, boards, pool):
        board = boards["2026-07-30"]
        cell = board.cells[0]
        answer = unused_answer_for_cell(board, cell.row, cell.col, pool=pool)
        payload = validate_answer(
            board, cell.row, cell.col, answer.id, pool=pool
        ).as_dict()
        assert payload["valid"] is True
        # The card still carries no score; the square's own score does.
        assert "prime_score" not in payload["player_season"]
        assert payload["cell_score"]["quality_points"] == pytest.approx(
            answer.prime_score, abs=0.01
        )

    def test_a_peak_threshold_rejection_does_not_print_the_score(self, boards, pool):
        """A peak-threshold square would otherwise answer 'what is this season
        rated?' for any season submitted to it."""
        peak_constraint = constraint_by_id("peak_85_plus", pool)
        below = next(ps for ps in pool.seasons if ps.prime_score < 85)
        from nba_peak.daily_grid.validation import _constraint_failure_reason

        reason = _constraint_failure_reason(below, peak_constraint)
        assert "below" in reason
        assert f"{below.prime_score:.1f}" not in reason
        assert str(int(below.prime_score)) not in reason.replace("85", "")


# ---------------------------------------------------------------------------
# Phase 11B — today's maximum
# ---------------------------------------------------------------------------

class TestOptimalSolution:
    def test_solution_fills_every_square_with_distinct_players(self, boards, pool):
        for date, board in boards.items():
            solution = solve_optimal(board, pool=pool)
            assert len(solution.cells) == 9, date
            assert len({c.player_season.player_slug for c in solution.cells}) == 9, date

    def test_every_optimal_answer_is_actually_valid_for_its_square(self, boards, pool):
        """The maximum has to be a legal board, not just a big number."""
        for date, board in boards.items():
            solution = solve_optimal(board, pool=pool)
            used: set[str] = set()
            for cell in solution.cells:
                result = validate_answer(
                    board,
                    cell.row,
                    cell.col,
                    cell.player_season.id,
                    used_player_slugs=used,
                    pool=pool,
                )
                assert result.valid, (date, cell.row, cell.col, result.reason)
                used.add(cell.player_season.player_slug)

    def test_total_equals_the_sum_of_its_squares(self, boards, pool):
        for board in boards.values():
            solution = solve_optimal(board, pool=pool)
            assert solution.total_points == sum(
                c.cell_score.arena_points for c in solution.cells
            )

    def test_is_deterministic_down_to_the_named_seasons(self, boards, pool):
        """The result screen names these nine seasons, so 'deterministic' has
        to mean the same seasons, not just the same total."""
        for board in boards.values():
            first = solve_optimal(board, pool=pool)
            second = solve_optimal(board, pool=pool)
            assert first.total_points == second.total_points
            assert [c.player_season.id for c in first.cells] == [
                c.player_season.id for c in second.cells
            ]

    def test_is_claimed_exact(self, boards, pool):
        """The reduction to a linear assignment problem is exact, so the UI is
        entitled to say 'today's maximum' rather than 'best known'."""
        for board in boards.values():
            assert solve_optimal(board, pool=pool).exact is True

    def test_no_legal_board_beats_it(self, boards, pool):
        """The real optimality claim, checked against actual play: a large
        sample of randomly-built legal boards must never outscore it."""
        import random

        for date, board in boards.items():
            optimal = solve_optimal(board, pool=pool)
            rng = random.Random(hash(date) & 0xFFFF)
            for _ in range(200):
                used: set[str] = set()
                total = 0
                feasible = True
                for cell in sorted(board.cells, key=lambda c: c.distinct_player_count):
                    choices = [
                        pool.by_id[a]
                        for a in cell.answer_ids
                        if pool.by_id[a].player_slug not in used
                    ]
                    if not choices:
                        feasible = False
                        break
                    pick = rng.choice(choices)
                    used.add(pick.player_slug)
                    total += score_cell(pick, cell).arena_points
                if feasible:
                    assert total <= optimal.total_points, (date, total)

    def test_beats_a_greedy_fill(self, boards, pool):
        """Sanity that the optimiser is doing real work: it must be at least as
        good as taking each square's best available answer in turn."""
        for board in boards.values():
            optimal = solve_optimal(board, pool=pool)
            used: set[str] = set()
            greedy = 0
            for cell in board.cells:
                best = max(
                    (
                        pool.by_id[a]
                        for a in cell.answer_ids
                        if pool.by_id[a].player_slug not in used
                    ),
                    key=lambda ps: ps.prime_score,
                )
                used.add(best.player_slug)
                greedy += score_cell(best, cell).arena_points
            assert optimal.total_points >= greedy

    def test_is_never_part_of_the_public_board_payload(self, boards):
        """The whole puzzle is behind this. It must not ride along on the
        board response under any key."""
        for board in boards.values():
            serialized = repr(board.as_public_dict())
            for forbidden in ("optimal", "total_points", "best_cell", "exact"):
                assert forbidden not in serialized


class TestGridResult:
    def _complete(self, board, pool):
        solution = board_reference_solution(board, pool=pool)
        return [(c.row, c.col, ps.id) for c, ps in zip(board.cells, solution)]

    def test_compares_the_player_against_the_maximum(self, boards, pool):
        board = boards["2026-07-30"]
        result = build_result(board, self._complete(board, pool), pool=pool)
        assert result.user_total > 0
        assert result.optimal_total >= result.user_total
        assert 0 < result.percent_of_best <= 100.0
        assert len(result.cells) == 9

    def test_percent_is_consistent_with_the_totals(self, boards, pool):
        for board in boards.values():
            result = build_result(board, self._complete(board, pool), pool=pool)
            assert result.percent_of_best == pytest.approx(
                round(100.0 * result.user_total / result.optimal_total, 1)
            )

    def test_names_a_biggest_miss_whenever_points_were_left(self, boards, pool):
        board = boards["2026-07-30"]
        result = build_result(board, self._complete(board, pool), pool=pool)
        if result.user_total < result.optimal_total:
            assert result.biggest_miss is not None
            assert result.biggest_miss.points_left > 0
            assert result.biggest_miss.points_left == max(
                c.points_left for c in result.cells
            )
        else:
            assert result.biggest_miss is None

    def test_a_maximum_board_reports_no_miss_and_full_percent(self, boards, pool):
        """Play the optimal board itself: 100%, no miss, every square matched."""
        for date, board in boards.items():
            optimal = solve_optimal(board, pool=pool)
            filled = [(c.row, c.col, c.player_season.id) for c in optimal.cells]
            result = build_result(board, filled, pool=pool)
            assert result.user_total == result.optimal_total, date
            assert result.percent_of_best == 100.0, date
            assert result.biggest_miss is None, date
            assert result.squares_matching_optimal == 9, date

    def test_is_deterministic(self, boards, pool):
        board = boards["2026-07-30"]
        filled = self._complete(board, pool)
        first = build_result(board, filled, pool=pool).as_dict()
        second = build_result(board, filled, pool=pool).as_dict()
        assert first == second

    def test_carries_incorrect_attempts_through(self, boards, pool):
        board = boards["2026-07-30"]
        result = build_result(board, self._complete(board, pool), incorrect_attempts=7, pool=pool)
        assert result.incorrect_attempts == 7


# ---------------------------------------------------------------------------
# Phase 11B — board composition quality
# ---------------------------------------------------------------------------

class TestBoardQuality:
    def test_every_board_carries_the_preferred_peak3_native_count(self, boards):
        """Phase 11A allowed a single PEAK3-native axis, which produced boards
        that were franchises crossed with positions. The preference is two."""
        for date, board in boards.items():
            categories = [c.category for c in board.rows] + [c.category for c in board.cols]
            native = sum(1 for cat in categories if cat in {"peak", "component"})
            assert native >= PREFERRED_PEAK3_NATIVE, (date, categories)

    def test_every_board_has_an_award_outcome_or_era_anchor(self, boards):
        for date, board in boards.items():
            categories = [c.category for c in board.rows] + [c.category for c in board.cols]
            anchors = sum(1 for cat in categories if cat in {"award", "outcome", "era"})
            assert anchors >= MIN_ANCHOR_CONSTRAINTS, (date, categories)

    def test_no_board_is_mostly_franchises_and_positions(self, boards):
        """The 'database lookup' shape this pass exists to remove."""
        for date, board in boards.items():
            categories = [c.category for c in board.rows] + [c.category for c in board.cols]
            lookup = sum(1 for cat in categories if cat in {"team", "position"})
            assert lookup <= len(categories) // 2, (date, categories)

    def test_no_category_owns_a_whole_axis(self, boards):
        for board in boards.values():
            categories = [c.category for c in board.rows] + [c.category for c in board.cols]
            for category in set(categories):
                assert categories.count(category) <= MAX_PER_CATEGORY

    def test_every_square_poses_a_real_choice(self, boards, pool):
        """Several different players must be plausibly the best answer, or the
        square is a recall test rather than a decision."""
        for date, board in boards.items():
            for cell in board.cells:
                seasons = [pool.by_id[a] for a in cell.answer_ids]
                best = max(ps.prime_score for ps in seasons)
                strong = {ps.player_slug for ps in seasons if ps.prime_score >= 0.70 * best}
                assert len(strong) >= MIN_STRONG_OPTIONS, (date, cell.row, cell.col)

    def test_no_single_player_dominates_the_board(self, boards, pool):
        """Guards against boards where one GOAT is the right answer nearly
        everywhere and the unique-player rule becomes a chore."""
        for date, board in boards.items():
            tops = []
            for cell in board.cells:
                seasons = [pool.by_id[a] for a in cell.answer_ids]
                tops.append(max(seasons, key=lambda ps: ps.prime_score).player_slug)
            for slug in set(tops):
                assert tops.count(slug) <= MAX_SQUARES_ONE_PLAYER_TOPS, (date, slug)

    def test_a_full_year_still_generates_and_stays_unique(self, pool, taxonomy):
        """The tighter rules must not have cost solvability or variety."""
        start = datetime.date(2026, 1, 1)
        signatures = set()
        for offset in range(365):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = generate_board(date, pool=pool, constraints=taxonomy)
            for cell in board.cells:
                assert cell.answer_count >= MIN_ANSWERS_PER_CELL
                assert cell.distinct_player_count >= MIN_PLAYERS_PER_CELL
            signatures.add(
                (tuple(c.id for c in board.rows), tuple(c.id for c in board.cols))
            )
        assert len(signatures) == 365
