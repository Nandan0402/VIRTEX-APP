-- ==============================================================================
-- Migration 004: Real-Time Synchronization Event Logs
-- Tracks WebSocket & SSE sync events broadcast between Admin Console, Kiosk & Robot
-- ==============================================================================

CREATE TABLE IF NOT EXISTS sync_event_logs (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'all',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    triggered_by VARCHAR(64) DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_event_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_sync_events_channel ON sync_event_logs (channel);
CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_event_logs (created_at DESC);

COMMENT ON TABLE sync_event_logs IS 'Persistent event log for real-time synchronization between Admin, Kiosk and Hardware';
