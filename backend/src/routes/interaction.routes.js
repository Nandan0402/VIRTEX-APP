import { Router } from 'express';
import * as interactionController from '../controllers/interaction.controller.js';
import { validateInteraction } from '../middlewares/validator.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// POST /api/interactions  (kiosk logs a conversation turn — stays public)
router.post('/', validateInteraction, interactionController.createInteraction);

// GET /api/interactions  (visitors' conversation history -> Admin only; was public)
router.get('/', authenticateToken, requireRole('owner', 'manager'), interactionController.getInteractions);

export default router;

