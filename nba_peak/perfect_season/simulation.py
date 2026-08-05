"""v0 experimental lineup-fit + season simulation for CourtBuilder.

Explicitly a labeled placeholder (config.SIMULATOR_VERSION = "...v0"-family),
not a calibrated model (master plan Sec 12.8) -- produces a plausible seeded
record and an expected-wins range from lineup-fit components derived from the
same LineupDNA fields Peak Draft's own experimental model already computes
per card (nba_peak.lineup.schemas.CardProfile.lineup_dna), never from a new
or approximated PEAK3 score (ADR-005 Decisions 3-4).

PEAK3 product philosophy, binding for every component computed here: this is
a game about PEAK VALUE. A roster is never mechanically punished just for
having a lot of elite all-time peaks -- there is no "too many stars," "role
redundancy," or "anti-GOAT" penalty anywhere in this module. If a player
legitimately drafts Magic, Jordan, Bird, Duncan, and Shaq, that roster
projects as historically dominant, full stop. The only things that move the
projection away from pure peak talent are real basketball constraints:
whether starters are placed at a position they actually played
(`positional_fit`, computed from nba_peak.perfect_season.positions), and
whether the bench carries real talent (`bench_strength`). Cross-era
combinations are never penalized for being cross-era. Uncertainty in the
projection comes from this being an uncalibrated v0 heuristic (see
SIMULATOR_EXPERIMENTAL_NOTICE), never from a hidden game-balance nerf.
"""
from __future__ import annotations

import random

from nba_peak.lineup.schemas import CardProfile
from nba_peak.perfect_season.config import (
    LINEUP_MODEL_VERSION,
    SIMULATOR_EXPERIMENTAL_NOTICE,
    SIMULATOR_VERSION,
    STARTER_SLOTS,
)
from nba_peak.perfect_season.exact_season import PlayerSeasonCard, component_percentile
from nba_peak.perfect_season.positions import (
    classify_fit,
    classify_fit_from_position,
    classify_fit_severity,
    parse_real_position,
    position_fit_severity,
    primary_position,
)
from nba_peak.perfect_season.schemas import LineupFitComponents, SimulationResult

TOTAL_GAMES = 82

# positional_fit contribution per starter, by classify_fit() outcome. Modest
# and symmetric around 0 -- this rewards/penalizes REAL position placement,
# never how many strong players are on the roster (see module docstring).
#
# Phase 8F: replaced the old flat off_position=-6.0 (every off-position
# placement penalized the same, regardless of how big a real basketball
# problem it actually was) with a severity-graded scale. Product direction:
# "normal flexible shifts should be free or nearly free... meaningful
# penalties should apply only to structurally broken basketball." A mild
# swap (SG playing SF, PF playing C) now costs nothing; a severe one (a
# small guard at center, a traditional center at guard) costs MORE than the
# old flat penalty did, since that combination genuinely breaks a lineup.
_FIT_POINTS = {"primary": 10.0, "secondary": 4.0}
_OFF_POSITION_SEVERITY_POINTS = {"mild": 0.0, "moderate": -5.0, "severe": -14.0}


def _fit_points(label: str, severity: str | None) -> float:
    if label in _FIT_POINTS:
        return _FIT_POINTS[label]
    if label == "off_position":
        return _OFF_POSITION_SEVERITY_POINTS.get(severity or "severe", -14.0)
    return 0.0  # "flexible" (bench slots) -- never scored.


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


# Phase 8 pre-loop polish: a flat average across the 5 starters let a single
# weaker starter drag talent_core down by as much as it took to credit four
# genuinely elite ones -- directly contradicting this module's own stated
# philosophy (see module docstring: peak talent should carry a roster, never
# get averaged away). These weights (highest real score first, descending,
# summing to 1.0) credit the top of the lineup more while still keeping every
# starter's real weight nonzero -- one merely-good starter is real drag, not
# zero drag, so this is recalibration, not a new "ignore weak links" rule.
_STARTER_TALENT_WEIGHTS: tuple[float, ...] = (0.30, 0.24, 0.19, 0.15, 0.12)


def _weighted_starter_talent(scores: list[float]) -> float:
    """Peak-weighted aggregate of the (up to 5) starter scores -- highest
    score gets the most credit, replacing a flat average that under-rewarded
    elite top-end talent (Phase 8 finding: a roster with three 85+ starters
    and one merely-decent one scored barely above a roster with no real
    stars at all). Falls back to a plain average if `scores` is shorter than
    the weight table (partial score coverage) by renormalizing over however
    many weights are actually used, so the result stays a true weighted mean
    rather than silently discounting the total."""
    if not scores:
        return 0.0
    ranked = sorted(scores, reverse=True)
    weights = _STARTER_TALENT_WEIGHTS[: len(ranked)]
    total_weight = sum(weights)
    if total_weight <= 0:
        return _avg(ranked)
    return sum(s * w for s, w in zip(ranked, weights)) / total_weight


def compute_fit_components(cards: list[CardProfile], slot_types: list[str]) -> LineupFitComponents:
    """Derive lineup-fit components from each card's existing LineupDNA.

    `cards` should be all 8 placed cards (starters + bench), index-aligned
    with `slot_types` (config.SLOT_TYPES order) -- starters weigh more
    heavily for talent_core, consistent with master plan Sec 6.2's
    "starters + bench" shape. `slot_types` is required to compute
    `positional_fit`, which needs to know which slot each card actually
    landed in, not just the card's own attributes.
    """
    if not cards:
        return LineupFitComponents(0, 0, 50, 0, 0, 0, 0)

    starters = cards[:STARTER_SLOTS]
    bench = cards[STARTER_SLOTS:]

    starter_talent = _weighted_starter_talent([c.individual_peak_score for c in starters])
    talent_core = starter_talent * 0.8 + _avg([c.individual_peak_score for c in bench]) * 0.2 if bench \
        else starter_talent
    bench_strength = _avg([c.individual_peak_score for c in bench])

    creation_coverage = _avg([c.lineup_dna.primary_creation for c in cards])
    scoring_coverage = _avg([c.lineup_dna.scoring_pressure for c in cards])
    postseason_pedigree = _avg([c.lineup_dna.postseason_translation for c in cards])
    team_context_depth = _avg([c.lineup_dna.team_context for c in cards])

    # Positional fit: starters only (bench is always "flexible", excluded).
    # Base 50 (neutral) + points per starter based on how their archetype
    # maps to the slot they were actually placed in -- a real board
    # constraint, never a talent-suppression mechanic.
    starter_slot_types = slot_types[:STARTER_SLOTS]
    fit_points = [
        _fit_points(
            classify_fit(card.player_slug, card.primary_role, slot),
            classify_fit_severity(card.player_slug, card.primary_role, slot),
        )
        for card, slot in zip(starters, starter_slot_types)
    ]
    positional_fit = max(0.0, min(100.0, 50.0 + sum(fit_points)))

    return LineupFitComponents(
        talent_core=round(talent_core, 2),
        bench_strength=round(bench_strength, 2),
        positional_fit=round(positional_fit, 2),
        creation_coverage=round(creation_coverage, 2),
        scoring_coverage=round(scoring_coverage, 2),
        postseason_pedigree=round(postseason_pedigree, 2),
        team_context_depth=round(team_context_depth, 2),
    )


