from fastapi import APIRouter, HTTPException, Query

from app.core.dataset import dataset_store
from app.models.leaderboard import PlayerDetailResponse, PlayerSearchResponse, PlayerSummary

router = APIRouter()


@router.get("/players/search", response_model=PlayerSearchResponse)
async def search_players(
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
) -> PlayerSearchResponse:
    """Full-text search across all player names, deduplicated by player_slug."""
    query = q.lower()
    all_leaderboards = dataset_store.get_all_leaderboards()

    # slug → {best_rank, name, durations}
    player_map: dict[str, dict] = {}

    for duration, rows in all_leaderboards.items():
        for record in rows:
            name = record.get("player_name", "")
            if query not in name.lower():
                continue
            slug = record["player_slug"]
            rank = record.get("rank", 9999)
            if slug not in player_map:
                player_map[slug] = {
                    "player_name": name,
                    "best_rank": rank,
                    "available_durations": [duration],
                }
            else:
                if rank < player_map[slug]["best_rank"]:
                    player_map[slug]["best_rank"] = rank
                if duration not in player_map[slug]["available_durations"]:
                    player_map[slug]["available_durations"].append(duration)

    results = sorted(player_map.items(), key=lambda x: x[1]["best_rank"])[:limit]
    players = [
        PlayerSummary(
            player_slug=slug,
            player_name=data["player_name"],
            best_rank=data["best_rank"],
            available_durations=sorted(data["available_durations"]),
        )
        for slug, data in results
    ]
    return PlayerSearchResponse(players=players)


@router.get("/players/{player_slug}", response_model=PlayerDetailResponse)
async def get_player(player_slug: str) -> PlayerDetailResponse:
    """Return all peak windows for a specific player across all durations."""
    all_leaderboards = dataset_store.get_all_leaderboards()

    windows: dict[str, dict] = {}
    player_name = ""

    for duration, rows in all_leaderboards.items():
        for record in rows:
            if record.get("player_slug") == player_slug:
                windows[str(duration)] = record
                player_name = record.get("player_name", player_slug)
                break

    if not windows:
        raise HTTPException(
            status_code=404,
            detail=f"No data found for player_slug='{player_slug}'",
        )

    return PlayerDetailResponse(
        player_slug=player_slug,
        player_name=player_name,
        windows=windows,
    )
