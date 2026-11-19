-- Trainer Hub 001 DOWN: removes only what 001 added.
-- WARNING: deletes assignment history rows; existing assignments are untouched.
BEGIN;
DROP TRIGGER IF EXISTS trg_pt_assignment_history ON personal_trainer_assignments;
DROP FUNCTION IF EXISTS fn_pt_assignment_history();
DROP INDEX IF EXISTS uq_pt_assign_active_pair;
DROP TABLE IF EXISTS pt_assignment_history;
ALTER TABLE personal_trainer_assignments DROP COLUMN IF EXISTS updated_by_user_id;
COMMIT;
