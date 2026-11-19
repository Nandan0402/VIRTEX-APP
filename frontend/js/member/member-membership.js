/** Virtex Member Portal — member-membership.html: current plan, dates, status, renewal and available plans.
 *  Data: GET /api/v1/member/membership (own memberships + fees) and GET /api/v1/membership-plans (catalog, active plans).
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';
import { money, fmtDate, statusPill, NONE, PAY_AT_DESK } from './member-billing-utils.js';

const shell = await initShell({ page: 'membership', title: 'My Membership', subtitle: 'Your plan, membership period and renewal' });

function currentCard(d) {
  const c = d.current;
  const days = c?.days_remaining;
  const expiryNote = c?.end_date
    ? (days < 0 ? `<span class="bl-warn-text">Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago</span>`
      : `${days} day${days === 1 ? '' : 's'} remaining`)
    : '';
  return `<section class="card bl-section bl-current${c && days !== null && days <= 7 ? (days < 0 ? ' is-bad' : ' is-warn') : ''}">
    <div class="bl-head"><h2>Current membership</h2>${statusPill(d.status)}</div>
    <div class="bl-plan-name">${d.planName ? esc(d.planName) : NONE}</div>
    <div class="bl-facts">
      <div><span>Start date</span><b>${fmtDate(c?.start_date)}</b></div>
      <div><span>Expiry date</span><b>${fmtDate(c?.end_date)}</b>${expiryNote ? `<small>${expiryNote}</small>` : ''}</div>
      <div><span>Membership status</span><b>${statusPill(c?.status || d.status)}</b></div>
      <div><span>Amount paid</span><b>${money(c?.price_paid)}</b>${c?.payment_status ? `<small>${statusPill(c.payment_status)}</small>` : ''}</div>
    </div>
    ${c ? '' : '<p class="bl-note">No membership period is recorded for your account yet. The front desk records your plan dates when your membership starts or renews.</p>'}
  </section>`;
}

function renewalCard(d) {
  const c = d.current; const f = d.fees;
  const due = Number(f.due) > 0;
  const autoRenew = c?.auto_renew === true ? 'On — your membership is set to renew automatically'
    : c?.auto_renew === false ? 'Off — renew before your expiry date' : null;
  return `<section class="card bl-section">
    <div class="bl-head"><h2>Renewal &amp; fees</h2></div>
    <dl class="bl-kv">
      <dt>Renews / expires</dt><dd>${fmtDate(c?.end_date)}</dd>
      <dt>Auto-renew</dt><dd>${autoRenew ? esc(autoRenew) : NONE}</dd>
      <dt>Fee amount</dt><dd>${money(f.amount)}</dd>
      <dt>Paid</dt><dd>${money(f.paid)}</dd>
      <dt>Outstanding</dt><dd>${f.due === null || f.due === undefined ? NONE : due ? `<b class="bl-warn-text">${money(f.due)}</b>` : money(f.due)}</dd>
      <dt>Next due date</dt><dd>${fmtDate(f.dueDate)}</dd>
      <dt>Payment status</dt><dd>${statusPill(f.paymentStatus)}</dd>
    </dl>
    <div class="bl-desk">🏢 ${esc(PAY_AT_DESK)}</div>
    <div class="bl-links"><a class="btn btn-outline" href="member-payments.html">Payment history</a><a class="btn btn-outline" href="member-invoices.html">Invoices &amp; receipts</a></div>
  </section>`;
}

function historyCard(rows) {
  if (rows.length <= 1) return '';
  return `<section class="card bl-section"><div class="bl-head"><h2>Membership history</h2></div>
    <div class="table-responsive"><table class="admin-table"><thead><tr><th>Plan</th><th>Start</th><th>End</th><th>Status</th><th>Paid</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r.plan_name ? esc(r.plan_name) : NONE}</td><td>${fmtDate(r.start_date)}</td><td>${fmtDate(r.end_date)}</td>
      <td>${statusPill(r.status)}</td><td>${money(r.price_paid)} ${r.payment_status ? statusPill(r.payment_status) : ''}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}

function plansCard(plans, d) {
  if (plans === null) return `<section class="card bl-section"><div class="bl-head"><h2>Available plans</h2></div>${notice('Plans unavailable', 'The plan catalog could not be loaded right now.', { error: true })}</section>`;
  const currentId = d.current?.plan_id || d.catalogPlan?.id;
  const body = plans.length
    ? `<div class="bl-plans">${plans.map((p) => {
      const perks = Array.isArray(p.perks) ? p.perks : [];
      const isCurrent = String(p.id) === String(currentId);
      return `<article class="bl-plan${isCurrent ? ' is-current' : ''}${p.is_featured ? ' is-featured' : ''}">
        <div class="bl-plan-top"><h3>${esc(p.name)}</h3>${isCurrent ? '<span class="bl-tag">Your plan</span>' : p.badge_label ? `<span class="bl-tag bl-tag-dim">${esc(p.badge_label)}</span>` : ''}</div>
        <div class="bl-price">${money(p.price_inr)}<small>${p.duration_months ? ` / ${esc(p.duration_months)} month${Number(p.duration_months) === 1 ? '' : 's'}` : ''}</small></div>
        ${perks.length ? `<ul class="bl-perks">${perks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </article>`;
    }).join('')}</div>
      <p class="bl-note">To renew or change your plan, please visit the front desk. Prices are the gym's current catalog prices.</p>`
    : emptyState('No plans are listed right now', 'The gym has not published any active membership plans.');
  return `<section class="card bl-section"><div class="bl-head"><h2>Available plans</h2></div>${body}</section>`;
}

if (shell) {
  const { content } = shell;
  content.innerHTML = '<div class="mp-muted mp-loading">Loading your membership…</div>';
  try {
    const [d, plans] = await Promise.all([
      api.get('/membership').then((r) => r.data),
      fetch('/api/v1/membership-plans').then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => j.data || []).catch(() => null),
    ]);
    content.innerHTML = `<div class="bl-cols">${currentCard(d)}${renewalCard(d)}</div>${historyCard(d.history)}${plansCard(plans, d)}`;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your membership', err.message || 'Unexpected error.', { error: true });
  }
}
