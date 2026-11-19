-- ==============================================================================
-- 020: Remove duplicate check-ins / enquiries that inflate the admin dashboard
--      KPI cards, and stop new duplicates from being written.
--
--   * check_ins        : one check-in per member per calendar day (DB timezone).
--                        Keeps the earliest check-in of the day.
--   * member_enquiries : one OPEN lead ('new' / 'contacted') per phone number.
--                        Keeps the most advanced / most recently updated row.
--                        Repeat kiosk enquiries now update that lead instead.
-- ==============================================================================

BEGIN;

-- 1. Remove same-day duplicate check-ins (keep the first one of the day)
DELETE FROM check_ins c
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY member_id, check_in_time::date
               ORDER BY check_in_time, id
           ) AS rn
    FROM check_ins
) d
WHERE c.id = d.id
  AND d.rn > 1;

-- 2. Remove duplicate open enquiries per phone number
DELETE FROM member_enquiries e
USING (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY regexp_replace(phone, '\D', '', 'g')
               ORDER BY CASE status WHEN 'contacted' THEN 0 ELSE 1 END,
                        updated_at DESC, id DESC
           ) AS rn
    FROM member_enquiries
    WHERE status IN ('new', 'contacted')
) d
WHERE e.id = d.id
  AND d.rn > 1;

-- 3. Check-in guard: keep the cooldown rule AND allow only one check-in per day
CREATE OR REPLACE FUNCTION fn_check_in_duplicate_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_cooldown_minutes INT := 5;
    v_recent_count INT;
BEGIN
    SELECT COALESCE(checkin_cooldown_minutes, 5) INTO v_cooldown_minutes
    FROM gym_settings WHERE id = 1;

    SELECT COUNT(*) INTO v_recent_count
    FROM check_ins
    WHERE member_id = NEW.member_id
      AND id <> COALESCE(NEW.id, 0)
      AND (
            check_in_time::date = NEW.check_in_time::date
         OR (v_cooldown_minutes > 0
             AND check_in_time > (NEW.check_in_time - (v_cooldown_minutes || ' minutes')::interval))
      );

    IF v_recent_count > 0 THEN
        RAISE EXCEPTION 'DUPLICATE_CHECK_IN: Member % has already checked in today.', NEW.member_id
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. One open lead per phone (digits only, so "+91 98451 12233" == "919845112233")
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_enquiries_open_phone
    ON member_enquiries ((regexp_replace(phone, '\D', '', 'g')))
    WHERE status IN ('new', 'contacted');

COMMIT;
