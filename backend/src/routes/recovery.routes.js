import { Router } from 'express';
import * as recoveryController from '../controllers/recovery.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Recovery Logs
router.get('/logs', requireRole('owner', 'manager', 'trainer'), recoveryController.getRecoveryLogs);
router.get('/logs/:id', requireRole('owner', 'manager', 'trainer'), recoveryController.getRecoveryLogById);
router.post('/logs', requireRole('owner', 'manager', 'trainer'), recoveryController.logMemberRecovery);

// Muscle Soreness Heatmap
router.get('/soreness/:memberId', requireRole('owner', 'manager', 'trainer'), recoveryController.getMuscleSorenessHeatmap);

// Trainer Recovery Overview & Reviews
router.get('/trainer-overview', requireRole('owner', 'manager', 'trainer'), recoveryController.getTrainerRecoveryOverview);
router.post('/trainer-reviews', requireRole('owner', 'manager', 'trainer'), recoveryController.addTrainerRecoveryReview);

// Longitudinal Member Recovery Report
router.get('/report/:memberId', requireRole('owner', 'manager', 'trainer'), recoveryController.getMemberRecoveryReport);

// Recovery KPIs & Distribution
router.get('/kpis', requireRole('owner', 'manager', 'trainer'), recoveryController.getRecoveryModuleKpis);

export default router;

