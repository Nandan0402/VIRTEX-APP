import * as routineRepo from '../repositories/routine.repository.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * GET /api/v1/routine/current
 * Get user's current routine status today
 */
export async function getCurrentStatus(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const status = await routineRepo.getCurrentRoutineStatus(userId);
    res.json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/routine/punch-in
 * Start work shift / routine
 */
export async function punchIn(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const userName = req.user?.fullName || req.user?.full_name || req.user?.username || 'Nandan.B (Owner)';
    const userRole = req.user?.role || 'owner';
    const { notes } = req.body;

    const data = await routineRepo.punchIn({
      userId,
      userName,
      userRole,
      notes: notes || '',
    });

    broadcast('ROUTINE_PUNCH_IN', { userId, userName, time: new Date() }, { channel: 'admin', triggeredBy: userName });

    res.json({
      success: true,
      message: `✅ Punched in successfully at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}. Have a productive shift!`,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/routine/break-start
 * Take break
 */
export async function startBreak(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const { reason } = req.body;

    const data = await routineRepo.startBreak(userId, reason || 'Routine Break');

    broadcast('ROUTINE_BREAK_START', { userId, time: new Date() }, { channel: 'admin', triggeredBy: req.user?.username });

    res.json({
      success: true,
      message: `⏸️ Break started at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}. Enjoy your break!`,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/routine/break-end
 * Resume work from break
 */
export async function endBreak(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const data = await routineRepo.endBreak(userId);

    broadcast('ROUTINE_BREAK_END', { userId, time: new Date() }, { channel: 'admin', triggeredBy: req.user?.username });

    res.json({
      success: true,
      message: `▶️ Break ended. Resumed work routine at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}.`,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/routine/punch-out
 * End work shift / routine
 */
export async function punchOut(req, res, next) {
  try {
    const userId = req.user?.id || null;
    const { notes } = req.body;

    const data = await routineRepo.punchOut(userId, notes || '');

    broadcast('ROUTINE_PUNCH_OUT', { userId, time: new Date() }, { channel: 'admin', triggeredBy: req.user?.username });

    res.json({
      success: true,
      message: `⏹️ Punched out successfully at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}. Shift routine recorded!`,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/routine/history
 * List shift routine history
 */
export async function getHistory(req, res, next) {
  try {
    const { date, userId, limit = 50, offset = 0 } = req.query;
    const logs = await routineRepo.getRoutineHistory({
      date,
      userId: userId ? parseInt(userId, 10) : null,
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });
    const summary = await routineRepo.getTodaySummary(userId ? parseInt(userId, 10) : null);

    res.json({
      success: true,
      data: logs,
      summary,
    });
  } catch (err) {
    next(err);
  }
}

