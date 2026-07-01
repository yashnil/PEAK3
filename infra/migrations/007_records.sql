-- Migration 007: Personal records and record events
-- Applies to: Supabase / PostgreSQL
-- Depends on: 003_game_records.sql, 006_progression.sql

-- ---------------------------------------------------------------------------
-- personal_records: current best result per (owner, type, mode, version_tuple)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub               TEXT NOT NULL,
    record_type             TEXT NOT NULL,  -- 'lineup_score'|'draft_efficiency'|'daily_percentile'|'challenge_margin'
    mode                    TEXT NOT NULL,  -- 'apex_1y'|'prime_3y'|'foundation_5y'|'all'
    lineup_model_version    TEXT NOT NULL,
    card_pool_version       TEXT NOT NULL,
    ruleset_version         TEXT NOT NULL,
    record_value            NUMERIC(10,4) NOT NULL,  -- higher is better for all types except daily_percentile
    higher_is_better        BOOLEAN NOT NULL DEFAULT true,
    source_result_id        TEXT NOT NULL,           -- references result_snapshots.id
    achieved_at             TIMESTAMPTZ NOT NULL,
    previous_record_id      UUID REFERENCES personal_records(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One canonical current record per full identity
    CONSTRAINT personal_records_unique
        UNIQUE (owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)
);

CREATE INDEX IF NOT EXISTS personal_records_owner_idx
    ON personal_records (owner_sub, record_type, mode);

-- ---------------------------------------------------------------------------
-- personal_record_events: history of record improvements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_record_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,
    record_type         TEXT NOT NULL,
    mode                TEXT NOT NULL,
    lineup_model_version TEXT NOT NULL,
    card_pool_version   TEXT NOT NULL,
    ruleset_version     TEXT NOT NULL,
    new_value           NUMERIC(10,4) NOT NULL,
    previous_value      NUMERIC(10,4),
    source_result_id    TEXT NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    original_owner_sub  TEXT                    -- set during claim migration
);

CREATE INDEX IF NOT EXISTS personal_record_events_owner_idx
    ON personal_record_events (owner_sub, occurred_at DESC);
