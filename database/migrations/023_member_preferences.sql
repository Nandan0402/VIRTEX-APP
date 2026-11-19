-- Migration 023: Member preferences (ADDITIVE — new table only; nothing existing is changed)
--
-- Why: members need to choose which notifications they see and whether their name appears on
-- event leaderboards. No table stores member preferences today.
--
-- One row per member, created only when the member saves Settings. No row = defaults
-- (every notification on, name shown on leaderboards) — exactly how the portal behaves today.
-- Safe to re-run (IF NOT EXISTS). No rows are inserted.

BEGIN;

CREATE TABLE IF NOT EXISTS member_preferences (
    member_id               INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    notify_workout          BOOLEAN NOT NULL DEFAULT TRUE,   -- new workout programmes
    notify_diet             BOOLEAN NOT NULL DEFAULT TRUE,   -- diet plan assigned / updated
    notify_pt               BOOLEAN NOT NULL DEFAULT TRUE,   -- PT session reminders
    notify_classes          BOOLEAN NOT NULL DEFAULT TRUE,   -- class reminders & cancellations
    notify_membership       BOOLEAN NOT NULL DEFAULT TRUE,   -- membership expiry
    notify_payments         BOOLEAN NOT NULL DEFAULT TRUE,   -- payments due / received
    notify_feedback         BOOLEAN NOT NULL DEFAULT TRUE,   -- trainer feedback
    notify_messages         BOOLEAN NOT NULL DEFAULT TRUE,   -- new message alerts
    leaderboard_visibility  VARCHAR(12) NOT NULL DEFAULT 'name'
                            CHECK (leaderboard_visibility IN ('name', 'anonymous')),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE member_preferences IS 'Member-chosen portal preferences (notifications shown, leaderboard name). Membership, status and roles are NOT stored here.';

COMMIT;
