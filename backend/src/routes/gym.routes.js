import { Router } from 'express';
import * as gymController from '../controllers/gym.controller.js';
import * as adminController from '../controllers/admin.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.js';

const router = Router();

// GET /api/gym/info
router.get('/info', gymController.getGymInfo);

// PUT /api/gym/info (Update facility settings: Owner, Manager)
router.put('/info', authenticateToken, requireRole('owner', 'manager'), adminController.updateSettings);
router.put('/profile', authenticateToken, requireRole('owner', 'manager'), adminController.updateSettings);

export default router;

