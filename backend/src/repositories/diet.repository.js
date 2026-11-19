/**
 * diet.repository.js - Data Access Layer for Diet & Nutrition Management
 * Integrates with PostgreSQL (gym_robot_db) food_items, diet_plans, meal schedules,
 * member assignments, hydration tracking, and adherence logs.
 */

import { pool } from '../config/database.js';

/**
 * Food Database Queries
 */
export async function getFoodItems({ category, search, is_vegetarian, is_vegan } = {}) {
  let query = `
    SELECT id, name, category, serving_size, calories, protein_g, carbs_g, fats_g, fiber_g, is_vegan, is_vegetarian, is_gluten_free, created_at
    FROM food_items
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (is_vegetarian === true || is_vegetarian === 'true') {
    query += ` AND is_vegetarian = true`;
  }
  if (is_vegan === true || is_vegan === 'true') {
    query += ` AND is_vegan = true`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (name ILIKE $${params.length} OR category ILIKE $${params.length})`;
  }

  query += ` ORDER BY category ASC, name ASC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getFoodItemById(id) {
  const query = `SELECT * FROM food_items WHERE id = $1`;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createFoodItem(foodData) {
  const {
    name,
    category,
    serving_size,
    calories,
    protein_g,
    carbs_g,
    fats_g,
    fiber_g,
    is_vegan,
    is_vegetarian,
    is_gluten_free
  } = foodData;

  const query = `
    INSERT INTO food_items (name, category, serving_size, calories, protein_g, carbs_g, fats_g, fiber_g, is_vegan, is_vegetarian, is_gluten_free)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    name,
    category,
    serving_size || '100g',
    calories,
    protein_g,
    carbs_g,
    fats_g,
    fiber_g || 0.0,
    is_vegan || false,
    is_vegetarian !== undefined ? is_vegetarian : true,
    is_gluten_free !== undefined ? is_gluten_free : true
  ]);
  return rows[0];
}

/**
 * Diet Plans & Meal Schedule Queries
 */
