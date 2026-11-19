-- ==============================================================================
-- Trainer Hub 008: Trainer-member communication                  STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- No messaging tables exist (VIRTEX Message stores chats in browser storage only;
-- member_communication_logs = outbound marketing campaigns, not conversations).
-- Adds:
--   * message_threads  one conversation per (trainer, member), archivable
--   * messages         read status (read_at), edits, soft delete (deleted_at)
--   * trigger keeping message_threads.last_message_at current
-- Rollback: 008_trainer_communication_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.trainers') IS NULL OR to_regclass('public.members') IS NULL
       OR to_regclass('public.users') IS NULL
       OR to_regprocedure('public.fn_update_timestamp()') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 008: required base objects are missing';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS message_threads (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    trainer_id       INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    member_id        INTEGER NOT NULL REFERENCES members(id)  ON DELETE CASCADE,
    status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    last_message_at  TIMESTAMPTZ,
    archived_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_thread_pair      UNIQUE (trainer_id, member_id),
    CONSTRAINT chk_thread_archived CHECK (status <> 'archived' OR archived_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_threads_trainer ON message_threads(trainer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_member  ON message_threads(member_id, last_message_at DESC);
CREATE OR REPLACE TRIGGER trg_threads_updated BEFORE UPDATE ON message_threads
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TABLE IF NOT EXISTS messages (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    thread_id       BIGINT  NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
    sender_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_role     VARCHAR(20) NOT NULL CHECK (sender_role IN ('trainer', 'member', 'staff', 'system')),
    body            TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
    read_at         TIMESTAMPTZ,
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(thread_id) WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION fn_message_touch_thread()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE message_threads SET last_message_at = NEW.created_at WHERE id = NEW.thread_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_message_touch_thread AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION fn_message_touch_thread();

COMMIT;