def _off_position_starter_slots(cards: list[CardProfile], slot_types: list[str]) -> list[tuple[str, str, str]]:
    """Which starter slots are off-position for the card placed there, with
    severity and the player's real primary position -- (slot, severity,
    player_name) tuples, moderate/severe only (Phase 8F: a mild swap is a
    near-free, unremarkable placement and should never be surfaced as a
    "weakness" -- see module docstring's flexible-shift philosophy). Used
    to name specific problem positions in the result explanation instead of
    a vague "several starters" statement."""
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]
    out: list[tuple[str, str, str]] = []
    for card, slot in zip(starters, starter_slot_types):
        severity = classify_fit_severity(card.player_slug, card.primary_role, slot)
        if severity in ("moderate", "severe"):
            out.append((slot, severity, card.player_name))
    return out


# Phase 8 pre-loop polish: a starter graded 80+ on PEAK3's 0-100 all-time-
# peak scale is a genuine star-level peak season, not just "above average" --
# used to give a strong roster satisfying, specific positive feedback (see
# module docstring: the game should feel exciting to build a great team, not
# just less-punishing) instead of only ever naming what's capping the
# ceiling. Never gates the win formula itself -- display-only, exactly like
# every other decisive-factors bullet.
_ELITE_STARTER_SCORE_FLOOR = 80.0


# Phase 8F: a roster with no real shot creation anywhere is a genuine
# structural problem ("no viable creation" -- explicit product ask), not
# just a middling component score. Deliberately much stricter than
# _COMPONENT_WEAKNESS_FLOOR (50) -- this is reserved for a roster that
# truly has nobody who creates, not one that's merely below its own
# ceiling on creation.
_NO_CREATION_FLOOR = 30.0


def _decisive_factors(
    fit: LineupFitComponents,
    weak_positions: list[tuple[str, str, str]] | None = None,
    elite_starter_count: int = 0,
) -> list[str]:
    factors: list[str] = []
    # Reported first (when it applies) -- a specific, exciting statement
    # about real star power beats the more generic "Elite talent core"
    # bullet below, and the two would otherwise say almost the same thing.
    if elite_starter_count >= 3:
        factors.append(f"{elite_starter_count} starters graded as genuine all-time peaks (80+ PEAK3)")
    elif elite_starter_count == 2:
        factors.append("Two starters graded as genuine all-time peaks (80+ PEAK3)")

    if fit.talent_core >= 85:
        factors.append("Elite talent core across the roster")
    elif fit.talent_core < 55:
        factors.append("Talent core is the roster's biggest limitation")

    if fit.bench_strength >= 75:
        factors.append("Deep, capable bench")
    elif fit.bench_strength < 40:
        factors.append("Thin bench is the roster's biggest weak spot")

    # Phase 6G Part F: align "What decided this" with the same
    # team_context_depth component _weakest_component_label can name as the
    # structural weakness on team-year boards -- without this, a roster
    # whose real problem is a weak supporting cast (Reggie Miller-at-SF bug
    # report: team_context_depth 35.6) never got that mentioned here at all.
    if fit.team_context_depth >= 75:
        factors.append("Strong team context around this roster")
    elif fit.team_context_depth < 45:
        factors.append("Team-context depth is a real drag on this roster")

    # Phase 8F: severity-tiered positional-fit copy, replacing the old
    # single "Off-position at X -- a real but modest drag" bucket that
    # treated every off-position placement the same regardless of how big
    # a real basketball problem it actually was (the Moncrief-at-SG trust
    # bug: a routine guard swap read exactly the same as a genuinely broken
    # placement). Mild swaps are never surfaced here at all -- see
    # _off_position_starter_slots/_exact, which already filter to
    # moderate/severe only. "structural mismatch" is reserved for severe
    # (a small guard at center, a traditional center at guard); "role
    # stretch" is the honest, softer word for a real-but-limited moderate
    # swap (e.g. a point guard sliding to small forward).
    severe_slots = [(slot, name) for slot, sev, name in (weak_positions or []) if sev == "severe"]
    moderate_slots = [(slot, name) for slot, sev, name in (weak_positions or []) if sev == "moderate"]
    if severe_slots:
        named = ", ".join(f"{name} at {slot}" for slot, name in severe_slots)
        factors.append(f"Structural mismatch -- {named}")
    if moderate_slots:
        named = ", ".join(f"{name} at {slot}" for slot, name in moderate_slots)
        factors.append(f"Role stretch -- {named}, a real but modest drag")
    if not weak_positions and fit.positional_fit >= 70:
        factors.append("Starters are placed at flexible, natural positions")

    if fit.creation_coverage < _NO_CREATION_FLOOR:
        factors.append("No viable primary creation on this roster")

    if fit.postseason_pedigree >= 75:
        factors.append("Deep postseason pedigree")

    if not factors:
        factors.append("A balanced, unremarkable lineup profile")

    return factors[:3]


def simulate_season(cards: list[CardProfile], board_seed: int, slot_types: list[str]) -> SimulationResult:
    """Run the v0 simulation for a completed 8-card lineup.

    Deterministic given the same cards + board_seed (never re-randomized on
    replay), consistent with "official results must be reproducible"
    (bridge doc Sec 8). Card identities (peak_window_ids) feed the RNG seed so
    two different lineups on the same board_seed do not collide.
    """
    fit = compute_fit_components(cards, slot_types)
    weak_positions = _off_position_starter_slots(cards, slot_types)
    elite_starters = sum(
        1 for c in cards[:STARTER_SLOTS] if c.individual_peak_score >= _ELITE_STARTER_SCORE_FLOOR
    )

    # expected_wins: talent-dominated, matching the experimental lineup
    # model's own "talent dominates" hypothesis (nba_peak/lineup/config.py).
    # Peak talent (talent_core, bench_strength) carries the large majority of
    # the weight; positional_fit and the DNA-coverage components are small,
    # honest nudges tied to real constraints -- never a redundancy/anti-star
    # penalty (see this module's docstring). Purely a v0 heuristic -- not
    # calibrated against real historical win distributions (master plan
    # Sec 12.8).
    base = 41.0 + (fit.talent_core - 50.0) * 1.0
    base += (fit.bench_strength - 50.0) * 0.12
    base += (fit.positional_fit - 50.0) * 0.08
    base += (fit.creation_coverage - 50.0) * 0.05
    base += (fit.scoring_coverage - 50.0) * 0.05
    base += (fit.postseason_pedigree - 50.0) * 0.05
    # Phase 8F: this path (career-peak-window mode: apex_1y/prime_3y/
    # foundation_5y) is what COURTBUILDER ACTUALLY RUNS BY DEFAULT --
    # COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED defaults off, so nearly
    # every real game reaches simulate_season, not simulate_exact_season.
    # The three-tier win-floor system (catastrophe/normal/generational) was
    # added to simulate_exact_season in Phase 8C/8D but never ported here --
    # verified empirically that a generational-caliber peak-window roster
    # (peak Curry/Jordan/LeBron/Garnett/Jokic + a merely-solid bench)
    # already lands 80-82 under the plain linear formula with no floor at
    # all, exactly like the exact-season path's own "already works with a
    # decent bench" finding -- so this closes the same worst-case gap
    # (weak/unscored bench, or a merely-good base) the exact-season floor
    # closes, for parity across both paths.
    is_catastrophe = _is_catastrophe_roster_legacy(cards, fit)
    is_generational = _is_generational_core_legacy(cards)
    if is_catastrophe:
        wins_floor = _CATASTROPHE_WINS_FLOOR
    elif is_generational:
        wins_floor = _GENERATIONAL_ELITE_WINS_FLOOR
    else:
        wins_floor = _NORMAL_BAD_WINS_FLOOR
    expected_wins = max(wins_floor, min(82.0, base))

    card_key = ",".join(sorted(c.peak_window_id for c in cards))
    rng = random.Random(f"{board_seed}:{card_key}")
    noise_range = _GENERATIONAL_NOISE_RANGE if is_generational else _NORMAL_NOISE_RANGE
    noise = rng.uniform(-noise_range, noise_range)
    wins = int(round(max(_MIN_FINAL_WINS, min(82.0, expected_wins + noise))))
    losses = TOTAL_GAMES - wins

    expected_low = max(0.0, expected_wins - 5.0)
    expected_high = min(82.0, expected_wins + 5.0)

    # PEAK3 Lineup Score (Phase 6A Goal 9): the durable, comparable score --
    # unlike the 82-0 record (which has RNG noise baked in via `rng.uniform`
    # above and is capped at a fixed 82-game season), this is a direct mean
    # of the 8 placed cards' own real, canonical `individual_peak_score`
    # values (already 0-100 calibrated PEAK3 scores -- see
    # CardProfile.individual_peak_score). No new scoring logic: an average
    # of numbers PEAK3 already computed, never recomputed or approximated
    # here (CLAUDE.md: never calculate PEAK3 scores in this layer).
    lineup_peak_score = round(sum(c.individual_peak_score for c in cards) / len(cards), 1)

    # Phase 8H: give the legacy career-peak-window path the same explanation
    # depth the exact-season path already had -- best_pick/structural_weakness/
    # weakness_framing were never computed here before, even though
    # _decisive_factors (the positive side) was always shared.
    weakness_text, weakness_detail = _structural_weakness(cards, slot_types, fit, wins)

    return SimulationResult(
        lineup_model_version=LINEUP_MODEL_VERSION,
        simulator_version=SIMULATOR_VERSION,
        fit_components=fit,
        wins=wins,
        losses=losses,
        expected_wins=round(expected_wins, 1),
        expected_wins_low=round(expected_low, 1),
        expected_wins_high=round(expected_high, 1),
        decisive_factors=_decisive_factors(fit, weak_positions, elite_starters),
        is_perfect_season=(wins >= 82),
        experimental_notice=SIMULATOR_EXPERIMENTAL_NOTICE,
        lineup_peak_score=lineup_peak_score,
        best_pick=_best_pick(cards),
        structural_weakness=weakness_text,
        structural_weakness_detail=weakness_detail,
        weakness_framing=_weakness_framing(wins),
    )


