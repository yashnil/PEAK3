"""Arena competitive identity: tiers, percentiles, Top Players, Around You, and
the personal skill card -- plus the queue fields that explain a skill search.

What must never happen, asserted rather than assumed:

  * a bot on a board, or a board row without a public handle;
  * a percentile for a population too small to mean anything, or for a
    provisional player, without a machine-readable reason;
  * a tier name on a provisional rating;
  * a rating shown without the all-human vs with-bots split that says how it
    was earned.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import (
    _memory_arena_rating_repo,
    _memory_arena_repo,
    _memory_profile_repo,
)
from app.main import app
from app.repositories.arena_protocols import (
    MATCH_STATUS_COMPLETED,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    EventDraft,
    ReducerInput,
    ReducerOutput,
    ResultDraft,
    TurnDraft,
)
from app.repositories.arena_rating_protocols import ArenaRatingHistoryEntry
from app.services.arena import bots as bot_service
from app.services.arena import rating as arena_rating
from app.services.arena import skill
from app.services.arena.modes import registry as mode_registry

MODE = "standings_mode"


# ---------------------------------------------------------------------------
# Tier ladder -- ranked's divisions, withheld while provisional
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "rating, expected",
    [
        (1349.99, "Prospect"),
        (1350.0, "Rotation"),
        (1499.99, "Rotation"),
        (1500.0, "Starter"),
        (1649.99, "Starter"),
        (1650.0, "All-Star"),
        (1800.0, "All-NBA"),
        (1950.0, "MVP"),
        (2100.0, "Legend"),
    ],
)
def test_tier_boundaries_follow_the_ranked_ladder(rating, expected):
    assert skill.tier_for(rating, 40, established_players=1000).tier == expected


def test_no_tier_while_provisional_and_one_the_match_it_is_established():
    early = skill.tier_for(1700.0, skill.PROVISIONAL_UNTIL - 1, 1000)
    assert early.tier is None and early.reason == skill.REASON_PROVISIONAL
    assert skill.tier_for(1700.0, skill.PROVISIONAL_UNTIL, 1000).tier == "All-Star"


def test_legend_needs_thirty_matches_like_ranked():
    assert skill.tier_for(2150.0, 29, 1000).tier == "MVP"
    assert skill.tier_for(2150.0, 30, 1000).tier == "Legend"


def test_top_tiers_wait_for_an_established_population_and_say_so():
    capped = skill.tier_for(2150.0, 40, established_players=99)
    assert capped.tier == "All-NBA" and capped.capped is True
    assert capped.next_tier is None  # no "next" while the cap is what binds
    assert skill.tier_for(2150.0, 40, established_players=100).tier == "Legend"


def test_next_tier_names_the_next_rung():
    verdict = skill.tier_for(1520.0, 10, 1000)
    assert (verdict.tier, verdict.next_tier, verdict.next_tier_rating) == ("Starter", "All-Star", 1650.0)
    assert skill.tier_for(2200.0, 40, 1000).next_tier is None


# ---------------------------------------------------------------------------
# Percentile -- only when meaningful
# ---------------------------------------------------------------------------


def test_percentile_is_withheld_below_thirty_rated_players():
    verdict = skill.percentile_for(players_below=20, rated_population=29, rated_matches=40)
    assert verdict.percentile is None
    assert verdict.reason == skill.REASON_POPULATION_TOO_SMALL


def test_percentile_is_never_published_for_a_provisional_player():
    verdict = skill.percentile_for(players_below=900, rated_population=1000, rated_matches=2)
    assert verdict.percentile is None and verdict.reason == skill.REASON_PROVISIONAL


def test_percentile_counts_strictly_lower_ratings():
    assert skill.percentile_for(29, 30, 7).percentile == 96.7
    assert skill.percentile_for(0, 30, 7).percentile == 0.0


# ---------------------------------------------------------------------------
# Route fixtures
# ---------------------------------------------------------------------------


class StandingsMode:
    mode = MODE
    mode_version = "st_v1"
    seat_count = 2
    turn_seconds = 30.0

    def initial_snapshot(self, seed, seats):
        return {"n": 0}

    def initial_phase(self):
        return "play"

    def reduce(self, data: ReducerInput) -> ReducerOutput:
        return ReducerOutput(
            accepted=True,
            snapshot={"n": data.match.snapshot.get("n", 0) + 1},
            events=(EventDraft(event_type="played"),),
            resolve_turn="action",
            open_turn=TurnDraft(
                phase="play", deadline_at=data.now + timedelta(seconds=30), seat_index=0
            ),
        )

    def project(self, match, seats, seat_index):
        return {}, {}, ("play",)


_FLAGS = (
    "ARENA_ENABLED",
    "ARENA_PUBLIC_QUEUE_ENABLED",
    "ARENA_BOTS_ENABLED",
    "ARENA_ALPHA_ALLOWLIST",
    "ARENA_RATINGS_ENABLED",
    "ARENA_LEADERBOARD_ENABLED",
)


@pytest.fixture(autouse=True)
def _arena_standings_enabled():
    saved = {name: getattr(settings, name) for name in _FLAGS}
    settings.ARENA_ENABLED = True
    settings.ARENA_PUBLIC_QUEUE_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    settings.ARENA_RATINGS_ENABLED = True
    settings.ARENA_LEADERBOARD_ENABLED = True
    mode = StandingsMode()
    mode_registry.register(mode)
    bot_service.registry.register(bot_service.RandomLegalBot(), for_modes=(MODE,))
    yield
    app.dependency_overrides.clear()
    mode_registry._modes.pop(MODE, None)
    bot_service.registry.clear()
    for name, value in saved.items():
        setattr(settings, name, value)


def _client_as(sub: str, *, anonymous: bool = False) -> TestClient:
    subject = AuthSubject(sub=sub, email=f"{sub}@test.com", is_anonymous=anonymous, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    return TestClient(app)


def _public() -> TestClient:
    app.dependency_overrides.clear()
    return TestClient(app)


def _rate(sub: str, rating: float, matches: int = skill.PROVISIONAL_UNTIL, handle: str | None = None) -> None:
    """Give `sub` a rating built from `matches` rated matches, through the
    rating repository's own write path -- never a hand-built board row."""

    async def go():
        for _ in range(matches):
            await _memory_arena_rating_repo.record_match_rating(
                [
                    ArenaRatingHistoryEntry(
                        owner_sub=sub, mode=MODE, match_id=str(uuid.uuid4()),
                        pre_rating=1500.0, pre_rd=350.0, pre_volatility=0.06,
                        post_rating=rating, post_rd=60.0, post_volatility=0.06,
                        unbounded_post_rating=rating, bound_applied=False, placement=1,
                        had_bot_opponent=False, algorithm_version="test",
                    )
                ]
            )
        if handle:
            await _memory_profile_repo.update_profile(sub, {"handle": handle})

    asyncio.run(go())


