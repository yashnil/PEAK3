from fastapi import APIRouter

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/meta")
async def get_meta() -> dict:
    """Return the pre-generated metadata.json describing the dataset."""
    return dataset_store.get_metadata()
