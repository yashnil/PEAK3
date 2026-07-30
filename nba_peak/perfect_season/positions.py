"""Position-data strategy for CourtBuilder position-aware slots.

THREE-TIER MODEL, in priority order:

1. **Manual v0 overrides** (`POSITION_OVERRIDES` below) -- real, human-
   verified primary/secondary NBA positions for every player_slug currently
   reachable in the interim team-season dataset
   (data/game/interim/courtbuilder_team_seasons.v3.json). This is the
   source of truth whenever it has an entry.

2. **Real career position data** (`career_positions.py`, Phase 9B) -- the
   set of positions a player actually logged qualifying NBA minutes at,
   derived from committed per-season data. Outranks the archetype tier
   because it is real data rather than an approximation, and it is what
   makes a placement at a position the player genuinely played read as a
   "natural" fit instead of "off-slot". See that module's docstring for the
   full root-cause writeup of the off-slot mislabeling bug.

3. **Archetype fallback** (`ARCHETYPE_POSITION_MAP`) -- for any player with
   NEITHER an override NOR career data, derived from the existing lineup-
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

from nba_peak.perfect_season.career_positions import career_positions

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

# Possible role-fit values, for callers that want the full set.
#
# Phase 9B: "natural" replaces the never-reachable "secondary" as the live
# second tier (the player really played this position in their career -- see
# career_positions.py) and bench slots now say "bench" rather than
# "flexible", which read as a judgment about the PLAYER rather than a
# statement that the SLOT has no position restriction. "secondary" and
# "flexible" are still ACCEPTED wire values (committed saved runs carry
# them, and classify_fit's POSITION_OVERRIDES secondary tier still emits
# "secondary") -- they are just no longer part of the forward-looking set.
ROLE_FIT_VALUES = ("primary", "natural", "off_position", "bench")

# Plain-language label per (role_fit, severity) pair -- the SINGLE source of
# truth for fit wording, mirrored (not re-invented) by the frontend's
# fitLabel() in apps/web/src/types/perfect-season.ts.
#
# Why severity has to reach the label: an off-position placement graded
# "mild" costs literally 0.0 simulation points (see simulation.py::
# _OFF_POSITION_SEVERITY_POINTS), so labeling it with the same alarming
# orange "Off-slot" pill as a genuinely broken one told users the model had
# punished a placement it had in fact scored as free. Three distinct words
# for three distinct real costs (0.0 / -5.0 / -14.0).
_FIT_LABELS: dict[str, str] = {
    "primary": "Primary fit",
    "natural": "Natural fit",
    # Legacy/POSITION_OVERRIDES tier -- same meaning as "natural" to a user.
    "secondary": "Natural fit",
    "bench": "",
    "flexible": "",
}
_OFF_POSITION_LABELS: dict[str, str] = {
    "mild": "Flex fit",
    "moderate": "Role stretch",
    "severe": "Structural mismatch",
}


def fit_label(role_fit: str | None, severity: str | None = None) -> str:
    """Plain-language fit label. The one place fit wording is decided.

    An off-position placement without a known severity is labeled with the
    same conservative default the simulator uses ("severe" -- see
    simulation.py::_fit_points), never silently downgraded to the free tier.
    """
    if not role_fit:
        return ""
    if role_fit == "off_position":
        return _OFF_POSITION_LABELS.get(severity or "severe", "Structural mismatch")
    return _FIT_LABELS.get(role_fit, "")

# The five real starter-position tokens.
#
# Phase 9B correction: this table (and parse_real_position below) was
# documented as handling hyphenated multi-position Basketball-Reference
# strings ("PG-SG", "SF-PF"). VERIFIED FALSE for the committed data -- the
# `pos` column of cache/processed/regular_1980_2026.parquet contains only
# {C, F, PF, PG, SF, SG} (plus nulls), never a hyphenated value. So the
# split below always yields an EMPTY secondary tuple in practice, which is
# why classify_fit_from_position's `slot_type in secondary` branch was dead
# code and why real multi-position players read as off-slot. Real
# multi-position knowledge now comes from career_positions.py instead; the
# hyphen split is retained only as forward-compatible defense.
_REAL_POSITION_TOKENS = {"PG", "SG", "SF", "PF", "C"}


def parse_real_position(pos: str | None) -> tuple[str | None, tuple[str, ...]]:
    """Split a per-season `pos` value into (primary, secondary tuple). Reads
    the player's actual listed position for THAT exact season -- used by
    team-year mode's exact PlayerSeasonCards, which carry a real `position`
    field (nba_peak.perfect_season.exact_season.PlayerSeasonCard) instead of
    an archetype. Returns (None, ()) if unparseable.

    The returned secondary tuple is ALWAYS empty for the committed data (see
    _REAL_POSITION_TOKENS' note) -- do not rely on it to detect a
    multi-position player; use career_positions() for that."""
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
    # Phase 9B: PG<->PF was simply MISSING from this table and therefore
    # fell through to the unlisted-pair "severe" default -- which is why a
    # LeBron season listed at PG cost -14 fit points when placed at PF.
    # Listed explicitly now so today's accidental default is an intentional,
    # reviewable decision instead of an omission. Deliberately NO behavior
    # change: it resolves to exactly the "severe" the default already gave
    # (a real point guard at power forward is two full tiers apart on the
    # positional spectrum). The LeBron case is fixed the right way instead --
    # by career_positions making PF a "natural" fit for him, so severity is
    # never consulted for that placement at all.
    frozenset({"PG", "PF"}): "severe",
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
# SF<->PF swap is never "off_position" and never fit-point penalized,
# regardless of which forward slot that exact season's `pos` field lists. A
# curated, human-verified list, not a height/archetype inference -- same
# sourcing discipline as POSITION_OVERRIDES; never expand this by guessing,
# only by verifying a player's real forward flexibility.
#
# Phase 9B: consumed via career_positions.py, which unions {SF, PF} into
# these players' derived career sets -- classify_fit_from_position no longer
# special-cases the list itself. The union is REQUIRED, not redundant:
# kawhi-leonard's per-season listings derive only {SF} and julius-erving's
# only {SF, SG}, so dropping it would regress exactly the players this list
# exists to protect.
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
    (see classify_fit_severity below, used by the legacy/peak-window path).
    Either way, the token itself is never guessed or height-inferred -- it
    always comes from parse_real_position or primary_position/
    POSITION_OVERRIDES."""
    if not real_primary or real_primary == slot_type:
        return "mild"
    return _ADJACENCY_SEVERITY.get(frozenset({slot_type, real_primary}), "severe")


def classify_fit_severity(player_slug: str | None, archetype: str | None, slot_type: str) -> str | None:
    """position_fit_severity()'s counterpart for the archetype/legacy path
    (classify_fit) -- returns None when the placement isn't "off_position"
    at all (severity is only meaningful for off-position placements), else
    "mild"/"moderate"/"severe". Phase 8F: added so the legacy path can grade
    off-position severity the same way team-year mode already could, instead
    of treating every off-position placement as equally bad."""
    if classify_fit(player_slug, archetype, slot_type) != "off_position":
        return None
    return position_fit_severity(slot_type, primary_position(player_slug, archetype))


def classify_fit_from_position(pos: str | None, slot_type: str, player_slug: str | None = None) -> str:
    """classify_fit()'s counterpart for a real per-season position string
    (team-year mode) instead of a player_slug + archetype lookup. This is
    the LIVE path -- COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED is on, so
    every real CourtBuilder game is labeled by this function.

    Returns "primary" | "natural" | "off_position" | "bench". Never gates
    placement legality -- display/fit-feedback only, exactly like
    classify_fit().

    Phase 9B: `pos` is ONE season's listed position, which is an accident of
    which slot that team happened to list the player at that year. Comparing
    the slot only against that single token is what produced the reported
    "OFF-SLOT for a position they routinely played" bug (Butler's SG-listed
    seasons made SF off-slot; LeBron's PG-listed seasons made PF off-slot).
    So a slot the player really logged career minutes at (career_positions,
    derived from committed per-season data + the curated POSITION_OVERRIDES/
    FLEXIBLE_FORWARD_SLUGS supplement) is "natural", not "off_position".
    That subsumes the old FLEXIBLE_FORWARD_SLUGS SF<->PF special case, which
    is why it is gone from here -- career_positions unions those players'
    {SF, PF} in directly.

    `player_slug` stays optional for backward-compatible callers that don't
    have it handy; without it, only the exact one-season `pos` match can
    produce a non-off_position answer for a starter slot."""
    if slot_type in BENCH_SLOTS:
        return "bench"
    if slot_type not in STARTER_SLOTS:
        return "off_position"
    primary, secondary = parse_real_position(pos)
    if primary == slot_type:
        return "primary"
    if slot_type in career_positions(player_slug):
        return "natural"
    # Defensive only: parse_real_position never actually yields secondaries
    # for the committed data (its `pos` values are single tokens -- see that
    # function's own note), but a future hyphenated source would flow
    # through here rather than being silently dropped.
    if slot_type in secondary:
        return "natural"
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
      "primary"       -- player's primary position matches the slot
      "secondary"     -- a curated POSITION_OVERRIDES secondary position
                          matches the slot (kept as a distinct token so
                          already-committed saved runs keep their meaning)
      "natural"       -- the player really logged career minutes at this
                          position (career_positions.py), even though it
                          isn't their listed primary
      "off_position"  -- none of the above (still a fully legal placement --
                          see docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md
                          Sec 6.2: soft placement, never blocked)
      "bench"         -- the slot is a bench slot (bench_1 / bench_2 /
                          bench_3), which is never position-restricted
                          regardless of position

    Placement legality is NOT determined here -- this function is purely
    for display/fit-feedback purposes. Every slot accepts every player;
    this only tells the caller what plain-language note to show.

    Tier order (Phase 9B): curated POSITION_OVERRIDES first, then REAL
    career position data (career_positions), and ARCHETYPE_POSITION_MAP only
    when the career set is empty. The archetype tier used to sit second,
    which inverted two verifiable cases: classify_fit("isiah-thomas",
    "anchor", "C") returned "primary" (+10 fit points for a 6'1 point guard
    at center) and classify_fit("dwight-howard", "lead_creator", "PG")
    returned "primary" (+10 for a true center at point guard), purely
    because the lineup-archetype model classifies by offensive engine role
    rather than position (see module docstring). Real data outranks an
    archetype approximation whenever real data exists.
    """
    if slot_type in BENCH_SLOTS:
        return "bench"
    if slot_type not in STARTER_SLOTS:
        # Unknown slot_type -- defensive default, should not occur given
        # config.SLOT_TYPES is the only source of slot_type values.
        return "off_position"

    override = POSITION_OVERRIDES.get(player_slug) if player_slug else None
    if override:
        if override[0] == slot_type:
            return "primary"
        if slot_type in override[1]:
            return "secondary"

    career = career_positions(player_slug)
    if career:
        if slot_type not in career:
            return "off_position"
        # "primary" only when a second, independent source agrees this is the
        # player's lead position -- career_positions is deliberately an
        # unordered SET (it never claims to know which of a player's real
        # positions was their main one), so promoting a bare set membership
        # to "primary" would be inventing an ordering the data doesn't have.
        arch = ARCHETYPE_POSITION_MAP.get(archetype) if archetype else None
        if (override and override[0] == slot_type) or (arch and arch[0] == slot_type):
            return "primary"
        return "natural"

    if override:
        return "off_position"
    if primary_position(player_slug, archetype) == slot_type:
        return "primary"
    if slot_type in secondary_positions(player_slug, archetype):
        return "secondary"
    return "off_position"
