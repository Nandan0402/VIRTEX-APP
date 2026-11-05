-- ==============================================================================
-- Rollback Migration: 002_shared_seed_data_down.sql
-- Description: Removes seed records added by 002_shared_seed_data.sql
-- ==============================================================================

DELETE FROM robot_logs WHERE event_type IN ('boot', 'network', 'servos', 'brownout_check');
DELETE FROM robot_commands WHERE triggered_by IN ('member_checkin', 'speech_ai', 'member_checkin_declined', 'trainer_referral');
DELETE FROM member_enquiries WHERE email IN ('siddharth.rao@example.com', 'neha.hegde@example.com', 'rohan.k@example.com');
DELETE FROM trainer_availability WHERE reason IN ('Standard morning strength shift', 'Strength conditioning clinic', 'Mobility & core recovery floor duty', 'Medical leave - morning half day off', 'Evening hypertrophy & bodybuilding shift');
DELETE FROM memberships WHERE notes LIKE '%Platinum Annual membership%' OR notes LIKE '%Gold Quarterly%' OR notes LIKE '%Silver Monthly%' OR notes LIKE '%Platinum VIP%' OR notes LIKE '%Expired membership%';
DELETE FROM users WHERE username IN ('manager_priya', 'frontdesk_kavya');

