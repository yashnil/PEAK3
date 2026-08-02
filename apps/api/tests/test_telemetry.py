"""Telemetry ingest — API-layer tests (Track F).

WHAT THESE TESTS ARE ACTUALLY GUARDING. Most of this file is not about
telemetry working; it is about telemetry being unable to do the specific
harmful things a telemetry pipe is prone to. The three that matter:

  1. The event vocabulary is CLOSED. An event name nobody reviewed cannot be
     stored, so the set of things collected is the set of things in
     app/models/telemetry.py and nothing else.
  2. PII is REJECTED, LOUDLY. A payload carrying `email` / `token` /
     `authorization` is a 422 with a named code, not a silently-stripped field
     that leaves the offending call site emitting it forever.
  3. NOTHING LOGS A TOKEN. The ingest path is exercised with a real-looking
     bearer token and a full logging capture asserts the token never appears
     in any record, from any logger, at any level.

Plus the operational properties: the flag defaults OFF, the endpoint is
metered, and anonymous and authenticated callers both work.

THE FLAG IS ON FOR MOST OF THIS FILE via an autouse fixture that patches the
module constant. That is deliberate: the disabled path gets its own explicit
test (`test_disabled_by_default`) rather than being the accidental default of
every other assertion.
"""
from __future__ import annotations

import logging
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.telemetry import (
    EVENT_NAMES,
    MAX_EVENTS_PER_BATCH,
    MAX_PROPERTIES_PER_EVENT,
    MAX_STRING_VALUE_LENGTH,
    PROPERTY_KEYS,
    hash_subject,
    subject_kind,
)

INGEST_URL = "/api/v1/telemetry/events"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _enable_telemetry(monkeypatch):
    """Turn the feature on for this module.

    Patches in-process state rather than an env var so the change is scoped to
    the test and cannot leak into another module's process state.

    Both layers are patched on purpose. The route resolves the flag from
    `Settings` first and falls back to the module constant, so once
    `PEAK3_TELEMETRY_ENABLED` landed in `app/core/config.py` (defaulting to
    False, as a privacy-affecting collection path should), patching only the
    constant left the settings value winning and every ingest test 403-ing.
    """
    from app.api.v1 import telemetry as telemetry_module
    from app.core.config import settings

    monkeypatch.setattr(telemetry_module, "TELEMETRY_ENABLED", True)
    monkeypatch.setattr(settings, "TELEMETRY_ENABLED", True, raising=False)
    yield


@pytest.fixture(autouse=True)
def _clean_store():
    """Every test starts with an empty in-memory telemetry store.

    The repository is a module-level singleton (it has to be: it is the
    process's telemetry buffer), so without this a test asserting "exactly one
    event was written" would depend on what ran before it.
    """
    import asyncio

    from app.api.v1.telemetry import _memory_telemetry_repo

    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        _memory_telemetry_repo.clear()
    )
    yield


@pytest.fixture
def anon_client() -> TestClient:
    """A caller with its own cookie jar — i.e. its own anonymous identity."""
    with TestClient(app) as c:
        yield c


def _stored():
    """The in-memory store's contents, newest first."""
    import asyncio

    from app.api.v1.telemetry import _memory_telemetry_repo

    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        _memory_telemetry_repo.list_recent(500)
    )


def _batch(*events: dict) -> dict:
    return {"events": list(events)}


# ---------------------------------------------------------------------------
# The closed allowlist
# ---------------------------------------------------------------------------


