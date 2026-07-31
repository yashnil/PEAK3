-- Migration 020: Daily Grid official results (Phase 11D)
-- daily_grid_results
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this pass
-- (`supabase link`/`supabase db push` were never run), same discipline as
-- 20260724150000_perfect_season_leaderboard.sql and
-- 20260729180000_perfect_season_saved_runs.sql.
--
-- WHAT THIS IS. One OFFICIAL completed Daily Grid per user per board. It is
-- the durable, server-validated counterpart to the localStorage archive that
-- anonymous players get (apps/web/src/lib/daily-grid-archive.ts): local
-- history is not cheat-proof and is explicitly not eligible for ranking
-- (CLAUDE.md Security), whereas every row here was re-validated square by
-- square by the API before it was written.
--
-- WHAT THIS IS NOT. Not a leaderboard. There is deliberately NO public-read
-- policy: nothing outside the owner can read a row, and no endpoint ranks
-- them. Phase 11D builds the trustworthy record a leaderboard would need and
-- stops there -- publishing a ranking also needs abuse controls and a decision
-- about what a "verified" attempt means, neither of which this pass makes.
--
-- Same "service-role writes, RLS as defense-in-depth" pattern as the ranked,
-- leaderboard and saved-run tables: the API reads/writes through a
-- service-role connection and enforces owner scoping in application code; the
-- policies below are a second, independent layer in case this table is ever
-- exposed through Supabase's own REST API to a client holding an anon key.

CREATE TABLE IF NOT EXISTS daily_grid_results (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub               TEXT NOT NULL,
    -- The generator's own board id, e.g. 'daily-grid-v2-2026-07-30'. Stored
    -- alongside date+version rather than instead of them so a row stays
    -- self-describing if the id format ever changes.
    board_id                TEXT NOT NULL,
    board_date              TEXT NOT NULL,
    -- 'daily_grid.v2'. Part of the uniqueness key: a taxonomy revision makes a
    -- genuinely different board for the same date, and that is a new result
    -- rather than a conflicting one.
    board_version           TEXT NOT NULL,
    board_theme             TEXT,
    -- Every number below is recomputed server-side from the submitted squares
    -- before the insert -- never taken from the client (see the save route).
    score                   INTEGER NOT NULL CHECK (score >= 0),
    optimal_total           INTEGER NOT NULL CHECK (optimal_total >= 0),
    percent_of_best         NUMERIC NOT NULL CHECK (percent_of_best >= 0),
    squares_matching_optimal INTEGER NOT NULL CHECK (
        squares_matching_optimal >= 0 AND squares_matching_optimal <= 9
    ),
    incorrect_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_attempts >= 0),
    -- Client-reported wall time. Presentational only: it does not enter the
    -- score, it is not ranked, and nothing validates it -- which is exactly
    -- why it must never become a scoring term without server-side timing.
    elapsed_seconds         INTEGER CHECK (elapsed_seconds IS NULL OR elapsed_seconds >= 0),
    -- Whether the board was played on its own UTC date. An archive replay is
    -- saved honestly and flagged, never silently promoted to a live result.
    played_on_board_date    BOOLEAN NOT NULL DEFAULT TRUE,
    -- The nine locked answer ids in reading order. JSONB (not a child table)
    -- because it is read as one whole snapshot per result and never queried
    -- field-by-field or joined against -- same call as perfect_season_saved_runs.roster.
    answers                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ONE official result per user per board. A second submit for the same
    -- board is a retry (double-click, reload, flaky network), not a new
    -- attempt -- the repository resolves it by returning the existing row
    -- rather than inserting or overwriting. This constraint is what makes
    -- that guarantee hold under concurrency rather than by convention.
    CONSTRAINT daily_grid_results_unique_owner_board
        UNIQUE (owner_sub, board_date, board_version)
);

-- The history query: this owner's results, newest board first.
CREATE INDEX IF NOT EXISTS daily_grid_results_owner_recent_idx
    ON daily_grid_results (owner_sub, board_date DESC);

-- ---------------------------------------------------------------------------
-- RLS: private-by-default, owner-only. No public read, by design -- see the
-- header. A future leaderboard would add an explicit, separately-reviewed
-- policy (or, more likely, a separate published projection), not relax this one.
-- ---------------------------------------------------------------------------
ALTER TABLE daily_grid_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_grid_results_owner_read ON daily_grid_results;
CREATE POLICY daily_grid_results_owner_read ON daily_grid_results
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS daily_grid_results_owner_insert ON daily_grid_results;
CREATE POLICY daily_grid_results_owner_insert ON daily_grid_results
    FOR INSERT WITH CHECK (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS daily_grid_results_owner_delete ON daily_grid_results;
CREATE POLICY daily_grid_results_owner_delete ON daily_grid_results
    FOR DELETE USING (owner_sub = auth.uid()::text);

-- No UPDATE policy. An official daily result is an immutable record of one
-- day's attempt; editing it after the fact is the one operation that would
-- make the whole table worthless as a foundation for ranking. Denied by
-- default under RLS with no matching policy. DELETE is allowed so a user can
-- remove their own record -- their data, their call.

-- Down:
-- DROP TABLE IF EXISTS daily_grid_results;
