-- Migration 021: Standard Food Items Database Seed
-- Authoritative, non-invented USDA / ICMR-NIN nutritional values per serving

INSERT INTO food_items (name, category, serving_size, calories, protein_g, carbs_g, fats_g, fiber_g, is_vegan, is_vegetarian, is_gluten_free)
VALUES
    -- Proteins
    ('Grilled Chicken Breast', 'Proteins', '100g', 165.0, 31.0, 0.0, 3.6, 0.0, false, false, true),
    ('Whole Eggs', 'Proteins', '1 large (50g)', 72.0, 6.3, 0.4, 4.8, 0.0, false, true, true),
    ('Egg Whites', 'Proteins', '100g', 52.0, 11.0, 0.7, 0.2, 0.0, false, true, true),
    ('Baked Atlantic Salmon', 'Proteins', '100g', 208.0, 20.0, 0.0, 13.0, 0.0, false, false, true),
    ('Canned Tuna in Water', 'Proteins', '100g', 116.0, 26.0, 0.0, 1.0, 0.0, false, false, true),
    ('Firm Tofu', 'Proteins', '100g', 144.0, 17.3, 2.8, 8.7, 2.3, true, true, true),
    ('Paneer (Cottage Cheese)', 'Proteins', '100g', 265.0, 18.3, 3.4, 20.8, 0.0, false, true, true),
    ('Boiled Chickpeas (Chole)', 'Proteins', '100g cooked', 164.0, 8.9, 27.4, 2.6, 7.6, true, true, true),
    ('Cooked Yellow Moong Dal', 'Proteins', '100g cooked', 105.0, 7.0, 18.0, 0.5, 4.0, true, true, true),

    -- Carbohydrates
    ('Rolled Oats', 'Carbohydrates', '50g dry', 195.0, 8.5, 33.2, 3.5, 5.0, true, true, true),
    ('Steamed Brown Rice', 'Carbohydrates', '100g cooked', 111.0, 2.6, 23.0, 0.9, 1.8, true, true, true),
    ('White Basmati Rice', 'Carbohydrates', '100g cooked', 130.0, 2.7, 28.0, 0.3, 0.4, true, true, true),
    ('Boiled Sweet Potato', 'Carbohydrates', '100g', 86.0, 1.6, 20.0, 0.1, 3.0, true, true, true),
    ('Whole Wheat Roti / Chapati', 'Carbohydrates', '1 piece (40g)', 110.0, 3.5, 20.0, 1.5, 2.5, true, true, false),
    ('Whole Wheat Bread', 'Carbohydrates', '1 slice (40g)', 92.0, 4.0, 17.0, 1.0, 2.0, true, true, false),
    ('Cooked Quinoa', 'Carbohydrates', '100g cooked', 120.0, 4.4, 21.3, 1.9, 2.8, true, true, true),

    -- Vegetables & Fruits
    ('Banana', 'Vegetables & Fruits', '1 medium (118g)', 105.0, 1.3, 27.0, 0.3, 3.1, true, true, true),
    ('Apple', 'Vegetables & Fruits', '1 medium (182g)', 95.0, 0.5, 25.0, 0.3, 4.4, true, true, true),
    ('Steamed Broccoli', 'Vegetables & Fruits', '100g', 35.0, 2.4, 7.0, 0.4, 2.6, true, true, true),
    ('Fresh Baby Spinach', 'Vegetables & Fruits', '100g', 23.0, 2.9, 3.6, 0.4, 2.2, true, true, true),
    ('Fresh Cucumber', 'Vegetables & Fruits', '100g', 15.0, 0.7, 3.6, 0.1, 0.5, true, true, true),

    -- Fats & Oils
    ('Raw Almonds', 'Fats & Oils', '25g', 145.0, 5.3, 5.4, 12.5, 3.1, true, true, true),
    ('Extra Virgin Olive Oil', 'Fats & Oils', '1 tbsp (14g)', 119.0, 0.0, 0.0, 13.5, 0.0, true, true, true),
    ('Natural Peanut Butter', 'Fats & Oils', '2 tbsp (32g)', 188.0, 8.0, 6.0, 16.0, 2.0, true, true, true),
    ('Walnuts', 'Fats & Oils', '25g', 163.0, 3.8, 3.4, 16.3, 1.7, true, true, true),
    ('Pure Desi Ghee', 'Fats & Oils', '1 tsp (5g)', 45.0, 0.0, 0.0, 5.0, 0.0, false, true, true),

    -- Dairy
    ('Greek Yogurt (Plain 0%)', 'Dairy', '150g', 88.0, 15.0, 5.4, 0.6, 0.0, false, true, true),
    ('Toned Cow Milk', 'Dairy', '200ml', 116.0, 6.4, 9.6, 6.0, 0.0, false, true, true),

    -- Supplements
    ('Whey Protein Isolate', 'Supplements', '1 scoop (30g)', 120.0, 25.0, 2.0, 1.0, 0.0, false, true, true),
    ('Plant Protein Powder', 'Supplements', '1 scoop (30g)', 125.0, 24.0, 3.0, 1.5, 1.0, true, true, true),

    -- Snacks & Beverages
    ('Roasted Makhana (Fox Nuts)', 'Snacks/Beverages', '30g', 106.0, 2.9, 23.0, 0.3, 2.5, true, true, true),
    ('Green Tea (Unsweetened)', 'Snacks/Beverages', '1 cup (240ml)', 2.0, 0.2, 0.0, 0.0, 0.0, true, true, true),
    ('Black Coffee', 'Snacks/Beverages', '1 cup (240ml)', 2.0, 0.3, 0.0, 0.0, 0.0, true, true, true)
ON CONFLICT (name) DO UPDATE SET
    category = EXCLUDED.category,
    serving_size = EXCLUDED.serving_size,
    calories = EXCLUDED.calories,
    protein_g = EXCLUDED.protein_g,
    carbs_g = EXCLUDED.carbs_g,
    fats_g = EXCLUDED.fats_g,
    fiber_g = EXCLUDED.fiber_g,
    is_vegan = EXCLUDED.is_vegan,
    is_vegetarian = EXCLUDED.is_vegetarian,
    is_gluten_free = EXCLUDED.is_gluten_free;

