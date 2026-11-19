-- Down for migration 022. Review before running: it REMOVES the two member-reported columns
-- (and their data). NOT NULL is restored only where no row is empty, so it never fails
-- half-way or invents values for member check-ins saved without a generated assessment.

BEGIN;

ALTER TABLE member_recovery_logs DROP COLUMN IF EXISTS self_assessment;
ALTER TABLE member_recovery_logs DROP COLUMN IF EXISTS fatigue_level;

DO $$
DECLARE col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['readiness_score', 'fatigue_index', 'readiness_status', 'energy_level', 'stress_level'] LOOP
    IF NOT EXISTS (SELECT 1 FROM member_recovery_logs WHERE (to_jsonb(member_recovery_logs) ->> col) IS NULL) THEN
      EXECUTE format('ALTER TABLE member_recovery_logs ALTER COLUMN %I SET NOT NULL', col);
    ELSE
      RAISE NOTICE 'Column % left nullable: some rows have no value.', col;
    END IF;
  END LOOP;
END $$;

COMMIT;
