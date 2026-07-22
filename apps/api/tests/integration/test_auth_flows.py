"""Real Supabase Auth flow tests (spec section A): sign-up/sign-in/session
restoration/sign-out against a live Supabase Auth REST API, plus real JWT
verification/expiry/revocation checked against app.core.auth's actual
verification path (not a re-implementation of it).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

# conftest.py's module-level `pytestmark` only applies within conftest.py
# itself, not to sibling test modules — pytest does not propagate it
# automatically. Each test module in this package must declare it directly
# so `pytest -m supabase_integration` (used by the CI Supabase-integration
# job) actually selects these tests instead of silently deselecting all of
# them. The real skip-when-unconfigured behavior is independently enforced
# by conftest.py's autouse `_require_supabase_test_project` fixture.
pytestmark = pytest.mark.supabase_integration


def _auth_headers(anon_key: str) -> dict:
    return {"apikey": anon_key, "Content-Type": "application/json"}


@pytest.mark.asyncio
async def test_sign_up_sign_in_and_session_restoration(
    supabase_url: str, supabase_anon_key: str, unique_test_email: str, test_user_password: str
) -> None:
    assert httpx is not None
    async with httpx.AsyncClient(base_url=supabase_url, headers=_auth_headers(supabase_anon_key)) as client:
        signup_res = await client.post(
            "/auth/v1/signup", json={"email": unique_test_email, "password": test_user_password}
        )
        assert signup_res.status_code in (200, 201), signup_res.text
        signup_body = signup_res.json()
        access_token = signup_body.get("access_token")

        if access_token is None:
            # Email confirmation required — sign in directly instead (still
            # proves the account exists and password auth works).
            signin_res = await client.post(
                "/auth/v1/token?grant_type=password",
                json={"email": unique_test_email, "password": test_user_password},
            )
            assert signin_res.status_code == 200, signin_res.text
            access_token = signin_res.json()["access_token"]

        # Session restoration: the returned access token must be independently
        # verifiable through the real user-info endpoint.
        me_res = await client.get("/auth/v1/user", headers={"Authorization": f"Bearer {access_token}"})
        assert me_res.status_code == 200
        assert me_res.json()["email"] == unique_test_email


@pytest.mark.asyncio
async def test_sign_out_removes_access(
    supabase_url: str, supabase_anon_key: str, unique_test_email: str, test_user_password: str
) -> None:
    assert httpx is not None
    async with httpx.AsyncClient(base_url=supabase_url, headers=_auth_headers(supabase_anon_key)) as client:
        await client.post("/auth/v1/signup", json={"email": unique_test_email, "password": test_user_password})
        signin_res = await client.post(
            "/auth/v1/token?grant_type=password",
            json={"email": unique_test_email, "password": test_user_password},
        )
        assert signin_res.status_code == 200
        tokens = signin_res.json()
        access_token, refresh_token = tokens["access_token"], tokens["refresh_token"]

        logout_res = await client.post(
            "/auth/v1/logout", headers={"Authorization": f"Bearer {access_token}"}
        )
        assert logout_res.status_code in (200, 204)

        # The refresh token must be revoked — no new session obtainable from it.
        refresh_res = await client.post(
            "/auth/v1/token?grant_type=refresh_token", json={"refresh_token": refresh_token}
        )
        assert refresh_res.status_code >= 400, "refresh token must be rejected after sign-out"


def test_real_jwt_is_accepted_by_the_actual_verification_path(supabase_url: str) -> None:
    """Not a copy of app.core.auth's logic — imports and calls it directly."""
    from app.core.auth import _decode_jwt
    import os

    secret = os.environ.get("PEAK3_TEST_SUPABASE_JWT_SECRET")
    if not secret:
        pytest.skip("PEAK3_TEST_SUPABASE_JWT_SECRET not set — cannot mint a project-matching JWT for this check")

    import jwt as pyjwt

    now = int(time.time())
    token = pyjwt.encode(
        {"sub": "test-user", "email": "test@example.com", "aud": "authenticated", "exp": now + 3600},
        secret,
        algorithm="HS256",
    )
    claims = _decode_jwt(token, secret)
    assert claims["sub"] == "test-user"


def test_expired_jwt_is_rejected() -> None:
    from app.core.auth import _decode_jwt

    import jwt as pyjwt

    secret = "irrelevant-for-this-shape-check"
    now = int(time.time())
    expired_token = pyjwt.encode(
        {"sub": "test-user", "aud": "authenticated", "exp": now - 3600}, secret, algorithm="HS256"
    )
    with pytest.raises(ValueError, match="token_expired"):
        _decode_jwt(expired_token, secret)


def test_tampered_signature_is_rejected() -> None:
    from app.core.auth import _decode_jwt

    import jwt as pyjwt

    now = int(time.time())
    token = pyjwt.encode(
        {"sub": "test-user", "aud": "authenticated", "exp": now + 3600}, "correct-secret", algorithm="HS256"
    )
    with pytest.raises(ValueError, match="token_invalid_signature"):
        _decode_jwt(token, "wrong-secret")


@pytest.mark.asyncio
async def test_oauth_disabled_state_is_intentional_when_not_configured(supabase_url: str, supabase_anon_key: str) -> None:
    """If Google OAuth is not configured on the test project, the provider
    endpoint must fail in a documented, intentional way (not silently
    succeed) — this is checked, not assumed.
    """
    assert httpx is not None
    async with httpx.AsyncClient(base_url=supabase_url, headers=_auth_headers(supabase_anon_key)) as client:
        res = await client.get("/auth/v1/authorize", params={"provider": "google"}, follow_redirects=False)
        # Either a redirect to Google (configured) or an explicit error
        # (not configured) — never a silent 200 with no provider wired up.
        assert res.status_code in (302, 303, 400, 404, 422)
