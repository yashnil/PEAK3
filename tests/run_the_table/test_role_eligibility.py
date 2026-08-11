"""RUN THE TABLE — role eligibility comes from positions, never from quality.

THE DEFECT THIS FILE PINS (F7). Role eligibility used to be derived from
component-score percentiles, because at the time no positional data existed at
the card-profile layer. The consequence: `guard_wing`'s only real requirement
was SI >= 40th percentile and `lead_creator`'s was SI >= 75th, so any
sufficiently GOOD player became positionally universal. Shaquille O'Neal's
committed v3 profile read `[lead_creator, guard_wing, wing_forward,
forward_big]` — a traditional center offered at point guard, and NOT offered
at anchor because his scoring was too good for the anchor rule's "non-scorer"
filter. Player quality was deciding positional flexibility.

ROLES-v4 (scripts/build_card_profiles.py, POSITION_ROLE_MAP) derives roles
from `nba_peak.perfect_season.career_positions` — the set of positions each
player actually logged >= 20 games and >= 500 minutes at, from committed
season data. Each real position grants its adjacent role families and nothing
else does:

    PG -> lead_creator, guard_wing
    SG -> guard_wing
    SF -> guard_wing, wing_forward
    PF -> wing_forward, forward_big
    C  -> forward_big, anchor

EVERY EXPECTATION BELOW FOLLOWS FROM THAT MAPPING AND THE POSITION DATA, not
from hand-authored star exceptions: the test derives the expected roles from
`career_positions` itself and then asserts the committed pool agrees, so a
future data refresh that changes a player's real position set updates the
expectation with it rather than failing on a stale byte.
"""
from __future__ import annotations

import pytest

from nba_peak.perfect_season.career_positions import career_positions
from nba_peak.run_the_table.config import ROLES

POSITION_ROLE_MAP = {
    "PG": ("lead_creator", "guard_wing"),
    "SG": ("guard_wing",),
    "SF": ("guard_wing", "wing_forward"),
    "PF": ("wing_forward", "forward_big"),
    "C":  ("forward_big", "anchor"),
}


def roles_from_positions(slug: str) -> tuple[str, ...]:
    """The mapping under test, restated independently of the builder so a
    builder regression cannot silently agree with itself."""
    granted: set[str] = set()
    for position in career_positions(slug):
        granted.update(POSITION_ROLE_MAP[position])
    return tuple(r for r in ROLES if r in granted)


def cards_for(pool, slug: str):
    cards = [c for c in pool.cards if c.player_slug == slug]
    assert cards, f"{slug} is not in the eligible pool"
    return cards


# ---------------------------------------------------------------------------
# The explicit Shaq regression
# ---------------------------------------------------------------------------


def test_a_traditional_center_can_never_play_guard_wing(pool):
    """THE REPORTED DEFECT. Shaq's real career position set is exactly {C}."""
    assert career_positions("shaquille-oneal") == frozenset({"C"})
    for card in cards_for(pool, "shaquille-oneal"):
        assert "guard_wing" not in card.eligible_roles
        assert "lead_creator" not in card.eligible_roles
        assert "wing_forward" not in card.eligible_roles
        assert "anchor" in card.eligible_roles
        assert "forward_big" in card.eligible_roles
        assert card.primary_role == "anchor"


# ---------------------------------------------------------------------------
# The eight representative archetypes, plus the named stars
# ---------------------------------------------------------------------------

# (slug, archetype, a position that must be in the data, a role that must NOT
#  be granted). The full expected role set is derived, not authored — see the
# module docstring — but each row also names one forbidden role so the test
# still says something if the derivation and the pool drift together.
ARCHETYPES = [
    ("john-stockton",    "small PG",            "PG", "anchor"),
    ("allen-iverson",    "combo guard",         "SG", "forward_big"),
    ("reggie-miller",    "shooting guard",      "SG", "lead_creator"),
    ("kevin-durant",     "large wing",          "SF", "anchor"),
    ("draymond-green",   "forward",             "PF", "lead_creator"),
    ("nikola-jokic",     "stretch/mobile big",  "C",  "lead_creator"),
    ("shaquille-oneal",  "traditional center",  "C",  "guard_wing"),
    ("lebron-james",     "point forward",       "SF", None),
    ("stephen-curry",    "primary PG",          "PG", "wing_forward"),
    ("michael-jordan",   "wing creator",        "SG", "anchor"),
]


