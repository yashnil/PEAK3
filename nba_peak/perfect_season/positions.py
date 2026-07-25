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
    "brook-lopez": ("C", ("PF",)),
    "cedric-maxwell": ("PF", ()),
    "chet-holmgren": ("C", ("PF",)),
    "chris-paul": ("PG", ()),
    "david-robinson": ("C", ()),
    "dennis-rodman": ("PF", ("C",)),
    "derrick-white": ("SG", ("PG",)),
    "devin-booker": ("SG", ("PG",)),
    "giannis-antetokounmpo": ("PF", ("SF", "C")),
    "horace-grant": ("PF", ()),
    "jamal-murray": ("PG", ("SG",)),
    "james-harden": ("SG", ("PG",)),
    "james-worthy": ("SF", ()),
    "jayson-tatum": ("SF", ("PF",)),
    "joel-embiid": ("C", ("PF",)),
    "jrue-holiday": ("PG", ("SG",)),
    "kareem-abdul-jabbar": ("C", ()),
    "kevin-durant": ("SF", ("PF",)),
    "kevin-garnett": ("PF", ("C",)),
    "kevin-mchale": ("PF", ("C",)),
    "klay-thompson": ("SG", ()),
    "kobe-bryant": ("SG", ("SF",)),
    "kyrie-irving": ("PG", ("SG",)),
    "larry-bird": ("SF", ("PF",)),
    "luka-doncic": ("PG", ("SG",)),
    "lebron-james": ("SF", ("PG", "SG", "PF")),
    "magic-johnson": ("PG", ("SG",)),
    "manu-ginobili": ("SG", ("PG",)),
    "michael-jordan": ("SG", ("SF",)),
    "nikola-jokic": ("C", ()),
    "pau-gasol": ("PF", ("C",)),
    "paul-pierce": ("SF", ("SG",)),
    "rajon-rondo": ("PG", ()),
    "ray-allen": ("SG", ()),
    "robert-parish": ("C", ()),
    "ron-harper": ("SG", ("PG",)),
    "scottie-pippen": ("SF", ("SG", "PG")),
    "shai-gilgeous-alexander": ("PG", ("SG",)),
    "shaquille-oneal": ("C", ()),
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
    frozenset({"SF", "PF"}): "moderate",
    frozenset({"PG", "SF"}): "moderate",
    frozenset({"SG", "PF"}): "moderate",
    frozenset({"C", "SG"}): "severe",
    frozenset({"C", "PG"}): "severe",
    frozenset({"C", "SF"}): "severe",
}


def position_fit_severity(slot_type: str, real_primary: str | None) -> str:
    """"mild" | "moderate" | "severe" -- how big a real basketball problem an
    off-position starter placement is. Only meaningful for pairs that are
    already "off_position" per classify_fit_from_position (a primary/
    secondary match is never "off_position" in the first place, so this is
    never called to grade those). `real_primary` must be a real, parsed
    Basketball-Reference position token (see parse_real_position) -- never
    guessed or height-inferred."""
    if not real_primary or real_primary == slot_type:
        return "mild"
    return _ADJACENCY_SEVERITY.get(frozenset({slot_type, real_primary}), "severe")


def classify_fit_from_position(pos: str | None, slot_type: str) -> str:
    """classify_fit()'s counterpart for a real per-season position string
    (team-year mode) instead of a player_slug + archetype lookup. Same
    return contract: "primary" | "secondary" | "off_position" | "flexible".
    Never gates placement legality -- display/fit-feedback only, exactly
    like classify_fit()."""
    if slot_type in BENCH_SLOTS:
        return "flexible"
    if slot_type not in STARTER_SLOTS:
        return "off_position"
    primary, secondary = parse_real_position(pos)
    if primary == slot_type:
        return "primary"
    if slot_type in secondary:
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
