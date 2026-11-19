import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.js';
import { authRateLimiter } from '../middlewares/rateLimiter.js';
import { validateLogin, validateRegister } from '../middlewares/validator.js';
import * as adminSignup from '../controllers/adminSignup.controller.js';

const router = Router();

// POST /api/v1/auth/login
router.post('/login', authRateLimiter, validateLogin, authController.login);

// POST /api/v1/auth/google (Google OAuth 2.0 Sign-In)
router.post('/google', authRateLimiter, authController.googleLogin);
router.post('/2fa/google', authRateLimiter, authController.twoStepGoogle);   // step 2 for members / trainers

// POST /api/v1/auth/register (Member, Personal Trainer, Admin registration)
router.post('/register', authRateLimiter, validateRegister, authController.register);

// POST /api/v1/auth/admin-signup: admin sign-up request; the account stays switched off until the owner approves it
router.post('/admin-signup', authRateLimiter, adminSignup.requestAdminSignup);

// POST /api/v1/auth/logout (Protected by JWT)
router.post('/logout', authenticateToken, authController.logout);

// Member password-reset request (generic response; logged for staff follow-up)
router.post('/forgot-password', authRateLimiter, authController.forgotPassword);

// GET /api/v1/auth/me (Protected by JWT)
router.get('/me', authenticateToken, authController.getMe);

// PUT /api/v1/auth/profile (Protected by JWT)
router.put('/profile', authenticateToken, authController.updateProfile);

export default router;
