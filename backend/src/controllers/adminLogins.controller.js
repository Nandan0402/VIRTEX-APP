/**
 * adminLogins.controller.js — Admin → Logins & Access. The admin manages every MEMBER and TRAINER login
 * (email/password and the linked Google account used as the 2nd sign-in step). Owner / manager only.
 *
 *   GET    /api/v1/admin/logins                      all members + trainers with their login (or none)
 *   POST   /api/v1/admin/logins                      { kind: 'member'|'trainer', refId, email, password }   add a login
 *   PATCH  /api/v1/admin/logins/:userId              { active: true|false }   freeze / unfreeze (takes effect at once)
 *   POST   /api/v1/admin/logins/:userId/password     { password }             set a new password
 *   POST   /api/v1/admin/logins/:userId/reset-google                          unlink Google (they link again at next sign-in)
 *   DELETE /api/v1/admin/logins/:userId                                       delete the login
 *
 * Delete: a login referenced by history (audit log, messages, punches…) cannot be removed row-wise without
 * destroying that history, so it is closed for good instead: switched off, password + Google removed, username
 * and email freed, unlinked from the member/trainer (who can then get a fresh login). Every action is audited.
 * Only member / trainer logins are managed here — never owner / manager accounts.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, withTransaction } from '../config/database.js';

const bad = (res, msg, status = 400) => res.status(status).json({ success: false, error: msg });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const audit = (req, event, details) => query(
  `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, $3, $4, $5)`,
  [req.user?.id || null, req.user?.username || null, event, req.user?.role || null, JSON.stringify(details)]).catch(() => {});

/** The member/trainer login being managed, or null (never owner/manager accounts). */
async function managedUser(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const u = (await query(`SELECT id, username, email, role, is_active, member_id, trainer_id, google_id FROM users WHERE id = $1`, [n])).rows[0];
  return u && ['member', 'trainer'].includes(String(u.role).toLowerCase()) ? u : null;
}

export async function list(req, res, next) {
  try {
    const [members, trainers] = await Promise.all([
      query(`SELECT 'member' AS kind, m.id AS ref_id, m.full_name AS name, m.member_code AS code, m.email AS record_email, m.status AS record_status,
                    u.id AS user_id, u.username, u.email, u.is_active, (u.google_id IS NOT NULL) AS google_linked, u.last_login_at
               FROM members m LEFT JOIN users u ON u.member_id = m.id AND u.role = 'member'
              ORDER BY m.full_name`),
      query(`SELECT 'trainer' AS kind, t.id AS ref_id, t.full_name AS name, t.trainer_code AS code, t.email AS record_email, t.status AS record_status,
                    u.id AS user_id, u.username, u.email, u.is_active, (u.google_id IS NOT NULL) AS google_linked, u.last_login_at
               FROM trainers t LEFT JOIN users u ON u.role = 'trainer' AND (u.id = t.user_id OR u.trainer_id = t.id)
              ORDER BY t.full_name`),
    ]);
    res.json({ success: true, data: [...members.rows, ...trainers.rows] });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const kind = req.body?.kind; const refId = Number(req.body?.refId);
    const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
    if (!['member', 'trainer'].includes(kind) || !Number.isInteger(refId) || refId <= 0) return bad(res, 'Choose a member or trainer.');
    if (!EMAIL_RE.test(email)) return bad(res, 'Enter a valid email address — it is their sign-in ID.');
    if (password.length < 8) return bad(res, 'The password must be at least 8 characters.');
    const rec = kind === 'member'
      ? (await query('SELECT id, full_name FROM members WHERE id = $1', [refId])).rows[0]
      : (await query('SELECT id, full_name, user_id FROM trainers WHERE id = $1', [refId])).rows[0];
    if (!rec) return bad(res, `${kind === 'member' ? 'Member' : 'Trainer'} not found.`, 404);
    const has = kind === 'member'
      ? (await query(`SELECT 1 FROM users WHERE member_id = $1 AND role = 'member'`, [refId])).rowCount
      : (await query(`SELECT 1 FROM users WHERE role = 'trainer' AND (trainer_id = $1 OR id = $2)`, [refId, rec.user_id || 0])).rowCount;
    if (has) return bad(res, `${rec.full_name} already has a login.`, 409);
    if ((await query('SELECT 1 FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $1', [email])).rowCount) return bad(res, 'That email is already used by another login.', 409);
    const hash = await bcrypt.hash(password, 10);
    const u = await withTransaction(async (c) => {
      const row = (await c.query(
        `INSERT INTO users (username, email, full_name, password_hash, role, is_active, member_id, trainer_id, auth_provider)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, 'local') RETURNING id, username, email`,
        [email, email, rec.full_name, hash, kind, kind === 'member' ? refId : null, kind === 'trainer' ? refId : null])).rows[0];
      if (kind === 'trainer') await c.query('UPDATE trainers SET user_id = $1 WHERE id = $2 AND user_id IS NULL', [row.id, refId]);
      return row;
    });
    await audit(req, 'LOGIN_CREATED', { kind, refId, userId: u.id, email });
    res.status(201).json({ success: true, message: `Login created for ${rec.full_name}. First sign-in: ${email} + the password; then they link their Gmail.`, data: u });
  } catch (err) {
    if (err.code === '23505') return bad(res, 'That email is already used by another login.', 409);
    next(err);
  }
}

