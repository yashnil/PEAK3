-- Migration 008: Achievement definitions and awards
-- Applies to: Supabase / PostgreSQL
-- Depends on: 001_identity.sql

-- ---------------------------------------------------------------------------
-- achievement_definitions: static catalog
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_definitions (
    achievement_key     TEXT PRIMARY KEY,
    version             INTEGER NOT NULL DEFAULT 1,
    category            TEXT NOT NULL CHECK (category IN ('onboarding','challenge','construction','habit')),
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    requirement_copy    TEXT NOT NULL,          -- plain-language rule for UI
    evaluator_id        TEXT NOT NULL,          -- maps to a server-side evaluator function
    is_hidden           BOOLEAN NOT NULL DEFAULT false,  -- hidden until earned
    is_repeatable       BOOLEAN NOT NULL DEFAULT false,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- achievement_awards: one row per user per achievement (unless repeatable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS achievement_awards (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub           TEXT NOT NULL,
    achievement_key     TEXT NOT NULL REFERENCES achievement_definitions(achievement_key),
    source_type         TEXT NOT NULL,          -- event type or 'retroactive'
    source_id           TEXT NOT NULL,
    awarded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    original_owner_sub  TEXT,                   -- set during claim migration

    -- Non-repeatable achievements can only be awarded once per owner
    CONSTRAINT achievement_awards_unique
        UNIQUE (owner_sub, achievement_key)
);

CREATE INDEX IF NOT EXISTS achievement_awards_owner_idx
    ON achievement_awards (owner_sub, awarded_at DESC);

-- ---------------------------------------------------------------------------
-- Seed achievement catalog
-- ---------------------------------------------------------------------------
INSERT INTO achievement_definitions
    (achievement_key, category, title, description, requirement_copy, evaluator_id, is_hidden, sort_order)
VALUES
    -- Onboarding
    ('first_game',          'onboarding', 'First Peak',
     'Completed your first valid game.',
     'Complete any valid game.',
     'first_game_evaluator', false, 10),

    ('apex_explorer',       'onboarding', 'Apex Explorer',
     'Completed a 1-Year Apex game.',
     'Complete a valid 1Y Apex game.',
     'mode_completion_evaluator', false, 20),

    ('prime_explorer',      'onboarding', 'Prime Explorer',
     'Completed a 3-Year Prime game.',
     'Complete a valid 3Y Prime game.',
     'mode_completion_evaluator', false, 30),

    ('foundation_explorer', 'onboarding', 'Foundation Explorer',
     'Completed a 5-Year Foundation game.',
     'Complete a valid 5Y Foundation game.',
     'mode_completion_evaluator', false, 40),

    ('full_spectrum',       'onboarding', 'Full Spectrum',
     'Completed valid games in all three window modes.',
     'Complete at least one valid game in 1Y Apex, 3Y Prime, and 5Y Foundation.',
     'full_spectrum_evaluator', false, 50),

    ('read_the_receipt',    'onboarding', 'Read the Receipt',
     'Explored a full Peak Receipt after completing a game.',
     'View the detailed breakdown after completing a game.',
     'receipt_exploration_evaluator', false, 60),

    -- Challenge
    ('challenger',          'challenge', 'Challenger',
     'Created a valid challenge link.',
     'Create a challenge from a completed game.',
     'challenge_created_evaluator', false, 110),

    ('answered_the_call',   'challenge', 'Answered the Call',
     'Completed a challenge received from someone else.',
     'Complete a challenge you received.',
     'challenge_completed_evaluator', false, 120),

    ('photo_finish',        'challenge', 'Photo Finish',
     'Settled a challenge within 1 point of the opponent.',
     'Complete a challenge settled within 1.0 lineup rating point.',
     'photo_finish_evaluator', false, 130),

    -- Construction
    ('board_maximizer',     'construction', 'Board Maximizer',
     'Achieved 85% or higher Draft Efficiency.',
     'Reach 85% Draft Efficiency in any completed game.',
     'draft_efficiency_evaluator', false, 210),

    ('balanced_five',       'construction', 'Balanced Five',
     'Built a lineup with no single dominant role — all components contributing.',
     'Complete a game with a lineup score above 75 and all five roles filled.',
     'balanced_lineup_evaluator', false, 220),

    ('role_complete',       'construction', 'Role Complete',
     'Filled all five roster roles in a single draft.',
     'Complete a game with all five distinct roles assigned.',
     'role_complete_evaluator', false, 230),

    -- Habit
    ('three_day_rhythm',    'habit', 'Three-Day Rhythm',
     'Maintained a 3-day Daily streak.',
     'Complete Daily boards on 3 consecutive local days.',
     'streak_length_evaluator', false, 310),

    ('seven_day_rhythm',    'habit', 'Seven-Day Rhythm',
     'Maintained a 7-day Daily streak.',
     'Complete Daily boards on 7 consecutive local days.',
     'streak_length_evaluator', false, 320),

    ('first_personal_best', 'construction', 'Personal Best',
     'Set your first personal record.',
     'Achieve a personal record in any mode.',
     'first_record_evaluator', false, 200)

ON CONFLICT (achievement_key) DO NOTHING;
