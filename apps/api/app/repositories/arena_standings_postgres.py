"""PostgreSQL ArenaStandingsRepository.

Every query ranks the SAME way: `ROW_NUMBER() OVER (ORDER BY rating DESC,
rated_matches DESC, owner_sub)` over the mode's rated rows, which is the order
`arena_ratings_leaderboard_idx` is built in, so the window streams off the index
rather than sorting. Handles come from `profiles` by a read-only join on
`profiles.auth_sub` (UNIQUE, so the join cannot duplicate a row).

SCALING NOTE. Ranking a neighbour or a standing computes the window over the
whole mode partition -- O(rated players in the mode) per call, with no sort.
That is milliseconds at launch populations and deliberately simpler than a
materialised rank. If a mode ever holds ~10^5 rated players, the replacement is
a periodically refreshed rank column, not a change to this protocol.
"""
from __future__ import annotations

from typing import Any, Optional

from app.repositories.arena_standings_protocols import (
    ArenaRatingPopulation,
    ArenaStanding,
    ArenaStandingRow,
)

# The mode's rated rows with their global position. $1 is always the mode.
_RANKED_CTE = """
    ranked AS (
        SELECT owner_sub, mode, rating, rd, rated_matches, last_rated_match_at,
               ROW_NUMBER() OVER (
                   ORDER BY rating DESC, rated_matches DESC, owner_sub
               ) AS rank
          FROM arena_ratings
         WHERE mode = $1 AND rated_matches > 0
    )
"""

# A listed player: a non-empty public handle.
_LISTED_JOIN = """
    JOIN profiles p
      ON p.auth_sub = ranked.owner_sub
     AND p.handle IS NOT NULL AND p.handle <> ''
"""

_ROW_COLUMNS = """
    ranked.owner_sub, ranked.mode, ranked.rank, ranked.rating, ranked.rd,
    ranked.rated_matches, ranked.last_rated_match_at, p.handle
"""


def _row(r: Any) -> ArenaStandingRow:
    return ArenaStandingRow(
        owner_sub=r["owner_sub"],
        mode=r["mode"],
        rank=int(r["rank"]),
        rating=float(r["rating"]),
        rd=float(r["rd"]),
        rated_matches=int(r["rated_matches"]),
        handle=r["handle"] or None,
        last_rated_match_at=r["last_rated_match_at"],
    )


class PostgresArenaStandingsRepository:
    def __init__(self, pool: Any) -> None:
        self._pool = pool

    async def get_population(
        self, mode: str, established_min_matches: int
    ) -> ArenaRatingPopulation:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT COUNT(*)                                             AS rated,
                       COUNT(*) FILTER (WHERE r.rated_matches >= $2)        AS established,
                       COUNT(*) FILTER (
                           WHERE p.handle IS NOT NULL AND p.handle <> ''
                       )                                                    AS listed
                  FROM arena_ratings r
                  LEFT JOIN profiles p ON p.auth_sub = r.owner_sub
                 WHERE r.mode = $1 AND r.rated_matches > 0
                """,
                mode, established_min_matches,
            )
        return ArenaRatingPopulation(
            rated_players=int(row["rated"] or 0),
            listed_players=int(row["listed"] or 0),
            established_players=int(row["established"] or 0),
        )

    async def list_top(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaStandingRow]:
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                WITH {_RANKED_CTE}
                SELECT {_ROW_COLUMNS}
                  FROM ranked {_LISTED_JOIN}
                 ORDER BY ranked.rank
                 LIMIT $2 OFFSET $3
                """,
                mode, limit, offset,
            )
        return [_row(r) for r in rows]

    async def get_standing(self, mode: str, owner_sub: str) -> Optional[ArenaStanding]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                WITH {_RANKED_CTE}
                SELECT {_ROW_COLUMNS},
                       (SELECT COUNT(*) FROM ranked b
                         WHERE b.rating < ranked.rating) AS players_below
                  FROM ranked
                  LEFT JOIN profiles p ON p.auth_sub = ranked.owner_sub
                 WHERE ranked.owner_sub = $2
                """,
                mode, owner_sub,
            )
        if row is None:
            return None
        return ArenaStanding(row=_row(row), players_below=int(row["players_below"]))

    async def list_neighbours(
        self, mode: str, owner_sub: str, above: int, below: int
    ) -> tuple[list[ArenaStandingRow], list[ArenaStandingRow]]:
        async with self._pool.acquire() as conn:
            ahead = await conn.fetch(
                f"""
                WITH {_RANKED_CTE},
                     me AS (SELECT rank FROM ranked WHERE owner_sub = $2)
                SELECT {_ROW_COLUMNS}
                  FROM ranked
                  JOIN me ON ranked.rank < me.rank
                  {_LISTED_JOIN}
                 ORDER BY ranked.rank DESC
                 LIMIT $3
                """,
                mode, owner_sub, max(0, above),
            )
            behind = await conn.fetch(
                f"""
                WITH {_RANKED_CTE},
                     me AS (SELECT rank FROM ranked WHERE owner_sub = $2)
                SELECT {_ROW_COLUMNS}
                  FROM ranked
                  JOIN me ON ranked.rank > me.rank
                  {_LISTED_JOIN}
                 ORDER BY ranked.rank ASC
                 LIMIT $3
                """,
                mode, owner_sub, max(0, below),
            )
        # Nearest-first from the query; returned in board order.
        return [_row(r) for r in reversed(ahead)], [_row(r) for r in behind]
