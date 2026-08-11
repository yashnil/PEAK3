"""Daily Grid daily leaderboard (final polish pass, A2).

Three layers under test:

  1. THE RANKING ITSELF (`leaderboard_sort_key` / `is_strictly_better`) —
     domain rules with no app: score always outranks, time only breaks ties,
     an unwitnessed time never beats a witnessed one, replacement is
     strictly-better-only.
  2. THE QUALIFICATION PIPELINE — a leaderboard row exists exactly when a
     LEGITIMATE, signed-in, live-daily official completion does, and every
     number on it comes from server records the request cannot touch.
  3. THE PUBLIC READ — ranks computed server-side over listed (handle-holding)
     players, the Pacific daily partition, and nothing private in the payload.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from app.core.dependencies import (
    _memory_daily_grid_result_repo as repo,
    _memory_profile_repo as profiles,
)
from app.repositories.daily_grid_protocols import (
    DailyGridLeaderboardEntry,
    is_strictly_better,
    leaderboard_sort_key,
)
from nba_peak.daily_grid.generator import get_board, today_utc_date
from nba_peak.daily_grid.search import unused_answer_for_cell

OFFICIAL_URL = "/api/v1/daily-grid/official"
LEADERBOARD_URL = "/api/v1/daily-grid/leaderboard"
START_URL = "/api/v1/daily-grid/{key}/start"

_TEST_JWT_SECRET = "daily-grid-leaderboard-test-jwt-secret"


def _token(sub: str, *, anonymous: bool = False) -> str:
    import jwt

    claims: dict = {"sub": sub, "email": f"{sub}@example.test"}
    if anonymous:
        claims["is_anonymous"] = True
    secret = settings.SUPABASE_JWT_SECRET or _TEST_JWT_SECRET
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def auth_headers(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", _TEST_JWT_SECRET, raising=False)

    def make(sub: str, *, anonymous: bool = False) -> dict:
        return {"Authorization": f"Bearer {_token(sub, anonymous=anonymous)}"}

    return make


def _complete_board_payload(date: str) -> list[dict]:
    board = get_board(date)
    used: set[str] = set()
    filled: list[dict] = []
    for cell in board.cells:
        answer = unused_answer_for_cell(board, cell.row, cell.col, frozenset(used))
        assert answer is not None, (cell.row, cell.col)
        used.add(answer.player_slug)
        filled.append({"row": cell.row, "col": cell.col, "answer_id": answer.id})
    return filled


def _complete_today(client: TestClient, headers: dict, *, start_first: bool = True) -> dict:
    """Play today's board legitimately end to end: start the server clock,
    then save the official result. Returns the official-save body."""
    today = today_utc_date()
    if start_first:
        assert client.post(START_URL.format(key=today), headers=headers).status_code == 200
    response = client.post(
        OFFICIAL_URL,
        json={
            "date": today,
            "filled": _complete_board_payload(today),
            "incorrect_attempts": 0,
            "elapsed_seconds": 123,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _set_handle(sub: str, handle: str) -> None:
    async def run():
        await profiles.get_or_create_profile(sub)
        await profiles.update_profile(sub, {"handle": handle})

    asyncio.run(run())


def _entry(
    sub: str = "u",
    *,
    key: str = "2026-08-11",
    score: int = 100,
    time_ms: int | None = 60_000,
    completed_at: datetime | None = None,
    entry_id: str = "",
) -> DailyGridLeaderboardEntry:
    return DailyGridLeaderboardEntry(
        id=entry_id,
        owner_sub=sub,
        daily_key=key,
        board_id=f"daily-grid-v2-{key}",
        board_version="daily_grid.v2",
        score=score,
        completion_time_ms=time_ms,
        result_id="r-1",
        completed_at=completed_at or datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc),
    )


# ---------------------------------------------------------------------------
# 1. The ranking, as domain rules
# ---------------------------------------------------------------------------


class TestRankingOrder:
    def test_a_higher_score_always_outranks_however_slow(self):
        # 1000/80s beats 999/20s — the brief's own example.
        slow_high = _entry("a", score=1000, time_ms=80_000)
        fast_low = _entry("b", score=999, time_ms=20_000)
        assert sorted([fast_low, slow_high], key=leaderboard_sort_key)[0] is slow_high

    def test_equal_scores_rank_by_time_ascending(self):
        # 1000/42s beats 1000/48s.
        faster = _entry("a", score=1000, time_ms=42_000)
        slower = _entry("b", score=1000, time_ms=48_000)
        assert sorted([slower, faster], key=leaderboard_sort_key)[0] is faster

    def test_an_unwitnessed_time_ranks_after_every_witnessed_one_at_equal_score(self):
        timed = _entry("a", score=500, time_ms=3_600_000)  # a full hour
        untimed = _entry("b", score=500, time_ms=None)
        assert sorted([untimed, timed], key=leaderboard_sort_key)[0] is timed

    def test_an_exact_tie_resolves_to_the_earlier_completion_then_id(self):
        early = _entry("a", score=500, time_ms=30_000,
                       completed_at=datetime(2026, 8, 11, 9, 0, tzinfo=timezone.utc),
                       entry_id="aaa")
        late = _entry("b", score=500, time_ms=30_000,
                      completed_at=datetime(2026, 8, 11, 10, 0, tzinfo=timezone.utc),
                      entry_id="bbb")
        assert sorted([late, early], key=leaderboard_sort_key)[0] is early
        # Byte-identical timestamps too: id gives a total order, so pagination
        # can never shuffle equal rows between reads.
        twin = _entry("c", score=500, time_ms=30_000,
                      completed_at=early.completed_at, entry_id="ccc")
        assert sorted([twin, early], key=leaderboard_sort_key)[0] is early


class TestBestAttemptRule:
    def test_a_better_score_replaces(self):
        assert is_strictly_better(_entry(score=600), _entry(score=500))

    def test_a_worse_score_never_replaces(self):
        assert not is_strictly_better(_entry(score=400), _entry(score=500))

    def test_equal_score_faster_replaces(self):
        assert is_strictly_better(
            _entry(score=500, time_ms=30_000), _entry(score=500, time_ms=40_000)
        )

    def test_equal_score_slower_never_replaces(self):
        assert not is_strictly_better(
            _entry(score=500, time_ms=50_000), _entry(score=500, time_ms=40_000)
        )

    def test_identical_performance_keeps_the_incumbent(self):
        assert not is_strictly_better(
            _entry(score=500, time_ms=40_000), _entry(score=500, time_ms=40_000)
        )

    def test_an_unwitnessed_time_never_replaces_a_witnessed_one(self):
        assert not is_strictly_better(
            _entry(score=500, time_ms=None), _entry(score=500, time_ms=999_000)
        )
        # ...but a witnessed one replaces an unwitnessed incumbent.
        assert is_strictly_better(
            _entry(score=500, time_ms=999_000), _entry(score=500, time_ms=None)
        )


class TestRepositoryUpsert:
    def _upsert(self, entry):
        return asyncio.run(
            repo.upsert_leaderboard_best(entry)
        )

    def test_worse_never_overwrites_better_whatever_the_order(self):
        best = _entry("u1", score=900, time_ms=50_000)
        stored, changed = self._upsert(best)
        assert changed
        stored, changed = self._upsert(_entry("u1", score=899, time_ms=1_000))
        assert not changed and stored.score == 900

    def test_concurrent_submissions_resolve_to_the_best(self):
        async def race():
            results = await asyncio.gather(
                repo.upsert_leaderboard_best(_entry("u2", score=700, time_ms=70_000)),
                repo.upsert_leaderboard_best(_entry("u2", score=700, time_ms=60_000)),
                repo.upsert_leaderboard_best(_entry("u2", score=650, time_ms=5_000)),
            )
            return results

        asyncio.run(race())
        final = asyncio.run(
            repo.leaderboard_entry_for_owner("u2", "2026-08-11")
        )
        assert final.score == 700
        assert final.completion_time_ms == 60_000

    def test_the_partition_is_the_daily_key(self):
        self._upsert(_entry("u3", key="2026-08-10", score=999))
        self._upsert(_entry("u4", key="2026-08-11", score=1))
        today_rows = asyncio.run(
            repo.leaderboard_top("2026-08-11")
        )
        assert [r.owner_sub for r in today_rows] == ["u4"]


# ---------------------------------------------------------------------------
# 2. Qualification — only legitimate, signed-in, live completions
# ---------------------------------------------------------------------------


class TestQualification:
    def test_a_legitimate_signed_in_completion_qualifies_with_server_time(
        self, client: TestClient, auth_headers
    ):
        _set_handle("user-a", "the-closer")
        _complete_today(client, auth_headers("user-a"))

        board = client.get(LEADERBOARD_URL).json()
        assert board["daily_key"] == today_utc_date()
        assert board["total_listed"] == 1
        row = board["entries"][0]
        assert row["rank"] == 1
        assert row["handle"] == "the-closer"
        assert row["score"] > 0
        # SERVER TIME: derived from the attempt clock this test started —
        # present, non-negative, and NOT the client's 123s claim scaled to ms
        # (the clock was started milliseconds ago).
        assert row["completion_time_ms"] is not None
        assert 0 <= row["completion_time_ms"] < 60_000

    def test_an_archive_replay_never_qualifies(self, client: TestClient, auth_headers):
        """`played_on_board_date=False` is a real completion and a stored
        result — but it is not today's competition (A2.12: wrong challenge
        date rejected)."""
        _set_handle("user-b", "replayer")
        response = client.post(
            OFFICIAL_URL,
            json={
                "date": "2026-03-14",
                "filled": _complete_board_payload("2026-03-14"),
                "incorrect_attempts": 0,
            },
            headers=auth_headers("user-b"),
        )
        assert response.status_code == 200
        assert response.json()["played_on_board_date"] is False
        assert client.get(LEADERBOARD_URL).json()["total_listed"] == 0
        # ...and it is not on that DATE's board either: an archive replay is
        # not a time-travelling entry into a finished competition.
        past = client.get(LEADERBOARD_URL, params={"date": "2026-03-14"}).json()
        assert past["total_listed"] == 0

    def test_an_anonymous_supabase_session_never_qualifies(
        self, client: TestClient, auth_headers
    ):
        """Anonymous players play normally; the public board requires a real
        account (A2.6)."""
        body = _complete_today(client, auth_headers("anon-1", anonymous=True))
        assert body["official_saved"] is True
        assert client.get(LEADERBOARD_URL).json()["total_listed"] == 0

    def test_an_incomplete_board_is_rejected_before_any_record_exists(
        self, client: TestClient, auth_headers
    ):
        today = today_utc_date()
        response = client.post(
            OFFICIAL_URL,
            json={
                "date": today,
                "filled": _complete_board_payload(today)[:8],
                "incorrect_attempts": 0,
            },
            headers=auth_headers("user-c"),
        )
        assert response.status_code == 400
        assert client.get(LEADERBOARD_URL).json()["total_listed"] == 0

    def test_the_client_cannot_influence_score_or_time(
        self, client: TestClient, auth_headers
    ):
        """A2.12: forged score impossible (no field), forged time ignored.
        The absurd client claims below change nothing the leaderboard shows."""
        _set_handle("user-d", "honest-by-force")
        today = today_utc_date()
        assert client.post(START_URL.format(key=today), headers=auth_headers("user-d")).status_code == 200
        response = client.post(
            OFFICIAL_URL,
            json={
                "date": today,
                "filled": _complete_board_payload(today),
                "incorrect_attempts": 0,
                "elapsed_seconds": 1,          # claims a 1-second solve
                "score": 999_999,              # not a request field; ignored
            },
            headers=auth_headers("user-d"),
        )
        assert response.status_code == 200
        row = client.get(LEADERBOARD_URL).json()["entries"][0]
        assert row["score"] == response.json()["score"]  # server-recomputed
        assert row["score"] < 999_999
        # The stored time is the server interval, not the claimed 1000ms. It
        # is strictly less than a second only if the server really saw the
        # whole board played in under a second — which this in-process test
        # legitimately does — so the assertion is about PROVENANCE: the value
        # equals the interval between the two server stamps.
        entry = asyncio.run(
            repo.leaderboard_entry_for_owner("user-d", today)
        )
        attempt = asyncio.run(
            repo.get_attempt("user-d", today)
        )
        result = asyncio.run(
            repo.get_result("user-d", today, "daily_grid.v2")
        )
        expected = max(0, int((result.created_at - attempt.started_at).total_seconds() * 1000))
        assert entry.completion_time_ms == expected

    def test_a_duplicate_save_is_idempotent_on_the_board_too(
        self, client: TestClient, auth_headers
    ):
        _set_handle("user-e", "twice")
        first = _complete_today(client, auth_headers("user-e"))
        again = _complete_today(client, auth_headers("user-e"), start_first=False)
        assert again["created"] is False
        board = client.get(LEADERBOARD_URL).json()
        assert board["total_listed"] == 1
        # The entry still reflects the FIRST save's timing — a replayed POST
        # cannot refresh the clock (`completed_at` is the result's immutable
        # created_at, and the upsert only replaces strictly-better).
        assert board["entries"][0]["score"] == first["score"]

    def test_a_completion_without_a_server_clock_qualifies_untimed(
        self, client: TestClient, auth_headers
    ):
        """A legacy client that never called /start still gets its (fully
        validated) score on the board — with an honest NULL time that ranks
        after every witnessed time of equal score. The strongest safe version:
        the server refuses to pretend it timed something it did not."""
        _set_handle("user-f", "untimed")
        _complete_today(client, auth_headers("user-f"), start_first=False)
        row = client.get(LEADERBOARD_URL).json()["entries"][0]
        assert row["completion_time_ms"] is None


# ---------------------------------------------------------------------------
# 3. The public read
# ---------------------------------------------------------------------------


class TestPublicBoard:
    def test_ranks_scores_then_time_and_marks_the_caller(
        self, client: TestClient, auth_headers
    ):
        # Three players, engineered standings via the repository (the API path
        # is proven above; this is about the READ).
        for sub, handle, score, ms in [
            ("p1", "gold", 900, 80_000),
            ("p2", "silver", 880, 20_000),
            ("p3", "bronze", 880, 30_000),
        ]:
            _set_handle(sub, handle)
            asyncio.run(
                repo.upsert_leaderboard_best(
                    _entry(sub, key=today_utc_date(), score=score, time_ms=ms)
                )
            )

        board = client.get(LEADERBOARD_URL, headers=auth_headers("p3")).json()
        assert [(r["rank"], r["handle"]) for r in board["entries"]] == [
            (1, "gold"), (2, "silver"), (3, "bronze"),
        ]
        assert [r["is_current_user"] for r in board["entries"]] == [False, False, True]
        assert board["you"]["rank"] == 3
        assert board["you"]["listed"] is True

    def test_a_player_without_a_handle_is_stored_but_unlisted(
        self, client: TestClient, auth_headers
    ):
        """The Arena rule: the only name shown is a handle the player chose.
        No handle -> no public row, and their own view says so instead of
        faking a placement."""
        _set_handle("named", "has-a-name")
        asyncio.run(
            repo.upsert_leaderboard_best(
                _entry("named", key=today_utc_date(), score=500, time_ms=10_000)
            )
        )
        asyncio.run(
            repo.upsert_leaderboard_best(
                _entry("nameless", key=today_utc_date(), score=900, time_ms=10_000)
            )
        )
        board = client.get(LEADERBOARD_URL, headers=auth_headers("nameless")).json()
        assert board["total_listed"] == 1
        assert board["entries"][0]["handle"] == "has-a-name"
        assert board["entries"][0]["rank"] == 1  # ranked among LISTED players
        you = board["you"]
        assert you["has_entry"] is True
        assert you["listed"] is False
        assert you["has_handle"] is False
        assert you["rank"] is None

    def test_your_true_rank_survives_being_outside_the_page(
        self, client: TestClient, auth_headers
    ):
        for i in range(5):
            _set_handle(f"top-{i}", f"top-{i}")
            asyncio.run(
                repo.upsert_leaderboard_best(
                    _entry(f"top-{i}", key=today_utc_date(), score=1000 - i, time_ms=10_000)
                )
            )
        _set_handle("tail", "tail")
        asyncio.run(
            repo.upsert_leaderboard_best(
                _entry("tail", key=today_utc_date(), score=1, time_ms=10_000)
            )
        )
        board = client.get(
            LEADERBOARD_URL, params={"limit": 3}, headers=auth_headers("tail")
        ).json()
        assert len(board["entries"]) == 3
        assert board["total_listed"] == 6
        assert board["you"]["rank"] == 6  # real rank, not a fake placement
        assert all(not r["is_current_user"] for r in board["entries"])

    def test_no_private_identity_field_in_the_payload(
        self, client: TestClient, auth_headers
    ):
        _set_handle("private-p", "publicname")
        asyncio.run(
            repo.upsert_leaderboard_best(
                _entry("private-p", key=today_utc_date(), score=10, time_ms=1_000)
            )
        )
        raw = client.get(LEADERBOARD_URL).text
        for leak in ("private-p", "owner_sub", "@example.test", "email", "result_id"):
            assert leak not in raw, f"leaderboard payload leaked '{leak}'"

    def test_the_empty_board_is_a_real_state(self, client: TestClient):
        board = client.get(LEADERBOARD_URL).json()
        assert board["entries"] == []
        assert board["total_listed"] == 0
        assert board["you"] is None

    def test_reading_needs_no_auth(self, client: TestClient):
        assert client.get(LEADERBOARD_URL).status_code == 200

    def test_a_malformed_or_future_date_is_rejected(self, client: TestClient):
        assert client.get(LEADERBOARD_URL, params={"date": "not-a-date"}).status_code == 400
        future = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
        assert client.get(LEADERBOARD_URL, params={"date": future}).status_code == 400


# ---------------------------------------------------------------------------
# Pacific-midnight rollover (A2.2 / A2.11)
# ---------------------------------------------------------------------------


class TestPacificRollover:
    def test_the_partition_key_is_the_pacific_day_not_utc(self):
        """23:59 vs 00:01 Pacific, across a UTC date line, on a DST-sensitive
        date: 2026-03-08 is the US spring-forward day. `today_utc_date` (the
        name is historical; it returns the America/Los_Angeles date) is the
        single date authority the leaderboard shares with every other Daily
        surface — asserting IT is asserting the partition."""
        from zoneinfo import ZoneInfo

        pacific = ZoneInfo("America/Los_Angeles")
        before_midnight = datetime(2026, 3, 8, 23, 59, tzinfo=pacific)
        after_midnight = datetime(2026, 3, 9, 0, 0, tzinfo=pacific)
        # Both instants are on March 9 UTC (23:59 PDT == 06:59 UTC Mar 9) —
        # a UTC partition would put them on the SAME board.
        assert before_midnight.astimezone(timezone.utc).date().isoformat() == "2026-03-09"
        assert today_utc_date(before_midnight) == "2026-03-08"
        assert today_utc_date(after_midnight) == "2026-03-09"
        # Fall-back too: 2026-11-01, when 01:30 PT happens twice.
        fall = ZoneInfo("America/Los_Angeles")
        assert today_utc_date(datetime(2026, 11, 1, 23, 59, tzinfo=fall)) == "2026-11-01"
        assert today_utc_date(datetime(2026, 11, 2, 0, 0, tzinfo=fall)) == "2026-11-02"

    def test_yesterday_never_surfaces_in_todays_default_view(self, client: TestClient):
        from datetime import date as _date

        today = today_utc_date()
        yesterday = (_date.fromisoformat(today) - timedelta(days=1)).isoformat()
        _set_handle("y-player", "yesterhero")
        asyncio.run(
            repo.upsert_leaderboard_best(
                _entry("y-player", key=yesterday, score=999, time_ms=1_000)
            )
        )
        assert client.get(LEADERBOARD_URL).json()["total_listed"] == 0
        # ...but the stored rows remain reachable for their own day.
        past = client.get(LEADERBOARD_URL, params={"date": yesterday}).json()
        assert past["total_listed"] == 1
        assert past["daily_key"] == yesterday
