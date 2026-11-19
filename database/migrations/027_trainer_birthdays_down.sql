-- 027_trainer_birthdays_down.sql — undo 027. WARNING: trainers' recorded dates of birth are lost.
BEGIN;
ALTER TABLE trainers DROP COLUMN IF EXISTS birthday_wish_sent_at;
ALTER TABLE trainers DROP COLUMN IF EXISTS date_of_birth;
COMMIT;