class TestEventAllowlist:
    def test_the_shipped_allowlist_is_exactly_the_reviewed_set(self):
        """The list is the privacy contract, so it is asserted literally.

        If a track adds an event, this test fails and the addition gets read
        by a human — which is the entire point of a closed vocabulary.
        """
        assert EVENT_NAMES == {
            "auth_started",
            "auth_completed",
            "guest_state_claimed",
            "game_opened",
            "run_started",
            "run_ended",
            "tutorial_completed",
            "tutorial_skipped",
            "perk_selected",
            "node_selected",
            "card_bought",
            "trade_completed",
            "boss_won",
            "boss_lost",
            "table_cleared",
            "run_replayed",
            "challenge_created",
            "challenge_completed",
            "daily_opened",
            "daily_completed",
            "second_run_started",
        }

    @pytest.mark.parametrize("name", sorted(EVENT_NAMES))
    def test_every_allowlisted_name_is_accepted(self, anon_client: TestClient, name: str):
        resp = anon_client.post(INGEST_URL, json=_batch({"name": name, "props": {}}))
        assert resp.status_code == 202, resp.text

    @pytest.mark.parametrize(
        "name",
        [
            "definitely_not_an_event",
            "page_view",
            "run_started_v2",
            "user_email_captured",
        ],
    )
    def test_unknown_event_names_are_rejected(self, anon_client: TestClient, name: str):
        resp = anon_client.post(INGEST_URL, json=_batch({"name": name}))
        assert resp.status_code == 422
        assert resp.json()["detail"]["error_code"] == "unknown_event"
        assert _stored() == []

    def test_an_unknown_name_in_a_batch_rejects_the_whole_batch(
        self, anon_client: TestClient
    ):
        """No partial acceptance.

        A batch that half-lands would mean the client's queue and the server's
        record disagree, and would let an abuser smuggle one bad event per
        batch indefinitely at no cost.
        """
        resp = anon_client.post(
            INGEST_URL,
            json=_batch({"name": "run_started"}, {"name": "not_an_event"}),
        )
        assert resp.status_code == 422
        assert _stored() == []


# ---------------------------------------------------------------------------
# PII
# ---------------------------------------------------------------------------


