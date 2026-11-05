import { Router } from 'express';
import * as membershipController from '../controllers/membership.controller.js';

const router = Router();

// GET /api/membership-plans
router.get('/', membershipController.getMembershipPlans);

export default router;

