"""Daily seed derivation for RUN THE TABLE.

Follows ``nba_peak/perfect_season/daily.py``: UTC date, midnight rollover, and
a namespaced SHA-256 seed that is a **pure function of the date**. The signing
secret is deliberately NOT mixed in — everyone getting the same run is then
true by construction rather than by synchronisation, and the seed can be
published so a challenge link can reproduce a daily run exactly.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from nba_peak.run_the_table.config import RULESET_VERSION

DATE_FORMAT = "%Y-%m-%d"

# Namespace + ruleset salt: bumping the ruleset changes every daily seed, so a
# rules change can never silently reinterpret a stored daily result.
_DAILY_SEED_NAMESPACE = "run-the-table-daily"


class InvalidRunDate(ValueError):
    """Raised for a malformed or out-of-range date."""


def today_utc_date(now: datetime | None = None) -> str:
    ref = now or datetime.now(timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    return ref.astimezone(timezone.utc).strftime(DATE_FORMAT)


def validate_run_date(date_str: str, now: datetime | None = None) -> str:
    """Normalise and bound-check a daily date.

    Future dates are rejected so the board cannot be enumerated forward. A
    12-month backward window is allowed for archive replay.
    """
    try:
        parsed = datetime.strptime(date_str, DATE_FORMAT).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        raise InvalidRunDate(f"Date must be YYYY-MM-DD, got {date_str!r}")

    today = datetime.strptime(today_utc_date(now), DATE_FORMAT).replace(tzinfo=timezone.utc)
    if parsed > today:
        raise InvalidRunDate("Cannot request a future daily run")
    if parsed < today - timedelta(days=366):
        raise InvalidRunDate("Daily archive only extends back 366 days")
    return parsed.strftime(DATE_FORMAT)


def daily_seed(date_str: str) -> int:
    """Deterministic public seed for the given UTC date."""
    raw = f"{_DAILY_SEED_NAMESPACE}:{RULESET_VERSION}:{date_str}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16) % (2 ** 31)


def daily_run_id(date_str: str) -> str:
    return f"rtt-daily-{date_str}"


def daily_descriptor(date_str: str) -> dict:
    """Public, spoiler-free description of a daily run."""
    return {
        "date": date_str,
        "run_id": daily_run_id(date_str),
        "seed": daily_seed(date_str),
        "ruleset_version": RULESET_VERSION,
    }
