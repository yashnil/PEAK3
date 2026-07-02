-- Migration 014: Rating ledger and user rating state
-- rating_ledger_entries (append-only source of truth), rating_snapshots,
-- queue_ratings, placement_states

-- ---------------------------------------------------------------------------
-- rating_ledger_entries: append-only source of truth for every rating change
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rating_ledger_entries (
    id                          BIGSERIAL PRIMARY KEY,   -- BIGSERIAL doubles as the immutable sequence
    owner_sub                   TEXT NOT NULL,
    mode                        TEXT NOT NULL,
    match_id                    UUID NOT NULL REFERENCES ranked_matches (id),
    rating_period_id            UUID NOT NULL REFERENCES rating_periods (id),
    pre_rating                  NUMERIC(8, 4) NOT NULL,
    pre_rd                      NUMERIC(8, 4) NOT NULL,
    pre_volatility              NUMERIC(10, 8) NOT NULL,
    opponent_sub                TEXT NOT NULL,
    opponent_pre_rating         NUMERIC(8, 4) NOT NULL,
    opponent_pre_rd             NUMERIC(8, 4) NOT NULL,
    opponent_pre_volatility     NUMERIC(10, 8) NOT NULL,
    outcome                     NUMERIC(2, 1) NOT NULL CHECK (outcome IN (0, 0.5, 1)),
    post_rating                 NUMERIC(8, 4) NOT NULL,
    post_rd                     NUMERIC(8, 4) NOT NULL,
    post_volatility             NUMERIC(10, 8) NOT NULL,
    algorithm_version           TEXT NOT NULL,
    entry_type                  TEXT NOT NULL DEFAULT 'settlement' CHECK (entry_type IN (
                                    'settlement', 'reversal', 'inactivity_rd_adjustment'
                                 )),
    reversal_of_entry_id        BIGINT REFERENCES rating_ledger_entries (id),
    reversal_reason             TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT rating_ledger_entries_reversal_requires_reason
        CHECK (entry_type <> 'reversal' OR reversal_reason IS NOT NULL)
);

-- One rating update per user per match (reversals are separate rows referencing it).
CREATE UNIQUE INDEX IF NOT EXISTS rating_ledger_entries_one_settlement_per_user_match
    ON rating_ledger_entries (owner_sub, match_id) WHERE entry_type = 'settlement';

CREATE INDEX IF NOT EXISTS rating_ledger_entries_owner_mode_idx
    ON rating_ledger_entries (owner_sub, mode, id);

-- Append-only: reject UPDATE/DELETE outright. Corrections are new rows.
CREATE OR REPLACE FUNCTION rating_ledger_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'rating_ledger_entries is append-only; % is not permitted (id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rating_ledger_entries_no_update ON rating_ledger_entries;
CREATE TRIGGER rating_ledger_entries_no_update
    BEFORE UPDATE ON rating_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION rating_ledger_immutable();

DROP TRIGGER IF EXISTS rating_ledger_entries_no_delete ON rating_ledger_entries;
CREATE TRIGGER rating_ledger_entries_no_delete
    BEFORE DELETE ON rating_ledger_entries
    FOR EACH ROW EXECUTE FUNCTION rating_ledger_immutable();

-- ---------------------------------------------------------------------------
-- rating_snapshots: point-in-time materialization for cheap history reads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rating_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    owner_sub           TEXT NOT NULL,
    mode                TEXT NOT NULL,
    ledger_entry_id     BIGINT NOT NULL REFERENCES rating_ledger_entries (id),
    rating              NUMERIC(8, 4) NOT NULL,
    rd                  NUMERIC(8, 4) NOT NULL,
    volatility          NUMERIC(10, 8) NOT NULL,
    snapshot_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rating_snapshots_owner_mode_idx
    ON rating_snapshots (owner_sub, mode, snapshot_at);

-- ---------------------------------------------------------------------------
-- queue_ratings: one current-rating row per user per queue (derived cache,
-- verifiable at any time via scripts/ranked_replay.py against the ledger).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_ratings (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub                   TEXT NOT NULL,
    mode                        TEXT NOT NULL,
    rating                      NUMERIC(8, 4) NOT NULL,
    rd                          NUMERIC(8, 4) NOT NULL,
    volatility                  NUMERIC(10, 8) NOT NULL,
    valid_rated_matches         INTEGER NOT NULL DEFAULT 0,
    established                 BOOLEAN NOT NULL DEFAULT false,
    algorithm_version           TEXT NOT NULL,
    last_rated_activity_at      TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT queue_ratings_owner_mode_unique UNIQUE (owner_sub, mode)
);

-- ---------------------------------------------------------------------------
-- placement_states: placement progress per user per queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS placement_states (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub                   TEXT NOT NULL,
    mode                        TEXT NOT NULL,
    valid_matches_completed     INTEGER NOT NULL DEFAULT 0,
    required_matches            INTEGER NOT NULL DEFAULT 7,
    established                 BOOLEAN NOT NULL DEFAULT false,
    established_at              TIMESTAMPTZ,

    CONSTRAINT placement_states_owner_mode_unique UNIQUE (owner_sub, mode)
);

-- Down:
-- DROP TABLE IF EXISTS placement_states;
-- DROP TABLE IF EXISTS queue_ratings;
-- DROP TABLE IF EXISTS rating_snapshots;
-- DROP TRIGGER IF EXISTS rating_ledger_entries_no_delete ON rating_ledger_entries;
-- DROP TRIGGER IF EXISTS rating_ledger_entries_no_update ON rating_ledger_entries;
-- DROP FUNCTION IF EXISTS rating_ledger_immutable();
-- DROP TABLE IF EXISTS rating_ledger_entries;
