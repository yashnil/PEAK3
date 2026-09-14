"""Skill-based public matchmaking: bands that start narrow and widen with wait.

The contract under test (`services/arena/matchmaking.py`, "Skill bands"):

  * a fresh entry matches within +/-100; +100 per 10 s of its OWN wait;
  * once its 30 s human window lapses (or it asks to fill now) the band is
    unbounded -- every waiting human before any bot;
  * a pair is compatible under the WIDER of its two bands;
  * among compatible humans the closest rating wins, then the longest wait,
    then the entry id, so the choice is total;
  * a full table of humans always beats bots, and bots only fill after the
    window;
  * `claim_entries_into_match` still makes a contended pairing produce exactly
    one match.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    EventDraft,
    ReducerInput,
    ReducerOutput,
    TurnDraft,
)
from app.repositories.arena_rating_memory import MemoryArenaRatingRepository
from app.repositories.arena_rating_protocols import ArenaRatingHistoryEntry
from app.services.arena import bots as bot_service
from app.services.arena import matchmaking as mm
from app.services.arena.modes import mode_rng

NOW = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)


class SkillMode:
    mode = "skill_demo"
    mode_version = "skill_v1"
    seat_count = 2
    turn_seconds = 30.0

    def initial_snapshot(self, seed: int, seats) -> dict:
        rng = mode_rng(seed, "deal")
        return {"turn": 0, "value": rng.randint(1, 100)}

    def initial_phase(self) -> str:
        return "play"

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        return ReducerOutput(
            accepted=True,
            snapshot={"turn": data.match.snapshot.get("turn", 0) + 1},
            events=(EventDraft(event_type="played"),),
            resolve_turn="action",
            open_turn=TurnDraft(
                phase="play",
                deadline_at=data.now + timedelta(seconds=self.turn_seconds),
                seat_index=0,
            ),
        )

    def project(self, match, seats, seat_index):
        return {}, {}, ("play",)


class SkillThreeSeat(SkillMode):
    mode = "skill_demo_three"
    seat_count = 3


@pytest.fixture(autouse=True)
def _clean_bot_registry():
    bot_service.registry.clear()
    yield
    bot_service.registry.clear()


async def _rate(ratings: MemoryArenaRatingRepository, sub: str, mode: str, rating: float) -> None:
    """Give `sub` a current rating in `mode` through the repository's own write."""
    await ratings.record_match_rating(
        [
            ArenaRatingHistoryEntry(
                owner_sub=sub, mode=mode, match_id=str(uuid.uuid4()),
                pre_rating=1500.0, pre_rd=350.0, pre_volatility=0.06,
                post_rating=rating, post_rd=80.0, post_volatility=0.06,
                unbounded_post_rating=rating, bound_applied=False, placement=1,
                had_bot_opponent=False, algorithm_version="test",
            )
        ]
    )


async def _subs(repo: MemoryArenaRepository, match) -> list[str]:
    return [s.occupant_sub for s in await repo.get_seats(match.match_id)]


# ---------------------------------------------------------------------------
# The schedule
# ---------------------------------------------------------------------------


def test_the_band_starts_narrow_and_widens_every_ten_seconds():
    assert mm.rating_band_for_wait(0) == 100
    assert mm.rating_band_for_wait(9.99) == 100
    assert mm.rating_band_for_wait(10) == 200
    assert mm.rating_band_for_wait(19.5) == 200
    assert mm.rating_band_for_wait(25) == 300


@pytest.mark.asyncio
async def test_the_band_is_the_entrys_own_and_unbounded_once_the_window_lapses():
    repo = MemoryArenaRepository()
    entry = await mm.join_queue(repo, SkillMode(), "user-a", NOW)
    assert mm.rating_band(entry, NOW) == 100
    assert mm.rating_band(entry, NOW + timedelta(seconds=12)) == 200
    assert mm.rating_band(entry, NOW + timedelta(seconds=29)) == 300
    assert mm.rating_band(entry, NOW + timedelta(seconds=30)) is None
    assert mm.rating_band(entry, NOW + timedelta(minutes=5)) is None


@pytest.mark.asyncio
async def test_widens_in_counts_down_to_the_next_step_and_to_the_window_end():
    repo = MemoryArenaRepository()
    entry = await mm.join_queue(repo, SkillMode(), "user-a", NOW)
    assert mm.rating_band_widens_in(entry, NOW + timedelta(seconds=3)) == 7.0
    assert mm.rating_band_widens_in(entry, NOW + timedelta(seconds=25)) == 5.0
    assert mm.rating_band_widens_in(entry, NOW + timedelta(seconds=31)) is None


