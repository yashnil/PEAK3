"""Healthy Daily streak service.

Streak policy v1.0:
- Qualifying event: first canonical Daily completion on a local calendar day
- Same-day duplicate: no-op (idempotent)
- One-day gap: consumes one reserve if available; otherwise resets current streak
- Two-or-more-day gap: resets current streak unconditionally
- Longest streak: always historical, never decreases
- Reserve earned: after streak reaches reserve_streak_threshold (7) with reserve_count < cap
- Reserve cap: 1 initially
- Timezone: IANA zone stored in user_settings; UTC fallback

Timezone protection:
- Server derives local_date from completion timestamp + stored timezone
- Timezone changes are rate-limited (max 1/24h); each change is logged
- Completions are evaluated under the timezone active at the time of completion
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from app.services.progression.xp_policy import get_active_policy


StreakEventType = Literal[
    "increment", "same_day", "reserve_consumed", "reset",
    "reserve_earned", "initialized"
]


@dataclass
class StreakState:
    owner_sub: str
    policy_version: str
    current_streak: int
    longest_streak: int
    last_qualifying_date: date | None
    last_qualifying_tz: str
    reserve_count: int
    reserve_cap: int
    last_reserve_earned_at: datetime | None


@dataclass
class StreakTransition:
    """Result of evaluating a streak event."""
    event_type: StreakEventType
    local_date: date
    tz_used: str
    streak_before: int
    streak_after: int
    reserve_before: int
    reserve_after: int
    is_qualifying: bool         # True if this advances or maintains streak
    reserve_earned: bool
    reserve_consumed: bool


def _local_date_for(ts: datetime, tz_name: str) -> date:
    """Convert a UTC timestamp to a local calendar date using the IANA zone."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tz_name)
    except (ImportError, Exception):
        tz = timezone.utc
    local_dt = ts.astimezone(tz)
    return local_dt.date()


def evaluate_streak_event(
    state: StreakState,
    completion_ts: datetime,
    tz_name: str,
) -> StreakTransition:
    """Evaluate a daily completion against the current streak state.

    Returns a StreakTransition describing the state change.
    This is a pure function — it does not mutate `state`.
    """
    policy = get_active_policy()
    local_date = _local_date_for(completion_ts, tz_name)

    before_streak = state.current_streak
    before_reserve = state.reserve_count
    after_streak = before_streak
    after_reserve = before_reserve
    reserve_earned = False
    reserve_consumed = False

    if state.last_qualifying_date is None:
        # First ever qualifying event
        after_streak = 1
        event_type: StreakEventType = "initialized"
    elif local_date == state.last_qualifying_date:
        # Same local day — idempotent
        event_type = "same_day"
        # Return early — no changes
        return StreakTransition(
            event_type=event_type,
            local_date=local_date,
            tz_used=tz_name,
            streak_before=before_streak,
            streak_after=after_streak,
            reserve_before=before_reserve,
            reserve_after=after_reserve,
            is_qualifying=False,
            reserve_earned=False,
            reserve_consumed=False,
        )
    elif local_date == state.last_qualifying_date + timedelta(days=1):
        # Consecutive day — increment
        after_streak = before_streak + 1
        event_type = "increment"
    elif local_date == state.last_qualifying_date + timedelta(days=2):
        # One-day gap — try to use a reserve
        if before_reserve > 0:
            after_streak = before_streak + 1
            after_reserve = before_reserve - 1
            reserve_consumed = True
            event_type = "reserve_consumed"
        else:
            after_streak = 1
            event_type = "reset"
    else:
        # Gap of 2+ days — reset unconditionally
        after_streak = 1
        event_type = "reset"

    # Check if a reserve is earned after the streak reaches threshold
    if (
        after_streak >= policy.reserve_streak_threshold
        and after_reserve < policy.reserve_cap
        and not reserve_consumed  # don't earn a reserve on the same day you used one
        and event_type in ("increment", "initialized")
    ):
        # Only earn once the threshold is freshly hit or maintained above it
        if before_streak < policy.reserve_streak_threshold or before_reserve < after_reserve:
            # Earn reserve when crossing the threshold for the first time
            if before_streak < policy.reserve_streak_threshold:
                after_reserve = min(after_reserve + 1, policy.reserve_cap)
                reserve_earned = True

    return StreakTransition(
        event_type=event_type,
        local_date=local_date,
        tz_used=tz_name,
        streak_before=before_streak,
        streak_after=after_streak,
        reserve_before=before_reserve,
        reserve_after=after_reserve,
        is_qualifying=True,
        reserve_earned=reserve_earned,
        reserve_consumed=reserve_consumed,
    )


