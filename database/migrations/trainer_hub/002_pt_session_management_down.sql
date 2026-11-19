-- Trainer Hub 002 DOWN: removes only what 002 added.
-- WARNING: deletes all PT packages, purchases (balances), sessions and ledger rows.
BEGIN;
DROP FUNCTION IF EXISTS fn_pt_complete_session(BIGINT, VARCHAR, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS fn_pt_reverse_session(BIGINT, INTEGER, VARCHAR);
DROP TABLE IF EXISTS pt_session_balance_ledger;
DROP TABLE IF EXISTS pt_sessions;
DROP TABLE IF EXISTS pt_package_purchases;
DROP INDEX IF EXISTS idx_pt_assign_package;
ALTER TABLE personal_trainer_assignments DROP COLUMN IF EXISTS package_id;
DROP TABLE IF EXISTS pt_packages;
COMMIT;
