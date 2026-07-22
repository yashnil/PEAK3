"""Achievement evaluation engine.

Evaluators are pure functions — they inspect an event and context and return
True if the achievement should be awarded. Recording the award is guarded by
a database UNIQUE constraint, making evaluation idempotent.

Never hardcode player names or IDs in evaluators.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class EvalContext:
    """Context passed to every evaluator."""
    owner_sub: str
    event_type: str           # triggering event type
    source_id: str            # source result/event ID
    result_payload: dict      # full result snapshot payload (if available)
    existing_awards: set[str] # achievement keys already awarded to this user
    mode: str | None = None
    board_type: str | None = None
    draft_efficiency: float | None = None
    lineup_peak_rating: float | None = None
    current_streak: int = 0
    total_modes_completed: set[str] | None = None  # set of modes completed by user
    challenge_margin: float | None = None


AchievementEvaluator = Callable[[EvalContext], bool]


# ---------------------------------------------------------------------------
# Evaluator implementations
# ---------------------------------------------------------------------------


def first_game_evaluator(ctx: EvalContext) -> bool:
    return ctx.event_type in (
        "daily_completion_first",
        "practice_completion_first_weekly",
        "challenge_completion",
    ) and "first_game" not in ctx.existing_awards


def mode_completion_evaluator(ctx: EvalContext) -> bool:
    """Used for apex_explorer, prime_explorer, foundation_explorer."""
    return ctx.event_type in (
        "daily_completion_first",
        "practice_completion_first_weekly",
    )


def full_spectrum_evaluator(ctx: EvalContext) -> bool:
    if ctx.total_modes_completed is None:
        return False
    return (
        "full_spectrum" not in ctx.existing_awards
        and {"apex_1y", "prime_3y", "foundation_5y"}.issubset(ctx.total_modes_completed)
    )


def receipt_exploration_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.event_type == "receipt_exploration"
        and "read_the_receipt" not in ctx.existing_awards
    )


def challenge_created_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.event_type == "challenge_created"
        and "challenger" not in ctx.existing_awards
    )


def challenge_completed_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.event_type == "challenge_completion"
        and "answered_the_call" not in ctx.existing_awards
    )


def photo_finish_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.event_type == "challenge_completion"
        and ctx.challenge_margin is not None
        and abs(ctx.challenge_margin) <= 1.0
        and "photo_finish" not in ctx.existing_awards
    )


def draft_efficiency_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.draft_efficiency is not None
        and ctx.draft_efficiency >= 0.85
        and "board_maximizer" not in ctx.existing_awards
    )


def balanced_lineup_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.lineup_peak_rating is not None
        and ctx.lineup_peak_rating >= 75.0
        and "balanced_five" not in ctx.existing_awards
    )


def role_complete_evaluator(ctx: EvalContext) -> bool:
    """True if all 5 roles are present in the result."""
    if "role_complete" in ctx.existing_awards:
        return False
    if not ctx.result_payload:
        return False
    selected = ctx.result_payload.get("selected_cards", [])
    roles = {c.get("assigned_role") for c in selected if c.get("assigned_role")}
    required = {"lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"}
    return required.issubset(roles)


def streak_length_evaluator(ctx: EvalContext) -> bool:
    """Used for three_day_rhythm (3) and seven_day_rhythm (7)."""
    return ctx.current_streak >= 1  # exact threshold set per-achievement in registry


def first_record_evaluator(ctx: EvalContext) -> bool:
    return (
        ctx.event_type == "personal_record_set"
        and "first_personal_best" not in ctx.existing_awards
    )


# ---------------------------------------------------------------------------
# Achievement registry
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class AchievementSpec:
    key: str
    evaluator: AchievementEvaluator
    # Optional: override condition (e.g. streak threshold)
    streak_threshold: int | None = None
    mode_filter: str | None = None   # e.g. 'apex_1y' for mode-specific achievements


_REGISTRY: dict[str, AchievementSpec] = {
    "first_game":           AchievementSpec("first_game", first_game_evaluator),
    "apex_explorer":        AchievementSpec("apex_explorer", mode_completion_evaluator, mode_filter="apex_1y"),
    "prime_explorer":       AchievementSpec("prime_explorer", mode_completion_evaluator, mode_filter="prime_3y"),
    "foundation_explorer":  AchievementSpec("foundation_explorer", mode_completion_evaluator, mode_filter="foundation_5y"),
    "full_spectrum":        AchievementSpec("full_spectrum", full_spectrum_evaluator),
    "read_the_receipt":     AchievementSpec("read_the_receipt", receipt_exploration_evaluator),
    "challenger":           AchievementSpec("challenger", challenge_created_evaluator),
    "answered_the_call":    AchievementSpec("answered_the_call", challenge_completed_evaluator),
    "photo_finish":         AchievementSpec("photo_finish", photo_finish_evaluator),
    "board_maximizer":      AchievementSpec("board_maximizer", draft_efficiency_evaluator),
    "balanced_five":        AchievementSpec("balanced_five", balanced_lineup_evaluator),
    "role_complete":        AchievementSpec("role_complete", role_complete_evaluator),
    "three_day_rhythm":     AchievementSpec("three_day_rhythm", streak_length_evaluator, streak_threshold=3),
    "seven_day_rhythm":     AchievementSpec("seven_day_rhythm", streak_length_evaluator, streak_threshold=7),
    "first_personal_best":  AchievementSpec("first_personal_best", first_record_evaluator),
}


def get_achievement_spec(key: str) -> AchievementSpec | None:
    return _REGISTRY.get(key)


def evaluate_achievements(ctx: EvalContext) -> list[str]:
    """Return list of achievement keys that should now be awarded.

    Filters out already-awarded achievements and applies spec-level conditions.
    """
    newly_earned: list[str] = []
    for key, spec in _REGISTRY.items():
        if key in ctx.existing_awards:
            continue
        # Mode filter: skip if the completion mode doesn't match
        if spec.mode_filter is not None and ctx.mode != spec.mode_filter:
            continue
        # Streak threshold override
        if spec.streak_threshold is not None and ctx.current_streak < spec.streak_threshold:
            continue
        try:
            if spec.evaluator(ctx):
                newly_earned.append(key)
        except Exception:
            # Never let an evaluator crash the completion flow
            continue
    return newly_earned
