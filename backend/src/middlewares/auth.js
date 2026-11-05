import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import * as userRepository from '../repositories/user.repository.js';

/**
 * Normalizes role codes (e.g. 'superadmin' and 'owner' are equivalent)
 */
export function normalizeRole(role) {
  if (!role) return 'guest';
  const r = String(role).toLowerCase().trim();
  if (r === 'superadmin') return 'owner';
  return r;
}

/**
 * Checks whether user permissions satisfy a required permission string
 * Supports wildcards (e.g. 'members:*' satisfies 'members:read')
 */
export function hasPermission(userPermissions = [], requiredPermission) {
  if (userPermissions.includes('*')) return true;
  if (userPermissions.includes(requiredPermission)) return true;

  // Wildcard check (e.g. 'members:*')
  const [reqDomain] = requiredPermission.split(':');
  if (userPermissions.includes(`${reqDomain}:*`) || userPermissions.includes(`${reqDomain}.*`)) {
    return true;
  }

  return false;
}

/**
 * JWT Authentication Middleware
 * Extracts Bearer token, validates signature/expiration, and verifies token blacklist
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Missing Bearer token in Authorization header.',
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);

    // Verify token is not in the revocation blacklist
    if (decoded.jti) {
      const isRevoked = await userRepository.isTokenBlacklisted(decoded.jti);
      if (isRevoked) {
        return res.status(403).json({
          success: false,
          error: 'Session has been revoked or logged out. Please sign in again.',
        });
      }
    }

    req.user = decoded; // { id, username, role, fullName, permissions, memberId, trainerId, jti }
    req.rawToken = token;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired authentication token. Please sign in again.',
    });
  }
}

/**
 * Optional Authentication Middleware
 * Populates req.user if valid token present, otherwise defaults to Guest role
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    req.user = {
      id: null,
      username: 'guest',
      role: 'guest',
      permissions: ['gym:read', 'faqs:read', 'plans:read', 'enquiries:create'],
    };
    return next();
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.jti) {
      const isRevoked = await userRepository.isTokenBlacklisted(decoded.jti);
      if (isRevoked) {
        req.user = { id: null, username: 'guest', role: 'guest', permissions: [] };
        return next();
      }
    }
    req.user = decoded;
    req.rawToken = token;
    next();
  } catch {
    req.user = { id: null, username: 'guest', role: 'guest', permissions: [] };
    next();
  }
}

/**
 * Role-Based Access Control (RBAC) Middleware
 * Accepts list of allowed roles (e.g. 'owner', 'manager', 'trainer', 'member')
 * Automatically treats 'superadmin' and 'owner' as interchangeable
 * @param  {...string} roles
 */
export function requireRole(...roles) {
  const allowed = roles.flat().map((r) => r.toLowerCase());

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication required before checking role permissions.',
      });
    }

    const userRoleNorm = normalizeRole(req.user.role);
    const hasRole = allowed.some((r) => normalizeRole(r) === userRoleNorm || r === req.user.role.toLowerCase());

    if (!hasRole) {
      // Record access denial in audit logs asynchronously
      userRepository.recordAuthAudit({
        userId: req.user.id,
        username: req.user.username,
        eventType: 'ACCESS_DENIED',
        role: req.user.role,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { path: req.originalUrl, method: req.method, requiredRoles: allowed },
      }).catch(() => {});

      return res.status(403).json({
        success: false,
        error: `Access Denied: Role '${req.user.role}' lacks permission for this action. Required: [${allowed.join(', ')}]`,
      });
    }

    next();
  };
}

/**
 * Granular Permission-Based Access Control Middleware
 * @param {...string} permissions
 */
export function requirePermission(...permissions) {
  const required = permissions.flat();

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication required before checking permissions.',
      });
    }

    const userPermissions = req.user.permissions || [];
    const authorized = required.every((p) => hasPermission(userPermissions, p));

    if (!authorized) {
      userRepository.recordAuthAudit({
        userId: req.user.id,
        username: req.user.username,
        eventType: 'ACCESS_DENIED',
        role: req.user.role,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { path: req.originalUrl, method: req.method, requiredPermissions: required },
      }).catch(() => {});

      return res.status(403).json({
        success: false,
        error: `Access Denied: Missing required permission(s) [${required.join(', ')}].`,
      });
    }

    next();
  };
}

/**
 * Resource-Level Authorization
 * Ensures trainers can only access their own schedules and members can only access their own data
 * Owners and Managers automatically bypass resource ownership restrictions
 */
export function requireResourceOwner({ idParam = 'id', role = 'trainer' } = {}) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const userRole = normalizeRole(req.user.role);
    // Owners and Managers have universal supervisory access
    if (userRole === 'owner' || userRole === 'manager') {
      return next();
    }

    const targetId = Number(req.params[idParam]) || req.params[idParam];

    if (role === 'trainer') {
      if (req.user.trainerId && req.user.trainerId === Number(targetId)) {
        return next();
      }
    } else if (role === 'member') {
      if (
        (req.user.memberId && req.user.memberId === Number(targetId)) ||
        (req.user.username && req.user.username === targetId)
      ) {
        return next();
      }
    }

    return res.status(403).json({
      success: false,
      error: `Access Denied: You may only access your own ${role} profile or records.`,
    });
  };
}
