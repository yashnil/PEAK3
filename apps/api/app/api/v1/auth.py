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
    CourtLineupRepoDep,
    DailyCompletionRepoDep,
    DailyGridResultRepoDep,
    GameRepoDep,
    OwnershipClaimRepoDep,
    PeakDuelDailyResultRepoDep,
    PerfectSeasonLeaderboardRepoDep,
    PerfectSeasonSavedRunRepoDep,
    ProgressionRepoDep,
    RecordRepoDep,
    ResultSnapshotRepoDep,
    RunTheTableRunRepoDep,
    StreakRepoDep,
)
from app.repositories.protocols import OwnershipClaim

router = APIRouter()

# Every domain a claim can move, in a fixed order. The response always carries
# all of these keys, including the zeros: a client rendering "here is what we
# imported" needs to distinguish "that mode moved nothing" from "we forgot to
# look", and an absent key cannot express the first.
CLAIMABLE_DOMAINS: tuple[str, ...] = (
    "draft_games",
    "court_lineups",
    "daily_completions",
    "peak_duel_daily_results",
    "daily_grid_results",
    "run_the_table_runs",
    "perfect_season_runs",
    "perfect_season_saved_runs",
    "challenges",
    "result_snapshots",
    "progression_events",
    "personal_records",
    "achievements",
    "streaks",
)


def _empty_domain_counts() -> dict[str, int]:
    return {domain: 0 for domain in CLAIMABLE_DOMAINS}


