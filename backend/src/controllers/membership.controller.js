import * as membershipService from '../services/membership.service.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * GET /api/membership-plans
 * Returns all active gym membership plans and pricing
 */
export async function getMembershipPlans(req, res, next) {
  try {
    const activeOnly = req.query.all === 'true' ? false : true;
    const plans = await membershipService.getMembershipPlans({ activeOnly });
    res.json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (err) {
    next(err);
  }
}

// ---- plan customisation (migration 031): who the fee plan is for + Mon–Sun planner
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_TYPES = ['pt', 'self', 'ladies', 'rest'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Returns { audience, weeklySchedule } (undefined = not sent) or throws a 400 error with a plain message. */
function cleanPlanExtras(body = {}) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const out = {};
  if (body.audience !== undefined) {
    if (!['all', 'girls', 'boys'].includes(body.audience)) throw bad('“For” must be Everyone, Girls or Boys.');
    out.audience = body.audience;
  }
  if (body.weeklySchedule !== undefined) {
    const ws = body.weeklySchedule;
    if (!ws || typeof ws !== 'object' || Array.isArray(ws)) throw bad('Weekly plan must be an object of days.');
    const clean = {};
    for (const [day, v] of Object.entries(ws)) {
      if (!DAYS.includes(day)) throw bad(`Unknown day “${String(day).slice(0, 10)}”.`);
      if (!v || !DAY_TYPES.includes(v.type)) throw bad(`Choose PT, Self, Ladies-only or Rest for ${day}.`);
      const d = { type: v.type };
      if (v.type !== 'rest' && (v.start || v.end)) {
        if (!TIME_RE.test(v.start || '') || !TIME_RE.test(v.end || '')) throw bad(`Use a start and end time like 07:00 for ${day}.`);
        if (v.end <= v.start) throw bad(`End time must be after start time on ${day}.`);
        d.start = v.start; d.end = v.end;
      }
      clean[day] = d;
    }
    out.weeklySchedule = clean;
  }
  return out;
}

export async function createPlan(req, res, next) {
  try {
    const { name, priceInr, durationMonths, badgeLabel, perks, planCode } = req.body;
    if (!name || !priceInr) {
      return res.status(400).json({ success: false, error: 'Plan name and price are required.' });
    }

    let extras;
    try { extras = cleanPlanExtras(req.body); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const created = await membershipService.createPlan({
      ...extras,
      name,
      priceInr: Number(priceInr),
      durationMonths: durationMonths ? Number(durationMonths) : 1,
      badgeLabel,
      perks: Array.isArray(perks) ? perks : perks ? perks.split(',').map((p) => p.trim()) : [],
      planCode,
    });

    broadcast('PLAN_CREATED', created, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.status(201).json({
      success: true,
      message: 'Plan created successfully.',
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

export async function updatePlan(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    let extras;
    try { extras = cleanPlanExtras(req.body); } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
    const updated = await membershipService.updatePlan(id, { ...req.body, audience: extras.audience, weeklySchedule: extras.weeklySchedule });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Plan not found.' });
    }

    broadcast('PLAN_UPDATED', updated, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Plan updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function togglePlan(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const toggled = await membershipService.togglePlanStatus(id);
    if (!toggled) {
      return res.status(404).json({ success: false, error: 'Plan not found.' });
    }

    broadcast('PLAN_STATUS_CHANGED', toggled, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: `Plan ${toggled.is_active ? 'activated' : 'deactivated'} successfully.`,
      data: toggled,
    });
  } catch (err) {
    next(err);
  }
}

export async function deletePlan(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await membershipService.deletePlan(id);
    broadcast('PLAN_DELETED', { id }, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Plan deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}


