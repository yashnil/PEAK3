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

from nba_peak.perfect_season.assets import get_player_headshot_url, get_team_logo_url, get_team_logo_url_by_name
from nba_peak.perfect_season.board import (
    find_spin,
    generate_board,
    generate_team_year_board,
    get_rollable_season_index,
    get_rollable_team_year_catalogue,
    get_rollable_team_year_entries,
    resolve_card,
)
from nba_peak.perfect_season import config as _ps_config
from nba_peak.perfect_season.config import (
    MIN_RESPIN_POOL,
    RESPIN_POLICY_VERSION,
    SLOT_TYPES,
    TOTAL_ROUNDS,
)


def _season_exclusion_radius() -> int:
    """Read the constant through the config MODULE, not a bound copy.

    `from ... import RESPIN_SEASON_EXCLUSION_RADIUS` binds a snapshot into this
    module's namespace, so the documented rollback -- "set both constants to 0"
    -- did nothing when applied to `nba_peak.perfect_season.config`, which is
    where an operator or a test would obviously set it. Reading the attribute at
    call time makes the rollback boundary real rather than aspirational.
    """
    return getattr(_ps_config, "RESPIN_SEASON_EXCLUSION_RADIUS", 0)


def _team_history_depth() -> int:
    """See `_season_exclusion_radius`."""
    return getattr(_ps_config, "RESPIN_TEAM_HISTORY_DEPTH", 0)
from nba_peak.perfect_season.daily import (
    DAILY_BOARD_TYPE,
    FREE_PLAY_BOARD_TYPE,
    daily_seed,
    today_utc_date,
    validate_challenge_date,
)
from nba_peak.perfect_season.exact_season import (
    PlayerSeasonCard,
    component_percentile,
    resolve_exact_card_by_key,
    resolve_player_season_card,
)
from nba_peak.perfect_season.career_positions import career_positions
from nba_peak.perfect_season.positions import (
    STARTER_SLOTS,
    classify_fit,
    classify_fit_from_position,
    classify_fit_severity,
    parse_real_position,
    position_fit_severity,
    primary_position,
    secondary_positions,
)
from nba_peak.perfect_season.schemas import CourtLineupState, CourtSlot
from nba_peak.perfect_season.simulation import (
    _fit_points,
    _weighted_starter_talent,
    provisional_unscored_impact,
    provisional_unscored_percentile,
    simulate_exact_season,
    simulate_season,
)

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
    challenge_date: Optional[str] = None,
) -> CourtLineupState:
    if mode not in VALID_MODES:
        raise ValueError(f"Invalid mode '{mode}'. Valid: {list(VALID_MODES.keys())}")
    # Phase 9A: "daily" joins "practice" as a supported board_type. A daily
    # board is NOT a different engine or a different rule set -- it is the
    # same generator on a seed derived from the calendar date
    # (nba_peak.perfect_season.daily.daily_seed), which is exactly what makes
    # everyone's board identical for a given date. Ranked remains unsupported.
    if board_type not in (FREE_PLAY_BOARD_TYPE, DAILY_BOARD_TYPE):
        raise ValueError(f"board_type '{board_type}' is not supported in this phase")

    if board_type == DAILY_BOARD_TYPE:
        # The seed for a daily board is ALWAYS derived here from the date --
        # never accepted from the caller. Otherwise a client could request
        # board_type="daily" with an arbitrary seed and get a run labeled as
        # "today's shared challenge" that nobody else could reproduce.
        challenge_date = validate_challenge_date(challenge_date or today_utc_date())
        resolved_seed = daily_seed(challenge_date, mode)
        challenge_kind = "daily"
    else:
        challenge_date = None
        resolved_seed = seed if seed is not None else secrets.randbelow(2 ** 31)
        challenge_kind = "free_play"
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
        challenge_kind=challenge_kind,
        challenge_date=challenge_date,
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
# Phase 9B: fit resolution in ONE place.
#
# Root cause this closes: role_fit was computed at four separate call sites
# (action_place_card's two engine branches, pending_card_public, and the
# fit_by_open_slot preview) and severity at NONE of them, so the client had
# no way to tell a 0.0-point "mild" off-position placement from a -14.0-point
# "severe" one and painted both the same alarming orange. These two helpers
# return the (role_fit, severity) pair together so the two values can never
# drift apart, and are the only thing any caller below uses.
# ---------------------------------------------------------------------------

def _exact_fit(card: Optional[PlayerSeasonCard], slot_type: str) -> tuple[Optional[str], Optional[str]]:
    """(role_fit, severity) for an exact-season card in `slot_type` -- the
    LIVE path (COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED is on)."""
    if card is None:
        return None, None
    role_fit = classify_fit_from_position(card.position, slot_type, card.player_slug)
    if role_fit != "off_position":
        return role_fit, None
    return role_fit, position_fit_severity(slot_type, parse_real_position(card.position)[0])


def _legacy_fit(player_slug: Optional[str], archetype: Optional[str], slot_type: str) -> tuple[str, Optional[str]]:
    """(role_fit, severity) for a legacy peak-window card in `slot_type`."""
    return (
        classify_fit(player_slug, archetype, slot_type),
        classify_fit_severity(player_slug, archetype, slot_type),
    )


def _display_positions(player_slug: Optional[str], listed_primary: Optional[str]) -> list[str]:
    """The OTHER real positions this player played, for the card's
    "SF / SG / PF" position line -- ordered PG..C so the line is stable.

    Phase 9B: this used to come from parse_real_position's secondary tuple,
    which is always empty for the committed data (see that function's own
    note), so every exact-season card rendered a bare single position and
    real multi-position players looked position-locked. Real data now, from
    career_positions -- never a guess, and the listed primary is excluded
    since it is rendered separately as `primary_position`."""
    career = career_positions(player_slug)
    return [p for p in STARTER_SLOTS if p in career and p != listed_primary]


