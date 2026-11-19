/**
 * memberMenu.controller.js — the admin decides which Member Portal features members see (migration 035),
 * separately for PERSONAL-training members (active/paused PT assignment) and GENERAL members; plus member
 * Punch In / Punch Out from the Member Portal (recorded in check_ins).
 *
 *  Admin   GET /api/v1/admin/member-menu        → { items, personal, general }
 *          PUT /api/v1/admin/member-menu        { personal: {key: bool}, general: {key: bool} }
 *  Member  GET /api/v1/member/menu              → { group: 'personal'|'general', visible: {key: bool} }
 *          GET /api/v1/member/punch             → { open, checkInTime, today: [...] }
 *          POST /api/v1/member/punch-in | /punch-out
 *
 * Dashboard and My Account are always on. Defaults: personal members get everything except Diet and Progress
 * (their personal trainer handles those); general members get everything.
 */
import { query } from '../config/database.js';

export const MENU_ITEMS = [
  { key: 'trainer', label: 'My Trainer', icon: '🎓' },
  { key: 'workouts-menu', label: 'Workouts', icon: '🏋️' },
  { key: 'diet-plans', label: 'Diet', icon: '🥗' },
  { key: 'progress-menu', label: 'Progress pages (overview, measurements, achievements)', icon: '📈' },
  { key: 'dashboard-progress', label: 'Progress chart on the dashboard (graphic progress)', icon: '📊' },
  { key: 'pt-sessions', label: 'PT Sessions', icon: '🤝' },
  { key: 'classes', label: 'Classes', icon: '🗓️' },
  { key: 'membership-menu', label: 'Membership & Fees', icon: '💳' },
  { key: 'attendance', label: 'Attendance + Punch In / Punch Out', icon: '🚪' },
  { key: 'messages', label: 'Messages', icon: '💬' },
  { key: 'notifications-menu', label: 'Notifications & Announcements', icon: '🔔' },
  { key: 'events', label: 'Events', icon: '🏆' },
  { key: 'feedback', label: 'Feedback', icon: '⭐' },
];
const KEYS = MENU_ITEMS.map((i) => i.key);
const DEFAULTS = {
  personal: Object.fromEntries(KEYS.map((k) => [k, !['diet-plans', 'progress-menu'].includes(k)])),
  general: Object.fromEntries(KEYS.map((k) => [k, true])),
};

async function columnReady(table, column) {
  return (await query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, column])).rowCount > 0;
}
/** Saved choices merged over the defaults (unknown keys ignored, new items default to on). */
async function loadMenu() {
  let saved = null;
  if (await columnReady('gym_settings', 'member_menu')) saved = (await query(`SELECT member_menu FROM gym_settings WHERE id = 1`)).rows[0]?.member_menu || null;
  const out = {};
  for (const g of ['personal', 'general']) out[g] = Object.fromEntries(KEYS.map((k) => [k, typeof saved?.[g]?.[k] === 'boolean' ? saved[g][k] : DEFAULTS[g][k]]));
  return out;
}
async function groupOf(memberId) {
  const r = await query(`SELECT 1 FROM personal_trainer_assignments WHERE member_id = $1 AND status IN ('active', 'paused') LIMIT 1`, [memberId]);
  return r.rowCount ? 'personal' : 'general';
}

// ---------------------------------------------------------------- admin

export async function adminGetMenu(req, res, next) {
  try {
    const menu = await loadMenu();
    const counts = (await query(`SELECT COUNT(*) FILTER (WHERE has_pt)::int AS personal, COUNT(*) FILTER (WHERE NOT has_pt)::int AS general
        FROM (SELECT EXISTS (SELECT 1 FROM personal_trainer_assignments pa WHERE pa.member_id = m.id AND pa.status IN ('active', 'paused')) AS has_pt
                FROM members m WHERE m.status <> 'inactive') x`)).rows[0];
    res.json({ success: true, data: { items: MENU_ITEMS, ...menu, defaults: DEFAULTS, counts, available: await columnReady('gym_settings', 'member_menu') } });
  } catch (err) { next(err); }
}