# ---------------------------------------------------------------------------
# Team-year (exact-season) simulation path
#
# Parallel to the PeakWindowCard path above, operating on
# exact_season.PlayerSeasonCard instead of CardProfile. `season_score` is the
# same real, official PEAK3 prime_score used everywhere else -- never
# recomputed or approximated here. A card's LineupDNA equivalent is not
# available at the single-season grain (card_profiles.v3.json's DNA is
# calibrated at the career-peak-WINDOW grain), so the "coverage" sub-
# components use component_percentile() -- a real percentile rank of the
# player-season's own official per-season component contribution against the
# full scored_1980_2026.parquet distribution. Different method from the
# calibrated card-pool DNA scale, honestly labeled as such (never presented
# as the same number).
# ---------------------------------------------------------------------------

EXACT_SEASON_SIMULATOR_NOTICE = (
    SIMULATOR_EXPERIMENTAL_NOTICE
    + " Team-year (exact-season) lineups use each player's real, single-season "
    "PEAK3 score -- never a career-peak substitute. If any selected card's "
    "exact-season score is unavailable (below the model's minutes threshold "
    "for that season), the PEAK3 Lineup Score is reported as unavailable "
    "rather than approximated. The projected record, however, still accounts "
    "for that card using a conservative provisional impact based on its real "
    "games/minutes sample -- never a neutral placeholder."
)

# ---------------------------------------------------------------------------
# Phase 8K: provisional simulation impact for unscored exact-season cards.
#
# Root cause fixed here: compute_exact_fit_components used to build
# talent_core/bench_strength from ONLY the cards with a real season_score --
# an unscored card (score_status == "exact_season_unscored") simply dropped
# out of the average entirely, contributing neither positive nor negative
# weight. That is silent neutrality, not honesty: a 6-game, 0-start roster-
# only card (Chuck Nevitt 1982-83 HOU) was mathematically indistinguishable
# from "this slot doesn't exist" -- it never dragged talent_core down at all,
# so a lineup with 3 real starters missing an official score could still
# read as a fringe-playoff team even though nearly half the starting five
# has no demonstrated real NBA-caliber production this season.
#
# Fix: every unscored card still gets a PROVISIONAL impact value (0-100,
# same scale as season_score) derived from the real sample-size context PEAK3
# already has for that card -- games_played, minutes_per_game, games_started
# -- never a fabricated official score, and never used for lineup_peak_score
# or anything the UI presents as "the PEAK3 score". It exists ONLY to keep
# the projected win total honest. `score_status` stays exactly what it was
# ("exact_season_unscored") and the UI's "Score incomplete" messaging is
# untouched -- this only changes what the SIMULATION does with the card.
#
# Tiers, from real sample size (never from era, team, or any score-adjacent
# signal -- the whole point is these cards have NO real score to lean on):
#   near_replacement    -- tiny games-played sample (<15 games) or very low
#                           minutes (<12 mpg), OR a token 0-start appearance
#                           in under 10 games. A real NBA roster spot, but
#                           one that never showed rotation-level production.
#                           (Chuck Nevitt 1982-83: 6 games, 0 starts, 10.7
#                           mpg -- exactly this case.)
#   low_minute          -- a real bench/rotation-fringe sample (>=15 games)
#                           but under 20 mpg. (Jalen Smith 2021-22 PHO: 29
#                           games, 13.2 mpg.)
#   meaningful_rotation -- >=20 mpg across a real sample. A genuine rotation
#                           player who happens to be unscored this season
#                           (below the model's minutes threshold in
#                           aggregate, a data-coverage gap, not a talent
#                           judgment) -- conservative, but never near-zero.
#                           (Kemba Walker 2021-22 NYK: 37 games, 25.6 mpg.)
#   unknown_sample      -- games_played/minutes_per_game themselves are
#                           unavailable (should not occur for a resolvable
#                           card, but stays defensive). A flat, conservative
#                           mid-low value -- never assumed replacement-level
#                           on literally no information.
# ---------------------------------------------------------------------------

_PROVISIONAL_TINY_SAMPLE_GAMES = 15.0
_PROVISIONAL_TINY_SAMPLE_MPG = 12.0
_PROVISIONAL_ZERO_START_TINY_GAMES = 10.0
_PROVISIONAL_LOW_MINUTE_MPG = 20.0

_PROVISIONAL_NEAR_REPLACEMENT_IMPACT = 6.0
_PROVISIONAL_LOW_MINUTE_IMPACT = 16.0
_PROVISIONAL_MEANINGFUL_ROTATION_IMPACT = 30.0
_PROVISIONAL_UNKNOWN_SAMPLE_IMPACT = 22.0


