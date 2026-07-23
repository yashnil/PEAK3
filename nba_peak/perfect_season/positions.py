"""v1 archetype -> position mapping for CourtBuilder position-aware slots.

EXPLICITLY AN APPROXIMATION, NOT GROUND TRUTH. The current card data has no
real NBA position field anywhere in the pipeline (verified absent from
card_profiles.v3.json and every other committed data file -- see
docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Sec 3). This module
derives a position label from the existing lineup-archetype role
(lead_creator/guard_wing/wing_forward/forward_big/anchor) already computed
for Peak Draft's lineup model, per
docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 6.4b.

This mapping WILL misclassify some players (e.g., some `anchor`-archetype
players were historically defensive-minded wings, not literal centers).
Replacing it with a real primary_position/secondary_position field sourced
from Basketball-Reference is a database-expansion follow-up
(docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md), not this
module's job -- this mapping only needs to be good enough to prove the
position-slot mechanic is fun, which is the actual goal of this phase.
"""
from __future__ import annotations

# The 5 position-anchored starter slots and 3 plain, unrestricted bench
# slots. Duplicated here (rather than imported from config.py) only as plain
# tuples for fast membership checks -- config.py's SLOT_TYPES remains the
# single source of truth for the full ordered slot list.
STARTER_SLOTS = ("PG", "SG", "SF", "PF", "C")
BENCH_SLOTS = ("bench_1", "bench_2", "bench_3")

# archetype -> (primary position, tuple of secondary positions)
ARCHETYPE_POSITION_MAP: dict[str, tuple[str, tuple[str, ...]]] = {
    "lead_creator": ("PG", ("SG",)),
    "guard_wing": ("SG", ("PG", "SF")),
    "wing_forward": ("SF", ("SG", "PF")),
    "forward_big": ("PF", ("C", "SF")),
    "anchor": ("C", ("PF",)),
}

# Possible classify_fit() return values, for callers that want the full set.
ROLE_FIT_VALUES = ("primary", "secondary", "off_position", "flexible")


def primary_position(archetype: str | None) -> str | None:
    """The v1-approximated primary position for an archetype, or None if
    the archetype is unknown/unset."""
    entry = ARCHETYPE_POSITION_MAP.get(archetype) if archetype else None
    return entry[0] if entry else None


def secondary_positions(archetype: str | None) -> tuple[str, ...]:
    """The v1-approximated secondary position(s) for an archetype."""
    entry = ARCHETYPE_POSITION_MAP.get(archetype) if archetype else None
    return entry[1] if entry else ()


def classify_fit(archetype: str | None, slot_type: str) -> str:
    """Classify how well an archetype fits a given slot.

    Returns one of:
      "primary"      -- archetype's primary position matches the slot
      "secondary"     -- archetype's secondary position matches the slot
      "off_position"  -- neither matches (still a fully legal placement --
                          see docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md
                          Sec 6.2: soft placement, never blocked)
      "flexible"      -- the slot is a bench slot (bench_1 / bench_2 /
                          bench_3), which is never position-restricted
                          regardless of archetype

    Placement legality is NOT determined here -- this function is purely
    for display/fit-feedback purposes. Every slot accepts every player;
    this only tells the caller what plain-language note to show.
    """
    if slot_type in BENCH_SLOTS:
        return "flexible"
    if slot_type not in STARTER_SLOTS:
        # Unknown slot_type -- defensive default, should not occur given
        # config.SLOT_TYPES is the only source of slot_type values.
        return "off_position"
    if primary_position(archetype) == slot_type:
        return "primary"
    if slot_type in secondary_positions(archetype):
        return "secondary"
    return "off_position"
