-- ==============================================================================
-- Trainer Hub 005: Diet & nutrition                              STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- REUSED AS-IS: diet_plans, diet_plan_meals (meal plans), diet_plan_meal_items,
--   food_items, member_diet_assignments, member_nutrition_daily_logs,
--   member_nutrition_meal_entries.
-- Adds only soft-archival (existing rows stay NULL = not archived):
--   * diet_plans.archived_at
--   * food_items.archived_at
-- Rollback: 005_diet_nutrition_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.diet_plans') IS NULL OR to_regclass('public.food_items') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 005: diet tables are missing';
    END IF;
END $$;

ALTER TABLE diet_plans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE food_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_diet_plans_not_archived ON diet_plans(trainer_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_food_items_not_archived ON food_items(category)   WHERE archived_at IS NULL;

COMMIT;
