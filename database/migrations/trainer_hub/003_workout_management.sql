-- ==============================================================================
-- Trainer Hub 003: Workout management                            STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- REUSED AS-IS (already complete): workout_programs, workout_program_days,
--   workout_program_exercises, exercises, member_workout_assignments.
-- Adds only soft-archival so trainers can retire programmes / exercises without
-- deleting them (existing rows stay NULL = not archived):
--   * workout_programs.archived_at
--   * exercises.archived_at
-- Rollback: 003_workout_management_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.workout_programs') IS NULL OR to_regclass('public.exercises') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 003: workout tables are missing';
    END IF;
END $$;

ALTER TABLE workout_programs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE exercises        ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workout_programs_not_archived ON workout_programs(trainer_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_exercises_not_archived        ON exercises(muscle_group)     WHERE archived_at IS NULL;

COMMIT;
