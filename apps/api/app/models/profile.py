"""Pydantic models for user profiles and settings."""
from __future__ import annotations

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator

# Exact-match only. Short, common words that would over-block real handles
# (e.g. "me", "help", "play") if matched as a substring -- "gamer" contains
# "me", "playful" contains "play". These are blocked only when they ARE the
# whole handle, which is enough to stop someone claiming a route/keyword
# outright without catching ordinary handles that merely contain one.
RESERVED_HANDLES = frozenset({
    "admin", "system", "peak3", "api", "auth", "me", "settings",
    "profile", "history", "arena", "play", "daily", "rankings",
    "about", "methodology", "support", "help", "null", "undefined",
})

# Substring match, deliberately. Unlike RESERVED_HANDLES, these are brand and
# authority terms where the impersonation risk is the same whether they are
# the whole handle or embedded in it -- "peak3_staff", "real_admin",
# "notarobot_official" are exactly the handles this exists to catch, and
# none of them are exact matches against RESERVED_HANDLES above. Kept short
# and MVP-appropriate on purpose: this is a launch-time impersonation
# tripwire, not a general trademark filter, so it only covers this
# product's own name and generic authority/staff claims.
IMPERSONATION_SUBSTRINGS = frozenset({
    "peak3", "admin", "official", "staff", "moderator", "support",
})

# Static, minimal, MVP-appropriate denylist -- a launch-time floor against
# the most common slurs and profanity as a public-facing handle, not a claim
# of completeness. Deliberately short: a longer list starts producing false
# positives against ordinary words and place names, which is a worse failure
# mode for a handle picker than an occasional miss here. Checked as a
# substring, same reasoning as IMPERSONATION_SUBSTRINGS -- "handle123fuck" is
# exactly as much of a problem as the word standing alone.
PROFANITY_SUBSTRINGS = frozenset({
    "fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot",
    "retard", "rape", "whore",
})

# 3-20 chars (tightened from 3-30 -- launch-polish IMPLEMENTATION_CONTRACT.md
# §8), start/end alnum, interior letters/digits/underscores only.
HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_]{1,18}[a-z0-9]$")


def _contains_any(normalized: str, terms: frozenset[str]) -> Optional[str]:
    """First matching term found as a substring of `normalized`, or None."""
    for term in terms:
        if term in normalized:
            return term
    return None


class ProfileResponse(BaseModel):
    id: str
    handle: Optional[str] = None
    display_name: Optional[str] = None
    bio: Optional[str] = None
    region: Optional[str] = None
    avatar_key: Optional[str] = None
    is_public: bool
    history_public: bool
    joined_at: str


class UpdateProfileRequest(BaseModel):
    handle: Optional[str] = Field(None, min_length=3, max_length=20)
    display_name: Optional[str] = Field(None, max_length=60)
    bio: Optional[str] = Field(None, max_length=500)
    region: Optional[str] = Field(None, max_length=100)
    avatar_key: Optional[str] = Field(None, max_length=50)
    is_public: Optional[bool] = None
    history_public: Optional[bool] = None

    @field_validator("handle")
    @classmethod
    def validate_handle(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        normalized = v.lower().strip()
        # Stable, specific error per failure reason (contract: "stable
        # validation errors") -- a client can show the right hint instead of
        # one generic "invalid handle" for every rejection reason.
        if not HANDLE_RE.match(normalized):
            raise ValueError(
                "Handle must be 3-20 characters, start/end with a letter or "
                "digit, and contain only letters, digits, and underscores."
            )
        if normalized in RESERVED_HANDLES:
            raise ValueError(f"Handle '{normalized}' is reserved.")
        impersonation_hit = _contains_any(normalized, IMPERSONATION_SUBSTRINGS)
        if impersonation_hit is not None:
            raise ValueError(
                f"Handle '{normalized}' is not allowed: it contains "
                f"'{impersonation_hit}', which is reserved to prevent "
                "impersonation of PEAK3 staff or the product itself."
            )
        if _contains_any(normalized, PROFANITY_SUBSTRINGS) is not None:
            raise ValueError(
                f"Handle '{normalized}' is not allowed. Choose a different handle."
            )
        return normalized


class UserSettingsResponse(BaseModel):
    timezone: str
    reduced_motion: bool


class UpdateSettingsRequest(BaseModel):
    timezone: Optional[str] = Field(None, max_length=64)
    reduced_motion: Optional[bool] = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        import zoneinfo
        try:
            zoneinfo.ZoneInfo(v)
        except Exception:
            raise ValueError(f"'{v}' is not a valid IANA timezone identifier.")
        return v
