"""In-process rate limiting (Phase 11D).

The first rate limiter in this repo. It exists because the Daily Grid's search
and answer routes are the only endpoints here that a client is *supposed* to
call repeatedly while holding a secret the server is trying to protect -- the
day's answer key. Every other route serves data that is already public.

WHY IN-PROCESS, AND WHAT THAT DOES NOT BUY YOU
A token bucket in a dict is correct for exactly one deployment shape: a single
API process. It is honest about being a nuisance-cost control, not a security
boundary:

  - it does NOT survive a restart, so a determined caller can reset it;
  - it does NOT coordinate across replicas, so N processes means N x the limit;
  - it keys on client IP, which a caller behind a rotating proxy can change.

None of that makes it useless. The threat it actually addresses is a single
client scripting the search endpoint to enumerate a cell's answer set faster
than a person could -- and for that, a per-process bucket is the right size of
answer. The real defence against reading the key is still the one the search
module already implements (see nba_peak/daily_grid/search.py: eligibility is
withheld once a response would name too many qualifying players). This is the
second layer, deliberately cheap.

A Redis-backed limiter is the upgrade path when the API runs more than one
process. `RateLimiter` is the seam: swap the storage, keep the interface.

DETERMINISM IN TESTS
`now` is injectable and `reset()` clears all state, so a test can assert exact
allow/deny boundaries without sleeping and without depending on wall-clock
timing. Nothing here samples the clock except through `_now`.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class RateLimitRule:
    """`limit` requests per `window_seconds`, per key."""

    limit: int
    window_seconds: float

    def __post_init__(self) -> None:
        if self.limit < 1:
            raise ValueError("rate limit must allow at least one request")
        if self.window_seconds <= 0:
            raise ValueError("rate limit window must be positive")


@dataclass(frozen=True)
class RateLimitVerdict:
    """The outcome of one `check()`.

    `retry_after_seconds` is always >= 1 when denied: a fractional Retry-After
    is legal but reads as a bug in a header, and rounding up can only make the
    client wait slightly longer than strictly necessary.
    """

    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int


class RateLimiter:
    """Fixed-window counters, bounded, thread-safe.

    FIXED WINDOW rather than sliding: at these limits the classic fixed-window
    burst (up to 2x the limit across a boundary) is irrelevant -- the point is
    to stop a script doing thousands of requests a minute, not to meter
    precisely -- and a fixed window costs one integer per key instead of a
    deque of timestamps.

    BOUNDED because the key includes a client-controlled component (the IP, and
    for some routes the date), so an unbounded dict is a memory-growth vector
    on exactly the endpoints being protected. Evicting the least-recently-used
    key is safe: an evicted key simply starts a fresh window, which is the same
    thing that happens when its window expires.
    """

    def __init__(self, max_keys: int = 20_000, now: Optional[Callable[[], float]] = None):
        self._max_keys = max_keys
        self._now = now or time.monotonic
        # key -> (window_start, count). OrderedDict gives the LRU eviction.
        self._buckets: "OrderedDict[str, tuple[float, int]]" = OrderedDict()
        # key -> (window_start, {values seen}). See check_distinct().
        self._distinct: "OrderedDict[str, tuple[float, set[str]]]" = OrderedDict()
        # The limiter is reachable from FastAPI's threadpool (the Daily Grid
        # handlers are sync `def`, so Starlette runs them off the event loop),
        # which means two requests really can touch this concurrently.
        self._lock = threading.Lock()

    def check(self, key: str, rule: RateLimitRule) -> RateLimitVerdict:
        """Consume one token for `key`. Does not sleep or block."""
        now = self._now()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None or now - bucket[0] >= rule.window_seconds:
                window_start, count = now, 0
            else:
                window_start, count = bucket

            if count >= rule.limit:
                self._buckets[key] = (window_start, count)
                self._buckets.move_to_end(key)
                elapsed = now - window_start
                retry_after = max(1, int(rule.window_seconds - elapsed) + 1)
                return RateLimitVerdict(
                    allowed=False,
                    limit=rule.limit,
                    remaining=0,
                    retry_after_seconds=retry_after,
                )

            self._buckets[key] = (window_start, count + 1)
            self._buckets.move_to_end(key)
            while len(self._buckets) > self._max_keys:
                self._buckets.popitem(last=False)
            return RateLimitVerdict(
                allowed=True,
                limit=rule.limit,
                remaining=rule.limit - (count + 1),
                retry_after_seconds=0,
            )

    def check_distinct(self, key: str, value: str, rule: RateLimitRule) -> RateLimitVerdict:
        """Allow at most `rule.limit` DISTINCT `value`s under `key` per window.

        A different question from `check()`, and the Daily Grid needs both. The
        board route wants "how many different DATES has this client pulled?" --
        not "how many board requests?", because reloading today's board fifty
        times is normal play while pulling fifty different dates is building an
        offline corpus. A plain counter cannot tell those apart; folding the
        date into the bucket key cannot either (that just gives every date its
        own budget). So this keeps the set.

        A value already seen in the window is always allowed and consumes
        nothing -- re-fetching the same board is free, forever.

        The set is bounded by the rule's own limit: once full, a new value is
        denied rather than stored, so the memory per key is capped at `limit`
        entries by construction.
        """
        now = self._now()
        with self._lock:
            entry = self._distinct.get(key)
            if entry is None or now - entry[0] >= rule.window_seconds:
                window_start, seen = now, set()
            else:
                window_start, seen = entry

            if value in seen:
                self._distinct[key] = (window_start, seen)
                self._distinct.move_to_end(key)
                return RateLimitVerdict(
                    allowed=True,
                    limit=rule.limit,
                    remaining=rule.limit - len(seen),
                    retry_after_seconds=0,
                )

            if len(seen) >= rule.limit:
                self._distinct[key] = (window_start, seen)
                self._distinct.move_to_end(key)
                elapsed = now - window_start
                return RateLimitVerdict(
                    allowed=False,
                    limit=rule.limit,
                    remaining=0,
                    retry_after_seconds=max(1, int(rule.window_seconds - elapsed) + 1),
                )

            seen.add(value)
            self._distinct[key] = (window_start, seen)
            self._distinct.move_to_end(key)
            while len(self._distinct) > self._max_keys:
                self._distinct.popitem(last=False)
            return RateLimitVerdict(
                allowed=True,
                limit=rule.limit,
                remaining=rule.limit - len(seen),
                retry_after_seconds=0,
            )

    def reset(self) -> None:
        """Drop all state. For tests and for a deliberate operational flush."""
        with self._lock:
            self._buckets.clear()
            self._distinct.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._buckets) + len(self._distinct)


# One limiter for the whole process, shared by every route that opts in.
limiter = RateLimiter()


def client_key(request, scope: str, *extra: str) -> str:
    """Build a limiter key: scope + client identity + any extra dimensions.

    IDENTITY. The anonymous-subject cookie adds a dimension ahead of the IP,
    because it survives a NAT that would otherwise make a whole office share
    one bucket.

    THE COOKIE'S SIGNATURE IS VERIFIED HERE, and an unverified cookie
    contributes nothing. This is load-bearing, not hygiene. `subject` is a
    *key dimension*, so a caller who rewrites the cookie between requests gets
    a brand-new bucket every time: with 50 forged cookies from one IP you get
    50 full budgets, not one. An earlier version of this function reasoned that
    forging could "only give themselves a different bucket, not a bigger one,
    because the IP is still in the key" -- which is exactly backwards, since a
    different bucket *is* a bigger budget. Collapsing every unverifiable cookie
    to the empty string puts all of them back into the single per-IP bucket,
    and also stops an attacker flooding the limiter's bounded key table to
    evict legitimate entries.

    The HMAC is one SHA-256 over a short string. That is not meaningfully "on
    the hot path" next to the request it is protecting, and the alternative is
    no protection at all.

    Deliberately does NOT read the Authorization header: verifying a JWT to
    decide a rate-limit bucket would make an unauthenticated flood cheaper than
    an authenticated one, and would put asymmetric crypto and a possible
    network fetch (JWKS) on the path of the endpoint being flooded.
    """
    from app.core.auth import verify_anon_subject
    from app.core.config import settings

    client = getattr(request, "client", None)
    ip = getattr(client, "host", None) or "unknown"

    cookie = ""
    try:
        cookie = request.cookies.get("peak3_anon", "") or ""
    except Exception:  # pragma: no cover - defensive; cookies always parse
        cookie = ""

    subject = ""
    if cookie:
        # Only the verified subject, never the signature -- the signature is
        # credential material and does not belong in a cache key.
        verified = verify_anon_subject(cookie, settings.SIGNING_SECRET)
        if verified:
            subject = verified[:64]

    return "|".join((scope, ip, subject, *extra))
