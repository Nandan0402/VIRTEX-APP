-- 032_trainer_exercise_checks.sql  (additive only — one new table, no existing rows change)
--
-- Trainer-only "Complete / Not done" marks for exercises a trainer assigned from the muscle-recovery view
-- (Trainer Hub → Client Profile). One row per assigned exercise per day. Members never see this table.
--   completed = TRUE  → ✓ Complete      completed = FALSE → ✗ Not done      (no row = not marked yet)

BEGIN;

CREATE TABLE IF NOT EXISTS trainer_exercise_checks (
    id SERIAL PRIMARY KEY,
    plan_exercise_id INTEGER NOT NULL REFERENCES workout_program_exercises(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    check_date DATE NOT NULL DEFAULT CURRENT_DATE,
    completed BOOLEAN NOT NULL,
    marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_exercise_check_day ON trainer_exercise_checks(plan_exercise_id, check_date);
CREATE INDEX IF NOT EXISTS idx_trainer_exercise_checks_member ON trainer_exercise_checks(member_id, check_date);

COMMIT;