# ---------------------------------------------------------------------------
# Compatibility
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_far_apart_pair_does_not_match_early_but_does_after_widening():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "user-a", mode.mode, 1500.0)
    await _rate(ratings, "user-b", mode.mode, 1750.0)  # 250 apart
    await mm.join_queue(repo, mode, "user-a", NOW)
    b = await mm.join_queue(repo, mode, "user-b", NOW)

    for waited in (0, 9, 15):
        assert await mm.try_match(
            repo, mode, b, {}, NOW + timedelta(seconds=waited), rating_repo=ratings
        ) is None, f"250 apart must not pair at {waited}s"
    assert await repo.get_queue_entry("user-a", mode.mode) is not None

    match = await mm.try_match(repo, mode, b, {}, NOW + timedelta(seconds=21), rating_repo=ratings)
    assert match is not None and match.rated is True
    assert sorted(await _subs(repo, match)) == ["user-a", "user-b"]


@pytest.mark.asyncio
async def test_a_newcomer_can_complete_a_long_waiters_widened_band():
    """The wider of the two bands decides, so the outcome does not depend on
    which client asks first."""
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "user-a", mode.mode, 1500.0)
    await _rate(ratings, "user-b", mode.mode, 1750.0)
    await mm.join_queue(repo, mode, "user-a", NOW)
    late = NOW + timedelta(seconds=21)
    b = await mm.join_queue(repo, mode, "user-b", late)
    assert mm.rating_band(b, late) == 100  # b's own band is still narrow...
    match = await mm.try_match(repo, mode, b, {}, late, rating_repo=ratings)
    assert match is not None  # ...but a's 300 covers the pair.


@pytest.mark.asyncio
async def test_unrated_players_are_matched_at_the_initial_rating():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "rated-near", mode.mode, 1590.0)
    await mm.join_queue(repo, mode, "rated-near", NOW)
    fresh = await mm.join_queue(repo, mode, "unrated", NOW)
    match = await mm.try_match(repo, mode, fresh, {}, NOW, rating_repo=ratings)
    assert match is not None, "an unrated player sits at 1500, 90 from 1590"

    await _rate(ratings, "rated-far", mode.mode, 1650.0)
    await mm.join_queue(repo, mode, "rated-far", NOW)
    fresh2 = await mm.join_queue(repo, mode, "unrated-2", NOW)
    assert await mm.try_match(repo, mode, fresh2, {}, NOW, rating_repo=ratings) is None


@pytest.mark.asyncio
async def test_without_a_rating_repository_nobody_is_excluded():
    """The previous behaviour, preserved for callers that pass no ratings."""
    repo, mode = MemoryArenaRepository(), SkillMode()
    await mm.join_queue(repo, mode, "user-a", NOW)
    b = await mm.join_queue(repo, mode, "user-b", NOW)
    assert await mm.try_match(repo, mode, b, {}, NOW) is not None


# ---------------------------------------------------------------------------
# Preference among compatible humans
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_closest_rated_human_is_preferred_over_the_longest_waiting():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "far", mode.mode, 1590.0)
    await _rate(ratings, "close", mode.mode, 1510.0)
    await _rate(ratings, "anchor", mode.mode, 1500.0)
    await mm.join_queue(repo, mode, "far", NOW)  # waited longest
    await mm.join_queue(repo, mode, "close", NOW + timedelta(seconds=1))
    at = NOW + timedelta(seconds=2)
    anchor = await mm.join_queue(repo, mode, "anchor", at)

    match = await mm.try_match(repo, mode, anchor, {}, at, rating_repo=ratings)
    assert sorted(await _subs(repo, match)) == ["anchor", "close"]
    assert await repo.get_queue_entry("far", mode.mode) is not None


@pytest.mark.asyncio
async def test_equal_distance_is_broken_by_the_longest_wait():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "later", mode.mode, 1550.0)
    await _rate(ratings, "earlier", mode.mode, 1450.0)
    await mm.join_queue(repo, mode, "earlier", NOW)
    await mm.join_queue(repo, mode, "later", NOW + timedelta(seconds=1))
    at = NOW + timedelta(seconds=2)
    anchor = await mm.join_queue(repo, mode, "anchor", at)  # unrated: 1500

    match = await mm.try_match(repo, mode, anchor, {}, at, rating_repo=ratings)
    assert sorted(await _subs(repo, match)) == ["anchor", "earlier"]


@pytest.mark.asyncio
async def test_a_complete_tie_is_broken_by_entry_id_so_the_choice_is_deterministic():
    repo, mode = MemoryArenaRepository(), SkillMode()
    first = await mm.join_queue(repo, mode, "tie-1", NOW)
    second = await mm.join_queue(repo, mode, "tie-2", NOW)
    anchor = await mm.join_queue(repo, mode, "anchor", NOW)
    expected = min((first, second), key=lambda e: e.entry_id).owner_sub

    match = await mm.try_match(repo, mode, anchor, {}, NOW, rating_repo=MemoryArenaRatingRepository())
    assert sorted(await _subs(repo, match)) == sorted(["anchor", expected])


