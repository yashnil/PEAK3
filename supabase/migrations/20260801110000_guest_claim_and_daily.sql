-- Migration 023: guest-claim support + the missing Peak Duel Daily attempt record
--
-- Three things, all in service of one product guarantee: a player who plays
-- as a guest and then signs in keeps everything they did.
--
--   1. peak_duel_daily_results -- Peak Duel Daily had NO server-side attempt
--      record of any kind. It was localStorage only, so "one attempt per day"
--      was a convention the client agreed to, not a rule, and a guest's daily
--      history could not be claimed because it never existed server-side.
--   2. ownership_claims.domain_counts -- the claim endpoint now transfers ten
--      domains, and re-running an already-completed claim has to report the
--      same per-domain breakdown it reported the first time. Three fixed
--      INTEGER columns cannot express that, and adding one column per domain
--      would make every new game mode a schema migration.
--   3. Explicit WITH CHECK on the two `FOR ALL` owner policies.
--
-- Same architecture as every table before it: the API reads and writes through
-- its own table-owning connection and enforces owner scoping in application
-- code; the policies below are an independent second layer for a PostgREST
-- client holding an anon/authenticated key. See 20260801100000_rls_gaps.sql's
-- header for why FORCE ROW LEVEL SECURITY is deliberately absent.

