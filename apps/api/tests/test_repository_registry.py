"""Tests for the startup repository-mode registry (Phase 4.0A section I)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.repository_registry import (
    REPOSITORY_DOMAINS,
    assert_production_ready,
    build_repository_registry,
)


def test_registry_covers_every_known_domain():
    registry = build_repository_registry(db_pool_present=True)
    assert set(registry.keys()) == set(REPOSITORY_DOMAINS)


def test_registry_reports_postgres_when_pool_present():
    registry = build_repository_registry(db_pool_present=True)
    assert all(backend == "postgres" for backend in registry.values())


def test_registry_reports_memory_when_pool_absent():
    registry = build_repository_registry(db_pool_present=False)
    assert all(backend == "memory" for backend in registry.values())


def test_dev_mode_allows_memory_backend():
    registry = build_repository_registry(db_pool_present=False)
    assert_production_ready(registry, debug=True)  # must not raise


def test_production_mode_rejects_memory_backend():
    registry = build_repository_registry(db_pool_present=False)
    with pytest.raises(RuntimeError, match="PostgreSQL-backed"):
        assert_production_ready(registry, debug=False)


def test_production_mode_accepts_full_postgres_backend():
    registry = build_repository_registry(db_pool_present=True)
    assert_production_ready(registry, debug=False)  # must not raise


def test_production_mode_rejects_mixed_backends():
    registry = build_repository_registry(db_pool_present=True)
    registry[REPOSITORY_DOMAINS[0]] = "memory"  # simulate a future wiring mistake
    with pytest.raises(RuntimeError, match="PostgreSQL-backed"):
        assert_production_ready(registry, debug=False)
