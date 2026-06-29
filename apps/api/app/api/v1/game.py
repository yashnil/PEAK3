"""Game endpoints: daily challenge, endless mode, and answer submission."""
from __future__ import annotations

import random
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.core.dataset import dataset_store
from app.core.security import create_session_token, verify_session_token
from app.models.game import (
    AnswerRequest,
    AnswerResponse,
    ComponentComparison,
    DailyGameResponse,
    EndlessGameResponse,
    PublicDuel,
    PublicPeakRef,
)
from app.services.arena_points import calculate_arena_points
from app.services.duel import (
    VALID_YEARS,
    DuelPair,
    generate_daily_duels,
    generate_endless_duels,
)
from app.services.explanation import generate_explanation

router = APIRouter()


def _build_public_duel(duel: DuelPair) -> PublicDuel:
    return PublicDuel(
        id=duel.id,
        left=PublicPeakRef(**duel.left),
        right=PublicPeakRef(**duel.right),
        difficulty=duel.difficulty,
    )


def _duels_to_token_payload(
    mode: str,
    years: int,
    duels: list[DuelPair],
    **extra: object,
) -> dict:
    return {
        "mode": mode,
        "years": years,
        "duels": [
            {
                "id": d.id,
                "left_id": d.left["peak_id"],
                "right_id": d.right["peak_id"],
            }
            for d in duels
        ],
        **extra,
    }


def _validate_years(years: int) -> None:
    if years not in VALID_YEARS:
        raise HTTPException(
            status_code=422,
            detail=f"years must be one of {VALID_YEARS}, got {years}",
        )


def _lookup_peak(peak_id: str, years: int) -> dict | None:
    try:
        rows = dataset_store.get_leaderboard(years)
    except KeyError:
        return None
    for r in rows:
        if r["id"] == peak_id:
            return r
    return None


@router.get("/game/daily", response_model=DailyGameResponse)
async def get_daily_game(
    years: int = Query(default=3),
    date: str = Query(default=""),
) -> DailyGameResponse:
    """Generate (or replay) the daily challenge for a given date and duration."""
    _validate_years(years)

    if not date:
        date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    else:
        # Validate date format
        try:
            datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD")

    try:
        pool = dataset_store.get_leaderboard(years)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No leaderboard data for years={years}")

    duels = generate_daily_duels(pool, years, date, count=settings.DAILY_DUEL_COUNT)
    if not duels:
        raise HTTPException(status_code=500, detail="Could not generate duels — pool may be too small")

    payload = _duels_to_token_payload("daily", years, duels, date=date)
    token = create_session_token(payload, settings.SIGNING_SECRET, settings.SESSION_TTL_SECONDS)

    return DailyGameResponse(
        date=date,
        years=years,
        duel_count=len(duels),
        duels=[_build_public_duel(d) for d in duels],
        session_token=token,
    )


@router.get("/game/endless", response_model=EndlessGameResponse)
async def get_endless_game(
    years: int = Query(default=3),
    seed: int | None = Query(default=None),
    count: int = Query(default=20, ge=1, le=50),
) -> EndlessGameResponse:
    """Generate an endless game session with an optional explicit seed."""
    _validate_years(years)

    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    try:
        pool = dataset_store.get_leaderboard(years)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No leaderboard data for years={years}")

    duels = generate_endless_duels(pool, years, seed, count=count)
    if not duels:
        raise HTTPException(status_code=500, detail="Could not generate duels — pool may be too small")

    payload = _duels_to_token_payload("endless", years, duels, seed=seed)
    token = create_session_token(payload, settings.SIGNING_SECRET, settings.SESSION_TTL_SECONDS)

    return EndlessGameResponse(
        seed=seed,
        years=years,
        duel_count=len(duels),
        duels=[_build_public_duel(d) for d in duels],
        session_token=token,
    )


@router.post("/game/answer", response_model=AnswerResponse)
async def post_answer(body: AnswerRequest) -> AnswerResponse:
    """Validate a player's answer, compute arena points, and return the reveal."""
    # 1. Verify token
    session = verify_session_token(body.session_token, settings.SIGNING_SECRET)
    if session is None:
        raise HTTPException(status_code=400, detail="Invalid or expired session token")

    years: int = session.get("years", 0)
    session_duels: list[dict] = session.get("duels", [])

    # 2. Find the duel in the session
    duel_meta = next((d for d in session_duels if d["id"] == body.duel_id), None)
    if duel_meta is None:
        raise HTTPException(status_code=400, detail=f"duel_id '{body.duel_id}' not found in session")

    left_id = duel_meta["left_id"]
    right_id = duel_meta["right_id"]

    # 3. Validate selected_peak_id is one of the two options
    if body.selected_peak_id not in (left_id, right_id):
        raise HTTPException(
            status_code=400,
            detail=f"selected_peak_id must be one of '{left_id}' or '{right_id}'",
        )

    # 4. Load full peak window data
    left_peak = _lookup_peak(left_id, years)
    right_peak = _lookup_peak(right_id, years)
    if left_peak is None or right_peak is None:
        raise HTTPException(status_code=500, detail="Duel peak data not found in dataset")

    # 5. Determine winner
    if left_peak["prime_index"] >= right_peak["prime_index"]:
        winner_peak = left_peak
        loser_peak = right_peak
    else:
        winner_peak = right_peak
        loser_peak = left_peak

    winning_peak_id = winner_peak["id"]
    prime_index_gap = abs(left_peak["prime_index"] - right_peak["prime_index"])
    correct = body.selected_peak_id == winning_peak_id

    # 6. Difficulty — re-derive from gap distribution across session
    all_ids_pairs = [(d["left_id"], d["right_id"]) for d in session_duels]
    all_gaps: list[float] = []
    for lid, rid in all_ids_pairs:
        lp = _lookup_peak(lid, years)
        rp = _lookup_peak(rid, years)
        if lp and rp:
            all_gaps.append(abs(lp["prime_index"] - rp["prime_index"]))

    # Import difficulty assignment
    from app.services.duel import _assign_difficulty
    all_gaps_sorted = sorted(all_gaps)
    difficulty = _assign_difficulty(prime_index_gap, all_gaps_sorted)

    # 7. Arena points
    arena_points = calculate_arena_points(
        correct=correct,
        prime_index_gap=prime_index_gap,
        elapsed_ms=body.elapsed_ms,
        streak=body.current_streak,
        all_gaps=all_gaps,
    )

    # 8. Updated streak
    updated_streak = (body.current_streak + 1) if correct else 0

    # 9. Component comparison
    component_keys = [
        "statistical_impact",
        "traditional_production",
        "individual_recognition",
        "postseason_individual_value",
        "team_achievement",
        "teammate_adjustment",
    ]
    w_comps = winner_peak.get("components", {})
    l_comps = loser_peak.get("components", {})
    component_comparison = {
        k: ComponentComparison(
            winner=w_comps.get(k, 0.0),
            loser=l_comps.get(k, 0.0),
            winner_leads=w_comps.get(k, 0.0) >= l_comps.get(k, 0.0),
        )
        for k in component_keys
    }

    # 10. Explanation
    explanation = generate_explanation(winner_peak, loser_peak, prime_index_gap)

    return AnswerResponse(
        correct=correct,
        winning_peak_id=winning_peak_id,
        arena_points_awarded=arena_points,
        updated_streak=updated_streak,
        difficulty=difficulty,
        score_gap=round(prime_index_gap, 4),
        winner=winner_peak,
        loser=loser_peak,
        component_comparison=component_comparison,
        explanation=explanation,
        selected_correctly=correct,
    )
