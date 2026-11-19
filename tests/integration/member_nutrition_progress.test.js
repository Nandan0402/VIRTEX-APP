import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, closePool } from '../../backend/src/config/database.js';
import * as memberSvc from '../../backend/src/services/memberPortal.service.js';
import * as trainerSvc from '../../backend/src/services/trainerHub.service.js';
import * as dietRepo from '../../backend/src/repositories/diet.repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const formatLocalYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const toDateOnly = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  if (d instanceof Date) return formatLocalYMD(d);
  return String(d).slice(0, 10);
};

describe('Member Nutrition Progress & Trainer Hub Suite', () => {
  let trainerId;
  let trainerUserId;
  let memberId;
  let memberUserId;
  let dietPlanId;
  let assignmentId;
  const foodItemIds = [];
  const logIds = [];

  const now = new Date();
  const todayStr = formatLocalYMD(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatLocalYMD(yesterday);

  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = formatLocalYMD(twoDaysAgo);

  before(async () => {
    // 1. Create a dedicated Trainer
    const trRes = await query(
      `INSERT INTO trainers (trainer_code, full_name, email, phone, specialty, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`TRN${Date.now().toString().slice(-6)}`, 'Coach Sneha Nutritionist', `coach.sneha.${Date.now()}@example.com`, `98${Math.floor(10000000 + Math.random() * 90000000)}`, 'Sports Nutrition', 'on_floor']
    );
    trainerId = trRes.rows[0].id;

    const tuRes = await query(
      `INSERT INTO users (username, full_name, email, password_hash, role, trainer_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`sneha_trn_${Date.now()}`, 'Coach Sneha Nutritionist', `sneha_user_${Date.now()}@example.com`, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'trainer', trainerId]
    );
    trainerUserId = tuRes.rows[0].id;

    // 2. Create a Member
    const memRes = await query(
      `INSERT INTO members (member_code, full_name, email, phone, plan_name, status, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [`MEM${Date.now().toString().slice(-6)}`, 'Kavya Sharma', `kavya.${Date.now()}@example.com`, `99${Math.floor(10000000 + Math.random() * 90000000)}`, 'Annual Pro', 'active', '1996-03-12']
    );
    memberId = memRes.rows[0].id;

    const muRes = await query(
      `INSERT INTO users (username, full_name, email, password_hash, role, member_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`kavya_mem_${Date.now()}`, 'Kavya Sharma', `kavya_user_${Date.now()}@example.com`, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'member', memberId]
    );
    memberUserId = muRes.rows[0].id;

    // 3. Assign member to trainer
    await query(
      `INSERT INTO personal_trainer_assignments (member_id, trainer_id, start_date, status)
       VALUES ($1, $2, CURRENT_DATE, 'active')`,
      [memberId, trainerId]
    );

    // 4. Create standard foods
    const testFoods = [
      { name: `Rolled Oats Progress ${Date.now()}`, category: 'Carbohydrates', serving: '50g', cal: 195, p: 8.5, c: 33.2, f: 3.5 },
      { name: `Chicken Breast Progress ${Date.now()}`, category: 'Proteins', serving: '150g', cal: 247, p: 46.5, c: 0, f: 5.4 },
      { name: `Greek Yogurt Progress ${Date.now()}`, category: 'Dairy', serving: '170g', cal: 130, p: 17, c: 6, f: 4 },
      { name: `Raw Almonds Progress ${Date.now()}`, category: 'Fats & Oils', serving: '25g', cal: 145, p: 5.3, c: 5.4, f: 12.5 },
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

    // 5. Create a Diet Plan assigned to Member
    const dpRes = await query(
      `INSERT INTO diet_plans (name, goal, description, target_calories, target_protein_g, target_carbs_g, target_fats_g, target_water_ml, trainer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      ['Athletic Performance & Lean Muscle', 'Muscle Gain', 'High protein athletic maintenance with adequate hydration', 2200, 160, 240, 60, 3200, trainerId]
    );
    dietPlanId = dpRes.rows[0].id;

    const assignRes = await query(
      `INSERT INTO member_diet_assignments (member_id, plan_id, assigned_by_trainer_id, start_date, status, notes)
       VALUES ($1, $2, $3, CURRENT_DATE, 'active', $4)
       RETURNING id`,
      [memberId, dietPlanId, trainerId, 'Focus on pre-workout hydration and hitting 160g protein daily.']
    );
    assignmentId = assignRes.rows[0].id;

    // 6. Seed actual food diary records:
    // Today: Full normal day with 4 meals
    const todayLog = await memberSvc.submitNutritionLog({ memberId }, {
      logDate: todayStr,
      waterIntakeMl: 3200,
      adherenceScore: 95,
      notes: 'Hit all macro targets smoothly.',
      meals: [
        { mealType: 'Breakfast', foodItemId: foodItemIds[0], foodName: 'Rolled Oats', portionSize: '1 portion', calories: 350, proteinG: 17, carbsG: 60, fatsG: 7 },
        { mealType: 'Lunch', foodItemId: foodItemIds[1], foodName: 'Chicken Breast', portionSize: '1.5 portions', calories: 550, proteinG: 70, carbsG: 45, fatsG: 12 },
        { mealType: 'Snacks', foodItemId: foodItemIds[2], foodName: 'Greek Yogurt', portionSize: '1 cup', calories: 220, proteinG: 22, carbsG: 15, fatsG: 6 },
        { mealType: 'Dinner', foodItemId: foodItemIds[3], foodName: 'Salad & Almonds', portionSize: '1 bowl', calories: 480, proteinG: 35, carbsG: 40, fatsG: 20 },
      ],
    });
    logIds.push(todayLog.id);

    // Yesterday: Logged Zero Intake / Fasting day (Record exists in DB with 0 calories and 0 meals)
    const fastingLog = await memberSvc.submitNutritionLog({ memberId }, {
      logDate: yesterdayStr,
      waterIntakeMl: 2500,
      adherenceScore: 90,
      notes: '24-hour intermittent fasting protocol.',
      meals: [],
    });
    logIds.push(fastingLog.id);

    // Note: twoDaysAgoStr is left UNLOGGED (no row in member_nutrition_daily_logs)
    // to verify missing data distinction.
  });

  after(async () => {
    for (const lid of logIds) {
      await query('DELETE FROM member_nutrition_daily_logs WHERE id = $1', [lid]);
    }
    await query('DELETE FROM member_nutrition_daily_logs WHERE member_id = $1', [memberId]);
    if (assignmentId) await query('DELETE FROM member_diet_assignments WHERE id = $1', [assignmentId]);
    if (dietPlanId) await query('DELETE FROM diet_plans WHERE id = $1', [dietPlanId]);
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

  test('UI File Structure: member-nutrition-progress.html and css exist', () => {
    const htmlPath = path.join(rootDir, 'frontend', 'member-nutrition-progress.html');
    assert.ok(fs.existsSync(htmlPath), 'member-nutrition-progress.html must exist');

    const content = fs.readFileSync(htmlPath, 'utf8');
    assert.match(content, /member-nutrition-progress\.css/, 'HTML must link css/member-nutrition-progress.css');
    assert.match(content, /member-nutrition-progress\.js/, 'HTML must load js/member/member-nutrition-progress.js as module');
    assert.match(content, /Nutrition Progress/, 'Title must reflect Nutrition Progress');

    const cssPath = path.join(rootDir, 'frontend', 'css', 'member-nutrition-progress.css');
    assert.ok(fs.existsSync(cssPath), 'member-nutrition-progress.css must exist');
  });

  test('UI Script: member-nutrition-progress.js implements all required sections and data handling', () => {
    const jsPath = path.join(rootDir, 'frontend', 'js', 'member', 'member-nutrition-progress.js');
    assert.ok(fs.existsSync(jsPath), 'member-nutrition-progress.js must exist');

    const content = fs.readFileSync(jsPath, 'utf8');
    // Required display components
    assert.match(content, /Daily Calorie Intake/i, 'Must display Daily Calorie intake');
    assert.match(content, /Protein Progress/i, 'Must display Protein progress');
    assert.match(content, /Carbohydrate Progress/i, 'Must display Carbohydrate progress');
    assert.match(content, /Fat Progress/i, 'Must display Fat progress');
    assert.match(content, /Water Intake/i, 'Must display Water intake');
    assert.match(content, /Meal Completion/i, 'Must display Meal completion');
    assert.match(content, /Weekly Nutrition History/i, 'Must display Weekly nutrition history');
    assert.match(content, /Monthly Nutrition Trends/i, 'Must display Monthly nutrition trends');

    // Missing vs Zero intake distinction
    assert.match(content, /isMissing|Missing Data|Not Logged/i, 'Must distinguish missing data');
    assert.match(content, /isZeroIntake|Fasting/i, 'Must distinguish zero intake / fasting');

    // Trainer Hub connection
    assert.match(content, /Trainer Hub/i, 'Must connect to Trainer Hub');
  });

  test('Backend Nutrition Progress API: Returns structured progress using actual member records', async () => {
    const progress = await memberSvc.getNutritionProgress(memberId, { date: todayStr });
    assert.ok(progress, 'Progress object must exist');

    // 1. Daily intake for today
    assert.equal(progress.today.date, todayStr);
    assert.equal(progress.today.isLogged, true, 'Today should be logged');
    assert.equal(progress.today.isMissing, false);
    assert.equal(progress.today.isZeroIntake, false);
    assert.ok(progress.today.calories > 1500, 'Should reflect actual summed calories');
    assert.ok(progress.today.proteinG > 100, 'Should reflect actual protein');
    assert.equal(progress.today.waterMl, 3200, 'Should reflect actual water intake');

    // 2. Targets from assigned diet plan
    assert.ok(progress.targets, 'Prescribed targets must exist');
    assert.equal(progress.targets.calories, 2200);
    assert.equal(progress.targets.proteinG, 160);
    assert.equal(progress.targets.waterMl, 3200);

    // 3. Meal completion
    assert.ok(progress.mealCompletion, 'Meal completion must exist');
    assert.equal(progress.mealCompletion.mealsLoggedCount, 4, 'All 4 meals should be logged today');
    assert.equal(progress.mealCompletion.completionPercent, 100);

    const bfast = progress.mealCompletion.meals.find((m) => m.mealType === 'Breakfast');
    assert.ok(bfast && bfast.isCompleted);
    assert.equal(bfast.calories, 350);
  });

  test('Distinguishes Missing Data from Zero Intake accurately in Progress and History', async () => {
    // 1. Query yesterday (Logged Fasting / Zero intake)
    const yesterdayProgress = await memberSvc.getNutritionProgress(memberId, { date: yesterdayStr });
    assert.equal(yesterdayProgress.today.isLogged, true, 'Yesterday was explicitly logged');
    assert.equal(yesterdayProgress.today.isMissing, false, 'Yesterday is not missing');
    assert.equal(yesterdayProgress.today.isZeroIntake, true, 'Yesterday should be flagged as zero intake / fasting');
    assert.equal(yesterdayProgress.today.calories, 0, 'Yesterday calories should be 0');

    // 2. Query two days ago (Unlogged / Missing day)
    const missingProgress = await memberSvc.getNutritionProgress(memberId, { date: twoDaysAgoStr });
    assert.equal(missingProgress.today.isLogged, false, 'Two days ago was NOT logged');
    assert.equal(missingProgress.today.isMissing, true, 'Two days ago should be flagged as missing data');
    assert.equal(missingProgress.today.isZeroIntake, false, 'Missing day is not zero intake');
    assert.equal(missingProgress.today.calories, null, 'Calories must be null (not 0)');
    assert.equal(missingProgress.today.proteinG, null, 'Protein must be null (not 0)');

    // 3. Weekly history items
    const weekly = yesterdayProgress.weeklyHistory;
    assert.ok(weekly && weekly.length === 7, 'Weekly history should contain 7 days');

    const twoDaysAgoItem = weekly.find((d) => d.date === twoDaysAgoStr);
    assert.ok(twoDaysAgoItem, 'Two days ago should be in weekly history');
    assert.equal(twoDaysAgoItem.isMissing, true, 'Two days ago must be marked isMissing');
    assert.equal(twoDaysAgoItem.calories, null, 'Two days ago calories must be null');

    const yesterdayItem = weekly.find((d) => d.date === yesterdayStr);
    assert.ok(yesterdayItem, 'Yesterday should be in weekly history');
    assert.equal(yesterdayItem.isZeroIntake, true, 'Yesterday must be marked isZeroIntake');
    assert.equal(yesterdayItem.calories, 0);
  });

  test('Monthly Trends: Calculates averages strictly over logged days without skews from missing days', async () => {
    const progress = await memberSvc.getNutritionProgress(memberId, { date: todayStr });
    const { summary, dailySeries } = progress.monthlyTrends;

    assert.ok(summary, 'Monthly summary must exist');
    assert.equal(summary.totalDays, 30);
    assert.equal(summary.loggedDaysCount, 2, 'Exactly 2 days were logged in 30 days');
    assert.equal(summary.missingDaysCount, 28, '28 days are missing');

    // Check average calories calculation:
    // (Today calories + Yesterday 0 calories) / 2 logged days!
    // NOT divided by 30!
    assert.ok(summary.avgCalories > 500, 'Average should be computed over logged days only');
    assert.equal(dailySeries.length, 30, 'Daily series should cover 30 days');
  });

  test('TRAINER HUB CONNECTION: Assigned Trainer reviews member nutrition logs and monitors progress', async () => {
    const progress = await memberSvc.getNutritionProgress(memberId, { date: todayStr });
    assert.ok(progress.trainerHub, 'Trainer Hub connection info must exist');
    assert.equal(progress.trainerHub.isAssigned, true);
    assert.equal(progress.trainerHub.trainerName, 'Coach Sneha Nutritionist');
    assert.equal(progress.trainerHub.specialty, 'Sports Nutrition');
    assert.equal(progress.trainerHub.isSynced, true);

    // Verify trainer endpoint can read the member's logs in Trainer Hub
    const trainerReview = await trainerSvc.getClientDietLogs(trainerId, memberId, { limit: 10 });
    assert.ok(trainerReview.data && trainerReview.data.length >= 2, 'Trainer receives client logs');

    const clientTodayLog = trainerReview.data.find((l) => toDateOnly(l.log_date) === todayStr);
    assert.ok(clientTodayLog, 'Trainer sees today member submission');
    assert.equal(clientTodayLog.water_intake_ml, 3200);
    assert.equal(clientTodayLog.meals.length, 4, 'Trainer sees all 4 meals');
  });
});
