import * as authService from '../services/auth.service.js';

/**
 * POST /api/v1/auth/login
 * Authenticates user credentials, generates signed JWT token with RBAC claims
 */
export async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    const authResult = await authService.loginUser(username, password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

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
 * POST /api/v1/auth/logout
 * Revokes active JWT session token and logs audit event
 */
export async function logout(req, res, next) {
  try {
    const result = await authService.logoutUser({
      token: req.rawToken,
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/auth/me
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
