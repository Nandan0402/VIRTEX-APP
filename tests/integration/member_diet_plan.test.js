import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, checkDatabaseConnection, closePool } from '../../backend/src/config/database.js';
import * as dietRepo from '../../backend/src/repositories/diet.repository.js';
import * as trainerRepo from '../../backend/src/repositories/trainerHub.repository.js';
import * as memberSvc from '../../backend/src/services/memberPortal.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Member Diet Plan & Trainer Connection Suite', () => {
  let trainerId;
  let memberId;
  let userId;
  let foodItemIds = [];
  let planId1;
  let planId2;
  let assignmentId1;
  let assignmentId2;

  before(async () => {
    await checkDatabaseConnection();

    // 1. Create a test trainer
    const tCode = `TRN${Date.now().toString().slice(-6)}`;
    const tRes = await query(
      `INSERT INTO trainers (trainer_code, full_name, email, phone, specialty, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tCode, 'Coach Vikram Dietician', `coach.vikram.${Date.now()}@example.com`, `98${Math.floor(10000000 + Math.random() * 90000000)}`, 'Sports Nutrition', 'on_floor']
    );
    trainerId = tRes.rows[0].id;

    // 2. Create a test member
    const mCode = `MEM${Date.now().toString().slice(-6)}`;
    const mRes = await query(
      `INSERT INTO members (member_code, full_name, email, phone, plan_name, status, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [mCode, 'Arjun Athlete', `arjun.${Date.now()}@example.com`, `99${Math.floor(10000000 + Math.random() * 90000000)}`, 'Annual Pro', 'active', '1998-05-15']
    );
    memberId = mRes.rows[0].id;

    // 3. Create a test user linked to member
    const uRes = await query(
      `INSERT INTO users (username, full_name, email, password_hash, role, member_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [`arjun_${Date.now()}`, 'Arjun Athlete', `arjun_user_${Date.now()}@example.com`, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 'member', memberId]
    );
    userId = uRes.rows[0].id;

    // 4. Create food items for testing
    const foods = [
      { name: `Rolled Oats ${Date.now()}`, category: 'Carbohydrates', serving: '50g', cal: 190, p: 6.5, c: 33, f: 3.5, v: true, veg: true, gf: true },
      { name: `Boiled Whole Eggs ${Date.now()}`, category: 'Proteins', serving: '2 large', cal: 156, p: 12.6, c: 1.1, f: 10.6, v: false, veg: true, gf: true },
      { name: `Grilled Chicken Breast ${Date.now()}`, category: 'Proteins', serving: '150g', cal: 247, p: 46.5, c: 0, f: 5.4, v: false, veg: false, gf: true },
      { name: `Steamed Brown Rice ${Date.now()}`, category: 'Carbohydrates', serving: '150g cooked', cal: 165, p: 3.5, c: 35, f: 1.2, v: true, veg: true, gf: true },
      { name: `Whey Protein Isolate ${Date.now()}`, category: 'Supplements', serving: '1 scoop (30g)', cal: 120, p: 25, c: 2, f: 1, v: false, veg: true, gf: true },
      { name: `Raw Almonds ${Date.now()}`, category: 'Fats & Oils', serving: '25g', cal: 145, p: 5.3, c: 5.4, f: 12.4, v: true, veg: true, gf: true },
      { name: `Baked Atlantic Salmon ${Date.now()}`, category: 'Proteins', serving: '150g', cal: 312, p: 34, c: 0, f: 18.5, v: false, veg: false, gf: true },
    ];

    for (const f of foods) {
      const fi = await query(
        `INSERT INTO food_items (name, category, serving_size, calories, protein_g, carbs_g, fats_g, is_vegan, is_vegetarian, is_gluten_free)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [f.name, f.category, f.serving, f.cal, f.p, f.c, f.f, f.v, f.veg, f.gf]
      );
      foodItemIds.push(fi.rows[0].id);
    }
  });

  after(async () => {
    // Cleanup
    if (assignmentId1) await query('DELETE FROM member_diet_assignments WHERE id = $1', [assignmentId1]);
    if (assignmentId2) await query('DELETE FROM member_diet_assignments WHERE id = $1', [assignmentId2]);
    if (planId1) await query('DELETE FROM diet_plans WHERE id = $1', [planId1]);
    if (planId2) await query('DELETE FROM diet_plans WHERE id = $1', [planId2]);
    for (const fid of foodItemIds) {
      await query('DELETE FROM food_items WHERE id = $1', [fid]);
    }
    if (userId) await query('DELETE FROM users WHERE id = $1', [userId]);
    if (memberId) await query('DELETE FROM members WHERE id = $1', [memberId]);
    if (trainerId) await query('DELETE FROM trainers WHERE id = $1', [trainerId]);
    await closePool();
  });

  test('UI File Structure: member-diet-plan.html exists and links required styling and scripts', () => {
    const htmlPath = path.join(rootDir, 'frontend', 'member-diet-plan.html');
    assert.ok(fs.existsSync(htmlPath), 'member-diet-plan.html must exist in /frontend');

    const content = fs.readFileSync(htmlPath, 'utf8');
    assert.match(content, /member-diet-plan\.css/, 'HTML must link css/member-diet-plan.css');
    assert.match(content, /member-diet-plan\.js/, 'HTML must load js/member/member-diet-plan.js as module');
    assert.match(content, /My Diet Plan/, 'HTML title must reflect diet plan');
  });

  test('UI Script: member-diet-plan.js supports all required metrics, meal groups, instructions, and history', () => {
    const jsPath = path.join(rootDir, 'frontend', 'js', 'member', 'member-diet-plan.js');
    assert.ok(fs.existsSync(jsPath), 'member-diet-plan.js must exist');

    const jsContent = fs.readFileSync(jsPath, 'utf8');
    // Check required metrics
    assert.match(jsContent, /Calories/i, 'Must support Calories target');
    assert.match(jsContent, /Protein/i, 'Must support Protein target');
    assert.match(jsContent, /Carbohydrates|Carbs/i, 'Must support Carbohydrate target');
    assert.match(jsContent, /Fat/i, 'Must support Fat target');
    assert.match(jsContent, /Water/i, 'Must support Water intake target');

    // Check required meal groups
    assert.match(jsContent, /breakfast/i, 'Must include Breakfast');
    assert.match(jsContent, /lunch/i, 'Must include Lunch');
    assert.match(jsContent, /dinner/i, 'Must include Dinner');
    assert.match(jsContent, /snack/i, 'Must include Snacks');

    // Check food quantities and meal instructions
    assert.match(jsContent, /custom_portion|servings/i, 'Must compute food quantities');
    assert.match(jsContent, /instructions|notes/i, 'Must display meal instructions');

    // Check meal schedule and nutritional information
    assert.match(jsContent, /scheduled_time|formatTime/i, 'Must display meal schedule');
    assert.match(jsContent, /macro|nutritional/i, 'Must show nutritional information and macro breakdown');

    // Check trainer connection and member connection
    assert.match(jsContent, /updated_at|last updated/i, 'Must show when trainer last updated the plan');
    assert.match(jsContent, /Latest Authorised Plan/i, 'Must show latest authorised plan badge');

    // Check history preservation
    assert.match(jsContent, /history|Past diet plans/i, 'Must preserve and display historical diet plans');
    assert.match(jsContent, /Historical Diet Plan/i, 'Must support viewing historical plans with back navigation');
  });

  test('Diet Plan Creation: Trainer creates a diet plan with targets, 4 meals, quantities, and instructions', async () => {
    const planData = {
      name: 'High Protein Cutting Plan Phase 1',
      trainer_id: trainerId,
      goal: 'Fat Loss',
      target_calories: 2200,
      target_protein_g: 175,
      target_carbs_g: 210,
      target_fats_g: 65,
      target_water_ml: 3500,
      description: 'Strict cutting diet designed to maintain lean muscle mass.',
      is_template: false,
    };

    const meals = [
      {
        meal_type: 'Breakfast',
        scheduled_time: '08:00:00',
        notes: 'Consume within 45 minutes of waking up with 500ml water.',
        items: [
          { food_item_id: foodItemIds[0], servings: 1.5, custom_portion: '75g dry oats', calories: 285, protein_g: 9.8, carbs_g: 49.5, fats_g: 5.3 },
          { food_item_id: foodItemIds[1], servings: 1.5, custom_portion: '3 whole boiled eggs', calories: 234, protein_g: 18.9, carbs_g: 1.6, fats_g: 15.9 },
        ],
      },
      {
        meal_type: 'Lunch',
        scheduled_time: '13:00:00',
        notes: 'Post-noon fuel. Season with herbs and rock salt only.',
        items: [
          { food_item_id: foodItemIds[2], servings: 1.2, custom_portion: '180g grilled breast', calories: 296, protein_g: 55.8, carbs_g: 0, fats_g: 6.5 },
          { food_item_id: foodItemIds[3], servings: 1.0, custom_portion: '150g brown rice', calories: 165, protein_g: 3.5, carbs_g: 35, fats_g: 1.2 },
        ],
      },
      {
        meal_type: 'Snacks',
        scheduled_time: '16:30:00',
        notes: 'Pre-workout booster. Take 45 minutes before training.',
        items: [
          { food_item_id: foodItemIds[4], servings: 1.0, custom_portion: '1 scoop in water', calories: 120, protein_g: 25, carbs_g: 2, fats_g: 1 },
          { food_item_id: foodItemIds[5], servings: 1.0, custom_portion: '25g raw almonds', calories: 145, protein_g: 5.3, carbs_g: 5.4, fats_g: 12.4 },
        ],
      },
      {
        meal_type: 'Dinner',
        scheduled_time: '20:00:00',
        notes: 'Light dinner rich in healthy omega fats and protein.',
        items: [
          { food_item_id: foodItemIds[6], servings: 1.0, custom_portion: '150g grilled salmon', calories: 312, protein_g: 34, carbs_g: 0, fats_g: 18.5 },
        ],
      },
    ];

    const plan = await dietRepo.createDietPlan(planData, meals);
    assert.ok(plan.id, 'Created plan must have an id');
    planId1 = plan.id;

    // Verify detail
    const detail = await dietRepo.getDietPlanById(planId1);
    assert.equal(detail.name, 'High Protein Cutting Plan Phase 1');
    assert.equal(detail.target_calories, 2200);
    assert.equal(detail.target_protein_g, 175);
    assert.equal(detail.target_carbs_g, 210);
    assert.equal(detail.target_fats_g, 65);
    assert.equal(detail.target_water_ml, 3500);
    assert.equal(detail.meals.length, 4, 'Must have 4 meals (Breakfast, Lunch, Snacks, Dinner)');
  });

  test('Trainer Assigns Diet Plan: Member sees the plan as their latest active assignment', async () => {
    const assignment = await dietRepo.assignDietPlanToMember({
      member_id: memberId,
      plan_id: planId1,
      assigned_by_trainer_id: trainerId,
      start_date: '2026-11-01',
      notes: 'Initial 4-week cut phase. Maintain water intake at 3.5L minimum.',
    });

    assert.ok(assignment.id);
    assert.equal(assignment.status, 'active');
    assignmentId1 = assignment.id;

    // Call memberPortal service to fetch diet plans
    const memberDiet = await memberSvc.getDietPlans(memberId);
    assert.ok(memberDiet.current, 'Member must have a current active diet plan');
    assert.equal(memberDiet.current.assignment.id, assignmentId1);
    assert.equal(memberDiet.current.plan.id, planId1);
    assert.equal(memberDiet.current.plan.target_calories, 2200);
    assert.equal(memberDiet.current.plan.target_water_ml, 3500);

    // Check meals structure in member view
    const meals = memberDiet.current.plan.meals;
    assert.equal(meals.length, 4);

    const breakfast = meals.find((m) => /breakfast/i.test(m.meal_type));
    assert.ok(breakfast, 'Breakfast meal must exist');
    assert.equal(breakfast.scheduled_time, '08:00:00');
    assert.match(breakfast.notes, /500ml water/);
    assert.equal(breakfast.items.length, 2);
    assert.equal(breakfast.items[0].custom_portion, '75g dry oats');

    const dinner = meals.find((m) => /dinner/i.test(m.meal_type));
    assert.ok(dinner, 'Dinner meal must exist');
    assert.equal(dinner.scheduled_time, '20:00:00');
  });

  test('Trainer Updates Diet Plan: Member immediately sees updated targets and timestamp', async () => {
    // Trainer modifies the diet plan targets
    const updateResult = await trainerRepo.updateDietPlan(trainerId, planId1, {
      target_calories: 2350,
      target_protein_g: 190,
      target_water_ml: 4000,
      description: 'Updated with +15g protein and +500ml water for recovery.',
    });

    assert.ok(updateResult, 'Plan should be updated');
    assert.equal(updateResult.target_calories, 2350);
    assert.equal(updateResult.target_protein_g, 190);
    assert.equal(updateResult.target_water_ml, 4000);

    // Member fetches their current plan
    const memberDiet = await memberSvc.getDietPlans(memberId);
    assert.ok(memberDiet.current);
    assert.equal(memberDiet.current.plan.target_calories, 2350, 'Member should see updated calories');
    assert.equal(memberDiet.current.plan.target_protein_g, 190, 'Member should see updated protein');
    assert.equal(memberDiet.current.plan.target_water_ml, 4000, 'Member should see updated water target');
    assert.match(memberDiet.current.plan.description, /recovery/);
  });

  test('Trainer Assigns New Plan: Preserves previous plan in history and makes new plan current', async () => {
    // 1. Trainer creates a second diet plan
    const plan2Data = {
      name: 'Lean Bulk Muscle Hypertrophy Phase 2',
      trainer_id: trainerId,
      goal: 'Muscle Gain / Hypertrophy',
      target_calories: 2800,
      target_protein_g: 200,
      target_carbs_g: 320,
      target_fats_g: 75,
      target_water_ml: 4000,
      description: 'Caloric surplus phase with elevated carbohydrates for training intensity.',
      is_template: false,
    };

    const meals2 = [
      {
        meal_type: 'Breakfast',
        scheduled_time: '07:30:00',
        notes: 'High energy start.',
        items: [
          { food_item_id: foodItemIds[0], servings: 2.0, custom_portion: '100g dry oats', calories: 380, protein_g: 13, carbs_g: 66, fats_g: 7 },
        ],
      },
    ];

    const plan2 = await dietRepo.createDietPlan(plan2Data, meals2);
    planId2 = plan2.id;

    // 2. Trainer assigns Plan 2 to member
    const newAssignment = await dietRepo.assignDietPlanToMember({
      member_id: memberId,
      plan_id: planId2,
      assigned_by_trainer_id: trainerId,
      start_date: '2026-11-12',
      notes: 'Transition to Lean Bulking phase. Great work on Phase 1!',
    });
    assignmentId2 = newAssignment.id;

    // 3. Member retrieves diet plans
    const memberDiet = await memberSvc.getDietPlans(memberId);

    // Verify current plan is the latest authorised plan (Plan 2)
    assert.ok(memberDiet.current, 'Must have an active current plan');
    assert.equal(memberDiet.current.assignment.id, assignmentId2, 'Current plan must be the latest assignment');
    assert.equal(memberDiet.current.plan.id, planId2);
    assert.equal(memberDiet.current.plan.name, 'Lean Bulk Muscle Hypertrophy Phase 2');
    assert.equal(memberDiet.current.plan.target_calories, 2800);

    // Verify historical plan (Plan 1) is preserved in history!
    assert.ok(memberDiet.history.length >= 1, 'Historical plans must be preserved');
    const pastPlan = memberDiet.history.find((h) => h.id === assignmentId1);
    assert.ok(pastPlan, 'Phase 1 assignment must be in history');
    assert.equal(pastPlan.status, 'completed', 'Prior plan must be marked completed');
    assert.ok(pastPlan.end_date, 'Prior plan must have an end_date');
    assert.equal(pastPlan.plan_name, 'High Protein Cutting Plan Phase 1');

    // 4. Member requests the historical plan detail via GET /diet-plans/:assignmentId
    const historicalDetail = await memberSvc.getDietAssignment(memberId, assignmentId1);
    assert.ok(historicalDetail, 'Historical assignment detail must load');
    assert.equal(historicalDetail.assignment.status, 'completed');
    assert.equal(historicalDetail.plan.id, planId1);
    assert.equal(historicalDetail.plan.target_calories, 2350);
    assert.equal(historicalDetail.plan.meals.length, 4, 'Historical plan retains all original 4 meals');

    const histBreakfast = historicalDetail.plan.meals.find((m) => /breakfast/i.test(m.meal_type));
    assert.ok(histBreakfast);
    assert.equal(histBreakfast.items.length, 2);
    assert.equal(histBreakfast.items[0].custom_portion, '75g dry oats');
  });
});
