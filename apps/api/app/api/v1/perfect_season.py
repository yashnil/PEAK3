"""82-0 Peak Season / CourtBuilder API endpoints (Phase 5C vertical slice).

Routes:
  GET  /api/v1/perfect-season/readiness           - safe diagnostic (no auth)
  POST /api/v1/perfect-season/games               - create a new practice game
  GET  /api/v1/perfect-season/games/{id}          - get current public state
  POST /api/v1/perfect-season/games/{id}/select   - select a candidate player
  POST /api/v1/perfect-season/games/{id}/cancel   - cancel the pending selection, back to candidates
  POST /api/v1/perfect-season/games/{id}/respin-team   - reroll the round's team (up to 3x, team_year only)
  POST /api/v1/perfect-season/games/{id}/respin-season - reroll the round's season (up to 3x, team_year only)
  POST /api/v1/perfect-season/games/{id}/place    - place the pending selection into a slot
  POST /api/v1/perfect-season/games/{id}/swap-slots    - move/swap two placed cards (no respin)
  POST /api/v1/perfect-season/games/{id}/complete - run the v0 simulation and freeze the result

No exact PEAK3 score/rank for any un-placed candidate is ever included in any
response (ADR-005 Decision 6) -- see app/services/perfect_season/state.py's
get_public_state for the enforcement point. Every route is gated behind
COURTBUILDER_ENABLED / COURTBUILDER_ALPHA_ALLOWLIST -- see
docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md Decision 7.

CourtBuilder is anonymous-friendly by design (ADR-005 Decision 1): unlike
ranked, this router uses OptionalAuth + resolve_owner_sub, never requires a
signed-in account.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Cookie, HTTPException, Query, Response

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, RequiredAuth, resolve_owner_sub
from app.core.config import settings
from app.core.ownership import assert_owns, existing_owner_sub
from app.core.dependencies import (
    CourtLineupRepoDep,
    PerfectSeasonLeaderboardRepoDep,
    PerfectSeasonSavedRunRepoDep,
    ProfileRepoDep,
)
from app.models.perfect_season import (
    CancelSelectionRequest,
    CompleteGameRequest,
    CourtBuilderCoverageSummary,
    CourtBuilderReadinessResponse,
    CreatePerfectSeasonGameRequest,
    DailyChallengeResponse,
    LeaderboardResponse,
    MyRunsResponse,
    PerfectSeasonRunPublic,
    PersonalBestsPublic,
    PersonalPlacementResponse,
    PlaceCardRequest,
    PublicCourtStateResponse,
    RespinRequest,
    SavedRunPublic,
    SavedRunsResponse,
    SaveRunRequest,
    SaveRunResponse,
    SelectPlayerRequest,
    SetRunVisibilityRequest,
    SharedCourtResultResponse,
    SubmitRunRequest,
    SwapSlotsRequest,
)
from app.repositories.leaderboard_protocols import DuplicateRunSubmission, PerfectSeasonRun
from app.repositories.saved_run_protocols import PersonalBests, SavedRun
from app.repositories.saved_run_ranking import compare_to_previous_best
from app.services.perfect_season import state as state_machine
from app.services.perfect_season.state import CourtError
from nba_peak.perfect_season.assets import get_team_logo_url_by_name
from nba_peak.perfect_season.board import coverage_summary, experimental_team_year_summary, interim_team_summary
from nba_peak.perfect_season.config import SLOT_TYPES, SUPPORTED_MODES
from nba_peak.perfect_season.daily import (
    DAILY_BOARD_TYPE,
    FREE_PLAY_BOARD_TYPE,
    InvalidChallengeDate,
    daily_challenge_descriptor,
    today_utc_date,
    validate_challenge_date,
)
from nba_peak.daily_key import daily_key, day_start_utc, daily_window, parse_daily_key
from nba_peak.perfect_season.exact_season import TEAM_ID_TO_NAME, resolve_player_season_card
from nba_peak.perfect_season.simulation import compute_exact_fit_components, simulate_exact_season
from pydantic import BaseModel

router = APIRouter()


class DailyChallengeWithWindow(DailyChallengeResponse):
    """The daily challenge descriptor plus the frozen daily-window block (§2.1).

    Declared here rather than on the shared model: every daily response in the
    app carries the identical object under the top-level key `daily`, produced
    by `DailyWindow.to_payload()`. The client counts down from
    `seconds_remaining` instead of deriving a midnight-Pacific boundary itself.
    """

    daily: dict


def _error_detail(exc: Exception, default_code: str = "invalid_request") -> dict:
    code = exc.code if isinstance(exc, CourtError) else default_code
    return {"error_code": code, "message": str(exc)}


def _require_courtbuilder_enabled() -> None:
    if not settings.COURTBUILDER_ENABLED:
        raise HTTPException(
            status_code=403,
            detail={"error_code": "courtbuilder_not_enabled", "message": "CourtBuilder is not enabled."},
        )


def _check_allowlist(owner_sub: str) -> None:
    allowlist = settings.COURTBUILDER_ALPHA_ALLOWLIST
    if allowlist and owner_sub not in allowlist:
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "not_in_alpha_allowlist",
                "message": "CourtBuilder is closed-alpha; this session is not on the allowlist.",
            },
        )


# ---------------------------------------------------------------------------
# Readiness (no auth -- safe diagnostic, no integrity internals)
# ---------------------------------------------------------------------------

@router.get("/perfect-season/readiness", response_model=CourtBuilderReadinessResponse)
async def get_readiness(
    mode: str = Query("apex_1y", description="Mode to compute duration-aware coverage for"),
) -> CourtBuilderReadinessResponse:
    summary = interim_team_summary()
    if mode not in SUPPORTED_MODES:
        mode = "apex_1y"
    coverage = coverage_summary(mode)
    team_year_summary = experimental_team_year_summary()
    team_logo_urls: dict[str, str] = {}
    if settings.ENABLE_EXTERNAL_ASSET_URLS:
        all_names = set(summary["franchise_names"]) | set(team_year_summary["franchise_names"])
        for name in all_names:
            url = get_team_logo_url_by_name(name)
            if url:
                team_logo_urls[name] = url
    return CourtBuilderReadinessResponse(
        readiness_level=settings.COURTBUILDER_READINESS_LEVEL,
        courtbuilder_enabled=settings.COURTBUILDER_ENABLED,
        team_spin_enabled=settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        interim_team_data_version=summary["dataset_version"] or "unavailable",
        interim_team_franchise_count=summary["franchise_count"],
        interim_team_franchise_names=summary["franchise_names"],
        coverage=CourtBuilderCoverageSummary(**coverage),
        team_year_enabled=settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
        experimental_team_year_data_version=team_year_summary["dataset_version"] or "unavailable",
        experimental_team_year_franchise_count=team_year_summary["franchise_count"],
        experimental_team_year_franchise_names=team_year_summary["franchise_names"],
        experimental_team_year_season_count=team_year_summary["season_count"],
        experimental_team_year_season_labels=team_year_summary["season_labels"],
        total_team_season_count=team_year_summary.get("total_team_season_count", 0),
        rollable_team_season_count=team_year_summary.get("rollable_team_season_count", 0),
        min_candidates_per_team_season=team_year_summary.get("min_candidates", 0),
        max_candidates_per_team_season=team_year_summary.get("max_candidates", 0),
        median_candidates_per_team_season=team_year_summary.get("median_candidates", 0.0),
        open_pool_enabled=False,
        sample_supported_team_seasons=team_year_summary.get("sample_supported_team_seasons", []),
        low_coverage_team_seasons=team_year_summary.get("low_coverage_team_seasons", []),
        season_2025_26_coverage_status=team_year_summary.get("season_2025_26_coverage_status", "not_covered"),
        warnings=team_year_summary.get("warnings", []),
        supported_franchise_count=team_year_summary.get("franchise_count", 0),
        teams_represented_in_spinner=team_year_summary.get("franchise_ids", []),
        seasons_represented_in_spinner=team_year_summary.get("seasons_represented", []),
        team_logo_urls=team_logo_urls,
    )


# ---------------------------------------------------------------------------
# Create game
# ---------------------------------------------------------------------------

@router.post("/perfect-season/games", response_model=PublicCourtStateResponse)
async def create_game(
    body: CreatePerfectSeasonGameRequest,
    auth: OptionalAuth,
    response: Response,
    court_repo: CourtLineupRepoDep,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    owner_sub = resolve_owner_sub(auth, peak3_anon, response, settings.SIGNING_SECRET)
    _check_allowlist(owner_sub)

    if body.mode not in SUPPORTED_MODES:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_mode", "message": f"Unknown mode '{body.mode}'"},
        )

    if body.challenge_kind not in ("free_play", "daily"):
        raise HTTPException(
            status_code=400,
            detail={"error_code": "invalid_challenge_kind", "message": f"Unknown challenge_kind '{body.challenge_kind}'"},
        )

    try:
        game_state = state_machine.create_perfect_season_game(
            mode=body.mode,
            seed=body.seed,
            team_spin_enabled=settings.COURTBUILDER_TEAM_SPIN_ENABLED,
            team_year_enabled=settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
            board_type=DAILY_BOARD_TYPE if body.challenge_kind == "daily" else FREE_PLAY_BOARD_TYPE,
            challenge_date=body.challenge_date,
        )
    except InvalidChallengeDate as exc:
        raise HTTPException(status_code=422, detail=_error_detail(exc, "invalid_challenge_date"))
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc, "board_error"))

    game_state.owner_sub = owner_sub
    game_id = await court_repo.create_lineup(game_state)
    game_state.game_id = game_id
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


# ---------------------------------------------------------------------------
# Get game state
# ---------------------------------------------------------------------------

async def _load_owned_lineup(
    game_id: str,
    court_repo,
    auth,
    anon_cookie: Optional[str],
):
    """Load a lineup and prove the caller owns it, or raise 404/403.

    The single gate for every mutating CourtBuilder route. Seven of them --
    select, cancel, respin-team, respin-season, place, swap-slots, complete --
    previously took a `game_id` and no identity whatsoever, so anyone holding a
    leaked id could burn a stranger's three-respin budget, misplace their
    cards, or force `/complete` to irreversibly freeze a sabotaged simulation.
    `submit` (`:485`) and `save` (`:729`) already did this correctly; this
    helper is that same check, hoisted so it cannot be forgotten again.
    """
    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    assert_owns(
        game_state.owner_sub,
        existing_owner_sub(auth, anon_cookie, settings.SIGNING_SECRET),
        message="This game belongs to a different player.",
    )
    return game_state


@router.get("/perfect-season/games/{game_id}", response_model=PublicCourtStateResponse)
async def get_game(
    game_id: str,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)
    return PublicCourtStateResponse(**state_machine.get_public_state(game_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.get(
    "/perfect-season/games/{game_id}/shared-result",
    response_model=SharedCourtResultResponse,
)
async def get_shared_result(
    game_id: str,
    court_repo: CourtLineupRepoDep,
) -> SharedCourtResultResponse:
    """The public, read-only scorecard for a COMPLETED run.

    Deliberately takes no identity at all -- not because ownership stopped
    mattering, but because there is nothing here for ownership to protect. The
    route above (`get_game`) is owner-only and stays that way: its payload is
    the live board plus the handle every mutator keys off, so possessing an id
    must not be enough to read it. This route answers a strictly different
    question -- "what did this finished run score?" -- through
    `get_shared_result_state`, which returns None for anything not
    `result_ready` and strips the owner-scoped and mutable keys by name
    (`SHARED_RESULT_WITHHELD_KEYS`), onto a response model that cannot
    represent them at all.

    No mutation is reachable from what it returns, and it is not a back door
    into `get_game`: an in-progress run answers 404 here, so the endpoint
    cannot be used to watch a stranger's board as they play it. A leaked id
    still buys an attacker exactly one thing -- the scorecard its owner
    shares by link on purpose.

    404, never 403, and the same shape for "no such run" and "not finished
    yet": the two are indistinguishable to a caller, so this route is not an
    oracle for which unguessable ids exist.
    """
    _require_courtbuilder_enabled()
    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Result not found")
    shared = state_machine.get_shared_result_state(
        game_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS
    )
    if shared is None:
        raise HTTPException(status_code=404, detail="Result not found")
    return SharedCourtResultResponse(**shared)


# ---------------------------------------------------------------------------
# Select / place / complete
# ---------------------------------------------------------------------------

@router.post("/perfect-season/games/{game_id}/select", response_model=PublicCourtStateResponse)
async def select_player(
    game_id: str,
    body: SelectPlayerRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        new_state = state_machine.action_select_player(game_state, body.player_slug)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/cancel", response_model=PublicCourtStateResponse)
async def cancel_selection(
    game_id: str,
    body: CancelSelectionRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        new_state = state_machine.action_cancel_selection(game_state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/respin-team", response_model=PublicCourtStateResponse)
async def respin_team(
    game_id: str,
    body: RespinRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        # W5: idempotent by key. A replayed key returns the current state
        # untouched instead of consuming a second respin (the handler is
        # still a read-modify-write -- `PostgresCourtLineupRepo.save_lineup`
        # has no version column -- so the key, not a lock, is what makes a
        # double-click safe).
        new_state = state_machine.action_respin_team(game_state, body.idempotency_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/respin-season", response_model=PublicCourtStateResponse)
async def respin_season(
    game_id: str,
    body: RespinRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        # W5: idempotent by key -- see respin_team above.
        new_state = state_machine.action_respin_season(game_state, body.idempotency_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/place", response_model=PublicCourtStateResponse)
async def place_card(
    game_id: str,
    body: PlaceCardRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        new_state = state_machine.action_place_card(game_state, body.slot_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/swap-slots", response_model=PublicCourtStateResponse)
async def swap_slots(
    game_id: str,
    body: SwapSlotsRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    """Phase 9B: move/swap two already-placed cards between slots.

    A pure roster-optimization move -- NOT a respin. It consumes no respin
    budget, never re-rolls the board or any spin, and can never create or
    destroy a card; the only thing that changes is which slot each card
    occupies (and therefore its recomputed position fit). Same request/error
    shape as /place and /select: game_id must match the URL, ValueError from
    the state machine becomes a 400 with the CourtError code, and the
    response is the full refreshed public state.

    Rejected with code "rearrange_after_result" once the run is simulated --
    a submitted result is the saved/shared artifact and must not mutate.
    """
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        new_state = state_machine.action_swap_slots(game_state, body.slot_a, body.slot_b)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


@router.post("/perfect-season/games/{game_id}/complete", response_model=PublicCourtStateResponse)
async def complete_game(
    game_id: str,
    body: CompleteGameRequest,
    court_repo: CourtLineupRepoDep,
    auth: OptionalAuth,
    peak3_anon: Optional[str] = Cookie(default=None, alias=ANON_COOKIE_NAME),
) -> PublicCourtStateResponse:
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")

    game_state = await _load_owned_lineup(game_id, court_repo, auth, peak3_anon)

    try:
        new_state = state_machine.action_complete_game(game_state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=_error_detail(exc))

    await court_repo.save_lineup(new_state)
    return PublicCourtStateResponse(**state_machine.get_public_state(new_state, include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS))


# ---------------------------------------------------------------------------
# Phase 6G Part E: authenticated global leaderboard. Reading is public once
# enabled; submitting always requires a REAL signed-in account (never an
# anonymous CourtBuilder session, even though CourtBuilder play itself is
# anonymous-friendly by design -- ADR-005 Decision 1). Every scored/roster
# field on a submission is recomputed from the server-saved game state, never
# taken from the client (see SubmitRunRequest's own docstring).
# ---------------------------------------------------------------------------

def _require_leaderboard_enabled() -> None:
    if not settings.COURTBUILDER_LEADERBOARD_ENABLED:
        raise HTTPException(
            status_code=403,
            detail={"error_code": "leaderboard_not_enabled", "message": "The PEAK Season leaderboard is not enabled."},
        )


def _run_to_public(run: PerfectSeasonRun) -> PerfectSeasonRunPublic:
    return PerfectSeasonRunPublic(
        id=run.id,
        display_name=run.display_name,
        mode=run.mode,
        game_type=run.game_type,
        seed=run.seed,
        wins=run.wins,
        losses=run.losses,
        lineup_score=run.lineup_score,
        score_status=run.score_status,
        exact_cards_scored=run.exact_cards_scored,
        total_cards=run.total_cards,
        team_respins_used=run.team_respins_used,
        season_respins_used=run.season_respins_used,
        data_version=run.data_version,
        formula_version=run.formula_version,
        simulation_version=run.simulation_version,
        created_at=run.created_at.isoformat() if hasattr(run.created_at, "isoformat") else str(run.created_at),
    )


@router.post("/perfect-season/games/{game_id}/submit", response_model=PerfectSeasonRunPublic)
async def submit_run(
    game_id: str,
    body: SubmitRunRequest,
    auth: RequiredAuth,
    court_repo: CourtLineupRepoDep,
    leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
    profile_repo: ProfileRepoDep,
) -> PerfectSeasonRunPublic:
    _require_courtbuilder_enabled()
    _require_leaderboard_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")
    if auth.is_anonymous:
        raise HTTPException(
            status_code=401,
            detail={"error_code": "sign_in_required", "message": "Sign in with a real account to submit to the leaderboard."},
        )

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    if game_state.owner_sub != auth.sub:
        raise HTTPException(status_code=403, detail={"error_code": "not_your_game", "message": "This game belongs to a different account."})
    if game_state.status != "result_ready" or game_state.simulation_result is None:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "game_not_complete", "message": "This game has not been completed and simulated yet."},
        )

    existing = await leaderboard_repo.get_run_by_game_id(game_id)
    if existing is not None:
        # Idempotent retry: the same game was already submitted -- return
        # the original immutable record rather than erroring or duplicating.
        return _run_to_public(existing)

    result = game_state.simulation_result
    team_year_board = game_state.board.experimental_team_year_data_version is not None
    # Phase 9A: eligibility is decided by ONE shared helper
    # (state_machine.compute_eligibility) that the public state also exposes,
    # so this route can never accept a run the UI called ineligible (or
    # reject one it called eligible). The rule is unchanged: a fully-scored
    # roster is required for the official leaderboard.
    eligibility = state_machine.compute_eligibility(game_state)
    lineup_score_status = "complete" if state_machine.placed_cards_all_scored(game_state) else "incomplete"
    if not eligibility["leaderboard_eligible"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "incomplete_score_not_eligible"
                if eligibility["reason"] == state_machine.ELIGIBILITY_INCOMPLETE_SCORE
                else eligibility["reason"],
                "message": eligibility["reason_detail"],
            },
        )

    roster_card_keys = [
        s.exact_player_season_key or s.peak_window_id or "" for s in game_state.slots
    ]
    exact_cards_scored = sum(
        1 for s in game_state.slots if s.exact_player_season_key and _card_scored(s.exact_player_season_key)
    ) if team_year_board else len(game_state.slots)

    profile = await profile_repo.get_or_create_profile(auth.sub)
    # SCORE_RECONCILIATION.md gap #4: the fallback used to be
    # `auth.email.split("@")[0]` -- publishing the account email's local part
    # on the GLOBAL leaderboard for anyone who had never explicitly set a
    # display name, with no consent gate. `profile.display_name` being set at
    # all already IS the explicit opt-in (it is only ever set through the
    # account's own profile-editing route, never derived here); the
    # non-consented default is now unconditionally the neutral
    # `Player-XXXXXX` handle already used for the no-email case, never
    # anything derived from the account's email.
    display_name = profile.display_name or f"Player-{auth.sub[-6:]}"

    run = PerfectSeasonRun(
        id="",
        owner_sub=auth.sub,
        display_name=display_name,
        mode=game_state.mode,
        game_id=game_id,
        seed=game_state.board.seed,
        wins=result.wins,
        losses=result.losses,
        lineup_score=result.lineup_peak_score,
        score_status=lineup_score_status,
        exact_cards_scored=exact_cards_scored,
        total_cards=len(game_state.slots),
        team_respins_used=sum(1 for h in game_state.respin_history if h.get("kind") == "team"),
        season_respins_used=sum(1 for h in game_state.respin_history if h.get("kind") == "season"),
        roster_card_keys=roster_card_keys,
        data_version=game_state.board.experimental_team_year_data_version,
        formula_version=game_state.board.metadata.get("formula_version"),
        simulation_version=result.simulator_version,
    )
    try:
        saved = await leaderboard_repo.submit_run(run)
    except DuplicateRunSubmission:
        existing = await leaderboard_repo.get_run_by_game_id(game_id)
        if existing is not None:
            return _run_to_public(existing)
        raise HTTPException(status_code=409, detail={"error_code": "duplicate_submission", "message": "This game was already submitted."})

    return _run_to_public(saved)


def _card_scored(exact_player_season_key: str) -> bool:
    from nba_peak.perfect_season.exact_season import resolve_exact_card_by_key
    card = resolve_exact_card_by_key(exact_player_season_key)
    return card is not None and card.score_status == "exact_season_scored"


@router.post("/perfect-season/runs/{run_id}/visibility", response_model=PerfectSeasonRunPublic)
async def set_run_visibility(
    run_id: str,
    body: SetRunVisibilityRequest,
    auth: RequiredAuth,
    leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
) -> PerfectSeasonRunPublic:
    """SCORE_RECONCILIATION.md gap #3: hide or unhide a submitted run.

    The only mutation a submitted run may ever undergo -- `is_public`, one
    column -- everything else stays the immutable record of what was
    submitted (Part E: "Prefer immutable submitted runs; no UPDATE except
    admin"). Ownership is checked in `leaderboard_repo.set_visibility` itself
    (`WHERE id = ... AND owner_sub = ...`), and a mismatch is reported the
    same way "does not exist" is -- 404, not 403 -- so this endpoint cannot be
    used to probe whether a given run id belongs to someone else.
    """
    _require_courtbuilder_enabled()
    _require_leaderboard_enabled()
    updated = await leaderboard_repo.set_visibility(run_id, auth.sub, body.is_public)
    if updated is None:
        raise HTTPException(status_code=404, detail="Run not found or not yours")
    return _run_to_public(updated)


@router.get("/perfect-season/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
    mode: Optional[str] = Query(None, description="Filter by mode (apex_1y/prime_3y/foundation_5y)"),
    no_respin: bool = Query(False, description="Only include runs with zero respins used"),
    limit: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = Query(None),
    daily: bool = Query(
        False,
        description=(
            "Restrict to runs submitted since the start of the current "
            "application day (midnight America/Los_Angeles) instead of the "
            "all-time board. Same query, same tie-break order."
        ),
    ),
) -> LeaderboardResponse:
    if not settings.COURTBUILDER_LEADERBOARD_ENABLED:
        return LeaderboardResponse(
            leaderboard_enabled=False, runs=[], next_cursor=None,
            daily=daily, daily_key=daily_key() if daily else None,
        )
    # The daily board is NOT a separate mode or a separate table -- it is the
    # identical query and tie-break order as all-time, filtered to
    # `created_at >= start of today`. `day_start_utc` is the ONE place the
    # "official application day" boundary is defined (`nba_peak/daily_key.py`)
    # -- every daily mode in this codebase reads it from there rather than
    # re-deriving a UTC or fixed-offset boundary of its own.
    since = day_start_utc(parse_daily_key(daily_key())) if daily else None
    runs = await leaderboard_repo.get_leaderboard(mode, no_respin, limit, cursor, since)
    # SCORE_RECONCILIATION.md gap #1: `next_cursor` was computed nowhere, ever
    # -- the repo-side encoder existed (leaderboard_postgres.py `_encode_cursor`
    # / leaderboard_memory.py's exported `encode_leaderboard_cursor`) but no
    # caller invoked it, so a client had no way to request page 2. Mirrors
    # ranked.py:458's `next_cursor = ... if len(ratings) == limit else None`.
    # `encode_cursor` is a REPOSITORY method (not a router-level free function
    # like ranked's) because the memory and Postgres backends do not share one
    # cursor wire format -- see leaderboard_protocols.py's docstring on it.
    # The cursor itself already encodes created_at, so a page-2 request
    # carries the daily filter forward correctly with no extra state needed.
    next_cursor = leaderboard_repo.encode_cursor(runs[-1]) if len(runs) == limit else None
    return LeaderboardResponse(
        leaderboard_enabled=True, runs=[_run_to_public(r) for r in runs],
        next_cursor=next_cursor, daily=daily,
        daily_key=daily_key() if daily else None,
    )


@router.get("/perfect-season/leaderboard/me", response_model=PersonalPlacementResponse)
async def get_personal_placement(
    auth: RequiredAuth,
    leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
    mode: Optional[str] = Query(None, description="Filter by mode (apex_1y/prime_3y/foundation_5y)"),
) -> PersonalPlacementResponse:
    """SCORE_RECONCILIATION.md gap #2: "no personal-placement endpoint... a
    player could see the board but never where they placed on it." Requires a
    real account for the same reason submission does -- an anonymous session
    cannot have a submitted run to rank in the first place. Reads the SAME
    public rows `GET /perfect-season/leaderboard` serves (`is_public=TRUE`,
    same sort order), so a rank returned here always corresponds to a
    position that leaderboard would actually show on some page of it.
    """
    if not settings.COURTBUILDER_LEADERBOARD_ENABLED:
        return PersonalPlacementResponse(leaderboard_enabled=False, mode=mode)
    placement = await leaderboard_repo.get_personal_placement(auth.sub, mode)
    if placement is None:
        return PersonalPlacementResponse(leaderboard_enabled=True, mode=mode)
    rank, run = placement
    return PersonalPlacementResponse(
        leaderboard_enabled=True, mode=mode, rank=rank, run=_run_to_public(run),
    )


@router.get("/perfect-season/me/runs", response_model=MyRunsResponse)
async def get_my_runs(
    auth: RequiredAuth,
    leaderboard_repo: PerfectSeasonLeaderboardRepoDep,
) -> MyRunsResponse:
    _require_leaderboard_enabled()
    runs = await leaderboard_repo.list_runs_for_owner(auth.sub)
    return MyRunsResponse(runs=[_run_to_public(r) for r in runs])


# ---------------------------------------------------------------------------
# Phase 9A: saved runs (private personal history) + personal bests.
#
# Deliberately NOT behind COURTBUILDER_LEADERBOARD_ENABLED: saving your own
# completed run to your own history is core retention behavior, not an opt-in
# competitive feature. It does always require a real signed-in account --
# there is nowhere durable to attach an anonymous session's history, and
# silently discarding a save would be worse than saying so (the route returns
# 401 with a sign_in_required code the UI turns into a CTA).
#
# A PROVISIONAL run (unscored cards -> not leaderboard-eligible) IS savable.
# See app/repositories/saved_run_protocols.py's module docstring for why
# history and the leaderboard are separate stores with different rules.
# ---------------------------------------------------------------------------

def _saved_run_to_public(run: SavedRun) -> SavedRunPublic:
    return SavedRunPublic(
        id=run.id,
        game_id=run.game_id,
        mode=run.mode,
        seed=run.seed,
        wins=run.wins,
        losses=run.losses,
        lineup_score=run.lineup_score,
        score_status=run.score_status,
        exact_cards_scored=run.exact_cards_scored,
        total_cards=run.total_cards,
        leaderboard_eligible=run.leaderboard_eligible,
        challenge_kind=run.challenge_kind,
        challenge_date=run.challenge_date,
        is_perfect_season=run.is_perfect_season,
        team_respins_used=run.team_respins_used,
        season_respins_used=run.season_respins_used,
        roster=run.roster,
        spin_history=run.spin_history,
        peak_picks_matched=run.peak_picks_matched,
        peak_picks_total=run.peak_picks_total,
        data_version=run.data_version,
        formula_version=run.formula_version,
        simulation_version=run.simulation_version,
        created_at=run.created_at.isoformat() if hasattr(run.created_at, "isoformat") else str(run.created_at),
    )


def _bests_to_public(bests: PersonalBests) -> PersonalBestsPublic:
    return PersonalBestsPublic(
        total_runs=bests.total_runs,
        best_run=_saved_run_to_public(bests.best_run) if bests.best_run else None,
        best_wins=bests.best_wins,
        best_lineup_score=bests.best_lineup_score,
        best_lineup_score_run=(
            _saved_run_to_public(bests.best_lineup_score_run) if bests.best_lineup_score_run else None
        ),
        best_daily_run=_saved_run_to_public(bests.best_daily_run) if bests.best_daily_run else None,
        perfect_season_count=bests.perfect_season_count,
        recent_runs=[_saved_run_to_public(r) for r in bests.recent_runs],
    )


def _require_real_account(auth) -> None:
    if auth.is_anonymous:
        raise HTTPException(
            status_code=401,
            detail={
                "error_code": "sign_in_required",
                "message": "Sign in with a real account to save runs and track personal bests.",
            },
        )


def _roster_snapshot(game_state) -> list[dict]:
    """The 8 placed cards, in slot order, as a durable display snapshot.

    Stored rather than re-derived on read so a saved run's scorecard can
    never silently change if card data or the simulator moves later -- a
    personal best that quietly rewrites itself is not a record.
    """
    from nba_peak.perfect_season.exact_season import resolve_exact_card_by_key

    snapshot: list[dict] = []
    for slot in game_state.slots:
        # Phase 9B: role_fit_severity is snapshotted alongside role_fit for
        # the same reason as everything else here -- without it a saved
        # scorecard can only render "off-position", which is exactly the
        # over-alarming label this pass replaced with three cost-accurate
        # tiers (see nba_peak/perfect_season/positions.py::fit_label).
        entry: dict = {
            "slot_type": slot.slot_type,
            "role_fit": slot.role_fit,
            "role_fit_severity": slot.role_fit_severity,
        }
        if slot.exact_player_season_key:
            card = resolve_exact_card_by_key(slot.exact_player_season_key)
            if card is not None:
                entry.update({
                    "player_name": card.player_name,
                    "player_slug": card.player_slug,
                    "team_name": card.team_name,
                    "team_id": card.team_id,
                    "season": card.season,
                    "score": card.season_score,
                    "score_status": card.score_status,
                    "position": card.position,
                })
        elif slot.peak_window_id:
            card = state_machine.resolve_card_by_window_id(game_state, slot.peak_window_id)
            if card is not None:
                entry.update({
                    "player_name": card.player_name,
                    "player_slug": card.player_slug,
                    "season": card.anchor_season,
                    "score": card.individual_peak_score,
                    "score_status": "exact_season_scored",
                })
        snapshot.append(entry)
    return snapshot


@router.post("/perfect-season/games/{game_id}/save", response_model=SaveRunResponse)
async def save_run(
    game_id: str,
    body: SaveRunRequest,
    auth: RequiredAuth,
    court_repo: CourtLineupRepoDep,
    saved_run_repo: PerfectSeasonSavedRunRepoDep,
) -> SaveRunResponse:
    """Save a completed run to the signed-in owner's private history.

    Every stored number is recomputed from the server-saved game state --
    the request body carries nothing but which game to save.
    """
    _require_courtbuilder_enabled()
    if body.game_id != game_id:
        raise HTTPException(status_code=400, detail="game_id in body must match URL")
    _require_real_account(auth)

    game_state = await court_repo.get_lineup(game_id)
    if game_state is None:
        raise HTTPException(status_code=404, detail="Game not found or expired")
    if game_state.owner_sub != auth.sub:
        raise HTTPException(
            status_code=403,
            detail={"error_code": "not_your_game", "message": "This game belongs to a different account."},
        )

    eligibility = state_machine.compute_eligibility(game_state)
    if not eligibility["savable"]:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "game_not_complete", "message": eligibility["reason_detail"]},
        )

    result = game_state.simulation_result
    recap = result.peak_picks_recap or []
    all_scored = state_machine.placed_cards_all_scored(game_state)
    exact_cards_scored = sum(
        1 for s in game_state.slots
        if s.exact_player_season_key and _card_scored(s.exact_player_season_key)
    ) if game_state.board.experimental_team_year_data_version is not None else len(game_state.slots)

    # Personal bests BEFORE this save, so a first-ever run reads as
    # "first run" and a repeat of your own best reads as "tied", not as a
    # self-referential "new best".
    previous_bests = await saved_run_repo.get_personal_bests(auth.sub)

    candidate = SavedRun(
        id="",
        owner_sub=auth.sub,
        game_id=game_id,
        mode=game_state.mode,
        seed=game_state.board.seed,
        wins=result.wins,
        losses=result.losses,
        lineup_score=result.lineup_peak_score,
        score_status="complete" if all_scored else "incomplete",
        exact_cards_scored=exact_cards_scored,
        total_cards=len(game_state.slots),
        leaderboard_eligible=eligibility["leaderboard_eligible"],
        challenge_kind=game_state.challenge_kind,
        challenge_date=game_state.challenge_date,
        is_perfect_season=result.is_perfect_season,
        team_respins_used=sum(1 for h in game_state.respin_history if h.get("kind") == "team"),
        season_respins_used=sum(1 for h in game_state.respin_history if h.get("kind") == "season"),
        roster=_roster_snapshot(game_state),
        spin_history=list(game_state.respin_history),
        peak_picks_matched=sum(1 for r in recap if r.get("matched")) if recap else None,
        peak_picks_total=len(recap) if recap else None,
        data_version=game_state.board.experimental_team_year_data_version,
        formula_version=game_state.board.metadata.get("formula_version"),
        simulation_version=result.simulator_version,
    )

    already = await saved_run_repo.get_run_by_game_id(auth.sub, game_id)
    saved = await saved_run_repo.save_run(candidate)
    comparison = compare_to_previous_best(saved, previous_bests.best_run)
    updated_bests = await saved_run_repo.get_personal_bests(auth.sub)

    return SaveRunResponse(
        saved_run=_saved_run_to_public(saved),
        comparison=comparison,
        already_saved=already is not None,
        personal_bests=_bests_to_public(updated_bests),
    )


@router.get("/perfect-season/me/saved-runs", response_model=SavedRunsResponse)
async def get_my_saved_runs(
    auth: RequiredAuth,
    saved_run_repo: PerfectSeasonSavedRunRepoDep,
    limit: int = Query(25, ge=1, le=100),
) -> SavedRunsResponse:
    """This account's own run history + personal bests. Private: always
    scoped to the authenticated owner, never listable for another user."""
    _require_courtbuilder_enabled()
    _require_real_account(auth)
    runs = await saved_run_repo.list_runs_for_owner(auth.sub, limit=limit)
    bests = await saved_run_repo.get_personal_bests(auth.sub)
    return SavedRunsResponse(
        runs=[_saved_run_to_public(r) for r in runs],
        personal_bests=_bests_to_public(bests),
    )


@router.get("/perfect-season/me/personal-bests", response_model=PersonalBestsPublic)
async def get_my_personal_bests(
    auth: RequiredAuth,
    saved_run_repo: PerfectSeasonSavedRunRepoDep,
) -> PersonalBestsPublic:
    _require_courtbuilder_enabled()
    _require_real_account(auth)
    return _bests_to_public(await saved_run_repo.get_personal_bests(auth.sub))


# ---------------------------------------------------------------------------
# Phase 9A: daily challenge descriptor. No auth REQUIRED (anonymous players
# get the same shared board -- daily play is not gated on an account, only
# saving/comparing is), but an authenticated caller additionally gets their
# own attempt count for today.
# ---------------------------------------------------------------------------

@router.get("/perfect-season/daily", response_model=DailyChallengeWithWindow)
async def get_daily_challenge(
    auth: OptionalAuth,
    saved_run_repo: PerfectSeasonSavedRunRepoDep,
    mode: str = Query("apex_1y", description="apex_1y | prime_3y | foundation_5y"),
    date: Optional[str] = Query(
        None,
        description="YYYY-MM-DD archive date; omit for today's (server-decided, midnight PT)",
    ),
) -> DailyChallengeWithWindow:
    _require_courtbuilder_enabled()
    if mode not in SUPPORTED_MODES:
        raise HTTPException(
            status_code=400, detail={"error_code": "invalid_mode", "message": f"Unknown mode '{mode}'"}
        )
    try:
        challenge_date = validate_challenge_date(date or today_utc_date())
    except InvalidChallengeDate as exc:
        raise HTTPException(status_code=422, detail=_error_detail(exc, "invalid_challenge_date"))

    descriptor = daily_challenge_descriptor(challenge_date, mode)

    # Attempt tracking is RECORDED but not enforced as a hard block in this
    # phase: the honest count is surfaced ("you've already played today") and
    # the product decision about limiting replays is left for the next phase,
    # when the daily leaderboard that would actually be distorted by replays
    # exists. Anonymous callers have no durable identity to count against.
    attempts_used = 0
    if auth is not None and not auth.is_anonymous:
        attempts_used = await saved_run_repo.count_daily_attempts(auth.sub, challenge_date, mode)

    return DailyChallengeWithWindow(
        **descriptor,
        attempts_used=attempts_used,
        already_played=attempts_used > 0,
        daily=daily_window(challenge_date).to_payload(),
    )


# ---------------------------------------------------------------------------
# Phase 6F Part G: developer-only manual lineup simulator (bypasses the
# spinner entirely). Gated OFF by default -- never exposed publicly unless a
# human explicitly sets PEAK3_DEV_TOOLS_ENABLED=true or
# PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev. Uses the SAME
# resolve_player_season_card/simulate_exact_season the real game uses -- no
# separate/duplicated scoring logic. Prefer scripts/simulate_peak_season_lineup.py
# for actual calibration work; this endpoint exists for quick in-browser/
# API-client checks in a local dev environment.
# ---------------------------------------------------------------------------

class DevSlotInput(BaseModel):
    slot: str
    player_slug: str
    season: str
    team: str  # team_id (e.g. "GSW") or exact display name (e.g. "Golden State Warriors")


class DevSimulateLineupRequest(BaseModel):
    slots: list[DevSlotInput]
    allow_unscored: bool = False


def _dev_tools_enabled() -> bool:
    return settings.DEV_TOOLS_ENABLED or settings.COURTBUILDER_READINESS_LEVEL == "internal_dev"


def _resolve_dev_team_id(raw: str) -> Optional[str]:
    if raw.upper() in TEAM_ID_TO_NAME:
        return raw.upper()
    key = raw.lower().replace(" ", "-")
    for team_id, name in TEAM_ID_TO_NAME.items():
        if name.lower().replace(" ", "-") == key:
            return team_id
    return None


@router.post("/perfect-season/dev/simulate-lineup")
async def dev_simulate_lineup(body: DevSimulateLineupRequest) -> dict:
    if not _dev_tools_enabled():
        raise HTTPException(
            status_code=403,
            detail={
                "error_code": "dev_tools_not_enabled",
                "message": "Set PEAK3_DEV_TOOLS_ENABLED=true or PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev "
                           "to use this endpoint. Prefer scripts/simulate_peak_season_lineup.py for calibration work.",
            },
        )

    by_slot = {s.slot: s for s in body.slots}
    missing = [s for s in SLOT_TYPES if s not in by_slot]
    if missing:
        raise HTTPException(status_code=400, detail={"error_code": "missing_slots", "message": f"Missing slot(s): {missing}"})

    cards = []
    warnings: list[str] = []
    for slot in SLOT_TYPES:
        e = by_slot[slot]
        team_id = _resolve_dev_team_id(e.team)
        if team_id is None:
            raise HTTPException(status_code=400, detail={"error_code": "unknown_team", "message": f"Unrecognized team '{e.team}' for slot {slot}"})
        card = resolve_player_season_card(e.player_slug, team_id, e.season)
        if card is None:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "unresolvable_card", "message": f"[{slot}] '{e.player_slug}' has no real roster record for {team_id} {e.season}"},
            )
        if card.season != e.season or card.team_id != team_id:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "exact_season_mismatch", "message": f"[{slot}] resolved {card.team_id} {card.season} != requested {team_id} {e.season}"},
            )
        if card.score_status != "exact_season_scored" and not body.allow_unscored:
            raise HTTPException(
                status_code=400,
                detail={"error_code": "unscored_card", "message": f"[{slot}] {card.player_name} {card.team_id} {card.season} is unscored -- pass allow_unscored=true to include it"},
            )
        if card.score_status != "exact_season_scored":
            warnings.append(f"{slot}: {card.player_name} {card.team_id} {card.season} is unscored ({card.score_status})")
        cards.append(card)

    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    fit = compute_exact_fit_components(cards, SLOT_TYPES)
    scored_count = sum(1 for c in cards if c.score_status == "exact_season_scored")

    return {
        "cards": [
            {
                "slot": slot, "player_slug": c.player_slug, "player_name": c.player_name,
                "team_id": c.team_id, "team_name": c.team_name, "season": c.season,
                "position": c.position, "season_score": c.season_score, "score_status": c.score_status,
            }
            for slot, c in zip(SLOT_TYPES, cards)
        ],
        "fit_components": fit.as_dict(),
        "wins": result.wins,
        "losses": result.losses,
        "expected_wins": result.expected_wins,
        "expected_wins_low": result.expected_wins_low,
        "expected_wins_high": result.expected_wins_high,
        "is_perfect_season": result.is_perfect_season,
        "lineup_peak_score": result.lineup_peak_score,
        "score_coverage": f"{scored_count}/{len(cards)}",
        "best_pick": result.best_pick,
        "structural_weakness": result.structural_weakness,
        "decisive_factors": result.decisive_factors,
        "warnings": warnings,
    }
