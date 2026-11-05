-- ==============================================================================
-- Migration Rollback: 002_create_member_details_view_down.sql
-- Description: Drop v_member_details view
-- ==============================================================================

DROP VIEW IF EXISTS v_member_details CASCADE;
