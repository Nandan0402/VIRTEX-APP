/**
 * messaging.repository.js — member ↔ assigned-trainer conversations (Trainer Hub migration 008 tables
 * message_threads / messages) and in-app notifications (migration 009 table notifications).
 * Every query is parameterised and scoped by the caller's own trainer/member id — authorisation
 * (who may open which thread) is checked in messaging.service.js.
 */
import { query, withTransaction } from '../config/database.js';

// thread_type: 'trainer' (member ↔ assigned trainer) or 'gym' (member ↔ gym team: owner/managers; migration 024)
const THREAD_COLS = `t.id, t.public_id, t.trainer_id, t.member_id, t.status, t.last_message_at, t.created_at, COALESCE(t.thread_type, 'trainer') AS thread_type`;

export async function listThreadsForMember(memberId) {
  const res = await query(
    `SELECT ${THREAD_COLS}, tr.full_name AS trainer_name, tr.specialty AS trainer_specialty,
            (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.sender_role <> 'member') AS unread,
            lm.body AS last_body, lm.sender_role AS last_sender_role, lm.created_at AS last_created_at,
            ls.full_name AS last_staff_name
       FROM message_threads t
       LEFT JOIN trainers tr ON tr.id = t.trainer_id
       LEFT JOIN LATERAL (SELECT body, sender_role, created_at FROM messages m WHERE m.thread_id = t.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1) lm ON TRUE
       LEFT JOIN LATERAL (SELECT NULLIF(TRIM(u.full_name), '') AS full_name FROM messages m JOIN users u ON u.id = m.sender_user_id
                           WHERE m.thread_id = t.id AND m.sender_role = 'staff' AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1) ls ON TRUE
      WHERE t.member_id = $1
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
    [memberId]
  );
  return res.rows;
}

export async function getThreadByPublicId(publicId) {
  const res = await query(
    `SELECT ${THREAD_COLS}, tr.full_name AS trainer_name, tr.specialty AS trainer_specialty, m.full_name AS member_name, m.member_code
       FROM message_threads t LEFT JOIN trainers tr ON tr.id = t.trainer_id JOIN members m ON m.id = t.member_id
      WHERE t.public_id = $1`,
    [publicId]
  );
  return res.rows[0] || null;
}

/** Latest messages (oldest first for display). */
export async function listThreadMessages(threadId, limit = 200) {
  const res = await query(
    // sender_name: the member / trainer of the thread, or the admin's own account name for gym-team replies
    // (NULL for automatic system messages → shown as the gym team).
    `SELECT * FROM (
        SELECT m.id, m.public_id, m.sender_role, m.sender_user_id, m.body, m.read_at, m.created_at, m.edited_at,
               CASE m.sender_role
                 WHEN 'member' THEN mem.full_name
                 WHEN 'trainer' THEN tr.full_name
                 ELSE NULLIF(TRIM(u.full_name), '')
               END AS sender_name
          FROM messages m
          JOIN message_threads t ON t.id = m.thread_id
          LEFT JOIN members mem ON mem.id = t.member_id
          LEFT JOIN trainers tr ON tr.id = t.trainer_id
          LEFT JOIN users u ON u.id = m.sender_user_id
         WHERE m.thread_id = $1 AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC, m.id DESC LIMIT $2) x
      ORDER BY created_at ASC, id ASC`, // id breaks ties for messages sent in the same instant
    [threadId, limit]
  );
  return res.rows;
}

/** Mark the OTHER side's messages as read (the reader never marks their own). */
export async function markThreadRead(threadId, readerRole) {
  const res = await query(
    `UPDATE messages SET read_at = NOW()
      WHERE thread_id = $1 AND sender_role <> $2 AND read_at IS NULL AND deleted_at IS NULL`,
    [threadId, readerRole]
  );
  return res.rowCount;
}

/** One thread per trainer–member pair (UNIQUE); re-activates an archived thread. */
export async function getOrCreateThread(trainerId, memberId) {
  const res = await query(
    `INSERT INTO message_threads (trainer_id, member_id) VALUES ($1, $2)
     ON CONFLICT (trainer_id, member_id) DO UPDATE SET status = 'active', archived_at = NULL
     RETURNING id, public_id, trainer_id, member_id, status, last_message_at, created_at`,
    [trainerId, memberId]
  );
  return res.rows[0];
}

/** Does the database support gym-team threads (migration 024)? */
let gymReady = { at: 0, ok: false };
export async function gymThreadsAvailable() {
  if (Date.now() - gymReady.at < 60000) return gymReady.ok;
  const r = await query(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'message_threads' AND column_name = 'thread_type') AS ok`);
  gymReady = { at: Date.now(), ok: r.rows[0].ok };
  return gymReady.ok;
}

