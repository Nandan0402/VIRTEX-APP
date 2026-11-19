/** Virtex Member Portal — member-invoices.html: invoice list, invoice details, download, payment receipt.
 *  Data: GET /api/v1/member/invoices and /api/v1/member/invoices/:id (own records only).
 *  "Download" prints the invoice view (save as PDF from the browser's print dialog). A receipt is shown
 *  only when the gym has recorded the payment as completed AND issued a receipt number.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';
import { money, fmtDate, statusPill, label, pager, NONE } from './member-billing-utils.js';

const shell = await initShell({ page: 'invoices', title: 'Invoices & Receipts', subtitle: 'Your tax invoices and payment receipts' });

function invoiceDoc(inv) {
  const g = inv.gym || {};
  const b = inv.billedTo || {};
  const t = inv.totals;
  const rate = t.subtotal ? (t.tax / Math.max(t.subtotal - t.discount, 0.01)) * 100 : null;
  return `<article class="bl-invoice" id="bl-invoice" aria-label="Invoice ${esc(inv.invoiceNumber)}">
    <header class="bl-inv-head">
      <div><div class="bl-inv-gym">${g.gym_name ? esc(g.gym_name) : 'Virtex Fitness'}</div>
        ${g.address ? `<div>${esc(g.address)}</div>` : ''}<div>${[g.phone, g.email].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="bl-inv-title"><h2>Tax Invoice</h2><div class="bl-mono">${esc(inv.invoiceNumber)}</div><div>${fmtDate(inv.date, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div>
    </header>
    <section class="bl-inv-parties"><div><h3>Billed to</h3><div><b>${esc(b.name || '')}</b></div>
      <div class="bl-mono">${esc(b.code || '')}</div>${b.email ? `<div>${esc(b.email)}</div>` : ''}${b.phone ? `<div>${esc(b.phone)}</div>` : ''}</div>
      <div><h3>Payment</h3><div>Status: ${statusPill(inv.paymentStatus)}</div><div>Method: ${label(inv.paymentMethod)}</div>${b.plan ? `<div>Plan: ${esc(b.plan)}</div>` : ''}</div></section>
    <table class="bl-inv-table"><thead><tr><th>Description</th><th>Amount</th><th>Discount</th><th>Taxable</th><th>Tax${rate !== null && Number.isFinite(rate) && t.tax ? ` (${rate.toFixed(0)}%)` : ''}</th><th>Total</th></tr></thead><tbody>
      ${inv.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${money(l.amount)}</td><td>${money(l.discount)}</td><td>${money(l.taxable)}</td><td>${money(l.tax)}</td><td><b>${money(l.total)}</b></td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="5">Total</td><td><b>${money(t.total)}</b></td></tr></tfoot></table>
    ${inv.receipt ? `<section class="bl-receipt"><h3>✅ Payment receipt</h3>
        <div class="bl-receipt-grid"><div><span>Receipt no.</span><b class="bl-mono">${esc(inv.receipt.receiptNumber)}</b></div>
        <div><span>Paid on</span><b>${fmtDate(inv.receipt.paidAt)}</b></div><div><span>Method</span><b>${label(inv.receipt.method)}</b></div>
        <div><span>Amount received</span><b>${money(inv.receipt.amount)}</b></div></div></section>`
      : `<section class="bl-receipt bl-receipt-none"><h3>Payment receipt</h3><p>A receipt is issued once the gym records this payment as completed. Current status: ${statusPill(inv.paymentStatus)}</p></section>`}
    <footer class="bl-inv-foot">Computer-generated from the gym's billing records. ${g.gym_name ? esc(g.gym_name) : ''}</footer>
  </article>`;
}

if (shell) {
  const { content } = shell;
  let page = 1;
  const params = new URLSearchParams(location.search);

  async function showInvoice(id) {
    const detail = content.querySelector('#bl-detail');
    detail.innerHTML = '<div class="mp-muted mp-loading">Loading invoice…</div>';
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const inv = (await api.get(`/invoices/${encodeURIComponent(id)}`)).data;
      detail.innerHTML = `<div class="bl-detail-actions no-print">
          <button class="btn btn-green" id="bl-print">⬇ Download / print (PDF)</button>
          <button class="btn btn-outline" id="bl-close">Close</button></div>${invoiceDoc(inv)}`;
      history.replaceState(null, '', `member-invoices.html?id=${encodeURIComponent(id)}`);
      content.querySelectorAll('.bl-inv-row').forEach((r) => r.classList.toggle('is-selected', r.dataset.id === String(id)));
      detail.querySelector('#bl-print').addEventListener('click', () => {
        const prev = document.title;
        document.title = `Invoice ${inv.invoiceNumber}`;          // default PDF file name
        window.print();
        document.title = prev;
      });
      detail.querySelector('#bl-close').addEventListener('click', () => {
        detail.innerHTML = ''; history.replaceState(null, '', 'member-invoices.html');
        content.querySelectorAll('.bl-inv-row').forEach((r) => r.classList.remove('is-selected'));
      });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) detail.innerHTML = notice(err.status === 404 ? 'Invoice not found' : 'Could not load the invoice', err.status === 404 ? 'This invoice does not exist on your account.' : err.message, { error: true });
    }
  }

  async function load() {
    content.innerHTML = '<div class="mp-muted mp-loading">Loading your invoices…</div>';
    try {
      const res = await api.get('/invoices', { page, limit: 15 });
      const list = res.data.length
        ? `<div class="table-responsive"><table class="admin-table bl-table"><thead><tr><th>Invoice</th><th>Date</th><th>Description</th><th>Total</th><th>Status</th><th>Receipt</th><th></th></tr></thead><tbody>
          ${res.data.map((i) => `<tr class="bl-inv-row" data-id="${esc(i.id)}"><td class="bl-mono">${esc(i.invoice_number)}</td><td>${fmtDate(i.transaction_date)}</td><td>${label(i.transaction_type)}</td>
            <td class="bl-num">${money(i.net_amount)}</td><td>${statusPill(i.payment_status)}</td>
            <td>${i.receipt_number && ['completed', 'paid', 'success'].includes(String(i.payment_status).toLowerCase()) ? `<span class="bl-mono">${esc(i.receipt_number)}</span>` : '<span class="bl-none">Not issued</span>'}</td>
            <td><button class="btn btn-outline" data-open="${esc(i.id)}">View</button></td></tr>`).join('')}</tbody></table></div><div class="bl-pager" id="bl-pager"></div>`
        : emptyState('No invoices yet', 'Tax invoices issued by the gym for your payments appear here.');
      content.innerHTML = `<section class="card bl-section no-print"><div class="bl-head"><h2>Invoices</h2></div>${list}</section><div id="bl-detail" class="bl-detail"></div>`;
      content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => showInvoice(b.dataset.open)));
      const pg = content.querySelector('#bl-pager');
      if (pg) pager(pg, res.pagination, (n) => { page = n; load(); });
      if (params.get('id')) { showInvoice(params.get('id')); params.delete('id'); }
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your invoices', err.message || 'Unexpected error.', { error: true });
    }
  }
  load();
}
