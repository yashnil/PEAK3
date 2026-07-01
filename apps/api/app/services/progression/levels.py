"""Level calculation — deterministic, monotonic, bounded.

Level uses a triangular threshold: cumulative_xp(n) = 100 * n * (n-1) / 2
  Level 1:   0 XP    Level 2:  100    Level 3:  300
  Level 4: 600        Level 5: 1000   Level 10: 4500
  Level 20: 19000     Level 50: 122500 (cap)

Level is never presented as player skill. The UI copy should read
"Level N explorer" or similar participation language.
"""
from __future__ import annotations

LEVEL_CAP = 50


def cumulative_xp_for_level(level: int) -> int:
    """Minimum total XP required to reach `level`."""
    if level < 1:
        raise ValueError("level must be >= 1")
    return 100 * (level - 1) * level // 2


def level_from_xp(total_xp: int) -> int:
    """Return the current level given total XP. Monotonic and bounded."""
    if total_xp < 0:
        total_xp = 0
    # Binary search for the highest level whose threshold is <= total_xp
    lo, hi = 1, LEVEL_CAP
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if cumulative_xp_for_level(mid) <= total_xp:
            lo = mid
        else:
            hi = mid - 1
    return lo


def xp_into_level(total_xp: int) -> int:
    """XP earned within the current level (progress bar numerator)."""
    lv = level_from_xp(total_xp)
    return total_xp - cumulative_xp_for_level(lv)


def xp_for_next_level(total_xp: int) -> int | None:
    """XP needed to reach the next level, or None if already at cap."""
    lv = level_from_xp(total_xp)
    if lv >= LEVEL_CAP:
        return None
    return cumulative_xp_for_level(lv + 1) - cumulative_xp_for_level(lv)


def progress_fraction(total_xp: int) -> float:
    """Float 0.0–1.0 representing progress within the current level."""
    needed = xp_for_next_level(total_xp)
    if needed is None:
        return 1.0
    progress = xp_into_level(total_xp)
    return min(1.0, progress / needed) if needed > 0 else 1.0
