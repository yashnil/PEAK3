"""Daily Grid Challenge (Phase 11A) -- PEAK3's lightweight daily game.

A 3x3 board whose rows and columns are basketball/PEAK3 constraints; each
cell is filled with an exact NBA player-SEASON that satisfies both.

Module map:
  pool.py        the canonical player-season answer universe (real, committed data only)
  constraints.py the shipped constraint taxonomy + predicates
  generator.py   deterministic date -> board
  validation.py  server-side answer checking
  scoring.py     cell/board scoring (PEAK quality + rarity proxy)
  search.py      name/season lookup for filling a cell
"""
from nba_peak.daily_grid.constraints import (
    ALL_CONSTRAINTS,
    Constraint,
    all_constraints,
    constraint_by_id,
)
from nba_peak.daily_grid.generator import (
    DAILY_GRID_VERSION,
    GridBoard,
    GridCell,
    InvalidGridDate,
    board_id,
    board_theme,
    generate_board,
    get_board,
    grid_seed,
    rarity_bucket,
    today_utc_date,
    validate_grid_date,
)
from nba_peak.daily_grid.pool import PlayerSeason, load_pool
from nba_peak.daily_grid.scoring import CellScore, score_cell
from nba_peak.daily_grid.search import (
    SELECTABLE_STATUSES,
    STATUS_AVAILABLE,
    STATUS_NO_FIT,
    STATUS_UNKNOWN,
    STATUS_USED,
    SearchHit,
    cell_answer_stats,
    search_player_seasons,
)
from nba_peak.daily_grid.validation import ValidationResult, validate_answer

__all__ = [
    "ALL_CONSTRAINTS",
    "CellScore",
    "Constraint",
    "DAILY_GRID_VERSION",
    "GridBoard",
    "GridCell",
    "InvalidGridDate",
    "PlayerSeason",
    "SELECTABLE_STATUSES",
    "STATUS_AVAILABLE",
    "STATUS_NO_FIT",
    "STATUS_UNKNOWN",
    "STATUS_USED",
    "SearchHit",
    "ValidationResult",
    "all_constraints",
    "board_id",
    "board_theme",
    "cell_answer_stats",
    "constraint_by_id",
    "generate_board",
    "get_board",
    "grid_seed",
    "load_pool",
    "rarity_bucket",
    "score_cell",
    "search_player_seasons",
    "today_utc_date",
    "validate_answer",
    "validate_grid_date",
]
