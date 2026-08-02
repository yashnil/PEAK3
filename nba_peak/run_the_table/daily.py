"""Daily seed derivation for RUN THE TABLE.

Follows ``nba_peak/perfect_season/daily.py``: one shared calendar day, one
midnight rollover, and a namespaced SHA-256 seed that is a **pure function of
the date**. The signing secret is deliberately NOT mixed in — everyone getting
the same run is then true by construction rather than by synchronisation, and
the seed can be published so a challenge link can reproduce a daily run
exactly.

The rollover boundary is midnight **America/Los_Angeles**, defined once in
``nba_peak.daily_key`` and shared by every daily mode. It used to be UTC here
and in three sibling helpers, which is how five modes ended up able to disagree
about what day it was.
"""
from __future__ import annotations

import hashlib
from datetime import datetime

from nba_peak.daily_key import (
    InvalidDailyKey,
    daily_key,
    validate_daily_key,
)
from nba_peak.run_the_table.config import RULESET_VERSION

DATE_FORMAT = "%Y-%m-%d"

# Namespace + ruleset salt: bumping the ruleset changes every daily seed, so a
# rules change can never silently reinterpret a stored daily result.
_DAILY_SEED_NAMESPACE = "run-the-table-daily"

# 12 months of archive replay, unchanged — the shared validator's default.
ARCHIVE_DAYS = 366


class InvalidRunDate(InvalidDailyKey):
    """Raised for a malformed or out-of-range date.

    Subclasses ``InvalidDailyKey`` (a ``ValueError``) so the shared validator's
    failures arrive under the name the router and service layer already catch.
    """


def today_utc_date(now: datetime | None = None) -> str:
    """Today's daily date as YYYY-MM-DD, in the daily reset zone.

    Name retained for its callers; the boundary is midnight Pacific, not UTC.
    ``now`` stays injectable so boundary and DST cases are directly testable.
    """
    return daily_key(now)


def validate_run_date(date_str: str, now: datetime | None = None) -> str:
    """Normalise and bound-check a daily date.

    Future dates are rejected so the board cannot be enumerated forward. A
    12-month backward window is allowed for archive replay.
    """
    try:
        return validate_daily_key(date_str, now=now, max_age_days=ARCHIVE_DAYS)
    except InvalidRunDate:
        raise
    except InvalidDailyKey as exc:
        raise InvalidRunDate(str(exc)) from exc


def daily_seed(date_str: str) -> int:
    """Deterministic public seed for the given date. Pure: never reads a clock."""
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
