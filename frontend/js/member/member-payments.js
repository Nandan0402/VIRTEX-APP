/** Virtex Member Portal — member-payments.html: the member's own payment history.
 *  Data: GET /api/v1/member/payments (financial_transactions for this member only + refund state).
 *  Statuses, amounts and references are shown exactly as recorded by the gym.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';
import { money, fmtDate, statusPill, label, pager, NONE, PAY_AT_DESK } from './member-billing-utils.js';

/** A receipt number is only meaningful once the gym has recorded the payment as completed. */
const isPaid = (p) => ['completed', 'paid', 'success'].includes(String(p.payment_status || '').toLowerCase());

const shell = await initShell({ page: 'payments', title: 'Payments', subtitle: 'Your payment history with the gym' });

if (shell) {
  const { content } = shell;
  let page = 1;
  content.innerHTML = '<div class="mp-muted mp-loading">Loading your payments…</div>';

  async function load() {
    try {
      const res = await api.get('/payments', { page, limit: 15 });
      const t = res.totals;
      const tiles = `<div class="bl-tiles">
        <div class="bl-tile"><span>Total paid</span><b>${money(t.total_paid)}</b><small>Completed payments only</small></div>
        <div class="bl-tile"><span>Transactions</span><b>${esc(t.transactions)}</b><small>All statuses</small></div>
        <div class="bl-tile"><span>Last payment</span><b>${t.last_payment_at ? fmtDate(t.last_payment_at) : NONE}</b></div>
      </div>`;
      const table = res.data.length
        ? `<div class="table-responsive"><table class="admin-table bl-table"><thead><tr>
            <th>Payment date</th><th>Description</th><th>Amount</th><th>Status</th><th>Method</th><th>Reference</th><th></th></tr></thead><tbody>
          ${res.data.map((p) => `<tr>
            <td>${fmtDate(p.transaction_date)}</td>
            <td>${label(p.transaction_type)}</td>
            <td class="bl-num">${money(p.net_amount)}${Number(p.tax_amount) ? `<div class="bl-sub">incl. tax ${money(p.tax_amount)}</div>` : ''}${Number(p.discount_amount) ? `<div class="bl-sub">discount ${money(p.discount_amount)}</div>` : ''}</td>
            <td>${statusPill(p.payment_status)}${p.refund ? `<div class="bl-sub">Refund ${statusPill(p.refund.status)} ${money(p.refund.amount)}</div>` : ''}</td>
            <td>${label(p.payment_method)}</td>
            <td class="bl-mono">${isPaid(p) && p.receipt_number ? `<div title="Receipt number">${esc(p.receipt_number)}</div>` : ''}${p.invoice_number ? `<div class="${isPaid(p) && p.receipt_number ? 'bl-sub' : ''}" title="Invoice number">${esc(p.invoice_number)}</div>` : ''}${!p.invoice_number && !(isPaid(p) && p.receipt_number) ? NONE : ''}</td>
            <td>${p.invoice_number ? `<a class="btn btn-outline" href="member-invoices.html?id=${encodeURIComponent(p.id)}">Invoice</a>` : ''}</td>
          </tr>`).join('')}</tbody></table></div><div class="bl-pager" id="bl-pager"></div>`
        : emptyState('No payments recorded yet', 'Payments you make at the gym appear here once the front desk records them.');
      content.innerHTML = `${tiles}<section class="card bl-section"><div class="bl-head"><h2>Payment history</h2></div>${table}</section>
        <div class="bl-desk">🏢 ${esc(PAY_AT_DESK)}</div>`;
      const pg = content.querySelector('#bl-pager');
      if (pg) pager(pg, res.pagination, (n) => { page = n; load(); });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your payments', err.message || 'Unexpected error.', { error: true });
    }
  }
  load();
}
