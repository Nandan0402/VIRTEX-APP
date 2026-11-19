-- Trainer Hub 006 DOWN: removes only what 006 added.
-- WARNING: deletes all cardio benchmark and progress snapshot rows.
BEGIN;
DROP TABLE IF EXISTS member_progress_snapshots;
DROP TABLE IF EXISTS member_cardio_benchmarks;
COMMIT;
