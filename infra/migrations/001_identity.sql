-- Migration 001: Identity tables
-- Applies to: Supabase / PostgreSQL
-- Run: psql $DATABASE_URL -f 001_identity.sql

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_sub        TEXT UNIQUE NOT NULL,          -- Supabase auth.uid()
    handle          TEXT UNIQUE,                    -- normalized, case-insensitive public handle
    display_name    TEXT,
    bio             TEXT CHECK (char_length(bio) <= 500),
    region          TEXT,
    avatar_key      TEXT,                          -- key into a curated set, or null → initials
    is_public       BOOLEAN NOT NULL DEFAULT false,
    history_public  BOOLEAN NOT NULL DEFAULT false,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_lower_idx
    ON profiles (lower(handle))
    WHERE handle IS NOT NULL;

-- ---------------------------------------------------------------------------
-- user_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
    profile_id      UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    reduced_motion  BOOLEAN NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- anonymous_subjects: one row per anonymous credential
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anonymous_subjects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sub_hash        TEXT UNIQUE NOT NULL,          -- sha256 of the anon sub claim
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at     TIMESTAMPTZ,                   -- set when claimed
    linked_profile  UUID REFERENCES profiles(id)   -- set when claimed
);

-- ---------------------------------------------------------------------------
-- ownership_claims: audit log when anon activity is transferred to a user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ownership_claims (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    real_user_sub       TEXT NOT NULL,
    anon_subject_id     TEXT UNIQUE NOT NULL,       -- the anon sub (not UUID)
    claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    game_count          INTEGER NOT NULL DEFAULT 0,
    completion_count    INTEGER NOT NULL DEFAULT 0,
    challenge_count     INTEGER NOT NULL DEFAULT 0
);

-- Down:
-- DROP TABLE IF EXISTS ownership_claims;
-- DROP TABLE IF EXISTS anonymous_subjects;
-- DROP TABLE IF EXISTS user_settings;
-- DROP TABLE IF EXISTS profiles;
