/**
 * feeStatus.controller.js — fee countdowns and the trainer gym-welfare share (migration 031).
 *
 *  Member  GET  /api/v1/member/fee-status          own fee countdown (alert from 7 days before the due date
 *                                                  until the admin records the payment), gender, plan + weekly planner
 *  Trainer GET  /api/v1/trainer/welfare            own gym-welfare share for this month (welfare_percent, default 20%,
 *                                                  of the monthly fees of the trainer's active PT clients), due on the
 *                                                  last day of the month; alert from 7 days before until recorded
 *  Admin   GET  /api/v1/admin/trainer-welfare      every trainer's share for a month (?month=YYYY-MM, default this month)
 *          POST /api/v1/admin/trainer-welfare/:trainerId/pay   record it → the trainer's alert disappears (audited)
 *
 * All SQL is parameterised; members/trainers only ever see their own row.
 */
import { query, withTransaction } from '../config/database.js';

const ALERT_DAYS = 7;
// Trainer welfare shares exist from the month the feature was switched on (migration 031, Nov 2026);
// earlier months are never owed.
const WELFARE_START = '2026-11-01';
const DAY_MS = 86400000;
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Whole days from today (gym local date from PostgreSQL) to a date. */
async function todayIso() {
  return (await query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS d`)).rows[0].d;
}
const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);

// ---------------------------------------------------------------- member

export async function memberFeeStatus(req, res, next) {
  try {
    const m = (await query(
      `SELECT m.id, m.full_name, m.status, m.gender, m.plan_name, m.fee_amount, m.fee_paid, m.fee_due,
              to_char(m.fee_due_date, 'YYYY-MM-DD') AS fee_due_date,
              mp.id AS plan_id, mp.name AS plan_title, mp.price_inr, mp.duration_months, mp.audience, mp.weekly_schedule
         FROM members m
         LEFT JOIN membership_plans mp ON mp.id = m.plan_id OR (m.plan_id IS NULL AND LOWER(mp.name) = LOWER(m.plan_name))
        WHERE m.id = $1
        ORDER BY (mp.id = m.plan_id) DESC NULLS LAST
        LIMIT 1`, [req.memberId])).rows[0];
    if (!m) return res.status(404).json({ success: false, error: 'Member not found.' });
    const today = await todayIso();
    const due = Number(m.fee_due) || 0;
    const daysLeft = due > 0 && m.fee_due_date ? daysBetween(today, m.fee_due_date) : null;
    let state = 'paid';
    if (due > 0) state = daysLeft === null ? 'due' : daysLeft < 0 ? 'overdue' : daysLeft <= ALERT_DAYS ? 'due_soon' : 'upcoming';
    res.json({
      success: true,
      data: {
        gender: m.gender || null,
        fee: {
          amount: Number(m.fee_amount) || 0, paid: Number(m.fee_paid) || 0, due,
          dueDate: m.fee_due_date, daysLeft, state,
          // The countdown card shows from 7 days before the due date (and while overdue) until the payment is recorded.
          showAlert: state === 'due_soon' || state === 'overdue' || state === 'due',
        },
        plan: m.plan_id ? {
          id: m.plan_id, name: m.plan_title, priceInr: Number(m.price_inr), durationMonths: m.duration_months,
          audience: m.audience || 'all', weeklySchedule: m.weekly_schedule || {},
        } : (m.plan_name ? { id: null, name: m.plan_name, audience: 'all', weeklySchedule: {} } : null),
      },
    });
  } catch (err) { next(err); }
}

// ---------------------------------------------------------------- trainer welfare share

/** The month a welfare share belongs to: { month: 'YYYY-MM-01', dueDate: last day of month }. */
async function monthInfo(monthParam) {
  const m = typeof monthParam === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? `${monthParam}-01` : null;
  const r = (await query(
    `SELECT to_char(d, 'YYYY-MM-DD') AS month, to_char((d + INTERVAL '1 month - 1 day')::date, 'YYYY-MM-DD') AS due_date
       FROM (SELECT date_trunc('month', COALESCE($1::date, CURRENT_DATE))::date AS d) x`, [m])).rows[0];
  return { month: r.month, dueDate: r.due_date };
}

/** Trainers with their PT base (sum of active clients' monthly fees), share and payment for the month. */
async function welfareRows(month, trainerId = null) {
  // Base = monthly fees of the trainer's active PT clients whose training had started by the end of that month.
  const rows = (await query(
    `SELECT t.id, t.full_name, t.trainer_code, t.welfare_percent,
            COALESCE((SELECT SUM(pa.monthly_fee) FROM personal_trainer_assignments pa WHERE pa.trainer_id = t.id AND pa.status = 'active'
                        AND COALESCE(pa.start_date, CURRENT_DATE) <= ($1::date + INTERVAL '1 month - 1 day')::date), 0)::numeric(12,2) AS base,
            (SELECT COUNT(*) FROM personal_trainer_assignments pa WHERE pa.trainer_id = t.id AND pa.status = 'active'
                AND COALESCE(pa.start_date, CURRENT_DATE) <= ($1::date + INTERVAL '1 month - 1 day')::date)::int AS clients,
            w.id AS payment_id, w.amount AS paid_amount, w.paid_at, w.payment_method
       FROM trainers t
       LEFT JOIN trainer_welfare_payments w ON w.trainer_id = t.id AND w.period_month = $1::date
      WHERE ($2::int IS NULL OR t.id = $2)
      ORDER BY t.full_name`, [month, trainerId])).rows;
  const before = month < WELFARE_START;
  return rows.map((r) => {
    const percent = Number(r.welfare_percent);
    const base = before ? 0 : Number(r.base);
    return {
      trainerId: r.id, name: r.full_name, code: r.trainer_code, clients: r.clients, percent, base,
      amount: Math.round(base * percent) / 100,
      paid: !!r.payment_id, paidAmount: r.paid_amount === null ? null : Number(r.paid_amount), paidAt: r.paid_at, paymentMethod: r.payment_method,
    };
  });
}

function withCountdown(row, info, today) {
  const daysLeft = daysBetween(today, info.dueDate);
  const owes = row.amount > 0 && !row.paid;
  return { ...row, month: info.month, dueDate: info.dueDate, daysLeft, overdue: owes && daysLeft < 0, showAlert: owes && daysLeft <= ALERT_DAYS };
}

export async function trainerWelfare(req, res, next) {
  try {
    const info = await monthInfo(null);
    const today = await todayIso();
    const [row] = await welfareRows(info.month, req.trainerId);
    if (!row) return res.status(404).json({ success: false, error: 'Trainer profile not found.' });
    // Last month still unpaid → keep showing it as overdue first.
    const prev = await monthInfo(new Date(Date.parse(`${info.month}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 7));
    const [prow] = await welfareRows(prev.month, req.trainerId);
    const prevC = prow ? withCountdown(prow, prev, today) : null;
    res.json({ success: true, data: { current: withCountdown(row, info, today), previousUnpaid: prevC && prevC.amount > 0 && !prevC.paid ? prevC : null } });
  } catch (err) { next(err); }
}

