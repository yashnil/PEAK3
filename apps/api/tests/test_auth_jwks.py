"""Asymmetric (JWKS) Supabase access-token verification.

Supabase projects created after the asymmetric signing-key rollout sign user
access tokens with an EC private key and publish the matching public key at
``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``. They issue **no** symmetric
"JWT secret" at all, so the previous HS256-only path could not verify a single
token from such a project.

These tests mint real ES256 tokens against a locally generated key pair and
serve a real JWKS document through a stubbed transport, so the whole path —
header routing, key lookup, rotation, audience, issuer, expiry — is exercised
without a network or a live project. ``test_live_jwks_document_is_usable``
additionally checks the real project's published document when one is
configured, and skips (never silently passes) when it is not.
"""
from __future__ import annotations

import base64
import json
import os
import time

import pytest

from app.core import jwks as jwks_module
from app.core.auth import (
    ASYMMETRIC_ALGORITHMS,
    get_optional_auth,
    token_algorithm,
    verify_access_token,
)
from app.core.config import settings

cryptography = pytest.importorskip("cryptography")
jwt = pytest.importorskip("jwt")

from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

PROJECT_URL = "https://testproject.supabase.co"
ISSUER = f"{PROJECT_URL}/auth/v1"
JWKS_URL = f"{PROJECT_URL}/auth/v1/.well-known/jwks.json"


# ---------------------------------------------------------------------------
# Key material + JWKS document helpers
# ---------------------------------------------------------------------------