/** The member's single conversation with the gym team (created on first use; re-activated if archived). */
export async function getOrCreateGymThread(memberId) {
  const res = await query(
    `INSERT INTO message_threads (member_id, thread_type) VALUES ($1, 'gym')
     ON CONFLICT (member_id) WHERE thread_type = 'gym' DO UPDATE SET status = 'active', archived_at = NULL
     RETURNING id, public_id, trainer_id, member_id, status, last_message_at, created_at, thread_type`,
    [memberId]
  );
  return res.rows[0];
}

/** Gym-team inbox for owners/managers: every member's gym thread, newest first, with unread member messages. */
export async function listGymThreads({ search = null, limit = 200 } = {}) {
  const res = await query(
    `SELECT ${THREAD_COLS}, m.full_name AS member_name, m.member_code, m.phone AS member_phone,
            (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.sender_role = 'member') AS unread,
            lm.body AS last_body, lm.sender_role AS last_sender_role, lm.created_at AS last_created_at
       FROM message_threads t
       JOIN members m ON m.id = t.member_id
       LEFT JOIN LATERAL (SELECT body, sender_role, created_at FROM messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1) lm ON TRUE
      WHERE t.thread_type = 'gym' AND ($1::text IS NULL OR m.full_name ILIKE '%' || $1 || '%' OR m.member_code ILIKE '%' || $1 || '%')
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC
      LIMIT $2`,
    [search, limit]
  );
  return res.rows;
}

/** Active owner/manager logins (recipients of gym-team message notifications). */
export async function staffUserIds() {
  const r = await query(`SELECT id FROM users WHERE role IN ('owner', 'manager', 'superadmin') AND is_active = TRUE`);
  return r.rows.map((x) => x.id);
}

export async function memberExists(memberId) {
  const r = await query('SELECT id, full_name FROM members WHERE id = $1', [memberId]);
  return r.rows[0] || null;
}

export async function insertMessage(threadId, senderUserId, senderRole, body) {
  const res = await query(
    `INSERT INTO messages (thread_id, sender_user_id, sender_role, body) VALUES ($1, $2, $3, $4)
     RETURNING public_id, sender_role, body, read_at, created_at`,
    [threadId, senderUserId, senderRole, body]
  );
  return res.rows[0];
}

export async function userIdForTrainer(trainerId) {
  const r = await query(`SELECT id FROM users WHERE trainer_id = $1 AND role = 'trainer' ORDER BY id LIMIT 1`, [trainerId]);
  return r.rows[0]?.id || null;
}
export async function userIdForMember(memberId) {
  const r = await query(`SELECT id FROM users WHERE member_id = $1 AND role = 'member' ORDER BY id LIMIT 1`, [memberId]);
  return r.rows[0]?.id || null;
}

// ---------------------------------------------------------------- notifications (migration 009)

export async function createNotification({ recipientUserId, type, title, body = null, linkUrl = null, entityType = null, entityId = null }) {
  const res = await query(
    `INSERT INTO notifications (recipient_user_id, type, title, body, link_url, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING public_id`,
    [recipientUserId, type, title, body, linkUrl, entityType, entityId]
  );
  return res.rows[0];
}