def _provisional_impact_tier(card: PlayerSeasonCard) -> str:
    """Which provisional-impact tier an unscored card falls into -- see the
    module comment above for the full rationale. Callers should only call
    this for a card whose season_score is already None; harmless (but
    meaningless) to call otherwise."""
    gp = card.games_played
    mpg = card.minutes_per_game
    if gp is None or mpg is None:
        return "unknown_sample"
    zero_start_tiny = card.games_started == 0 and gp < _PROVISIONAL_ZERO_START_TINY_GAMES
    if zero_start_tiny or gp < _PROVISIONAL_TINY_SAMPLE_GAMES or mpg < _PROVISIONAL_TINY_SAMPLE_MPG:
        return "near_replacement"
    if mpg < _PROVISIONAL_LOW_MINUTE_MPG:
        return "low_minute"
    return "meaningful_rotation"


_PROVISIONAL_TIER_IMPACT = {
    "near_replacement": _PROVISIONAL_NEAR_REPLACEMENT_IMPACT,
    "low_minute": _PROVISIONAL_LOW_MINUTE_IMPACT,
    "meaningful_rotation": _PROVISIONAL_MEANINGFUL_ROTATION_IMPACT,
    "unknown_sample": _PROVISIONAL_UNKNOWN_SAMPLE_IMPACT,
}


def provisional_unscored_impact(card: PlayerSeasonCard) -> float:
    """Conservative 0-100 PROVISIONAL simulation impact for a card with no
    official PEAK3 score -- never the official score itself, never surfaced
    as `season_score`/`lineup_peak_score`, used only inside the win-
    projection math below (talent_core/bench_strength) so an unscored card
    behaves like the real, if modest, roster-only or low-minute NBA season
    it actually is instead of silently dropping out of the average."""
    return _PROVISIONAL_TIER_IMPACT[_provisional_impact_tier(card)]


def _simulation_impact_scores(group: list[PlayerSeasonCard]) -> list[float]:
    """Like the old `_scored_scores` this replaces, but every card
    contributes -- a real season_score if one exists, else a conservative
    provisional_unscored_impact() derived from that card's own real games/
    minutes sample. Never silently excludes an unscored card from the
    average (see the Phase 8K module comment above for why that was the
    root cause of unscored/low-minute cards reading as neutral rather than
    the real drag they are)."""
    return [c.season_score if c.season_score is not None else provisional_unscored_impact(c) for c in group]


# Same tiers as _PROVISIONAL_TIER_IMPACT, translated to a 0-100 PERCENTILE
# (creation_coverage/scoring_coverage/postseason_pedigree/team_context_depth
# are percentile ranks, not raw scores -- see component_percentile). Without
# this, component_percentile() returns None for every unscored card and
# _avg_percentile below would exclude it exactly the same way talent_core
# used to -- verified empirically to matter: a lineup with 3 real, badly-
# scored starters (each with a genuinely low creation/scoring percentile)
# could otherwise look BETTER on these components than a lineup with 3
# unscored tiny-sample starters, since the scored-but-bad players' real low
# percentiles get averaged in while the unscored ones simply vanished from
# the average. That's backwards -- an unscored tiny-sample card has no
# demonstrated creation/scoring/postseason value either, and should never
# get a free pass on these components just because it lacks a score.
_PROVISIONAL_TIER_PERCENTILE = {
    "near_replacement": 8.0,
    "low_minute": 22.0,
    "meaningful_rotation": 38.0,
    "unknown_sample": 28.0,
}


def provisional_unscored_percentile(card: PlayerSeasonCard) -> float:
    """Conservative 0-100 provisional PERCENTILE for an unscored card's
    creation/scoring/postseason/team-context contribution -- same tiering
    as provisional_unscored_impact, expressed on the percentile scale
    component_percentile() itself uses. Never the real percentile (which
    doesn't exist for an unscored card), never fabricated as though it
    were measured -- purely a conservative simulation-only stand-in."""
    return _PROVISIONAL_TIER_PERCENTILE[_provisional_impact_tier(card)]


def compute_exact_fit_components(cards: list[PlayerSeasonCard], slot_types: list[str]) -> LineupFitComponents:
    if not cards:
        return LineupFitComponents(0, 0, 50, 0, 0, 0, 0)

    starters = cards[:STARTER_SLOTS]
    bench = cards[STARTER_SLOTS:]

    # Phase 8K: every starter/bench card contributes to talent_core/
    # bench_strength -- an unscored card is never silently excluded, it
    # gets a conservative provisional impact instead (see
    # _simulation_impact_scores/provisional_unscored_impact above).
    starter_scores = _simulation_impact_scores(starters)
    bench_scores = _simulation_impact_scores(bench)
    starter_talent = _weighted_starter_talent(starter_scores)
    talent_core = (starter_talent * 0.8 + _avg(bench_scores) * 0.2) if bench_scores else starter_talent
    bench_strength = _avg(bench_scores)

    # Phase 8K: an unscored card contributes a conservative provisional
    # percentile here too -- see provisional_unscored_percentile above --
    # instead of vanishing from the average the way a real, if badly-
    # scored, card never does.
    def _avg_percentile(column: str) -> float:
        values = []
        for c in cards:
            p = component_percentile(c.player_slug, c.team_id, c.season, column) if c.season_score is not None else None
            values.append(p if p is not None else provisional_unscored_percentile(c))
        return _avg(values)

    creation_coverage = _avg_percentile("contrib_statistical_impact")
    scoring_coverage = _avg_percentile("contrib_traditional_production")
    postseason_pedigree = _avg_percentile("contrib_postseason")
    team_context_depth = _avg_percentile("contrib_team_achievement")

    starter_slot_types = slot_types[:STARTER_SLOTS]
    fit_points = [
        _fit_points(
            classify_fit_from_position(card.position, slot, card.player_slug),
            position_fit_severity(slot, parse_real_position(card.position)[0]),
        )
        for card, slot in zip(starters, starter_slot_types)
    ]
    positional_fit = max(0.0, min(100.0, 50.0 + sum(fit_points)))

    return LineupFitComponents(
        talent_core=round(talent_core, 2),
        bench_strength=round(bench_strength, 2),
        positional_fit=round(positional_fit, 2),
        creation_coverage=round(creation_coverage, 2),
        scoring_coverage=round(scoring_coverage, 2),
        postseason_pedigree=round(postseason_pedigree, 2),
        team_context_depth=round(team_context_depth, 2),
    )


def _off_position_starter_slots_exact(cards: list[PlayerSeasonCard], slot_types: list[str]) -> list[tuple[str, str, str]]:
    """Exact-season counterpart to _off_position_starter_slots -- see its
    docstring. (slot, severity, player_name) tuples, moderate/severe only."""
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]
    out: list[tuple[str, str, str]] = []
    for card, slot in zip(starters, starter_slot_types):
        if classify_fit_from_position(card.position, slot, card.player_slug) != "off_position":
            continue
        real_primary, _ = parse_real_position(card.position)
        severity = position_fit_severity(slot, real_primary)
        if severity in ("moderate", "severe"):
            out.append((slot, severity, card.player_name))
    return out


# ---------------------------------------------------------------------------
# Phase 6F Part F: structural result explanation.
#
# Root cause of the "Weakness: Rasheed Wallace" bug this fixes: the OLD
# explanation picked whichever placed card had the lowest real score, full
# stop -- on a roster of 8 legends, SOMEONE has the lowest score even though
# every player is elite, so it randomly blamed a strong player instead of
# describing the actual problem (off-position starters, no true wing, thin
# bench). These functions prioritize STRUCTURE over raw score rank, and
# when a specific player IS named, always with slot/role context (never a
# bare name).
# ---------------------------------------------------------------------------

