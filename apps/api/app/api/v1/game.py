"""Game endpoints: daily challenge, endless mode, and answer submission.

THE SERVER OWNS "TODAY". `GET /game/daily` used to fall back to its own clock
only when the browser omitted `?date=`, and performed no validation at all on
the value when it was present — so the day a player was playing was decided by
their device, and any date, past or future, minted a signed session token for a
board that had not opened. Now the date is `validate_daily_key(date)` when a
client explicitly asks for an archive board and `daily_key()` otherwise, both
resolved against `nba_peak.daily_key` (midnight America/Los_Angeles).
"""
from __future__ import annotations

import random
import sys
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

_repo_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.daily_key import (
    InvalidDailyKey,
    daily_key,
    daily_window,
    validate_daily_key,
)

from app.core.auth import ANON_COOKIE_NAME, OptionalAuth, resolve_owner_sub
from app.core.config import settings
from app.core.dataset import dataset_store
from app.core.dependencies import PeakDuelDailyResultRepoDep
from app.core.rate_limit import RateLimitRule, client_key, limiter
from app.core.security import create_session_token, verify_session_token
from app.repositories.peak_duel_daily_protocols import PeakDuelDailyResult
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


class DailyGameWithWindow(DailyGameResponse):
    """`DailyGameResponse` plus the frozen daily-window block (plan §2.1).

    Declared here rather than on the shared model because every daily response
    in the app carries the identical object under the top-level key `daily`,
    produced by `DailyWindow.to_payload()`:

        {"daily_key", "timezone", "starts_at", "ends_at", "seconds_remaining"}

    Clients count down from `seconds_remaining`; they never recompute a
    timezone boundary in JavaScript, which is what let five modes disagree.
    """

    daily: dict


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


@router.get("/game/daily", response_model=DailyGameWithWindow)
async def get_daily_game(
    years: int = Query(default=3),
    date: str = Query(default=""),
) -> DailyGameWithWindow:
    """Generate (or replay) the daily challenge for a given date and duration.

    `date` is an ARCHIVE REQUEST, never the client's opinion of today. Omit it
    and the server answers with its own daily key; supply it and it is validated
    for shape, bounded to the archive window, and rejected outright if it names
    a board that has not opened yet.
    """
    _validate_years(years)

    try:
        date = validate_daily_key(date) if date else daily_key()
    except InvalidDailyKey as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        pool = dataset_store.get_leaderboard(years)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No leaderboard data for years={years}")

    duels = generate_daily_duels(pool, years, date, count=settings.DAILY_DUEL_COUNT)
    if not duels:
        raise HTTPException(status_code=500, detail="Could not generate duels — pool may be too small")

    payload = _duels_to_token_payload("daily", years, duels, date=date)
    token = create_session_token(payload, settings.SIGNING_SECRET, settings.SESSION_TTL_SECONDS)

    return DailyGameWithWindow(
        date=date,
        years=years,
        duel_count=len(duels),
        duels=[_build_public_duel(d) for d in duels],
        session_token=token,
        daily=daily_window(date).to_payload(),
    )


class DailyResultRequest(BaseModel):
    """A completed Peak Duel Daily attempt, submitted for the official record.

    The client sends only what it cannot be trusted to score: which peak it
    picked in each duel. Correctness, arena points and the streak are all
    recomputed here from the signed session token and the dataset — a submitted
    score is never persisted.
    """

    session_token: str
    selections: dict[str, str] = Field(default_factory=dict)
    elapsed_seconds: Optional[int] = Field(default=None, ge=0, le=86_400)


class DailyResultResponse(BaseModel):
    saved: bool
    already_recorded: bool
    daily_key: str
    duration_years: int
    duels_total: int
    correct_count: int
    arena_points: int
    best_streak: int
    played_on_daily_key: bool


