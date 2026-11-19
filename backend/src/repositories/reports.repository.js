/**
 * reports.repository.js — simple month-by-month business numbers for Admin → Reports.
 * Leads (member_enquiries), amount collected (financial_transactions), new members, new trainers,
 * plus today's head-counts of members, personal trainers and general trainers.
 *
 * "Personal trainer" = a trainer with at least one active/paused personal-training client
 * (personal_trainer_assignments); every other trainer counts as a "general" (floor) trainer.
 */
import { query } from '../config/database.js';

// Ledger rows that are real money in (not refunded / failed / still pending).
const MONEY_IN = `COALESCE(t.payment_status, 'completed') NOT IN ('failed', 'refunded', 'cancelled', 'pending', 'voided')`;

/** One row per month from `fromMonth` (a DATE, first of month) to the current month. */
export async function monthlySeries(fromMonth) {
  const r = await query(
    `WITH months AS (
       SELECT generate_series(date_trunc('month', $1::date), date_trunc('month', CURRENT_DATE), interval '1 month')::date AS m
     )
     SELECT to_char(months.m, 'YYYY-MM') AS month,
            (SELECT COALESCE(SUM(COALESCE(t.net_amount, t.amount)), 0)::numeric(14,2) FROM financial_transactions t
              WHERE t.transaction_date >= months.m AND t.transaction_date < months.m + interval '1 month' AND ${MONEY_IN}) AS amount,
            (SELECT COUNT(*)::int FROM financial_transactions t
              WHERE t.transaction_date >= months.m AND t.transaction_date < months.m + interval '1 month' AND ${MONEY_IN}) AS payments,
            (SELECT COUNT(*)::int FROM member_enquiries e WHERE e.created_at >= months.m AND e.created_at < months.m + interval '1 month') AS leads,
            (SELECT COUNT(*)::int FROM member_enquiries e WHERE e.created_at >= months.m AND e.created_at < months.m + interval '1 month' AND e.status = 'converted') AS leads_converted,
            (SELECT COUNT(*)::int FROM members mb WHERE mb.created_at >= months.m AND mb.created_at < months.m + interval '1 month') AS new_members,
            (SELECT COUNT(*)::int FROM trainers tr WHERE tr.created_at >= months.m AND tr.created_at < months.m + interval '1 month') AS new_trainers,
            (SELECT COUNT(*)::int FROM personal_trainer_assignments a WHERE a.start_date >= months.m AND a.start_date < months.m + interval '1 month') AS new_pt_clients
       FROM months
      ORDER BY months.m`,
    [fromMonth]
  );
  return r.rows.map((x) => ({ ...x, amount: Number(x.amount) }));
}

/** Head-counts right now. */
export async function snapshot() {
  const r = await query(
    `WITH pt AS (
       SELECT DISTINCT trainer_id FROM personal_trainer_assignments WHERE status IN ('active', 'paused')
     )
     SELECT (SELECT COUNT(*)::int FROM members) AS members_total,
            (SELECT COUNT(*)::int FROM members WHERE status = 'active') AS members_active,
            (SELECT COUNT(*)::int FROM trainers) AS trainers_total,
            (SELECT COUNT(*)::int FROM trainers WHERE id IN (SELECT trainer_id FROM pt)) AS personal_trainers,
            (SELECT COUNT(*)::int FROM trainers WHERE id NOT IN (SELECT trainer_id FROM pt)) AS general_trainers,
            (SELECT COUNT(DISTINCT member_id)::int FROM personal_trainer_assignments WHERE status IN ('active', 'paused')) AS pt_clients,
            (SELECT COUNT(*)::int FROM member_enquiries WHERE status IN ('new', 'contacted')) AS open_leads`
  );
  return r.rows[0];
}
