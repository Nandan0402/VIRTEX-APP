import { normalizeRole } from './auth.js';
import * as trainerHubRepo from '../repositories/trainerHub.repository.js';

/**
 * trainerScope middleware (use after authenticateToken + requireRole).
 *
 * Sets req.trainerId = the ONLY trainer whose data this request may touch:
 *  - trainer        -> their own trainer profile (from JWT trainerId, or looked up
 *                      via trainers.user_id / users.trainer_id if the token predates
 *                      the link). Any ?trainerId= supplied by a trainer is ignored.
 *  - owner/manager  -> must choose a trainer with ?trainerId=<id> (supervisory view).
 *  - anyone else    -> 403.
 */
export async function trainerScope(req, res, next) {
  try {
    const role = normalizeRole(req.user?.role);

    if (role === 'trainer') {
      let trainerId = Number(req.user.trainerId) || null;
      if (!trainerId) trainerId = await trainerHubRepo.findTrainerIdForUser(req.user.id);
      if (!trainerId) {
        return res.status(403).json({
          success: false,
          error: 'Your account is not linked to a trainer profile. Ask an administrator to link it.',
        });
      }
      req.trainerId = trainerId;
      return next();
    }

    if (role === 'owner' || role === 'manager') {
      const requested = Number.parseInt(req.query.trainerId, 10);
      if (!Number.isInteger(requested) || requested <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Owners and managers must specify ?trainerId=<id> to view a trainer\'s hub.',
        });
      }
      req.trainerId = requested;
      return next();
    }

    return res.status(403).json({ success: false, error: 'Trainer Hub is available to trainers and management only.' });
  } catch (err) {
    next(err);
  }
}

/**
 * Responds 503 until the Trainer Hub migrations that a route needs are applied.
 * @param {...string} tables - required tables from TRAINER_HUB_TABLES
 */
export function requireHubTables(...tables) {
  return async (req, res, next) => {
    try {
      const present = await trainerHubRepo.getPresentHubTables();
      const missing = tables.filter((t) => !present.has(t));
      if (missing.length > 0) {
        return res.status(503).json({
          success: false,
          code: 'TRAINER_HUB_MIGRATIONS_PENDING',
          error: 'This Trainer Hub feature needs database migrations that have not been applied yet.',
          missingTables: missing,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
