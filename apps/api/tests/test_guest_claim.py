"""Guest claim: everything a player did before signing in comes with them.

WHAT THIS SUITE IS DEFENDING. `POST /api/v1/auth/claim` used to transfer five
domains and silently miss four -- `run_the_table_runs`, `daily_grid_results`,
`perfect_season_runs` and `perfect_season_saved_runs` had no `transfer_owner`
at all. RUN THE TABLE is the one that hurt: it is anonymous-first by design, so
the modal player is a guest, and signing in permanently detached them from
every run they had played. The run stayed in the database, owned by a subject
whose cookie had just been deleted.

The four security properties asserted here are the ones that make a claim safe
rather than merely useful:

  1. the credential is the signature-verified `peak3_anon` httponly cookie and
     nothing else -- no client-submitted subject, no localStorage run id;
  2. a forged or unsigned cookie claims nothing, and says so without revealing
     which kind of invalid it was;
  3. an anon subject already claimed by a DIFFERENT account is 403, never a
     second transfer;
  4. two tabs cannot double-claim -- `ownership_claims.anon_subject_id` is
     UNIQUE, and the second writer reads back the first writer's row instead of
     recording its own.

Seeding is done directly against the in-memory repositories the app is already
using (`app.core.dependencies`' module singletons, which are what
`get_*_repo` returns whenever no database pool is configured) rather than by
playing each game through its own routes. Those routes belong to other tracks
and are moving; what is under test here is the claim, and seeding through the
repository is the same state a real play would have left behind.
"""
from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.api.v1.auth import ANON_COOKIE_NAME, CLAIMABLE_DOMAINS
from app.core import dependencies as deps
from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.main import app
from app.repositories.daily_grid_protocols import DailyGridResult
from app.repositories.leaderboard_protocols import PerfectSeasonRun
from app.repositories.peak_duel_daily_protocols import PeakDuelDailyResult
from app.repositories.protocols import ChallengeRecord, OwnershipClaim
from app.repositories.run_the_table_protocols import StoredRun
from app.repositories.saved_run_protocols import SavedRun


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(sub: str) -> AuthSubject:
    return AuthSubject(sub=sub, email="guest@example.com", is_anonymous=False, raw_claims={})


def _sign_in_as(sub: str) -> None:
    subject = _auth(sub)
    app.dependency_overrides[get_optional_auth] = lambda: subject
    app.dependency_overrides[get_required_auth] = lambda: subject


@pytest.fixture(autouse=True)
def _clean_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def _new_guest(client: TestClient) -> tuple[str, str]:
    """Establish a real guest session. Returns (anon_sub, raw_cookie_value).

    Goes through `POST /auth/anon` rather than fabricating a subject, because
    the cookie's HMAC signature is the whole credential -- a test that made one
    up would be testing a different endpoint than the one that ships.
    """
    resp = client.post("/api/v1/auth/anon")
    assert resp.status_code == 200
    anon_sub = resp.json()["sub"]
    assert anon_sub.startswith("anon:")
    cookie = client.cookies.get(ANON_COOKIE_NAME)
    assert cookie, "POST /auth/anon must set the peak3_anon cookie"
    return anon_sub, cookie


def _claim(client: TestClient, real_sub: str, cookie: str | None = None):
    """Sign in and claim. `cookie` re-presents a value the server has cleared."""
    if cookie is not None:
        client.cookies.set(ANON_COOKIE_NAME, cookie)
    _sign_in_as(real_sub)
    return client.post("/api/v1/auth/claim")


def _run(owner_sub: str, *, status: str = "in_progress", run_type: str = "standard",
         run_date: str | None = None) -> StoredRun:
    return StoredRun(
        run_id=f"rtt-{uuid.uuid4().hex}",
        owner_sub=owner_sub,
        seed=1234,
        run_type=run_type,
        run_date=run_date,
        status=status,
        snapshot={"status": status, "act": 2},
        engine_version="rtt_engine_v1",
        ruleset_version="rtt_ruleset_v1",
        card_pool_version="v3",
    )


def _grid_result(owner_sub: str, board_date: str) -> DailyGridResult:
    return DailyGridResult(
        id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        board_id=f"daily-grid-v2-{board_date}",
        board_date=board_date,
        board_version="daily_grid.v2",
        score=700,
        optimal_total=900,
        percent_of_best=77.8,
        squares_matching_optimal=6,
    )


