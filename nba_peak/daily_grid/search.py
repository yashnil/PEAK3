"""Player-season search for filling a Daily Grid cell.

The player types a name; this returns exact player-SEASONS to choose from,
each carrying a STATUS that says whether it can actually be played here.

RANKING, NOT FILTERING. When a cell is supplied, results are ordered so that
seasons the player can actually use come first -- but unusable ones are still
returned, marked and disabled. Hiding them would leak the answer key by
omission: a player could type "Jordan", see only three of his seasons, and
learn the answer set without submitting anything. Showing every season, and
saying plainly why the others cannot be picked, keeps the key server-side and
still spares the player a submit-to-find-out loop.

THE FOUR STATUSES (see STATUS_* below)
  available  fits this square, and this identity is not on the board yet
  used       this player is already somewhere on the board, so the
             distinct-identity rule rules out every one of their seasons --
             decided from client-supplied board state, not from the key, so
             it is always safe to report
  no_fit     does not satisfy this square's two constraints
  unknown    eligibility withheld for this query (see below); the player may
             still submit it and find out

HOW MUCH ELIGIBILITY A QUERY EARNS. Phase 11C replaces 11B's "is the query
narrow?" gate with a direct measure of the thing that was actually at risk:
HOW MANY OF THIS SQUARE'S ANSWERS ONE RESPONSE WOULD HAND OVER. If a query's
hits contain more than MAX_REVEALED_ELIGIBLE_IDENTITIES distinct qualifying
PLAYERS, every hit comes back `unknown` and the client cannot tell valid from
invalid. Counted in distinct players because the distinct-identity rule makes
the player the real unit of an answer -- and because the case this is meant to
help, "which of Alex English's seasons is the one?", is one identity no matter
how many seasons it matches.

That is a strictly better gate than counting matched identities. The old rule
withheld a verdict from "br" (dozens of matching names) even though barely any
of them qualify -- so the player had to click Brad Daugherty to discover he is
not a Knicks guard, which is friction with no security value. The new rule
answers "br" and goes dark exactly when a query starts to approach the answer
set, which is the incentive shape you want: the closer a query gets to being a
bulk extractor, the less it says.

NAME MATCHING is prefix-and-substring over the player name, with a season
token honoured when present ("jordan 96", "1996-97 jordan"), because that is
how people actually search for a season. No fuzzy/edit-distance matching:
it produces confident wrong answers, and the pool is small enough that
substring matching finds everything a real query intends.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

from nba_peak.daily_grid.constraints import constraint_by_id
from nba_peak.daily_grid.generator import GridBoard
from nba_peak.daily_grid.pool import GridPool, PlayerSeason, load_pool

SEARCH_VERSION = "daily_grid_search.v3"

DEFAULT_LIMIT = 25
MAX_LIMIT = 50
MIN_QUERY_LENGTH = 2

# The four statuses a hit can carry. See the module docstring.
STATUS_AVAILABLE = "available"
STATUS_USED = "used"
STATUS_NO_FIT = "no_fit"
STATUS_UNKNOWN = "unknown"

# Statuses the client may submit. `unknown` is playable because the player is
# choosing to find out; `used` and `no_fit` are refusals the server has already
# stated, so offering them as buttons would only invite a pointless round trip.
SELECTABLE_STATUSES = frozenset({STATUS_AVAILABLE, STATUS_UNKNOWN})

# How many DISTINCT qualifying players one response may name before eligibility
# is withheld from the whole response -- see "HOW MUCH ELIGIBILITY A QUERY
# EARNS" above. Three is enough that naming a player (one identity, however
# many of their seasons match) always earns a verdict, and that a plausible
# partial like "br" on a guard square still does; it is small enough that a
# query approaching a cell's real answer set goes dark.
MAX_REVEALED_ELIGIBLE_IDENTITIES = 3

# Sort rank per status. Playable hits first, then the player's own already-used
# names, then the ones that simply do not fit. `available` and `unknown` share
# a rank because they never occur in the same response -- eligibility is
# revealed for all hits or none of them.
_STATUS_RANK: dict[str, int] = {
    STATUS_AVAILABLE: 0,
    STATUS_UNKNOWN: 0,
    STATUS_USED: 1,
    STATUS_NO_FIT: 2,
}

# A 2- or 4-digit run in the query is read as a season hint ("96", "1996").
_SEASON_TOKEN = re.compile(r"\b(\d{2}|\d{4})\b")


@dataclass(frozen=True)
class SearchHit:
    """One candidate season, plus whether it can be played in the cell.

    `eligible` is None when the search was not scoped to a cell, or when the
    query would have revealed too much of the answer set (see
    MAX_REVEALED_ELIGIBLE_IDENTITIES). `status` is the display verdict, which
    also folds in the distinct-identity rule: a player already on the board is
    `used` whatever their eligibility, because that is the reason they cannot
    be played here.

    CARRIES NO SCORE. `as_dict()` serialises via
    PlayerSeason.as_search_dict(), so a candidate's PEAK3 score is not
    knowable until it is locked in. Eligibility is still exposed because
    knowing WHETHER a season qualifies is a different fact from knowing HOW
    MUCH it is worth -- and with the score hidden, choosing among a player's
    several qualifying seasons is exactly the judgement the mode is asking for.
    """

    player_season: PlayerSeason
    eligible: Optional[bool]
    status: str = STATUS_UNKNOWN

    @property
    def selectable(self) -> bool:
        return self.status in SELECTABLE_STATUSES

    def as_dict(self) -> dict:
        # as_SEARCH_dict, deliberately -- no prime_score. See the class
        # docstring; the API's own tests assert no score reaches this shape.
        payload = self.player_season.as_search_dict()
        payload["eligible"] = self.eligible
        payload["status"] = self.status
        payload["selectable"] = self.selectable
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
    used_player_slugs: Iterable[str] = (),
) -> list[SearchHit]:
    """Candidate player-seasons for `query`, most playable first.

    When (board, row, col) are supplied, hits the player can actually use sort
    ahead of ones they cannot, and each carries a `status`. Eligibility is
    withheld (status `unknown`) when a response would name more than
    MAX_REVEALED_ELIGIBLE_IDENTITIES distinct qualifying players.

    `used_player_slugs` is the client's own board state, so `used` is reported
    for every query -- including one too broad to earn an eligibility verdict.
    It tells the client nothing it did not already know.
    """
    grid_pool = pool if pool is not None else load_pool()
    limit = max(1, min(int(limit), MAX_LIMIT))
    used = set(used_player_slugs)

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

    # How much of this square's answer set would a verdict give away? Measured
    # in distinct QUALIFYING players, which is the unit an answer really has
    # (the distinct-identity rule means a player's other seasons are worth
    # nothing once one of them is placed). Computed over the whole matched set,
    # not the truncated page, so raising `limit` cannot buy a bigger reveal.
    cell_scoped = board is not None and row is not None and col is not None
    answer_ids: set[str] = set(board.cell(row, col).answer_ids) if cell_scoped else set()
    revealed_identities = {
        player_season.player_slug
        for _, player_season in matched
        if player_season.id in answer_ids
    }
    reveal_eligibility = (
        cell_scoped and len(revealed_identities) <= MAX_REVEALED_ELIGIBLE_IDENTITIES
    )

    # Pass 2 -- classify and rank.
    scored: list[tuple[tuple, SearchHit]] = []
    for name_rank, player_season in matched:
        eligible: Optional[bool] = (
            (player_season.id in answer_ids) if reveal_eligibility else None
        )
        if player_season.player_slug in used:
            # Wins over eligibility on purpose: an identity already on the
            # board cannot be played here whether or not the season qualifies,
            # and "already used" is the reason the player needs to see. It is
            # also derived from their own board state, so it stays truthful on
            # a query whose eligibility was withheld.
            status = STATUS_USED
        elif eligible is True:
            status = STATUS_AVAILABLE
        elif eligible is False:
            status = STATUS_NO_FIT
        else:
            status = STATUS_UNKNOWN

        # Within a status, ordered by name-match quality and then
        # CHRONOLOGICALLY -- never by score. Ranking a player's seasons
        # best-first would leak the optimisation target just as surely as
        # printing the number: the player would simply click the top row every
        # time. Career order is neutral, and it is also how someone thinks
        # about a career they are trying to recall ("his third year, the one
        # they won it").
        sort_key = (
            _STATUS_RANK[status],
            name_rank,
            player_season.player_name,
            player_season.season,
        )
        scored.append(
            (
                sort_key,
                SearchHit(
                    player_season=player_season, eligible=eligible, status=status
                ),
            )
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
