"""In-memory ProfileRepository implementation — tests and DATABASE_URL-unset dev."""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from app.repositories.profile_protocols import HandleTakenError, Profile, UserSettings


class MemoryProfileRepository:
    """Thread-safe in-memory profile + settings store, keyed by auth_sub."""

    def __init__(self) -> None:
        self._profiles: dict[str, Profile] = {}
        self._settings: dict[str, UserSettings] = {}
        self._lock = threading.Lock()

    async def get_or_create_profile(self, auth_sub: str) -> Profile:
        with self._lock:
            profile = self._profiles.get(auth_sub)
            if profile is None:
                profile = Profile(
                    id=str(uuid.uuid4()),
                    auth_sub=auth_sub,
                    handle=None,
                    display_name=None,
                    bio=None,
                    region=None,
                    avatar_key=None,
                    is_public=False,
                    history_public=False,
                    joined_at=datetime.now(timezone.utc),
                )
                self._profiles[auth_sub] = profile
            return profile

    async def update_profile(self, auth_sub: str, updates: dict) -> Profile:
        with self._lock:
            profile = self._profiles.get(auth_sub)
            if profile is None:
                profile = Profile(
                    id=str(uuid.uuid4()),
                    auth_sub=auth_sub,
                    handle=None,
                    display_name=None,
                    bio=None,
                    region=None,
                    avatar_key=None,
                    is_public=False,
                    history_public=False,
                    joined_at=datetime.now(timezone.utc),
                )
                self._profiles[auth_sub] = profile

            if "handle" in updates and updates["handle"] is not None:
                normalized = updates["handle"].lower()
                for other_sub, other in self._profiles.items():
                    if other_sub != auth_sub and (other.handle or "").lower() == normalized:
                        raise HandleTakenError(normalized)
                profile.handle = normalized

            for field in ("display_name", "bio", "region", "avatar_key", "is_public", "history_public"):
                if field in updates and updates[field] is not None:
                    setattr(profile, field, updates[field])

            return profile

    async def get_profile_by_handle(self, handle: str) -> Profile | None:
        normalized = handle.strip().lower()
        with self._lock:
            for profile in self._profiles.values():
                if (profile.handle or "").lower() == normalized:
                    return profile
        return None

    async def get_or_create_settings(self, auth_sub: str) -> UserSettings:
        with self._lock:
            settings = self._settings.get(auth_sub)
            if settings is None:
                settings = UserSettings(profile_id=auth_sub, timezone="UTC", reduced_motion=False)
                self._settings[auth_sub] = settings
            return settings

    async def update_settings(self, auth_sub: str, updates: dict) -> UserSettings:
        with self._lock:
            settings = self._settings.get(auth_sub)
            if settings is None:
                settings = UserSettings(profile_id=auth_sub, timezone="UTC", reduced_motion=False)
                self._settings[auth_sub] = settings
            if updates.get("timezone") is not None:
                settings.timezone = updates["timezone"]
            if updates.get("reduced_motion") is not None:
                settings.reduced_motion = updates["reduced_motion"]
            return settings
