/**
 * billingSimple.js — Admin → Billing & Expenses, simplified for a small gym (admin-finance-billing.html).
 *   Money in  : GET  /api/v1/admin/finance/transactions/all   (fee payments recorded on Fees Alert appear here too)
 *               POST /api/v1/admin/finance/transactions       (+ Add income)
 *   Money out : GET  /api/v1/admin/finance/expenses/all?start_date&end_date
 *               POST /api/v1/admin/finance/expenses           (+ Add expense)
 *   Profit    = money in − money out for the chosen month. Nothing is deleted from this page.
 */
import { adminApi } from './adminApi.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = (v) => (String(v).length === 10 ? String(v) : ymd(new Date(v)));
const TYPE = { membership: 'Membership fee', personal_training: 'Personal training fee', pt_package: 'PT package', admission: 'Admission fee', app_fee: 'App fee', other: 'Other income' };

const now = new Date();
const view = { year: now.getFullYear(), month: now.getMonth() };

async function call(path, opts = {}) {
  const res = await fetch(`/api/v1/admin/finance${path}`, { ...opts, headers: adminApi.getHeaders(true) });
  if (res.status === 401) { adminApi.redirectToLogin(); throw new Error('Please sign in again.'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(j.error || j.message || `Request failed (${res.status})`);
  return j;
}

function dateCell(v) {
  const d = new Date(`${localDay(v)}T00:00:00`);
  return `<span class="bs-date"><b>${d.getDate()}</b>${d.toLocaleDateString(undefined, { month: 'short' })}</span>`;
}

async function load() {
  const first = new Date(view.year, view.month, 1);
  const last = new Date(view.year, view.month + 1, 0);
  const from = ymd(first); const to = ymd(last);
  $('bs-month-label').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('bs-in-list').innerHTML = '<p class="bs-muted">Loading…</p>'; $('bs-out-list').innerHTML = '<p class="bs-muted">Loading…</p>';
  try {
    const [tx, ex] = await Promise.all([
      call('/transactions/all').then((j) => j.data || []),
      call(`/expenses/all?start_date=${from}&end_date=${to}`).then((j) => j.data || []),
    ]);
    const ins = tx.filter((t) => ['completed', 'paid', 'success'].includes(String(t.payment_status || 'completed').toLowerCase()))
      .filter((t) => { const d = localDay(t.transaction_date); return d >= from && d <= to; })
      .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));
    const outs = ex.filter((e) => String(e.status || 'paid').toLowerCase() !== 'cancelled').sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
    const totalIn = ins.reduce((n, t) => n + (Number(t.net_amount ?? t.amount) || 0), 0);
    const totalOut = outs.reduce((n, e) => n + (Number(e.amount) || 0), 0);
    const profit = totalIn - totalOut;
    $('bs-in').textContent = money(totalIn); $('bs-in-n').textContent = `${ins.length} payment${ins.length === 1 ? '' : 's'}`;
    $('bs-out').textContent = money(totalOut); $('bs-out-n').textContent = `${outs.length} expense${outs.length === 1 ? '' : 's'}`;
    $('bs-profit').textContent = `${profit < 0 ? '−' : ''}${money(Math.abs(profit))}`;
    $('bs-profit-label').textContent = profit < 0 ? '📉 Loss' : '📈 Profit';
    $('bs-profit').parentElement.classList.toggle('loss', profit < 0);

    $('bs-in-list').innerHTML = ins.length
      ? `<ul class="bs-list">${ins.map((t) => `<li class="bs-row">${dateCell(t.transaction_date)}
          <span class="bs-what"><b>${esc(t.member_name || TYPE[t.transaction_type] || 'Income')}</b>
            <small>${esc(TYPE[t.transaction_type] || t.transaction_type || 'Income')} · ${esc(t.payment_method || '')}${t.notes && !t.member_name ? ` · ${esc(t.notes)}` : ''}</small></span>
          <span class="bs-amt in">+${money(t.net_amount ?? t.amount)}</span>
          <button type="button" class="bs-del" data-del="tx" data-id="${t.id}" data-what="${esc(t.member_name ? `${t.member_name} — ${TYPE[t.transaction_type] || 'payment'}` : (t.notes || TYPE[t.transaction_type] || 'Income'))}" data-amt="${esc(money(t.net_amount ?? t.amount))}" data-fee="${t.member_id && t.transaction_type === 'membership' ? '1' : ''}" aria-label="Delete this payment" title="Delete">🗑</button></li>`).join('')}</ul>`
      : '<p class="bs-empty">No money received this month yet.</p>';
    $('bs-out-list').innerHTML = outs.length
      ? `<ul class="bs-list">${outs.map((e) => `<li class="bs-row">${dateCell(e.expense_date)}
          <span class="bs-what"><b>${esc(e.title)}</b><small>${esc(e.category || '')}${e.payment_method ? ` · ${esc(e.payment_method)}` : ''}</small></span>
          <span class="bs-amt out">−${money(e.amount)}</span>
          <button type="button" class="bs-del" data-del="ex" data-id="${e.id}" data-what="${esc(e.title)}" data-amt="${esc(money(e.amount))}" aria-label="Delete this expense" title="Delete">🗑</button></li>`).join('')}</ul>`
      : '<p class="bs-empty">No expenses this month.</p>';
  } catch (err) {
    $('bs-in-list').innerHTML = `<p class="bs-err">${esc(err.message)}</p>`; $('bs-out-list').innerHTML = '';
  }
}

