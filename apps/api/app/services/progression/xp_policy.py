"""XP policy — versioned, configurable XP award rules.

Rules never influence lineup score, Draft Efficiency, offers, matchmaking,
or any model output. XP measures participation only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import ClassVar


ACTIVE_POLICY_VERSION = "v1.0"


@dataclass(frozen=True)
class XpPolicy:
    """Immutable snapshot of one policy version."""
    version: str
    daily_completion_first: int       # XP for first completion on a local day
    practice_completion_first_weekly: int  # XP for first practice per mode per week
    challenge_completion: int         # XP for completing a received challenge
    ranked_completion_first_weekly: int  # XP for first ranked match per queue per week —
                                          # participation only; identical regardless of
                                          # win/loss/draw/rating change (ADR-004 §17)
    receipt_exploration: int          # One-time lifetime XP
    methodology_exploration: int      # One-time lifetime XP
    first_game_bonus: int             # One-time XP for very first game
    local_day_cap: int                # Max XP in a single local day
    weekly_cap: int                   # Max XP in a 7-day window
    reserve_streak_threshold: int     # Days of streak before earning a reserve
    reserve_cap: int                  # Max reserves a user can hold

    # Maps event_type → XP amount for award calculation
    def xp_for(self, event_type: str) -> int:
        mapping = {
            "daily_completion_first": self.daily_completion_first,
            "practice_completion_first_weekly": self.practice_completion_first_weekly,
            "challenge_completion": self.challenge_completion,
            "ranked_completion_first_weekly": self.ranked_completion_first_weekly,
            "receipt_exploration": self.receipt_exploration,
            "methodology_exploration": self.methodology_exploration,
            "first_game_bonus": self.first_game_bonus,
        }
        return mapping.get(event_type, 0)

    # Event types that have one-time lifetime caps (never re-awarded)
    LIFETIME_ONCE: ClassVar[frozenset[str]] = frozenset({
        "receipt_exploration",
        "methodology_exploration",
        "first_game_bonus",
    })

    # Event types that cannot award for self-generated activity
    NO_SELF_CHALLENGE: ClassVar[frozenset[str]] = frozenset({
        "challenge_completion",
    })


V1_POLICY = XpPolicy(
    version="v1.0",
    daily_completion_first=100,
    practice_completion_first_weekly=25,
    challenge_completion=50,
    ranked_completion_first_weekly=25,
    receipt_exploration=20,
    methodology_exploration=20,
    first_game_bonus=30,
    local_day_cap=150,
    weekly_cap=500,
    reserve_streak_threshold=7,
    reserve_cap=1,
)

_POLICIES: dict[str, XpPolicy] = {
    "v1.0": V1_POLICY,
}


def get_policy(version: str = ACTIVE_POLICY_VERSION) -> XpPolicy:
    """Return the XpPolicy for the given version string."""
    if version not in _POLICIES:
        raise ValueError(f"Unknown XP policy version: {version!r}")
    return _POLICIES[version]


def get_active_policy() -> XpPolicy:
    return get_policy(ACTIVE_POLICY_VERSION)
