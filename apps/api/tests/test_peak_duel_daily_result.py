"""POST /game/daily/result — the official Peak Duel Daily attempt record.

Of the five daily modes, Peak Duel Daily was the only one with no server-side
attempt record at all: `GET /game/daily` is stateless and the result lived
exclusively in localStorage. So "one attempt per day" was a convention the
client agreed to rather than a rule, and a guest's daily history could not be
claimed on sign-in because there was nothing to claim.

These tests guard the three properties that make the record worth having:
the server scores it, the day is the server's, and a second submission cannot
replace the first.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

DAILY_URL = "/api/v1/game/daily"
RESULT_URL = "/api/v1/game/daily/result"
ANSWER_URL = "/api/v1/game/answer"
DISTRIBUTION_URL = "/api/v1/game/daily/distribution"
HISTORY_URL = "/api/v1/game/daily/history"


@pytest.fixture
def player() -> TestClient:
    """A caller with its own cookie jar — i.e. its own anonymous identity."""
    with TestClient(app) as c:
        yield c


def _start_daily(client: TestClient, years: int = 3) -> dict:
    resp = client.get(DAILY_URL, params={"years": years})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _winning_selections(client: TestClient, board: dict) -> dict[str, str]:
    """Play the board perfectly, using the API's own reveal as the oracle.

    Deriving the right answers from `/game/answer` rather than from the
    dataset keeps this test honest about what a client can actually observe,
    and means it cannot pass by reimplementing the scoring rule it is checking.
    """
    selections: dict[str, str] = {}
    for duel in board["duels"]:
        first = duel["left"]["peak_id"]
        reveal = client.post(
            ANSWER_URL,
            json={
                "session_token": board["session_token"],
                "duel_id": duel["id"],
                "selected_peak_id": first,
                # Required by /game/answer's contract; presentational only and
                # irrelevant to which peak actually won.
                "elapsed_ms": 1200,
                "current_streak": 0,
            },
        )
        assert reveal.status_code == 200, reveal.text
        selections[duel["id"]] = reveal.json()["winning_peak_id"]
    return selections


class TestServerSideScoring:
    def test_a_perfect_board_is_scored_by_the_server(self, player: TestClient):
        board = _start_daily(player)
        selections = _winning_selections(player, board)

        resp = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": selections},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["saved"] is True
        assert body["already_recorded"] is False
        assert body["duels_total"] == board["duel_count"]
        assert body["correct_count"] == board["duel_count"]
        assert body["best_streak"] == board["duel_count"]
        assert body["arena_points"] > 0
        assert body["daily_key"] == board["daily"]["daily_key"]
        assert body["played_on_daily_key"] is True

    def test_the_client_cannot_submit_its_own_score(self, player: TestClient):
        """A submitted score is ignored; only the selections are read."""
        board = _start_daily(player)

        resp = player.post(
            RESULT_URL,
            json={
                "session_token": board["session_token"],
                "selections": {},
                # Fields a hopeful client might invent. The request model
                # ignores them; the response must reflect the empty board.
                "correct_count": 10,
                "arena_points": 999_999,
            },
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["correct_count"] == 0
        assert body["arena_points"] == 0
        assert body["best_streak"] == 0

    def test_an_unanswered_duel_counts_as_wrong_not_absent(self, player: TestClient):
        """A partial run must not be indistinguishable from a perfect one."""
        board = _start_daily(player)
        selections = _winning_selections(player, board)
        first_id = board["duels"][0]["id"]
        del selections[first_id]

        body = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": selections},
        ).json()

        assert body["duels_total"] == board["duel_count"]
        assert body["correct_count"] == board["duel_count"] - 1

    def test_a_wrong_pick_breaks_the_streak_without_shortening_the_board(
        self, player: TestClient
    ):
        board = _start_daily(player)
        selections = _winning_selections(player, board)
        duels = board["duels"]
        assert len(duels) >= 3, "this assertion needs a board of at least three duels"

        # Miss the middle duel by picking whichever side did not win.
        middle = duels[len(duels) // 2]
        winner = selections[middle["id"]]
        loser = (
            middle["right"]["peak_id"]
            if winner == middle["left"]["peak_id"]
            else middle["left"]["peak_id"]
        )
        selections[middle["id"]] = loser

        body = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": selections},
        ).json()

        assert body["duels_total"] == len(duels)
        assert body["correct_count"] == len(duels) - 1
        assert body["best_streak"] < len(duels)


class TestOneAttemptPerDay:
    def test_a_second_submission_returns_the_first_attempt(self, player: TestClient):
        board = _start_daily(player)
        perfect = _winning_selections(player, board)

        first = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": perfect},
        ).json()
        assert first["already_recorded"] is False
        assert first["correct_count"] == board["duel_count"]

        # Resubmit with a deliberately worse board. The stored attempt must not
        # move — otherwise a player could resubmit until they liked the number,
        # and equally a retry after a dropped connection must not be an error.
        second = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": {}},
        ).json()

        assert second["already_recorded"] is True
        assert second["correct_count"] == first["correct_count"]
        assert second["arena_points"] == first["arena_points"]

    def test_two_browsers_are_two_attempts(self, player: TestClient):
        """Uniqueness is per identity, not global."""
        board = _start_daily(player)
        assert (
            player.post(
                RESULT_URL,
                json={"session_token": board["session_token"], "selections": {}},
            ).json()["already_recorded"]
            is False
        )

        with TestClient(app) as other:
            other_board = _start_daily(other)
            body = other.post(
                RESULT_URL,
                json={"session_token": other_board["session_token"], "selections": {}},
            ).json()

        assert body["already_recorded"] is False


class TestTokenAndDayIntegrity:
    def test_an_endless_session_cannot_be_recorded_as_a_daily(self, player: TestClient):
        """Endless has no daily key and no one-attempt rule."""
        endless = player.get("/api/v1/game/endless", params={"years": 3, "count": 5})
        assert endless.status_code == 200, endless.text

        resp = player.post(
            RESULT_URL,
            json={"session_token": endless.json()["session_token"], "selections": {}},
        )

        assert resp.status_code == 400
        assert "not a daily session" in resp.json()["detail"]

    @pytest.mark.parametrize(
        "token",
        ["", "not-a-token", "aaaa.bbbb", "eyJhIjoxfQ.deadbeef"],
    )
    def test_an_unsigned_or_tampered_token_is_refused(self, player: TestClient, token: str):
        resp = player.post(RESULT_URL, json={"session_token": token, "selections": {}})
        assert resp.status_code == 400

    def test_the_recorded_day_comes_from_the_token_not_the_client(
        self, player: TestClient
    ):
        """There is no field a client can set to choose the day it played."""
        board = _start_daily(player)

        body = player.post(
            RESULT_URL,
            json={
                "session_token": board["session_token"],
                "selections": {},
                # Ignored: the day is whatever the signed token says.
                "daily_key": "1999-01-01",
                "date": "1999-01-01",
            },
        ).json()

        assert body["daily_key"] == board["daily"]["daily_key"]


class TestArchiveReplay:
    def test_an_archive_board_is_recorded_but_not_as_a_live_attempt(
        self, player: TestClient
    ):
        """Recorded honestly rather than rejected — it is a real thing the
        player did, it is simply not a live attempt at today's daily."""
        from nba_peak.daily_key import daily_key, parse_daily_key
        from datetime import timedelta

        yesterday = (parse_daily_key(daily_key()) - timedelta(days=1)).strftime("%Y-%m-%d")
        board = player.get(DAILY_URL, params={"years": 3, "date": yesterday}).json()
        assert board["daily"]["daily_key"] == yesterday

        body = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": {}},
        ).json()

        assert body["daily_key"] == yesterday
        assert body["played_on_daily_key"] is False

    def test_an_archive_attempt_does_not_consume_todays(self, player: TestClient):
        from nba_peak.daily_key import daily_key, parse_daily_key
        from datetime import timedelta

        yesterday = (parse_daily_key(daily_key()) - timedelta(days=1)).strftime("%Y-%m-%d")
        archive = player.get(DAILY_URL, params={"years": 3, "date": yesterday}).json()
        player.post(
            RESULT_URL,
            json={"session_token": archive["session_token"], "selections": {}},
        )

        today = _start_daily(player)
        body = player.post(
            RESULT_URL,
            json={"session_token": today["session_token"], "selections": {}},
        ).json()

        assert body["already_recorded"] is False
        assert body["played_on_daily_key"] is True