export async function listNotificationsForUser(userId, limit = 100) {
  const res = await query(
    `SELECT public_id, type, title, body, link_url, read_at, created_at
       FROM notifications WHERE recipient_user_id = $1 AND archived_at IS NULL
      ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return res.rows;
}

export async function markNotificationsRead(userId, publicId = null) {
  const res = await query(
    `UPDATE notifications SET read_at = NOW()
      WHERE recipient_user_id = $1 AND read_at IS NULL AND archived_at IS NULL AND ($2::uuid IS NULL OR public_id = $2::uuid)
      RETURNING public_id`,
    [userId, publicId]
  );
  return res.rowCount;
}

// ---------------------------------------------------------------- group conversations (migration 025)
// Created only by the gym team (enforced in the service + admin routes). Participants live in
// message_thread_members; a member's unread count is "messages from others after my last_read_at".

let groupReady = { at: 0, ok: false };
export async function groupsAvailable() {
  if (Date.now() - groupReady.at < 60000) return groupReady.ok;
  const r = await query(`SELECT to_regclass('public.message_thread_members') IS NOT NULL AS ok`);
  groupReady = { at: Date.now(), ok: r.rows[0].ok };
  return groupReady.ok;
}

const GROUP_COLS = `t.id, t.public_id, t.status, t.title, t.description, t.created_at, t.last_message_at, t.created_by_user_id`;

/** Create a group and add its first participants in one transaction. */
export async function createGroup({ title, description, userId, memberIds }) {
  return withTransaction(async (client) => {
    const g = (await client.query(
      `INSERT INTO message_threads (thread_type, title, description, created_by_user_id) VALUES ('group', $1, $2, $3)
       RETURNING id, public_id`,
      [title, description, userId]
    )).rows[0];
    if (memberIds.length) {
      await client.query(
        `INSERT INTO message_thread_members (thread_id, member_id, added_by_user_id)
         SELECT $1, m.id, $2 FROM members m WHERE m.id = ANY($3::int[])`,
        [g.id, userId, memberIds]
      );
    }
    return g;
  });
}

export async function getGroupByPublicId(publicId) {
  const r = await query(`SELECT ${GROUP_COLS} FROM message_threads t WHERE t.public_id = $1 AND t.thread_type = 'group'`, [publicId]);
  return r.rows[0] || null;
}

/** Staff list of all groups with participant count, last message and unread member messages. */
export async function listGroupsForStaff() {
  const res = await query(
    `SELECT ${GROUP_COLS},
            (SELECT COUNT(*)::int FROM message_thread_members p WHERE p.thread_id = t.id AND p.removed_at IS NULL) AS member_count,
            (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.sender_role = 'member') AS unread,
            lm.body AS last_body, lm.sender_role AS last_sender_role, lm.created_at AS last_created_at
       FROM message_threads t
       LEFT JOIN LATERAL (SELECT body, sender_role, created_at FROM messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1) lm ON TRUE
      WHERE t.thread_type = 'group'
      ORDER BY (t.status = 'active') DESC, COALESCE(t.last_message_at, t.created_at) DESC`
  );
  return res.rows;
}

/** Groups the member currently belongs to. */
export async function listGroupsForMember(memberId, userId) {
  const res = await query(
    `SELECT ${GROUP_COLS},
            (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL
                AND x.sender_user_id IS DISTINCT FROM $2 AND (p.last_read_at IS NULL OR x.created_at > p.last_read_at)) AS unread,
            lm.body AS last_body, lm.sender_role AS last_sender_role, lm.sender_user_id AS last_sender_user_id, lm.created_at AS last_created_at
       FROM message_thread_members p
       JOIN message_threads t ON t.id = p.thread_id AND t.thread_type = 'group'
       LEFT JOIN LATERAL (SELECT body, sender_role, sender_user_id, created_at FROM messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1) lm ON TRUE
      WHERE p.member_id = $1 AND p.removed_at IS NULL
      ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
    [memberId, userId]
  );
  return res.rows;
}

export async function isActiveGroupMember(threadId, memberId) {
  const r = await query(`SELECT 1 FROM message_thread_members WHERE thread_id = $1 AND member_id = $2 AND removed_at IS NULL`, [threadId, memberId]);
  return r.rowCount > 0;
}

export async function markGroupReadForMember(threadId, memberId) {
  await query(`UPDATE message_thread_members SET last_read_at = NOW() WHERE thread_id = $1 AND member_id = $2`, [threadId, memberId]);
}

/** Current participants (names for everyone; member code only used on the staff side). */
export async function listGroupParticipants(threadId) {
  const r = await query(
    `SELECT m.id, m.full_name, m.member_code, p.added_at
       FROM message_thread_members p JOIN members m ON m.id = p.member_id
      WHERE p.thread_id = $1 AND p.removed_at IS NULL
      ORDER BY m.full_name`,
    [threadId]
  );
  return r.rows;
}

/** Group messages with the sender's display name (member name, or the staff user's name). */
export async function listGroupMessages(threadId, limit = 300) {
  const res = await query(
    `SELECT * FROM (
        SELECT x.id, x.public_id, x.sender_role, x.sender_user_id, x.body, x.created_at, x.edited_at,
               COALESCE(mem.full_name, u.full_name) AS sender_name
          FROM messages x
          LEFT JOIN users u ON u.id = x.sender_user_id
          LEFT JOIN members mem ON mem.id = u.member_id AND x.sender_role = 'member'
         WHERE x.thread_id = $1 AND x.deleted_at IS NULL
         ORDER BY x.created_at DESC, x.id DESC LIMIT $2) y
      ORDER BY created_at ASC, id ASC`,
    [threadId, limit]
  );
  return res.rows;
}

