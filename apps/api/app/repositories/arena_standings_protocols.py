"""Read model for Arena standings: who is where on a mode's rating board.

A READ-ONLY PROJECTION ACROSS TWO OWNERS, AND NAMED AS ONE. `arena_ratings` is
the rating repository's table; `profiles.handle` is the profile repository's.
A public board needs both at once -- rows are listed only under a public handle
(launch-polish IMPLEMENTATION_CONTRACT.md §8), and "the three listed players
just above you" is a question about the ORDER of one table filtered by the
other. Answering it by loading a whole mode's ratings and looking up a handle
per row (which is what ranked's `/leaderboard/me` does) costs one round trip per
player; answering it by teaching the rating repository to read `profiles` would
put a second owner inside a repository whose docstring says it owns exactly two
tables. So this is its own protocol, it writes nothing, and it owns nothing.

RANK IS POSITION AMONG EVERY RATED PLAYER, NOT AMONG LISTED ONES. That is the
existing contract of `GET /arena/leaderboard/{mode}` (`rank = offset + index +
1` over all rated rows, with handle-less rows skipped) and of ranked's board,
both of which document the gaps it leaves. It is kept because it is the true
competitive position: an unlisted player rated above you IS above you, and a
number that pretended otherwise would change the moment they chose a handle.

TOTAL ORDER: `rating DESC, rated_matches DESC, owner_sub ASC` -- identical to
`ArenaRatingRepository.get_leaderboard_page` and to `arena_ratings_leaderboard_idx`,
so a rank here and a position there cannot disagree.

WHAT IS NEVER HERE: bots. A bot is rated against and never rated
(`services/arena/rating.py`), so it has no `arena_ratings` row and cannot
appear in any method below. Players with zero rated matches are excluded too,
exactly as the leaderboard index excludes them.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class ArenaRatingPopulation:
    """Head-counts for one mode's rated humans."""

    #: Humans with at least one rated match -- the population ranks and
    #: percentiles are computed over.
    rated_players: int = 0
    #: The subset with a public handle -- the rows a public board can list.
    listed_players: int = 0
    #: The subset past the provisional threshold the caller passed.
    established_players: int = 0


@dataclass(frozen=True)
class ArenaStandingRow:
    """One rated player at a position on the board.

    `handle` is None only on `get_standing` for an unlisted caller; every
    listing method returns listed rows exclusively. `owner_sub` is carried for
    the API to join statistics and is stripped before serialising, the same
    rule `ArenaLeaderboardRow` follows.
    """

    owner_sub: str
    mode: str
    rank: int
    rating: float
    rd: float
    rated_matches: int
    handle: Optional[str] = None
    last_rated_match_at: Optional[datetime] = None


@dataclass(frozen=True)
class ArenaStanding:
    """One player's own position, with what a percentile needs."""

    row: ArenaStandingRow
    #: Rated players with a STRICTLY lower rating (ties share a percentile).
    players_below: int


@runtime_checkable
class ArenaStandingsRepository(Protocol):
    async def get_population(
        self, mode: str, established_min_matches: int
    ) -> ArenaRatingPopulation:
        """Counts for one mode. All zero for a mode nobody has rated in."""
        ...

    async def list_top(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaStandingRow]:
        """Listed players best first, paged over LISTED rows.

        Paging over listed rows (not over all rated rows) is what lets a page of
        50 actually hold 50 names; `rank` on each row is still the global
        position, so an unlisted player above shows as a gap in the numbers.
        """
        ...

    async def get_standing(self, mode: str, owner_sub: str) -> Optional[ArenaStanding]:
        """This subject's position, or None when they have no rated match in
        this mode. Returned whether or not they have a handle (`row.handle` is
        None when they do not)."""
        ...

    async def list_neighbours(
        self, mode: str, owner_sub: str, above: int, below: int
    ) -> tuple[list[ArenaStandingRow], list[ArenaStandingRow]]:
        """The nearest `above` LISTED players ahead of this subject and the
        nearest `below` behind, both in board order (best first), never
        including the subject. Two empty lists when the subject is unrated.

        "Nearest listed", not "the rows at rank ±n": an unlisted neighbour is
        skipped and the next listed player is taken, so the window is full
        whenever enough listed players exist on that side.
        """
        ...