@pytest.mark.asyncio
async def test_a_three_seat_table_takes_the_two_closest_ratings():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillThreeSeat()
    for sub, r in (("r1480", 1480.0), ("r1530", 1530.0), ("r1590", 1590.0), ("anchor", 1500.0)):
        await _rate(ratings, sub, mode.mode, r)
    for i, sub in enumerate(("r1590", "r1530", "r1480")):
        await mm.join_queue(repo, mode, sub, NOW + timedelta(seconds=i))
    at = NOW + timedelta(seconds=4)
    anchor = await mm.join_queue(repo, mode, "anchor", at)

    match = await mm.try_match(repo, mode, anchor, {}, at, rating_repo=ratings)
    assert sorted(await _subs(repo, match)) == ["anchor", "r1480", "r1530"]
    assert (await repo.get_seats(match.match_id))[0].occupant_sub == "anchor"


# ---------------------------------------------------------------------------
# Humans before bots
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_bot_fill_inside_the_window_while_an_out_of_band_human_waits():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    await _rate(ratings, "user-b", mode.mode, 2000.0)
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    await mm.join_queue(repo, mode, "user-b", NOW)
    assert await mm.try_match(repo, mode, a, {}, NOW + timedelta(seconds=25), rating_repo=ratings) is None
    assert await repo.list_matches_for_sub("user-a") == []


@pytest.mark.asyncio
async def test_a_full_human_table_beats_bots_once_the_band_is_unbounded():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    await _rate(ratings, "user-b", mode.mode, 2400.0)  # 900 apart
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    await mm.join_queue(repo, mode, "user-b", NOW)

    match = await mm.try_match(repo, mode, a, {}, NOW + timedelta(seconds=31), rating_repo=ratings)
    seats = await repo.get_seats(match.match_id)
    assert [s.is_bot for s in seats] == [False, False]


@pytest.mark.asyncio
async def test_bots_fill_only_after_the_window_and_the_match_is_rated_and_labelled():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    assert await mm.try_match(repo, mode, a, {}, NOW + timedelta(seconds=29), rating_repo=ratings) is None

    match = await mm.try_match(repo, mode, a, {}, NOW + timedelta(seconds=31), rating_repo=ratings)
    assert match is not None and match.rated is True
    seats = await repo.get_seats(match.match_id)
    assert [s.is_bot for s in seats] == [False, True]
    assert seats[1].bot_rating is not None


@pytest.mark.asyncio
async def test_a_lapsed_three_seat_window_seats_every_waiting_human_before_a_bot():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillThreeSeat()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    await _rate(ratings, "user-b", mode.mode, 2600.0)
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    await mm.join_queue(repo, mode, "user-b", NOW)

    match = await mm.try_match(repo, mode, a, {}, NOW + timedelta(seconds=31), rating_repo=ratings)
    assert [s.is_bot for s in await repo.get_seats(match.match_id)] == [False, False, True]


@pytest.mark.asyncio
async def test_fill_now_is_unchanged_it_still_takes_a_far_human_before_bots():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(mode.mode,))
    await _rate(ratings, "user-b", mode.mode, 2600.0)
    await mm.join_queue(repo, mode, "user-a", NOW)
    await mm.join_queue(repo, mode, "user-b", NOW)

    match = await mm.fill_queue_with_bots_now(
        repo, mode, "user-a", {}, NOW + timedelta(seconds=2), rating_repo=ratings
    )
    assert [s.is_bot for s in await repo.get_seats(match.match_id)] == [False, False]

    await mm.join_queue(repo, mode, "alone", NOW + timedelta(seconds=3))
    solo = await mm.fill_queue_with_bots_now(
        repo, mode, "alone", {}, NOW + timedelta(seconds=4), rating_repo=ratings
    )
    assert solo.rated is True
    assert [s.is_bot for s in await repo.get_seats(solo.match_id)] == [False, True]
    # A second press finds no waiting entry.
    assert await mm.fill_queue_with_bots_now(
        repo, mode, "alone", {}, NOW + timedelta(seconds=5), rating_repo=ratings
    ) is None


@pytest.mark.asyncio
async def test_the_claim_race_still_yields_exactly_one_match_with_ratings():
    repo, ratings, mode = MemoryArenaRepository(), MemoryArenaRatingRepository(), SkillMode()
    await _rate(ratings, "user-a", mode.mode, 1500.0)
    await _rate(ratings, "user-b", mode.mode, 1520.0)
    a = await mm.join_queue(repo, mode, "user-a", NOW)
    b = await mm.join_queue(repo, mode, "user-b", NOW)
    first, second = await asyncio.gather(
        mm.try_match(repo, mode, a, {}, NOW, rating_repo=ratings),
        mm.try_match(repo, mode, b, {}, NOW, rating_repo=ratings),
    )
    assert len([m for m in (first, second) if m is not None]) == 1
