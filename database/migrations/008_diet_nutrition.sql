-- Migration 008: Diet and Nutrition Management Schema
-- Supporting Diet Plan Builder, Food Database, Meal Schedules, Macro & Water Tracking, Member Assignments, and Adherence Analytics

CREATE TABLE IF NOT EXISTS food_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    category VARCHAR(50) NOT NULL, -- Proteins, Carbohydrates, Fats & Oils, Vegetables & Fruits, Dairy, Supplements, Snacks/Beverages
    serving_size VARCHAR(50) NOT NULL DEFAULT '100g',
    calories NUMERIC(6,1) NOT NULL, -- kcal
    protein_g NUMERIC(5,1) NOT NULL, -- grams
    carbs_g NUMERIC(5,1) NOT NULL,   -- grams
    fats_g NUMERIC(5,1) NOT NULL,    -- grams
    fiber_g NUMERIC(5,1) DEFAULT 0.0,
    is_vegan BOOLEAN DEFAULT false,
    is_vegetarian BOOLEAN DEFAULT true,
    is_gluten_free BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_food_items_category ON food_items(category);
CREATE INDEX IF NOT EXISTS idx_food_items_name ON food_items(name);

CREATE TABLE IF NOT EXISTS diet_plans (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    goal VARCHAR(50) NOT NULL, -- Fat Loss, Muscle Gain / Hypertrophy, Lean Recomposition, Endurance, Keto / Low-Carb
    target_calories INTEGER NOT NULL, -- kcal/day
    target_protein_g INTEGER NOT NULL, -- g/day
    target_carbs_g INTEGER NOT NULL,   -- g/day
    target_fats_g INTEGER NOT NULL,    -- g/day
    target_water_ml INTEGER NOT NULL DEFAULT 3500, -- ml/day
    description TEXT,
    is_template BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diet_plans_trainer ON diet_plans(trainer_id);
CREATE INDEX IF NOT EXISTS idx_diet_plans_goal ON diet_plans(goal);

CREATE TABLE IF NOT EXISTS diet_plan_meals (
    id SERIAL PRIMARY KEY,
    plan_id INTEGER NOT NULL REFERENCES diet_plans(id) ON DELETE CASCADE,
    meal_type VARCHAR(30) NOT NULL, -- Breakfast, Lunch, Dinner, Snack 1, Snack 2, Pre-Workout, Post-Workout
    scheduled_time TIME, -- e.g. '08:00:00'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diet_plan_meals_plan ON diet_plan_meals(plan_id);

CREATE TABLE IF NOT EXISTS diet_plan_meal_items (
    id SERIAL PRIMARY KEY,
    meal_id INTEGER NOT NULL REFERENCES diet_plan_meals(id) ON DELETE CASCADE,
    food_item_id INTEGER NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
    servings NUMERIC(4,2) NOT NULL DEFAULT 1.0,
    custom_portion VARCHAR(50), -- e.g. '150g', '2 scoops', '1 bowl'
    calories NUMERIC(6,1) NOT NULL,
    protein_g NUMERIC(5,1) NOT NULL,
    carbs_g NUMERIC(5,1) NOT NULL,
    fats_g NUMERIC(5,1) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_meal_items_meal ON diet_plan_meal_items(meal_id);
CREATE INDEX IF NOT EXISTS idx_plan_meal_items_food ON diet_plan_meal_items(food_item_id);

CREATE TABLE IF NOT EXISTS member_diet_assignments (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    plan_id INTEGER NOT NULL REFERENCES diet_plans(id) ON DELETE RESTRICT,
    assigned_by_trainer_id INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_diet_member ON member_diet_assignments(member_id);
CREATE INDEX IF NOT EXISTS idx_member_diet_status ON member_diet_assignments(status);

CREATE TABLE IF NOT EXISTS member_nutrition_daily_logs (
    id SERIAL PRIMARY KEY,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_calories NUMERIC(6,1) NOT NULL DEFAULT 0,
    total_protein_g NUMERIC(5,1) NOT NULL DEFAULT 0,
    total_carbs_g NUMERIC(5,1) NOT NULL DEFAULT 0,
    total_fats_g NUMERIC(5,1) NOT NULL DEFAULT 0,
    water_intake_ml INTEGER NOT NULL DEFAULT 0,
    adherence_score SMALLINT DEFAULT 100 CHECK (adherence_score >= 0 AND adherence_score <= 100),
    notes TEXT,
    logged_by VARCHAR(50) DEFAULT 'Member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(member_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_member ON member_nutrition_daily_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_date ON member_nutrition_daily_logs(log_date);

CREATE TABLE IF NOT EXISTS member_nutrition_meal_entries (
    id SERIAL PRIMARY KEY,
    daily_log_id INTEGER NOT NULL REFERENCES member_nutrition_daily_logs(id) ON DELETE CASCADE,
    meal_type VARCHAR(30) NOT NULL, -- Breakfast, Lunch, Dinner, Snack
    food_item_id INTEGER REFERENCES food_items(id) ON DELETE SET NULL,
    food_name VARCHAR(120) NOT NULL,
    portion_size VARCHAR(50) NOT NULL,
    calories NUMERIC(6,1) NOT NULL,
    protein_g NUMERIC(5,1) NOT NULL,
    carbs_g NUMERIC(5,1) NOT NULL,
    fats_g NUMERIC(5,1) NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nutrition_entries_daily ON member_nutrition_meal_entries(daily_log_id);

