-- ==============================================================================
-- Virtex AI Gym Receptionist Robot - Complete Shared PostgreSQL Database Schema
-- File: database/schema.sql
-- Serves: Member Reception Kiosk (/kiosk.html) & Staff Admin Console (/admin)
-- Compatible with PostgreSQL 14, 15, 16, 17, 18+
-- ==============================================================================

-- Enable pgcrypto extension for secure password hashing and UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- Drop existing tables and views in reverse dependency order (Clean Migration Support)
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_faqs_unified CASCADE;
DROP VIEW IF EXISTS v_member_details CASCADE;
DROP TABLE IF EXISTS interaction_logs CASCADE;
DROP TABLE IF EXISTS check_ins CASCADE;
DROP TABLE IF EXISTS robot_logs CASCADE;
DROP TABLE IF EXISTS robot_command_logs CASCADE;
DROP TABLE IF EXISTS robot_commands CASCADE;
DROP TABLE IF EXISTS robot_devices CASCADE;
DROP TABLE IF EXISTS member_enquiries CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS gym_faqs CASCADE;
DROP TABLE IF EXISTS faqs CASCADE;
DROP TABLE IF EXISTS trainer_availability CASCADE;
DROP TABLE IF EXISTS trainer_schedules CASCADE;
DROP TABLE IF EXISTS trainers CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS membership_plans CASCADE;
DROP TABLE IF EXISTS admin_users CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS gym_settings CASCADE;
DROP TABLE IF EXISTS gym_profile CASCADE;

-- ------------------------------------------------------------------------------
-- 0. REUSABLE TRIGGER FUNCTIONS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 1. GYM SETTINGS (Single-Row Facility Configuration Pattern)
-- ==============================================================================
CREATE TABLE gym_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Enforces strict singleton configuration
    gym_name VARCHAR(120) NOT NULL DEFAULT 'Virtex Fitness',
    tagline VARCHAR(200) DEFAULT 'AI-Powered Smart Fitness Reception',
    phone VARCHAR(20) NOT NULL DEFAULT '+91 98765 43210',
    email VARCHAR(120) NOT NULL DEFAULT 'reception@virtexfitness.in',
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
    checkin_cooldown_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (checkin_cooldown_minutes >= 0),
    wifi_ssid VARCHAR(64) DEFAULT 'Virtex-Gym-Guest',
    updated_by INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_gym_settings_updated
BEFORE UPDATE ON gym_settings
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 2. ROLES (RBAC Framework)
-- ==============================================================================
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    role_code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_roles_code ON roles(role_code);

-- ==============================================================================
-- 3. USERS (Shared Administrative & Staff Identity Store)
-- ==============================================================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- Hashed with bcrypt / Blowfish
    full_name VARCHAR(100) NOT NULL,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'trainer',
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_role_id ON users(role_id);

CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Backward compatibility table: admin_users (points to / mirrors users for legacy endpoints)
CREATE TABLE admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
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
-- 4. MEMBERSHIP PLANS (Catalog & Pricing Tiers)
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
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_membership_plans_active ON membership_plans(is_active);
CREATE INDEX idx_membership_plans_price ON membership_plans(price_inr);

CREATE TRIGGER trg_membership_plans_updated
BEFORE UPDATE ON membership_plans
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 5. MEMBERS (Registered Gym Members Profiles)
-- ==============================================================================
CREATE TABLE members (
    id SERIAL PRIMARY KEY,
    member_code VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(120) UNIQUE,
    plan_id INTEGER REFERENCES membership_plans(id) ON DELETE SET NULL,
    plan_name VARCHAR(100), -- Direct denormalized accessor for ultra-fast kiosk lookups
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'frozen')),
    preferred_language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (preferred_language IN ('en-IN', 'kn-IN', 'hi-IN')),
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_members_code ON members(member_code);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_plan ON members(plan_id);

