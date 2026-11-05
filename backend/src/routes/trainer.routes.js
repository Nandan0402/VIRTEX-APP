import { Router } from 'express';
import * as trainerController from '../controllers/trainer.controller.js';
import { authenticateToken, requireRole, requireResourceOwner } from '../middlewares/auth.js';

const router = Router();

// Public: GET /api/v1/trainers (or /api/trainers)
router.get('/', trainerController.getTrainers);

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