def apply_transition(state: StreakState, transition: StreakTransition, now: datetime) -> StreakState:
    """Return a new StreakState after applying a StreakTransition."""
    new_longest = max(state.longest_streak, transition.streak_after)
    new_last_reserve_earned_at = (
        now if transition.reserve_earned else state.last_reserve_earned_at
    )
    new_last_date = (
        transition.local_date
        if transition.event_type != "same_day"
        else state.last_qualifying_date
    )
    return StreakState(
        owner_sub=state.owner_sub,
        policy_version=state.policy_version,
        current_streak=transition.streak_after,
        longest_streak=new_longest,
        last_qualifying_date=new_last_date,
        last_qualifying_tz=transition.tz_used,
        reserve_count=transition.reserve_after,
        reserve_cap=state.reserve_cap,
        last_reserve_earned_at=new_last_reserve_earned_at,
    )


def empty_streak_state(owner_sub: str, policy_version: str) -> StreakState:
    """Create an initial (zero) streak state for a new user."""
    policy = get_active_policy()
    return StreakState(
        owner_sub=owner_sub,
        policy_version=policy_version,
        current_streak=0,
        longest_streak=0,
        last_qualifying_date=None,
        last_qualifying_tz="UTC",
        reserve_count=0,
        reserve_cap=policy.reserve_cap,
        last_reserve_earned_at=None,
    )


def merge_streak_states(anon: StreakState, real: StreakState) -> StreakState:
    """Merge an anonymous streak state into a real user's streak state during claim.

    Policy:
    - longest_streak: max of both
    - current_streak: recomputed — use the chronologically later contiguous streak
    - reserve_count: sum, capped by reserve_cap
    - last_qualifying_date: whichever is more recent
    """
    policy = get_active_policy()
    longest = max(anon.longest_streak, real.longest_streak)

    # Determine which state has the more recent qualifying date
    if anon.last_qualifying_date is None:
        merged_current = real.current_streak
        merged_date = real.last_qualifying_date
        merged_tz = real.last_qualifying_tz
    elif real.last_qualifying_date is None:
        merged_current = anon.current_streak
        merged_date = anon.last_qualifying_date
        merged_tz = anon.last_qualifying_tz
    elif real.last_qualifying_date >= anon.last_qualifying_date:
        merged_current = real.current_streak
        merged_date = real.last_qualifying_date
        merged_tz = real.last_qualifying_tz
    else:
        merged_current = anon.current_streak
        merged_date = anon.last_qualifying_date
        merged_tz = anon.last_qualifying_tz

    merged_reserves = min(
        anon.reserve_count + real.reserve_count,
        policy.reserve_cap,
    )

    return StreakState(
        owner_sub=real.owner_sub,
        policy_version=real.policy_version,
        current_streak=merged_current,
        longest_streak=longest,
        last_qualifying_date=merged_date,
        last_qualifying_tz=merged_tz,
        reserve_count=merged_reserves,
        reserve_cap=policy.reserve_cap,
        last_reserve_earned_at=(
            real.last_reserve_earned_at or anon.last_reserve_earned_at
        ),
    )
