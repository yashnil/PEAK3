-- Migration 022: First-party product telemetry (Track F)
-- telemetry_events
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this pass,
-- same discipline as 20260730190000_daily_grid_results.sql and
-- 20260731090000_run_the_table.sql.
--
-- WHAT THIS IS. A narrow, append-only product-funnel log: "a run started",
-- "the tutorial was skipped", "the final boss was lost". It exists to answer
-- exactly the questions in scripts/telemetry_report.py -- first-run
-- completion, tutorial completion, second-run conversion, clear rate, boss
-- win rates, perk pick/win rates, trade usage, run duration, daily return --
-- and nothing else.
--
-- WHAT THIS IS EMPHATICALLY NOT. It is not a user profile, not a session
-- recorder, and not an identity store. The columns below are the complete
-- list of what can ever be written; there is no free-text column, no request
-- header capture, no IP column, and no email column, by construction rather
-- than by policy. The full "never collected" list, and the enforcement that
-- backs it, is docs/implementation/TELEMETRY.md.
--
-- IDENTITY IS A SALTED HASH, NOT THE SUBJECT. `subject_hash` is
-- HMAC-SHA256(PEAK3_SIGNING_SECRET, owner_sub) rendered hex, computed in the
-- API before the row is built (app/models/telemetry.py:hash_subject). The
-- server never writes the raw `anon:...` token or the Supabase `sub` here.
-- The cost of that choice is real and deliberate: this table CANNOT be joined
-- to games / run_the_table_runs / profiles, because those store the raw
-- owner_sub. Every metric the report script produces is a per-subject
-- aggregate (funnels, conversion, return), so no such join is needed -- and
-- giving up the join is what makes a leaked telemetry extract non-identifying
-- without the signing secret.
--
-- WITHIN-TELEMETRY LINKAGE uses `run_ref` / `session_ref` in `props`: opaque
-- random tokens minted by the CLIENT for this purpose only. They are not the
-- server's run ids, so perk-win-rate analysis works without creating a second
-- path back to a named account.
--
-- SAME "service-role writes, RLS as the client gate" split as every other
-- table here (see 20260630130000_ranked_rls.sql): the API writes through its
-- owner-role asyncpg pool, so the policies below never apply to it. What they
-- do apply to is a PostgREST client holding the anon/authenticated key, and
-- for THIS table the correct answer to that client is "nothing at all" -- see
-- the RLS section.

CREATE TABLE IF NOT EXISTS telemetry_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Hex HMAC-SHA256 of the owner subject. Fixed width, so a raw
    -- `anon:{token}` or a Supabase UUID cannot be stored here by accident --
    -- neither is 64 hex characters.
    subject_hash        TEXT NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),

    -- 'anon' or 'user'. The only identity attribute retained, because
    -- "did signing in change the funnel?" is a question the funnel must be
    -- able to answer and this is the least that answers it.
    subject_kind        TEXT NOT NULL CHECK (subject_kind IN ('anon', 'user')),

    -- Product event name. The AUTHORITATIVE closed allowlist lives in
    -- app/models/telemetry.py (EVENT_NAMES) and is enforced by the ingest
    -- endpoint's Pydantic Literal, so an unknown name is a 422 and never
    -- reaches this table. The pattern below is the second layer: it bounds
    -- the shape without duplicating the list, so adding an event does not
    -- require a migration while writing arbitrary text still cannot happen.
    event_name          TEXT NOT NULL CHECK (event_name ~ '^[a-z][a-z0-9_]{2,63}$'),

    -- Validated scalar properties only. Every key is checked against a closed
    -- allowlist and every value against a closed type + charset set before the
    -- insert (app/models/telemetry.py). No free text ever reaches this column.
    props               JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Server clock. The client's own timestamp is deliberately NOT stored:
    -- it is unverifiable, it is a fingerprinting surface (clock skew is
    -- surprisingly identifying), and every metric here is computed from
    -- server-observed ordering anyway.
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- RETENTION, as a column rather than a promise. Set by the API to
    -- created_at + PEAK3_TELEMETRY_RETENTION_DAYS (default 90). A row past
    -- this instant is garbage awaiting collection -- see
    -- telemetry_events_purge_expired() below for who actually collects it.
    expires_at          TIMESTAMPTZ NOT NULL,

    CONSTRAINT telemetry_events_expiry_after_creation CHECK (expires_at > created_at),
    -- Bounds the property bag at the storage layer too, so a bug in the
    -- validator cannot turn this into a document store.
    CONSTRAINT telemetry_events_props_is_object CHECK (jsonb_typeof(props) = 'object')
);

