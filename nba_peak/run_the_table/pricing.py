"""Card pricing and System economics for RUN THE TABLE.

Every price the player is ever shown comes from :func:`price_for` and is
reproducible from ``(card, active_systems)`` alone. The function also returns
the list of modifiers it applied, so the UI can explain a discount in plain
language instead of showing an unexplained number.
"""
from __future__ import annotations

from typing import Sequence

from nba_peak.run_the_table.config import (
    MONEYBALL_DISCOUNT,
    MONEYBALL_PERCENTILE_MAX,
    NO_HARDWARE_DISCOUNT,
    NO_HARDWARE_IMPACT_PCT_MIN,
    NO_HARDWARE_RECOGNITION_PCT_MAX,
    PRICE_MAX,
    PRICE_MIN,
    TRADE_MACHINE_REFUND_PCT,
    TRADE_REFUND_PCT,
    TWO_WAY_BALANCE_MAX_SPREAD,
    TWO_WAY_DISCOUNT,
    TWO_WAY_IMPACT_PCT_MIN,
    TWO_WAY_MAX_PERCENTILE,
    VETERAN_MINIMUM_PERCENTILE_MAX,
)
from nba_peak.run_the_table.schemas import RunCard


def qualifies_moneyball(card: RunCard) -> bool:
    return card.overall_percentile <= MONEYBALL_PERCENTILE_MAX


def qualifies_no_hardware(card: RunCard) -> bool:
    return (
        card.lane_percentiles["individual_recognition"] < NO_HARDWARE_RECOGNITION_PCT_MAX
        and card.lane_percentiles["statistical_impact"] > NO_HARDWARE_IMPACT_PCT_MIN
    )


def qualifies_two_way(card: RunCard) -> bool:
    vals = list(card.lane_percentiles.values())
    spread = max(vals) - min(vals)
    return (
        spread <= TWO_WAY_BALANCE_MAX_SPREAD
        and card.lane_percentiles["statistical_impact"] > TWO_WAY_IMPACT_PCT_MIN
        and card.overall_percentile <= TWO_WAY_MAX_PERCENTILE
    )


def qualifies_veteran_minimum(card: RunCard) -> bool:
    return card.overall_percentile <= VETERAN_MINIMUM_PERCENTILE_MAX


#: System id -> (predicate, discount fraction). Order is fixed and published;
#: discounts are applied multiplicatively in this order so a card qualifying
#: for two Systems is never double-charged or free by accident.
_PRICE_SYSTEMS: tuple[tuple[str, object, float], ...] = (
    ("moneyball", qualifies_moneyball, MONEYBALL_DISCOUNT),
    ("no_hardware", qualifies_no_hardware, NO_HARDWARE_DISCOUNT),
    ("two_way_value", qualifies_two_way, TWO_WAY_DISCOUNT),
)


def price_for(card: RunCard, systems: Sequence[str] = ()) -> tuple[int, list[dict]]:
    """Return ``(final_cost, applied_modifiers)``.

    ``final_cost`` is clamped to ``[PRICE_MIN, PRICE_MAX]``. Rounding is
    ``round()`` half-to-even at each step, applied to the running value so the
    displayed price is exactly what is charged.
    """
    cost = float(card.base_cost)
    applied: list[dict] = []
    for system_id, predicate, discount in _PRICE_SYSTEMS:
        if system_id in systems and predicate(card):  # type: ignore[operator]
            before = cost
            cost = cost * (1.0 - discount)
            applied.append(
                {
                    "system_id": system_id,
                    "discount_pct": round(discount * 100),
                    "before": int(round(before)),
                    "after": max(PRICE_MIN, int(round(cost))),
                }
            )
    final = int(round(cost))
    final = max(PRICE_MIN, min(PRICE_MAX, final))
    return final, applied


def veteran_minimum_available(
    card: RunCard, systems: Sequence[str], used_in_act: bool
) -> bool:
    """Veteran Minimum makes one qualifying card free, once per act."""
    return (
        "veteran_minimum" in systems
        and not used_in_act
        and qualifies_veteran_minimum(card)
    )


def refund_for(card: RunCard, systems: Sequence[str] = ()) -> int:
    """Credits returned when a card leaves the roster.

    Based on the card's *undiscounted* base cost so a System cannot be used to
    buy cheap and sell dear. Rounded down — the player never profits from a
    round-trip.
    """
    pct = TRADE_MACHINE_REFUND_PCT if "trade_machine" in systems else TRADE_REFUND_PCT
    return int(card.base_cost * pct)


def trade_net_cost(
    outgoing: RunCard, incoming: RunCard, systems: Sequence[str] = ()
) -> dict:
    """Transparent breakdown of a proposed trade."""
    incoming_cost, modifiers = price_for(incoming, systems)
    refund = refund_for(outgoing, systems)
    return {
        "incoming_cost": incoming_cost,
        "incoming_modifiers": modifiers,
        "outgoing_refund": refund,
        "net_cost": incoming_cost - refund,
    }
