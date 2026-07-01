"""Progression, personal records, achievements, and streak endpoints.

Routes:
  GET  /api/v1/progression/me           — current progression summary
  GET  /api/v1/progression/events       — paginated XP event history
  POST /api/v1/progression/action       — record a UI action (receipt/methodology)
  GET  /api/v1/records                  — personal records
  GET  /api/v1/achievements             — achievement catalog + user awards
  GET  /api/v1/achievements/{key}       — single achievement detail
  GET  /api/v1/streak                   — current streak state
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.auth import OptionalAuth, RequiredAuth
from app.core.dependencies import (
    AchievementRepoDep,
    RecordRepoDep,
    ProgressionRepoDep,
    StreakRepoDep,
)
from app.services.progression.levels import (
    level_from_xp,
    xp_for_next_level,
    xp_into_level,
    progress_fraction,
    LEVEL_CAP,
)
from app.services.progression.xp_policy import get_active_policy, ACTIVE_POLICY_VERSION

router = APIRouter()

# Achievement catalog — static definitions loaded from the migration seed
ACHIEVEMENT_CATALOG = [
    {"key": "first_game",          "category": "onboarding",    "title": "First Peak",           "description": "Completed your first valid game.",                                        "requirement_copy": "Complete any valid game."},
    {"key": "apex_explorer",       "category": "onboarding",    "title": "Apex Explorer",        "description": "Completed a 1-Year Apex game.",                                           "requirement_copy": "Complete a valid 1Y Apex game."},
    {"key": "prime_explorer",      "category": "onboarding",    "title": "Prime Explorer",       "description": "Completed a 3-Year Prime game.",                                          "requirement_copy": "Complete a valid 3Y Prime game."},
    {"key": "foundation_explorer", "category": "onboarding",    "title": "Foundation Explorer",  "description": "Completed a 5-Year Foundation game.",                                     "requirement_copy": "Complete a valid 5Y Foundation game."},
    {"key": "full_spectrum",       "category": "onboarding",    "title": "Full Spectrum",        "description": "Completed valid games in all three window modes.",                        "requirement_copy": "Complete at least one valid game in all 3 modes."},
    {"key": "read_the_receipt",    "category": "onboarding",    "title": "Read the Receipt",     "description": "Explored a full Peak Receipt after completing a game.",                   "requirement_copy": "View the detailed breakdown after completing a game."},
    {"key": "challenger",          "category": "challenge",     "title": "Challenger",           "description": "Created a valid challenge link.",                                          "requirement_copy": "Create a challenge from a completed game."},
    {"key": "answered_the_call",   "category": "challenge",     "title": "Answered the Call",   "description": "Completed a challenge received from someone else.",                       "requirement_copy": "Complete a challenge you received."},
    {"key": "photo_finish",        "category": "challenge",     "title": "Photo Finish",         "description": "Settled a challenge within 1 point of the opponent.",                    "requirement_copy": "Complete a challenge settled within 1.0 lineup rating point."},
    {"key": "board_maximizer",     "category": "construction",  "title": "Board Maximizer",      "description": "Achieved 85% or higher Draft Efficiency.",                                "requirement_copy": "Reach 85% Draft Efficiency in any completed game."},
    {"key": "balanced_five",       "category": "construction",  "title": "Balanced Five",        "description": "Built a lineup with all components contributing.",                        "requirement_copy": "Complete a game with lineup score above 75 and all 5 roles filled."},
    {"key": "role_complete",       "category": "construction",  "title": "Role Complete",        "description": "Filled all five roster roles in a single draft.",                        "requirement_copy": "Complete a game with all five distinct roles assigned."},
    {"key": "three_day_rhythm",    "category": "habit",         "title": "Three-Day Rhythm",     "description": "Maintained a 3-day Daily streak.",                                       "requirement_copy": "Complete Daily boards on 3 consecutive local days."},
    {"key": "seven_day_rhythm",    "category": "habit",         "title": "Seven-Day Rhythm",     "description": "Maintained a 7-day Daily streak.",                                       "requirement_copy": "Complete Daily boards on 7 consecutive local days."},
    {"key": "first_personal_best", "category": "construction",  "title": "Personal Best",        "description": "Set your first personal record.",                                         "requirement_copy": "Achieve a personal record in any mode."},
]
_CATALOG_BY_KEY = {a["key"]: a for a in ACHIEVEMENT_CATALOG}


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class LevelSummary(BaseModel):
    total_xp: int
    current_level: int
    level_cap: int
    xp_into_level: int
    xp_for_next_level: Optional[int]
    progress_fraction: float
    policy_version: str


class ProgressionSummary(BaseModel):
    level: LevelSummary
    current_streak: int
    longest_streak: int
    reserve_count: int
    reserve_cap: int
    achievement_count: int
    recent_achievements: list[str]


class ProgressionEventOut(BaseModel):
    id: str
    event_type: str
    xp_amount: int
    occurred_at: str
    policy_version: str


class PersonalRecordOut(BaseModel):
    record_type: str
    mode: str
    record_value: float
    higher_is_better: bool
    source_result_id: str
    achieved_at: str
    lineup_model_version: str
    card_pool_version: str
    ruleset_version: str


class AchievementOut(BaseModel):
    key: str
    category: str
    title: str
    description: str
    requirement_copy: str
    earned: bool
    earned_at: Optional[str] = None


class StreakOut(BaseModel):
    current_streak: int
    longest_streak: int
    last_qualifying_date: Optional[str]
    reserve_count: int
    reserve_cap: int
    policy_version: str


# ---------------------------------------------------------------------------
# GET /progression/me
# ---------------------------------------------------------------------------

@router.get("/progression/me", response_model=ProgressionSummary)
async def get_my_progression(
    auth: RequiredAuth,
    progression_repo: ProgressionRepoDep,
    achievement_repo: AchievementRepoDep,
    streak_repo: StreakRepoDep,
) -> ProgressionSummary:
    progress = progression_repo.get_progress(auth.sub)
    total_xp = progress.total_xp if progress else 0
    level = level_from_xp(total_xp)

    streak = streak_repo.get_streak(auth.sub)
    awards = achievement_repo.list_awards(auth.sub)
    recent_keys = [
        a.achievement_key
        for a in sorted(awards, key=lambda x: x.awarded_at, reverse=True)[:3]
    ]

    return ProgressionSummary(
        level=LevelSummary(
            total_xp=total_xp,
            current_level=level,
            level_cap=LEVEL_CAP,
            xp_into_level=xp_into_level(total_xp),
            xp_for_next_level=xp_for_next_level(total_xp),
            progress_fraction=progress_fraction(total_xp),
            policy_version=ACTIVE_POLICY_VERSION,
        ),
        current_streak=streak.current_streak if streak else 0,
        longest_streak=streak.longest_streak if streak else 0,
        reserve_count=streak.reserve_count if streak else 0,
        reserve_cap=streak.reserve_cap if streak else 1,
        achievement_count=len(awards),
        recent_achievements=recent_keys,
    )


# ---------------------------------------------------------------------------
# GET /progression/events
# ---------------------------------------------------------------------------

@router.get("/progression/events")
async def list_progression_events(
    auth: RequiredAuth,
    progression_repo: ProgressionRepoDep,
    limit: int = Query(default=20, ge=1, le=100),
    before_id: Optional[str] = Query(default=None),
) -> dict:
    events = progression_repo.list_events(auth.sub, limit=limit + 1, before_id=before_id)
    has_more = len(events) > limit
    events = events[:limit]
    next_cursor = events[-1].id if has_more and events else None
    return {
        "items": [
            ProgressionEventOut(
                id=e.id,
                event_type=e.event_type,
                xp_amount=e.xp_amount,
                occurred_at=e.occurred_at.isoformat() if hasattr(e.occurred_at, "isoformat") else e.occurred_at,
                policy_version=e.policy_version,
            )
            for e in events
        ],
        "next_cursor": next_cursor,
    }


# ---------------------------------------------------------------------------
# POST /progression/action — record a one-time UI action
# ---------------------------------------------------------------------------

class UiActionRequest(BaseModel):
    action_type: str = Field(..., pattern="^(receipt_exploration|methodology_exploration)$")
    source_id: str

@router.post("/progression/action")
async def record_ui_action(
    body: UiActionRequest,
    auth: RequiredAuth,
    progression_repo: ProgressionRepoDep,
    achievement_repo: AchievementRepoDep,
) -> dict:
    from app.services.progression.engine import process_ui_action
    summary = process_ui_action(
        owner_sub=auth.sub,
        action_type=body.action_type,
        source_id=body.source_id,
        progression_repo=progression_repo,
        achievement_repo=achievement_repo,
    )
    return summary


# ---------------------------------------------------------------------------
# GET /records
# ---------------------------------------------------------------------------

@router.get("/records", response_model=list[PersonalRecordOut])
async def get_my_records(
    auth: RequiredAuth,
    record_repo: RecordRepoDep,
) -> list[PersonalRecordOut]:
    records = record_repo.list_records(auth.sub)
    return [
        PersonalRecordOut(
            record_type=r.record_type,
            mode=r.mode,
            record_value=float(r.record_value),
            higher_is_better=r.higher_is_better,
            source_result_id=r.source_result_id,
            achieved_at=r.achieved_at.isoformat() if hasattr(r.achieved_at, "isoformat") else r.achieved_at,
            lineup_model_version=r.lineup_model_version,
            card_pool_version=r.card_pool_version,
            ruleset_version=r.ruleset_version,
        )
        for r in sorted(records, key=lambda r: (r.record_type, r.mode))
    ]


# ---------------------------------------------------------------------------
# GET /achievements
# ---------------------------------------------------------------------------

@router.get("/achievements", response_model=list[AchievementOut])
async def get_achievements(
    auth: OptionalAuth,
    achievement_repo: AchievementRepoDep,
) -> list[AchievementOut]:
    awards_by_key: dict[str, str] = {}
    if auth is not None:
        for a in achievement_repo.list_awards(auth.sub):
            awards_by_key[a.achievement_key] = a.awarded_at.isoformat() if hasattr(a.awarded_at, "isoformat") else str(a.awarded_at)

    return [
        AchievementOut(
            key=a["key"],
            category=a["category"],
            title=a["title"],
            description=a["description"],
            requirement_copy=a["requirement_copy"],
            earned=a["key"] in awards_by_key,
            earned_at=awards_by_key.get(a["key"]),
        )
        for a in ACHIEVEMENT_CATALOG
    ]


# ---------------------------------------------------------------------------
# GET /achievements/{key}
# ---------------------------------------------------------------------------

@router.get("/achievements/{key}", response_model=AchievementOut)
async def get_achievement(
    key: str,
    auth: OptionalAuth,
    achievement_repo: AchievementRepoDep,
) -> AchievementOut:
    defn = _CATALOG_BY_KEY.get(key)
    if defn is None:
        raise HTTPException(status_code=404, detail="achievement_not_found")
    earned_at = None
    if auth is not None:
        award = achievement_repo.get_award(auth.sub, key)
        if award:
            earned_at = award.awarded_at.isoformat() if hasattr(award.awarded_at, "isoformat") else str(award.awarded_at)
    return AchievementOut(
        key=defn["key"],
        category=defn["category"],
        title=defn["title"],
        description=defn["description"],
        requirement_copy=defn["requirement_copy"],
        earned=earned_at is not None,
        earned_at=earned_at,
    )


# ---------------------------------------------------------------------------
# GET /streak
# ---------------------------------------------------------------------------

@router.get("/streak", response_model=StreakOut)
async def get_my_streak(
    auth: RequiredAuth,
    streak_repo: StreakRepoDep,
) -> StreakOut:
    state = streak_repo.get_streak(auth.sub)
    if state is None:
        return StreakOut(
            current_streak=0,
            longest_streak=0,
            last_qualifying_date=None,
            reserve_count=0,
            reserve_cap=1,
            policy_version=ACTIVE_POLICY_VERSION,
        )
    return StreakOut(
        current_streak=state.current_streak,
        longest_streak=state.longest_streak,
        last_qualifying_date=state.last_qualifying_date.isoformat() if state.last_qualifying_date else None,
        reserve_count=state.reserve_count,
        reserve_cap=state.reserve_cap,
        policy_version=state.policy_version,
    )
