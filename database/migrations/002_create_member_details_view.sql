-- ==============================================================================
-- Migration: 002_create_member_details_view.sql
-- Description: Creates a convenient, performant view linking members with their plan names
-- ==============================================================================

CREATE OR REPLACE VIEW v_member_details AS
SELECT 
    m.id,
    m.member_code,
    m.full_name,
    m.phone,
    m.email,
    m.plan_id,
    p.name AS plan_name,
    p.plan_code,
    p.price_inr AS plan_price,
    m.status,
    m.preferred_language,
    m.created_at,
    m.updated_at
FROM members m
LEFT JOIN membership_plans p ON p.id = m.plan_id;
