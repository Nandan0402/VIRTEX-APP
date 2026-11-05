-- ==============================================================================
-- Migration: 001_create_enquiries_table.sql
-- Description: Create member_enquiries table for Kiosk enquiry submissions
-- Compatible with PostgreSQL 14+
-- ==============================================================================

CREATE TABLE IF NOT EXISTS member_enquiries (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(120),
    plan_name VARCHAR(100),
    preferred_timing VARCHAR(50),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_member_enquiries_status ON member_enquiries(status);
CREATE INDEX IF NOT EXISTS idx_member_enquiries_created ON member_enquiries(created_at DESC);
