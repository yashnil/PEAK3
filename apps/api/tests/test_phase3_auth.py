"""Phase 3.0 tests — auth, anonymous ownership, claim, profiles, history.

Uses dependency_overrides to inject authenticated subjects without needing
a real Supabase JWT secret in the test environment.
"""
from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import (
    AuthSubject,
    get_optional_auth,
    get_required_auth,
)
from app.main import app
from app.repositories.memory import (
    MemoryDailyCompletionRepository,
    MemoryOwnershipClaimRepository,
    MemoryResultSnapshotRepository,
)
from app.repositories.protocols import DailyCompletion, ResultSnapshot


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth(
    sub: str | None = None,
    email: str = "test@example.com",
    is_anonymous: bool = False,
) -> AuthSubject:
    return AuthSubject(
        sub=sub or str(uuid.uuid4()),
        email=email,
        is_anonymous=is_anonymous,
        raw_claims={},
    )


def _make_client(subject: AuthSubject | None = None) -> TestClient:
    """Return a TestClient with optional auth dependency override."""
    overrides: dict = {}
    if subject is not None:
        overrides[get_optional_auth] = lambda: subject
        overrides[get_required_auth] = lambda: subject
    app.dependency_overrides.update(overrides)
    client = TestClient(app, raise_server_exceptions=True)
    return client


def _clear_overrides() -> None:
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------


