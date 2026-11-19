/**
 * Trainer account details + admin-authorised password changes.
 *   GET  /api/v1/trainer/account                         trainer: own login details + password status
 *   POST /api/v1/trainer/account/password-request        trainer: ask the admin for a new password
 *   GET  /api/v1/admin/trainer-password-requests         owner/manager: open requests
 *   POST /api/v1/admin/trainer-password-requests/:id/dismiss   owner/manager: close without changing
 * The admin completes a request by setting the password on the coach (PUT /api/v1/trainers/:id), which is
 * recorded as PASSWORD_SET_BY_ADMIN and resolves the request automatically.
 */
import * as repo from '../repositories/passwordRequest.repository.js';
import { normalizeRole } from '../middlewares/auth.js';

const REASONS = ['forgot', 'security', 'shared', 'periodic', 'other'];

export async function getMyAccount(req, res, next) {
  try {
    const login = await repo.getTrainerLogin(req.trainerId);
    if (!login) return res.status(404).json({ success: false, error: 'No login is linked to this trainer profile yet. Ask the admin to set one up.' });
    const status = await repo.getPasswordStatus(login.id);
    res.json({
      success: true,
      data: {
        account: {
          username: login.username, email: login.email, phone: login.phone, role: login.role, active: login.is_active !== false,
          lastLoginAt: login.last_login_at, createdAt: login.created_at, trainerCode: login.trainer_code, fullName: login.full_name,
        },
        password: {
          managedBy: 'admin',
          lastSetAt: status.lastSet?.created_at || null,
          pendingRequest: status.pending ? { id: status.pending.id, requestedAt: status.pending.created_at, reason: status.pending.reason } : null,
          history: status.history.map((h) => ({ id: h.id, requestedAt: h.created_at, reason: h.reason, status: h.status, adminNote: h.admin_note })),
        },
      },
    });
  } catch (err) { next(err); }
}

export async function requestPasswordChange(req, res, next) {
  try {
    if (normalizeRole(req.user?.role) !== 'trainer') {
      return res.status(403).json({ success: false, error: 'Only the trainer can request a new password for their own account.' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!REASONS.includes(reason)) return res.status(400).json({ success: false, error: `Choose a reason: ${REASONS.join(', ')}.` });
    const login = await repo.getTrainerLogin(req.trainerId);
    if (!login || login.id !== req.user.id) return res.status(403).json({ success: false, error: 'This request must come from the coach\'s own login.' });
    const status = await repo.getPasswordStatus(login.id);
    if (status.pending) {
      return res.status(409).json({ success: false, error: 'You already have a password request waiting for the admin.', data: { requestedAt: status.pending.created_at } });
    }
    const created = await repo.createRequest({
      userId: login.id, username: login.username, trainerId: req.trainerId, reason,
      ipAddress: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    });
    res.status(201).json({ success: true, message: 'Request sent. The admin will set a new password and give it to you.', data: { id: created.id, requestedAt: created.created_at, reason } });
  } catch (err) { next(err); }
}

export async function listOpenRequests(req, res, next) {
  try {
    res.json({ success: true, data: await repo.listOpenTrainerRequests() });
  } catch (err) { next(err); }
}

export async function dismissRequest(req, res, next) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, error: 'Invalid request id.' });
    const open = await repo.getRequest(id);
    if (!open) return res.status(404).json({ success: false, error: 'This request is not open (already completed or dismissed).' });
    const note = String(req.body?.note || '').trim().slice(0, 300) || null;
    await repo.dismissRequest(id, req.user, note);
    res.json({ success: true, message: 'Request dismissed.' });
  } catch (err) { next(err); }
}