class TestPiiIsRefused:
    @pytest.mark.parametrize(
        "key",
        ["email", "token", "authorization", "access_token", "password", "ip_address"],
    )
    def test_a_forbidden_property_key_is_rejected_by_name(
        self, anon_client: TestClient, key: str
    ):
        resp = anon_client.post(
            INGEST_URL,
            json=_batch({"name": "auth_completed", "props": {key: "value"}}),
        )
        assert resp.status_code == 422
        body = resp.json()["detail"]
        assert body["error_code"] == "forbidden_property"
        # The KEY may be named (it is drawn from our own vocabulary); the
        # VALUE must never be echoed.
        assert key in body["message"]
        assert _stored() == []

    def test_the_rejection_never_echoes_the_value(self, anon_client: TestClient):
        secret = "person@example.com"
        resp = anon_client.post(
            INGEST_URL, json=_batch({"name": "auth_completed", "props": {"email": secret}})
        )
        assert resp.status_code == 422
        assert secret not in resp.text
        assert "example.com" not in resp.text

    def test_a_key_outside_the_allowlist_is_rejected_even_if_innocuous(
        self, anon_client: TestClient
    ):
        resp = anon_client.post(
            INGEST_URL,
            json=_batch({"name": "run_started", "props": {"favourite_colour": "gold"}}),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["error_code"] == "unknown_property"

    def test_free_text_values_are_rejected(self, anon_client: TestClient):
        """The charset rule is what makes free text unrepresentable.

        An allowlisted KEY carrying a typed sentence, an email, or a JWT all
        fail the same slug rule — so a call site cannot smuggle user input
        through a legitimate dimension.
        """
        for value in [
            "I typed this into the search box!",
            "person@example.com",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.aaa",
            "Bearer abc123",
        ]:
            resp = anon_client.post(
                INGEST_URL, json=_batch({"name": "run_started", "props": {"mode": value}})
            )
            assert resp.status_code == 422, value
            assert resp.json()["detail"]["error_code"] == "invalid_property_value"

    def test_an_over_long_string_value_is_rejected(self, anon_client: TestClient):
        resp = anon_client.post(
            INGEST_URL,
            json=_batch(
                {
                    "name": "run_started",
                    "props": {"mode": "a" * (MAX_STRING_VALUE_LENGTH + 1)},
                }
            ),
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["error_code"] == "invalid_property_value"

    def test_too_many_properties_is_rejected(self, anon_client: TestClient):
        props = {key: 1 for key in sorted(PROPERTY_KEYS)[: MAX_PROPERTIES_PER_EVENT + 1]}
        resp = anon_client.post(
            INGEST_URL, json=_batch({"name": "run_ended", "props": props})
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["error_code"] == "too_many_properties"

    def test_a_stored_row_holds_no_raw_subject(self, anon_client: TestClient):
        """The identity on the row is a salted hash, not the subject."""
        anon_client.post(INGEST_URL, json=_batch({"name": "game_opened"}))
        cookie = anon_client.cookies.get("peak3_anon")
        assert cookie, "the ingest route should have issued an anon cookie"
        raw_subject = cookie.split(".", 1)[0]

        rows = _stored()
        assert len(rows) == 1
        row = rows[0]
        assert row.subject_hash != raw_subject
        assert len(row.subject_hash) == 64
        assert int(row.subject_hash, 16) >= 0  # hex
        assert raw_subject not in row.subject_hash

    def test_the_hash_is_keyed_not_a_bare_digest(self):
        """Two different secrets must give two different hashes.

        A bare SHA-256 of a Supabase UUID is reversible by anyone holding the
        user table; keying it is what makes an extract non-identifying.
        """
        assert hash_subject("anon:abc", "secret-a") != hash_subject("anon:abc", "secret-b")
        assert hash_subject("anon:abc", "s") == hash_subject("anon:abc", "s")

    def test_subject_kind_distinguishes_anon_from_user(self):
        assert subject_kind("anon:xyz") == "anon"
        assert subject_kind(str(uuid.uuid4())) == "user"


class TestNothingLogsATokenOrAPayload:
    def test_the_request_path_never_logs_a_bearer_token(
        self, anon_client: TestClient, caplog
    ):
        """Capture EVERY logger at DEBUG and assert the token is absent.

        The auth dependency logs verification failures by design, so an
        invalid token is the interesting case: it is the one code path that
        has both a token in hand and a reason to write a log line.
        """
        token = "eyJhbGciOiJIUzI1NiJ9.PEAK3TESTSECRETVALUE.signaturepart"
        with caplog.at_level(logging.DEBUG):
            resp = anon_client.post(
                INGEST_URL,
                json=_batch(
                    {"name": "auth_completed", "props": {"method": "magic_link"}}
                ),
                headers={"Authorization": f"Bearer {token}"},
            )
        assert resp.status_code == 202

        blob = "\n".join(r.getMessage() for r in caplog.records)
        assert token not in blob
        assert "PEAK3TESTSECRETVALUE" not in blob
        assert "Bearer" not in blob

    def test_a_rejected_payload_is_not_logged(self, anon_client: TestClient, caplog):
        secret = "person@example.com"
        with caplog.at_level(logging.DEBUG):
            anon_client.post(
                INGEST_URL,
                json=_batch({"name": "auth_started", "props": {"email": secret}}),
            )
        blob = "\n".join(r.getMessage() for r in caplog.records)
        assert secret not in blob


# ---------------------------------------------------------------------------
# Ingest behaviour
# ---------------------------------------------------------------------------


class TestBatchIngest:
    def test_a_batch_is_written_in_full(self, anon_client: TestClient):
        events = [
            {"name": "game_opened", "props": {"surface": "home"}},
            {"name": "run_started", "props": {"run_ref": "a1b2c3", "run_index": 1}},
            {"name": "perk_selected", "props": {"perk": "two_way_value", "run_ref": "a1b2c3"}},
            {"name": "run_ended", "props": {"outcome": "table_cleared", "run_ref": "a1b2c3"}},
        ]
        resp = anon_client.post(INGEST_URL, json={"events": events})
        assert resp.status_code == 202
        assert resp.json() == {"accepted": 4, "stored": True}

        rows = _stored()
        assert [r.event_name for r in rows] == [
            "run_ended",
            "perk_selected",
            "run_started",
            "game_opened",
        ]
        assert {r.subject_hash for r in rows} == {rows[0].subject_hash}

    def test_every_row_carries_a_retention_stamp(self, anon_client: TestClient):
        anon_client.post(INGEST_URL, json=_batch({"name": "daily_opened"}))
        row = _stored()[0]
        assert row.expires_at is not None
        assert row.expires_at > row.created_at

    def test_an_empty_batch_is_a_client_error(self, anon_client: TestClient):
        resp = anon_client.post(INGEST_URL, json={"events": []})
        assert resp.status_code == 422

    def test_an_oversized_batch_is_rejected(self, anon_client: TestClient):
        events = [{"name": "node_selected"}] * (MAX_EVENTS_PER_BATCH + 1)
        resp = anon_client.post(INGEST_URL, json={"events": events})
        assert resp.status_code == 422
        assert _stored() == []

    def test_unknown_top_level_keys_are_refused(self, anon_client: TestClient):
        resp = anon_client.post(
            INGEST_URL,
            json={"events": [{"name": "run_started", "user_agent": "Mozilla/5.0"}]},
        )
        assert resp.status_code == 422

    def test_the_response_reveals_nothing_about_stored_rows(self, anon_client: TestClient):
        resp = anon_client.post(INGEST_URL, json=_batch({"name": "table_cleared"}))
        assert set(resp.json()) == {"accepted", "stored"}


class TestIdentityPaths:
    def test_anonymous_ingest_works_and_issues_one_identity(self, anon_client: TestClient):
        first = anon_client.post(INGEST_URL, json=_batch({"name": "game_opened"}))
        assert first.status_code == 202
        second = anon_client.post(INGEST_URL, json=_batch({"name": "daily_opened"}))
        assert second.status_code == 202

        rows = _stored()
        assert len(rows) == 2
        # Same browser, same subject hash — which is what makes a funnel
        # countable without knowing who anyone is.
        assert rows[0].subject_hash == rows[1].subject_hash
        assert rows[0].subject_kind == "anon"

    def test_two_browsers_are_two_subjects(self, anon_client: TestClient):
        anon_client.post(INGEST_URL, json=_batch({"name": "game_opened"}))
        with TestClient(app) as other:
            other.post(INGEST_URL, json=_batch({"name": "game_opened"}))
        rows = _stored()
        assert len({r.subject_hash for r in rows}) == 2

    def test_authenticated_ingest_is_attributed_to_the_verified_sub(
        self, anon_client: TestClient, monkeypatch
    ):
        """An authenticated caller is recorded as `user`, keyed on the JWT sub.

        The token is verified through the real dependency; only the
        verification function is stubbed, so the route's own identity handling
        (resolve_owner_sub → hash → row) is exercised for real.
        """
        from app.core import auth as auth_module
        from app.core.config import settings

        user_sub = "11111111-2222-3333-4444-555555555555"

        async def _fake_verify(token: str) -> dict:
            return {"sub": user_sub, "aud": "authenticated", "exp": 9999999999}

        monkeypatch.setattr(auth_module, "verify_access_token", _fake_verify)

        resp = anon_client.post(
            INGEST_URL,
            json=_batch({"name": "auth_completed", "props": {"method": "magic_link"}}),
            headers={"Authorization": "Bearer any.token.here"},
        )
        assert resp.status_code == 202

        row = _stored()[0]
        assert row.subject_kind == "user"
        assert row.subject_hash == hash_subject(user_sub, settings.SIGNING_SECRET)
        assert user_sub not in row.subject_hash


class TestFeatureFlag:
    def test_disabled_by_default(self, monkeypatch):
        """With no operator opt-in, the route collects nothing.

        Asserted against the module constant AND the resolver, so a future
        Settings field that defaults to True would still fail here.
        """
        from app.api.v1 import telemetry as telemetry_module

        # Both layers, because the resolver prefers Settings. `TELEMETRY_ENABLED`
        # is now a real pydantic field, so its value lives on the settings
        # INSTANCE -- deleting the class attribute no longer hides it.
        monkeypatch.setattr(telemetry_module, "TELEMETRY_ENABLED", False)
        monkeypatch.setattr(
            telemetry_module.settings, "TELEMETRY_ENABLED", False, raising=False
        )

        with TestClient(app) as c:
            resp = c.post(INGEST_URL, json=_batch({"name": "game_opened"}))
        assert resp.status_code == 403
        assert resp.json()["detail"]["error_code"] == "telemetry_disabled"
        assert _stored() == []

    def test_the_shipped_default_constant_is_off(self):
        """Read from a fresh import of the module's own default expression."""
        from app.api.v1.telemetry import _env_bool

        assert _env_bool("PEAK3_TELEMETRY_ENABLED_DEFINITELY_UNSET_XYZ", False) is False


class TestRateLimiting:
    def test_the_ingest_endpoint_is_metered(self, monkeypatch):
        """An unauthenticated write endpoint without a limit is the abuse
        surface; this asserts the limit is actually wired, not merely
        available."""
        from app.api.v1 import telemetry as telemetry_module
        from app.core.rate_limit import limiter

        monkeypatch.setattr(telemetry_module, "TELEMETRY_RATE_LIMIT", 3)
        monkeypatch.setattr(
            telemetry_module.settings, "TELEMETRY_RATE_LIMIT", 3, raising=False
        )

        with TestClient(app) as c:
            # Warm-up: the first call is the one that MINTS the anon cookie,
            # and `client_key` folds that cookie's subject into the bucket key
            # -- so without this the pre-cookie request and the post-cookie
            # ones would land in two different buckets and the boundary being
            # asserted would be off by one. Reset after, so the budget under
            # test is exactly the configured limit.
            c.post(INGEST_URL, json=_batch({"name": "node_selected"}))
            limiter.reset()

            for i in range(3):
                assert (
                    c.post(INGEST_URL, json=_batch({"name": "node_selected"})).status_code
                    == 202
                ), i
            denied = c.post(INGEST_URL, json=_batch({"name": "node_selected"}))

        assert denied.status_code == 429
        assert denied.json()["detail"]["error_code"] == "rate_limited"
        assert int(denied.headers["Retry-After"]) >= 1
        # No budget information leaks — a remaining count is the calibration
        # signal a prober wants.
        assert "remaining" not in denied.text.lower()
        assert "x-ratelimit-remaining" not in {k.lower() for k in denied.headers}


class TestInMemoryBackendIsANoOpNotAFailure:
    def test_ingest_succeeds_with_no_database_configured(self, anon_client: TestClient):
        """The whole API test suite runs without a pool, so this asserts the
        state the suite is already in — deliberately, because "telemetry 500s
        when DATABASE_URL is unset" would take every local dev's console with
        it."""
        assert getattr(app.state, "db_pool", None) is None
        resp = anon_client.post(INGEST_URL, json=_batch({"name": "run_started"}))
        assert resp.status_code == 202
        assert resp.json()["stored"] is True

    def test_the_memory_store_is_bounded(self):
        """It must not grow without limit in a long dev session."""
        import asyncio

        from app.repositories.telemetry_memory import MemoryTelemetryRepository
        from app.repositories.telemetry_protocols import TelemetryEvent

        repo = MemoryTelemetryRepository(max_events=5)
        loop = asyncio.get_event_loop_policy().new_event_loop()
        loop.run_until_complete(
            repo.record_events(
                [
                    TelemetryEvent(
                        subject_hash="0" * 64, subject_kind="anon", event_name="run_started"
                    )
                    for _ in range(50)
                ]
            )
        )
        assert len(loop.run_until_complete(repo.list_recent(1000))) == 5

    def test_purge_removes_only_expired_rows(self):
        import asyncio
        from datetime import datetime, timedelta, timezone

        from app.repositories.telemetry_memory import MemoryTelemetryRepository
        from app.repositories.telemetry_protocols import TelemetryEvent

        now = datetime.now(timezone.utc)
        repo = MemoryTelemetryRepository()
        loop = asyncio.get_event_loop_policy().new_event_loop()
        loop.run_until_complete(
            repo.record_events(
                [
                    TelemetryEvent(
                        subject_hash="0" * 64,
                        subject_kind="anon",
                        event_name="run_started",
                        created_at=now - timedelta(days=200),
                        expires_at=now - timedelta(days=110),
                    ),
                    TelemetryEvent(
                        subject_hash="0" * 64,
                        subject_kind="anon",
                        event_name="run_ended",
                        created_at=now,
                        expires_at=now + timedelta(days=90),
                    ),
                ]
            )
        )
        assert loop.run_until_complete(repo.purge_expired(now)) == 1
        remaining = loop.run_until_complete(repo.list_recent(10))
        assert [r.event_name for r in remaining] == ["run_ended"]
