"""Test configuration — provides a TestClient with either real or fixture dataset."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Repository mode — decided HERE, before the app is imported
# ---------------------------------------------------------------------------
#
# `PEAK3_TEST_REPOSITORY_MODE` is the single switch, and `memory` is the
# default, because the ordinary suite is a unit suite: it reaches into
# `_memory_game_repo`, `_memory_daily_completion_repo` and their siblings
# directly, and none of those assertions mean anything against another backend.
#
# WHAT THIS FIXES. `Settings` read `apps/api/.env` unconditionally, so a
# developer with a `PEAK3_DATABASE_URL` in that untracked file ran the whole
# suite against a hosted Postgres while CI ran it in memory — the same command
# on the same commit, two different applications, and a CI failure that could
# not be reproduced locally no matter how exactly the command was copied. Two
# things make that impossible now: dotenv loading is turned off outright (see
# `_ENV_FILE` in app/core/config.py) and an inherited `PEAK3_DATABASE_URL` is
# removed rather than quietly honoured.
#
# The real-Postgres tests are unaffected: they are marked
# `supabase_integration`, take their connection string from
# `PEAK3_TEST_DATABASE_URL` through their own fixtures, and never read
# `PEAK3_DATABASE_URL`. Mixing the two modes in one process is refused below
# rather than resolved by precedence.
REPOSITORY_MODE = os.environ.get("PEAK3_TEST_REPOSITORY_MODE", "memory").strip().lower()

if REPOSITORY_MODE not in {"memory", "postgres"}:
    raise RuntimeError(
        f"PEAK3_TEST_REPOSITORY_MODE={REPOSITORY_MODE!r} is not a mode. Use "
        "'memory' (the default, and what scripts/ci/api-unit-tests.sh sets) or "
        "'postgres' (a local, deliberate run against a real backend — see the "
        "guard below; this is NOT what scripts/ci/api-integration-tests.sh or "
        "CI's supabase-integration job use, since those exercise "
        "tests/integration/ and test_repository_conformance.py directly "
        "against PEAK3_TEST_DATABASE_URL without going through this switch)."
    )

if REPOSITORY_MODE == "memory":
    # No dotenv, and no inherited connection string. Both halves matter: the
    # file is how it leaks on a laptop, the variable is how it leaks in a shell
    # that has been `source`d.
    os.environ["PEAK3_ENV_FILE"] = ""
    _leaked_database_url = os.environ.pop("PEAK3_DATABASE_URL", None)
    if _leaked_database_url:
        print(
            "\n[conftest] PEAK3_DATABASE_URL was set in the environment and has "
            "been ignored: this suite runs in explicit memory mode. Use "
            "PEAK3_TEST_REPOSITORY_MODE=postgres for the Postgres-backed run.\n",
            file=sys.stderr,
            flush=True,
        )
else:
    # THE GUARD THIS BLOCK EXISTS FOR (launch-polish, IDENTITY_AUDIT.md §1.3).
    #
    # A prior version of this branch accepted `PEAK3_DATABASE_URL` as the
    # connection string, falling back to `PEAK3_TEST_DATABASE_URL` only if
    # unset. `PEAK3_DATABASE_URL` is the EXACT variable name the deployed
    # staging/production API reads (docs/implementation/STAGING_DEPLOYMENT.md
    # §3) and is exactly the variable a developer's local `apps/api/.env` or
    # shell holds while doing ordinary hands-on staging verification. Running
    # this repo's own functional suite in postgres mode — most concretely,
    # `apps/api/tests/test_perfect_season.py`'s `leaderboard_client` fixture,
    # which plays full games and calls the real `/submit` route — with that
    # variable silently honoured writes real rows into whatever database it
    # points at. That is confirmed, not hypothetical: it is what produced the
    # 32 contaminated rows on the staging 82-0 leaderboard documented in
    # docs/implementation/launch-polish/IDENTITY_AUDIT.md §1 (seed set, seed
    # order, and respin pattern all trace to this exact test file).
    #
    # The fix has two independent parts, because either one alone is a single
    # point of failure someone eventually types past without thinking:
    #
    #   1. This process NEVER reads `PEAK3_DATABASE_URL` as a source of truth
    #      for its own connection, even as a fallback. Only the deliberately,
    #      differently-named `PEAK3_TEST_DATABASE_URL` is accepted — the same
    #      variable `tests/integration/` and `test_repository_conformance.py`
    #      already use directly, and the ONLY variable CI's supabase-integration
    #      job ever sets (`.github/workflows/ci.yml`). A leftover
    #      `PEAK3_DATABASE_URL` in the environment cannot silently become the
    #      target: it is not even inspected until after both gates below pass,
    #      and then only to warn that it is being ignored.
    #   2. A second, INDEPENDENT explicit opt-in —
    #      `PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS=1` — is required in addition to
    #      the URL. This is the literal "explicitly marked as a destructive
    #      staging test" the brief asks for: a human has to type a second,
    #      differently-shaped acknowledgement that this run performs real
    #      writes, not just happen to have a Postgres URL sitting in their
    #      shell. A stray `.env` cannot satisfy this by accident the way it
    #      could satisfy a URL check alone.
    #
    # Both checks run and raise BEFORE `app.main` is imported below (i.e. at
    # collection time, when this module is first loaded) — a RuntimeError
    # here aborts the whole pytest invocation with a clear message, never a
    # warning buried mid-run. See test_postgres_mode_guard.py, which asserts
    # this by spawning pytest as a subprocess under each missing-gate
    # condition and checking it refuses to even collect.
    _pg_url = os.environ.get("PEAK3_TEST_DATABASE_URL")
    if not _pg_url:
        raise RuntimeError(
            "PEAK3_TEST_REPOSITORY_MODE=postgres but PEAK3_TEST_DATABASE_URL is "
            "not set. Point it at an isolated test project — never a shared or "
            "production one, and never PEAK3_DATABASE_URL (that name is read "
            "only by the deployed API, never by this test process, on purpose: "
            "see docs/implementation/launch-polish/IDENTITY_AUDIT.md §1.3)."
        )
    if os.environ.get("PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS", "").strip() != "1":
        raise RuntimeError(
            "PEAK3_TEST_REPOSITORY_MODE=postgres also requires "
            "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS=1, set as a second, independent "
            "acknowledgement. This mode runs the app's real functional suite — "
            "including tests that create games, complete them, and submit to "
            "the global leaderboard — against whatever database "
            "PEAK3_TEST_DATABASE_URL points at. Set this flag only alongside a "
            "PEAK3_TEST_DATABASE_URL you have personally confirmed is an "
            "isolated test project, never a shared or deployed one."
        )
    _leaked_database_url = os.environ.get("PEAK3_DATABASE_URL")
    if _leaked_database_url:
        print(
            "\n[conftest] PEAK3_DATABASE_URL is also set in this environment "
            "and has been ignored: postgres-mode tests connect ONLY through "
            "PEAK3_TEST_DATABASE_URL, never PEAK3_DATABASE_URL, even when both "
            "are present.\n",
            file=sys.stderr,
            flush=True,
        )
    # `Settings` reads `PEAK3_DATABASE_URL`, so the approved test URL is
    # written under that name for the app to pick up — this is wiring the
    # already-vetted value through, not re-accepting whatever was there.
    os.environ["PEAK3_DATABASE_URL"] = _pg_url

from app.core.dataset import dataset_store  # noqa: E402
from app.main import app  # noqa: E402

# ---------------------------------------------------------------------------
# Fixture dataset — used when data/web/ has not been generated yet
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
WEB_DATA_DIR = REPO_ROOT / "data" / "web"


def _make_peak(
    player_num: int,
    duration: int,
    rank: int,
    prime_index: float,
) -> dict:
    """Build a synthetic peak window record."""
    player_slug = f"player-{player_num:03d}"
    first = f"First{player_num:03d}"
    last = f"Last{player_num:03d}"
    season = f"200{player_num % 10}-{(player_num % 10) + 1:02d}"
    peak_id = f"{player_slug}-{duration}yr-{season.replace('-', '')}"
    return {
        "id": peak_id,
        "player_id": player_slug,
        "player_slug": player_slug,
        "player_name": f"{first} {last}",
        "duration_years": duration,
        "start_season": season,
        "end_season": season,
        "anchor_season": season,
        "rank": rank,
        "prime_score": round(90.0 - rank * 0.5, 2),
        "prime_index": round(prime_index, 4),
        "components": {
            "statistical_impact": round(prime_index * 0.40, 4),
            "traditional_production": round(prime_index * 0.22, 4),
            "individual_recognition": round(prime_index * 0.21, 4),
            "postseason_individual_value": round(prime_index * 0.13, 4),
            "team_achievement": round(prime_index * 0.03, 4),
            "teammate_adjustment": round(-prime_index * 0.01, 4),
        },
        "data_status": "complete",
    }


def _build_fixture_leaderboards(player_count: int = 30) -> dict[int, list[dict]]:
    durations = [1, 2, 3, 5]
    lbs: dict[int, list[dict]] = {}
    for d in durations:
        rows = []
        for i in range(1, player_count + 1):
            prime_index = round(90.0 - i * 1.5 + (d * 0.1), 4)
            rows.append(_make_peak(i, d, i, prime_index))
        lbs[d] = rows
    return lbs


FIXTURE_LEADERBOARDS = _build_fixture_leaderboards(30)
FIXTURE_METADATA = {
    "schema_version": "1.0.0",
    "model_version": "peak3-2026",
    "generated_at": "2026-06-28T00:00:00Z",
    "source_commit": "fixture",
    "supported_durations": [1, 2, 3, 5],
    "player_count": 30,
    "peak_window_count": 120,
    "source_artifacts": ["fixture"],
}
FIXTURE_METHODOLOGY: dict = {
    "weights": {
        "statistical_impact": 38,
        "traditional_production": 21,
        "individual_recognition": 20,
        "postseason_individual_value": 18,
        "team_achievement": 3,
    }
}


#: True when the session is running against FIXTURE_LEADERBOARDS -- 30 synthetic
#: players named `First001 Last001` -- rather than the real generated dataset.
#:
#: This flag exists because the fallback below is genuinely useful (most of the
#: 868 API tests have nothing to do with leaderboard content, and requiring a
#: build step to run them would be hostile) but is also genuinely dangerous: the
#: leaderboard endpoints will happily serve fabricated players and every
#: assertion about them will pass. Before this pass that substitution was
#: completely silent. Now it is announced on stderr and observable in-process,
#: so a test that MUST see real data can refuse to run against fixtures instead
#: of quietly proving nothing. See docs/implementation/RANKINGS_SYNC_REPORT.md.
USING_FIXTURE_DATASET = False


def _load_dataset() -> None:
    """Load the real generated dataset, falling back to fixtures loudly."""
    global USING_FIXTURE_DATASET
    if WEB_DATA_DIR.exists() and (WEB_DATA_DIR / "leaderboards.json").exists():
        dataset_store.load(WEB_DATA_DIR)
        return

    USING_FIXTURE_DATASET = True
    print(
        "\n"
        "==============================================================\n"
        "  data/web/leaderboards.json is MISSING.\n"
        "  Falling back to 30 SYNTHETIC players (First001 Last001 ...).\n"
        "  Any test asserting on leaderboard CONTENT is now proving\n"
        "  nothing about the real model. Run:  make build-dataset\n"
        "==============================================================\n",
        file=sys.stderr,
        flush=True,
    )
    dataset_store.load_fixture(FIXTURE_LEADERBOARDS, FIXTURE_METADATA, FIXTURE_METHODOLOGY)


def requires_real_dataset() -> None:
    """Fail (never skip) when a content assertion would run against fixtures.

    Mirrors the policy in ``test_regression.py``: a parity check that silently
    disappears is worse than one that fails, because a green suite then reads as
    evidence the data is correct.
    """
    if USING_FIXTURE_DATASET:
        pytest.fail(
            "This test asserts on real leaderboard content but the session is "
            "running against synthetic fixture data. Run `make build-dataset` "
            "to generate data/web/, then re-run."
        )


# Load once for the entire test session
_load_dataset()


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as c:
        # The mode is ASSERTED, once, against what the application actually
        # resolved at startup — not merely requested through an environment
        # variable. `app.state.db_pool` is the single flag every `get_*_repo`
        # in core/dependencies.py branches on (see core/repository_registry.py),
        # so this one line is the whole backend for every domain.
        #
        # Without it, a leaked connection string turns into a scatter of
        # "expected 1, got 0" failures in whichever tests happen to inspect a
        # memory repo — a symptom that reads as broken product code and sends
        # you looking in the wrong place entirely.
        pool = getattr(app.state, "db_pool", None)
        if REPOSITORY_MODE == "memory":
            assert pool is None, (
                "PEAK3_TEST_REPOSITORY_MODE=memory but the app started with a "
                "PostgreSQL pool. Something re-introduced a connection string "
                "after conftest cleared it (a plugin, a sitecustomize, an "
                "explicit monkeypatch)."
            )
        else:
            assert pool is not None, (
                "PEAK3_TEST_REPOSITORY_MODE=postgres but the app fell back to "
                "in-memory repositories — the pool failed to initialise. The "
                "startup log above carries the connection error."
            )
        yield c


@pytest.fixture(autouse=True)
def _isolated_rate_limits():
    """Give every test a fresh rate-limit budget (Phase 11D).

    The `client` fixture is session-scoped, so without this the Daily Grid
    limits would be shared across the whole run: a test would pass or fail
    depending on how many requests the tests before it happened to make, and
    adding a test anywhere could break one somewhere else. Resetting per test
    makes each one's budget exactly the configured limit.

    Deliberately does NOT disable limiting. The limited path is the one that
    runs in production, so it should be the one the tests exercise; the
    429-behaviour tests then work by deliberately exceeding a limit rather than
    by turning a switch back on that nothing else uses.
    """
    from app.core.rate_limit import limiter

    limiter.reset()
    yield
    limiter.reset()


def reset_memory_repositories() -> list[str]:
    """Empty every in-memory repository singleton. Returns the names reset.

    HOW, AND WHY IT IS THIS WAY. Each singleton is re-initialised IN PLACE by
    calling its own `__init__` on itself:

        type(repo).__init__(repo)

    Two properties follow, and both are the point:

      * IT IS EXACT. Whatever `__init__` sets up is what a fresh repository has,
        so this cannot drift from the real constructor and cannot miss a field
        somebody adds later. Clearing a hand-written list of attributes would
        have to be maintained against twenty-two classes in fourteen files, and
        the failure mode of forgetting one is silent.
      * IT IS IN PLACE. Rebinding `dependencies._memory_daily_completion_repo`
        to a new instance would work for the app — `get_daily_completion_repo`
        reads the module global on every call — but EIGHT test modules import
        these singletons at module scope (`from app.core.dependencies import
        _memory_arena_repo`). Those names would go on pointing at the old
        object, so the test would inspect one store while the app wrote to
        another and its assertions would quietly stop meaning anything.

    Discovered by prefix rather than listed, so a new domain is covered the day
    it is wired rather than the day somebody remembers this file. Every one of
    the twenty-two takes no constructor arguments; `test_memory_repositories_
    can_all_be_reset` asserts that stays true.
    """
    from app.core import dependencies

    reset: list[str] = []
    for name, repo in vars(dependencies).items():
        if not name.startswith("_memory_"):
            continue
        type(repo).__init__(repo)
        reset.append(name)
    return reset


@pytest.fixture(autouse=True)
def _isolated_memory_repositories():
    """Give every test empty repositories, for the same reason as rate limits.

    THE FAILURE THIS CLOSES. `client` is session-scoped, so one anonymous
    subject — one `peak3_anon` cookie — plays every test in the run, and the
    memory repositories are module-level singletons that nothing emptied
    between test modules. `MemoryDailyCompletionRepository` is keyed on
    `(owner_sub, board_id)` and first-write-wins, which is correct: a player
    gets one recorded attempt at a daily board. So the FIRST test anywhere in
    the suite to finish today's `apex_1y` daily board took that key, and
    `test_daily_completion_is_recorded_on_finish` — which finishes the same
    board as the same subject and then asserts the record is its own — found
    the earlier test's row and failed on `c.game_id == game_id`.

    It passed alone, it passed in pairs, and it failed in the full suite: the
    signature of leaked state rather than of a bug in what was being tested.
    Nothing about the application is wrong here, and this fixture deliberately
    does NOT change it — the one-attempt rule, the date window the test
    searches, and the duplicate-attempt protection all stay exactly as they
    are. What changes is that a test no longer inherits the writes of the tests
    that ran before it.

    EVERY DOMAIN, NOT JUST THE ONE THAT BROKE. Daily completions are simply
    where it surfaced first; games, snapshots, profiles, ratings and arena
    matches are all the same shape of singleton behind the same session-scoped
    client. Resetting one domain would leave the next instance of this bug to
    be diagnosed from scratch.

    STATE SHARED WITHIN A SINGLE TEST IS UNAFFECTED. The reset happens once
    before the test function runs and once after it, so everything a test does
    — including multi-step fixtures it requests, and helpers that create a game
    and then finish it — sees one continuous store.
    """
    reset_memory_repositories()
    yield
    reset_memory_repositories()


@pytest.fixture(scope="session")
def fixture_leaderboards() -> dict[int, list[dict]]:
    return FIXTURE_LEADERBOARDS


@pytest.fixture(scope="session")
def fixture_metadata() -> dict:
    return FIXTURE_METADATA
