from fastapi import APIRouter

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/methodology")
async def get_methodology() -> dict:
    """Return the pre-generated methodology.json (weights and component descriptions)."""
    return dataset_store.get_methodology()