export async function getDietPlans({ trainer_id, goal, search } = {}) {
  let query = `
    SELECT 
      dp.id,
      dp.name,
      dp.trainer_id,
      t.full_name AS trainer_name,
      dp.goal,
      dp.target_calories,
      dp.target_protein_g,
      dp.target_carbs_g,
      dp.target_fats_g,
      dp.target_water_ml,
      dp.description,
      dp.is_template,
      dp.created_at,
      COUNT(DISTINCT dpm.id) AS meals_count,
      COUNT(DISTINCT dpmi.id) AS food_items_count,
      COUNT(DISTINCT mda.id) FILTER (WHERE mda.status = 'active') AS active_assigned_members
    FROM diet_plans dp
    LEFT JOIN trainers t ON dp.trainer_id = t.id
    LEFT JOIN diet_plan_meals dpm ON dp.id = dpm.plan_id
    LEFT JOIN diet_plan_meal_items dpmi ON dpm.id = dpmi.meal_id
    LEFT JOIN member_diet_assignments mda ON dp.id = mda.plan_id
    WHERE 1=1
  `;
  const params = [];

  if (trainer_id && trainer_id !== 'All') {
    params.push(parseInt(trainer_id, 10));
    query += ` AND dp.trainer_id = $${params.length}`;
  }
  if (goal && goal !== 'All') {
    params.push(goal);
    query += ` AND dp.goal = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (dp.name ILIKE $${params.length} OR dp.description ILIKE $${params.length})`;
  }

  query += ` GROUP BY dp.id, t.full_name ORDER BY dp.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getDietPlanById(id) {
  const pQuery = `
    SELECT 
      dp.*,
      t.full_name AS trainer_name,
      t.specialty AS trainer_specialty
    FROM diet_plans dp
    LEFT JOIN trainers t ON dp.trainer_id = t.id
    WHERE dp.id = $1
  `;
  const pRes = await pool.query(pQuery, [id]);
  if (pRes.rows.length === 0) return null;
  const plan = pRes.rows[0];

  const mealsQuery = `
    SELECT 
      dpm.id,
      dpm.meal_type,
      dpm.scheduled_time,
      dpm.notes
    FROM diet_plan_meals dpm
    WHERE dpm.plan_id = $1
    ORDER BY dpm.scheduled_time ASC, dpm.id ASC
  `;
  const mealsRes = await pool.query(mealsQuery, [id]);
  const meals = mealsRes.rows;

  for (const meal of meals) {
    const itemsQuery = `
      SELECT 
        dpmi.id,
        dpmi.food_item_id,
        fi.name AS food_name,
        fi.category,
        dpmi.servings,
        dpmi.custom_portion,
        dpmi.calories,
        dpmi.protein_g,
        dpmi.carbs_g,
        dpmi.fats_g
      FROM diet_plan_meal_items dpmi
      JOIN food_items fi ON dpmi.food_item_id = fi.id
      WHERE dpmi.meal_id = $1
      ORDER BY dpmi.id ASC
    `;
    const itemsRes = await pool.query(itemsQuery, [meal.id]);
    meal.items = itemsRes.rows;
  }

  plan.meals = meals;
  return plan;
}

export async function createDietPlan(planData, meals = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pQuery = `
      INSERT INTO diet_plans (name, trainer_id, goal, target_calories, target_protein_g, target_carbs_g, target_fats_g, target_water_ml, description, is_template)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;
    const pValues = [
      planData.name,
      planData.trainer_id || null,
      planData.goal || 'Muscle Gain / Hypertrophy',
      planData.target_calories || 2500,
      planData.target_protein_g || 180,
      planData.target_carbs_g || 250,
      planData.target_fats_g || 70,
      planData.target_water_ml || 3500,
      planData.description || '',
      planData.is_template !== undefined ? planData.is_template : true
    ];
    const pRes = await client.query(pQuery, pValues);
    const newPlan = pRes.rows[0];

    for (const m of meals) {
      const mQuery = `
        INSERT INTO diet_plan_meals (plan_id, meal_type, scheduled_time, notes)
        VALUES ($1, $2, $3, $4)
        RETURNING id;
      `;
      const mRes = await client.query(mQuery, [
        newPlan.id,
        m.meal_type || 'Breakfast',
        m.scheduled_time || '08:00:00',
        m.notes || ''
      ]);
      const mealId = mRes.rows[0].id;

      if (m.items && Array.isArray(m.items)) {
        for (const item of m.items) {
          await client.query(`
            INSERT INTO diet_plan_meal_items (meal_id, food_item_id, servings, custom_portion, calories, protein_g, carbs_g, fats_g)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
          `, [
            mealId,
            item.food_item_id,
            item.servings || 1.0,
            item.custom_portion || '100g',
            item.calories || 0,
            item.protein_g || 0,
            item.carbs_g || 0,
            item.fats_g || 0
          ]);
        }
      }
    }

    await client.query('COMMIT');
    return newPlan;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Member Diet Assignments
 */
export async function getMemberDietAssignments({ member_id, trainer_id, status } = {}) {
  let query = `
    SELECT 
      mda.id,
      mda.member_id,
      m.full_name AS member_name,
      m.member_code,
      mda.plan_id,
      dp.name AS plan_name,
      dp.goal,
      dp.target_calories,
      dp.target_protein_g,
      dp.target_carbs_g,
      dp.target_fats_g,
      dp.target_water_ml,
      mda.assigned_by_trainer_id,
      t.full_name AS trainer_name,
      mda.start_date,
      mda.end_date,
      mda.status,
      mda.notes,
      mda.created_at,
      COUNT(mndl.id) AS days_logged_count,
      COALESCE(ROUND(AVG(mndl.adherence_score)), 0) AS avg_adherence_percent,
      COALESCE(ROUND(AVG(mndl.water_intake_ml)), 0) AS avg_water_ml
    FROM member_diet_assignments mda
    JOIN members m ON mda.member_id = m.id
    JOIN diet_plans dp ON mda.plan_id = dp.id
    LEFT JOIN trainers t ON mda.assigned_by_trainer_id = t.id
    LEFT JOIN member_nutrition_daily_logs mndl ON mda.member_id = mndl.member_id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND mda.member_id = $${params.length}`;
  }
  if (trainer_id && trainer_id !== 'All') {
    params.push(parseInt(trainer_id, 10));
    query += ` AND mda.assigned_by_trainer_id = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND mda.status = $${params.length}`;
  }

  query += ` GROUP BY mda.id, m.full_name, m.member_code, dp.name, dp.goal, dp.target_calories, dp.target_protein_g, dp.target_carbs_g, dp.target_fats_g, dp.target_water_ml, t.full_name ORDER BY mda.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function assignDietPlanToMember({ member_id, plan_id, assigned_by_trainer_id, start_date, notes }) {
  // Archive/complete any current active diet assignments so historical records are preserved with end_date
  await pool.query(
    `UPDATE member_diet_assignments
        SET status = 'completed', end_date = COALESCE($2, CURRENT_DATE), updated_at = NOW()
      WHERE member_id = $1 AND status = 'active'`,
    [member_id, start_date || null]
  );

  const query = `
    INSERT INTO member_diet_assignments (member_id, plan_id, assigned_by_trainer_id, start_date, status, notes)
    VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), 'active', $5)
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    member_id,
    plan_id,
    assigned_by_trainer_id || null,
    start_date || null,
    notes || ''
  ]);
  return rows[0];
}

