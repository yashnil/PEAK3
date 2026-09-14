-- Migration: contact_feedback_categories
--
-- LOCAL MIGRATION ONLY -- same discipline as
-- 20260803110000_contact_submissions.sql, which this extends.
--
-- WHY. The homepage feedback section asks early users for six kinds of note:
-- a game idea, something they disliked, a bug, a weakness, general feedback,
-- or a question. Only `bug` had an honest stored category; filing the other
-- five under `new_mode`/`other` would make the stored category a guess about
-- what the sender meant. This adds a stored value for each missing kind.
--
-- ADDITIVE ONLY. Every existing category value is kept, so every row already
-- stored still satisfies the new constraint and the /contact page's existing
-- dropdown keeps working unchanged. RLS, grants and every other column's
-- constraint are untouched -- the table stays write-only through
-- POST /api/v1/contact, with no client read path.
--
-- THE CONSTRAINT NAME. The original CHECK was declared inline on the column,
-- so Postgres named it `<table>_<column>_check` deterministically:
-- `contact_submissions_category_check`. It is replaced under that same name
-- so the chain keeps exactly one category constraint.
--
-- Authoritative list: apps/api/app/models/contact.py (ContactCategory /
-- CONTACT_CATEGORIES); apps/api/tests/test_contact.py checks this file names
-- every value in that tuple.

ALTER TABLE contact_submissions
    DROP CONSTRAINT IF EXISTS contact_submissions_category_check;

ALTER TABLE contact_submissions
    ADD CONSTRAINT contact_submissions_category_check CHECK (category IN (
        'new_mode', 'improve_mode', 'bug',
        'question_ranking_or_data', 'accessibility',
        'account_or_privacy', 'partnership_or_press', 'other',
        'game_idea', 'dislike', 'weakness', 'general_feedback', 'question'
    ));

-- Down (never executed; recorded for review -- only valid once no row uses a
-- value added here):
--   ALTER TABLE contact_submissions DROP CONSTRAINT IF EXISTS contact_submissions_category_check;
--   ALTER TABLE contact_submissions ADD CONSTRAINT contact_submissions_category_check CHECK (category IN (
--       'new_mode', 'improve_mode', 'bug', 'question_ranking_or_data', 'accessibility',
--       'account_or_privacy', 'partnership_or_press', 'other'));
