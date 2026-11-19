/**
 * messaging.service.js — conversations between a member and their ASSIGNED trainer.
 * Shared by the Member Portal and Trainer Hub so both sides see the same thread and read state.
 *
 * Rules:
 *  - A member sees only threads where they are the member; a trainer only threads where they are the trainer.
 *  - New messages may only be sent while the trainer–member assignment is active or paused
 *    (same rule Trainer Hub uses for client access). Older threads stay readable as history.
 *  - Opening a thread marks the OTHER side's messages as read.
 *  - Each new message creates an in-app notification for the recipient when the notifications table exists.
 */
import * as repo from '../repositories/messaging.repository.js';
import { getPresentHubTables, isClientOfTrainer, getAssignedTrainerIds } from '../repositories/trainerHub.repository.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (status, message, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; return e; };
const MAX_BODY = 4000;

export async function messagingAvailable() {
  const present = await getPresentHubTables();
  return present.has('message_threads') && present.has('messages');
}
async function requireMessaging() {
  if (!(await messagingAvailable())) throw err(503, 'Messaging is waiting for a database update (Trainer Hub migration 008).', 'TRAINER_HUB_MIGRATIONS_PENDING');
}
export async function notificationsAvailable() {
  return (await getPresentHubTables()).has('notifications');
}

function cleanBody(body) {
  const text = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (!text) throw err(400, 'Write a message first.');
  if (text.length > MAX_BODY) throw err(400, `Messages can be at most ${MAX_BODY} characters.`);
  return text;
}

/** senderName comes from PostgreSQL (members / trainers / the admin's users row); senderRole → tag Member / Trainer / Admin. */
const presentMessage = (m, viewerRole) => ({
  id: m.public_id, mine: m.sender_role === viewerRole, senderRole: m.sender_role, body: m.body,
  senderName: m.sender_name || (m.sender_role === 'staff' ? 'Virtex Gym Team' : null),
  sentAt: m.created_at, readAt: m.read_at || null, edited: !!m.edited_at,
});

async function notify(recipientUserId, payload) {
  if (!recipientUserId || !(await notificationsAvailable())) return;
  try { await repo.createNotification({ recipientUserId, ...payload }); } catch { /* a failed notification never blocks the message */ }
}

// ---------------------------------------------------------------- member side

/** Display identity of the other side of a thread, as the member sees it. */
const GYM_TEAM = { name: 'Virtex Gym Team', specialty: 'Front desk & management' };
// Gym-team threads show the name of the admin who last replied (from PostgreSQL), else "Virtex Gym Team".
const counterpart = (t, staffName = t.last_staff_name) => (t.thread_type === 'gym'
  ? { name: staffName || GYM_TEAM.name, specialty: staffName ? 'Virtex Gym Team · front desk & management' : GYM_TEAM.specialty, role: 'admin' }
  : { name: t.trainer_name, specialty: t.trainer_specialty || null, role: 'trainer' });

export async function memberInbox(ctx) {
  if (!(await messagingAvailable())) return { available: false, threads: [], trainers: [], groups: [], gym: { available: false } };
  const { memberId } = ctx;
  const [threads, assignedIds, gymOk, groups] = await Promise.all([repo.listThreadsForMember(memberId), getAssignedTrainerIds(memberId), repo.gymThreadsAvailable(), memberGroups(ctx)]);
  const assigned = new Set(assignedIds.map((t) => t.trainer_id));
  const gymThread = threads.find((t) => t.thread_type === 'gym');
  return {
    available: true,
    threads: threads.map((t) => ({
      id: t.public_id, type: t.thread_type, trainer: counterpart(t), unread: t.unread,
      lastMessage: t.last_body ? { preview: t.last_body.slice(0, 140), fromMe: t.last_sender_role === 'member', at: t.last_created_at } : null,
      canReply: t.status === 'active' && (t.thread_type === 'gym' || assigned.has(t.trainer_id)),
      status: t.status,
    })),
    // Assigned trainers the member can start a conversation with (no existing thread yet).
    trainers: assignedIds.filter((a) => !threads.some((t) => t.trainer_id === a.trainer_id))
      .map((a) => ({ trainerId: a.trainer_id, name: a.trainer_name, specialty: a.specialty || null })),
    // Groups the gym team added this member to (members cannot create groups).
    groups,
    // Every member can message the gym team (owner/managers) 1-to-1.
    gym: { available: gymOk, threadId: gymThread ? gymThread.public_id : null, ...GYM_TEAM },
  };
}

