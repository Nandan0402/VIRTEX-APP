-- ==============================================================================
-- Migration: 002_shared_seed_data.sql
-- Description: Development Seed Data for Shared PulseCore Kiosk & Admin Schema
-- ==============================================================================

-- 1. USERS & ROLES
-- Ensure manager and receptionist staff exist with hashed passwords (bcrypt: 'ManagerPass2026!' & 'StaffPass2026!')
INSERT INTO users (username, email, password_hash, full_name, role_id, role, phone, is_active)
VALUES
    ('manager_priya', 'priya.manager@pulsecorefitness.in', crypt('ManagerPass2026!', gen_salt('bf', 10)), 'Priya Deshmukh', 
     (SELECT id FROM roles WHERE role_code = 'manager'), 'manager', '+91 98765 00010', TRUE),
    ('frontdesk_kavya', 'kavya.desk@pulsecorefitness.in', crypt('StaffPass2026!', gen_salt('bf', 10)), 'Kavya Gowda', 
     (SELECT id FROM roles WHERE role_code = 'reception_staff'), 'reception_staff', '+91 98765 00011', TRUE)
ON CONFLICT (username) DO NOTHING;

-- 2. MEMBERSHIPS (Active & History Contracts)
INSERT INTO memberships (member_id, plan_id, start_date, end_date, price_paid, payment_status, status, auto_renew, notes)
VALUES
    (1, 3, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '305 days', 18999.00, 'paid', 'active', TRUE, 'Platinum Annual membership with personal training voucher'),
    (2, 2, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '70 days', 5999.00, 'paid', 'active', FALSE, 'Gold Quarterly with steam & sauna perk'),
    (3, 1, CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', 2499.00, 'paid', 'active', FALSE, 'Silver Monthly starter'),
    (4, 3, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '355 days', 18999.00, 'paid', 'active', TRUE, 'Platinum VIP pass - referred by Arjun Reddy'),
    (5, 1, CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '10 days', 2499.00, 'paid', 'expired', FALSE, 'Expired membership; renewal reminder sent')
ON CONFLICT DO NOTHING;

-- 3. TRAINER AVAILABILITY (Date-specific shifts and time-off)
INSERT INTO trainer_availability (trainer_id, specific_date, start_time, end_time, is_available, reason)
VALUES
    (1, CURRENT_DATE, '06:00:00', '14:00:00', TRUE, 'Standard morning strength shift'),
    (1, CURRENT_DATE + INTERVAL '1 day', '06:00:00', '14:00:00', TRUE, 'Strength conditioning clinic'),
    (2, CURRENT_DATE, '08:00:00', '16:00:00', TRUE, 'Mobility & core recovery floor duty'),
    (2, CURRENT_DATE + INTERVAL '2 days', '08:00:00', '12:00:00', FALSE, 'Medical leave - morning half day off'),
    (3, CURRENT_DATE, '14:00:00', '22:00:00', TRUE, 'Evening hypertrophy & bodybuilding shift')
ON CONFLICT DO NOTHING;

-- 4. MEMBER ENQUIRIES (Kiosk Leads)
INSERT INTO member_enquiries (full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id)
VALUES
    ('Siddharth Rao', '+91 98450 12345', 'siddharth.rao@example.com', 'Platinum Annual', 'Evening (6 PM - 8 PM)', 'Interested in personal Olympic lifting coaching', 'new', 1),
    ('Neha Hegde', '+91 98450 67890', 'neha.hegde@example.com', 'Gold Quarterly', 'Morning (7 AM - 9 AM)', 'Interested in functional yoga & posture rehab', 'contacted', 2),
    ('Rohan Kulkarni', '+91 98450 99887', 'rohan.k@example.com', 'Silver Monthly', 'Flexible', 'Walked in via kiosk, requested facility tour', 'new', NULL)
ON CONFLICT DO NOTHING;

-- 5. ROBOT COMMANDS (Sample queued & executed motions)
INSERT INTO robot_commands (device_id, command_type, gesture_name, servo_payload, status, priority, triggered_by, execution_time_ms)
VALUES
    (1, 'GESTURE', 'GREET_WAVE', '{"headPan": 90, "headTilt": 80, "armWave": 120, "delayMs": 250}'::jsonb, 'executed', 1, 'member_checkin', 950),
    (1, 'GESTURE', 'NOD_YES', '{"headPan": 90, "headTilt": 70, "armWave": 10, "delayMs": 200}'::jsonb, 'executed', 2, 'speech_ai', 810),
    (1, 'GESTURE', 'SHAKE_NO', '{"headPan": 60, "headTilt": 90, "armWave": 10, "delayMs": 200}'::jsonb, 'executed', 1, 'member_checkin_declined', 780),
    (1, 'GESTURE', 'LOOK_RIGHT', '{"headPan": 40, "headTilt": 90, "armWave": 10, "delayMs": 300}'::jsonb, 'executed', 3, 'trainer_referral', 420)
ON CONFLICT DO NOTHING;

-- 6. ROBOT LOGS (Telemetry & Hardware Diagnostics)
INSERT INTO robot_logs (device_id, log_level, event_type, message, payload)
VALUES
    (1, 'INFO', 'boot', 'ESP32 DevKit V1 booted successfully. Firmware v1.2.0.', '{"heap_free": 184520, "reset_reason": "POWERON_RESET"}'::jsonb),
    (1, 'INFO', 'network', 'Wi-Fi link established with PulseCore-AP. RSSI -58 dBm.', '{"ip": "192.168.1.150", "mac": "24:6F:28:B1:C4:80"}'::jsonb),
    (1, 'INFO', 'servos', 'SG90 servo timers calibrated. Neutral angles initialized (90, 90, 10).', '{"servos": {"headPan": 90, "headTilt": 90, "armWave": 10}}'::jsonb),
    (1, 'WARN', 'brownout_check', 'Current spike detected during concurrent arm wave; smoothed via 470uF decoupling capacitor.', '{"current_ma_peak": 1280, "rail_voltage": 4.96}'::jsonb)
ON CONFLICT DO NOTHING;

