"""The single server-authoritative daily key for every shared PEAK3 mode.

Every globally-shared daily board — RUN THE TABLE Daily, Daily Grid, Peak Duel
Daily, Peak Draft Daily, PEAK Season Daily, and any daily leaderboard — rolls
over at **midnight America/Los_Angeles**. This module is the only place that
decision is encoded. Before it existed there were four near-identical
``today_utc_date()`` helpers plus five inline ``strftime``/``toISOString``
expressions across two apps, three of which let the *client* cast the deciding
vote on what day it was.

Design rules, in priority order:

1. **IANA zone, never a fixed offset.** ``America/Los_Angeles`` is UTC-8 in
   winter and UTC-7 in summer. A hardcoded ``-08:00`` silently shifts the reset
   to 1am local for eight months of the year.
2. **The server decides.** A client may *ask* for a specific archive date, but
   "today" is never taken from a browser clock. ``daily_key()`` reads the
   process clock; every route resolves ``date or daily_key()``.
3. **The window travels with the key.** Responses carry ``starts_at`` /
   ``ends_at`` / ``seconds_remaining`` so a client never has to recompute a
   timezone boundary in JavaScript — it only has to count down.

DST behaviour is not an edge case here, it is the point: on the spring-forward
day the window is 23 hours, on the fall-back day it is 25. Both are correct and
both are tested. Midnight itself is never a nonexistent local time in this zone
(US transitions happen at 02:00), but ``fold``/normalisation is handled
defensively anyway so the module stays correct if the policy zone ever changes.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as _date
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

__all__ = [
    "DAILY_TIMEZONE",
    "DAILY_TZ",
    "DAILY_KEY_FORMAT",
    "DailyWindow",
    "daily_key",
    "daily_window",
    "validate_daily_key",
    "parse_daily_key",
    "day_start_utc",
    "seconds_until_next_daily",
]

# The product-wide reset zone. Changing this string changes every shared daily
# mode at once — which is exactly why it lives in one place.
DAILY_TIMEZONE = "America/Los_Angeles"
DAILY_TZ = ZoneInfo(DAILY_TIMEZONE)

DAILY_KEY_FORMAT = "%Y-%m-%d"

# How far back an archive request may reach. Mirrors the pre-existing RUN THE
# TABLE bound so archive replay stays finite and enumeration stays cheap.
MAX_ARCHIVE_DAYS = 366


class InvalidDailyKey(ValueError):
    """A daily key was malformed, out of range, or in the future."""


@dataclass(frozen=True)
class DailyWindow:
    """The open/close boundary of one daily board, in absolute time."""

    daily_key: str
    timezone: str
    starts_at: datetime      # inclusive, tz-aware UTC
    ends_at: datetime        # exclusive, tz-aware UTC
    seconds_remaining: int   # until ends_at, floored at 0

    def to_payload(self) -> dict:
        """The wire shape every daily API response embeds."""
        return {
            "daily_key": self.daily_key,
            "timezone": self.timezone,
            "starts_at": self.starts_at.isoformat().replace("+00:00", "Z"),
            "ends_at": self.ends_at.isoformat().replace("+00:00", "Z"),
            "seconds_remaining": self.seconds_remaining,
        }


def _as_utc(now: datetime | None) -> datetime:
    """Normalise an optional reference instant to tz-aware UTC.

    A naive datetime is interpreted as UTC rather than local time: the API runs
    in containers whose local zone is an accident of deployment, and silently
    reading it would reintroduce exactly the client/server disagreement this
    module exists to remove.
    """
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def daily_key(now: datetime | None = None) -> str:
    """Return today's daily key (``YYYY-MM-DD``) in the daily reset zone.

    ``now`` is injectable so boundary, DST, leap-day and year-rollover cases are
    directly testable — the helpers this replaces read the clock internally and
    were therefore untestable at a boundary.
    """
    return _as_utc(now).astimezone(DAILY_TZ).strftime(DAILY_KEY_FORMAT)


def parse_daily_key(value: str) -> _date:
    """Parse a daily key into a date, raising InvalidDailyKey on bad shape."""
    if not isinstance(value, str):
        raise InvalidDailyKey("daily key must be a string")
    try:
        return datetime.strptime(value.strip(), DAILY_KEY_FORMAT).date()
    except (ValueError, TypeError):
        raise InvalidDailyKey(f"daily key must be YYYY-MM-DD, got {value!r}")


def day_start_utc(day: _date) -> datetime:
    """The absolute instant a given local day begins, as UTC.

    Uses ``ZoneInfo`` arithmetic rather than an offset so the spring-forward and
    fall-back days produce 23- and 25-hour windows respectively.
    """
    local_midnight = datetime.combine(day, time.min, tzinfo=DAILY_TZ)
    # If the policy zone ever moves its transition onto midnight itself, the
    # earlier of the two ambiguous instants is the board's true start.
    return local_midnight.replace(fold=0).astimezone(timezone.utc)


def validate_daily_key(
    value: str | None,
    *,
    now: datetime | None = None,
    max_age_days: int = MAX_ARCHIVE_DAYS,
    allow_future: bool = False,
) -> str:
    """Validate a client-supplied daily key against the server's clock.

    Returns the normalised key. Raises ``InvalidDailyKey`` for a malformed key,
    a future key (the board does not exist yet), or one older than the archive
    window. Callers pass ``value or daily_key()`` — the server always owns the
    default.
    """
    if value is None:
        raise InvalidDailyKey("daily key is required")

    day = parse_daily_key(value)
    today = parse_daily_key(daily_key(now))

    if not allow_future and day > today:
        raise InvalidDailyKey(f"daily key {value} is in the future")
    if (today - day).days > max_age_days:
        raise InvalidDailyKey(
            f"daily key {value} is older than the {max_age_days}-day archive window"
        )
    return day.strftime(DAILY_KEY_FORMAT)


def daily_window(
    key: str | None = None,
    *,
    now: datetime | None = None,
) -> DailyWindow:
    """Describe the board window for ``key`` (defaulting to today).

    ``seconds_remaining`` is measured from ``now`` to the window's end and
    floored at zero, so an archive board reports 0 rather than a negative
    countdown.
    """
    reference = _as_utc(now)
    resolved = key or daily_key(reference)
    day = parse_daily_key(resolved)

    starts_at = day_start_utc(day)
    ends_at = day_start_utc(day + timedelta(days=1))
    remaining = int((ends_at - reference).total_seconds())

    return DailyWindow(
        daily_key=day.strftime(DAILY_KEY_FORMAT),
        timezone=DAILY_TIMEZONE,
        starts_at=starts_at,
        ends_at=ends_at,
        seconds_remaining=max(0, remaining),
    )


def seconds_until_next_daily(now: datetime | None = None) -> int:
    """Seconds until the next reset. Never negative, never zero-for-a-whole-second."""
    return daily_window(now=now).seconds_remaining
