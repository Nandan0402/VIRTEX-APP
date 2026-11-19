/** Virtex Member Portal — member-attendance.html: my gym attendance.
 *  Uses: GET /api/v1/member/attendance?page=&limit=&from=&to=
 *  Records come from check_ins — written by Admin check-in and the FitBot reception kiosk.
 *  This page only reads them (it never creates a check-in). Check-out is not recorded by the gym,
 *  so it is shown as "Not tracked" — never estimated.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';
import { barChart } from './member-charts.js';

const shell = await initShell({ page: 'attendance', title: 'Attendance', subtitle: 'Your gym check-ins and visit history' });

const dLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const tShort = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dShort = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const mShort = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short' });
const diff = (a, b, unit) => (a === b ? `same as last ${unit}` : `${a > b ? '▲' : '▼'} ${Math.abs(a - b)} vs last ${unit}`);

if (shell) {
  const { content } = shell;
  let data = null; let page = 1; let from = ''; let to = '';

  const tile = (label, value, sub = '') => `<div class="mm-tile"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;

  function render() {
    const s = data.summary; const h = data.history;
    const none = !s.totalDays;
    const weekItems = data.weekly.map((w, i) => ({ label: dShort(w.weekStart), v: w.days, current: i === data.weekly.length - 1, title: `Week of ${dShort(w.weekStart)}: ${w.days} visit day${w.days === 1 ? '' : 's'}` }));
    const monthItems = data.monthly.map((m, i) => ({ label: mShort(m.monthStart), v: m.days, current: i === data.monthly.length - 1, title: `${new Date(`${m.monthStart}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${m.days} visit day${m.days === 1 ? '' : 's'}` }));
    content.innerHTML = `<div class="pg-wrap">
      <section class="pg-card"><h2 class="pg-h">Attendance summary</h2>
        ${none ? '<p class="pg-muted">No check-ins yet. Check in at the FitBot reception kiosk or at the front desk and your visits will appear here.</p>' : `
        <div class="at-tiles">
          ${tile('This week', s.thisWeek, esc(diff(s.thisWeek, s.lastWeek, 'week')))}
          ${tile('This month', s.thisMonth, esc(diff(s.thisMonth, s.lastMonth, 'month')))}
          ${tile('Last 30 days', s.last30Days, 'visit days')}
          ${tile('All time', s.totalDays, `since ${esc(dLong(s.firstVisit))}`)}
          ${tile('Average per week', s.avgPerWeek ?? '—', `over ${s.weeksCounted} week${s.weeksCounted === 1 ? '' : 's'}`)}
          ${tile('Weekly streak', s.weekStreak, `week${s.weekStreak === 1 ? '' : 's'} in a row with a visit`)}
        </div>
        <p class="pg-muted at-habits">Last visit: <b>${esc(dLong(s.lastVisit))} at ${esc(tShort(s.lastVisit))}</b>${s.usualDay ? ` · You usually come on <b>${esc(s.usualDay)}</b>${s.usualTime ? ` in the <b>${esc(s.usualTime)}</b>` : ''} (last 90 days)` : ''}</p>`}
        <p class="pg-foot">Counts are visit days — one check-in per day is recorded.</p>
      </section>
      <div class="at-two">
        <section class="pg-card"><h2 class="pg-h">Weekly attendance</h2>${barChart(weekItems, { label: 'Visit days per week, last 12 weeks', unit: 'Visit days (this week so far)' })}</section>
        <section class="pg-card"><h2 class="pg-h">Monthly attendance</h2>${barChart(monthItems, { label: 'Visit days per month, last 12 months', unit: 'Visit days (this month so far)' })}</section>
      </div>
      <section class="pg-card"><div class="cl-head"><h2 class="pg-h">Attendance history</h2>
          <form class="at-filter" id="at-filter"><label>From <input type="date" name="from" value="${esc(from)}"></label><label>To <input type="date" name="to" value="${esc(to)}"></label>
            <button type="submit" class="btn btn-outline">Filter</button>${from || to ? '<button type="button" class="btn btn-outline" id="at-clear">Clear</button>' : ''}</form></div>
        ${h.data.length ? `<div class="pg-scroll"><table class="admin-table pg-tbl at-tbl"><thead><tr><th>Date</th><th>Check-in</th><th>Check-out</th><th>How</th><th>Where</th></tr></thead><tbody>
          ${h.data.map((r) => `<tr><td>${esc(dLong(r.checkInAt))}</td><td><b>${esc(tShort(r.checkInAt))}</b></td>
            <td>${r.checkOutAt ? esc(tShort(r.checkOutAt)) : '<span class="pg-missing" title="The gym does not record check-out times">Not tracked</span>'}</td>
            <td>${esc(r.methodLabel)}</td><td>${esc(r.device || '—')}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="at-pager"><button type="button" class="btn btn-outline" id="at-prev"${h.pagination.page <= 1 ? ' disabled' : ''}>‹ Newer</button>
            <span>Page ${h.pagination.page} of ${h.pagination.totalPages} · ${h.pagination.total} check-in${h.pagination.total === 1 ? '' : 's'}</span>
            <button type="button" class="btn btn-outline" id="at-next"${h.pagination.page >= h.pagination.totalPages ? ' disabled' : ''}>Older ›</button></div>`
          : `<p class="pg-muted">${from || to ? 'No check-ins in this date range.' : 'No check-ins recorded yet.'}</p>`}
        <p class="pg-foot">From the gym's check-in records (front desk and FitBot kiosk). Check-out times are not recorded by the gym.</p>
      </section></div>`;
    content.querySelector('#at-filter').addEventListener('submit', (e) => { e.preventDefault(); from = e.target.from.value; to = e.target.to.value; page = 1; load(); });
    content.querySelector('#at-clear')?.addEventListener('click', () => { from = ''; to = ''; page = 1; load(); });
    content.querySelector('#at-prev')?.addEventListener('click', () => { page -= 1; load(); });
    content.querySelector('#at-next')?.addEventListener('click', () => { page += 1; load(); });
  }

  async function load() {
    try { data = (await api.get('/attendance', { page, limit: 20, from: from || undefined, to: to || undefined })).data; render(); }
    catch (e) { content.innerHTML = notice('Could not load attendance', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
  }
  content.innerHTML = '<div class="mp-loading">Loading attendance…</div>';
  await load();
}
