"""Authentication and anonymous ownership endpoints.

Routes:
  GET  /api/v1/auth/me              — return current identity (auth or anon)
  POST /api/v1/auth/anon            — issue an anonymous subject cookie
  POST /api/v1/auth/claim           — transfer anonymous activity to authenticated user
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Response

from app.core.auth import (
    ANON_COOKIE_MAX_AGE as _SHARED_ANON_COOKIE_MAX_AGE,
    ANON_COOKIE_NAME as _SHARED_ANON_COOKIE_NAME,
    OptionalAuth,
    RequiredAuth,
    resolve_owner_sub,
    verify_anon_subject,
)
from app.core.config import settings
from app.core.dependencies import (
    AchievementRepoDep,
    ChallengeRepoDep,
    DailyCompletionRepoDep,
    GameRepoDep,
    OwnershipClaimRepoDep,
    ProgressionRepoDep,
    RecordRepoDep,
    ResultSnapshotRepoDep,
    StreakRepoDep,
)
from app.repositories.protocols import OwnershipClaim

router = APIRouter()

# Re-exported from app.core.auth (the shared, canonical definitions — also
# used by app/api/v1/draft.py) so existing references to the plain names
# below keep working unchanged.
ANON_COOKIE_NAME = _SHARED_ANON_COOKIE_NAME
ANON_COOKIE_MAX_AGE = _SHARED_ANON_COOKIE_MAX_AGE


# ---------------------------------------------------------------------------
# GET /auth/me — identity probe
# ---------------------------------------------------------------------------


@router.get("/auth/me")
async def get_me(
    auth: OptionalAuth,
    response: Response,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> dict:
    """Return the caller's current identity.

    If authenticated: returns auth subject.
    If anonymous cookie present: returns anon subject.
    If neither: issues a new anon cookie and returns the anon subject.
    """
    if auth is not None:
        return {
            "authenticated": True,
            "sub": auth.sub,
            "email": auth.email,
            "is_anonymous": auth.is_anonymous,
        }

    anon_sub = _get_or_create_anon_sub(peak3_anon, response)
    return {
        "authenticated": False,
        "sub": anon_sub,
        "is_anonymous": True,
    }


# ---------------------------------------------------------------------------
# POST /auth/anon — explicit anon subject issuance
# ---------------------------------------------------------------------------


@router.post("/auth/anon")
async def create_anon(
    response: Response,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> dict:
    """Issue (or return) an anonymous subject cookie.

    Idempotent: returns the existing subject if the cookie is already valid.
    """
    anon_sub = _get_or_create_anon_sub(peak3_anon, response)
    return {"sub": anon_sub, "is_anonymous": True}


# ---------------------------------------------------------------------------
# POST /auth/claim — transfer anonymous activity to authenticated user
# ---------------------------------------------------------------------------


@router.post("/auth/claim")
async def claim_anonymous_activity(
    response: Response,
    auth: RequiredAuth,
    game_repo: GameRepoDep,
    challenge_repo: ChallengeRepoDep,
    daily_completion_repo: DailyCompletionRepoDep,
    result_snapshot_repo: ResultSnapshotRepoDep,
    claim_repo: OwnershipClaimRepoDep,
    progression_repo: ProgressionRepoDep,
    record_repo: RecordRepoDep,
    achievement_repo: AchievementRepoDep,
    streak_repo: StreakRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> dict:
    """Claim anonymous activity for the authenticated user.

    Steps:
    1. Verify authenticated user.
    2. Verify anonymous credential from cookie.
    3. Check for an existing claim (idempotent).
    4. Transfer ownership of games, completions, challenges.
    5. Record the claim.
    6. Mark the anonymous cookie consumed.
    7. Return counts and claim ID.
    """
    # 1. Authenticated identity is already verified via RequiredAuth dependency.
    real_sub = auth.sub

    # 2. Verify anonymous credential
    if not peak3_anon:
        return {
            "claimed": False,
            "reason": "no_anon_session",
            "game_count": 0,
            "completion_count": 0,
            "challenge_count": 0,
        }

    anon_sub = verify_anon_subject(peak3_anon, settings.SIGNING_SECRET)
    if not anon_sub:
        return {
            "claimed": False,
            "reason": "invalid_anon_credential",
            "game_count": 0,
            "completion_count": 0,
            "challenge_count": 0,
        }

    # Prevent a user from claiming their own authenticated sub (shouldn't happen,
    # but guard against edge cases in anonymous Supabase sessions).
    if anon_sub == real_sub:
        return {
            "claimed": True,
            "reason": "already_same_user",
            "game_count": 0,
            "completion_count": 0,
            "challenge_count": 0,
        }

    # 3. Check idempotency — if already claimed, return the prior result
    existing = await claim_repo.get_claim_by_anon(anon_sub)
    if existing is not None:
        if existing.real_user_sub != real_sub:
            # Another user already claimed this anon sub
            raise HTTPException(
                status_code=409,
                detail="anon_session_already_claimed",
            )
        return {
            "claimed": True,
            "claim_id": existing.id,
            "reason": "already_claimed",
            "game_count": existing.game_count,
            "completion_count": existing.completion_count,
            "challenge_count": existing.challenge_count,
        }

    # 4. Transfer ownership through the repository's own transfer_owner
    # method — real for both in-memory and PostgreSQL backends (previously
    # this reached into memory-repo private attributes and silently
    # no-op'd against Postgres; see docs/architecture/REPOSITORY_WIRING_AUDIT.md).
    game_count = await game_repo.transfer_owner(anon_sub, real_sub)
    completion_count = await daily_completion_repo.transfer_owner(anon_sub, real_sub)
    challenge_count = await challenge_repo.transfer_owner(anon_sub, real_sub)
    await result_snapshot_repo.transfer_owner(anon_sub, real_sub)

    # 4b. Transfer progression atomically (Phase 3.1)
    progression_count = await progression_repo.transfer_events(anon_sub, real_sub)
    record_count = await record_repo.transfer_records(anon_sub, real_sub)
    achievement_count = await achievement_repo.transfer_awards(anon_sub, real_sub)
    await streak_repo.transfer_streak(anon_sub, real_sub)

    # Recalculate user_progress total after merging anon XP into real user
    all_events = await progression_repo.list_events(real_sub, limit=10_000)
    merged_xp = sum(e.xp_amount for e in all_events)
    from app.services.progression.levels import level_from_xp
    from app.services.progression.xp_policy import ACTIVE_POLICY_VERSION
    from app.repositories.progression_protocols import UserProgress
    from datetime import datetime, timezone as _tz
    await progression_repo.upsert_progress(UserProgress(
        owner_sub=real_sub,
        total_xp=merged_xp,
        current_level=level_from_xp(merged_xp),
        policy_version=ACTIVE_POLICY_VERSION,
        last_progression_at=datetime.now(_tz.utc),
    ))

    # 5. Record the claim
    claim = OwnershipClaim(
        id=str(uuid.uuid4()),
        real_user_sub=real_sub,
        anon_subject_id=anon_sub,
        claimed_at=datetime.now(timezone.utc),
        game_count=game_count,
        completion_count=completion_count,
        challenge_count=challenge_count,
    )
    await claim_repo.record_claim(claim)

    # 6. Clear the anonymous cookie (consumed)
    response.delete_cookie(ANON_COOKIE_NAME, path="/", samesite="lax")

    return {
        "claimed": True,
        "claim_id": claim.id,
        "reason": "claimed",
        "game_count": game_count,
        "completion_count": completion_count,
        "challenge_count": challenge_count,
        "progression_events_claimed": progression_count,
        "records_claimed": record_count,
        "achievements_claimed": achievement_count,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_or_create_anon_sub(
    existing_cookie: Optional[str],
    response: Response,
) -> str:
    """Return existing verified anon sub, or issue a new one.

    Thin wrapper over the shared app.core.auth.resolve_owner_sub — the
    canonical resolution path also used by app/api/v1/draft.py, so both
    routers issue/read the exact same peak3_anon cookie consistently.
    """
    return resolve_owner_sub(None, existing_cookie, response, settings.SIGNING_SECRET)


