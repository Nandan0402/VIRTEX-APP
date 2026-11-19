-- 029_competition_icon_down.sql — undo 029. Chosen competition icons are lost (cards fall back to the automatic icon).
BEGIN;
ALTER TABLE fitness_competitions DROP COLUMN IF EXISTS icon;
COMMIT;
