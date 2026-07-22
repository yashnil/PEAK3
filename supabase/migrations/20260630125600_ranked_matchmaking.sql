-- Migration 012: Ranked matchmaking
-- ranked_matches, ranked_match_participants, ranked_match_submissions,
-- ranked_queue_entries, ranked_opponent_history
--
-- ranked_matches is defined before ranked_queue_entries because the queue entry
-- references the match it was paired into.

-- ---------------------------------------------------------------------------
-- ranked_matches: one immutable pairing + board snapshot
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_matches (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode                        TEXT NOT NULL,
    queue_version               TEXT NOT NULL,
    board_snapshot              JSONB NOT NULL,   -- full immutable board (rounds/offers/reframe pool)
    board_version_key           TEXT NOT NULL,    -- nba_peak.lineup.board.make_board_version_key()
    rating_algorithm_version    TEXT NOT NULL,
    abandonment_policy_version  TEXT NOT NULL DEFAULT 'ranked_abandon_policy_v1',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    matched_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deadline                    TIMESTAMPTZ NOT NULL,
    status                      TEXT NOT NULL DEFAULT 'matched' CHECK (status IN (
                                    'matched', 'settlement_pending', 'settled', 'cancelled',
                                    'expired', 'forfeited', 'protected_abort', 'integrity_review',
                                    'invalidated'
                                 )),
    settlement_status           TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN (
                                    'pending', 'settled', 'invalidated'
                                 )),
    integrity_status            TEXT NOT NULL DEFAULT 'clear' CHECK (integrity_status IN (
                                    'clear', 'flagged', 'reviewed'
                                 )),
    -- FK to rating_periods(id) added in migration 013 (table does not exist yet).
    rating_period_id            UUID,

    CONSTRAINT ranked_matches_queue_version_fk
        FOREIGN KEY (mode, queue_version) REFERENCES ranked_queue_versions (mode, queue_version)
);

CREATE INDEX IF NOT EXISTS ranked_matches_status_idx ON ranked_matches (status);
CREATE INDEX IF NOT EXISTS ranked_matches_mode_idx ON ranked_matches (mode);

-- ---------------------------------------------------------------------------
-- ranked_match_participants: exactly two rows per match, distinct users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_match_participants (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id                UUID NOT NULL REFERENCES ranked_matches (id) ON DELETE CASCADE,
    owner_sub               TEXT NOT NULL,
    slot                    SMALLINT NOT NULL CHECK (slot IN (0, 1)),
    game_id                 UUID,     -- set once the participant's DraftGameState is created
    status                  TEXT NOT NULL DEFAULT 'board_ready' CHECK (status IN (
                                'board_ready', 'in_progress', 'complete', 'awaiting_opponent',
                                'abandoned', 'protected_abort'
                             )),
    joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    abandonment_state       TEXT NOT NULL DEFAULT 'none' CHECK (abandonment_state IN (
                                'none', 'abandoned', 'protected'
                             )),
    pre_match_rating        NUMERIC(8, 4) NOT NULL,
    pre_match_rd            NUMERIC(8, 4) NOT NULL,
    pre_match_volatility    NUMERIC(10, 8) NOT NULL,
    post_match_rating       NUMERIC(8, 4),
    post_match_rd           NUMERIC(8, 4),
    post_match_volatility   NUMERIC(10, 8),

    -- One active participant record per user per match (also prevents both
    -- slots being claimed by the same user, i.e. self-match).
    CONSTRAINT ranked_match_participants_user_unique UNIQUE (match_id, owner_sub),
    CONSTRAINT ranked_match_participants_slot_unique UNIQUE (match_id, slot)
);

CREATE INDEX IF NOT EXISTS ranked_match_participants_owner_idx
    ON ranked_match_participants (owner_sub);

-- ---------------------------------------------------------------------------
-- ranked_match_submissions: one authoritative result per participant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_match_submissions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id            UUID NOT NULL REFERENCES ranked_matches (id) ON DELETE CASCADE,
    participant_id      UUID NOT NULL REFERENCES ranked_match_participants (id) ON DELETE CASCADE,
    owner_sub           TEXT NOT NULL,
    game_id             UUID NOT NULL,
    board_version_key   TEXT NOT NULL,
    lineup_evaluation   JSONB NOT NULL,   -- full LineupEvaluation payload at completion
    solver_version      TEXT NOT NULL,
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key     TEXT NOT NULL,

    CONSTRAINT ranked_match_submissions_participant_unique UNIQUE (participant_id),
    CONSTRAINT ranked_match_submissions_user_match_unique UNIQUE (match_id, owner_sub),
    CONSTRAINT ranked_match_submissions_idempotency_unique UNIQUE (match_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- ranked_queue_entries: durable waiting-room entry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_queue_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub               TEXT NOT NULL,
    mode                    TEXT NOT NULL,
    queue_version           TEXT NOT NULL,
    rating_snapshot         NUMERIC(8, 4) NOT NULL,
    rd_snapshot             NUMERIC(8, 4) NOT NULL,
    volatility_snapshot     NUMERIC(10, 8) NOT NULL,
    placement_state         TEXT NOT NULL CHECK (placement_state IN ('placement', 'established')),
    status                  TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN (
                                'waiting', 'matched', 'cancelled', 'expired'
                             )),
    joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    matched_at              TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    match_id                UUID REFERENCES ranked_matches (id),
    search_range_rating     NUMERIC(8, 4) NOT NULL DEFAULT 100,

    CONSTRAINT ranked_queue_entries_queue_version_fk
        FOREIGN KEY (mode, queue_version) REFERENCES ranked_queue_versions (mode, queue_version)
);

-- One active (waiting) queue entry per user per queue.
CREATE UNIQUE INDEX IF NOT EXISTS ranked_queue_entries_active_unique
    ON ranked_queue_entries (owner_sub, mode) WHERE status = 'waiting';

CREATE INDEX IF NOT EXISTS ranked_queue_entries_waiting_idx
    ON ranked_queue_entries (mode, status, joined_at) WHERE status = 'waiting';

-- ---------------------------------------------------------------------------
-- ranked_opponent_history: recent-pairing tracker for repeat-opponent caps
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_opponent_history (
    id              BIGSERIAL PRIMARY KEY,
    owner_sub       TEXT NOT NULL,
    opponent_sub    TEXT NOT NULL,
    mode            TEXT NOT NULL,
    match_id        UUID NOT NULL REFERENCES ranked_matches (id) ON DELETE CASCADE,
    paired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ranked_opponent_history_lookup_idx
    ON ranked_opponent_history (owner_sub, mode, paired_at DESC);

-- Down:
-- DROP TABLE IF EXISTS ranked_opponent_history;
-- DROP TABLE IF EXISTS ranked_queue_entries;
-- DROP TABLE IF EXISTS ranked_match_submissions;
-- DROP TABLE IF EXISTS ranked_match_participants;
-- DROP TABLE IF EXISTS ranked_matches;
