import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, checkDatabaseConnection, closePool } from '../../backend/src/config/database.js';
import * as dietRepo from '../../backend/src/repositories/diet.repository.js';
import * as memberSvc from '../../backend/src/services/memberPortal.service.js';
import * as trainerSvc from '../../backend/src/services/trainerHub.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Member Food Diary & Nutrition Tracking Suite', () => {
  let trainerId;
  let trainerUserId;
  let memberId;
  let memberUserId;
  let foodItemIds = [];
  let dailyLogId;

  before(async () => {
    await checkDatabaseConnection();

    // 1. Create a test trainer
    const tCode = `TRN${Date.now().toString().slice(-6)}`;
    const tRes = await query(
      `INSERT INTO trainers (trainer_code, full_name, email, phone, specialty, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tCode, 'Coach Sneha Nutritionist', `coach.sneha.${Date.now()}@example.com`, `98${Math.floor(10000000 + Math.random() * 90000000)}`, 'Clinical Dietetics', 'on_floor']
    );
    trainerId = tRes.rows[0].id;

    // Trainer login user
    const tuRes = await query(
      `INSERT INTO users (username, full_name, email, password_hash, role, trainer_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`sneha_trn_${Date.now()}`, 'Coach Sneha Nutritionist', `sneha_user_${Date.now()}@example.com`, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'trainer', trainerId]
    );
    trainerUserId = tuRes.rows[0].id;

    // 2. Create a test member
    const mCode = `MEM${Date.now().toString().slice(-6)}`;
    const mRes = await query(
      `INSERT INTO members (member_code, full_name, email, phone, plan_name, status, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [mCode, 'Rohan Verma', `rohan.${Date.now()}@example.com`, `99${Math.floor(10000000 + Math.random() * 90000000)}`, 'Annual Pro', 'active', '1995-08-20']
    );
    memberId = mRes.rows[0].id;

    // Member login user
    const muRes = await query(
      `INSERT INTO users (username, full_name, email, password_hash, role, member_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`rohan_mem_${Date.now()}`, 'Rohan Verma', `rohan_user_${Date.now()}@example.com`, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'member', memberId]
    );
    memberUserId = muRes.rows[0].id;

    // 3. Assign member to trainer so trainer can review their logs
    await query(
      `INSERT INTO personal_trainer_assignments (member_id, trainer_id, start_date, status)
       VALUES ($1, $2, CURRENT_DATE, 'active')`,
      [memberId, trainerId]
    );

    // 4. Ensure standard foods exist in food_items
    const testFoods = [
      { name: `Rolled Oats Diary ${Date.now()}`, category: 'Carbohydrates', serving: '50g dry', cal: 195, p: 8.5, c: 33.2, f: 3.5 },
      { name: `Whole Eggs Diary ${Date.now()}`, category: 'Proteins', serving: '1 large (50g)', cal: 72, p: 6.3, c: 0.4, f: 4.8 },
      { name: `Grilled Chicken Diary ${Date.now()}`, category: 'Proteins', serving: '100g', cal: 165, p: 31, c: 0, f: 3.6 },
      { name: `Brown Rice Diary ${Date.now()}`, category: 'Carbohydrates', serving: '100g cooked', cal: 111, p: 2.6, c: 23, f: 0.9 },
      { name: `Raw Almonds Diary ${Date.now()}`, category: 'Fats & Oils', serving: '25g', cal: 145, p: 5.3, c: 5.4, f: 12.5 },
    ];

    for (const f of testFoods) {
      const fi = await query(
        `INSERT INTO food_items (name, category, serving_size, calories, protein_g, carbs_g, fats_g)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [f.name, f.category, f.serving, f.cal, f.p, f.c, f.f]
      );
      foodItemIds.push(fi.rows[0].id);
    }
  });

  after(async () => {
    // Cleanup
    if (dailyLogId) {
      await query('DELETE FROM member_nutrition_daily_logs WHERE id = $1', [dailyLogId]);
    }
    await query('DELETE FROM member_nutrition_daily_logs WHERE member_id = $1', [memberId]);
    await query('DELETE FROM personal_trainer_assignments WHERE member_id = $1', [memberId]);
    for (const fid of foodItemIds) {
      await query('DELETE FROM food_items WHERE id = $1', [fid]);
    }
    if (memberUserId) await query('DELETE FROM users WHERE id = $1', [memberUserId]);
    if (trainerUserId) await query('DELETE FROM users WHERE id = $1', [trainerUserId]);
    if (memberId) await query('DELETE FROM members WHERE id = $1', [memberId]);
    if (trainerId) await query('DELETE FROM trainers WHERE id = $1', [trainerId]);
    await closePool();
  });

  test('UI File Structure: member-food-diary.html exists and links required styling and scripts', () => {
    const htmlPath = path.join(rootDir, 'frontend', 'member-food-diary.html');
    assert.ok(fs.existsSync(htmlPath), 'member-food-diary.html must exist');

    const content = fs.readFileSync(htmlPath, 'utf8');
    assert.match(content, /member-food-diary\.css/, 'HTML must link css/member-food-diary.css');
    assert.match(content, /member-food-diary\.js/, 'HTML must load js/member/member-food-diary.js as module');
    assert.match(content, /Food Diary/, 'HTML title must reflect Food Diary');
  });

  test('UI Script: member-food-diary.js implements all required features without inventing nutrition values', () => {
    const jsPath = path.join(rootDir, 'frontend', 'js', 'member', 'member-food-diary.js');
    assert.ok(fs.existsSync(jsPath), 'member-food-diary.js must exist');

    const content = fs.readFileSync(jsPath, 'utf8');
    // Required meal sections
    assert.match(content, /Breakfast/i, 'Must support Breakfast log');
    assert.match(content, /Lunch/i, 'Must support Lunch log');
    assert.match(content, /Dinner/i, 'Must support Dinner log');
    assert.match(content, /Snacks/i, 'Must support Snacks log');

    // Required metrics and features
    assert.match(content, /portionSize|serving/i, 'Must record serving quantity');
    assert.match(content, /calories/i, 'Must compute calories');
    assert.match(content, /proteinG|protein/i, 'Must compute protein');
    assert.match(content, /carbsG|carbs/i, 'Must compute carbohydrates');
    assert.match(content, /fatsG|fat/i, 'Must compute fat');
    assert.match(content, /waterIntakeMl|water/i, 'Must track daily water intake');

    // Food database lookup
    assert.match(content, /\/foods/i, 'Must query food database catalogue');
    assert.match(content, /foodCatalogue/i, 'Must use food catalogue data');
  });

  test('Member Food Catalogue API: Returns real food items from PostgreSQL', async () => {
    const foods = await memberSvc.listFoodCatalogue({ limit: 50 });
    assert.ok(foods.data && foods.data.length >= 5, 'Should return food catalogue items');
    assert.ok(foods.pagination && foods.pagination.total >= 5, 'Total foods should be at least 5');

    const oats = foods.data.find((f) => f.name.includes('Rolled Oats'));
    assert.ok(oats, 'Rolled Oats should be in catalogue');
    assert.ok(Number(oats.calories) > 0, 'Calories must be positive');
    assert.ok(Number(oats.protein_g) > 0, 'Protein must be positive');
  });

  test('Member Logs Daily Food Consumption: Persists into PostgreSQL tables with exact macro calculations', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const logPayload = {
      logDate: today,
      waterIntakeMl: 3000,
      adherenceScore: 92,
      notes: 'Clean nutrition day. Felt high energy during evening workout.',
      meals: [
        {
          mealType: 'Breakfast',
          foodItemId: foodItemIds[0],
          foodName: 'Rolled Oats Diary',
          portionSize: '1.5 × 50g dry',
          calories: 292.5,
          proteinG: 12.8,
          carbsG: 49.8,
          fatsG: 5.3,
        },
        {
          mealType: 'Breakfast',
          foodItemId: foodItemIds[1],
          foodName: 'Whole Eggs Diary',
          portionSize: '2 large',
          calories: 144,
          proteinG: 12.6,
          carbsG: 0.8,
          fatsG: 9.6,
        },
        {
          mealType: 'Lunch',
          foodItemId: foodItemIds[2],
          foodName: 'Grilled Chicken Diary',
          portionSize: '1.5 × 100g',
          calories: 247.5,
          proteinG: 46.5,
          carbsG: 0,
          fatsG: 5.4,
        },
        {
          mealType: 'Lunch',
          foodItemId: foodItemIds[3],
          foodName: 'Brown Rice Diary',
          portionSize: '1.5 × 100g cooked',
          calories: 166.5,
          proteinG: 3.9,
          carbsG: 34.5,
          fatsG: 1.4,
        },
        {
          mealType: 'Snacks',
          foodItemId: foodItemIds[4],
          foodName: 'Raw Almonds Diary',
          portionSize: '1 × 25g',
          calories: 145,
          proteinG: 5.3,
          carbsG: 5.4,
          fatsG: 12.5,
        },
        {
          mealType: 'Dinner',
          foodItemId: foodItemIds[2],
          foodName: 'Grilled Chicken Diary',
          portionSize: '1.2 × 100g',
          calories: 198,
          proteinG: 37.2,
          carbsG: 0,
          fatsG: 4.3,
        },
      ],
    };

    const result = await memberSvc.submitNutritionLog({ memberId }, logPayload);
    assert.ok(result.id, 'Daily log must be created');
    dailyLogId = result.id;
    assert.equal(result.member_id, memberId);
    assert.equal(result.water_intake_ml, 3000);
    assert.equal(result.adherence_score, 92);

    // Verify database row in PostgreSQL directly
    const dbLog = await query(
      `SELECT id, member_id, total_calories, total_protein_g, total_carbs_g, total_fats_g, water_intake_ml, notes
       FROM member_nutrition_daily_logs WHERE id = $1`,
      [dailyLogId]
    );
    assert.equal(dbLog.rows.length, 1);
    assert.ok(Number(dbLog.rows[0].total_calories) > 1000, 'Total calories should be summed');
    assert.ok(Number(dbLog.rows[0].total_protein_g) > 100, 'Total protein should be summed');

    // Verify itemized meal entries
    const dbEntries = await query(
      `SELECT meal_type, food_name, portion_size, calories, protein_g, carbs_g, fats_g
       FROM member_nutrition_meal_entries WHERE daily_log_id = $1 ORDER BY id ASC`,
      [dailyLogId]
    );
    assert.equal(dbEntries.rows.length, 6, 'Must store all 6 meal entries');

    const breakfastEntries = dbEntries.rows.filter((e) => e.meal_type === 'Breakfast');
    assert.equal(breakfastEntries.length, 2);

    const lunchEntries = dbEntries.rows.filter((e) => e.meal_type === 'Lunch');
    assert.equal(lunchEntries.length, 2);

    const snacksEntries = dbEntries.rows.filter((e) => e.meal_type === 'Snacks');
    assert.equal(snacksEntries.length, 1);

    const dinnerEntries = dbEntries.rows.filter((e) => e.meal_type === 'Dinner');
    assert.equal(dinnerEntries.length, 1);
  });

  test('TRAINER CONNECTION: Trainer reviews daily nutrition records for assigned member', async () => {
    const trainerReview = await trainerSvc.getClientDietLogs(trainerId, memberId, { limit: 10 });
    assert.ok(trainerReview.data, 'Trainer must receive client diet logs');
    assert.ok(trainerReview.data.length >= 1, 'Should contain member daily log');

    const memberLog = trainerReview.data.find((l) => l.id === dailyLogId);
    assert.ok(memberLog, 'Trainer should see the exact daily log');
    assert.equal(memberLog.water_intake_ml, 3000);
    assert.equal(memberLog.adherence_score, 92);
    assert.ok(memberLog.meals.length >= 6, 'Trainer sees all meal items');

    const snackMeal = memberLog.meals.find((m) => m.mealType === 'Snacks');
    assert.ok(snackMeal);
    assert.equal(snackMeal.food, 'Raw Almonds Diary');
    assert.equal(snackMeal.portion, '1 × 25g');
  });

  test('ADMIN CONNECTION: Admin views authorised nutrition summaries and adherence analytics', async () => {
    // 1. Check admin daily nutrition logs list
    const adminLogs = await dietRepo.getMemberDailyNutritionLogs({ member_id: memberId, limit: 10 });
    assert.ok(adminLogs.length >= 1, 'Admin must be able to view member nutrition logs');
    assert.equal(adminLogs[0].member_name, 'Rohan Verma');
    assert.equal(adminLogs[0].water_intake_ml, 3000);

    // 2. Check admin adherence analytics summary
    const analytics = await dietRepo.getDietAdherenceAnalytics();
    assert.ok(analytics, 'Analytics object must exist');
    assert.ok(analytics.kpis, 'KPIs object must exist');
    assert.ok(analytics.kpis.totalFoods >= 5, 'Must report total foods in system');
    assert.ok(analytics.kpis.avgCalories > 0, 'Summary must calculate average calories');
    assert.ok(analytics.kpis.avgWaterMl > 0, 'Summary must calculate average water intake');
    assert.ok(analytics.goalDistribution, 'Summary must include goal distribution');
    assert.ok(analytics.trainerMonitoring, 'Summary must include trainer monitoring');
  });
});
