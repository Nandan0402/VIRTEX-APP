-- ==============================================================================
-- Rollback Migration 004: Drop Real-Time Synchronization Event Logs
-- ==============================================================================

DROP TABLE IF EXISTS sync_event_logs CASCADE;

