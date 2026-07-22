import warnings
from pathlib import Path
from typing import Literal, Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PEAK3_", env_file=".env", extra="ignore")

    SIGNING_SECRET: str = "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION"
    DEBUG: bool = True
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    SESSION_TTL_SECONDS: int = 86400
    # Absolute path resolved relative to this file: apps/api/app/core/config.py → repo root / data / web
    DATA_DIR: Path = Path(__file__).resolve().parent.parent.parent.parent.parent / "data" / "web"
    DAILY_DUEL_COUNT: int = 10
    ENDLESS_MAX_COUNT: int = 50

    # ---------------------------------------------------------------------------
    # Phase 3.0 — durable persistence + auth
    # ---------------------------------------------------------------------------

    # PostgreSQL connection string, e.g. postgresql://user:pass@host/db
    # Required in production (DEBUG=False).  In DEBUG mode, omitting this falls
    # back to in-memory repositories with a startup warning.
    DATABASE_URL: Optional[str] = None

    # Supabase project JWT secret — used to verify access tokens issued by
    # Supabase Auth.  Required for /api/v1/auth/me and protected endpoints.
    SUPABASE_JWT_SECRET: Optional[str] = None

    # Supabase anon key — sent to the frontend for the Supabase JS client.
    SUPABASE_ANON_KEY: Optional[str] = None

    # Supabase project URL — sent to the frontend for the Supabase JS client.
    SUPABASE_URL: Optional[str] = None

    # ---------------------------------------------------------------------------
    # Phase 4.0 — Ranked duels feature flags
    #
    # These are independent capability switches, not one ambiguous boolean.
    # RANKED_READINESS_LEVEL is the human-facing summary of the combination below;
    # the individual booleans are what code actually branches on.
    # ---------------------------------------------------------------------------

    # Master switch: ranked routes/UI exist at all (still gated further by the
    # switches below and by RANKED_ALPHA_ALLOWLIST).
    RANKED_ENABLED: bool = False

    # Whether the matchmaker will pair waiting queue entries into matches.
    # Can be off even when RANKED_ENABLED=True (e.g. simulation-only readiness).
    RANKED_MATCHMAKING_ENABLED: bool = False

    # Whether settlement is allowed to write rating ledger entries / update
    # queue_ratings. Kept independently switchable so a dry-run settlement path
    # (compute but do not persist) is possible during validation.
    RANKED_RATING_WRITES_ENABLED: bool = False

    # Whether the public (feature-gated) leaderboard endpoints return data.
    RANKED_PUBLIC_LEADERBOARD_ENABLED: bool = False

    # Closed-alpha allowlist of Supabase auth_sub values permitted to see/use
    # ranked routes when RANKED_ENABLED=True but the release is not yet public.
    # Empty list + RANKED_ENABLED=True means "internal engineering only."
    RANKED_ALPHA_ALLOWLIST: list[str] = []

    # Human-facing readiness classification. Does not itself gate behavior —
    # the booleans above do — but is surfaced on /api/v1/ranked/readiness and
    # must be kept consistent with them (validated below).
    RANKED_READINESS_LEVEL: Literal[
        "disabled", "simulation_only", "internal_alpha", "closed_alpha", "public_beta"
    ] = "disabled"

    @model_validator(mode="after")
    def validate_ranked_readiness(self) -> "Settings":
        level = self.RANKED_READINESS_LEVEL
        if level == "disabled" and (
            self.RANKED_ENABLED or self.RANKED_MATCHMAKING_ENABLED or self.RANKED_RATING_WRITES_ENABLED
        ):
            raise ValueError(
                "PEAK3_RANKED_READINESS_LEVEL is 'disabled' but a ranked capability "
                "flag is enabled. Set an appropriate readiness level or disable the flag."
            )
        if level == "public_beta" and not self.RANKED_PUBLIC_LEADERBOARD_ENABLED:
            # Public beta without a public leaderboard is a valid (conservative)
            # configuration, so this is intentionally not an error — just documented
            # here as a case operators should double-check.
            pass
        return self

    @model_validator(mode="after")
    def warn_insecure_secret(self) -> "Settings":
        if self.DEBUG and self.SIGNING_SECRET == "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION":
            warnings.warn(
                "PEAK3_SIGNING_SECRET is set to the insecure default. "
                "Set PEAK3_SIGNING_SECRET in your environment or .env file.",
                stacklevel=2,
            )
        if not self.DEBUG and self.DATABASE_URL is None:
            raise ValueError(
                "PEAK3_DATABASE_URL must be set in production (DEBUG=False). "
                "See docs/implementation/LOCAL_DEV.md for setup instructions."
            )
        return self


settings = Settings()
