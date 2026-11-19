/**
 * messageExtras.controller.js — 📎 file attachments and 📊 polls inside Messages (migration 034).
 * One API for all three portals; works in every conversation type:
 *   'trainer' (member ↔ personal trainer), 'gym' (member ↔ gym team), 'trainer_gym' (trainer ↔ gym team), 'group'.
 *
 *   GET  /api/v1/messages/:threadId/extras          attachments + polls for the messages of one conversation
 *   POST /api/v1/messages/:threadId/attachments     { fileName, data (base64 or data: URL), caption? }  → new message
 *   POST /api/v1/messages/:threadId/polls           { question, options: [..2-10], multiple? }          → new message
 *   POST /api/v1/messages/polls/:pollId/vote        { optionIds: [...] }   ([] removes your vote)
 *   POST /api/v1/messages/polls/:pollId/close       (the person who created the poll, or the gym team)
 *   GET  /api/v1/messages/files/:fileId             download (only people who can open that conversation)
 *
 * Access: members — their own 1-to-1 conversations and groups they belong to; trainers — their own client chats
 * and their gym-team chat; owner/manager — gym-team, trainer↔gym and group conversations (never private
 * trainer↔member chats). Files: PDF, Word, Excel, PowerPoint, images, text/CSV, max 5 MB, checked by their real
 * content (not only the name), stored outside the public web folder.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { query, withTransaction } from '../config/database.js';
import { normalizeRole } from '../middlewares/auth.js';

const STORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage/message-files');
const MAX_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF = ['owner', 'manager', 'superadmin'];

// extension → [mime, signature check]
const sig = (hex) => (b) => b.subarray(0, hex.length / 2).toString('hex') === hex;
const ZIP = sig('504b0304'); const OLE = sig('d0cf11e0a1b11ae1');
const TEXT = (b) => !b.subarray(0, 4096).includes(0);
const TYPES = {
  pdf: ['application/pdf', sig('25504446')],
  doc: ['application/msword', OLE], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP],
  xls: ['application/vnd.ms-excel', OLE], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ZIP],
  ppt: ['application/vnd.ms-powerpoint', OLE], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ZIP],
  png: ['image/png', sig('89504e47')], jpg: ['image/jpeg', sig('ffd8ff')], jpeg: ['image/jpeg', sig('ffd8ff')],
  webp: ['image/webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  txt: ['text/plain', TEXT], csv: ['text/csv', TEXT],
};

const bad = (res, msg, status = 400) => res.status(status).json({ success: false, error: msg });

async function tablesReady() {
  return (await query(`SELECT to_regclass('public.message_attachments') IS NOT NULL AND to_regclass('public.message_poll_votes') IS NOT NULL AS ok`)).rows[0].ok;
}

/** Who is asking: { kind: 'member'|'trainer'|'staff', id, userId, senderRole } or null. */
async function viewer(req) {
  const role = normalizeRole(req.user?.role);
  const userId = req.user?.id;
  if (!userId) return null;
  if (role === 'member') {
    const r = (await query(`SELECT u.member_id, u.is_active, m.status FROM users u LEFT JOIN members m ON m.id = u.member_id WHERE u.id = $1`, [userId])).rows[0];
    if (!r?.member_id || r.is_active === false || r.status === 'frozen') return null;
    return { kind: 'member', id: r.member_id, userId, senderRole: 'member' };
  }
  if (role === 'trainer') {
    const r = (await query(`SELECT COALESCE((SELECT id FROM trainers WHERE user_id = $1 LIMIT 1), (SELECT trainer_id FROM users WHERE id = $1)) AS id`, [userId])).rows[0];
    return r?.id ? { kind: 'trainer', id: r.id, userId, senderRole: 'trainer' } : null;
  }
  if (STAFF.includes(role)) return { kind: 'staff', id: userId, userId, senderRole: 'staff' };
  return null;
}

/** The conversation if the viewer may open it (and whether they may post), else null. */
async function threadFor(v, threadPublicId) {
  if (!v || !UUID_RE.test(String(threadPublicId || ''))) return null;
  const t = (await query(`SELECT id, public_id, thread_type, member_id, trainer_id, status FROM message_threads WHERE public_id = $1`, [threadPublicId])).rows[0];
  if (!t) return null;
  const type = t.thread_type || 'trainer';
  let ok = false; let canPost = t.status === 'active';
  if (v.kind === 'member') {
    if ((type === 'trainer' || type === 'gym') && t.member_id === v.id) ok = true;
    if (type === 'group') ok = (await query(`SELECT 1 FROM message_thread_members WHERE thread_id = $1 AND member_id = $2 AND removed_at IS NULL`, [t.id, v.id])).rowCount > 0;
  } else if (v.kind === 'trainer') {
    ok = (type === 'trainer' || type === 'trainer_gym') && t.trainer_id === v.id;
  } else if (v.kind === 'staff') {
    ok = ['gym', 'trainer_gym', 'group'].includes(type);
  }
  if (!ok) return null;
  // A private member ↔ trainer chat is read-only once the trainer is no longer assigned.
  if (canPost && type === 'trainer') {
    canPost = (await query(`SELECT 1 FROM personal_trainer_assignments WHERE member_id = $1 AND trainer_id = $2 AND status IN ('active', 'paused')`, [t.member_id, t.trainer_id])).rowCount > 0;
  }
  return { ...t, type, canPost };
}

