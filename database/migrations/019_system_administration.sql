-- ==============================================================================
-- 019_system_administration.sql
-- Migration 019: System Administration, Audit Logging, Backups, Error Tracking,
-- Data Export Utilities, and Integration Health Status
-- ==============================================================================

-- 1. System Database Backups Ledger
CREATE TABLE IF NOT EXISTS system_backups (
    id SERIAL PRIMARY KEY,
    backup_name VARCHAR(120) NOT NULL UNIQUE,
    backup_type VARCHAR(30) NOT NULL DEFAULT 'daily_automated' CHECK (backup_type IN ('manual', 'daily_automated', 'weekly_archive', 'pre_migration')),
    file_path VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'in_progress', 'failed', 'verified')),
    checksum VARCHAR(64),
    tables_included TEXT[] NOT NULL DEFAULT '{"all"}',
    created_by VARCHAR(50) DEFAULT 'system_cron',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_backups_created ON system_backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_backups_status ON system_backups(status);

-- 2. System Application Error Monitoring
CREATE TABLE IF NOT EXISTS system_error_logs (
    id BIGSERIAL PRIMARY KEY,
    error_code VARCHAR(64),
    error_type VARCHAR(50) NOT NULL DEFAULT 'HTTP_500' CHECK (error_type IN ('HTTP_500', 'DB_CONNECTION_ERROR', 'API_TIMEOUT', 'AUTH_ERROR', 'HARDWARE_TIMEOUT', 'UNHANDLED_EXCEPTION')),
    message TEXT NOT NULL,
    endpoint VARCHAR(255),
    http_method VARCHAR(10),
    stack_trace TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'investigating', 'resolved', 'ignored')),
    occurrence_count INT NOT NULL DEFAULT 1,
    resolved_by VARCHAR(50),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_error_logs_created ON system_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_status ON system_error_logs(status);
CREATE INDEX IF NOT EXISTS idx_system_error_logs_type ON system_error_logs(error_type);

-- 3. Data Export Audit Ledger
CREATE TABLE IF NOT EXISTS system_export_logs (
    id SERIAL PRIMARY KEY,
    export_name VARCHAR(120) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('members', 'check_ins', 'finances', 'audit_logs', 'equipment', 'staff', 'telemetry')),
    export_format VARCHAR(10) NOT NULL DEFAULT 'json' CHECK (export_format IN ('csv', 'json')),
    record_count INT NOT NULL DEFAULT 0,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    exported_by VARCHAR(50) NOT NULL,
    sanitized_fields TEXT[] NOT NULL DEFAULT '{"password_hash", "api_key_hash", "jwt_tokens", "sensitive_member_pii"}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_export_logs_created ON system_export_logs(created_at DESC);

-- 4. Seed Initial Backup Records
INSERT INTO system_backups (backup_name, backup_type, file_path, file_size_bytes, status, checksum, tables_included, created_by, notes)
VALUES
    ('virtex_db_full_20261108_0200.dump', 'daily_automated', 'C:/Users/user/.gemini/antigravity/backups/virtex_db_full_20261108_0200.dump', 14859000, 'verified', 'a7f3c8e9d1234567890abcdef1234567890abcdef1234567890abcdef1234567', '{"all"}', 'system_cron', 'Daily automated full snapshot verified by checksum'),
    ('virtex_db_full_20261109_0200.dump', 'daily_automated', 'C:/Users/user/.gemini/antigravity/backups/virtex_db_full_20261109_0200.dump', 15242000, 'completed', 'b8e4d9f0e2345678901bcdef2345678901bcdef2345678901bcdef2345678901', '{"all"}', 'system_cron', 'Daily automated full snapshot verified clean'),
    ('virtex_db_pre_module18_manual.dump', 'pre_migration', 'C:/Users/user/.gemini/antigravity/backups/virtex_db_pre_module18_manual.dump', 15120000, 'verified', 'c9f5e0a1f3456789012cdef3456789012cdef3456789012cdef3456789012cde', '{"all"}', 'owner_manju', 'Manual pre-migration snapshot before robotics module deployment')
