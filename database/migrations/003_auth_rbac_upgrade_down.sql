-- ==============================================================================
-- 003_auth_rbac_upgrade_down.sql
-- Rollback for RBAC tables and token blacklist
-- ==============================================================================

DELETE FROM users WHERE username IN ('owner_manju', 'member_rahul');
DROP TABLE IF EXISTS token_blacklist CASCADE;
DROP TABLE IF EXISTS auth_audit_logs CASCADE;

ALTER TABLE users DROP COLUMN IF EXISTS member_id CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS trainer_id CASCADE;
