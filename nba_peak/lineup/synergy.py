"""Synergy adjustment layer for the experimental lineup model.

Each rule is bounded, named, and produces a receipt item.
No rule can override talent quality.
No player-specific exceptions.
"""
from __future__ import annotations

from nba_peak.lineup.config import SYNERGY_MAX, SYNERGY_MIN, SYNERGY_RULES
from nba_peak.lineup.schemas import CardProfile, SynergyItem


def _count_dna(cards: list[CardProfile], dimension: str, threshold: float) -> int:
    return sum(1 for c in cards if getattr(c.lineup_dna, dimension, 0.0) >= threshold)


def _has_any_role(cards: list[CardProfile], role: str) -> bool:
    return any(role in c.eligible_roles for c in cards)


def compute_synergy(cards: list[CardProfile]) -> tuple[float, list[SynergyItem]]:
    """Evaluate all synergy rules and return (total_adjustment, items).

    Args:
        cards: 5 CardProfile objects.

    Returns:
        (total_adjustment: float bounded to SYNERGY_MIN..SYNERGY_MAX,
         items: list[SynergyItem] one per rule evaluated)
    """
    items: list[SynergyItem] = []
    total = 0.0

    all_roles_in_lineup = {r for c in cards for r in c.eligible_roles}

    for rule in SYNERGY_RULES:
        triggered = False
        adj = rule["adjustment"]

        if "requires_roles" in rule:
            # Positive: lineup has all required roles
            triggered = all(r in all_roles_in_lineup for r in rule["requires_roles"])

        elif "scoring_pressure_count" in rule and rule["type"] == "positive":
            count = _count_dna(
                cards, "scoring_pressure", rule["scoring_pressure_threshold"]
            )
            triggered = count >= rule["scoring_pressure_count"]

        elif "validation_count" in rule:
            count = _count_dna(
                cards, "individual_validation", rule["validation_threshold"]
            )
            triggered = count >= rule["validation_count"]

        elif "missing_role" in rule:
            # Negative: lineup lacks a required role
            triggered = rule["missing_role"] not in all_roles_in_lineup

        elif "creation_count" in rule:
            count = _count_dna(cards, "primary_creation", rule["creation_threshold"])
            triggered = count >= rule["creation_count"]

        elif "scoring_pressure_count_max" in rule and rule["type"] == "negative":
            count = _count_dna(
                cards, "scoring_pressure", rule["scoring_pressure_threshold"]
            )
            triggered = count < rule["scoring_pressure_count_max"]

        item = SynergyItem(
            rule_id=rule["id"],
            rule_type=rule["type"],
            title=rule["title"],
            description=rule["description"],
            triggered=triggered,
            adjustment=adj if triggered else 0.0,
        )
        items.append(item)
        if triggered:
            total += adj

    # Clamp total synergy adjustment
    total_clamped = max(SYNERGY_MIN, min(SYNERGY_MAX, total))
    return total_clamped, items