async function senderName(v) {
  if (v.kind === 'member') return (await query('SELECT full_name FROM members WHERE id = $1', [v.id])).rows[0]?.full_name || 'Member';
  if (v.kind === 'trainer') return (await query('SELECT full_name FROM trainers WHERE id = $1', [v.id])).rows[0]?.full_name || 'Trainer';
  return (await query('SELECT full_name FROM users WHERE id = $1', [v.userId])).rows[0]?.full_name || 'Gym team';
}

/** Best-effort notifications to the other people in the conversation. */
async function notifyOthers(t, v, title, body) {
  try {
    if (!(await query(`SELECT to_regclass('public.notifications') IS NOT NULL AS ok`)).rows[0].ok) return;
    const ids = new Set();
    const add = (rows) => rows.forEach((r) => r.id && ids.add(r.id));
    const memberUser = async (mid) => add((await query(`SELECT id FROM users WHERE member_id = $1 AND role = 'member'`, [mid])).rows);
    const trainerUser = async (tid) => add((await query(`SELECT COALESCE((SELECT user_id FROM trainers WHERE id = $1), (SELECT id FROM users WHERE trainer_id = $1 AND role = 'trainer' LIMIT 1)) AS id`, [tid])).rows);
    const staff = async () => add((await query(`SELECT id FROM users WHERE role IN ('owner', 'manager', 'superadmin') AND is_active = TRUE`)).rows);
    if (t.type === 'trainer') { await memberUser(t.member_id); await trainerUser(t.trainer_id); }
    else if (t.type === 'gym') { await memberUser(t.member_id); await staff(); }
    else if (t.type === 'trainer_gym') { await trainerUser(t.trainer_id); await staff(); }
    else if (t.type === 'group') { add((await query(`SELECT u.id FROM message_thread_members tm JOIN users u ON u.member_id = tm.member_id AND u.role = 'member' WHERE tm.thread_id = $1 AND tm.removed_at IS NULL`, [t.id])).rows); await staff(); }
    ids.delete(v.userId);
    const link = { member: `member-messages.html?thread=${t.public_id}`, trainer: `trainer-messages.html?thread=${t.public_id}`, staff: `admin-messages.html?thread=${t.public_id}` };
    for (const uid of ids) {
      const role = normalizeRole((await query('SELECT role FROM users WHERE id = $1', [uid])).rows[0]?.role);
      await query(`INSERT INTO notifications (recipient_user_id, type, title, body, link_url) VALUES ($1, 'new_message', $2, $3, $4)`,
        [uid, title, body.slice(0, 300), link[role === 'member' ? 'member' : role === 'trainer' ? 'trainer' : 'staff']]);
    }
  } catch { /* never block the message */ }
}

const ctx = async (req, res) => {
  if (!(await tablesReady())) { bad(res, 'Files and polls need database migration 034.', 503); return null; }
  const v = await viewer(req);
  if (!v) { bad(res, 'Messages are not available for this account.', 403); return null; }
  return v;
};

// ---------------------------------------------------------------- read

async function pollsFor(messageIds, userId) {
  if (!messageIds.length) return new Map();
  const polls = (await query(`SELECT p.id, p.public_id, p.message_id, p.question, p.allow_multiple, p.closed_at, p.created_by FROM message_polls p WHERE p.message_id = ANY($1::bigint[])`, [messageIds])).rows;
  if (!polls.length) return new Map();
  const pids = polls.map((p) => p.id);
  const [opts, votes] = await Promise.all([
    query(`SELECT o.id, o.poll_id, o.label, o.position, COUNT(v.id)::int AS votes, BOOL_OR(v.user_id = $2) AS mine
             FROM message_poll_options o LEFT JOIN message_poll_votes v ON v.option_id = o.id
            WHERE o.poll_id = ANY($1::bigint[]) GROUP BY o.id ORDER BY o.poll_id, o.position, o.id`, [pids, userId]),
    query(`SELECT poll_id, COUNT(DISTINCT user_id)::int AS voters FROM message_poll_votes WHERE poll_id = ANY($1::bigint[]) GROUP BY poll_id`, [pids]),
  ]);
  const voters = new Map(votes.rows.map((r) => [String(r.poll_id), r.voters]));
  const out = new Map();
  for (const p of polls) {
    out.set(String(p.message_id), {
      id: p.public_id, question: p.question, multiple: p.allow_multiple, closed: !!p.closed_at, mine: p.created_by === userId,
      totalVoters: voters.get(String(p.id)) || 0,
      options: opts.rows.filter((o) => String(o.poll_id) === String(p.id)).map((o) => ({ id: String(o.id), label: o.label, votes: o.votes, mine: !!o.mine })),
    });
  }
  return out;
}

