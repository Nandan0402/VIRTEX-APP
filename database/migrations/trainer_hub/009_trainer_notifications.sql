-- ==============================================================================
-- Trainer Hub 009: Notifications                                 STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- No per-user notification table exists (announcements are gym-wide notices).
-- Adds:
--   * notifications  per-user inbox, read status (read_at), archival (archived_at)
-- Rollback: 009_trainer_notifications_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 009: users table is missing';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS notifications (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    recipient_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type               VARCHAR(30) NOT NULL
                       CHECK (type IN ('session_booked', 'session_cancelled', 'session_reminder', 'session_completed',
                                       'assignment_created', 'assignment_updated', 'package_low_balance',
                                       'package_expiring', 'new_message', 'workout_assigned', 'diet_assigned',
                                       'feedback', 'system')),
    title              VARCHAR(160) NOT NULL,
    body               TEXT,
    link_url           VARCHAR(255),
    entity_type        VARCHAR(40),
    entity_id          BIGINT,
    read_at            TIMESTAMPTZ,
    archived_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread    ON notifications(recipient_user_id)
    WHERE read_at IS NULL AND archived_at IS NULL;

COMMIT;
