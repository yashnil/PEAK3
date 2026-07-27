"""CourtBuilder (82-0 Peak Season) server-authoritative state machine.

Mirrors app/services/draft/state.py's role for Peak Draft, but for the
court-based game grammar (ADR-005; PHASE_5_DATA_MODEL.md entity 8).

State machine (master plan Sec 16.6, adapted):
  selection_pending -> placement_pending -> (repeat 8x) ->
  rounds_complete -> result_ready
(create_perfect_season_game() constructs a state that starts directly at
selection_pending -- there is no separate "created" status value.)

All transitions are validated here. No exact prime_score/prime_index is ever
included in the public state for the CURRENT round's candidates -- only for
already-placed (locked) slots (ADR-005 Decision 6). This module never
computes or approximates the canonical PEAK3 score itself.
"""
from __future__ import annotations

import random
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.perfect_season.assets import get_player_headshot_url, get_team_logo_url
from nba_peak.perfect_season.board import (
    find_spin,
    generate_board,
    generate_team_year_board,
    get_rollable_team_year_entries,
    resolve_card,
)
from nba_peak.perfect_season.config import SLOT_TYPES, TOTAL_ROUNDS
from nba_peak.perfect_season.exact_season import (
    PlayerSeasonCard,
    component_percentile,
    resolve_exact_card_by_key,
    resolve_player_season_card,
)
from nba_peak.perfect_season.positions import (
    classify_fit,
    classify_fit_from_position,
    parse_real_position,
    primary_position,
    secondary_positions,
)
from nba_peak.perfect_season.schemas import CourtLineupState, CourtSlot
from nba_peak.perfect_season.simulation import _FIT_POINTS, simulate_exact_season, simulate_season

TEAM_YEAR_SPIN_TYPE = "team_year"

VALID_MODES = {"apex_1y": 1, "prime_3y": 3, "foundation_5y": 5}


