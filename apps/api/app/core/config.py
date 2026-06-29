import warnings
from pathlib import Path

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

    @model_validator(mode="after")
    def warn_insecure_secret(self) -> "Settings":
        if self.DEBUG and self.SIGNING_SECRET == "INSECURE_DEV_SECRET_CHANGE_IN_PRODUCTION":
            warnings.warn(
                "PEAK3_SIGNING_SECRET is set to the insecure default. "
                "Set PEAK3_SIGNING_SECRET in your environment or .env file.",
                stacklevel=2,
            )
        return self


settings = Settings()
