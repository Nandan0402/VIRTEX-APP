-- ==============================================================================
-- 005_fees_alerts_trainer_assignments_and_routine.sql
-- Migration for:
-- 1. Personal Trainer Assignment with Monthly Fees
-- 2. Staff / Routine Tracker (Punch In, Break, Punch Out)
-- 3. Fee & Birthday Alert timestamps
-- ==============================================================================

-- 1. Ensure members table has alert tracking columns
ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_paid NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_due NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_due_date DATE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'Cash';
ALTER TABLE members ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'paid';
ALTER TABLE members ADD COLUMN IF NOT EXISTS fee_alert_sent_at TIMESTAMPTZ;
ALTER TABLE members ADD COLUMN IF NOT EXISTS birthday_wish_sent_at TIMESTAMPTZ;

-- 2. Personal Trainer Assignments Table
CREATE TABLE IF NOT EXISTS personal_trainer_assignments (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    monthly_fee NUMERIC(10, 2) NOT NULL DEFAULT 5000.00 CHECK (monthly_fee >= 0),
    fee_paid NUMERIC(10, 2) NOT NULL DEFAULT 5000.00 CHECK (fee_paid >= 0),
    fee_due NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (fee_due >= 0),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
    sessions_per_week SMALLINT NOT NULL DEFAULT 3,
    preferred_slot VARCHAR(80) DEFAULT 'Morning (07:00 AM - 08:00 AM)',
    training_goal VARCHAR(150) DEFAULT 'Hypertrophy & Strength Training',
    payment_status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'partial', 'waived')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pt_assign_member ON personal_trainer_assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_pt_assign_trainer ON personal_trainer_assignments(trainer_id);
CREATE INDEX IF NOT EXISTS idx_pt_assign_status ON personal_trainer_assignments(status);
CREATE INDEX IF NOT EXISTS idx_pt_assign_dates ON personal_trainer_assignments(start_date, end_date);

-- 3. Routine Tracker Punches Table
CREATE TABLE IF NOT EXISTS routine_punches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(120) NOT NULL DEFAULT 'Nandan.B',
    user_role VARCHAR(50) NOT NULL DEFAULT 'owner',
    punch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    punch_in TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    punch_out TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'punched_in' CHECK (status IN ('punched_in', 'on_break', 'punched_out')),
    total_break_seconds INTEGER NOT NULL DEFAULT 0,
    total_work_seconds INTEGER NOT NULL DEFAULT 0,
    routine_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routine_punches_date ON routine_punches(punch_date DESC);
CREATE INDEX IF NOT EXISTS idx_routine_punches_user ON routine_punches(user_id);
CREATE INDEX IF NOT EXISTS idx_routine_punches_status ON routine_punches(status);

-- 4. Routine Breaks Table
CREATE TABLE IF NOT EXISTS routine_punch_breaks (
    id SERIAL PRIMARY KEY,
    punch_id INTEGER NOT NULL REFERENCES routine_punches(id) ON DELETE CASCADE,
    break_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    break_end TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    break_reason VARCHAR(100) DEFAULT 'Routine Break',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routine_breaks_punch ON routine_punch_breaks(punch_id);

-- 5. Seed initial PT assignment if none exist
DO $$
DECLARE
    v_member_id INT;
    v_trainer_id INT;
BEGIN
    SELECT id INTO v_member_id FROM members ORDER BY id LIMIT 1;
    SELECT id INTO v_trainer_id FROM trainers ORDER BY id LIMIT 1;

    IF v_member_id IS NOT NULL AND v_trainer_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM personal_trainer_assignments WHERE member_id = v_member_id) THEN
            INSERT INTO personal_trainer_assignments (
                member_id, trainer_id, monthly_fee, fee_paid, fee_due, start_date, end_date, sessions_per_week, preferred_slot, training_goal, payment_status, status, notes
            ) VALUES (
                v_member_id,
                v_trainer_id,
                6500.00,
                6500.00,
                0.00,
                CURRENT_DATE - INTERVAL '10 days',
                CURRENT_DATE + INTERVAL '20 days',
                4,
                'Morning (06:30 AM - 07:30 AM)',
                'Hypertrophy & Mobility',
                'paid',
                'active',
                'Enrolled in VIP Personal Training with Coach'
            );
        END IF;
    END IF;
END $$;

