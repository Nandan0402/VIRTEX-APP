import { normalizeRole } from './auth.js';
import * as trainerHubRepo from '../repositories/trainerHub.repository.js';

/**
 * portalAccess.js — three-portal RBAC helpers (use AFTER authenticateToken).
 *
 * Portals map onto the existing users.role values (no new accounts or auth system):
 *   Admin   = owner (superadmin normalises to owner), manager
 *   Trainer = trainer      -> /api/trainer/*  (scoped to own assigned clients)
 *   Member  = member       -> /api/member/*   (scoped to own records)
 */

const PORTAL_HINT = {
  trainer: 'Trainers use the Trainer Hub API (/api/trainer/*), which only returns your assigned clients.',
  member: 'Members use the Member API (/api/member/*), which only returns your own records.',
};

/**
 * Block whole roles from a route or module (e.g. legacy admin modules that return
 * every member's records and therefore cannot honour trainer/member scoping).
 */
export function denyRoles(...roles) {
  const blocked = roles.flat().map((r) => normalizeRole(r));
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    const role = normalizeRole(req.user.role);
    if (blocked.includes(role)) {
      return res.status(403).json({
        success: false,
        error: `Access Denied: this endpoint is not available to the ${role} role. ${PORTAL_HINT[role] || ''}`.trim(),
      });
    }
    next();
  };
}

/**
 * For trainers, overwrite ?trainerId= with the caller's OWN trainer id so legacy list
 * endpoints (e.g. GET /trainers/assignments) cannot be used to read another trainer's clients.
 * Owners/managers pass through unchanged.
 */
export async function forceOwnTrainerFilter(req, res, next) {
  try {
    if (normalizeRole(req.user?.role) !== 'trainer') return next();
    let trainerId = Number(req.user.trainerId) || null;
    if (!trainerId) trainerId = await trainerHubRepo.findTrainerIdForUser(req.user.id);
    if (!trainerId) {
      return res.status(403).json({
        success: false,
        error: 'Your account is not linked to a trainer profile. Ask an administrator to link it.',
      });
    }
    req.query.trainerId = String(trainerId);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * For trainers, overwrite a user-id query filter (e.g. ?user_id=) with the caller's own
 * user id, so staff shift / attendance lists only ever return the trainer's own rows.
 */
export function forceOwnUserQuery(param = 'user_id') {
  return (req, res, next) => {
    if (normalizeRole(req.user?.role) === 'trainer') req.query[param] = String(req.user.id);
    next();
  };
}

/** For trainers, a :param that names a user (e.g. /staff/:id) must be the caller's own id. */
export function selfOnlyForTrainer(param = 'id') {
  return (req, res, next) => {
    if (normalizeRole(req.user?.role) === 'trainer' && String(req.params[param]) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: 'Access Denied: trainers can only view their own staff record.' });
    }
    next();
  };
}

/** For trainers, the staff shift in :id must belong to the caller. */
export async function requireOwnStaffShift(req, res, next) {
  try {
    if (normalizeRole(req.user?.role) !== 'trainer') return next();
    const own = await trainerHubRepo.isOwnStaffShift(req.params.id, req.user.id);
    if (!own) return res.status(403).json({ success: false, error: 'Access Denied: you can only update your own shifts.' });
    next();
  } catch (err) {
    next(err);
  }
}
