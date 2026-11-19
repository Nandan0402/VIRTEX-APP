/**
 * Virtex Admin - Finance and Billing Expansion Repository
 * Unified financial queries for admission fees, membership packages, app access fees,
 * payment history, invoices, receipts, outstanding dues, refunds, promo discounts,
 * monthly revenue reports, expense ledger, and trainer commissions.
 */

import { pool } from '../config/database.js';

// ----------------------------------------------------
// 1. ADMISSION FEES
// ----------------------------------------------------

export async function getAdmissionFees() {
  const query = 'SELECT * FROM admission_fees ORDER BY id ASC';
  const { rows } = await pool.query(query);
  return rows;
}

export async function createAdmissionFee(data) {
  const query = `
    INSERT INTO admission_fees (name, amount, description, is_active)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const params = [
    data.name,
    parseFloat(data.amount) || 1000.00,
    data.description || '',
    data.is_active !== undefined ? (data.is_active === true || data.is_active === 'true') : true
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

export async function getMemberAdmissionRecords() {
  const query = `
    SELECT 
      mar.id,
      mar.member_id,
      m.full_name AS member_name,
      m.member_code,
      m.phone AS member_phone,
      mar.amount,
      mar.status,
      mar.waiver_reason,
      mar.receipt_code,
      mar.paid_at,
      mar.created_at
    FROM member_admission_records mar
    JOIN members m ON mar.member_id = m.id
    ORDER BY mar.paid_at DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function recordMemberAdmission(data) {
  const receipt = data.receipt_code || `REC-ADM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const query = `
    INSERT INTO member_admission_records (member_id, admission_fee_id, amount, status, waiver_reason, receipt_code, paid_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *
  `;
  const params = [
    data.member_id,
    data.admission_fee_id || null,
    parseFloat(data.amount) || 1500.00,
    data.status || 'paid',
    data.waiver_reason || null,
    receipt
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 2. MEMBERSHIP PACKAGE PRICING
// ----------------------------------------------------

export async function getMembershipPackages() {
  const query = `
    SELECT 
      mp.id,
      mp.plan_code,
      mp.name,
      mp.duration_months,
      mp.price_inr,
      mp.badge_label,
      mp.is_featured,
      mp.is_active,
      mp.perks,
      COUNT(m.id) AS active_subscribers_count
    FROM membership_plans mp
    LEFT JOIN members m ON mp.id = m.plan_id AND m.status = 'active'
    GROUP BY mp.id
    ORDER BY mp.duration_months ASC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function updatePackagePrice(id, { price_inr, is_active, perks, badge_label }) {
  const query = `
    UPDATE membership_plans
    SET 
      price_inr = COALESCE($1, price_inr),
      is_active = COALESCE($2, is_active),
      perks = COALESCE($3, perks),
      badge_label = COALESCE($4, badge_label),
      updated_at = NOW()
    WHERE id = $5
    RETURNING *
  `;
  const params = [
    price_inr !== undefined ? parseFloat(price_inr) : null,
    is_active !== undefined ? (is_active === true || is_active === 'true') : null,
    perks || null,
    badge_label || null,
    id
  ];
  const { rows } = await pool.query(query, params);
  return rows[0] || null;
}

// ----------------------------------------------------
// 3. DIGITAL APPLICATION ACCESS FEES
// ----------------------------------------------------

export async function getDigitalAppFees() {
  const query = 'SELECT * FROM digital_app_fees ORDER BY id ASC';
  const { rows } = await pool.query(query);
  return rows;
}

export async function getMemberAppSubscriptions() {
  const query = `
    SELECT 
      mas.id,
      mas.member_id,
      m.full_name AS member_name,
      m.member_code,
      daf.title AS app_fee_title,
      mas.amount_paid,
      mas.valid_from,
      mas.valid_until,
      mas.payment_status
    FROM member_app_fee_subscriptions mas
    JOIN members m ON mas.member_id = m.id
    LEFT JOIN digital_app_fees daf ON mas.app_fee_id = daf.id
    ORDER BY mas.valid_until DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function subscribeMemberAppFee(data) {
  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);

  const query = `
    INSERT INTO member_app_fee_subscriptions (member_id, app_fee_id, amount_paid, valid_from, valid_until, payment_status)
    VALUES ($1, $2, $3, CURRENT_DATE, $4, 'active')
    RETURNING *
  `;
  const params = [
    data.member_id,
    data.app_fee_id || null,
    parseFloat(data.amount_paid) || 499.00,
    data.valid_until || validUntil.toISOString().slice(0, 10)
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 4. FINANCIAL TRANSACTIONS & INVOICES
// ----------------------------------------------------

export async function getFinancialTransactions({ member_id, transaction_type, payment_status } = {}) {
  let query = `
    SELECT 
      ft.id,
      ft.member_id,
      m.full_name AS member_name,
      m.member_code,
      m.phone AS member_phone,
      ft.transaction_type,
      ft.reference_id,
      ft.amount,
      ft.tax_amount,
      ft.discount_amount,
      ft.net_amount,
      ft.payment_method,
      ft.payment_status,
      ft.invoice_number,
      ft.receipt_number,
      ft.transaction_date,
      ft.notes
    FROM financial_transactions ft
    LEFT JOIN members m ON ft.member_id = m.id
    WHERE ${REAL_TX('ft.')}
  `;
  const params = [];

  if (member_id) {
    params.push(member_id);
    query += ` AND ft.member_id = $${params.length}`;
  }
  if (transaction_type && transaction_type !== 'All') {
    params.push(transaction_type);
    query += ` AND ft.transaction_type = $${params.length}`;
  }
  if (payment_status && payment_status !== 'All') {
    params.push(payment_status);
    query += ` AND ft.payment_status = $${params.length}`;
  }

  query += ` ORDER BY ft.transaction_date DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getTransactionById(id) {
  const query = `
    SELECT 
      ft.*,
      m.full_name AS member_name,
      m.member_code,
      m.phone AS member_phone,
      m.email AS member_email,
      m.plan_name
    FROM financial_transactions ft
    LEFT JOIN members m ON ft.member_id = m.id
    WHERE ft.id = $1
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createFinancialTransaction(data) {
  const invoiceNum = data.invoice_number || `INV-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
  const receiptNum = data.receipt_number || `REC-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  const gross = parseFloat(data.amount) || 0.00;
  const discount = parseFloat(data.discount_amount) || 0.00;
  const taxable = Math.max(0, gross - discount);
  const tax = Number((taxable * 0.18).toFixed(2));
  const net = Number((taxable).toFixed(2));

  const query = `
    INSERT INTO financial_transactions (
      member_id, transaction_type, reference_id, amount, tax_amount,
      discount_amount, net_amount, payment_method, payment_status,
      invoice_number, receipt_number, transaction_date, notes
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), $12)
    RETURNING *
  `;
  const params = [
    data.member_id || null,
    data.transaction_type || 'membership',
    data.reference_id || null,
    gross,
    tax,
    discount,
    net,
    data.payment_method || 'UPI / QR',
    data.payment_status || 'completed',
    invoiceNum,
    receiptNum,
    data.notes || ''
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 5. OUTSTANDING DUES REPORTS
// ----------------------------------------------------

export async function getOutstandingDuesReport() {
  const query = `
    SELECT 
      m.id AS member_id,
      m.member_code,
      m.full_name AS member_name,
      m.phone AS member_phone,
      m.email AS member_email,
      m.plan_name,
      m.fee_amount,
      m.fee_paid,
      m.fee_due,
      m.fee_due_date,
      m.payment_status,
      m.fee_alert_sent_at,
      CASE 
        WHEN m.fee_due_date IS NOT NULL AND m.fee_due_date < CURRENT_DATE 
        THEN (CURRENT_DATE - m.fee_due_date)
        ELSE 0 
      END AS overdue_days
    FROM members m
    WHERE m.fee_due > 0 OR m.payment_status IN ('partial', 'pending', 'overdue')
    ORDER BY m.fee_due DESC, overdue_days DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

// ----------------------------------------------------
// 6. REFUND MANAGEMENT
// ----------------------------------------------------

export async function getRefundRequests() {
  const query = `
    SELECT 
      rr.id,
      rr.transaction_id,
      rr.member_id,
      m.full_name AS member_name,
      m.member_code,
      m.phone AS member_phone,
      rr.amount,
      rr.reason,
      rr.status,
      rr.approved_by_user_id,
      u.full_name AS approver_name,
      rr.requested_at,
      rr.processed_at,
      rr.notes
    FROM refund_requests rr
    JOIN members m ON rr.member_id = m.id
    LEFT JOIN users u ON rr.approved_by_user_id = u.id
    ORDER BY rr.requested_at DESC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

export async function createRefundRequest(data) {
  const query = `
    INSERT INTO refund_requests (transaction_id, member_id, amount, reason, status, requested_at, notes)
    VALUES ($1, $2, $3, $4, 'requested', NOW(), $5)
    RETURNING *
  `;
  const params = [
    data.transaction_id || null,
    data.member_id,
    parseFloat(data.amount) || 0.00,
    data.reason,
    data.notes || ''
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

export async function processRefund(id, { status, notes, approved_by_user_id }) {
  const query = `
    UPDATE refund_requests
    SET 
      status = $1,
      notes = COALESCE($2, notes),
      approved_by_user_id = COALESCE($3, approved_by_user_id),
      processed_at = CASE WHEN $1 IN ('approved', 'processed') THEN NOW() ELSE processed_at END
    WHERE id = $4
    RETURNING *
  `;
  const { rows } = await pool.query(query, [status, notes || null, approved_by_user_id || null, id]);
  return rows[0] || null;
}

// ----------------------------------------------------
// 7. PROMOTIONAL DISCOUNTS & OFFERS
// ----------------------------------------------------

export async function getPromotionalDiscounts() {
  const query = 'SELECT * FROM promotional_discounts ORDER BY is_active DESC, end_date ASC';
  const { rows } = await pool.query(query);
  return rows;
}

export async function createPromotionalDiscount(data) {
  const query = `
    INSERT INTO promotional_discounts (
      code, description, discount_type, discount_value, min_purchase_amount,
      start_date, end_date, max_uses, times_used, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9)
    RETURNING *
  `;
  const params = [
    (data.code || 'PROMO').toUpperCase().trim(),
    data.description || '',
    data.discount_type || 'percentage',
    parseFloat(data.discount_value) || 10.00,
    parseFloat(data.min_purchase_amount) || 0.00,
    data.start_date || new Date().toISOString().slice(0, 10),
    data.end_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    parseInt(data.max_uses, 10) || 100,
    data.is_active !== undefined ? (data.is_active === true || data.is_active === 'true') : true
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 8. GYM OPERATING EXPENSE LEDGER
// ----------------------------------------------------

export async function getExpenses({ category, status, start_date, end_date } = {}) {
  let query = `SELECT * FROM gym_expenses WHERE ${REAL_EXPENSE}`;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  if (start_date) {
    params.push(start_date);
    query += ` AND expense_date >= $${params.length}`;
  }
  if (end_date) {
    params.push(end_date);
    query += ` AND expense_date <= $${params.length}`;
  }

  query += ' ORDER BY expense_date DESC';
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function createExpense(data) {
  const query = `
    INSERT INTO gym_expenses (category, title, vendor_name, amount, expense_date, payment_method, invoice_ref, status, notes, created_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const params = [
    data.category || 'Equipment Maintenance',
    data.title,
    data.vendor_name || 'Vendor',
    parseFloat(data.amount) || 0.00,
    data.expense_date || new Date().toISOString().slice(0, 10),
    data.payment_method || 'Bank Transfer',
    data.invoice_ref || null,
    data.status || 'paid',
    data.notes || '',
    data.created_by_user_id || null
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 9. TRAINER COMMISSIONS
// ----------------------------------------------------

export async function getTrainerCommissions({ period_month, trainer_id } = {}) {
  let query = `
    SELECT 
      tc.id,
      tc.trainer_id,
      t.full_name AS trainer_name,
      t.specialty AS trainer_specialty,
      tc.assignment_id,
      m.full_name AS client_name,
      tc.period_month,
      tc.gross_revenue,
      tc.commission_rate_pct,
      tc.commission_amount,
      tc.payout_status,
      tc.paid_at,
      tc.notes
    FROM trainer_commissions tc
    JOIN trainers t ON tc.trainer_id = t.id
    LEFT JOIN personal_trainer_assignments pta ON tc.assignment_id = pta.id
    LEFT JOIN members m ON pta.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (period_month) {
    params.push(period_month);
    query += ` AND tc.period_month = $${params.length}`;
  }
  if (trainer_id) {
    params.push(trainer_id);
    query += ` AND tc.trainer_id = $${params.length}`;
  }

  query += ` ORDER BY tc.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function calculateTrainerCommissionsForMonth(periodMonth = null) {
  const month = periodMonth || new Date().toISOString().slice(0, 7);

  // Retrieve active PT assignments with fees paid
  const query = `
    SELECT 
      pta.id AS assignment_id,
      pta.trainer_id,
      pta.fee_paid,
      pta.monthly_fee
    FROM personal_trainer_assignments pta
    WHERE pta.fee_paid > 0 AND pta.status = 'active'
  `;
  const { rows: assignments } = await pool.query(query);

  const inserted = [];
  for (const a of assignments) {
    const gross = parseFloat(a.fee_paid || a.monthly_fee || 0);
    const rate = 25.00; // 25% trainer commission
    const commission = Number(((gross * rate) / 100).toFixed(2));

    const insQuery = `
      INSERT INTO trainer_commissions (trainer_id, assignment_id, period_month, gross_revenue, commission_rate_pct, commission_amount, payout_status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, 'calculated', 'Monthly commission from active personal training assignment.')
      ON CONFLICT DO NOTHING
      RETURNING *
    `;
    const res = await pool.query(insQuery, [a.trainer_id, a.assignment_id, month, gross, rate, commission]);
    if (res.rows[0]) inserted.push(res.rows[0]);
  }
  return inserted;
}

// ----------------------------------------------------
// 10. MONTHLY REVENUE REPORTS & FINANCIAL ANALYTICS
// ----------------------------------------------------

export async function getMonthlyRevenueReports({ year } = {}) {
  // Only a 4-digit year is accepted (the value is used inside the SQL date literal below).
  const targetYear = /^\d{4}$/.test(String(year || '')) ? String(year) : new Date().getFullYear().toString();

  const query = `
    SELECT 
      TO_CHAR(d, 'YYYY-MM') AS month,
      COALESCE(inflows.gross_revenue, 0) AS gross_revenue,
      COALESCE(inflows.tax_collected, 0) AS tax_collected,
      COALESCE(refunds.total_refunds, 0) AS total_refunds,
      COALESCE(expenses.total_expenses, 0) AS total_expenses,
      (COALESCE(inflows.gross_revenue, 0) - COALESCE(refunds.total_refunds, 0) - COALESCE(expenses.total_expenses, 0)) AS net_profit
    FROM generate_series(
      DATE '${targetYear}-01-01', 
      DATE '${targetYear}-12-01', 
      INTERVAL '1 month'
    ) d
    LEFT JOIN (
      SELECT 
        TO_CHAR(transaction_date, 'YYYY-MM') AS m,
        SUM(net_amount) AS gross_revenue,
        SUM(tax_amount) AS tax_collected
      FROM financial_transactions
      WHERE payment_status = 'completed' AND ${REAL_TX()}
      GROUP BY TO_CHAR(transaction_date, 'YYYY-MM')
    ) inflows ON TO_CHAR(d, 'YYYY-MM') = inflows.m
    LEFT JOIN (
      SELECT 
        TO_CHAR(processed_at, 'YYYY-MM') AS m,
        SUM(amount) AS total_refunds
      FROM refund_requests
      WHERE status IN ('approved', 'processed')
      GROUP BY TO_CHAR(processed_at, 'YYYY-MM')
    ) refunds ON TO_CHAR(d, 'YYYY-MM') = refunds.m
    LEFT JOIN (
      SELECT 
        TO_CHAR(expense_date, 'YYYY-MM') AS m,
        SUM(amount) AS total_expenses
      FROM gym_expenses
      WHERE status = 'paid' AND ${REAL_EXPENSE}
      GROUP BY TO_CHAR(expense_date, 'YYYY-MM')
    ) expenses ON TO_CHAR(d, 'YYYY-MM') = expenses.m
    ORDER BY d ASC
  `;
  const { rows } = await pool.query(query);
  return rows;
}

// Sample rows inserted by database/migrations/014_finance_billing_expansion.sql (demo data, no member / no creator).
// They stay in the database (history is kept) but are hidden from the finance page: lists, KPI card and reports.
const SAMPLE_TX_INVOICES = ['INV-2026-0001', 'INV-2026-0002'];
const SAMPLE_EXPENSE_REFS = ['BILL-TITAN-889', 'RENT-2026-NOV', 'BESCOM-98441', 'GCP-INV-114', 'OPT-9921'];
const sqlList = (a) => a.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
/** SQL conditions (constants only, no user input) that exclude the migration sample rows. */
const REAL_TX = (alias = '') => `NOT (${alias}member_id IS NULL AND ${alias}invoice_number IN (${sqlList(SAMPLE_TX_INVOICES)}))`;
const REAL_EXPENSE = `NOT (created_by_user_id IS NULL AND invoice_ref IN (${sqlList(SAMPLE_EXPENSE_REFS)}))`;

export async function getFinancialAnalytics() {
  const statsQuery = `
    SELECT
      -- Inflows from financial transactions (migration sample rows excluded)
      (SELECT COALESCE(SUM(net_amount), 0) FROM financial_transactions WHERE payment_status = 'completed'
         AND NOT (member_id IS NULL AND invoice_number = ANY($1::text[]))) AS total_inflows,
      (SELECT COALESCE(SUM(tax_amount), 0) FROM financial_transactions WHERE payment_status = 'completed'
         AND NOT (member_id IS NULL AND invoice_number = ANY($1::text[]))) AS total_gst_tax,
      -- Outflows from expenses (migration sample rows excluded)
      (SELECT COALESCE(SUM(amount), 0) FROM gym_expenses WHERE status = 'paid'
         AND NOT (created_by_user_id IS NULL AND invoice_ref = ANY($2::text[]))) AS total_expenses,
      -- Refunds
      (SELECT COALESCE(SUM(amount), 0) FROM refund_requests WHERE status IN ('approved', 'processed')) AS total_refunds,
      -- Dues from members
      (SELECT COALESCE(SUM(fee_due), 0) FROM members) AS total_outstanding_dues,
      (SELECT COUNT(*) FROM members WHERE fee_due > 0) AS total_defaulters_count,
      -- Membership package totals
      (SELECT COUNT(*) FROM membership_plans WHERE is_active = true) AS active_plans_count,
      -- Commissions
      (SELECT COALESCE(SUM(commission_amount), 0) FROM trainer_commissions) AS total_commissions
  `;
  const { rows } = await pool.query(statsQuery, [SAMPLE_TX_INVOICES, SAMPLE_EXPENSE_REFS]);
  const row = rows[0] || {};

  const totalInflows = parseFloat(row.total_inflows) || 0.00;
  const totalExpenses = parseFloat(row.total_expenses) || 0.00;
  const totalRefunds = parseFloat(row.total_refunds) || 0.00;
  const netProfit = totalInflows - totalRefunds - totalExpenses;
  const netMarginPct = totalInflows > 0 ? Number(((netProfit / totalInflows) * 100).toFixed(1)) : 0.0;

  return {
    totalRevenue: totalInflows,
    totalTaxGst: parseFloat(row.total_gst_tax) || 0.00,
    totalOperatingExpenses: totalExpenses,
    totalRefundsProcessed: totalRefunds,
    netOperatingProfit: netProfit,
    netProfitMarginPct: netMarginPct,
    totalOutstandingDues: parseFloat(row.total_outstanding_dues) || 0.00,
    totalDefaultersCount: parseInt(row.total_defaulters_count, 10) || 0,
    activePlansCount: parseInt(row.active_plans_count, 10) || 0,
    totalTrainerCommissions: parseFloat(row.total_commissions) || 0.00
  };
}
