-- ==============================================================================
-- Migration: 001_shared_schema_upgrade.sql
-- System: PulseCore Fitness AI Gym Receptionist & Admin Console
-- Target Tables:
--   1. roles (NEW)
--   2. users (NEW - enhanced replacement/bridge for admin_users)
--   3. members (ENHANCED with audit fields & constraints)
--   4. membership_plans (ENHANCED with audit fields)
--   5. memberships (NEW - subscription contract instances)
--   6. check_ins (ENHANCED with duplicate check-in guard & audit)
--   7. trainers (ENHANCED with audit fields)
--   8. trainer_schedules (ENHANCED with audit fields)
--   9. trainer_availability (NEW - date-specific availability & leave tracking)
--   10. gym_settings (ENHANCED with check-in cooldown & audit fields)
--   11. gym_faqs (NEW / ENHANCED - multilingual knowledge base)
--   12. announcements (ENHANCED with audit fields)
--   13. member_enquiries (NEW - kiosk lead capture)
--   14. interaction_logs (ENHANCED with session & sentiment tracking)
--   15. robot_devices (ENHANCED with battery & hardware telemetry)
--   16. robot_commands (NEW - motion dispatch queue)
--   17. robot_logs (NEW - hardware diagnostic and error audit trail)
--
-- Safety: Non-destructive migration preserving existing data and compatibility.
-- ==============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- ------------------------------------------------------------------------------
-- 1. ROLES TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    role_code VARCHAR(32) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(role_code);

-- Seed default system roles
INSERT INTO roles (role_code, name, description, permissions, is_system)
VALUES
    ('superadmin', 'Super Administrator', 'Full access to all facility settings, staff, hardware, and finances', '{"*"}', TRUE),
    ('manager', 'Floor Manager', 'Manage staff rosters, membership plans, FAQs, and member check-ins', '{"members.*", "trainers.*", "plans.*", "faqs.*", "reports.view"}', TRUE),
    ('trainer', 'Fitness Trainer', 'View floor assignments, member check-ins, and update personal availability', '{"trainers.self", "members.view", "schedules.view"}', TRUE),
    ('reception_staff', 'Front Desk Staff', 'Handle physical check-ins, member lookups, and visitor enquiries', '{"members.checkin", "members.create", "enquiries.*"}', TRUE)
ON CONFLICT (role_code) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 2. USERS TABLE (Shared Auth & RBAC)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'trainer',
    phone VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- Non-destructively copy existing admin_users into users
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_users' AND table_schema = 'public') THEN
        INSERT INTO users (id, username, email, password_hash, full_name, role, is_active, last_login_at, created_at, updated_at)
        SELECT 
            a.id, 
            a.username, 
            a.email, 
            a.password_hash, 
            a.full_name, 
            a.role, 
            a.is_active, 
            a.last_login_at, 
            a.created_at, 
            a.updated_at
        FROM admin_users a
        ON CONFLICT (username) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            full_name = EXCLUDED.full_name,
            role = EXCLUDED.role,
            is_active = EXCLUDED.is_active;

        -- Link role_id based on role string
        UPDATE users u
        SET role_id = r.id
        FROM roles r
        WHERE u.role = r.role_code AND u.role_id IS NULL;

        -- Ensure sequence is aligned
        PERFORM setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));
    END IF;
END $$;

-- Automatic updated_at trigger for users
DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 3. MEMBERS TABLE ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    -- Add audit fields and emergency contacts if they do not exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='emergency_contact_name') THEN
        ALTER TABLE members ADD COLUMN emergency_contact_name VARCHAR(100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='emergency_contact_phone') THEN
        ALTER TABLE members ADD COLUMN emergency_contact_phone VARCHAR(20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='notes') THEN
        ALTER TABLE members ADD COLUMN notes TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='created_by') THEN
        ALTER TABLE members ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='updated_by') THEN
        ALTER TABLE members ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_members_updated ON members;
CREATE TRIGGER trg_members_updated
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 4. MEMBERSHIP_PLANS ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membership_plans' AND column_name='created_by') THEN
        ALTER TABLE membership_plans ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='membership_plans' AND column_name='updated_by') THEN
        ALTER TABLE membership_plans ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_membership_plans_updated ON membership_plans;
CREATE TRIGGER trg_membership_plans_updated
BEFORE UPDATE ON membership_plans
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 5. MEMBERSHIPS TABLE (Active Subscription Contracts)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
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

CREATE INDEX IF NOT EXISTS idx_memberships_member ON memberships(member_id);
CREATE INDEX IF NOT EXISTS idx_memberships_plan ON memberships(plan_id);
CREATE INDEX IF NOT EXISTS idx_memberships_status ON memberships(status);
CREATE INDEX IF NOT EXISTS idx_memberships_dates ON memberships(start_date, end_date);

