-- Trainer Hub 005 DOWN: removes only what 005 added (archive dates are lost).
BEGIN;
DROP INDEX IF EXISTS idx_diet_plans_not_archived;
DROP INDEX IF EXISTS idx_food_items_not_archived;
ALTER TABLE diet_plans DROP COLUMN IF EXISTS archived_at;
ALTER TABLE food_items DROP COLUMN IF EXISTS archived_at;
COMMIT;
