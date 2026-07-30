"""Player-season search for filling a Daily Grid cell.

The player types a name; this returns exact player-SEASONS to choose from.
Two things shape the design:

RANKING, NOT FILTERING. When a cell is supplied, results are ordered so that
seasons valid for that cell come first -- but invalid ones are still
returned, marked. Hiding them would leak the answer key by omission: a player
could type "Jordan", see only three of his seasons, and learn the answer set
without submitting anything. Showing every season and letting validation
reject the wrong ones keeps the key server-side and teaches the player why a
guess missed.

WHICH QUERIES EARN THAT HELP. Eligibility is revealed only for a query that
already names a specific player (few distinct identities matched). This is
the game's skill split made explicit:

  "who played for the Nuggets AND was top-10% in Traditional Production?"
      <- the actual puzzle; the search box must not answer this
  "which of Alex English's seasons is the one?"
      <- pure friction; there is no attempt limit, so withholding this only
         makes the player submit the same name repeatedly until one sticks

Without the gate, eligibility ranking is a bulk answer-key extractor: a
meaningless two-letter substring ("an", "on") matches hundreds of players,
and sorting valid-first floats a large share of a cell's real answer set to
the top of the list for a player who knows nothing. Measured on a real v1
board, one such query surfaced 6 of a 31-answer cell's key. So a BROAD query
(more than MAX_IDENTITIES_FOR_ELIGIBILITY distinct players) is ranked by name
match alone and every hit comes back `eligible=None` -- the client cannot tell
valid from invalid, and there is nothing to harvest.

NAME MATCHING is prefix-and-substring over the player name, with a season
token honoured when present ("jordan 96", "1996-97 jordan"), because that is
how people actually search for a season. No fuzzy/edit-distance matching:
it produces confident wrong answers, and the pool is small enough that
substring matching finds everything a real query intends.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from nba_peak.daily_grid.constraints import constraint_by_id
from nba_peak.daily_grid.generator import GridBoard
from nba_peak.daily_grid.pool import GridPool, PlayerSeason, load_pool

SEARCH_VERSION = "daily_grid_search.v1"

DEFAULT_LIMIT = 25
MAX_LIMIT = 50
MIN_QUERY_LENGTH = 2

# A cell-scoped query only reveals eligibility if it narrows to at most this
# many distinct player identities -- see "WHICH QUERIES EARN THAT HELP" above.
# Set at 6 so a real surname still qualifies (there are several Johnsons and
# Williamses in the pool) while a generic substring does not.
MAX_IDENTITIES_FOR_ELIGIBILITY = 6

# A 2- or 4-digit run in the query is read as a season hint ("96", "1996").
_SEASON_TOKEN = re.compile(r"\b(\d{2}|\d{4})\b")


@dataclass(frozen=True)
class SearchHit:
    """One candidate season, plus whether it fits the cell being filled.

    `eligible` is None when the search was not scoped to a cell.
    """

    player_season: PlayerSeason
    eligible: Optional[bool]

    def as_dict(self) -> dict:
        payload = self.player_season.as_dict()
        payload["eligible"] = self.eligible
        return payload


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]+", " ", str(text).lower()).strip()


def _season_matches(season: str, token: str) -> bool:
    """Does '1996-97' match the token '96' or '1996'?

    Both halves count, so "97" finds 1996-97 as well as 1997-98 -- a player
    thinking of "the 97 Bulls" means the 1996-97 team, and one thinking of
    "97-98" means the next one. Returning both is friendlier than guessing.
    """
    start, end = season.split("-")
    if len(token) == 4:
        return start == token
    return start[2:] == token or end == token


def search_player_seasons(
    query: str,
    board: GridBoard | None = None,
    row: int | None = None,
    col: int | None = None,
    limit: int = DEFAULT_LIMIT,
    pool: GridPool | None = None,
) -> list[SearchHit]:
    """Candidate player-seasons for `query`, best first.

    When (board, row, col) are supplied AND the query names a specific player
    (see MAX_IDENTITIES_FOR_ELIGIBILITY), hits valid for that cell sort ahead
    of invalid ones and carry `eligible`. For a broad query, results are ranked
    by name match alone and every hit carries `eligible=None`.
    """
    grid_pool = pool if pool is not None else load_pool()
    limit = max(1, min(int(limit), MAX_LIMIT))

    normalized = _normalize(query)
    if len(normalized.replace(" ", "")) < MIN_QUERY_LENGTH:
        return []

    season_tokens = _SEASON_TOKEN.findall(normalized)
    name_query = _normalize(_SEASON_TOKEN.sub(" ", normalized))

    # Pass 1 -- everything the query matches, with its name-match quality.
    matched: list[tuple[int, PlayerSeason]] = []
    for player_season in grid_pool.seasons:
        name = _normalize(player_season.player_name)

        if name_query:
            if name.startswith(name_query):
                name_rank = 0
            elif any(part.startswith(name_query) for part in name.split()):
                name_rank = 1
            elif name_query in name:
                name_rank = 2
            else:
                continue
        else:
            # Season-only query ("1996"): every player-season in that year.
            name_rank = 3

        if season_tokens and not any(
            _season_matches(player_season.season, token) for token in season_tokens
        ):
            continue

        matched.append((name_rank, player_season))

    # Does this query narrow to a specific player? Counted over DISTINCT
    # IDENTITIES rather than seasons, since one player naturally has many
    # seasons and that is exactly the case eligibility is meant to help with.
    identities = {player_season.player_slug for _, player_season in matched}
    reveal_eligibility = (
        board is not None
        and row is not None
        and col is not None
        and 0 < len(identities) <= MAX_IDENTITIES_FOR_ELIGIBILITY
    )

    eligible_ids: set[str] = (
        set(board.cell(row, col).answer_ids) if reveal_eligibility else set()
    )

    # Pass 2 -- rank.
    scored: list[tuple[tuple, SearchHit]] = []
    for name_rank, player_season in matched:
        eligible: Optional[bool] = (
            (player_season.id in eligible_ids) if reveal_eligibility else None
        )
        sort_key = (
            0 if eligible else 1,
            name_rank,
            -player_season.prime_score,
            player_season.season,
        )
        scored.append(
            (sort_key, SearchHit(player_season=player_season, eligible=eligible))
        )

    scored.sort(key=lambda item: item[0])
    return [hit for _, hit in scored[:limit]]


def cell_answer_stats(board: GridBoard, row: int, col: int) -> dict:
    """Safe-to-expose facts about a cell: its two constraint labels and its
    rarity bucket. Never the answer count or the answers themselves."""
    from nba_peak.daily_grid.generator import rarity_bucket

    cell = board.cell(row, col)
    return {
        "row": row,
        "col": col,
        "row_constraint": constraint_by_id(cell.row_constraint_id).as_dict(),
        "col_constraint": constraint_by_id(cell.col_constraint_id).as_dict(),
        "rarity_bucket": rarity_bucket(cell.answer_count),
    }


def unused_answer_for_cell(
    board: GridBoard,
    row: int,
    col: int,
    used_player_slugs: frozenset[str] = frozenset(),
    pool: GridPool | None = None,
) -> Optional[PlayerSeason]:
    """One valid answer for a cell whose player is not already used.

    Server-side only -- this is answer-key material. It exists for tests
    (which need a known-good answer for every cell) and never has a route.
    Returns the highest-PEAK3 such season so test output is stable and
    readable; None if the distinct-identity rule leaves nothing.
    """
    grid_pool = pool if pool is not None else load_pool()
    cell = board.cell(row, col)
    candidates = [
        grid_pool.by_id[answer_id]
        for answer_id in cell.answer_ids
        if grid_pool.by_id[answer_id].player_slug not in used_player_slugs
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda ps: (ps.prime_score, ps.id))


def board_reference_solution(
    board: GridBoard, pool: GridPool | None = None
) -> Optional[list[PlayerSeason]]:
    """A full nine-cell solution using nine different players, or None.

    Server-side only, same as unused_answer_for_cell. Backtracks in
    fewest-options-first order so the binding cells are resolved before the
    open ones.
    """
    grid_pool = pool if pool is not None else load_pool()
    order = sorted(board.cells, key=lambda c: c.distinct_player_count)
    solution: dict[tuple[int, int], PlayerSeason] = {}
    used: set[str] = set()

    def assign(index: int) -> bool:
        if index == len(order):
            return True
        cell = order[index]
        for answer_id in cell.answer_ids:
            player_season = grid_pool.by_id[answer_id]
            if player_season.player_slug in used:
                continue
            used.add(player_season.player_slug)
            solution[(cell.row, cell.col)] = player_season
            if assign(index + 1):
                return True
            used.discard(player_season.player_slug)
            del solution[(cell.row, cell.col)]
        return False

    if not assign(0):
        return None
    return [solution[(cell.row, cell.col)] for cell in board.cells]
