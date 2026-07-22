-- Migration 009: Streak states and streak events
-- Applies to: Supabase / PostgreSQL
-- Depends on: 001_identity.sql, 006_progression.sql

-- ---------------------------------------------------------------------------
-- streak_states: one canonical active streak state per owner
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS streak_states (
    owner_sub               TEXT PRIMARY KEY,
    policy_version          TEXT NOT NULL REFERENCES xp_policy_versions(version),
    current_streak          INTEGER NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
    longest_streak          INTEGER NOT NULL DEFAULT 0 CHECK (longest_streak >= 0),
    last_qualifying_date    DATE,                -- local date of last qualifying completion
    last_qualifying_tz      TEXT NOT NULL DEFAULT 'UTC',  -- IANA timezone at time of last event
    reserve_count           INTEGER NOT NULL DEFAULT 0,
    reserve_cap             INTEGER NOT NULL DEFAULT 1,
    last_reserve_earned_at  TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- streak_events: append-only history of streak transitions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS streak_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,
    event_type          TEXT NOT NULL CHECK (event_type IN (
                            'increment', 'same_day', 'reserve_consumed',
                            'reset', 'reserve_earned', 'merge_claim', 'initialized'
                        )),
    local_date          DATE NOT NULL,           -- the qualifying local day this event covers
    tz_used             TEXT NOT NULL,           -- IANA timezone active at evaluation time
    streak_before       INTEGER NOT NULL,
    streak_after        INTEGER NOT NULL,
    reserve_before      INTEGER NOT NULL DEFAULT 0,
    reserve_after       INTEGER NOT NULL DEFAULT 0,
    source_type         TEXT,                    -- 'daily_completion' | 'claim_merge'
    source_id           TEXT,                    -- ID of the triggering source
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    original_owner_sub  TEXT                     -- set during claim migration
);

CREATE INDEX IF NOT EXISTS streak_events_owner_idx
    ON streak_events (owner_sub, occurred_at DESC);