export async function adminWelfareList(req, res, next) {
  try {
    const info = await monthInfo(req.query.month);
    const today = await todayIso();
    const rows = (await welfareRows(info.month)).map((r) => withCountdown(r, info, today));
    res.json({
      success: true,
      data: {
        month: info.month, dueDate: info.dueDate, trainers: rows,
        totals: { due: rows.filter((r) => !r.paid).reduce((n, r) => n + r.amount, 0), collected: rows.filter((r) => r.paid).reduce((n, r) => n + (r.paidAmount || 0), 0) },
      },
    });
  } catch (err) { next(err); }
}

const METHODS = ['Cash', 'UPI / QR', 'Card', 'Bank Transfer'];
export async function adminWelfarePay(req, res, next) {
  try {
    const trainerId = Number(req.params.trainerId);
    if (!Number.isInteger(trainerId) || trainerId <= 0) return res.status(400).json({ success: false, error: 'Invalid trainer.' });
    const info = await monthInfo(req.body?.month);
    const method = METHODS.includes(req.body?.paymentMethod) ? req.body.paymentMethod : 'Cash';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 300) || null : null;
    const [row] = await welfareRows(info.month, trainerId);
    if (!row) return res.status(404).json({ success: false, error: 'Trainer not found.' });
    let amount = row.amount;
    if (req.body?.amount !== undefined && req.body.amount !== '') {
      amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return res.status(400).json({ success: false, error: 'Enter a valid amount.' });
      amount = Math.round(amount * 100) / 100;
    }
    const saved = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO trainer_welfare_payments (trainer_id, trainer_name, period_month, base_amount, percent, amount, payment_method, notes, recorded_by)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (trainer_id, period_month) DO NOTHING
         RETURNING id, period_month, amount, paid_at`,
        [trainerId, row.name, info.month, row.base, row.percent, amount, method, notes, req.user?.id || null]);
      if (!ins.rows[0]) return null;
      await client.query(
        `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, 'TRAINER_WELFARE_PAID', $3, $4)`,
        [req.user?.id || null, req.user?.username || null, req.user?.role || null,
          JSON.stringify({ trainerId, trainer: row.name, month: info.month, base: row.base, percent: row.percent, amount, method })]);
      return ins.rows[0];
    });
    if (!saved) return res.status(409).json({ success: false, error: `${row.name}'s share for this month is already recorded.` });
    res.status(201).json({ success: true, message: `Recorded ₹${amount} from ${row.name}.`, data: { ...saved, month: iso(saved.period_month) } });
  } catch (err) { next(err); }
}
