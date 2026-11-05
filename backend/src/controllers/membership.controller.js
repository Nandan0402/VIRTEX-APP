import * as membershipService from '../services/membership.service.js';

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

export async function createPlan(req, res, next) {
  try {
    const { name, priceInr, durationMonths, badgeLabel, perks, planCode } = req.body;
    if (!name || !priceInr) {
      return res.status(400).json({ success: false, error: 'Plan name and price are required.' });
    }

    const created = await membershipService.createPlan({
      name,
      priceInr: Number(priceInr),
      durationMonths: durationMonths ? Number(durationMonths) : 1,
      badgeLabel,
      perks: Array.isArray(perks) ? perks : perks ? perks.split(',').map((p) => p.trim()) : [],
      planCode,
    });

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
    const updated = await membershipService.updatePlan(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Plan not found.' });
    }

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
    res.json({
      success: true,
      message: 'Plan deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}


