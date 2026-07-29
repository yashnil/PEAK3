"""Position-data strategy for CourtBuilder position-aware slots.

TWO-TIER MODEL, in priority order:

1. **Manual v0 overrides** (`POSITION_OVERRIDES` below) -- real, human-
   verified primary/secondary NBA positions for every player_slug currently
   reachable in the interim team-season dataset
   (data/game/interim/courtbuilder_team_seasons.v3.json). This is the
   source of truth whenever it has an entry.

2. **Archetype fallback** (`ARCHETYPE_POSITION_MAP`) -- for any player NOT
   in the override table (i.e. anyone drawn from the open_pool fallback,
   not the curated interim dataset), derived from the existing lineup-
   archetype role (lead_creator/guard_wing/wing_forward/forward_big/anchor)
   already computed for Peak Draft's lineup model.

Why tier 2 is NOT good enough on its own (Phase 5X.6 finding): a manual
audit found Tim Duncan and Shaquille O'Neal -- both real centers/bigs --
displaying as "plays PG" in the UI. Root cause: `primary_role` in the
existing lineup-archetype model classifies players by "best all-around
offensive engine" (lead_creator), not by real position, and nearly every
elite/high-usage player in the pool -- regardless of era or actual position
-- gets classified `lead_creator`, which `ARCHETYPE_POSITION_MAP` maps to
PG. This is correct for the lineup-archetype model's own purpose (Peak
Draft role coverage) and simply wrong as a position proxy. Tier 1 exists to
guarantee every player actually reachable in CourtBuilder today shows a
real, correct position; tier 2 is a labeled-approximate fallback for the
open-pool long tail, not something to fix incrementally forever -- the
durable fix is real position data as part of the 1000-player expansion
(see docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Sec "Required
source tables").
"""
from __future__ import annotations

# The 5 position-anchored starter slots and 3 plain, unrestricted bench
# slots. Duplicated here (rather than imported from config.py) only as plain
# tuples for fast membership checks -- config.py's SLOT_TYPES remains the
# single source of truth for the full ordered slot list.
STARTER_SLOTS = ("PG", "SG", "SF", "PF", "C")
BENCH_SLOTS = ("bench_1", "bench_2", "bench_3")

# archetype -> (primary position, tuple of secondary positions). Fallback
# tier ONLY -- see module docstring. Never used for a player_slug that has
# a POSITION_OVERRIDES entry.
ARCHETYPE_POSITION_MAP: dict[str, tuple[str, tuple[str, ...]]] = {
    "lead_creator": ("PG", ("SG",)),
    "guard_wing": ("SG", ("PG", "SF")),
    "wing_forward": ("SF", ("SG", "PF")),
    "forward_big": ("PF", ("C", "SF")),
    "anchor": ("C", ("PF",)),
}

