"""Every daily route resolves ONE day, and it is the server's.

Five modes used to answer "what day is it?" independently: four near-identical
`today_utc_date()` helpers plus five inline `strftime`/`toISOString()`
expressions, three of which let the BROWSER cast the deciding vote by sending a
`?date=` the server honoured. This file is the transport-layer proof that they
now agree, that the day they agree on is midnight America/Los_Angeles, and that
every one of them publishes the window it resolved so no client has to guess.

The boundary arithmetic itself (DST, leap day, year rollover, one minute either
side of midnight) is proved once, at the source, in `tests/test_daily_key.py`.
What is proved HERE is the part only the HTTP layer can get wrong:

  * the default is the server's key, not the caller's;
  * a future date is refused rather than silently generating a board that has
    not opened;
  * the `daily` block is present, correctly shaped, and describes the board
    actually returned;
  * a CHALLENGE never consumes a daily attempt (the Peak Draft bug: a link
    minted from a daily carried `board_type: "daily"` and the sender's date, so
    opening a friend's link wrote the recipient's official daily completion --
    and if they had already played, the write hit ON CONFLICT DO NOTHING and
    their real result was silently discarded).
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.daily_key import DAILY_TIMEZONE, daily_key, daily_window

WINDOW_KEYS = {"daily_key", "timezone", "starts_at", "ends_at", "seconds_remaining"}

# The longest a daily window can ever be: 25 hours, on the fall-back date.
MAX_WINDOW_SECONDS = 25 * 3600


def tomorrow() -> str:
    return (
        datetime.strptime(daily_key(), "%Y-%m-%d") + timedelta(days=1)
    ).strftime("%Y-%m-%d")


def yesterday() -> str:
    return (
        datetime.strptime(daily_key(), "%Y-%m-%d") - timedelta(days=1)
    ).strftime("%Y-%m-%d")


def assert_live_window(block: dict, expected_key: str) -> None:
    """The frozen contract (plan §2.1), for a board that is still today's."""
    assert set(block) == WINDOW_KEYS, block
    assert block["daily_key"] == expected_key
    assert block["timezone"] == DAILY_TIMEZONE
    assert block["starts_at"].endswith("Z")
    assert block["ends_at"].endswith("Z")
    assert 0 < block["seconds_remaining"] <= MAX_WINDOW_SECONDS
    # The window the server published is the window the shared module would
    # compute for that key -- the client and the server cannot drift, because
    # only one of them ever does the arithmetic.
    canonical = daily_window(expected_key).to_payload()
    assert block["starts_at"] == canonical["starts_at"]
    assert block["ends_at"] == canonical["ends_at"]


# ---------------------------------------------------------------------------
# The default day is the server's
# ---------------------------------------------------------------------------

def test_peak_duel_daily_defaults_to_the_servers_key(client: TestClient):
    body = client.get("/api/v1/game/daily?years=3").json()
    assert body["date"] == daily_key()
    assert_live_window(body["daily"], daily_key())


def test_peak_draft_daily_defaults_to_the_servers_key(client: TestClient):
    body = client.get("/api/v1/draft/daily?mode=prime_3y").json()
    assert body["board_metadata"]["board_id"] == f"daily-prime_3y-{daily_key()}"
    assert_live_window(body["daily"], daily_key())


def test_daily_grid_defaults_to_the_servers_key(client: TestClient):
    body = client.get("/api/v1/daily-grid/board").json()
    assert body["date"] == daily_key()
    assert_live_window(body["daily"], daily_key())


def test_run_the_table_daily_defaults_to_the_servers_key(client: TestClient):
    body = client.get("/api/v1/run-the-table/daily").json()
    assert body["date"] == daily_key()
    assert_live_window(body["daily"], daily_key())


# ---------------------------------------------------------------------------
# An archive date is an explicit request, and its window is closed
# ---------------------------------------------------------------------------

def test_an_archive_board_reports_a_closed_window(client: TestClient):
    """`seconds_remaining: 0`, never a negative countdown -- which is also what
    stops a client arming a rollover refetch on a board it opened on purpose."""
    body = client.get(f"/api/v1/daily-grid/board?date={yesterday()}").json()
    assert body["date"] == yesterday()
    assert body["daily"]["daily_key"] == yesterday()
    assert body["daily"]["seconds_remaining"] == 0


def test_yesterdays_peak_duel_is_still_replayable(client: TestClient):
    body = client.get(f"/api/v1/game/daily?years=3&date={yesterday()}").json()
    assert body["date"] == yesterday()
    assert body["daily"]["seconds_remaining"] == 0


