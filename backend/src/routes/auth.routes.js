import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.js';
import { authRateLimiter } from '../middlewares/rateLimiter.js';
import { validateLogin } from '../middlewares/validator.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', authRateLimiter, validateLogin, authController.login);

// POST /api/v1/auth/logout (Protected by JWT)
router.post('/logout', authenticateToken, authController.logout);

// GET /api/v1/auth/me (Protected by JWT)
router.get('/me', authenticateToken, authController.getMe);

export default router;