# Manual v0 position overrides: player_slug -> (primary position, tuple of
# secondary positions). Human-verified against real, publicly documented
# career position(s) -- NOT derived from the lineup archetype. Covers every
# player_slug currently reachable via the interim team-season dataset
# (data/game/interim/courtbuilder_team_seasons.v3.json) as of Phase 5X.6.
#
# Sourcing discipline: primary position is the player's most commonly
# listed/played position; secondary positions are other positions they
# legitimately played meaningful minutes at (never a stretch/aspirational
# guess). Players with one clear position (e.g. Shaquille O'Neal, Nikola
# Jokic) get an empty secondary tuple rather than a padded one -- an empty
# tuple is not a data gap here, it is the accurate answer.
#
# When the 1000-player expansion (PHASE_5X_PLAYER_EXPANSION_STRATEGY.md)
# ships a real source-derived position table, this override table is
# deleted, not migrated -- same "interim, not seed data" discipline already
# used for the team-season dataset itself.
POSITION_OVERRIDES: dict[str, tuple[str, tuple[str, ...]]] = {
    "al-horford": ("PF", ("C",)),
    "alonzo-mourning": ("C", ()),
    "brook-lopez": ("C", ("PF",)),
    "cedric-maxwell": ("PF", ()),
    "chet-holmgren": ("C", ("PF",)),
    "chris-paul": ("PG", ()),
    "david-robinson": ("C", ()),
    "dennis-rodman": ("PF", ("C",)),
    "derrick-white": ("SG", ("PG",)),
    "devin-booker": ("SG", ("PG",)),
    "dirk-nowitzki": ("PF", ("C",)),
    "giannis-antetokounmpo": ("PF", ("SF", "C")),
    "hakeem-olajuwon": ("C", ("PF",)),
    "horace-grant": ("PF", ()),
    "ja-morant": ("PG", ("SG",)),
    "jamal-murray": ("PG", ("SG",)),
    "james-harden": ("SG", ("PG",)),
    "james-worthy": ("SF", ()),
    "jayson-tatum": ("SF", ("PF",)),
    "joel-embiid": ("C", ("PF",)),
    "john-stockton": ("PG", ()),
    "jrue-holiday": ("PG", ("SG",)),
    "kareem-abdul-jabbar": ("C", ()),
    # Phase 8F: Durant has legitimately played all three -- SG in his early
    # Seattle/OKC seasons, SF as his primary career position, PF in
    # small-ball Golden State lineups. Was missing SG entirely.
    "kevin-durant": ("SF", ("PF", "SG")),
    "kevin-garnett": ("PF", ("C",)),
    "kevin-mchale": ("PF", ("C",)),
    "klay-thompson": ("SG", ()),
    "kobe-bryant": ("SG", ("SF",)),
    "kyrie-irving": ("PG", ("SG",)),
    "larry-bird": ("SF", ("PF",)),
    "luka-doncic": ("PG", ("SG",)),
    # Phase 8F: added C -- LeBron has legitimately anchored small-ball-5
    # lineups (2017-18 Cavs playoffs, several Lakers stretches). Product
    # direction: "LeBron at C is not automatically punished if lineup
    # context supports it."
    "lebron-james": ("SF", ("PG", "SG", "PF", "C")),
    "magic-johnson": ("PG", ("SG",)),
    "manu-ginobili": ("SG", ("PG",)),
    # Phase 8F: added PG -- Jordan ran point for stretches (most notably his
    # 1989-90 season averaging 8.0 apg with real point-guard duties) on top
    # of his SG/SF career shape.
    "michael-jordan": ("SG", ("SF", "PG")),
    "nikola-jokic": ("C", ("PF",)),
    "pau-gasol": ("PF", ("C",)),
    "paul-pierce": ("SF", ("SG",)),
    "rajon-rondo": ("PG", ()),
    "ray-allen": ("SG", ("SF",)),
    "robert-parish": ("C", ()),
    "ron-harper": ("SG", ("PG",)),
    "scottie-pippen": ("SF", ("SG", "PG")),
    "shai-gilgeous-alexander": ("PG", ("SG",)),
    "shaquille-oneal": ("C", ()),
    "sidney-moncrief": ("SG", ("PG",)),
    "stephen-curry": ("PG", ("SG",)),
    "tim-duncan": ("PF", ("C",)),
    "tony-parker": ("PG", ()),
}

# Possible classify_fit() return values, for callers that want the full set.
ROLE_FIT_VALUES = ("primary", "secondary", "off_position", "flexible")

# Basketball-Reference per-season "Pos" strings use these five tokens, most-
# played first (e.g. "PG-SG", "SF-PF"). PF-C/C-PF era-specific hybrid labels
# some older seasons use are not present in this table's `pos` column, but
# the split is defensive regardless.
_REAL_POSITION_TOKENS = {"PG", "SG", "SF", "PF", "C"}


def parse_real_position(pos: str | None) -> tuple[str | None, tuple[str, ...]]:
    """Split a real Basketball-Reference `pos` string (e.g. "PG-SG", "C")
    into (primary, secondary tuple). Unlike POSITION_OVERRIDES/
    ARCHETYPE_POSITION_MAP (v1 approximations for the career-peak card pool),
    this reads the player's actual listed position for THAT exact season --
    used by team-year mode's exact PlayerSeasonCards, which carry a real
    `position` field (nba_peak.perfect_season.exact_season.PlayerSeasonCard)
    instead of an archetype. Returns (None, ()) if unparseable."""
    if not pos:
        return None, ()
    tokens = [t.strip().upper() for t in str(pos).split("-") if t.strip().upper() in _REAL_POSITION_TOKENS]
    if not tokens:
        return None, ()
    return tokens[0], tuple(tokens[1:])


