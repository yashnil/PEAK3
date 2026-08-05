-- Migration: Arena public ratings and the leaderboards built on them.
--
-- The two tables 20260804100000_arena_foundation.sql:88-92 deliberately left
-- out ("what a match counts FOR is somebody else's migration"). This is that
-- migration.
--
-- WHAT COUNTS IS ALREADY DECIDED, AND NOT RE-DECIDED HERE
-- ------------------------------------------------------
-- `arena_matches` carries `CHECK (rated = (entry_path = 'public_queue'))` and
-- `arena_match_results.rated` is a COPY of that verdict taken at settlement
-- time, denormalised precisely so a rating pass cannot see a different answer
-- than the match was settled under (foundation:523-527). Nothing in this file
-- recomputes eligibility from `entry_path`; the rating service reads
-- `arena_match_results.rated` and refuses anything else. Private rooms and
-- practice therefore cannot reach a rating by construction, and the service
-- asserts it a second time so the invariant fails loudly rather than silently.
--
-- WHY A LEDGER PLUS A CURRENT ROW, AND NOT ONE TABLE
-- --------------------------------------------------
-- Exactly the split `20260630125800_ranked_rating.sql` uses, for the same
-- reason: `arena_rating_history` is the append-only source of truth and
-- `arena_ratings` is a derived current-value cache that can be rebuilt from it.
-- A single mutable row would make "how did this player reach 1640" an
-- unanswerable question, and a rating you cannot explain is a rating you cannot
-- defend when a player disputes it.
--
-- WHAT IS NOT STORED HERE: LEADERBOARD STATISTICS
-- -----------------------------------------------
-- Wins, podium rate, average placement, average lineup rating, best lineup,
-- budget remaining, PEAK3-per-dollar and human/bot composition are all DERIVED
-- BY QUERY from `arena_match_results` joined to `arena_match_seats`, never
-- materialised into a stats table. The results rows are already immutable and
-- already carry `rated` and `was_bot`, so a second aggregated copy could only
-- ever drift from them -- and the first symptom of that drift would be a
-- leaderboard disagreeing with the match history it was computed from. The
-- foundation makes the same argument about regenerating boards from the seed
-- rather than storing a second copy (foundation:80-86).
--
-- The index at the bottom is what makes that derivation cheap.

-- ---------------------------------------------------------------------------
-- arena_ratings: one current rating per (player, mode).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arena_ratings (
    owner_sub               TEXT NOT NULL,

    -- The mode this rating is FOR. Ratings are per-mode and never pooled: a
    -- three-player snake draft and a two-player blind auction measure different
    -- skills, and one number covering both would be an average of two things
    -- rather than a measurement of either. Not a CHECK IN (...) for the same
    -- reason the foundation declined one on arena_matches.mode -- a new mode
    -- must not require a migration.
    mode                    TEXT NOT NULL,

    -- Glicko-2 state, on the Glicko-1 display scale. NUMERIC and not DOUBLE
    -- PRECISION so a stored rating compares exactly on replay -- the same
    -- boundary-rounding discipline glicko2.py:34-42 applies, and the same
    -- column types 20260630125800_ranked_rating.sql:14-16 chose.
    rating                  NUMERIC(8, 4) NOT NULL,
    rd                      NUMERIC(8, 4) NOT NULL,
    volatility              NUMERIC(10, 8) NOT NULL,

    -- Rated matches actually counted. Drives the "provisional" badge: a rating
    -- built from two matches is not yet a measurement and the leaderboard says
    -- so rather than ranking it beside one built from two hundred.
    rated_matches           INTEGER NOT NULL DEFAULT 0,

    -- The algorithm that produced the current value, pinned rather than read at
    -- display time. A recalibration must not retroactively relabel ratings that
    -- were computed under the previous one.
    algorithm_version       TEXT NOT NULL,

    last_rated_match_at     TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (owner_sub, mode)
);

-- The leaderboard's only ordering. Partial on `rated_matches > 0` because a row
-- with no rated matches is a placeholder, not a competitor, and including it
-- would put every never-played account at the provisional default rating in the
-- middle of the board.
CREATE INDEX IF NOT EXISTS arena_ratings_leaderboard_idx
    ON arena_ratings (mode, rating DESC, rated_matches DESC, owner_sub)
    WHERE rated_matches > 0;