/** Notify every active owner/manager about a member's message to the gym team. */
async function notifyStaff(t, text) {
  for (const uid of await repo.staffUserIds()) {
    await notify(uid, { type: 'new_message', title: `New message from ${t.member_name}`, body: text.slice(0, 140), linkUrl: `admin-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  }
}

/** Start (or reopen) the member's conversation with the gym team, optionally with a first message. */
export async function memberStartGymThread(ctx, body) {
  await requireMessaging();
  if (!(await repo.gymThreadsAvailable())) throw err(503, 'Messaging the gym team is waiting for a database update (migration 024).', 'MIGRATIONS_PENDING');
  const text = body === undefined || body === null || body === '' ? null : cleanBody(body);
  const t = await repo.getOrCreateGymThread(ctx.memberId);
  if (text) {
    await repo.insertMessage(t.id, ctx.user?.id || null, 'member', text);
    await notifyStaff(await repo.getThreadByPublicId(t.public_id), text);
  }
  return { id: t.public_id };
}

async function memberThread(memberId, threadId) {
  if (!UUID_RE.test(String(threadId || ''))) throw err(404, 'Conversation not found.');
  const t = await repo.getThreadByPublicId(threadId);
  if (!t || t.member_id !== memberId) throw err(404, 'Conversation not found.'); // same answer for other people's threads
  return t;
}

export async function memberOpenThread(ctx, threadId) {
  await requireMessaging();
  const { memberId } = ctx;
  const grp = await memberGroup(memberId, threadId);
  if (grp) return memberOpenGroup(ctx, grp);
  const t = await memberThread(memberId, threadId);
  await repo.markThreadRead(t.id, 'member');
  const gym = t.thread_type === 'gym';
  const [msgs, canReply] = await Promise.all([repo.listThreadMessages(t.id), gym ? true : isClientOfTrainer(t.trainer_id, memberId)]);
  return {
    id: t.public_id, type: t.thread_type, status: t.status,
    trainer: counterpart(t, [...msgs].reverse().find((m) => m.sender_role === 'staff' && m.sender_name)?.sender_name || null),
    canReply: canReply && t.status === 'active',
    messages: msgs.map((m) => presentMessage(m, 'member')),
  };
}

export async function memberSend(ctx, threadId, body) {
  await requireMessaging();
  const grp = await memberGroup(ctx.memberId, threadId);
  if (grp) return memberSendGroup(ctx, grp, body);
  const text = cleanBody(body);
  const t = await memberThread(ctx.memberId, threadId);
  if (t.thread_type === 'gym') {
    if (t.status !== 'active') throw err(403, 'This conversation is closed.');
    const g = await repo.insertMessage(t.id, ctx.user?.id || null, 'member', text);
    await notifyStaff(t, text);
    return presentMessage(g, 'member');
  }
  if (!(await isClientOfTrainer(t.trainer_id, ctx.memberId))) throw err(403, 'This trainer is no longer assigned to you, so the conversation is read-only.');
  const m = await repo.insertMessage(t.id, ctx.user?.id || null, 'member', text);
  await notify(await repo.userIdForTrainer(t.trainer_id), { type: 'new_message', title: `New message from ${t.member_name}`, body: text.slice(0, 140), linkUrl: `trainer-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return presentMessage(m, 'member');
}

/** Start (or reopen) the conversation with an assigned trainer, optionally with a first message. */
export async function memberStartThread(ctx, trainerIdRaw, body) {
  await requireMessaging();
  const trainerId = Number(trainerIdRaw);
  if (!Number.isInteger(trainerId) || trainerId <= 0) throw err(400, 'trainerId is required.');
  if (!(await isClientOfTrainer(trainerId, ctx.memberId))) throw err(403, 'You can message only your assigned trainer.');
  const text = body === undefined || body === null || body === '' ? null : cleanBody(body);
  const t = await repo.getOrCreateThread(trainerId, ctx.memberId);
  if (text) {
    await repo.insertMessage(t.id, ctx.user?.id || null, 'member', text);
    const full = await repo.getThreadByPublicId(t.public_id);
    await notify(await repo.userIdForTrainer(trainerId), { type: 'new_message', title: `New message from ${full.member_name}`, body: text.slice(0, 140), linkUrl: `trainer-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  }
  return { id: t.public_id };
}

// ---------------------------------------------------------------- trainer side

async function trainerThread(trainerId, threadId) {
  if (!UUID_RE.test(String(threadId || ''))) throw err(404, 'Conversation not found.');
  const t = await repo.getThreadByPublicId(threadId);
  if (!t || t.trainer_id !== trainerId) throw err(404, 'Conversation not found.');
  return t;
}

export async function trainerOpenThread(trainerId, threadId) {
  await requireMessaging();
  const tg = await ownTrainerGymThread(trainerId, threadId);
  if (tg) {
    await repo.markThreadRead(tg.id, 'trainer');
    const msgs = await repo.listThreadMessages(tg.id);
    return {
      id: tg.public_id, type: 'trainer_gym', member: null, counterpart: GYM_TEAM, status: tg.status,
      canReply: tg.status === 'active', messages: msgs.map((m) => presentMessage(m, 'trainer')),
    };
  }
  const t = await trainerThread(trainerId, threadId);
  await repo.markThreadRead(t.id, 'trainer');
  const [msgs, canReply] = await Promise.all([repo.listThreadMessages(t.id), isClientOfTrainer(trainerId, t.member_id)]);
  return {
    id: t.public_id, member: { id: t.member_id, name: t.member_name, code: t.member_code }, status: t.status,
    canReply: canReply && t.status === 'active', messages: msgs.map((m) => presentMessage(m, 'trainer')),
  };
}

export async function trainerSend(ctx, threadId, body) {
  await requireMessaging();
  const text = cleanBody(body);
  const tg = await ownTrainerGymThread(ctx.trainerId, threadId);
  if (tg) {
    if (tg.status !== 'active') throw err(403, 'This conversation is closed.');
    const g = await repo.insertMessage(tg.id, ctx.user?.id || null, 'trainer', text);
    await notifyStaffAboutTrainer(tg, text);
    return presentMessage(g, 'trainer');
  }
  const t = await trainerThread(ctx.trainerId, threadId);
  if (!(await isClientOfTrainer(ctx.trainerId, t.member_id))) throw err(403, 'This member is no longer your client, so the conversation is read-only.');
  const m = await repo.insertMessage(t.id, ctx.user?.id || null, 'trainer', text);
  await notify(await repo.userIdForMember(t.member_id), { type: 'new_message', title: `New message from ${t.trainer_name}`, body: text.slice(0, 140), linkUrl: `member-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return presentMessage(m, 'trainer');
}

/** Trainer opens (or creates) the thread with one of their clients. */
export async function trainerStartThread(ctx, memberIdRaw) {
  await requireMessaging();
  const memberId = Number(memberIdRaw);
  if (!Number.isInteger(memberId) || memberId <= 0) throw err(400, 'memberId is required.');
  if (!(await isClientOfTrainer(ctx.trainerId, memberId))) throw err(404, 'Client not found in your roster.');
  const t = await repo.getOrCreateThread(ctx.trainerId, memberId);
  return { id: t.public_id };
}

// ---------------------------------------------------------------- trainer ↔ gym team (migration 026)
// Each trainer has ONE conversation with the gym team (owner/managers share it). Trainers never see
// other trainers' gym-team threads; staff never see trainer ↔ member threads through this channel.

/** The trainer's own gym-team thread, or null (also null for other trainers' threads → callers answer 404). */
async function ownTrainerGymThread(trainerId, threadId) {
  if (!UUID_RE.test(String(threadId || '')) || !(await repo.trainerGymAvailable())) return null;
  const t = await repo.getTrainerGymThreadByPublicId(threadId);
  return t && t.trainer_id === trainerId ? t : null;
}
async function notifyStaffAboutTrainer(t, text) {
  for (const uid of await repo.staffUserIds()) {
    await notify(uid, { type: 'new_message', title: `New message from trainer ${t.trainer_name}`, body: text.slice(0, 140), linkUrl: `admin-messages.html?thread=${t.public_id}#trainers`, entityType: 'message_thread', entityId: t.id });
  }
}
async function requireTrainerGym() {
  await requireMessaging();
  if (!(await repo.trainerGymAvailable())) throw err(503, 'Messaging the gym team is waiting for a database update (migration 026).', 'MIGRATIONS_PENDING');
}

/** Trainer side: is the gym-team channel available, and the existing thread (if any). */
export async function trainerGymInfo(trainerId) {
  if (!(await messagingAvailable()) || !(await repo.trainerGymAvailable())) return { available: false, ...GYM_TEAM };
  const t = await repo.findTrainerGymThread(trainerId);
  return {
    available: true, ...GYM_TEAM,
    thread: t ? { id: t.public_id, unread: t.unread, status: t.status, lastMessage: t.last_body ? { preview: t.last_body.slice(0, 140), fromMe: t.last_sender_role === 'trainer', at: t.last_created_at } : null } : null,
  };
}

/** Trainer starts (or reopens) their gym-team conversation, optionally with a first message. */
export async function trainerStartGymThread(ctx, body) {
  await requireTrainerGym();
  const text = body === undefined || body === null || body === '' ? null : cleanBody(body);
  const t = await repo.getOrCreateTrainerGymThread(ctx.trainerId);
  if (text) {
    await repo.insertMessage(t.id, ctx.user?.id || null, 'trainer', text);
    await notifyStaffAboutTrainer(await repo.getTrainerGymThreadByPublicId(t.public_id), text);
  }
  return { id: t.public_id };
}

// ---- staff side
async function staffTrainerThread(threadId) {
  if (!UUID_RE.test(String(threadId || ''))) throw err(404, 'Conversation not found.');
  const t = await repo.getTrainerGymThreadByPublicId(threadId);
  if (!t) throw err(404, 'Conversation not found.');
  return t;
}

export async function staffTrainerInbox() {
  if (!(await messagingAvailable()) || !(await repo.trainerGymAvailable())) return { available: false, threads: [] };
  const rows = await repo.listTrainerGymThreads();
  return {
    available: true,
    unreadTotal: rows.reduce((n, t) => n + (t.unread || 0), 0),
    threads: rows.map((t) => ({
      id: t.public_id, trainer: { id: t.trainer_id, name: t.trainer_name, code: t.trainer_code, specialty: t.trainer_specialty }, unread: t.unread, status: t.status,
      lastMessage: t.last_body ? { preview: t.last_body.slice(0, 140), fromTrainer: t.last_sender_role === 'trainer', at: t.last_created_at } : null,
    })),
  };
}

export async function staffOpenTrainerThread(threadId) {
  await requireTrainerGym();
  const t = await staffTrainerThread(threadId);
  await repo.markThreadRead(t.id, 'staff');
  const msgs = await repo.listThreadMessages(t.id);
  return {
    id: t.public_id, type: 'trainer_gym', trainer: { id: t.trainer_id, name: t.trainer_name, code: t.trainer_code, specialty: t.trainer_specialty },
    status: t.status, canReply: t.status === 'active', messages: msgs.map((m) => presentMessage(m, 'staff')),
  };
}

export async function staffSendTrainer(ctx, threadId, body) {
  await requireTrainerGym();
  const text = cleanBody(body);
  const t = await staffTrainerThread(threadId);
  if (t.status !== 'active') throw err(403, 'This conversation is closed.');
  const m = await repo.insertMessage(t.id, ctx.user?.id || null, 'staff', text);
  await notify(await repo.userIdForTrainer(t.trainer_id), { type: 'new_message', title: 'New message from Virtex Gym Team', body: text.slice(0, 140), linkUrl: `trainer-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return presentMessage(m, 'staff');
}

/** Staff opens (or creates) the gym-team conversation with any trainer. */
export async function staffStartTrainerThread(trainerIdRaw) {
  await requireTrainerGym();
  const trainerId = Number(trainerIdRaw);
  if (!Number.isInteger(trainerId) || trainerId <= 0) throw err(400, 'trainerId is required.');
  if (!(await repo.trainerExists(trainerId))) throw err(404, 'Trainer not found.');
  const t = await repo.getOrCreateTrainerGymThread(trainerId);
  return { id: t.public_id };
}

// ---------------------------------------------------------------- automatic messages from the gym team (e.g. birthday wishes)
// Posted as the gym team (sender_role 'staff', no individual sender) in the recipient's existing 1-to-1
// gym-team conversation, so they appear in Messages and the gym team sees them in its inbox.

/** Can automatic messages reach members (008 + 024) / trainers (008 + 026)? */
export async function systemMessageChannels() {
  const base = await messagingAvailable();
  return {
    members: base && (await repo.gymThreadsAvailable()),
    trainers: base && (await repo.trainerGymAvailable()),
  };
}

export async function systemMessageToMember(memberId, body, { title = 'New message from Virtex Gym Team' } = {}) {
  await requireMessaging();
  if (!(await repo.gymThreadsAvailable())) throw err(503, 'Gym-team messaging needs migration 024.', 'MIGRATIONS_PENDING');
  const text = cleanBody(body);
  const t = await repo.getOrCreateGymThread(memberId);
  await repo.insertMessage(t.id, null, 'staff', text);
  await notify(await repo.userIdForMember(memberId), { type: 'new_message', title, body: text.slice(0, 140), linkUrl: `member-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return { threadId: t.public_id };
}

export async function systemMessageToTrainer(trainerId, body, { title = 'New message from Virtex Gym Team' } = {}) {
  await requireTrainerGym();
  const text = cleanBody(body);
  const t = await repo.getOrCreateTrainerGymThread(trainerId);
  await repo.insertMessage(t.id, null, 'staff', text);
  await notify(await repo.userIdForTrainer(trainerId), { type: 'new_message', title, body: text.slice(0, 140), linkUrl: `trainer-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return { threadId: t.public_id };
}

// ---------------------------------------------------------------- stored notifications (any signed-in user, own only)

export async function listMyNotifications(userId) {
  if (!userId || !(await notificationsAvailable())) return { available: false, items: [], unread: 0 };
  const rows = await repo.listNotificationsForUser(userId);
  return {
    available: true,
    unread: rows.filter((n) => !n.read_at).length,
    items: rows.map((n) => ({ id: n.public_id, type: n.type, title: n.title, body: n.body || '', link: n.link_url || null, readAt: n.read_at, createdAt: n.created_at })),
  };
}

export async function markMyNotificationsRead(userId, publicId = null) {
  if (!(await notificationsAvailable())) throw err(503, 'Notifications are waiting for a database update (Trainer Hub migration 009).', 'TRAINER_HUB_MIGRATIONS_PENDING');
  if (publicId !== null && !UUID_RE.test(String(publicId))) throw err(404, 'Notification not found.');
  return { marked: await repo.markNotificationsRead(userId, publicId) };
}

// ---------------------------------------------------------------- gym team side (owner / manager)
// The gym team shares one inbox: any owner/manager can read and reply to any member's gym-team thread.
// Staff never see trainer ↔ member threads here.

async function gymThread(threadId) {
  if (!UUID_RE.test(String(threadId || ''))) throw err(404, 'Conversation not found.');
  const t = await repo.getThreadByPublicId(threadId);
  if (!t || t.thread_type !== 'gym') throw err(404, 'Conversation not found.');
  return t;
}
async function requireGymMessaging() {
  await requireMessaging();
  if (!(await repo.gymThreadsAvailable())) throw err(503, 'Gym-team messaging is waiting for a database update (migration 024).', 'MIGRATIONS_PENDING');
}

export async function staffInbox(q = {}) {
  if (!(await messagingAvailable()) || !(await repo.gymThreadsAvailable())) return { available: false, threads: [] };
  const search = typeof q.search === 'string' && q.search.trim() ? q.search.trim().slice(0, 80) : null;
  const rows = await repo.listGymThreads({ search });
  return {
    available: true,
    unreadTotal: rows.reduce((n, t) => n + (t.unread || 0), 0),
    threads: rows.map((t) => ({
      id: t.public_id, member: { id: t.member_id, name: t.member_name, code: t.member_code }, unread: t.unread, status: t.status,
      lastMessage: t.last_body ? { preview: t.last_body.slice(0, 140), fromMember: t.last_sender_role === 'member', at: t.last_created_at } : null,
    })),
  };
}

export async function staffOpenThread(threadId) {
  await requireGymMessaging();
  const t = await gymThread(threadId);
  await repo.markThreadRead(t.id, 'staff');
  const msgs = await repo.listThreadMessages(t.id);
  return {
    id: t.public_id, member: { id: t.member_id, name: t.member_name, code: t.member_code }, status: t.status,
    canReply: t.status === 'active', messages: msgs.map((m) => presentMessage(m, 'staff')),
  };
}

export async function staffSend(ctx, threadId, body) {
  await requireGymMessaging();
  const text = cleanBody(body);
  const t = await gymThread(threadId);
  if (t.status !== 'active') throw err(403, 'This conversation is closed.');
  const m = await repo.insertMessage(t.id, ctx.user?.id || null, 'staff', text);
  await notify(await repo.userIdForMember(t.member_id), { type: 'new_message', title: 'New message from Virtex Gym Team', body: text.slice(0, 140), linkUrl: `member-messages.html?thread=${t.public_id}`, entityType: 'message_thread', entityId: t.id });
  return presentMessage(m, 'staff');
}

/** Staff opens (or creates) the gym-team conversation with any member. */
export async function staffStartThread(memberIdRaw) {
  await requireGymMessaging();
  const memberId = Number(memberIdRaw);
  if (!Number.isInteger(memberId) || memberId <= 0) throw err(400, 'memberId is required.');
  if (!(await repo.memberExists(memberId))) throw err(404, 'Member not found.');
  const t = await repo.getOrCreateGymThread(memberId);
  return { id: t.public_id };
}

// ---------------------------------------------------------------- group conversations (migration 025)
// ONLY the gym team (owner/managers) can create groups, rename/close them and add or remove people.
// Members see the groups they were added to and can post there while the group is open.
// Other members are shown to members as "First L." (no member codes or contact details).

async function requireGroups() {
  await requireMessaging();
  if (!(await repo.groupsAvailable())) throw err(503, 'Group messaging is waiting for a database update (migration 025).', 'MIGRATIONS_PENDING');
}
const shortName = (n) => { const p = String(n || 'Member').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0]; };
function cleanTitle(v, { required }) {
  if (v === undefined && !required) return undefined;
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  if (t.length < 2) throw err(400, 'Give the group a name (at least 2 characters).');
  if (t.length > 80) throw err(400, 'Group names can be at most 80 characters.');
  return t;
}
function cleanDescription(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  if (t.length > 300) throw err(400, 'Descriptions can be at most 300 characters.');
  return t || null;
}
function cleanMemberIds(v, { allowEmpty }) {
  if (v === undefined && allowEmpty) return [];
  if (!Array.isArray(v)) throw err(400, 'memberIds must be a list of member ids.');
  const ids = [...new Set(v.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw err(400, 'memberIds must be positive whole numbers.');
  if (!allowEmpty && !ids.length) throw err(400, 'Choose at least one member.');
  if (ids.length > 500) throw err(400, 'At most 500 members can be added at once.');
  return ids;
}
async function staffGroup(threadId) {
  if (!UUID_RE.test(String(threadId || ''))) throw err(404, 'Group not found.');
  const g = await repo.getGroupByPublicId(threadId);
  if (!g) throw err(404, 'Group not found.');
  return g;
}
async function notifyGroup(g, text, { exceptUserId = null, title }) {
  for (const uid of await repo.groupParticipantUserIds(g.id)) {
    if (uid === exceptUserId) continue;
    await notify(uid, { type: 'new_message', title, body: text.slice(0, 140), linkUrl: `member-messages.html?thread=${g.public_id}`, entityType: 'message_thread', entityId: g.id });
  }
}

// ---- staff (owner / manager)

export async function staffListGroups() {
  if (!(await messagingAvailable()) || !(await repo.groupsAvailable())) return { available: false, groups: [] };
  const rows = await repo.listGroupsForStaff();
  return {
    available: true,
    groups: rows.map((g) => ({
      id: g.public_id, title: g.title, description: g.description || '', status: g.status, memberCount: g.member_count, unread: g.unread,
      lastMessage: g.last_body ? { preview: g.last_body.slice(0, 140), fromMember: g.last_sender_role === 'member', at: g.last_created_at } : null,
      createdAt: g.created_at,
    })),
  };
}

export async function staffCreateGroup(ctx, body = {}) {
  await requireGroups();
  const title = cleanTitle(body.title, { required: true });
  const description = cleanDescription(body.description) ?? null;
  const memberIds = cleanMemberIds(body.memberIds, { allowEmpty: true });
  const g = await repo.createGroup({ title, description, userId: ctx.user?.id || null, memberIds });
  return { id: g.public_id };
}

export async function staffOpenGroup(ctx, threadId) {
  await requireGroups();
  const g = await staffGroup(threadId);
  await repo.markThreadRead(g.id, 'staff'); // "seen by the gym team" for members' messages
  const [msgs, people] = await Promise.all([repo.listGroupMessages(g.id), repo.listGroupParticipants(g.id)]);
  return {
    id: g.public_id, type: 'group', title: g.title, description: g.description || '', status: g.status, canReply: g.status === 'active',
    members: people.map((p) => ({ id: p.id, name: p.full_name, code: p.member_code })),
    messages: msgs.map((m) => ({
      id: m.public_id, mine: m.sender_role === 'staff' && m.sender_user_id === ctx.user?.id, senderRole: m.sender_role,
      senderName: m.sender_role === 'staff' ? `${m.sender_name || 'Gym team'} (gym team)` : (m.sender_name || 'Member'), body: m.body, sentAt: m.created_at,
    })),
  };
}

export async function staffSendGroup(ctx, threadId, body) {
  await requireGroups();
  const text = cleanBody(body);
  const g = await staffGroup(threadId);
  if (g.status !== 'active') throw err(403, 'This group is closed. Reopen it to post.');
  const m = await repo.insertMessage(g.id, ctx.user?.id || null, 'staff', text);
  await notifyGroup(g, text, { title: `Virtex Gym Team in ${g.title}` });
  return presentMessage(m, 'staff');
}

export async function staffUpdateGroup(threadId, body = {}) {
  await requireGroups();
  const g = await staffGroup(threadId);
  const { status } = body;
  if (status !== undefined && !['active', 'archived'].includes(status)) throw err(400, 'status must be active or archived.');
  await repo.updateGroup(g.id, { title: cleanTitle(body.title, { required: false }), description: cleanDescription(body.description), status });
  return { id: g.public_id };
}

export async function staffAddGroupMembers(ctx, threadId, body = {}) {
  await requireGroups();
  const g = await staffGroup(threadId);
  const ids = cleanMemberIds(body.memberIds, { allowEmpty: false });
  const added = await repo.addGroupMembers(g.id, ids, ctx.user?.id || null);
  return { added: added.length };
}

export async function staffRemoveGroupMember(threadId, memberIdRaw) {
  await requireGroups();
  const g = await staffGroup(threadId);
  const memberId = Number(memberIdRaw);
  if (!Number.isInteger(memberId) || memberId <= 0) throw err(400, 'memberId is required.');
  if (!(await repo.removeGroupMember(g.id, memberId))) throw err(404, 'That member is not in this group.');
  return { removed: true };
}

// ---- member

export async function memberGroups(ctx) {
  if (!(await repo.groupsAvailable())) return [];
  const rows = await repo.listGroupsForMember(ctx.memberId, ctx.user?.id || null);
  return rows.map((g) => ({
    id: g.public_id, type: 'group', trainer: { name: g.title, specialty: g.description || 'Group · gym team', role: 'group' }, unread: g.unread, status: g.status,
    lastMessage: g.last_body ? { preview: g.last_body.slice(0, 140), fromMe: g.last_sender_user_id === ctx.user?.id, at: g.last_created_at } : null,
    canReply: g.status === 'active',
  }));
}

/** The member's group, or null when the id is not a group they currently belong to (callers answer 404). */
async function memberGroup(memberId, threadId) {
  if (!UUID_RE.test(String(threadId || '')) || !(await repo.groupsAvailable())) return null;
  const g = await repo.getGroupByPublicId(threadId);
  if (!g || !(await repo.isActiveGroupMember(g.id, memberId))) return null;
  return g;
}

async function memberOpenGroup(ctx, g) {
  await repo.markGroupReadForMember(g.id, ctx.memberId);
  const [msgs, people] = await Promise.all([repo.listGroupMessages(g.id), repo.listGroupParticipants(g.id)]);
  return {
    id: g.public_id, type: 'group', status: g.status, canReply: g.status === 'active',
    trainer: { name: g.title, specialty: `${people.length} member${people.length === 1 ? '' : 's'} + gym team`, role: 'group' },
    messages: msgs.map((m) => {
      const mine = m.sender_user_id != null && m.sender_user_id === ctx.user?.id;
      return { id: m.public_id, mine, senderRole: m.sender_role, senderName: mine ? 'You' : (m.sender_role === 'staff' ? (m.sender_name || 'Virtex Gym Team') : shortName(m.sender_name)), body: m.body, sentAt: m.created_at };
    }),
  };
}

async function memberSendGroup(ctx, g, body) {
  const text = cleanBody(body);
  if (g.status !== 'active') throw err(403, 'This group is closed.');
  const m = await repo.insertMessage(g.id, ctx.user?.id || null, 'member', text);
  await repo.markGroupReadForMember(g.id, ctx.memberId);
  const me = (await repo.memberExists(ctx.memberId))?.full_name;
  await notifyGroup(g, text, { exceptUserId: ctx.user?.id || null, title: `${shortName(me)} in ${g.title}` });
  return presentMessage(m, 'member');
}
