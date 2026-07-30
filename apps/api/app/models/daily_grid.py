"""Pydantic request/response models for the Daily Grid Challenge (Phase 11A).

The authoritative contract is apps/web/src/types/daily-grid.ts. Every model
here mirrors one interface in that file, field for field, so the OpenAPI
schema and the TypeScript types can never quietly diverge. If a shape needs
to change, change the .ts file first, then this one.

TWO THINGS THIS FILE IS RESPONSIBLE FOR

1. THE ANSWER KEY NEVER LEAVES THE SERVER. `DailyGridBoardResponse` and
   `GridCellSpec` declare exactly the public fields and nothing else -- so
   even if a future serializer started handing the router a dict carrying
   `answer_ids` or `answer_count`, response_model serialization would drop
   it. That is a second line of defence behind
   generator.GridBoard.as_public_dict(); see the header comment in
   daily-grid.ts for why the raw answer count is as sensitive as the key.

2. BOUNDING CLIENT INPUT. Phase 11A keeps no server-side board state, so
   `used_player_slugs` / `filled_cells` are client-supplied. They are capped
   at nine (a 3x3 board can never have more), which is a resource guard, not
   a security boundary -- constraint validity itself is decided server-side
   from real data in nba_peak/daily_grid/validation.py.

The closed unions below (`ConstraintCategory`, `RarityBucket`,
`GridDifficulty`, `ValidationReasonCode`) are Literals on purpose: they are
the same unions the TS contract declares, and a taxonomy addition that does
not update both sides should fail loudly in tests rather than ship a value
the client cannot switch on.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

# Mirrors GRID_SIZE in the TS contract and in nba_peak/daily_grid/generator.py.
GRID_SIZE = 3
MAX_BOARD_CELLS = GRID_SIZE * GRID_SIZE

ConstraintCategory = Literal[
    "team", "award", "era", "position", "peak", "component", "outcome"
]
RarityBucket = Literal["very_rare", "rare", "uncommon", "common", "very_common"]
GridDifficulty = Literal["easy", "medium", "hard"]
ValidationReasonCode = Literal[
    "unknown_answer", "player_already_used", "constraint_failed", "cell_filled"
]


class GridConstraint(BaseModel):
    """One row or column condition (constraints.Constraint.as_dict()).

    Carries no answer information -- not the ids, not how many seasons
    satisfy it.
    """

    id: str
    label: str
    short_label: str = Field(..., description="Compact form for the grid header")
    category: ConstraintCategory
    description: str = Field(..., description="Full sentence explaining what qualifies")


class GridCellSpec(BaseModel):
    """One square's public facts. No answers, no answer count -- `rarity_bucket`
    is the only answer-derived value exposed, and it is coarse by design."""

    row: int
    col: int
    row_constraint_id: str
    col_constraint_id: str
    rarity_bucket: RarityBucket


class GridRules(BaseModel):
    unique_player_identity: bool = Field(
        ..., description="Phase 11A: no player identity twice on one board"
    )
    grid_size: int


class DailyGridBoardResponse(BaseModel):
    """GET /api/v1/daily-grid/board"""

    board_id: str
    date: str = Field(..., description="YYYY-MM-DD, UTC")
    version: str
    difficulty: GridDifficulty
    rows: list[GridConstraint]
    cols: list[GridConstraint]
    cells: list[GridCellSpec]
    rules: GridRules


class PlayerSeasonCard(BaseModel):
    """An exact NBA player-season (pool.PlayerSeason.as_dict())."""

    id: str
    player_slug: str
    player_name: str
    season: str = Field(..., description='"1990-91"')
    team: str = Field(..., description='Basketball-Reference code, e.g. "CHI"')
    team_name: str
    position: str = Field(..., description='Season position, e.g. "SG"; "" if unlisted')
    prime_score: float = Field(..., description="PEAK3 calibrated 0-100 season score")
    label: str = Field(..., description='"1990-91 Michael Jordan"')


class PlayerSeasonSearchHit(PlayerSeasonCard):
    """A search result. `eligible` is None for an unscoped search.

    Ineligible hits are returned on purpose: filtering them out would leak
    the answer key by omission (see nba_peak/daily_grid/search.py).
    """

    eligible: Optional[bool] = None


class DailyGridSearchResponse(BaseModel):
    """GET /api/v1/daily-grid/search"""

    query: str
    results: list[PlayerSeasonSearchHit] = []


class CellScore(BaseModel):
    """How one filled cell scored (scoring.CellScore.as_dict()).

    Game scoring is `arena_points` by convention (CLAUDE.md) -- never
    `peak_score`. `quality_points` is the season's own model `prime_score`.
    """

    arena_points: int
    quality_points: float
    rarity_bucket: RarityBucket
    rarity_label: str = Field(..., description='Human-readable, e.g. "Rare square"')
    rarity_multiplier: float
    rarity_bonus: int = Field(..., description="arena_points minus quality_points")


class SubmitAnswerRequest(BaseModel):
    """POST /api/v1/daily-grid/answer request.

    `used_player_slugs` and `filled_cells` are the client's view of its own
    board so far -- capped at nine each because a 3x3 board can never hold
    more, and defaulting to empty so a fresh board needs neither.
    """

    date: str = Field(..., max_length=32, description="YYYY-MM-DD, UTC")
    row: int = Field(..., ge=0, le=GRID_SIZE - 1)
    col: int = Field(..., ge=0, le=GRID_SIZE - 1)
    answer_id: str = Field(..., min_length=1, max_length=128)
    used_player_slugs: list[str] = Field(
        default_factory=list, max_length=MAX_BOARD_CELLS
    )
    filled_cells: list[tuple[int, int]] = Field(
        default_factory=list,
        max_length=MAX_BOARD_CELLS,
        description="[row, col] pairs already filled",
    )


class SubmitAnswerResponse(BaseModel):
    """POST /api/v1/daily-grid/answer response.

    A wrong answer is `valid: false` on HTTP 200 -- being wrong is normal
    gameplay, not a transport error. The route serializes this with
    exclude_none so absent fields are omitted rather than sent as null,
    matching the optional fields in the TS contract.
    """

    valid: bool
    reason: Optional[str] = Field(None, description="Present only when invalid")
    reason_code: Optional[ValidationReasonCode] = None
    player_season: Optional[PlayerSeasonCard] = Field(
        None, description="Present whenever the id resolved, valid or not"
    )
    cell_score: Optional[CellScore] = Field(None, description="Present only when valid")
