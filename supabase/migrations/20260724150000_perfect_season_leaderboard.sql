-- Migration 017: PEAK Season (CourtBuilder) global leaderboard (Phase 6G Part E)
-- perfect_season_runs, perfect_season_run_cards
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass (per explicit instruction; `supabase link`/`supabase db push` were
-- never run). Reuses the same immutable-submitted-record + service-role-
-- writes + RLS-as-defense-in-depth pattern already established by
-- 20260630130000_ranked_rls.sql -- see that file's own comment: the API
-- reads/writes through a service-role Postgres connection and enforces
-- public/private + filter logic in application code; RLS here is a second,
-- independent layer in case these tables are ever exposed via Supabase's
-- own REST API to a client holding an anon/authenticated key directly.

-- ---------------------------------------------------------------------------
-- perfect_season_runs: one immutable submitted PEAK Season leaderboard entry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfect_season_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub               TEXT NOT NULL,
    display_name            TEXT NOT NULL,
    mode                    TEXT NOT NULL,
    game_type               TEXT NOT NULL DEFAULT 'peak_season',
    game_id                 TEXT NOT NULL UNIQUE,  -- one submission per completed game (immutable, no resubmit)
    seed                    INTEGER NOT NULL,
    wins                    INTEGER NOT NULL CHECK (wins >= 0 AND wins <= 82),
    losses                  INTEGER NOT NULL CHECK (losses >= 0 AND losses <= 82),
    lineup_score            NUMERIC NOT NULL,
    score_status            TEXT NOT NULL CHECK (score_status IN ('complete', 'incomplete')),
    exact_cards_scored      INTEGER NOT NULL,
    total_cards             INTEGER NOT NULL,
    team_respins_used       INTEGER NOT NULL DEFAULT 0,
    season_respins_used     INTEGER NOT NULL DEFAULT 0,
    data_version             TEXT,
    formula_version          TEXT,
    simulation_version       TEXT,
    is_public                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leaderboard sort: wins desc, lineup_score desc, fewer respins used asc,
-- created_at asc (Part E's exact spec) -- partial index on public rows only,
-- matching the only query shape the leaderboard endpoint ever issues.
CREATE INDEX IF NOT EXISTS perfect_season_runs_leaderboard_idx
    ON perfect_season_runs (mode, wins DESC, lineup_score DESC, (team_respins_used + season_respins_used) ASC, created_at ASC)
    WHERE is_public;

CREATE INDEX IF NOT EXISTS perfect_season_runs_owner_idx
    ON perfect_season_runs (owner_sub, created_at DESC);

-- ---------------------------------------------------------------------------
-- perfect_season_run_cards: the 8 roster player-season card keys for a run
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perfect_season_run_cards (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES perfect_season_runs (id) ON DELETE CASCADE,
    slot_index              SMALLINT NOT NULL CHECK (slot_index >= 0 AND slot_index < 8),
    card_key                TEXT NOT NULL,  -- exact_player_season_key or peak_window_id

    CONSTRAINT perfect_season_run_cards_unique_slot UNIQUE (run_id, slot_index)
);

CREATE INDEX IF NOT EXISTS perfect_season_run_cards_run_idx ON perfect_season_run_cards (run_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE perfect_season_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfect_season_run_cards ENABLE ROW LEVEL SECURITY;

-- Public read of public runs.
DROP POLICY IF EXISTS perfect_season_runs_public_read ON perfect_season_runs;
CREATE POLICY perfect_season_runs_public_read ON perfect_season_runs
    FOR SELECT USING (is_public = TRUE);

-- Owner can always read their own runs, public or not.
DROP POLICY IF EXISTS perfect_season_runs_owner_read ON perfect_season_runs;
CREATE POLICY perfect_season_runs_owner_read ON perfect_season_runs
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- Insert only as yourself. No UPDATE/DELETE policy at all -- immutable
-- submitted runs (Part E: "Prefer immutable submitted runs; no UPDATE
-- except admin"), denied by default under RLS with no matching policy.
DROP POLICY IF EXISTS perfect_season_runs_owner_insert ON perfect_season_runs;
CREATE POLICY perfect_season_runs_owner_insert ON perfect_season_runs
    FOR INSERT WITH CHECK (owner_sub = auth.uid()::text);

-- Run cards inherit their parent run's visibility/ownership.
DROP POLICY IF EXISTS perfect_season_run_cards_public_read ON perfect_season_run_cards;
CREATE POLICY perfect_season_run_cards_public_read ON perfect_season_run_cards
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM perfect_season_runs r
            WHERE r.id = perfect_season_run_cards.run_id AND r.is_public
        )
    );

DROP POLICY IF EXISTS perfect_season_run_cards_owner_read ON perfect_season_run_cards;
CREATE POLICY perfect_season_run_cards_owner_read ON perfect_season_run_cards
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM perfect_season_runs r
            WHERE r.id = perfect_season_run_cards.run_id AND r.owner_sub = auth.uid()::text
        )
    );

DROP POLICY IF EXISTS perfect_season_run_cards_owner_insert ON perfect_season_run_cards;
CREATE POLICY perfect_season_run_cards_owner_insert ON perfect_season_run_cards
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM perfect_season_runs r
            WHERE r.id = perfect_season_run_cards.run_id AND r.owner_sub = auth.uid()::text
        )
    );

-- Down:
-- DROP TABLE IF EXISTS perfect_season_run_cards;
-- DROP TABLE IF EXISTS perfect_season_runs;
