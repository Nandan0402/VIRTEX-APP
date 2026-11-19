-- Trainer Hub 003 DOWN: removes only what 003 added (archive dates are lost).
BEGIN;
DROP INDEX IF EXISTS idx_workout_programs_not_archived;
DROP INDEX IF EXISTS idx_exercises_not_archived;
ALTER TABLE workout_programs DROP COLUMN IF EXISTS archived_at;
ALTER TABLE exercises        DROP COLUMN IF EXISTS archived_at;
COMMIT;