DROP TRIGGER IF EXISTS trg_memberships_updated ON memberships;
CREATE TRIGGER trg_memberships_updated
BEFORE UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Backfill active memberships from existing members if empty
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM memberships LIMIT 1) THEN
        INSERT INTO memberships (member_id, plan_id, start_date, end_date, price_paid, payment_status, status)
        SELECT 
            m.id,
            COALESCE(m.plan_id, 1),
            CURRENT_DATE - INTERVAL '30 days',
            CASE 
                WHEN m.status = 'expired' THEN CURRENT_DATE - INTERVAL '1 day'
                ELSE CURRENT_DATE + (COALESCE(p.duration_months, 1) * 30 || ' days')::interval
            END,
            COALESCE(p.price_inr, 2499.00),
            'paid',
            m.status
        FROM members m
        LEFT JOIN membership_plans p ON p.id = m.plan_id;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 6. CHECK_INS ENHANCEMENTS & DUPLICATE PROTECTION
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='check_ins' AND column_name='device_id') THEN
        ALTER TABLE check_ins ADD COLUMN device_id INTEGER REFERENCES robot_devices(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='check_ins' AND column_name='notes') THEN
        ALTER TABLE check_ins ADD COLUMN notes VARCHAR(200);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_check_ins_member_time ON check_ins(member_id, check_in_time DESC);

-- Duplicate Check-in Guard Function (prevents rapid double-taps within configurable cooldown)
CREATE OR REPLACE FUNCTION fn_check_in_duplicate_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_cooldown_minutes INT := 5;
    v_recent_count INT;
BEGIN
    -- Check if gym_settings has a configured cooldown window
    SELECT COALESCE(checkin_cooldown_minutes, 5) INTO v_cooldown_minutes
    FROM gym_settings WHERE id = 1;

    -- If cooldown enabled, verify no recent check-in exists for this member
    IF v_cooldown_minutes > 0 THEN
        SELECT COUNT(*) INTO v_recent_count
        FROM check_ins
        WHERE member_id = NEW.member_id
          AND check_in_time > (NEW.check_in_time - (v_cooldown_minutes || ' minutes')::interval)
          AND id <> COALESCE(NEW.id, 0);

        IF v_recent_count > 0 THEN
            RAISE EXCEPTION 'DUPLICATE_CHECK_IN: Member % already checked in within the last % minutes.',
                NEW.member_id, v_cooldown_minutes
                USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_in_duplicate_guard ON check_ins;
CREATE TRIGGER trg_check_in_duplicate_guard
BEFORE INSERT ON check_ins
FOR EACH ROW EXECUTE FUNCTION fn_check_in_duplicate_guard();

-- ------------------------------------------------------------------------------
-- 7. TRAINERS & SCHEDULES ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainers' AND column_name='created_by') THEN
        ALTER TABLE trainers ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trainers' AND column_name='updated_by') THEN
        ALTER TABLE trainers ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_trainers_updated ON trainers;
CREATE TRIGGER trg_trainers_updated
BEFORE UPDATE ON trainers
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 8. TRAINER_AVAILABILITY (Date-specific exceptions, holidays & slots)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trainer_availability (
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

CREATE INDEX IF NOT EXISTS idx_trainer_avail_date ON trainer_availability(trainer_id, specific_date);
CREATE INDEX IF NOT EXISTS idx_trainer_avail_lookup ON trainer_availability(specific_date, is_available);

DROP TRIGGER IF EXISTS trg_trainer_avail_updated ON trainer_availability;
CREATE TRIGGER trg_trainer_avail_updated
BEFORE UPDATE ON trainer_availability
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 9. GYM_SETTINGS ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gym_settings' AND column_name='checkin_cooldown_minutes') THEN
        ALTER TABLE gym_settings ADD COLUMN checkin_cooldown_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (checkin_cooldown_minutes >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gym_settings' AND column_name='wifi_ssid') THEN
        ALTER TABLE gym_settings ADD COLUMN wifi_ssid VARCHAR(64) DEFAULT 'PulseCore-Gym-Guest';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gym_settings' AND column_name='updated_by') THEN
        ALTER TABLE gym_settings ADD COLUMN updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_gym_settings_updated ON gym_settings;
CREATE TRIGGER trg_gym_settings_updated
BEFORE UPDATE ON gym_settings
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 10. GYM_FAQS TABLE (Multilingual Knowledge Base)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gym_faqs (
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

CREATE INDEX IF NOT EXISTS idx_gym_faqs_lang ON gym_faqs(language);
CREATE INDEX IF NOT EXISTS idx_gym_faqs_category ON gym_faqs(category);
CREATE INDEX IF NOT EXISTS idx_gym_faqs_active ON gym_faqs(is_active);

DROP TRIGGER IF EXISTS trg_gym_faqs_updated ON gym_faqs;
CREATE TRIGGER trg_gym_faqs_updated
BEFORE UPDATE ON gym_faqs
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Non-destructively copy from faqs into gym_faqs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'faqs' AND table_schema = 'public') THEN
        INSERT INTO gym_faqs (id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, created_at, updated_at)
        SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, created_at, updated_at
        FROM faqs
        ON CONFLICT (id) DO UPDATE SET
            question = EXCLUDED.question,
            answer = EXCLUDED.answer,
            suggested_gesture = EXCLUDED.suggested_gesture,
            keywords = EXCLUDED.keywords;

        PERFORM setval('gym_faqs_id_seq', COALESCE((SELECT MAX(id) FROM gym_faqs), 1));
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 11. ANNOUNCEMENTS ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='announcements' AND column_name='updated_at') THEN
        ALTER TABLE announcements ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='announcements' AND column_name='created_by') THEN
        ALTER TABLE announcements ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_announcements_updated ON announcements;
