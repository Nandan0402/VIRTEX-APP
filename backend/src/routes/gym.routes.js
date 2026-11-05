import { Router } from 'express';
import * as gymController from '../controllers/gym.controller.js';

const router = Router();

// GET /api/gym/info
router.get('/info', gymController.getGymInfo);

export default router;