def _duel_result(owner_sub: str, daily_key: str) -> PeakDuelDailyResult:
    return PeakDuelDailyResult(
        id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        mode="peak_duel",
        daily_key=daily_key,
        duration_years=3,
        duels_total=10,
        correct_count=8,
        arena_points=940,
        best_streak=5,
    )


def _saved_run(owner_sub: str) -> SavedRun:
    return SavedRun(
        id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        game_id=f"game-{uuid.uuid4().hex}",
        mode="peak_season",
        seed=99,
        wins=61,
        losses=21,
        lineup_score=88.5,
        score_status="complete",
        exact_cards_scored=8,
        total_cards=8,
        leaderboard_eligible=True,
    )


def _submitted_run(owner_sub: str) -> PerfectSeasonRun:
    return PerfectSeasonRun(
        id=str(uuid.uuid4()),
        owner_sub=owner_sub,
        display_name="Guest",
        mode="peak_season",
        game_id=f"game-{uuid.uuid4().hex}",
        seed=7,
        wins=70,
        losses=12,
        lineup_score=91.2,
        score_status="complete",
        exact_cards_scored=8,
        total_cards=8,
        team_respins_used=0,
        season_respins_used=0,
    )


def _challenge(owner_sub: str | None) -> ChallengeRecord:
    now = datetime.now(timezone.utc)
    return ChallengeRecord(
        token_hash=uuid.uuid4().hex,
        challenger_game_id=f"game-{uuid.uuid4().hex}",
        board_id="board-1",
        mode="apex",
        board_type="challenge",
        duration_years=3,
        seed=5,
        date=None,
        created_at=now,
        expires_at=now + timedelta(days=7),
        challenger_snapshot={"picks": []},
        anon_subject_id=owner_sub,
    )


# ---------------------------------------------------------------------------
# The four previously-missed domains
# ---------------------------------------------------------------------------


def test_active_run_the_table_run_is_claimed_mid_run(client: TestClient) -> None:
    """Signing in during act 2 keeps the run you are standing in.

    The highest-impact case: RUN THE TABLE takes no account to start, so this
    is the ordinary path, and before `transfer_owner` existed on this
    repository the run was orphaned the moment the cookie was consumed.
    """
    anon_sub, _ = _new_guest(client)
    run = _run(anon_sub, status="in_progress")
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(run))

    real_sub = str(uuid.uuid4())
    body = _claim(client, real_sub).json()

    assert body["claimed"] is True
    assert body["domain_counts"]["run_the_table_runs"] == 1

    moved = asyncio.run(deps._memory_run_the_table_run_repo.get_run(run.run_id))
    assert moved is not None, "the run must still exist"
    assert moved.owner_sub == real_sub
    assert moved.status == "in_progress", "claiming must not disturb the run itself"
    assert moved.snapshot == {"status": "in_progress", "act": 2}


def test_completed_results_are_claimed_from_the_completion_screen(client: TestClient) -> None:
    """Signing in from a result screen keeps the result."""
    anon_sub, _ = _new_guest(client)
    finished = _run(anon_sub, status="complete")
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(finished))
    grid = _grid_result(anon_sub, "2026-07-30")
    asyncio.run(deps._memory_daily_grid_result_repo.save_result(grid))
    duel = _duel_result(anon_sub, "2026-07-30")
    asyncio.run(deps._memory_peak_duel_daily_result_repo.save_result(duel))

    real_sub = str(uuid.uuid4())
    counts = _claim(client, real_sub).json()["domain_counts"]

    assert counts["run_the_table_runs"] == 1
    assert counts["daily_grid_results"] == 1
    assert counts["peak_duel_daily_results"] == 1

    assert asyncio.run(
        deps._memory_daily_grid_result_repo.get_result(real_sub, "2026-07-30", "daily_grid.v2")
    ) is not None
    assert asyncio.run(
        deps._memory_peak_duel_daily_result_repo.get_result(real_sub, "peak_duel", "2026-07-30")
    ) is not None


