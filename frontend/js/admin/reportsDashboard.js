/**
 * reportsDashboard.js — Admin → Reports (admin.html#tab-analytics), simple version.
 * Shows: Leads, Amount collected, Members, Personal trainers, General trainers — this month vs last month —
 * and month-by-month charts + table from any earlier month up to the present month.
 * Data: GET /api/v1/admin/reports/summary?from=YYYY-MM (owner / manager).
 */
import { adminApi } from './adminApi.js';

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthLabel = (ym, long = false) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' });
};
const charts = {};
let fromMonth = null;
let loading = false;

/** "+25% vs last month" style badge. */
function changeBadge(now, before, { money = false } = {}) {
  if (!before && !now) return '<span class="rp-chg flat">No change vs last month</span>';
  if (!before) return `<span class="rp-chg up">▲ New this month (last month ${money ? inr(0) : 0})</span>`;
  const pct = Math.round(((now - before) / before) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
  return `<span class="rp-chg ${cls}">${arrow} ${Math.abs(pct)}% vs last month (${money ? inr(before) : before})</span>`;
}

function monthOptions() {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push(`<option value="${ym}">${esc(monthLabel(ym, true))}${i === 0 ? ' (this month)' : ''}</option>`);
  }
  return opts.join('');
}

function render(d) {
  const months = d.months || [];
  const cur = months.at(-1) || {};
  const prev = months.at(-2) || {};
  const n = d.now || {};

  $('rp-range-label').textContent = months.length > 1
    ? `${monthLabel(d.from, true)} → ${monthLabel(d.to, true)}`
    : monthLabel(d.to, true);

  $('rp-kpis').innerHTML = [
    { icon: '🎯', label: 'Leads this month', value: cur.leads ?? 0, sub: changeBadge(cur.leads || 0, prev.leads || 0), foot: `${n.open_leads ?? 0} open lead${n.open_leads === 1 ? '' : 's'} to follow up`, cls: 'leads' },
    { icon: '💰', label: 'Amount this month', value: inr(cur.amount), sub: changeBadge(cur.amount || 0, prev.amount || 0, { money: true }), foot: `${cur.payments ?? 0} payment${cur.payments === 1 ? '' : 's'} received`, cls: 'amount' },
    { icon: '👥', label: 'Members', value: n.members_total ?? 0, sub: changeBadge(cur.new_members || 0, prev.new_members || 0).replace('vs last month', 'new members vs last month'), foot: `${n.members_active ?? 0} active · ${cur.new_members ?? 0} joined this month`, cls: 'members' },
    { icon: '🤝', label: 'Personal trainers', value: n.personal_trainers ?? 0, sub: `<span class="rp-chg flat">${n.pt_clients ?? 0} member${n.pt_clients === 1 ? '' : 's'} with a personal trainer</span>`, foot: 'Trainers with at least one PT client', cls: 'pt' },
    { icon: '🏋️', label: 'General trainers', value: n.general_trainers ?? 0, sub: `<span class="rp-chg flat">${n.trainers_total ?? 0} trainers in total</span>`, foot: 'Floor trainers with no PT clients', cls: 'gt' },
  ].map((k) => `<div class="rp-kpi rp-${k.cls}">
      <div class="rp-kpi-top"><span class="rp-kpi-icon" aria-hidden="true">${k.icon}</span><span class="rp-kpi-label">${esc(k.label)}</span></div>
      <div class="rp-kpi-value">${esc(k.value)}</div>
      ${k.sub}
      <div class="rp-kpi-foot">${esc(k.foot)}</div>
    </div>`).join('');

  // Month-by-month table (oldest → newest) + change from the first month to now.
  const first = months[0] || {};
  const delta = (a, b, money) => {
    const diff = (a || 0) - (b || 0);
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    return `<span class="rp-chg ${cls}">${diff > 0 ? '+' : diff < 0 ? '−' : ''}${money ? inr(Math.abs(diff)) : Math.abs(diff)}</span>`;
  };
  $('rp-table-body').innerHTML = months.slice().reverse().map((m, i) => `<tr${i === 0 ? ' class="rp-current"' : ''}>
      <td>${esc(monthLabel(m.month, true))}${i === 0 ? ' <span class="rp-tag">Now</span>' : ''}</td>
      <td class="num">${esc(inr(m.amount))}</td><td class="num">${m.leads}</td><td class="num">${m.leads_converted}</td>
      <td class="num">${m.new_members}</td><td class="num">${m.new_pt_clients}</td><td class="num">${m.new_trainers}</td>
    </tr>`).join('') + (months.length > 1 ? `<tr class="rp-delta">
      <td>Change: ${esc(monthLabel(first.month))} → ${esc(monthLabel(cur.month))}</td>
      <td class="num">${delta(cur.amount, first.amount, true)}</td><td class="num">${delta(cur.leads, first.leads)}</td><td class="num">${delta(cur.leads_converted, first.leads_converted)}</td>
      <td class="num">${delta(cur.new_members, first.new_members)}</td><td class="num">${delta(cur.new_pt_clients, first.new_pt_clients)}</td><td class="num">${delta(cur.new_trainers, first.new_trainers)}</td>
    </tr>` : '');

  const total = (k) => months.reduce((s, m) => s + Number(m[k] || 0), 0);
  $('rp-amount-total').textContent = `${inr(total('amount'))} in total`;
  $('rp-growth-total').textContent = `${total('leads')} leads · ${total('new_members')} new members`;
  drawCharts(months);
}

