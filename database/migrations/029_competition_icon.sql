-- 029_competition_icon.sql
-- Lets the admin choose an icon (emoji) for each competition, shown on its card.
-- Additive only: one nullable column; existing competitions keep the automatic icon until one is chosen.
-- Undo: 029_competition_icon_down.sql
BEGIN;
ALTER TABLE fitness_competitions ADD COLUMN IF NOT EXISTS icon VARCHAR(16);
COMMIT;
