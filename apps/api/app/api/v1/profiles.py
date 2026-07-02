"""User profile and settings endpoints.

Routes:
  GET  /api/v1/profiles/me          — current user's profile (auth required)
  PUT  /api/v1/profiles/me          — update current user's profile
  GET  /api/v1/profiles/me/settings — current user's settings
  PUT  /api/v1/profiles/me/settings — update current user's settings
  GET  /api/v1/profiles/{handle}    — public profile by handle
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.auth import OptionalAuth, RequiredAuth
from app.core.dependencies import ProfileRepoDep
from app.models.profile import (
    ProfileResponse,
    UpdateProfileRequest,
    UpdateSettingsRequest,
    UserSettingsResponse,
)
from app.repositories.profile_protocols import HandleTakenError, Profile

router = APIRouter()


def _to_response(profile: Profile) -> ProfileResponse:
    return ProfileResponse(
        id=profile.id,
        handle=profile.handle,
        display_name=profile.display_name,
        bio=profile.bio,
        region=profile.region,
        avatar_key=profile.avatar_key,
        is_public=profile.is_public,
        history_public=profile.history_public,
        joined_at=profile.joined_at.isoformat() if hasattr(profile.joined_at, "isoformat") else profile.joined_at,
    )


# ---------------------------------------------------------------------------
# GET /profiles/me
# ---------------------------------------------------------------------------


@router.get("/profiles/me", response_model=ProfileResponse)
async def get_my_profile(auth: RequiredAuth, profile_repo: ProfileRepoDep) -> ProfileResponse:
    profile = await profile_repo.get_or_create_profile(auth.sub)
    return _to_response(profile)


# ---------------------------------------------------------------------------
# PUT /profiles/me
# ---------------------------------------------------------------------------


@router.put("/profiles/me", response_model=ProfileResponse)
async def update_my_profile(
    body: UpdateProfileRequest,
    auth: RequiredAuth,
    profile_repo: ProfileRepoDep,
) -> ProfileResponse:
    updates = body.model_dump(exclude_unset=True)
    try:
        profile = await profile_repo.update_profile(auth.sub, updates)
    except HandleTakenError:
        raise HTTPException(status_code=409, detail="handle_taken")
    return _to_response(profile)


# ---------------------------------------------------------------------------
# GET /profiles/me/settings
# ---------------------------------------------------------------------------


@router.get("/profiles/me/settings", response_model=UserSettingsResponse)
async def get_my_settings(auth: RequiredAuth, profile_repo: ProfileRepoDep) -> UserSettingsResponse:
    s = await profile_repo.get_or_create_settings(auth.sub)
    return UserSettingsResponse(timezone=s.timezone, reduced_motion=s.reduced_motion)


# ---------------------------------------------------------------------------
# PUT /profiles/me/settings
# ---------------------------------------------------------------------------


@router.put("/profiles/me/settings", response_model=UserSettingsResponse)
async def update_my_settings(
    body: UpdateSettingsRequest,
    auth: RequiredAuth,
    profile_repo: ProfileRepoDep,
) -> UserSettingsResponse:
    updates = body.model_dump(exclude_unset=True)
    s = await profile_repo.update_settings(auth.sub, updates)
    return UserSettingsResponse(timezone=s.timezone, reduced_motion=s.reduced_motion)


# ---------------------------------------------------------------------------
# GET /profiles/{handle} — public profile
# ---------------------------------------------------------------------------


@router.get("/profiles/{handle}", response_model=ProfileResponse)
async def get_public_profile(
    handle: str,
    auth: OptionalAuth,
    profile_repo: ProfileRepoDep,
) -> ProfileResponse:
    profile = await profile_repo.get_profile_by_handle(handle)
    if profile is None:
        raise HTTPException(status_code=404, detail="profile_not_found")

    # Owner can always read their own profile
    if auth and auth.sub == profile.auth_sub:
        return _to_response(profile)
    # Non-owner: only if profile is public
    if profile.is_public:
        return _to_response(profile)
    raise HTTPException(status_code=403, detail="profile_private")
