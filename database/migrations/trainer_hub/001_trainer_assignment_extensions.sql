-- ==============================================================================
-- Trainer Hub 001: Trainer assignment extensions                STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- Reuses: personal_trainer_assignments, trainers, members, users (unchanged keys)
-- Adds:
--   * personal_trainer_assignments.updated_by_user_id  (nullable FK -> users)
--   * pt_assignment_history  (append-only, filled by trigger)
--   * uq_pt_assign_active_pair: one ACTIVE assignment per (member, trainer)
-- Additive only. Rollback: 001_trainer_assignment_extensions_down.sql
-- ==============================================================================

BEGIN;

-- Prerequisites (fail fast, nothing changed if missing)
DO $$
BEGIN
    IF to_regclass('public.personal_trainer_assignments') IS NULL
       OR to_regclass('public.trainers') IS NULL
       OR to_regclass('public.members') IS NULL
       OR to_regclass('public.users') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 001: required base tables are missing';
    END IF;
END $$;

-- Who last changed an assignment (application sets it on UPDATE)
ALTER TABLE personal_trainer_assignments
    ADD COLUMN IF NOT EXISTS updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Assignment history (survives trainer / member / assignment removal via SET NULL)
CREATE TABLE IF NOT EXISTS pt_assignment_history (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    assignment_id       INTEGER REFERENCES personal_trainer_assignments(id) ON DELETE SET NULL,
    member_id           INTEGER REFERENCES members(id)  ON DELETE SET NULL,
    trainer_id          INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    change_type         VARCHAR(20) NOT NULL
                        CHECK (change_type IN ('created', 'status_changed', 'trainer_changed',
                                               'dates_changed', 'fees_changed', 'updated')),
    old_status          VARCHAR(20),
    new_status          VARCHAR(20),
    old_trainer_id      INTEGER,
    new_trainer_id      INTEGER,
    snapshot            JSONB NOT NULL DEFAULT '{}'::jsonb,
    changed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pt_hist_assignment ON pt_assignment_history(assignment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_hist_trainer    ON pt_assignment_history(trainer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pt_hist_member     ON pt_assignment_history(member_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_pt_assignment_history()
RETURNS TRIGGER AS $$
DECLARE
    v_type VARCHAR(20);
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_type := 'created';
    ELSIF NEW.trainer_id IS DISTINCT FROM OLD.trainer_id THEN
        v_type := 'trainer_changed';
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        v_type := 'status_changed';
    ELSIF NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date THEN
        v_type := 'dates_changed';
    ELSIF NEW.monthly_fee IS DISTINCT FROM OLD.monthly_fee
       OR NEW.fee_paid    IS DISTINCT FROM OLD.fee_paid
       OR NEW.fee_due     IS DISTINCT FROM OLD.fee_due THEN
        v_type := 'fees_changed';
    ELSE
        v_type := 'updated';
    END IF;

    INSERT INTO pt_assignment_history (
        assignment_id, member_id, trainer_id, change_type,
        old_status, new_status, old_trainer_id, new_trainer_id,
        snapshot, changed_by_user_id
    ) VALUES (
        NEW.id, NEW.member_id, NEW.trainer_id, v_type,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status,
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.trainer_id END, NEW.trainer_id,
        to_jsonb(NEW), NEW.updated_by_user_id
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_pt_assignment_history
AFTER INSERT OR UPDATE ON personal_trainer_assignments
FOR EACH ROW EXECUTE FUNCTION fn_pt_assignment_history();

-- One ACTIVE assignment per (member, trainer).
-- Fails (and rolls back this file) if duplicates already exist; table had 0 rows at audit time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pt_assign_active_pair
    ON personal_trainer_assignments(member_id, trainer_id)
    WHERE status = 'active';

COMMIT;
