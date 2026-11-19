/**
 * trainingTimes.controller.js — general vs personal trainer times + member time-shift requests (migration 033).
 *
 *  Personal training: personal_trainer_assignments (admin assigns the PT; the time is preferred_slot text,
 *                     e.g. "Morning (07:30 AM - 08:30 AM)").
 *  General training:  general_training_assignments (admin gives a member a general trainer + start/end time).
 *  Time shift:        time_shift_requests — the member asks to move one of those times; the admin approves
 *                     (optionally adjusting the time) or rejects. Approving updates the assignment itself, so the
 *                     new time shows on the admin pages, the trainer's client lists and the member's page.
 *
 *  Admin   GET  /api/v1/admin/training-times                      overview: general assignments, PT times, members, trainers
 *          POST /api/v1/admin/general-training                    { memberId, trainerId, startTime, endTime, notes? }
 *          POST /api/v1/admin/general-training/:id/end
 *          GET  /api/v1/admin/time-shift-requests?status=pending|all
 *          POST /api/v1/admin/time-shift-requests/:id/approve     { startTime?, endTime?, note? }
 *          POST /api/v1/admin/time-shift-requests/:id/reject      { note? }
 *  Member  GET  /api/v1/member/training-times
 *          POST /api/v1/member/time-shift-requests                { kind: 'personal'|'general', startTime, endTime, reason? }
 *          POST /api/v1/member/time-shift-requests/:id/cancel
 *  Trainer GET  /api/v1/trainer/general-members                   own general-training members and their times
 *
 *  All SQL is parameterised. Members only see/act on their own rows (memberScope); trainers only their own (trainerScope).
 */
import { query, withTransaction } from '../config/database.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (res, msg, status = 400) => res.status(status).json({ success: false, error: msg });
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

async function available() {
  const r = await query(`SELECT to_regclass('public.general_training_assignments') IS NOT NULL AND to_regclass('public.time_shift_requests') IS NOT NULL AS ok`);
  return r.rows[0].ok;
}
async function needTables(res) {
  if (await available()) return false;
  res.status(503).json({ success: false, code: 'MIGRATIONS_PENDING', error: 'Training times need database migration 033.' });
  return true;
}

/** "07:30" → "07:30 AM" */
function to12(t) { const [h, m] = t.split(':').map(Number); return `${String(h % 12 || 12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; }
const partOfDay = (t) => { const h = Number(t.slice(0, 2)); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
/** PT slot text in the format the rest of the app already shows: "Morning (07:30 AM - 08:30 AM)". */
const slotText = (start, end) => `${partOfDay(start)} (${to12(start)} - ${to12(end)})`;
/** "Morning (07:30 AM - 08:30 AM)" → { start: '07:30', end: '08:30' } (null when it has no times). */
function parseSlot(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const conv = (h, mi, ap) => { let x = Number(h) % 12; if (/pm/i.test(ap)) x += 12; return `${String(x).padStart(2, '0')}:${mi}`; };
  return { start: conv(m[1], m[2], m[3]), end: conv(m[4], m[5], m[6]) };
}
function cleanTimes(body, { required = true } = {}) {
  const s = body?.startTime; const e = body?.endTime;
  if (!required && (s === undefined || s === null || s === '') && (e === undefined || e === null || e === '')) return { start: null, end: null };
  if (!TIME_RE.test(String(s || '')) || !TIME_RE.test(String(e || ''))) throw new Error('Give a start and end time like 06:00 and 07:00.');
  if (e <= s) throw new Error('End time must be after start time.');
  return { start: s, end: e };
}
const cleanNote = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);

// ---- notifications (best effort; a failed notification never blocks the change)
async function trainerUserId(trainerId) {
  if (!trainerId) return null;
  const r = await query(`SELECT COALESCE((SELECT user_id FROM trainers WHERE id = $1), (SELECT id FROM users WHERE trainer_id = $1 AND role = 'trainer' ORDER BY id LIMIT 1)) AS id`, [trainerId]);
  return r.rows[0]?.id || null;
}
async function memberUserId(memberId) {
  const r = await query(`SELECT id FROM users WHERE member_id = $1 AND role = 'member' ORDER BY id LIMIT 1`, [memberId]);
  return r.rows[0]?.id || null;
}
async function notify(userId, type, title, body, linkUrl) {
  if (!userId) return;
  try {
    if (!(await query(`SELECT to_regclass('public.notifications') IS NOT NULL AS ok`)).rows[0].ok) return;
    await query(`INSERT INTO notifications (recipient_user_id, type, title, body, link_url) VALUES ($1, $2, $3, $4, $5)`, [userId, type, title, body?.slice(0, 500) || null, linkUrl]);
  } catch { /* never block */ }
}
async function notifyStaff(title, body) {
  const r = await query(`SELECT id FROM users WHERE role IN ('owner', 'manager', 'superadmin') AND is_active = TRUE`);
  for (const u of r.rows) await notify(u.id, 'system', title, body, 'admin-training-times.html#requests');
}
async function audit(req, event, details) {
  try {
    await query(`INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id || null, req.user?.username || null, event, req.user?.role || null, JSON.stringify(details)]);
  } catch { /* never block */ }
}

