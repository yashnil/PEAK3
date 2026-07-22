-- Migration 005: Row Level Security policies
-- Requires Supabase Auth JWT to be available in the request context.
-- auth.uid() returns the authenticated user's UUID (cast to text for TEXT columns).

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE result_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenge_settlements ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_public_read ON profiles;
CREATE POLICY profiles_public_read ON profiles
    FOR SELECT USING (is_public = true);

DROP POLICY IF EXISTS profiles_owner_all ON profiles;
CREATE POLICY profiles_owner_all ON profiles
    FOR ALL USING (auth_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- user_settings — owner only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_settings_owner ON user_settings;
CREATE POLICY user_settings_owner ON user_settings
    FOR ALL USING (
        profile_id IN (
            SELECT id FROM profiles WHERE auth_sub = auth.uid()::text
        )
    );

-- ---------------------------------------------------------------------------
-- board_snapshots — board metadata is public, seed is server-only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS board_snapshots_public_meta ON board_snapshots;
CREATE POLICY board_snapshots_public_meta ON board_snapshots
    FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- games — owner only; server writes via service role bypass RLS
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS games_owner ON games;
CREATE POLICY games_owner ON games
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- game_actions are internal, no direct client access
DROP POLICY IF EXISTS game_actions_deny_all ON game_actions;
CREATE POLICY game_actions_deny_all ON game_actions
    FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- result_snapshots — owner can read their own; public if sharing rules allow
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS result_snapshots_owner ON result_snapshots;
CREATE POLICY result_snapshots_owner ON result_snapshots
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- daily_completions — owner only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS daily_completions_owner ON daily_completions;
CREATE POLICY daily_completions_owner ON daily_completions
    FOR SELECT USING (owner_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- challenges — spoiler-safe metadata is public; challenger can read full record
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS challenges_public_meta ON challenges;
CREATE POLICY challenges_public_meta ON challenges
    FOR SELECT USING (true);

-- challenge_participants — owner and service role only
DROP POLICY IF EXISTS challenge_participants_owner ON challenge_participants;
CREATE POLICY challenge_participants_owner ON challenge_participants
    FOR SELECT USING (participant_sub = auth.uid()::text);

-- challenge_settlements — each party can see their own settlement
DROP POLICY IF EXISTS challenge_settlements_owner ON challenge_settlements;
CREATE POLICY challenge_settlements_owner ON challenge_settlements
    FOR SELECT USING (recipient_sub = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- anonymous_subjects — no direct client access (server role only)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS anonymous_subjects_deny ON anonymous_subjects;
CREATE POLICY anonymous_subjects_deny ON anonymous_subjects
    FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- ownership_claims — owner can read their own claim record
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS ownership_claims_owner ON ownership_claims;
CREATE POLICY ownership_claims_owner ON ownership_claims
    FOR SELECT USING (real_user_sub = auth.uid()::text);