def _board(**params) -> dict:
    response = _public().get(f"/api/v1/arena/leaderboard/{MODE}", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _around(sub: str, **params) -> dict:
    response = _client_as(sub).get(f"/api/v1/arena/leaderboard/{MODE}/around-me", params=params)
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Top Players
# ---------------------------------------------------------------------------


def test_top_players_lists_handle_holders_with_global_rank_tier_and_totals():
    _rate("sub-a", 1700.0, handle="alpha")
    _rate("sub-b", 1650.0)  # rated, no handle: counted, never listed
    _rate("sub-c", 1600.0, matches=3, handle="charlie")  # provisional

    body = _board()
    assert [e["handle"] for e in body["entries"]] == ["alpha", "charlie"]
    assert [e["rank"] for e in body["entries"]] == [1, 3]
    assert [e["tier"] for e in body["entries"]] == ["All-Star", None]
    assert [e["provisional"] for e in body["entries"]] == [False, True]
    assert body["total_rated_players"] == 2
    assert body["population"] == {
        "total_rated_players": 2,
        "rated_population": 3,
        "established_players": 2,
        "percentile_min_population": 30,
        "provisional_until": 7,
    }
    assert [t["label"] for t in body["tier_ladder"]][0] == "Prospect"
    assert body["tier_version"].startswith("arena_tier_v1+")
    assert all("owner_sub" not in e for e in body["entries"])


def test_top_players_breaks_rating_ties_by_more_rated_matches():
    _rate("sub-x", 1500.0, matches=9, handle="xray")
    _rate("sub-y", 1500.0, matches=12, handle="yankee")
    assert [e["handle"] for e in _board()["entries"]] == ["yankee", "xray"]


def test_top_players_pages_over_listed_rows():
    _rate("sub-1", 1900.0, handle="one")
    _rate("sub-2", 1850.0)
    _rate("sub-3", 1800.0, handle="three")
    _rate("sub-4", 1750.0, handle="four")
    page = _board(limit=1, offset=1)
    assert [(e["handle"], e["rank"]) for e in page["entries"]] == [("three", 3)]
    assert page["limit"] == 1 and page["offset"] == 1 and page["total_rated_players"] == 3


def test_an_empty_board_is_honest_about_being_empty():
    body = _board()
    assert body["leaderboard_enabled"] is True
    assert body["entries"] == []
    assert body["population"]["rated_population"] == 0


def test_a_closed_board_answers_rather_than_errors():
    settings.ARENA_LEADERBOARD_ENABLED = False
    assert _board() == {**_board(), "leaderboard_enabled": False, "entries": []}
    body = _around("sub-anyone")
    assert body["leaderboard_enabled"] is False and body["me"] is None


def test_an_unknown_mode_is_a_404():
    assert _public().get("/api/v1/arena/leaderboard/not_a_mode").status_code == 404
    assert _client_as("sub-z").get("/api/v1/arena/leaderboard/not_a_mode/around-me").status_code == 404


# ---------------------------------------------------------------------------
# Bots: never listed, always disclosed
# ---------------------------------------------------------------------------


def _settle_bot_filled_public_match(human_sub: str, human_wins: bool) -> None:
    """A real public match: one human seat, one bot seat with a pinned rating,
    completed through `apply_command` and settled by the real rating pass."""

    async def go():
        match = ArenaMatch(
            match_id=str(uuid.uuid4()), mode=MODE, mode_version="st_v1",
            model_version="peak3_v1", seat_count=2, entry_path="public_queue",
            rated=True, seed=7, created_by=human_sub,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=2),
            bot_policy_version="random_legal_v1",
        )
        seats = [
            ArenaSeat(match_id=match.match_id, seat_index=0, occupant_kind="human",
                      occupant_sub=human_sub, display_name="Human"),
            ArenaSeat(match_id=match.match_id, seat_index=1, occupant_kind="bot",
                      bot_id="random_legal", bot_rating=1400.0, display_name="Bot Name"),
        ]
        await _memory_arena_repo.create_match(match, seats)

        def finish(_data):
            return ReducerOutput(
                accepted=True, status=MATCH_STATUS_COMPLETED,
                results=(
                    ResultDraft(seat_index=0, placement=1 if human_wins else 2, score=10.0,
                                outcome="win" if human_wins else "loss"),
                    ResultDraft(seat_index=1, placement=2 if human_wins else 1, score=5.0,
                                outcome="loss" if human_wins else "win"),
                ),
            )

        now = datetime.now(timezone.utc)
        await _memory_arena_repo.apply_command(
            CommandRequest(match_id=match.match_id, idempotency_key=f"finish-{match.match_id}",
                           command_type="__finish__", actor_sub=None,
                           expected_state_version=None, issued_at=now),
            finish, now,
        )
        settled = await _memory_arena_repo.get_match(match.match_id)
        written = await arena_rating.settle_match_rating(
            _memory_arena_repo, _memory_arena_rating_repo, settled, now
        )
        assert written == 1  # the human only; a bot is rated against, never rated

    asyncio.run(go())


