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
    parse_real_position,
    position_fit_severity,
)
from nba_peak.perfect_season.schemas import LineupFitComponents, SimulationResult

TOTAL_GAMES = 82

# positional_fit contribution per starter, by classify_fit() outcome. Modest
# and symmetric around 0 -- this rewards/penalizes REAL position placement,
# never how many strong players are on the roster (see module docstring).
_FIT_POINTS = {"primary": 10.0, "secondary": 4.0, "off_position": -6.0}


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


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

    talent_core = _avg([c.individual_peak_score for c in starters]) * 0.8 + \
        _avg([c.individual_peak_score for c in bench]) * 0.2 if bench else \
        _avg([c.individual_peak_score for c in starters])
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
        _FIT_POINTS.get(classify_fit(card.player_slug, card.primary_role, slot), 0.0)
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


def _off_position_starter_slots(cards: list[CardProfile], slot_types: list[str]) -> list[str]:
    """Which starter slot_types are off-position for the card placed there --
    used to name specific weak positions in the result explanation instead
    of only a vague "several starters" statement (result-credibility goal:
    open/weak positions if any)."""
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]
    return [
        slot for card, slot in zip(starters, starter_slot_types)
        if classify_fit(card.player_slug, card.primary_role, slot) == "off_position"
    ]


def _decisive_factors(fit: LineupFitComponents, weak_positions: list[str] | None = None) -> list[str]:
    factors: list[str] = []
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

    if weak_positions:
        positions = ", ".join(weak_positions)
        factors.append(f"Off-position at {positions} -- a real but modest drag, not a talent penalty")
    elif fit.positional_fit >= 70:
        factors.append("Starters are placed at their natural positions")

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
    expected_wins = max(15.0, min(82.0, base))

    card_key = ",".join(sorted(c.peak_window_id for c in cards))
    rng = random.Random(f"{board_seed}:{card_key}")
    noise = rng.uniform(-2.5, 2.5)
    wins = int(round(max(0.0, min(82.0, expected_wins + noise))))
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

    return SimulationResult(
        lineup_model_version=LINEUP_MODEL_VERSION,
        simulator_version=SIMULATOR_VERSION,
        fit_components=fit,
        wins=wins,
        losses=losses,
        expected_wins=round(expected_wins, 1),
        expected_wins_low=round(expected_low, 1),
        expected_wins_high=round(expected_high, 1),
        decisive_factors=_decisive_factors(fit, weak_positions),
        is_perfect_season=(wins >= 82),
        experimental_notice=SIMULATOR_EXPERIMENTAL_NOTICE,
        lineup_peak_score=lineup_peak_score,
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
    "rather than approximated."
)


def compute_exact_fit_components(cards: list[PlayerSeasonCard], slot_types: list[str]) -> LineupFitComponents:
    if not cards:
        return LineupFitComponents(0, 0, 50, 0, 0, 0, 0)

    starters = cards[:STARTER_SLOTS]
    bench = cards[STARTER_SLOTS:]

    def _scored_scores(group: list[PlayerSeasonCard]) -> list[float]:
        return [c.season_score for c in group if c.season_score is not None]

    starter_scores = _scored_scores(starters)
    bench_scores = _scored_scores(bench)
    talent_core = (_avg(starter_scores) * 0.8 + _avg(bench_scores) * 0.2) if bench_scores else _avg(starter_scores)
    bench_strength = _avg(bench_scores)

    def _avg_percentile(column: str) -> float:
        values = [
            p for c in cards
            if (p := component_percentile(c.player_slug, c.team_id, c.season, column)) is not None
        ]
        return _avg(values)

    creation_coverage = _avg_percentile("contrib_statistical_impact")
    scoring_coverage = _avg_percentile("contrib_traditional_production")
    postseason_pedigree = _avg_percentile("contrib_postseason")
    team_context_depth = _avg_percentile("contrib_team_achievement")

    starter_slot_types = slot_types[:STARTER_SLOTS]
    fit_points = [
        _FIT_POINTS.get(classify_fit_from_position(card.position, slot), 0.0)
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


def _off_position_starter_slots_exact(cards: list[PlayerSeasonCard], slot_types: list[str]) -> list[str]:
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]
    return [
        slot for card, slot in zip(starters, starter_slot_types)
        if classify_fit_from_position(card.position, slot) == "off_position"
    ]


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


# Phase 6G Part A: human-readable labels for the six lineup-fit components,
# used only when that component is the actual driver of a weak roster (see
# _weakest_component_label). Never phrased as a player name -- these are
# always roster-level statements.
_COMPONENT_LABELS = {
    "talent_core": "low talent core",
    "bench_strength": "thin bench depth",
    "team_context_depth": "low team-context depth",
    "creation_coverage": "limited shot-creation coverage",
    "scoring_coverage": "limited scoring coverage",
    "postseason_pedigree": "thin postseason pedigree",
}
# A component only becomes "the weakness" once it's meaningfully below
# neutral (50) -- otherwise a perfectly fine roster's slightly-below-average
# component would get needlessly called out.
_COMPONENT_WEAKNESS_FLOOR = 50.0


