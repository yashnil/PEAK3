"""Arena points calculation for PEAK3 game answers."""
from __future__ import annotations


def percentile_rank(value: float, values: list[float]) -> float:
    """Return the percentile rank of `value` in `values` (0–100, lower = smaller).

    Uses the fraction of values strictly less than the given value.
    """
    if not values:
        return 50.0
    n = len(values)
    rank = sum(1 for v in values if v < value)
    return (rank / n) * 100.0


def calculate_arena_points(
    correct: bool,
    prime_index_gap: float,
    elapsed_ms: int,
    streak: int,
    all_gaps: list[float],
) -> int:
    """Calculate arena points for a single answer.

    Args:
        correct: Whether the player selected the correct peak.
        prime_index_gap: |left_prime_index - right_prime_index|.
        elapsed_ms: Time taken to answer in milliseconds.
        streak: Current streak count (before this answer).
        all_gaps: All prime_index gaps in the current session (for normalization).

    Returns:
        Non-negative integer arena points.
    """
    if not correct:
        return 0

    # Base score
    base = 100

    # Closeness bonus: up to 200 pts — lower gap (harder) earns more points
    gap_pct = percentile_rank(prime_index_gap, all_gaps)  # 0 = hardest, 100 = easiest
    closeness_bonus = int(200 * (1.0 - gap_pct / 100.0))

    # Speed bonus: up to 100 pts
    FLOOR_MS = 1000
    FULL_BONUS_MS = 5000
    ZERO_BONUS_MS = 30000

    if elapsed_ms <= FLOOR_MS:
        speed_frac = 0.0  # too fast — likely not human
    elif elapsed_ms <= FULL_BONUS_MS:
        speed_frac = 1.0
    else:
        speed_frac = max(
            0.0,
            1.0 - (elapsed_ms - FULL_BONUS_MS) / (ZERO_BONUS_MS - FULL_BONUS_MS),
        )
    speed_bonus = int(100 * speed_frac)

    # Streak multiplier: 1.0 + 0.05 per streak level, capped at 1.50
    streak_mult = min(1.50, 1.0 + 0.05 * max(0, streak))

    total = int((base + closeness_bonus + speed_bonus) * streak_mult)
    return min(total, 600)  # absolute cap
