-- 024_member_gym_messaging_down.sql — undo 024.
-- WARNING: gym-team conversations (thread_type = 'gym') and their messages are deleted by this script,
-- because trainer_id becomes NOT NULL again. Export them first if they must be kept.
BEGIN;
DROP INDEX IF EXISTS idx_threads_gym_recent;
DROP INDEX IF EXISTS uq_gym_thread_member;
DELETE FROM message_threads WHERE thread_type = 'gym';
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_party;
ALTER TABLE message_threads ALTER COLUMN trainer_id SET NOT NULL;
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_type;
ALTER TABLE message_threads DROP COLUMN IF EXISTS thread_type;
COMMIT;
