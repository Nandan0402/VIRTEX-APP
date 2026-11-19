-- Trainer Hub 009 DOWN: removes only what 009 added.
-- WARNING: deletes all notifications.
BEGIN;
DROP TABLE IF EXISTS notifications;
COMMIT;
