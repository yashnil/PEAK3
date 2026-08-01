-- Migration 026: asynchronous two-player RUN THE TABLE (Head-to-Head).
--
-- LOCAL MIGRATION ONLY -- not applied to hosted Supabase as part of this pass
-- (`supabase link` / `supabase db push` were never run), the same discipline as
-- 20260731090000_run_the_table.sql and its three predecessors.
--
--
-- WHY THESE ARE NEW TABLES AND NOT `challenge_participants`
-- --------------------------------------------------------
-- The pass plan (§4.4) proposed building on the already-migrated
-- `challenges` / `challenge_participants` / `challenge_settlements` trio,
-- which has RLS, a not-self trigger and zero application references
-- (20260630124800_challenges.sql:31-79). That was evaluated against the real
-- DDL and rejected. Four reasons, in descending order of how disqualifying
-- they are:
--
--   1. `challenges_public_meta` is `FOR SELECT USING (true)`
--      (20260630124900_rls.sql:76-79). Every column of every challenge row --
--      including `challenger_snapshot` -- is world-readable through PostgREST
--      with the anon key that ships in the browser bundle
--      (apps/web/src/lib/supabase/config.ts:22). Head-to-head is a
--      SPOILER-SAFE feature: neither player may see the other's result until
--      both are done. Storing it in a table whose published policy is
--      "everything here is public" would build the spoiler leak in at the
--      storage layer, where no amount of application care could close it.
--
--   2. `challenges` is Peak Duel-shaped. `board_id`, `mode`, `board_type` and
--      `duration_years` are all NOT NULL and none of them has any RUN THE
--      TABLE meaning. Filling them to satisfy the schema would be inventing
--      data, which CLAUDE.md forbids outright.
--
--   3. `challenges.challenger_snapshot` is NOT NULL and documented as
--      "immutable at creation". A head-to-head is created BEFORE the creator
--      has finished -- that is what makes it asynchronous -- so at creation
--      there is no result to pin.
--
--   4. `challenge_participants` has no status, no result, no submission time
--      and no completion ordering. Adding all four would be an ALTER on a
--      table two other modes may still adopt, to hold columns that only mean
--      something for this one.
--
-- What IS reused is that migration's REASONING: the participant-scoped row,
-- the not-self rule (here a consequence of a primary key rather than a
-- trigger -- see below), and one settlement per pairing.
--
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
-- --------------------------------------------
-- Stored: the invite's HASH, the creator, the seed, the three version strings,
-- the pinned `fairness` object, an expiry, and -- once both sides submit --
-- the settlement.
--
-- NOT stored: the blueprint, and neither player's run. Both already live in
-- `run_the_table_runs`, and the blueprint is a pure function of the seed
-- (nba_peak/run_the_table/generation.py:253), so a second copy here could only
-- ever drift from the first. `head_to_head_participants.run_id` points at the
-- run; the run stays where it lives.
--
-- NOT stored: the invite itself. `invite_hash` is `sha256(invite_id)`, the
-- same discipline as `challenges.token_hash`. A database read must not yield a
-- working invite link.
--
--
-- WHY THE MATCH ID IS NEVER IN A TOKEN
-- -------------------------------------
-- Spec §6: "the invite must not expose mutable resource IDs". The signed
-- invite carries 128 random bits (`inv`) and nothing else identifying; the
-- lookup is `WHERE invite_hash = sha256(inv)`. `match_id` is a UUID that only
-- ever travels to a caller who is already a participant, and every route that
-- accepts one re-checks participation
-- (apps/api/app/api/v1/head_to_head.py `_participant_or_403`, modelled on
-- ranked.py:196-203). Possessing a match id is worth a 403.

