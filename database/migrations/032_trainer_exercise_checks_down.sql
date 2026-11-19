-- Reverts 032. WARNING: deletes every trainer "Complete / Not done" mark. Back up first.
BEGIN;
DROP TABLE IF EXISTS trainer_exercise_checks;
COMMIT;
