/**
 * performance.routes.js - Express Router for Client Performance Center
 */

import { Router } from 'express';
import * as performanceController from '../controllers/performance.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Protect with JWT authentication and admin roles
router.use(authenticateToken);

// 1. Performance Overview Cards Grid (with filtering)
router.get('/cards', requireRole('owner', 'manager', 'trainer'), performanceController.getPerformanceCards);

// 2. Member Performance Deep Analytics
router.get('/member/:memberId', requireRole('owner', 'manager', 'trainer'), performanceController.getMemberDetails);

// 3. Log Strength Milestone (1RM)
router.post('/member/:memberId/strength', requireRole('owner', 'manager', 'trainer'), performanceController.logStrength);

// 4. Log Body Measurements
router.post('/member/:memberId/measurements', requireRole('owner', 'manager', 'trainer'), performanceController.logBodyMeasurement);

// 5. Post Trainer Coaching Comment
router.post('/member/:memberId/comments', requireRole('owner', 'manager', 'trainer'), performanceController.addComment);

export default router;

