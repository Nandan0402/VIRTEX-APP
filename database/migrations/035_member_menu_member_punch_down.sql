-- Reverts 035. WARNING: fails if any check_ins row uses 'member_portal' (delete or change those rows first),
-- and removes saved member-menu choices and check-out times. Back up first.
BEGIN;
DROP INDEX IF EXISTS idx_check_ins_member_open;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_check_in_method_check;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_check_in_method_check
  CHECK (check_in_method IN ('kiosk_voice', 'kiosk_manual', 'rfid_card', 'mobile_qr'));
ALTER TABLE check_ins DROP COLUMN IF EXISTS check_out_time;
ALTER TABLE gym_settings DROP COLUMN IF EXISTS member_menu;
COMMIT;
