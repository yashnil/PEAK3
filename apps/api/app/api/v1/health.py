from fastapi import APIRouter, Response

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Liveness probe — always returns 200 if the process is running."""
    return {"status": "ok", "service": "peak3-arena-api", "version": "1.0.0"}


@router.get("/health/readiness")
async def readiness(response: Response) -> dict:
    """Readiness probe — returns 503 if the dataset has not been loaded."""
    if not dataset_store.is_loaded:
        response.status_code = 503
        return {"status": "unavailable", "dataset_loaded": False, "player_count": 0, "duration_count": 0}

    meta = dataset_store.get_metadata()
    lb = dataset_store.get_all_leaderboards()
    return {
        "status": "ready",
        "dataset_loaded": True,
        "player_count": meta.get("player_count", 0),
        "duration_count": len(lb),
    }