def _legacy_display_positions(card) -> list[str]:
    """_display_positions for a legacy peak-window CardProfile: the curated
    POSITION_OVERRIDES/archetype secondaries unioned with real career
    positions, so the legacy engine's cards get the same honest multi-position
    line as exact-season cards."""
    primary = primary_position(card.player_slug, card.primary_role)
    curated = set(secondary_positions(card.player_slug, card.primary_role))
    career = career_positions(card.player_slug)
    return [p for p in STARTER_SLOTS if (p in curated or p in career) and p != primary]


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
        slot.role_fit, slot.role_fit_severity = _exact_fit(placed_card, slot_type)
    else:
        slot.peak_window_id = state.pending_selection_peak_window_id
        placed_card = resolve_card_by_window_id(state, slot.peak_window_id)
        slot.role_fit, slot.role_fit_severity = _legacy_fit(
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


def _recompute_slot_fit(state: CourtLineupState, slot: CourtSlot) -> None:
    """Re-derive (role_fit, role_fit_severity) for `slot` from whatever card
    is currently sitting in it. Called after a rearrange -- the whole point
    of moving a card is that its fit changes, so a stale role_fit copied
    along with the card would defeat the feature."""
    if slot.exact_player_season_key:
        slot.role_fit, slot.role_fit_severity = _exact_fit(
            resolve_exact_card_by_key(slot.exact_player_season_key), slot.slot_type
        )
    elif slot.peak_window_id:
        card = resolve_card_by_window_id(state, slot.peak_window_id)
        slot.role_fit, slot.role_fit_severity = _legacy_fit(
            card.player_slug if card else None,
            card.primary_role if card else None,
            slot.slot_type,
        )
    else:
        slot.role_fit = None
        slot.role_fit_severity = None


# Every identity/provenance field that belongs to the CARD, not to the SLOT.
# Swapping is defined as exchanging exactly this tuple between two slots --
# enumerated explicitly so a future CourtSlot field can't be silently left
# behind (which would strand a card's provenance in the wrong slot).
_SWAPPABLE_CARD_FIELDS = (
    "exact_player_season_key",
    "peak_window_id",
    "round_number",
    "resolved_via_spin_id",
)


def action_swap_slots(state: CourtLineupState, slot_a: str, slot_b: str) -> CourtLineupState:
    """Move/swap already-placed cards between two slots, WITHOUT respinning.

    Phase 9B: users could see that a placement was off-position but had no
    way to act on it -- the only levers were respins (which reroll the
    team+season and cost a run-level budget) or starting over. Rearranging
    is a pure roster-optimization move: it consumes no budget, touches
    neither the board nor any spin, and can never add or remove a card. The
    only thing it changes is which slot each already-earned card occupies,
    and therefore each card's position fit.

    Rules:
      * both slot_type values must be real slots (config.SLOT_TYPES);
      * they must differ, and at least one must be filled (swapping two
        empty slots is a no-op, and silently accepting it would let a client
        believe it had done something);
      * the card identity fields move together (_SWAPPABLE_CARD_FIELDS),
        including round_number/resolved_via_spin_id so the receipt keeps
        pointing at the round that actually produced the card;
      * role_fit AND role_fit_severity are RECOMPUTED for both slots from
        their new positions, never carried over;
      * allowed while selection_pending / placement_pending / rounds_complete
        -- including mid-run, and including with a selection pending (a
        rearrange is orthogonal to the pending pick and leaves it alone);
      * REJECTED once status == "result_ready". A submitted/simulated result
        is the saved and shared artifact; letting the roster shift under a
        frozen simulation_result would make a shared scorecard describe a
        roster that no longer exists.
    """
    if state.status == "result_ready":
        raise CourtError(
            "rearrange_after_result",
            "This run is already simulated -- its roster is frozen. Rearranging is only "
            "available before you lock the roster and simulate.",
        )
    if state.status not in ("selection_pending", "placement_pending", "rounds_complete"):
        raise CourtError("rearrange_not_allowed", f"Cannot rearrange in status '{state.status}'")

    for slot_type in (slot_a, slot_b):
        if slot_type not in SLOT_TYPES:
            raise CourtError("invalid_slot", f"Unknown slot_type '{slot_type}'")
    if slot_a == slot_b:
        raise CourtError("invalid_swap", "Cannot swap a slot with itself")

    a = next((s for s in state.slots if s.slot_type == slot_a), None)
    b = next((s for s in state.slots if s.slot_type == slot_b), None)
    if a is None or b is None:
        raise CourtError("invalid_slot", f"Unknown slot_type '{slot_a}' or '{slot_b}'")

    def _is_filled(slot: CourtSlot) -> bool:
        return slot.peak_window_id is not None or slot.exact_player_season_key is not None

    if not _is_filled(a) and not _is_filled(b):
        raise CourtError("no_card_to_move", "Neither slot has a card to move")

    for field_name in _SWAPPABLE_CARD_FIELDS:
        a_value = getattr(a, field_name)
        setattr(a, field_name, getattr(b, field_name))
        setattr(b, field_name, a_value)

    _recompute_slot_fit(state, a)
    _recompute_slot_fit(state, b)

    state.last_action_at = datetime.now(timezone.utc).isoformat()
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


# ---------------------------------------------------------------------------
# Distance-aware respin policy (W5, UX/organization/polish pass).
#
# WHAT WAS WRONG. Both respin kinds narrowed to a constrained pool
# (same-season-other-team / same-team-other-season) and then, if that pool
# could not produce an entry within 30 probe attempts, fell back to the FULL
# rollable catalogue -- which still contained the entry the player was
# rerolling away from. So a respin could legitimately land on the identical
# team-season. And nothing anywhere looked at how FAR the new result was
# from the old one: 1991-92 -> 1992-93 was a perfectly ordinary outcome that
# reads to a player as "the reroll did nothing".
#
# WHAT THIS DOES INSTEAD. Build an explicit ladder of allowed pools, most
# restrictive first, drop down a rung only when a rung's allowed pool falls
# below MIN_RESPIN_POOL, then sample UNIFORMLY over whichever rung was
# chosen. No era is weighted. No franchise is favoured. Nothing is
# hand-picked. The only thing the policy does is refuse to hand back a
# result that is too close to the one just seen, and it records exactly
# which rung it used and how big that rung's pool was.
#
# WHAT IT DOES NOT TOUCH. Initial board generation. generate_team_year_board
# is not called, not imported differently, and not parameterised by any of
# these constants -- daily boards and every existing seed stay byte-identical
# (pinned by test_initial_board_generation_is_unchanged_by_respin_policy).
# ---------------------------------------------------------------------------


def _feasible(entry: dict, used_slugs: set[str]) -> bool:
    """An entry is feasible iff at least one of its real roster candidates is
    not already on this roster. The MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON
    floor is already guaranteed by the catalogue accessor, so this is the
    only additional constraint a respin has to preserve."""
    return any(slug not in used_slugs for slug in entry.get("player_slugs", ()))


def _shuffle_bag_pick(pool: list[dict], rng: random.Random) -> Optional[dict]:
    """Uniform draw over an ALREADY-FILTERED allowed pool, via a deterministic
    shuffle bag rather than repeated independent probing.

    Why not `pool[rng.randrange(len(pool))]`: mathematically identical for a
    single draw, but the bag makes the "no repeated independent draws"
    property structural -- there is exactly one draw per respin, over a pool
    that has already had every disallowed entry removed, so an excluded entry
    is unreachable by construction instead of merely improbable. The old code
    probed the pool up to 30 times and silently widened to the full catalogue
    when the probes failed, which is precisely how the current entry got back
    in.
    """
    if not pool:
        return None
    bag = list(pool)
    rng.shuffle(bag)
    return bag[0]


def _radius_ladder(radius: int) -> list[int]:
    """[2, 1, 0] for radius 2; [1, 0] for radius 1; [0] for radius 0."""
    return sorted({radius, min(radius, 1), 0}, reverse=True)


def _recent_team_ids(state: CourtLineupState, spin, entries: list[dict]) -> list[str]:
    """Team ids already seen in this run, MOST RECENT FIRST, excluding the
    current one (which the policy always excludes separately).

    Derived from two real sources, exactly as specified: `respin_history`
    (which was previously written and never read -- this is the first thing
    that reads it) and the run's already-resolved spins. respin_history
    stores franchise DISPLAY NAMES, so they are mapped back to team ids
    through the catalogue; a name that no longer maps is dropped rather than
    guessed at.
    """
    name_to_id = {e["franchise_display_name"]: e["team_id"] for e in entries}
    ordered: list[str] = []

    def push(team_id: Optional[str]) -> None:
        if team_id and team_id != spin.team_id and team_id not in ordered:
            ordered.append(team_id)

    # Most recent respin first; within one entry, the team it landed on is
    # more recent than the team it came from.
    for record in reversed(state.respin_history):
        if record.get("round") != state.current_round:
            continue
        push(name_to_id.get(record.get("to_team")))
        push(name_to_id.get(record.get("from_team")))
    for record in reversed(state.respin_history):
        push(name_to_id.get(record.get("to_team")))
        push(name_to_id.get(record.get("from_team")))
    # Then the run's already-resolved rounds, latest round first.
    for prior in sorted(state.board.spins, key=lambda s: s.round_number, reverse=True):
        if prior.round_number >= state.current_round:
            continue
        push(prior.team_id)
    return ordered


def plan_respin(
    kind: str,
    entries: list[dict],
    current: dict,
    used_slugs: set[str],
    recent_team_ids: list[str],
    season_index: dict[str, int],
    rng: random.Random,
) -> tuple[Optional[dict], dict]:
    """The whole policy, as one pure function.

    Pure so it can be exercised 100,000 times in
    scripts/audit_spinner_reroll_policy.py without constructing a game, and
    so the relaxation ladder can be tested against a deliberately tiny pool.

    Returns (chosen_entry, metadata). `metadata` always describes what
    actually happened, including on the no-option path.
    """
    current_team = current.get("team_id")
    current_season = current.get("era_label")
    current_spin_id = current.get("spin_id")
    s = season_index.get(current_season)

    tiers: list[tuple[str, int, int, list[dict]]] = []  # (tier, radius, depth, pool)

    if kind == "season":
        # Season respin. The product promise is "same team in a different
        # season if the team has roster data that year", so same-team tiers
        # are tried first at every radius before broadening to other teams.
        def far_enough(entry: dict, radius: int) -> bool:
            if s is None:
                return entry.get("era_label") != current_season
            other = season_index.get(entry.get("era_label"))
            if other is None:
                return True
            return abs(other - s) > radius

        for radius in _radius_ladder(_season_exclusion_radius()):
            tiers.append((
                f"same_team_radius_{radius}", radius, 0,
                [e for e in entries if e["team_id"] == current_team and far_enough(e, radius)],
            ))
        for radius in _radius_ladder(_season_exclusion_radius()):
            tiers.append((
                f"any_team_radius_{radius}", radius, 0,
                [e for e in entries if e["spin_id"] != current_spin_id and far_enough(e, radius)],
            ))
    else:
        # Team respin. The current team is excluded at EVERY tier -- only the
        # recent-history depth relaxes -- so "the respin gave me the same
        # team back" is structurally impossible, not just unlikely.
        def allowed_team(entry: dict, depth: int) -> bool:
            team_id = entry["team_id"]
            if team_id == current_team:
                return False
            return team_id not in recent_team_ids[:depth]

        _depth = _team_history_depth()
        depths = sorted({_depth, min(_depth, 1), 0}, reverse=True)
        for depth in depths:
            tiers.append((
                f"same_season_depth_{depth}", 0, depth,
                [e for e in entries if e["era_label"] == current_season and allowed_team(e, depth)],
            ))
        for depth in depths:
            tiers.append((
                f"any_season_depth_{depth}", 0, depth,
                [e for e in entries if allowed_team(e, depth)],
            ))

    best_fallback: Optional[tuple[str, int, int, list[dict]]] = None
    for tier_index, (tier, radius, depth, pool) in enumerate(tiers):
        allowed = [e for e in pool if _feasible(e, used_slugs)]
        if not allowed:
            continue
        # FIRST non-empty rung wins the fallback, not the widest.
        #
        # The tiers are ordered most-restrictive-first, and the rungs nest
        # (`depth_0` contains `depth_1` contains `depth_2`), so "widest
        # non-empty" was always the LEAST restrictive rung -- it threw away the
        # distance and recent-history guarantees even when a stricter rung had
        # candidates in it. When every rung is under MIN_RESPIN_POOL the honest
        # choice is the strictest rung that can still produce a result.
        if best_fallback is None:
            best_fallback = (tier, radius, depth, allowed)
        if len(allowed) >= MIN_RESPIN_POOL:
            return _shuffle_bag_pick(allowed, rng), {
                "policy_version": RESPIN_POLICY_VERSION,
                "kind": kind,
                "relaxation_tier": tier,
                "tier_index": tier_index,
                "exclusion_radius": radius,
                "history_depth": depth,
                "allowed_pool_size": len(allowed),
                "min_respin_pool": MIN_RESPIN_POOL,
                "relaxed": tier_index > 0,
            }

    if best_fallback is None:
        return None, {
            "policy_version": RESPIN_POLICY_VERSION,
            "kind": kind,
            "relaxation_tier": "none",
            "tier_index": -1,
            "exclusion_radius": 0,
            "history_depth": 0,
            "allowed_pool_size": 0,
            "min_respin_pool": MIN_RESPIN_POOL,
            "relaxed": True,
        }

    # Every rung was under the floor. Use the widest one that had anything in
    # it at all rather than failing the respin -- an under-floor pool is a
    # real data-coverage limit, and a smaller-than-ideal honest draw beats
    # refusing the player's reroll.
    tier, radius, depth, allowed = best_fallback
    return _shuffle_bag_pick(allowed, rng), {
        "policy_version": RESPIN_POLICY_VERSION,
        "kind": kind,
        "relaxation_tier": tier,
        "tier_index": [t[0] for t in tiers].index(tier),
        "exclusion_radius": radius,
        "history_depth": depth,
        "allowed_pool_size": len(allowed),
        "min_respin_pool": MIN_RESPIN_POOL,
        "relaxed": True,
        "below_min_pool": True,
    }


def _policy_enabled() -> bool:
    """False only when BOTH policy constants are 0 -- the documented rollback
    boundary. In that state the actions below take the verbatim pre-policy
    code path (same pools, same `_pick_valid_entry` probing, same rng call
    sequence), so rolling back is provable rather than approximate."""
    return _season_exclusion_radius() > 0 or _team_history_depth() > 0


#: How many applied respin keys to remember per kind.
#:
#: A single remembered key was not enough. Keys are derived per respin
#: (`{game}:r{round}:{kind}:{used}`), so respin #2 overwrote respin #1's key and
#: a DELAYED duplicate of #1 -- a mobile TCP retransmit, a proxy replay, a second
#: tab -- was no longer recognised. It would pass validation, burn a third
#: respin out of a run-level budget of three, and reroll the board the player
#: had already accepted.
#:
#: Six is the whole budget (MAX_TEAM_RESPINS + MAX_SEASON_RESPINS), so within a
#: run no legitimate key can ever be evicted.
_RESPIN_KEY_MEMORY = 6


def _remembered_respin_keys(state: CourtLineupState, kind: str) -> list[str]:
    """Applied keys for `kind`, oldest first.

    Tolerates the pre-existing single-string shape so a game persisted before
    this change still replays correctly rather than raising on load.
    """
    raw = state.last_respin_keys.get(kind)
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    return list(raw)


def _replayed_respin(state: CourtLineupState, kind: str, idempotency_key: Optional[str]) -> bool:
    """True when this exact respin has already been applied.

    Checked BEFORE any validation, deliberately: a replay must return the
    current state untouched even if the game has since moved on (the player
    selected a player, the round advanced), because the caller is retrying an
    action the server already honoured -- not requesting a new one.
    """
    if not idempotency_key:
        return False
    return idempotency_key in _remembered_respin_keys(state, kind)


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


def _apply_respin(
    state: CourtLineupState,
    spin,
    kind: str,
    new_entry: dict,
    policy_meta: dict,
    idempotency_key: Optional[str],
) -> CourtLineupState:
    """Commit one respin: mutate the spin, charge the run-level budget, and
    append BOTH receipts (the player-visible respin_history entry, whose key
    set is frozen by test_respin_history_recorded_and_budget_carries_over_
    next_round, and the separate policy debug entry)."""
    from_team, from_season = spin.franchise_display_name, spin.era_label
    _apply_respin_entry(spin, new_entry)
    if kind == "team":
        state.team_respins_used += 1
    else:
        state.season_respins_used += 1
    state.respin_history.append({
        "round": state.current_round, "kind": kind,
        "from_team": from_team, "from_season": from_season,
        "to_team": spin.franchise_display_name, "to_season": spin.era_label,
    })
    state.respin_policy_debug.append({
        **policy_meta,
        "round": state.current_round,
        "from_season": from_season,
        "to_season": spin.era_label,
        "from_team": from_team,
        "to_team": spin.franchise_display_name,
    })
    if idempotency_key:
        # Append to a bounded ledger rather than overwrite -- see _RESPIN_KEY_MEMORY.
        remembered = _remembered_respin_keys(state, kind)
        remembered.append(idempotency_key)
        state.last_respin_keys[kind] = remembered[-_RESPIN_KEY_MEMORY:]
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


def action_respin_team(
    state: CourtLineupState, idempotency_key: Optional[str] = None
) -> CourtLineupState:
    """Reroll the current round's TEAM.

    Keeps the same season whenever another team has a rollable roster for it
    (Part C: 'same season if valid for new team, or reroll to a valid
    team-season pair if that team did not exist in that season'), and on top
    of that never returns the current team, and prefers to avoid the most
    recent RESPIN_TEAM_HISTORY_DEPTH teams already seen this run.

    IDEMPOTENT BY KEY: resending the same `idempotency_key` returns the
    current state unchanged instead of consuming a second respin, so a
    double-click or a retried fetch cannot burn two of the three.
    """
    if _replayed_respin(state, "team", idempotency_key):
        return state
    spin = _assert_respin_allowed(state)
    if state.team_respins_used >= MAX_TEAM_RESPINS:
        raise CourtError("respin_limit_reached", "No team respins left this round")

    rng = _respin_rng(state, "team", state.team_respins_used)
    used_slugs = _used_player_slugs(state)

    if not _policy_enabled():
        # Documented rollback path -- verbatim pre-policy behaviour.
        entries = get_rollable_team_year_entries()
        same_season_other_team = [
            e for e in entries if e["era_label"] == spin.era_label and e["team_id"] != spin.team_id
        ]
        new_entry = _pick_valid_entry(same_season_other_team, used_slugs, rng, entries)
        policy_meta = {"policy_version": "legacy_pre_policy", "kind": "team"}
    else:
        entries = get_rollable_team_year_catalogue()
        new_entry, policy_meta = plan_respin(
            "team",
            entries,
            {"team_id": spin.team_id, "era_label": spin.era_label, "spin_id": spin.spin_id},
            used_slugs,
            _recent_team_ids(state, spin, entries),
            get_rollable_season_index(),
            rng,
        )

    if new_entry is None:
        raise CourtError("respin_no_valid_option", "No valid team-season available for a respin right now")
    return _apply_respin(state, spin, "team", new_entry, policy_meta, idempotency_key)


def action_respin_season(
    state: CourtLineupState, idempotency_key: Optional[str] = None
) -> CourtLineupState:
    """Reroll the current round's SEASON.

    Keeps the same team whenever it has a rollable roster in another season
    (Part C: 'same team if the team has roster data that year'), and on top
    of that excludes every season within RESPIN_SEASON_EXCLUSION_RADIUS
    indices of the current one whenever enough seasons remain -- so
    1991-92 -> 1992-93 stops being an ordinary outcome.

    IDEMPOTENT BY KEY -- see action_respin_team.
    """
    if _replayed_respin(state, "season", idempotency_key):
        return state
    spin = _assert_respin_allowed(state)
    if state.season_respins_used >= MAX_SEASON_RESPINS:
        raise CourtError("respin_limit_reached", "No season respins left this round")

    rng = _respin_rng(state, "season", state.season_respins_used)
    used_slugs = _used_player_slugs(state)

    if not _policy_enabled():
        # Documented rollback path -- verbatim pre-policy behaviour.
        entries = get_rollable_team_year_entries()
        same_team_other_season = [
            e for e in entries if e["team_id"] == spin.team_id and e["era_label"] != spin.era_label
        ]
        new_entry = _pick_valid_entry(same_team_other_season, used_slugs, rng, entries)
        policy_meta = {"policy_version": "legacy_pre_policy", "kind": "season"}
    else:
        entries = get_rollable_team_year_catalogue()
        new_entry, policy_meta = plan_respin(
            "season",
            entries,
            {"team_id": spin.team_id, "era_label": spin.era_label, "spin_id": spin.spin_id},
            used_slugs,
            [],
            get_rollable_season_index(),
            rng,
        )

    if new_entry is None:
        raise CourtError("respin_no_valid_option", "No valid team-season available for a respin right now")
    return _apply_respin(state, spin, "season", new_entry, policy_meta, idempotency_key)


def _compute_peak_picks_recap(state: CourtLineupState, team_year_board: bool) -> list[dict]:
    """Phase 8H: "what PEAK3 would have picked" -- for each round, the
    highest-scored candidate actually AVAILABLE at that moment (excluding
    whatever earlier rounds already used), compared against what the
    player actually picked. Only ever called once the roster is complete
    (action_complete_game, after the real reveal gate has already opened),
    so this is an honest extension of the same reveal, never a pre-pick
    leak -- ADR-005 Decision 6 is about withholding scores from the
    CURRENT round's own live candidate list before a pick is made; this
    runs only after every card's real score is already being shown.

    Never fabricates a reason -- the "why" is always the real, computed
    metric (highest score among the round's then-available candidates),
    stated plainly rather than inventing narrative flavor text the model
    didn't actually compute."""
    recap: list[dict] = []
    used_slugs: set[str] = set()
    slots_by_spin = {s.resolved_via_spin_id: s for s in state.slots if s.resolved_via_spin_id}

    for spin in sorted(state.board.spins, key=lambda s: s.round_number):
        slot = slots_by_spin.get(spin.spin_id)
        if slot is None:
            continue

        if team_year_board:
            picked_card = resolve_exact_card_by_key(slot.exact_player_season_key) if slot.exact_player_season_key else None
            picked_name = picked_card.player_name if picked_card else None
            picked_score = picked_card.season_score if picked_card else None
            picked_slug = picked_card.player_slug if picked_card else None

            best_slug, best_name, best_score = None, None, None
            for slug in spin.candidate_player_slugs:
                if slug in used_slugs:
                    continue
                card = resolve_player_season_card(slug, spin.team_id, spin.era_label)
                if card is None or card.season_score is None:
                    continue
                if best_score is None or card.season_score > best_score:
                    best_slug, best_name, best_score = slug, card.player_name, card.season_score
        else:
            picked_card = resolve_card_by_window_id(state, slot.peak_window_id) if slot.peak_window_id else None
            picked_name = picked_card.player_name if picked_card else None
            picked_score = picked_card.individual_peak_score if picked_card else None
            picked_slug = picked_card.player_slug if picked_card else None

            best_slug, best_name, best_score = None, None, None
            for slug in spin.candidate_player_slugs:
                if slug in used_slugs:
                    continue
                card = resolve_card(slug, state.duration_years)
                if card is None:
                    continue
                if best_score is None or card.individual_peak_score > best_score:
                    best_slug, best_name, best_score = slug, card.player_name, card.individual_peak_score

        if picked_slug:
            used_slugs.add(picked_slug)

        if best_slug is None:
            # No scored candidate was available this round (e.g. every
            # option was roster-only/unscored) -- an honest data gap, not
            # a fabricated recommendation.
            continue

        recap.append({
            "round_number": spin.round_number,
            "slot_type": slot.slot_type,
            "picked_player_name": picked_name,
            "picked_score": round(picked_score, 1) if picked_score is not None else None,
            "peak_pick_player_name": best_name,
            "peak_pick_score": round(best_score, 1) if best_score is not None else None,
            "matched": best_slug == picked_slug,
        })

    return recap


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
        state.simulation_result.peak_picks_recap = _compute_peak_picks_recap(state, team_year_board=True)
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
        state.simulation_result.peak_picks_recap = _compute_peak_picks_recap(state, team_year_board=False)

    state.status = "result_ready"
    state.last_action_at = datetime.now(timezone.utc).isoformat()
    return state


# ---------------------------------------------------------------------------
# Phase 9A: leaderboard eligibility, computed in ONE place.
#
# Root cause this closes: "is this run leaderboard-eligible" was decided
# independently in three places that could drift -- the submit endpoint
# (which raised incomplete_score_not_eligible), the frontend panel (which
# re-derived it from lineup_score_status), and the result copy. They agreed
# only by coincidence. These helpers are now the single source of truth,
# surfaced on the public state so the UI never has to re-derive the rule.
#
# The rule itself (unchanged in substance, only centralized):
#   - The OFFICIAL leaderboard requires a fully-scored roster. A run with any
#     unscored/provisional card is not eligible -- its projected record uses
#     conservative provisional impact (Phase 8K), which is an honest estimate
#     but not an official, comparable score.
#   - Ineligibility is never a reason to block PLAY, SAVING, SHARING, or
#     DOWNLOADING a run. A provisional run is a real run; it just isn't a
#     ranked one.
#   - Durable submission additionally requires a real signed-in account,
#     enforced at the route (not here) since this layer has no auth context.
# ---------------------------------------------------------------------------

ELIGIBILITY_COMPLETE = "eligible"
ELIGIBILITY_INCOMPLETE_SCORE = "incomplete_score"
ELIGIBILITY_NOT_COMPLETE = "game_not_complete"


def placed_cards_all_scored(state: CourtLineupState) -> bool:
    """True when every placed slot has a real official PEAK3 score. Always
    True for legacy peak-window boards (no unscored state exists at that
    grain -- see simulation.py::_best_pick's own note)."""
    if state.board.experimental_team_year_data_version is None:
        return True
    for slot in state.slots:
        if not slot.exact_player_season_key:
            return False
        card = resolve_exact_card_by_key(slot.exact_player_season_key)
        if card is None or card.score_status != "exact_season_scored":
            return False
    return True


def compute_eligibility(state: CourtLineupState) -> dict:
    """The one definition of leaderboard eligibility for a PEAK Season run.

    Returns a plain dict (same at-the-API-boundary convention as
    LineupFitComponents.as_dict()): `leaderboard_eligible` plus a stable
    machine-readable `reason` code and a human-readable `reason_detail` the
    UI can show verbatim instead of composing its own wording.
    """
    if state.status != "result_ready" or state.simulation_result is None:
        return {
            "leaderboard_eligible": False,
            "reason": ELIGIBILITY_NOT_COMPLETE,
            "reason_detail": "This run has not been completed and simulated yet.",
            # Saving/sharing are gated on completion too -- there is no
            # finished result to save before this point.
            "savable": False,
        }
    if not placed_cards_all_scored(state):
        return {
            "leaderboard_eligible": False,
            "reason": ELIGIBILITY_INCOMPLETE_SCORE,
            "reason_detail": (
                "One or more cards have no official PEAK3 score for that exact season, so this run's "
                "projected record uses conservative provisional impact. You can still save, share, and "
                "download it -- it just isn't eligible for the official leaderboard."
            ),
            # Explicitly savable: a provisional run belongs in your own
            # history even though it can never be ranked.
            "savable": True,
        }
    return {
        "leaderboard_eligible": True,
        "reason": ELIGIBILITY_COMPLETE,
        "reason_detail": "Every card has an official PEAK3 score -- this run is eligible for the leaderboard.",
        "savable": True,
    }


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

    # Phase 8K: an unscored placed card still contributes a conservative
    # provisional impact here, same as the final simulate_exact_season() --
    # otherwise this mid-run estimate would read as more optimistic than
    # the real result it's supposed to preview (see simulation.py's
    # provisional_unscored_impact for the full rationale).
    starter_scores = [
        c.season_score if c.season_score is not None else provisional_unscored_impact(c)
        for st in STARTER_SLOT_TYPES
        if (c := cards_by_slot.get(st)) is not None
    ]
    bench_scores = [
        c.season_score if c.season_score is not None else provisional_unscored_impact(c)
        for st in BENCH_SLOT_TYPES
        if (c := cards_by_slot.get(st)) is not None
    ]
    if not starter_scores and not bench_scores:
        return None
    # Phase 8: reuse the same peak-weighted starter aggregate as the real
    # simulator (simulation.py::_weighted_starter_talent) -- keeping this
    # mid-run estimate on the exact same formula as the final result is the
    # whole point of this function (see docstring above).
    starter_talent = _weighted_starter_talent(starter_scores)
    talent_core = (
        starter_talent * 0.8 + (sum(bench_scores) / len(bench_scores)) * 0.2
        if starter_scores and bench_scores
        else (starter_talent if starter_scores else sum(bench_scores) / len(bench_scores))
    )
    bench_strength = (sum(bench_scores) / len(bench_scores)) if bench_scores else 50.0

    # Phase 9B bug fix: this used to call _FIT_POINTS.get(label, 0.0) with NO
    # severity, so every off-position placement scored 0.0 here while the
    # real simulator charged -5.0 (moderate) / -14.0 (severe) for the same
    # roster -- i.e. the mid-run projection was systematically optimistic
    # about exactly the mistake this projection exists to warn about. Now
    # uses simulation._fit_points, the same severity-aware function
    # compute_exact_fit_components itself calls, so the two can't disagree.
    fit_points = []
    for slot_type in STARTER_SLOT_TYPES:
        card = cards_by_slot.get(slot_type)
        if card is None:
            continue
        role_fit, severity = _exact_fit(card, slot_type)
        fit_points.append(_fit_points(role_fit or "off_position", severity))
    positional_fit = max(0.0, min(100.0, 50.0 + sum(fit_points))) if fit_points else 50.0

    # Phase 8K: same provisional-percentile fallback as compute_exact_fit_
    # components -- an unscored placed card contributes a conservative
    # estimate here too, rather than vanishing from the average.
    def _avg_percentile(column: str) -> float:
        values = []
        for c in cards_by_slot.values():
            p = component_percentile(c.player_slug, c.team_id, c.season, column) if c.season_score is not None else None
            values.append(p if p is not None else provisional_unscored_percentile(c))
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
                 if _is_team_year_spin(spin) else _candidate_public(slug, state.duration_years, include_asset_urls))
                for slug in spin.candidate_player_slugs
                if slug not in _used_player_slugs(state)
            ],
        }
        # Phase 8F: team_logo_url used to be set ONLY inside the team_year
        # branch below (via team_id, which only team_year spins carry) --
        # the DEFAULT engine's spins (team_decade/exact_team_season, what
        # CourtBuilder actually runs by default) never got a logo at all,
        # even with the asset flag on, because they have no team_id (the
        # interim dataset only carries franchise_display_name). Resolved by
        # name instead for every non-team_year spin type -- same real,
        # already-verified team_assets.v2.json entries, just a second
        # lookup key (get_team_logo_url_by_name). open_pool spins have no
        # real team at all, so this correctly stays None for those.
        if include_asset_urls and spin.spin_type != "open_pool":
            current_spin_public["team_logo_url"] = (
                get_team_logo_url(spin.team_id) if _is_team_year_spin(spin)
                else get_team_logo_url_by_name(spin.franchise_display_name)
            )
        if _is_team_year_spin(spin):
            current_spin_public["team_id"] = spin.team_id
            current_spin_public["candidate_source"] = "exact_team_season"
            current_spin_public["data_version"] = state.board.experimental_team_year_data_version
            current_spin_public["coverage_mode"] = state.board.metadata.get("coverage_mode")
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
            primary, _unused_secondary = parse_real_position(card.position)
            pending_card_public = {
                "exact_player_season_key": card.exact_player_season_key,
                "player_name": card.player_name,
                "team_id": card.team_id,
                "team_name": card.team_name,
                "season": card.season,
                # No score here either -- still not locked into a slot yet.
                "primary_position": primary,
                # Phase 9B: real career positions, not parse_real_position's
                # always-empty secondary tuple -- see _display_positions.
                "secondary_positions": _display_positions(card.player_slug, primary),
                "identity_pool_status": card.identity_pool_status,
                "score_status": card.score_status,
                "score_source": card.score_source,
                # Phase 9B: carries role_fit AND its severity per open slot
                # (was a bare label), so the placement preview can distinguish
                # a free "Flex fit" from a "Structural mismatch". Deliberately
                # a widened value on the SAME key rather than a sibling key --
                # pending_selection's key set is contract-tested.
                "fit_by_open_slot": {
                    slot_type: dict(zip(("role_fit", "role_fit_severity"), _exact_fit(card, slot_type)))
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
                "secondary_positions": _legacy_display_positions(card),
                "fit_by_open_slot": {
                    slot_type: dict(zip(
                        ("role_fit", "role_fit_severity"),
                        _legacy_fit(card.player_slug, card.primary_role, slot_type),
                    ))
                    for slot_type in get_open_slot_types(state)
                },
            }
            # Phase 8E: this peak-window pending-selection branch was missing
            # headshot_url entirely (the exact-season branch just above it,
            # for state.pending_selection_exact_season_key, already had it)
            # -- same class of gap as _candidate_public's, just one call site
            # over. get_player_headshot_url is a pure slug lookup, so it
            # resolves identically regardless of peak-window vs exact-season.
            if include_asset_urls:
                pending_card_public["headshot_url"] = get_player_headshot_url(card.player_slug)

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
                primary, _unused_secondary = parse_real_position(card.position)
                entry.update({
                    "exact_player_season_key": card.exact_player_season_key,
                    "player_name": card.player_name,
                    "team_id": card.team_id,
                    "team_name": card.team_name,
                    "season": card.season,
                    "role_fit": slot.role_fit,
                    # Phase 9B: emitted next to role_fit so the client can
                    # label the three off-position tiers by their real cost
                    # (free / -5 / -14) instead of one alarming pill for all
                    # three. None whenever role_fit != "off_position".
                    "role_fit_severity": slot.role_fit_severity,
                    "resolved_via_spin_id": slot.resolved_via_spin_id,
                    "primary_position": primary,
                    "secondary_positions": _display_positions(card.player_slug, primary),
                    "identity_pool_status": card.identity_pool_status,
                    "score_status": card.score_status,
                    "score_source": card.score_source,
                })
                if include_asset_urls:
                    entry["headshot_url"] = get_player_headshot_url(card.player_slug)
                    entry["team_logo_url"] = get_team_logo_url(card.team_id)
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
                    "role_fit_severity": slot.role_fit_severity,
                    "resolved_via_spin_id": slot.resolved_via_spin_id,
                    # Lets the UI explain an off-position placement ("plays
                    # SF") rather than just flagging it as off-position with
                    # no context (goal: position eligibility clarity).
                    "primary_position": primary_position(card.player_slug, card.primary_role),
                    "secondary_positions": _legacy_display_positions(card),
                })
                # Phase 8E: same gap as pending_card_public's peak-window
                # branch -- the exact-season filled-slot branch above (line
                # ~783) already had this, the peak-window one never did.
                if include_asset_urls:
                    entry["headshot_url"] = get_player_headshot_url(card.player_slug)
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
            "structural_weakness_detail": r.structural_weakness_detail,
            "weakness_framing": r.weakness_framing,
            "peak_picks_recap": r.peak_picks_recap,
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
        # Phase 9A: which loop this attempt belongs to ("free_play" | "daily")
        # and, for a daily attempt, the daily key (midnight America/Los_Angeles)
        # whose shared seed it uses.
        # The client uses these to label the scorecard ("Daily PEAK Season --
        # July 29, 2026") rather than re-deriving the date from the seed.
        "challenge_kind": state.challenge_kind,
        "challenge_date": state.challenge_date,
        "board_type": state.board.board_type,
        # Phase 9A: leaderboard eligibility, computed server-side in exactly
        # one place (compute_eligibility) so the UI never re-derives the rule
        # and can never disagree with what /submit will actually accept.
        "eligibility": compute_eligibility(state),
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
        # W5: the distance-aware respin policy's identifier and its per-respin
        # debug trail (exclusion radius, recent-team depth, which relaxation
        # rung fired, allowed pool size). Deliberately NOT rendered in the
        # normal UI -- surfaced so tests, the audit script and a support
        # request can prove which pool a given reroll actually sampled from.
        "respin_policy_version": RESPIN_POLICY_VERSION,
        "respin_policy_debug": state.respin_policy_debug,
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


