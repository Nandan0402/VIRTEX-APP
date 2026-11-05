import { isDatabaseConnected } from '../config/database.js';
import * as membershipRepository from '../repositories/membership.repository.js';

const MOCK_PLANS = [
  {
    id: 1,
    plan_code: 'SILVER-01',
    name: 'Silver Monthly',
    duration_months: 1,
    price_inr: 2499.0,
    badge_label: 'Starter',
    is_featured: false,
    perks: ['Full Gym Floor & Cardio Access', 'Locker & Shower Facilities', 'Free Fitness Assessment'],
  },
  {
    id: 2,
    plan_code: 'GOLD-03',
    name: 'Gold Quarterly',
    duration_months: 3,
    price_inr: 5999.0,
    badge_label: 'Popular',
    is_featured: true,
    perks: ['Everything in Silver', '2 Personal Trainer Consultations', 'Nutrition & Macro Guidance', 'Steam & Sauna Access'],
  },
  {
    id: 3,
    plan_code: 'PLAT-12',
    name: 'Platinum Annual',
    duration_months: 12,
    price_inr: 18999.0,
    badge_label: 'VIP Elite',
    is_featured: false,
    perks: ['Unlimited 24/7 Access', 'Monthly 1-on-1 Trainer Session', 'Full Recovery Lounge Access', 'Free Locker for 1 Year'],
  },
];

/**
 * Fetch available membership plans & pricing
 */
export async function getMembershipPlans({ activeOnly = true } = {}) {
  if (isDatabaseConnected()) {
    return await membershipRepository.findPlans({ activeOnly });
  }

  // Fallback mock
  return MOCK_PLANS;
}

export async function createPlan(data) {
  if (isDatabaseConnected()) {
    return await membershipRepository.createPlan(data);
  }
  const newPlan = { id: MOCK_PLANS.length + 1, ...data };
  MOCK_PLANS.push(newPlan);
  return newPlan;
}

export async function updatePlan(id, data) {
  if (isDatabaseConnected()) {
    return await membershipRepository.updatePlan(id, data);
  }
  const plan = MOCK_PLANS.find((p) => p.id === Number(id));
  if (plan) Object.assign(plan, data);
  return plan || null;
}

export async function togglePlanStatus(id) {
  if (isDatabaseConnected()) {
    return await membershipRepository.togglePlanStatus(id);
  }
  const plan = MOCK_PLANS.find((p) => p.id === Number(id));
  if (plan) plan.is_active = !plan.is_active;
  return plan || null;
}

export async function deletePlan(id) {
  if (isDatabaseConnected()) {
    return await membershipRepository.deletePlan(id);
  }
  const idx = MOCK_PLANS.findIndex((p) => p.id === Number(id));
  if (idx !== -1) MOCK_PLANS.splice(idx, 1);
  return { id };
}

