-- ==============================================================================
-- Trainer Hub 010: Indexes on existing trainer foreign keys      STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- These existing FK columns had no index (schema audit). Trainer Hub filters
-- "my clients / my assignments" on them. Indexes only — no data change.
-- Note: plain CREATE INDEX briefly locks writes on each table; all are small/empty.
-- Rollback: 010_trainer_hub_indexes_down.sql
-- ==============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_trainers_user_id          ON trainers(user_id);
CREATE INDEX IF NOT EXISTS idx_mwa_assigned_by_trainer   ON member_workout_assignments(assigned_by_trainer_id);
CREATE INDEX IF NOT EXISTS idx_mda_assigned_by_trainer   ON member_diet_assignments(assigned_by_trainer_id);
CREATE INDEX IF NOT EXISTS idx_mtc_trainer               ON member_trainer_comments(trainer_id);
CREATE INDEX IF NOT EXISTS idx_online_classes_instructor ON online_classes(instructor_trainer_id);
CREATE INDEX IF NOT EXISTS idx_pt_assign_trainer_status  ON personal_trainer_assignments(trainer_id, status);

COMMIT;
