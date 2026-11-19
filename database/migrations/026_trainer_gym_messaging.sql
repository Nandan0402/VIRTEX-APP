-- 026_trainer_gym_messaging.sql
-- Lets each trainer hold a 1-to-1 conversation with the gym team (owner/managers), using the EXISTING
-- message_threads / messages tables with thread_type = 'trainer_gym' (trainer set, no member).
-- Additive only: no existing rows are changed. Undo: 026_trainer_gym_messaging_down.sql
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.message_thread_members') IS NULL THEN
        RAISE EXCEPTION '026: apply migrations 008, 024 and 025 first';
    END IF;
END $$;

ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_type;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_type CHECK (thread_type IN ('trainer', 'gym', 'group', 'trainer_gym'));

ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_party;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_party CHECK (
       (thread_type = 'trainer'     AND trainer_id IS NOT NULL AND member_id IS NOT NULL)
    OR (thread_type = 'gym'         AND trainer_id IS NULL     AND member_id IS NOT NULL)
    OR (thread_type = 'group'       AND trainer_id IS NULL     AND member_id IS NULL AND title IS NOT NULL)
    OR (thread_type = 'trainer_gym' AND trainer_id IS NOT NULL AND member_id IS NULL));

-- One gym-team conversation per trainer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_gym_thread ON message_threads (trainer_id) WHERE thread_type = 'trainer_gym';
CREATE INDEX IF NOT EXISTS idx_threads_trainer_gym_recent ON message_threads (last_message_at DESC) WHERE thread_type = 'trainer_gym';

COMMIT;
