-- Migration 002: Version registry tables
-- Canonical records for each software version component used to generate boards.

CREATE TABLE IF NOT EXISTS lineup_model_versions (
    version         TEXT PRIMARY KEY,
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current      BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS ruleset_versions (
    version         TEXT PRIMARY KEY,
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current      BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT
);

CREATE TABLE IF NOT EXISTS card_pool_versions (
    version         TEXT PRIMARY KEY,
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current      BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT
);

-- Seed current versions from config.py values
INSERT INTO lineup_model_versions (version, is_current, notes)
    VALUES ('experimental_lineup_v3', true, 'Phase 3.0 initial')
    ON CONFLICT (version) DO NOTHING;

INSERT INTO ruleset_versions (version, is_current, notes)
    VALUES ('ruleset_v3', true, 'Phase 3.0 initial')
    ON CONFLICT (version) DO NOTHING;

INSERT INTO card_pool_versions (version, is_current, notes)
    VALUES ('v3', true, 'Phase 3.0 initial')
    ON CONFLICT (version) DO NOTHING;

-- Down:
-- DROP TABLE IF EXISTS card_pool_versions;
-- DROP TABLE IF EXISTS ruleset_versions;
-- DROP TABLE IF EXISTS lineup_model_versions;