def test_a_bot_filled_rated_match_lists_the_human_only_and_discloses_the_bot():
    asyncio.run(_memory_profile_repo.update_profile("sub-human", {"handle": "human"}))
    _settle_bot_filled_public_match("sub-human", human_wins=True)

    body = _board()
    assert [e["handle"] for e in body["entries"]] == ["human"]
    assert body["population"]["rated_population"] == 1
    row = body["entries"][0]
    assert (row["wins"], row["matches_with_bots"], row["matches_all_human"]) == (1, 1, 0)
    assert "Bot Name" not in str(body)

    me = _around("sub-human")["me"]
    assert (me["matches_with_bots"], me["matches_all_human"]) == (1, 0)


# ---------------------------------------------------------------------------
# Around You
# ---------------------------------------------------------------------------


def _ladder() -> None:
    """2000 down to 1400 in steps of 100, all listed, plus an unlisted 1850."""
    for i, rating in enumerate(range(2000, 1300, -100)):
        _rate(f"sub-{rating}", float(rating), handle=f"p{rating}")
    _rate("sub-unlisted", 1850.0)


def test_around_me_at_the_top_of_the_board():
    _ladder()
    body = _around("sub-2000", window=2)
    assert body["status"] == "listed"
    assert body["me"]["rank"] == 1
    assert body["above"] == []
    assert [e["handle"] for e in body["below"]] == ["p1900", "p1800"]
    assert [e["rank"] for e in body["below"]] == [2, 4]  # the unlisted 1850 is rank 3


