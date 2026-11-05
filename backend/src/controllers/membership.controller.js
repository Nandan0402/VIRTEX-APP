import * as membershipService from '../services/membership.service.js';

/**
 * GET /api/membership-plans
 * Returns all active gym membership plans and pricing
 */
export async function getMembershipPlans(req, res, next) {
  try {
    const plans = await membershipService.getMembershipPlans({ activeOnly: true });
    res.json({
      success: true,
      count: plans.length,
      data: plans,
    });
  } catch (err) {
    next(err);
  }
}

