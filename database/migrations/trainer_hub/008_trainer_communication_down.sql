-- Trainer Hub 008 DOWN: removes only what 008 added.
-- WARNING: deletes all message threads and messages.
BEGIN;
DROP TABLE IF EXISTS messages;          -- also drops trg_message_touch_thread
DROP FUNCTION IF EXISTS fn_message_touch_thread();
DROP TABLE IF EXISTS message_threads;
COMMIT;