# Phase 6G Part A: how severe an off-position starter placement actually is,
# for real per-season positions (team-year mode). Not every off-position
# placement is an equally bad basketball problem -- a 6'7 SG playing SF is a
# routine, plausible NBA role; a center playing point guard is not. Used to
# stop the result explanation from naming a mild, defensible swap as "the"
# weakness ahead of a much larger talent/context/bench problem (see
# nba_peak.perfect_season.simulation._structural_weakness_exact).
#
# No height/archetype data is available at this layer, so severity is
# derived from position adjacency alone (never invented/height-inferred) --
# unlisted pairs default to "severe" since, by construction, they are
# further apart on the positional spectrum than any listed pair.
_ADJACENCY_SEVERITY: dict[frozenset[str], str] = {
    frozenset({"PG", "SG"}): "mild",
    frozenset({"SG", "SF"}): "mild",
    frozenset({"PF", "C"}): "mild",
    # Phase 7A Part F: downgraded from "moderate" -- a modern combo forward
    # (the KD-at-PF/LeBron-at-SF pattern) is a routine, defensible NBA
    # role, not a real structural problem. No height/archetype data exists
    # to single out "elite 6'9+ forwards" specifically (never invented --
    # see Part A's original discipline), so this is a general adjacency
    # recalibration that applies to every SF/PF swap, which is the
    # honest, non-player-specific way to capture the same product intent.
    frozenset({"SF", "PF"}): "mild",
    frozenset({"PG", "SF"}): "moderate",
    frozenset({"SG", "PF"}): "moderate",
    frozenset({"C", "SG"}): "severe",
    frozenset({"C", "PG"}): "severe",
    frozenset({"C", "SF"}): "severe",
}


# Phase 7A Part F follow-up: elite/big wings who legitimately and commonly
# play both forward spots within a single season (small-ball 4, modern combo
# forward, or a classic tweener great) -- e.g. LeBron James's 2012-13 Miami
# season lists PF as the primary Basketball-Reference position while Kevin
# Durant's 2013-14 OKC season lists SF, even though both are the same
# "big wing" role. For these specific, human-verified players, a real-season
# SF<->PF swap is treated as "secondary" fit (never "off_position", never
# fit-point penalized), regardless of which forward slot that exact season's
# `pos` field lists. A curated, human-verified list, not a height/archetype
# inference -- same sourcing discipline as POSITION_OVERRIDES; never expand
# this by guessing, only by verifying a player's real forward flexibility.
FLEXIBLE_FORWARD_SLUGS: frozenset[str] = frozenset({
    "lebron-james",
    "kevin-durant",
    "larry-bird",
    "giannis-antetokounmpo",
    "kawhi-leonard",
    "jayson-tatum",
    "paul-george",
    "julius-erving",
    "carmelo-anthony",
})


def position_fit_severity(slot_type: str, real_primary: str | None) -> str:
    """"mild" | "moderate" | "severe" -- how big a real basketball problem an
    off-position starter placement is. Only meaningful for pairs that are
    already "off_position" per classify_fit_from_position/classify_fit (a
    primary/secondary match is never "off_position" in the first place, so
    this is never called to grade those).

    Phase 8F: `real_primary` was originally documented as "must be a real,
    parsed Basketball-Reference position token" (team-year mode only) --
    but this function only ever compares two position-token strings, so it
    is equally valid called with an archetype-derived primary position
    (see classify_fit_severity below, used by the legacy/peak-window path
    that most CourtBuilder games actually run today since
    COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED defaults off). Either way,
    the token itself is never guessed or height-inferred -- it always comes
    from parse_real_position or primary_position/POSITION_OVERRIDES."""
    if not real_primary or real_primary == slot_type:
        return "mild"
    return _ADJACENCY_SEVERITY.get(frozenset({slot_type, real_primary}), "severe")


