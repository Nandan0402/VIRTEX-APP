-- ==============================================================================
-- 003_auth_rbac_upgrade.sql
-- Non-destructive RBAC Expansion, Token Blacklist, and Authentication Audit Logs
-- ==============================================================================

-- 1. Ensure all standard RBAC roles are present
INSERT INTO roles (role_code, name, description, permissions, is_system)
VALUES
    ('owner', 'Gym Owner', 'Full unrestricted facility, staff, hardware, financial, and administrative control', '{"*"}', TRUE),
    ('manager', 'Floor Manager', 'Manage gym floor operations, member accounts, trainer schedules, announcements, and robot gestures', '{"members:*", "trainers:*", "schedules:*", "plans:*", "faqs:*", "announcements:*", "enquiries:*", "robot:commands", "robot:read", "reports:view"}', TRUE),
    ('trainer', 'Fitness Trainer', 'View assigned schedules, update personal availability, access permitted member info, and view robot telemetry', '{"schedules:read", "schedules:write:self", "trainers:read:self", "trainers:status:self", "members:read:permitted", "robot:read"}', TRUE),
    ('member', 'Gym Member', 'View own membership details, access personal check-in history, execute turnstile check-in, and submit enquiries', '{"members:read:self", "members:checkin:self", "memberships:read:self", "enquiries:create"}', TRUE),
    ('guest', 'Guest Visitor', 'Browse public gym profile, view active membership pricing tiers, read multilingual FAQs, and submit prospect leads', '{"gym:read", "faqs:read", "plans:read", "enquiries:create"}', TRUE)
ON CONFLICT (role_code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    permissions = EXCLUDED.permissions;

-- 2. Add relational links on users to members and trainers
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_member_id ON users(member_id);
CREATE INDEX IF NOT EXISTS idx_users_trainer_id ON users(trainer_id);

-- 3. Token Blacklist Table (For immediate revocation on logout or compromise)
CREATE TABLE IF NOT EXISTS token_blacklist (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(64) NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(jti);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);

-- 4. Authentication Audit Logs Table
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'TOKEN_REVOKED', 'ACCESS_DENIED'
    role VARCHAR(32),
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event ON auth_audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_logs(created_at DESC);

-- 5. Seed Core Role Users for Local Development & Testing
-- Hashed using pgcrypto gen_salt('bf', 10)
INSERT INTO users (username, email, password_hash, full_name, role_id, role, phone, is_active, member_id, trainer_id)
VALUES
    ('owner_manju', 'owner@pulsecorefitness.in', crypt('OwnerPass2026!', gen_salt('bf', 10)), 'Manju Owner', (SELECT id FROM roles WHERE role_code = 'owner'), 'owner', '+91 99000 00001', TRUE, NULL, NULL),
    ('member_rahul', 'rahul.sharma@example.com', crypt('MemberPass2026!', gen_salt('bf', 10)), 'Rahul Sharma', (SELECT id FROM roles WHERE role_code = 'member'), 'member', '9876543210', TRUE, 1, NULL)
ON CONFLICT (username) DO UPDATE SET
    role = EXCLUDED.role,
    role_id = EXCLUDED.role_id,
    password_hash = EXCLUDED.password_hash,
    member_id = EXCLUDED.member_id,
    trainer_id = EXCLUDED.trainer_id;

-- Link existing head_trainer to trainer ID 1
UPDATE users
SET trainer_id = 1, role_id = (SELECT id FROM roles WHERE role_code = 'trainer')
WHERE username = 'head_trainer';

