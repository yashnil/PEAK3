"""Assembling Arena standings responses: Top Players, Around You, skill card.

The routes stay thin; this module joins the three sources a standing needs --
the standings read model (position, handle), the arena repository's rated-match
statistics (record, bot composition) and `skill.py`'s presentation rules (tier,
percentile) -- and nothing else. It computes no rating and writes nothing.

BOT DISCLOSURE TRAVELS WITH EVERY RATING. Every row and every skill card
carries `matches_with_bots` / `matches_all_human` from `get_player_stats`,
because a public-queue match filled with bots IS rated (see the
`services/arena/matchmaking.py` module docstring for why) against the bot's
calibrated, pinned rating. The policy is kept; what this module guarantees is
that no rating is ever shown without saying how much of it was earned against
people. Bots themselves never appear in any list: they have no rating row.
"""
from __future__ import annotations

from typing import Optional, Sequence

from app.models.arena import (
    ArenaAroundMeResponse,
    ArenaLeaderboardEntry,
    ArenaLeaderboardResponse,
    ArenaPopulationView,
    ArenaSkillView,
    ArenaTierStep,
)
from app.repositories.arena_standings_protocols import (
    ArenaRatingPopulation,
    ArenaStandingRow,
)
from app.services.arena import skill

#: Default and ceiling for the Around You window on each side.
AROUND_ME_DEFAULT_WINDOW = 3
AROUND_ME_MAX_WINDOW = 10


def population_view(population: ArenaRatingPopulation) -> ArenaPopulationView:
    return ArenaPopulationView(
        total_rated_players=population.listed_players,
        rated_population=population.rated_players,
        established_players=population.established_players,
        percentile_min_population=skill.PERCENTILE_MIN_POPULATION,
        provisional_until=skill.PROVISIONAL_UNTIL,
    )


def tier_ladder_view() -> list[ArenaTierStep]:
    return [ArenaTierStep(label=s.label, min_rating=s.min_rating) for s in skill.tier_ladder()]


async def _population(standings_repo, mode: str) -> ArenaRatingPopulation:
    return await standings_repo.get_population(mode, skill.PROVISIONAL_UNTIL)


async def _entries(
    repo,
    mode: str,
    rows: Sequence[ArenaStandingRow],
    detail_keys: Sequence[str],
    established_players: int,
) -> list[ArenaLeaderboardEntry]:
    rows = [r for r in rows if r.handle]  # listed rows only, defensively
    if not rows:
        return []
    stats = await repo.get_player_stats(mode, [r.owner_sub for r in rows], detail_keys)
    entries: list[ArenaLeaderboardEntry] = []
    for row in rows:
        st = stats.get(row.owner_sub)
        entries.append(
            ArenaLeaderboardEntry(
                rank=row.rank,
                handle=row.handle,
                rating=round(row.rating, 2),
                rd=round(row.rd, 2),
                rated_matches=row.rated_matches,
                provisional=skill.is_provisional(row.rated_matches),
                wins=st.wins if st else 0,
                losses=st.losses if st else 0,
                draws=st.draws if st else 0,
                matches_with_bots=st.matches_with_bots if st else 0,
                matches_all_human=st.matches_all_human if st else 0,
                average_placement=st.average_placement if st else None,
                podium_rate=st.podium_rate if st else None,
                average_score=st.score_avg if st else None,
                best_score=st.score_best if st else None,
                averages=dict(st.detail_averages) if st else {},
                bests=dict(st.detail_bests) if st else {},
                tier=skill.tier_for(row.rating, row.rated_matches, established_players).tier,
            )
        )
    return entries


async def top_players(
    repo,
    standings_repo,
    mode: str,
    detail_keys: Sequence[str],
    limit: int,
    offset: int,
) -> ArenaLeaderboardResponse:
    population = await _population(standings_repo, mode)
    rows = await standings_repo.list_top(mode, limit, offset) if population.listed_players else []
    view = population_view(population)
    return ArenaLeaderboardResponse(
        leaderboard_enabled=True,
        mode=mode,
        entries=await _entries(repo, mode, rows, detail_keys, population.established_players),
        limit=limit,
        offset=offset,
        population=view,
        total_rated_players=view.total_rated_players,
        tier_version=skill.ARENA_TIER_VERSION,
        tier_ladder=tier_ladder_view(),
    )


