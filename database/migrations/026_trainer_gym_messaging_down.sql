-- 026_trainer_gym_messaging_down.sql — undo 026.
-- WARNING: trainer ↔ gym team conversations (thread_type = 'trainer_gym') and their messages are deleted.
BEGIN;
DROP INDEX IF EXISTS idx_threads_trainer_gym_recent;
DROP INDEX IF EXISTS uq_trainer_gym_thread;
DELETE FROM message_threads WHERE thread_type = 'trainer_gym';
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_party;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_party CHECK (
       (thread_type = 'trainer' AND trainer_id IS NOT NULL AND member_id IS NOT NULL)
    OR (thread_type = 'gym'     AND trainer_id IS NULL     AND member_id IS NOT NULL)
    OR (thread_type = 'group'   AND trainer_id IS NULL     AND member_id IS NULL AND title IS NOT NULL));
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_type;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_type CHECK (thread_type IN ('trainer', 'gym', 'group'));
COMMIT;
