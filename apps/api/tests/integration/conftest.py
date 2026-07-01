"""Shared fixtures for the Supabase integration-test suite (spec section A).

Every fixture here requires a real, isolated Supabase test project — these
tests must NEVER run against a shared/production project (they create real
users, apply real migrations, and probe RLS). Required environment
variables:

    PEAK3_TEST_SUPABASE_URL
    PEAK3_TEST_SUPABASE_ANON_KEY
    PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY
    PEAK3_TEST_DATABASE_URL

When any are absent, every test in this package is skipped with an explicit
"not configured" reason — never silently reported as passing. See
docs/implementation/PHASE_4_0_REPORT.md for why this suite is currently
"written but not yet run against a live project" in this environment.
"""
from __future__ import annotations

import os
import uuid

import pytest

REQUIRED_ENV_VARS = [
    "PEAK3_TEST_SUPABASE_URL",
    "PEAK3_TEST_SUPABASE_ANON_KEY",
    "PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY",
    "PEAK3_TEST_DATABASE_URL",
]


def _missing_env_vars() -> list[str]:
    return [name for name in REQUIRED_ENV_VARS if not os.environ.get(name)]


SUPABASE_NOT_CONFIGURED_REASON = (
    "Supabase integration tests not configured: missing {vars}. "
    "This is expected outside a dedicated CI job with test-project secrets — "
    "see docs/architecture/ADR-004-phase4-ranked.md section A and "
    "docs/implementation/PHASE_4_0_REPORT.md for what this gap means for "
    "ranked release readiness."
)

pytestmark = pytest.mark.supabase_integration


def _skip_reason() -> str | None:
    missing = _missing_env_vars()
    if missing:
        return SUPABASE_NOT_CONFIGURED_REASON.format(vars=", ".join(missing))
    return None


@pytest.fixture(scope="session", autouse=True)
def _require_supabase_test_project():
    reason = _skip_reason()
    if reason:
        pytest.skip(reason)


@pytest.fixture(scope="session")
def supabase_url() -> str:
    return os.environ["PEAK3_TEST_SUPABASE_URL"]


@pytest.fixture(scope="session")
def supabase_anon_key() -> str:
    return os.environ["PEAK3_TEST_SUPABASE_ANON_KEY"]


@pytest.fixture(scope="session")
def supabase_service_role_key() -> str:
    return os.environ["PEAK3_TEST_SUPABASE_SERVICE_ROLE_KEY"]


@pytest.fixture(scope="session")
def test_database_url() -> str:
    return os.environ["PEAK3_TEST_DATABASE_URL"]


@pytest.fixture
def unique_test_email() -> str:
    return f"peak3-e2e-{uuid.uuid4().hex[:12]}@example-test.invalid"


@pytest.fixture
def test_user_password() -> str:
    return f"Peak3TestPw!{uuid.uuid4().hex[:8]}"
