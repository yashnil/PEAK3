"""RateLimiter unit tests (Phase 11D).

Every test injects its own clock. Nothing here sleeps, and nothing depends on
how fast the machine is -- a rate limiter tested against the wall clock is a
flaky test waiting for a slow CI box.
"""
from __future__ import annotations

import pytest

from app.core.rate_limit import RateLimiter, RateLimitRule


class FakeClock:
    """A monotonic clock the test advances by hand."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(clock: FakeClock) -> RateLimiter:
    return RateLimiter(now=clock)


RULE = RateLimitRule(limit=3, window_seconds=60.0)


class TestRule:
    @pytest.mark.parametrize("limit", [0, -1])
    def test_a_rule_must_allow_at_least_one_request(self, limit: int):
        with pytest.raises(ValueError):
            RateLimitRule(limit=limit, window_seconds=60.0)

    @pytest.mark.parametrize("window", [0.0, -5.0])
    def test_a_rule_needs_a_positive_window(self, window: float):
        with pytest.raises(ValueError):
            RateLimitRule(limit=5, window_seconds=window)


class TestCheck:
    def test_allows_exactly_the_limit_then_denies(self, limiter: RateLimiter):
        for i in range(RULE.limit):
            verdict = limiter.check("k", RULE)
            assert verdict.allowed, i
            assert verdict.remaining == RULE.limit - (i + 1)
        denied = limiter.check("k", RULE)
        assert denied.allowed is False
        assert denied.remaining == 0

    def test_a_denied_request_reports_a_usable_retry_after(self, limiter: RateLimiter):
        for _ in range(RULE.limit):
            limiter.check("k", RULE)
        denied = limiter.check("k", RULE)
        # Always at least a second: a fractional Retry-After reads as a bug.
        assert denied.retry_after_seconds >= 1
        assert denied.retry_after_seconds <= int(RULE.window_seconds) + 1

    def test_keys_do_not_share_a_budget(self, limiter: RateLimiter):
        for _ in range(RULE.limit):
            assert limiter.check("a", RULE).allowed
        assert limiter.check("a", RULE).allowed is False
        # A different client is untouched by the first one's spending.
        assert limiter.check("b", RULE).allowed

    def test_the_window_resets(self, limiter: RateLimiter, clock: FakeClock):
        for _ in range(RULE.limit):
            limiter.check("k", RULE)
        assert limiter.check("k", RULE).allowed is False
        clock.advance(RULE.window_seconds)
        assert limiter.check("k", RULE).allowed

    def test_a_partial_window_does_not_reset(self, limiter: RateLimiter, clock: FakeClock):
        for _ in range(RULE.limit):
            limiter.check("k", RULE)
        clock.advance(RULE.window_seconds - 0.01)
        assert limiter.check("k", RULE).allowed is False

    def test_denied_requests_do_not_extend_the_window(
        self, limiter: RateLimiter, clock: FakeClock
    ):
        """A caller hammering a limited key must not push their own reset out.

        The failure this guards against is a limiter that restarts the window
        on every request: a client in a tight retry loop would then be locked
        out forever, which turns a throttle into a ban.
        """
        for _ in range(RULE.limit):
            limiter.check("k", RULE)
        for _ in range(50):
            clock.advance(0.5)
            limiter.check("k", RULE)
        clock.advance(RULE.window_seconds)
        assert limiter.check("k", RULE).allowed

    def test_reset_clears_every_budget(self, limiter: RateLimiter):
        for _ in range(RULE.limit):
            limiter.check("k", RULE)
        assert limiter.check("k", RULE).allowed is False
        limiter.reset()
        assert limiter.check("k", RULE).allowed
        assert len(RateLimiter()) == 0

    def test_keys_are_bounded(self, clock: FakeClock):
        """The key includes client-controlled input, so an unbounded map would
        be a memory-growth vector on exactly the endpoints being protected."""
        bounded = RateLimiter(max_keys=10, now=clock)
        for i in range(500):
            bounded.check(f"key-{i}", RULE)
        assert len(bounded) <= 10


class TestCheckDistinct:
    """The date-enumeration cap: N distinct values per key, not N requests."""

    def test_repeating_a_value_is_free_forever(self, limiter: RateLimiter):
        rule = RateLimitRule(limit=2, window_seconds=60.0)
        for _ in range(100):
            assert limiter.check_distinct("client", "2026-03-14", rule).allowed
        # ...and the budget for OTHER values is untouched by those 100 calls.
        assert limiter.check_distinct("client", "2026-03-15", rule).allowed

    def test_denies_past_the_distinct_limit(self, limiter: RateLimiter):
        rule = RateLimitRule(limit=3, window_seconds=60.0)
        for day in range(3):
            assert limiter.check_distinct("client", f"2026-03-{day:02d}", rule).allowed
        assert limiter.check_distinct("client", "2026-03-99", rule).allowed is False
        # A value already inside the window still works while new ones do not,
        # so a player replaying a board they already opened is never blocked.
        assert limiter.check_distinct("client", "2026-03-00", rule).allowed

    def test_distinct_windows_reset(self, limiter: RateLimiter, clock: FakeClock):
        rule = RateLimitRule(limit=1, window_seconds=60.0)
        assert limiter.check_distinct("client", "a", rule).allowed
        assert limiter.check_distinct("client", "b", rule).allowed is False
        clock.advance(60.0)
        assert limiter.check_distinct("client", "b", rule).allowed

    def test_distinct_keys_do_not_share_a_budget(self, limiter: RateLimiter):
        rule = RateLimitRule(limit=1, window_seconds=60.0)
        assert limiter.check_distinct("client-a", "x", rule).allowed
        assert limiter.check_distinct("client-a", "y", rule).allowed is False
        assert limiter.check_distinct("client-b", "y", rule).allowed

    def test_the_stored_set_cannot_grow_past_the_limit(self, limiter: RateLimiter):
        """Memory per key is capped by the rule itself: once the set is full a
        new value is denied rather than stored."""
        rule = RateLimitRule(limit=5, window_seconds=60.0)
        for i in range(1000):
            limiter.check_distinct("client", f"v{i}", rule)
        # Only the first 5 were ever admitted.
        assert limiter.check_distinct("client", "v0", rule).allowed
        assert limiter.check_distinct("client", "v999", rule).allowed is False

    def test_check_and_check_distinct_do_not_interfere(self, limiter: RateLimiter):
        rule = RateLimitRule(limit=1, window_seconds=60.0)
        assert limiter.check("shared", rule).allowed
        assert limiter.check("shared", rule).allowed is False
        # Same key string, different counter -- the two primitives are separate.
        assert limiter.check_distinct("shared", "v", rule).allowed