export async function updateDietAssignmentStatus(assignment_id, status) {
  const query = `
    UPDATE member_diet_assignments
    SET status = $1, updated_at = NOW()
    WHERE id = $2
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [status, assignment_id]);
  return rows[0];
}

/**
 * Daily Nutrition & Water Tracking Logs
 */
export async function getMemberDailyNutritionLogs({ member_id, start_date, end_date, limit = 14 } = {}) {
  let query = `
    SELECT 
      mndl.*,
      m.full_name AS member_name,
      m.member_code
    FROM member_nutrition_daily_logs mndl
    JOIN members m ON mndl.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (member_id) {
    params.push(parseInt(member_id, 10));
    query += ` AND mndl.member_id = $${params.length}`;
  }
  if (start_date) {
    params.push(start_date);
    query += ` AND mndl.log_date >= $${params.length}`;
  }
  if (end_date) {
    params.push(end_date);
    query += ` AND mndl.log_date <= $${params.length}`;
  }

  query += ` ORDER BY mndl.log_date DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(query, params);
  return rows;
}

export async function logDailyNutrition(logData, mealEntries = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let totalCal = 0, totalP = 0, totalC = 0, totalF = 0;
    mealEntries.forEach(m => {
      totalCal += Number(m.calories) || 0;
      totalP += Number(m.protein_g) || 0;
      totalC += Number(m.carbs_g) || 0;
      totalF += Number(m.fats_g) || 0;
    });

    const lQuery = `
      INSERT INTO member_nutrition_daily_logs (member_id, log_date, total_calories, total_protein_g, total_carbs_g, total_fats_g, water_intake_ml, adherence_score, notes, logged_by)
      VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (member_id, log_date) DO UPDATE SET
        total_calories = EXCLUDED.total_calories,
        total_protein_g = EXCLUDED.total_protein_g,
        total_carbs_g = EXCLUDED.total_carbs_g,
        total_fats_g = EXCLUDED.total_fats_g,
        water_intake_ml = EXCLUDED.water_intake_ml,
        adherence_score = EXCLUDED.adherence_score,
        notes = EXCLUDED.notes
      RETURNING *;
    `;
    const lRes = await client.query(lQuery, [
      logData.member_id,
      logData.log_date || null,
      totalCal > 0 ? totalCal : (logData.total_calories || 0),
      totalP > 0 ? totalP : (logData.total_protein_g || 0),
      totalC > 0 ? totalC : (logData.total_carbs_g || 0),
      totalF > 0 ? totalF : (logData.total_fats_g || 0),
      logData.water_intake_ml || 0,
      logData.adherence_score || 95,
      logData.notes || '',
      logData.logged_by || 'Admin'
    ]);
    const dailyLog = lRes.rows[0];

    // Remove existing entries for this daily log if re-logging
    await client.query(`DELETE FROM member_nutrition_meal_entries WHERE daily_log_id = $1;`, [dailyLog.id]);

    for (const entry of mealEntries) {
      await client.query(`
        INSERT INTO member_nutrition_meal_entries (daily_log_id, meal_type, food_item_id, food_name, portion_size, calories, protein_g, carbs_g, fats_g)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
      `, [
        dailyLog.id,
        entry.meal_type || 'Breakfast',
        entry.food_item_id || null,
        entry.food_name || 'Generic Food',
        entry.portion_size || '1 portion',
        entry.calories || 0,
        entry.protein_g || 0,
        entry.carbs_g || 0,
        entry.fats_g || 0
      ]);
    }

    await client.query('COMMIT');
    return dailyLog;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Diet Adherence & Nutrition Analytics
 */
export async function getDietAdherenceAnalytics() {
  const client = await pool.connect();
  try {
    const foodCountRes = await client.query(`SELECT COUNT(*) AS total_foods FROM food_items;`);
    const planCountRes = await client.query(`SELECT COUNT(*) AS total_plans FROM diet_plans;`);
    const assignRes = await client.query(`
      SELECT 
        COUNT(*) AS total_assignments,
        COUNT(*) FILTER (WHERE status = 'active') AS active_assignments,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed_assignments
      FROM member_diet_assignments;
    `);
    const logsRes = await client.query(`
      SELECT 
        COUNT(*) AS total_logs,
        COALESCE(ROUND(AVG(adherence_score)), 0) AS overall_avg_adherence,
        COALESCE(ROUND(AVG(water_intake_ml)), 0) AS overall_avg_water_ml,
        COALESCE(ROUND(AVG(total_calories)), 0) AS overall_avg_calories,
        COALESCE(ROUND(AVG(total_protein_g)), 0) AS overall_avg_protein_g
      FROM member_nutrition_daily_logs;
    `);

    const goalDistRes = await client.query(`
      SELECT goal, COUNT(*) AS count
      FROM diet_plans
      GROUP BY goal
      ORDER BY count DESC;
    `);

    const foodCategoryDist = await client.query(`
      SELECT category, COUNT(*) AS count
      FROM food_items
      GROUP BY category
      ORDER BY count DESC;
    `);

    const trainerMonitoring = await client.query(`
      SELECT 
        t.full_name AS trainer_name,
        COUNT(mda.id) AS active_clients_count,
        COALESCE(ROUND(AVG(mndl.adherence_score)), 0) AS clients_avg_adherence
      FROM trainers t
      JOIN member_diet_assignments mda ON t.id = mda.assigned_by_trainer_id
      LEFT JOIN member_nutrition_daily_logs mndl ON mda.member_id = mndl.member_id
      WHERE mda.status = 'active'
      GROUP BY t.id, t.full_name
      ORDER BY clients_avg_adherence DESC;
    `);

    return {
      kpis: {
        totalFoods: parseInt(foodCountRes.rows[0].total_foods, 10),
        totalPlans: parseInt(planCountRes.rows[0].total_plans, 10),
        activeAssignments: parseInt(assignRes.rows[0].active_assignments, 10),
        totalAssignments: parseInt(assignRes.rows[0].total_assignments, 10),
        avgAdherencePercent: parseInt(logsRes.rows[0].overall_avg_adherence, 10),
        avgWaterMl: parseInt(logsRes.rows[0].overall_avg_water_ml, 10),
        avgCalories: parseInt(logsRes.rows[0].overall_avg_calories, 10),
        avgProteinG: parseInt(logsRes.rows[0].overall_avg_protein_g, 10)
      },
      goalDistribution: goalDistRes.rows,
      foodCategories: foodCategoryDist.rows,
      trainerMonitoring: trainerMonitoring.rows
    };
  } finally {
    client.release();
  }
}

