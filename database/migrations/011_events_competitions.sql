-- Migration 011: Events and Fitness Competitions Schema
-- Supporting Weightlifting Meets, Push-Up/Pull-Up/Squat Challenges, Monthly Contests,
-- Transformation Contests, Member Registrations, Leaderboards, Rankings, and Certificates.

CREATE TABLE IF NOT EXISTS fitness_competitions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'Weightlifting', 'Push-Up Challenge', 'Pull-Up Challenge', 'Squat Challenge', 'Monthly Fitness Challenge', 'Transformation Contest', 'Cross-Training'
    description TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    registration_deadline DATE,
    status VARCHAR(30) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'in_progress', 'completed', 'cancelled')),
    organizer_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    metric_type VARCHAR(30) NOT NULL, -- 'Max Weight (kg)', 'Max Repetitions', 'Fastest Time (seconds)', 'Transformation Points'
    prize_pool VARCHAR(150),
    rules TEXT,
    banner_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_competitions_status ON fitness_competitions(status);
CREATE INDEX IF NOT EXISTS idx_competitions_type ON fitness_competitions(type);

CREATE TABLE IF NOT EXISTS competition_participants (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER NOT NULL REFERENCES fitness_competitions(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    registration_date TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(30) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'checked_in', 'completed', 'withdrawn')),
    division VARCHAR(50) DEFAULT 'Open', -- 'Open Male', 'Open Female', 'Masters', 'Novice'
    score NUMERIC(8,2), -- e.g. 140.00 kg or 65.00 reps
    score_unit VARCHAR(30) DEFAULT 'reps', -- 'kg', 'reps', 'seconds', 'points'
    rank_position SMALLINT,
    is_winner BOOLEAN DEFAULT false,
    verified_by_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    trainer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(competition_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_comp ON competition_participants(competition_id);
CREATE INDEX IF NOT EXISTS idx_participants_member ON competition_participants(member_id);
CREATE INDEX IF NOT EXISTS idx_participants_rank ON competition_participants(rank_position);

CREATE TABLE IF NOT EXISTS competition_certificates (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER NOT NULL REFERENCES fitness_competitions(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    certificate_code VARCHAR(50) NOT NULL UNIQUE,
    award_title VARCHAR(100) NOT NULL,
    rank_awarded SMALLINT,
    issued_at TIMESTAMPTZ DEFAULT NOW(),
    issued_by VARCHAR(50) DEFAULT 'Virtex Athletics'
);

CREATE INDEX IF NOT EXISTS idx_cert_code ON competition_certificates(certificate_code);
CREATE INDEX IF NOT EXISTS idx_cert_member ON competition_certificates(member_id);

