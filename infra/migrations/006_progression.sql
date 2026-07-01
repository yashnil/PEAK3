-- Migration 006: Progression events, user progress, and XP policy versions
-- Applies to: Supabase / PostgreSQL
-- Depends on: 001_identity.sql (profiles, anonymous_subjects)

-- ---------------------------------------------------------------------------
-- xp_policy_versions: versioned XP award configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xp_policy_versions (
    version         TEXT PRIMARY KEY,            -- e.g. 'v1.0'
    config          JSONB NOT NULL,              -- full policy document
    is_active       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one policy can be active at a time
CREATE UNIQUE INDEX IF NOT EXISTS xp_policy_single_active
    ON xp_policy_versions (is_active)
    WHERE is_active = true;

-- Seed initial policy
INSERT INTO xp_policy_versions (version, config, is_active)
VALUES ('v1.0', '{
    "daily_completion_first": 100,
    "practice_completion_first_weekly": 25,
    "challenge_completion": 50,
    "receipt_exploration": 20,
    "methodology_exploration": 20,
    "first_game_bonus": 30,
    "local_day_cap": 150,
    "weekly_cap": 500,
    "reserve_streak_threshold": 7,
    "reserve_cap": 1
}', true)
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- progression_events: append-only XP event log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS progression_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,           -- auth_sub or anon:... subject
    event_type          TEXT NOT NULL,           -- e.g. 'daily_completion_first'
    source_type         TEXT NOT NULL,           -- 'result_snapshot' | 'daily_completion' | 'ui_action'
    source_id           TEXT NOT NULL,           -- ID of the source object
    idempotency_key     TEXT UNIQUE NOT NULL,    -- prevents double-award on retry
    policy_version      TEXT NOT NULL REFERENCES xp_policy_versions(version),
    xp_amount           INTEGER NOT NULL CHECK (xp_amount >= 0),
    occurred_at         TIMESTAMPTZ NOT NULL,    -- when the qualifying event happened
    awarded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata            JSONB NOT NULL DEFAULT '{}',
    progression_season_id TEXT,                 -- reserved for Phase 4.0 season scoping
    original_owner_sub  TEXT                    -- set during claim migration; tracks anon lineage
);

CREATE INDEX IF NOT EXISTS progression_events_owner_idx
    ON progression_events (owner_sub, occurred_at DESC);
CREATE INDEX IF NOT EXISTS progression_events_type_idx
    ON progression_events (owner_sub, event_type);

-- ---------------------------------------------------------------------------
-- user_progress: server-calculated aggregate (derived from progression_events)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_progress (
    owner_sub           TEXT PRIMARY KEY,
    total_xp            INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    current_level       INTEGER NOT NULL DEFAULT 1 CHECK (current_level >= 1 AND current_level <= 50),
    policy_version      TEXT NOT NULL REFERENCES xp_policy_versions(version),
    last_progression_at TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