class TestLifetimeDistribution:
    """GET /game/daily/distribution — the real 0/10..10/10 histogram.

    Built entirely from `PeakDuelDailyResultRepository` rows this same test
    file already proves are server-scored and idempotent; these tests only
    check the read/aggregation path is honest about what it counts.
    """

    def test_a_fresh_identity_has_an_all_zero_distribution(self, player: TestClient):
        body = player.get(DISTRIBUTION_URL).json()
        assert body["total"] == 0
        assert body["counts"] == [0] * 11

    def test_one_perfect_attempt_lands_in_bucket_ten(self, player: TestClient):
        board = _start_daily(player)
        perfect = _winning_selections(player, board)
        player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": perfect},
        )

        body = player.get(DISTRIBUTION_URL).json()
        assert body["total"] == 1
        assert body["counts"][10] == 1
        assert sum(body["counts"]) == 1

    def test_multiple_archive_days_each_count_once(self, player: TestClient):
        from datetime import timedelta

        from nba_peak.daily_key import daily_key, parse_daily_key

        today_board = _start_daily(player)
        player.post(
            RESULT_URL,
            json={"session_token": today_board["session_token"], "selections": {}},
        )  # 0/10

        yesterday = (parse_daily_key(daily_key()) - timedelta(days=1)).strftime("%Y-%m-%d")
        archive_board = player.get(DAILY_URL, params={"years": 3, "date": yesterday}).json()
        perfect = _winning_selections(player, archive_board)
        player.post(
            RESULT_URL,
            json={"session_token": archive_board["session_token"], "selections": perfect},
        )  # 10/10

        body = player.get(DISTRIBUTION_URL).json()
        assert body["total"] == 2
        assert body["counts"][0] == 1
        assert body["counts"][10] == 1

    def test_resubmitting_the_same_day_does_not_double_count(self, player: TestClient):
        """Idempotent at the write path, so the histogram cannot see a
        retried submission as a second attempt."""
        board = _start_daily(player)
        player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": {}},
        )
        player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": {}},
        )

        body = player.get(DISTRIBUTION_URL).json()
        assert body["total"] == 1

    def test_two_identities_have_independent_distributions(self, player: TestClient):
        board = _start_daily(player)
        perfect = _winning_selections(player, board)
        player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": perfect},
        )

        with TestClient(app) as other:
            body = other.get(DISTRIBUTION_URL).json()
            assert body["total"] == 0

        assert player.get(DISTRIBUTION_URL).json()["total"] == 1


