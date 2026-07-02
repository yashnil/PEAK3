-- Migration 015: Ranked integrity
-- ranked_integrity_events, ranked_abort_allowances

CREATE TABLE IF NOT EXISTS ranked_integrity_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID REFERENCES ranked_matches (id) ON DELETE SET NULL,
    owner_sub       TEXT,
    event_type      TEXT NOT NULL,   -- e.g. 'repeated_abort', 'suspicious_timing', 'manual_review'
    severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'severe')),
    details         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    resolution      TEXT
);

CREATE INDEX IF NOT EXISTS ranked_integrity_events_owner_idx
    ON ranked_integrity_events (owner_sub);
CREATE INDEX IF NOT EXISTS ranked_integrity_events_unresolved_idx
    ON ranked_integrity_events (owner_sub) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- ranked_abort_allowances: server-verified protected-abort credits.
-- granted_by is always 'service' in this schema — there is no client-writable
-- path to this table; client claims alone never create a row here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ranked_abort_allowances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub       TEXT NOT NULL,
    mode            TEXT,   -- NULL = applies across all queues
    match_id        UUID REFERENCES ranked_matches (id) ON DELETE SET NULL,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by      TEXT NOT NULL DEFAULT 'service' CHECK (granted_by = 'service'),
    reason          TEXT NOT NULL,
    consumed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ranked_abort_allowances_owner_idx
    ON ranked_abort_allowances (owner_sub);

-- Down:
-- DROP TABLE IF EXISTS ranked_abort_allowances;
-- DROP TABLE IF EXISTS ranked_integrity_events;
