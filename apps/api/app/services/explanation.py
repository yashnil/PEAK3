"""Deterministic explanation generation for PEAK3 duel results."""
from __future__ import annotations

COMPONENT_LABELS: dict[str, str] = {
    "statistical_impact": "Statistical Impact",
    "traditional_production": "Traditional Production",
    "individual_recognition": "Individual Recognition",
    "postseason_individual_value": "Postseason Value",
    "team_achievement": "Team Achievement",
}


def generate_explanation(
    winner: dict,
    loser: dict,
    prime_index_gap: float,
) -> str:
    """Generate a 1-2 sentence explanation of why the winner beat the loser.

    Args:
        winner: Full peak window dict with 'components' sub-dict.
        loser: Full peak window dict with 'components' sub-dict.
        prime_index_gap: Absolute difference between prime_index values.

    Returns:
        A human-readable explanation string.
    """
    winner_name = winner.get("player_name", "The winner")
    loser_name = loser.get("player_name", "the loser")
    winner_short = winner_name.split()[1] if " " in winner_name else winner_name
    loser_short = loser_name.split()[1] if " " in loser_name else loser_name
    duration = winner.get("duration_years", 1)

    winner_components: dict = winner.get("components", {})
    loser_components: dict = loser.get("components", {})

    diffs = {
        k: winner_components.get(k, 0.0) - loser_components.get(k, 0.0)
        for k in COMPONENT_LABELS
    }
    sorted_diffs = sorted(diffs.items(), key=lambda x: -x[1])

    # Photo finish case
    if prime_index_gap < 2.0:
        biggest_diff_label = COMPONENT_LABELS[sorted_diffs[0][0]]
        return (
            f"This was a photo finish: PEAK3 rates {winner_short} ahead primarily through "
            f"{biggest_diff_label}, with {loser_short} close on every other dimension."
        )

    top_diff = sorted_diffs[0]
    second_diff = sorted_diffs[1]

    # One component clearly decisive
    if top_diff[1] > 3.0 and second_diff[1] < 1.0:
        return (
            f"Within this formula, {winner_short}'s advantage came primarily from "
            f"{COMPONENT_LABELS[top_diff[0]]}."
        )

    # Two components decisive
    if top_diff[1] > 0 and second_diff[1] > 0:
        loser_best = sorted(diffs.items(), key=lambda x: x[1])[0]
        if loser_best[1] < -1.0:
            return (
                f"The model gives {winner_short} the edge through {COMPONENT_LABELS[top_diff[0]]} "
                f"and {COMPONENT_LABELS[second_diff[0]]}, while {loser_short} led in "
                f"{COMPONENT_LABELS[loser_best[0]]}."
            )
        return (
            f"PEAK3 rates {winner_short} ahead on {COMPONENT_LABELS[top_diff[0]]} "
            f"and {COMPONENT_LABELS[second_diff[0]]}."
        )

    return (
        f"The model rates {winner_short} ahead of {loser_short} "
        f"in this {duration}-year window."
    )
