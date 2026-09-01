from fastapi import APIRouter, Request, Response

from app.core.dataset import dataset_store

router = APIRouter()


@router.get("/health")
async def health() -> dict:
    """Liveness probe — always returns 200 if the process is running."""
    return {"status": "ok", "service": "peak3-arena-api", "version": "1.0.0"}


@router.get("/health/readiness")
async def readiness(request: Request, response: Response) -> dict:
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

    `repository_mode` (public-platform-readiness Batch P1) is the same
    "postgres" | "memory" signal `app.core.repository_registry` already logs
    once at startup, put where a human can actually check it. The startup log
    line was the ONLY place this was visible; a deploy running DEBUG=True with
    no PEAK3_DATABASE_URL configured serves every request "successfully" while
    silently storing profiles, handles, and every other durable domain in a
    process-local dict that a restart empties — which is exactly the local-dev
    configuration that reproduced the "handle forgotten after sign back in"
    report this endpoint was extended to help diagnose. `assert_production_ready`
    already refuses to boot with DEBUG=False in this state; this field is for
    the DEBUG=True case that guard intentionally allows, and for verifying a
    deploy without reading its logs.
    """
    # IMPORTED INSIDE THE HANDLER, like `settings` below. `app.main` puts the
    # repository root on `sys.path`, and it does so AFTER importing this module
    # -- so a module-level `nba_peak` import here fails at startup with
    # ModuleNotFoundError. Deferring it is the same accommodation the rest of
    # this function already makes.
    from nba_peak.nba_facts import bank_status

    facts = bank_status()
    repository_mode = "postgres" if getattr(request.app.state, "db_pool", None) is not None else "memory"

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
            "repository_mode": repository_mode,
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
        # "postgres" | "memory" — "memory" means every durable domain (profiles,
        # handles, saved runs, ratings, matches...) is process-local and will be
        # lost on the next restart. Never "memory" in a real deploy unless
        # PEAK3_DEBUG is also (incorrectly) true there.
        "repository_mode": repository_mode,
    }
