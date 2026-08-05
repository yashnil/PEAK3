from fastapi import APIRouter, Response

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Liveness probe — always returns 200 if the process is running."""
    return {"status": "ok", "service": "peak3-arena-api", "version": "1.0.0"}


@router.get("/health/readiness")
async def readiness(response: Response) -> dict:
    """Readiness probe — 503 unless EVERY generated artifact this API serves is
    present.

    THE FACT BANK IS PART OF THIS, and it is here because of a real deploy.
    `data/web/nba_facts.v1.json` is generated at image-build time like the rest
    of `data/web/`, but the Dockerfile ran only the web-dataset exporter. The
    deployed image was therefore missing exactly one file: this probe answered
    "ready", every dashboard was green, and `/api/v1/nba-facts/today` served 503
    while the homepage silently dropped the panel. A readiness probe that can
    report ready while a served endpoint cannot answer is not reporting
    readiness.

    The build now asserts the file exists, so reaching the 503 branch below
    means something removed it after the build — which is worth failing loudly
    for rather than discovering through a missing homepage section.
    """
    # IMPORTED INSIDE THE HANDLER, like `settings` below. `app.main` puts the
    # repository root on `sys.path`, and it does so AFTER importing this module
    # -- so a module-level `nba_peak` import here fails at startup with
    # ModuleNotFoundError. Deferring it is the same accommodation the rest of
    # this function already makes.
    from nba_peak.nba_facts import bank_status

    facts = bank_status()

    if not dataset_store.is_loaded or not facts["loaded"]:
        response.status_code = 503
        loaded = dataset_store.is_loaded
        meta = dataset_store.get_metadata() if loaded else {}
        return {
            "status": "unavailable",
            "dataset_loaded": loaded,
            "player_count": meta.get("player_count", 0) if loaded else 0,
            "duration_count": len(dataset_store.get_all_leaderboards()) if loaded else 0,
            "fact_bank": facts,
        }

    from app.core.config import settings

    meta = dataset_store.get_metadata()
    lb = dataset_store.get_all_leaderboards()
    return {
        "status": "ready",
        "dataset_loaded": True,
        "player_count": meta.get("player_count", 0),
        "duration_count": len(lb),
        "fact_bank": facts,
        # Surfaced so a deploy that cannot verify any access token is visible on
        # the readiness probe instead of silently 401-ing every authenticated
        # request with one WARNING line. Reports the *mode*, never key material.
        "auth_verification_mode": settings.auth_verification_mode,
    }
