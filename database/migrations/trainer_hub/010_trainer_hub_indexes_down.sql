-- Trainer Hub 010 DOWN: removes only the indexes 010 added (no data affected).
BEGIN;
DROP INDEX IF EXISTS idx_trainers_user_id;
DROP INDEX IF EXISTS idx_mwa_assigned_by_trainer;
DROP INDEX IF EXISTS idx_mda_assigned_by_trainer;
DROP INDEX IF EXISTS idx_mtc_trainer;
DROP INDEX IF EXISTS idx_online_classes_instructor;
DROP INDEX IF EXISTS idx_pt_assign_trainer_status;
COMMIT;
