"""PEAK3 Arena API — FastAPI entry point."""
from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import health, leaderboards, meta, methodology, players, game
from app.api.v1 import draft
from app.api.v1 import auth as auth_router
from app.api.v1 import profiles as profiles_router
from app.api.v1 import history as history_router
from app.api.v1 import progression as progression_router
from app.api.v1 import ranked as ranked_router
from app.core.config import settings
from app.core.dataset import dataset_store

# Ensure repo root is on sys.path so `nba_peak` lineup package is importable
_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Load the dataset once at startup and release on shutdown."""
    logger.info("Loading PEAK3 dataset from %s", settings.DATA_DIR)
    try:
        dataset_store.load(settings.DATA_DIR)
    except FileNotFoundError as exc:
        logger.warning("Dataset not available at startup: %s", exc)
        # API will start but readiness probe returns 503 until data is available.

    # Initialize PostgreSQL connection pool if DATABASE_URL is configured
    if settings.DATABASE_URL:
        try:
            from app.repositories.postgres import create_pool
            app.state.db_pool = await create_pool(settings.DATABASE_URL)
            logger.info("PostgreSQL connection pool initialized")
        except Exception as exc:
            logger.error("Failed to initialize database pool: %s", exc)
            if not settings.DEBUG:
                raise
            app.state.db_pool = None
    else:
        app.state.db_pool = None
        if not settings.DEBUG:
            raise RuntimeError(
                "DATABASE_URL is required in production. "
                "Set PEAK3_DATABASE_URL."
            )
        logger.warning(
            "DATABASE_URL not set — using in-memory repositories. "
            "State will be lost on restart."
        )

    yield

    if getattr(app.state, "db_pool", None) is not None:
        await app.state.db_pool.close()
        logger.info("PostgreSQL connection pool closed")

    logger.info("PEAK3 API shutting down")


app = FastAPI(
    title="PEAK3 Arena API",
    version="1.0.0",
    description="Basketball analytics game API — serving peak performance duels.",
    lifespan=lifespan,
)

# CORS
allowed_origins = list(settings.CORS_ORIGINS)
if settings.DEBUG:
    for origin in ("http://localhost:3000", "http://localhost:3001"):
        if origin not in allowed_origins:
            allowed_origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(health.router, tags=["health"])
app.include_router(leaderboards.router, prefix="/api/v1", tags=["leaderboards"])
app.include_router(meta.router, prefix="/api/v1", tags=["meta"])
app.include_router(methodology.router, prefix="/api/v1", tags=["methodology"])
app.include_router(players.router, prefix="/api/v1", tags=["players"])
app.include_router(game.router, prefix="/api/v1", tags=["game"])
app.include_router(draft.router, prefix="/api/v1", tags=["draft"])
app.include_router(auth_router.router, prefix="/api/v1", tags=["auth"])
app.include_router(profiles_router.router, prefix="/api/v1", tags=["profiles"])
app.include_router(history_router.router, prefix="/api/v1", tags=["history"])
app.include_router(progression_router.router, prefix="/api/v1", tags=["progression"])
app.include_router(ranked_router.router, prefix="/api/v1", tags=["ranked"])