def classify_fit_severity(player_slug: str | None, archetype: str | None, slot_type: str) -> str | None:
    """position_fit_severity()'s counterpart for the archetype/legacy path
    (classify_fit) -- returns None when the placement isn't "off_position"
    at all (severity is only meaningful for off-position placements), else
    "mild"/"moderate"/"severe". Phase 8F: added so the legacy path (the one
    most CourtBuilder games actually run) can grade off-position severity
    the same way team-year mode already could, instead of treating every
    off-position placement as equally bad."""
    if classify_fit(player_slug, archetype, slot_type) != "off_position":
        return None
    return position_fit_severity(slot_type, primary_position(player_slug, archetype))


def classify_fit_from_position(pos: str | None, slot_type: str, player_slug: str | None = None) -> str:
    """classify_fit()'s counterpart for a real per-season position string
    (team-year mode) instead of a player_slug + archetype lookup. Same
    return contract: "primary" | "secondary" | "off_position" | "flexible".
    Never gates placement legality -- display/fit-feedback only, exactly
    like classify_fit().

    `player_slug` is optional (defaults to None for backward-compatible
    callers that don't have it handy) and only ever used to check
    FLEXIBLE_FORWARD_SLUGS -- an SF<->PF swap for one of those specific
    players is "secondary", never "off_position"."""
    if slot_type in BENCH_SLOTS:
        return "flexible"
    if slot_type not in STARTER_SLOTS:
        return "off_position"
    primary, secondary = parse_real_position(pos)
    if primary == slot_type:
        return "primary"
    if slot_type in secondary:
        return "secondary"
    if (
        player_slug in FLEXIBLE_FORWARD_SLUGS
        and primary in ("SF", "PF")
        and slot_type in ("SF", "PF")
    ):
        return "secondary"
    return "off_position"


def _position_entry(player_slug: str | None, archetype: str | None) -> tuple[str, tuple[str, ...]] | None:
    """Resolve the (primary, secondaries) tuple for a player: manual
    override first, archetype fallback second. Returns None if neither
    source has an answer (unknown archetype and no override)."""
    if player_slug and player_slug in POSITION_OVERRIDES:
        return POSITION_OVERRIDES[player_slug]
    return ARCHETYPE_POSITION_MAP.get(archetype) if archetype else None


def primary_position(player_slug: str | None, archetype: str | None = None) -> str | None:
    """The player's primary position: manual override if one exists for
    this player_slug, otherwise the v1 archetype-approximated fallback.
    None if neither source has an answer."""
    entry = _position_entry(player_slug, archetype)
    return entry[0] if entry else None


def secondary_positions(player_slug: str | None, archetype: str | None = None) -> tuple[str, ...]:
    """The player's secondary position(s): manual override if one exists
    for this player_slug, otherwise the v1 archetype-approximated
    fallback."""
    entry = _position_entry(player_slug, archetype)
    return entry[1] if entry else ()


def classify_fit(player_slug: str | None, archetype: str | None, slot_type: str) -> str:
    """Classify how well a player fits a given slot.

    Returns one of:
      "primary"      -- player's primary position matches the slot
      "secondary"     -- player's secondary position matches the slot
      "off_position"  -- neither matches (still a fully legal placement --
                          see docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md
                          Sec 6.2: soft placement, never blocked)
      "flexible"      -- the slot is a bench slot (bench_1 / bench_2 /
                          bench_3), which is never position-restricted
                          regardless of position

    Placement legality is NOT determined here -- this function is purely
    for display/fit-feedback purposes. Every slot accepts every player;
    this only tells the caller what plain-language note to show. Prefers
    the manual POSITION_OVERRIDES table over the archetype fallback -- see
    module docstring for why the fallback alone produced wrong labels for
    real centers/bigs.
    """
    if slot_type in BENCH_SLOTS:
        return "flexible"
    if slot_type not in STARTER_SLOTS:
        # Unknown slot_type -- defensive default, should not occur given
        # config.SLOT_TYPES is the only source of slot_type values.
        return "off_position"
    if primary_position(player_slug, archetype) == slot_type:
        return "primary"
    if slot_type in secondary_positions(player_slug, archetype):
        return "secondary"
    return "off_position"
