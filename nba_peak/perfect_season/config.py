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
# could change which players are offered for a given spin.
ELIGIBILITY_RULESET_VERSION = "perfect_season_eligibility_v0"

# Bumped whenever the interim team-season dataset changes (see
# data/game/interim/courtbuilder_team_seasons.v0.json's own dataset_version).
INTERIM_TEAM_DATA_VERSION = "courtbuilder_interim_teams.v0"

# Bumped whenever board generation (spin sequence assembly) changes.
BOARD_GENERATOR_VERSION = "perfect_season_board_v0"

# Bumped whenever the v0 simulator's method changes. Explicitly "v0" and
# explicitly labeled experimental everywhere it is surfaced -- this is not a
# calibrated season simulator (master plan Sec 12.8); it produces a plausible
# seeded record and an expected-wins range from lineup-fit components only.
SIMULATOR_VERSION = "perfect_season_simulator_v0"

# Bumped whenever the lineup-fit component computation changes.
LINEUP_MODEL_VERSION = "perfect_season_lineup_fit_v0"

SIMULATOR_EXPERIMENTAL_NOTICE = (
    "The 82-0 Peak Season simulator is an early, uncalibrated (v0) "
    "experimental model for comparing constructed historical rosters. It is "
    "not a scientific claim that a hypothetical roster would literally win "
    "a given number of NBA games, and it is not the canonical PEAK3 "
    "individual score."
)

# Court shape (master plan Sec 5.5, Sec 6.2): 5 starters + 3 bench, soft
# position assignment -- placement is never blocked by position (see
# nba_peak.perfect_season.positions.classify_fit), but slots now carry real
# position/role identity instead of being purely numbered labels
# (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 6.1). The 5 starter slots
# are position-anchored (PG/SG/SF/PF/C, v1 archetype-approximated -- see
# positions.py); the 3 bench slots are role-anchored, not position-anchored
# (sixth_man/defensive_specialist/wildcard), and accept any player.
STARTER_SLOTS = 5
BENCH_SLOTS = 3
TOTAL_ROUNDS = STARTER_SLOTS + BENCH_SLOTS  # 8

# Order matters: the first STARTER_SLOTS entries are the starters (consumed
# in this exact order by simulation.py::compute_fit_components' starters/
# bench split), followed by the BENCH_SLOTS bench entries.
SLOT_TYPES: list[str] = [
    "PG", "SG", "SF", "PF", "C",
    "sixth_man", "defensive_specialist", "wildcard",
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
