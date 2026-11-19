-- 027_trainer_birthdays.sql
-- Lets the gym record personal trainers' dates of birth so the server can wish them automatically
-- (same idea as members.date_of_birth / members.birthday_wish_sent_at from migration 005).
-- Additive only: two nullable columns, no existing data changed. Undo: 027_trainer_birthdays_down.sql
BEGIN;

ALTER TABLE trainers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS birthday_wish_sent_at TIMESTAMPTZ;

COMMIT;
