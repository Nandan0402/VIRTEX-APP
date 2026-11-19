-- ==============================================================================
-- Virtex AI Gym Receptionist Robot - Complete Shared Development Seed Data
-- File: database/seed.sql
-- Compatible with PostgreSQL 14, 15, 16, 17, 18+
-- ==============================================================================

-- 1. GYM SETTINGS (Singleton facility configuration)
INSERT INTO gym_settings (
    id, gym_name, tagline, phone, email, address, operating_hours, default_language, supported_languages, speech_rate, speech_pitch, checkin_cooldown_minutes, wifi_ssid
) VALUES (
    1,
    'Virtex Fitness',
    'AI-Powered Smart Fitness Reception',
    '+91 98765 43210',
    'reception@virtexfitness.in',
    '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
    '[
        {"day": "Monday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Tuesday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Wednesday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Thursday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Friday", "open": "06:00", "close": "22:00", "is_closed": false},
        {"day": "Saturday", "open": "06:00", "close": "21:00", "is_closed": false},
        {"day": "Sunday", "open": "07:00", "close": "13:00", "is_closed": false}
    ]'::jsonb,
    'en-IN',
    '{"en-IN", "kn-IN", "hi-IN"}',
    1.00,
    1.00,
    5,
    'Virtex-Gym-Guest'
) ON CONFLICT (id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP;

-- 2. ROLES (RBAC Permissions)
INSERT INTO roles (role_code, name, description, permissions, is_system)
VALUES
    ('superadmin', 'Super Administrator', 'Full access to all facility settings, staff, hardware, and finances', '{"*"}', TRUE),
    ('manager', 'Floor Manager', 'Manage staff rosters, membership plans, FAQs, and member check-ins', '{"members.*", "trainers.*", "plans.*", "faqs.*", "reports.view"}', TRUE),
    ('trainer', 'Fitness Trainer', 'View floor assignments, member check-ins, and update personal availability', '{"trainers.self", "members.view", "schedules.view"}', TRUE),
    ('reception_staff', 'Front Desk Staff', 'Handle physical check-ins, member lookups, and visitor enquiries', '{"members.checkin", "members.create", "enquiries.*"}', TRUE)
ON CONFLICT (role_code) DO NOTHING;

-- 3. USERS & ADMIN USERS (Hashed with bcrypt/Blowfish)
-- Plaintext for local dev testing:
--   'admin' / 'AdminPass2026!'
--   'head_trainer' / 'TrainerPass2026!'
--   'manager_priya' / 'ManagerPass2026!'
--   'frontdesk_kavya' / 'StaffPass2026!'
INSERT INTO users (username, email, password_hash, full_name, role_id, role, phone, is_active)
VALUES
    ('admin', 'admin@virtexfitness.in', crypt('AdminPass2026!', gen_salt('bf', 10)), 'Dev Admin Manager', 1, 'superadmin', '+91 98765 00000', TRUE),
    ('head_trainer', 'trainer@virtexfitness.in', crypt('TrainerPass2026!', gen_salt('bf', 10)), 'Head Coach Arjun', 3, 'trainer', '+91 98765 00001', TRUE),
    ('manager_priya', 'priya.manager@virtexfitness.in', crypt('ManagerPass2026!', gen_salt('bf', 10)), 'Priya Deshmukh', 2, 'manager', '+91 98765 00010', TRUE),
    ('frontdesk_kavya', 'kavya.desk@virtexfitness.in', crypt('StaffPass2026!', gen_salt('bf', 10)), 'Kavya Gowda', 4, 'reception_staff', '+91 98765 00011', TRUE)
ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name;

INSERT INTO admin_users (username, email, password_hash, full_name, role)
VALUES
    ('admin', 'admin@virtexfitness.in', crypt('AdminPass2026!', gen_salt('bf', 10)), 'Dev Admin Manager', 'superadmin'),
    ('head_trainer', 'trainer@virtexfitness.in', crypt('TrainerPass2026!', gen_salt('bf', 10)), 'Head Coach Arjun', 'trainer')
ON CONFLICT (username) DO NOTHING;

-- 4. MEMBERSHIP PLANS
INSERT INTO membership_plans (plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks)
VALUES
    ('SILVER-01', 'Silver Monthly', 1, 2499.00, 'Starter', FALSE, TRUE, 
     ARRAY['Full Gym Floor & Cardio Access', 'Locker & Shower Facilities', 'Free Fitness Assessment']),
    ('GOLD-03', 'Gold Quarterly', 3, 5999.00, 'Popular', TRUE, TRUE, 
     ARRAY['Everything in Silver', '2 Personal Trainer Consultations', 'Nutrition & Macro Guidance', 'Steam & Sauna Access']),
    ('PLAT-12', 'Platinum Annual', 12, 18999.00, 'VIP Elite', FALSE, TRUE, 
     ARRAY['Unlimited 24/7 Access', 'Monthly 1-on-1 Trainer Session', 'Full Recovery Lounge Access', 'Free Locker for 1 Year'])
ON CONFLICT (plan_code) DO NOTHING;

-- 5. MEMBERS
INSERT INTO members (member_code, full_name, phone, email, plan_id, plan_name, status, preferred_language, emergency_contact_name, emergency_contact_phone, notes)
VALUES
    ('GYM001', 'Rahul Sharma', '9876543210', 'rahul.sharma@example.com', 3, 'Platinum Annual', 'active', 'kn-IN', 'Sunita Sharma', '9876543290', 'Morning lifter; allergic to penicillin'),
    ('GYM002', 'Priya Patel', '9876543211', 'priya.patel@example.com', 2, 'Gold Quarterly', 'active', 'hi-IN', 'Anand Patel', '9876543291', 'Interested in functional core training'),
    ('GYM003', 'David Miller', '9876543212', 'david.miller@example.com', 1, 'Silver Monthly', 'active', 'en-IN', 'Sarah Miller', '9876543292', 'Locker keycard holder'),
    ('GYM004', 'Ananya Hegde', '9876543213', 'ananya.hegde@example.com', 3, 'Platinum Annual', 'active', 'kn-IN', 'Ramesh Hegde', '9876543293', 'Referred by Coach Arjun'),
    ('GYM005', 'Vikram Singh', '9876543214', 'vikram.singh@example.com', 1, 'Silver Monthly', 'expired', 'hi-IN', 'Simran Kaur', '9876543294', 'Expired membership; renewal follow-up pending')
ON CONFLICT (member_code) DO UPDATE SET
    plan_name = EXCLUDED.plan_name,
    emergency_contact_name = EXCLUDED.emergency_contact_name;

-- 6. MEMBERSHIPS (Subscription Contracts)
INSERT INTO memberships (member_id, plan_id, start_date, end_date, price_paid, payment_status, status, auto_renew, notes)
VALUES
    (1, 3, CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '305 days', 18999.00, 'paid', 'active', TRUE, 'Platinum Annual membership with personal training voucher'),
    (2, 2, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '70 days', 5999.00, 'paid', 'active', FALSE, 'Gold Quarterly with steam & sauna perk'),
    (3, 1, CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', 2499.00, 'paid', 'active', FALSE, 'Silver Monthly starter'),
    (4, 3, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '355 days', 18999.00, 'paid', 'active', TRUE, 'Platinum VIP pass - referred by Arjun Reddy'),
    (5, 1, CURRENT_DATE - INTERVAL '40 days', CURRENT_DATE - INTERVAL '10 days', 2499.00, 'paid', 'expired', FALSE, 'Expired membership; renewal reminder sent')
ON CONFLICT DO NOTHING;

-- 7. TRAINERS (Staff Roster)
INSERT INTO trainers (trainer_code, user_id, full_name, specialty, phone, email, bio, certifications, status)
VALUES
    ('TRN001', 2, 'Arjun Reddy', 'CrossFit & Olympic Weightlifting', '9876500001', 'arjun@virtexfitness.in', 
     'CSCS Certified with 8 years of strength and high-intensity athletic conditioning experience.', 
     ARRAY['CSCS', 'CrossFit L2', 'CPR/AED'], 'on_floor'),
    ('TRN002', NULL, 'Meera Rao', 'Functional Mobility & Hatha Yoga', '9876500002', 'meera@virtexfitness.in', 
     'Specialist in postural alignment, athletic flexibility, and injury recovery.', 
     ARRAY['RYT-500', 'Core Rehab Specialist'], 'in_session'),
    ('TRN003', NULL, 'Karan Verma', 'Hypertrophy & Physique Coach', '9876500003', 'karan@virtexfitness.in', 
     'Specializes in evidence-based muscle hypertrophy and competition prep.', 
     ARRAY['ACE Personal Trainer', 'ISSN Sports Nutritionist'], 'off_duty')
ON CONFLICT (trainer_code) DO NOTHING;

-- 8. TRAINER SCHEDULES (Weekly Shifts)
INSERT INTO trainer_schedules (trainer_id, day_of_week, shift_start, shift_end, is_available, notes)
VALUES
    (1, 1, '06:00:00', '14:00:00', TRUE, 'Morning strength floor shift'),
    (1, 2, '06:00:00', '14:00:00', TRUE, 'Morning strength floor shift'),
    (1, 3, '06:00:00', '14:00:00', TRUE, 'Morning strength floor shift'),
    (1, 4, '06:00:00', '14:00:00', TRUE, 'Morning strength floor shift'),
    (1, 5, '06:00:00', '14:00:00', TRUE, 'Morning strength floor shift'),
    (2, 1, '08:00:00', '16:00:00', TRUE, 'Mid-day mobility clinic'),
    (2, 3, '08:00:00', '16:00:00', TRUE, 'Mid-day mobility clinic'),
    (2, 5, '08:00:00', '16:00:00', TRUE, 'Mid-day mobility clinic'),
    (3, 2, '14:00:00', '22:00:00', TRUE, 'Evening hypertrophy shift'),
    (3, 4, '14:00:00', '22:00:00', TRUE, 'Evening hypertrophy shift'),
    (3, 6, '13:00:00', '21:00:00', TRUE, 'Saturday weekend coaching')
ON CONFLICT DO NOTHING;

-- 9. TRAINER AVAILABILITY (Date-specific exceptions and clinics)
INSERT INTO trainer_availability (trainer_id, specific_date, start_time, end_time, is_available, reason)
VALUES
    (1, CURRENT_DATE, '06:00:00', '14:00:00', TRUE, 'Standard morning strength shift'),
    (1, CURRENT_DATE + INTERVAL '1 day', '06:00:00', '14:00:00', TRUE, 'Strength conditioning clinic'),
    (2, CURRENT_DATE, '08:00:00', '16:00:00', TRUE, 'Mobility & core recovery floor duty'),
    (2, CURRENT_DATE + INTERVAL '2 days', '08:00:00', '12:00:00', FALSE, 'Medical leave - morning half day off'),
    (3, CURRENT_DATE, '14:00:00', '22:00:00', TRUE, 'Evening hypertrophy & bodybuilding shift')
ON CONFLICT DO NOTHING;

-- 10. GYM FAQS & FAQS (Multilingual Knowledge Base)
INSERT INTO gym_faqs (question, answer, language, category, suggested_gesture, keywords, display_order)
VALUES
    ('What are your gym operating hours?', 'We are open Monday through Saturday from 6:00 AM to 10:00 PM, and Sundays from 7:00 AM to 1:00 PM.', 'en-IN', 'timings', 'NOD_YES', ARRAY['hours', 'timing', 'open', 'close', 'schedule'], 1),
    ('How much are the membership plans?', 'We offer Silver Monthly at ₹2,499, Gold Quarterly at ₹5,999, and Platinum Annual at ₹18,999 with 24/7 access.', 'en-IN', 'pricing', 'NOD_YES', ARRAY['membership', 'price', 'fee', 'cost', 'plans'], 2),
    ('Are certified personal trainers available?', 'Yes! Certified trainers Arjun Reddy and Meera Rao are available on the workout floor right now.', 'en-IN', 'trainers', 'LOOK_RIGHT', ARRAY['trainer', 'coach', 'personal trainer', 'guidance'], 3),
    ('Do you provide lockers and showers?', 'Yes, RFID digital lockers and hot water shower facilities are available in both locker rooms.', 'en-IN', 'facilities', 'NOD_YES', ARRAY['locker', 'shower', 'changing room', 'bags'], 4),
    ('ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?', 'ನಮ್ಮ ಜಿಮ್ ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ ಬೆಳಿಗ್ಗೆ 6:00 ರಿಂದ ರಾತ್ರಿ 10:00 ರವರೆಗೆ ಮತ್ತು ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 7:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.', 'kn-IN', 'timings', 'NOD_YES', ARRAY['ಸಮಯ', 'ತೆರೆಯುವುದು', 'ಬೆಳಿಗ್ಗೆ', 'ರಾತ್ರಿ'], 1),
    ('ಸದಸ್ಯತ್ವ ಶುಲ್ಕ ಎಷ್ಟು?', 'ನಾವು ಮಾಸಿಕ ಸಿಲ್ವರ್ ₹2,499, ತ್ರೈಮಾಸಿಕ ಗೋಲ್ಡ್ ₹5,999 ಮತ್ತು ವಾರ್ಷಿಕ ಪ್ಲಾಟಿನಂ ₹18,999 ಯೋಜನೆಗಳನ್ನು ಹೊಂದಿದ್ದೇವೆ.', 'kn-IN', 'pricing', 'NOD_YES', ARRAY['ಶುಲ್ಕ', 'ಯೋಜನೆ', 'ಬೆಲೆ'], 2),
    ('जिम का समय क्या है?', 'हमारा जिम सोमवार से शनिवार सुबह 6:00 से रात 10:00 बजे तक और रविवार को सुबह 7:00 से दोपहर 1:00 बजे तक खुला रहता है।', 'hi-IN', 'timings', 'NOD_YES', ARRAY['समय', 'टाइमिंग', 'खुला'], 1),
    ('मेंबरशिप की फीस कितनी है?', 'सिल्वर मंथली ₹2,499, गोल्ड क्वार्टरली ₹5,999 और प्लैटिनम एनुअल ₹18,999 में उपलब्ध है।', 'hi-IN', 'pricing', 'NOD_YES', ARRAY['फीस', 'प्लान', 'दाम', 'कीमत'], 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO faqs (id, question, answer, language, category, suggested_gesture, keywords, display_order)
SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order
FROM gym_faqs
ON CONFLICT (id) DO NOTHING;

-- 11. ANNOUNCEMENTS
INSERT INTO announcements (title, message, priority, target_language, start_date, end_date, is_active)
VALUES
    ('Diwali Transformation Challenge', 'Registration is open for our 30-Day Lean & Strong Bootcamp! Free fitness trackers for the first 25 sign-ups.', 'event', 'all', CURRENT_DATE, CURRENT_DATE + INTERVAL '21 days', TRUE),
    ('Steam Room Routine Maintenance', 'The recovery steam room will undergo routine sanitization this Thursday from 2:00 PM to 4:00 PM.', 'maintenance', 'all', CURRENT_DATE, CURRENT_DATE + INTERVAL '3 days', TRUE)
ON CONFLICT DO NOTHING;

-- 12. MEMBER ENQUIRIES (Kiosk Leads)
INSERT INTO member_enquiries (full_name, phone, email, plan_name, preferred_timing, notes, status, assigned_trainer_id)
VALUES
    ('Siddharth Rao', '+91 98450 12345', 'siddharth.rao@example.com', 'Platinum Annual', 'Evening (6 PM - 8 PM)', 'Interested in personal Olympic lifting coaching', 'new', 1),
    ('Neha Hegde', '+91 98450 67890', 'neha.hegde@example.com', 'Gold Quarterly', 'Morning (7 AM - 9 AM)', 'Interested in functional yoga & posture rehab', 'contacted', 2),
    ('Rohan Kulkarni', '+91 98450 99887', 'rohan.k@example.com', 'Silver Monthly', 'Flexible', 'Walked in via kiosk, requested facility tour', 'new', NULL)
ON CONFLICT DO NOTHING;

-- 13. ROBOT DEVICES (ESP32 DevKit V1 Base Hardware)
INSERT INTO robot_devices (
    device_uuid, device_name, mac_address, ip_address, api_key_hash, status, firmware_version, head_pan_pin, head_tilt_pin, arm_wave_pin, battery_level, wifi_rssi, is_enabled, last_heartbeat
) VALUES (
    'ESP32_RECEPTION_01',
    'FitBot Front Desk Station',
    '24:6F:28:B1:C4:80',
    '192.168.1.150',
    crypt('gym_robot_secret_key_12345', gen_salt('bf', 8)),
    'online',
    '1.2.0',
    18,
    19,
    21,
    92,
    -58,
    TRUE,
    CURRENT_TIMESTAMP
) ON CONFLICT (device_uuid) DO NOTHING;

-- 14. ROBOT COMMANDS & LOGS
INSERT INTO robot_commands (device_id, command_type, gesture_name, servo_payload, status, priority, triggered_by, execution_time_ms)
VALUES
    (1, 'GESTURE', 'GREET_WAVE', '{"headPan": 90, "headTilt": 80, "armWave": 120, "delayMs": 250}'::jsonb, 'executed', 1, 'check_in', 980),
    (1, 'GESTURE', 'NOD_YES', '{"headPan": 90, "headTilt": 70, "armWave": 10, "delayMs": 200}'::jsonb, 'executed', 2, 'speech_ai', 820),
    (1, 'GESTURE', 'LOOK_RIGHT', '{"headPan": 40, "headTilt": 90, "armWave": 10, "delayMs": 400}'::jsonb, 'executed', 3, 'speech_ai', 450)
ON CONFLICT DO NOTHING;

INSERT INTO robot_command_logs (device_id, command_type, gesture_name, servo_payload, status, triggered_by, execution_time_ms)
SELECT device_id, command_type, gesture_name, servo_payload, status, triggered_by, execution_time_ms
FROM robot_commands
ON CONFLICT DO NOTHING;

INSERT INTO robot_logs (device_id, log_level, event_type, message, payload)
VALUES
    (1, 'INFO', 'boot', 'ESP32 DevKit V1 booted successfully. Firmware v1.2.0.', '{"heap_free": 184520, "reset_reason": "POWERON_RESET"}'::jsonb),
    (1, 'INFO', 'network', 'Wi-Fi link established with Virtex-AP. RSSI -58 dBm.', '{"ip": "192.168.1.150", "mac": "24:6F:28:B1:C4:80"}'::jsonb),
    (1, 'INFO', 'servos', 'SG90 servo timers calibrated. Neutral angles initialized (90, 90, 10).', '{"servos": {"headPan": 90, "headTilt": 90, "armWave": 10}}'::jsonb),
    (1, 'WARN', 'brownout_check', 'Current spike detected during concurrent arm wave; smoothed via 470uF decoupling capacitor.', '{"current_ma_peak": 1280, "rail_voltage": 4.96}'::jsonb)
ON CONFLICT DO NOTHING;

-- 15. CHECK-INS
INSERT INTO check_ins (member_id, check_in_time, check_in_method)
VALUES
    (1, CURRENT_TIMESTAMP - INTERVAL '3 hours', 'kiosk_voice'),
    (2, CURRENT_TIMESTAMP - INTERVAL '2 hours', 'kiosk_voice'),
    (3, CURRENT_TIMESTAMP - INTERVAL '45 minutes', 'kiosk_manual'),
    (4, CURRENT_TIMESTAMP - INTERVAL '10 minutes', 'kiosk_voice')
ON CONFLICT DO NOTHING;

-- 16. INTERACTION LOGS
INSERT INTO interaction_logs (member_id, device_id, user_query, robot_response, language, input_method, intent_detected, gesture_command_id, latency_ms)
VALUES
    (1, 1, 'Member Check-In: GYM001', 'ಸ್ವಾಗತ Rahul Sharma! ನಿಮ್ಮ ಇಂದಿನ ತರಬೇತಿ ಫಲಪ್ರದವಾಗಲಿ!', 'kn-IN', 'voice', 'member_checkin', 1, 320),
    (NULL, 1, 'What are your gym operating hours?', 'We are open Monday through Saturday from 6:00 AM to 10:00 PM, and Sundays from 7:00 AM to 1:00 PM.', 'en-IN', 'voice', 'gym_timings', 2, 280),
    (2, 1, 'Member Check-In: GYM002', 'स्वागत है Priya Patel! आपका आज का वर्कआउट बेहतरीन रहे!', 'hi-IN', 'voice', 'member_checkin', 1, 310)
ON CONFLICT DO NOTHING;
