import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

/**
 * JWT Authentication Middleware for Trainers & Administrators
 * Header format: Authorization: Bearer <TOKEN>
 */
export function authenticateToken(req, res, next) {
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
    req.user = decoded; // { id, username, role, fullName }
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired authentication token. Please sign in again.',
    });
  }
}

/**
 * Role-Based Access Control (RBAC) Authorization Middleware
 * @param {Array<string>} allowedRoles - e.g. ['superadmin', 'manager', 'trainer']
 */
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication required before checking role permissions.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `Access Denied: Your role '${req.user.role}' lacks permission for this action. Required: [${allowedRoles.join(', ')}]`,
      });
    }

    next();
  };
}

