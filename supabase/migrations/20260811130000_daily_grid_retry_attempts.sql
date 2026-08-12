-- Daily Grid RETRY attempts: the server clock for leaderboard replays
-- (final integrity closure, gap 1).
--
-- WHY A SECOND ATTEMPTS TABLE INSTEAD OF LOOSENING THE FIRST.
-- `daily_grid_attempts` (20260801150000) is UNIQUE (owner_sub, daily_key) and
-- its entire contract is "one non-restartable clock per player per day" — the
-- canonical first attempt, whose time stamps the player's one immutable
-- official result. That contract is load-bearing (idempotent /start, D8) and
-- is not weakened here. A RETRY is a different thing: an explicit, repeatable
-- act whose only consequence is a possible improvement of the player's
-- public leaderboard entry. So retries get their own append-only table:
--
--   * every row is a fresh attempt with its own server-stamped `started_at`;
--   * the ACTIVE retry for (owner, daily_key) is simply the latest row;
--   * nothing here can touch `daily_grid_attempts` or `daily_grid_results` —
--     the canonical first result and its recorded time stay exactly as the
--     player earned them.
--
-- HOW A ROW IS USED. `POST /daily-grid/{key}/retry` (signed-in, non-anonymous,
-- today only, official result already saved) inserts one. When the player
-- finishes the replayed board, `POST /daily-grid/retry/complete` re-validates
-- the board square by square, recomputes the score server-side, computes
-- `completion_time_ms = now() - latest_retry.started_at` (both ends
-- server-stamped; the request body carries no time and no score), and feeds
-- the leaderboard's better-only upsert. A worse replay changes nothing.
--
-- SAFE TO RE-RUN AND SAFE OUT OF ORDER: every statement is guarded, matching
-- every sibling in this directory.

CREATE TABLE IF NOT EXISTS daily_grid_retry_attempts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub    TEXT NOT NULL,
    -- YYYY-MM-DD in the product reset zone (America/Los_Angeles), same key
    -- as the canonical attempt clock and the leaderboard partition.
    daily_key    TEXT NOT NULL,
    -- Server-stamped, never client-supplied. The routes never read a
    -- timestamp out of a request body.
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Deliberately NO unique constraint on (owner_sub, daily_key): multiple
    -- rows per day are the point. The newest row is the active clock.
);

-- The only query shape: "this owner's newest retry for this day".
CREATE INDEX IF NOT EXISTS daily_grid_retry_attempts_latest_idx
    ON daily_grid_retry_attempts (owner_sub, daily_key, started_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: server-only, same posture as the canonical attempts table — the owner
-- may read their own clock through PostgREST (harmless, and symmetric with
-- daily_grid_attempts_owner_read), and no client role can write. A client
-- that could insert its own row could stamp itself a fresh clock an instant
-- before submitting a pre-solved board; the whole value of this table is that
-- `started_at` is witnessed by the server on an explicit, logged retry act.
-- ---------------------------------------------------------------------------
ALTER TABLE daily_grid_retry_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_grid_retry_attempts_owner_read ON daily_grid_retry_attempts;
CREATE POLICY daily_grid_retry_attempts_owner_read ON daily_grid_retry_attempts
    FOR SELECT USING (owner_sub = (SELECT auth.uid()::text));

-- ---------------------------------------------------------------------------
-- REVOKE: all five write verbs, not the CRUD three —
-- `20260630130100_default_privileges.sql` grants more than CRUD to
-- anon+authenticated on every new table, TRUNCATE is a write RLS never
-- filters, and TRIGGER allows attaching a function to a table one cannot
-- otherwise write (the lesson of 20260801170000, re-learned by
-- 20260811090000's first draft). SELECT stays granted; the owner-read policy
-- above narrows it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'daily_grid_retry_attempts'
    ) THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER
            ON public.daily_grid_retry_attempts
            FROM anon, authenticated;
    END IF;
END
$$;

-- Down (never executed; recorded for review):
--   DROP TABLE IF EXISTS daily_grid_retry_attempts;