def _unclaimed(reason: str) -> dict:
    """The response for a call that legitimately claimed nothing.

    Deliberately a 200 rather than an error: arriving at the claim endpoint
    without a guest session is the ordinary case for someone who signed in on a
    fresh browser, and it is not a failure.
    """
    return {
        "claimed": False,
        "reason": reason,
        "game_count": 0,
        "completion_count": 0,
        "challenge_count": 0,
        "total_claimed": 0,
        "domain_counts": _empty_domain_counts(),
    }

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
    court_lineup_repo: CourtLineupRepoDep,
    challenge_repo: ChallengeRepoDep,
    daily_completion_repo: DailyCompletionRepoDep,
    result_snapshot_repo: ResultSnapshotRepoDep,
    claim_repo: OwnershipClaimRepoDep,
    progression_repo: ProgressionRepoDep,
    record_repo: RecordRepoDep,
    achievement_repo: AchievementRepoDep,
    streak_repo: StreakRepoDep,
    run_the_table_repo: RunTheTableRunRepoDep,
    daily_grid_repo: DailyGridResultRepoDep,
    peak_duel_daily_repo: PeakDuelDailyResultRepoDep,
    perfect_season_leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
    perfect_season_saved_run_repo: PerfectSeasonSavedRunRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> dict:
    """Transfer everything a guest did to the account they just signed into.

    THE CREDENTIAL IS THE COOKIE, AND ONLY THE COOKIE. The subject being
    claimed comes from `peak3_anon` -- an httponly, HMAC-signed, 30-day
    server-issued token -- verified here before anything moves. The request
    body is not read; there is no `anon_sub` parameter, no run id, and nothing
    from localStorage is ever trusted. A caller who wants someone else's guest
    data would have to forge a signature.

    IT HAPPENS ONCE. `ownership_claims.anon_subject_id` is UNIQUE, and that
    constraint -- not a check in this function -- is what resolves two tabs
    racing the same claim: both may reach `record_claim`, exactly one row
    survives, and both then read that one row back. A repeat call after the
    fact returns the stored per-domain counts rather than recomputing them,
    because by then the rows have already moved and a recomputed answer would
    say zero for a claim that really did import something.

    A DIFFERENT USER CANNOT TAKE IT. If the anon subject already belongs to
    another account, this is 403 -- never a silent success and never a second
    transfer.

    PLAYING SOMEONE'S CHALLENGE IS NOT OWNING IT. Only `challenges` rows whose
    `anon_subject_id` is the guest -- the ones they *created* -- move.
    Participation lives in `challenge_participants.participant_sub` and is
    never transferred, so opening a friend's link can never make their board
    part of your history.
    """
    # 1. Authenticated identity is already verified via RequiredAuth dependency.
    real_sub = auth.sub

    # 2. Verify anonymous credential
    if not peak3_anon:
        return _unclaimed("no_anon_session")

    anon_sub = verify_anon_subject(peak3_anon, settings.SIGNING_SECRET)
    if not anon_sub:
        # Unsigned, forged, tampered with, or simply expired. Indistinguishable
        # on purpose: a caller probing the endpoint learns nothing about which.
        return _unclaimed("invalid_anon_credential")

    # Prevent a user from claiming their own authenticated sub (shouldn't happen,
    # but guard against edge cases in anonymous Supabase sessions).
    if anon_sub == real_sub:
        return {**_unclaimed("already_same_user"), "claimed": True}

    # 3. Idempotency — if this subject was already claimed, answer from the
    # stored record rather than transferring anything a second time.
    existing = await claim_repo.get_claim_by_anon(anon_sub)
    if existing is not None:
        return _claim_response(existing, real_sub, reason="already_claimed")

    # 4. Transfer ownership through each repository's own transfer_owner
    # method — real for both in-memory and PostgreSQL backends (previously
    # this reached into memory-repo private attributes and silently
    # no-op'd against Postgres; see docs/architecture/REPOSITORY_WIRING_AUDIT.md).
    #
    # ORDER MATTERS FOR THE FIRST TWO. Against Postgres these two repositories
    # share the `games` table: PostgresCourtLineupRepository.transfer_owner
    # filters `board_type = 'perfect_season'` while
    # PostgresGameRepository.transfer_owner takes every row for the subject.
    # Running the narrow one first makes the two counts disjoint — court
    # lineups, then whatever draft games are left — instead of the broad one
    # swallowing the lineups and the narrow one then reporting 0 for rows it
    # would have moved. In memory the two are separate stores and the order is
    # irrelevant, so this is safe either way and correct in both.
    court_lineup_count = await court_lineup_repo.transfer_owner(anon_sub, real_sub)
    draft_game_count = await game_repo.transfer_owner(anon_sub, real_sub)
    completion_count = await daily_completion_repo.transfer_owner(anon_sub, real_sub)
    challenge_count = await challenge_repo.transfer_owner(anon_sub, real_sub)
    result_snapshot_count = await result_snapshot_repo.transfer_owner(anon_sub, real_sub)

    # 4a. The four domains this endpoint used to miss entirely. RUN THE TABLE
    # is the one that mattered most: it is anonymous-first by design, so a
    # guest who played it and signed in used to lose the association
    # permanently — the run stayed in the database under a subject whose
    # cookie had just been deleted.
    run_the_table_count = await run_the_table_repo.transfer_owner(anon_sub, real_sub)
    daily_grid_count = await daily_grid_repo.transfer_owner(anon_sub, real_sub)
    peak_duel_daily_count = await peak_duel_daily_repo.transfer_owner(anon_sub, real_sub)
    perfect_season_run_count = await perfect_season_leaderboard_repo.transfer_owner(
        anon_sub, real_sub
    )
    perfect_season_saved_run_count = await perfect_season_saved_run_repo.transfer_owner(
        anon_sub, real_sub
    )

    # 4b. Transfer progression atomically (Phase 3.1)
    progression_count = await progression_repo.transfer_events(anon_sub, real_sub)
    record_count = await record_repo.transfer_records(anon_sub, real_sub)
    achievement_count = await achievement_repo.transfer_awards(anon_sub, real_sub)
    streak_moved = await streak_repo.transfer_streak(anon_sub, real_sub)

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

    domain_counts = {
        "draft_games": draft_game_count,
        "court_lineups": court_lineup_count,
        "daily_completions": completion_count,
        "peak_duel_daily_results": peak_duel_daily_count,
        "daily_grid_results": daily_grid_count,
        "run_the_table_runs": run_the_table_count,
        "perfect_season_runs": perfect_season_run_count,
        "perfect_season_saved_runs": perfect_season_saved_run_count,
        "challenges": challenge_count,
        "result_snapshots": result_snapshot_count,
        "progression_events": progression_count,
        "personal_records": record_count,
        "achievements": achievement_count,
        "streaks": 1 if streak_moved else 0,
    }

    # 5. Record the claim. `game_count` keeps its original meaning — every row
    # that left `games` — so anything already reading that column stays
    # correct; domain_counts carries the split.
    claim = OwnershipClaim(
        id=str(uuid.uuid4()),
        real_user_sub=real_sub,
        anon_subject_id=anon_sub,
        claimed_at=datetime.now(timezone.utc),
        game_count=draft_game_count + court_lineup_count,
        completion_count=completion_count,
        challenge_count=challenge_count,
        domain_counts=domain_counts,
    )
    await claim_repo.record_claim(claim)

    # Read back rather than trusting the object we just built. Under the
    # two-tab race both callers reach record_claim and the UNIQUE constraint
    # picks one; the loser's INSERT was a no-op, so its own `claim.id` names a
    # row that does not exist. Whoever lost reports the winner's claim — or, if
    # the winner was a different account, gets the 403 below.
    persisted = await claim_repo.get_claim_by_anon(anon_sub) or claim

    # 6. Clear the anonymous cookie (consumed)
    # Attributes must match the ones the cookie was SET with (see
    # core/auth.anon_cookie_attributes) -- a delete whose samesite/secure
    # differ targets a different cookie and silently leaves the original in
    # place, which after a claim would mean the guest identity outliving the
    # claim that was supposed to retire it.
    from app.core.auth import anon_cookie_attributes

    response.delete_cookie(ANON_COOKIE_NAME, path="/", **anon_cookie_attributes())

    return _claim_response(persisted, real_sub, reason="claimed")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _claim_response(claim: OwnershipClaim, real_sub: str, *, reason: str) -> dict:
    """Render a stored claim as the endpoint's response.

    Raises 403 if the claim belongs to someone else. This is the single place
    that decision is made, so the freshly-recorded path and the repeat-call
    path can never disagree about it.
    """
    if claim.real_user_sub != real_sub:
        raise HTTPException(status_code=403, detail="anon_session_already_claimed")

    counts = {**_empty_domain_counts(), **(claim.domain_counts or {})}
    return {
        "claimed": True,
        "claim_id": claim.id,
        "reason": reason,
        # Legacy top-level fields, unchanged in meaning, kept because existing
        # clients read them.
        "game_count": claim.game_count,
        "completion_count": claim.completion_count,
        "challenge_count": claim.challenge_count,
        "progression_events_claimed": counts["progression_events"],
        "records_claimed": counts["personal_records"],
        "achievements_claimed": counts["achievements"],
        "total_claimed": sum(counts.values()),
        "domain_counts": counts,
    }


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


