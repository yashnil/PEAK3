from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class DatasetStore:
    """Load and cache the pre-generated web JSON dataset from data/web/."""

    def __init__(self) -> None:
        self._leaderboards: dict[int, list[dict]] = {}
        self._metadata: dict = {}
        self._methodology: dict = {}
        self._loaded: bool = False

    def load(self, data_dir: Path) -> None:
        """Load all JSON files from data_dir into memory. Called once at startup."""
        lb_path = data_dir / "leaderboards.json"
        meta_path = data_dir / "metadata.json"
        meth_path = data_dir / "methodology.json"

        if not lb_path.exists():
            raise FileNotFoundError(
                f"Leaderboard data not found at {lb_path}. "
                "Run the PEAK3 pipeline to generate data/web/ files first."
            )
        if not meta_path.exists():
            raise FileNotFoundError(
                f"Metadata file not found at {meta_path}. "
                "Run the PEAK3 pipeline to generate data/web/ files first."
            )

        with lb_path.open() as f:
            raw = json.load(f)
        # Keys are strings in JSON; convert to int
        self._leaderboards = {int(k): v for k, v in raw.items()}

        with meta_path.open() as f:
            self._metadata = json.load(f)

        if meth_path.exists():
            with meth_path.open() as f:
                self._methodology = json.load(f)
        else:
            logger.warning("methodology.json not found at %s — returning empty dict", meth_path)
            self._methodology = {}

        self._loaded = True
        player_count = self._metadata.get("player_count", "?")
        duration_count = len(self._leaderboards)
        logger.info(
            "Dataset loaded: %s players across %s duration(s)", player_count, duration_count
        )

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def get_leaderboard(self, years: int) -> list[dict]:
        if not self._loaded:
            raise RuntimeError("Dataset has not been loaded yet.")
        lb = self._leaderboards.get(years)
        if lb is None:
            raise KeyError(f"No leaderboard data for duration_years={years}")
        return lb

    def get_all_leaderboards(self) -> dict[int, list[dict]]:
        if not self._loaded:
            raise RuntimeError("Dataset has not been loaded yet.")
        return self._leaderboards

    def get_metadata(self) -> dict:
        if not self._loaded:
            raise RuntimeError("Dataset has not been loaded yet.")
        return self._metadata

    def get_methodology(self) -> dict:
        if not self._loaded:
            raise RuntimeError("Dataset has not been loaded yet.")
        return self._methodology

    def load_fixture(self, leaderboards: dict[int, list[dict]], metadata: dict, methodology: dict) -> None:
        """Load in-memory fixture data (used in tests when data/web/ is absent)."""
        self._leaderboards = leaderboards
        self._metadata = metadata
        self._methodology = methodology
        self._loaded = True


# Global singleton — imported by routers and services
dataset_store = DatasetStore()