@pytest.mark.parametrize("slug,archetype,expected_position,forbidden", ARCHETYPES)
def test_archetype_roles_follow_the_position_data(
    pool, slug, archetype, expected_position, forbidden
):
    positions = career_positions(slug)
    assert expected_position in positions, (
        f"{slug} ({archetype}): position data no longer lists {expected_position}"
    )
    expected = roles_from_positions(slug)
    assert expected, f"{slug} derived no roles at all"
    for card in cards_for(pool, slug):
        assert tuple(card.eligible_roles) == expected, (
            f"{slug} ({archetype}): pool says {card.eligible_roles}, "
            f"positions {sorted(positions)} derive {expected}"
        )
        if forbidden is not None:
            assert forbidden not in card.eligible_roles, (
                f"{slug} ({archetype}) must never be eligible for {forbidden}"
            )


def test_the_point_forward_spans_families_only_because_the_data_does(pool):
    """LeBron is the genuine hybrid: the data lists him at all five positions,
    so — and ONLY so — he derives all five roles. The flexibility is earned in
    the seasons, not granted by the name."""
    assert career_positions("lebron-james") == frozenset({"PG", "SG", "SF", "PF", "C"})
    for card in cards_for(pool, "lebron-james"):
        assert tuple(card.eligible_roles) == tuple(ROLES)


# ---------------------------------------------------------------------------
# Pool-wide audits
# ---------------------------------------------------------------------------


def test_every_card_in_the_pool_matches_its_position_derivation(pool):
    """The whole committed pool, not a sample: eligibility is the position
    mapping for every card whose player has position data (which, as of this
    build, is all of them)."""
    checked = 0
    for card in pool.cards:
        expected = roles_from_positions(card.player_slug)
        if not expected:
            continue  # capability fallback is allowed only when no data exists
        assert tuple(card.eligible_roles) == expected, card.player_slug
        checked += 1
    assert checked == len(pool.cards), (
        f"only {checked}/{len(pool.cards)} cards had position data — "
        "the capability fallback fired for a card it should not have"
    )


def test_no_card_in_the_pool_has_zero_roles(pool):
    for card in pool.cards:
        assert card.eligible_roles, card.player_slug


def test_quality_grants_no_flexibility(pool):
    """The defect, stated as a pool-wide property: among single-position
    players, the BEST card must have exactly the same role count as the worst.
    Under the old percentile rules the best single-position players carried
    four roles and the weakest one."""
    single_position = [
        c for c in pool.cards if len(career_positions(c.player_slug)) == 1
    ]
    assert single_position, "no single-position players in the pool?"
    by_roles = {len(c.eligible_roles) for c in single_position}
    # A single position grants at most two families (its own mapping row),
    # regardless of how good the card is.
    assert by_roles <= {1, 2}, sorted(by_roles)
    best = max(single_position, key=lambda c: c.prime_score)
    worst = min(single_position, key=lambda c: c.prime_score)
    assert len(best.eligible_roles) <= 2, (
        f"{best.player_name} gained roles from being good"
    )
    assert len(worst.eligible_roles) >= 1


def test_no_role_is_starved_in_the_3y_pool(pool):
    """Board generation deals by role band; a role with a handful of cards
    would make the deal degenerate. Every role keeps a real pool."""
    counts = pool.role_counts()
    for role in ROLES:
        assert counts.get(role, 0) >= 20, (role, counts)


# ---------------------------------------------------------------------------
# The offering invariant
# ---------------------------------------------------------------------------


def test_every_offered_candidate_has_a_legal_lane_on_the_opening_roster(pool):
    """ZERO offered candidates with no usable legal destination (F7).

    Two facts make this structural rather than probabilistic — bench slots
    accept any card, and the pool holds no zero-role card — but structural
    facts drift, so it is asserted against the real generated boards: every
    draft offer of every stage of a spread of seeds must report at least one
    legal slot against that run's own roster.
    """
    from nba_peak.run_the_table import state as S
    from nba_peak.run_the_table.generation import generate_blueprint

    checked = 0
    for seed in (1, 3, 11, 21, 42, 99, 777):
        bp = generate_blueprint(seed, pool=pool)
        st = S.create_run(bp, f"offer-audit-{seed}", pool=pool)
        for stage in bp.stages:
            for node_id, payload in stage.payloads.items():
                for card_id in payload.get("offer_ids", ()):
                    slots = S.legal_slots_for(st, pool, card_id)
                    # A dealt card already on this roster is legal nowhere by
                    # design (you cannot own the same player twice); every
                    # OTHER offer must have a lane.
                    if pool.get(card_id).player_slug in {
                        pool.get(c.card_id).player_slug
                        for c in (*st.starters, *st.bench) if c.card_id
                    }:
                        continue
                    assert slots, (
                        f"seed {seed} {node_id}: offer {card_id} has no legal slot"
                    )
                    checked += 1
    assert checked > 100, f"only {checked} offers audited — the sweep is broken"