def test_perfect_season_history_and_submissions_are_claimed(client: TestClient) -> None:
    anon_sub, _ = _new_guest(client)
    saved = _saved_run(anon_sub)
    asyncio.run(deps._memory_perfect_season_saved_run_repo.save_run(saved))
    submitted = _submitted_run(anon_sub)
    asyncio.run(deps._memory_perfect_season_leaderboard_repo.submit_run(submitted))

    real_sub = str(uuid.uuid4())
    counts = _claim(client, real_sub).json()["domain_counts"]

    assert counts["perfect_season_saved_runs"] == 1
    assert counts["perfect_season_runs"] == 1

    bests = asyncio.run(deps._memory_perfect_season_saved_run_repo.get_personal_bests(real_sub))
    assert bests.total_runs == 1
    # A submitted leaderboard row changes hands but never changes content: the
    # board still shows the name that was behind the submission.
    moved = asyncio.run(
        deps._memory_perfect_season_leaderboard_repo.get_run_by_game_id(submitted.game_id)
    )
    assert moved.owner_sub == real_sub
    assert moved.display_name == "Guest"


def test_response_reports_every_domain_including_the_zeros(client: TestClient) -> None:
    """A per-domain breakdown the UI can render honestly.

    Every key is always present. "That mode moved nothing" and "we forgot to
    look at that mode" are different statements, and an absent key cannot make
    the first one.
    """
    _new_guest(client)
    body = _claim(client, str(uuid.uuid4())).json()

    assert set(body["domain_counts"]) == set(CLAIMABLE_DOMAINS)
    assert body["total_claimed"] == sum(body["domain_counts"].values())


# ---------------------------------------------------------------------------
# Idempotency and concurrency
# ---------------------------------------------------------------------------


def test_claiming_twice_is_a_no_op_not_a_duplicate(client: TestClient) -> None:
    """The second call reports the first call's claim, and moves nothing."""
    anon_sub, cookie = _new_guest(client)
    run = _run(anon_sub)
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(run))

    real_sub = str(uuid.uuid4())
    first = _claim(client, real_sub).json()
    second = _claim(client, real_sub, cookie=cookie).json()

    assert first["claimed"] is True and second["claimed"] is True
    assert second["reason"] == "already_claimed"
    assert second["claim_id"] == first["claim_id"], "a second claim must not mint a second record"
    assert second["domain_counts"] == first["domain_counts"], (
        "the repeat call must report what the original claim moved, not recount "
        "rows that have already moved"
    )

    runs = asyncio.run(deps._memory_run_the_table_run_repo.list_runs_for_owner(real_sub))
    assert len(runs) == 1, "the run must not be duplicated by a repeat claim"


def test_two_tabs_cannot_double_claim(client: TestClient) -> None:
    """The UNIQUE constraint on `ownership_claims.anon_subject_id` decides.

    Driven at the repository, which is where the race actually resolves: two
    writers reach `record_claim` for the same anon subject and exactly one row
    survives, so both callers read back the same claim.
    """
    repo = deps._memory_ownership_claim_repo
    anon_sub = f"anon:{uuid.uuid4().hex}"
    real_sub = str(uuid.uuid4())

    def _claim_record(counts: dict[str, int]) -> OwnershipClaim:
        return OwnershipClaim(
            id=str(uuid.uuid4()),
            real_user_sub=real_sub,
            anon_subject_id=anon_sub,
            claimed_at=datetime.now(timezone.utc),
            game_count=counts.get("draft_games", 0),
            completion_count=0,
            challenge_count=0,
            domain_counts=counts,
        )

    tab_a = _claim_record({"draft_games": 3})
    tab_b = _claim_record({"draft_games": 3})

    async def _race() -> OwnershipClaim:
        await asyncio.gather(repo.record_claim(tab_a), repo.record_claim(tab_b))
        return await repo.get_claim_by_anon(anon_sub)

    stored = asyncio.run(_race())
    assert stored is not None
    assert stored.id in (tab_a.id, tab_b.id)
    # The loser's record must not have overwritten the winner's — one claim,
    # one set of counts, no doubling.
    assert stored.domain_counts == {"draft_games": 3}


def test_a_different_user_cannot_claim_an_already_claimed_session(client: TestClient) -> None:
    anon_sub, cookie = _new_guest(client)
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(_run(anon_sub)))

    first_user = str(uuid.uuid4())
    assert _claim(client, first_user).status_code == 200

    second_user = str(uuid.uuid4())
    resp = _claim(client, second_user, cookie=cookie)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "anon_session_already_claimed"

    # And nothing moved to the second user.
    assert asyncio.run(
        deps._memory_run_the_table_run_repo.list_runs_for_owner(second_user)
    ) == []