-- The funnel queries: "all X events in this period, newest first".
CREATE INDEX IF NOT EXISTS telemetry_events_name_recent_idx
    ON telemetry_events (event_name, created_at DESC);

-- The per-subject queries: conversion, return, "did this subject ever ...".
CREATE INDEX IF NOT EXISTS telemetry_events_subject_idx
    ON telemetry_events (subject_hash, created_at);

-- The purge query. Small and single-purpose so retention stays cheap even
-- when the table is large.
CREATE INDEX IF NOT EXISTS telemetry_events_expiry_idx
    ON telemetry_events (expires_at);

-- ---------------------------------------------------------------------------
-- Retention enforcement
--
-- HOW IT IS ACTUALLY ENFORCED, stated plainly so nobody has to guess:
--
--   1. Every row is written with a hard `expires_at`. That is a fact about
--      the row, not a setting somebody can forget to apply retroactively.
--   2. `telemetry_events_purge_expired()` below is the delete. It is
--      idempotent and safe to run at any frequency.
--   3. SOMETHING MUST CALL IT. This migration does NOT schedule it, because
--      scheduling needs the `pg_cron` extension, which is an operator
--      decision (it is available on hosted Supabase but is not enabled by
--      default, and enabling an extension from an app migration is not this
--      repo's call to make). Until an operator schedules it, expired rows
--      remain on disk -- that is the honest status, and it is why the API
--      also opportunistically purges: PostgresTelemetryRepository runs the
--      same delete at most once per hour per process
--      (app/repositories/telemetry_postgres.py), which is enough for a
--      single-process deployment and is not a substitute for the cron job at
--      scale.
--
-- To schedule it properly, an operator runs (once, out of band):
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--       'telemetry_events_purge',
--       '17 4 * * *',
--       $cron$ SELECT telemetry_events_purge_expired(); $cron$
--   );
--
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION telemetry_events_purge_expired()
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
    removed BIGINT;
BEGIN
    DELETE FROM telemetry_events WHERE expires_at <= NOW();
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS: NOBODY reads this table through PostgREST, and nobody writes to it
-- either.
--
-- This differs from every other table in the chain, which grants the owner
-- read access to their own rows, and the difference is the point. Telemetry
-- is write-only from the client's perspective:
--
--   * a client must not READ its own events, because "read your own
--     telemetry" is one broken predicate away from "read everyone's", and
--     there is no product feature that needs it;
--   * a client must not read anyone ELSE'S events, obviously;
--   * a client must not INSERT directly either. Ingest goes through
--     POST /api/v1/telemetry/events, which is where the allowlist, the PII
--     rejection, the size caps and the rate limit live. A direct PostgREST
--     insert would bypass all four -- so the write path a client is offered
--     is the validated one, and only that one.
--
-- Analysis happens server-side (scripts/telemetry_report.py) over the owner
-- role, which is not subject to these policies.
--
-- WHY AN EXPLICIT DENY POLICY AND A REVOKE, when "no policy" already denies:
-- 20260630130100_default_privileges.sql:31 sets ALTER DEFAULT PRIVILEGES so
-- every future table in schema public is granted SELECT/INSERT/UPDATE/DELETE
-- to anon and authenticated automatically -- including this one, the moment
-- it is created. Base privileges alone are not enough to read a row under RLS,
-- but relying on "there happens to be no policy" makes the protection an
-- absence rather than a statement. So: an explicit FOR ALL deny policy that
-- says what is intended, AND a REVOKE that removes the inherited grant, so
-- both layers have to be undone deliberately for this table to leak.
-- ---------------------------------------------------------------------------
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telemetry_events_no_client_access ON telemetry_events;
CREATE POLICY telemetry_events_no_client_access ON telemetry_events
    FOR ALL USING (false) WITH CHECK (false);

REVOKE SELECT, INSERT, UPDATE, DELETE ON telemetry_events FROM anon, authenticated;

-- Down:
-- DROP FUNCTION IF EXISTS telemetry_events_purge_expired();
-- DROP TABLE IF EXISTS telemetry_events;