class CourtError(ValueError):
    """A CourtBuilder state-machine validation error with a stable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Game creation
# ---------------------------------------------------------------------------

def create_perfect_season_game(
    mode: str,
    seed: Optional[int],
    team_spin_enabled: bool,
    board_type: str = "practice",
    team_year_enabled: bool = False,
) -> CourtLineupState:
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Valid: {list(VALID_MODES.keys())}")
    if board_type != "practice":
        # Phase 5C vertical slice supports practice only -- see
        # PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 3. Daily/ranked are later phases.
        raise ValueError(f"board_type '{board_type}' is not supported in this phase")

    resolved_seed = seed if seed is not None else secrets.randbelow(2 ** 31)
    # Phase 6A: team_year_enabled selects the experimental exact-season
    # engine instead of the team+decade path. Independent of
    # team_spin_enabled -- when both are set, team_year_enabled wins (the
    # product direction is exact-year, not decade; the two spin flavors are
    # never mixed on the same board).
    if team_year_enabled:
        board = generate_team_year_board(mode=mode, seed=resolved_seed, board_type=board_type)
    else:
        board = generate_board(mode=mode, seed=resolved_seed, board_type=board_type, team_spin_enabled=team_spin_enabled)

    now = datetime.now(timezone.utc).isoformat()
    slots = [CourtSlot(slot_type=st) for st in SLOT_TYPES]

    return CourtLineupState(
        game_id="",  # set by repository
        board=board,
        status="selection_pending",
        current_round=1,
        slots=slots,
        created_at=now,
        last_action_at=now,
        mode=mode,
        duration_years=VALID_MODES[mode],
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _assert_active(state: CourtLineupState) -> None:
    if state.status in ("rounds_complete", "result_ready"):
        raise CourtError("game_already_complete", "This CourtBuilder attempt is already complete")


def _used_player_slugs(state: CourtLineupState) -> set[str]:
    used = set()
    for slot in state.slots:
        if slot.peak_window_id:
            # peak_window_id format: {player_slug}-{n}yr-{anchor_nodash}
            card = resolve_card_by_window_id(state, slot.peak_window_id)
            if card:
                used.add(card.player_slug)
        elif slot.exact_player_season_key:
            card = resolve_exact_card_by_key(slot.exact_player_season_key)
            if card:
                used.add(card.player_slug)
    return used


def resolve_card_by_window_id(state: CourtLineupState, peak_window_id: str):
    from nba_peak.lineup.board import _load_profiles
    by_dur = _load_profiles()
    for card in by_dur.get(state.duration_years, []):
        if card.peak_window_id == peak_window_id:
            return card
    return None


def _is_team_year_spin(spin) -> bool:
    return spin is not None and spin.spin_type == TEAM_YEAR_SPIN_TYPE


def get_open_slot_types(state: CourtLineupState) -> list[str]:
    return [s.slot_type for s in state.slots if s.peak_window_id is None]


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def action_select_player(
    state: CourtLineupState,
    player_slug: str,
) -> CourtLineupState:
    """Select a player from the current round's spin candidates.

    Does not place them yet -- a separate action_place_card call assigns
    them to a court/bench slot. Selecting again before placing replaces the
    pending selection (no explicit "undo" action needed for this).
    """
    _assert_active(state)
    if state.status not in ("selection_pending",):
        raise CourtError("select_not_allowed", f"Cannot select in status '{state.status}'")

    spin = find_spin(state.board, state.current_round)
    if spin is None:
        raise CourtError("round_not_found", f"No spin for round {state.current_round}")

    if player_slug not in spin.candidate_player_slugs:
        raise CourtError(
            "player_not_offered",
            f"Player '{player_slug}' is not a candidate for round {state.current_round}",
        )

    if player_slug in _used_player_slugs(state):
        raise CourtError(
            "player_already_used",
            f"Player '{player_slug}' is already on this roster",
        )

    if _is_team_year_spin(spin):
        # Phase 6C: team-year mode resolves an EXACT player-season, never a
        # career-peak substitute. Hard invariant, not a best-effort lookup:
        # the resolved card's team/season must match what was actually
        # rolled, or this raises rather than silently drifting to a
        # different season/team (e.g. a 2013-14 OKC card for a 2017-18 GSW
        # roll).
        card = resolve_player_season_card(player_slug, spin.team_id, spin.era_label)
        if card is None:
            raise CourtError(
                "card_not_resolvable",
                f"Player '{player_slug}' has no exact-season roster record for "
                f"{spin.franchise_display_name} {spin.era_label}",
            )
        if card.season != spin.era_label or card.team_id != spin.team_id:
            raise CourtError(
                "exact_season_mismatch",
                f"Resolved card {card.player_name} {card.team_id} {card.season} does not "
                f"match the rolled team-season {spin.team_id} {spin.era_label}",
            )
        state.pending_selection_exact_season_key = card.exact_player_season_key
        state.pending_selection_peak_window_id = None
    else:
        card = resolve_card(player_slug, state.duration_years)
        if card is None:
            raise CourtError(
                "card_not_resolvable",
                f"Player '{player_slug}' has no resolvable card at this duration",
            )
        state.pending_selection_peak_window_id = card.peak_window_id
        state.pending_selection_exact_season_key = None

    state.pending_selection_spin_id = spin.spin_id
    state.status = "placement_pending"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_cancel_selection(state: CourtLineupState) -> CourtLineupState:
    """Cancel the pending selection and return to selection_pending for the
    SAME round, so the player can pick a different candidate instead.

    Phase 5X.7 fix: before this action existed, selecting a candidate was a
    one-way door -- there was no way back to the candidate list short of
    placing whoever you selected (manual review finding: "no obvious way
    to cancel/back out and choose another player before placing them").
    Does not touch current_round or any already-placed slot -- only the
    current round's pending, not-yet-placed selection.
    """
    _assert_active(state)
    has_pending = state.pending_selection_peak_window_id or state.pending_selection_exact_season_key
    if state.status != "placement_pending" or not has_pending:
        raise CourtError("cancel_not_allowed", "No pending selection to cancel")

    state.pending_selection_peak_window_id = None
    state.pending_selection_exact_season_key = None
    state.pending_selection_spin_id = None
    state.status = "selection_pending"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_place_card(
    state: CourtLineupState,
    slot_type: str,
) -> CourtLineupState:
    """Place the pending selection into a court/bench slot.

    Soft placement -- any open slot_type is legal regardless of the
    player's real position (master plan Sec 5.5). Advances to the next
    round, or to 'rounds_complete' if this was the final slot.
    """
    _assert_active(state)
    has_pending = state.pending_selection_peak_window_id or state.pending_selection_exact_season_key
    if state.status != "placement_pending" or not has_pending:
        raise CourtError("place_not_allowed", "No pending selection to place")

    if slot_type not in SLOT_TYPES:
        raise CourtError("invalid_slot", f"Unknown slot_type '{slot_type}'")

    slot = next((s for s in state.slots if s.slot_type == slot_type), None)
    if slot is None or slot.peak_window_id is not None or slot.exact_player_season_key is not None:
        raise CourtError("slot_not_open", f"Slot '{slot_type}' is not open")

    slot.round_number = state.current_round
    slot.resolved_via_spin_id = state.pending_selection_spin_id

    if state.pending_selection_exact_season_key:
        slot.exact_player_season_key = state.pending_selection_exact_season_key
        placed_card = resolve_exact_card_by_key(slot.exact_player_season_key)
        slot.role_fit = classify_fit_from_position(placed_card.position if placed_card else None, slot_type)
    else:
        slot.peak_window_id = state.pending_selection_peak_window_id
        placed_card = resolve_card_by_window_id(state, slot.peak_window_id)
        slot.role_fit = classify_fit(
            placed_card.player_slug if placed_card else None,
            placed_card.primary_role if placed_card else None,
            slot_type,
        )

    state.pending_selection_peak_window_id = None
    state.pending_selection_exact_season_key = None
    state.pending_selection_spin_id = None
    state.last_action_at = datetime.now(timezone.utc).isoformat()

    filled = sum(1 for s in state.slots if s.peak_window_id is not None or s.exact_player_season_key is not None)
    if filled >= TOTAL_ROUNDS:
        state.status = "rounds_complete"
    else:
        state.current_round += 1
        state.status = "selection_pending"
        # Phase 7A Part C: respin budgets are PER-RUN, not per-round -- do
        # NOT reset team_respins_used/season_respins_used here. Once a
        # player uses all 3 team (or season) respins anywhere in an 8-round
        # run, that respin type stays disabled for the rest of the run.
        # (Phase 6G's original per-round reset was the bug this fixes.)

    return state


# ---------------------------------------------------------------------------
# Respins (Phase 7A Part C, replacing Phase 6G's per-round budget) -- up to
# 3 team respins + 3 season respins for the WHOLE 8-round run, team_year
# mode only (the whole feature is about rerolling the team+season reel,
# which only team_year spins have -- team_decade/exact_team_season/
# open_pool rounds reject respin actions outright). state.team_respins_used
# / state.season_respins_used are never reset by action_place_card -- once
# a budget hits MAX_*_RESPINS anywhere in the run, that respin type stays
# disabled for every remaining round.
# ---------------------------------------------------------------------------

MAX_TEAM_RESPINS = 3
MAX_SEASON_RESPINS = 3
_MAX_RESPIN_PICK_ATTEMPTS = 30


def _respin_rng(state: CourtLineupState, kind: str, count: int) -> random.Random:
    """Deterministic per-respin seed, derived from the board seed + round +
    respin kind + how many of that kind have already been used ACROSS THE
    WHOLE RUN -- never Python's unseeded global random, and reproducible
    for the same game/round/respin-number (Part C: 'Deterministic seeded
    behavior'). `state.current_round` is included only as extra entropy
    (distinct rounds get distinct rerolls even at the same used-count) --
    it does not reset or scope the budget itself."""
    kind_salt = 1 if kind == "team" else 2
    return random.Random(f"{state.board.seed}:{state.current_round}:{kind}:{kind_salt}:{count}")


def _pick_valid_entry(
    pool: list[dict], used_slugs: set[str], rng: random.Random, fallback_pool: list[dict]
) -> Optional[dict]:
    """An entry from `pool` with at least one candidate not already on the
    roster -- bounded random probing (deterministic given `rng`), falling
    back to the full entries catalogue if the constrained pool (e.g. "same
    season, different team") can't produce one. Guarantees a respin never
    produces an empty AVAILABLE candidate list; returns None only in the
    practically-unreachable case where even the full catalogue can't (7
    used players max vs. an 8+-candidate floor per entry across ~1,300+
    entries)."""
    for candidates in (pool, fallback_pool):
        if not candidates:
            continue
        for _ in range(min(_MAX_RESPIN_PICK_ATTEMPTS, len(candidates))):
            entry = candidates[rng.randrange(len(candidates))]
            if any(slug not in used_slugs for slug in entry["player_slugs"]):
                return entry
    return None


def _apply_respin_entry(spin, new_entry: dict) -> None:
    spin.spin_id = new_entry.get("spin_id")
    spin.franchise_display_name = new_entry.get("franchise_display_name")
    spin.era_label = new_entry.get("era_label")
    spin.candidate_player_slugs = list(new_entry["player_slugs"])
    spin.team_id = new_entry.get("team_id")


def _assert_respin_allowed(state: CourtLineupState):
    _assert_active(state)
    if state.status != "selection_pending":
        raise CourtError(
            "respin_not_allowed",
            "Respins are only available before a player is selected for this round",
        )
    spin = find_spin(state.board, state.current_round)
    if spin is None or not _is_team_year_spin(spin):
        raise CourtError(
            "respin_not_supported",
            "Respins are only available for exact team+season rounds",
        )
    return spin


def action_respin_team(state: CourtLineupState) -> CourtLineupState:
    """Reroll the current round's TEAM, preferring to keep the same season
    if another team has a rollable roster for it; otherwise rerolls to a
    fully independent valid team-season pair (Part C: 'same season if valid
    for new team, or reroll to a valid team-season pair if that team did
    not exist in that season')."""
    spin = _assert_respin_allowed(state)
    if state.team_respins_used >= MAX_TEAM_RESPINS:
        raise CourtError("respin_limit_reached", "No team respins left this round")

    entries = get_rollable_team_year_entries()
    same_season_other_team = [
        e for e in entries if e["era_label"] == spin.era_label and e["team_id"] != spin.team_id
    ]
    rng = _respin_rng(state, "team", state.team_respins_used)
    new_entry = _pick_valid_entry(same_season_other_team, _used_player_slugs(state), rng, entries)
    if new_entry is None:
        raise CourtError("respin_no_valid_option", "No valid team-season available for a respin right now")

    from_team, from_season = spin.franchise_display_name, spin.era_label
    _apply_respin_entry(spin, new_entry)
    state.team_respins_used += 1
    state.respin_history.append({
        "round": state.current_round, "kind": "team",
        "from_team": from_team, "from_season": from_season,
        "to_team": spin.franchise_display_name, "to_season": spin.era_label,
    })
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_respin_season(state: CourtLineupState) -> CourtLineupState:
    """Reroll the current round's SEASON, preferring to keep the same team
    if it has a rollable roster in a different season; otherwise rerolls to
    a fully independent valid team-season pair (Part C: 'same team if the
    team has roster data that year')."""
    spin = _assert_respin_allowed(state)
    if state.season_respins_used >= MAX_SEASON_RESPINS:
        raise CourtError("respin_limit_reached", "No season respins left this round")

    entries = get_rollable_team_year_entries()
    same_team_other_season = [
        e for e in entries if e["team_id"] == spin.team_id and e["era_label"] != spin.era_label
    ]
    rng = _respin_rng(state, "season", state.season_respins_used)
    new_entry = _pick_valid_entry(same_team_other_season, _used_player_slugs(state), rng, entries)
    if new_entry is None:
        raise CourtError("respin_no_valid_option", "No valid team-season available for a respin right now")

    from_team, from_season = spin.franchise_display_name, spin.era_label
    _apply_respin_entry(spin, new_entry)
    state.season_respins_used += 1
    state.respin_history.append({
        "round": state.current_round, "kind": "season",
        "from_team": from_team, "from_season": from_season,
        "to_team": spin.franchise_display_name, "to_season": spin.era_label,
    })
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_complete_game(state: CourtLineupState) -> CourtLineupState:
    """Run the v0 simulation and freeze the result. Idempotent -- calling
    this again on an already-result_ready state returns the same result
    unchanged rather than re-simulating (results must be reproducible, not
    regenerated on every call)."""
    if state.status == "result_ready":
        return state
    if state.status != "rounds_complete":
        raise CourtError("not_ready_to_complete", f"Cannot complete in status '{state.status}'")

    slot_types = [s.slot_type for s in state.slots]
    team_year_board = state.board.experimental_team_year_data_version is not None

    if team_year_board:
        exact_cards: list[PlayerSeasonCard] = []
        for slot in state.slots:
            if not slot.exact_player_season_key:
                raise CourtError("incomplete_roster", "Not all slots are filled")
            card = resolve_exact_card_by_key(slot.exact_player_season_key)
            if card is None:
                raise CourtError(
                    "card_not_resolvable", f"Could not resolve slot card '{slot.exact_player_season_key}'"
                )
            exact_cards.append(card)
        state.simulation_result = simulate_exact_season(exact_cards, state.board.seed, slot_types)
    else:
        cards = []
        for slot in state.slots:
            if not slot.peak_window_id:
                raise CourtError("incomplete_roster", "Not all slots are filled")
            card = resolve_card_by_window_id(state, slot.peak_window_id)
            if card is None:
                raise CourtError("card_not_resolvable", f"Could not resolve slot card '{slot.peak_window_id}'")
            cards.append(card)
        state.simulation_result = simulate_season(cards, state.board.seed, slot_types)

    state.status = "result_ready"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


# ---------------------------------------------------------------------------
# Public state serialization (never exposes scores for un-locked candidates)
# ---------------------------------------------------------------------------

_GUARD_POSITIONS = {"PG", "SG"}
_WING_POSITIONS = {"SF"}
_BIG_POSITIONS = {"PF", "C"}

# Coarse, server-side-only score buckets for the "star-heavy" identity tag.
# The underlying season_score is NEVER sent to the client for an unrevealed
# slot -- only this bucketed label is. Placed cards are already committed
# choices (not the undecided current round), so describing what's already
# on the roster is feedback on a decision already made, not a hint that
# solves the round in progress.
_STAR_SCORE_FLOOR = 75.0


def _compute_live_build(placed_cards: list[PlayerSeasonCard], state: CourtLineupState) -> dict:
    """Phase 6E Part D: compact mid-run feedback -- roster identity, needs,
    and a provisional (deliberately coarse) projected record range. Never
    reveals an exact hidden score and never names which OPEN-round candidate
    to pick; describes only what's already been placed."""
    n = len(placed_cards)
    scored = [c for c in placed_cards if c.score_status == "exact_season_scored" and c.season_score is not None]
    unscored_count = n - len(scored)

    primaries = []
    for c in placed_cards:
        primary, _ = parse_real_position(c.position)
        if primary:
            primaries.append(primary)
    guards = sum(1 for p in primaries if p in _GUARD_POSITIONS)
    wings = sum(1 for p in primaries if p in _WING_POSITIONS)
    bigs = sum(1 for p in primaries if p in _BIG_POSITIONS)

    identity_tags: list[str] = []
    if scored:
        avg_score = sum(c.season_score for c in scored) / len(scored)
        if avg_score >= _STAR_SCORE_FLOOR:
            identity_tags.append("star-heavy")
    if n >= 3 and guards >= max(2, n // 2):
        identity_tags.append("guard-heavy")
    if n >= 3 and wings >= 3:
        identity_tags.append("wing-rich")
    if n >= 5 and bigs == 0:
        identity_tags.append("no true center")
    if not identity_tags and n >= 3:
        identity_tags.append("balanced build")

    needs: list[str] = []
    open_count = TOTAL_ROUNDS - n
    if open_count > 0:
        if guards == 0:
            needs.append("needs a guard")
        if wings == 0:
            needs.append("needs a wing")
        if bigs == 0:
            needs.append("needs a big")

    provisional_record_range = None
    projection_confidence = "early_projection"
    if n >= TOTAL_ROUNDS:
        projection_confidence = "ready_to_simulate"
    elif n >= 5:
        projection_confidence = "narrowing_projection"

    if n >= TOTAL_ROUNDS and all(s.exact_player_season_key for s in state.slots):
        # Phase 7A Part E: at 8/8 placed, every input simulate_exact_season
        # needs is already known and fully deterministic (board_seed + the
        # 8 exact cards) -- call the REAL simulator directly instead of
        # approximating, so the "provisional" number always exactly
        # matches what /complete will return (never a lowball/mismatched
        # range for a finished roster).
        exact_cards = [resolve_exact_card_by_key(s.exact_player_season_key) for s in state.slots]
        if all(c is not None for c in exact_cards):
            result = simulate_exact_season(exact_cards, state.board.seed, [s.slot_type for s in state.slots])
            provisional_record_range = {"low_wins": result.wins, "high_wins": result.wins}
    if provisional_record_range is None and scored:
        expected_wins = _provisional_expected_wins(state)
        if expected_wins is not None:
            # Range narrows as the roster fills in -- a 1-2 card guess is
            # genuinely uncertain (wide range honestly reflects that); a
            # 7-card roster is nearly fully determined (narrow range).
            half_width = {0: 15, 1: 15, 2: 15, 3: 12, 4: 10, 5: 7, 6: 5, 7: 3}.get(n, 2)
            low = max(0, int(round(expected_wins)) - half_width)
            high = min(82, int(round(expected_wins)) + half_width)
            provisional_record_range = {"low_wins": low, "high_wins": high}

    return {
        "placed_count": n,
        "total_rounds": TOTAL_ROUNDS,
        "scored_count": len(scored),
        "unscored_count": unscored_count,
        "identity_tags": identity_tags,
        "needs": needs,
        "provisional_record_range": provisional_record_range,
        # Phase 7A Part E: "early_projection" (< 5 placed) | "narrowing_
        # projection" (5-7 placed) | "ready_to_simulate" (8/8 placed) --
        # drives the UI copy so users don't read early-round noise as a
        # confident prediction.
        "projection_confidence": projection_confidence,
    }


def _provisional_expected_wins(state: CourtLineupState) -> Optional[float]:
    """Mid-run expected-wins estimate using the SAME weighted formula and
    component weights as simulate_exact_season (Phase 7A Part E) -- unlike
    the old flat "avg_score +/- 8" placeholder, this reuses talent_core/
    bench_strength/positional_fit/creation_coverage/scoring_coverage/
    postseason_pedigree with their real weights, computed from whichever
    slots are ALREADY placed (missing slots simply don't contribute,
    rather than being padded with a fabricated average). team_context_depth
    is intentionally excluded -- the real win formula never weights it
    either (see simulation.py's own `base = ...` construction)."""
    from nba_peak.perfect_season.positions import BENCH_SLOTS as BENCH_SLOT_TYPES, STARTER_SLOTS as STARTER_SLOT_TYPES

    cards_by_slot: dict[str, PlayerSeasonCard] = {}
    for slot in state.slots:
        if slot.exact_player_season_key:
            card = resolve_exact_card_by_key(slot.exact_player_season_key)
            if card is not None:
                cards_by_slot[slot.slot_type] = card
    if not cards_by_slot:
        return None

    starter_scores = [
        c.season_score for st in STARTER_SLOT_TYPES
        if (c := cards_by_slot.get(st)) is not None and c.season_score is not None
    ]
    bench_scores = [
        c.season_score for st in BENCH_SLOT_TYPES
        if (c := cards_by_slot.get(st)) is not None and c.season_score is not None
    ]
    if not starter_scores and not bench_scores:
        return None
    talent_core = (
        (sum(starter_scores) / len(starter_scores)) * 0.8 + (sum(bench_scores) / len(bench_scores)) * 0.2
        if starter_scores and bench_scores
        else (sum(starter_scores) / len(starter_scores) if starter_scores else sum(bench_scores) / len(bench_scores))
    )
    bench_strength = (sum(bench_scores) / len(bench_scores)) if bench_scores else 50.0

    fit_points = []
    for slot_type in STARTER_SLOT_TYPES:
        card = cards_by_slot.get(slot_type)
        if card is None:
            continue
        fit_points.append(_FIT_POINTS.get(classify_fit_from_position(card.position, slot_type), 0.0))
    positional_fit = max(0.0, min(100.0, 50.0 + sum(fit_points))) if fit_points else 50.0

    def _avg_percentile(column: str) -> float:
        values = [
            p for c in cards_by_slot.values()
            if (p := component_percentile(c.player_slug, c.team_id, c.season, column)) is not None
        ]
        return (sum(values) / len(values)) if values else 50.0

    creation_coverage = _avg_percentile("contrib_statistical_impact")
    scoring_coverage = _avg_percentile("contrib_traditional_production")
    postseason_pedigree = _avg_percentile("contrib_postseason")

    base = 41.0 + (talent_core - 50.0) * 1.0
    base += (bench_strength - 50.0) * 0.12
    base += (positional_fit - 50.0) * 0.08
    base += (creation_coverage - 50.0) * 0.05
    base += (scoring_coverage - 50.0) * 0.05
    base += (postseason_pedigree - 50.0) * 0.05
    return max(15.0, min(82.0, base))


def get_public_state(state: CourtLineupState, include_asset_urls: bool = False) -> dict:
    """Build the client-visible state.

    ADR-005 Decision 6, ruthlessly enforced here: the current round's
    candidate list contains ONLY player_slug + display context, never
    prime_score/prime_index/rank.

    Deferred reveal (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5,
    extending ADR-005 Decision 6 rather than replacing it): a filled slot's
    exact `individual_peak_score`/`individual_peak_rank` are withheld until
    `state.status == "result_ready"` -- i.e. until the full 8-slot roster is
    locked AND simulated, not the instant each slot is filled. Before that,
    a filled slot exposes only qualitative information: `player_name`,
    `anchor_season` ("peak locked" -- which window was resolved, not its
    score), and `role_fit` (position/role fit note). This collapses 8
    separate "was I right?" reveals into a single roster-wide broadcast
    reveal at the end, instead of resolving the suspense once per pick.
    """
    spin = find_spin(state.board, state.current_round) if state.status == "selection_pending" else None
    team_year_board = state.board.experimental_team_year_data_version is not None

    current_spin_public = None
    if spin is not None:
        current_spin_public = {
            "round_number": spin.round_number,
            "spin_type": spin.spin_type,
            "franchise_display_name": spin.franchise_display_name,
            "era_label": spin.era_label,
            "candidates": [
                (_candidate_public_exact(slug, spin.team_id, spin.era_label, include_asset_urls)
                 if _is_team_year_spin(spin) else _candidate_public(slug, state.duration_years))
                for slug in spin.candidate_player_slugs
                if slug not in _used_player_slugs(state)
            ],
        }
        if _is_team_year_spin(spin):
            current_spin_public["team_id"] = spin.team_id
            current_spin_public["candidate_source"] = "exact_team_season"
            current_spin_public["data_version"] = state.board.experimental_team_year_data_version
            current_spin_public["coverage_mode"] = state.board.metadata.get("coverage_mode")
            if include_asset_urls:
                current_spin_public["team_logo_url"] = get_team_logo_url(spin.team_id)
            # Phase 7A Part C: RUN-LEVEL budget (never resets per round --
            # see MAX_TEAM_RESPINS's own comment). Respins are only ever
            # offered/consumable before a player is selected (status ==
            # "selection_pending", same gate action_respin_team/
            # action_respin_season enforce) -- a client seeing
            # state.status != "selection_pending" already knows respins
            # are locked for THIS round without needing a separate flag,
            # even though the budget itself carries over.
            current_spin_public["team_respins_used"] = state.team_respins_used
            current_spin_public["team_respins_max"] = MAX_TEAM_RESPINS
            current_spin_public["season_respins_used"] = state.season_respins_used
            current_spin_public["season_respins_max"] = MAX_SEASON_RESPINS

    pending_card_public = None
    if state.pending_selection_exact_season_key:
        card = resolve_exact_card_by_key(state.pending_selection_exact_season_key)
        if card:
            primary, secondary = parse_real_position(card.position)
            pending_card_public = {
                "exact_player_season_key": card.exact_player_season_key,
                "player_name": card.player_name,
                "team_id": card.team_id,
                "team_name": card.team_name,
                "season": card.season,
                # No score here either -- still not locked into a slot yet.
                "primary_position": primary,
                "secondary_positions": list(secondary),
                "identity_pool_status": card.identity_pool_status,
                "score_status": card.score_status,
                "score_source": card.score_source,
                "fit_by_open_slot": {
                    slot_type: classify_fit_from_position(card.position, slot_type)
                    for slot_type in get_open_slot_types(state)
                },
            }
            if include_asset_urls:
                pending_card_public["headshot_url"] = get_player_headshot_url(card.player_slug)
    elif state.pending_selection_peak_window_id:
        card = resolve_card_by_window_id(state, state.pending_selection_peak_window_id)
        if card:
            pending_card_public = {
                "peak_window_id": card.peak_window_id,
                "player_name": card.player_name,
                # No score here either -- still not locked into a slot yet.
                "primary_position": primary_position(card.player_slug, card.primary_role),
                "secondary_positions": list(secondary_positions(card.player_slug, card.primary_role)),
                "fit_by_open_slot": {
                    slot_type: classify_fit(card.player_slug, card.primary_role, slot_type)
                    for slot_type in get_open_slot_types(state)
                },
            }

    reveal_scores = state.status == "result_ready"
    slots_public = []
    all_placed_scored = True
    placed_exact_cards: list[PlayerSeasonCard] = []
    for slot in state.slots:
        filled = slot.peak_window_id is not None or slot.exact_player_season_key is not None
        entry: dict = {"slot_type": slot.slot_type, "filled": filled}
        if slot.exact_player_season_key:
            card = resolve_exact_card_by_key(slot.exact_player_season_key)
            if card:
                placed_exact_cards.append(card)
                primary, secondary = parse_real_position(card.position)
                entry.update({
                    "exact_player_season_key": card.exact_player_season_key,
                    "player_name": card.player_name,
                    "team_id": card.team_id,
                    "team_name": card.team_name,
                    "season": card.season,
                    "role_fit": slot.role_fit,
                    "resolved_via_spin_id": slot.resolved_via_spin_id,
                    "primary_position": primary,
                    "secondary_positions": list(secondary),
                    "identity_pool_status": card.identity_pool_status,
                    "score_status": card.score_status,
                    "score_source": card.score_source,
                })
                if include_asset_urls:
                    entry["headshot_url"] = get_player_headshot_url(card.player_slug)
                if card.score_status != "exact_season_scored":
                    all_placed_scored = False
                if reveal_scores:
                    entry.update({"season_score": card.season_score})
        elif slot.peak_window_id:
            card = resolve_card_by_window_id(state, slot.peak_window_id)
            if card:
                entry.update({
                    "peak_window_id": card.peak_window_id,
                    "player_name": card.player_name,
                    "anchor_season": card.anchor_season,
                    "role_fit": slot.role_fit,
                    "resolved_via_spin_id": slot.resolved_via_spin_id,
                    # Lets the UI explain an off-position placement ("plays
                    # SF") rather than just flagging it as off-position with
                    # no context (goal: position eligibility clarity).
                    "primary_position": primary_position(card.player_slug, card.primary_role),
                    "secondary_positions": list(secondary_positions(card.player_slug, card.primary_role)),
                })
                if reveal_scores:
                    entry.update({
                        "individual_peak_score": card.individual_peak_score,
                        "individual_peak_rank": card.individual_peak_rank,
                    })
        slots_public.append(entry)

    simulation_public = None
    if state.simulation_result:
        r = state.simulation_result
        simulation_public = {
            "lineup_model_version": r.lineup_model_version,
            "simulator_version": r.simulator_version,
            "fit_components": r.fit_components.as_dict(),
            "wins": r.wins,
            "losses": r.losses,
            "expected_wins": r.expected_wins,
            "expected_wins_low": r.expected_wins_low,
            "expected_wins_high": r.expected_wins_high,
            "decisive_factors": r.decisive_factors,
            "is_perfect_season": r.is_perfect_season,
            "experimental_notice": r.experimental_notice,
            # Phase 6C: for team-year boards, lineup_peak_score is only a
            # real number when every placed card has an exact-season score
            # (simulate_exact_season already enforces this and returns 0.0
            # otherwise) -- lineup_score_status tells the UI which case it
            # is in, so it can show "Prototype score incomplete" instead of
            # presenting 0.0 as a real result.
            "lineup_peak_score": r.lineup_peak_score,
            "lineup_score_status": (
                ("complete" if all_placed_scored else "incomplete") if team_year_board else "complete"
            ),
            "best_pick": r.best_pick,
            "structural_weakness": r.structural_weakness,
            "weakness_framing": r.weakness_framing,
        }

    return {
        "game_id": state.game_id,
        "status": state.status,
        "mode": state.mode,
        "current_round": state.current_round,
        "total_rounds": TOTAL_ROUNDS,
        "current_spin": current_spin_public,
        "pending_selection": pending_card_public,
        "slots": slots_public,
        "board_seed": state.board.seed,
        "card_pool_version": state.board.card_pool_version,
        "board_generator_version": state.board.board_generator_version,
        "interim_team_data_version": state.board.interim_team_data_version,
        # Phase 6A receipt fields -- None for every non-team-year board
        # (team_decade/open_pool), populated for generate_team_year_board()
        # boards. See board.metadata's own "formula_version"/"coverage_mode".
        "experimental_team_year_data_version": state.board.experimental_team_year_data_version,
        "formula_version": state.board.metadata.get("formula_version"),
        "coverage_mode": state.board.metadata.get("coverage_mode"),
        "open_pool_enabled": (not team_year_board) and any(s.spin_type == "open_pool" for s in state.board.spins),
        "simulation_result": simulation_public,
        "live_build": (
            _compute_live_build(placed_exact_cards, state)
            if team_year_board and placed_exact_cards and state.status != "result_ready"
            else None
        ),
        # Phase 6G Part C: full respin receipt for this attempt (every round,
        # not just the current one) -- part of the data receipt, and needed
        # by the leaderboard submission path (Part E) to record respin
        # counts on a submitted run.
        "respin_history": state.respin_history,
        # Phase 7A Part C: explicit RUN-LEVEL counters for the data receipt
        # -- team_respins_used/season_respins_used on current_spin (below)
        # are already run-level values (never reset per round), but these
        # top-level _total fields are always present (even once the round
        # has advanced past the last team_year spin) and name the budget
        # unambiguously.
        "team_respins_used_total": state.team_respins_used,
        "team_respins_remaining_total": max(0, MAX_TEAM_RESPINS - state.team_respins_used),
        "season_respins_used_total": state.season_respins_used,
        "season_respins_remaining_total": max(0, MAX_SEASON_RESPINS - state.season_respins_used),
    }


def _display_name_for_slug(player_slug: str, duration_years: int) -> str:
    card = resolve_card(player_slug, duration_years)
    return card.player_name if card else player_slug


def _candidate_public(player_slug: str, duration_years: int) -> dict:
    """Public candidate entry: name + v1 position eligibility hint, never a
    score/rank (ADR-005 Decision 6 -- SpinCandidate has no score field at
    all, enforced at the Pydantic layer too)."""
    card = resolve_card(player_slug, duration_years)
    if card is None:
        return {"player_slug": player_slug, "player_name": player_slug, "primary_position": None, "secondary_positions": []}
    return {
        "player_slug": player_slug,
        "player_name": card.player_name,
        "primary_position": primary_position(card.player_slug, card.primary_role),
        "secondary_positions": list(secondary_positions(card.player_slug, card.primary_role)),
    }


def _candidate_public_exact(player_slug: str, team_id: str, season: str, include_asset_urls: bool = False) -> dict:
    """Team-year mode's candidate entry: exact team + exact season + real
    position + identity/score status -- never a score/rank before reveal
    (same ADR-005 Decision 6 discipline as _candidate_public), and never a
    peak-window id (this candidate resolves to a PlayerSeasonCard, not a
    CardProfile).

    Phase 6F Part C: `headshot_url` is populated ONLY when include_asset_urls
    is true (Settings.ENABLE_EXTERNAL_ASSET_URLS, default off) AND the asset
    manifest has a resolved entry for this exact player_slug -- see
    nba_peak.perfect_season.assets. None in every other case; the frontend
    already falls back to initials for a None/missing URL."""
    card = resolve_player_season_card(player_slug, team_id, season)
    if card is None:
        return {
            "player_slug": player_slug, "player_name": player_slug, "team_id": team_id, "season": season,
            "primary_position": None, "secondary_positions": [],
            "identity_pool_status": "unresolved", "score_status": "score_unavailable",
        }
    primary, secondary = parse_real_position(card.position)
    entry = {
        "player_slug": player_slug,
        "player_name": card.player_name,
        "team_id": card.team_id,
        "team_name": card.team_name,
        "season": card.season,
        "primary_position": primary,
        "secondary_positions": list(secondary),
        "identity_pool_status": card.identity_pool_status,
        "score_status": card.score_status,
        "score_source": card.score_source,
    }
    if include_asset_urls:
        entry["headshot_url"] = get_player_headshot_url(player_slug)
    return entry
