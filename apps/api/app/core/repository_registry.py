"""Startup repository-mode registry (Phase 4.0A section I).

Every repository domain in this project is switched by the single
`app.state.db_pool` flag (see core/dependencies.py's get_*_repo functions —
each checks `request.app.state.db_pool is not None` and nothing else). There
is exactly one connection pool for the whole process, so per-domain backend
divergence cannot occur by construction today. This module makes that
guarantee explicit and *checked* rather than assumed: it enumerates every
domain, logs a safe (no connection strings, no secrets, no project IDs)
summary at startup, and fails production startup outright if any domain
would resolve to memory or if backends are ever mixed.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Every durable domain wired through core/dependencies.py's get_*_repo
# functions. Keep in sync when a new domain/table is added.
REPOSITORY_DOMAINS: list[str] = [
    "game",
    "challenge",
    "daily_completion",
    "result_snapshot",
    "ownership_claim",
    "progression",
    "personal_record",
    "achievement",
    "streak",
    "profile",
    "ranked_matchmaking",
    "ranked_rating",
    "ranked_integrity",
]


def build_repository_registry(db_pool_present: bool) -> dict[str, str]:
    """Return {domain: "postgres" | "memory"} for every known domain."""
    backend = "postgres" if db_pool_present else "memory"
    return {domain: backend for domain in REPOSITORY_DOMAINS}


def log_repository_registry(registry: dict[str, str]) -> None:
    """Log a safe backend summary — domain -> backend name only."""
    backends = set(registry.values())
    if len(backends) == 1:
        logger.info(
            "Repository registry: %s (%d/%d domains)",
            next(iter(backends)), len(registry), len(REPOSITORY_DOMAINS),
        )
    else:
        # Cannot happen given today's single-pool-flag design (see module
        # docstring) — logged as an error rather than silently accepted in
        # case a future domain's get_*_repo function is wired incorrectly.
        logger.error("Repository backends are MIXED across domains: %s", registry)


def assert_production_ready(registry: dict[str, str], debug: bool) -> None:
    """Fail startup if production mode has any non-durable or mixed domain."""
    if debug:
        return
    non_durable = sorted(d for d, backend in registry.items() if backend != "postgres")
    if non_durable:
        raise RuntimeError(
            "Production startup requires every repository domain to be "
            f"PostgreSQL-backed. Non-durable domains: {non_durable}. "
            "Set PEAK3_DATABASE_URL."
        )