# ---------------------------------------------------------------------------
# Tomorrow's board has not opened
# ---------------------------------------------------------------------------

def test_peak_duel_refuses_a_future_date(client: TestClient):
    """This route performed NO date validation at all before this pass: any
    string that parsed minted a signed session token for a board that did not
    exist yet."""
    assert client.get(f"/api/v1/game/daily?years=3&date={tomorrow()}").status_code == 422


def test_peak_duel_refuses_a_malformed_date(client: TestClient):
    assert client.get("/api/v1/game/daily?years=3&date=07-31-2026").status_code == 422
    assert client.get("/api/v1/game/daily?years=3&date=2026-02-30").status_code == 422


def test_peak_draft_refuses_a_future_date(client: TestClient):
    resp = client.get(f"/api/v1/draft/daily?mode=prime_3y&date={tomorrow()}")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "invalid_daily_key"


def test_daily_grid_refuses_a_future_date(client: TestClient):
    resp = client.get(f"/api/v1/daily-grid/board?date={tomorrow()}")
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "invalid_grid_date"


def test_run_the_table_refuses_a_future_date(client: TestClient):
    resp = client.get(f"/api/v1/run-the-table/daily?date={tomorrow()}")
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "invalid_run_date"


# ---------------------------------------------------------------------------
# All five modes name the same day
# ---------------------------------------------------------------------------

def test_every_mode_publishes_the_same_daily_key(client: TestClient):
    """The point of the whole pass: one key, five modes. Anything else and a
    player's Grid streak and their Draft attempt belong to different days."""
    keys = {
        "peak_duel": client.get("/api/v1/game/daily?years=3").json()["daily"]["daily_key"],
        "peak_draft": client.get("/api/v1/draft/daily?mode=prime_3y").json()["daily"]["daily_key"],
        "daily_grid": client.get("/api/v1/daily-grid/board").json()["daily"]["daily_key"],
        "run_the_table": client.get("/api/v1/run-the-table/daily").json()["daily"]["daily_key"],
    }
    assert set(keys.values()) == {daily_key()}, keys


def test_the_daily_key_is_pacific_not_utc():
    """Restated at this layer because it is the assertion a future refactor is
    most likely to break by 'simplifying' a helper back to utcnow()."""
    from nba_peak.daily_grid.generator import today_utc_date as grid_today
    from nba_peak.perfect_season.daily import today_utc_date as season_today
    from nba_peak.run_the_table.daily import today_utc_date as rtt_today

    # 00:00 UTC is 17:00 the previous afternoon in California.
    midnight_utc = datetime(2026, 8, 1, 0, 0)
    assert daily_key(midnight_utc) == "2026-07-31"
    assert grid_today(midnight_utc) == "2026-07-31"
    assert season_today(midnight_utc) == "2026-07-31"
    assert rtt_today(midnight_utc) == "2026-07-31"

    # 07:00 UTC on the same date is exactly midnight PDT.
    midnight_pt = datetime(2026, 8, 1, 7, 0)
    assert daily_key(midnight_pt) == "2026-08-01"
    assert grid_today(midnight_pt) == "2026-08-01"
    assert season_today(midnight_pt) == "2026-08-01"
    assert rtt_today(midnight_pt) == "2026-08-01"


def test_a_utc_derived_today_is_a_future_date_for_part_of_every_day(client: TestClient):
    """The rule any test FIXTURE has to respect, stated as a test.

    `datetime.now(timezone.utc).date()` is the server's day for sixteen or
    seventeen hours out of twenty-four and is TOMORROW for the rest — every
    instant between midnight UTC and midnight Pacific. A test that derived
    "today" that way (tests/test_draft.py's daily-completion test did) passed
    whenever it happened to be run during working hours in California and
    failed a 02:05 UTC CI run with `daily key ... is in the future`, which
    reads as a product bug and is not one.

    Asserted through HTTP because that is where the two meet: the route
    validates the requested date against `daily_key()`, so the only safe source
    for a requested date is `daily_key()` itself.
    """
    # 02:05 UTC — the exact shape of the CI failure. Pacific is still on the
    # previous day, so the UTC calendar date is one the server must refuse.
    ci_instant = datetime(2026, 8, 2, 2, 5)
    assert daily_key(ci_instant) == "2026-08-01"
    assert ci_instant.date().isoformat() == "2026-08-02"

    # And the live coupling, at whatever instant this actually runs: today's
    # key is accepted, the day after it is not.
    today = daily_key()
    tomorrow = (datetime.fromisoformat(today) + timedelta(days=1)).date().isoformat()

    accepted = client.post(
        "/api/v1/draft/games",
        json={"mode": "apex_1y", "board_type": "daily", "date": today},
    )
    assert accepted.status_code == 200, accepted.text

    refused = client.post(
        "/api/v1/draft/games",
        json={"mode": "apex_1y", "board_type": "daily", "date": tomorrow},
    )
    assert refused.status_code == 400, refused.text
    assert "future" in refused.text