CREATE TABLE IF NOT EXISTS head_to_head_matches (
    match_id            UUID PRIMARY KEY,
    -- sha256(invite_id), hex. UNIQUE so an invite resolves to exactly one
    -- match and a collision is a constraint violation rather than a silent
    -- cross-match join.
    invite_hash         TEXT UNIQUE NOT NULL,
    -- Always a Supabase auth.uid(): spec §6 says an AUTHENTICATED user
    -- creates. Unlike run_the_table_runs.owner_sub this is never an anon
    -- cookie subject, which is why the RLS policies below can be the primary
    -- control here rather than a second layer.
    creator_sub         TEXT NOT NULL,
    -- The board both players get. BIGINT for the same reason
    -- run_the_table_runs.seed is: the space is [0, 2^31) today and a column
    -- that cannot hold a wider one is a migration waiting to happen.
    seed                BIGINT NOT NULL,
    -- Provenance of the run this was minted from. Neither column affects
    -- generation (`generate_blueprint` ignores both), so neither can make the
    -- two sides' boards differ; they are carried so a receipt can say where
    -- the board came from.
    source_run_type     TEXT NOT NULL CHECK (source_run_type IN ('standard', 'daily', 'challenge')),
    source_run_date     DATE,
    engine_version      TEXT NOT NULL,
    ruleset_version     TEXT NOT NULL,
    card_pool_version   TEXT NOT NULL,
    -- The pinned fairness contract: ruleset version, starting starters,
    -- starting bench, both System offers, the boss sequence, a digest over the
    -- node structure and every offer-generation input, and a digest over all
    -- of it. Re-derived from each player's own regenerated blueprint at join
    -- and at submission and compared against this
    -- (services/head_to_head.assert_fairness). JSONB rather than child tables
    -- because it is written once, read whole, and never queried field by field
    -- -- the same call run_the_table_runs.snapshot makes.
    fairness            JSONB NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'complete')),
    expires_at          TIMESTAMPTZ NOT NULL,
    -- `services.head_to_head.compare()` output. NULL until both sides submit;
    -- written first-write-wins by `WHERE settlement IS NULL`, so two tabs
    -- finishing together cannot produce two different settled outcomes.
    settlement          JSONB,
    settled_at          TIMESTAMPTZ,
    rematch_of          UUID REFERENCES head_to_head_matches(match_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ONE REMATCH PER SOURCE MATCH PER CREATOR. This is the idempotency half of
-- `POST /{match_id}/rematch`: a double-clicked Rematch button must return the
-- match already created rather than mint a second board. Partial, so the many
-- rows with a NULL `rematch_of` are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS head_to_head_matches_rematch_uniq
    ON head_to_head_matches (rematch_of, creator_sub)
    WHERE rematch_of IS NOT NULL;

CREATE INDEX IF NOT EXISTS head_to_head_matches_creator_idx
    ON head_to_head_matches (creator_sub, created_at DESC);


CREATE TABLE IF NOT EXISTS head_to_head_participants (
    match_id        UUID NOT NULL REFERENCES head_to_head_matches(match_id) ON DELETE CASCADE,
    participant_sub TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('creator', 'opponent')),
    -- The run this participant is allowed to act on. Written once, at seating
    -- time, from the server's own run creation -- never accepted from a
    -- client. Every submission resolves through this column, which is the
    -- ranked.py:196-203 contract: the server decides which run a participant
    -- may submit, and there is no request field that can disagree.
    run_id          TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('in_progress', 'complete')),
    -- ComparisonMetrics.to_dict() at submission, computed server-side from the
    -- run's own receipt. NULL until submitted; first write wins
    -- (`WHERE result IS NULL`), so a replayed submission cannot rewrite a
    -- number an opponent has already been compared against.
    result          JSONB,
    submitted_at    TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ONE SEAT PER PERSON. This is also the not-self rule: the creator already
    -- holds a row, so their own accept collides here. 20260630124800 needed a
    -- trigger for the equivalent check because its challenger lived in a
    -- DIFFERENT table (a CHECK cannot contain a subquery); here both sides are
    -- rows of this table, so a primary key is sufficient and a trigger would
    -- be a second, weaker copy of the same rule.
    PRIMARY KEY (match_id, participant_sub)
);

-- TWO PLAYERS, NOT THREE. Combined with the primary key above, this is what
-- makes "seat yourself" the only thing an invite can do: the third acceptor
-- collides on the role and gets 409 match_full.
CREATE UNIQUE INDEX IF NOT EXISTS head_to_head_participants_role_uniq
    ON head_to_head_participants (match_id, role);

-- The history query: every match this subject is in, newest first.
CREATE INDEX IF NOT EXISTS head_to_head_participants_sub_idx
    ON head_to_head_participants (participant_sub, joined_at DESC);


-- ---------------------------------------------------------------------------
-- RLS: participant-scoped, private by default.
--
-- No public read on either table. A match row carries the pinned starting
-- roster and the boss sequence in `fairness`, which is spoiler material for
-- anyone who has not played the board, and a participant row carries the other
-- player's result. `challenges_public_meta`'s `USING (true)` is precisely the
-- shape this feature must not have -- see the header.
--
-- Unlike run_the_table_runs, `auth.uid()` is meaningful for every row here:
-- both participants are always authenticated accounts. These policies are
-- therefore real access control rather than a layer that happens to match
-- nothing.
-- ---------------------------------------------------------------------------
ALTER TABLE head_to_head_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE head_to_head_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS head_to_head_matches_participant_read ON head_to_head_matches;
CREATE POLICY head_to_head_matches_participant_read ON head_to_head_matches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM head_to_head_participants p
             WHERE p.match_id = head_to_head_matches.match_id
               AND p.participant_sub = auth.uid()::text
        )
    );

