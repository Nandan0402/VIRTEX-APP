-- 030_announcement_audience_category_trainer_votes.sql
-- 1. announcements.audience  — who sees it: 'all' (members + trainers), 'members' or 'trainers'.
--    (The admin form already asks for this; until now it was not stored.)
-- 2. announcements.category  — 'general', 'indoor_sport', 'outdoor_sport', 'event' or 'fitness'.
-- 3. Poll votes can come from trainers too: announcement_poll_votes gets trainer_id; each vote belongs to
--    exactly one member OR one trainer, and each person can vote once per choice.
-- Additive: existing announcements become audience 'all', category 'general'; existing member votes are kept.
-- Undo: 030_announcement_audience_category_trainer_votes_down.sql
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.announcement_poll_votes') IS NULL THEN
        RAISE EXCEPTION '030: apply migration 028 (announcement polls) first';
    END IF;
END $$;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS audience VARCHAR(10) NOT NULL DEFAULT 'all';
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'general';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_announcement_audience') THEN
        ALTER TABLE announcements ADD CONSTRAINT chk_announcement_audience CHECK (audience IN ('all', 'members', 'trainers'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_announcement_category') THEN
        ALTER TABLE announcements ADD CONSTRAINT chk_announcement_category CHECK (category IN ('general', 'indoor_sport', 'outdoor_sport', 'event', 'fitness'));
    END IF;
END $$;

-- Votes: member OR trainer
ALTER TABLE announcement_poll_votes ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id) ON DELETE CASCADE;
ALTER TABLE announcement_poll_votes ADD COLUMN IF NOT EXISTS id BIGINT GENERATED ALWAYS AS IDENTITY;
ALTER TABLE announcement_poll_votes DROP CONSTRAINT IF EXISTS announcement_poll_votes_pkey;
ALTER TABLE announcement_poll_votes ADD CONSTRAINT announcement_poll_votes_pkey PRIMARY KEY (id);
ALTER TABLE announcement_poll_votes ALTER COLUMN member_id DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_poll_vote_voter') THEN
        ALTER TABLE announcement_poll_votes ADD CONSTRAINT chk_poll_vote_voter CHECK ((member_id IS NULL) <> (trainer_id IS NULL));
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_poll_vote_member ON announcement_poll_votes (option_id, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_poll_vote_trainer ON announcement_poll_votes (option_id, trainer_id) WHERE trainer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poll_votes_announcement_trainer ON announcement_poll_votes (announcement_id, trainer_id) WHERE trainer_id IS NOT NULL;

COMMIT;
