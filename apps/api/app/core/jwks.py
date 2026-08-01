"""Supabase JWKS (asymmetric JWT signing key) fetching and caching.

Supabase projects created after the asymmetric-signing rollout no longer expose
a symmetric "JWT secret" at all: user access tokens are signed with a private
key held by the project, and verifiers fetch the matching *public* key from

    {SUPABASE_URL}/auth/v1/.well-known/jwks.json

That endpoint is unauthenticated and returns only public key material, so
nothing here is a secret and nothing here may ever be logged as one.

Why a hand-rolled cache instead of ``jwt.PyJWKClient``:

* ``PyJWKClient`` is synchronous. Calling it from an async FastAPI dependency
  blocks the event loop on every cache miss.
* Key rotation needs "unknown ``kid`` triggers exactly one re-fetch, then gives
  up until the cooldown expires" semantics, so a hostile client cannot turn an
  unknown ``kid`` into an outbound-request amplifier.

Both are a handful of lines with ``httpx`` (already an API dependency), so we
own them explicitly.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# How long a successfully fetched JWKS document is trusted before a background
# refresh is required. Supabase rotates signing keys rarely; 10 minutes keeps
# rotation propagation fast without hammering the endpoint.
DEFAULT_TTL_SECONDS = 600

# Floor between two network fetches. Protects the auth endpoint (and us) when a
# client sends a stream of tokens carrying a `kid` that will never resolve.
DEFAULT_MIN_REFRESH_INTERVAL_SECONDS = 30

# Network budget for a single JWKS fetch. Deliberately short: a hung fetch must
# not hold an inbound request open.
DEFAULT_FETCH_TIMEOUT_SECONDS = 5.0


class JWKSUnavailable(RuntimeError):
    """The JWKS document could not be fetched and no cached copy is usable."""


class SupabaseJWKSCache:
    """TTL + rotation-aware cache of a project's public signing keys.

    Thread/task safe: concurrent misses coalesce behind a single asyncio lock so
    a burst of requests produces one fetch, not one fetch per request.
    """

    def __init__(
        self,
        jwks_url: str,
        *,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        min_refresh_interval_seconds: int = DEFAULT_MIN_REFRESH_INTERVAL_SECONDS,
        fetch_timeout_seconds: float = DEFAULT_FETCH_TIMEOUT_SECONDS,
    ) -> None:
        self.jwks_url = jwks_url
        self.ttl_seconds = ttl_seconds
        self.min_refresh_interval_seconds = min_refresh_interval_seconds
        self.fetch_timeout_seconds = fetch_timeout_seconds

        self._keys_by_kid: dict[str, Any] = {}
        self._fetched_at: float = 0.0
        self._last_attempt_at: float = 0.0
        self._lock = asyncio.Lock()

    # -- internals ---------------------------------------------------------

    def _is_fresh(self, now: float) -> bool:
        return bool(self._keys_by_kid) and (now - self._fetched_at) < self.ttl_seconds

    def _may_attempt(self, now: float) -> bool:
        return (now - self._last_attempt_at) >= self.min_refresh_interval_seconds

    async def _fetch(self) -> None:
        """Fetch and index the JWKS document. Raises JWKSUnavailable on failure."""
        import httpx
        from jwt import PyJWKSet

        self._last_attempt_at = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self.fetch_timeout_seconds) as client:
                response = await client.get(self.jwks_url)
                response.raise_for_status()
                document = response.json()
        except Exception as exc:  # network, TLS, non-2xx, malformed JSON
            raise JWKSUnavailable(
                f"could not fetch JWKS from {self.jwks_url}: {type(exc).__name__}"
            ) from exc

        try:
            jwk_set = PyJWKSet.from_dict(document)
        except Exception as exc:
            raise JWKSUnavailable(
                f"malformed JWKS document at {self.jwks_url}: {type(exc).__name__}"
            ) from exc

        indexed = {key.key_id: key for key in jwk_set.keys if key.key_id}
        if not indexed:
            raise JWKSUnavailable(f"JWKS at {self.jwks_url} contained no usable keys")

        self._keys_by_kid = indexed
        self._fetched_at = time.monotonic()
        logger.info(
            "Fetched Supabase JWKS: %d key(s), algs=%s",
            len(indexed),
            sorted({getattr(k, "algorithm_name", None) or "?" for k in indexed.values()}),
        )

    # -- public API --------------------------------------------------------

    async def get_key(self, kid: str) -> Any:
        """Return the ``PyJWK`` for ``kid``, fetching/refreshing as needed.

        Raises ``KeyError`` when the key genuinely is not in the project's key
        set, and ``JWKSUnavailable`` when we could not obtain a key set at all.
        The two are distinct on purpose: the first is "this token is not ours"
        (401), the second is "we cannot tell right now" (503-ish).
        """
        now = time.monotonic()
        if self._is_fresh(now) and kid in self._keys_by_kid:
            return self._keys_by_kid[kid]

        async with self._lock:
            # Another task may have refreshed while we waited for the lock.
            now = time.monotonic()
            if self._is_fresh(now) and kid in self._keys_by_kid:
                return self._keys_by_kid[kid]

            stale = not self._is_fresh(now)
            unknown_kid = kid not in self._keys_by_kid

            if (stale or unknown_kid) and self._may_attempt(now):
                try:
                    await self._fetch()
                except JWKSUnavailable:
                    # Serve stale-but-present keys rather than failing every
                    # request during a transient outage. Signature verification
                    # still protects us; only rotation propagation is delayed.
                    if not self._keys_by_kid:
                        raise
                    logger.warning(
                        "JWKS refresh failed; falling back to cached keys "
                        "(age %.0fs)",
                        time.monotonic() - self._fetched_at,
                    )

            if kid in self._keys_by_kid:
                return self._keys_by_kid[kid]
            if not self._keys_by_kid:
                raise JWKSUnavailable(f"no JWKS keys available from {self.jwks_url}")
            raise KeyError(kid)

    def invalidate(self) -> None:
        """Drop cached keys (used by tests and by explicit rotation handling)."""
        self._keys_by_kid = {}
        self._fetched_at = 0.0
        self._last_attempt_at = 0.0


# ---------------------------------------------------------------------------
# Process-wide singleton, keyed by URL so a settings change in tests rebuilds it
# ---------------------------------------------------------------------------

_cache: Optional[SupabaseJWKSCache] = None


def get_jwks_cache(jwks_url: str) -> SupabaseJWKSCache:
    global _cache
    if _cache is None or _cache.jwks_url != jwks_url:
        _cache = SupabaseJWKSCache(jwks_url)
    return _cache


def reset_jwks_cache() -> None:
    """Test hook — forget the singleton entirely."""
    global _cache
    _cache = None


def derive_jwks_url(supabase_url: str) -> str:
    """Map a project URL to its published JWKS endpoint."""
    return f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


def derive_issuer(supabase_url: str) -> str:
    """Map a project URL to the `iss` claim Supabase Auth stamps on tokens."""
    return f"{supabase_url.rstrip('/')}/auth/v1"