def _b64u(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


class KeyPair:
    """An ES256 key pair plus its JWK representation."""

    def __init__(self, kid: str) -> None:
        self.kid = kid
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.private_pem = self.private_key.private_bytes(
            encoding=cryptography.hazmat.primitives.serialization.Encoding.PEM,
            format=cryptography.hazmat.primitives.serialization.PrivateFormat.PKCS8,
            encryption_algorithm=cryptography.hazmat.primitives.serialization.NoEncryption(),
        )

    def public_jwk(self) -> dict:
        numbers = self.private_key.public_key().public_numbers()
        size = 32  # P-256 coordinate width
        return {
            "kty": "EC",
            "crv": "P-256",
            "alg": "ES256",
            "use": "sig",
            "kid": self.kid,
            "x": _b64u(numbers.x.to_bytes(size, "big")),
            "y": _b64u(numbers.y.to_bytes(size, "big")),
        }

    def mint(self, **overrides) -> str:
        now = int(time.time())
        claims = {
            "sub": "11111111-2222-3333-4444-555555555555",
            "email": "player@example.test",
            "aud": "authenticated",
            "role": "authenticated",
            "iss": ISSUER,
            "iat": now,
            "exp": now + 3600,
            "is_anonymous": False,
        }
        claims.update(overrides)
        for key in [k for k, v in claims.items() if v is None]:
            del claims[key]
        return jwt.encode(
            claims,
            self.private_pem,
            algorithm="ES256",
            headers={"kid": self.kid},
        )


import cryptography.hazmat.primitives.serialization  # noqa: E402,F401  (used above)


class _StubResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class StubJWKSEndpoint:
    """Stands in for the project's JWKS endpoint and counts fetches."""

    def __init__(self, keys):
        self.keys = list(keys)
        self.fetches = 0
        self.fail_with: Exception | None = None

    def document(self) -> dict:
        return {"keys": [k.public_jwk() for k in self.keys]}

    def install(self, monkeypatch):
        endpoint = self

        class _Client:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def get(self, url):
                endpoint.fetches += 1
                if endpoint.fail_with is not None:
                    raise endpoint.fail_with
                return _StubResponse(endpoint.document())

        import httpx

        monkeypatch.setattr(httpx, "AsyncClient", _Client)
        return self


@pytest.fixture
def signing_key():
    return KeyPair("key-primary")


@pytest.fixture
def endpoint(signing_key, monkeypatch):
    jwks_module.reset_jwks_cache()
    stub = StubJWKSEndpoint([signing_key]).install(monkeypatch)
    yield stub
    jwks_module.reset_jwks_cache()


@pytest.fixture
def asymmetric_project(monkeypatch):
    """A project configured exactly like the hosted one: JWKS, no HS256 secret."""
    monkeypatch.setattr(settings, "SUPABASE_URL", PROJECT_URL, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWKS_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_ISSUER", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_AUDIENCE", "authenticated", raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", None, raising=False)


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verifies_an_es256_token_with_no_shared_secret(
    asymmetric_project, endpoint, signing_key
):
    """The whole point: a project with no HS256 secret still authenticates."""
    assert settings.SUPABASE_JWT_SECRET is None

    claims = await verify_access_token(signing_key.mint())

    assert claims["sub"] == "11111111-2222-3333-4444-555555555555"
    assert claims["email"] == "player@example.test"


@pytest.mark.asyncio
async def test_derives_jwks_url_and_issuer_from_the_project_url(
    asymmetric_project, endpoint, signing_key
):
    assert jwks_module.derive_jwks_url(PROJECT_URL) == JWKS_URL
    assert jwks_module.derive_issuer(PROJECT_URL) == ISSUER
    # A trailing slash on the configured URL must not produce a doubled path.
    assert jwks_module.derive_jwks_url(PROJECT_URL + "/") == JWKS_URL

    await verify_access_token(signing_key.mint())
    assert endpoint.fetches == 1


@pytest.mark.asyncio
async def test_keys_are_cached_across_requests(asymmetric_project, endpoint, signing_key):
    for _ in range(5):
        await verify_access_token(signing_key.mint())
    assert endpoint.fetches == 1, "JWKS should be fetched once, not per request"


# ---------------------------------------------------------------------------
# Rejection paths — each must be a clean 401-shaped failure, never a 500
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rejects_a_token_signed_by_another_project(
    asymmetric_project, endpoint
):
    """A different project's key is not in our published set."""
    foreign = KeyPair("some-other-projects-key")

    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(foreign.mint())

    assert str(excinfo.value) == "token_unknown_key"


@pytest.mark.asyncio
async def test_rejects_a_token_with_a_forged_signature(
    asymmetric_project, endpoint, signing_key
):
    """Same kid, different private key — the classic key-substitution attempt."""
    impostor = KeyPair(signing_key.kid)

    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(impostor.mint())

    assert str(excinfo.value) == "token_invalid_signature"


@pytest.mark.asyncio
async def test_rejects_the_wrong_audience(asymmetric_project, endpoint, signing_key):
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(signing_key.mint(aud="some-other-audience"))

    assert str(excinfo.value) == "token_invalid_audience"


@pytest.mark.asyncio
async def test_rejects_the_wrong_issuer(asymmetric_project, endpoint, signing_key):
    """The old HS256 path checked neither aud nor iss."""
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(signing_key.mint(iss="https://evil.example/auth/v1"))

    assert str(excinfo.value) == "token_invalid_issuer"


@pytest.mark.asyncio
async def test_rejects_an_expired_token(asymmetric_project, endpoint, signing_key):
    past = int(time.time()) - 60
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(signing_key.mint(iat=past - 3600, exp=past))

    assert str(excinfo.value) == "token_expired"


@pytest.mark.asyncio
async def test_rejects_a_token_with_no_subject(asymmetric_project, endpoint, signing_key):
    """Previously an unguarded claims["sub"] made this a 500, not a 401."""
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(signing_key.mint(sub=None))

    assert "sub" in str(excinfo.value) or str(excinfo.value).startswith("token_")


@pytest.mark.asyncio
async def test_rejects_a_token_with_no_kid(asymmetric_project, endpoint, signing_key):
    token = jwt.encode(
        {"sub": "x", "aud": "authenticated", "iss": ISSUER, "exp": int(time.time()) + 60},
        signing_key.private_pem,
        algorithm="ES256",
    )
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(token)

    assert str(excinfo.value) == "token_missing_kid"


@pytest.mark.asyncio
async def test_rejects_the_none_algorithm(asymmetric_project, endpoint):
    """An unsigned token must never be accepted, whatever it claims."""
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    payload = (
        base64.urlsafe_b64encode(json.dumps({"sub": "attacker"}).encode())
        .decode()
        .rstrip("=")
    )
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(f"{header}.{payload}.")

    assert str(excinfo.value) == "token_unsupported_algorithm"


@pytest.mark.asyncio
async def test_public_key_is_never_accepted_as_an_hmac_secret(
    asymmetric_project, endpoint, signing_key
):
    """Algorithm-confusion guard.

    The classic attack mints an HS256 token whose HMAC key is the *public* key
    bytes, hoping the verifier passes whatever key it found to a symmetric
    algorithm. Our asymmetric path allows only ES256/RS256/EdDSA, and the HS256
    path is reached only when the project has a configured shared secret —
    which an asymmetric project does not.
    """
    assert "HS256" not in ASYMMETRIC_ALGORITHMS

    public_pem = signing_key.private_key.public_key().public_bytes(
        encoding=cryptography.hazmat.primitives.serialization.Encoding.PEM,
        format=cryptography.hazmat.primitives.serialization.PublicFormat.SubjectPublicKeyInfo,
    )

    # Assembled by hand rather than with jwt.encode: PyJWT refuses to *sign*
    # HS256 with PEM key material, so an attacker would build the token
    # manually. That refusal is a second layer of defence, not the one under
    # test here — what matters is that our verifier rejects the result.
    import hmac as _hmac
    from hashlib import sha256

    header = _b64u(json.dumps({"alg": "HS256", "typ": "JWT", "kid": signing_key.kid}).encode())
    payload = _b64u(
        json.dumps(
            {"sub": "attacker", "aud": "authenticated", "iss": ISSUER,
             "exp": int(time.time()) + 60}
        ).encode()
    )
    signature = _b64u(
        _hmac.new(public_pem, f"{header}.{payload}".encode(), sha256).digest()
    )
    forged = f"{header}.{payload}.{signature}"

    assert token_algorithm(forged) == "HS256"
    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(forged)

    assert str(excinfo.value) == "hs256_secret_not_configured"


# ---------------------------------------------------------------------------
# Rotation and resilience
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_rotated_key_is_picked_up_by_one_refetch(
    asymmetric_project, endpoint, signing_key
):
    """After the refresh cooldown, a newly published kid resolves on first use.

    In production the cooldown is never the binding constraint here: cached
    keys are up to 600 s old when a rotated kid first appears, which is well
    past the 30 s floor. The floor is collapsed to zero for this test so the
    rotation behaviour is isolated from the anti-amplification behaviour
    covered by the next test.
    """
    await verify_access_token(signing_key.mint())
    assert endpoint.fetches == 1

    jwks_module.get_jwks_cache(JWKS_URL).min_refresh_interval_seconds = 0

    rotated = KeyPair("key-rotated")
    endpoint.keys.append(rotated)

    claims = await verify_access_token(rotated.mint())

    assert claims["sub"]
    assert endpoint.fetches == 2, "an unknown kid should trigger exactly one refetch"
    # The previously cached key keeps working across the rotation overlap.
    assert (await verify_access_token(signing_key.mint()))["sub"]


@pytest.mark.asyncio
async def test_an_unknown_kid_does_not_amplify_outbound_requests(
    asymmetric_project, endpoint, signing_key
):
    """A hostile client must not be able to turn tokens into a fetch storm."""
    await verify_access_token(signing_key.mint())
    baseline = endpoint.fetches

    stranger = KeyPair("never-published")
    for _ in range(20):
        with pytest.raises(ValueError):
            await verify_access_token(stranger.mint())

    assert endpoint.fetches - baseline <= 1, (
        "the minimum-refresh cooldown should collapse 20 unknown-kid tokens "
        "into at most one fetch"
    )


@pytest.mark.asyncio
async def test_cached_keys_survive_a_transient_jwks_outage(
    asymmetric_project, endpoint, signing_key
):
    cache = jwks_module.get_jwks_cache(JWKS_URL)
    await verify_access_token(signing_key.mint())

    # Force staleness, then break the endpoint.
    cache._fetched_at = 0.0
    cache._last_attempt_at = 0.0
    endpoint.fail_with = RuntimeError("connection reset")

    claims = await verify_access_token(signing_key.mint())

    assert claims["sub"], "a transient JWKS outage must not sign everybody out"


@pytest.mark.asyncio
async def test_reports_a_clear_reason_when_nothing_is_configured(monkeypatch, signing_key):
    jwks_module.reset_jwks_cache()
    monkeypatch.setattr(settings, "SUPABASE_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWKS_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", None, raising=False)

    with pytest.raises(ValueError) as excinfo:
        await verify_access_token(signing_key.mint())

    assert str(excinfo.value) == "jwks_not_configured"
    assert settings.auth_verification_mode == "unconfigured"


# ---------------------------------------------------------------------------
# Mode reporting + coexistence with the legacy HS256 path
# ---------------------------------------------------------------------------


def test_auth_verification_mode_reports_what_is_actually_possible(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", PROJECT_URL, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWKS_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", None, raising=False)
    assert settings.auth_verification_mode == "jwks"

    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", "local-stack-secret", raising=False)
    assert settings.auth_verification_mode == "jwks+hs256"

    monkeypatch.setattr(settings, "SUPABASE_URL", None, raising=False)
    assert settings.auth_verification_mode == "hs256"

    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", None, raising=False)
    assert settings.auth_verification_mode == "unconfigured"


@pytest.mark.asyncio
async def test_hs256_still_works_for_the_local_stack(monkeypatch):
    """The local `supabase start` stack and ~30 existing tests mint HS256."""
    jwks_module.reset_jwks_cache()
    monkeypatch.setattr(settings, "SUPABASE_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWKS_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", "local-stack-secret", raising=False)

    token = jwt.encode({"sub": "local-user", "email": "a@b.test"},
                       "local-stack-secret", algorithm="HS256")

    claims = await verify_access_token(token)

    assert claims["sub"] == "local-user"


@pytest.mark.asyncio
async def test_both_regimes_coexist_during_a_migration(
    monkeypatch, endpoint, signing_key
):
    """A project mid-migration briefly has both key types valid."""
    monkeypatch.setattr(settings, "SUPABASE_URL", PROJECT_URL, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWKS_URL", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_ISSUER", None, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_AUDIENCE", "authenticated", raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", "legacy-secret", raising=False)

    asymmetric = await verify_access_token(signing_key.mint())
    symmetric = await verify_access_token(
        jwt.encode({"sub": "legacy-user"}, "legacy-secret", algorithm="HS256")
    )

    assert asymmetric["sub"] != symmetric["sub"]
    assert symmetric["sub"] == "legacy-user"


# ---------------------------------------------------------------------------
# Dependency behaviour
# ---------------------------------------------------------------------------


class _Credentials:
    def __init__(self, token):
        self.credentials = token
        self.scheme = "Bearer"


@pytest.mark.asyncio
async def test_optional_auth_downgrades_rather_than_raising(
    asymmetric_project, endpoint, signing_key
):
    good = await get_optional_auth(None, _Credentials(signing_key.mint()))
    assert good is not None and good.is_anonymous is False

    stranger = KeyPair("not-ours")
    bad = await get_optional_auth(None, _Credentials(stranger.mint()))
    assert bad is None, "an untrusted token must read as anonymous, not as a 500"

    assert await get_optional_auth(None, None) is None


# ---------------------------------------------------------------------------
# The real project
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("PEAK3_SUPABASE_URL"),
    reason="PEAK3_SUPABASE_URL is not configured — cannot check a live JWKS document",
)
@pytest.mark.asyncio
async def test_live_jwks_document_is_usable():
    """Fetch the configured project's real, public JWKS document.

    Public key material only — nothing here is a secret. Asserts the document
    is shaped the way our cache expects and that every key is one we can
    actually verify with, so a project that rotates to an unsupported algorithm
    fails loudly here rather than as a mass 401 in production.
    """
    jwks_module.reset_jwks_cache()
    url = jwks_module.derive_jwks_url(os.environ["PEAK3_SUPABASE_URL"])
    cache = jwks_module.SupabaseJWKSCache(url)

    await cache._fetch()

    assert cache._keys_by_kid, "live JWKS returned no usable keys"
    for kid, key in cache._keys_by_kid.items():
        assert kid
        alg = getattr(key, "algorithm_name", None)
        assert alg in ASYMMETRIC_ALGORITHMS, (
            f"live project publishes {alg!r}, which this API cannot verify"
        )
