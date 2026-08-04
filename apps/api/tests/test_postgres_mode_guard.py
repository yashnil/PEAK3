"""Proves the postgres-mode leak guard in conftest.py actually fires.

WHY THIS FILE HAS TO SPAWN A SUBPROCESS. The guard runs at MODULE level in
`tests/conftest.py`, before pytest has collected a single test — that is the
whole point (it must fail loudly at collection time, not mid-run). A test
living inside the same pytest process cannot observe its own conftest being
refused: by the time any test body runs, conftest.py has already been
imported successfully. The only way to prove the guard actually raises is to
launch a fresh `pytest` process under each broken environment and check that
IT refuses to even collect.

WHAT THIS PROTECTS AGAINST REGRESSING. IDENTITY_AUDIT.md §1.3 traces 32
contaminated rows on the staging 82-0 leaderboard to `PEAK3_TEST_REPOSITORY_MODE
=postgres` accepting `PEAK3_DATABASE_URL` — the exact variable name the
deployed API reads — as a connection string with no explicit acknowledgement
that doing so performs real writes. The fix has two independent gates (see
conftest.py's own comment): only `PEAK3_TEST_DATABASE_URL` is ever read, and
`PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS=1` is required in addition. Each is tested
in isolation here — missing either one must refuse — plus a case proving a
leftover `PEAK3_DATABASE_URL` is ignored (not used) once both real gates are
satisfied, and a case proving the pre-existing memory-mode guard was not
weakened while this file was touched.

Every subprocess targets `tests/test_health.py` (the smallest test module in
this suite) with `--collect-only`, so these assertions are fast and require
no real Postgres, no generated dataset, and no network access — the guard
raises before `app.main` is even imported, let alone before any database
connection is attempted (that only happens inside FastAPI's lifespan, which
`--collect-only` never triggers).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parent.parent
TARGET = "tests/test_health.py"

# Every env var this guard cares about, stripped from the child's environment
# before each case sets exactly the ones under test — so a variable leaking
# in from whoever is running this suite can never change the outcome.
_GUARD_VARS = (
    "PEAK3_TEST_REPOSITORY_MODE",
    "PEAK3_DATABASE_URL",
    "PEAK3_TEST_DATABASE_URL",
    "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS",
)


def _run(extra_env: dict[str, str]) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in _GUARD_VARS}
    env.update(extra_env)
    return subprocess.run(
        # -s disables pytest's own output capturing: the guard's print()
        # lines run at conftest IMPORT time, before any test exists to
        # attach captured output to, so without -s a successful collection
        # would swallow them entirely and the "ignored" assertions below
        # would never see them.
        [sys.executable, "-m", "pytest", TARGET, "--collect-only", "-q", "-s"],
        cwd=API_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_postgres_mode_refuses_without_test_database_url():
    """No PEAK3_TEST_DATABASE_URL at all -> loud refusal, nothing collected."""
    result = _run({"PEAK3_TEST_REPOSITORY_MODE": "postgres"})
    assert result.returncode != 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "PEAK3_TEST_DATABASE_URL is" in combined
    assert "not set" in combined


def test_postgres_mode_refuses_without_destructive_flag():
    """A real-looking PEAK3_TEST_DATABASE_URL alone is NOT enough -- the
    second, independent PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS=1 acknowledgement is
    still required. This is the case that matters most: it is exactly the
    state a developer who copied a connection string into their shell (for
    completely unrelated manual debugging) would be in, without ever having
    decided to run destructive tests against it."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "postgres",
            "PEAK3_TEST_DATABASE_URL": "postgresql://user:pw@example.invalid:5432/test",
        }
    )
    assert result.returncode != 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS" in combined


def test_postgres_mode_never_accepts_deploy_shaped_database_url_alone():
    """The literal failure mode from IDENTITY_AUDIT.md: PEAK3_DATABASE_URL is
    set (as it would be by a local .env used for staging debugging) but
    PEAK3_TEST_DATABASE_URL and the destructive flag are not. Must still
    refuse -- PEAK3_DATABASE_URL is never read as a fallback."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "postgres",
            "PEAK3_DATABASE_URL": "postgresql://user:pw@deployed.example.invalid:5432/staging",
        }
    )
    assert result.returncode != 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "PEAK3_TEST_DATABASE_URL is" in combined
    assert "not set" in combined


def test_postgres_mode_collects_when_both_gates_are_satisfied():
    """Both gates present -> collection succeeds. No real Postgres is
    contacted at collection time (the pool is created inside FastAPI's
    lifespan, never at import time), so a fake, unreachable URL is fine
    here -- this test is only proving the GUARD lets a legitimate,
    fully-acknowledged run through, not that the connection itself works."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "postgres",
            "PEAK3_TEST_DATABASE_URL": "postgresql://user:pw@example.invalid:5432/test",
            "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS": "1",
        }
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_postgres_mode_ignores_and_warns_about_a_leftover_deploy_url():
    """Both gates satisfied AND a leftover PEAK3_DATABASE_URL is present
    (the exact combination that would occur if the developer's shell had
    both a stray deploy URL and had correctly set up an isolated test run):
    collection still succeeds, but the leftover deploy URL must be reported
    as ignored, not silently used."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "postgres",
            "PEAK3_TEST_DATABASE_URL": "postgresql://user:pw@example.invalid:5432/test",
            "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS": "1",
            "PEAK3_DATABASE_URL": "postgresql://user:pw@deployed.example.invalid:5432/staging",
        }
    )
    assert result.returncode == 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "has been ignored" in combined


@pytest.mark.parametrize("destructive_flag", ["0", "yes", "true", "TRUE", ""])
def test_postgres_mode_rejects_anything_other_than_the_literal_flag(destructive_flag):
    """Only the literal string "1" satisfies the destructive-acknowledgement
    gate -- not "yes", not "true", not any other truthy-looking value. A
    strict literal match means there is exactly one spelling that works,
    which is what a copy-pasteable, greppable instruction needs."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "postgres",
            "PEAK3_TEST_DATABASE_URL": "postgresql://user:pw@example.invalid:5432/test",
            "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS": destructive_flag,
        }
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "PEAK3_ALLOW_DESTRUCTIVE_DB_TESTS" in result.stdout + result.stderr


def test_memory_mode_guard_is_not_weakened():
    """Regression check: memory mode (the default and what CI's unit-test job
    uses) must still ignore a leaked PEAK3_DATABASE_URL and collect
    successfully -- this file must not have narrowed that existing guard
    while adding the postgres-mode one."""
    result = _run(
        {
            "PEAK3_TEST_REPOSITORY_MODE": "memory",
            "PEAK3_DATABASE_URL": "postgresql://user:pw@deployed.example.invalid:5432/staging",
        }
    )
    assert result.returncode == 0, result.stdout + result.stderr
    combined = result.stdout + result.stderr
    assert "has been ignored" in combined


def test_default_mode_is_memory_and_collects_cleanly():
    """No PEAK3_TEST_REPOSITORY_MODE at all -> defaults to memory, no gates
    apply, nothing is refused."""
    result = _run({})
    assert result.returncode == 0, result.stdout + result.stderr
