/**
 * Trainer login details + admin-authorised password changes.
 *
 * No new tables: requests and their outcomes are events in the existing auth_audit_logs table.
 *   PASSWORD_CHANGE_REQUESTED   trainer asks the admin for a new password   (details: trainerId, reason)
 *   PASSWORD_SET_BY_ADMIN       admin set the coach's password (create/edit coach) — resolves open requests
 *   PASSWORD_REQUEST_DISMISSED  admin closed a request without changing it  (details: requestId, note)
 * Passwords are never stored or returned here (only bcrypt hashes exist, in users.password_hash).
 */
import { query } from '../config/database.js';

export const EVENTS = {
  REQUESTED: 'PASSWORD_CHANGE_REQUESTED',
  SET_BY_ADMIN: 'PASSWORD_SET_BY_ADMIN',
  DISMISSED: 'PASSWORD_REQUEST_DISMISSED',
};

/** A request stays open until the admin sets a password for that user afterwards, or dismisses it.
 *  "Afterwards" uses the SERIAL id (strictly increasing), not created_at, which can tie within a transaction. */
const OPEN_SQL = `
  NOT EXISTS (SELECT 1 FROM auth_audit_logs s WHERE s.user_id = r.user_id AND s.event_type = '${EVENTS.SET_BY_ADMIN}' AND s.id > r.id)
  AND NOT EXISTS (SELECT 1 FROM auth_audit_logs d WHERE d.event_type = '${EVENTS.DISMISSED}' AND d.details->>'requestId' = r.id::text)`;

/** The login linked to a trainer profile (users.trainer_id or trainers.user_id). */
export async function getTrainerLogin(trainerId) {
  const r = await query(
    `SELECT u.id, u.username, u.email, u.phone, u.role, u.is_active, u.last_login_at, u.created_at,
            t.id AS trainer_id, t.trainer_code, t.full_name
       FROM trainers t
       JOIN users u ON u.id = COALESCE(t.user_id, (SELECT id FROM users WHERE trainer_id = t.id ORDER BY id LIMIT 1))
      WHERE t.id = $1
      LIMIT 1`,
    [trainerId]
  );
  return r.rows[0] || null;
}

export async function getPasswordStatus(userId) {
  const [last, open, recent] = await Promise.all([
    query(`SELECT event_type, created_at FROM auth_audit_logs WHERE user_id = $1 AND event_type IN ('${EVENTS.SET_BY_ADMIN}', 'PASSWORD_CHANGED')
            ORDER BY id DESC LIMIT 1`, [userId]),
    query(`SELECT r.id, r.created_at, r.details->>'reason' AS reason FROM auth_audit_logs r
            WHERE r.user_id = $1 AND r.event_type = '${EVENTS.REQUESTED}' AND ${OPEN_SQL}
            ORDER BY r.id DESC LIMIT 1`, [userId]),
    query(`SELECT r.id, r.created_at, r.details->>'reason' AS reason,
                  CASE WHEN ${OPEN_SQL} THEN 'pending'
                       WHEN EXISTS (SELECT 1 FROM auth_audit_logs d WHERE d.event_type = '${EVENTS.DISMISSED}' AND d.details->>'requestId' = r.id::text) THEN 'dismissed'
                       ELSE 'completed' END AS status,
                  (SELECT d.details->>'note' FROM auth_audit_logs d WHERE d.event_type = '${EVENTS.DISMISSED}' AND d.details->>'requestId' = r.id::text LIMIT 1) AS admin_note
             FROM auth_audit_logs r WHERE r.user_id = $1 AND r.event_type = '${EVENTS.REQUESTED}'
            ORDER BY r.id DESC LIMIT 5`, [userId]),
  ]);
  return { lastSet: last.rows[0] || null, pending: open.rows[0] || null, history: recent.rows };
}

export async function createRequest({ userId, username, trainerId, reason, ipAddress, userAgent }) {
  const r = await query(
    `INSERT INTO auth_audit_logs (user_id, username, event_type, role, ip_address, user_agent, details)
     VALUES ($1, $2, '${EVENTS.REQUESTED}', 'trainer', $3, $4, $5) RETURNING id, created_at`,
    [userId, String(username || 'trainer').slice(0, 50), ipAddress || null, userAgent || null, { trainerId, reason: reason || null }]
  );
  return r.rows[0];
}

export async function listOpenTrainerRequests() {
  const r = await query(
    `SELECT r.id, r.created_at, r.details->>'reason' AS reason, r.user_id, u.username, u.email AS login_email,
            t.id AS trainer_id, t.full_name, t.trainer_code
       FROM auth_audit_logs r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN trainers t ON t.id = COALESCE(u.trainer_id, NULLIF(r.details->>'trainerId', '')::int)
      WHERE r.event_type = '${EVENTS.REQUESTED}' AND ${OPEN_SQL}
      ORDER BY r.id ASC
      LIMIT 100`
  );
  return r.rows;
}

export async function getRequest(id) {
  const r = await query(`SELECT r.id, r.user_id, r.created_at FROM auth_audit_logs r WHERE r.id = $1 AND r.event_type = '${EVENTS.REQUESTED}' AND ${OPEN_SQL}`, [id]);
  return r.rows[0] || null;
}

export async function dismissRequest(requestId, admin, note) {
  const r = await query(
    `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details)
     VALUES ($1, $2, '${EVENTS.DISMISSED}', $3, $4) RETURNING id, created_at`,
    [admin.id || null, String(admin.username || 'admin').slice(0, 50), admin.role || null, { requestId: String(requestId), note: note || null }]
  );
  return r.rows[0];
}

/** Called after the admin sets a coach's password (create or edit). The acting admin is in details. */
export async function recordAdminPasswordSet(targetUserId, targetUsername, admin, trainerId) {
  await query(
    `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details)
     VALUES ($1, $2, '${EVENTS.SET_BY_ADMIN}', 'trainer', $3)`,
    [targetUserId, String(targetUsername || 'trainer').slice(0, 50), { trainerId, by: admin?.username || null, byUserId: admin?.id || null }]
  );
}
