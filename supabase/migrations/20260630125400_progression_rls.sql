-- Migration 010: RLS policies for Phase 3.1 progression tables
-- Applies to: Supabase / PostgreSQL
-- Depends on: 006_progression.sql, 007_records.sql, 008_achievements.sql, 009_streaks.sql

-- Enable RLS on all new tables
ALTER TABLE xp_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE progression_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_record_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- xp_policy_versions: public read (config is not sensitive)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS xp_policy_public_read ON xp_policy_versions;
CREATE POLICY xp_policy_public_read ON xp_policy_versions
    FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- progression_events: owner-readable only (XP history is private)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS progression_events_owner ON progression_events;
CREATE POLICY progression_events_owner ON progression_events
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- user_progress: owner-readable; level is exposed on public profiles via JOIN
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_progress_owner ON user_progress;
CREATE POLICY user_progress_owner ON user_progress
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- Authenticated users can also see progress for public profiles (level only)
-- Level exposure on public profiles is handled at the API layer, not here,
-- to avoid leaking XP total alongside level.

-- ---------------------------------------------------------------------------
-- personal_records: owner-readable by default
-- History is exposed for public profiles via API authorization layer
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS personal_records_owner ON personal_records;
CREATE POLICY personal_records_owner ON personal_records
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS personal_records_public ON personal_records;
CREATE POLICY personal_records_public ON personal_records
    FOR SELECT USING (
        owner_sub IN (
            SELECT auth_sub FROM profiles WHERE is_public = true
        )
    );

DROP POLICY IF EXISTS personal_record_events_owner ON personal_record_events;
CREATE POLICY personal_record_events_owner ON personal_record_events
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- achievement_definitions: always public (catalog)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS achievement_definitions_public ON achievement_definitions;
CREATE POLICY achievement_definitions_public ON achievement_definitions
    FOR SELECT USING (is_hidden = false);

-- Service role can read hidden achievements for evaluation
-- (service role bypasses RLS by default in Supabase)

-- ---------------------------------------------------------------------------
-- achievement_awards: owner-readable; public profiles expose non-hidden awards
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS achievement_awards_owner ON achievement_awards;
CREATE POLICY achievement_awards_owner ON achievement_awards
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS achievement_awards_public ON achievement_awards;
CREATE POLICY achievement_awards_public ON achievement_awards
    FOR SELECT USING (
        owner_sub IN (
            SELECT auth_sub FROM profiles WHERE is_public = true
        )
        AND achievement_key IN (
            SELECT achievement_key FROM achievement_definitions WHERE is_hidden = false
        )
    );

-- ---------------------------------------------------------------------------
-- streak_states: owner-readable; public profiles expose current/longest streak
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS streak_states_owner ON streak_states;
CREATE POLICY streak_states_owner ON streak_states
    FOR SELECT USING (owner_sub = auth.uid()::text);

DROP POLICY IF EXISTS streak_states_public ON streak_states;
CREATE POLICY streak_states_public ON streak_states
    FOR SELECT USING (
        owner_sub IN (
            SELECT auth_sub FROM profiles WHERE is_public = true
        )
    );

DROP POLICY IF EXISTS streak_events_owner ON streak_events;
CREATE POLICY streak_events_owner ON streak_events
    FOR SELECT USING (owner_sub = auth.uid()::text);