def _weakest_component_label(fit: LineupFitComponents) -> str | None:
    """The single lowest of the six major fit components, as a plain-
    English label -- only returned if it's actually low (below
    _COMPONENT_WEAKNESS_FLOOR), never just "whichever is smallest" on an
    otherwise-strong roster. positional_fit is intentionally excluded here:
    it's graded separately (as named off-position starters), not folded
    into this generic component check."""
    values = {
        "talent_core": fit.talent_core,
        "bench_strength": fit.bench_strength,
        "team_context_depth": fit.team_context_depth,
        "creation_coverage": fit.creation_coverage,
        "scoring_coverage": fit.scoring_coverage,
        "postseason_pedigree": fit.postseason_pedigree,
    }
    worst_key = min(values, key=lambda k: values[k])
    if values[worst_key] >= _COMPONENT_WEAKNESS_FLOOR:
        return None
    return _COMPONENT_LABELS[worst_key]


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


def _structural_weakness_exact(
    cards: list[PlayerSeasonCard], slot_types: list[str], fit: LineupFitComponents
) -> str | None:
    """Prioritized structural weakness description. Order (Phase 6G Part A
    rewrite -- fixes the "Weakness: Reggie Miller at SF" bug, where a mild,
    entirely plausible SG-at-SF swap outranked a 42.6 talent core / 35.6
    team-context depth just because it was *an* off-position starter, with
    no regard for how big a real basketball problem it actually was):
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
         postseason_pedigree), if meaningfully below neutral -- a genuinely
         weak supporting cast is a bigger problem than a defensible mild
         positional swap.
      5. Mild off-position starter(s) -- reached only once nothing larger
         applies (a 6'7 SG at SF is a real but small drag, not the fatal
         flaw -- see position_fit_severity's adjacency table).
      6. Fallback: lowest-scored placed card (only reached when the roster
         is structurally sound and every component is healthy -- score
         rank alone is a fair "weakness" only then).
    """
    if not cards:
        return None
    starters = cards[:STARTER_SLOTS]
    starter_slot_types = slot_types[:STARTER_SLOTS]

    unscored = [c for c in cards if c.score_status != "exact_season_scored"]
    if len(unscored) >= 2:
        return f"{len(unscored)} cards with no PEAK3 score yet -- lineup score is incomplete"

    # (player_name, slot, real_primary_position, severity)
    off_position: list[tuple[str, str, str | None, str]] = []
    for card, slot in zip(starters, starter_slot_types):
        primary, _ = parse_real_position(card.position)
        if classify_fit_from_position(card.position, slot) == "off_position":
            off_position.append((card.player_name, slot, primary, position_fit_severity(slot, primary)))

    severe = [o for o in off_position if o[3] == "severe"]
    if len(severe) == 1:
        name, slot, real_pos, _sev = severe[0]
        pos_note = f" -- {name}'s real position is {real_pos}" if real_pos else f" -- {name} is not a real {slot}"
        return f"{_SEVERE_SLOT_LABEL.get(slot, f'no real {slot}')}{pos_note}"
    if len(severe) >= 2:
        detail = ", ".join(f"{name} at {slot}" for name, slot, _, _ in severe)
        return f"Position-broken starting five -- {detail}"

    moderate = [o for o in off_position if o[3] == "moderate"]
    if len(moderate) == 1:
        name, slot, real_pos, _sev = moderate[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"{name} at {slot}{pos_note}"
    if len(moderate) >= 2:
        detail = ", ".join(f"{name} at {slot}" for name, slot, _, _ in moderate)
        return f"Position-broken starting five -- {detail}"

    weakest_component = _weakest_component_label(fit)
    if weakest_component:
        return weakest_component

    mild = [o for o in off_position if o[3] == "mild"]
    if len(mild) == 1:
        name, slot, real_pos, _sev = mild[0]
        pos_note = f", real position {real_pos}" if real_pos else ""
        return f"{name} at {slot}{pos_note}"
    if len(mild) >= 2:
        detail = ", ".join(f"{name} at {slot}" for name, slot, _, _ in mild)
        return f"Position-broken starting five -- {detail}"

    scored = [c for c in cards if c.season_score is not None]
    if scored:
        worst = min(scored, key=lambda c: c.season_score)
        return worst.player_name
    return None


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
    expected_wins = max(15.0, min(82.0, base))

    card_key = ",".join(sorted(c.exact_player_season_key for c in cards))
    rng = random.Random(f"{board_seed}:{card_key}")
    noise = rng.uniform(-2.5, 2.5)
    wins = int(round(max(0.0, min(82.0, expected_wins + noise))))
    losses = TOTAL_GAMES - wins

    expected_low = max(0.0, expected_wins - 5.0)
    expected_high = min(82.0, expected_wins + 5.0)

    all_scored = all(c.score_status == "exact_season_scored" for c in cards)
    scored_values = [c.season_score for c in cards if c.season_score is not None]
    lineup_peak_score = round(sum(scored_values) / len(scored_values), 1) if all_scored and scored_values else 0.0

    return SimulationResult(
        lineup_model_version=LINEUP_MODEL_VERSION,
        simulator_version=SIMULATOR_VERSION,
        fit_components=fit,
        wins=wins,
        losses=losses,
        expected_wins=round(expected_wins, 1),
        expected_wins_low=round(expected_low, 1),
        expected_wins_high=round(expected_high, 1),
        decisive_factors=_decisive_factors(fit, weak_positions),
        is_perfect_season=(wins >= 82),
        experimental_notice=EXACT_SEASON_SIMULATOR_NOTICE,
        lineup_peak_score=lineup_peak_score,
        best_pick=_best_pick_exact(cards),
        structural_weakness=_structural_weakness_exact(cards, slot_types, fit),
    )