#: Keys of `get_public_state` that a *shared* scorecard must never carry.
#:
#: This set is the whole security argument of `get_shared_result_state`, so it
#: is spelled out rather than inlined, and each entry says why it is here:
#:
#: * `current_spin` / `pending_selection` -- live, mutable, in-progress board
#:   state. A finished run has both as None already; naming them makes the
#:   projection safe by construction rather than safe by coincidence, so a
#:   future status that leaves one populated cannot leak an unplayed board.
#: * `live_build` -- the mid-run running evaluation, same reasoning.
#: * `eligibility` -- the OWNER's leaderboard-submission verdict
#:   (`compute_eligibility`), which is about what *they* are allowed to do
#:   with the run, not about what the run scored. A viewer has no submission
#:   rights to describe.
#: * `respin_policy_debug` -- explicitly documented above as an audit/support
#:   surface that "the normal UI must not render" (it carries sampled pool
#:   sizes). Its own docstring is the reason it does not belong on a link
#:   anyone can open.
SHARED_RESULT_WITHHELD_KEYS = frozenset({
    "current_spin",
    "pending_selection",
    "live_build",
    "eligibility",
    "respin_policy_debug",
})


def get_shared_result_state(
    state: CourtLineupState, include_asset_urls: bool = False
) -> Optional[dict]:
    """The read-only scorecard a *shared results link* may show, or None.

    WHY THIS EXISTS AS A SEPARATE FUNCTION. `GET /perfect-season/games/{id}`
    is owner-only (`_load_owned_lineup`) because possessing an id must not
    grant mutation rights, and the same id is the handle for seven mutators.
    But a *completed* run has always been shareable by link, and that is real
    product behaviour, not an accident of a missing check. Those two facts are
    only compatible if the shared view is a different, narrower thing than the
    game state -- which is what this is.

    THE TWO RULES:

    1. **Completed runs only.** `None` for anything not `result_ready`. An
       in-progress run is a live board; handing one out by id would leak the
       candidate pool of a game someone is still playing, and every score is
       withheld before `result_ready` anyway (see `get_public_state`).
    2. **Withhold by name, not by hope.** Every key in
       `SHARED_RESULT_WITHHELD_KEYS` is removed, whatever its value. See that
       set for the per-key reasoning.

    What remains is the scorecard itself: the eight resolved cards with their
    revealed scores, the simulation result, and the data receipt (seed, card
    pool, formula/coverage versions, respin counts). No owner subject appears
    anywhere in `get_public_state`'s output, so there is nothing to strip on
    that front -- but note that this projection is also the reason the route
    is safe to serve unauthenticated: it returns a *result*, and there is no
    action reachable from it.
    """
    if state.status != "result_ready":
        return None
    public = get_public_state(state, include_asset_urls=include_asset_urls)
    return {k: v for k, v in public.items() if k not in SHARED_RESULT_WITHHELD_KEYS}


