"""Authentication utilities for PEAK3 Arena.

Verifies Supabase Auth access tokens (standard JWTs) using PyJWT.
The FastAPI backend never trusts a client-submitted user ID — only the
verified `sub` claim from the JWT is authoritative.

Token flow:
  1. Client signs in via Supabase Auth (email+password or Google OAuth).
  2. Supabase issues a JWT signed with PEAK3_SUPABASE_JWT_SECRET.
  3. Client sends Authorization: Bearer <access_token> on protected requests.
  4. FastAPI dependency verifies the JWT and extracts the `sub` claim.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


@dataclass
class AuthSubject:
    """Verified identity extracted from a JWT."""
    sub: str                    # Supabase auth.uid() — stable across sessions
    email: Optional[str]        # may be absent for anonymous sessions
    is_anonymous: bool          # True when using an anonymous Supabase session
    raw_claims: dict            # full decoded payload (for app-specific claims)


def _decode_jwt(token: str, jwt_secret: str) -> dict:
    """Decode and verify a Supabase JWT.

    Raises ValueError with a human-readable message on failure.
    Never logs the token value.
    """
    try:
        import jwt as _jwt  # PyJWT
    except ImportError:
        raise RuntimeError(
            "PyJWT is required for JWT verification. "
            "Install it: pip install 'PyJWT[crypto]'"
        )

    try:
        payload = _jwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase tokens set aud to "authenticated"
        )
        return payload
    except _jwt.ExpiredSignatureError:
        raise ValueError("token_expired")
    except _jwt.InvalidSignatureError:
        raise ValueError("token_invalid_signature")
    except _jwt.DecodeError:
        raise ValueError("token_malformed")
    except Exception as exc:
        raise ValueError(f"token_error: {type(exc).__name__}")


async def get_optional_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthSubject | None:
    """Return AuthSubject if a valid Bearer token is present, else None.

    Does NOT raise for missing auth — use get_required_auth for protected routes.
    """
    from app.core.config import settings

    if credentials is None:
        return None

    jwt_secret = settings.SUPABASE_JWT_SECRET
    if not jwt_secret:
        logger.warning(
            "SUPABASE_JWT_SECRET is not configured — cannot verify access tokens"
        )
        return None

    try:
        claims = _decode_jwt(credentials.credentials, jwt_secret)
    except ValueError as exc:
        # Invalid token — treat as unauthenticated rather than raising
        logger.debug("JWT verification failed: %s", exc)
        return None

    return AuthSubject(
        sub=claims["sub"],
        email=claims.get("email"),
        is_anonymous=claims.get("is_anonymous", False),
        raw_claims=claims,
    )


async def get_required_auth(
    auth: AuthSubject | None = Depends(get_optional_auth),
) -> AuthSubject:
    """Return AuthSubject or raise 401 if not authenticated."""
    if auth is None:
        raise HTTPException(
            status_code=401,
            detail="authentication_required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return auth


def verify_anon_subject(cookie_value: str, signing_secret: str) -> str | None:
    """Verify an anonymous subject cookie and return the subject ID.

    The cookie value is `{sub}.{hmac_sig}` — the same format as challenge tokens.
    Returns the sub string if valid, None if invalid or expired.
    """
    from app.core.security import verify_session_token

    payload = verify_session_token(cookie_value, signing_secret)
    if payload is None:
        return None
    return payload.get("sub")


def create_anon_subject_cookie(sub: str, signing_secret: str) -> str:
    """Create a signed anonymous subject cookie value.

    Cookie value: `{sub}.{hmac_sig}` with a 30-day TTL.
    """
    from app.core.security import create_session_token

    return create_session_token({"sub": sub}, signing_secret, ttl_seconds=30 * 86400)


ANON_COOKIE_NAME = "peak3_anon"
ANON_COOKIE_MAX_AGE = 30 * 86400  # 30 days


def resolve_owner_sub(
    auth: "AuthSubject | None",
    existing_anon_cookie: str | None,
    response: Response,
    signing_secret: str,
) -> str:
    """Resolve the effective owning identity for a request: the real
    authenticated sub if present, otherwise a verified anonymous cookie sub,
    otherwise a freshly-issued anonymous sub (cookie set on the response).

    This is the single shared resolution path for any route that creates or
    reads owned game/history data anonymously-or-authenticated — previously
    duplicated ad hoc in app/api/v1/auth.py and absent entirely from
    app/api/v1/draft.py (see docs/architecture/REPOSITORY_WIRING_AUDIT.md).
    Never trusts a client-submitted sub; only a verified JWT or a
    signature-verified cookie.
    """
    import secrets as _secrets

    from app.core.config import settings as _settings

    if auth is not None:
        return auth.sub

    if existing_anon_cookie:
        sub = verify_anon_subject(existing_anon_cookie, signing_secret)
        if sub:
            return sub

    new_sub = f"anon:{_secrets.token_urlsafe(16)}"
    cookie_value = create_anon_subject_cookie(new_sub, signing_secret)
    response.set_cookie(
        key=ANON_COOKIE_NAME,
        value=cookie_value,
        max_age=ANON_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=not _settings.DEBUG,
        path="/",
    )
    return new_sub


# ---------------------------------------------------------------------------
# Typed aliases for use in route signatures
# ---------------------------------------------------------------------------

OptionalAuth = Annotated[AuthSubject | None, Depends(get_optional_auth)]
RequiredAuth = Annotated[AuthSubject, Depends(get_required_auth)]
