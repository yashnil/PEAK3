"""Progression engine — orchestrates XP, streak, records, and achievements.

Called after a game is completed. All writes are guarded by idempotency keys
and database uniqueness constraints so retries are safe.

Skill isolation guarantee: this module NEVER modifies result_snapshots,
board seeds, card offers, or any game-domain objects.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.repositories.progression_protocols import (
    AchievementAward,
    PersonalRecord,
    PersonalRecordEvent,
    ProgressionEvent,
    StreakEvent,
    StreakState,
    UserProgress,
)
from app.services.progression.achievements import EvalContext, evaluate_achievements
from app.services.progression.levels import level_from_xp
from app.services.progression.records_service import extract_candidates, is_new_record
from app.services.progression.streak_service import (
    apply_transition,
    empty_streak_state,
    evaluate_streak_event,
)
from app.services.progression.xp_policy import get_active_policy, ACTIVE_POLICY_VERSION


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _idempotency_key(owner_sub: str, event_type: str, source_type: str, source_id: str) -> str:
    policy = ACTIVE_POLICY_VERSION
    return f"{owner_sub}:{event_type}:{source_type}:{source_id}:{policy}"


def process_game_completion(
    owner_sub: str,
    result_snapshot: dict,
    result_id: str,
    board_type: str,
    mode: str,
    completed_at: datetime,
    tz_name: str,
    progression_repo,
    record_repo,
    achievement_repo,
    streak_repo,
    completion_repo=None,        # daily completion repo for first-game checks
    is_first_ever_game: bool = False,
    is_self_challenge: bool = False,
) -> dict:
    """Process all progression events for one completed game.

    Returns a summary dict of what was awarded (for the result screen).
    This function is idempotent: repeated calls with the same result_id
    produce no additional awards.
    """
    policy = get_active_policy()
    now = _now()
    summary: dict = {
        "xp_awarded": 0,
        "new_level": None,
        "new_personal_records": [],
        "new_achievements": [],
        "streak_advanced": False,
        "streak_reserve_earned": False,
        "streak_reserve_consumed": False,
    }

    # -----------------------------------------------------------------------
    # 1. XP events
    # -----------------------------------------------------------------------
    xp_total_this_call = 0

    def _try_award_xp(event_type: str, source_type: str, source_id: str, extra_meta: dict | None = None) -> int:
        """Award XP if eligible and not already awarded. Returns XP amount."""
        if is_self_challenge and event_type in policy.NO_SELF_CHALLENGE:
            return 0
        idem_key = _idempotency_key(owner_sub, event_type, source_type, source_id)
        existing = progression_repo.get_event_by_idempotency_key(idem_key)
        if existing is not None:
            return 0  # already awarded

        # Lifetime-once events
        if event_type in policy.LIFETIME_ONCE:
            past = progression_repo.list_events(owner_sub, limit=500)
            if any(e.event_type == event_type for e in past):
                return 0

        xp = policy.xp_for(event_type)
        if xp == 0:
            return 0

        event = ProgressionEvent(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            event_type=event_type,
            source_type=source_type,
            source_id=source_id,
            idempotency_key=idem_key,
            policy_version=policy.version,
            xp_amount=xp,
            occurred_at=completed_at,
            awarded_at=now,
            metadata=extra_meta or {},
        )
        progression_repo.record_event(event)
        return xp

    # First-ever game bonus
    if is_first_ever_game:
        xp_total_this_call += _try_award_xp("first_game_bonus", "result_snapshot", result_id)

    # Daily completion XP (only for daily board_type, first of local day)
    if board_type == "daily":
        # Check if this is the first qualifying daily completion on the local day
        from app.services.progression.streak_service import _local_date_for
        local_date = _local_date_for(completed_at, tz_name)
        day_str = local_date.isoformat()
        # Use a day-scoped idempotency key
        idem_key_daily = f"{owner_sub}:daily_completion_first:day:{day_str}:{policy.version}"
        existing_daily = progression_repo.get_event_by_idempotency_key(idem_key_daily)
        if existing_daily is None:
            event = ProgressionEvent(
                id=str(uuid.uuid4()),
                owner_sub=owner_sub,
                event_type="daily_completion_first",
                source_type="result_snapshot",
                source_id=result_id,
                idempotency_key=idem_key_daily,
                policy_version=policy.version,
                xp_amount=policy.daily_completion_first,
                occurred_at=completed_at,
                awarded_at=now,
                metadata={"local_date": day_str, "tz": tz_name, "mode": mode},
            )
            progression_repo.record_event(event)
            xp_total_this_call += policy.daily_completion_first

    elif board_type == "practice":
        # Practice: once per mode per week
        from datetime import timedelta
        week_start = completed_at - timedelta(days=completed_at.weekday())
        week_str = week_start.strftime("%Y-W%W")
        idem_key_prac = f"{owner_sub}:practice_completion_first_weekly:{mode}:{week_str}:{policy.version}"
        existing_prac = progression_repo.get_event_by_idempotency_key(idem_key_prac)
        if existing_prac is None:
            event = ProgressionEvent(
                id=str(uuid.uuid4()),
                owner_sub=owner_sub,
                event_type="practice_completion_first_weekly",
                source_type="result_snapshot",
                source_id=result_id,
                idempotency_key=idem_key_prac,
                policy_version=policy.version,
                xp_amount=policy.practice_completion_first_weekly,
                occurred_at=completed_at,
                awarded_at=now,
                metadata={"week": week_str, "mode": mode},
            )
            progression_repo.record_event(event)
            xp_total_this_call += policy.practice_completion_first_weekly

    elif board_type == "challenge" and not is_self_challenge:
        xp_total_this_call += _try_award_xp("challenge_completion", "result_snapshot", result_id)

    elif board_type == "ranked":
        # Ranked: identical participation XP structure to practice (once per
        # mode per week) — never varies with win/loss/draw, rating change, or
        # division (ADR-004 §17). Called only after the rating ledger
        # transaction has already committed; never awarded for an
        # invalidated/unsettled match.
        from datetime import timedelta
        week_start = completed_at - timedelta(days=completed_at.weekday())
        week_str = week_start.strftime("%Y-W%W")
        idem_key_ranked = f"{owner_sub}:ranked_completion_first_weekly:{mode}:{week_str}:{policy.version}"
        existing_ranked = progression_repo.get_event_by_idempotency_key(idem_key_ranked)
        if existing_ranked is None:
            event = ProgressionEvent(
                id=str(uuid.uuid4()),
                owner_sub=owner_sub,
                event_type="ranked_completion_first_weekly",
                source_type="result_snapshot",
                source_id=result_id,
                idempotency_key=idem_key_ranked,
                policy_version=policy.version,
                xp_amount=policy.ranked_completion_first_weekly,
                occurred_at=completed_at,
                awarded_at=now,
                metadata={"week": week_str, "mode": mode},
            )
            progression_repo.record_event(event)
            xp_total_this_call += policy.ranked_completion_first_weekly

    summary["xp_awarded"] = xp_total_this_call

    # -----------------------------------------------------------------------
    # 2. Update user_progress aggregate
    # -----------------------------------------------------------------------
    if xp_total_this_call > 0:
        current = progression_repo.get_progress(owner_sub)
        old_xp = current.total_xp if current else 0
        old_level = current.current_level if current else 1
        new_xp = old_xp + xp_total_this_call
        new_level = level_from_xp(new_xp)
        progression_repo.upsert_progress(UserProgress(
            owner_sub=owner_sub,
            total_xp=new_xp,
            current_level=new_level,
            policy_version=policy.version,
            last_progression_at=now,
        ))
        if new_level > old_level:
            summary["new_level"] = new_level

    # -----------------------------------------------------------------------
    # 3. Streak update (daily only)
    # -----------------------------------------------------------------------
    if board_type == "daily":
        from app.services.progression.streak_service import StreakState as SvcStreak
        stored = streak_repo.get_streak(owner_sub)
        if stored is None:
            svc_state = empty_streak_state(owner_sub, policy.version)
        else:
            svc_state = SvcStreak(
                owner_sub=stored.owner_sub,
                policy_version=stored.policy_version,
                current_streak=stored.current_streak,
                longest_streak=stored.longest_streak,
                last_qualifying_date=stored.last_qualifying_date,
                last_qualifying_tz=stored.last_qualifying_tz,
                reserve_count=stored.reserve_count,
                reserve_cap=stored.reserve_cap,
                last_reserve_earned_at=stored.last_reserve_earned_at,
            )

        transition = evaluate_streak_event(svc_state, completed_at, tz_name)
        new_svc_state = apply_transition(svc_state, transition, now)

        # Save updated streak state
        streak_repo.save_streak(StreakState(
            owner_sub=owner_sub,
            policy_version=new_svc_state.policy_version,
            current_streak=new_svc_state.current_streak,
            longest_streak=new_svc_state.longest_streak,
            last_qualifying_date=new_svc_state.last_qualifying_date,
            last_qualifying_tz=new_svc_state.last_qualifying_tz,
            reserve_count=new_svc_state.reserve_count,
            reserve_cap=new_svc_state.reserve_cap,
            last_reserve_earned_at=new_svc_state.last_reserve_earned_at,
        ))

        # Record the streak event
        streak_repo.record_streak_event(StreakEvent(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            event_type=transition.event_type,
            local_date=transition.local_date,
            tz_used=transition.tz_used,
            streak_before=transition.streak_before,
            streak_after=transition.streak_after,
            reserve_before=transition.reserve_before,
            reserve_after=transition.reserve_after,
            source_type="daily_completion",
            source_id=result_id,
            occurred_at=now,
        ))

        summary["streak_advanced"] = transition.is_qualifying
        summary["streak_reserve_earned"] = transition.reserve_earned
        summary["streak_reserve_consumed"] = transition.reserve_consumed
        summary["current_streak"] = new_svc_state.current_streak

    # -----------------------------------------------------------------------
    # 4. Personal records
    # -----------------------------------------------------------------------
    candidates = extract_candidates(result_snapshot, result_id, completed_at)
    for candidate in candidates:
        current_rec = record_repo.get_record(
            owner_sub,
            candidate.record_type,
            candidate.mode,
            candidate.lineup_model_version,
            candidate.card_pool_version,
            candidate.ruleset_version,
        )
        if is_new_record(candidate, current_rec):
            new_rec = PersonalRecord(
                id=str(uuid.uuid4()),
                owner_sub=owner_sub,
                record_type=candidate.record_type,
                mode=candidate.mode,
                lineup_model_version=candidate.lineup_model_version,
                card_pool_version=candidate.card_pool_version,
                ruleset_version=candidate.ruleset_version,
                record_value=candidate.value,
                higher_is_better=candidate.higher_is_better,
                source_result_id=candidate.source_result_id,
                achieved_at=candidate.achieved_at,
                previous_record_id=current_rec.id if current_rec else None,
            )
            record_repo.upsert_record(new_rec)
            record_repo.record_event(PersonalRecordEvent(
                id=str(uuid.uuid4()),
                owner_sub=owner_sub,
                record_type=candidate.record_type,
                mode=candidate.mode,
                lineup_model_version=candidate.lineup_model_version,
                card_pool_version=candidate.card_pool_version,
                ruleset_version=candidate.ruleset_version,
                new_value=candidate.value,
                previous_value=current_rec.record_value if current_rec else None,
                source_result_id=candidate.source_result_id,
                occurred_at=now,
            ))
            summary["new_personal_records"].append({
                "record_type": candidate.record_type,
                "mode": candidate.mode,
                "value": candidate.value,
                "previous_value": current_rec.record_value if current_rec else None,
            })

    # -----------------------------------------------------------------------
    # 5. Achievement evaluation
    # -----------------------------------------------------------------------
    existing_awards = {a.achievement_key for a in achievement_repo.list_awards(owner_sub)}
    all_records = record_repo.list_records(owner_sub)
    modes_completed = {r.mode for r in all_records if r.record_type == "lineup_score"}

    # Add any mode from this completion
    if mode:
        modes_completed.add(mode)

    streak_state = streak_repo.get_streak(owner_sub)
    current_streak_count = streak_state.current_streak if streak_state else 0

    challenge_margin = result_snapshot.get("challenge_margin")

    game_event_type = (
        "daily_completion_first" if board_type == "daily" else
        "practice_completion_first_weekly" if board_type == "practice" else
        "ranked_completion_first_weekly" if board_type == "ranked" else
        "challenge_completion"
    )
    ctx = EvalContext(
        owner_sub=owner_sub,
        event_type=game_event_type,
        source_id=result_id,
        result_payload=result_snapshot,
        existing_awards=existing_awards,
        mode=mode,
        board_type=board_type,
        draft_efficiency=result_snapshot.get("draft_efficiency"),
        lineup_peak_rating=result_snapshot.get("lineup_peak_rating"),
        current_streak=current_streak_count,
        total_modes_completed=modes_completed,
        challenge_margin=challenge_margin,
    )

    # Evaluate once with game event_type, then again with "personal_record_set"
    # so that first_game/mode_explorer evaluators AND first_personal_best both fire
    # on the same call rather than splitting across two calls.
    candidate_keys: list[str] = list(evaluate_achievements(ctx))
    if summary["new_personal_records"]:
        ctx.event_type = "personal_record_set"
        for key in evaluate_achievements(ctx):
            if key not in candidate_keys:
                candidate_keys.append(key)

    new_achievement_keys = candidate_keys
    for key in new_achievement_keys:
        award = AchievementAward(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            achievement_key=key,
            source_type=board_type,
            source_id=result_id,
            awarded_at=now,
        )
        if achievement_repo.award_achievement(award):
            summary["new_achievements"].append(key)

    return summary


def process_ui_action(
    owner_sub: str,
    action_type: str,   # 'receipt_exploration' | 'methodology_exploration'
    source_id: str,
    progression_repo,
    achievement_repo,
) -> dict:
    """Process a UI interaction progression event (one-time lifetime XP)."""
    policy = get_active_policy()
    now = _now()
    summary: dict = {"xp_awarded": 0, "new_achievements": []}

    idem_key = _idempotency_key(owner_sub, action_type, "ui_action", source_id)
    existing = progression_repo.get_event_by_idempotency_key(idem_key)
    if existing is not None:
        return summary

    # Check lifetime cap
    past = progression_repo.list_events(owner_sub, limit=500)
    if any(e.event_type == action_type for e in past):
        return summary

    xp = policy.xp_for(action_type)
    if xp > 0:
        event = ProgressionEvent(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            event_type=action_type,
            source_type="ui_action",
            source_id=source_id,
            idempotency_key=idem_key,
            policy_version=policy.version,
            xp_amount=xp,
            occurred_at=now,
            awarded_at=now,
        )
        progression_repo.record_event(event)
        summary["xp_awarded"] = xp

        # Update progress
        current = progression_repo.get_progress(owner_sub)
        old_xp = current.total_xp if current else 0
        new_xp = old_xp + xp
        progression_repo.upsert_progress(UserProgress(
            owner_sub=owner_sub,
            total_xp=new_xp,
            current_level=level_from_xp(new_xp),
            policy_version=policy.version,
            last_progression_at=now,
        ))

    # Evaluate achievements
    existing_awards = {a.achievement_key for a in achievement_repo.list_awards(owner_sub)}
    ctx = EvalContext(
        owner_sub=owner_sub,
        event_type=action_type,
        source_id=source_id,
        result_payload={},
        existing_awards=existing_awards,
    )
    for key in evaluate_achievements(ctx):
        award = AchievementAward(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            achievement_key=key,
            source_type="ui_action",
            source_id=source_id,
            awarded_at=now,
        )
        if achievement_repo.award_achievement(award):
            summary["new_achievements"].append(key)

    return summary