def _best_pick_exact(cards: list[PlayerSeasonCard]) -> str | None:
    """Highest real exact-season score among placed cards -- unlike
    "weakness", picking the single best real contributor by score is not a
    fit problem, so this stays score-based."""
    scored = [c for c in cards if c.season_score is not None]
    if not scored:
        return None
    best = max(scored, key=lambda c: c.season_score)
    return best.player_name


def _best_pick(cards: list[CardProfile]) -> str | None:
    """CardProfile (career-peak-window) counterpart of _best_pick_exact --
    every CardProfile reaching the simulator is already scored (no
    "unscored" state at this grain), so this never has an empty-scored
    edge case, but stays defensive for consistency."""
    if not cards:
        return None
    best = max(cards, key=lambda c: c.individual_peak_score)
    return best.player_name


# Phase 7A Part F: "Weakness" implies something is wrong with the roster;
# at contender/dynasty win totals (mirrors the frontend's own resultTier()
# bands in SeasonResultStub.tsx -- Contender starts at 65 wins), nothing
# about the roster IS wrong -- structural_weakness at that tier describes
# what's capping the ceiling below 82, not a fault. Below that (rebuild/
# mid-pack), "Weakness" is the honest word.
_CEILING_LIMITER_WINS_FLOOR = 65


def _weakness_framing(wins: int) -> str:
    return "ceiling_limiter" if wins >= _CEILING_LIMITER_WINS_FLOOR else "weakness"


# Phase 6G Part A: human-readable labels for the six lineup-fit components,
# used only when that component is the actual driver of a weak roster (see
# _weakest_component_key). Never phrased as a player name -- these are
# always roster-level statements.
_COMPONENT_LABELS = {
    "talent_core": "low talent core",
    "bench_strength": "thin bench depth",
    "team_context_depth": "low team-context depth",
    "creation_coverage": "limited shot-creation coverage",
    "scoring_coverage": "limited scoring coverage",
    "postseason_pedigree": "thin postseason pedigree",
}
# Phase 8 pre-loop polish: one-sentence plain-English explainers, shown as
# `structural_weakness_detail` alongside the short label above. Root cause
# this fixes: "Ceiling limiter: thin bench depth" reads as a real basketball
# insult (Granger/Lowry/English are not weak NBA players) when what the
# model actually means is "these three score lower than the starters on
# PEAK3's 0-100 all-time-peak scale" -- a relative, in-scale statement, not
# an absolute one. Every label gets a detail sentence so the UI never has to
# guess which one needs clarifying.
_COMPONENT_EXPLAINERS: dict[str, str] = {
    "talent_core": (
        "Your starters' real season scores, weighted toward the top of the lineup, still average "
        "out below this roster's own ceiling on PEAK3's 0-100 all-time-peak scale."
    ),
    "bench_strength": (
        "PEAK3 grades the bench on the same 0-100 all-time-peak scale as the starters -- a bench "
        "in the 40s-50s is a normal, solid real-season bench, not a weak one. It just isn't at the "
        "same all-time-peak tier as this lineup's elite starters."
    ),
    "team_context_depth": (
        "How much these exact seasons' real teams leaned on shared team success rather than one "
        "player's individual production."
    ),
    "creation_coverage": (
        "How much of this roster's shot creation, across all 8 selected seasons, came from a real, "
        "elite-level offensive engine."
    ),
    "scoring_coverage": (
        "How much of this roster's scoring volume, across all 8 selected seasons, was carried by "
        "real, elite-level scorers."
    ),
    "postseason_pedigree": "How deep these exact seasons' real playoff track records run.",
}
# A component only becomes "the weakness" once it's meaningfully below
# neutral (50) -- otherwise a perfectly fine roster's slightly-below-average
# component would get needlessly called out.
_COMPONENT_WEAKNESS_FLOOR = 50.0


def _weakest_component_key(
    fit: LineupFitComponents, *, require_below_floor: bool = True, min_gap_below_others: float = 0.0
) -> str | None:
    """The single lowest of the six major fit components, as its raw key
    (e.g. "bench_strength") -- see _COMPONENT_LABELS/_COMPONENT_EXPLAINERS
    for the display strings. By default only returned if it's actually low
    (below _COMPONENT_WEAKNESS_FLOOR), never just "whichever is smallest" on
    an otherwise-strong roster. positional_fit is intentionally excluded
    here: it's graded separately (as named off-position starters), not
    folded into this generic component check.

    `require_below_floor=False` (used for the ceiling_limiter tier -- see
    _structural_weakness_exact) drops the floor: on a contender/dynasty
    roster nothing is genuinely "wrong", but the relatively-weakest
    component is still the honest answer to "what's capping the ceiling
    below 82", which is a more useful explanation than naming a bare
    player as "the weakness".

    `min_gap_below_others` (Phase 8, also ceiling_limiter-tier only): when
    the single weakest component isn't actually distinguishable from the
    rest -- e.g. a well-rounded elite roster where every component sits
    within a couple points of each other -- singling one out as "the
    ceiling limiter" overstates a trivial gap as a real finding. Returns
    None in that case so the caller falls through to the generic "not
    every star is in their peak season" explanation instead."""
    values = {
        "talent_core": fit.talent_core,
        "bench_strength": fit.bench_strength,
        "team_context_depth": fit.team_context_depth,
        "creation_coverage": fit.creation_coverage,
        "scoring_coverage": fit.scoring_coverage,
        "postseason_pedigree": fit.postseason_pedigree,
    }
    worst_key = min(values, key=lambda k: values[k])
    worst_val = values[worst_key]
    if require_below_floor and worst_val >= _COMPONENT_WEAKNESS_FLOOR:
        return None
    if min_gap_below_others > 0:
        second_lowest = min(v for k, v in values.items() if k != worst_key)
        if second_lowest - worst_val < min_gap_below_others:
            return None
    return worst_key


# Per-slot phrasing for a SEVERE off-position starter -- framed as a missing
# position GROUP (e.g. "no true wing") rather than just naming the player,
# since a severe mismatch (a true center at SF, a guard at center) means
# that slot has no real coverage at all, not just an imperfect one. Keyed by
# slot_type; the fixed 5-slot starting lineup (STARTER_SLOTS) means each
# slot has exactly one occupant, so "no true wing" and "the SF starter is
# severely off-position" are the same fact here -- the severe-only framing
# just states it as the bigger structural problem it actually is.
_SEVERE_SLOT_LABEL = {
    "PG": "no real point guard",
    "SG": "no real shooting guard",
    "SF": "no true wing",
    "PF": "no real power forward",
    "C": "no interior anchor",
}


_CEILING_LIMITER_GENERIC_DETAIL = (
    "Every fit component here is healthy -- the only thing capping the ceiling is that these are "
    "real single-season snapshots, not a hand-picked all-time-peak roster."
)