@router.post("/game/daily/result", response_model=DailyResultResponse)
async def post_daily_result(
    body: DailyResultRequest,
    request: Request,
    response: Response,
    repo: PeakDuelDailyResultRepoDep,
    auth: OptionalAuth = None,
) -> DailyResultResponse:
    """Record the official Peak Duel Daily attempt for the calling identity.

    Of the five daily modes this was the only one with no server-side attempt
    record at all: the result lived exclusively in localStorage, so "one
    attempt per day" was a convention the client agreed to rather than a rule,
    and a guest's daily history could not be claimed on sign-in because there
    was nothing to claim.

    Anonymous-first, like RUN THE TABLE: the attempt is recorded under the
    signed `peak3_anon` cookie subject when there is no account, and
    `transfer_owner` moves it the moment the player signs in.

    Idempotent by construction. A second POST for the same
    (owner, mode, daily_key) returns the attempt already on file rather than
    replacing it — otherwise a player could resubmit until they liked the
    number.
    """
    # Metered before anything else. This is a write endpoint that does not
    # require an account — a guest records their attempt under the signed anon
    # cookie — so it needs a bound, and the legitimate ceiling is one attempt
    # per identity per day plus retries. The 429 carries `Retry-After` and
    # nothing about the budget's size, matching the Daily Grid routes: a
    # running remaining-count is exactly the calibration signal a prober wants.
    verdict = limiter.check(
        client_key(request, "peak_duel:result"),
        RateLimitRule(
            limit=settings.PEAK_DUEL_RESULT_RATE_LIMIT,
            window_seconds=settings.PEAK_DUEL_RESULT_RATE_LIMIT_WINDOW_SECONDS,
        ),
    )
    if not verdict.allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many daily result submissions. Try again shortly.",
            headers={"Retry-After": str(verdict.retry_after_seconds)},
        )

    session = verify_session_token(body.session_token, settings.SIGNING_SECRET)
    if session is None:
        raise HTTPException(status_code=400, detail="Invalid or expired session token")

    if session.get("mode") != "daily":
        # Endless has no daily key and no one-attempt rule; recording it here
        # would invent a daily the player never played.
        raise HTTPException(status_code=400, detail="session_token is not a daily session")

    session_date = session.get("date")
    years: int = session.get("years", 0)
    session_duels: list[dict] = session.get("duels", [])
    if not session_date or not session_duels:
        raise HTTPException(status_code=400, detail="daily session token is malformed")

    try:
        resolved_key = validate_daily_key(session_date)
    except InvalidDailyKey as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # Score it here, from the token's duels and the dataset. Anything the
    # client asserted about its own performance is ignored.
    #
    # The recorded `arena_points` deliberately EXCLUDE the speed bonus. Live
    # scoring in /game/answer includes it, but it is derived from a client-
    # supplied `elapsed_ms` that the server cannot verify, and this record is
    # the one that can become a personal best and survive a sign-in. Passing
    # elapsed_ms=0 zeroes that component; base, closeness and the streak
    # multiplier are all re-derivable from the signed token and the dataset, so
    # every point in this row is one the server can prove.
    peaks: list[tuple[dict, dict]] = []
    for duel in session_duels:
        left = _lookup_peak(duel["left_id"], years)
        right = _lookup_peak(duel["right_id"], years)
        if left is None or right is None:
            raise HTTPException(status_code=500, detail="Duel peak data not found in dataset")
        peaks.append((left, right))

    all_gaps = [abs(l["prime_index"] - r["prime_index"]) for l, r in peaks]

    correct_count = 0
    best_streak = 0
    streak = 0
    arena_points = 0
    answers: list[dict] = []

    for duel, (left, right) in zip(session_duels, peaks):
        winner = left if left["prime_index"] >= right["prime_index"] else right
        selected = body.selections.get(duel["id"])
        # A duel the player never answered is wrong, not absent: the attempt is
        # a whole board, and letting unanswered duels vanish would make a
        # partial run indistinguishable from a perfect one.
        correct = selected is not None and selected == winner["id"]

        arena_points += calculate_arena_points(
            correct,
            abs(left["prime_index"] - right["prime_index"]),
            0,  # see the note above — the speed bonus is not verifiable
            streak,
            all_gaps,
        )

        if correct:
            correct_count += 1
            streak += 1
            best_streak = max(best_streak, streak)
        else:
            streak = 0

        answers.append(
            {"duel_id": duel["id"], "selected_peak_id": selected, "correct": correct}
        )

    owner_sub = resolve_owner_sub(
        auth, request.cookies.get(ANON_COOKIE_NAME), response, settings.SIGNING_SECRET
    )

    record, created = await repo.save_result(
        PeakDuelDailyResult(
            id=str(uuid.uuid4()),
            owner_sub=owner_sub,
            mode="peak_duel",
            daily_key=resolved_key,
            duration_years=years,
            duels_total=len(session_duels),
            correct_count=correct_count,
            arena_points=arena_points,
            best_streak=best_streak,
            elapsed_seconds=body.elapsed_seconds,
            # An archive replay is recorded honestly rather than rejected: it
            # is a real thing the player did, it is simply not a live attempt
            # at today's daily and must not count toward a streak.
            played_on_daily_key=resolved_key == daily_key(),
            answers=answers,
        )
    )

    return DailyResultResponse(
        saved=True,
        already_recorded=not created,
        daily_key=record.daily_key,
        duration_years=record.duration_years,
        duels_total=record.duels_total,
        correct_count=record.correct_count,
        arena_points=record.arena_points,
        best_streak=record.best_streak,
        played_on_daily_key=record.played_on_daily_key,
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
