-- 025_member_group_messaging.sql
-- Group conversations created ONLY by the gym team (owner/managers). Members added to a group can read and
-- post in it; they cannot create groups or add/remove people. Reuses message_threads / messages
-- (Trainer Hub 008 + migration 024) with thread_type = 'group', plus one participants table.
-- Additive only: no existing rows are changed. Undo: 025_member_group_messaging_down.sql
BEGIN;

DO $$
BEGIN
    IF to_regclass('public.message_threads') IS NULL OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'message_threads' AND column_name = 'thread_type') THEN
        RAISE EXCEPTION '025: apply Trainer Hub migration 008 and migration 024 first';
    END IF;
END $$;

ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS title              VARCHAR(80);
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS description        VARCHAR(300);
ALTER TABLE message_threads ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Group threads have no single member.
ALTER TABLE message_threads ALTER COLUMN member_id DROP NOT NULL;

ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_type;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_type CHECK (thread_type IN ('trainer', 'gym', 'group'));

ALTER TABLE message_threads DROP CONSTRAINT IF EXISTS chk_thread_party;
ALTER TABLE message_threads ADD CONSTRAINT chk_thread_party CHECK (
       (thread_type = 'trainer' AND trainer_id IS NOT NULL AND member_id IS NOT NULL)
    OR (thread_type = 'gym'     AND trainer_id IS NULL     AND member_id IS NOT NULL)
    OR (thread_type = 'group'   AND trainer_id IS NULL     AND member_id IS NULL AND title IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_threads_group_recent ON message_threads (last_message_at DESC) WHERE thread_type = 'group';

-- Who is in each group. Removing someone keeps the row (removed_at) so history stays auditable.
CREATE TABLE IF NOT EXISTS message_thread_members (
    thread_id         BIGINT  NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    member_id         INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    added_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    added_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    removed_at        TIMESTAMPTZ,
    last_read_at      TIMESTAMPTZ,
    PRIMARY KEY (thread_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_members_member ON message_thread_members (member_id) WHERE removed_at IS NULL;

COMMIT;
