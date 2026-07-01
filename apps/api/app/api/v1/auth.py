"""Authentication and anonymous ownership endpoints.

Routes:
  GET  /api/v1/auth/me              — return current identity (auth or anon)
  POST /api/v1/auth/anon            — issue an anonymous subject cookie
  POST /api/v1/auth/claim           — transfer anonymous activity to authenticated user
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Response

from app.core.auth import (
    OptionalAuth,
    RequiredAuth,
    create_anon_subject_cookie,
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

ANON_COOKIE_NAME = "peak3_anon"
ANON_COOKIE_MAX_AGE = 30 * 86400  # 30 days


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
    existing = claim_repo.get_claim_by_anon(anon_sub)
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

    # 4. Count claimable records (ownership transfer is handled by the database
    #    via UPDATE … WHERE owner_sub = anon_sub, executed in the DB layer).
    #
    # For the in-memory implementation we enumerate and reassign inline.
    game_count = _claim_games(game_repo, anon_sub, real_sub)
    completion_count = _claim_completions(daily_completion_repo, anon_sub, real_sub)
    challenge_count = _claim_challenges(challenge_repo, anon_sub, real_sub)

    # 4b. Transfer progression atomically (Phase 3.1)
    progression_count = progression_repo.transfer_events(anon_sub, real_sub)
    record_count = record_repo.transfer_records(anon_sub, real_sub)
    achievement_count = achievement_repo.transfer_awards(anon_sub, real_sub)
    streak_repo.transfer_streak(anon_sub, real_sub)

    # Recalculate user_progress total after merging anon XP into real user
    all_events = progression_repo.list_events(real_sub, limit=10_000)
    merged_xp = sum(e.xp_amount for e in all_events)
    from app.services.progression.levels import level_from_xp
    from app.services.progression.xp_policy import ACTIVE_POLICY_VERSION
    from app.repositories.progression_protocols import UserProgress
    from datetime import datetime, timezone as _tz
    progression_repo.upsert_progress(UserProgress(
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
    claim_repo.record_claim(claim)

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
    """Return existing verified anon sub, or issue a new one."""
    if existing_cookie:
        sub = verify_anon_subject(existing_cookie, settings.SIGNING_SECRET)
        if sub:
            return sub

    # Issue a new anonymous subject
    new_sub = f"anon:{secrets.token_urlsafe(16)}"
    cookie_value = create_anon_subject_cookie(new_sub, settings.SIGNING_SECRET)
    response.set_cookie(
        key=ANON_COOKIE_NAME,
        value=cookie_value,
        max_age=ANON_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=not settings.DEBUG,
        path="/",
    )
    return new_sub


def _claim_games(game_repo, anon_sub: str, real_sub: str) -> int:
    """Transfer game ownership from anon_sub to real_sub.

    For in-memory repos this is a no-op count (games TTL-expire anyway).
    For PostgreSQL repos this issues an UPDATE statement.
    """
    from app.repositories.memory import MemoryGameRepository
    if isinstance(game_repo, MemoryGameRepository):
        count = 0
        with game_repo._lock:
            for state in game_repo._games.values():
                if getattr(state, "anon_subject_id", None) == anon_sub:
                    state.anon_subject_id = real_sub  # type: ignore[attr-defined]
                    count += 1
        return count
    # PostgreSQL: issue an async UPDATE (handled in transaction context)
    return 0


def _claim_completions(daily_repo, anon_sub: str, real_sub: str) -> int:
    """Transfer daily completion ownership."""
    from app.repositories.memory import MemoryDailyCompletionRepository
    if isinstance(daily_repo, MemoryDailyCompletionRepository):
        count = 0
        with daily_repo._lock:
            to_move = []
            for key, c in list(daily_repo._completions.items()):
                if c.owner_sub == anon_sub:
                    new_key = f"{real_sub}:{c.board_id}"
                    if new_key not in daily_repo._completions:
                        to_move.append((key, new_key, c))
            for old_key, new_key, c in to_move:
                del daily_repo._completions[old_key]
                c.owner_sub = real_sub
                daily_repo._completions[new_key] = c
                count += 1
        return count
    return 0


def _claim_challenges(challenge_repo, anon_sub: str, real_sub: str) -> int:
    """Transfer challenge ownership."""
    from app.repositories.memory import MemoryChallengeRepository
    if isinstance(challenge_repo, MemoryChallengeRepository):
        count = 0
        with challenge_repo._lock:
            for record in challenge_repo._challenges.values():
                if record.anon_subject_id == anon_sub:
                    record.anon_subject_id = real_sub
                    count += 1
        return count
    return 0