-- SELF-ONLY, NOT MATCH-SCOPED, and this is deliberate on two counts.
--
-- The obvious policy -- "you may read a participant row if you are in that
-- match" -- has to look up `head_to_head_participants` from inside a policy ON
-- `head_to_head_participants`, and PostgreSQL evaluates the inner query under
-- the same policy. That is unbounded recursion, and it is not a theoretical
-- objection: the first draft of this migration was written that way, applied
-- to the local PostgreSQL 17.6 container, and `SELECT count(*)` as `anon`
-- answered
--
--     ERROR:  infinite recursion detected in policy for relation
--             "head_to_head_participants"
--
-- Worth recording, because that failure mode reads as a bug in the query
-- rather than in the policy.
--
-- Self-only is also the better rule regardless. The opponent's row carries
-- their result, and this feature's whole contract is that neither side sees
-- the other's until both have submitted -- an ordering only the API knows.
-- Handing PostgREST a policy that would expose the opponent's row the moment
-- it exists would put a spoiler leak one anon-key query away, so the direct
-- client path is closed and the server serves the opponent's side through
-- `_match_view`, which knows when it is safe.
DROP POLICY IF EXISTS head_to_head_participants_own_match_read ON head_to_head_participants;
DROP POLICY IF EXISTS head_to_head_participants_self_read ON head_to_head_participants;
CREATE POLICY head_to_head_participants_self_read ON head_to_head_participants
    FOR SELECT USING (participant_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- REVOKE -- the layer that actually stops a forged win.
--
-- WHY BOTH, and why the policies above are not enough. An owner-scoped or
-- participant-scoped `WITH CHECK` pins WHO a row belongs to; it does not pin
-- the PAYLOAD. 20260801140000_owned_results_revoke.sql spells this out for the
-- four result tables it closed, and the argument is sharper here than
-- anywhere: with an INSERT/UPDATE grant, a participant could write their own
-- `result` JSONB directly through PostgREST -- `table_cleared: true`,
-- `bosses_defeated: 5`, `active_play_seconds: 0` -- and every RLS policy in
-- this file would pass it, because it really is their row. The server
-- recomputes every one of those numbers from the run's own persisted state
-- through `build_receipt` precisely so they cannot be asserted by a client; a
-- direct write walks around that whole trust boundary.
--
-- The same applies to `settlement`, which is the match's verdict, and to
-- `fairness`, which is the pin the verdict is checked against.
--
-- SELECT is deliberately left granted. The participant-scoped policies above
-- already narrow it to matches the caller is in, and reading one's own
-- head-to-head history directly is a legitimate future client path. This
-- removes only the ability to WRITE.
--
-- Two layers on purpose, exactly as the telemetry migration argues
-- (20260801120000_telemetry_events.sql): a REVOKE fails loudly at the
-- privilege check, while a write that matches no policy silently affects zero
-- rows and reads to a client as success.
--
-- The API is unaffected: it connects as the table-owning role, which is not
-- subject to these grants (see 20260801100000_rls_gaps.sql).
--
-- Guarded by pg_tables for the same reason 20260801140000 is: a table that a
-- given environment has not created yet must not fail the chain.
--
-- TRUNCATE AND TRIGGER ARE REVOKED TOO, which is one step beyond the four
-- sibling tables 20260801140000 closed. Measured against the live local
-- database rather than assumed: after that migration ran,
-- `run_the_table_runs`, `daily_grid_results` and `telemetry_events` still
-- report `REFERENCES,SELECT,TRIGGER,TRUNCATE` for anon and authenticated,
-- because Supabase's own default privileges grant ALL on new public tables and
-- the sibling migration revoked only three of the write verbs. TRUNCATE is a
-- write that RLS does not filter at all -- no policy is consulted -- so a
-- grant of it on a settled-results table is a delete-everything primitive. It
-- is not reachable through PostgREST today, which is why the sibling tables
-- are a finding to report rather than an active breach, and why they are not
-- edited from here: they belong to a migration this pass has already shipped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'head_to_head_matches',
        'head_to_head_participants'
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

-- Down (never executed; recorded for review):
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ON public.head_to_head_matches,
--     public.head_to_head_participants TO anon, authenticated;
--   DROP TABLE IF EXISTS head_to_head_participants;
--   DROP TABLE IF EXISTS head_to_head_matches;
