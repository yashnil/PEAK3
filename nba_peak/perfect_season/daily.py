"""Daily PEAK Season challenge: deterministic date-keyed seed (Phase 9A).

The whole daily challenge rests on one property the board generator already
guarantees: `generate_team_year_board(mode, seed)` is fully deterministic in
(mode, seed) -- same seed, same 8-round spin sequence, same candidates, in
the same order (see board.py's own "immutable once created" discipline and
ADR-001/ADR-004 Sec 15). So a "shared daily challenge" needs no new board
machinery and no stored per-date board snapshot at all: it only needs a seed
that every player derives identically from the calendar date.

Deliberately mirrors the existing Peak Duel precedent
(apps/api/app/services/duel.py::daily_seed) rather than inventing a second
convention -- same SHA-256-of-a-date-string approach, same 2**31 range so
the value stays a valid `seed` everywhere CourtBuilder already accepts one.
Differences, both intentional:
  - the salt includes MODE (apex_1y/prime_3y/foundation_5y), so the three
    durations are three genuinely distinct daily challenges rather than the
    same spin sequence relabeled;
  - the salt is namespaced with a literal prefix, so a given date can never
    collide with Peak Duel's own daily seed for that date (they index
    different games; sharing a seed value between them would be a
    coincidence waiting to confuse a future reader).

No network access, no stored state, no randomness: a pure function of
(date, mode). That is what makes "two users opening the same date get the
same board" true by construction rather than by a synchronization step.
"""
from __future__ import annotations

import hashlib
from datetime import datetime

from nba_peak.daily_key import (
    InvalidDailyKey,
    daily_key,
    parse_daily_key,
    validate_daily_key,
)

# Namespace prefix -- see module docstring (never share a raw date salt with
# another game's daily seed).
_DAILY_SEED_NAMESPACE = "peak-season-daily"

# Same modulus as apps/api/app/services/duel.py::daily_seed -- keeps the
# result inside the signed-32-bit range every existing seed path accepts.
_SEED_MODULUS = 2 ** 31

DAILY_CHALLENGE_VERSION = "peak_season_daily.v1"

# board_type for a daily attempt. Distinct from "practice" (free play) so a
# daily run is separable in storage/history without inferring it from the
# seed, and so board_id (see board.py::_make_board_id) self-describes.
DAILY_BOARD_TYPE = "daily"
FREE_PLAY_BOARD_TYPE = "practice"

DATE_FORMAT = "%Y-%m-%d"


class InvalidChallengeDate(InvalidDailyKey):
    """Raised for a date string that is not a real, in-range daily key.

    Subclasses ``InvalidDailyKey`` (itself a ``ValueError``) so the shared
    validator's failures surface under the name this package's callers already
    catch, and so `except InvalidDailyKey` is equally correct.
    """


def today_utc_date(now: datetime | None = None) -> str:
    """Today's challenge date as YYYY-MM-DD, in the daily reset zone.

    The name is kept for its callers; the BOUNDARY is no longer UTC. Every
    shared daily mode rolls over at midnight America/Los_Angeles, and that
    decision lives in exactly one module (``nba_peak.daily_key``) so the five
    modes cannot disagree about what day it is.
    """
    return daily_key(now)


def challenge_date_shape(date_str: str) -> str:
    """Shape-only check, for the PURE seed/id functions below.

    A challenge is a pure function of (date, mode), so every calendar date
    names exactly one challenge and the derivation must stay clock-free --
    otherwise `daily_seed` would depend on when it was called. What a CLIENT
    may ask for is a different question; `validate_challenge_date` answers it.
    """
    try:
        return parse_daily_key(date_str).strftime(DATE_FORMAT)
    except InvalidDailyKey as exc:
        raise InvalidChallengeDate(
            f"date must be a real YYYY-MM-DD date, got '{date_str}'"
        ) from exc


def validate_challenge_date(date_str: str, *, now: datetime | None = None) -> str:
    """Return the normalised date if a client may ask for it, else raise.

    Rejects malformed strings, impossible dates ("2026-02-30"), dates in the
    FUTURE (that challenge has not opened yet, and enumerating it forward is
    not a supported read) and anything past the archive window.
    """
    try:
        return validate_daily_key(date_str, now=now)
    except InvalidChallengeDate:
        raise
    except InvalidDailyKey as exc:
        raise InvalidChallengeDate(str(exc)) from exc


def daily_seed(date_str: str, mode: str) -> int:
    """The deterministic board seed for one (date, mode) daily challenge.

    Pure: no clock read, no randomness, no I/O -- callers pass the date in
    explicitly (use today_utc_date() for "today") so the same function
    serves today, a replay of an earlier date, and tests without branching.
    """
    date_str = challenge_date_shape(date_str)
    raw = f"{_DAILY_SEED_NAMESPACE}:{date_str}:{mode}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16) % _SEED_MODULUS


def daily_challenge_id(date_str: str, mode: str) -> str:
    """Stable identifier for one daily challenge -- e.g.
    "peak-season-daily-2026-07-29-apex_1y". Used as the storage key for
    "has this user already played today's challenge in this mode", so it
    must stay stable for a given (date, mode) forever."""
    date_str = challenge_date_shape(date_str)
    return f"{_DAILY_SEED_NAMESPACE}-{date_str}-{mode}"


def daily_challenge_descriptor(date_str: str, mode: str) -> dict:
    """Everything a client needs to launch/label today's shared challenge,
    as a plain dict (same at-the-API-boundary convention as
    LineupFitComponents.as_dict()). `seed` is included deliberately: it is
    not secret -- it is the very thing that must be identical for everyone
    on this date, and the client already passes an explicit seed for a
    replayable free-play board."""
    date_str = challenge_date_shape(date_str)
    return {
        "challenge_date": date_str,
        "mode": mode,
        "seed": daily_seed(date_str, mode),
        "challenge_id": daily_challenge_id(date_str, mode),
        "board_type": DAILY_BOARD_TYPE,
        "daily_challenge_version": DAILY_CHALLENGE_VERSION,
    }