def test_around_me_in_the_middle_skips_an_unlisted_neighbour():
    _ladder()
    body = _around("sub-1800", window=2)
    assert body["me"]["rank"] == 4
    assert [e["handle"] for e in body["above"]] == ["p2000", "p1900"]
    assert [e["handle"] for e in body["below"]] == ["p1700", "p1600"]
    assert body["total_rated_players"] == 7 and body["population"]["rated_population"] == 8


def test_around_me_at_the_bottom_of_the_board():
    _ladder()
    body = _around("sub-1400", window=3)
    assert body["me"]["rank"] == 8
    assert [e["handle"] for e in body["above"]] == ["p1700", "p1600", "p1500"]
    assert body["below"] == []


def test_around_me_for_a_caller_with_no_rating_is_an_honest_not_rated():
    _ladder()
    body = _around("sub-never-played")
    assert body["status"] == "not_rated"
    me = body["me"]
    assert me["rated"] is False and me["rating"] is None and me["rank"] is None
    assert me["tier_reason"] == me["rank_reason"] == me["percentile_reason"] == "not_rated"
    assert body["above"] == [] and body["below"] == []
    assert body["population"]["rated_population"] == 8


def test_around_me_for_a_handleless_caller_is_ranked_but_unlisted():
    _ladder()
    body = _around("sub-unlisted", window=1)
    assert body["status"] == "unlisted"
    assert body["me"]["listed"] is False and body["me"]["handle"] is None
    assert body["me"]["rank"] == 3
    assert [e["handle"] for e in body["above"]] == ["p1900"]
    assert [e["handle"] for e in body["below"]] == ["p1800"]


def test_around_me_needs_an_account():
    response = _client_as("sub-anon", anonymous=True).get(
        f"/api/v1/arena/leaderboard/{MODE}/around-me"
    )
    assert response.status_code == 403


def test_a_low_population_withholds_the_percentile_with_a_reason():
    _ladder()
    me = _around("sub-1700")["me"]
    assert me["percentile"] is None
    assert me["percentile_reason"] == "population_too_small"
    assert me["tier"] == "All-Star" and me["provisional"] is False