// ---- delete (centred confirm popup)
function confirmBox(title, message, okText) {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'bs-back';
    back.innerHTML = `<div class="bs-box" role="dialog" aria-modal="true" aria-labelledby="bs-cf-t"><h3 id="bs-cf-t">${esc(title)}</h3>
      <p>${message}</p><div class="bs-btns"><button type="button" class="btn btn-outline" data-x="no">Cancel</button>
      <button type="button" class="btn bs-danger" data-x="yes">${esc(okText)}</button></div></div>`;
    const done = (v) => { document.removeEventListener('keydown', key); back.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(false); };
    back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('[data-x="no"]')) done(false); else if (e.target.closest('[data-x="yes"]')) done(true); });
    document.addEventListener('keydown', key); document.body.appendChild(back); back.querySelector('[data-x="no"]').focus();
  });
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del]'); if (!b) return;
  const tx = b.dataset.del === 'tx';
  const msg = `Delete <b>${esc(b.dataset.what)}</b> (${esc(b.dataset.amt)})?${tx && b.dataset.fee ? '<br><br>This is a membership fee payment: the member’s fee will show this amount as <b>due again</b> on Fees Alert.' : ''}<br><br>A copy is kept in the audit log.`;
  if (!(await confirmBox(tx ? '🗑 Delete payment' : '🗑 Delete expense', msg, 'Delete'))) return;
  b.disabled = true;
  try { const r = await call(`/${tx ? 'transactions' : 'expenses'}/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' }); toast(r.message || 'Deleted.'); await load(); }
  catch (err) { b.disabled = false; toast(err.message, true); }
});
function toast(msg, error = false) {
  const n = document.createElement('div'); n.setAttribute('role', 'status');
  n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9999;padding:.7rem 1rem;border-radius:10px;font-weight:700;font-size:.88rem;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
  n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3500);
}

function toggleForm(kind, show) {
  const f = $(kind === 'income' ? 'bs-income-form' : 'bs-expense-form');
  f.hidden = !show;
  if (show) { f.reset(); if (kind === 'expense') f.date.value = ymd(new Date()); f.querySelector('.bs-err').textContent = ''; f.querySelector('input, select').focus(); }
}
document.addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'); if (o) toggleForm(o.dataset.open, true);
  const c = e.target.closest('[data-close]'); if (c) toggleForm(c.dataset.close, false);
});

$('bs-income-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = f.querySelector('.bs-err');
  const amount = Number(f.amount.value);
  if (!(amount > 0)) { err.textContent = 'Enter an amount.'; return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await call('/transactions', { method: 'POST', body: JSON.stringify({ transaction_type: f.type.value, amount, payment_method: f.method.value, payment_status: 'completed', notes: f.notes.value.trim() || null }) });
    toggleForm('income', false); view.year = now.getFullYear(); view.month = now.getMonth(); await load();
  } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
});

$('bs-expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const err = f.querySelector('.bs-err');
  const amount = Number(f.amount.value);
  if (!f.title.value.trim()) { err.textContent = 'Say what the expense was.'; return; }
  if (!(amount > 0)) { err.textContent = 'Enter an amount.'; return; }
  if (!f.date.value) { err.textContent = 'Choose the date.'; return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    await call('/expenses', { method: 'POST', body: JSON.stringify({ title: f.title.value.trim(), category: f.category.value, amount, expense_date: f.date.value, payment_method: f.method.value, status: 'paid' }) });
    const d = new Date(`${f.date.value}T00:00:00`); view.year = d.getFullYear(); view.month = d.getMonth();
    toggleForm('expense', false); await load();
  } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
});

$('bs-prev').addEventListener('click', () => { view.month--; if (view.month < 0) { view.month = 11; view.year--; } load(); });
$('bs-next').addEventListener('click', () => { view.month++; if (view.month > 11) { view.month = 0; view.year++; } load(); });

load();