CREATE TRIGGER trg_members_updated
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 6. MEMBERSHIPS (Individual Subscription Contracts & Terms)
-- ==============================================================================
CREATE TABLE memberships (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES membership_plans(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NOT NULL,
    price_paid NUMERIC(10, 2) NOT NULL CHECK (price_paid >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'waived', 'refunded')),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled', 'frozen')),
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_membership_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_memberships_member ON memberships(member_id);
CREATE INDEX idx_memberships_plan ON memberships(plan_id);
CREATE INDEX idx_memberships_status ON memberships(status);
CREATE INDEX idx_memberships_dates ON memberships(start_date, end_date);

CREATE TRIGGER trg_memberships_updated
BEFORE UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 7. TRAINERS (Staff Profiles & On-Floor Status)
-- ==============================================================================
CREATE TABLE trainers (
    id SERIAL PRIMARY KEY,
    trainer_code VARCHAR(32) NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    full_name VARCHAR(120) NOT NULL,
    specialty VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(120) UNIQUE,
    bio TEXT,
    certifications TEXT[] NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'on_floor' CHECK (status IN ('on_floor', 'in_session', 'off_duty')),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trainers_status ON trainers(status);
CREATE INDEX idx_trainers_code ON trainers(trainer_code);

CREATE TRIGGER trg_trainers_updated
BEFORE UPDATE ON trainers
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 8. TRAINER SCHEDULES (Recurring Weekly Shifts)
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
    CONSTRAINT chk_shift_time CHECK (shift_end > shift_start),
    CONSTRAINT uq_trainer_day_shift UNIQUE (trainer_id, day_of_week, shift_start)
);

CREATE INDEX idx_trainer_schedules_day ON trainer_schedules(day_of_week, is_available);
CREATE INDEX idx_trainer_schedules_trainer ON trainer_schedules(trainer_id);

-- ==============================================================================
-- 9. TRAINER AVAILABILITY (Date-Specific Shifts, Exceptions & Time-Off)
-- ==============================================================================
CREATE TABLE trainer_availability (
    id SERIAL PRIMARY KEY,
    trainer_id INTEGER NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
    specific_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    reason VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_avail_time CHECK (end_time > start_time)
);

CREATE INDEX idx_trainer_avail_date ON trainer_availability(trainer_id, specific_date);
CREATE INDEX idx_trainer_avail_lookup ON trainer_availability(specific_date, is_available);

CREATE TRIGGER trg_trainer_avail_updated
BEFORE UPDATE ON trainer_availability
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 10. GYM FAQS & FAQS (Multilingual Knowledge Base)
-- ==============================================================================
CREATE TABLE gym_faqs (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (language IN ('en-IN', 'kn-IN', 'hi-IN')),
    category VARCHAR(50) NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'timings', 'pricing', 'facilities', 'trainers', 'rules')),
    suggested_gesture VARCHAR(50) NOT NULL DEFAULT 'NOD_YES',
    keywords TEXT[] NOT NULL DEFAULT '{}',
    display_order SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gym_faqs_lang ON gym_faqs(language);
CREATE INDEX idx_gym_faqs_category ON gym_faqs(category);
CREATE INDEX idx_gym_faqs_active ON gym_faqs(is_active);

CREATE TRIGGER trg_gym_faqs_updated
BEFORE UPDATE ON gym_faqs
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Compatibility table faqs for existing endpoints
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
-- 11. ANNOUNCEMENTS (Digital Noticeboard)
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
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_announcement_dates CHECK (end_date >= start_date)
);

CREATE INDEX idx_announcements_active_dates ON announcements(is_active, start_date, end_date);

CREATE TRIGGER trg_announcements_updated
BEFORE UPDATE ON announcements
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 12. MEMBER ENQUIRIES (Kiosk Lead Capture & Follow-Up)
-- ==============================================================================
CREATE TABLE member_enquiries (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120),
    plan_name VARCHAR(100),
    preferred_timing VARCHAR(50),
    notes TEXT,
    customization_type VARCHAR(100) DEFAULT 'Standard Gym Access',
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
    assigned_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_member_enquiries_status ON member_enquiries(status);