def _display_name_for_slug(player_slug: str, duration_years: int) -> str:
    card = resolve_card(player_slug, duration_years)
    return card.player_name if card else player_slug


def _candidate_public(player_slug: str, duration_years: int, include_asset_urls: bool = False) -> dict:
    """Public candidate entry: name + v1 position eligibility hint, never a
    score/rank (ADR-005 Decision 6 -- SpinCandidate has no score field at
    all, enforced at the Pydantic layer too).

    Phase 8E: `include_asset_urls` was missing entirely from this function's
    signature until now -- every non-team_year spin (team_decade,
    exact_team_season, open_pool) routed candidates through here (see the
    `_is_team_year_spin` branch above) and could therefore NEVER show a
    headshot regardless of Settings.ENABLE_EXTERNAL_ASSET_URLS or whether
    the asset manifest actually had a resolved entry for that exact player
    -- verified live (a fresh exact_team_season board for 2024-25 Nuggets
    returned `headshot_url: null` for Nikola Jokic/Jamal Murray even with
    the flag on, despite both being `resolution_status: "resolved"` in
    data/game/assets/player_assets.v3.json with real ESPN URLs). Mirrors
    _candidate_public_exact's own identical gating exactly: same
    conditional, same get_player_headshot_url() lookup, same None-in-every-
    other-case contract the frontend already handles."""
    card = resolve_card(player_slug, duration_years)
    if card is None:
        return {"player_slug": player_slug, "player_name": player_slug, "primary_position": None, "secondary_positions": []}
    entry = {
        "player_slug": player_slug,
        "player_name": card.player_name,
        "primary_position": primary_position(card.player_slug, card.primary_role),
        "secondary_positions": _legacy_display_positions(card),
    }
    if include_asset_urls:
        entry["headshot_url"] = get_player_headshot_url(player_slug)
    return entry


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
    primary, _unused_secondary = parse_real_position(card.position)
    entry = {
        "player_slug": player_slug,
        "player_name": card.player_name,
        "team_id": card.team_id,
        "team_name": card.team_name,
        "season": card.season,
        "primary_position": primary,
        # Phase 9B: the other positions this player really played (see
        # state._display_positions) -- previously always [], which is why a
        # multi-position candidate rendered a bare single-position badge.
        "secondary_positions": _display_positions(card.player_slug, primary),
        "identity_pool_status": card.identity_pool_status,
        "score_status": card.score_status,
        "score_source": card.score_source,
    }
    if include_asset_urls:
        entry["headshot_url"] = get_player_headshot_url(player_slug)
    return entry
