-- Daily Grid attempts: the server-side clock (Phase 12, spec §2 / defect D8).
--
-- WHAT WAS WRONG. The elapsed time on a Daily Grid board was measured entirely
-- in the browser (`apps/web/src/lib/daily-grid-state.ts:245-265`). That clock
-- ran while the tab was closed, reset when local storage was cleared, and was
-- editable from the console -- and it was written verbatim into
-- `daily_grid_results.elapsed_seconds`. The creating migration
-- (`20260730190000_daily_grid_results.sql:56-59`) says so out loud: "nothing
-- validates it -- which is exactly why it must never become a scoring term
-- without server-side timing". This table is that server-side timing.
--
-- WHAT THIS IS. One row per player per daily key, holding the instant the
-- server first agreed the attempt had begun. Elapsed time is derived
-- (`now() - started_at`) and never accepted from a client.
--
-- ONE ROW, WRITTEN ONCE. `UNIQUE (owner_sub, daily_key)` is what makes
-- `POST /api/v1/daily-grid/{daily_key}/start` idempotent under concurrency
-- rather than by convention: the repository inserts with
-- `ON CONFLICT (owner_sub, daily_key) DO NOTHING ... RETURNING *`, so a
-- double-click, a refresh and a second tab all resolve to the same
-- `started_at`. There is deliberately NO UPDATE path in the repository and no
-- UPDATE policy below -- a restartable clock measures nothing.
--
-- NOT KEYED ON `board_version`, unlike `daily_grid_results`. A player has one
-- timed attempt per DAY. If the taxonomy were revised mid-day, re-clocking
-- them from zero would be worse than keeping the clock they have been
-- watching. `board_id`/`board_version` are recorded so a row stays
-- self-describing.
--
-- OWNERS ARE OFTEN ANONYMOUS. Daily Grid needs no account to play, so
-- `owner_sub` is very often an `anon:...` subject from the first-party signed
-- `peak3_anon` cookie, exactly as for `run_the_table_runs` and
-- `peak_duel_daily_results`. The owner-scoped RLS policies below therefore
-- match no anon-key client at all (`auth.uid()` is null for them); the API
-- connects as the table-owning role and enforces owner scoping in application
-- code, and RLS is the second, independent layer. Same architecture note as
-- `20260801100000_rls_gaps.sql`.
--
-- SAFE TO RE-RUN AND SAFE OUT OF ORDER. Every statement is guarded, because
-- `20260730190000_daily_grid_results.sql` was never pushed to hosted Supabase
-- (its own header, lines 4-7) and a missing sibling must not fail the chain.

CREATE TABLE IF NOT EXISTS daily_grid_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub       TEXT NOT NULL,
    -- YYYY-MM-DD in the product reset zone (America/Los_Angeles), decided by
    -- the server. Never a browser wall-clock date -- see nba_peak/daily_key.py.
    daily_key       TEXT NOT NULL,
    -- The generator's board id, e.g. 'daily-grid-v2-2026-08-01', and the
    -- taxonomy version that produced it. Informational: the uniqueness key is
    -- deliberately the day alone (see the header).
    board_id        TEXT NOT NULL,
    board_version   TEXT NOT NULL,
    -- Assigned by the server on the first successful insert and never moved.
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT daily_grid_attempts_unique_owner_day
        UNIQUE (owner_sub, daily_key)
);

-- The only lookup this table has: "does this owner have a clock for this day?"
-- The UNIQUE constraint above already provides the index; this one supports
-- the guest-claim sweep (`transfer_owner`), which scans by owner alone.
CREATE INDEX IF NOT EXISTS daily_grid_attempts_owner_idx
    ON daily_grid_attempts (owner_sub, daily_key DESC);

-- ---------------------------------------------------------------------------
-- RLS: private-by-default, owner-only. No public read: when this board's
-- timer eventually feeds a "fastest solve" surface, that will be a separately
-- reviewed published projection, not a relaxation of this policy.
-- ---------------------------------------------------------------------------
ALTER TABLE daily_grid_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_grid_attempts_owner_read ON daily_grid_attempts;
CREATE POLICY daily_grid_attempts_owner_read ON daily_grid_attempts
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- No INSERT, UPDATE or DELETE policy, and no need for one. Every write goes
-- through the API's table-owning connection. A client that could insert its
-- own row could choose its own `started_at` -- i.e. could hand itself a
-- three-second solve -- which is precisely the attack the server-side clock
-- removes. Denied by default under RLS with no matching policy.

-- ---------------------------------------------------------------------------
-- REVOKE: the second layer, for the reason 20260801130000 and 20260801140000
-- both spell out. `20260630130100_default_privileges.sql:31-32` runs
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
--
-- which attaches to every table created AFTERWARDS -- including this one. So
-- without this block, any holder of the public anon key that ships in the
-- browser bundle could reach `daily_grid_attempts` through PostgREST. The RLS
-- policy above pins ownership, not the payload, and a write that matches no
-- policy silently affects zero rows; a REVOKE fails loudly at the privilege
-- check instead.
--
-- SELECT is left granted, matching the four sibling result tables: the
-- owner-read policy already narrows it to the caller's own rows, and reading
-- one's own clock directly is a legitimate future client path.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'daily_grid_attempts'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE ON public.daily_grid_attempts
            FROM anon, authenticated;
    END IF;
END
$$;

-- Down (never executed; recorded for review):
--   DROP TABLE IF EXISTS daily_grid_attempts;