def _structural_weakness_exact(
    cards: list[PlayerSeasonCard], slot_types: list[str], fit: LineupFitComponents, wins: int
) -> tuple[str | None, str | None]:
    """Prioritized structural weakness description, plus a one-sentence
    plain-English `detail` explaining it (Phase 8 pre-loop polish -- root
    cause: a short label like "thin bench depth" reads as a real basketball
    insult on its own; the detail sentence clarifies it's a relative
    statement on PEAK3's 0-100 all-time-peak scale, not an absolute one).
    Returns (text, detail) -- detail is None only where the text is already
    fully self-explanatory (a named off-position starter, a data-coverage
    gap, or the below-contender-tier bare-name fallback).

    Order (Phase 6G Part A rewrite -- fixes the "Weakness: Reggie Miller at
    SF" bug, where a mild, entirely plausible SG-at-SF swap outranked a 42.6
    talent core / 35.6 team-context depth just because it was *an*
    off-position starter, with no regard for how big a real basketball
    problem it actually was):
      1. Multiple unscored cards -> score-coverage problem (a real data
         gap, not a talent/fit judgment).
      2. Severe off-position starter(s) (position_fit_severity, e.g. a true
         center at guard/SF, a guard at center) -- framed as a missing
         position GROUP ("no true wing"), since a severe mismatch means
         that slot has no real coverage, which is worse than any single
         merely-imperfect placement.
      3. Moderate off-position starter(s) -- named specifically with slot +
         real position (a real but secondary concern, e.g. a small forward
         playing power forward).
      4. The single weakest major fit component (talent_core/bench_strength/
         team_context_depth/creation_coverage/scoring_coverage/
         postseason_pedigree). On a contender/dynasty roster (wins >=
         _CEILING_LIMITER_WINS_FLOOR) this is always reported (no floor --
         see _weakest_component_key) since nothing needs to be "wrong"
         for it to be the honest answer to "what's capping the ceiling
         below 82". Below that tier, only reported if meaningfully below
         neutral -- a genuinely weak supporting cast is a bigger problem
         than a defensible mild positional swap, but a slight dip on an
         otherwise fine roster isn't worth naming.
      5. Mild off-position starter(s) -- reached only once nothing larger
         applies (a 6'7 SG at SF is a real but small drag, not the fatal
         flaw -- see position_fit_severity's adjacency table).
      6. Fallback: on a contender/dynasty roster, a generic "not every
         star is in their absolute peak season" note (every component is
         healthy and no positional issue exists -- the only thing left
         capping the ceiling is that this is a real-season roster, not a
         hand-picked all-time-peak one). Below that tier, the lowest-
         scored placed card (score rank alone is a fair "weakness" only
         when the roster is otherwise structurally sound).
    """
    if not cards:
        return None, None
    is_ceiling_limiter = wins >= _CEILING_LIMITER_WINS_FLOOR
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]

    unscored = [c for c in cards if c.score_status != "exact_season_scored"]
    if len(unscored) >= 2:
        detail_parts = [
            "Projected record uses conservative provisional impact for unscored cards, based on each "
            "card's real games/minutes sample -- it is not ignored and not treated as a neutral value."
        ]
        # Phase 8K: name any unscored STARTER whose real sample is so small
        # (tiny games-played/minutes, or a token 0-start appearance) that it
        # reads as roster-only depth rather than a real rotation player --
        # e.g. Chuck Nevitt's 6-game, 0-start 1982-83 HOU season. Bench-only
        # tiny-sample cards are already covered by the general sentence
        # above; a tiny-sample STARTER is the specific, surprising case
        # worth calling out by name. Also names a SEVERE position mismatch
        # among the starters here (even a scored one) -- an unscored-card
        # data gap and a structural position mismatch are independent real
        # problems that can both apply to the same roster (Kemba Walker at
        # C: a real-but-mediocre exact season AND a severe position
        # mismatch), and both deserve to surface, not just whichever one
        # this cascade's own priority order would otherwise pick alone.
        for card, slot in zip(starters, starter_slot_types):
            if card.score_status != "exact_season_scored" and _provisional_impact_tier(card) == "near_replacement":
                sample_note = f"{int(card.games_played)}-game" if card.games_played is not None else "tiny-sample"
                detail_parts.append(
                    f"{card.player_name}'s {sample_note} season is treated as roster-only depth, "
                    "not a rotation-level starter."
                )
            real_primary, _ = parse_real_position(card.position)
            if (
                classify_fit_from_position(card.position, slot, card.player_slug) == "off_position"
                and position_fit_severity(slot, real_primary) == "severe"
            ):
                detail_parts.append(f"{card.player_name} at {slot} creates a major structural mismatch.")
        return f"{len(unscored)} cards with no PEAK3 score yet -- lineup score is incomplete", " ".join(detail_parts)

    # (player_name, slot, real_primary_position, severity)
    off_position: list[tuple[str, str, str | None, str]] = []
    for card, slot in zip(starters, starter_slot_types):
        primary, _ = parse_real_position(card.position)
        if classify_fit_from_position(card.position, slot, card.player_slug) == "off_position":
            off_position.append((card.player_name, slot, primary, position_fit_severity(slot, primary)))

    severe = [o for o in off_position if o[3] == "severe"]
    if len(severe) == 1:
        name, slot, real_pos, _sev = severe[0]
        pos_note = f" -- {name}'s real position is {real_pos}" if real_pos else f" -- {name} is not a real {slot}"
        return f"{_SEVERE_SLOT_LABEL.get(slot, f'no real {slot}')}{pos_note}", None
    if len(severe) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in severe)
        return f"Position-broken starting five -- {names_joined}", None

    moderate = [o for o in off_position if o[3] == "moderate"]
    if len(moderate) == 1:
        name, slot, real_pos, _sev = moderate[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"Role stretch -- {name} at {slot}{pos_note}", None
    if len(moderate) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in moderate)
        return f"Role stretch across the starting five -- {names_joined}", None

    weakest_key = _weakest_component_key(
        fit, require_below_floor=not is_ceiling_limiter, min_gap_below_others=6.0 if is_ceiling_limiter else 0.0
    )
    if weakest_key:
        return _COMPONENT_LABELS[weakest_key], _COMPONENT_EXPLAINERS.get(weakest_key)

    # Phase 7A Part F follow-up: "mild" is, by construction (see
    # position_fit_severity's adjacency table), a routine and defensible
    # placement -- e.g. a small forward playing power forward. Never phrase
    # this as "Position-broken", which implies a real structural problem;
    # that framing is reserved for the severe/moderate branches above.
    mild = [o for o in off_position if o[3] == "mild"]
    if len(mild) == 1:
        name, slot, real_pos, _sev = mild[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"Minor role stretch -- {name} at {slot}{pos_note}", None
    if len(mild) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in mild)
        return f"Flexible alignment -- {names_joined}", None

    if is_ceiling_limiter:
        return "not every star is in their peak season", _CEILING_LIMITER_GENERIC_DETAIL

    scored = [c for c in cards if c.season_score is not None]
    if scored:
        worst = min(scored, key=lambda c: c.season_score)
        return worst.player_name, None
    return None, None


