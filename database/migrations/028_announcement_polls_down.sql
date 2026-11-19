-- 028_announcement_polls_down.sql — undo 028.
-- WARNING: all poll choices and members' votes are deleted. The announcements themselves stay.
BEGIN;
DROP TABLE IF EXISTS announcement_poll_votes;
DROP TABLE IF EXISTS announcement_poll_options;
ALTER TABLE announcements DROP COLUMN IF EXISTS poll_multiple;
COMMIT;
