"""RUN THE TABLE — roles come from the CARD WINDOW's positions, never quality.

THE TWO DEFECTS THIS FILE PINS (F7, then the A0 correction).

First (v4): role eligibility used to be derived from component-score
percentiles, so any sufficiently GOOD player became positionally universal —
Shaquille O'Neal's committed profile read `[lead_creator, guard_wing,
wing_forward, forward_big]` and NOT anchor.

Second (v5): v4 fixed that with POSITIONS, but unioned them across the whole
CAREER, so one card could be legal somewhere purely because the player played
that position years outside the card's window (LeBron's Miami window carried
all five roles; Rodman carried guard_wing off an SF grant). Eligibility is a
claim about THIS card, so v5 reads positional evidence from the seasons
INSIDE the card's own window (`listed_position`, gate-qualified at >= 20
games and >= 500 minutes per season), under a tightened map in which SF alone
never grants guard_wing:

    PG -> lead_creator, guard_wing
    SG -> guard_wing
    SF -> wing_forward
    PF -> wing_forward, forward_big
    C  -> forward_big, anchor

EVERY EXPECTATION BELOW FOLLOWS FROM THAT MAPPING AND THE WINDOW DATA, not
from hand-authored star exceptions: the tests derive the expected roles from
`listed_position` over each card's own seasons and assert the committed pool
agrees, so a future data refresh updates the expectation with the data rather
than failing on a stale byte.
"""
from __future__ import annotations

import pytest

from nba_peak.perfect_season.career_positions import career_positions, listed_position
from nba_peak.run_the_table.config import ROLES

POSITION_ROLE_MAP = {
    "PG": ("lead_creator", "guard_wing"),
    "SG": ("guard_wing",),
    "SF": ("wing_forward",),
    "PF": ("wing_forward", "forward_big"),
    "C":  ("forward_big", "anchor"),
}


def window_seasons(start_season: str, end_season: str) -> list[str]:
    first, last = int(start_season[:4]), int(end_season[:4])
    return [f"{year}-{str(year + 1)[-2:].zfill(2)}" for year in range(first, last + 1)]


def window_positions(slug: str, start_season: str, end_season: str) -> frozenset[str]:
    """Positions the player was gate-qualified at INSIDE this window; falls
    back to the career union only when no window season qualifies — the same
    ladder the builder walks."""
    found = {
        listed_position(slug, season)
        for season in window_seasons(start_season, end_season)
    } - {None}
    return frozenset(found) if found else frozenset(career_positions(slug))


def roles_from_positions(positions: frozenset[str]) -> tuple[str, ...]:
    """The mapping under test, restated independently of the builder so a
    builder regression cannot silently agree with itself."""
    granted: set[str] = set()
    for position in positions:
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
    """THE REPORTED DEFECT. Shaq's gate-qualified positions are exactly {C} —
    career-wide AND therefore in every window."""
    assert career_positions("shaquille-oneal") == frozenset({"C"})
    for card in cards_for(pool, "shaquille-oneal"):
        assert window_positions(
            "shaquille-oneal", card.start_season, card.end_season
        ) == frozenset({"C"})
        assert "guard_wing" not in card.eligible_roles
        assert "lead_creator" not in card.eligible_roles
        assert "wing_forward" not in card.eligible_roles
        assert "anchor" in card.eligible_roles
        assert "forward_big" in card.eligible_roles
        assert card.primary_role == "anchor"


# ---------------------------------------------------------------------------
# The eight representative archetypes, plus the named stars
# ---------------------------------------------------------------------------

# (slug, archetype, a position the career data must still list, a role no
#  window of theirs may EVER be granted). The full expected role set per card
# is derived from that card's own window — see the module docstring — but each
# row also names one forbidden role so the test still says something if the
# derivation and the pool drift together.
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
def test_archetype_roles_follow_each_windows_own_data(
    pool, slug, archetype, expected_position, forbidden
):
    assert expected_position in career_positions(slug), (
        f"{slug} ({archetype}): position data no longer lists {expected_position}"
    )
    for card in cards_for(pool, slug):
        positions = window_positions(slug, card.start_season, card.end_season)
        expected = roles_from_positions(positions)
        assert expected, f"{slug} {card.start_season} derived no roles at all"
        assert tuple(card.eligible_roles) == expected, (
            f"{slug} ({archetype}) {card.start_season}..{card.end_season}: pool "
            f"says {card.eligible_roles}, window positions {sorted(positions)} "
            f"derive {expected}"
        )
        if forbidden is not None:
            assert forbidden not in card.eligible_roles, (
                f"{slug} ({archetype}) must never be eligible for {forbidden}"
            )


def test_a_hybrids_flexibility_is_window_scoped_not_career_wide(pool):
    """THE A0 CORRECTION'S HEADLINE CASE. LeBron's CAREER spans all five
    positions, and under v4 every one of his cards therefore carried all five
    roles. A card is a claim about a 3-year window, and no window of his has
    all five gate-qualified positions — so no card may carry all five roles,
    and each card's roles must come from ITS OWN seasons."""
    assert career_positions("lebron-james") == frozenset({"PG", "SG", "SF", "PF", "C"})
    for card in cards_for(pool, "lebron-james"):
        positions = window_positions("lebron-james", card.start_season, card.end_season)
        assert positions < frozenset({"PG", "SG", "SF", "PF", "C"}), (
            f"window {card.start_season}..{card.end_season} claims all five positions"
        )
        assert tuple(card.eligible_roles) == roles_from_positions(positions)
        assert len(card.eligible_roles) < 5


def test_sf_alone_never_grants_guard_wing(pool):
    """THE TIGHTENED GRANT, pool-wide: every guard_wing card has PG or SG
    evidence inside its own window (Rodman's SF seasons no longer make him a
    Guard/Wing)."""
    checked = 0
    for card in pool.cards:
        if "guard_wing" not in card.eligible_roles:
            continue
        positions = window_positions(card.player_slug, card.start_season, card.end_season)
        assert positions & {"PG", "SG"}, (
            f"{card.player_slug} {card.start_season}: guard_wing without PG/SG "
            f"evidence ({sorted(positions)})"
        )
        checked += 1
    assert checked > 0


def test_anchor_requires_center_evidence_in_the_window(pool):
    for card in pool.cards:
        if "anchor" not in card.eligible_roles:
            continue
        positions = window_positions(card.player_slug, card.start_season, card.end_season)
        assert "C" in positions, (
            f"{card.player_slug} {card.start_season}: anchor without C evidence"
        )


# ---------------------------------------------------------------------------
# Pool-wide audits
# ---------------------------------------------------------------------------


def test_every_card_in_the_pool_matches_its_position_derivation(pool):
    """The whole committed pool, not a sample: eligibility is the position
    mapping for every card whose player has position data (which, as of this
    build, is all of them)."""
    checked = 0
    for card in pool.cards:
        expected = roles_from_positions(
            window_positions(card.player_slug, card.start_season, card.end_season)
        )
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
        c for c in pool.cards
        if len(window_positions(c.player_slug, c.start_season, c.end_season)) == 1
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
