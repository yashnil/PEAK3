from fastapi import APIRouter, HTTPException, Query

from app.core.dataset import dataset_store
from app.models.leaderboard import LeaderboardResponse

router = APIRouter()

VALID_YEARS = [1, 2, 3, 5]
MAX_LIMIT = 250


@router.get("/leaderboards", response_model=LeaderboardResponse)
async def get_leaderboards(
    years: int = Query(default=1, description="Duration in years (1, 2, 3, or 5)"),
    limit: int = Query(default=50, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    search: str = Query(default=""),
) -> LeaderboardResponse:
    """Return paginated leaderboard rows for a given peak duration."""
    if years not in VALID_YEARS:
        raise HTTPException(
            status_code=422,
            detail=f"years must be one of {VALID_YEARS}, got {years}",
        )

    try:
        rows = dataset_store.get_leaderboard(years)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No leaderboard data for years={years}")

    # Case-insensitive name filter
    if search:
        q = search.lower()
        rows = [r for r in rows if q in r.get("player_name", "").lower()]

    total = len(rows)
    paginated = rows[offset : offset + limit]

    return LeaderboardResponse(
        rows=paginated,
        total=total,
        duration=years,
        offset=offset,
        limit=limit,
        metadata=dataset_store.get_metadata(),
    )