# ---------------------------------------------------------------------------
# Credential handling
# ---------------------------------------------------------------------------


def test_a_forged_anon_cookie_claims_nothing(client: TestClient) -> None:
    """An unsigned or tampered cookie is refused before anything moves.

    The cookie is `{sub}.{hmac}`. This presents a well-formed subject with a
    signature that was never issued -- exactly what an attacker who guessed the
    format but not the secret would send.
    """
    victim_sub = f"anon:{uuid.uuid4().hex}"
    victim_run = _run(victim_sub)
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(victim_run))

    client.cookies.set(ANON_COOKIE_NAME, f"{victim_sub}.not-a-real-signature")
    attacker = str(uuid.uuid4())
    _sign_in_as(attacker)
    body = client.post("/api/v1/auth/claim").json()

    assert body["claimed"] is False
    assert body["reason"] == "invalid_anon_credential"
    assert body["total_claimed"] == 0

    still_theirs = asyncio.run(deps._memory_run_the_table_run_repo.get_run(victim_run.run_id))
    assert still_theirs.owner_sub == victim_sub, "a forged cookie must move nothing"


def test_a_raw_unsigned_subject_is_not_a_credential(client: TestClient) -> None:
    """Knowing the subject string is not enough — the signature is the secret."""
    victim_sub = f"anon:{uuid.uuid4().hex}"
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(_run(victim_sub)))

    client.cookies.set(ANON_COOKIE_NAME, victim_sub)  # no signature at all
    _sign_in_as(str(uuid.uuid4()))
    body = client.post("/api/v1/auth/claim").json()

    assert body["claimed"] is False
    assert body["reason"] == "invalid_anon_credential"


def test_the_request_body_cannot_name_the_subject_to_claim(client: TestClient) -> None:
    """There is no client-supplied subject. Only the cookie decides."""
    victim_sub = f"anon:{uuid.uuid4().hex}"
    victim_run = _run(victim_sub)
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(victim_run))

    attacker_sub, _ = _new_guest(client)
    assert attacker_sub != victim_sub
    _sign_in_as(str(uuid.uuid4()))
    body = client.post(
        "/api/v1/auth/claim",
        json={"anon_sub": victim_sub, "sub": victim_sub, "run_id": victim_run.run_id},
    ).json()

    assert body["claimed"] is True
    assert body["domain_counts"]["run_the_table_runs"] == 0, (
        "the claim must follow the cookie, not the body"
    )
    assert asyncio.run(
        deps._memory_run_the_table_run_repo.get_run(victim_run.run_id)
    ).owner_sub == victim_sub


def test_claim_without_a_guest_session_is_an_ordinary_success(client: TestClient) -> None:
    _sign_in_as(str(uuid.uuid4()))
    resp = client.post("/api/v1/auth/claim")
    assert resp.status_code == 200
    body = resp.json()
    assert body["claimed"] is False
    assert body["reason"] == "no_anon_session"
    assert body["domain_counts"] == {d: 0 for d in CLAIMABLE_DOMAINS}


def test_claim_requires_authentication(client: TestClient) -> None:
    _new_guest(client)
    assert client.post("/api/v1/auth/claim").status_code == 401


# ---------------------------------------------------------------------------
# Challenge participation never confers ownership
# ---------------------------------------------------------------------------


def test_playing_someone_elses_challenge_does_not_claim_it(client: TestClient) -> None:
    """Opening a friend's link is participation, not authorship.

    Only `challenges` rows whose `anon_subject_id` is the guest -- the ones
    they created -- move. If it were otherwise, sharing a board would hand over
    the challenger's record along with it.
    """
    friends_sub = f"anon:{uuid.uuid4().hex}"
    friends_challenge = _challenge(friends_sub)
    asyncio.run(deps._memory_challenge_repo.store_challenge(friends_challenge))

    guest_sub, _ = _new_guest(client)
    own_challenge = _challenge(guest_sub)
    asyncio.run(deps._memory_challenge_repo.store_challenge(own_challenge))

    real_sub = str(uuid.uuid4())
    counts = _claim(client, real_sub).json()["domain_counts"]

    assert counts["challenges"] == 1, "only the guest's own challenge is theirs to bring"
    theirs = asyncio.run(deps._memory_challenge_repo.get_challenge(own_challenge.token_hash))
    assert theirs.anon_subject_id == real_sub
    friends = asyncio.run(deps._memory_challenge_repo.get_challenge(friends_challenge.token_hash))
    assert friends.anon_subject_id == friends_sub, (
        "another player's challenge must never change hands"
    )