export async function adminSaveMenu(req, res, next) {
  try {
    if (!(await columnReady('gym_settings', 'member_menu'))) return res.status(503).json({ success: false, error: 'Member menu settings need database migration 035.' });
    const clean = {};
    for (const g of ['personal', 'general']) {
      const src = req.body?.[g];
      if (!src || typeof src !== 'object') return res.status(400).json({ success: false, error: `Send ${g} choices.` });
      clean[g] = Object.fromEntries(KEYS.map((k) => [k, src[k] === true]));
    }
    await query(`UPDATE gym_settings SET member_menu = $1::jsonb, updated_at = NOW() WHERE id = 1`, [JSON.stringify(clean)]);
    try {
      await query(`INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, 'MEMBER_MENU_UPDATED', $3, $4)`,
        [req.user?.id || null, req.user?.username || null, req.user?.role || null, JSON.stringify(clean)]);
    } catch { /* audit is best effort */ }
    res.json({ success: true, message: 'Member menu saved. Members see it the next time they open a page.', data: clean });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------- member

export async function memberMenu(req, res, next) {
  try {
    const [menu, group] = await Promise.all([loadMenu(), groupOf(req.memberId)]);
    res.json({ success: true, data: { group, visible: menu[group] } });
  } catch (err) { next(err); }
}

async function punchAllowed(memberId) {
  const [menu, group] = await Promise.all([loadMenu(), groupOf(memberId)]);
  return menu[group].attendance !== false;
}
async function punchState(memberId) {
  const open = (await query(`SELECT id, check_in_time FROM check_ins WHERE member_id = $1 AND check_out_time IS NULL AND check_in_method = 'member_portal' AND check_in_time::date = CURRENT_DATE ORDER BY check_in_time DESC LIMIT 1`, [memberId])).rows[0] || null;
  const today = (await query(`SELECT check_in_time, check_out_time, check_in_method FROM check_ins WHERE member_id = $1 AND check_in_time::date = CURRENT_DATE ORDER BY check_in_time`, [memberId])).rows;
  return { open: !!open, checkInTime: open?.check_in_time || null, today };
}

export async function memberPunchStatus(req, res, next) {
  try {
    if (!(await columnReady('check_ins', 'check_out_time'))) return res.json({ success: true, data: { available: false } });
    res.json({ success: true, data: { available: true, allowed: await punchAllowed(req.memberId), ...(await punchState(req.memberId)) } });
  } catch (err) { next(err); }
}

export async function memberPunchIn(req, res, next) {
  try {
    if (!(await columnReady('check_ins', 'check_out_time'))) return res.status(503).json({ success: false, error: 'Punch In needs database migration 035.' });
    if (!(await punchAllowed(req.memberId))) return res.status(403).json({ success: false, error: 'Punch In is switched off for your membership.' });
    const s = await punchState(req.memberId);
    if (s.open) return res.status(409).json({ success: false, error: 'You are already punched in. Punch out when you leave.' });
    await query(`INSERT INTO check_ins (member_id, check_in_method, notes) VALUES ($1, 'member_portal', 'Punched in from the Member Portal')`, [req.memberId]);
    res.status(201).json({ success: true, message: 'Punched in — have a great workout!', data: await punchState(req.memberId) });
  } catch (err) { next(err); }
}

export async function memberPunchOut(req, res, next) {
  try {
    if (!(await columnReady('check_ins', 'check_out_time'))) return res.status(503).json({ success: false, error: 'Punch Out needs database migration 035.' });
    const r = await query(`UPDATE check_ins SET check_out_time = NOW()
        WHERE id = (SELECT id FROM check_ins WHERE member_id = $1 AND check_out_time IS NULL AND check_in_method = 'member_portal' AND check_in_time::date = CURRENT_DATE ORDER BY check_in_time DESC LIMIT 1)
        RETURNING check_in_time, check_out_time`, [req.memberId]);
    if (!r.rowCount) return res.status(409).json({ success: false, error: 'You are not punched in.' });
    const mins = Math.max(1, Math.round((new Date(r.rows[0].check_out_time) - new Date(r.rows[0].check_in_time)) / 60000));
    res.json({ success: true, message: `Punched out — ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m today. See you next time!`, data: await punchState(req.memberId) });
  } catch (err) { next(err); }
}
