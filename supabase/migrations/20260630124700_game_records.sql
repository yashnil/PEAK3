-- Migration 003: Game records
-- board_snapshots, games, game_actions, result_snapshots, daily_completions

-- ---------------------------------------------------------------------------
-- board_snapshots: canonical board identity including all version components
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_snapshots (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id                    TEXT NOT NULL,          -- public compact ID
    board_type                  TEXT NOT NULL CHECK (board_type IN ('daily','practice','challenge')),
    mode                        TEXT NOT NULL,
    date                        TEXT,                   -- YYYY-MM-DD, daily only
    seed                        BIGINT,                 -- practice/challenge
    lineup_model_version        TEXT NOT NULL,
    ruleset_version             TEXT NOT NULL,
    card_pool_version           TEXT NOT NULL,
    board_generation_algorithm  TEXT NOT NULL DEFAULT 'v1',
    generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata                    JSONB NOT NULL DEFAULT '{}',

    -- A canonical daily board is unique across the full version tuple.
    -- Changing any version component produces a new canonical record.
    CONSTRAINT board_snapshots_daily_unique
        UNIQUE (board_type, mode, date, lineup_model_version, ruleset_version, card_pool_version)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS board_snapshots_board_id_idx ON board_snapshots (board_id);

-- ---------------------------------------------------------------------------
-- games: one game session (in-progress or complete)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub       TEXT,                               -- null for unauthenticated
    board_id        TEXT NOT NULL,
    mode            TEXT NOT NULL,
    board_type      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'round_active',
    payload         JSONB NOT NULL,                     -- full DraftGameState snapshot
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Note: a `expires_at TIMESTAMPTZ GENERATED ALWAYS AS (created_at + INTERVAL
    -- '24 hours') STORED` column was originally specified here, but PostgreSQL
    -- rejects timestamptz + interval as a generated-column expression
    -- ("generation expression is not immutable") — confirmed against a real
    -- PostgreSQL 16 instance while validating Phase 4.0's migration chain, so
    -- this table could never actually be created against a real database.
    -- No application code reads games.expires_at (grep confirmed); a 24h TTL
    -- cleanup job can compute `created_at + INTERVAL '24 hours' < now()`
    -- directly in its DELETE/SELECT rather than relying on a stored column.
);

CREATE INDEX IF NOT EXISTS games_owner_sub_idx ON games (owner_sub) WHERE owner_sub IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_board_id_idx ON games (board_id);

-- ---------------------------------------------------------------------------
-- game_actions: append-only action log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_actions (
    id              BIGSERIAL PRIMARY KEY,
    game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    sequence_num    INTEGER NOT NULL,
    action_type     TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    idempotency_key TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT game_actions_idempotency_unique UNIQUE (game_id, idempotency_key)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS game_actions_game_id_idx ON game_actions (game_id);

-- ---------------------------------------------------------------------------
-- result_snapshots: immutable result record — append-only after insert
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS result_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,
    game_id             TEXT NOT NULL,
    board_id            TEXT NOT NULL,
    board_type          TEXT NOT NULL,
    mode                TEXT NOT NULL,
    lineup_peak_rating  NUMERIC(8,4) NOT NULL,
    draft_efficiency    NUMERIC(6,4),
    board_percentile    NUMERIC(6,4),
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload             JSONB NOT NULL                 -- full immutable result at time of completion
);

CREATE INDEX IF NOT EXISTS result_snapshots_owner_sub_idx ON result_snapshots (owner_sub);
CREATE INDEX IF NOT EXISTS result_snapshots_game_id_idx ON result_snapshots (game_id);

-- No UPDATE or DELETE allowed on result_snapshots (enforced via RLS + no grants)

-- ---------------------------------------------------------------------------
-- daily_completions: one official completion per owner per board
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_completions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,
    board_id            TEXT NOT NULL,
    mode                TEXT NOT NULL,
    date                TEXT NOT NULL,                 -- YYYY-MM-DD
    game_id             TEXT NOT NULL,
    lineup_peak_rating  NUMERIC(8,4) NOT NULL,
    draft_efficiency    NUMERIC(6,4),
    board_percentile    NUMERIC(6,4),
    hold_used           BOOLEAN NOT NULL DEFAULT false,
    reframe_used        BOOLEAN NOT NULL DEFAULT false,
    completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    result_snapshot     JSONB NOT NULL,

    -- One immutable official completion per owner per board
    CONSTRAINT daily_completions_unique UNIQUE (owner_sub, board_id)
);

CREATE INDEX IF NOT EXISTS daily_completions_owner_sub_idx ON daily_completions (owner_sub);

-- Down:
-- DROP TABLE IF EXISTS daily_completions;
-- DROP TABLE IF EXISTS result_snapshots;
-- DROP TABLE IF EXISTS game_actions;
-- DROP TABLE IF EXISTS games;
-- DROP TABLE IF EXISTS board_snapshots;