function drawCharts(months) {
  if (!window.Chart) return;
  const labels = months.map((m) => monthLabel(m.month));
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--text-gray').trim() || '#a1a1aa';
  const grid = 'rgba(255, 255, 255, 0.06)';
  const common = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { labels: { color: text, boxWidth: 12, usePointStyle: true } }, tooltip: { mode: 'index', intersect: false } },
    scales: { x: { ticks: { color: text }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: text, precision: 0 }, grid: { color: grid } } },
  };
  const make = (id, cfg) => {
    const el = $(id); if (!el) return;
    charts[id]?.destroy();
    charts[id] = new window.Chart(el, cfg);
  };
  make('rp-chart-amount', {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Amount collected (₹)', data: months.map((m) => m.amount), backgroundColor: '#22c55e', borderRadius: 6, maxBarThickness: 46 }] },
    options: { ...common, plugins: { ...common.plugins, legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.parsed.y) } } },
      scales: { ...common.scales, y: { ...common.scales.y, ticks: { color: text, callback: (v) => inr(v) } } } },
  });
  make('rp-chart-growth', {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'Leads', data: months.map((m) => m.leads), backgroundColor: '#f59e0b', borderRadius: 5, maxBarThickness: 26 },
      { label: 'New members', data: months.map((m) => m.new_members), backgroundColor: '#38bdf8', borderRadius: 5, maxBarThickness: 26 },
      { label: 'New PT clients', data: months.map((m) => m.new_pt_clients), backgroundColor: '#a78bfa', borderRadius: 5, maxBarThickness: 26 },
    ] },
    options: common,
  });
}

export async function loadReports() {
  const root = $('rp-root');
  if (!root || loading) return;
  const sel = $('rp-from');
  if (!sel.options.length) {
    sel.innerHTML = monthOptions();
    const d = new Date(); d.setMonth(d.getMonth() - 5);
    fromMonth = fromMonth || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    sel.value = fromMonth;
    sel.addEventListener('change', () => { fromMonth = sel.value; loadReports(); });
    $('rp-refresh').addEventListener('click', () => loadReports());
  }
  loading = true;
  $('rp-error').hidden = true;
  root.classList.add('is-loading');
  try {
    const res = await fetch(`/api/v1/admin/reports/summary?from=${encodeURIComponent(fromMonth)}`, { headers: adminApi.getHeaders(true) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error(j.error?.message || j.error || `Could not load reports (${res.status}).`);
    render(j.data);
  } catch (err) {
    $('rp-error').textContent = err.message;
    $('rp-error').hidden = false;
  } finally {
    loading = false;
    root.classList.remove('is-loading');
  }
}
