"""Pydantic models for user profiles and settings."""
from __future__ import annotations

import re
from typing import Optional
from pydantic import BaseModel, Field, field_validator

RESERVED_HANDLES = frozenset({
    "admin", "system", "peak3", "api", "auth", "me", "settings",
    "profile", "history", "arena", "play", "daily", "rankings",
    "about", "methodology", "support", "help", "null", "undefined",
})

HANDLE_RE = re.compile(r"^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$")


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
    handle: Optional[str] = Field(None, min_length=3, max_length=30)
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
        if not HANDLE_RE.match(normalized):
            raise ValueError(
                "Handle must be 3-30 characters, start/end with a letter or digit, "
                "and contain only letters, digits, and underscores."
            )
        if normalized in RESERVED_HANDLES:
            raise ValueError(f"Handle '{normalized}' is reserved.")
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