/** Add (or re-add) members. Returns the number of members now active that were not before. */
export async function addGroupMembers(threadId, memberIds, userId) {
  const r = await query(
    `INSERT INTO message_thread_members (thread_id, member_id, added_by_user_id)
     SELECT $1, m.id, $2 FROM members m WHERE m.id = ANY($3::int[])
     ON CONFLICT (thread_id, member_id) DO UPDATE SET removed_at = NULL, added_by_user_id = EXCLUDED.added_by_user_id, added_at = NOW()
       WHERE message_thread_members.removed_at IS NOT NULL
     RETURNING member_id`,
    [threadId, userId, memberIds]
  );
  return r.rows.map((x) => x.member_id);
}

export async function removeGroupMember(threadId, memberId) {
  const r = await query(`UPDATE message_thread_members SET removed_at = NOW() WHERE thread_id = $1 AND member_id = $2 AND removed_at IS NULL`, [threadId, memberId]);
  return r.rowCount;
}

export async function updateGroup(threadId, { title, description, status }) {
  const r = await query(
    `UPDATE message_threads SET
        title = COALESCE($2, title),
        description = CASE WHEN $3::boolean THEN $4 ELSE description END,
        status = COALESCE($5, status),
        archived_at = CASE WHEN $5 = 'archived' THEN COALESCE(archived_at, NOW()) WHEN $5 = 'active' THEN NULL ELSE archived_at END
      WHERE id = $1 AND thread_type = 'group'
      RETURNING id`,
    [threadId, title ?? null, description !== undefined, description ?? null, status ?? null]
  );
  return r.rowCount;
}

/** Login ids of a group's current participants (for notifications). */
export async function groupParticipantUserIds(threadId) {
  const r = await query(
    `SELECT u.id FROM message_thread_members p JOIN users u ON u.member_id = p.member_id AND u.role = 'member' AND u.is_active
      WHERE p.thread_id = $1 AND p.removed_at IS NULL`,
    [threadId]
  );
  return r.rows.map((x) => x.id);
}

// ---------------------------------------------------------------- trainer ↔ gym team (migration 026)

let trainerGymReady = { at: 0, ok: false };
export async function trainerGymAvailable() {
  if (Date.now() - trainerGymReady.at < 60000) return trainerGymReady.ok;
  const r = await query(`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_trainer_gym_thread') AS ok`);
  trainerGymReady = { at: Date.now(), ok: r.rows[0].ok };
  return trainerGymReady.ok;
}

/** The trainer's single conversation with the gym team (created on first use; re-activated if archived). */
export async function getOrCreateTrainerGymThread(trainerId) {
  const res = await query(
    `INSERT INTO message_threads (trainer_id, thread_type) VALUES ($1, 'trainer_gym')
     ON CONFLICT (trainer_id) WHERE thread_type = 'trainer_gym' DO UPDATE SET status = 'active', archived_at = NULL
     RETURNING id, public_id, trainer_id, status`,
    [trainerId]
  );
  return res.rows[0];
}

const TG_SELECT = `SELECT ${THREAD_COLS}, tr.full_name AS trainer_name, tr.specialty AS trainer_specialty, tr.trainer_code,
            lm.body AS last_body, lm.sender_role AS last_sender_role, lm.created_at AS last_created_at`;
const TG_FROM = `FROM message_threads t JOIN trainers tr ON tr.id = t.trainer_id
       LEFT JOIN LATERAL (SELECT body, sender_role, created_at FROM messages x WHERE x.thread_id = t.id AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC LIMIT 1) lm ON TRUE`;

export async function getTrainerGymThreadByPublicId(publicId) {
  const r = await query(`${TG_SELECT} ${TG_FROM} WHERE t.public_id = $1 AND t.thread_type = 'trainer_gym'`, [publicId]);
  return r.rows[0] || null;
}

/** The trainer's own gym-team thread with unread count (messages from the gym team not yet read). */
export async function findTrainerGymThread(trainerId) {
  const r = await query(
    `${TG_SELECT}, (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.sender_role <> 'trainer') AS unread
     ${TG_FROM} WHERE t.trainer_id = $1 AND t.thread_type = 'trainer_gym'`,
    [trainerId]
  );
  return r.rows[0] || null;
}

/** Staff list: every trainer's gym-team thread with unread trainer messages. */
export async function listTrainerGymThreads() {
  const r = await query(
    `${TG_SELECT}, (SELECT COUNT(*)::int FROM messages x WHERE x.thread_id = t.id AND x.read_at IS NULL AND x.deleted_at IS NULL AND x.sender_role = 'trainer') AS unread
     ${TG_FROM} WHERE t.thread_type = 'trainer_gym'
     ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`
  );
  return r.rows;
}

export async function trainerExists(trainerId) {
  const r = await query('SELECT id, full_name FROM trainers WHERE id = $1', [trainerId]);
  return r.rows[0] || null;
}
