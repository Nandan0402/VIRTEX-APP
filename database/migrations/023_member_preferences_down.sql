-- Down for migration 023. Review before running: removes saved member preferences
-- (members fall back to the defaults: all notifications on, name shown on leaderboards).
BEGIN;
DROP TABLE IF EXISTS member_preferences;
COMMIT;
