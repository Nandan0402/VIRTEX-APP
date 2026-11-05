import { Router } from 'express';
import * as interactionController from '../controllers/interaction.controller.js';
import { validateInteraction } from '../middlewares/validator.js';

const router = Router();

// POST /api/interactions
router.post('/', validateInteraction, interactionController.createInteraction);

// GET /api/interactions
router.get('/', interactionController.getInteractions);

export default router;