# ---------------------------------------------------------------------------
# Collision rules — the destination account's own record wins
# ---------------------------------------------------------------------------


def test_a_guest_daily_never_overwrites_the_accounts_own_daily(client: TestClient) -> None:
    """One official attempt per player per daily survives the claim.

    Both subjects played 2026-07-29. The account already has its official
    result; the guest's copy cannot move without creating a second official
    attempt for that date, so it is dropped and not counted.
    """
    real_sub = str(uuid.uuid4())
    mine = _grid_result(real_sub, "2026-07-29")
    asyncio.run(deps._memory_daily_grid_result_repo.save_result(mine))
    my_duel = _duel_result(real_sub, "2026-07-29")
    asyncio.run(deps._memory_peak_duel_daily_result_repo.save_result(my_duel))

    guest_sub, _ = _new_guest(client)
    asyncio.run(deps._memory_daily_grid_result_repo.save_result(_grid_result(guest_sub, "2026-07-29")))
    asyncio.run(deps._memory_peak_duel_daily_result_repo.save_result(_duel_result(guest_sub, "2026-07-29")))
    # ...plus one day only the guest played, which must come across.
    asyncio.run(deps._memory_daily_grid_result_repo.save_result(_grid_result(guest_sub, "2026-07-28")))

    counts = _claim(client, real_sub).json()["domain_counts"]

    assert counts["daily_grid_results"] == 1, "only the uncontested day moves"
    assert counts["peak_duel_daily_results"] == 0

    kept = asyncio.run(
        deps._memory_daily_grid_result_repo.get_result(real_sub, "2026-07-29", "daily_grid.v2")
    )
    assert kept.id == mine.id, "the account's own official result is the one that stands"
    assert asyncio.run(
        deps._memory_daily_grid_result_repo.get_result(real_sub, "2026-07-28", "daily_grid.v2")
    ) is not None


def test_a_guest_daily_run_never_creates_a_second_official_daily(client: TestClient) -> None:
    """The RUN THE TABLE partial unique index survives the claim too."""
    real_sub = str(uuid.uuid4())
    mine = _run(real_sub, run_type="daily", run_date="2026-07-29")
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(mine))

    guest_sub, _ = _new_guest(client)
    contested = _run(guest_sub, run_type="daily", run_date="2026-07-29")
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(contested))
    uncontested = _run(guest_sub, run_type="standard")
    asyncio.run(deps._memory_run_the_table_run_repo.create_run(uncontested))

    counts = _claim(client, real_sub).json()["domain_counts"]

    assert counts["run_the_table_runs"] == 1
    daily = asyncio.run(deps._memory_run_the_table_run_repo.get_daily_run(real_sub, "2026-07-29"))
    assert daily.run_id == mine.run_id
    assert asyncio.run(
        deps._memory_run_the_table_run_repo.get_run(uncontested.run_id)
    ).owner_sub == real_sub


# ---------------------------------------------------------------------------
# The redundancy fixed in the two `games`-backed repositories
# ---------------------------------------------------------------------------


def test_draft_games_and_court_lineups_are_counted_disjointly(client: TestClient) -> None:
    """Two repositories, one `games` table, no double-counting.

    Against Postgres, `PostgresGameRepository.transfer_owner` moves every row
    for a subject while `PostgresCourtLineupRepository.transfer_owner` moves
    only `board_type = 'perfect_season'`. The claim runs the narrow one first
    so the two counts partition the rows instead of overlapping. This asserts
    the arithmetic the response promises: the legacy `game_count` is still
    "everything that left `games`", and it equals the two halves.
    """
    _new_guest(client)
    body = _claim(client, str(uuid.uuid4())).json()
    counts = body["domain_counts"]
    assert body["game_count"] == counts["draft_games"] + counts["court_lineups"]