CREATE TRIGGER trg_announcements_updated
BEFORE UPDATE ON announcements
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 12. MEMBER_ENQUIRIES TABLE (Kiosk Lead Capture)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_enquiries (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120),
    plan_name VARCHAR(100),
    preferred_timing VARCHAR(50),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
    assigned_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_enquiries_status ON member_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_member_enquiries_phone ON member_enquiries(phone);
CREATE INDEX IF NOT EXISTS idx_member_enquiries_created ON member_enquiries(created_at DESC);

DROP TRIGGER IF EXISTS trg_member_enquiries_updated ON member_enquiries;
CREATE TRIGGER trg_member_enquiries_updated
BEFORE UPDATE ON member_enquiries
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 13. INTERACTION_LOGS ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interaction_logs' AND column_name='session_id') THEN
        ALTER TABLE interaction_logs ADD COLUMN session_id VARCHAR(64);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interaction_logs' AND column_name='sentiment') THEN
        ALTER TABLE interaction_logs ADD COLUMN sentiment VARCHAR(20) DEFAULT 'neutral';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='interaction_logs' AND column_name='audio_duration_ms') THEN
        ALTER TABLE interaction_logs ADD COLUMN audio_duration_ms INTEGER;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interaction_logs_session ON interaction_logs(session_id);

-- ------------------------------------------------------------------------------
-- 14. ROBOT_DEVICES ENHANCEMENTS
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='robot_devices' AND column_name='battery_level') THEN
        ALTER TABLE robot_devices ADD COLUMN battery_level SMALLINT CHECK (battery_level BETWEEN 0 AND 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='robot_devices' AND column_name='wifi_rssi') THEN
        ALTER TABLE robot_devices ADD COLUMN wifi_rssi SMALLINT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='robot_devices' AND column_name='is_enabled') THEN
        ALTER TABLE robot_devices ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_robot_devices_updated ON robot_devices;
CREATE TRIGGER trg_robot_devices_updated
BEFORE UPDATE ON robot_devices
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ------------------------------------------------------------------------------
-- 15. ROBOT_COMMANDS TABLE (Motion Command Dispatch & Tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS robot_commands (
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

CREATE INDEX IF NOT EXISTS idx_robot_commands_device_status ON robot_commands(device_id, status);
CREATE INDEX IF NOT EXISTS idx_robot_commands_created ON robot_commands(created_at DESC);

DROP TRIGGER IF EXISTS trg_robot_commands_updated ON robot_commands;
CREATE TRIGGER trg_robot_commands_updated
BEFORE UPDATE ON robot_commands
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Non-destructively copy from robot_command_logs into robot_commands
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'robot_command_logs' AND table_schema = 'public') THEN
        INSERT INTO robot_commands (id, device_id, command_type, gesture_name, servo_payload, status, triggered_by, execution_time_ms, error_message, created_at, updated_at)
        SELECT 
            id, device_id, command_type, gesture_name, servo_payload, status, triggered_by, execution_time_ms, error_message, created_at, created_at
        FROM robot_command_logs
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            execution_time_ms = EXCLUDED.execution_time_ms;

        PERFORM setval('robot_commands_id_seq', COALESCE((SELECT MAX(id) FROM robot_commands), 1));
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 16. ROBOT_LOGS TABLE (Hardware Diagnostics & Telemetry History)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS robot_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
    log_level VARCHAR(10) NOT NULL DEFAULT 'INFO' CHECK (log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
    event_type VARCHAR(50) NOT NULL DEFAULT 'telemetry',
    message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_robot_logs_device ON robot_logs(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_robot_logs_level ON robot_logs(log_level);
CREATE INDEX IF NOT EXISTS idx_robot_logs_event ON robot_logs(event_type);

-- ------------------------------------------------------------------------------
-- 17. BACKWARD-COMPATIBILITY RELATIONAL VIEWS
-- ------------------------------------------------------------------------------
-- View v_member_details: joins members and membership_plans to provide plan_name seamlessly
CREATE OR REPLACE VIEW v_member_details AS
SELECT 
    m.id,
    m.member_code,
    m.full_name,
    m.phone,
    m.email,
    m.plan_id,
    p.name AS plan_name,
    p.plan_code,
    p.price_inr AS plan_price,
    m.status,
    m.preferred_language,
    m.created_at,
    m.updated_at
FROM members m
LEFT JOIN membership_plans p ON p.id = m.plan_id;

-- Bi-directional compatibility view for faqs <-> gym_faqs if ever queried
CREATE OR REPLACE VIEW v_faqs_unified AS
SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, created_at, updated_at
FROM gym_faqs;

