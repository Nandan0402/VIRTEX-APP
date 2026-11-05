-- ==============================================================================
-- PulseCore AI Gym Receptionist Robot - Complete PostgreSQL Database Schema
-- File: database/schema.sql
-- Compatible with PostgreSQL 14, 15, 16, 17, 18+
-- ==============================================================================

-- Enable pgcrypto extension for secure password hashing and UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- Drop existing tables in reverse dependency order (Clean Migration Support)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS interaction_logs CASCADE;
DROP TABLE IF EXISTS robot_command_logs CASCADE;
DROP TABLE IF EXISTS robot_devices CASCADE;
DROP TABLE IF EXISTS check_ins CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS trainer_schedules CASCADE;
DROP TABLE IF EXISTS trainers CASCADE;
DROP TABLE IF EXISTS faqs CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS membership_plans CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS gym_settings CASCADE;

-- ==============================================================================
-- 1. GYM SETTINGS (Single-Row Configuration Pattern)
-- ==============================================================================
CREATE TABLE gym_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Enforces strict singleton configuration
    gym_name VARCHAR(120) NOT NULL DEFAULT 'PulseCore Fitness',
    tagline VARCHAR(200) DEFAULT 'AI-Powered Smart Fitness Reception',
    phone VARCHAR(20) NOT NULL DEFAULT '+91 98765 43210',
    email VARCHAR(120) NOT NULL DEFAULT 'reception@pulsecorefitness.in',
    address TEXT NOT NULL DEFAULT '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
    operating_hours JSONB NOT NULL DEFAULT '[
        {"day": "Monday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Tuesday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Wednesday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Thursday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Friday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Saturday", "open": "06:00", "close": "21:00", "is_closed": false},
        {"day": "Sunday", "open": "07:00", "close": "13:00", "is_closed": false}
    ]'::jsonb,
    default_language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (default_language IN ('en-IN', 'kn-IN', 'hi-IN')),
    supported_languages TEXT[] NOT NULL DEFAULT '{"en-IN", "kn-IN", "hi-IN"}',
    speech_rate NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (speech_rate BETWEEN 0.50 AND 2.00),
    speech_pitch NUMERIC(3, 2) NOT NULL DEFAULT 1.00 CHECK (speech_pitch BETWEEN 0.50 AND 2.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- 2. ADMIN USERS (Secure RBAC, Strictly Hashed Passwords)
-- ==============================================================================
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- NEVER plaintext! Hashed with bcrypt/Blowfish
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'trainer' CHECK (role IN ('superadmin', 'manager', 'trainer')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_users_username ON admin_users(username);
CREATE INDEX idx_admin_users_role ON admin_users(role);

-- ==============================================================================
-- 3. MEMBERSHIP PLANS (Public Tiers & Dynamic Pricing)
-- ==============================================================================
CREATE TABLE membership_plans (
    id SERIAL PRIMARY KEY,
    plan_code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    duration_months SMALLINT NOT NULL CHECK (duration_months > 0),
    price_inr NUMERIC(10, 2) NOT NULL CHECK (price_inr >= 0),
    badge_label VARCHAR(30),
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    perks TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_membership_plans_active ON membership_plans(is_active);
CREATE INDEX idx_membership_plans_price ON membership_plans(price_inr);

-- ==============================================================================
-- 4. TRAINERS (Staff Profiles & Live Floor Status)
-- ==============================================================================
CREATE TABLE trainers (
    id SERIAL PRIMARY KEY,
    trainer_code VARCHAR(32) NOT NULL UNIQUE,
    user_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL, -- Optional link to login account
    full_name VARCHAR(120) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(120) UNIQUE,
    bio TEXT,
    certifications TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'on_floor' CHECK (status IN ('on_floor', 'in_session', 'off_duty')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trainers_status ON trainers(status);
CREATE INDEX idx_trainers_code ON trainers(trainer_code);

-- ==============================================================================
-- 5. TRAINER SCHEDULES (Weekly Shifts & Timetable)
-- ==============================================================================
CREATE TABLE trainer_schedules (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    shift_start TIME NOT NULL,
    shift_end TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    notes VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_shift_time CHECK (shift_end > shift_start)
);

CREATE INDEX idx_trainer_schedules_day ON trainer_schedules(day_of_week, is_available);
CREATE INDEX idx_trainer_schedules_trainer ON trainer_schedules(trainer_id);

-- ==============================================================================
-- 6. FAQS (Knowledge Base & Multilingual Prompts)
-- ==============================================================================
CREATE TABLE faqs (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (language IN ('en-IN', 'kn-IN', 'hi-IN')),
    category VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'timings', 'pricing', 'facilities', 'trainers', 'rules')),
    suggested_gesture VARCHAR(50) NOT NULL DEFAULT 'NOD_YES',
    keywords TEXT[] NOT NULL DEFAULT '{}',
    display_order SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_faqs_lang ON faqs(language);
CREATE INDEX idx_faqs_category ON faqs(category);
CREATE INDEX idx_faqs_active ON faqs(is_active);

-- ==============================================================================
-- 7. ANNOUNCEMENTS (Digital Reception Noticeboard)
-- ==============================================================================
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent', 'event', 'maintenance')),
    target_language VARCHAR(10) NOT NULL DEFAULT 'all',
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '14 days'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_announcement_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_announcements_active_dates ON announcements(is_active, start_date, end_date);

-- ==============================================================================
-- 8. ROBOT DEVICES (ESP32 Hardware Registration & Pinouts)
-- ==============================================================================
CREATE TABLE robot_devices (
    id SERIAL PRIMARY KEY,
    device_uuid VARCHAR(64) NOT NULL UNIQUE, -- e.g. 'ESP32_DEV_FRONT_01'
    device_name VARCHAR(100) NOT NULL DEFAULT 'FitBot Front Desk Station',
    mac_address VARCHAR(17) UNIQUE,
    ip_address VARCHAR(45),
    api_key_hash VARCHAR(255) NOT NULL, -- Hashed pre-shared key for hardware authentication
    status VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error', 'calibrating')),
    firmware_version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    head_pan_pin SMALLINT NOT NULL DEFAULT 18,
    head_tilt_pin SMALLINT NOT NULL DEFAULT 19,
    arm_wave_pin SMALLINT NOT NULL DEFAULT 21,
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_devices_uuid ON robot_devices(device_uuid);
CREATE INDEX idx_robot_devices_status ON robot_devices(status);

-- ==============================================================================
-- 9. ROBOT COMMAND LOGS (Servo Motion & Gesture Queue)
-- ==============================================================================
CREATE TABLE robot_command_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
    command_type VARCHAR(30) NOT NULL CHECK (command_type IN ('GESTURE', 'DIRECT_ANGLES', 'CALIBRATE', 'EMERGENCY_STOP')),
    gesture_name VARCHAR(50),
    servo_payload JSONB NOT NULL, -- e.g. '{"headPan": 90, "headTilt": 80, "armWave": 110, "delayMs": 250}'
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'executed', 'failed')),
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'system', -- 'speech_ai', 'admin_dashboard', 'check_in', 'system'
    execution_time_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_commands_device_status ON robot_command_logs(device_id, status);
CREATE INDEX idx_robot_commands_created ON robot_command_logs(created_at DESC);

-- ==============================================================================
-- 10. MEMBERS (Gym Member Profiles)
-- ==============================================================================
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    member_code VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(120) UNIQUE,
    plan_id INTEGER REFERENCES membership_plans(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'frozen')),
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (preferred_language IN ('en-IN', 'kn-IN', 'hi-IN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_members_code ON members(member_code);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_status ON members(status);

-- ==============================================================================
-- 11. CHECK-INS (Physical Gym Access Log)
-- ==============================================================================
CREATE TABLE check_ins (
    id BIGSERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_in_method VARCHAR(30) NOT NULL DEFAULT 'kiosk_voice' CHECK (check_in_method IN ('kiosk_voice', 'kiosk_manual', 'rfid_card', 'mobile_qr'))
);

CREATE INDEX idx_check_ins_member ON check_ins(member_id);
CREATE INDEX idx_check_ins_time ON check_ins(check_in_time DESC);

-- ==============================================================================
-- 12. INTERACTION LOGS (Conversational AI Analytics & Audit Trail)
-- ==============================================================================
CREATE TABLE interaction_logs (
    id BIGSERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    device_id INTEGER REFERENCES robot_devices(id) ON DELETE SET NULL,
    user_query TEXT NOT NULL,
    robot_response TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (language IN ('en-IN', 'kn-IN', 'hi-IN')),
    input_method VARCHAR(20) NOT NULL DEFAULT 'voice' CHECK (input_method IN ('voice', 'text_kiosk', 'rfid_scan')),
    intent_detected VARCHAR(50),
    gesture_command_id BIGINT REFERENCES robot_command_logs(id) ON DELETE SET NULL,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interactions_created ON interaction_logs(created_at DESC);
CREATE INDEX idx_interactions_language ON interaction_logs(language);
CREATE INDEX idx_interactions_member ON interaction_logs(member_id);
