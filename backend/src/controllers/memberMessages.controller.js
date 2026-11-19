/**
 * Gym-team ↔ member 1-to-1 messages (Admin → Member Messages). Owner / manager only (enforced in admin.routes.js).
 *   GET  /api/v1/admin/member-messages              inbox (?search=)
 *   POST /api/v1/admin/member-messages              { memberId } → open or create the conversation
 *   GET  /api/v1/admin/member-messages/:threadId    open (marks the member's messages read)
 *   POST /api/v1/admin/member-messages/:threadId    { body } → send
 */
import * as messaging from '../services/messaging.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

export const inbox = wrap(async (req, res) => ok(res, await messaging.staffInbox(req.query)));
export const start = wrap(async (req, res) => ok(res, await messaging.staffStartThread(req.body?.memberId), 201));
export const open = wrap(async (req, res) => ok(res, await messaging.staffOpenThread(req.params.threadId)));
export const send = wrap(async (req, res) => ok(res, await messaging.staffSend({ user: req.user }, req.params.threadId, req.body?.body), 201));

// Trainer ↔ gym team (migration 026)
//   GET  /api/v1/admin/trainer-messages             inbox
//   POST /api/v1/admin/trainer-messages             { trainerId } → open or create
//   GET  /api/v1/admin/trainer-messages/:threadId   open (marks the trainer's messages read)
//   POST /api/v1/admin/trainer-messages/:threadId   { body } → send
export const trainerInbox = wrap(async (req, res) => ok(res, await messaging.staffTrainerInbox()));
export const trainerStart = wrap(async (req, res) => ok(res, await messaging.staffStartTrainerThread(req.body?.trainerId), 201));
export const trainerOpen = wrap(async (req, res) => ok(res, await messaging.staffOpenTrainerThread(req.params.threadId)));
export const trainerSend = wrap(async (req, res) => ok(res, await messaging.staffSendTrainer({ user: req.user }, req.params.threadId, req.body?.body), 201));
