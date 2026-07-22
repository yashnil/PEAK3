-- Migration 013: Ranked settlement
-- rating_periods, ranked_match_settlements
--
-- Rating-period strategy v1 (ADR-004 §7): exactly one rating period per settled
-- match. rating_periods.match_id is UNIQUE to make that strategy a real constraint,
-- not just a convention — a future batched-period algorithm version would use a
-- different table shape rather than relaxing this one.

CREATE TABLE IF NOT EXISTS rating_periods (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mode                TEXT NOT NULL,
    queue_version       TEXT NOT NULL,
    match_id            UUID NOT NULL UNIQUE REFERENCES ranked_matches (id) ON DELETE CASCADE,
    algorithm_version   TEXT NOT NULL,
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ
);

-- ALTER TABLE ... ADD CONSTRAINT has no IF NOT EXISTS form in PostgreSQL;
-- guard it explicitly so this migration is rerun-safe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ranked_matches_rating_period_fk'
    ) THEN
        ALTER TABLE ranked_matches
            ADD CONSTRAINT ranked_matches_rating_period_fk
            FOREIGN KEY (rating_period_id) REFERENCES rating_periods (id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ranked_match_settlements: one immutable settlement per match
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_match_settlements (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id                            UUID NOT NULL UNIQUE REFERENCES ranked_matches (id) ON DELETE CASCADE,
    rating_period_id                    UUID NOT NULL REFERENCES rating_periods (id),
    settlement_algorithm_version        TEXT NOT NULL,
    board_version_key                   TEXT NOT NULL,
    primary_comparison                  TEXT NOT NULL DEFAULT 'lineup_peak_rating',
    participant_a_sub                   TEXT NOT NULL,
    participant_b_sub                   TEXT NOT NULL,
    participant_a_score                 NUMERIC(8, 4) NOT NULL,
    participant_b_score                 NUMERIC(8, 4) NOT NULL,
    participant_a_draft_efficiency      NUMERIC(6, 4),
    participant_b_draft_efficiency      NUMERIC(6, 4),
    participant_a_solver_version        TEXT NOT NULL,
    participant_b_solver_version        TEXT NOT NULL,
    tie_break_used                      TEXT CHECK (tie_break_used IN (
                                            'draft_efficiency', 'forced_placements', 'none'
                                         )),
    outcome                             TEXT NOT NULL CHECK (outcome IN ('a_win', 'b_win', 'draw')),
    integrity_decision                  TEXT NOT NULL DEFAULT 'clear' CHECK (integrity_decision IN (
                                            'clear', 'flagged', 'reviewed', 'invalidated'
                                         )),
    audit_metadata                      JSONB NOT NULL DEFAULT '{}',
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT ranked_match_settlements_distinct_participants
        CHECK (participant_a_sub <> participant_b_sub)
);

-- Settlement cannot reference a mismatched board: the settlement's stored
-- board_version_key must equal the match's, and no submission for the match
-- may carry a different board_version_key.
CREATE OR REPLACE FUNCTION ranked_enforce_settlement_board_match() RETURNS TRIGGER AS $$
DECLARE
    match_board_key   TEXT;
    mismatch_count    INTEGER;
BEGIN
    SELECT board_version_key INTO match_board_key
    FROM ranked_matches WHERE id = NEW.match_id;

    IF NEW.board_version_key IS DISTINCT FROM match_board_key THEN
        RAISE EXCEPTION
            'ranked_match_settlements.board_version_key (%) does not match ranked_matches.board_version_key (%) for match %',
            NEW.board_version_key, match_board_key, NEW.match_id;
    END IF;

    SELECT count(*) INTO mismatch_count
    FROM ranked_match_submissions
    WHERE match_id = NEW.match_id AND board_version_key IS DISTINCT FROM match_board_key;

    IF mismatch_count > 0 THEN
        RAISE EXCEPTION
            'ranked_match_submissions contains a board_version_key mismatch for match %',
            NEW.match_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ranked_match_settlements_board_match_check ON ranked_match_settlements;
CREATE TRIGGER ranked_match_settlements_board_match_check
    BEFORE INSERT ON ranked_match_settlements
    FOR EACH ROW EXECUTE FUNCTION ranked_enforce_settlement_board_match();

-- Settlement rows are immutable once written (no UPDATE/DELETE at any layer).
-- Invalidating a settled match happens by (a) transitioning ranked_matches.status
-- to 'invalidated' via service role, (b) appending a reversal rating_ledger_entries
-- row (migration 014), and (c) recording a ranked_integrity_events row
-- (migration 015) — never by mutating this row.
CREATE OR REPLACE FUNCTION ranked_settlements_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ranked_match_settlements is append-only; % is not permitted (id=%)', TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ranked_match_settlements_no_update ON ranked_match_settlements;
CREATE TRIGGER ranked_match_settlements_no_update
    BEFORE UPDATE ON ranked_match_settlements
    FOR EACH ROW EXECUTE FUNCTION ranked_settlements_immutable();

DROP TRIGGER IF EXISTS ranked_match_settlements_no_delete ON ranked_match_settlements;
CREATE TRIGGER ranked_match_settlements_no_delete
    BEFORE DELETE ON ranked_match_settlements
    FOR EACH ROW EXECUTE FUNCTION ranked_settlements_immutable();

-- Down:
-- DROP TRIGGER IF EXISTS ranked_match_settlements_no_delete ON ranked_match_settlements;
-- DROP TRIGGER IF EXISTS ranked_match_settlements_no_update ON ranked_match_settlements;
-- DROP FUNCTION IF EXISTS ranked_settlements_immutable();
-- DROP TRIGGER IF EXISTS ranked_match_settlements_board_match_check ON ranked_match_settlements;
-- DROP FUNCTION IF EXISTS ranked_enforce_settlement_board_match();
-- DROP TABLE IF EXISTS ranked_match_settlements;
-- ALTER TABLE ranked_matches DROP CONSTRAINT IF EXISTS ranked_matches_rating_period_fk;
-- DROP TABLE IF EXISTS rating_periods;
