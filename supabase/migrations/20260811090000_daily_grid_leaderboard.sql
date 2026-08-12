-- Daily Grid leaderboard: one PUBLIC best-per-user row per daily board (A2).
--
-- WHAT THIS IS. The public, ranked counterpart of `daily_grid_results`
-- (20260730190000). Results are private, owner-only, and carry answer
-- material; a leaderboard row carries nothing but what the board displays —
-- who, which day, what score, how long. Splitting the record keeps the RLS
-- story trivial (this table is public-read by policy, results stay private)
-- instead of trying to expose three columns of a private table.
--
-- EVERY NUMBER IS SERVER-DERIVED. Rows are written only by the API's own
-- table-owning connection, inside `POST /api/v1/daily-grid/official`, from
-- two server records the client never touched:
--
--   score               the official result's, itself recomputed square by
--                       square from the board at save time;
--   completion_time_ms  result.created_at - attempt.started_at, both
--                       server-stamped (`daily_grid_attempts` is the
--                       non-restartable clock 20260801150000 created for
--                       exactly this). NULL only when the owner never had a
--                       server clock (a pre-/start legacy client); the
--                       ranking places such a row after every timed row of
--                       equal score — an unwitnessed time never beats a
--                       witnessed one.
--
-- THE RANKING (A2.1), defined once in
-- `app/repositories/daily_grid_protocols.leaderboard_sort_key` and spelled
-- here as the index the only leaderboard query shape uses:
--
--   score DESC, completion_time_ms ASC NULLS LAST, completed_at ASC, id ASC
--
-- BEST-ATTEMPT-ONLY (A2.5). `UNIQUE (owner_sub, daily_key, board_version)`
-- plus the repository's conditional `ON CONFLICT DO UPDATE ... WHERE better`
-- make replacement atomic: a better score, or an equal score in strictly less
-- witnessed time, replaces; anything else leaves the incumbent, whatever the
-- arrival order of concurrent submissions. (Today the official-result rule —
-- one immutable result per user per board — means at most one qualifying
-- submission ever exists; the conflict rule is the guarantee that stays
-- correct if that product rule ever loosens.)
--
-- ONLY AUTHENTICATED, NON-ANONYMOUS OWNERS ARE WRITTEN (A2.6). Guests play,
-- share and keep their local archive; they enter the public board by signing
-- in — after which the idempotent re-save of their claimed official result
-- promotes it here. `owner_sub` is therefore always a real account subject,
-- unlike the attempts table.
--
-- SAFE TO RE-RUN AND SAFE OUT OF ORDER: every statement is guarded, matching
-- every sibling in this directory.

CREATE TABLE IF NOT EXISTS daily_grid_leaderboard_entries (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub            TEXT NOT NULL,
    -- YYYY-MM-DD in the product reset zone (America/Los_Angeles) — the SAME
    -- key the attempt clock uses (nba_peak/daily_key.py), which is what makes
    -- the daily partition roll over at Pacific midnight, never at UTC's.
    daily_key            TEXT NOT NULL,
    board_id             TEXT NOT NULL,
    -- Part of the uniqueness key for the same reason it is on
    -- `daily_grid_results`: a taxonomy revision makes a different board for
    -- the same date.
    board_version        TEXT NOT NULL,
    score                INTEGER NOT NULL CHECK (score >= 0),
    completion_time_ms   BIGINT CHECK (completion_time_ms IS NULL OR completion_time_ms >= 0),
    -- Provenance: the private official result this row was derived from.
    -- Deliberately NOT a foreign key — `daily_grid_results` was never pushed
    -- to hosted Supabase (its own header says so) and a missing sibling must
    -- not fail this chain; the API only ever writes ids it just read back.
    result_id            TEXT NOT NULL,
    -- When the qualifying completion was FIRST saved (== the result row's
    -- created_at) — the ranking's third key, so an identical performance
    -- resolves to whoever did it first.
    completed_at         TIMESTAMPTZ NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT daily_grid_leaderboard_unique_owner_day
        UNIQUE (owner_sub, daily_key, board_version)
);

-- THE ONLY HOT QUERY SHAPE (A2.13): WHERE daily_key = ? ordered by the
-- ranking. The database orders; the API only numbers the rows it is handed —
-- no fetch-all-and-sort in application code, no client-side ranking.
CREATE INDEX IF NOT EXISTS daily_grid_leaderboard_rank_idx
    ON daily_grid_leaderboard_entries
    (daily_key, score DESC, completion_time_ms ASC NULLS LAST, completed_at ASC, id ASC);

-- The guest-claim/off-board lookups: "this owner's entry for this day".
-- Covered by the UNIQUE constraint's index prefix; nothing further needed.

-- ---------------------------------------------------------------------------
-- RLS: public READ (a leaderboard is public — the row carries a subject, a
-- day and two numbers, no email, no answer material), NO client write of any
-- kind. A client that could insert or update could choose its own score and
-- time, which is precisely what the server-derived pipeline exists to
-- prevent (A2.12). Every write goes through the API's table-owning
-- connection; denied-by-default RLS with no INSERT/UPDATE/DELETE policy is
-- the second layer.
-- ---------------------------------------------------------------------------
ALTER TABLE daily_grid_leaderboard_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_grid_leaderboard_public_read ON daily_grid_leaderboard_entries;
CREATE POLICY daily_grid_leaderboard_public_read ON daily_grid_leaderboard_entries
    FOR SELECT USING (TRUE);

-- ---------------------------------------------------------------------------
-- REVOKE: the same second layer every recent sibling carries.
-- `20260630130100_default_privileges.sql` grants privileges on every later
-- table to anon+authenticated; without this block any holder of the browser
-- bundle's anon key could reach this table through PostgREST with write
-- privileges gated only by RLS. A write that matches no policy silently
-- affects zero rows; a REVOKE fails loudly at the privilege check.
--
-- ALL FIVE WRITE VERBS, not just the CRUD three — TRUNCATE is a write RLS
-- never filters (it is table-level, no policy is consulted) and TRIGGER
-- allows attaching a function to a table one cannot otherwise write. Both
-- were left granted by an earlier migration that revoked only the three (see
-- `tests/integration/test_arena_rls.py`), which is why the sibling arena
-- migrations and this one revoke five. Caught here by
-- `tests/integration/test_daily_grid_leaderboard_rls.py` on its first run
-- against a real database.
--
-- SELECT stays granted — the public-read policy above is the point.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'daily_grid_leaderboard_entries'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER
            ON public.daily_grid_leaderboard_entries
            FROM anon, authenticated;
    END IF;
END
$$;

-- Down (never executed; recorded for review):
--   DROP TABLE IF EXISTS daily_grid_leaderboard_entries;