async def skill_view(
    repo,
    standings_repo,
    mode: str,
    owner_sub: str,
    *,
    ratings_enabled: bool,
    leaderboard_enabled: bool,
    population: Optional[ArenaRatingPopulation] = None,
) -> ArenaSkillView:
    """One player's skill card. Every withheld value names its reason."""
    stats = (await repo.get_player_stats(mode, [owner_sub], ())).get(owner_sub)
    record = dict(
        wins=stats.wins if stats else 0,
        losses=stats.losses if stats else 0,
        draws=stats.draws if stats else 0,
        rated_matches_counted=stats.rated_matches if stats else 0,
        matches_with_bots=stats.matches_with_bots if stats else 0,
        matches_all_human=stats.matches_all_human if stats else 0,
        best_rated_score=stats.score_best if stats else None,
        tier_version=skill.ARENA_TIER_VERSION,
    )

    if not ratings_enabled:
        reason = skill.REASON_RATINGS_DISABLED
        return ArenaSkillView(
            tier_reason=reason, rank_reason=reason, percentile_reason=reason, **record
        )

    population = population or await _population(standings_repo, mode)
    pop_view = population_view(population)
    standing = await standings_repo.get_standing(mode, owner_sub)
    if standing is None:
        reason = skill.REASON_NOT_RATED
        return ArenaSkillView(
            tier_reason=reason, rank_reason=reason, percentile_reason=reason,
            population=pop_view, **record,
        )

    row = standing.row
    tier = skill.tier_for(row.rating, row.rated_matches, population.established_players)
    rank = rank_reason = percentile = percentile_reason = None
    if leaderboard_enabled:
        rank = row.rank
        verdict = skill.percentile_for(
            standing.players_below, population.rated_players, row.rated_matches
        )
        percentile, percentile_reason = verdict.percentile, verdict.reason
    else:
        rank_reason = percentile_reason = skill.REASON_LEADERBOARD_DISABLED

    return ArenaSkillView(
        rated=True,
        rating=round(row.rating, 2),
        rd=round(row.rd, 2),
        rated_matches=row.rated_matches,
        provisional=skill.is_provisional(row.rated_matches),
        matches_until_established=max(0, skill.PROVISIONAL_UNTIL - row.rated_matches),
        tier=tier.tier,
        tier_reason=tier.reason,
        tier_capped=tier.capped,
        next_tier=tier.next_tier,
        next_tier_rating=tier.next_tier_rating,
        rank=rank,
        rank_reason=rank_reason,
        listed=bool(row.handle),
        handle=row.handle,
        percentile=percentile,
        percentile_reason=percentile_reason,
        population=pop_view,
        **record,
    )


async def around_me(
    repo,
    standings_repo,
    mode: str,
    owner_sub: str,
    detail_keys: Sequence[str],
    window: int,
    *,
    ratings_enabled: bool,
) -> ArenaAroundMeResponse:
    population = await _population(standings_repo, mode)
    view = population_view(population)
    me = await skill_view(
        repo, standings_repo, mode, owner_sub,
        ratings_enabled=ratings_enabled, leaderboard_enabled=True, population=population,
    )
    base = dict(
        leaderboard_enabled=True, mode=mode, me=me, population=view,
        total_rated_players=view.total_rated_players, tier_version=skill.ARENA_TIER_VERSION,
    )
    if not me.rated:
        return ArenaAroundMeResponse(status="not_rated", **base)

    above_rows, below_rows = await standings_repo.list_neighbours(mode, owner_sub, window, window)
    entries = await _entries(
        repo, mode, [*above_rows, *below_rows], detail_keys, population.established_players
    )
    by_rank = {e.rank: e for e in entries}
    return ArenaAroundMeResponse(
        status="listed" if me.listed else "unlisted",
        above=[by_rank[r.rank] for r in above_rows if r.rank in by_rank],
        below=[by_rank[r.rank] for r in below_rows if r.rank in by_rank],
        **base,
    )
