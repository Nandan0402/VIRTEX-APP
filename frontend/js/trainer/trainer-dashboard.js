/** Virtex Trainer Hub — trainer-dashboard.html: trainer statistics and daily overview. */
import { api } from './trainer-api.js';

/** Gym-welfare share (default 20% of PT clients' monthly fees), due at month end. Shown from 7 days before
 *  until the admin records the payment on Fees Due. An unpaid previous month is shown first. */
function welfareBanner(w) {
  const x = w?.previousUnpaid || (w?.current?.showAlert ? w.current : null);
  if (!x) return '';
  const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const overdue = x.daysLeft < 0;
  const days = Math.abs(x.daysLeft);
  const due = new Date(`${x.dueDate}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const big = x.daysLeft === 0 ? 'Today' : String(days);
  const unit = x.daysLeft === 0 ? '' : `day${days === 1 ? '' : 's'} ${overdue ? 'overdue' : 'left'}`;
  return `<section class="tp-welfare ${overdue ? 'overdue' : 'soon'}" role="alert">
    <div class="tp-welfare-count" aria-hidden="true"><b>${big}</b><span>${unit}</span></div>
    <div class="tp-welfare-text"><h2>${overdue ? '🚨 Gym welfare share overdue' : '⏳ Gym welfare share due soon'}</h2>
      <p><b>${rupees(x.amount)}</b> — ${x.percent}% of ${rupees(x.base)} (your ${x.clients} PT client${x.clients === 1 ? '' : 's'}' monthly fees), due <b>${due}</b>.</p>
      <small>Pay at the front desk. This alert disappears once the admin records it.</small></div>
  </section>`;
}
import { initShell, esc, dash, fmtDate, fmtDateTime, fmtTime, fmtMoney, badge, emptyState, notAvailable, renderError, pageHref } from './trainer-navigation.js';

const shell = await initShell({ page: 'dashboard', title: 'Dashboard', subtitle: 'Your clients, sessions and alerts at a glance' });

const sameDay = (v, d = new Date()) => v && new Date(v).toDateString() === d.toDateString();
const stat = (label, value, sub = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="tp-stat${href ? ' tp-stat-link' : ''}">
  <div class="tp-stat-label">${esc(label)}</div><div class="tp-stat-value">${value}</div>${sub ? `<div class="tp-stat-sub">${esc(sub)}</div>` : ''}</${href ? 'a' : 'div'}>`;
const card = (title, inner, action = '') => `<div class="card"><div class="card-header tp-card-head"><h3 class="tp-card-title">${esc(title)}</h3>${action}</div>${inner}</div>`;

function todayPanel(schedule, todaySessions) {
  const now = new Date();
  const shifts = schedule.weekly.filter((w) => Number(w.day_of_week) === now.getDay());
  const exceptions = schedule.upcomingAvailability.filter((a) => sameDay(a.specific_date, now));
  const rostered = (schedule.staffShifts || []).filter((r) => sameDay(r.shift_date, now));
  const shiftText = rostered.length
    ? rostered.map((r) => `${fmtTime(r.start_time)}–${fmtTime(r.end_time)} · ${esc(r.shift_type || 'shift')}${r.branch_name ? ` @ ${esc(r.branch_name)}` : ''} (rostered)`).join(', ')
    : shifts.length
      ? shifts.map((s) => `${fmtTime(s.shift_start)}–${fmtTime(s.shift_end)}${s.is_available ? '' : ' (off)'}`).join(', ')
      : 'No shift today';
  const sessionsText = todaySessions === null ? 'PT sessions: available after database update'
    : `${todaySessions.length} PT session${todaySessions.length === 1 ? '' : 's'} booked`;
  return `<div class="tp-today">
    <div class="tp-today-date"><span>${now.toLocaleDateString(undefined, { weekday: 'long' })}</span>
      <strong>${now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
    <ul class="tp-today-list">
      <li><span>🗓️</span><div><b>Shift</b><div class="tp-muted">${shiftText}</div></div></li>
      <li><span>🤝</span><div><b>Sessions</b><div class="tp-muted">${esc(sessionsText)}</div></div></li>
      <li><span>⛔</span><div><b>Availability changes</b><div class="tp-muted">${exceptions.length
        ? exceptions.map((a) => `${fmtTime(a.start_time)}–${fmtTime(a.end_time)} ${a.is_available ? 'extra' : 'unavailable'}${a.reason ? ` · ${esc(a.reason)}` : ''}`).join('<br>')
        : 'None today'}</div></div></li>
    </ul></div>`;
}

/** Active announcements published by Admin (GET /api/v1/announcements?activeOnly=true). */
function announcementList(rows) {
  if (rows === null) return '<div class="tp-muted">Announcements could not be loaded right now.</div>';
  if (!rows.length) return emptyState('No announcements', 'Notices published by the gym admin appear here.');
  return `<div class="tp-list">${rows.map((a) => `<div class="tp-row tp-ann tp-ann-${esc(String(a.priority || 'normal').toLowerCase())}"><div class="tp-row-main">
      <div class="tp-row-title">${esc(a.title)}</div>
      <div class="tp-ann-body">${esc(a.message)}</div>
      <div class="tp-row-sub">${a.start_date ? fmtDate(a.start_date) : ''}${a.end_date ? ` – ${fmtDate(a.end_date)}` : ''}</div></div>
      ${a.priority ? `<span class="tp-chip">${esc(a.priority)}</span>` : ''}</div>`).join('')}</div>`;
}

if (shell) {
  const { content } = shell;
  content.innerHTML = '<div class="tp-muted tp-loading">Loading dashboard…</div>';
  try {
    const [d, schedule, announcements, welfare] = await Promise.all([
      api.get('/dashboard').then((r) => r.data),
      api.get('/schedule').then((r) => r.data),
      api.get('/announcements').then((r) => (r.data.announcements || []).slice(0, 5).map((a) => ({ ...a, start_date: a.postedAt, end_date: a.endDate, title: `${a.poll ? '📊 ' : ''}${a.title}` }))).catch(() => null),   // optional: never blocks the dashboard
      api.get('/welfare').then((r) => r.data).catch(() => null),   // gym-welfare share countdown (optional)
    ]);
    const s = d.summary || {};

    const sessions = d.todaySessions === null
      ? notAvailable('Today\'s PT sessions')
      : d.todaySessions.length
        ? `<div class="tp-list">${d.todaySessions.map((x) => `<div class="tp-row"><div class="tp-row-main">
            <div class="tp-row-title">${esc(x.member_name)}</div>
            <div class="tp-row-sub">${fmtDateTime(x.scheduled_start)} – ${fmtDateTime(x.scheduled_end)} · ${dash(x.location)}</div></div>${badge(x.status)}</div>`).join('')}</div>`
        : emptyState('No PT sessions today');

    const avail = d.upcomingAvailability.length
      ? `<div class="tp-list">${d.upcomingAvailability.map((a) => `<div class="tp-row"><div class="tp-row-main">
          <div class="tp-row-title">${fmtDate(a.specific_date)} · ${fmtTime(a.start_time)}–${fmtTime(a.end_time)}</div>
          <div class="tp-row-sub">${dash(a.reason)}</div></div>${a.is_available ? '<span class="badge badge-green">extra</span>' : '<span class="badge badge-danger">unavailable</span>'}</div>`).join('')}</div>`
      : emptyState('No upcoming availability changes');

    content.innerHTML = `
      ${welfareBanner(welfare)}
      <div class="tp-dash-hero">
        <div class="card tp-welcome"><div class="tp-welcome-name">Welcome, ${esc(d.trainer.fullName)}</div>
          <div class="tp-muted">${dash(d.trainer.specialty)} · ${badge(d.trainer.status)}</div></div>
        <div class="card">${todayPanel(schedule, d.todaySessions)}</div>
      </div>
      <div class="tp-grid">
        ${stat('Active clients', s.active_clients ?? 0, `${s.paused_clients ?? 0} paused`, pageHref('trainer-clients.html'))}
        ${stat('Active workout plans', s.active_workout_assignments ?? 0, `${s.my_workout_programs ?? 0} programmes created`, pageHref('trainer-workouts.html'))}
        ${stat('Active diet plans', s.active_diet_assignments ?? 0, `${s.my_diet_plans ?? 0} plans created`, pageHref('trainer-diet-plans.html'))}
        ${stat('Client fees due', fmtMoney(s.client_fees_due ?? 0), 'Active assignments')}
      </div>
      ${card('Today\'s PT sessions', sessions, `<a class="btn btn-outline" href="${pageHref('trainer-pt-sessions.html')}">All sessions</a>`)}
      <div class="tp-grid-2">
        ${card('Gym announcements', announcementList(announcements))}
        ${card('Upcoming availability', avail, `<a class="btn btn-outline" href="${pageHref('trainer-schedule.html')}">Open schedule</a>`)}
      </div>`;
  } catch (err) {
    renderError(content, err, 'Dashboard');
  }
}
