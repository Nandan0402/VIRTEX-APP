-- 035_member_menu_member_punch.sql  (additive — no rows change)
--
-- 1. gym_settings.member_menu (JSONB): which Member Portal menu items the admin switches on, separately for
--    personal-training members and general members, e.g.
--      {"personal": {"diet-plans": false, "progress-menu": false, ...}, "general": {...}}
--    NULL = defaults (personal: everything except Diet and Progress; general: everything).
-- 2. Member Punch In / Punch Out from the Member Portal, recorded in the EXISTING check_ins table:
--    check_ins.check_out_time (new, nullable) and a new allowed check_in_method 'member_portal'.
--    The method rule is replaced by a SUPERSET of the old one (all existing values stay valid).

BEGIN;

ALTER TABLE gym_settings ADD COLUMN IF NOT EXISTS member_menu JSONB;

ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS check_out_time TIMESTAMPTZ;
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'check_ins'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%check_in_method%';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE check_ins DROP CONSTRAINT %I', c); END IF;
  ALTER TABLE check_ins ADD CONSTRAINT check_ins_check_in_method_check
    CHECK (check_in_method IN ('kiosk_voice', 'kiosk_manual', 'rfid_card', 'mobile_qr', 'member_portal'));
END $$;
CREATE INDEX IF NOT EXISTS idx_check_ins_member_open ON check_ins(member_id, check_in_time DESC) WHERE check_out_time IS NULL;

COMMIT;