-- ---------------------------------------------------------------------------
-- arena_rating_history: append-only, one row per player per rated match.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arena_rating_history (
    id                      BIGSERIAL PRIMARY KEY,
    owner_sub               TEXT NOT NULL,
    mode                    TEXT NOT NULL,
    match_id                UUID NOT NULL REFERENCES arena_matches(match_id) ON DELETE CASCADE,

    -- Before and after, both stored. Storing only the delta would make a
    -- replay depend on every earlier row being present and correct; storing
    -- both makes any single row independently checkable.
    pre_rating              NUMERIC(8, 4) NOT NULL,
    pre_rd                  NUMERIC(8, 4) NOT NULL,
    pre_volatility          NUMERIC(10, 8) NOT NULL,
    post_rating             NUMERIC(8, 4) NOT NULL,
    post_rd                 NUMERIC(8, 4) NOT NULL,
    post_volatility         NUMERIC(10, 8) NOT NULL,

    -- The rating Glicko-2 actually produced, BEFORE the per-match bound was
    -- applied. Equal to post_rating whenever the bound did not bite.
    --
    -- Stored because the bound is the abuse control this design uses INSTEAD of
    -- a daily cap, and a control whose activations are invisible cannot be
    -- monitored or tuned. A player whose unbounded value is repeatedly far from
    -- their bounded one is the signal a cap would have been trying to catch,
    -- and it is visible here without penalising honest high-volume play.
    unbounded_post_rating   NUMERIC(8, 4) NOT NULL,
    bound_applied           BOOLEAN NOT NULL DEFAULT FALSE,

    -- This seat's finishing position in the match. Ties SHARE a placement
    -- (foundation:511-513), so 1/1/1 is a three-way draw and the next seat
    -- would be 4. Copied here so the ledger explains itself without a join.
    placement               SMALLINT NOT NULL CHECK (placement >= 1),

    -- The pairwise results this rating change was computed from, as
    -- [{"opponent_seat": n, "score": 1.0|0.5|0.0, "was_bot": bool,
    --   "opponent_rating": r, "opponent_rd": d}, ...].
    --
    -- A three-player match is rated as ONE Glicko-2 rating period containing
    -- two opponents, not as two independent matches -- see
    -- services/arena/rating.py. This column is what makes that decomposition
    -- auditable rather than implicit.
    opponents               JSONB NOT NULL DEFAULT '[]',

    -- Whether ANY opponent in this match was a bot. Denormalised from the
    -- seats for the same reason arena_match_results.was_bot is: a history read
    -- must not depend on the seat rows still existing, and a player is entitled
    -- to see which of their rated wins were against people.
    had_bot_opponent        BOOLEAN NOT NULL,

    -- The bot policy the bots in this match were seated under, pinned at seat
    -- time by the matchmaker and copied here. NULL when every opponent was
    -- human. Read from the match, never recomputed: a recalibration must not
    -- change what a settled match was played against.
    bot_policy_version      TEXT,

    algorithm_version       TEXT NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ONE rating row per player per match, forever. This is the idempotency
-- boundary for the whole rating pass: a settlement replayed twice -- by a
-- retry, a redeploy mid-settle, or a manual re-run -- inserts nothing the
-- second time and the current-rating update is skipped with it. Without this a
-- double settle would silently double a rating change, which is the one class
-- of bug in a rating system that players notice and cannot be talked out of.
CREATE UNIQUE INDEX IF NOT EXISTS arena_rating_history_one_per_player_match_idx
    ON arena_rating_history (owner_sub, match_id);

-- A player's own rating history, newest first. Serves both the history route
-- and any future replay/verification pass.
CREATE INDEX IF NOT EXISTS arena_rating_history_owner_idx
    ON arena_rating_history (owner_sub, mode, id DESC);

-- Append-only. Same rule, same reasoning, and the same shape as
-- rating_ledger_entries (20260630125800:44-59) and arena_match_results
-- (foundation:541-551): a rating change is evidence, and evidence that can be
-- edited is not evidence. A rating computed in error is corrected by appending
-- a compensating row, never by rewriting one.
CREATE OR REPLACE FUNCTION arena_rating_history_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'arena_rating_history is append-only; % is not permitted (id=%)',
        TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arena_rating_history_no_update ON arena_rating_history;
CREATE TRIGGER arena_rating_history_no_update
    BEFORE UPDATE ON arena_rating_history
    FOR EACH ROW EXECUTE FUNCTION arena_rating_history_immutable();

DROP TRIGGER IF EXISTS arena_rating_history_no_delete ON arena_rating_history;
CREATE TRIGGER arena_rating_history_no_delete
    BEFORE DELETE ON arena_rating_history
    FOR EACH ROW EXECUTE FUNCTION arena_rating_history_immutable();

-- ---------------------------------------------------------------------------
-- The leaderboard statistics index.
--
-- Every statistic on both boards is one aggregate over this shape:
--
--     arena_match_results r JOIN arena_match_seats s USING (match_id, seat_index)
--     WHERE r.rated AND s.occupant_sub = $1
--
-- so the seats side needs to reach a player's rated result rows without
-- scanning. `arena_match_seats_occupant_idx` (foundation) already covers
-- occupant_sub; this covers the results side of the same join.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS arena_match_results_rated_idx
    ON arena_match_results (match_id, seat_index)
    WHERE rated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- WHAT A PUBLIC LEADERBOARD MAY EXPOSE. Rating and statistics, attached to a
-- PUBLIC HANDLE -- nothing else. `arena_ratings.owner_sub` is a Supabase
-- auth.uid(), the same value 20260803120000_profile_column_privileges.sql
-- withheld from `profiles` for anon/authenticated, and it must not re-enter the
-- schema through this table's front door. So the column privilege below grants
-- every column EXCEPT owner_sub, and the API joins to `profiles.handle` itself.
-- A leaderboard row that carried an auth subject would be a privacy leak
-- dressed as a primary key.
--
-- The row policy is `USING (true)` because a public leaderboard genuinely is
-- public at the ROW level -- every ranked player appears. The exposure that
-- needed narrowing was COLUMN-level, which is exactly the distinction
-- 20260801100000_rls_gaps.sql:69-93 drew for board_snapshots and challenges.
-- ---------------------------------------------------------------------------
ALTER TABLE arena_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE arena_rating_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS arena_ratings_public_read ON arena_ratings;
CREATE POLICY arena_ratings_public_read ON arena_ratings
    FOR SELECT USING (true);

-- History is the player's OWN ledger and not public. Self-only, not
-- match-scoped: an opponent's rating trajectory is theirs, and knowing that the
-- player across the table just dropped 80 points is competitive information
-- nobody agreed to share.
DROP POLICY IF EXISTS arena_rating_history_owner_read ON arena_rating_history;
CREATE POLICY arena_rating_history_owner_read ON arena_rating_history
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- Withhold owner_sub from the public table. Everything else on arena_ratings is
-- already public by intent.
REVOKE SELECT ON arena_ratings FROM anon, authenticated;
GRANT SELECT (
    mode, rating, rd, volatility, rated_matches, algorithm_version,
    last_rated_match_at, created_at, updated_at
) ON arena_ratings TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Writes belong to the service role only.
--
-- FIVE VERBS, NOT THREE -- TRUNCATE is a table-level write that RLS does not
-- filter at all (no policy is consulted), so a role holding it could erase
-- every rating in the system regardless of the policies above, and TRIGGER
-- would allow attaching a function to a table one cannot otherwise write. Both
-- were found still granted on four earlier tables after a migration revoked
-- only the CRUD three (20260801160000:258-269), which is why they are named
-- rather than assumed absent.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (20260801100000_rls_gaps.sql:3-18).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'arena_ratings',
        'arena_rating_history'
    ]
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables
            WHERE schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format(
                'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.%I '
                'FROM anon, authenticated',
                t
            );
        END IF;
    END LOOP;
END
$$;

-- Down:
-- DROP INDEX IF EXISTS arena_match_results_rated_idx;
-- DROP TRIGGER IF EXISTS arena_rating_history_no_delete ON arena_rating_history;
-- DROP TRIGGER IF EXISTS arena_rating_history_no_update ON arena_rating_history;
-- DROP FUNCTION IF EXISTS arena_rating_history_immutable();
-- DROP TABLE IF EXISTS arena_rating_history;
-- DROP TABLE IF EXISTS arena_ratings;