# ---------------------------------------------------------------------------
# A challenge is provenance, never a daily attempt
# ---------------------------------------------------------------------------

ALL_ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]


def _play_to_completion(client: TestClient, game_id: str) -> dict:
    """Fill all five roles.

    Most-constrained-first, but it tries every (card, role) pair the round
    offers rather than committing to the first: role eligibility can dead-end
    the greedy pick in the last round, and a rejected selection is a 400 that
    leaves the state untouched, so retrying is free and safe.
    """
    for _ in range(5):
        state = client.get(f"/api/v1/draft/games/{game_id}").json()
        if state["status"] == "draft_complete":
            return state
        offers = state["current_offers"]
        open_roles = state["open_roles"]

        pairs: list[tuple[str, str]] = []
        for offer in sorted(
            offers,
            key=lambda o: len([r for r in o["eligible_roles"] if r in open_roles]) or 99,
        ):
            for role in offer["eligible_roles"]:
                if role in open_roles:
                    pairs.append((offer["peak_window_id"], role))
        # Last resort: any card into any open role. The server decides.
        pairs += [(o["peak_window_id"], r) for o in offers for r in open_roles]

        if not _try_pairs(client, game_id, pairs):
            # Dead end: nothing on offer is eligible for the roles still open.
            # Reframe is exactly the in-game tool for that, so use it rather
            # than declaring the board broken.
            client.post(
                f"/api/v1/draft/games/{game_id}/actions",
                json={"game_id": game_id, "action": "use_reframe"},
            )
            client.post(
                f"/api/v1/draft/games/{game_id}/actions",
                json={"game_id": game_id, "action": "confirm"},
            )
            state = client.get(f"/api/v1/draft/games/{game_id}").json()
            retry = [
                (o["peak_window_id"], r)
                for o in state["current_offers"]
                for r in o["eligible_roles"]
                if r in state["open_roles"]
            ]
            assert _try_pairs(client, game_id, retry), state

    return client.get(f"/api/v1/draft/games/{game_id}").json()


def _try_pairs(client: TestClient, game_id: str, pairs: list[tuple[str, str]]) -> bool:
    """Submit pairs until one is accepted. A rejected selection is a 400 that
    changes nothing, so this is free to probe."""
    for card_id, role in pairs:
        resp = client.post(
            f"/api/v1/draft/games/{game_id}/actions",
            json={
                "game_id": game_id,
                "action": "select_card",
                "card_id": card_id,
                "role": role,
            },
        )
        if resp.status_code == 200:
            return True
    return False


def test_a_daily_minted_challenge_reproduces_the_board_but_is_not_a_daily(
    client: TestClient,
):
    """The Peak Draft back-port of the rule RUN THE TABLE already enforced.

    Both halves matter and they pull in opposite directions:
      - the recipient must get the SAME board, or the comparison against the
        challenger is meaningless (`board_id` is what the comparison route
        matches on);
      - the recipient's GAME must not be a daily, or finishing it writes their
        official daily completion for a day someone else chose.
    """
    date = yesterday()
    daily = client.get(f"/api/v1/draft/daily?mode=apex_1y&date={date}").json()
    assert daily["board_type"] == "daily"
    board_id = daily["board_metadata"]["board_id"]

    completed = _play_to_completion(client, daily["game_id"])
    assert completed["status"] == "draft_complete"

    token = client.post(
        f"/api/v1/draft/challenges?game_id={daily['game_id']}"
    ).json()["challenge_token"]

    recipient = client.get(f"/api/v1/draft/challenges/{token}").json()
    # Same board, bit for bit.
    assert recipient["board_metadata"]["board_id"] == board_id
    # ...but not the recipient's daily.
    assert recipient["board_type"] == "challenge"


