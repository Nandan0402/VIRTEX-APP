-- 030_announcement_audience_category_trainer_votes_down.sql — undo 030.
-- WARNING: trainers' poll votes are deleted, and announcement audience / category values are lost.
BEGIN;
DELETE FROM announcement_poll_votes WHERE trainer_id IS NOT NULL;
DROP INDEX IF EXISTS idx_poll_votes_announcement_trainer;
DROP INDEX IF EXISTS uq_poll_vote_trainer;
DROP INDEX IF EXISTS uq_poll_vote_member;
ALTER TABLE announcement_poll_votes DROP CONSTRAINT IF EXISTS chk_poll_vote_voter;
ALTER TABLE announcement_poll_votes ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE announcement_poll_votes DROP CONSTRAINT IF EXISTS announcement_poll_votes_pkey;
ALTER TABLE announcement_poll_votes ADD CONSTRAINT announcement_poll_votes_pkey PRIMARY KEY (option_id, member_id);
ALTER TABLE announcement_poll_votes DROP COLUMN IF EXISTS id;
ALTER TABLE announcement_poll_votes DROP COLUMN IF EXISTS trainer_id;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS chk_announcement_category;
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS chk_announcement_audience;
ALTER TABLE announcements DROP COLUMN IF EXISTS category;
ALTER TABLE announcements DROP COLUMN IF EXISTS audience;
COMMIT;
