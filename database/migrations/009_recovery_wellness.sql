-- Migration 009: Recovery and Wellness Management Schema
-- Supporting Muscle Soreness Tracking, Sleep Logs, Rest-Day Management, Fatigue Monitoring,
-- Wellness Assessments, and Trainer Recovery Overviews.
-- NOTICE: Non-medical athletic wellness and lifestyle monitoring only.

CREATE TABLE IF NOT EXISTS member_recovery_logs (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- User-Reported Information (Subjective)
    sleep_hours NUMERIC(3,1) NOT NULL, -- e.g. 7.5 hrs
    sleep_quality SMALLINT NOT NULL CHECK (sleep_quality >= 1 AND sleep_quality <= 10), -- 1-10
    energy_level SMALLINT NOT NULL CHECK (energy_level >= 1 AND energy_level <= 10), -- 1-10
    stress_level SMALLINT NOT NULL CHECK (stress_level >= 1 AND stress_level <= 10), -- 1-10
    hydration_liters NUMERIC(3,1) DEFAULT 3.0,
    overall_soreness_rating SMALLINT NOT NULL CHECK (overall_soreness_rating >= 0 AND overall_soreness_rating <= 10), -- 0-10
    user_notes TEXT,
    is_rest_day BOOLEAN DEFAULT false,
    rest_day_activity VARCHAR(100), -- 'Complete Rest', 'Light Walking & Sauna', 'Mobility & Foam Rolling'
    
    -- Calculated Indicators (Algorithmic / Mathematical)
    readiness_score SMALLINT NOT NULL CHECK (readiness_score >= 0 AND readiness_score <= 100),
    fatigue_index SMALLINT NOT NULL CHECK (fatigue_index >= 0 AND fatigue_index <= 100),
    readiness_status VARCHAR(50) NOT NULL, -- 'Optimal', 'Good', 'Moderate', 'Needs Recovery'
    recommended_action VARCHAR(255),
    
    logged_by VARCHAR(50) DEFAULT 'Member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(member_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_recovery_logs_member ON member_recovery_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_date ON member_recovery_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_readiness ON member_recovery_logs(readiness_score);

CREATE TABLE IF NOT EXISTS member_muscle_soreness_details (
    id SERIAL PRIMARY KEY,
    recovery_log_id INTEGER NOT NULL REFERENCES member_recovery_logs(id) ON DELETE CASCADE,
    muscle_group VARCHAR(50) NOT NULL, -- Chest, Upper Back, Lower Back, Shoulders, Arms, Quadriceps, Hamstrings, Glutes, Calves, Core
    soreness_level SMALLINT NOT NULL CHECK (soreness_level >= 0 AND soreness_level <= 10),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_soreness_log_id ON member_muscle_soreness_details(recovery_log_id);
CREATE INDEX IF NOT EXISTS idx_soreness_muscle ON member_muscle_soreness_details(muscle_group);

CREATE TABLE IF NOT EXISTS trainer_recovery_reviews (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    review_date DATE NOT NULL DEFAULT CURRENT_DATE,
    fatigue_risk_level VARCHAR(30) DEFAULT 'Low', -- 'Low', 'Moderate', 'High', 'Elevated Strain'
    trainer_advice TEXT NOT NULL,
    suggested_rest_days SMALLINT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainer_reviews_member ON trainer_recovery_reviews(member_id);
CREATE INDEX IF NOT EXISTS idx_trainer_reviews_trainer ON trainer_recovery_reviews(trainer_id);

