"""Pydantic request/response models for the Daily Grid Challenge.

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

2. BOUNDING CLIENT INPUT. There is no server-side board state -- boards are
   derived from the date, not stored -- so `used_player_slugs` / `filled_cells`
   are client-supplied. They are capped at nine (a 3x3 board can never have
   more), which is a resource guard, not a security boundary: constraint
   validity itself is decided server-side from real data in
   nba_peak/daily_grid/validation.py, and the distinct-identity rule is
   re-checked across the whole board on /result and /official.

   (Phase 11D added durable storage of completed RESULTS for signed-in
   players -- see OfficialResultRequest below -- which is a record of a
   finished board, not live board state.)

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
    "team", "award", "era", "position", "context", "peak", "component", "outcome"
]
RarityBucket = Literal["very_rare", "rare", "uncommon", "common", "very_common"]
GridDifficulty = Literal["easy", "medium", "hard"]
SearchHitStatus = Literal["available", "used", "no_fit", "unknown"]
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
    # Deliberately an open `str`, not a Literal: the theme is descriptive copy
    # derived from the axes the client already has, and adding a theme name
    # should not be a breaking schema change on a field nothing switches on.
    theme: str = Field(..., description='e.g. "Ring Chasers"; derived from the axes')
    rows: list[GridConstraint]
    cols: list[GridConstraint]
    cells: list[GridCellSpec]
    rules: GridRules


class PlayerSeasonIdentity(BaseModel):
    """An exact NBA player-season, WITHOUT its score
    (pool.PlayerSeason.as_search_dict()).

    Phase 11B: the Daily Grid asks the player to maximise total PEAK3 score,
    so `prime_score` is the answer to the puzzle and cannot appear before a
    pick is locked. Everything here is identity the player already knows from
    the name they typed. Deliberately has no `prime_score` field at all rather
    than an optional one -- an optional field is a field someone eventually
    populates by accident.
    """

    id: str
    player_slug: str
    player_name: str
    season: str = Field(..., description='"1990-91"')
    team: str = Field(..., description='Basketball-Reference code, e.g. "CHI"')
    team_name: str
    position: str = Field(..., description='Season position, e.g. "SG"; "" if unlisted')
    label: str = Field(..., description='"1990-91 Michael Jordan"')


class PlayerSeasonCard(PlayerSeasonIdentity):
    """A player-season with its score revealed (pool.PlayerSeason.as_dict()).

    REVEALED SHAPE -- only valid post-completion, in the result comparison.
    A locked square learns its own score through `CellScore.quality_points`,
    not through this model.
    """

    prime_score: float = Field(..., description="PEAK3 calibrated 0-100 season score")


class PlayerSeasonSearchHit(PlayerSeasonIdentity):
    """A search result. `eligible` is None for an unscoped search, or one whose
    verdict was withheld to avoid handing over the square's answers.

    Unusable hits are returned on purpose: filtering them out would leak the
    answer key by omission (see nba_peak/daily_grid/search.py). `status` is
    what the UI renders and what decides whether the row is clickable --
    `selectable` restates it as the single boolean a button needs, so the
    client never has to re-derive the rule.

    Carries no score -- knowing WHETHER a season qualifies is a different fact
    from knowing how much it is worth, and only the first is given away.
    """

    eligible: Optional[bool] = None
    status: SearchHitStatus = "unknown"
    selectable: bool = Field(
        True, description="False for `used` and `no_fit`; the UI disables those rows"
    )


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
    player_season: Optional[PlayerSeasonIdentity] = Field(
        None,
        description=(
            "Present whenever the id resolved, valid or not. Identity only -- "
            "a rejected answer never returns its score, or every square would "
            "be a free score oracle."
        ),
    )
    cell_score: Optional[CellScore] = Field(
        None,
        description=(
            "Present only when valid. `quality_points` is the locked season's "
            "prime_score -- this is where a score is revealed."
        ),
    )


# ---------------------------------------------------------------------------
# Result / today's maximum (Phase 11B)
# ---------------------------------------------------------------------------

class FilledCellInput(BaseModel):
    """One square the client claims to have locked."""

    row: int = Field(..., ge=0, le=GRID_SIZE - 1)
    col: int = Field(..., ge=0, le=GRID_SIZE - 1)
    answer_id: str = Field(..., min_length=1, max_length=128)


class GridResultRequest(BaseModel):
    """POST /api/v1/daily-grid/result request.

    The client sends the nine squares it believes it has completed. The route
    RE-VALIDATES every one of them server-side before computing anything --
    the result payload contains today's maximum, so a client must not be able
    to unlock the answer key by simply claiming a finished board.
    """

    date: str = Field(..., max_length=32, description="YYYY-MM-DD, UTC")
    filled: list[FilledCellInput] = Field(
        ..., min_length=1, max_length=MAX_BOARD_CELLS
    )
    incorrect_attempts: int = Field(0, ge=0, le=10_000)


class ResultCell(BaseModel):
    """One square, side by side: what the player used, what the BEST LEGAL GRID
    used.

    The comparison is grid-to-grid, not square-to-square: the optimal answer
    here comes from a single nine-different-players assignment, so it depends
    on what that assignment needed elsewhere. `beat_optimal` and
    `optimal_player_user_square` exist so the UI can say that instead of
    printing something that looks wrong (see optimal.ResultCell).
    """

    row: int
    col: int
    row_constraint_label: str
    col_constraint_label: str
    user_player_season: PlayerSeasonCard
    user_points: int
    optimal_player_season: PlayerSeasonCard
    optimal_points: int
    points_left: int = Field(..., description="optimal_points - user_points, floored at 0")
    matched_optimal: bool
    beat_optimal: bool = Field(
        False,
        description=(
            "The player scored MORE here than the best legal grid did, because "
            "that grid traded this square away for a bigger total elsewhere."
        ),
    )
    optimal_player_user_square: Optional[str] = Field(
        None,
        description=(
            "The square where the PLAYER used this same identity, when the best "
            "legal grid also wanted them. None when there is no overlap."
        ),
    )


class GridResultResponse(BaseModel):
    """POST /api/v1/daily-grid/result — the post-completion comparison.

    `exact_optimal` is True when `optimal_total` is the provable maximum for
    the board rather than the best found; the UI wording depends on it, and
    overclaiming there would be unearned certainty.
    """

    board_id: str
    date: str
    user_total: int
    optimal_total: int
    percent_of_best: float
    exact_optimal: bool
    incorrect_attempts: int
    squares_matching_optimal: int
    cells: list[ResultCell]
    best_cell: ResultCell
    biggest_miss: Optional[ResultCell] = Field(
        None, description="None when the player matched the maximum on every square"
    )


# ---------------------------------------------------------------------------
# Official account-backed result (Phase 11D)
# ---------------------------------------------------------------------------

class OfficialResultRequest(GridResultRequest):
    """POST /api/v1/daily-grid/official request.

    Extends the result request rather than redefining it, so the two routes
    take the SAME nine squares and go through the SAME server-side
    revalidation. Adds only the two presentational facts the durable record
    keeps and the comparison does not.
    """

    elapsed_seconds: Optional[int] = Field(
        None,
        ge=0,
        le=86_400,
        description=(
            "Client wall-clock time for the board. Stored presentationally and "
            "NEVER scored or ranked -- the server does not time attempts, so "
            "this value is not verified and must not be treated as if it were."
        ),
    )
    theme: Optional[str] = Field(
        None,
        max_length=64,
        description="Board theme, echoed back for display. Re-derived server-side.",
    )


class OfficialResultResponse(BaseModel):
    """POST /api/v1/daily-grid/official response.

    `official_saved` is True whenever the caller now HAS an official record for
    this board, whether this request created it or an earlier one did.
    `created` distinguishes the two. A retry is a success, not a conflict --
    see DailyGridResultRepository.save_result.
    """

    official_saved: bool
    created: bool = Field(
        ..., description="False when an official result for this board already existed"
    )
    board_id: str
    board_date: str
    board_version: str
    score: int
    optimal_total: int
    percent_of_best: float
    squares_matching_optimal: int
    played_on_board_date: bool = Field(
        ...,
        description=(
            "False for an archive replay reached through ?date=. Recorded "
            "honestly rather than rejected, and never counted as a live daily."
        ),
    )
    saved_at: str = Field(..., description="ISO-8601 UTC")
