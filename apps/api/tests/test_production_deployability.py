"""Tests for `Settings._assert_deployable` / `warn_insecure_secret` — the
production fail-closed contract (public-platform-readiness Batch P5).

WHY THIS FILE DID NOT EXIST UNTIL NOW. This validator was the entire subject
of a prior manual verification pass (docs/implementation/STAGING_DEPLOYMENT.md
§4 — a table of checkmarks against each rejected case), but it had zero
automated regression coverage: nothing would have caught a future edit that
silently weakened one of these checks. That gap is exactly how the one real
bug found this batch went unnoticed — `self.DATABASE_URL is None` missed a
`PEAK3_DATABASE_URL=""` (defined-but-empty) shape a deploy platform can
produce for an unset variable reference; `main.py`'s lifespan() and
assert_production_ready() both independently catch it downstream (both use a
truthy check), so it was never a live boot-into-memory risk, but the earliest,
cheapest guard had a blind spot its two later layers did not share. Fixed to
`not self.DATABASE_URL`, matching every other check in this method.

ISOLATION. Every test below clears the process environment of PEAK3_/
NEXT_PUBLIC_ variables first and sets `PEAK3_ENV_FILE=""` to disable dotenv
loading — otherwise a developer's real `apps/api/.env` would be read into
every `Settings()` call here (pydantic-settings reads the file fresh on each
instantiation, independent of `os.environ`), making these tests describe
whatever happens to be in that file rather than the isolated case under test.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

_GOOD_PRODUCTION_ENV = {
    "PEAK3_DEBUG": "false",
    "PEAK3_SIGNING_SECRET": "a-real-random-secret-value-not-the-shipped-default",
    "PEAK3_DATABASE_URL": "postgresql://user:pass@real-host.example.com:5432/db",
    "PEAK3_SUPABASE_URL": "https://realproject.supabase.co",
    "PEAK3_CORS_ORIGINS": '["https://peak3.example.com"]',
}


def _settings(monkeypatch, overrides: dict[str, str]):
    """Build a `Settings()` with an isolated, dotenv-free environment.

    Deliberately does NOT touch `sys.modules["app.core.config"]`. An earlier
    version of this helper deleted and re-imported that module per test to
    force a fresh read of `PEAK3_ENV_FILE` — but `app.main` (imported once,
    at collection time, by every other test file) holds its own reference to
    the *original* `app.core.config` module's `settings` singleton, and a
    reload here creates a second, divergent module object. Any test file
    that patches `app.core.config.settings` after that (e.g.
    `tests/test_telemetry.py`'s autouse flag-enabling fixture) ends up
    patching a different object than the one `app`'s routes actually close
    over, and its assertions fail for reasons unrelated to what they test.
    `_env_file=None` disables dotenv loading for this one instance via
    pydantic-settings' own per-call override — no module reload needed, so
    the shared module/singleton is never disturbed.
    """
    import os

    for k in list(os.environ):
        if k.startswith("PEAK3_") or k.startswith("NEXT_PUBLIC_"):
            monkeypatch.delenv(k, raising=False)
    for k, v in overrides.items():
        monkeypatch.setenv(k, v)

    from app.core.config import Settings

    return Settings(_env_file=None)  # type: ignore[call-arg]


class TestGoodProductionConfigBoots:
    def test_a_correctly_configured_production_environment_boots(self, monkeypatch):
        s = _settings(monkeypatch, _GOOD_PRODUCTION_ENV)
        assert s.DEBUG is False
        assert s.DATABASE_URL == _GOOD_PRODUCTION_ENV["PEAK3_DATABASE_URL"]

    def test_debug_mode_with_no_database_url_still_boots(self, monkeypatch):
        """The in-memory dev fallback must remain available in DEBUG mode —
        this validator's job is refusing PRODUCTION misconfiguration, not
        making local development harder."""
        s = _settings(monkeypatch, {"PEAK3_DEBUG": "true"})
        assert s.DATABASE_URL is None


class TestProductionRefusesUnsafeDatabaseConfig:
    def test_missing_database_url(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_DATABASE_URL": ""}
        del overrides["PEAK3_DATABASE_URL"]
        with pytest.raises(Exception, match="PEAK3_DATABASE_URL"):
            _settings(monkeypatch, overrides)

    def test_empty_string_database_url(self, monkeypatch):
        """Regression test for the exact gap fixed this batch: a variable
        that is DEFINED but EMPTY must be treated the same as unset."""
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_DATABASE_URL": ""}
        with pytest.raises(Exception, match="PEAK3_DATABASE_URL"):
            _settings(monkeypatch, overrides)

    def test_localhost_database_url(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_DATABASE_URL": "postgresql://u:p@localhost:5432/db"}
        with pytest.raises(Exception, match="localhost"):
            _settings(monkeypatch, overrides)

    def test_docker_internal_database_url(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_DATABASE_URL": "postgresql://u:p@host.docker.internal:5432/db"}
        with pytest.raises(Exception, match="localhost"):
            _settings(monkeypatch, overrides)


class TestProductionRefusesUnsafeSigningSecret:
    def test_default_signing_secret(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_SIGNING_SECRET": "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION"}
        with pytest.raises(Exception, match="SIGNING_SECRET"):
            _settings(monkeypatch, overrides)


class TestProductionRefusesUnsafeCors:
    def test_wildcard_cors_with_credentials(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_CORS_ORIGINS": '["*"]'}
        with pytest.raises(Exception, match="CORS_ORIGINS"):
            _settings(monkeypatch, overrides)

    def test_empty_cors_origins(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_CORS_ORIGINS": "[]"}
        with pytest.raises(Exception, match="CORS_ORIGINS"):
            _settings(monkeypatch, overrides)

    def test_localhost_cors_origin(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_CORS_ORIGINS": '["http://localhost:3000"]'}
        with pytest.raises(Exception, match="CORS_ORIGINS"):
            _settings(monkeypatch, overrides)


class TestProductionRefusesUnsafeSupabaseUrl:
    def test_localhost_supabase_url(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_SUPABASE_URL": "http://localhost:54321"}
        with pytest.raises(Exception, match="localhost"):
            _settings(monkeypatch, overrides)

    def test_plaintext_http_supabase_url(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_SUPABASE_URL": "http://realproject.supabase.co"}
        with pytest.raises(Exception):
            _settings(monkeypatch, overrides)

    def test_no_auth_verification_configured(self, monkeypatch):
        overrides = {**_GOOD_PRODUCTION_ENV, "PEAK3_SUPABASE_URL": ""}
        del overrides["PEAK3_SUPABASE_URL"]
        with pytest.raises(Exception, match="[Tt]oken verification"):
            _settings(monkeypatch, overrides)
