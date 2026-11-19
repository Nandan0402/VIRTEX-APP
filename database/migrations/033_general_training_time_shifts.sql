-- 033_general_training_time_shifts.sql  (additive only — two new tables, no existing rows change)
--
-- 1. general_training_assignments: the admin gives a member a GENERAL trainer and a training time
--    (personal training stays in personal_trainer_assignments, with its time in preferred_slot).
--    One active general assignment per member; ending one keeps it as history (status 'ended').
-- 2. time_shift_requests: a member asks the admin to move their personal or general training time.
--    The admin approves (optionally adjusting the time) or rejects. Approving updates the assignment, so the
--    new time shows for the admin, the trainer and the member. One pending request per member per kind.

BEGIN;

CREATE TABLE IF NOT EXISTS general_training_assignments (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
    notes VARCHAR(300),
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    CONSTRAINT chk_gta_times CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gta_one_active_per_member ON general_training_assignments(member_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_gta_trainer ON general_training_assignments(trainer_id, status);

CREATE TABLE IF NOT EXISTS time_shift_requests (
    id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    kind VARCHAR(10) NOT NULL CHECK (kind IN ('personal', 'general')),
    pt_assignment_id INTEGER REFERENCES personal_trainer_assignments(id) ON DELETE CASCADE,
    general_assignment_id INTEGER REFERENCES general_training_assignments(id) ON DELETE CASCADE,
    current_label VARCHAR(120),
    requested_start TIME NOT NULL,
    requested_end TIME NOT NULL,
    reason VARCHAR(300),
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    approved_start TIME,
    approved_end TIME,
    admin_note VARCHAR(300),
    decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tsr_times CHECK (requested_end > requested_start),
    CONSTRAINT chk_tsr_target CHECK ((kind = 'personal' AND pt_assignment_id IS NOT NULL) OR (kind = 'general' AND general_assignment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsr_one_pending ON time_shift_requests(member_id, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_tsr_status ON time_shift_requests(status, created_at);

COMMIT;