-- ---------------------------------------------------------------------------
-- 1. peak_duel_daily_results -- one OFFICIAL Peak Duel Daily attempt per
--    (owner, mode, daily key).
--
-- Shaped after 20260730190000_daily_grid_results.sql, which solves the same
-- problem for the other daily board: a private, immutable, server-written
-- record that a signed-in player gets instead of a localStorage entry, plus
-- the uniqueness constraint that makes "the first attempt is the official one"
-- hold under concurrency rather than by convention.
--
-- `daily_key` is the America/Los_Angeles daily key produced by
-- nba_peak.daily_key.daily_key() -- NOT a UTC date and NOT a browser-computed
-- one. TEXT rather than DATE because the key is a timezone-resolved label
-- whose boundary is defined by that module, and storing it as a DATE would
-- invite someone to compare it against a database `current_date` in UTC.
--
-- NOT a leaderboard. There is deliberately no public-read policy and no
-- endpoint that ranks these rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS peak_duel_daily_results (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- A Supabase auth.uid() OR a signed anon-cookie subject ('anon:...'), so
    -- a guest's attempt exists to be claimed later. TEXT, not a UUID FK, for
    -- exactly that reason -- same call as run_the_table_runs.owner_sub.
    owner_sub               TEXT NOT NULL,
    -- Which daily this is. 'peak_duel' today; a second duel-shaped daily gets
    -- its own value rather than overloading this one. Part of the uniqueness
    -- key, so two different dailies on the same date never collide.
    mode                    TEXT NOT NULL,
    -- YYYY-MM-DD in DAILY_TIMEZONE. See the header.
    daily_key               TEXT NOT NULL,
    -- The peak-window duration the board was played at (1/2/3/5 -- the model
    -- supports no others; see CLAUDE.md's Phase 1 limitations).
    duration_years          INTEGER NOT NULL CHECK (duration_years IN (1, 2, 3, 5)),
    duels_total             INTEGER NOT NULL CHECK (duels_total > 0),
    correct_count           INTEGER NOT NULL CHECK (correct_count >= 0),
    -- Game scoring is `arena_points`, never `peak_score` (CLAUDE.md naming).
    arena_points            INTEGER NOT NULL DEFAULT 0 CHECK (arena_points >= 0),
    best_streak             INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
    -- Client wall-clock. Presentational only: nothing validates it, so it must
    -- never enter scoring until the server times attempts itself. Same
    -- asymmetry, and the same warning, as daily_grid_results.elapsed_seconds.
    elapsed_seconds         INTEGER CHECK (elapsed_seconds IS NULL OR elapsed_seconds >= 0),
    -- FALSE when the player replayed an archive board. Recorded honestly and
    -- flagged rather than rejected or silently promoted to a live attempt.
    played_on_daily_key     BOOLEAN NOT NULL DEFAULT TRUE,
    -- Per-duel outcomes in presentation order. JSONB (not a child table)
    -- because it is read as one whole snapshot per attempt and is never
    -- queried field-by-field or joined against -- same call as
    -- daily_grid_results.answers.
    answers                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT peak_duel_daily_results_correct_within_total
        CHECK (correct_count <= duels_total),
    -- ONE official attempt per player per daily. A second submit is a retry
    -- (double-click, reload, flaky network), not a new attempt: the repository
    -- resolves it by returning the existing row rather than inserting or
    -- overwriting.
    CONSTRAINT peak_duel_daily_results_unique_owner_daily
        UNIQUE (owner_sub, mode, daily_key)
);

-- The history/streak query: this owner's attempts, most recent daily first.
CREATE INDEX IF NOT EXISTS peak_duel_daily_results_owner_recent_idx
    ON peak_duel_daily_results (owner_sub, daily_key DESC);

ALTER TABLE peak_duel_daily_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS peak_duel_daily_results_owner_read ON peak_duel_daily_results;
CREATE POLICY peak_duel_daily_results_owner_read ON peak_duel_daily_results
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS peak_duel_daily_results_owner_insert ON peak_duel_daily_results;
CREATE POLICY peak_duel_daily_results_owner_insert ON peak_duel_daily_results
    FOR INSERT WITH CHECK (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS peak_duel_daily_results_owner_delete ON peak_duel_daily_results;
CREATE POLICY peak_duel_daily_results_owner_delete ON peak_duel_daily_results
    FOR DELETE USING (owner_sub = auth.uid()::text);

-- No UPDATE policy, matching daily_grid_results and for the same reason: an
-- official daily attempt is an immutable record of one day's play, and being
-- able to edit it after the fact is the single change that would make the
-- table worthless as a foundation for anything ranked. Denied by default under
-- RLS with no matching policy. INSERT takes only WITH CHECK and DELETE takes
-- only USING, so both policies above are complete as written -- there is no
-- USING/WITH CHECK gap of the kind section 3 fixes.
--
-- As on run_the_table_runs: auth.uid() is NULL for the anon-cookie subjects
-- that own a guest's rows here, so these policies match nothing for those
-- rows. That is correct -- an anon key can never reach a guest's attempt
-- through PostgREST at all, and the API's own connection is the only path.

-- ---------------------------------------------------------------------------
-- 2. ownership_claims.domain_counts -- what the claim actually moved.
--
-- The three existing INTEGER columns (game_count, completion_count,
-- challenge_count) date from a claim that covered three domains. It now covers
-- ten, and POST /auth/claim is idempotent: a repeat call for an already-claimed
-- anon subject must return the SAME per-domain breakdown as the original call,
-- which means the breakdown has to be stored, not recomputed (by the time of
-- the second call the rows have already moved, so recomputing yields zeros).
--
-- One JSONB column rather than seven more INTEGERs: the set of claimable
-- domains changes whenever a game mode is added, and that should not be a
-- schema migration each time. The three legacy columns are kept and still
-- populated so nothing that reads them breaks; game_count keeps its original
-- meaning of "every row moved out of `games`" while domain_counts splits that
-- into the draft and court-lineup halves.
-- ---------------------------------------------------------------------------
ALTER TABLE ownership_claims
    ADD COLUMN IF NOT EXISTS domain_counts JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 3. Explicit WITH CHECK on the two `FOR ALL` owner policies.
--
-- `profiles_owner_all` and `user_settings_owner` (20260630124900_rls.sql:27,34)
-- are written as `FOR ALL USING (...)` with no WITH CHECK. Postgres reuses the
-- USING expression as the WITH CHECK expression when one is omitted, so these
-- are NOT currently exploitable -- an authenticated caller cannot insert or
-- update a row into someone else's ownership. This section makes the write
-- side explicit anyway, so that the guarantee is stated in the policy rather
-- than inherited from a default, and so that every owner-scoped policy set in
-- the chain reads the same way (run_the_table_runs' four policies are the
-- model: USING for what you can see, WITH CHECK for what you can leave behind).
--
-- The policies are RENAMED rather than redefined: scripts/validate_migrations.py
-- rejects a duplicate (table, policy_name) pair anywhere in the chain, which is
-- what stops a later migration from silently redefining an earlier policy under
-- the same name. Dropping the old name and creating a new one keeps that check
-- meaningful. Semantics are unchanged.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_owner_all ON profiles;
DROP POLICY IF EXISTS profiles_owner_write ON profiles;
CREATE POLICY profiles_owner_write ON profiles
    FOR ALL USING (auth_sub = auth.uid()::text)
    WITH CHECK (auth_sub = auth.uid()::text);

DROP POLICY IF EXISTS user_settings_owner ON user_settings;
DROP POLICY IF EXISTS user_settings_owner_write ON user_settings;
CREATE POLICY user_settings_owner_write ON user_settings
    FOR ALL USING (
        profile_id IN (
            SELECT id FROM profiles WHERE auth_sub = auth.uid()::text
        )
    )
    WITH CHECK (
        profile_id IN (
            SELECT id FROM profiles WHERE auth_sub = auth.uid()::text
        )
    );

-- Down:
-- DROP POLICY IF EXISTS user_settings_owner_write ON user_settings;
-- DROP POLICY IF EXISTS profiles_owner_write ON profiles;
-- ALTER TABLE ownership_claims DROP COLUMN IF EXISTS domain_counts;
-- DROP TABLE IF EXISTS peak_duel_daily_results;
