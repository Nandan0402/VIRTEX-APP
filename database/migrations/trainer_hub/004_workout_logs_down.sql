-- Trainer Hub 004 DOWN: removes only what 004 added (supervising-trainer links are lost).
BEGIN;
DROP INDEX IF EXISTS idx_workout_session_logs_trainer;
ALTER TABLE workout_session_logs DROP COLUMN IF EXISTS trainer_id;
COMMIT;
