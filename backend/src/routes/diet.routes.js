import { Router } from 'express';
import * as dietController from '../controllers/diet.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Food Database
router.get('/foods', requireRole('owner', 'manager', 'trainer'), dietController.getFoodItems);
router.get('/foods/:id', requireRole('owner', 'manager', 'trainer'), dietController.getFoodItemById);
router.post('/foods', requireRole('owner', 'manager', 'trainer'), dietController.createFoodItem);

// Diet Plans & Schedules
router.get('/plans', requireRole('owner', 'manager', 'trainer'), dietController.getDietPlans);
router.get('/plans/:id', requireRole('owner', 'manager', 'trainer'), dietController.getDietPlanById);
router.post('/plans', requireRole('owner', 'manager', 'trainer'), dietController.createDietPlan);

// Member Assignments
router.get('/assignments', requireRole('owner', 'manager', 'trainer'), dietController.getMemberDietAssignments);
router.post('/assignments', requireRole('owner', 'manager', 'trainer'), dietController.assignDietPlanToMember);
router.patch('/assignments/:id/status', requireRole('owner', 'manager', 'trainer'), dietController.updateDietAssignmentStatus);

// Daily Logs & Water Tracking
router.get('/logs', requireRole('owner', 'manager', 'trainer'), dietController.getMemberDailyNutritionLogs);
router.post('/logs', requireRole('owner', 'manager', 'trainer'), dietController.logDailyNutrition);

// Adherence Analytics
router.get('/analytics', requireRole('owner', 'manager', 'trainer'), dietController.getDietAdherenceAnalytics);

export default router;

