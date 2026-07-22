"""Repository protocols for user profiles and settings.

Structural subtypes (typing.Protocol) — implementations in memory_profile.py
(tests/dev) and postgres_profile.py (production). Async throughout, matching
every other repository in this package (see repositories/protocols.py's
GameRepository docstring for the rationale).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Protocol, runtime_checkable


class HandleTakenError(Exception):
    """Raised when a profile update requests a handle already owned by another user."""


@dataclass
class Profile:
    id: str
    auth_sub: str
    handle: Optional[str]
    display_name: Optional[str]
    bio: Optional[str]
    region: Optional[str]
    avatar_key: Optional[str]
    is_public: bool
    history_public: bool
    joined_at: datetime


@dataclass
class UserSettings:
    profile_id: str
    timezone: str
    reduced_motion: bool


@runtime_checkable
class ProfileRepository(Protocol):
    async def get_or_create_profile(self, auth_sub: str) -> Profile: ...

    async def update_profile(self, auth_sub: str, updates: dict) -> Profile:
        """Apply a partial update. Raises HandleTakenError on handle collision."""
        ...

    async def get_profile_by_handle(self, handle: str) -> Optional[Profile]: ...

    async def get_or_create_settings(self, auth_sub: str) -> UserSettings: ...

    async def update_settings(self, auth_sub: str, updates: dict) -> UserSettings: ...
