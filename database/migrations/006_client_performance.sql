-- ==============================================================================
-- Virtex AI Gym Receptionist - Migration 006: Client Performance Center
-- Dedicated tables for athletic progression, 1RM, body measurements, 
-- transformation timelines, and trainer comments.
-- ==============================================================================

-- 1. Member Performance Profiles
CREATE TABLE IF NOT EXISTS member_performance_profiles (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  assigned_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  fitness_goal VARCHAR(100) DEFAULT 'General Fitness',
  overall_progress_pct NUMERIC(5, 2), -- NULL if insufficient data
  workout_completion_pct NUMERIC(5, 2), -- NULL if insufficient data
  attendance_pct NUMERIC(5, 2), -- Computed from check_ins
  diet_adherence_pct NUMERIC(5, 2), -- NULL if not logged
  recovery_status VARCHAR(50), -- 'Optimal', 'Adequate', 'Fatigued', 'Needs Rest', NULL
  progress_status VARCHAR(50) DEFAULT 'insufficient_data', -- 'on_track', 'improving', 'needs_attention', 'insufficient_data'
  trainer_notes TEXT,
  consent_photos BOOLEAN DEFAULT false,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_perf_member UNIQUE (member_id)
);

CREATE INDEX IF NOT EXISTS idx_perf_member_id ON member_performance_profiles(member_id);
CREATE INDEX IF NOT EXISTS idx_perf_trainer_id ON member_performance_profiles(assigned_trainer_id);
CREATE INDEX IF NOT EXISTS idx_perf_status ON member_performance_profiles(progress_status);

-- 2. Member Strength Progression (1RM, Sets, Reps)
CREATE TABLE IF NOT EXISTS member_strength_logs (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  exercise_name VARCHAR(100) NOT NULL, -- e.g. 'Barbell Back Squat', 'Barbell Bench Press', 'Deadlift'
  weight_kg NUMERIC(6, 2) NOT NULL,
  reps INTEGER NOT NULL DEFAULT 1,
  estimated_one_rep_max NUMERIC(6, 2) NOT NULL,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strength_member_time ON member_strength_logs(member_id, logged_at);

-- 3. Member Body Measurements & Weight Progression
CREATE TABLE IF NOT EXISTS member_body_measurements (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  weight_kg NUMERIC(5, 2) NOT NULL,
  body_fat_pct NUMERIC(4, 1),
  muscle_mass_kg NUMERIC(5, 2),
  chest_cm NUMERIC(5, 1),
  waist_cm NUMERIC(5, 1),
  arms_cm NUMERIC(5, 1),
  thighs_cm NUMERIC(5, 1),
  notes TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_body_member_time ON member_body_measurements(member_id, logged_at);

-- 4. Member Transformation Photos (With Explicit Consent)
CREATE TABLE IF NOT EXISTS member_transformation_photos (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_type VARCHAR(20) DEFAULT 'front', -- 'front', 'side', 'back'
  consent_given BOOLEAN DEFAULT true,
  caption TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trans_photo_member ON member_transformation_photos(member_id);

-- 5. Trainer Review & Coaching Comments
CREATE TABLE IF NOT EXISTS member_trainer_comments (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
  comment_type VARCHAR(50) DEFAULT 'weekly_checkin', -- 'weekly_checkin', 'milestone', 'form_correction', 'general'
  comment_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_member ON member_trainer_comments(member_id);

