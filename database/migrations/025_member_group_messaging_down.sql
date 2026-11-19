-- 025_member_group_messaging_down.sql — undo 025.
-- WARNING: group conversations (thread_type = 'group'), their messages and participants are deleted by this
-- script, because member_id becomes NOT NULL again. Export them first if they must be kept.
BEGIN;
DROP TABLE IF EXISTS message_thread_members;
DROP INDEX IF EXISTS idx_threads_group_recent;
DELETE FROM message_threads WHERE thread_type = 'group';
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_party;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_party CHECK (
    (thread_type = 'trainer' AND trainer_id IS NOT NULL) OR (thread_type = 'gym' AND trainer_id IS NULL));
ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_type;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_type CHECK (thread_type IN ('trainer', 'gym'));
ALTER TABLE message_threads ALTER COLUMN member_id SET NOT NULL;
ALTER TABLE message_threads DROP COLUMN IF EXISTS created_by_user_id;
ALTER TABLE message_threads DROP COLUMN IF EXISTS description;
ALTER TABLE message_threads DROP COLUMN IF EXISTS title;
COMMIT;
