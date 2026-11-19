import { Router } from 'express';
import * as analyticsController from '../controllers/analytics.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// Protect ALL analytics routes server-side with JWT authentication
router.use(authenticateToken);

// Role-adaptive report endpoint (accessible to all authenticated staff: trainer, manager, owner)
router.get('/report', requireRole('owner', 'manager', 'trainer', 'superadmin', 'admin'), analyticsController.getRoleReport);

// Trainer availability analytics (accessible to staff)
router.get('/trainers', requireRole('owner', 'manager', 'trainer', 'superadmin', 'admin'), analyticsController.getTrainerAvailability);

// Executive & Managerial Analytics Endpoints (Owner & Manager)
router.get('/overview', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getOverview);
router.get('/check-ins', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getCheckIns);
router.get('/enquiries', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getEnquiries);
router.get('/faqs', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getPopularFaqs);
router.get('/languages', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getLanguages);
router.get('/robot', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getRobotMetrics);
router.get('/robot-commands', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getRobotCommands);
router.get('/ai-performance', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getAiPerformance);
router.get('/failed-interactions', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getFailedInteractions);
router.get('/summary', requireRole('owner', 'manager', 'superadmin', 'admin'), analyticsController.getSummary);

export default router;

