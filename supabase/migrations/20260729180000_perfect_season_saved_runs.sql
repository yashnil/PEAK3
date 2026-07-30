-- Migration 018: PEAK Season saved runs / personal history (Phase 9A)
-- perfect_season_saved_runs
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass (`supabase link`/`supabase db push` were never run), same discipline
-- as 20260724150000_perfect_season_leaderboard.sql.
--
-- WHY A SECOND TABLE, not a column on perfect_season_runs: that table is the
-- PUBLIC, immutable, competitive leaderboard, which by design only accepts a
-- fully-scored roster. This one is PRIVATE personal history and deliberately
-- DOES accept provisional runs (rosters with unscored cards -- see
-- app/services/perfect_season/state.py::compute_eligibility). Folding them
-- together would force history to inherit the leaderboard's fully-scored
-- requirement, dropping exactly the runs Phase 8K made honest. See
-- app/repositories/saved_run_protocols.py's module docstring for the full
-- three-way split (game state / leaderboard / history).
--
-- Same "service-role writes, RLS as defense-in-depth" pattern as the ranked
-- and leaderboard tables: the API reads/writes through a service-role
-- connection and enforces owner scoping in application code; the policies
-- below are a second, independent layer in case this table is ever exposed
-- through Supabase's own REST API to a client holding an anon/authenticated
-- key directly.

CREATE TABLE IF NOT EXISTS perfect_season_saved_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub               TEXT NOT NULL,
    game_id                 TEXT NOT NULL,
    mode                    TEXT NOT NULL,
    seed                    INTEGER NOT NULL,
    wins                    INTEGER NOT NULL CHECK (wins >= 0 AND wins <= 82),
    losses                  INTEGER NOT NULL CHECK (losses >= 0 AND losses <= 82),
    -- A provisional run stores its real reported lineup_score (0.0, which
    -- simulate_exact_season returns rather than fabricating a value) and is
    -- excluded from best-lineup-score comparisons by score_status, never by
    -- overwriting the number itself.
    lineup_score            NUMERIC NOT NULL,
    score_status            TEXT NOT NULL CHECK (score_status IN ('complete', 'incomplete')),
    exact_cards_scored      INTEGER NOT NULL,
    total_cards             INTEGER NOT NULL,
    -- Snapshot of eligibility AS OF save time -- never re-derived on read,
    -- so history can't silently change if card data or the simulator moves.
    leaderboard_eligible    BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_kind          TEXT NOT NULL DEFAULT 'free_play'
                                CHECK (challenge_kind IN ('free_play', 'daily')),
    -- YYYY-MM-DD for a daily run; NULL for free play. Enforced consistent
    -- with challenge_kind by the CHECK below.
    challenge_date          TEXT,
    is_perfect_season       BOOLEAN NOT NULL DEFAULT FALSE,
    team_respins_used       INTEGER NOT NULL DEFAULT 0,
    season_respins_used     INTEGER NOT NULL DEFAULT 0,
    -- The 8 placed cards in slot order, and the attempt's respin receipt.
    -- JSONB (not child tables) because these are read as one whole snapshot
    -- per run and never queried field-by-field or joined against.
    roster                  JSONB NOT NULL DEFAULT '[]'::jsonb,
    spin_history            JSONB NOT NULL DEFAULT '[]'::jsonb,
    peak_picks_matched      INTEGER,
    peak_picks_total        INTEGER,
    data_version            TEXT,
    formula_version         TEXT,
    simulation_version      TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- One saved run per (owner, completed game): saving twice is a retry,
    -- not new information (action_complete_game is itself idempotent, so a
    -- completed game's result is frozen).
    CONSTRAINT perfect_season_saved_runs_unique_owner_game UNIQUE (owner_sub, game_id),
    -- A daily run always carries its date; a free-play run never does.
    CONSTRAINT perfect_season_saved_runs_daily_has_date CHECK (
        (challenge_kind = 'daily' AND challenge_date IS NOT NULL)
        OR (challenge_kind = 'free_play' AND challenge_date IS NULL)
    )
);

-- The history query: this owner's runs, newest first.
CREATE INDEX IF NOT EXISTS perfect_season_saved_runs_owner_recent_idx
    ON perfect_season_saved_runs (owner_sub, created_at DESC);

-- "Have I already played today's daily in this mode?" (count_daily_attempts).
CREATE INDEX IF NOT EXISTS perfect_season_saved_runs_owner_daily_idx
    ON perfect_season_saved_runs (owner_sub, challenge_date, mode)
    WHERE challenge_kind = 'daily';

-- ---------------------------------------------------------------------------
-- RLS: private-by-default. Unlike perfect_season_runs there is NO public-read
-- policy at all -- personal history is never publicly listable. (A user can
-- still SHARE an individual result via /arena/court/results/{game_id}, which
-- reads the game state, not this table.)
-- ---------------------------------------------------------------------------
ALTER TABLE perfect_season_saved_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfect_season_saved_runs_owner_read ON perfect_season_saved_runs;
CREATE POLICY perfect_season_saved_runs_owner_read ON perfect_season_saved_runs
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS perfect_season_saved_runs_owner_insert ON perfect_season_saved_runs;
CREATE POLICY perfect_season_saved_runs_owner_insert ON perfect_season_saved_runs
    FOR INSERT WITH CHECK (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS perfect_season_saved_runs_owner_delete ON perfect_season_saved_runs;
CREATE POLICY perfect_season_saved_runs_owner_delete ON perfect_season_saved_runs
    FOR DELETE USING (owner_sub = auth.uid()::text);

-- No UPDATE policy: a saved run is an immutable snapshot of a completed
-- game (see the leaderboard table's same choice). Denied by default under
-- RLS with no matching policy. DELETE is allowed so a user can remove their
-- own history entry -- their data, their call.

-- Down:
-- DROP TABLE IF EXISTS perfect_season_saved_runs;