CREATE INDEX idx_member_enquiries_phone ON member_enquiries(phone);
CREATE INDEX idx_member_enquiries_created ON member_enquiries(created_at DESC);
-- One open lead per phone number; repeat kiosk enquiries update it (see createEnquiry)
CREATE UNIQUE INDEX uq_member_enquiries_open_phone
    ON member_enquiries ((regexp_replace(phone, '\D', '', 'g')))
    WHERE status IN ('new', 'contacted');

CREATE TRIGGER trg_member_enquiries_updated
BEFORE UPDATE ON member_enquiries
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 13. ROBOT DEVICES (ESP32 Hardware Registration & Pinouts)
-- ==============================================================================
CREATE TABLE robot_devices (
    id SERIAL PRIMARY KEY,
    device_uuid VARCHAR(64) NOT NULL UNIQUE,
    device_name VARCHAR(100) NOT NULL DEFAULT 'FitBot Front Desk Station',
    mac_address VARCHAR(17) UNIQUE,
    ip_address VARCHAR(45),
    api_key_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'error', 'calibrating')),
    firmware_version VARCHAR(20) NOT NULL DEFAULT '1.2.0',
    head_pan_pin SMALLINT NOT NULL DEFAULT 18,
    head_tilt_pin SMALLINT NOT NULL DEFAULT 19,
    arm_wave_pin SMALLINT NOT NULL DEFAULT 21,
    battery_level SMALLINT CHECK (battery_level BETWEEN 0 AND 100),
    wifi_rssi SMALLINT,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_devices_uuid ON robot_devices(device_uuid);
CREATE INDEX idx_robot_devices_status ON robot_devices(status);

CREATE TRIGGER trg_robot_devices_updated
BEFORE UPDATE ON robot_devices
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ==============================================================================
-- 14. ROBOT COMMANDS & LOGS (Servo Motion Queue & Hardware Telemetry)
-- ==============================================================================
CREATE TABLE robot_commands (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
    command_type VARCHAR(30) NOT NULL CHECK (command_type IN ('GESTURE', 'DIRECT_ANGLES', 'CALIBRATE', 'EMERGENCY_STOP')),
    gesture_name VARCHAR(50),
    servo_payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'executed', 'failed')),
    priority SMALLINT NOT NULL DEFAULT 1,
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'system',
    execution_time_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_commands_device_status ON robot_commands(device_id, status);
CREATE INDEX idx_robot_commands_created ON robot_commands(created_at DESC);

CREATE TRIGGER trg_robot_commands_updated
BEFORE UPDATE ON robot_commands
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Backward compatibility table robot_command_logs
CREATE TABLE robot_command_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
    command_type VARCHAR(30) NOT NULL CHECK (command_type IN ('GESTURE', 'DIRECT_ANGLES', 'CALIBRATE', 'EMERGENCY_STOP')),
    gesture_name VARCHAR(50),
    servo_payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'executed', 'failed')),
    triggered_by VARCHAR(50) NOT NULL DEFAULT 'system',
    execution_time_ms INTEGER,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_command_logs_device_status ON robot_command_logs(device_id, status);
CREATE INDEX idx_robot_command_logs_created ON robot_command_logs(created_at DESC);

-- Robot hardware diagnostic log
CREATE TABLE robot_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
    log_level VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
    event_type VARCHAR(50) NOT NULL DEFAULT 'telemetry',
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_robot_logs_device ON robot_logs(device_id, created_at DESC);
CREATE INDEX idx_robot_logs_level ON robot_logs(log_level);