ON CONFLICT (backup_name) DO NOTHING;

-- 5. Seed Initial System Error Logs
INSERT INTO system_error_logs (error_code, error_type, message, endpoint, http_method, stack_trace, status, occurrence_count)
VALUES
    ('ESP32_WS_DROPOUT', 'HARDWARE_TIMEOUT', 'WebSocket connection keep-alive timeout from ESP32 node 192.168.1.150', '/ws/robot', 'WS', 'Error: Keep-alive ping unacknowledged after 15000ms at WebSocketServer.pingChecker', 'resolved', 2),
    ('RATE_LIMIT_BURST', 'AUTH_ERROR', 'Rate limit exceeded for prospect enquiry submission from IP 192.168.1.45', '/api/v1/gym/enquiries', 'POST', 'Error: Rate limit exceeded (100 requests per 15m) at apiRateLimiter', 'investigating', 4),
    ('GEMINI_OVERLOAD_FALLBACK', 'API_TIMEOUT', 'Gemini API HTTP 503 Service Unavailable, engaged grounded fallback response', '/api/v1/chat', 'POST', 'Error: Gemini API error (HTTP 503): Backend service overloaded at callGeminiAPI', 'resolved', 1)
ON CONFLICT DO NOTHING;

-- 6. Seed Initial Data Export Logs
INSERT INTO system_export_logs (export_name, entity_type, export_format, record_count, file_size_bytes, exported_by, sanitized_fields)
VALUES
    ('members_active_roster_20261108.json', 'members', 'json', 24, 18500, 'owner_manju', '{"password_hash", "api_key_hash"}'),
    ('check_ins_monthly_october_2026.csv', 'check_ins', 'csv', 184, 14200, 'owner_manju', '{"internal_device_keys"}'),
    ('finance_dues_ledger_20261109.csv', 'finances', 'csv', 42, 6800, 'owner_manju', '{"payment_gateway_secrets"}')
ON CONFLICT DO NOTHING;

-- 7. Ensure Diverse Auth Audit Logs for Viewer & Login History
INSERT INTO auth_audit_logs (user_id, username, event_type, role, ip_address, user_agent, details)
VALUES
    ((SELECT id FROM users WHERE username = 'owner_manju' LIMIT 1), 'owner_manju', 'LOGIN_SUCCESS', 'owner', '192.168.1.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', '{"login_method": "password_jwt"}'),
    ((SELECT id FROM users WHERE username = 'manager_priya' LIMIT 1), 'manager_priya', 'LOGIN_SUCCESS', 'manager', '192.168.1.12', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/128.0', '{"login_method": "password_jwt"}'),
    (NULL, 'unknown_intruder', 'LOGIN_FAILURE', 'guest', '203.0.113.88', 'curl/8.4.0', '{"reason": "INVALID_CREDENTIALS", "attempted_user": "admin"}'),
    (NULL, 'unknown_intruder', 'LOGIN_FAILURE', 'guest', '203.0.113.88', 'curl/8.4.0', '{"reason": "INVALID_CREDENTIALS", "attempted_user": "root"}'),
    ((SELECT id FROM users WHERE username = 'trainer_rohit' LIMIT 1), 'trainer_rohit', 'LOGIN_SUCCESS', 'trainer', '192.168.1.25', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Mobile/15E148', '{"login_method": "mobile_app"}'),
    ((SELECT id FROM users WHERE username = 'owner_manju' LIMIT 1), 'owner_manju', 'SETTINGS_UPDATED', 'owner', '192.168.1.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '{"section": "operating_hours", "change": "Sunday closing 13:00"}'),
    ((SELECT id FROM users WHERE username = 'owner_manju' LIMIT 1), 'owner_manju', 'DATA_EXPORT', 'owner', '192.168.1.10', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '{"entity": "members", "format": "json", "sanitized": true}')
ON CONFLICT DO NOTHING;

