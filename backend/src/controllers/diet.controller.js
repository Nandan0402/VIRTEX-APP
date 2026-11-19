import * as dietRepo from '../repositories/diet.repository.js';

export async function getFoodItems(req, res) {
  try {
    const { category, search, is_vegetarian, is_vegan } = req.query;
    const items = await dietRepo.getFoodItems({ category, search, is_vegetarian, is_vegan });
    res.json({
      success: true,
      count: items.length,
      data: items
    });
  } catch (error) {
    console.error('Error in getFoodItems:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch food items database.' });
  }
}

export async function getFoodItemById(req, res) {
  try {
    const { id } = req.params;
    const food = await dietRepo.getFoodItemById(id);
    if (!food) {
      return res.status(404).json({ success: false, message: 'Food item not found.' });
    }
    res.json({ success: true, data: food });
  } catch (error) {
    console.error('Error in getFoodItemById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch food item details.' });
  }
}

export async function createFoodItem(req, res) {
  try {
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
    } = req.body;

    if (!name || !category || calories === undefined || protein_g === undefined || carbs_g === undefined || fats_g === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Name, category, calories, protein, carbs, and fats are required.'
      });
    }

    const newFood = await dietRepo.createFoodItem({
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
    });

    res.status(201).json({
      success: true,
      message: 'Food item successfully added to database.',
      data: newFood
    });
  } catch (error) {
    console.error('Error in createFoodItem:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'A food item with this name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Failed to create food item.' });
  }
}

export async function getDietPlans(req, res) {
  try {
    const { trainer_id, goal, search } = req.query;
    const plans = await dietRepo.getDietPlans({ trainer_id, goal, search });
    res.json({
      success: true,
      count: plans.length,
      data: plans
    });
  } catch (error) {
    console.error('Error in getDietPlans:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch diet plans.' });
  }
}

export async function getDietPlanById(req, res) {
  try {
    const { id } = req.params;
    const plan = await dietRepo.getDietPlanById(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Diet plan not found.' });
    }
    res.json({ success: true, data: plan });
  } catch (error) {
    console.error('Error in getDietPlanById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch diet plan details.' });
  }
}

export async function createDietPlan(req, res) {
  try {
    const {
      name,
      trainer_id,
      goal,
      target_calories,
      target_protein_g,
      target_carbs_g,
      target_fats_g,
      target_water_ml,
      description,
      is_template,
      meals
    } = req.body;

    if (!name || !goal || !target_calories || !target_protein_g) {
      return res.status(400).json({
        success: false,
        message: 'Plan name, goal, target calories, and target protein are required.'
      });
    }

    const newPlan = await dietRepo.createDietPlan({
      name,
      trainer_id,
      goal,
      target_calories,
      target_protein_g,
      target_carbs_g,
      target_fats_g,
      target_water_ml,
      description,
      is_template
    }, meals || []);

    res.status(201).json({
      success: true,
      message: 'Diet plan successfully created.',
      data: newPlan
    });
  } catch (error) {
    console.error('Error in createDietPlan:', error);
    res.status(500).json({ success: false, message: 'Failed to create diet plan.' });
  }
}

export async function getMemberDietAssignments(req, res) {
  try {
    const { member_id, trainer_id, status } = req.query;
    const assignments = await dietRepo.getMemberDietAssignments({ member_id, trainer_id, status });
    res.json({
      success: true,
      count: assignments.length,
      data: assignments
    });
  } catch (error) {
    console.error('Error in getMemberDietAssignments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch member diet assignments.' });
  }
}

export async function assignDietPlanToMember(req, res) {
  try {
    const { member_id, plan_id, assigned_by_trainer_id, start_date, notes } = req.body;
    if (!member_id || !plan_id) {
      return res.status(400).json({
        success: false,
        message: 'Member ID and Diet Plan ID are required.'
      });
    }

    const assignment = await dietRepo.assignDietPlanToMember({
      member_id,
      plan_id,
      assigned_by_trainer_id,
      start_date,
      notes
    });

    res.status(201).json({
      success: true,
      message: 'Diet plan assigned to member successfully.',
      data: assignment
    });
  } catch (error) {
    console.error('Error in assignDietPlanToMember:', error);
    res.status(500).json({ success: false, message: 'Failed to assign diet plan.' });
  }
}

export async function updateDietAssignmentStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'completed', 'paused'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid assignment status.' });
    }
    const updated = await dietRepo.updateDietAssignmentStatus(id, status);
    res.json({
      success: true,
      message: `Diet assignment status changed to ${status}.`,
      data: updated
    });
  } catch (error) {
    console.error('Error in updateDietAssignmentStatus:', error);
    res.status(500).json({ success: false, message: 'Failed to update diet assignment status.' });
  }
}

export async function getMemberDailyNutritionLogs(req, res) {
  try {
    const { member_id, start_date, end_date, limit } = req.query;
    const logs = await dietRepo.getMemberDailyNutritionLogs({
      member_id,
      start_date,
      end_date,
      limit: limit ? parseInt(limit, 10) : 21
    });
    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('Error in getMemberDailyNutritionLogs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch daily nutrition logs.' });
  }
}

export async function logDailyNutrition(req, res) {
  try {
    const {
      member_id,
      log_date,
      total_calories,
      total_protein_g,
      total_carbs_g,
      total_fats_g,
      water_intake_ml,
      adherence_score,
      notes,
      mealEntries
    } = req.body;

    if (!member_id) {
      return res.status(400).json({ success: false, message: 'Member ID is required.' });
    }

    const log = await dietRepo.logDailyNutrition({
      member_id,
      log_date,
      total_calories,
      total_protein_g,
      total_carbs_g,
      total_fats_g,
      water_intake_ml,
      adherence_score,
      notes,
      logged_by: req.user?.username || 'Admin'
    }, mealEntries || []);

    res.status(201).json({
      success: true,
      message: 'Daily nutrition and water intake recorded successfully.',
      data: log
    });
  } catch (error) {
    console.error('Error in logDailyNutrition:', error);
    res.status(500).json({ success: false, message: 'Failed to record nutrition log.' });
  }
}

export async function getDietAdherenceAnalytics(req, res) {
  try {
    const analytics = await dietRepo.getDietAdherenceAnalytics();
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error in getDietAdherenceAnalytics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch diet analytics.' });
  }
}