def test_a_challenge_board_is_identical_to_the_daily_it_was_minted_from(
    client: TestClient,
):
    """`reproduce_as` must not perturb generation: same offers, same order."""
    date = yesterday()
    daily = client.get(f"/api/v1/draft/daily?mode=apex_1y&date={date}").json()
    original_offers = [o["peak_window_id"] for o in daily["current_offers"]]
    _play_to_completion(client, daily["game_id"])
    token = client.post(
        f"/api/v1/draft/challenges?game_id={daily['game_id']}"
    ).json()["challenge_token"]

    recipient = client.get(f"/api/v1/draft/challenges/{token}").json()
    assert [o["peak_window_id"] for o in recipient["current_offers"]] == original_offers


def test_a_challenge_never_consumes_or_overwrites_the_recipients_daily(client: TestClient):
    """THE BUG, stated as the sequence that loses data.

    A daily-minted token carried `board_type: "daily"` and the sender's date
    straight into `create_draft_game`, so the recipient's challenge play wrote
    THEIR official daily completion for that board. `record_completion` is
    "first completion wins" (ON CONFLICT DO NOTHING in Postgres), so a player
    who opened a friend's link before playing their own daily had their real
    attempt silently discarded -- and there is no repair path, because the
    write that mattered simply never happened.
    """
    from app.core.dependencies import _memory_daily_completion_repo
    from app.main import app

    date = yesterday()

    # The sender: their own client, so their own anon subject.
    with TestClient(app) as sender:
        sender_daily = sender.get(
            f"/api/v1/draft/daily?mode=apex_1y&date={date}"
        ).json()
        _play_to_completion(sender, sender_daily["game_id"])
        token = sender.post(
            f"/api/v1/draft/challenges?game_id={sender_daily['game_id']}"
        ).json()["challenge_token"]

    board_id = sender_daily["board_metadata"]["board_id"]

    with TestClient(app) as recipient:
        # 1. They open the friend's link FIRST and play it through.
        challenge_game = recipient.get(f"/api/v1/draft/challenges/{token}").json()
        _play_to_completion(recipient, challenge_game["game_id"])

        # 2. Then they play their own daily for the same date.
        own_daily = recipient.get(
            f"/api/v1/draft/daily?mode=apex_1y&date={date}"
        ).json()
        _play_to_completion(recipient, own_daily["game_id"])

        recorded = [
            c
            for c in _memory_daily_completion_repo._completions.values()
            if c.board_id == board_id
            and c.game_id in {challenge_game["game_id"], own_daily["game_id"]}
        ]

    # Exactly one daily completion for this board, and it is the game the
    # player actually chose to spend their attempt on.
    assert len(recorded) == 1, recorded
    assert recorded[0].game_id == own_daily["game_id"]
    assert recorded[0].board_id == board_id


def test_a_practice_challenge_still_reproduces_its_seeded_board(client: TestClient):
    """The same mechanism, on the path that already worked, so relabelling the
    recipient's game cannot break a practice link's board identity."""
    game = client.post(
        "/api/v1/draft/games",
        json={"mode": "apex_1y", "board_type": "practice", "seed": 4242},
    ).json()
    board_id = game["board_metadata"]["board_id"]
    _play_to_completion(client, game["game_id"])
    token = client.post(
        f"/api/v1/draft/challenges?game_id={game['game_id']}"
    ).json()["challenge_token"]

    recipient = client.get(f"/api/v1/draft/challenges/{token}").json()
    assert recipient["board_metadata"]["board_id"] == board_id
    assert recipient["board_type"] == "challenge"


# ---------------------------------------------------------------------------
# PEAK Season (flag-gated)
# ---------------------------------------------------------------------------

@pytest.fixture
def courtbuilder(client: TestClient):
    from app.core.config import settings

    original = (settings.COURTBUILDER_ENABLED, settings.COURTBUILDER_READINESS_LEVEL)
    settings.COURTBUILDER_ENABLED = True
    settings.COURTBUILDER_READINESS_LEVEL = "internal_dev"
    yield client
    settings.COURTBUILDER_ENABLED, settings.COURTBUILDER_READINESS_LEVEL = original


def test_peak_season_daily_defaults_to_the_servers_key(courtbuilder: TestClient):
    body = courtbuilder.get("/api/v1/perfect-season/daily?mode=apex_1y").json()
    assert body["challenge_date"] == daily_key()
    assert_live_window(body["daily"], daily_key())


def test_peak_season_daily_refuses_a_future_date(courtbuilder: TestClient):
    resp = courtbuilder.get(
        f"/api/v1/perfect-season/daily?mode=apex_1y&date={tomorrow()}"
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "invalid_challenge_date"
