-- ==============================================================================
-- Gym Receptionist Robot - Admin & Trainer PostgreSQL Schema Extensions
-- Apply to 'gym_robot_db'
-- ==============================================================================

-- 1. Trainers & Staff Availability Table
CREATE TABLE IF NOT EXISTS trainers (
    id SERIAL PRIMARY KEY,
    trainer_code VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    specialty VARCHAR(100) NOT NULL DEFAULT 'General Fitness',
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120),
    bio TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'on_floor' CHECK (status IN ('on_floor', 'in_session', 'off_duty')),
    shift_hours VARCHAR(100) DEFAULT '06:00 AM - 02:00 PM',
    photo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trainers_status ON trainers(status);

-- 2. Membership Plans Table (Dynamic Pricing & Perks)
CREATE TABLE IF NOT EXISTS membership_plans (
    id SERIAL PRIMARY KEY,
    plan_code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    duration_months SMALLINT NOT NULL DEFAULT 1,
    price_inr NUMERIC(10, 2) NOT NULL,
    badge_label VARCHAR(30),
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    perks TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Knowledge Base FAQs (Receptionist Training Prompts)
CREATE TABLE IF NOT EXISTS faqs (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (language IN ('en-IN', 'kn-IN', 'hi-IN')),
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    suggested_gesture VARCHAR(50) DEFAULT 'NOD_YES',
    display_order SMALLINT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faqs_lang ON faqs(language);
CREATE INDEX IF NOT EXISTS idx_faqs_category ON faqs(category);

-- 4. Announcements & Digital Noticeboard
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'event', 'maintenance')),
    target_language VARCHAR(10) DEFAULT 'all',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '14 days'),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);

-- 5. Gym Facility Profile & System Configuration
CREATE TABLE IF NOT EXISTS gym_profile (
    id SERIAL PRIMARY KEY,
    gym_name VARCHAR(120) NOT NULL DEFAULT 'Virtex Fitness',
    tagline VARCHAR(200) DEFAULT 'AI-Powered Smart Fitness Reception',
    phone VARCHAR(30) NOT NULL DEFAULT '+91 98765 43210',
    email VARCHAR(120) NOT NULL DEFAULT 'reception@virtexfitness.in',
    address TEXT NOT NULL DEFAULT '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
    operating_hours JSONB NOT NULL DEFAULT '[
        {"days": "Monday – Friday", "open": "06:00", "close": "22:00", "status": "Open"},
        {"days": "Saturday", "open": "06:00", "close": "21:00", "status": "Open"},
        {"days": "Sunday", "open": "07:00", "close": "13:00", "status": "Half Day"}
    ]'::jsonb,
    default_language VARCHAR(10) DEFAULT 'en-IN',
    speech_rate NUMERIC(3, 2) DEFAULT 1.00,
    speech_pitch NUMERIC(3, 2) DEFAULT 1.00,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial records if empty
INSERT INTO gym_profile (id, gym_name) 
VALUES (1, 'Virtex Fitness') 
ON CONFLICT (id) DO NOTHING;

-- Seed Sample Trainers
INSERT INTO trainers (trainer_code, full_name, specialty, phone, email, bio, status, shift_hours)
VALUES
    ('TRN001', 'Arjun Reddy', 'CrossFit & Strength Training', '9876500001', 'arjun@virtexfitness.in', 'CSCS Certified, 8 years elite athletic conditioning', 'on_floor', '06:00 AM - 02:00 PM'),
    ('TRN002', 'Meera Rao', 'Functional Mobility & Yoga', '9876500002', 'meera@virtexfitness.in', 'RYT-500 Certified, Specialist in posture & core recovery', 'in_session', '08:00 AM - 04:00 PM'),
    ('TRN003', 'Karan Verma', 'HIIT & Bodybuilding Coach', '9876500003', 'karan@virtexfitness.in', 'ACE Personal Trainer, Hypertrophy & transformation expert', 'off_duty', '02:00 PM - 10:00 PM')
ON CONFLICT (trainer_code) DO NOTHING;

-- Seed Initial FAQs
INSERT INTO faqs (question, answer, language, category, suggested_gesture)
VALUES
    ('What are your gym operating hours?', 'We are open Monday through Saturday from 6:00 AM to 10:00 PM, and Sundays from 7:00 AM to 1:00 PM.', 'en-IN', 'timings', 'NOD_YES'),
    ('ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?', 'ನಮ್ಮ ಜಿಮ್ ಸೋಮವಾರದಿಂದ ಶನಿವಾರ ಬೆಳಿಗ್ಗೆ 6:00 ರಿಂದ ರಾತ್ರಿ 10:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.', 'kn-IN', 'timings', 'NOD_YES'),
    ('जिम का समय क्या है?', 'हमारा जिम सोमवार से शनिवार सुबह 6:00 से रात 10:00 बजे तक खुला रहता है।', 'hi-IN', 'timings', 'NOD_YES')
ON CONFLICT DO NOTHING;

