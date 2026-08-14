"""The centralized bot name pool, and the guarantee it exists to make.

BEFORE THIS POOL, a mode with no naming opinion of its own showed "PEAK3 Bot"
(and, past two bot seats, "PEAK3 Bot 1" / "PEAK3 Bot 2") to every player. That
was a generic, numbered, implementation-flavoured label sitting next to a mode
like Three-Man Weave's real basketball archetypes, and it is exactly what
`bots.BOT_NAME_POOL` / `bots.curated_bot_names` replace: every mode that does
not supply its own `bot_display_names` hook now draws seeded, memorable,
basketball-adjacent handles from one shared pool instead.

This file tests the pool and the naming functions directly (`curated_bot_names`,
`bot_seat_names`) rather than through a live match, so the property is checked
against the seam the rest of the arena already trusts -- `test_arena_practice_e2e
.py::test_no_seat_name_leaks_an_implementation_label` covers the same guarantee
end to end, through real HTTP routes.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pytest

from app.repositories.arena_memory import MemoryArenaRepository
from app.services.arena import bots as bot_service
from app.services.arena import matchmaking as mm
from app.services.three_man_weave.mode import mode as tmw_mode
from app.services.twenty_dollar.mode import mode as td_mode

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)

#: A numbered generic placeholder, in either form the old code produced
#: ("PEAK3 Bot" alone, or "PEAK3 Bot 1" / "PEAK3 Bot 2" past two seats).
_GENERIC_PLACEHOLDER = re.compile(r"^PEAK3 Bot(\s\d+)?$")


class _NoOpinionMode:
    """A minimal stand-in for a mode with no `bot_display_names` hook.

    `bot_seat_names` reads `mode` with `getattr`, so a mode is anything with
    the right shape -- this is deliberately not a full `ArenaMode`.
    """

    mode = "no_opinion_test_mode"
    seat_count = 4


# ---------------------------------------------------------------------------
# `curated_bot_names` on its own
# ---------------------------------------------------------------------------


def test_curated_bot_names_is_deterministic():
    for seed in (0, 1, 42, 2**30, 987654321):
        for count in (1, 2, 3, len(bot_service.BOT_NAME_POOL)):
            first = bot_service.curated_bot_names(seed, count)
            second = bot_service.curated_bot_names(seed, count)
            assert first == second, f"seed {seed} count {count} was not stable"


def test_curated_bot_names_differ_across_seeds():
    # Not a hard guarantee for any two arbitrary seeds (a shuffle can collide),
    # but true across sixteen consecutive seeds for a pool this size, and a
    # regression that hardcoded the pool's own order back in would fail it.
    draws = {bot_service.curated_bot_names(seed, 3) for seed in range(16)}
    assert len(draws) > 1


def test_curated_bot_names_are_distinct_within_one_draw():
    for seed in range(25):
        names = bot_service.curated_bot_names(seed, len(bot_service.BOT_NAME_POOL))
        assert len(set(names)) == len(names)


def test_curated_bot_names_never_the_generic_placeholder():
    for seed in range(50):
        for count in (1, 2, 3):
            for name in bot_service.curated_bot_names(seed, count):
                assert not _GENERIC_PLACEHOLDER.match(name), name
                assert name != bot_service.BOT_DISPLAY_NAME


def test_bot_name_pool_has_no_real_player_looking_entries():
    # A loose guard, not a name-by-name registry lookup: every pool entry
    # should read as a handle a person chose for themselves, not a person's
    # own name -- no entry is exactly two capitalized words separated by a
    # space (the shape "First Last" takes), which is the cheapest signal that
    # a real player's name slipped in. "The Architect"-shaped entries (an
    # article plus a noun) are the pool's one intentional two-word form and
    # are excluded from the check rather than the pool.
    two_word_name = re.compile(r"^[A-Z][a-z]+ [A-Z][a-z]+$")
    for name in bot_service.BOT_NAME_POOL:
        if name.startswith("The "):
            continue
        assert not two_word_name.match(name), name


def test_bot_name_pool_has_room_for_every_mode_shipped_today():
    # The largest bot-seat count any mode seats today is Three-Man Weave's
    # practice draft (one human, two bots); The $20 Showdown seats at most
    # one. The pool is sized well past either.
    assert len(bot_service.BOT_NAME_POOL) >= 20
    assert len(set(bot_service.BOT_NAME_POOL)) == len(bot_service.BOT_NAME_POOL)


# ---------------------------------------------------------------------------
# `bot_seat_names`: the default a mode with no opinion gets
# ---------------------------------------------------------------------------


def test_bot_seat_names_default_draws_from_the_curated_pool():
    mode = _NoOpinionMode()
    names = bot_service.bot_seat_names(mode, seed=777, seat_indexes=[1, 2, 3])
    assert set(names.keys()) == {1, 2, 3}
    for name in names.values():
        assert name in bot_service.BOT_NAME_POOL
    assert len(set(names.values())) == 3  # distinct within the match


def test_bot_seat_names_default_is_deterministic_per_seed():
    mode = _NoOpinionMode()
    first = bot_service.bot_seat_names(mode, seed=555, seat_indexes=[0, 2])
    second = bot_service.bot_seat_names(mode, seed=555, seat_indexes=[0, 2])
    assert first == second


def test_bot_seat_names_empty_input_is_empty_output():
    mode = _NoOpinionMode()
    assert bot_service.bot_seat_names(mode, seed=1, seat_indexes=[]) == {}


# ---------------------------------------------------------------------------
# Every shipped mode with bot seats, swept across seeds
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mode, seat_indexes",
    [
        (td_mode, [1]),  # The $20 Showdown: at most one bot seat
        (tmw_mode, [1, 2]),  # Three-Man Weave practice: at most two bot seats
    ],
)
def test_no_shipped_mode_ever_produces_a_generic_placeholder_name(mode, seat_indexes):
    for seed in range(60):
        names = bot_service.bot_seat_names(mode, seed, seat_indexes)
        assert set(names.keys()) == set(seat_indexes)
        for name in names.values():
            assert name, "a bot seat must never have an empty name"
            assert not _GENERIC_PLACEHOLDER.match(name), (mode.mode, seed, name)
            assert name != bot_service.BOT_DISPLAY_NAME
        # Distinct within the match, for every seed swept.
        assert len(set(names.values())) == len(seat_indexes)


@pytest.mark.parametrize("mode, seat_indexes", [(td_mode, [1]), (tmw_mode, [1, 2])])
def test_bot_seat_names_is_deterministic_for_every_shipped_mode(mode, seat_indexes):
    for seed in (0, 1, 2, 4242, 999999):
        first = bot_service.bot_seat_names(mode, seed, seat_indexes)
        second = bot_service.bot_seat_names(mode, seed, seat_indexes)
        assert first == second, f"{mode.mode} seed {seed} was not stable"


def test_three_man_weave_keeps_its_own_archetype_scheme():
    # Documents the deliberate choice: Three-Man Weave's board is otherwise
    # full of real retired players' names, so it supplies its own archetypes
    # (`bot_display_names`) rather than drawing from the shared username-style
    # pool. This asserts the hook is actually wired, not merely present.
    names = bot_service.bot_seat_names(tmw_mode, seed=8, seat_indexes=[1, 2])
    from nba_peak.three_man_weave.bot import BOT_ARCHETYPE_NAMES

    for name in names.values():
        assert name in BOT_ARCHETYPE_NAMES


# ---------------------------------------------------------------------------
# `fill_private_room_with_bots`: the one seating path that used to build
# seats one at a time, outside `bot_seat_names`, and so fell back to the
# generic label instead of a curated name.
# ---------------------------------------------------------------------------


class _ThreeSeatNoOpinionMode:
    """A three-seat mode with no naming hook -- exercises the curated-pool
    default on a room where more than one bot seat needs a distinct name."""

    mode = "bot_naming_three_seat_test_mode"
    mode_version = "v1"
    seat_count = 3
    turn_seconds = 30.0

    def initial_snapshot(self, seed: int, seats) -> dict:
        return {"turn": 0}

    def initial_phase(self) -> str:
        return "play"

    def reduce(self, data):  # pragma: no cover - not exercised by this test
        raise NotImplementedError

    def project(self, match, seats, seat_index):  # pragma: no cover
        return {}, {}, ()


@pytest.fixture
def _registered_fallback_bot():
    bot_service.registry.clear()
    bot_service.registry.register(
        bot_service.RandomLegalBot(), for_modes=(_ThreeSeatNoOpinionMode.mode,)
    )
    yield
    bot_service.registry.clear()


@pytest.mark.asyncio
async def test_host_fill_names_every_bot_seat_from_the_curated_pool(_registered_fallback_bot):
    """`fill_private_room_with_bots` seats bots one at a time (a human joining
    mid-fill must win the race), but the NAMES must still come from one
    whole-match draw so two bot seats in the same room cannot collide -- and
    must never be the generic emergency-fallback label.
    """
    mode = _ThreeSeatNoOpinionMode()
    for _ in range(10):
        repo = MemoryArenaRepository()
        room = await mm.create_private_room(repo, mode, "host", "Host", NOW)
        filled = await mm.fill_private_room_with_bots(repo, mode, room, "host", NOW)
        bot_names = [s.display_name for s in await repo.get_seats(filled.match_id) if s.is_bot]
        assert len(bot_names) == 2
        for name in bot_names:
            assert name in bot_service.BOT_NAME_POOL
            assert name != bot_service.BOT_DISPLAY_NAME
        assert len(set(bot_names)) == len(bot_names)
