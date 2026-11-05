import { Router } from 'express';
import * as membershipController from '../controllers/membership.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Public: GET /api/membership-plans
router.get('/', membershipController.getMembershipPlans);

// RBAC Protected: Owner, Manager
router.post('/', authenticateToken, requireRole('owner', 'manager'), membershipController.createPlan);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), membershipController.updatePlan);
router.patch('/:id/toggle', authenticateToken, requireRole('owner', 'manager'), membershipController.togglePlan);
router.delete('/:id', authenticateToken, requireRole('owner', 'manager'), membershipController.deletePlan);

export default router;

