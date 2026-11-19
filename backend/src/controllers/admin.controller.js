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
// Admin logins the Owner may create here. Members and trainers get their logins from Admin → Members /
// Personal Trainers (linked to their gym records); they are never created through this endpoint.
const ADMIN_ROLES = ['manager', 'owner'];
const ADMIN_EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function createUser(req, res, next) {
  try {
    const b = req.body || {};
    const fullName = String(b.fullName || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim() || null;
    const role = String(b.role || 'manager').trim().toLowerCase();
    const password = typeof b.password === 'string' ? b.password : '';
    let username = String(b.username || '').trim().toLowerCase();

    const problems = [];
    if (fullName.length < 2 || fullName.length > 100) problems.push('Enter the full name (2–100 characters).');
    if (!ADMIN_EMAIL_RE.test(email)) problems.push('Enter a valid email address.');
    if (!ADMIN_ROLES.includes(role)) problems.push('Role must be Manager or Owner.');
    if (password.length < 8 || password.length > 128) problems.push('Password must be 8–128 characters.');
    if (phone && !/^\+?[0-9][0-9 ()-]{6,18}$/.test(phone)) problems.push('Enter a valid phone number or leave it empty.');
    if (username && !/^[a-z0-9._-]{3,50}$/.test(username)) problems.push('Username can use 3–50 letters, numbers, dots, dashes or underscores.');
    if (problems.length) return res.status(400).json({ success: false, error: problems.join(' ') });

    if (isDatabaseConnected()) {
      const dupe = await query('SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
      if (dupe.rowCount) return res.status(409).json({ success: false, error: 'An account with this email already exists.' });
      if (!username) {
        const base = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'admin';
        username = base.length >= 3 ? base : `admin_${base}`;
        for (let i = 0; i < 5; i++) {
          const taken = await query('SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1', [username]);
          if (!taken.rowCount) break;
          username = `${base.slice(0, 40)}_${Math.floor(100 + Math.random() * 900)}`;
        }
      } else {
        const taken = await query('SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1', [username]);
        if (taken.rowCount) return res.status(409).json({ success: false, error: 'That username is already taken.' });
      }
    }

    // memberId / trainerId are deliberately NOT passed through (no linking to someone else's record).
    const newUser = await authService.registerStaffUser({ username, email, password, fullName, role, phone });
    userRepository.recordAuthAudit({
      userId: req.user?.id || null,
      username: String(req.user?.username || 'owner').slice(0, 50),
      eventType: 'ADMIN_ACCOUNT_CREATED',
      role: req.user?.role || null,
      ipAddress: req.ip || null,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      details: { newUserId: newUser.id, newUsername: newUser.username, newRole: newUser.role },
    }).catch(() => {});
    res.status(201).json({
      success: true,
      message: `${newUser.full_name || fullName} can now sign in to the Admin Console as ${newUser.role}.`,
      data: newUser,
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'An account with this email or username already exists.' });
    res.status(400).json({ success: false, error: err.message });
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

