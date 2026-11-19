/**
 * Member group conversations — created and managed ONLY by the gym team (owner / manager; enforced in admin.routes.js).
 *   GET    /api/v1/admin/member-groups                          list groups
 *   POST   /api/v1/admin/member-groups                          { title, description?, memberIds? } → create
 *   GET    /api/v1/admin/member-groups/:groupId                 open (messages + participants)
 *   PATCH  /api/v1/admin/member-groups/:groupId                 { title?, description?, status? } rename / close / reopen
 *   POST   /api/v1/admin/member-groups/:groupId/messages        { body } → post as the gym team
 *   POST   /api/v1/admin/member-groups/:groupId/members         { memberIds } → add people
 *   DELETE /api/v1/admin/member-groups/:groupId/members/:memberId  remove someone (history is kept)
 */
import * as messaging from '../services/messaging.service.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const ctx = (req) => ({ user: req.user });

export const list = wrap(async (req, res) => ok(res, await messaging.staffListGroups()));
export const create = wrap(async (req, res) => ok(res, await messaging.staffCreateGroup(ctx(req), req.body || {}), 201));
export const open = wrap(async (req, res) => ok(res, await messaging.staffOpenGroup(ctx(req), req.params.groupId)));
export const update = wrap(async (req, res) => ok(res, await messaging.staffUpdateGroup(req.params.groupId, req.body || {})));
export const send = wrap(async (req, res) => ok(res, await messaging.staffSendGroup(ctx(req), req.params.groupId, req.body?.body), 201));
export const addMembers = wrap(async (req, res) => ok(res, await messaging.staffAddGroupMembers(ctx(req), req.params.groupId, req.body || {})));
export const removeMember = wrap(async (req, res) => ok(res, await messaging.staffRemoveGroupMember(req.params.groupId, req.params.memberId)));
