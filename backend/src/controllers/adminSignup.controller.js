/**
 * Admin sign-up with owner approval (no new tables).
 *   POST /api/v1/auth/admin-signup                     public: creates a SWITCHED-OFF manager login (is_active = FALSE)
 *   GET  /api/v1/admin/admin-signups                   owner: pending requests
 *   POST /api/v1/admin/admin-signups/:userId/approve   owner: switch on as manager or owner
 *   POST /api/v1/admin/admin-signups/:userId/reject    owner: keep it switched off (history is kept, nothing deleted)
 * Events are written to auth_audit_logs: ADMIN_SIGNUP_REQUESTED / ADMIN_SIGNUP_APPROVED / ADMIN_SIGNUP_REJECTED.
 */
import bcrypt from 'bcryptjs';
import { query, isDatabaseConnected, ensureDatabaseConnected } from '../config/database.js';
import * as userRepository from '../repositories/user.repository.js';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,18}$/;
const DONE = `NOT EXISTS (SELECT 1 FROM auth_audit_logs d WHERE d.event_type IN ('ADMIN_SIGNUP_APPROVED','ADMIN_SIGNUP_REJECTED') AND d.details->>'userId' = r.details->>'userId' AND d.id > r.id)`;
const SENT = 'Request sent. The gym owner will review it, and you can sign in once it is approved.';

/** True when this inactive user has a sign-up request the owner has not reviewed yet (used by login). */
export async function isPendingAdminSignup(userId) {
  if (!isDatabaseConnected() || !userId) return false;
  const r = await query(`SELECT 1 FROM auth_audit_logs r WHERE r.event_type = 'ADMIN_SIGNUP_REQUESTED' AND r.details->>'userId' = $1 AND ${DONE} LIMIT 1`, [String(userId)]);
  return r.rowCount > 0;
}

export async function requestAdminSignup(req, res, next) {
  try {
    const b = req.body || {};
    const fullName = String(b.fullName || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const phone = String(b.phone || '').trim() || null;
    const password = typeof b.password === 'string' ? b.password : '';
    const problems = [];
    if (fullName.length < 2 || fullName.length > 100) problems.push('Enter your full name.');
    if (!EMAIL_RE.test(email)) problems.push('Enter a valid email address.');
    if (phone && !PHONE_RE.test(phone)) problems.push('Enter a valid phone number or leave it empty.');
    if (password.length < 8 || password.length > 128) problems.push('Password must be 8–128 characters.');
    if (problems.length) return res.status(400).json({ success: false, error: problems.join(' ') });
    if (!(await ensureDatabaseConnected())) return res.status(503).json({ success: false, error: 'Sign-up is unavailable right now. Please try again later.' });

    // Same answer whether or not the email exists, so this form cannot be used to discover staff emails.
    const dupe = await query('SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    if (dupe.rowCount) return res.status(202).json({ success: true, message: SENT });

    const base = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 40) || 'admin';
    let username = base.length >= 3 ? base : `admin_${base}`;
    for (let i = 0; i < 5; i++) {
      const taken = await query('SELECT 1 FROM users WHERE LOWER(username) = $1 LIMIT 1', [username]);
      if (!taken.rowCount) break;
      username = `${base.slice(0, 40)}_${Math.floor(100 + Math.random() * 900)}`;
    }
    const ins = await query(
      `INSERT INTO users (username, email, password_hash, full_name, role, phone, is_active)
       VALUES ($1, $2, $3, $4, 'manager', $5, FALSE) RETURNING id, username`,
      [username, email, bcrypt.hashSync(password, 10), fullName, phone]
    );
    await userRepository.recordAuthAudit({
      userId: ins.rows[0].id, username: ins.rows[0].username, eventType: 'ADMIN_SIGNUP_REQUESTED', role: 'manager',
      ipAddress: req.ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      details: { userId: String(ins.rows[0].id), fullName, email },
    });
    res.status(202).json({ success: true, message: SENT });
  } catch (err) {
    if (err.code === '23505') return res.status(202).json({ success: true, message: SENT });
    next(err);
  }
}

export async function listPendingSignups(req, res, next) {
  try {
    const r = await query(
      `SELECT u.id AS user_id, u.full_name, u.email, u.phone, u.username, r.created_at AS requested_at
         FROM auth_audit_logs r
         JOIN users u ON u.id = NULLIF(r.details->>'userId', '')::int
        WHERE r.event_type = 'ADMIN_SIGNUP_REQUESTED' AND u.is_active = FALSE AND ${DONE}
        ORDER BY r.id ASC LIMIT 100`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
}

async function review(req, res, next, decision) {
  try {
    const userId = Number.parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ success: false, error: 'Invalid request.' });
    if (!(await isPendingAdminSignup(userId))) return res.status(404).json({ success: false, error: 'This sign-up request is not waiting for review.' });
    let role = null;
    if (decision === 'approve') {
      role = String(req.body?.role || 'manager').toLowerCase();
      if (!['manager', 'owner'].includes(role)) return res.status(400).json({ success: false, error: 'Approve as Manager or Owner.' });
      await query(`UPDATE users SET is_active = TRUE, role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND is_active = FALSE AND member_id IS NULL AND trainer_id IS NULL`, [role, userId]);
    }
    const u = (await query('SELECT id, username, full_name, email, role, is_active FROM users WHERE id = $1', [userId])).rows[0];
    await userRepository.recordAuthAudit({
      userId: req.user?.id || null, username: String(req.user?.username || 'owner').slice(0, 50),
      eventType: decision === 'approve' ? 'ADMIN_SIGNUP_APPROVED' : 'ADMIN_SIGNUP_REJECTED', role: req.user?.role || null,
      ipAddress: req.ip || null, details: { userId: String(userId), role, email: u?.email || null },
    });
    res.json({
      success: true,
      message: decision === 'approve' ? `${u?.full_name || 'The new admin'} can now sign in as ${role}.` : 'Request rejected. The account stays switched off.',
      data: u,
    });
  } catch (err) { next(err); }
}
export const approveSignup = (req, res, next) => review(req, res, next, 'approve');
export const rejectSignup = (req, res, next) => review(req, res, next, 'reject');
