/**
 * financeDelete.controller.js — delete one payment (money in) or one expense (money out) from
 * Admin → Billing & Expenses. Owner / manager only.
 *
 *   DELETE /api/v1/admin/finance/transactions/:id
 *   DELETE /api/v1/admin/finance/expenses/:id
 *
 * A full copy of the deleted row is written to auth_audit_logs (PAYMENT_DELETED / EXPENSE_DELETED) so the
 * action stays traceable. Deleting a member's MEMBERSHIP fee payment also undoes it on the member's fee
 * (fee_paid goes down, fee_due goes back up), so Fees Alert stays correct. Refund requests that pointed at
 * the payment are unlinked by their foreign key (ON DELETE SET NULL).
 */
import { withTransaction } from '../config/database.js';

const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const audit = (c, req, event, details) => c.query(
  `INSERT INTO auth_audit_logs (user_id, username, event_type, role, details) VALUES ($1, $2, $3, $4, $5)`,
  [req.user?.id || null, req.user?.username || null, event, req.user?.role || null, JSON.stringify(details)]);

export async function deleteTransaction(req, res, next) {
  try {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid payment.' });
    const out = await withTransaction(async (c) => {
      const t = (await c.query('SELECT * FROM financial_transactions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!t) return null;
      let member = null;
      if (t.member_id && t.transaction_type === 'membership' && ['completed', 'paid', 'success'].includes(String(t.payment_status || '').toLowerCase())) {
        const amt = Number(t.net_amount ?? t.amount) || 0;
        member = (await c.query(
          `UPDATE members
              SET fee_paid = GREATEST(0, COALESCE(fee_paid, 0) - $1),
                  fee_due  = LEAST(COALESCE(fee_amount, 0), GREATEST(0, COALESCE(fee_amount, 0) - GREATEST(0, COALESCE(fee_paid, 0) - $1))),
                  payment_status = CASE WHEN GREATEST(0, COALESCE(fee_paid, 0) - $1) >= COALESCE(fee_amount, 0) THEN 'paid'
                                        WHEN GREATEST(0, COALESCE(fee_paid, 0) - $1) > 0 THEN 'partial' ELSE 'pending' END,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, full_name, fee_amount, fee_paid, fee_due, payment_status`, [amt, t.member_id])).rows[0] || null;
      }
      await c.query('DELETE FROM financial_transactions WHERE id = $1', [id]);
      await audit(c, req, 'PAYMENT_DELETED', { transaction: t, memberFeeAfter: member });
      return { t, member };
    });
    if (!out) return res.status(404).json({ success: false, error: 'Payment not found.' });
    res.json({ success: true, message: out.member ? `Payment deleted. ${out.member.full_name}'s fee is updated (₹${Number(out.member.fee_due)} due).` : 'Payment deleted.', data: { id, memberFee: out.member } });
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid expense.' });
    const row = await withTransaction(async (c) => {
      const e = (await c.query('SELECT * FROM gym_expenses WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!e) return null;
      await c.query('DELETE FROM gym_expenses WHERE id = $1', [id]);
      await audit(c, req, 'EXPENSE_DELETED', { expense: e });
      return e;
    });
    if (!row) return res.status(404).json({ success: false, error: 'Expense not found.' });
    res.json({ success: true, message: `Expense “${row.title}” deleted.`, data: { id } });
  } catch (err) { next(err); }
}