class TestDailyHistory:
    """GET /game/daily/history — the dated rows a result-history grid needs.

    Same underlying `PeakDuelDailyResultRepository` rows `TestLifetimeDistribution`
    already proves are server-scored and idempotent; these tests check that the
    per-day list is honest about which days it names and never double-lists a
    resubmitted day.
    """

    def test_a_fresh_identity_has_no_history(self, player: TestClient):
        body = player.get(HISTORY_URL).json()
        assert body["entries"] == []

    def test_one_attempt_appears_as_one_dated_row(self, player: TestClient):
        board = _start_daily(player)
        perfect = _winning_selections(player, board)
        result = player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": perfect},
        ).json()

        body = player.get(HISTORY_URL).json()
        assert len(body["entries"]) == 1
        entry = body["entries"][0]
        assert entry["daily_key"] == result["daily_key"]
        assert entry["correct_count"] == 10
        assert entry["duels_total"] == 10
        assert entry["played_on_daily_key"] is True

    def test_resubmitting_the_same_day_does_not_duplicate_the_row(self, player: TestClient):
        board = _start_daily(player)
        payload = {"session_token": board["session_token"], "selections": {}}
        player.post(RESULT_URL, json=payload)
        player.post(RESULT_URL, json=payload)

        body = player.get(HISTORY_URL).json()
        assert len(body["entries"]) == 1

    def test_an_archive_replay_is_listed_but_flagged_as_not_on_its_daily_key(
        self, player: TestClient
    ):
        from datetime import timedelta

        from nba_peak.daily_key import daily_key, parse_daily_key

        yesterday = (parse_daily_key(daily_key()) - timedelta(days=1)).strftime("%Y-%m-%d")
        archive_board = player.get(DAILY_URL, params={"years": 3, "date": yesterday}).json()
        player.post(
            RESULT_URL,
            json={"session_token": archive_board["session_token"], "selections": {}},
        )

        body = player.get(HISTORY_URL).json()
        assert len(body["entries"]) == 1
        assert body["entries"][0]["daily_key"] == yesterday
        assert body["entries"][0]["played_on_daily_key"] is False

    def test_multiple_days_come_back_most_recent_first(self, player: TestClient):
        from datetime import timedelta

        from nba_peak.daily_key import daily_key, parse_daily_key

        yesterday = (parse_daily_key(daily_key()) - timedelta(days=1)).strftime("%Y-%m-%d")
        archive_board = player.get(DAILY_URL, params={"years": 3, "date": yesterday}).json()
        player.post(
            RESULT_URL,
            json={"session_token": archive_board["session_token"], "selections": {}},
        )

        today_board = _start_daily(player)
        player.post(
            RESULT_URL,
            json={"session_token": today_board["session_token"], "selections": {}},
        )

        body = player.get(HISTORY_URL).json()
        assert len(body["entries"]) == 2
        keys = [e["daily_key"] for e in body["entries"]]
        assert keys == sorted(keys, reverse=True)

    def test_two_identities_have_independent_histories(self, player: TestClient):
        board = _start_daily(player)
        player.post(
            RESULT_URL,
            json={"session_token": board["session_token"], "selections": {}},
        )

        with TestClient(app) as other:
            body = other.get(HISTORY_URL).json()
            assert body["entries"] == []

        assert len(player.get(HISTORY_URL).json()["entries"]) == 1


