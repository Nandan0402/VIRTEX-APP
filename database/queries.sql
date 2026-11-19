-- ==============================================================================
-- Virtex AI Gym Receptionist Robot - Example Production SQL Queries
-- File: database/queries.sql
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FAQ / KNOWLEDGE BASE SEARCH
-- Look up answers by language and matching keywords or question text
-- ------------------------------------------------------------------------------
-- Find answering prompt for English keyword 'timings' or 'hours'
SELECT id, question, answer, language, suggested_gesture
FROM faqs
WHERE is_active = TRUE
  AND language = 'en-IN'
  AND (
      question ILIKE '%hours%' 
      OR question ILIKE '%open%' 
      OR 'timings' = ANY(keywords)
  )
ORDER BY display_order ASC
LIMIT 1;

-- ------------------------------------------------------------------------------
-- 2. ACTIVE MEMBERSHIP PLANS & PRICING
-- Fetch all active gym tiers sorted by price for kiosk display or robot speech
-- ------------------------------------------------------------------------------
SELECT 
    name, 
    duration_months, 
    price_inr, 
    badge_label, 
    is_featured, 
    array_to_string(perks, ' • ') AS perks_summary
FROM membership_plans
WHERE is_active = TRUE
ORDER BY price_inr ASC;

-- ------------------------------------------------------------------------------
-- 3. GYM OPERATING HOURS (JSONB Extraction)
-- Query operating hours from singleton gym_settings
-- ------------------------------------------------------------------------------
-- Full weekly schedule
SELECT 
    elem->>'day' AS day_of_week,
    elem->>'open' AS opens_at,
    elem->>'close' AS closes_at,
    (elem->>'is_closed')::boolean AS is_closed
FROM gym_settings,
     jsonb_array_elements(operating_hours) AS elem
WHERE id = 1;

-- Query specific day's hours (e.g. today or Sunday)
SELECT 
    elem->>'day' AS day_name,
    elem->>'open' AS opens_at,
    elem->>'close' AS closes_at
FROM gym_settings,
     jsonb_array_elements(operating_hours) AS elem
WHERE id = 1 
  AND elem->>'day' = 'Sunday';

-- ------------------------------------------------------------------------------
-- 4. TRAINER ON-FLOOR AVAILABILITY
-- Check which certified trainers are currently on the gym floor
-- ------------------------------------------------------------------------------
SELECT 
    t.trainer_code, 
    t.full_name, 
    t.specialty, 
    t.phone, 
    t.status,
    s.shift_start, 
    s.shift_end
FROM trainers t
LEFT JOIN LATERAL (
    SELECT shift_start, shift_end 
    FROM trainer_schedules 
    WHERE trainer_id = t.id 
      AND day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP)::smallint
    ORDER BY shift_start ASC
    LIMIT 1
) s ON true
WHERE t.status = 'on_floor'
ORDER BY t.full_name ASC;

-- ------------------------------------------------------------------------------
-- 5. RECENT CHECK-INS WITH MEMBER & PLAN DETAILS
-- Parameterized query used by Node.js backend check-in dashboard
-- ------------------------------------------------------------------------------
SELECT 
    c.id AS checkin_id,
    c.check_in_time,
    c.check_in_method,
    m.member_code,
    m.full_name AS member_name,
    m.phone,
    m.status AS membership_status,
    m.preferred_language,
    p.name AS plan_name
FROM check_ins c
JOIN members m ON m.id = c.member_id
LEFT JOIN membership_plans p ON p.id = m.plan_id
ORDER BY c.check_in_time DESC
LIMIT 10;

-- ------------------------------------------------------------------------------
-- 6. SECURE ADMIN PASSWORD VERIFICATION
-- Demonstrates verifying password_hash without ever exposing plaintext password
-- ------------------------------------------------------------------------------
SELECT 
    id, 
    username, 
    full_name, 
    role, 
    is_active
FROM admin_users
WHERE username = 'admin'
  AND is_active = TRUE
  AND password_hash = crypt('AdminPass2026!', password_hash); -- Returns row ONLY if password matches hash

-- ------------------------------------------------------------------------------
-- 7. RECEPTIONIST CONVERSATION & ROBOT AUDIT LOG
-- Analyzes interactions and associated motor gestures
-- ------------------------------------------------------------------------------
SELECT 
    i.id,
    i.created_at,
    i.user_query,
    i.robot_response,
    i.language,
    i.input_method,
    r.gesture_name,
    r.status AS gesture_status,
    i.latency_ms
FROM interaction_logs i
LEFT JOIN robot_command_logs r ON i.gesture_command_id = r.id
ORDER BY i.created_at DESC
LIMIT 15;

