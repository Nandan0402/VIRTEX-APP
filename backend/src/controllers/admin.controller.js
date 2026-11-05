import { query, isDatabaseConnected } from '../config/database.js';
import * as userRepository from '../repositories/user.repository.js';
import * as gymRepository from '../repositories/gym.repository.js';
import * as memberRepository from '../repositories/member.repository.js';
import * as robotService from '../services/robot.service.js';
import * as authService from '../services/auth.service.js';
import { broadcast, getRecentSyncLogs } from '../services/realtime.service.js';

/**
 * GET /api/v1/admin/dashboard
 * High-level facility telemetry, member counts, and active shifts
 * Accessible to: Owner, Manager
 */
export async function getDashboardStats(req, res, next) {
  try {
    let stats = {
      totalMembers: 5,
      activeMembers: 5,
      todayCheckIns: 4,
      onFloorTrainers: 2,
      pendingLeads: 3,
      robotOnline: true,
    };

    if (isDatabaseConnected()) {
      const [membersCount, checkinsCount, trainersCount, leadsCount] = await Promise.all([
        query("SELECT COUNT(*) as count, COUNT(*) FILTER (WHERE status = 'active') as active FROM members;"),
        query("SELECT COUNT(*) as count FROM check_ins WHERE check_in_time >= CURRENT_DATE;"),
        query("SELECT COUNT(*) as count FROM trainers WHERE status = 'on_floor';"),
        query("SELECT COUNT(*) as count FROM member_enquiries WHERE status = 'new';"),
      ]);

      const robotState = await robotService.getRobotStatus();

      stats = {
        totalMembers: parseInt(membersCount.rows[0]?.count || 0, 10),
        activeMembers: parseInt(membersCount.rows[0]?.active || 0, 10),
        todayCheckIns: parseInt(checkinsCount.rows[0]?.count || 0, 10),
        onFloorTrainers: parseInt(trainersCount.rows[0]?.count || 0, 10),
        pendingLeads: parseInt(leadsCount.rows[0]?.count || 0, 10),
        robotOnline: Boolean(robotState.online),
      };
    }

    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/users
 * List administrative and staff accounts
 * Accessible to: Owner only
 */
export async function getUsers(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const users = await userRepository.listUsers({ limit });
    res.json({
      success: true,
      data: users,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/admin/users
 * Provision a new staff account (bcrypt hashed, never plaintext)
 * Accessible to: Owner only
 */
export async function createUser(req, res, next) {
  try {
    const newUser = await authService.registerStaffUser(req.body);
    res.status(201).json({
      success: true,
      message: `User '${newUser.username}' created successfully with role '${newUser.role}'.`,
      data: newUser,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
}

/**
 * PUT /api/v1/admin/settings
 * Update facility operating settings
 * Accessible to: Owner, Manager
 */
export async function updateSettings(req, res, next) {
  try {
    const updated = await gymRepository.updateGymSettings(req.body);
    broadcast('GYM_INFO_UPDATED', updated, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Facility settings updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/sync-logs
 * Real-time event synchronization audit logs
 */
export async function getSyncLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const logs = await getRecentSyncLogs(limit);
    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/audit-logs
 * Security & authentication audit logs
 * Accessible to: Owner only
 */
export async function getAuditLogs(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const { userId, eventType } = req.query;
    const logs = await userRepository.getAuthAuditLogs({ limit, userId, eventType });

    res.json({
      success: true,
      data: logs,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/enquiries
 * Retrieve prospective membership leads for managerial follow-up
 * Accessible to: Owner, Manager
 */
export async function getEnquiries(req, res, next) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const leads = await memberRepository.getRecentEnquiries(limit);
    res.json({
      success: true,
      data: leads,
    });
  } catch (err) {
    next(err);
  }
}

