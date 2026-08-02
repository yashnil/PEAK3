"""Authentication utilities for PEAK3 Arena.

Verifies Supabase Auth access tokens (standard JWTs) using PyJWT.
The FastAPI backend never trusts a client-submitted user ID — only the
verified `sub` claim from the JWT is authoritative.

Token flow:
  1. Client signs in via Supabase Auth (email magic link or Google OAuth).
  2. Supabase issues a JWT signed by the project.
  3. Client sends Authorization: Bearer <access_token> on protected requests.
  4. FastAPI dependency verifies the JWT and extracts the `sub` claim.

Two signing regimes are supported, selected per token by its `alg` header:

* **Asymmetric (ES256 / RS256 / EdDSA)** — the current Supabase default. The
  project publishes public keys at `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`
  and there is *no* symmetric secret to configure. This is the production path:
  set `PEAK3_SUPABASE_URL` and verification works with no secret at all.
  Because real Supabase tokens always carry `aud` and `iss`, this path verifies
  both — a token minted by a different project is rejected even if we somehow
  fetched its keys.

* **Symmetric (HS256)** — legacy projects and the local `supabase start` stack,
  which still issue HS256 tokens signed with `PEAK3_SUPABASE_JWT_SECRET`. Kept
  for local development and for the existing test suites that mint tokens
  directly. `aud`/`iss` are not required on this path because locally minted
  test tokens historically omit them.

Neither path ever logs a token, a key, or a secret.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

# Algorithms we accept on the JWKS path. `none` and every symmetric algorithm
# are excluded so a token cannot downgrade itself into being verified against a
# public key treated as an HMAC secret (the classic alg-confusion attack).
ASYMMETRIC_ALGORITHMS = ("ES256", "RS256", "EdDSA")


@dataclass
class AuthSubject:
    """Verified identity extracted from a JWT."""
    sub: str                    # Supabase auth.uid() — stable across sessions
    email: Optional[str]        # may be absent for anonymous sessions
    is_anonymous: bool          # True when using an anonymous Supabase session
    raw_claims: dict            # full decoded payload (for app-specific claims)


def _import_pyjwt():
    try:
        import jwt as _jwt  # PyJWT
    except ImportError:
        raise RuntimeError(
            "PyJWT is required for JWT verification. "
            "Install it: pip install 'PyJWT[crypto]'"
        )
    return _jwt


def _translate_jwt_error(_jwt, exc: Exception) -> ValueError:
    """Map a PyJWT exception onto our stable, token-free reason strings."""
    if isinstance(exc, _jwt.ExpiredSignatureError):
        return ValueError("token_expired")
    if isinstance(exc, _jwt.InvalidAudienceError):
        return ValueError("token_invalid_audience")
    if isinstance(exc, _jwt.InvalidIssuerError):
        return ValueError("token_invalid_issuer")
    if isinstance(exc, _jwt.InvalidSignatureError):
        return ValueError("token_invalid_signature")
    if isinstance(exc, _jwt.DecodeError):
        return ValueError("token_malformed")
    return ValueError(f"token_error: {type(exc).__name__}")


def token_algorithm(token: str) -> str | None:
    """Read the (unverified) `alg` header of a compact JWS.

    Reading an unverified header is safe and necessary: it is how any verifier
    decides *which* key material to check the signature against. Nothing is
    trusted from it beyond routing to a verification strategy, and only the
    algorithms we explicitly allow are ever passed to PyJWT.
    """
    _jwt = _import_pyjwt()
    try:
        return _jwt.get_unverified_header(token).get("alg")
    except Exception:
        return None


def _decode_jwt(token: str, jwt_secret: str) -> dict:
    """Decode and verify a symmetric (HS256) Supabase JWT.

    Used by legacy projects, the local `supabase start` stack, and tests that
    mint tokens directly. Raises ValueError with a stable reason string on
    failure. Never logs the token value.
    """
    _jwt = _import_pyjwt()

    try:
        return _jwt.decode(
            token,
            jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase tokens set aud to "authenticated"
        )
    except Exception as exc:
        raise _translate_jwt_error(_jwt, exc)


async def _decode_jwt_asymmetric(
    token: str,
    *,
    jwks_url: str,
    issuer: str | None,
    audience: str | None,
) -> dict:
    """Decode and verify an asymmetrically-signed Supabase JWT via JWKS.

    Unlike the HS256 path this verifies `aud` and `iss` when they are known,
    because every genuine Supabase access token carries both. Raises ValueError
    with a stable reason string on failure. Never logs the token or key values.
    """
    from app.core.jwks import JWKSUnavailable, get_jwks_cache

    _jwt = _import_pyjwt()

    try:
        header = _jwt.get_unverified_header(token)
    except Exception as exc:
        raise _translate_jwt_error(_jwt, exc)

    alg = header.get("alg")
    if alg not in ASYMMETRIC_ALGORITHMS:
        raise ValueError("token_unsupported_algorithm")

    kid = header.get("kid")
    if not kid:
        raise ValueError("token_missing_kid")

    cache = get_jwks_cache(jwks_url)
    try:
        signing_key = await cache.get_key(kid)
    except KeyError:
        # The signature key is not in this project's published key set — the
        # token belongs to somebody else.
        raise ValueError("token_unknown_key")
    except JWKSUnavailable as exc:
        logger.warning("Cannot verify access token: %s", exc)
        raise ValueError("jwks_unavailable")

    options = {
        "verify_aud": audience is not None,
        "require": ["exp", "sub"],
    }
    try:
        return _jwt.decode(
            token,
            signing_key.key,
            algorithms=list(ASYMMETRIC_ALGORITHMS),
            audience=audience,
            issuer=issuer,
            options=options,
        )
    except Exception as exc:
        raise _translate_jwt_error(_jwt, exc)


async def verify_access_token(token: str) -> dict:
    """Verify a Supabase access token using whichever regime the project uses.

    Selection is driven by the token's own `alg` header, so a project mid-way
    through a symmetric→asymmetric migration (both key types briefly valid)
    keeps working without a config flip.

    Raises ValueError with a stable reason string; the caller decides whether
    that means 401 or anonymous.
    """
    from app.core.config import settings
    from app.core.jwks import derive_issuer, derive_jwks_url

    alg = token_algorithm(token)

    if alg in ASYMMETRIC_ALGORITHMS:
        jwks_url = settings.SUPABASE_JWKS_URL or (
            derive_jwks_url(settings.SUPABASE_URL) if settings.SUPABASE_URL else None
        )
        if not jwks_url:
            raise ValueError("jwks_not_configured")
        issuer = settings.SUPABASE_JWT_ISSUER or (
            derive_issuer(settings.SUPABASE_URL) if settings.SUPABASE_URL else None
        )
        return await _decode_jwt_asymmetric(
            token,
            jwks_url=jwks_url,
            issuer=issuer,
            audience=settings.SUPABASE_JWT_AUDIENCE or None,
        )

    if alg == "HS256":
        jwt_secret = settings.SUPABASE_JWT_SECRET
        if not jwt_secret:
            raise ValueError("hs256_secret_not_configured")
        return _decode_jwt(token, jwt_secret)

    raise ValueError("token_unsupported_algorithm")


def _unverified_issuer(token: str) -> str | None:
    """The `iss` claim without verifying the signature — for logging only.

    Safe: nothing is trusted from it. It exists so a rejected token can say
    *which project minted it*, which is the one fact that distinguishes a
    misconfiguration from an expired session.
    """
    _jwt = _import_pyjwt()
    try:
        return _jwt.decode(token, options={"verify_signature": False}).get("iss")
    except Exception:
        return None


def _configured_issuer() -> str | None:
    """The issuer this API will accept, as resolved from settings."""
    from app.core.config import settings
    from app.core.jwks import derive_issuer

    if settings.SUPABASE_JWT_ISSUER:
        return settings.SUPABASE_JWT_ISSUER
    if settings.SUPABASE_URL:
        return derive_issuer(settings.SUPABASE_URL)
    return None


async def get_optional_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthSubject | None:
    """Return AuthSubject if a valid Bearer token is present, else None.

    Does NOT raise for missing auth — use get_required_auth for protected routes.
    """
    if credentials is None:
        return None

    try:
        claims = await verify_access_token(credentials.credentials)
    except ValueError as exc:
        # Invalid token — treat as unauthenticated rather than raising.
        # A misconfiguration ("we cannot verify anything") is logged loudly;
        # a bad token from a client is not, to avoid log-flooding on abuse.
        reason = str(exc)
        if reason in {"jwks_not_configured", "hs256_secret_not_configured", "jwks_unavailable"}:
            logger.warning("Cannot verify access tokens: %s", reason)
        elif reason in {"token_unknown_key", "token_invalid_issuer", "token_invalid_audience"}:
            # A CONFIGURATION mismatch wearing a client error's clothes: the
            # browser holds a perfectly valid session from a different Supabase
            # project than this API verifies against, so the player is visibly
            # signed in and every write 401s. Previously this went to
            # logger.debug and the server said nothing at all, which made the
            # single most likely production misconfiguration invisible in logs
            # and indistinguishable from "user is signed out".
            #
            # The token's issuer is echoed because it is the whole diagnosis and
            # it is not a secret (it is a public project URL, present in the
            # browser bundle). No token, key, signature or claim beyond `iss`
            # is logged.
            logger.warning(
                "Rejected an access token (%s). Token issuer=%r; this API verifies "
                "issuer=%r. If those differ, the web app and the API are pointed at "
                "different Supabase projects -- align NEXT_PUBLIC_SUPABASE_URL with "
                "PEAK3_SUPABASE_URL.",
                reason,
                _unverified_issuer(credentials.credentials),
                _configured_issuer(),
            )
        else:
            logger.debug("JWT verification failed: %s", reason)
        return None

    sub = claims.get("sub")
    if not sub:
        # A validly-signed token with no subject is unusable, not a server bug.
        logger.debug("JWT verification failed: token_missing_sub")
        return None

    return AuthSubject(
        sub=sub,
        email=claims.get("email"),
        is_anonymous=claims.get("is_anonymous", False),
        raw_claims=claims,
    )


async def get_required_auth(
    auth: AuthSubject | None = Depends(get_optional_auth),
) -> AuthSubject:
    """Return AuthSubject or raise 401 if not authenticated.

    The detail is the structured `{error_code, message}` shape every other
    error in this API uses, NOT the bare string `"authentication_required"`.

    WHY. The frontend error parsers (`parseErrorDetail` in
    perfect-season-api.ts and its siblings) treat a *string* detail as the
    human-readable message and show it verbatim, so a signed-in player who
    pressed "Save run" was told, in the UI, `authentication_required`. That is
    a wire protocol constant leaking into a product surface: it names no
    problem the reader has and offers no action. The code is preserved as
    `error_code` so diagnostics, tests and client branching are unaffected --
    this widens the payload, it does not replace it.
    """
    if auth is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error_code": "authentication_required",
                "message": (
                    "You are not signed in, or your session has expired. "
                    "Sign in again to continue."
                ),
            },
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
