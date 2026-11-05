-- ==============================================================================
-- Migration Rollback: 001_create_enquiries_table_down.sql
-- Description: Drop member_enquiries table
-- ==============================================================================

DROP TABLE IF EXISTS member_enquiries CASCADE;
