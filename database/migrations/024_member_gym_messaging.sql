-- 024_member_gym_messaging.sql
-- Lets a member hold a 1-to-1 conversation with the gym team (owner/managers), in addition to their
-- assigned trainer, using the EXISTING message_threads / messages tables (Trainer Hub migration 008).
-- Additive only: no data is changed. Existing threads keep thread_type = 'trainer'.
-- Undo: 024_member_gym_messaging_down.sql
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.message_threads') IS NULL OR to_regclass('public.messages') IS NULL THEN
        RAISE EXCEPTION '024: apply Trainer Hub migration 008 (message_threads, messages) first';
    END IF;
END $$;

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS thread_type VARCHAR(20) NOT NULL DEFAULT 'trainer';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_thread_type') THEN
        ALTER TABLE message_threads ADD CONSTRAINT chk_thread_type CHECK (thread_type IN ('trainer', 'gym'));
    END IF;
END $$;

-- Gym-team threads have no trainer.
ALTER TABLE message_threads ALTER COLUMN trainer_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_thread_party') THEN
        ALTER TABLE message_threads ADD CONSTRAINT chk_thread_party CHECK (
            (thread_type = 'trainer' AND trainer_id IS NOT NULL) OR (thread_type = 'gym' AND trainer_id IS NULL));
    END IF;
END $$;

-- One gym-team conversation per member (trainer pairs stay unique via uq_thread_pair).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gym_thread_member ON message_threads (member_id) WHERE thread_type = 'gym';
CREATE INDEX IF NOT EXISTS idx_threads_gym_recent ON message_threads (last_message_at DESC) WHERE thread_type = 'gym';

COMMIT;