export async function setActive(req, res, next) {
  try {
    const u = await managedUser(req.params.userId);
    if (!u) return bad(res, 'Login not found.', 404);
    if (typeof req.body?.active !== 'boolean') return bad(res, 'Send { "active": true } or { "active": false }.');
    await query('UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [req.body.active, u.id]);
    await audit(req, req.body.active ? 'LOGIN_UNFROZEN' : 'LOGIN_FROZEN', { userId: u.id, username: u.username, role: u.role });
    res.json({ success: true, message: req.body.active ? 'Login unfrozen — they can sign in again.' : 'Login frozen — they are signed out everywhere and cannot sign in (password or Google).' });
  } catch (err) { next(err); }
}

export async function setPassword(req, res, next) {
  try {
    const u = await managedUser(req.params.userId);
    if (!u) return bad(res, 'Login not found.', 404);
    const password = String(req.body?.password || '');
    if (password.length < 8) return bad(res, 'The password must be at least 8 characters.');
    await query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [await bcrypt.hash(password, 10), u.id]);
    await audit(req, 'LOGIN_PASSWORD_SET_BY_ADMIN', { userId: u.id, username: u.username, role: u.role });
    res.json({ success: true, message: 'New password saved. Give it to them; they still confirm with their linked Gmail.' });
  } catch (err) { next(err); }
}

export async function resetGoogle(req, res, next) {
  try {
    const u = await managedUser(req.params.userId);
    if (!u) return bad(res, 'Login not found.', 404);
    await query('UPDATE users SET google_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [u.id]);
    await audit(req, 'LOGIN_GOOGLE_RESET', { userId: u.id, username: u.username, role: u.role });
    res.json({ success: true, message: 'Google unlinked — at their next sign-in they link a Gmail again.' });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const u = await managedUser(req.params.userId);
    if (!u) return bad(res, 'Login not found.', 404);
    const tag = `deleted-${u.id}-${crypto.randomBytes(3).toString('hex')}`;
    await withTransaction(async (c) => {
      await c.query(
        `UPDATE users SET is_active = FALSE, google_id = NULL, password_hash = $1, username = $2, email = $3,
                member_id = NULL, trainer_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10), tag, `${tag}@deleted.invalid`, u.id]);
      await c.query('UPDATE trainers SET user_id = NULL WHERE user_id = $1', [u.id]);
    });
    await audit(req, 'LOGIN_DELETED', { userId: u.id, username: u.username, email: u.email, role: u.role, memberId: u.member_id, trainerId: u.trainer_id });
    res.json({ success: true, message: 'Login deleted. Their history stays; you can add a new login for them any time.' });
  } catch (err) { next(err); }
}
