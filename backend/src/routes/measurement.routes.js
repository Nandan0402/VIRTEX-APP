import { Router } from 'express';
import * as measurementController from '../controllers/measurement.controller.js';
import { requireRole } from '../middlewares/auth.js';

const router = Router();

// Body Measurements History & Logging
router.get('/', requireRole('owner', 'manager', 'trainer'), measurementController.getBodyMeasurements);
router.get('/kpis/summary', requireRole('owner', 'manager', 'trainer'), measurementController.getMeasurementModuleKpis);
router.get('/:id', requireRole('owner', 'manager', 'trainer'), measurementController.getMeasurementById);
router.post('/', requireRole('owner', 'manager', 'trainer'), measurementController.recordBodyMeasurement);

// Transformation Timeline & Deltas
router.get('/timeline/:memberId', requireRole('owner', 'manager', 'trainer'), measurementController.getTransformationTimeline);

// Before-and-After Photos (Consent Enforced)
router.get('/photos/:memberId', requireRole('owner', 'manager', 'trainer'), measurementController.getTransformationPhotos);
router.post('/photos', requireRole('owner', 'manager', 'trainer'), measurementController.addTransformationPhoto);

// Monthly Comparison & Downloadable Reports
router.get('/report/:memberId', requireRole('owner', 'manager', 'trainer'), measurementController.getMonthlyComparisonReport);

export default router;