class TestRateLimiting:
    def test_the_submission_endpoint_is_metered(self, player: TestClient, monkeypatch):
        """An unauthenticated write endpoint without a bound is the abuse
        surface; this asserts the limit is wired, not merely available."""
        from app.core.config import settings
        from app.core.rate_limit import limiter

        monkeypatch.setattr(settings, "PEAK_DUEL_RESULT_RATE_LIMIT", 3, raising=False)

        board = _start_daily(player)
        payload = {"session_token": board["session_token"], "selections": {}}

        # Warm-up: the first call is the one that MINTS the anon cookie, and
        # `client_key` folds that cookie's subject into the bucket key — so
        # without this the pre-cookie request and the post-cookie ones would
        # land in two different buckets and the boundary would be off by one.
        player.post(RESULT_URL, json=payload)
        limiter.reset()

        codes = [player.post(RESULT_URL, json=payload).status_code for _ in range(5)]

        assert codes[:3] == [200, 200, 200], codes
        assert 429 in codes[3:], codes
        denied = player.post(RESULT_URL, json=payload)
        assert denied.status_code == 429
        assert "Retry-After" in denied.headers
        # Deliberately uninformative beyond "slow down": a remaining-count is
        # the calibration signal a prober wants.
        assert "X-RateLimit-Remaining" not in denied.headers


@pytest.mark.asyncio
async def test_history_read_is_scoped_to_the_peak_duel_mode():
    """A second daily-shaped mode must not leak into Peak Duel's history.

    `save_result`/`get_result` key on `(owner_sub, mode, daily_key)` -- the
    table's UNIQUE constraint -- but `list_results_for_owner` keyed on
    `owner_sub` alone, so the history and distribution routes would have
    silently folded another mode's attempts into Peak Duel's the moment one
    existed. Nothing would have raised; the counts would just have been wrong.
    """
    from app.repositories.peak_duel_daily_memory import (
        MemoryPeakDuelDailyResultRepository,
    )
    from app.repositories.peak_duel_daily_protocols import PeakDuelDailyResult

    repo = MemoryPeakDuelDailyResultRepository()

    def attempt(mode: str, daily_key: str, correct: int) -> PeakDuelDailyResult:
        return PeakDuelDailyResult(
            id="",
            owner_sub="owner-1",
            mode=mode,
            daily_key=daily_key,
            duration_years=3,
            duels_total=10,
            correct_count=correct,
            arena_points=100 * correct,
            best_streak=correct,
            elapsed_seconds=42,
            played_on_daily_key=True,
            answers={},
            created_at=None,
        )

    await repo.save_result(attempt("peak_duel", "2026-08-25", 5))
    await repo.save_result(attempt("peak_duel", "2026-08-26", 7))
    # Same owner, same day as one of the above, a DIFFERENT daily mode.
    await repo.save_result(attempt("some_other_daily", "2026-08-26", 1))

    duel_only = await repo.list_results_for_owner(
        "owner-1", limit=3650, mode="peak_duel"
    )
    assert [r.daily_key for r in duel_only] == ["2026-08-26", "2026-08-25"]
    assert {r.mode for r in duel_only} == {"peak_duel"}
    assert [r.correct_count for r in duel_only] == [7, 5]

    # The unfiltered read is unchanged for any caller that wants every mode.
    everything = await repo.list_results_for_owner("owner-1", limit=3650)
    assert len(everything) == 3
