-- Migration: contact_submissions (launch-polish IMPLEMENTATION_CONTRACT.md §9)
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this
-- pass, same discipline as every other table added in this phase (see
-- 20260724150000_perfect_season_leaderboard.sql's own header comment for
-- the pattern this repeats).
--
-- WHAT THIS REPLACES. apps/web's contact page was a static `mailto:` to a
-- deliberate `.invalid` placeholder -- there was no contact/feedback
-- storage or route anywhere in this codebase before this migration.
--
-- MODELED DIRECTLY ON 20260801120000_telemetry_events.sql, not designed
-- from scratch -- same "write-only from the client's perspective" shape,
-- because the reasoning is identical: a client that can read its own
-- contact submissions is one broken predicate away from reading everyone
-- else's, and no product surface needs a player to read back what they
-- sent. `subject_hash`/`subject_kind` reuse app/models/telemetry.py's
-- `hash_subject`/`subject_kind` exactly (HMAC-SHA256 keyed with
-- PEAK3_SIGNING_SECRET) -- the raw owner subject never reaches this table,
-- for the same re-identification reason documented there.
--
-- WHAT IS DIFFERENT FROM TELEMETRY, and why:
--   * No retention/expiry columns. Telemetry is high-volume, ambient,
--     collected without an explicit per-event user action; a contact
--     submission is a deliberate, individually-composed message a person
--     typed to reach a human, and this pass does not assume a retention
--     policy for correspondence the way it does for analytics events.
--   * `message`/`subject`/`reply_email` are free text (bounded, but real
--     free text), unlike telemetry's closed-vocabulary event names and
--     validated-scalar-only props. This is the one place in this whole
--     schema that stores genuinely free-form input from an
--     authentication-optional surface -- treat it accordingly: sanitize
--     before ever rendering it anywhere (an admin tool included).
--   * `status` exists for future triage (open/in_progress/resolved). No
--     route in this pass updates it -- there is no admin surface yet, only
--     the submission path. It defaults to 'open' and is otherwise inert.

CREATE TABLE IF NOT EXISTS contact_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Same construction as telemetry_events.subject_hash: HMAC-SHA256 of the
    -- resolved owner subject (verified JWT sub, or the signed anon-cookie
    -- subject), never the raw value. Lets an admin tool group a user's own
    -- submissions without ever storing something re-identifying on its own.
    subject_hash    TEXT NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
    subject_kind    TEXT NOT NULL CHECK (subject_kind IN ('anon', 'user')),

    -- Closed vocabulary, authoritative list in app/models/contact.py
    -- (ContactCategory). Mirrors the contact page's own reason dropdown.
    category        TEXT NOT NULL CHECK (category IN (
                        'new_mode', 'improve_mode', 'bug',
                        'question_ranking_or_data', 'accessibility',
                        'account_or_privacy', 'partnership_or_press', 'other'
                    )),

    -- Optional: which part of the product this is about, when the category
    -- makes that meaningful (a bug report almost always has one; "press"
    -- usually doesn't). Closed vocabulary, same discipline as category.
    relevant_area   TEXT CHECK (relevant_area IS NULL OR relevant_area IN (
                        'daily_grid', 'peak_season_82_0', 'run_the_table',
                        'ranked', 'rankings_model', 'account', 'other'
                    )),

    subject         TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
    message         TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 4000),

    -- Opt-in, mainly for a signed-out sender who wants a reply -- a signed-in
    -- account's real email is never read from their session for this table
    -- (see the API route: this column is the ONLY email that can ever land
    -- here, and only when the sender typed it themselves). Loosely
    -- shape-checked at the database layer as defense in depth; the real
    -- validation is app/models/contact.py's pydantic field.
    reply_email     TEXT CHECK (
                        reply_email IS NULL
                        OR (char_length(reply_email) <= 320 AND reply_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
                    ),

    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Triage queries: newest-first, optionally by status.
CREATE INDEX IF NOT EXISTS contact_submissions_created_idx
    ON contact_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS contact_submissions_status_idx
    ON contact_submissions (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: NOBODY reads this table through PostgREST, and nobody writes to it
-- either -- identical shape and identical reasoning to
-- 20260801120000_telemetry_events.sql's own RLS section (reread there for
-- the full "why an explicit deny AND a revoke, when no policy already
-- denies" argument; short version: 20260630130100_default_privileges.sql
-- grants anon/authenticated SELECT/INSERT/UPDATE/DELETE on every future
-- table automatically, so relying on "no policy" would be leaving this
-- table's protection to an absence rather than a statement).
--
-- Submission goes through POST /api/v1/contact only, which is where the
-- category/length validation, the honeypot check and the rate limit live.
-- A direct PostgREST insert would bypass all three.
-- ---------------------------------------------------------------------------
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_submissions_no_client_access ON contact_submissions;
CREATE POLICY contact_submissions_no_client_access ON contact_submissions
    FOR ALL USING (false) WITH CHECK (false);

REVOKE SELECT, INSERT, UPDATE, DELETE ON contact_submissions FROM anon, authenticated;

-- Down:
-- DROP TABLE IF EXISTS contact_submissions;
