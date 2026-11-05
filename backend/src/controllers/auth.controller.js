import * as authService from '../services/auth.service.js';

/**
 * POST /api/auth/login
 * Authenticates admin or trainer credentials, returns JWT bearer token
 */
export async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const authResult = await authService.loginUser(username, password);

    res.json({
      success: true,
      message: `Welcome back, ${authResult.user.fullName}!`,
      data: authResult,
    });
  } catch (err) {
    res.status(401).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * GET /api/auth/me
 * Returns authenticated user session details
 */
export async function getMe(req, res, next) {
  try {
    const userProfile = await authService.getUserProfile(req.user.id);
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.',
      });
    }

    res.json({
      success: true,
      data: userProfile,
    });
  } catch (err) {
    next(err);
  }
}

