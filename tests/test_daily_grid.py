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
    DPOY_SEASON_START,
    FRANCHISES,
    MIP_SEASON_START,
    SMOY_SEASON_START,
    V3_ADDED_CONSTRAINT_IDS,
    V4_ADDED_CONSTRAINT_IDS,
    V5_ADDED_CONSTRAINT_IDS,
    V5_RETIRED_CONSTRAINT_IDS,
    build_constraints,
    constraint_by_id,
)
from nba_peak.daily_grid.generator import (
    CATEGORY_COOLDOWN_BOARDS,
    DAILY_GRID_VERSION,
    DAILY_GRID_VERSION_V2,
    DAILY_GRID_VERSION_V3,
    DAILY_GRID_VERSION_V4,
    DAILY_GRID_VERSION_V5,
    FAMILY_CUTOVER_DATE,
    TAXONOMY_CUTOVER_DATE,
    GRID_SIZE,
    GridBoard,
    GridCell as ModelGridCell,
    MAX_CONTEXT_CONSTRAINTS,
    MAX_PEAK3_NATIVE,
    MAX_PER_CATEGORY,
    MAX_SQUARES_ONE_PLAYER_TOPS,
    MAX_TEAM_CONSTRAINTS,
    MIN_ANCHOR_CONSTRAINTS,
    MIN_ANSWERS_PER_CELL,
    MIN_CATEGORIES,
    MIN_PLAYERS_PER_CELL,
    MIN_STRONG_OPTIONS,
    MIN_TEAM_CONSTRAINTS,
    NOVELTY_CUTOVER_DATE,
    PAIR_COOLDOWN_BOARDS,
    _RECOGNIZABLE,
    THEME_LABELS,
    _BOARD_CACHE,
    _BOARD_CACHE_MAX,
    _native_allowance,
    _version_for_date,
    BoardGenerationFailed,
    InvalidGridDate,
    board_id,
    board_theme,
    generate_board,
    get_board,
    grid_seed,
    rarity_bucket,
    resolve_theme_id,
    theme_candidates,
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
    MAX_LIMIT,
    MAX_QUERY_LENGTH,
    MAX_REVEALED_ELIGIBLE_IDENTITIES,
    STATUS_AVAILABLE,
    STATUS_NO_FIT,
    STATUS_UNKNOWN,
    STATUS_USED,
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
            "context",
            "peak",
            "component",
            "outcome",
            # v4 families. The set grew because the taxonomy did; what this
            # test still pins is that it is EXACTLY this set -- a family
            # arriving without a deliberate edit here, or one silently
            # disappearing, still fails.
            "career",
            "production",
            "shooting",
            "usage",
            # v5 families: how the player entered the league, where he was
            # born, how tall he is, what his career looked like.
            "draft",
            "origin",
            "size",
            "journey",
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
        assert board_id("2026-07-30") == "daily-grid-v2-2026-07-30"
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
        exactly the same board.

        Starts the day after NOVELTY_CUTOVER_DATE (not some arbitrary far
        future date) so this walk IS the v3 novelty history from its first
        day -- a date further out would make its own first `get_board` prime
        every intervening day first, which is correct but needlessly slow for
        a test that is only exercising cache bounds.
        """
        from nba_peak.daily_grid.generator import NOVELTY_CUTOVER_DATE

        start = datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE) + datetime.timedelta(
            days=1
        )
        for offset in range(_BOARD_CACHE_MAX + 25):
            get_board((start + datetime.timedelta(days=offset)).isoformat())
        assert len(_BOARD_CACHE) <= _BOARD_CACHE_MAX

    def test_an_evicted_date_regenerates_identically(self):
        """Same rationale as test_board_cache_is_bounded above for staying
        close to NOVELTY_CUTOVER_DATE rather than years past it. Offset well
        past that test's own range (it walks the cutover's first
        _BOARD_CACHE_MAX + 25 days) so the two tests' cache-eviction walks
        cannot leave each other's target already warm and mask what each is
        actually meant to exercise."""
        from nba_peak.daily_grid.generator import NOVELTY_CUTOVER_DATE

        cutover = datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE)
        target = (cutover + datetime.timedelta(days=500)).isoformat()
        first = get_board(target)
        signature = (
            tuple(c.id for c in first.rows),
            tuple(c.id for c in first.cols),
        )
        start = cutover + datetime.timedelta(days=501)
        for offset in range(_BOARD_CACHE_MAX + 5):
            get_board((start + datetime.timedelta(days=offset)).isoformat())
        again = get_board(target)
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

    def test_boards_are_built_from_categories_a_fan_recognizes(self, boards):
        """Phase 11C inverted this test's second half. It used to require at
        least one PEAK3-native axis; the mode now requires almost none, so what
        is asserted instead is that every axis is a fact a basketball fan can
        reason about without knowing anything about the model."""
        for date, board in boards.items():
            categories = [c.category for c in board.rows] + [
                c.category for c in board.cols
            ]
            # READ FROM THE RULE, NOT A SECOND COPY OF IT. This restated the
            # generator's own `_RECOGNIZABLE` set inline, so the two drifted
            # apart the moment the taxonomy grew: a board of era x shooting x
            # production x team x award x team failed a test whose subject
            # ("every axis is a fact a fan can reason about") it satisfies
            # completely. The threshold is unchanged.
            recognizable = sum(1 for cat in categories if cat in _RECOGNIZABLE)
            assert recognizable >= 5, (date, categories)
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

class TestSearchInputHygiene:
    """Phase 11D. Normalization is input hygiene, not matching behaviour: it
    must not change the result of any query a person would type, and it must
    stop a caller manufacturing thousands of distinct-looking full-pool scans."""

    def test_a_pathological_query_is_clamped_before_the_scan(self, pool):
        # Without the clamp, "a" * 5000 is a distinct string that costs a full
        # scan of the pool -- a cheap way to spend server CPU.
        long_query = "olajuwon" + "z" * 5000
        assert len(long_query) > MAX_QUERY_LENGTH
        hits = search_player_seasons(long_query, pool=pool, limit=5)
        # Clamped to the first MAX_QUERY_LENGTH characters, which still starts
        # with a real name, so the query behaves like the name it contains.
        assert isinstance(hits, list)

    def test_padding_does_not_create_a_distinct_query(self, pool):
        plain = [h.player_season.id for h in search_player_seasons("olajuwon", pool=pool)]
        for variant in ("  olajuwon  ", "olajuwon...", "--olajuwon--", "olajuwon\t\n"):
            assert [
                h.player_season.id for h in search_player_seasons(variant, pool=pool)
            ] == plain, variant

    def test_internal_whitespace_collapses(self, pool):
        spaced = search_player_seasons("hakeem     olajuwon", pool=pool)
        plain = search_player_seasons("hakeem olajuwon", pool=pool)
        assert [h.player_season.id for h in spaced] == [h.player_season.id for h in plain]
        assert spaced

    def test_the_response_stays_capped_however_large_the_limit(self, pool):
        hits = search_player_seasons("ja", pool=pool, limit=10_000)
        assert len(hits) <= MAX_LIMIT

    def test_a_query_below_the_minimum_returns_nothing(self, pool):
        # Not an error -- a half-typed name is just not a query yet.
        for short in ("", " ", "j", "  .  "):
            assert search_player_seasons(short, pool=pool) == [], repr(short)


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
    def test_a_query_never_names_more_than_the_cap_of_qualifying_players(
        self, boards, pool, broad
    ):
        """The bulk answer-key harvest the gate exists to stop: a meaningless
        substring matches hundreds of players, and marking them valid-first
        would float a large share of a cell's real answer set to the top of the
        list for someone who knows nothing.

        Phase 11C measures the leak directly rather than proxying it with "is
        this query narrow?" -- so what must hold is that no response ever names
        more than MAX_REVEALED_ELIGIBLE_IDENTITIES distinct qualifying players.
        A substring that happens to match almost nothing valid may answer; one
        approaching the answer set must go dark."""
        board = boards["2026-07-30"]
        for cell in board.cells:
            hits = search_player_seasons(
                broad, board=board, row=cell.row, col=cell.col, limit=50, pool=pool
            )
            revealed = {
                h.player_season.player_slug for h in hits if h.eligible is True
            }
            assert len(revealed) <= MAX_REVEALED_ELIGIBLE_IDENTITIES, (
                broad,
                cell.row,
                cell.col,
                sorted(revealed),
            )
            # All-or-nothing per response: a mixed response would let a player
            # infer the withheld verdicts from the ones that were given.
            verdicts = {h.eligible is None for h in hits}
            assert len(verdicts) <= 1, (broad, cell.row, cell.col)

    def test_a_query_matching_much_of_the_answer_set_withholds_every_verdict(
        self, boards, pool
    ):
        """The gate has to actually fire on a real board, not just be
        theoretically capable of firing. Finds a query that matches enough of
        some cell's answers to trip it, and asserts the whole response goes
        `unknown`."""
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.distinct_player_count)
        for broad in ("a", "e", "an", "on", "ar", "er"):
            hits = search_player_seasons(
                broad, board=board, row=cell.row, col=cell.col, limit=50, pool=pool
            )
            if hits and all(h.status == STATUS_UNKNOWN for h in hits):
                assert all(h.eligible is None for h in hits)
                # Withheld is still PLAYABLE -- the player may submit and find
                # out. Only a stated refusal disables a row.
                assert all(h.selectable for h in hits)
                return
        pytest.fail("no query tripped the eligibility cap on the widest cell")

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

    def test_the_eligibility_gate_counts_identities_not_seasons(self, boards, pool):
        """One player has many seasons in the pool, and a cell can hold several
        of them. The cap counts distinct qualifying IDENTITIES so that naming a
        single player always earns a verdict -- the case the help exists for."""
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        answer = pool.by_id[cell.answer_ids[0]]
        seasons_in_cell = sum(
            1 for a in cell.answer_ids if pool.by_id[a].player_slug == answer.player_slug
        )
        hits = search_player_seasons(
            answer.player_name,
            board=board,
            row=cell.row,
            col=cell.col,
            limit=50,
            pool=pool,
        )
        # Even when that player holds MORE qualifying seasons than the cap, the
        # response still answers -- because it is one identity.
        assert seasons_in_cell >= 1
        assert all(h.eligible is not None for h in hits)

    # -- Phase 11C statuses -------------------------------------------------

    def test_a_used_player_is_marked_used_and_not_selectable(self, boards, pool):
        """The bug this fixes: a player already spent on the board kept coming
        back labelled as if it were playable."""
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
            used_player_slugs=[answer.player_slug],
        )
        assert hits
        own = [h for h in hits if h.player_season.player_slug == answer.player_slug]
        assert own
        for hit in own:
            assert hit.status == STATUS_USED
            assert hit.selectable is False
        # And specifically: no season of theirs is offered as available, not
        # even the ones that genuinely satisfy both constraints.
        assert not any(h.status == STATUS_AVAILABLE for h in own)

    def test_used_wins_over_eligibility_in_both_directions(self, boards, pool):
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        valid = pool.by_id[cell.answer_ids[0]]
        hits = search_player_seasons(
            valid.player_name,
            board=board,
            row=cell.row,
            col=cell.col,
            limit=50,
            pool=pool,
            used_player_slugs=[valid.player_slug],
        )
        statuses = {h.status for h in hits if h.player_season.player_slug == valid.player_slug}
        assert statuses == {STATUS_USED}

    def test_an_invalid_hit_is_no_fit_and_not_selectable(self, boards, pool):
        board = boards["2026-07-30"]
        cell = max(board.cells, key=lambda c: c.answer_count)
        valid_ids = set(cell.answer_ids)
        answer = pool.by_id[cell.answer_ids[0]]
        hits = search_player_seasons(
            answer.player_name,
            board=board,
            row=cell.row,
            col=cell.col,
            limit=50,
            pool=pool,
        )
        misses = [h for h in hits if h.player_season.id not in valid_ids]
        if not misses:
            pytest.skip("this player's every season happens to fit the cell")
        for hit in misses:
            assert hit.status == STATUS_NO_FIT
            assert hit.selectable is False

    def test_available_hits_sort_ahead_of_unusable_ones(self, boards, pool):
        """"Valid unused first, then used, then no-fit" -- the ordering the
        player relies on to not have to read the whole list."""
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
        rank = {STATUS_AVAILABLE: 0, STATUS_UNKNOWN: 0, STATUS_USED: 1, STATUS_NO_FIT: 2}
        ranks = [rank[h.status] for h in hits]
        assert ranks == sorted(ranks), [h.status for h in hits]

    def test_result_dicts_carry_no_answer_key_signal(self, boards, pool):
        """A search hit says whether THAT season fits -- which the player is
        about to learn anyway by submitting it -- and nothing about the rest
        of the answer set. In particular no score, and no count."""
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
                "status",
                "selectable",
            }


# ---------------------------------------------------------------------------
# Phase 11C — the reported search bugs, on a fixed board
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def knicks_guard_board(pool, taxonomy):
    """A hand-built Knicks x Guard board, so the reported bugs are pinned to
    the exact scenario they were reported in rather than to whatever board a
    date happens to produce.

    Built directly from the constraint masks rather than through
    generate_board(): this is a REGRESSION FIXTURE, and it has to keep meaning
    "Knicks x Guard" even if a future composition rule would stop the generator
    from ever pairing these six axes.
    """
    by_id = {c.id: c for c in taxonomy}
    rows = [by_id["team_nyk"], by_id["team_chi"], by_id["era_2010s"]]
    cols = [by_id["pos_guard"], by_id["award_all_star"], by_id["outcome_champion"]]
    masks = {c.id: c.matches(pool.frame) for c in taxonomy}
    answer_ids = pool.frame["answer_id"].to_numpy()
    slugs = pool.frame["player_slug"].to_numpy()

    cells = []
    for row_index, row_constraint in enumerate(rows):
        for col_index, col_constraint in enumerate(cols):
            mask = masks[row_constraint.id] & masks[col_constraint.id]
            cells.append(
                ModelGridCell(
                    row=row_index,
                    col=col_index,
                    row_constraint_id=row_constraint.id,
                    col_constraint_id=col_constraint.id,
                    answer_ids=tuple(answer_ids[mask].tolist()),
                    player_slugs=frozenset(slugs[mask].tolist()),
                )
            )
    return GridBoard(
        board_id="daily-grid-test-knicks-guard",
        date="2026-07-30",
        seed=1,
        version="test",
        rows=tuple(rows),
        cols=tuple(cols),
        cells=tuple(cells),
        difficulty="medium",
        theme=board_theme(rows, cols),
        attempts=1,
    )


class TestReportedSearchBugs:
    """Knicks x Guard is cell (0, 0) of `knicks_guard_board`."""

    def _search(self, board, pool, query, used=()):
        return search_player_seasons(
            query, board=board, row=0, col=0, limit=25, pool=pool, used_player_slugs=used
        )

    def test_a_broad_partial_prioritises_the_valid_candidate(
        self, knicks_guard_board, pool
    ):
        """"br" on Knicks x Guard: Jalen Brunson is a Knicks guard and must
        come first; Brad Daugherty matches the letters but was a Cleveland
        centre and must not be offered as if he were playable."""
        hits = self._search(knicks_guard_board, pool, "br")
        by_slug = {h.player_season.player_slug: h for h in hits}
        assert "jalen-brunson" in by_slug
        assert by_slug["jalen-brunson"].status == STATUS_AVAILABLE
        assert by_slug["jalen-brunson"].selectable is True

        assert "brad-daugherty" in by_slug, "the invalid match must still be shown"
        assert by_slug["brad-daugherty"].status == STATUS_NO_FIT
        assert by_slug["brad-daugherty"].selectable is False

        statuses = [h.status for h in hits]
        assert statuses.index(STATUS_AVAILABLE) < statuses.index(STATUS_NO_FIT)

    def test_the_broad_partial_and_the_full_name_agree(self, knicks_guard_board, pool):
        """A player's verdict cannot depend on how much of their name was
        typed -- that inconsistency is what made the list feel arbitrary."""
        broad = {
            h.player_season.id: h.status
            for h in self._search(knicks_guard_board, pool, "br")
            if h.player_season.player_slug == "brad-daugherty"
        }
        full = {
            h.player_season.id: h.status
            for h in self._search(knicks_guard_board, pool, "brad daugherty")
            if h.player_season.player_slug == "brad-daugherty"
        }
        assert broad, "the partial query must surface Daugherty at all"
        for answer_id, status in broad.items():
            assert full[answer_id] == status == STATUS_NO_FIT

    def test_a_used_player_is_never_offered_as_playable(self, knicks_guard_board, pool):
        """The LeBron case from the review: once an identity is on the board,
        every one of their seasons is USED, including the qualifying ones."""
        used_hits = self._search(
            knicks_guard_board, pool, "brunson", used=("jalen-brunson",)
        )
        assert used_hits
        for hit in used_hits:
            if hit.player_season.player_slug == "jalen-brunson":
                assert hit.status == STATUS_USED
                assert hit.selectable is False

        # Control: unused, the same query does offer them.
        fresh = self._search(knicks_guard_board, pool, "brunson")
        assert any(h.status == STATUS_AVAILABLE for h in fresh)

    def test_no_search_result_ever_carries_a_score(self, knicks_guard_board, pool):
        for query in ("br", "brad daugherty", "brunson"):
            for hit in self._search(knicks_guard_board, pool, query):
                payload = hit.as_dict()
                assert "prime_score" not in payload
                assert "arena_points" not in payload
                assert "points" not in payload


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
# Phase 11C — board composition quality
# ---------------------------------------------------------------------------

def _axis_categories(board) -> list[str]:
    return [c.category for c in board.rows] + [c.category for c in board.cols]


def _native_axis_count(board) -> int:
    return sum(1 for cat in _axis_categories(board) if cat in {"peak", "component"})


class TestBoardQuality:
    def test_no_board_carries_more_than_one_peak3_native_axis(self, boards):
        """The Phase 11C rule that makes this a basketball game rather than a
        formula quiz: an axis restating the scoring objective ("60+ PEAK",
        "Top 10% SI") is self-referential when the objective is to maximise
        PEAK3 score, so at most one may ever appear."""
        for date, board in boards.items():
            assert _native_axis_count(board) <= MAX_PEAK3_NATIVE, (
                date,
                _axis_categories(board),
            )

    def test_most_boards_carry_no_peak3_native_axis(self, pool, taxonomy):
        """"At most one" is the ceiling; ZERO is the standard board. Measured
        over a full year rather than the small sample, because the allowance is
        a deterministic function of the seed and a handful of dates could
        otherwise all land on the same side of it."""
        start = datetime.date(2026, 1, 1)
        zero_native = 0
        for offset in range(365):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = generate_board(date, pool=pool, constraints=taxonomy)
            if _native_axis_count(board) == 0:
                zero_native += 1
        # Comfortably a majority. The spice allowance fires on ~1 date in 5 and
        # the measured figure is 298/365 (82%); the assertion leaves room for
        # the taxonomy shifting without becoming a rubber stamp.
        assert zero_native >= 280, zero_native

    def test_a_board_never_exceeds_its_dates_native_allowance(self, boards):
        """The per-date allowance is the whole mechanism, so assert boards obey
        the allowance itself rather than only the global ceiling."""
        for date, board in boards.items():
            assert _native_axis_count(board) <= _native_allowance(board.seed), date

    def test_native_allowance_is_deterministic_and_bounded(self):
        for seed in (0, 1, 4, 5, 12345, 2**31 - 1):
            allowance = _native_allowance(seed)
            assert allowance in (0, MAX_PEAK3_NATIVE)
            assert _native_allowance(seed) == allowance

    def test_no_board_crosses_two_season_context_axes(self, boards):
        for date, board in boards.items():
            categories = _axis_categories(board)
            assert categories.count("context") <= MAX_CONTEXT_CONSTRAINTS, (date, categories)

    def test_every_board_has_a_theme_that_is_true_of_its_axes(self, boards, pool, taxonomy):
        """Phase 12 (D5) changed the CONTRACT this test asserts, and tightened
        it rather than loosening it.

        Before: the theme was the first match in a fixed ladder, so it was a
        pure function of the axis set -- and it repeated on adjacent daily keys
        25.5 % of the time, ran to six days, and gave `Award Season` 38.6 % of
        the year while `Open Court` was unreachable.

        Now: a board has a ranked list of descriptions that are ALL true of its
        axes (`theme_candidates`), and the one it publishes is the first that
        was not also true of the previous daily key. So the published theme is
        no longer a function of the axes alone -- but it is still constrained
        by them, and that is what is asserted here:

          1. the published theme is one of this board's own true descriptions
             (it can never be a label the axes do not support);
          2. `theme_id` and `theme` agree;
          3. resolving the date again reproduces it exactly -- determinism is
             preserved, the label just reads one day further back.
        """
        for date, board in boards.items():
            assert board.theme, date
            candidates = theme_candidates(board.rows, board.cols)
            assert board.theme_id in candidates, (date, board.theme_id, candidates)
            assert THEME_LABELS[board.theme_id] == board.theme, date
            assert (
                resolve_theme_id(date, pool=pool, constraints=taxonomy) == board.theme_id
            ), date
            # `board_theme` remains the axes-only primary description and must
            # still be one of the same true statements.
            assert board_theme(board.rows, board.cols) in THEME_LABELS.values(), date

    def test_adjacent_daily_keys_never_publish_the_same_theme(self, pool, taxonomy):
        """The headline defect (D5), at the model layer.

        Sixty consecutive keys, each labelled independently, and no two
        neighbours may agree. `resolve_theme_id` reads only the previous key's
        axes, so this is a property of the algorithm rather than of the sample.
        """
        import datetime as _datetime

        start = _datetime.date(2026, 6, 1)
        keys = [(start + _datetime.timedelta(days=i)).isoformat() for i in range(60)]
        themes = [resolve_theme_id(k, pool=pool, constraints=taxonomy) for k in keys]
        collisions = [
            (keys[i], themes[i]) for i in range(1, len(keys)) if themes[i] == themes[i - 1]
        ]
        assert collisions == []

    def test_every_board_has_at_least_two_true_descriptions(self, boards):
        """The headroom the anti-repeat rule needs. A board with only one true
        description could not avoid repeating it, so the composition rules
        (>= 1 team axis, >= 2 award/outcome/era anchors) have to keep
        guaranteeing this."""
        for date, board in boards.items():
            assert len(theme_candidates(board.rows, board.cols)) >= 2, date

    def test_the_theme_never_changes_which_board_a_date_gets(self, pool, taxonomy):
        """The constraint the whole design is built around: the theme is a
        DESCRIPTION, never a generation input. The axes, cells and difficulty
        are produced before any theme work and cannot see one."""
        from nba_peak.daily_grid.generator import _board_core, _version_for_date

        for date in SAMPLE_DATES:
            core = _board_core(date, pool, taxonomy, _version_for_date(date))
            board = generate_board(date, pool=pool, constraints=taxonomy)
            assert tuple(c.id for c in board.rows) == tuple(c.id for c in core.rows), date
            assert tuple(c.id for c in board.cols) == tuple(c.id for c in core.cols), date
            assert board.seed == core.seed, date
            assert board.attempts == core.attempts, date

    def test_board_hash_identifies_the_criteria_signature(self, boards):
        from nba_peak.daily_grid.generator import board_hash as _board_hash

        hashes = {date: board.board_hash for date, board in boards.items()}
        assert len(set(hashes.values())) == len(hashes)
        for date, board in boards.items():
            assert board.board_hash == _board_hash(board.rows, board.cols, board.version)
            assert len(board.board_hash) == 16
            int(board.board_hash, 16)
        # Order-sensitive: the same six constraints with rows and columns
        # swapped is a different board to play.
        sample = next(iter(boards.values()))
        assert _board_hash(sample.cols, sample.rows, sample.version) != sample.board_hash

    def test_every_board_has_two_award_outcome_or_era_anchors(self, boards):
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


# ---------------------------------------------------------------------------
# Sixth Man of the Year / Most Improved Player + explicit season validity
# ---------------------------------------------------------------------------

class TestNewAwardCategories:
    """Sixth Man of the Year and Most Improved Player, parsed from the same
    `awards` string mvp_rank/dpoy_rank already come from (pool.py::_award_rank)
    -- never a new or fabricated source."""

    def test_smoy_and_mip_ship_as_award_constraints(self, taxonomy):
        ids = {c.id for c in taxonomy}
        assert {"award_smoy", "award_smoy_votes", "award_mip"} <= ids
        for cid in ("award_smoy", "award_smoy_votes", "award_mip"):
            assert constraint_by_id(cid).category == "award"

    @pytest.mark.parametrize(
        "constraint_id,valid_id,invalid_id",
        [
            # Bobby Jones won the first-ever Sixth Man of the Year, 1982-83.
            ("award_smoy", "bobby-jones-198283-phi", "michael-jordan-199091-chi"),
            # Alvin Robertson won the first-ever Most Improved Player, 1985-86.
            ("award_mip", "alvin-robertson-198586-sas", "michael-jordan-199091-chi"),
        ],
    )
    def test_known_valid_and_invalid_smoy_mip_examples(
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

    def test_no_season_satisfies_dpoy_or_smoy_before_1982_83(self, taxonomy, pool):
        """DPOY and Sixth Man of the Year were both introduced for the
        1982-83 season -- never true before it, whatever the raw column
        says."""
        years = pool.frame["season_start_year"].to_numpy()
        for constraint_id in (
            "award_dpoy",
            "award_dpoy_votes",
            "award_smoy",
            "award_smoy_votes",
        ):
            mask = constraint_by_id(constraint_id, pool).matches(pool.frame)
            assert (years[mask] >= DPOY_SEASON_START).all(), constraint_id
            assert (years[mask] >= SMOY_SEASON_START).all(), constraint_id

    def test_no_season_satisfies_mip_before_1985_86(self, taxonomy, pool):
        years = pool.frame["season_start_year"].to_numpy()
        mask = constraint_by_id("award_mip", pool).matches(pool.frame)
        assert (years[mask] >= MIP_SEASON_START).all()

    def test_valid_from_is_explicit_and_correct_on_the_registry(self, taxonomy):
        """Gap #2: validity must be provable by reading the registry, not
        inferred from a column happening to be null."""
        by_id = {c.id: c for c in taxonomy}
        assert by_id["award_dpoy"].valid_from == DPOY_SEASON_START == 1982
        assert by_id["award_dpoy_votes"].valid_from == DPOY_SEASON_START
        assert by_id["award_smoy"].valid_from == SMOY_SEASON_START == 1982
        assert by_id["award_smoy_votes"].valid_from == SMOY_SEASON_START
        assert by_id["award_mip"].valid_from == MIP_SEASON_START == 1985
        # A constraint whose real-world basis has no introduction date (team
        # membership, a decade, a position) stays valid for the whole window.
        assert by_id["team_lal"].valid_from is None
        assert by_id["era_1990s"].valid_from is None
        assert by_id["award_mvp"].valid_from is None

    def test_matches_enforces_valid_from_even_if_the_mask_disagreed(self, pool):
        """Defence in depth: Constraint.matches() ANDs in the season floor
        itself, so a constraint's validity is never solely at the mercy of
        its own mask logic. Proven directly by constructing a Constraint
        whose mask is a lie (always True) and confirming valid_from still
        wins."""
        from nba_peak.daily_grid.constraints import Constraint

        always_true = Constraint(
            id="test_always_true",
            label="test",
            short_label="test",
            category="award",
            exclusive_group=None,
            description="test",
            mask=lambda f: (f["season_start_year"] >= 0).to_numpy(),
            valid_from=1985,
        )
        mask = always_true.matches(pool.frame)
        years = pool.frame["season_start_year"].to_numpy()
        assert not mask[years < 1985].any()
        assert mask[years >= 1985].all()


# ---------------------------------------------------------------------------
# v2 -> v3 cutover: historical-board stability + future determinism
# ---------------------------------------------------------------------------

class TestVersionCutover:
    """A date at or before NOVELTY_CUTOVER_DATE must keep resolving EXACTLY
    as it always has -- same seed, same taxonomy, same board -- forever, even
    as the taxonomy and generation rules keep evolving for later dates. See
    generator.py's NOVELTY_CUTOVER_DATE and _legacy_v2_taxonomy()."""

    @pytest.mark.parametrize(
        "date,expected_board_id,expected_rows,expected_cols,expected_attempts",
        [
            (
                "2026-01-01",
                "daily-grid-v2-2026-01-01",
                ("team_uta", "team_nyk", "award_all_nba"),
                ("outcome_made_playoffs", "outcome_missed_playoffs", "pos_forward"),
                159,
            ),
            (
                "2026-07-30",
                "daily-grid-v2-2026-07-30",
                ("team_bos", "award_stat_leader", "team_orl"),
                ("era_2020s", "context_mpg_36", "era_1990s"),
                40,
            ),
            (
                # The cutover date itself is still legacy ("at or before").
                "2026-08-25",
                "daily-grid-v2-2026-08-25",
                ("context_mpg_36", "outcome_conf_finals", "era_2010s"),
                ("team_atl", "award_stat_leader", "pos_center"),
                674,
            ),
        ],
    )
    def test_legacy_dates_resolve_to_their_recorded_board(
        self, date, expected_board_id, expected_rows, expected_cols, expected_attempts
    ):
        """Regression pin: the exact boards these dates resolved to before
        Sixth Man of the Year / Most Improved Player and the novelty system
        shipped. This is what makes "historical boards keep resolving
        identically" a checked property instead of an assumption about the
        code's intent -- if a future change to the legacy path ever moves
        one of these, this test is the one that catches it."""
        board = get_board(date)
        assert board.version == DAILY_GRID_VERSION_V2
        assert board.board_id == expected_board_id
        assert tuple(c.id for c in board.rows) == expected_rows
        assert tuple(c.id for c in board.cols) == expected_cols
        assert board.attempts == expected_attempts

    def test_every_date_at_or_before_the_cutover_resolves_to_v2(self):
        for date in ("1990-01-01", "2020-06-15", "2026-01-01", "2026-08-24", NOVELTY_CUTOVER_DATE):
            assert _version_for_date(date) == DAILY_GRID_VERSION_V2, date

    def test_dates_between_the_two_cutovers_resolve_to_v3(self):
        day_after = (
            datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE) + datetime.timedelta(days=1)
        ).isoformat()
        for date in (day_after, "2026-09-01", FAMILY_CUTOVER_DATE):
            assert _version_for_date(date) == DAILY_GRID_VERSION_V3, date

    @pytest.mark.parametrize(
        "date,expected_version,expected_board_id,expected_rows,expected_cols,expected_attempts",
        [
            (
                # The first v3 date, and the last two v4 dates -- the whole v4
                # window, since v5 shipped two days after v4 did. Pinned for
                # the same reason the v2 boards above are: these are boards a
                # real player could already have opened, and the v5 pass
                # RETIRES constraints two of them are built from
                # (`shoot_efficiency`, `comp_traditional_production`,
                # `prod_perimeter_defense`). Retired must mean "not drawn for a
                # NEW board", never "gone" -- if it ever came to mean the
                # second, these three are what notices.
                "2026-08-26",
                DAILY_GRID_VERSION_V3,
                "daily-grid-v3-2026-08-26",
                ("pos_center", "award_all_star", "era_2000s"),
                ("team_nyk", "award_all_defense_first", "context_mpg_30"),
                238,
            ),
            (
                "2026-09-09",
                DAILY_GRID_VERSION_V4,
                "daily-grid-v4-2026-09-09",
                ("shoot_efficiency", "pos_forward", "usage_primary"),
                ("team_cha", "outcome_missed_playoffs", "award_finals_mvp"),
                2814,
            ),
            (
                # The cutover date itself is still v4 ("at or before").
                "2026-09-10",
                DAILY_GRID_VERSION_V4,
                "daily-grid-v4-2026-09-10",
                ("usage_high", "comp_traditional_production", "prod_perimeter_defense"),
                ("award_dpoy_votes", "era_2020s", "team_phi"),
                700,
            ),
        ],
    )
    def test_v3_and_v4_dates_resolve_to_their_recorded_board(
        self,
        date,
        expected_version,
        expected_board_id,
        expected_rows,
        expected_cols,
        expected_attempts,
    ):
        board = get_board(date)
        assert board.version == expected_version
        assert board.board_id == expected_board_id
        assert tuple(c.id for c in board.rows) == expected_rows
        assert tuple(c.id for c in board.cols) == expected_cols
        assert board.attempts == expected_attempts

    def test_dates_between_the_family_and_taxonomy_cutovers_resolve_to_v4(self):
        day_after = (
            datetime.date.fromisoformat(FAMILY_CUTOVER_DATE) + datetime.timedelta(days=1)
        ).isoformat()
        for date in (day_after, TAXONOMY_CUTOVER_DATE):
            assert _version_for_date(date) == DAILY_GRID_VERSION_V4, date

    def test_every_date_after_the_taxonomy_cutover_resolves_to_v5(self):
        day_after = (
            datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        ).isoformat()
        for date in (day_after, "2030-01-01", "2036-08-25"):
            assert _version_for_date(date) == DAILY_GRID_VERSION_V5, date

    def test_the_version_ladder_ascends(self):
        """Each cutover must be strictly later than the one before it, or a
        date would fall on two rungs and `_version_for_date` would silently
        answer with whichever came first in the table."""
        from nba_peak.daily_grid.generator import _VERSION_LADDER

        cutovers = [cutover for cutover, _ in _VERSION_LADDER]
        assert cutovers == sorted(cutovers)
        assert len(set(cutovers)) == len(cutovers)

    @pytest.mark.parametrize(
        "date", ["1990-01-01", "2020-06-15", "2026-08-25", "2026-09-01", FAMILY_CUTOVER_DATE]
    )
    def test_pre_v4_boards_never_use_a_v4_family(self, date):
        """The same structural guarantee `test_legacy_boards_never_use_a_v3_
        added_constraint` makes, one version on: a date that shipped before
        the four new families existed can never draw one, however the live
        registry has grown since."""
        board = get_board(date)
        ids = {c.id for c in board.rows} | {c.id for c in board.cols}
        assert not (ids & V4_ADDED_CONSTRAINT_IDS), (date, ids)

    def test_the_v4_families_do_reach_a_real_board_after_the_cutover(self):
        """The other half of the guarantee above -- the new families are not
        merely legal after the cutover, they actually appear."""
        start = datetime.date.fromisoformat(FAMILY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(60):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            ids = {c.id for c in board.rows} | {c.id for c in board.cols}
            if ids & V4_ADDED_CONSTRAINT_IDS:
                return
        pytest.fail("no career/production/shooting/usage axis appeared in 60 v4 days")

    @pytest.mark.parametrize("date", ["1990-01-01", "2020-06-15", "2025-12-25", "2026-08-25"])
    def test_legacy_boards_never_use_a_v3_added_constraint(self, date):
        """Even generated fresh from the LIVE registry (which now includes
        Sixth Man of the Year / Most Improved Player), a legacy date's board
        can never contain one -- the legacy taxonomy filter excludes them
        structurally, not just by chance."""
        board = get_board(date)
        ids = {c.id for c in board.rows} | {c.id for c in board.cols}
        assert not (ids & V3_ADDED_CONSTRAINT_IDS), (date, ids)

    def test_the_ladder_filter_removes_each_version_cumulatively(self, taxonomy):
        """A v2 date must see neither the v3 award ids nor the v4 families, a
        v3 date must see the v3 ids but not the v4 families, and the current
        version sees everything.

        Replaces the single-step `_legacy_v2_taxonomy` assertion this test used
        to make: with two cutovers, "the full taxonomy minus the v3 additions"
        is no longer what a v2 date actually samples from -- it must lose the
        v4 families too, or every legacy board silently changes.
        """
        from nba_peak.daily_grid.generator import _legacy_taxonomy

        as_v2 = {c.id for c in _legacy_taxonomy(taxonomy, DAILY_GRID_VERSION_V2)}
        as_v3 = {c.id for c in _legacy_taxonomy(taxonomy, DAILY_GRID_VERSION_V3)}
        as_v4 = {c.id for c in _legacy_taxonomy(taxonomy, DAILY_GRID_VERSION_V4)}
        as_v5 = {c.id for c in _legacy_taxonomy(taxonomy, DAILY_GRID_VERSION_V5)}
        every_id = {c.id for c in taxonomy}

        assert as_v2 == (
            every_id
            - V3_ADDED_CONSTRAINT_IDS
            - V4_ADDED_CONSTRAINT_IDS
            - V5_ADDED_CONSTRAINT_IDS
        )
        assert as_v3 == every_id - V4_ADDED_CONSTRAINT_IDS - V5_ADDED_CONSTRAINT_IDS
        assert as_v4 == every_id - V5_ADDED_CONSTRAINT_IDS
        # v5 is the first version that also REMOVES: it sees everything except
        # the PEAK3-native and per-75 constraints it retired, which stay in the
        # module so that already-published boards keep resolving.
        assert as_v5 == every_id - V5_RETIRED_CONSTRAINT_IDS
        assert V5_RETIRED_CONSTRAINT_IDS <= as_v4

        # ORDER IS PRESERVED at every rung -- generation samples from this list
        # by index against a date-seeded RNG, so a legacy date's determinism
        # depends on the relative order of its members never shifting.
        for version, kept in (
            (DAILY_GRID_VERSION_V2, as_v2),
            (DAILY_GRID_VERSION_V3, as_v3),
            (DAILY_GRID_VERSION_V4, as_v4),
        ):
            assert [c.id for c in _legacy_taxonomy(taxonomy, version)] == [
                c.id for c in taxonomy if c.id in kept
            ], version

    def test_a_v3_window_can_actually_reach_the_new_award_categories(self):
        """The flip side of test_legacy_boards_never_use_a_v3_added_constraint:
        the cutover has to actually turn Sixth Man of the Year / Most Improved
        Player ON for later dates, not just keep them off before it. Walks a
        real window rather than asserting on one date, since composition and
        novelty may keep any SINGLE date from drawing either one."""
        start = datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(150):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            ids = {c.id for c in board.rows} | {c.id for c in board.cols}
            if ids & V3_ADDED_CONSTRAINT_IDS:
                return
        pytest.fail("no Sixth Man of the Year / Most Improved Player axis appeared in 150 v3 days")


class TestFutureDeterminism:
    """Same date, same board, forever -- specifically for the v3 (post-
    cutover, novelty-enabled) path, which TestDeterminism above does not
    exercise directly."""

    FUTURE_DATE = "2030-03-14"

    def test_same_future_date_produces_identical_board_and_hash(self):
        first = get_board(self.FUTURE_DATE)
        second = get_board(self.FUTURE_DATE)
        assert first.version == DAILY_GRID_VERSION
        assert [c.id for c in first.rows] == [c.id for c in second.rows]
        assert [c.id for c in first.cols] == [c.id for c in second.cols]
        assert first.board_hash == second.board_hash
        assert first.attempts == second.attempts

    def test_a_fresh_generation_matches_the_cached_one(self):
        """Same property as test_get_board_cache_matches_fresh_generation
        above, on the v3 path specifically -- generate_board() bypasses
        _BOARD_CACHE but must still agree with get_board()."""
        cached = get_board(self.FUTURE_DATE)
        fresh = generate_board(self.FUTURE_DATE)
        assert [c.id for c in cached.rows] == [c.id for c in fresh.rows]
        assert [c.id for c in cached.cols] == [c.id for c in fresh.cols]
        assert cached.seed == fresh.seed


# ---------------------------------------------------------------------------
# Novelty / cooldown: cross-day repetition
# ---------------------------------------------------------------------------

class TestNoveltyCooldown:
    """Phase 12B (the human complaint this pass exists to close: "categories
    becoming repetitive"). Composition rules (TestBoardQuality) make any
    SINGLE board read like a basketball puzzle; nothing before this stopped
    the same axis, or the same axis PAIR, from reappearing on a nearby date --
    a cross-DAY property no single-board check can see. See generator.py's
    "Novelty / cooldown" section for the full design writeup.

    ON THE BOUNDS BELOW, NOT ABSOLUTE ZERO. Id-level cooldown is enforced by
    removing a cooling-down id from the population `rng.sample` draws from
    (see `_cooling_down_ids`), but that filter runs under a real, finite
    attempt budget (`_PREFER_NOVELTY_UNTIL_ATTEMPT`) precisely because a
    date's board must NEVER be allowed to fail generation purely because
    novelty could not be satisfied -- an actual BoardGenerationFailed on any
    v3 date would permanently break generation for every later date, since
    `_recent_usage` needs that date's board to compute its own history. So a
    small residual violation rate, from the rare day that exhausts its
    strict-phase budget and falls back to unfiltered sampling, is an accepted
    trade for that guarantee -- measured directly by the model-layer
    simulation (`scripts/audit_daily_grid_novelty.py`) at ~10-11% for ids and
    ~4-6% for pairs over runs from 150 days to 10 years. The bounds below are
    that measurement with headroom, not an aspirational target.
    """

    WINDOW_DAYS = 365

    def _walk(self, days):
        start = datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE) + datetime.timedelta(days=1)
        dates = [(start + datetime.timedelta(days=i)).isoformat() for i in range(days)]
        id_last: dict[str, int] = {}
        id_gaps: list[int] = []
        pair_last: dict[frozenset, int] = {}
        pair_gaps: list[int] = []
        for idx, date in enumerate(dates):
            board = get_board(date)
            for constraint in list(board.rows) + list(board.cols):
                if constraint.id in id_last:
                    id_gaps.append(idx - id_last[constraint.id])
                id_last[constraint.id] = idx
            for row in board.rows:
                for col in board.cols:
                    pair = frozenset((row.id, col.id))
                    if pair in pair_last:
                        pair_gaps.append(idx - pair_last[pair])
                    pair_last[pair] = idx
        return id_gaps, pair_gaps

    def test_no_board_ever_fails_to_generate_under_the_cooldown(self):
        """The safety property the whole design leans on: novelty can make a
        board harder to find, never impossible to find."""
        start = datetime.date.fromisoformat(NOVELTY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(self.WINDOW_DAYS):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            get_board(date)  # raises BoardGenerationFailed on any real failure

    def test_cooldown_violation_rate_stays_low_over_a_year(self):
        id_gaps, pair_gaps = self._walk(self.WINDOW_DAYS)
        id_violations = sum(1 for g in id_gaps if g < CATEGORY_COOLDOWN_BOARDS)
        pair_violations = sum(1 for g in pair_gaps if g < PAIR_COOLDOWN_BOARDS)
        id_rate = id_violations / len(id_gaps)
        pair_rate = pair_violations / len(pair_gaps)
        assert id_rate < 0.20, id_rate
        assert pair_rate < 0.12, pair_rate

    @staticmethod
    def _gap1_rate(dates, expected_version):
        """Fraction of every axis SLOT (six per board) whose constraint id
        also appeared on the immediately preceding board -- the "same
        category two days running" complaint, measured directly rather than
        assumed."""
        last_seen: dict[str, int] = {}
        gap1 = 0
        total = 0
        for idx, date in enumerate(dates):
            board = get_board(date)
            assert board.version == expected_version, (date, board.version)
            for constraint in list(board.rows) + list(board.cols):
                total += 1
                if last_seen.get(constraint.id) == idx - 1:
                    gap1 += 1
                last_seen[constraint.id] = idx
        return gap1 / total

    def test_cooldown_sharply_reduces_immediate_repeats_vs_the_legacy_system(self):
        """The direct "actually reduces repeat frequency" comparison: the
        legacy (v2) system never had any cross-day memory at all, so its
        immediate-repeat (an axis reappearing on the VERY NEXT board) rate is
        the honest "no cooldown" baseline -- not a synthetic one. A v3 window
        of the same length must show a substantially lower rate."""
        legacy_start = datetime.date(2024, 1, 1)
        legacy_dates = [
            (legacy_start + datetime.timedelta(days=i)).isoformat() for i in range(200)
        ]
        # Measured on the CURRENT taxonomy's own window, so the comparison
        # keeps meaning what it says as versions ship. It used to start the
        # day after NOVELTY_CUTOVER_DATE and assert v3 for 200 consecutive
        # days, which stopped being true the moment a second cutover landed
        # inside that span.
        current_start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        current_dates = [
            (current_start + datetime.timedelta(days=i)).isoformat() for i in range(200)
        ]

        legacy_rate = self._gap1_rate(legacy_dates, DAILY_GRID_VERSION_V2)
        current_rate = self._gap1_rate(current_dates, DAILY_GRID_VERSION)

        assert legacy_rate > 0.08, legacy_rate  # sanity: the comparison means something
        assert current_rate < legacy_rate / 2, (current_rate, legacy_rate)

    def test_every_ACTIVE_category_is_reachable(self, taxonomy):
        """No constraint the generator may still DRAW is dead weight -- every
        one shows up on a real board somewhere in a long enough window.

        Walked per version, because each version samples a different
        population: the legacy stretch covers everything v2 could draw, and the
        v5 stretch covers everything v5 can. A handful of the rarer team ids
        need the full 1,000-day window on either side to appear at all
        (measured: 900 was not always enough, so this keeps a margin rather
        than chasing the exact minimum).

        RETIRED IDS ARE EXCLUDED, AND THAT IS THE POINT rather than a
        loosening. `V5_RETIRED_CONSTRAINT_IDS` names constraints the taxonomy
        deliberately no longer draws; asserting they still turn up would be
        asserting the taxonomy pass had failed. That they remain RESOLVABLE --
        which is what an already-published board needs -- is checked by
        `TestV5Taxonomy::test_the_retired_ids_are_exactly_...` and by the v3/v4
        board pins in TestVersionCutover, two of which are built from them.
        """
        seen: set[str] = set()
        legacy_start = datetime.date(2020, 1, 1)
        for offset in range(1000):
            date = (legacy_start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            seen |= {c.id for c in board.rows} | {c.id for c in board.cols}

        v5_start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(1000):
            date = (v5_start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            seen |= {c.id for c in board.rows} | {c.id for c in board.cols}

        active = {c.id for c in taxonomy} - V5_RETIRED_CONSTRAINT_IDS
        unreached = active - seen
        assert not unreached, unreached

    def test_no_retired_id_reaches_a_board_in_either_window(self, taxonomy):
        """The other half of the statement above, so "excluded from the
        reachability check" cannot quietly become "still being drawn".

        Only the v5 window is checked: the legacy window SHOULD keep drawing
        the PEAK3-native ids, because they were part of v2's population and
        those boards are frozen.
        """
        v5_start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(400):
            date = (v5_start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            ids = {c.id for c in board.rows} | {c.id for c in board.cols}
            assert not (ids & V5_RETIRED_CONSTRAINT_IDS), (date, ids)


# ---------------------------------------------------------------------------
# Non-empty intersections: zero- and one-answer cells must be structurally
# impossible, not just empirically rare.
# ---------------------------------------------------------------------------

class TestNoImpossibleCells:
    def test_no_generated_cell_ever_has_zero_or_one_answers(self, boards):
        """MIN_ANSWERS_PER_CELL (6) already makes this true by construction --
        this test exists so a future change to that floor cannot silently
        reintroduce an impossible or trivially-guessable cell without a test
        noticing."""
        for date, board in boards.items():
            for cell in board.cells:
                assert cell.answer_count >= 2, (date, cell.row, cell.col, cell.answer_count)
                assert cell.answer_count != 1, (date, cell.row, cell.col)

    def test_the_floor_itself_is_well_above_the_brief(self):
        assert MIN_ANSWERS_PER_CELL >= 3


# ---------------------------------------------------------------------------
# The v5 basketball taxonomy: draft, origin, size, journey, per-game
# production, and the retirement of the PEAK3-native and per-75 families
# ---------------------------------------------------------------------------

class TestV5Taxonomy:
    """The basketball-taxonomy pass: the four new families, the retirements,
    and the promise that a published board never moves because of either."""

    def test_the_new_families_are_all_registered(self, taxonomy):
        families = {c.category for c in taxonomy}
        assert {"draft", "origin", "size", "journey"} <= families

    def test_every_v5_id_exists_and_every_added_id_is_new(self, taxonomy):
        ids = {c.id for c in taxonomy}
        assert V5_ADDED_CONSTRAINT_IDS <= ids
        assert V5_RETIRED_CONSTRAINT_IDS <= ids
        assert not (V5_ADDED_CONSTRAINT_IDS & V5_RETIRED_CONSTRAINT_IDS)

    def test_the_retired_ids_are_exactly_the_peak3_native_and_per_75_families(
        self, taxonomy
    ):
        """Retirement is a product decision about which axes read as
        basketball, so what it covers is worth pinning: everything PEAK3's own
        model output (`peak`, `component`), plus the per-75-possession bands
        and the three-point-RATE band that the per-game constraints replaced.
        Nothing else."""
        by_id = {c.id: c for c in taxonomy}
        retired_families = {by_id[i].category for i in V5_RETIRED_CONSTRAINT_IDS}
        assert retired_families == {"peak", "component", "production", "shooting"}
        assert {c.id for c in taxonomy if c.category in {"peak", "component"}} <= (
            V5_RETIRED_CONSTRAINT_IDS
        )

    @pytest.mark.parametrize("date", ["1990-01-01", "2026-08-25", "2026-09-01", "2026-09-10"])
    def test_pre_v5_boards_never_use_a_v5_constraint(self, date):
        board = get_board(date)
        ids = {c.id for c in board.rows} | {c.id for c in board.cols}
        assert not (ids & V5_ADDED_CONSTRAINT_IDS), (date, ids)

    def test_v5_boards_never_use_a_retired_constraint(self):
        """The whole point of the pass, asserted against real generated boards
        rather than against the filter in isolation: an axis reading
        "Top 10% TP" or "1.8+ STL/75" must not reach a new board."""
        start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(200):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            ids = {c.id for c in board.rows} | {c.id for c in board.cols}
            assert not (ids & V5_RETIRED_CONSTRAINT_IDS), (date, ids)

    def test_the_v5_families_do_reach_a_real_board(self):
        start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        seen: set[str] = set()
        for offset in range(120):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            seen |= {c.category for c in board.rows} | {c.category for c in board.cols}
        assert {"draft", "origin", "size", "journey"} <= seen, seen

    def test_no_v5_board_is_more_than_two_identity_axes(self):
        """MAX_IDENTITY_CONSTRAINTS, on real boards. Three biography axes and
        every square becomes a lookup about the player rather than a question
        about a season."""
        from nba_peak.daily_grid.generator import MAX_IDENTITY_CONSTRAINTS, _IDENTITY

        start = datetime.date.fromisoformat(TAXONOMY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(200):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            categories = [c.category for c in board.rows] + [c.category for c in board.cols]
            identity = sum(1 for cat in categories if cat in _IDENTITY)
            assert identity <= MAX_IDENTITY_CONSTRAINTS, (date, categories)

    def test_the_native_allowance_is_zero_at_v5_for_every_seed(self):
        """`_native_allowance` has to be version-aware, not seed-only. If it
        still returned 1 on a spice seed, every spice-seeded v5 date would burn
        _PREFER_SPICE_UNTIL_ATTEMPT attempts insisting on a PEAK3-native axis
        that no longer exists in its population."""
        for seed in range(0, 50):
            assert _native_allowance(seed, DAILY_GRID_VERSION_V5) == 0, seed
        # ... while the older versions keep their original behaviour exactly.
        assert _native_allowance(0, DAILY_GRID_VERSION_V4) == MAX_PEAK3_NATIVE
        assert _native_allowance(1, DAILY_GRID_VERSION_V4) == 0

    def test_the_draft_slots_can_never_cross(self, taxonomy):
        """Top-10, second round and undrafted are mutually exclusive, and
        "No. 1 Overall" is nested inside "Top-10", so all four share a group."""
        draft = [c for c in taxonomy if c.category == "draft"]
        assert len(draft) == 4
        assert len({c.exclusive_group for c in draft}) == 1
        assert draft[0].exclusive_group is not None

    def test_the_height_bands_can_never_cross(self, taxonomy):
        size = [c for c in taxonomy if c.category == "size"]
        assert len({c.exclusive_group for c in size}) == 1

    def test_the_two_points_per_game_rungs_share_a_group(self, taxonomy):
        """20+ and 25+ PPG are nested, so crossing them would make the looser
        one decoration. The other per-game bands measure different acts and are
        free to cross."""
        by_id = {c.id: c for c in taxonomy}
        assert (
            by_id["prod_ppg_20"].exclusive_group
            == by_id["prod_ppg_25"].exclusive_group
            is not None
        )
        for other in ("prod_rpg_10", "prod_apg_7", "prod_spg_2", "prod_bpg_2"):
            assert by_id[other].exclusive_group is None


class TestConstraintDefinitions:
    """`needs_definition` -- which axes get an info marker, and why."""

    def test_the_flag_is_published_to_the_client(self, taxonomy):
        payload = taxonomy[0].as_dict()
        assert "needs_definition" in payload
        assert isinstance(payload["needs_definition"], bool)

    def test_the_axes_whose_rule_cannot_be_read_off_the_label_are_marked(
        self, taxonomy
    ):
        by_id = {c.id: c for c in taxonomy}
        for constraint_id in (
            "shoot_elite_efficiency",   # relative to WHICH league average?
            "draft_second_round",       # rounds were not always two
            "draft_undrafted",          # drafted in which league?
            "origin_international",     # birthplace, citizenship or flag?
            "journey_one_franchise",    # counted over which seasons?
            "journey_franchises_5",
            "journey_seasons_15",
        ):
            assert by_id[constraint_id].needs_definition, constraint_id

    def test_self_explanatory_axes_are_not_marked(self, taxonomy):
        by_id = {c.id: c for c in taxonomy}
        for constraint_id in (
            "team_lal",
            "award_all_star",
            "award_mvp",
            "era_1990s",
            "size_7ft",
            "draft_top10",
            "prod_ppg_25",
            "outcome_champion",
        ):
            assert not by_id[constraint_id].needs_definition, constraint_id

    def test_every_constraint_carries_a_real_sentence_either_way(self, taxonomy):
        """The marker decides whether the rule is FLAGGED, never whether it
        exists: the cell panel prints `description` for every axis."""
        for constraint in taxonomy:
            assert constraint.description.strip().endswith("."), constraint.id
            assert len(constraint.description) > 20, constraint.id


class TestReferenceBackedPredicates:
    """The v5 predicates against named players, through the real pool.

    tests/test_player_reference_dataset.py checks the DATA is right; this
    checks the constraints read it correctly, which is a different failure.
    """

    @staticmethod
    def _season(pool, name: str, season: str):
        matches = [s for s in pool.seasons if s.player_name == name and s.season == season]
        assert matches, f"{season} {name} is not in the pool"
        return matches[0]

    @pytest.mark.parametrize(
        "name,season,constraint_id,expected",
        [
            # Draft.
            ("Michael Jordan", "1990-91", "draft_top10", True),
            ("Michael Jordan", "1990-91", "draft_first_overall", False),
            ("Michael Jordan", "1990-91", "draft_second_round", False),
            ("Nikola Jokic", "2021-22", "draft_second_round", True),
            ("Nikola Jokic", "2021-22", "draft_top10", False),
            ("LeBron James", "2012-13", "draft_first_overall", True),
            ("Ben Wallace", "2003-04", "draft_undrafted", True),
            ("Ben Wallace", "2003-04", "draft_top10", False),
            # A pre-window career with no NBA draft row is NOT undrafted.
            ("Moses Malone", "1982-83", "draft_undrafted", False),
            # Origin.
            ("Hakeem Olajuwon", "1993-94", "origin_international", True),
            ("Tim Duncan", "2002-03", "origin_international", True),
            ("Michael Jordan", "1990-91", "origin_international", False),
            # Size.
            ("Hakeem Olajuwon", "1993-94", "size_7ft", True),
            ("Tim Duncan", "2002-03", "size_7ft", False),
            ("Tim Duncan", "2002-03", "size_6ft10", True),
            ("Chris Paul", "2008-09", "size_6ft3_under", True),
            ("Michael Jordan", "1990-91", "size_6ft3_under", False),
            # Journey.
            ("Tim Duncan", "2002-03", "journey_one_franchise", True),
            ("Tim Duncan", "2002-03", "journey_franchises_5", False),
            ("Michael Jordan", "1990-91", "journey_one_franchise", False),
            # A career that began before the window cannot make the
            # one-franchise claim even when its in-window teams are all one.
            ("Julius Erving", "1982-83", "journey_one_franchise", False),
            # Per-game production.
            ("Michael Jordan", "1990-91", "prod_ppg_25", True),
            ("Michael Jordan", "1990-91", "prod_rpg_10", False),
            ("Dennis Rodman", "1991-92", "prod_rpg_10", True),
            ("Dennis Rodman", "1991-92", "prod_ppg_20", False),
            ("John Stockton", "1990-91", "prod_apg_7", True),
            ("Stephen Curry", "2015-16", "shoot_threes_200", True),
            ("Michael Jordan", "1990-91", "shoot_threes_200", False),
        ],
    )
    def test_predicate(self, pool, name, season, constraint_id, expected):
        season_row = self._season(pool, name, season)
        constraint = constraint_by_id(constraint_id, pool)
        matched = constraint.matches(pool.frame)
        index = list(pool.frame["answer_id"]).index(season_row.id)
        assert bool(matched[index]) is expected, (name, season, constraint_id)

    def test_a_missing_reference_value_rejects_rather_than_passing(self, pool):
        """The three-state contract, at the predicate layer. Nothing in the
        pool may satisfy a v5 constraint by having a null where its fact should
        be."""
        frame = pool.frame
        for constraint_id, column in (
            ("size_7ft", "height_in"),
            ("origin_international", "international"),
            ("draft_top10", "draft_pick_overall"),
            ("draft_undrafted", "undrafted"),
        ):
            matched = constraint_by_id(constraint_id, pool).matches(frame)
            assert not frame.loc[matched, column].isna().any(), constraint_id


# ---------------------------------------------------------------------------
# The v4 families: career stage, production, shooting, usage
# ---------------------------------------------------------------------------

class TestV4Families:
    """The four families the category-breadth pass added.

    THE GATE EACH ONE HAD TO PASS is the one constraints.py states in its own
    docstring: if the fact cannot be read out of committed data at player-
    SEASON grain, the constraint does not exist. These tests pin that -- every
    predicate here reads a real column with no nulls in the pool, and the
    thresholds leave enough answers for the cell floors to be satisfiable
    rather than merely legal.
    """

    V4_COLUMNS = (
        "age",
        "pts_per75",
        "ast_per75",
        "trb_per75",
        "stl_per75",
        "blk_per75",
        "usg_pct",
        "ts_plus",
        "threepar",
    )

    def test_every_column_the_new_families_read_is_present_and_complete(self, pool):
        """No family is built on a column the pool has to guess at. A predicate
        over a partly-null column silently rejects seasons for a reason that
        is not about basketball."""
        for column in self.V4_COLUMNS:
            assert column in pool.frame.columns, column
            nulls = int(pool.frame[column].isna().sum())
            assert nulls == 0, (column, nulls)

    def test_the_per_75_rates_are_an_exact_conversion_of_the_committed_per_100s(
        self, pool
    ):
        """x0.75 on the same rate, not a re-estimate. If this ever stopped
        being an exact unit change it would be a derived statistic wearing a
        committed statistic's name."""
        import pandas as pd

        from nba_peak.daily_grid.pool import _PER_100_TO_PER_75, SCORED_PATH, slug
        from nba_peak.daily_grid.pool import _MULTI_TEAM_CODES

        scored = pd.read_parquet(SCORED_PATH)
        scored = scored[~scored["team"].isin(_MULTI_TEAM_CODES)].copy()
        scored["player_slug"] = scored["player"].map(slug)
        source = scored.set_index(["player_slug", "season", "team"])
        keyed = pool.frame.set_index(["player_slug", "season", "team"])
        for per_100, per_75 in _PER_100_TO_PER_75:
            expected = source.loc[keyed.index, per_100].to_numpy() * 0.75
            assert keyed[per_75].to_numpy() == pytest.approx(expected, rel=1e-9)

    @pytest.mark.parametrize(
        "constraint_id,minimum_seasons,minimum_players",
        [
            ("career_age_23_under", 1500, 500),
            ("career_age_30_over", 1500, 400),
            ("career_age_34_over", 400, 150),
            ("prod_scoring", 800, 200),
            ("prod_rebounding", 1000, 250),
            ("prod_playmaking", 700, 200),
            ("prod_rim_protection", 500, 150),
            ("prod_perimeter_defense", 800, 250),
            ("shoot_efficiency", 800, 300),
            ("shoot_three_volume", 1500, 400),
            ("usage_high", 1000, 300),
            ("usage_primary", 400, 150),
        ],
    )
    def test_each_new_constraint_has_a_real_population(
        self, pool, taxonomy, constraint_id, minimum_seasons, minimum_players
    ):
        """Never a two-answer trivia axis. The floors here are well below the
        measured counts -- they exist to catch a threshold edit that quietly
        turns a family into a quiz, not to pin today's exact numbers."""
        constraint = next(c for c in taxonomy if c.id == constraint_id)
        mask = constraint.matches(pool.frame)
        assert int(mask.sum()) >= minimum_seasons, (constraint_id, int(mask.sum()))
        players = pool.frame.loc[mask, "player_slug"].nunique()
        assert players >= minimum_players, (constraint_id, players)

    def test_the_age_bands_can_never_cross(self, taxonomy):
        """'Age 23 or younger x Age 30 or older' has zero answers for ever, and
        34+ is a strict subset of 30+. Both are exactly what exclusive_group
        exists to stop."""
        ages = [c for c in taxonomy if c.category == "career"]
        assert len(ages) == 3
        assert len({c.exclusive_group for c in ages}) == 1
        assert ages[0].exclusive_group is not None

    def test_the_nested_usage_bands_share_a_group(self, taxonomy):
        usage = [c for c in taxonomy if c.category == "usage"]
        assert len({c.exclusive_group for c in usage}) == 1

    def test_the_production_rates_are_independent_and_may_cross(self, taxonomy):
        """Rebounding and playmaking measure different acts, so crossing them
        is a real two-condition square rather than one condition twice.

        Asserted over the v4 per-75 bands SPECIFICALLY, by id, rather than over
        the whole `production` family: v5 added six per-game constraints to the
        same family (and two of those, 20+ and 25+ PPG, ARE nested and do share
        a group). The property this test names is still exactly true of the
        five it was written about.
        """
        production = [c for c in taxonomy if c.id in V4_ADDED_CONSTRAINT_IDS and c.category == "production"]
        assert len(production) == 5
        assert all(c.exclusive_group is None for c in production)

    def test_no_board_is_more_than_half_rate_statistics(self):
        """MAX_STYLE_CONSTRAINTS, on real boards. Three rate/efficiency/usage/
        workload axes is a statistical filter with a basketball label."""
        from nba_peak.daily_grid.generator import MAX_STYLE_CONSTRAINTS, _STYLE

        start = datetime.date.fromisoformat(FAMILY_CUTOVER_DATE) + datetime.timedelta(days=1)
        for offset in range(120):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            board = get_board(date)
            categories = [c.category for c in board.rows] + [
                c.category for c in board.cols
            ]
            style = sum(1 for cat in categories if cat in _STYLE)
            assert style <= MAX_STYLE_CONSTRAINTS, (date, categories)


class TestFamilyDiversity:
    """The cross-day rule the category-breadth pass added.

    The id and pair cooldowns stop the same AXIS and the same MATCHUP
    recurring. They do not stop the same KIND of board recurring -- three
    franchises and three decades on Monday, three franchises and three decades
    on Tuesday, with six different ids each time, satisfies both. That is the
    "categories are repetitive" complaint, and this is the rule for it.
    """

    WINDOW = 200

    @staticmethod
    def _family_counts(board):
        from collections import Counter

        return Counter(c.category for c in list(board.rows) + list(board.cols))

    def _walk(self, days: int):
        start = datetime.date.fromisoformat(FAMILY_CUTOVER_DATE) + datetime.timedelta(days=1)
        previous = None
        adjacent_doubles = 0
        for offset in range(days):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            counts = self._family_counts(get_board(date))
            if previous is not None:
                doubled = {f for f, n in counts.items() if n >= MAX_PER_CATEGORY}
                before = {f for f, n in previous.items() if n >= MAX_PER_CATEGORY}
                adjacent_doubles += len(doubled & before)
            previous = counts
        return adjacent_doubles

    def test_a_family_almost_never_dominates_two_boards_running(self):
        """A SOFT rule, like every other novelty rule here: the strict phase
        gets a real budget of attempts and then generation falls back rather
        than ever costing a date its board. Measured over 365 days the fallback
        fires once; 200 days is asserted at a rate that leaves room for the
        fallback without leaving room for the defect."""
        adjacent = self._walk(self.WINDOW)
        assert adjacent <= 2, adjacent

    def test_the_same_rule_measured_against_the_no_memory_baseline(self):
        """The legacy (v2) system had no cross-day memory at all, so its
        adjacent-domination rate is the honest 'no rule' baseline. Anything
        short of a large reduction would mean the rule is decoration."""
        legacy_start = datetime.date(2024, 1, 1)
        previous = None
        legacy_adjacent = 0
        for offset in range(self.WINDOW):
            date = (legacy_start + datetime.timedelta(days=offset)).isoformat()
            counts = self._family_counts(get_board(date))
            if previous is not None:
                doubled = {f for f, n in counts.items() if n >= MAX_PER_CATEGORY}
                before = {f for f, n in previous.items() if n >= MAX_PER_CATEGORY}
                legacy_adjacent += len(doubled & before)
            previous = counts
        assert legacy_adjacent > 40, legacy_adjacent  # the baseline is real
        assert self._walk(self.WINDOW) < legacy_adjacent / 10

    def test_boards_draw_from_more_distinct_families_than_the_old_taxonomy_could(self):
        """Twelve families rather than eight is only worth having if boards
        actually spread across them."""
        start = datetime.date.fromisoformat(FAMILY_CUTOVER_DATE) + datetime.timedelta(days=1)
        distinct = []
        for offset in range(self.WINDOW):
            date = (start + datetime.timedelta(days=offset)).isoformat()
            distinct.append(len(self._family_counts(get_board(date))))
        assert min(distinct) >= MIN_CATEGORIES
        assert sum(distinct) / len(distinct) > 4.6, sum(distinct) / len(distinct)
