import { Router } from 'express';
import * as trainerController from '../controllers/trainer.controller.js';
import * as trainerAssignmentController from '../controllers/trainerAssignment.controller.js';
import { authenticateToken, requireRole, requireResourceOwner } from '../middlewares/auth.js';
import { forceOwnTrainerFilter } from '../middlewares/portalAccess.js';

const router = Router();

// Public: GET /api/v1/trainers (or /api/trainers)
router.get('/', trainerController.getTrainers);

// RBAC Protected: Personal Trainer Assignments & Monthly Fees
router.get(
  '/assignments/summary',
  authenticateToken,
  requireRole('owner', 'manager'),          // gym-wide totals -> Admin only
  trainerAssignmentController.getTrainerAssignmentsSummary
);
router.get(
  '/assignments',
  authenticateToken,
  requireRole('owner', 'manager', 'trainer'),
  forceOwnTrainerFilter,                     // trainers: ?trainerId forced to their own id
  trainerAssignmentController.getTrainerAssignments
);
router.post(
  '/assignments',
  authenticateToken,
  requireRole('owner', 'manager'),
  trainerAssignmentController.createTrainerAssignment
);
router.put(
  '/assignments/:id',
  authenticateToken,
  requireRole('owner', 'manager'),
  trainerAssignmentController.updateTrainerAssignment
);
router.delete(
  '/assignments/:id',
  authenticateToken,
  requireRole('owner', 'manager'),
  trainerAssignmentController.deleteTrainerAssignment
);

// RBAC Protected: PATCH /api/v1/trainers/:id/status
// Trainers can update their own status; Managers and Owners can update any trainer
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole('owner', 'manager', 'trainer'),
  requireResourceOwner({ idParam: 'id', role: 'trainer' }),
  trainerController.updateStatus
);

// RBAC Protected Management: Owner, Manager
router.post('/', authenticateToken, requireRole('owner', 'manager'), trainerController.createTrainer);
router.put('/:id', authenticateToken, requireRole('owner', 'manager'), trainerController.updateTrainer);
router.delete('/:id', authenticateToken, requireRole('owner', 'manager'), trainerController.deleteTrainer);

export default router;