export async function getExtras(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    const t = await threadFor(v, req.params.threadId);
    if (!t) return bad(res, 'Conversation not found.', 404);
    const msgs = (await query(`SELECT id, public_id FROM messages WHERE thread_id = $1 AND deleted_at IS NULL`, [t.id])).rows;
    const ids = msgs.map((m) => m.id);
    const pub = new Map(msgs.map((m) => [String(m.id), m.public_id]));
    const att = ids.length ? (await query(`SELECT public_id, message_id, file_name, mime_type, size_bytes FROM message_attachments WHERE message_id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows : [];
    const attachments = {};
    for (const a of att) { const k = pub.get(String(a.message_id)); (attachments[k] ||= []).push({ id: a.public_id, name: a.file_name, type: a.mime_type, size: a.size_bytes }); }
    const polls = {};
    for (const [mid, p] of await pollsFor(ids, v.userId)) polls[pub.get(mid)] = p;
    res.json({ success: true, data: { attachments, polls, canPost: t.canPost } });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------- attachments

export async function postAttachment(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    const t = await threadFor(v, req.params.threadId);
    if (!t) return bad(res, 'Conversation not found.', 404);
    if (!t.canPost) return bad(res, 'This conversation is closed or read-only.', 403);
    const rawName = String(req.body?.fileName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 160);
    const ext = (rawName.split('.').pop() || '').toLowerCase();
    if (!rawName || !TYPES[ext]) return bad(res, 'Allowed files: PDF, Word, Excel, PowerPoint, images (PNG, JPG, WebP), text and CSV.');
    const b64 = String(req.body?.data || '').replace(/^data:[^;,]*;base64,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return bad(res, 'The file could not be read.');
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return bad(res, 'The file is empty.');
    if (buf.length > MAX_BYTES) return bad(res, 'Files can be at most 5 MB.');
    const [mime, check] = TYPES[ext];
    if (!check(buf)) return bad(res, `That does not look like a real .${ext} file.`);
    const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 1000) : '';
    fs.mkdirSync(STORE, { recursive: true });
    const storageName = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(STORE, storageName), buf, { flag: 'wx' });
    let out;
    try {
      out = await withTransaction(async (c) => {
        const m = (await c.query(`INSERT INTO messages (thread_id, sender_user_id, sender_role, body) VALUES ($1, $2, $3, $4) RETURNING id, public_id`,
          [t.id, v.userId, v.senderRole, caption || `📎 ${rawName}`])).rows[0];
        const a = (await c.query(`INSERT INTO message_attachments (message_id, file_name, mime_type, size_bytes, storage_name, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING public_id`,
          [m.id, rawName, mime, buf.length, storageName, v.userId])).rows[0];
        return { messageId: m.public_id, fileId: a.public_id };
      });
    } catch (e) { fs.rmSync(path.join(STORE, storageName), { force: true }); throw e; }
    await notifyOthers(t, v, `📎 File from ${await senderName(v)}`, rawName);
    res.status(201).json({ success: true, message: 'File sent.', data: { ...out, name: rawName, type: mime, size: buf.length } });
  } catch (err) { next(err); }
}

export async function downloadFile(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    if (!UUID_RE.test(String(req.params.fileId || ''))) return bad(res, 'File not found.', 404);
    const a = (await query(
      `SELECT a.file_name, a.mime_type, a.storage_name, t.public_id AS thread_public_id
         FROM message_attachments a JOIN messages m ON m.id = a.message_id JOIN message_threads t ON t.id = m.thread_id
        WHERE a.public_id = $1 AND m.deleted_at IS NULL`, [req.params.fileId])).rows[0];
    if (!a || !(await threadFor(v, a.thread_public_id))) return bad(res, 'File not found.', 404);
    const file = path.join(STORE, path.basename(a.storage_name));
    if (!fs.existsSync(file)) return bad(res, 'File not found on the server.', 404);
    const inline = req.query.inline === '1' && /^image\/|^application\/pdf$/.test(a.mime_type);
    res.setHeader('Content-Type', a.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.file_name)}`);
    fs.createReadStream(file).pipe(res);
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------- polls

export async function postPoll(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    const t = await threadFor(v, req.params.threadId);
    if (!t) return bad(res, 'Conversation not found.', 404);
    if (!t.canPost) return bad(res, 'This conversation is closed or read-only.', 403);
    const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 200) : '';
    if (question.length < 2) return bad(res, 'Write the poll question.');
    const options = [...new Set((Array.isArray(req.body?.options) ? req.body.options : []).map((o) => String(o || '').trim().slice(0, 100)).filter(Boolean))];
    if (options.length < 2) return bad(res, 'Give at least 2 different options.');
    if (options.length > 10) return bad(res, 'A poll can have at most 10 options.');
    const multiple = req.body?.multiple === true;
    const out = await withTransaction(async (c) => {
      const m = (await c.query(`INSERT INTO messages (thread_id, sender_user_id, sender_role, body) VALUES ($1, $2, $3, $4) RETURNING id, public_id`,
        [t.id, v.userId, v.senderRole, `📊 Poll: ${question}`])).rows[0];
      const p = (await c.query(`INSERT INTO message_polls (message_id, question, allow_multiple, created_by) VALUES ($1, $2, $3, $4) RETURNING id, public_id`,
        [m.id, question, multiple, v.userId])).rows[0];
      for (let i = 0; i < options.length; i++) await c.query(`INSERT INTO message_poll_options (poll_id, label, position) VALUES ($1, $2, $3)`, [p.id, options[i], i]);
      return { messageId: m.public_id, pollId: p.public_id };
    });
    await notifyOthers(t, v, `📊 New poll from ${await senderName(v)}`, question);
    res.status(201).json({ success: true, message: 'Poll posted.', data: out });
  } catch (err) { next(err); }
}

async function pollWithAccess(v, pollPublicId) {
  if (!UUID_RE.test(String(pollPublicId || ''))) return null;
  const p = (await query(
    `SELECT p.id, p.message_id, p.allow_multiple, p.closed_at, p.created_by, t.public_id AS thread_public_id
       FROM message_polls p JOIN messages m ON m.id = p.message_id JOIN message_threads t ON t.id = m.thread_id
      WHERE p.public_id = $1 AND m.deleted_at IS NULL`, [pollPublicId])).rows[0];
  if (!p) return null;
  const t = await threadFor(v, p.thread_public_id);
  return t ? { p, t } : null;
}

export async function votePoll(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    const found = await pollWithAccess(v, req.params.pollId);
    if (!found) return bad(res, 'Poll not found.', 404);
    const { p } = found;
    if (p.closed_at) return bad(res, 'This poll is closed.', 409);
    const ids = [...new Set((Array.isArray(req.body?.optionIds) ? req.body.optionIds : []).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0))];
    if (!p.allow_multiple && ids.length > 1) return bad(res, 'Pick one option.');
    const valid = ids.length ? (await query(`SELECT id FROM message_poll_options WHERE poll_id = $1 AND id = ANY($2::bigint[])`, [p.id, ids])).rows.map((r) => Number(r.id)) : [];
    if (valid.length !== ids.length) return bad(res, 'Unknown option.');
    await withTransaction(async (c) => {
      await c.query(`DELETE FROM message_poll_votes WHERE poll_id = $1 AND user_id = $2`, [p.id, v.userId]);
      for (const o of valid) await c.query(`INSERT INTO message_poll_votes (poll_id, option_id, user_id) VALUES ($1, $2, $3)`, [p.id, o, v.userId]);
    });
    const poll = (await pollsFor([p.message_id], v.userId)).get(String(p.message_id));
    res.json({ success: true, message: valid.length ? 'Vote saved.' : 'Vote removed.', data: poll });
  } catch (err) { next(err); }
}

export async function closePoll(req, res, next) {
  try {
    const v = await ctx(req, res); if (!v) return;
    const found = await pollWithAccess(v, req.params.pollId);
    if (!found) return bad(res, 'Poll not found.', 404);
    if (found.p.created_by !== v.userId && v.kind !== 'staff') return bad(res, 'Only the person who created the poll (or the gym team) can close it.', 403);
    await query(`UPDATE message_polls SET closed_at = COALESCE(closed_at, NOW()) WHERE id = $1`, [found.p.id]);
    const poll = (await pollsFor([found.p.message_id], v.userId)).get(String(found.p.message_id));
    res.json({ success: true, message: 'Poll closed.', data: poll });
  } catch (err) { next(err); }
}
