-- Migration 021: RUN THE TABLE runs
-- run_the_table_runs
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this pass
-- (`supabase link`/`supabase db push` were never run), same discipline as
-- 20260724150000_perfect_season_leaderboard.sql,
-- 20260729180000_perfect_season_saved_runs.sql and
-- 20260730190000_daily_grid_results.sql.
--
-- WHAT THIS IS. One durable, resumable RUN THE TABLE run. It is live state,
-- not a finished record: every action rewrites `snapshot`, and the row is what
-- lets a player close the tab mid-act-2 and come back to the same run.
--
-- WHAT IS DELIBERATELY NOT STORED: the blueprint. The starting roster, all six
-- draft/trade boards, the node graph and all three bosses are a pure function
-- of `seed` (nba_peak/run_the_table/generation.py), so persisting them would
-- create a second copy of the truth that could drift from the first. They are
-- regenerated on every load, which means a run's content is re-proved to
-- follow from its seed every time it is opened rather than trusted to.
--
-- WHY THE VERSION COLUMNS EXIST even though `snapshot` already carries them:
-- the API refuses to replay a run whose engine/ruleset/card-pool versions have
-- moved (state.assert_version_compatible) -- silently reinterpreting a run
-- under changed rules would produce a result that never actually happened.
-- Denormalising the three strings out of the JSONB makes "which ruleset were
-- the broken runs on?" an indexable question instead of a blob scan, and a row
-- whose columns disagree with its snapshot is a corruption signal.
--
-- OWNERS ARE USUALLY ANONYMOUS. RUN THE TABLE needs no account, so `owner_sub`
-- here is far more often a signed anon-cookie subject ('anon:...') than a
-- Supabase auth.uid(). That is why owner_sub is TEXT and not a UUID FK, and it
-- is why the RLS policies below cannot be the primary access control -- see
-- the RLS section.
--
-- Same "service-role writes/reads, RLS as defense-in-depth" pattern as the
-- ranked, leaderboard, saved-run and daily-grid tables.

CREATE TABLE IF NOT EXISTS run_the_table_runs (
    -- Server-generated, opaque, never enumerated. Daily ids are derived from
    -- (date, owner) so the same player asking twice lands on the same run even
    -- if the uniqueness check below were bypassed; everything else is random.
    run_id                  TEXT PRIMARY KEY,
    -- Supabase auth.uid() OR a signed anon-cookie subject. See the header.
    owner_sub               TEXT NOT NULL,
    -- The whole run derives from this. BIGINT rather than INTEGER: the seed
    -- space is [0, 2^31) today, and a column that cannot hold a wider space is
    -- a migration waiting to happen for no benefit.
    seed                    BIGINT NOT NULL,
    run_type                TEXT NOT NULL CHECK (run_type IN ('standard', 'daily', 'challenge')),
    -- The UTC date a daily run belongs to; NULL for a standard run. A real
    -- DATE, not TEXT, so the partial unique index below and any future range
    -- query work on dates rather than on string prefixes.
    run_date                DATE,
    -- Denormalised from snapshot->>'status' for cheap "runs in progress"
    -- queries and operational triage. The snapshot remains authoritative.
    status                  TEXT NOT NULL,
    -- services/run_the_table/serialization.py's state_to_dict output, verbatim.
    -- JSONB (not a set of child tables) because it is read and written as one
    -- whole state per action and is never queried field-by-field or joined
    -- against -- same call as perfect_season_saved_runs.roster.
    snapshot                JSONB NOT NULL,
    engine_version          TEXT NOT NULL,
    ruleset_version         TEXT NOT NULL,
    card_pool_version       TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The resume/history query: this owner's runs, newest first.
CREATE INDEX IF NOT EXISTS run_the_table_runs_owner_recent_idx
    ON run_the_table_runs (owner_sub, created_at DESC);

-- ONE OFFICIAL DAILY PER PLAYER PER DATE. Partial, so standard and challenge
-- runs stay unlimited: the point is not to ration play, it is that a shared
-- daily board means nothing if a reload can re-roll it. The FIRST attempt is
-- the official one; the repository resolves a second create by returning the
-- run already in progress rather than inserting or overwriting. This index is
-- what makes that hold under concurrency rather than by convention.
CREATE UNIQUE INDEX IF NOT EXISTS run_the_table_runs_unique_daily_idx
    ON run_the_table_runs (owner_sub, run_type, run_date)
    WHERE run_type = 'daily';

-- ---------------------------------------------------------------------------
-- RLS: private-by-default, owner-only. No public read -- a run in progress is
-- one player's live state, and its `snapshot` contains the bosses and offers
-- they have reached, which is spoiler material for anyone playing the same
-- seed. Sharing is done with a signed challenge token carrying only the seed
-- (see the /challenge route), never by reading someone else's row.
--
-- NOTE ON ANONYMOUS OWNERS: `auth.uid()` is NULL for the anon-cookie subjects
-- that own most rows here, so these policies match nothing for them. That is
-- correct and intentional -- it means an anon key can never reach an anonymous
-- player's run through Supabase's REST API at all. The API's own service-role
-- connection is the only path to those rows, and it enforces owner scoping in
-- application code (services/run_the_table/runs.py load_run). RLS is the
-- second layer here, not the first.
-- ---------------------------------------------------------------------------
ALTER TABLE run_the_table_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_the_table_runs_owner_read ON run_the_table_runs;
CREATE POLICY run_the_table_runs_owner_read ON run_the_table_runs
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS run_the_table_runs_owner_insert ON run_the_table_runs;
CREATE POLICY run_the_table_runs_owner_insert ON run_the_table_runs
    FOR INSERT WITH CHECK (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS run_the_table_runs_owner_update ON run_the_table_runs;
CREATE POLICY run_the_table_runs_owner_update ON run_the_table_runs
    FOR UPDATE USING (owner_sub = auth.uid()::text)
    WITH CHECK (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS run_the_table_runs_owner_delete ON run_the_table_runs;
CREATE POLICY run_the_table_runs_owner_delete ON run_the_table_runs
    FOR DELETE USING (owner_sub = auth.uid()::text);

-- An UPDATE policy exists here, unlike daily_grid_results, because a run is a
-- live object rather than a finished record -- every action rewrites its
-- snapshot. What is immutable is the run's IDENTITY: the repository's UPDATE
-- statement never touches run_id, owner_sub, seed, run_type or run_date, so a
-- run can never be re-pointed at a different seed after the fact.

-- Down:
-- DROP TABLE IF EXISTS run_the_table_runs;
