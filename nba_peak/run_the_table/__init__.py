"""RUN THE TABLE — PEAK3's deterministic front-office roguelike engine.

This package is pure Python with no FastAPI/Pydantic dependency, mirroring the
layout of ``nba_peak.lineup`` (which backs Peak Draft) and
``nba_peak.perfect_season``. The FastAPI layer in ``apps/api/app`` wraps it.

Design contract
---------------
* Every card is a **canonical exact 3-year prime window** taken from the
  committed PEAK3 artifacts. The engine never recomputes PEAK3 scores.
* Every run is fully reproducible from ``(seed, ruleset_version,
  engine_version, card_pool_version)``.
* No randomness is drawn outside :mod:`nba_peak.run_the_table.rng`.
* No LLM, heuristic, or subjective judgement influences any number.
"""
from __future__ import annotations

from nba_peak.run_the_table.config import (
    CARD_POOL_VERSION,
    ENGINE_VERSION,
    RULESET_VERSION,
    version_tuple,
)

__all__ = [
    "CARD_POOL_VERSION",
    "ENGINE_VERSION",
    "RULESET_VERSION",
    "version_tuple",
]
