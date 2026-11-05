import { query } from '../config/database.js';

/**
 * Find membership plans
 * @param {Object} [options] - { activeOnly }
 * @param {import('pg').PoolClient} [client]
 */
export async function findPlans({ activeOnly = true } = {}, client) {
  const conditions = activeOnly ? 'WHERE is_active = TRUE' : '';
  const sql = `
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks
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
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks
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
    SELECT id, plan_code, name, duration_months, price_inr, badge_label, is_featured, is_active, perks
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
