import { Router } from 'express';
import * as trainerController from '../controllers/trainer.controller.js';

const router = Router();

// GET /api/trainers
router.get('/', trainerController.getTrainers);

export default router;

