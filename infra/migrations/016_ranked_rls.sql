-- Migration 016: Row Level Security policies for ranked tables (ADR-004 §14)
--
-- Summary (mirrors infra/migrations/005_rls.sql's table):
--
-- | Table                        | Public reads        | Owner/participant reads         | Server writes |
-- |-------------------------------|---------------------|----------------------------------|---------------|
-- | ranked_queue_versions         | Yes (metadata)       | —                                | Yes |
-- | rating_algorithm_versions     | Yes (metadata)       | —                                | Yes |
-- | division_versions             | Yes (metadata)       | —                                | Yes |
-- | ranked_queue_entries          | No                   | Own entries only                 | Yes |
-- | ranked_matches                | No                   | Participants only (both sides)   | Yes |
-- | ranked_match_participants     | No                   | Own row always; opponent row only after settlement | Yes |
-- | ranked_match_submissions      | No                   | Own row always; opponent row only after settlement | Yes |
-- | ranked_opponent_history       | No                   | Service role only                | Yes |
-- | rating_periods                | No                   | Service role only                | Yes |
-- | ranked_match_settlements      | No                   | Either participant, post-settlement | Yes |
-- | rating_ledger_entries         | No                   | Own entries only                 | Yes (append-only) |
-- | rating_snapshots              | No                   | Own snapshots only               | Yes |
-- | queue_ratings                 | No (leaderboard reads go through service-role + app-level flag) | Own rating only | Yes |
-- | placement_states              | No                   | Own placement state only         | Yes |
-- | ranked_integrity_events       | No                   | Service role only                | Yes |
-- | ranked_abort_allowances       | No                   | Service role only                | Yes |
--
-- Service-role operations (matchmaking, settlement, rating writes) bypass RLS
-- using the Supabase service key, which is never exposed to clients (ADR-002 §8).

ALTER TABLE ranked_queue_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_algorithm_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE division_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_match_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_match_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_opponent_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_match_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE placement_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_integrity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_abort_allowances ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Configuration — public metadata
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_queue_versions_public_read ON ranked_queue_versions;
CREATE POLICY ranked_queue_versions_public_read ON ranked_queue_versions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS rating_algorithm_versions_public_read ON rating_algorithm_versions;
CREATE POLICY rating_algorithm_versions_public_read ON rating_algorithm_versions
    FOR SELECT USING (true);

DROP POLICY IF EXISTS division_versions_public_read ON division_versions;
CREATE POLICY division_versions_public_read ON division_versions
    FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- ranked_queue_entries — owner only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_queue_entries_owner ON ranked_queue_entries;
CREATE POLICY ranked_queue_entries_owner ON ranked_queue_entries
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- ranked_matches — either participant may read (both need the shared board)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_matches_participant ON ranked_matches;
CREATE POLICY ranked_matches_participant ON ranked_matches
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ranked_match_participants p
            WHERE p.match_id = ranked_matches.id AND p.owner_sub = auth.uid()::text
        )
    );

-- ---------------------------------------------------------------------------
-- ranked_match_participants — own row always; opponent row only once settled
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_match_participants_own ON ranked_match_participants;
CREATE POLICY ranked_match_participants_own ON ranked_match_participants
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS ranked_match_participants_opponent_post_settlement ON ranked_match_participants;
CREATE POLICY ranked_match_participants_opponent_post_settlement ON ranked_match_participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ranked_matches m
            WHERE m.id = ranked_match_participants.match_id
              AND m.status = 'settled'
              AND EXISTS (
                  SELECT 1 FROM ranked_match_participants p2
                  WHERE p2.match_id = m.id AND p2.owner_sub = auth.uid()::text
              )
        )
    );

-- ---------------------------------------------------------------------------
-- ranked_match_submissions — own row always; opponent row only once settled
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_match_submissions_own ON ranked_match_submissions;
CREATE POLICY ranked_match_submissions_own ON ranked_match_submissions
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS ranked_match_submissions_opponent_post_settlement ON ranked_match_submissions;
CREATE POLICY ranked_match_submissions_opponent_post_settlement ON ranked_match_submissions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM ranked_matches m
            WHERE m.id = ranked_match_submissions.match_id
              AND m.status = 'settled'
              AND EXISTS (
                  SELECT 1 FROM ranked_match_participants p2
                  WHERE p2.match_id = m.id AND p2.owner_sub = auth.uid()::text
              )
        )
    );

-- ---------------------------------------------------------------------------
-- Server-only internals — no direct client access at all
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_opponent_history_deny ON ranked_opponent_history;
CREATE POLICY ranked_opponent_history_deny ON ranked_opponent_history
    FOR ALL USING (false);

DROP POLICY IF EXISTS rating_periods_deny ON rating_periods;
CREATE POLICY rating_periods_deny ON rating_periods
    FOR ALL USING (false);

DROP POLICY IF EXISTS ranked_integrity_events_deny ON ranked_integrity_events;
CREATE POLICY ranked_integrity_events_deny ON ranked_integrity_events
    FOR ALL USING (false);

DROP POLICY IF EXISTS ranked_abort_allowances_deny ON ranked_abort_allowances;
CREATE POLICY ranked_abort_allowances_deny ON ranked_abort_allowances
    FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- ranked_match_settlements — either participant, once it exists (only exists
-- once settled, by construction)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ranked_match_settlements_participant ON ranked_match_settlements;
CREATE POLICY ranked_match_settlements_participant ON ranked_match_settlements
    FOR SELECT USING (
        participant_a_sub = auth.uid()::text OR participant_b_sub = auth.uid()::text
    );

-- ---------------------------------------------------------------------------
-- Rating ledger and derived state — owner only. No opponent read, no public
-- read (public leaderboards are served by the API via a service-role query
-- gated on RANKED_PUBLIC_LEADERBOARD_ENABLED, not via direct table RLS).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rating_ledger_entries_owner ON rating_ledger_entries;
CREATE POLICY rating_ledger_entries_owner ON rating_ledger_entries
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS rating_snapshots_owner ON rating_snapshots;
CREATE POLICY rating_snapshots_owner ON rating_snapshots
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS queue_ratings_owner ON queue_ratings;
CREATE POLICY queue_ratings_owner ON queue_ratings
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS placement_states_owner ON placement_states;
CREATE POLICY placement_states_owner ON placement_states
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- Down:
-- (RLS policies are dropped automatically when their tables are dropped in
-- migrations 011-015's down blocks; no separate down block needed here.)
