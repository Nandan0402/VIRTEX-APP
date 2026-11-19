-- Migration 022: Member recovery self-report (ADDITIVE — no data removed or changed)
--
-- Why: member_recovery_logs currently REQUIRES a generated readiness_score, fatigue_index and
-- readiness_status on every row, so a member check-in could only be saved together with a
-- formula-generated "assessment". Members must be able to record what they actually felt,
-- without the system inventing an assessment for them.
--
-- What this does:
--   1. Adds member-reported columns:
--        fatigue_level    1–10, as reported by the member
--        self_assessment  the member's own recovery assessment (fixed set of answers)
--   2. Allows the generated/optional columns to be empty (DROP NOT NULL only):
--        readiness_score, fatigue_index, readiness_status, energy_level, stress_level
--      Existing rows keep every value they already have.
--
-- Safe to re-run (IF NOT EXISTS / DROP NOT NULL is idempotent). No rows are updated or deleted.

BEGIN;

ALTER TABLE member_recovery_logs
    ADD COLUMN IF NOT EXISTS fatigue_level SMALLINT
        CHECK (fatigue_level IS NULL OR fatigue_level BETWEEN 1 AND 10),
    ADD COLUMN IF NOT EXISTS self_assessment VARCHAR(30)
        CHECK (self_assessment IS NULL OR self_assessment IN
               ('fully_recovered', 'mostly_recovered', 'partly_recovered', 'not_recovered'));

ALTER TABLE member_recovery_logs
    ALTER COLUMN readiness_score  DROP NOT NULL,
    ALTER COLUMN fatigue_index    DROP NOT NULL,
    ALTER COLUMN readiness_status DROP NOT NULL,
    ALTER COLUMN energy_level     DROP NOT NULL,
    ALTER COLUMN stress_level     DROP NOT NULL;

COMMENT ON COLUMN member_recovery_logs.fatigue_level IS 'Member-reported fatigue 1 (fresh) – 10 (exhausted). Not calculated.';
COMMENT ON COLUMN member_recovery_logs.self_assessment IS 'Member''s own recovery assessment. Not calculated, not a diagnosis.';

COMMIT;
