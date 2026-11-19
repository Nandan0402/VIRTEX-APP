import * as authService from '../services/auth.service.js';
import * as userRepository from '../repositories/user.repository.js';

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
      message: authResult.twoStep ? 'Password correct — now confirm with Google.' : `Welcome back, ${authResult.user.fullName}!`,
      data: authResult,
    });
  } catch (err) {
    res.status(err.code === 'ACCOUNT_FROZEN' ? 403 : 401).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
}

/**
 * POST /api/v1/auth/2fa/google   { challenge, id_token } — step 2 of member / trainer sign-in.
 */
export async function twoStepGoogle(req, res) {
  try {
    const { challenge, id_token, idToken } = req.body || {};
    const authResult = await authService.completeTwoStepWithGoogle({ challenge, idToken: id_token || idToken, meta: { ipAddress: req.ip, userAgent: req.headers['user-agent'] } });
    res.json({ success: true, message: `Welcome back, ${authResult.user.fullName}!`, data: authResult });
  } catch (err) {
    res.status(err.status || 401).json({ success: false, error: err.message });
  }
}

/**
 * POST /api/v1/auth/google
 * Authenticates with a Google OAuth 2.0 ID token
 */
export async function googleLogin(req, res, next) {
  try {
    const { id_token, idToken, role = 'member' } = req.body;
    const tokenToVerify = id_token || idToken;

    if (!tokenToVerify) {
      return res.status(400).json({
        success: false,
        error: 'Google ID token is required.',
      });
    }

    const authResult = await authService.loginWithGoogle({
      idToken: tokenToVerify,
      role,
      meta: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Signed in with Google successfully! Welcome, ${authResult.user.fullName}!`,
      data: authResult,
    });
  } catch (err) {
    const status = err.status || (err.code === 'ACCOUNT_FROZEN' ? 403 : 401);
    res.status(status).json({
      success: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
}

/**
 * POST /api/v1/auth/register
 * Self-service registration for Members, Personal Trainers, and Admins (with invite key)
 */
export async function register(req, res, next) {
  try {
    const authResult = await authService.registerUser(req.body, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      success: true,
      message: `Account created successfully! Welcome, ${authResult.user.fullName}!`,
      data: authResult,
    });
  } catch (err) {
    res.status(err.status === 403 ? 403 : 400).json({
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
      data: {
        ...userProfile,
        user: userProfile,
        fullName: userProfile.fullName || userProfile.full_name,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/auth/profile
 * Updates authenticated user's profile details (fullName, phone, email, optional password)
 */
export async function updateProfile(req, res, next) {
  try {
    // Members' personal details live on their gym record (members table, admin-managed). They are
    // changed through PATCH /api/v1/member/profile so both records stay in sync; here members may
    // only change their password.
    if (String(req.user?.role || '').toLowerCase() === 'member') {
      const blocked = ['fullName', 'email', 'phone', 'avatarUrl'].filter((k) => req.body?.[k] !== undefined);
      if (blocked.length) {
        return res.status(403).json({
          success: false,
          error: 'Members update personal details from My Account in the Member Portal.',
        });
      }
    }
    // Trainer passwords are authorised by the gym admin: trainers request a change from Trainer Hub → Settings
    // (POST /api/v1/trainer/account/password-request) and the admin sets it on the coach record.
    const pwKeys = ['newPassword', 'password', 'currentPassword'].filter((k) => req.body?.[k] !== undefined);
    if (String(req.user?.role || '').toLowerCase() === 'trainer' && pwKeys.length) {
      return res.status(403).json({
        success: false,
        code: 'PASSWORD_MANAGED_BY_ADMIN',
        error: 'Trainer passwords are set by the gym admin. Send a password change request from Settings.',
      });
    }
    const updated = await authService.updateUserProfile(req.user.id, req.body);
    res.json({
      success: true,
      message: 'Profile updated successfully!',
      data: updated,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * POST /api/v1/auth/forgot-password
 * Member password-reset REQUEST (no email service exists, so no reset link/token is issued).
 * Always answers with the same generic message so the endpoint cannot be used to discover
 * which accounts exist. When the identifier matches an active MEMBER account, a
 * PASSWORD_RESET_REQUESTED event is written to the existing auth_audit_logs table so the
 * gym team (Admin -> Security) can verify the member and reset the password.
 */
const RESET_ACK = 'If an active member account matches those details, the gym team has been notified. '
  + 'Please visit the front desk with photo ID to complete your password reset.';

export async function forgotPassword(req, res, next) {
  try {
    const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
    if (!identifier || identifier.length > 150) {
      return res.status(400).json({ success: false, error: 'Enter the username, email or phone number on your membership.' });
    }
    const user = await userRepository.findByUsernameOrEmail(identifier).catch(() => null);
    if (user && String(user.role).toLowerCase() === 'member' && user.is_active !== false) {
      await userRepository.recordAuthAudit({
        userId: user.id,
        username: user.username,
        eventType: 'PASSWORD_RESET_REQUESTED',
        role: 'member',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        details: { channel: 'member-forgot-password' },
      }).catch((e) => console.warn('[Auth] reset-request audit failed:', e.message));
    }
    res.json({ success: true, message: RESET_ACK });
  } catch (err) {
    next(err);
  }
}