// ---------------------------------------------------------------- shared reads

async function generalRows(where, params) {
  const r = await query(
    `SELECT g.id, g.member_id, m.full_name AS member_name, m.member_code, m.gender, g.trainer_id, t.full_name AS trainer_name,
            to_char(g.start_time, 'HH24:MI') AS start_time, to_char(g.end_time, 'HH24:MI') AS end_time, g.notes, g.status, g.created_at, g.updated_at
       FROM general_training_assignments g
       JOIN members m ON m.id = g.member_id
       LEFT JOIN trainers t ON t.id = g.trainer_id
      WHERE ${where}
      ORDER BY g.start_time, m.full_name`, params);
  return r.rows;
}
async function personalRows(where, params) {
  const r = await query(
    `SELECT a.id, a.member_id, m.full_name AS member_name, m.member_code, a.trainer_id, t.full_name AS trainer_name,
            a.preferred_slot, a.sessions_per_week, a.status, a.start_date, a.end_date
       FROM personal_trainer_assignments a
       JOIN members m ON m.id = a.member_id
       LEFT JOIN trainers t ON t.id = a.trainer_id
      WHERE ${where}
      ORDER BY m.full_name`, params);
  return r.rows.map((x) => ({ ...x, ...(parseSlot(x.preferred_slot) ? { start_time: parseSlot(x.preferred_slot).start, end_time: parseSlot(x.preferred_slot).end } : { start_time: null, end_time: null }) }));
}
async function requestRows(where, params, limit = 200) {
  const r = await query(
    `SELECT q.public_id AS id, q.member_id, m.full_name AS member_name, m.member_code, q.kind, q.current_label,
            to_char(q.requested_start, 'HH24:MI') AS requested_start, to_char(q.requested_end, 'HH24:MI') AS requested_end, q.reason,
            q.status, to_char(q.approved_start, 'HH24:MI') AS approved_start, to_char(q.approved_end, 'HH24:MI') AS approved_end,
            q.admin_note, q.decided_at, q.created_at, u.full_name AS decided_by_name,
            COALESCE(tp.full_name, tg.full_name) AS trainer_name
       FROM time_shift_requests q
       JOIN members m ON m.id = q.member_id
       LEFT JOIN users u ON u.id = q.decided_by
       LEFT JOIN personal_trainer_assignments pa ON pa.id = q.pt_assignment_id
       LEFT JOIN trainers tp ON tp.id = pa.trainer_id
       LEFT JOIN general_training_assignments ga ON ga.id = q.general_assignment_id
       LEFT JOIN trainers tg ON tg.id = ga.trainer_id
      WHERE ${where}
      ORDER BY (q.status = 'pending') DESC, q.created_at DESC
      LIMIT ${Number(limit)}`, params);
  return r.rows;
}

// ---------------------------------------------------------------- admin

export async function adminOverview(req, res, next) {
  try {
    if (await needTables(res)) return;
    const [general, personal, trainers, members, pending] = await Promise.all([
      generalRows(`g.status = 'active'`, []),
      personalRows(`a.status IN ('active', 'paused')`, []),
      query(`SELECT id, full_name, trainer_code, specialty, status FROM trainers ORDER BY full_name`).then((r) => r.rows),
      query(`SELECT m.id, m.full_name, m.member_code, m.gender, m.status,
                    EXISTS (SELECT 1 FROM personal_trainer_assignments pa WHERE pa.member_id = m.id AND pa.status IN ('active', 'paused')) AS has_pt,
                    EXISTS (SELECT 1 FROM general_training_assignments g WHERE g.member_id = m.id AND g.status = 'active') AS has_general
               FROM members m WHERE m.status <> 'inactive' ORDER BY m.full_name`).then((r) => r.rows),
      query(`SELECT COUNT(*)::int n FROM time_shift_requests WHERE status = 'pending'`).then((r) => r.rows[0].n),
    ]);
    res.json({ success: true, data: { general, personal, trainers, members, pendingRequests: pending } });
  } catch (err) { next(err); }
}

