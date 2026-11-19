-- ==============================================================================
-- Trainer Hub 004: Workout logs                                  STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- REUSED AS-IS: workout_session_logs (daily logs), workout_session_items
--   (completed sets / reps / weight / PR), member_strength_logs.
-- Adds:
--   * workout_session_logs.trainer_id  (nullable FK -> trainers, SET NULL)
--     = trainer who supervised the logged workout; NULL = self-logged.
-- (pt_sessions.workout_session_log_id in 002 links a PT session to its log.)
-- Rollback: 004_workout_logs_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.workout_session_logs') IS NULL OR to_regclass('public.trainers') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 004: workout_session_logs or trainers missing';
    END IF;
END $$;

ALTER TABLE workout_session_logs
    ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workout_session_logs_trainer
    ON workout_session_logs(trainer_id, completed_at DESC);

COMMIT;
