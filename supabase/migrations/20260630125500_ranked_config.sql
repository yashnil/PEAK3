-- Migration 011: Ranked configuration (versioned, code-reviewed, not operator-tunable)
-- ranked_queue_versions, rating_algorithm_versions, division_versions
--
-- These tables mirror apps/api/app/services/ranked/versions.py. Application code
-- reads defaults from that module; these tables exist so a match/ledger entry can
-- pin the *exact* version tuple active when it was created (ADR-004 §15), and so
-- version history is queryable/auditable rather than only living in source control.

-- ---------------------------------------------------------------------------
-- ranked_queue_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_queue_versions (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode                            TEXT NOT NULL CHECK (mode IN ('apex_1y', 'prime_3y', 'foundation_5y')),
    queue_version                   TEXT NOT NULL,
    status                          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    ruleset_version                 TEXT NOT NULL,
    lineup_model_version            TEXT NOT NULL,
    card_pool_version               TEXT NOT NULL,
    board_generator_version         TEXT NOT NULL,
    anchor_eligibility_version      TEXT NOT NULL,
    rating_algorithm_version        TEXT NOT NULL,
    placement_count                 INTEGER NOT NULL DEFAULT 7,
    matchmaking_params              JSONB NOT NULL DEFAULT '{}',
    valid_from                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at                      TIMESTAMPTZ,

    CONSTRAINT ranked_queue_versions_unique UNIQUE (mode, queue_version)
);

CREATE INDEX IF NOT EXISTS ranked_queue_versions_mode_status_idx
    ON ranked_queue_versions (mode, status);

-- ---------------------------------------------------------------------------
-- rating_algorithm_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rating_algorithm_versions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    algorithm_version           TEXT NOT NULL UNIQUE,
    algorithm_name              TEXT NOT NULL DEFAULT 'glicko-2',
    initial_rating               NUMERIC(8, 4) NOT NULL,
    initial_rd                   NUMERIC(8, 4) NOT NULL,
    initial_volatility           NUMERIC(10, 8) NOT NULL,
    tau                          NUMERIC(6, 4) NOT NULL,
    epsilon                      NUMERIC(12, 10) NOT NULL,
    rating_period_strategy       TEXT NOT NULL,
    valid_from                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at                   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- division_versions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS division_versions (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    division_version                    TEXT NOT NULL UNIQUE,
    thresholds                          JSONB NOT NULL,   -- [{"rating": 0, "label": "Prospect"}, ...]
    legend_min_valid_matches             INTEGER NOT NULL,
    high_tier_min_queue_population        INTEGER NOT NULL,
    valid_from                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at                          TIMESTAMPTZ
);

-- Down:
-- DROP TABLE IF EXISTS division_versions;
-- DROP TABLE IF EXISTS rating_algorithm_versions;
-- DROP TABLE IF EXISTS ranked_queue_versions;