export async function adminAssignGeneral(req, res, next) {
  try {
    if (await needTables(res)) return;
    const memberId = Number(req.body?.memberId); const trainerId = Number(req.body?.trainerId);
    if (!Number.isInteger(memberId) || memberId <= 0) return bad(res, 'Choose a member.');
    if (!Number.isInteger(trainerId) || trainerId <= 0) return bad(res, 'Choose a general trainer.');
    let t; try { t = cleanTimes(req.body); } catch (e) { return bad(res, e.message); }
    const notes = cleanNote(req.body?.notes);
    const m = (await query('SELECT id, full_name FROM members WHERE id = $1', [memberId])).rows[0];
    if (!m) return bad(res, 'Member not found.', 404);
    const tr = (await query('SELECT id, full_name FROM trainers WHERE id = $1', [trainerId])).rows[0];
    if (!tr) return bad(res, 'Trainer not found.', 404);
    const row = await withTransaction(async (c) => {
      const prev = (await c.query(`SELECT id, trainer_id FROM general_training_assignments WHERE member_id = $1 AND status = 'active' FOR UPDATE`, [memberId])).rows[0];
      if (prev) await c.query(`UPDATE general_training_assignments SET status = 'ended', ended_at = NOW(), updated_at = NOW() WHERE id = $1`, [prev.id]);
      // A pending general time-shift request belongs to the old assignment: close it.
      await c.query(`UPDATE time_shift_requests SET status = 'cancelled', admin_note = 'Replaced by a new general-training assignment', updated_at = NOW() WHERE member_id = $1 AND kind = 'general' AND status = 'pending'`, [memberId]);
      return (await c.query(
        `INSERT INTO general_training_assignments (member_id, trainer_id, start_time, end_time, notes, assigned_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [memberId, trainerId, t.start, t.end, notes, req.user?.id || null])).rows[0];
    });
    const when = `${to12(t.start)} – ${to12(t.end)}`;
    await notify(await memberUserId(memberId), 'assignment_created', `General training: ${tr.full_name}, ${when}`, `Your general trainer is ${tr.full_name}. Training time: ${when}.`, 'member-trainer.html');
    await notify(await trainerUserId(trainerId), 'assignment_created', `New general-training member: ${m.full_name}`, `${m.full_name} trains with you at ${when}.`, 'trainer-general.html');
    await audit(req, 'GENERAL_TRAINER_ASSIGNED', { memberId, trainerId, start: t.start, end: t.end });
    res.status(201).json({ success: true, message: `${m.full_name} → ${tr.full_name}, ${when}.`, data: (await generalRows('g.id = $1', [row.id]))[0] });
  } catch (err) { next(err); }
}

export async function adminEndGeneral(req, res, next) {
  try {
    if (await needTables(res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'Invalid assignment.');
    const r = await query(`UPDATE general_training_assignments SET status = 'ended', ended_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'active' RETURNING id, member_id, trainer_id`, [id]);
    if (!r.rowCount) return bad(res, 'Active general-training assignment not found.', 404);
    await query(`UPDATE time_shift_requests SET status = 'cancelled', admin_note = 'General training ended', updated_at = NOW() WHERE general_assignment_id = $1 AND status = 'pending'`, [id]);
    await audit(req, 'GENERAL_TRAINER_ENDED', { assignmentId: id, memberId: r.rows[0].member_id });
    res.json({ success: true, message: 'General training ended.' });
  } catch (err) { next(err); }
}

export async function adminListRequests(req, res, next) {
  try {
    if (await needTables(res)) return;
    const rows = req.query.status === 'all' ? await requestRows('TRUE', []) : await requestRows(`q.status = 'pending'`, []);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

async function decide(req, res, next, approve) {
  try {
    if (await needTables(res)) return;
    const pid = String(req.params.id || '');
    if (!UUID_RE.test(pid)) return bad(res, 'Invalid request.');
    let t = { start: null, end: null };
    if (approve) { try { t = cleanTimes(req.body, { required: false }); } catch (e) { return bad(res, e.message); } }
    const note = cleanNote(req.body?.note);
    const out = await withTransaction(async (c) => {
      const q = (await c.query(`SELECT * FROM time_shift_requests WHERE public_id = $1 FOR UPDATE`, [pid])).rows[0];
      if (!q) return { error: [404, 'Request not found.'] };
      if (q.status !== 'pending') return { error: [409, `This request is already ${q.status}.`] };
      const start = t.start || hhmm(q.requested_start); const end = t.end || hhmm(q.requested_end);
      let trainerId = null;
      if (approve) {
        if (q.kind === 'personal') {
          const a = (await c.query(`UPDATE personal_trainer_assignments SET preferred_slot = $1, updated_at = NOW() WHERE id = $2 AND status IN ('active', 'paused') RETURNING trainer_id`, [slotText(start, end), q.pt_assignment_id])).rows[0];
          if (!a) return { error: [409, 'That personal-training assignment is no longer active.'] };
          trainerId = a.trainer_id;
        } else {
          const g = (await c.query(`UPDATE general_training_assignments SET start_time = $1, end_time = $2, updated_at = NOW() WHERE id = $3 AND status = 'active' RETURNING trainer_id`, [start, end, q.general_assignment_id])).rows[0];
          if (!g) return { error: [409, 'That general-training assignment is no longer active.'] };
          trainerId = g.trainer_id;
        }
      } else if (q.kind === 'personal') {
        trainerId = (await c.query(`SELECT trainer_id FROM personal_trainer_assignments WHERE id = $1`, [q.pt_assignment_id])).rows[0]?.trainer_id || null;
      } else {
        trainerId = (await c.query(`SELECT trainer_id FROM general_training_assignments WHERE id = $1`, [q.general_assignment_id])).rows[0]?.trainer_id || null;
      }
      await c.query(
        `UPDATE time_shift_requests SET status = $1, approved_start = $2, approved_end = $3, admin_note = $4, decided_by = $5, decided_at = NOW(), updated_at = NOW() WHERE id = $6`,
        [approve ? 'approved' : 'rejected', approve ? start : null, approve ? end : null, note, req.user?.id || null, q.id]);
      return { q, start, end, trainerId };
    });
    if (out.error) return bad(res, out.error[1], out.error[0]);
    const { q, start, end, trainerId } = out;
    const kindLabel = q.kind === 'personal' ? 'personal training' : 'general training';
    const name = (await query('SELECT full_name FROM members WHERE id = $1', [q.member_id])).rows[0]?.full_name || 'Member';
    if (approve) {
      const when = `${to12(start)} – ${to12(end)}`;
      await notify(await memberUserId(q.member_id), 'assignment_updated', `Time change approved: ${when}`, `Your ${kindLabel} time is now ${when}.${note ? ` Note: ${note}` : ''}`, 'member-trainer.html');
      await notify(await trainerUserId(trainerId), 'assignment_updated', `${name}'s ${kindLabel} time changed`, `New time: ${when}.`, q.kind === 'personal' ? 'trainer-clients.html' : 'trainer-general.html');
    } else {
      await notify(await memberUserId(q.member_id), 'assignment_updated', 'Time change not approved', `Your request to change your ${kindLabel} time was not approved.${note ? ` Note: ${note}` : ''}`, 'member-trainer.html');
    }
    await audit(req, approve ? 'TIME_SHIFT_APPROVED' : 'TIME_SHIFT_REJECTED', { requestId: pid, memberId: q.member_id, kind: q.kind, start: approve ? start : null, end: approve ? end : null });
    res.json({ success: true, message: approve ? 'Approved — the new time now shows for the member, trainer and admin.' : 'Request rejected.', data: (await requestRows('q.public_id = $1', [pid]))[0] });
  } catch (err) { next(err); }
}
export const adminApprove = (req, res, next) => decide(req, res, next, true);
export const adminReject = (req, res, next) => decide(req, res, next, false);

// ---------------------------------------------------------------- member

export async function memberTimes(req, res, next) {
  try {
    if (!(await available())) return res.json({ success: true, data: { available: false, personal: [], general: null, requests: [] } });
    const [personal, general, requests] = await Promise.all([
      personalRows(`a.member_id = $1 AND a.status IN ('active', 'paused')`, [req.memberId]),
      generalRows(`g.member_id = $1 AND g.status = 'active'`, [req.memberId]),
      requestRows('q.member_id = $1', [req.memberId], 20),
    ]);
    res.json({
      success: true,
      data: {
        available: true,
        personal: personal.map((p) => ({ assignmentId: p.id, trainerName: p.trainer_name, slot: p.preferred_slot, startTime: p.start_time, endTime: p.end_time, sessionsPerWeek: p.sessions_per_week, status: p.status })),
        general: general[0] ? { assignmentId: general[0].id, trainerName: general[0].trainer_name, startTime: general[0].start_time, endTime: general[0].end_time, notes: general[0].notes } : null,
        requests: requests.map(({ member_id, member_name, member_code, ...r }) => r),
      },
    });
  } catch (err) { next(err); }
}

export async function memberRequest(req, res, next) {
  try {
    if (await needTables(res)) return;
    const kind = req.body?.kind;
    if (!['personal', 'general'].includes(kind)) return bad(res, 'Choose personal or general training.');
    let t; try { t = cleanTimes(req.body); } catch (e) { return bad(res, e.message); }
    const reason = cleanNote(req.body?.reason);
    let target; let currentLabel;
    if (kind === 'personal') {
      target = (await query(`SELECT id, preferred_slot FROM personal_trainer_assignments WHERE member_id = $1 AND status = 'active' ORDER BY start_date DESC NULLS LAST, id DESC LIMIT 1`, [req.memberId])).rows[0];
      if (!target) return bad(res, 'You have no active personal trainer, so there is no personal-training time to change.', 409);
      currentLabel = target.preferred_slot || null;
    } else {
      target = (await query(`SELECT id, to_char(start_time, 'HH24:MI') s, to_char(end_time, 'HH24:MI') e FROM general_training_assignments WHERE member_id = $1 AND status = 'active'`, [req.memberId])).rows[0];
      if (!target) return bad(res, 'You have no general-training time yet. The admin sets it first.', 409);
      currentLabel = `${to12(target.s)} - ${to12(target.e)}`;
    }
    let row;
    try {
      row = (await query(
        `INSERT INTO time_shift_requests (member_id, kind, pt_assignment_id, general_assignment_id, current_label, requested_start, requested_end, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING public_id`,
        [req.memberId, kind, kind === 'personal' ? target.id : null, kind === 'general' ? target.id : null, currentLabel, t.start, t.end, reason])).rows[0];
    } catch (e) {
      if (e.code === '23505') return bad(res, 'You already have a pending request for this. Wait for the admin, or cancel it first.', 409);
      throw e;
    }
    const name = (await query('SELECT full_name FROM members WHERE id = $1', [req.memberId])).rows[0]?.full_name || 'A member';
    await notifyStaff(`Time change request from ${name}`, `${kind === 'personal' ? 'Personal' : 'General'} training: ${currentLabel || '—'} → ${to12(t.start)} – ${to12(t.end)}${reason ? `. Reason: ${reason}` : ''}`);
    res.status(201).json({ success: true, message: 'Request sent to the admin.', data: (await requestRows('q.public_id = $1', [row.public_id]))[0] });
  } catch (err) { next(err); }
}

export async function memberCancel(req, res, next) {
  try {
    if (await needTables(res)) return;
    const pid = String(req.params.id || '');
    if (!UUID_RE.test(pid)) return bad(res, 'Invalid request.');
    const r = await query(`UPDATE time_shift_requests SET status = 'cancelled', updated_at = NOW() WHERE public_id = $1 AND member_id = $2 AND status = 'pending' RETURNING public_id`, [pid, req.memberId]);
    if (!r.rowCount) return bad(res, 'Pending request not found.', 404);
    res.json({ success: true, message: 'Request cancelled.' });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------- trainer

export async function trainerGeneralMembers(req, res, next) {
  try {
    if (!(await available())) return res.json({ success: true, data: { available: false, members: [] } });
    const rows = await generalRows(`g.trainer_id = $1 AND g.status = 'active'`, [req.trainerId]);
    res.json({ success: true, data: { available: true, members: rows.map(({ trainer_id, trainer_name, ...r }) => r) } });
  } catch (err) { next(err); }
}
