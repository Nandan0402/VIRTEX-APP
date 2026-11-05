-- ==============================================================================
-- Rollback Migration: 001_shared_schema_upgrade_down.sql
-- Description: Cleanly removes new tables, triggers, and views added by 001_shared_schema_upgrade.sql
-- Base tables (admin_users, members, membership_plans, faqs, gym_settings, announcements, check_ins, etc.) are PRESERVED.
-- ==============================================================================

-- Drop views
DROP VIEW IF EXISTS v_faqs_unified CASCADE;
DROP VIEW IF EXISTS v_member_details CASCADE;

-- Drop new tables created in upgrade
DROP TABLE IF EXISTS robot_logs CASCADE;
DROP TABLE IF EXISTS robot_commands CASCADE;
DROP TABLE IF EXISTS member_enquiries CASCADE;
DROP TABLE IF EXISTS gym_faqs CASCADE;
DROP TABLE IF EXISTS trainer_availability CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- Drop triggers added to existing tables
DROP TRIGGER IF EXISTS trg_check_in_duplicate_guard ON check_ins;
DROP TRIGGER IF EXISTS trg_members_updated ON members;
DROP TRIGGER IF EXISTS trg_membership_plans_updated ON membership_plans;
DROP TRIGGER IF EXISTS trg_trainers_updated ON trainers;
DROP TRIGGER IF EXISTS trg_gym_settings_updated ON gym_settings;
DROP TRIGGER IF EXISTS trg_announcements_updated ON announcements;
DROP TRIGGER IF EXISTS trg_robot_devices_updated ON robot_devices;

-- Drop functions
DROP FUNCTION IF EXISTS fn_check_in_duplicate_guard() CASCADE;
DROP FUNCTION IF EXISTS fn_update_timestamp() CASCADE;

-- Note: Columns added to base tables (e.g. check_ins.device_id, members.notes)
-- are intentionally retained to avoid data loss, or can be dropped if strict schema parity is needed.

