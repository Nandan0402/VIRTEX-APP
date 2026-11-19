-- 031_gender_plan_schedule_trainer_welfare.sql  (additive only — nothing is dropped, no rows change)
--
-- 1. members.gender            : 'female' (Girl) / 'male' (Boy). NULL = not set yet (existing members).
-- 2. membership_plans.audience : who a fee plan is for — 'all' (default for existing plans), 'girls', 'boys'.
--    membership_plans.weekly_schedule : Mon–Sun planner set by the admin, e.g.
--      {"mon":{"type":"pt","start":"07:00","end":"08:00"},"tue":{"type":"self"},"sat":{"type":"ladies","start":"16:00","end":"18:00"},"sun":{"type":"rest"}}
--      type ∈ pt (with personal trainer) | self (self-training) | ladies (ladies-only) | rest
-- 3. trainers.welfare_percent  : share of a trainer's monthly PT fees paid to the gym (gym welfare). Default 20.
--    trainer_welfare_payments  : one row per trainer per month once the admin records the payment.
--      Due on the last day of each month; trainers see a countdown from 7 days before until it is recorded.
--      trainer_name is kept so payment history survives if a trainer is deleted (trainer_id → NULL).
--
-- Account freeze for unpaid fees uses the EXISTING members.status value 'frozen' (no change needed here).

BEGIN;

ALTER TABLE members ADD COLUMN IF NOT EXISTS gender VARCHAR(6);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_members_gender') THEN
    ALTER TABLE members ADD CONSTRAINT chk_members_gender CHECK (gender IS NULL OR gender IN ('female', 'male'));
  END IF;
END $$;

ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS audience VARCHAR(8) NOT NULL DEFAULT 'all';
ALTER TABLE membership_plans ADD COLUMN IF NOT EXISTS weekly_schedule JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_membership_plans_audience') THEN
    ALTER TABLE membership_plans ADD CONSTRAINT chk_membership_plans_audience CHECK (audience IN ('all', 'girls', 'boys'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_membership_plans_schedule_object') THEN
    ALTER TABLE membership_plans ADD CONSTRAINT chk_membership_plans_schedule_object CHECK (jsonb_typeof(weekly_schedule) = 'object');
  END IF;
END $$;

ALTER TABLE trainers ADD COLUMN IF NOT EXISTS welfare_percent NUMERIC(5, 2) NOT NULL DEFAULT 20.00;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_trainers_welfare_percent') THEN
    ALTER TABLE trainers ADD CONSTRAINT chk_trainers_welfare_percent CHECK (welfare_percent >= 0 AND welfare_percent <= 100);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS trainer_welfare_payments (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    trainer_name VARCHAR(120) NOT NULL,
    period_month DATE NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
    base_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (base_amount >= 0),
    percent NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    payment_method VARCHAR(30) NOT NULL DEFAULT 'Cash',
    notes TEXT,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trainer_welfare_month ON trainer_welfare_payments(trainer_id, period_month);
CREATE INDEX IF NOT EXISTS idx_trainer_welfare_period ON trainer_welfare_payments(period_month);

COMMIT;
