-- Reverts 031. WARNING: removes gender values, plan audiences/weekly planners, trainer welfare % and
-- the trainer welfare payment history. Back up the database first.
BEGIN;
DROP TABLE IF EXISTS trainer_welfare_payments;
ALTER TABLE trainers DROP CONSTRAINT IF EXISTS chk_trainers_welfare_percent;
ALTER TABLE trainers DROP COLUMN IF EXISTS welfare_percent;
ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS chk_membership_plans_schedule_object;
ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS chk_membership_plans_audience;
ALTER TABLE membership_plans DROP COLUMN IF EXISTS weekly_schedule;
ALTER TABLE membership_plans DROP COLUMN IF EXISTS audience;
ALTER TABLE members DROP CONSTRAINT IF EXISTS chk_members_gender;
ALTER TABLE members DROP COLUMN IF EXISTS gender;
COMMIT;
