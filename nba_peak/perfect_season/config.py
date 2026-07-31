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

from nba_peak import formula_version

# Bumped whenever spin/eligibility resolution logic changes in a way that
# could change which players are offered for a given spin. v1: the board
# generator filters out any zero-candidate interim entry outright. v2
# (Phase 5X.5): entry SELECTION changed from a hard "fill with >=2-candidate
# entries first, sparse entries only as leftover filler" split to weighted
# sampling without replacement (see board.py::_select_interim_entries) --
# audited this session across many seeds and found the hard-split version
# made any franchise whose only entries were sparse (1 candidate)
# essentially invisible, even though every one of its entries was a real,
# non-fabricated, playable spin.
ELIGIBILITY_RULESET_VERSION = "perfect_season_eligibility_v2"

# Bumped whenever the interim team-season dataset changes (see
# data/game/interim/courtbuilder_team_seasons.v3.json's own dataset_version).
# v2 (Phase 5X.5): removed two dead player_slugs (michael-cooper, jaylen-brown
# -- both profile_status='excluded' at every duration, so never actually
# resolvable as candidates despite being named) and added real, in-pool
# teammates (derrick-white, al-horford, jamal-murray, brook-lopez) to the
# entries that dead weight was silently starving -- see board_coverage
# audit findings in the dataset's own coverage_note. v3 (Phase 5X.6 audit):
# added jrue-holiday to celtics-2020s -- confirmed resolvable in the pool
# (3yr/5yr) and a real 2024 champion Celtic, previously only attributed to
# bucks-2020s.
INTERIM_TEAM_DATA_VERSION = "courtbuilder_interim_teams.v3"

# Bumped whenever board generation (spin sequence assembly) changes. v2
# (Phase 5X.5): weighted-sampling entry selection, see
# ELIGIBILITY_RULESET_VERSION's comment.
BOARD_GENERATOR_VERSION = "perfect_season_board_v2"

# Bumped whenever the v0 simulator's method changes. Explicitly "v0" and
# explicitly labeled experimental everywhere it is surfaced -- this is not a
# calibrated season simulator (master plan Sec 12.8); it produces a plausible
# seeded record and an expected-wins range from lineup-fit components only.
SIMULATOR_VERSION = "perfect_season_simulator_v1"

# Bumped whenever the lineup-fit component computation OR its explanatory
# output (decisive_factors) changes. v1 removes the "too many cards share a
# primary_role" redundancy penalty entirely -- PEAK3 does not punish a
# roster for having several elite all-time peaks, only for real basketball
# constraints (bench depth, positional fit). v2 (Phase 5X.5): decisive
# factors now name the SPECIFIC off-position starter slots (e.g. "Off-
# position at SF, PF, C") instead of only a vague "several starters" note --
# the underlying fit_components math is unchanged, only the explanation
# text. See simulation.py's module docstring for the full rationale.
LINEUP_MODEL_VERSION = "perfect_season_lineup_fit_v2"

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

# ---------------------------------------------------------------------------
# Phase 6A: experimental team+YEAR (exact season) engine
# ---------------------------------------------------------------------------
# Bumped whenever data/game/experimental/player_pool_1500/courtbuilder_team_
# year.experimental.v2.json changes -- see that file's own dataset_version.
# Deliberately separate from INTERIM_TEAM_DATA_VERSION (the team+decade
# path); the two engines are independently versioned and independently
# flag-gated (COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED vs
# COURTBUILDER_TEAM_SPIN_ENABLED).
# v1 (Phase 6C): added `team_id` per entry and switched candidates to the
# team-season's full real roster. v2 (Phase 6D): computed from EVERY
# team-season in regular_1980_2026.parquet (1,310 rollable team-seasons, 40
# franchises, 1979-80..2025-26), not a hardcoded Warriors-only list -- see
# build_experimental_team_year_dataset.py. The v0/v1 files this superseded
# are both deleted; nothing at runtime reads them anymore.
EXPERIMENTAL_TEAM_YEAR_DATA_VERSION = "courtbuilder_team_year.experimental.v3"

# Surfaced verbatim in the team-year board's receipt metadata. Never
# recomputed -- OFFICIAL_WEIGHTS itself lives in peak3.py and is read only,
# never re-derived here (CLAUDE.md: never change scoring without approval).
EXPERIMENTAL_FORMULA_VERSION = formula_version.V1_DESCRIPTION

# Human-facing label for the team-year board's receipt -- coverage is
# deliberately narrow in this pass (see EXPERIMENTAL_TEAM_YEAR_DATA_VERSION's
# dataset coverage_note), so every board built by this engine says so
# explicitly rather than presenting itself as broad/official coverage.
EXPERIMENTAL_TEAM_YEAR_COVERAGE_MODE = "experimental_limited_rosters"
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