def _structural_weakness(
    cards: list[CardProfile], slot_types: list[str], fit: LineupFitComponents, wins: int
) -> tuple[str | None, str | None]:
    """CardProfile (career-peak-window) counterpart of _structural_weakness_exact
    -- same prioritized severe/moderate/weakest-component/mild/fallback
    cascade, adapted for archetype-based fit (classify_fit/
    classify_fit_severity/primary_position) instead of real per-season
    position data. Phase 8H: this path (simulate_season, what CourtBuilder
    runs when the legacy engine is explicitly selected) never had this
    explanation depth at all before -- only simulate_exact_season did,
    even though _decisive_factors (the positive-side explanation) was
    always shared between both paths. No unscored-card check here (every
    CardProfile reaching the simulator is already scored -- no
    "score_status" concept at this grain)."""
    if not cards:
        return None, None
    is_ceiling_limiter = wins >= _CEILING_LIMITER_WINS_FLOOR
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]

    off_position: list[tuple[str, str, str | None, str]] = []
    for card, slot in zip(starters, starter_slot_types):
        severity = classify_fit_severity(card.player_slug, card.primary_role, slot)
        if severity is not None:
            real_pos = primary_position(card.player_slug, card.primary_role)
            off_position.append((card.player_name, slot, real_pos, severity))

    severe = [o for o in off_position if o[3] == "severe"]
    if len(severe) == 1:
        name, slot, real_pos, _sev = severe[0]
        pos_note = f" -- {name}'s real position is {real_pos}" if real_pos else f" -- {name} is not a real {slot}"
        return f"{_SEVERE_SLOT_LABEL.get(slot, f'no real {slot}')}{pos_note}", None
    if len(severe) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in severe)
        return f"Position-broken starting five -- {names_joined}", None

    moderate = [o for o in off_position if o[3] == "moderate"]
    if len(moderate) == 1:
        name, slot, real_pos, _sev = moderate[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"Role stretch -- {name} at {slot}{pos_note}", None
    if len(moderate) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in moderate)
        return f"Role stretch across the starting five -- {names_joined}", None

    weakest_key = _weakest_component_key(
        fit, require_below_floor=not is_ceiling_limiter, min_gap_below_others=6.0 if is_ceiling_limiter else 0.0
    )
    if weakest_key:
        return _COMPONENT_LABELS[weakest_key], _COMPONENT_EXPLAINERS.get(weakest_key)

    mild = [o for o in off_position if o[3] == "mild"]
    if len(mild) == 1:
        name, slot, real_pos, _sev = mild[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"Minor role stretch -- {name} at {slot}{pos_note}", None
    if len(mild) >= 2:
        names_joined = ", ".join(f"{name} at {slot}" for name, slot, _, _ in mild)
        return f"Flexible alignment -- {names_joined}", None

    if is_ceiling_limiter:
        return "not every star is in their peak season", _CEILING_LIMITER_GENERIC_DETAIL

    if cards:
        worst = min(cards, key=lambda c: c.individual_peak_score)
        return worst.player_name, None
    return None, None


# ---------------------------------------------------------------------------
# Phase 8C: conditional catastrophe win floor.
#
# Root cause of the reported "13-69" result: expected_wins had a FLAT 15.0
# floor applied before noise, but the final noisy `wins` was only clamped to
# [0, 82] -- so a merely-bad roster (expected_wins pinned at the 15 floor)
# could still get unlucky and land at 13. That's an accident of clamp
# ordering, not a deliberate catastrophe outcome, and it also meant a truly
# disastrous roster (no star, no creator, no scoring engine, mostly
# unscored/low-minute cards) was ARTIFICIALLY PROPPED UP to the same 15
# floor as an ordinary bad-but-real roster -- the model could never tell the
# two apart.
#
# Fix: two floors, chosen deliberately rather than one accidental one.
#   - _NORMAL_BAD_WINS_FLOOR (15.0, unchanged): an ordinary bad roster --
#     real NBA-caliber talent that just doesn't fit together well -- still
#     lands in a believable ~15-25 range. This is the floor every roster
#     gets by default.
#   - _CATASTROPHE_WINS_FLOOR (5.0): reached ONLY when the roster fails on
#     every real axis at once (see _is_catastrophe_roster below) -- no
#     talent, no shot creation, no scoring, and multiple cards that aren't
#     even real contributors (unscored or genuinely low-minute). For
#     reference, the worst 82-game-equivalent pace in real NBA history is
#     the 2011-12 Bobcats (7-59 in a 66-game lockout season, a .106 clip --
#     ~9 wins over 82 games); 5.0 sits below that on purpose, because this
#     is a HYPOTHETICAL constructed roster that can genuinely be worse than
#     any real team ever fielded (a real team always has real replacement-
#     level NBA players in every minute; a constructed disaster roster here
#     might not). This is not a "make bad teams look worse" nerf -- it's
#     removing the artificial prop-up that kept the linear formula's own
#     (already very negative) result from ever showing through.
# Both floors apply to `expected_wins` (the pre-noise projection) only; the
# final noisy `wins` keeps a small separate absolute floor (1.0, see below)
# so a result is never literally 0-82, which would read as a bug rather
# than a feature.
# ---------------------------------------------------------------------------

_NORMAL_BAD_WINS_FLOOR = 15.0
_CATASTROPHE_WINS_FLOOR = 5.0
_MIN_FINAL_WINS = 1.0

# A component only counts toward "catastrophe" once it's this bad -- these
# are deliberately strict (well below the generic _COMPONENT_WEAKNESS_FLOOR
# of 50 used for weakness-explanation text) so an ordinary bad roster with,
# say, a 35 talent_core never accidentally triggers the catastrophe floor.
_CATASTROPHE_TALENT_CORE_CEILING = 30.0
_CATASTROPHE_CREATION_CEILING = 30.0
_CATASTROPHE_SCORING_CEILING = 30.0
# A card counts as "not a real contributor" if it has no official PEAK3
# score yet, OR it does have a score but was on the floor so little that
# the number barely means anything (real minutes-per-game data from the
# card itself, never inferred).
_CATASTROPHE_LOW_MINUTES_CEILING = 15.0
_CATASTROPHE_MIN_WEAK_CARDS = 2


def _is_weak_contributor(card: PlayerSeasonCard) -> bool:
    if card.score_status != "exact_season_scored":
        return True
    return card.minutes_per_game is not None and card.minutes_per_game < _CATASTROPHE_LOW_MINUTES_CEILING


def _is_catastrophe_roster(cards: list[PlayerSeasonCard], fit: LineupFitComponents) -> bool:
    """True only when EVERY axis fails at once -- no real talent, no real
    shot creation, no real scoring, AND multiple cards that aren't real
    contributors. Any one of these alone (e.g. a real, if unremarkable,
    roster that's simply unscored on a couple of deep-bench spots) stays on
    the normal 15-win floor -- catastrophe is reserved for a roster with no
    redeeming real-basketball axis left, not for a merely bad one."""
    return (
        fit.talent_core < _CATASTROPHE_TALENT_CORE_CEILING
        and fit.creation_coverage < _CATASTROPHE_CREATION_CEILING
        and fit.scoring_coverage < _CATASTROPHE_SCORING_CEILING
        and sum(1 for c in cards if _is_weak_contributor(c)) >= _CATASTROPHE_MIN_WEAK_CARDS
    )


# Phase 8F: CardProfile (career-peak-window) counterparts of the two checks
# above, for simulate_season -- the path COURTBUILDER ACTUALLY RUNS BY
# DEFAULT (see simulate_season's own comment). CardProfile has no
# score_status/minutes_per_game (every card reaching the simulator already
# passed board.py's own "exclude incomplete profiles" filter -- there is no
# "unscored" state at this grain), so "not a real contributor" is adapted
# to mean a low individual_peak_score instead -- the honest equivalent for
# this card shape, not a guess.
_CATASTROPHE_LEGACY_LOW_SCORE_CEILING = 30.0


def _is_weak_contributor_legacy(card: CardProfile) -> bool:
    return card.individual_peak_score < _CATASTROPHE_LEGACY_LOW_SCORE_CEILING


def _is_catastrophe_roster_legacy(cards: list[CardProfile], fit: LineupFitComponents) -> bool:
    return (
        fit.talent_core < _CATASTROPHE_TALENT_CORE_CEILING
        and fit.creation_coverage < _CATASTROPHE_CREATION_CEILING
        and fit.scoring_coverage < _CATASTROPHE_SCORING_CEILING
        and sum(1 for c in cards if _is_weak_contributor_legacy(c)) >= _CATASTROPHE_MIN_WEAK_CARDS
    )


def _generational_starter_count_legacy(cards: list[CardProfile]) -> int:
    starters = cards[:STARTER_SLOTS]
    return sum(1 for c in starters if c.individual_peak_score >= _GENERATIONAL_STARTER_SCORE_FLOOR)


def _is_generational_core_legacy(cards: list[CardProfile]) -> bool:
    """CardProfile counterpart of _is_generational_core -- see that
    function's docstring and the module-level comment above
    _GENERATIONAL_STARTER_SCORE_FLOOR for the product direction this
    implements."""
    return _generational_starter_count_legacy(cards) >= _GENERATIONAL_MIN_STARTER_COUNT


# ---------------------------------------------------------------------------
# Generational-elite win floor -- a third, symmetric tier alongside the two
# above (normal-bad 15 / catastrophe 5). Product-directed acceptance anchor:
# a lineup built around 2015-16 Curry, 1987-88 Jordan, 2012-13 LeBron,
# 2003-04 Garnett, and 2022-23 Jokic must land 82-0, or at worst 81-1/80-2 --
# "more generally, rosters with 4 or 5 genuinely generational peak starters
# should land extremely close to 82-0."
#
# Verified empirically before adding this: with a merely-solid bench, the
# existing linear formula ALREADY clamps that exact lineup to 82-0 (talent_core
# is 80% weighted toward the top starters, and 5 real 89-96-rated seasons
# push `base` in the 90s before the min(82, ...) clamp). The gap is the
# WORST case -- a weak/unscored bench, or a merely-good (not full 82+
# already) `base` -- where nothing guaranteed the result stayed close to 82.
# This floor closes that gap the same way the catastrophe floor closes the
# opposite one: a roster-composition check, not a change to the linear
# formula's own weights.
#
# Deliberately scoped so it can NEVER fire for a "good contender" roster
# (Section: "some rosters really are just strong contenders... don't
# flatten everything upward") -- 85+ is a real, high bar (see
# _ELITE_STARTER_SCORE_FLOOR = 80.0 used elsewhere for the more modest
# "genuine all-time peak" decisive-factor callout); requiring FOUR starters
# to individually clear it is what keeps this from ever triggering on a
# roster with only one or two true legends.
_GENERATIONAL_STARTER_SCORE_FLOOR = 85.0
_GENERATIONAL_MIN_STARTER_COUNT = 4
_GENERATIONAL_ELITE_WINS_FLOOR = 81.0
# Noise stays tight for a genuinely stacked core -- an all-time roster is
# not "iffy," it's dominant; the normal +/-2.5 uniform noise band exists to
# express real uncertainty in a formula that is NOT that confident for
# ordinary rosters, not to occasionally make a legendary lineup look shaky.
_GENERATIONAL_NOISE_RANGE = 1.0
_NORMAL_NOISE_RANGE = 2.5


def _generational_starter_count(cards: list[PlayerSeasonCard]) -> int:
    starters = cards[:STARTER_SLOTS]
    return sum(
        1 for c in starters
        if c.season_score is not None and c.season_score >= _GENERATIONAL_STARTER_SCORE_FLOOR
    )


def _is_generational_core(cards: list[PlayerSeasonCard]) -> bool:
    """True when 4 or more STARTERS (not bench) individually clear the
    generational-peak bar. Never looks at bench, fit, or any other
    component -- a real generational core carries a roster regardless of
    the other 3 slots, which is exactly the product direction given."""
    return _generational_starter_count(cards) >= _GENERATIONAL_MIN_STARTER_COUNT


def simulate_exact_season(cards: list[PlayerSeasonCard], board_seed: int, slot_types: list[str]) -> SimulationResult:
    """simulate_season()'s counterpart for team-year (exact-season) lineups.

    `lineup_peak_score` is the mean of the 8 cards' real season_score values
    ONLY if every card has score_status == 'exact_season_scored'; otherwise
    0.0 with is_perfect_season/wins still computed from whatever real scores
    ARE available (talent_core degrades gracefully), and callers (state.py)
    must surface score_status honestly (e.g. "Prototype score incomplete")
    rather than presenting 0.0 as a real result.
    """
    fit = compute_exact_fit_components(cards, slot_types)
    weak_positions = _off_position_starter_slots_exact(cards, slot_types)

    base = 41.0 + (fit.talent_core - 50.0) * 1.0
    base += (fit.bench_strength - 50.0) * 0.12
    base += (fit.positional_fit - 50.0) * 0.08
    base += (fit.creation_coverage - 50.0) * 0.05
    base += (fit.scoring_coverage - 50.0) * 0.05
    base += (fit.postseason_pedigree - 50.0) * 0.05
    is_catastrophe = _is_catastrophe_roster(cards, fit)
    is_generational = _is_generational_core(cards)
    if is_catastrophe:
        wins_floor = _CATASTROPHE_WINS_FLOOR
    elif is_generational:
        wins_floor = _GENERATIONAL_ELITE_WINS_FLOOR
    else:
        wins_floor = _NORMAL_BAD_WINS_FLOOR
    expected_wins = max(wins_floor, min(82.0, base))

    card_key = ",".join(sorted(c.exact_player_season_key for c in cards))
    rng = random.Random(f"{board_seed}:{card_key}")
    noise_range = _GENERATIONAL_NOISE_RANGE if is_generational else _NORMAL_NOISE_RANGE
    noise = rng.uniform(-noise_range, noise_range)
    wins = int(round(max(_MIN_FINAL_WINS, min(82.0, expected_wins + noise))))
    losses = TOTAL_GAMES - wins

    expected_low = max(0.0, expected_wins - 5.0)
    expected_high = min(82.0, expected_wins + 5.0)

    all_scored = all(c.score_status == "exact_season_scored" for c in cards)
    scored_values = [c.season_score for c in cards if c.season_score is not None]
    lineup_peak_score = round(sum(scored_values) / len(scored_values), 1) if all_scored and scored_values else 0.0

    weakness_text, weakness_detail = _structural_weakness_exact(cards, slot_types, fit, wins)
    elite_starters = sum(
        1 for c in cards[:STARTER_SLOTS] if c.season_score is not None and c.season_score >= _ELITE_STARTER_SCORE_FLOOR
    )

    return SimulationResult(
        lineup_model_version=LINEUP_MODEL_VERSION,
        simulator_version=SIMULATOR_VERSION,
        fit_components=fit,
        wins=wins,
        losses=losses,
        expected_wins=round(expected_wins, 1),
        expected_wins_low=round(expected_low, 1),
        expected_wins_high=round(expected_high, 1),
        decisive_factors=_decisive_factors(fit, weak_positions, elite_starters),
        is_perfect_season=(wins >= 82),
        experimental_notice=EXACT_SEASON_SIMULATOR_NOTICE,
        lineup_peak_score=lineup_peak_score,
        # The weighted fit combination this projection is built from, before
        # the floor, the cap and the noise. Surfaced for callers that must
        # RANK rosters rather than project a record -- see the field's own
        # comment in schemas.py. `base` is unchanged by publishing it.
        lineup_quality=round(base, 3),
        best_pick=_best_pick_exact(cards),
        structural_weakness=weakness_text,
        structural_weakness_detail=weakness_detail,
        weakness_framing=_weakness_framing(wins),
    )
