-- Migration 007: Workout and Training Management Schema
-- Supporting Workout Program Builder, Exercise Library, Schedules, Assignments, Session Monitoring, PRs, and Analytics

CREATE TABLE IF NOT EXISTS exercises (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    muscle_group VARCHAR(50) NOT NULL, -- Chest, Back, Shoulders, Legs, Arms, Core, Full Body
    equipment VARCHAR(50) NOT NULL,    -- Barbell, Dumbbell, Machine, Cable, Bodyweight, Kettlebell
    difficulty VARCHAR(30) DEFAULT 'Intermediate', -- Beginner, Intermediate, Advanced
    instructions TEXT NOT NULL,
    target_muscles VARCHAR(200),
    video_url VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercises_muscle_group ON exercises(muscle_group);
CREATE INDEX IF NOT EXISTS idx_exercises_equipment ON exercises(equipment);

CREATE TABLE IF NOT EXISTS workout_programs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    difficulty_level VARCHAR(30) DEFAULT 'Intermediate',
    goal VARCHAR(50) NOT NULL, -- Hypertrophy, Strength, Fat Loss, Endurance, Athletic Conditioning
    split_type VARCHAR(50) NOT NULL, -- Push/Pull/Legs, Upper/Lower, 5-Day Body Split, Full Body 3x
    description TEXT,
    is_template BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_programs_trainer ON workout_programs(trainer_id);

CREATE TABLE IF NOT EXISTS workout_program_days (
    id SERIAL PRIMARY KEY,
    program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
    day_number SMALLINT NOT NULL, -- 1 to 7
    day_name VARCHAR(100) NOT NULL, -- e.g. Day 1: Heavy Push (Chest & Shoulders)
    focus VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_days_program ON workout_program_days(program_id);

CREATE TABLE IF NOT EXISTS workout_program_exercises (
    id SERIAL PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES workout_program_days(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    sets SMALLINT NOT NULL DEFAULT 3,
    reps VARCHAR(30) NOT NULL DEFAULT '8-12',
    target_weight_kg NUMERIC(6,2),
    rest_seconds INTEGER NOT NULL DEFAULT 90,
    order_index SMALLINT NOT NULL DEFAULT 1,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_program_exercises_day ON workout_program_exercises(day_id);

CREATE TABLE IF NOT EXISTS member_workout_assignments (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE RESTRICT,
    assigned_by_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    trainer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_workout_member ON member_workout_assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_member_workout_status ON member_workout_assignments(status);

CREATE TABLE IF NOT EXISTS workout_session_logs (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    program_id INTEGER REFERENCES workout_programs(id) ON DELETE SET NULL,
    day_id INTEGER REFERENCES workout_program_days(id) ON DELETE SET NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_minutes SMALLINT DEFAULT 60,
    total_volume_kg NUMERIC(10,2) DEFAULT 0.00,
    rpe_rating SMALLINT CHECK (rpe_rating >= 1 AND rpe_rating <= 10),
    notes TEXT,
    logged_by VARCHAR(50) DEFAULT 'Admin',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_logs_member ON workout_session_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_session_logs_completed_at ON workout_session_logs(completed_at);

CREATE TABLE IF NOT EXISTS workout_session_items (
    id SERIAL PRIMARY KEY,
    session_log_id INTEGER NOT NULL REFERENCES workout_session_logs(id) ON DELETE CASCADE,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    set_number SMALLINT NOT NULL,
    reps_completed SMALLINT NOT NULL,
    weight_kg NUMERIC(6,2) NOT NULL,
    is_pr BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_session_items_session ON workout_session_items(session_log_id);
CREATE INDEX IF NOT EXISTS idx_session_items_exercise ON workout_session_items(exercise_id);

