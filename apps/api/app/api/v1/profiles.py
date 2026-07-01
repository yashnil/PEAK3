"""User profile and settings endpoints.

Routes:
  GET  /api/v1/profiles/me          — current user's profile (auth required)
  PUT  /api/v1/profiles/me          — update current user's profile
  GET  /api/v1/profiles/me/settings — current user's settings
  PUT  /api/v1/profiles/me/settings — update current user's settings
  GET  /api/v1/profiles/{handle}    — public profile by handle
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.core.auth import OptionalAuth, RequiredAuth
from app.models.profile import (
    ProfileResponse,
    UpdateProfileRequest,
    UpdateSettingsRequest,
    UserSettingsResponse,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory profile store (replaced by PostgreSQL when DATABASE_URL is set)
# These dicts are keyed by auth_sub for development/test.
# ---------------------------------------------------------------------------

_profiles: dict[str, dict] = {}
_settings: dict[str, dict] = {}


def _get_or_create_profile(auth_sub: str) -> dict:
    if auth_sub not in _profiles:
        _profiles[auth_sub] = {
            "id": str(uuid.uuid4()),
            "auth_sub": auth_sub,
            "handle": None,
            "display_name": None,
            "bio": None,
            "region": None,
            "avatar_key": None,
            "is_public": False,
            "history_public": False,
            "joined_at": datetime.now(timezone.utc).isoformat(),
        }
    return _profiles[auth_sub]


def _get_or_create_settings(auth_sub: str) -> dict:
    if auth_sub not in _settings:
        _settings[auth_sub] = {
            "timezone": "UTC",
            "reduced_motion": False,
        }
    return _settings[auth_sub]


# ---------------------------------------------------------------------------
# GET /profiles/me
# ---------------------------------------------------------------------------


@router.get("/profiles/me", response_model=ProfileResponse)
async def get_my_profile(auth: RequiredAuth) -> ProfileResponse:
    profile = _get_or_create_profile(auth.sub)
    return ProfileResponse(**profile)


# ---------------------------------------------------------------------------
# PUT /profiles/me
# ---------------------------------------------------------------------------


@router.put("/profiles/me", response_model=ProfileResponse)
async def update_my_profile(
    body: UpdateProfileRequest,
    auth: RequiredAuth,
) -> ProfileResponse:
    profile = _get_or_create_profile(auth.sub)

    # Handle uniqueness check (case-insensitive)
    if body.handle is not None:
        normalized = body.handle.lower()
        for sub, p in _profiles.items():
            if sub != auth.sub and (p.get("handle") or "").lower() == normalized:
                raise HTTPException(status_code=409, detail="handle_taken")
        profile["handle"] = normalized

    if body.display_name is not None:
        profile["display_name"] = body.display_name
    if body.bio is not None:
        profile["bio"] = body.bio
    if body.region is not None:
        profile["region"] = body.region
    if body.avatar_key is not None:
        profile["avatar_key"] = body.avatar_key
    if body.is_public is not None:
        profile["is_public"] = body.is_public
    if body.history_public is not None:
        profile["history_public"] = body.history_public

    return ProfileResponse(**profile)


# ---------------------------------------------------------------------------
# GET /profiles/me/settings
# ---------------------------------------------------------------------------


@router.get("/profiles/me/settings", response_model=UserSettingsResponse)
async def get_my_settings(auth: RequiredAuth) -> UserSettingsResponse:
    s = _get_or_create_settings(auth.sub)
    return UserSettingsResponse(**s)


# ---------------------------------------------------------------------------
# PUT /profiles/me/settings
# ---------------------------------------------------------------------------


@router.put("/profiles/me/settings", response_model=UserSettingsResponse)
async def update_my_settings(
    body: UpdateSettingsRequest,
    auth: RequiredAuth,
) -> UserSettingsResponse:
    s = _get_or_create_settings(auth.sub)
    if body.timezone is not None:
        s["timezone"] = body.timezone
    if body.reduced_motion is not None:
        s["reduced_motion"] = body.reduced_motion
    return UserSettingsResponse(**s)


# ---------------------------------------------------------------------------
# GET /profiles/{handle} — public profile
# ---------------------------------------------------------------------------


@router.get("/profiles/{handle}", response_model=ProfileResponse)
async def get_public_profile(
    handle: str,
    auth: OptionalAuth,
) -> ProfileResponse:
    normalized = handle.strip().lower()
    for sub, p in _profiles.items():
        if (p.get("handle") or "").lower() == normalized:
            # Owner can always read their own profile
            if auth and auth.sub == sub:
                return ProfileResponse(**p)
            # Non-owner: only if profile is public
            if p.get("is_public"):
                return ProfileResponse(**p)
            raise HTTPException(status_code=403, detail="profile_private")

    raise HTTPException(status_code=404, detail="profile_not_found")
