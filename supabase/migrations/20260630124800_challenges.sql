-- Migration 004: Challenge tables

-- ---------------------------------------------------------------------------
-- challenges: one record per challenge link
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenges (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash          TEXT UNIQUE NOT NULL,          -- sha256(token)[:32]
    challenger_game_id  TEXT NOT NULL,
    board_id            TEXT NOT NULL,
    mode                TEXT NOT NULL,
    board_type          TEXT NOT NULL,
    duration_years      INTEGER NOT NULL,
    seed                BIGINT,
    date                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    challenger_snapshot JSONB NOT NULL,                -- immutable at creation
    anon_subject_id     TEXT,                          -- owner of challenger
    settlement          JSONB,                         -- set on first comparison
    settled_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS challenges_board_id_idx ON challenges (board_id);
CREATE INDEX IF NOT EXISTS challenges_anon_subject_id_idx ON challenges (anon_subject_id)
    WHERE anon_subject_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- challenge_participants: one row per recipient attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_participants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id    UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    participant_sub TEXT,                              -- null for unauthenticated
    game_id         TEXT NOT NULL,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS challenge_participants_challenge_id_idx
    ON challenge_participants (challenge_id);

-- Challenger cannot be a recipient. A CHECK constraint cannot contain a
-- subquery (PostgreSQL rejects this at DDL time — confirmed against a real
-- PostgreSQL 16 instance while validating Phase 4.0's migration chain, so
-- this table could never actually be created against a real database with
-- the original CHECK). A BEFORE INSERT/UPDATE trigger is the correct
-- equivalent (same pattern used for ranked_match_settlements' board-match
-- check in migration 013).
CREATE OR REPLACE FUNCTION challenge_participants_enforce_not_self() RETURNS TRIGGER AS $$
DECLARE
    challenger_sub TEXT;
BEGIN
    SELECT anon_subject_id INTO challenger_sub FROM challenges WHERE id = NEW.challenge_id;
    IF NEW.participant_sub IS NOT NULL AND NEW.participant_sub = challenger_sub THEN
        RAISE EXCEPTION 'challenge_participants.participant_sub cannot equal the challenger (challenge_id=%)', NEW.challenge_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS challenge_participants_not_self ON challenge_participants;
CREATE TRIGGER challenge_participants_not_self
    BEFORE INSERT OR UPDATE ON challenge_participants
    FOR EACH ROW EXECUTE FUNCTION challenge_participants_enforce_not_self();

-- ---------------------------------------------------------------------------
-- challenge_settlements: one per challenge/recipient pairing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenge_settlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id    UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    recipient_sub   TEXT,
    outcome         TEXT NOT NULL CHECK (outcome IN ('challenger_wins','recipient_wins','draw')),
    settled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload         JSONB NOT NULL,

    -- One settlement per challenge/recipient pairing
    CONSTRAINT challenge_settlements_unique UNIQUE (challenge_id, recipient_sub)
);

-- Down:
-- DROP TABLE IF EXISTS challenge_settlements;
-- DROP TRIGGER IF EXISTS challenge_participants_not_self ON challenge_participants;
-- DROP FUNCTION IF EXISTS challenge_participants_enforce_not_self();
-- DROP TABLE IF EXISTS challenge_participants;
-- DROP TABLE IF EXISTS challenges;
