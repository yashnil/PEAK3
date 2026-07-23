"""Versioned configuration for the experimental 82-0 Peak Season / CourtBuilder model.

Phase 5C vertical slice only. See:
  docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md
  docs/architecture/PHASE_5_DATA_MODEL.md
  docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md

This module never computes or approximates the canonical PEAK3 score. It only
governs the experimental court/simulation layer on top of it (ADR-005
Decisions 3-4).
"""
from __future__ import annotations

# Bumped whenever spin/eligibility resolution logic changes in a way that
# could change which players are offered for a given spin. Bumped to v1: the
# board generator now filters out any zero-candidate interim entry outright
# and prefers entries with >=2 candidates over 1-candidate entries when
# enough exist (see board.py's entry-preference logic).
ELIGIBILITY_RULESET_VERSION = "perfect_season_eligibility_v1"

# Bumped whenever the interim team-season dataset changes (see
# data/game/interim/courtbuilder_team_seasons.v1.json's own dataset_version).
INTERIM_TEAM_DATA_VERSION = "courtbuilder_interim_teams.v1"

# Bumped whenever board generation (spin sequence assembly) changes.
BOARD_GENERATOR_VERSION = "perfect_season_board_v1"

# Bumped whenever the v0 simulator's method changes. Explicitly "v0" and
# explicitly labeled experimental everywhere it is surfaced -- this is not a
# calibrated season simulator (master plan Sec 12.8); it produces a plausible
# seeded record and an expected-wins range from lineup-fit components only.
SIMULATOR_VERSION = "perfect_season_simulator_v1"

# Bumped whenever the lineup-fit component computation changes. v1 removes
# the "too many cards share a primary_role" redundancy penalty entirely --
# PEAK3 does not punish a roster for having several elite all-time peaks,
# only for real basketball constraints (bench depth, positional fit). See
# simulation.py's module docstring for the full rationale.
LINEUP_MODEL_VERSION = "perfect_season_lineup_fit_v1"

# The 5 decades CourtBuilder's era wheel covers. Fixed by product decision
# (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md), not derived from data --
# the interim dataset aims to have at least one team-decade entry per era,
# but this list itself never shrinks or grows with data coverage.
ERA_LABELS: list[str] = ["1980s", "1990s", "2000s", "2010s", "2020s"]

# Board generation prefers interim spin entries with at least this many
# candidates (after intersecting with the current duration's card pool) over
# entries with fewer, when enough exist to fill all TOTAL_ROUNDS slots.
# Entries with 0 candidates are always excluded outright, never just
# deprioritized. See board.py::_select_interim_entries.
PREFERRED_MIN_CANDIDATES = 2

SIMULATOR_EXPERIMENTAL_NOTICE = (
    "The 82-0 Peak Season simulator is an early, uncalibrated (v0) "
    "experimental model for comparing constructed historical rosters. It is "
    "not a scientific claim that a hypothetical roster would literally win "
    "a given number of NBA games, and it is not the canonical PEAK3 "
    "individual score."
)

# Court shape (master plan Sec 5.5, Sec 6.2): 5 starters + 3 bench, soft
# position assignment -- placement is never blocked by position (see
# nba_peak.perfect_season.positions.classify_fit). The 5 starter slots are
# position-anchored (PG/SG/SF/PF/C, v1 archetype-approximated -- see
# positions.py). The 3 bench slots are deliberately plain (Bench 1/2/3, NOT
# role-flavored labels like "6th Man"/"Defensive Specialist"/"Wildcard") --
# any selected player is eligible for any bench slot, no restriction, no
# bonus condition tied to a specific archetype.
STARTER_SLOTS = 5
BENCH_SLOTS = 3
TOTAL_ROUNDS = STARTER_SLOTS + BENCH_SLOTS  # 8

# Order matters: the first STARTER_SLOTS entries are the starters (consumed
# in this exact order by simulation.py::compute_fit_components' starters/
# bench split), followed by the BENCH_SLOTS bench entries.
SLOT_TYPES: list[str] = [
    "PG", "SG", "SF", "PF", "C",
    "bench_1", "bench_2", "bench_3",
]

# Duration modes reused verbatim from nba_peak.lineup.config.SUPPORTED_MODES
# -- CourtBuilder does not introduce a second duration taxonomy.
SUPPORTED_MODES: list[str] = ["apex_1y", "prime_3y", "foundation_5y"]
MODE_TO_YEARS: dict[str, int] = {
    "apex_1y": 1,
    "prime_3y": 3,
    "foundation_5y": 5,
}

# Number of eligible-player candidates surfaced per spin round (kept small so
# the interim team dataset's narrow rosters are never padded with irrelevant
# players -- when team spins are on, the candidate list is exactly the
# interim roster for that spin, intersected with the current duration's card
# pool; when team spins are off, this many players are offered from a
# shuffled duration-filtered pool instead).
FALLBACK_CANDIDATES_PER_ROUND = 8
