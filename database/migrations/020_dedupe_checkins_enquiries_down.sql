-- Reverts the guards added in 020 (deleted duplicate rows are NOT restored;
-- see backups/dedupe_*.json for the removed rows).
BEGIN;

DROP INDEX IF EXISTS uq_member_enquiries_open_phone;

CREATE OR REPLACE FUNCTION fn_check_in_duplicate_guard()
RETURNS TRIGGER AS $$
DECLARE
    v_cooldown_minutes INT := 5;
    v_recent_count INT;
BEGIN
    SELECT COALESCE(checkin_cooldown_minutes, 5) INTO v_cooldown_minutes
    FROM gym_settings WHERE id = 1;

    IF v_cooldown_minutes > 0 THEN
        SELECT COUNT(*) INTO v_recent_count
        FROM check_ins
        WHERE member_id = NEW.member_id
          AND check_in_time > (NEW.check_in_time - (v_cooldown_minutes || ' minutes')::interval)
          AND id <> COALESCE(NEW.id, 0);

        IF v_recent_count > 0 THEN
            RAISE EXCEPTION 'DUPLICATE_CHECK_IN: Member % already checked in within the last % minutes.',
                NEW.member_id, v_cooldown_minutes
                USING ERRCODE = '23505';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
