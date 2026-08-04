-- Migration: companion index for the daily 82-0 (PEAK Season) leaderboard.
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this pass,
-- same discipline as every other migration in this file's lineage
-- (`20260724150000_perfect_season_leaderboard.sql` and its own header note).
--
-- WHAT THIS IS FOR. SCORE_RECONCILIATION.md's leaderboard audit added a daily
-- board: `GET /perfect-season/leaderboard?daily=true` is the IDENTICAL query
-- and tie-break order as the all-time board (`perfect_season_runs_leaderboard_idx`,
-- migration 20260724150000), with one extra predicate --
-- `created_at >= <start of the current application day>`, where the boundary
-- comes from `nba_peak.daily_key.day_start_utc` (midnight America/Los_Angeles),
-- the one shared function every daily mode in this codebase uses.
--
-- WHY A NEW INDEX. `perfect_season_runs_leaderboard_idx` is
-- `(mode, wins DESC, lineup_score DESC, respins ASC, created_at ASC) WHERE is_public`.
-- `mode` is the only leading column filtered by equality; `created_at` sits
-- LAST, after three sort-order columns that the daily query does not filter
-- on. Postgres cannot turn "created_at >= X" into an efficient index range
-- scan against that index -- it would need to walk every public row for the
-- filtered mode (or the whole table, if `mode` is unfiltered, which the daily
-- query allows) and apply `created_at` as a row-by-row filter. That is a
-- growing seq-scan-shaped cost as the table grows, for a query whose whole
-- point is "today's rows only" -- a small, bounded slice regardless of table
-- size.
--
-- This index leads with `created_at` so Postgres can range-scan directly to
-- "today's public rows" first (small, bounded), then filter/sort that small
-- result set -- correct for both `?daily=true` alone (all modes, today) and
-- `?daily=true&mode=X` (today, one mode; `mode` still serves as a cheap
-- index-level filter on the narrowed range).
CREATE INDEX IF NOT EXISTS perfect_season_runs_daily_leaderboard_idx
    ON perfect_season_runs (created_at, mode)
    WHERE is_public;

-- Down:
-- DROP INDEX IF EXISTS perfect_season_runs_daily_leaderboard_idx;
