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
