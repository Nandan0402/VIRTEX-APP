import { query } from '../config/database.js';

/**
 * Find membership plans
 * @param {Object} [options] - { activeOnly }
 * @param {import('pg').PoolClient} [client]
 */
export async function findPlans({ activeOnly = true } = {}, client) {
  const conditions = activeOnly ? 'WHERE is_active = TRUE' : '';
  const sql = `
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule
    FROM membership_plans
    ${conditions}
    ORDER BY price_inr ASC;
  `;

  const executor = client || { query };
  const result = await executor.query(sql);
  return result.rows;
}

/**
 * Find membership plan by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findPlanById(id, client) {
  const sql = `
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule
    FROM membership_plans
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Find membership plan by plan_code (e.g. 'SILVER-01')
 * @param {string} planCode
 * @param {import('pg').PoolClient} [client]
 */
export async function findPlanByCode(planCode, client) {
  const sql = `
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule
    FROM membership_plans
    WHERE plan_code = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [planCode]);
  return result.rows[0] || null;
}

/**
 * Create a membership contract record
 * @param {Object} data
 * @param {import('pg').PoolClient} [client]
 */
export async function createMembership(data, client) {
  const {
    memberId,
    planId,
    startDate,
    endDate,
    pricePaid,
    paymentStatus = 'paid',
    status = 'active',
    autoRenew = false,
  } = data;

  const sql = `
    INSERT INTO memberships (
      member_id, plan_id, start_date, end_date, price_paid, payment_status, status, auto_renew
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, member_id, plan_id, start_date, end_date, price_paid, payment_status, status, auto_renew, created_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    memberId,
    planId,
    startDate,
    endDate,
    pricePaid,
    paymentStatus,
    status,
    autoRenew,
  ]);
  return result.rows[0];
}

/**
 * Find memberships for a specific member
 * @param {number} memberId
 * @param {import('pg').PoolClient} [client]
 */
export async function findMembershipsByMemberId(memberId, client) {
  const sql = `
    SELECT m.id, m.member_id, m.plan_id, p.name AS plan_name, m.start_date, m.end_date,
           m.price_paid, m.payment_status, m.status, m.auto_renew, m.created_at
    FROM memberships m
    JOIN membership_plans p ON p.id = m.plan_id
    WHERE m.member_id = $1
    ORDER BY m.start_date DESC;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [memberId]);
  return result.rows;
}

/**
 * Create a new membership plan
 * @param {Object} planData
 * @param {import('pg').PoolClient} [client]
 */
export async function createPlan(planData, client) {
  const {
    planCode = `PLAN-${Date.now().toString().slice(-4)}`,
    name,
    durationMonths = 1,
    priceInr,
    badgeLabel = 'Standard',
    isFeatured = false,
    isActive = true,
    perks = [],
    audience = 'all',
    weeklySchedule = {},
  } = planData;

  const sql = `
    INSERT INTO membership_plans (
      plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    RETURNING id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule, created_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    planCode,
    name,
    durationMonths,
    priceInr,
    badgeLabel,
    isFeatured,
    isActive,
    perks,
    audience,
    JSON.stringify(weeklySchedule || {}),
  ]);
  return result.rows[0];
}

/**
 * Update an existing membership plan
 * @param {number} id
 * @param {Object} planData
 * @param {import('pg').PoolClient} [client]
 */
export async function updatePlan(id, planData, client) {
  const { name, durationMonths, priceInr, badgeLabel, isFeatured, isActive, perks, audience, weeklySchedule } = planData;

  const sql = `
    UPDATE membership_plans
    SET name = COALESCE($1, name),
        duration_months = COALESCE($2, duration_months),
        price_inr = COALESCE($3, price_inr),
        badge_label = COALESCE($4, badge_label),
        is_featured = COALESCE($5, is_featured),
        is_active = COALESCE($6, is_active),
        perks = COALESCE($7, perks),
        audience = COALESCE($9, audience),
        weekly_schedule = COALESCE($10::jsonb, weekly_schedule),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $8
    RETURNING id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks, audience, weekly_schedule, updated_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    name,
    durationMonths,
    priceInr,
    badgeLabel,
    isFeatured,
    isActive,
    perks,
    id,
    audience ?? null,
    weeklySchedule === undefined || weeklySchedule === null ? null : JSON.stringify(weeklySchedule),
  ]);
  return result.rows[0] || null;
}

/**
 * Toggle plan active status
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function togglePlanStatus(id, client) {
  const sql = `
    UPDATE membership_plans
    SET is_active = NOT is_active,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING id, plan_code, name, is_active, updated_at;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Delete a membership plan
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deletePlan(id, client) {
  const sql = `
    DELETE FROM membership_plans
    WHERE id = $1
    RETURNING id;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [id]);
  return result.rows[0] || null;
}


