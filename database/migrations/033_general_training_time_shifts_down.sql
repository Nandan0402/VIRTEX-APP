-- Reverts 033. WARNING: deletes all general-trainer assignments and time-shift requests. Back up first.
BEGIN;
DROP TABLE IF EXISTS time_shift_requests;
DROP TABLE IF EXISTS general_training_assignments;
COMMIT;