def test_at_thirty_rated_players_an_established_caller_gets_a_percentile():
    for i in range(29):
        _rate(f"sub-pop-{i:02d}", 1000.0 + 10 * i, handle=f"pop{i:02d}")
    _rate("sub-me", 1205.0, handle="me")  # 21 of the others (1000..1200) are below
    me = _around("sub-me")["me"]
    assert me["population"]["rated_population"] == 30
    assert me["percentile"] == round(100 * 21 / 30, 1)
    assert me["percentile_reason"] is None


def test_at_thirty_rated_players_a_provisional_caller_still_gets_no_percentile():
    for i in range(29):
        _rate(f"sub-pop-{i:02d}", 1000.0 + 10 * i, handle=f"pop{i:02d}")
    _rate("sub-new", 1205.0, matches=2, handle="newbie")
    me = _around("sub-new")["me"]
    assert me["percentile"] is None and me["percentile_reason"] == "provisional"
    assert me["tier"] is None and me["tier_reason"] == "provisional"
    assert me["matches_until_established"] == skill.PROVISIONAL_UNTIL - 2


# ---------------------------------------------------------------------------
# Personal skill card on /modes/{mode}/me
# ---------------------------------------------------------------------------


def test_the_personal_record_carries_the_skill_card():
    _ladder()
    body = _client_as("sub-1600").get(f"/api/v1/arena/modes/{MODE}/me").json()
    card = body["skill"]
    assert card["rated"] is True and card["rating"] == 1600.0
    assert card["tier"] == "Starter" and card["rank"] == 6 and card["listed"] is True
    assert card["next_tier"] == "All-Star" and card["next_tier_rating"] == 1650.0
    assert card["percentile_reason"] == "population_too_small"
    assert {"wins", "losses", "draws", "matches_with_bots", "matches_all_human"} <= card.keys()
    assert body["unrated_matches"] == 0 and body["practice_matches"] == 0


def test_the_skill_card_says_why_when_ratings_or_the_board_are_off():
    _ladder()
    settings.ARENA_LEADERBOARD_ENABLED = False
    card = _client_as("sub-1600").get(f"/api/v1/arena/modes/{MODE}/me").json()["skill"]
    assert card["rating"] == 1600.0 and card["rank"] is None
    assert card["rank_reason"] == card["percentile_reason"] == "leaderboard_disabled"

    settings.ARENA_RATINGS_ENABLED = False
    card = _client_as("sub-1600").get(f"/api/v1/arena/modes/{MODE}/me").json()["skill"]
    assert card["rated"] is False and card["rating"] is None
    assert card["tier_reason"] == "ratings_disabled"


# ---------------------------------------------------------------------------
# Queue status explains the skill search
# ---------------------------------------------------------------------------


def test_queue_status_exposes_wait_band_and_human_search():
    client = _client_as("sub-queuer")
    joined = client.post(f"/api/v1/arena/queue/{MODE}/join").json()
    assert joined["status"] == "waiting"
    assert joined["rating_band"] == 100
    assert joined["still_seeking_humans"] is True
    assert 0 < joined["rating_band_widens_in_seconds"] <= 10

    polled = client.get(f"/api/v1/arena/queue/{MODE}/status").json()
    assert polled["status"] == "waiting"
    assert polled["rating_band"] in (100, 200)
    assert polled["waited_seconds"] >= 0


def test_two_close_players_are_paired_through_the_routes():
    _rate("sub-q1", 1500.0)
    _rate("sub-q2", 1540.0)
    assert _client_as("sub-q1").post(f"/api/v1/arena/queue/{MODE}/join").json()["status"] == "waiting"
    second = _client_as("sub-q2").post(f"/api/v1/arena/queue/{MODE}/join").json()
    assert second["status"] == "matched" and second["rating_band"] is None


def test_two_distant_players_are_not_paired_on_join():
    _rate("sub-q1", 1500.0)
    _rate("sub-q2", 1900.0)
    _client_as("sub-q1").post(f"/api/v1/arena/queue/{MODE}/join")
    second = _client_as("sub-q2").post(f"/api/v1/arena/queue/{MODE}/join").json()
    assert second["status"] == "waiting"