-- ==============================================================================
-- 15. CHECK-INS (Physical Gym Access & Duplicate Guard)
-- ==============================================================================
CREATE TABLE check_ins (
    id BIGSERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    device_id INTEGER REFERENCES robot_devices(id) ON DELETE SET NULL,
    check_in_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_in_method VARCHAR(30) NOT NULL DEFAULT 'kiosk_voice' CHECK (check_in_method IN ('kiosk_voice', 'kiosk_manual', 'rfid_card', 'mobile_qr')),
    notes VARCHAR(200)
);

CREATE INDEX idx_check_ins_member ON check_ins(member_id);
CREATE INDEX idx_check_ins_time ON check_ins(check_in_time DESC);
CREATE INDEX idx_check_ins_member_time ON check_ins(member_id, check_in_time DESC);

-- Duplicate Check-in Guard Trigger
CREATE OR REPLACE FUNCTION fn_check_in_duplicate_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_cooldown_minutes INT := 5;
    v_recent_count INT;
BEGIN
    SELECT COALESCE(checkin_cooldown_minutes, 5) INTO v_cooldown_minutes
    FROM gym_settings WHERE id = 1;

    -- One check-in per member per calendar day (plus the short cooldown window)
    SELECT COUNT(*) INTO v_recent_count
    FROM check_ins
    WHERE member_id = NEW.member_id
      AND id <> COALESCE(NEW.id, 0)
      AND (
            check_in_time::date = NEW.check_in_time::date
         OR (v_cooldown_minutes > 0
             AND check_in_time > (NEW.check_in_time - (v_cooldown_minutes || ' minutes')::interval))
      );

    IF v_recent_count > 0 THEN
        RAISE EXCEPTION 'DUPLICATE_CHECK_IN: Member % has already checked in today.', NEW.member_id
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_in_duplicate_guard
BEFORE INSERT ON check_ins
FOR EACH ROW EXECUTE FUNCTION fn_check_in_duplicate_guard();

-- ==============================================================================
-- 16. INTERACTION LOGS (Speech AI Dialogue & Conversational Audit)
-- ==============================================================================
CREATE TABLE interaction_logs (
    id BIGSERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    device_id INTEGER REFERENCES robot_devices(id) ON DELETE SET NULL,
    session_id VARCHAR(64),
    user_query TEXT NOT NULL,
    robot_response TEXT NOT NULL,
    language VARCHAR(10) NOT NULL DEFAULT 'en-IN' CHECK (language IN ('en-IN', 'kn-IN', 'hi-IN')),
    input_method VARCHAR(20) NOT NULL DEFAULT 'voice' CHECK (input_method IN ('voice', 'text_kiosk', 'rfid_scan')),
    intent_detected VARCHAR(50),
    sentiment VARCHAR(20) DEFAULT 'neutral',
    gesture_command_id BIGINT REFERENCES robot_commands(id) ON DELETE SET NULL,
    latency_ms INTEGER,
    audio_duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interactions_created ON interaction_logs(created_at DESC);
CREATE INDEX idx_interactions_language ON interaction_logs(language);
CREATE INDEX idx_interactions_member ON interaction_logs(member_id);
CREATE INDEX idx_interactions_session ON interaction_logs(session_id);

-- ==============================================================================
-- 17. BACKWARD-COMPATIBILITY RELATIONAL VIEWS
-- ==============================================================================
CREATE OR REPLACE VIEW v_member_details AS
SELECT 
    m.id,
    m.member_code,
    m.full_name,
    m.phone,
    m.email,
    m.plan_id,
    COALESCE(m.plan_name, p.name) AS plan_name,
    p.plan_code,
    p.price_inr AS plan_price,
    m.status,
    m.preferred_language,
    m.emergency_contact_name,
    m.emergency_contact_phone,
    m.notes,
    m.created_at,
    m.updated_at
FROM members m
LEFT JOIN membership_plans p ON p.id = m.plan_id;

CREATE OR REPLACE VIEW v_faqs_unified AS
SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, created_at, updated_at
FROM gym_faqs;
