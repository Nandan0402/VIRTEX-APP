-- ==============================================================================
-- Trainer Hub 006: Member performance                            STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- REUSED AS-IS: member_strength_logs (strength), member_body_measurements,
--   member_transformation_photos, member_performance_profiles (current state),
--   member_trainer_comments + trainer_recovery_reviews (trainer feedback).
-- Adds (genuinely missing):
--   * member_cardio_benchmarks   cardio tests (no existing table)
--   * member_progress_snapshots  history of performance metrics
--                                (member_performance_profiles keeps 1 row/member)
-- Rollback: 006_member_performance_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.members') IS NULL OR to_regclass('public.trainers') IS NULL
       OR to_regprocedure('public.fn_update_timestamp()') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 006: required base objects are missing';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS member_cardio_benchmarks (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id            INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id           INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    test_type            VARCHAR(30) NOT NULL
                         CHECK (test_type IN ('run', 'row', 'bike', 'swim', 'vo2_max', 'resting_hr',
                                              'beep_test', 'step_test', 'custom')),
    test_name            VARCHAR(120) NOT NULL,
    result_value         NUMERIC(10,2) NOT NULL CHECK (result_value >= 0),
    result_unit          VARCHAR(20)  NOT NULL,
    distance_m           NUMERIC(10,2) CHECK (distance_m IS NULL OR distance_m >= 0),
    duration_seconds     INTEGER       CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    avg_heart_rate       SMALLINT      CHECK (avg_heart_rate IS NULL OR avg_heart_rate BETWEEN 30 AND 230),
    recorded_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recorded_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mcb_member  ON member_cardio_benchmarks(member_id, test_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcb_trainer ON member_cardio_benchmarks(trainer_id);
CREATE OR REPLACE TRIGGER trg_mcb_updated BEFORE UPDATE ON member_cardio_benchmarks
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

CREATE TABLE IF NOT EXISTS member_progress_snapshots (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    member_id               INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id              INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    snapshot_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    fitness_goal            VARCHAR(100),
    overall_progress_pct    NUMERIC(5,2) CHECK (overall_progress_pct   BETWEEN 0 AND 100),
    workout_completion_pct  NUMERIC(5,2) CHECK (workout_completion_pct BETWEEN 0 AND 100),
    attendance_pct          NUMERIC(5,2) CHECK (attendance_pct         BETWEEN 0 AND 100),
    diet_adherence_pct      NUMERIC(5,2) CHECK (diet_adherence_pct     BETWEEN 0 AND 100),
    weight_kg               NUMERIC(6,2) CHECK (weight_kg IS NULL OR weight_kg > 0),
    body_fat_pct            NUMERIC(5,2) CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 0 AND 100),
    recovery_status         VARCHAR(50),
    progress_status         VARCHAR(50),
    trainer_summary         TEXT,
    created_by_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_progress_member_day UNIQUE (member_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_mps_member  ON member_progress_snapshots(member_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_mps_trainer ON member_progress_snapshots(trainer_id);

COMMIT;