class TestGetMe:
    def test_unauthenticated_issues_anon_cookie(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get("/api/v1/auth/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["authenticated"] is False
        assert data["is_anonymous"] is True
        assert data["sub"].startswith("anon:")

    def test_authenticated_returns_identity(self):
        subject = _auth(sub="user-abc", email="alice@example.com")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/auth/me")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["authenticated"] is True
        assert data["sub"] == "user-abc"
        assert data["email"] == "alice@example.com"

    def test_existing_valid_anon_cookie_is_reused(self):
        """A valid peak3_anon cookie must return the same sub."""
        _clear_overrides()
        with TestClient(app) as client:
            r1 = client.get("/api/v1/auth/me")
            # Cookie is set; second request re-uses it
            r2 = client.get("/api/v1/auth/me")
        assert r1.json()["sub"] == r2.json()["sub"]


# ---------------------------------------------------------------------------
# POST /auth/anon
# ---------------------------------------------------------------------------


class TestCreateAnon:
    def test_creates_anon_subject(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.post("/api/v1/auth/anon")
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_anonymous"] is True
        assert data["sub"].startswith("anon:")

    def test_idempotent_with_existing_cookie(self):
        _clear_overrides()
        with TestClient(app) as client:
            r1 = client.post("/api/v1/auth/anon")
            sub1 = r1.json()["sub"]
            r2 = client.post("/api/v1/auth/anon")
            sub2 = r2.json()["sub"]
        assert sub1 == sub2


# ---------------------------------------------------------------------------
# POST /auth/claim
# ---------------------------------------------------------------------------


class TestClaimAnonActivity:
    def test_claim_requires_auth(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.post("/api/v1/auth/claim")
        assert resp.status_code == 401

    def test_claim_no_anon_cookie_returns_no_anon_session(self):
        subject = _auth()
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.post("/api/v1/auth/claim")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["claimed"] is False
        assert data["reason"] == "no_anon_session"

    def test_claim_invalid_anon_cookie(self):
        subject = _auth()
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            client.cookies.set("peak3_anon", "definitely.not.valid")
            resp = client.post("/api/v1/auth/claim")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["claimed"] is False
        assert data["reason"] == "invalid_anon_credential"

    def test_full_claim_flow(self):
        """Anon gets a cookie, claim transfers ownership."""
        _clear_overrides()
        # Step 1 — establish anon session via /auth/anon
        with TestClient(app) as client:
            anon_resp = client.post("/api/v1/auth/anon")
            assert anon_resp.status_code == 200
            # The anon cookie is now set in the client's cookie jar
            anon_sub = anon_resp.json()["sub"]
            assert anon_sub.startswith("anon:")

            # Step 2 — authenticate and claim
            real_sub = str(uuid.uuid4())
            subject = _auth(sub=real_sub)
            app.dependency_overrides[get_optional_auth] = lambda: subject
            app.dependency_overrides[get_required_auth] = lambda: subject

            claim_resp = client.post("/api/v1/auth/claim")

        _clear_overrides()
        assert claim_resp.status_code == 200
        data = claim_resp.json()
        assert data["claimed"] is True
        assert data["reason"] == "claimed"
        assert "claim_id" in data

    def test_double_claim_by_same_user_is_idempotent(self):
        _clear_overrides()
        with TestClient(app) as client:
            # Get anon cookie
            client.post("/api/v1/auth/anon")

            real_sub = str(uuid.uuid4())
            subject = _auth(sub=real_sub)
            app.dependency_overrides[get_optional_auth] = lambda: subject
            app.dependency_overrides[get_required_auth] = lambda: subject

            r1 = client.post("/api/v1/auth/claim")
            claim_id = r1.json().get("claim_id")

            # Cookie is cleared after claim; second claim has no_anon_session
            r2 = client.post("/api/v1/auth/claim")

        _clear_overrides()
        assert r1.status_code == 200
        assert r1.json()["claimed"] is True
        # After claim, cookie deleted — second call returns no_anon_session
        assert r2.json()["reason"] in ("no_anon_session", "already_claimed")


# ---------------------------------------------------------------------------
# GET/PUT /profiles/me
# ---------------------------------------------------------------------------


class TestMyProfile:
    def test_requires_auth(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get("/api/v1/profiles/me")
        assert resp.status_code == 401

    def test_get_creates_default_profile(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/profiles/me")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["handle"] is None
        assert data["is_public"] is False
        assert "joined_at" in data

    def test_update_handle_and_display_name(self):
        sub = f"user-{uuid.uuid4()}"
        subject = _auth(sub=sub)
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.put(
                "/api/v1/profiles/me",
                json={"handle": "TestUser42", "display_name": "Test User"},
            )
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["handle"] == "testuser42"  # normalized to lowercase
        assert data["display_name"] == "Test User"

    def test_handle_validation_rejects_invalid(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.put(
                "/api/v1/profiles/me",
                json={"handle": "ab"},  # too short (min 3)
            )
        _clear_overrides()
        assert resp.status_code == 422

    def test_duplicate_handle_returns_409(self):
        sub_a = f"user-{uuid.uuid4()}"
        sub_b = f"user-{uuid.uuid4()}"
        handle = f"uniquehandle{uuid.uuid4().hex[:6]}"

        # User A claims the handle
        subject_a = _auth(sub=sub_a)
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject_a
        app.dependency_overrides[get_required_auth] = lambda: subject_a
        with TestClient(app) as client:
            r1 = client.put("/api/v1/profiles/me", json={"handle": handle})
        assert r1.status_code == 200

        # User B tries to take the same handle
        subject_b = _auth(sub=sub_b)
        app.dependency_overrides[get_optional_auth] = lambda: subject_b
        app.dependency_overrides[get_required_auth] = lambda: subject_b
        with TestClient(app) as client:
            r2 = client.put("/api/v1/profiles/me", json={"handle": handle})
        _clear_overrides()
        assert r2.status_code == 409
        assert r2.json()["detail"] == "handle_taken"


# ---------------------------------------------------------------------------
# GET/PUT /profiles/me/settings
# ---------------------------------------------------------------------------


class TestMySettings:
    def test_get_default_settings(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/profiles/me/settings")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["timezone"] == "UTC"
        assert data["reduced_motion"] is False

    def test_update_settings(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.put(
                "/api/v1/profiles/me/settings",
                json={"timezone": "America/New_York", "reduced_motion": True},
            )
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["timezone"] == "America/New_York"
        assert data["reduced_motion"] is True


# ---------------------------------------------------------------------------
# GET /profiles/{handle} — public profile
# ---------------------------------------------------------------------------


class TestPublicProfile:
    def _create_profile_with_handle(self, handle: str, is_public: bool) -> str:
        sub = f"user-{uuid.uuid4()}"
        subject = _auth(sub=sub)
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            client.put("/api/v1/profiles/me", json={"handle": handle, "is_public": is_public})
        _clear_overrides()
        return sub

    def test_public_profile_visible_to_all(self):
        handle = f"pubuser{uuid.uuid4().hex[:6]}"
        self._create_profile_with_handle(handle, is_public=True)

        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get(f"/api/v1/profiles/{handle}")
        assert resp.status_code == 200
        assert resp.json()["handle"] == handle

    def test_private_profile_hidden_to_others(self):
        handle = f"privuser{uuid.uuid4().hex[:6]}"
        self._create_profile_with_handle(handle, is_public=False)

        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get(f"/api/v1/profiles/{handle}")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "profile_private"

    def test_owner_can_read_own_private_profile(self):
        handle = f"ownpriv{uuid.uuid4().hex[:6]}"
        sub = self._create_profile_with_handle(handle, is_public=False)

        subject = _auth(sub=sub)
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get(f"/api/v1/profiles/{handle}")
        _clear_overrides()
        assert resp.status_code == 200

    def test_unknown_handle_returns_404(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get("/api/v1/profiles/does_not_exist_xyzxyz")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /history and GET /history/{result_id}
# ---------------------------------------------------------------------------


class TestHistory:
    async def _inject_snapshot(self, owner_sub: str) -> str:
        """Directly inject a ResultSnapshot into the in-memory singleton repo."""
        from app.core.dependencies import _memory_result_snapshot_repo

        result_id = str(uuid.uuid4())
        snap = ResultSnapshot(
            id=result_id,
            owner_sub=owner_sub,
            game_id=str(uuid.uuid4()),
            board_id="daily-apex_1y-2026-06-30",
            board_type="daily",
            mode="apex_1y",
            lineup_peak_rating=85.5,
            draft_efficiency=0.92,
            board_percentile=12.0,
            completed_at=datetime.now(timezone.utc),
            payload={"date": "2026-06-30", "draft_points": 850},
        )
        await _memory_result_snapshot_repo.record_result(snap)
        return result_id

    def test_history_requires_auth(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get("/api/v1/history")
        assert resp.status_code == 401

    def test_empty_history(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/history")
        _clear_overrides()
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["next_cursor"] is None

    def test_get_result_requires_auth(self):
        _clear_overrides()
        with TestClient(app) as client:
            resp = client.get("/api/v1/history/some-id")
        assert resp.status_code == 401

    def test_get_result_not_found(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/history/no-such-result-id")
        _clear_overrides()
        assert resp.status_code == 404
        assert resp.json()["detail"] == "result_not_found"

    @pytest.mark.asyncio
    async def test_other_user_cannot_read_result(self):
        owner_sub = f"user-{uuid.uuid4()}"
        result_id = await self._inject_snapshot(owner_sub)

        other = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: other
        app.dependency_overrides[get_required_auth] = lambda: other
        with TestClient(app) as client:
            resp = client.get(f"/api/v1/history/{result_id}")
        _clear_overrides()
        assert resp.status_code == 403
        assert resp.json()["detail"] == "access_denied"


# ---------------------------------------------------------------------------
# History pagination limit validation
# ---------------------------------------------------------------------------


class TestHistoryPagination:
    def test_limit_too_large_returns_422(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/history?limit=9999")
        _clear_overrides()
        assert resp.status_code == 422

    def test_limit_zero_returns_422(self):
        subject = _auth(sub=f"user-{uuid.uuid4()}")
        _clear_overrides()
        app.dependency_overrides[get_optional_auth] = lambda: subject
        app.dependency_overrides[get_required_auth] = lambda: subject
        with TestClient(app) as client:
            resp = client.get("/api/v1/history?limit=0")
        _clear_overrides()
        assert resp.status_code == 422
