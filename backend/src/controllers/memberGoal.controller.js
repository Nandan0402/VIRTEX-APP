/**
 * memberGoal.controller.js — the member's own training goal (Bulking / Cutting / Maintain).
 *   GET /api/v1/member/goal   → { goal: 'bulking' | 'cutting' | 'maintain' | null, label, updatedAt }
 *   PUT /api/v1/member/goal   { goal } → saves it
 * Stored in the EXISTING member_performance_profiles.fitness_goal (one row per member, UNIQUE member_id),
 * which trainers and the admin already see on client performance / Trainer Hub. memberScope pins req.memberId.
 */
import { query } from '../config/database.js';

const LABEL = { bulking: 'Bulking', cutting: 'Cutting', maintain: 'Maintain / Recomp' };

/** Map a stored fitness_goal text back to a goal key (null when it is something else, e.g. "General Fitness"). */
function toKey(text) {
  const t = String(text || '').toLowerCase();
  if (/bulk|mass|muscle gain|gain/.test(t)) return 'bulking';
  if (/cut|fat loss|weight loss|lose/.test(t)) return 'cutting';
  if (/maintain|recomp/.test(t)) return 'maintain';
  return null;
}

export async function getGoal(req, res, next) {
  try {
    const r = (await query('SELECT fitness_goal, last_updated_at FROM member_performance_profiles WHERE member_id = $1', [req.memberId])).rows[0];
    const goal = r ? toKey(r.fitness_goal) : null;
    res.json({ success: true, data: { goal, label: goal ? LABEL[goal] : null, stored: r?.fitness_goal || null, updatedAt: r?.last_updated_at || null } });
  } catch (err) { next(err); }
}

export async function setGoal(req, res, next) {
  try {
    const goal = req.body?.goal;
    if (!Object.hasOwn(LABEL, goal)) return res.status(400).json({ success: false, error: 'Choose Bulking, Cutting or Maintain.' });
    const r = (await query(
      `INSERT INTO member_performance_profiles (member_id, fitness_goal, last_updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (member_id) DO UPDATE SET fitness_goal = EXCLUDED.fitness_goal, last_updated_at = NOW()
       RETURNING fitness_goal, last_updated_at`, [req.memberId, LABEL[goal]])).rows[0];
    res.json({ success: true, message: `Goal set to ${LABEL[goal]}.`, data: { goal, label: LABEL[goal], stored: r.fitness_goal, updatedAt: r.last_updated_at } });
  } catch (err) { next(err); }
}
